#!/usr/bin/env node
'use strict';

/**
 * scripts/telegram-backup.js
 * Standalone daily backup script for 9Router SQLite database to Telegram.
 * Runs independently without requiring Next.js runtime.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

// 1. Read environment variables from .env if present
const rootDir = path.resolve(__dirname, '..');
const envFile = path.join(rootDir, '.env');

function loadEnv() {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const allowedIdsStr = process.env.ALLOWED_USER_IDS;
const rawDataDir = process.env.DATA_DIR || './data';
const resolvedDataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.resolve(rootDir, rawDataDir);
const dbPath = path.join(resolvedDataDir, 'db', 'data.sqlite');

if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing in .env');
  process.exit(1);
}

const chatIds = (allowedIdsStr || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (chatIds.length === 0) {
  console.error('❌ ALLOWED_USER_IDS is empty or missing in .env');
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`❌ SQLite database file not found at: ${dbPath}`);
  process.exit(1);
}

function getServerMetrics() {
  let disk = { totalGB: '?', freeGB: '?', usedGB: '?', percent: '?' };
  try {
    const rootPath = process.platform === 'win32' ? process.cwd() : '/';
    const st = fs.statfsSync(rootPath);
    const bsize = Number(st.bsize);
    const totalBytes = Number(st.blocks) * bsize;
    const freeBytes = Number(st.bfree) * bsize;
    const usedBytes = totalBytes - freeBytes;
    const totalGB = (totalBytes / (1024 ** 3)).toFixed(1);
    const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
    const usedGB = (usedBytes / (1024 ** 3)).toFixed(1);
    const percent = Math.round((usedBytes / totalBytes) * 100);
    disk = { totalGB, freeGB, usedGB, percent };
  } catch {}

  let totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  let freeMemMB = Math.round(os.freemem() / (1024 * 1024));
  let usedMemMB = totalMemMB - freeMemMB;
  let memPercent = Math.round((usedMemMB / totalMemMB) * 100);

  // Accurate Linux memory from /proc/meminfo (excludes disk cache)
  try {
    if (fs.existsSync('/proc/meminfo')) {
      const txt = fs.readFileSync('/proc/meminfo', 'utf8');
      const parseKB = (name) => {
        const line = txt.split('\n').find(l => l.startsWith(name + ':'));
        if (!line) return 0;
        const val = line.replace(/[^0-9]/g, '');
        return parseInt(val, 10) || 0;
      };
      const totalKB = parseKB('MemTotal');
      const availKB = parseKB('MemAvailable');
      const freeKB = parseKB('MemFree');
      const bufKB = parseKB('Buffers');
      const cacheKB = parseKB('Cached');
      if (totalKB > 0) {
        totalMemMB = Math.round(totalKB / 1024);
        const actualUsedKB = Math.max(0, totalKB - freeKB - bufKB - cacheKB);
        usedMemMB = Math.round(actualUsedKB / 1024);
        freeMemMB = availKB > 0 ? Math.round(availKB / 1024) : Math.round(freeKB / 1024);
        memPercent = Math.round((usedMemMB / totalMemMB) * 100);
      }
    }
  } catch {}

  const uptimeSec = Math.floor(os.uptime());
  const upDays = Math.floor(uptimeSec / 86400);
  const upHours = Math.floor((uptimeSec % 86400) / 3600);
  const upMins = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = (upDays > 0 ? upDays + ' ngày ' : '') + upHours + 'h ' + upMins + 'm';

  const loadAvg = os.loadavg()[0] || 0;
  const nodeMemMB = Math.round(process.memoryUsage().rss / (1024 * 1024));

  return {
    disk,
    mem: { totalMB: totalMemMB, usedMB: usedMemMB, freeMB: freeMemMB, percent: memPercent },
    uptimeStr,
    cpuLoad: loadAvg.toFixed(2),
    nodeMemMB
  };
}

async function run() {
  console.log(`[TelegramBackup] Reading database: ${dbPath}`);
  const rawBuffer = fs.readFileSync(dbPath);
  const rawSizeKB = Math.round(rawBuffer.length / 1024);
  const gzBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
  const gzSizeKB = Math.round(gzBuffer.length / 1024);

  // Read stats from SQLite
  let stats = { total: 0, agActive: 0, agInactive: 0, claude: 0, codex: 0, keys: 0 };
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare('SELECT provider, isActive, COUNT(*) as count FROM providerConnections GROUP BY provider, isActive').all();
    for (const r of rows) {
      const cnt = Number(r.count || 0);
      stats.total += cnt;
      if (r.provider === 'antigravity') {
        if (r.isActive) stats.agActive += cnt;
        else stats.agInactive += cnt;
      } else if (r.provider === 'claude' || r.provider === 'anthropic') {
        stats.claude += cnt;
      } else if (r.provider === 'codex') {
        stats.codex += cnt;
      }
    }
    const keyRow = db.prepare('SELECT COUNT(*) as c FROM client_keys').get();
    stats.keys = keyRow?.c || 0;
    db.close();
  } catch (err) {
    console.warn('[TelegramBackup] Could not query SQLite stats:', err.message);
  }

  const vps = getServerMetrics();
  const now = new Date();
  const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const pad = n => String(n).padStart(2, '0');
  const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `9router-data-${dateTag}.sqlite.gz`;

  const caption = [
    `📦 <b>BẢN SAO LƯU DỮ LIỆU ĐỊNH KỲ 9ROUTER (SQLITE)</b>`,
    `📅 <b>Thời gian:</b> <code>${timeStr}</code>`,
    `🔄 <b>Hình thức:</b> ⏰ Tự động định kỳ hàng ngày (Cron)`,
    ``,
    `🖥 <b>Thông số máy chủ VPS:</b>`,
    `• <b>CPU Load:</b> <code>${vps.cpuLoad}</code>`,
    `• <b>RAM VPS:</b> <code>${vps.mem.usedMB} MB / ${vps.mem.totalMB} MB (${vps.mem.percent}%) — Trống: ${vps.mem.freeMB} MB</code>`,
    `• <b>Ổ cứng (Disk):</b> <code>${vps.disk.usedGB} GB / ${vps.disk.totalGB} GB (Trống: ${vps.disk.freeGB} GB)</code>`,
    `• <b>Uptime hệ thống:</b> <code>${vps.uptimeStr}</code>`,
    `• <b>RAM Node (9Router):</b> <code>${vps.nodeMemMB} MB</code>`,
    ``,
    `📊 <b>Tài khoản AI đang kết nối:</b>`,
    `• <b>Antigravity:</b> ${stats.agActive} hoạt động${stats.agInactive > 0 ? ` (${stats.agInactive} lỗi 401)` : ''}`,
    `• <b>Claude Code:</b> ${stats.claude} tài khoản`,
    `• <b>OpenAI Codex:</b> ${stats.codex} tài khoản`,
    `• <b>Client Keys:</b> ${stats.keys} keys hoạt động`,
    `• <b>Dung lượng file nén:</b> <b>${gzSizeKB} KB</b> (Gốc: ${rawSizeKB} KB)`,
    ``,
    `<i>💡 File này lưu toàn bộ tài khoản, access token và lịch sử dùng key. Lưu về máy an toàn.</i>`
  ].join('\n');

  console.log(`[TelegramBackup] Prepared archive ${filename} (${gzSizeKB} KB). Sending to ${chatIds.length} recipient(s)...`);

  for (const chatId of chatIds) {
    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', new Blob([gzBuffer], { type: 'application/gzip' }), filename);
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        console.log(`✅ Sent backup to chat ${chatId} (Msg ID: ${data.result?.message_id})`);
      } else {
        console.error(`❌ Failed to send to chat ${chatId}:`, data.description || res.status);
      }
    } catch (err) {
      console.error(`❌ Error sending to chat ${chatId}:`, err.message);
    }
  }

  console.log('[TelegramBackup] Daily backup completed successfully.');
}

run().catch(err => {
  console.error('❌ Fatal error in Telegram backup script:', err);
  process.exit(1);
});
