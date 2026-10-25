import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { DATA_FILE } from './db/paths.js';
import { getAdapter } from './db/driver.js';

function getTelegramConfig() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const envAllowed = process.env.ALLOWED_USER_IDS;
  let chatIds = [];
  if (envAllowed) {
    chatIds = String(envAllowed)
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
  }
  return { botToken, chatIds };
}

export function isUserAllowed(userId) {
  const { chatIds } = getTelegramConfig();
  if (!chatIds || chatIds.length === 0) return true;
  return chatIds.includes(String(userId));
}

export function getServerMetrics() {
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

export async function getStats() {
  try {
    const adapter = await getAdapter();
    const rows = (await adapter.all('SELECT provider, isActive, COUNT(*) as count FROM providerConnections GROUP BY provider, isActive')) || [];

    let totalConnections = 0;
    let agActive = 0;
    let agInactive = 0;
    let claudeCount = 0;
    let codexCount = 0;
    let otherCount = 0;

    for (const r of rows) {
      const cnt = Number(r.count || 0);
      totalConnections += cnt;
      if (r.provider === 'antigravity') {
        if (r.isActive) agActive += cnt;
        else agInactive += cnt;
      } else if (r.provider === 'claude' || r.provider === 'anthropic') {
        claudeCount += cnt;
      } else if (r.provider === 'codex') {
        codexCount += cnt;
      } else {
        otherCount += cnt;
      }
    }

    const keysRow = await adapter.get('SELECT COUNT(*) as count FROM client_keys');
    return {
      totalConnections,
      agActive,
      agInactive,
      agTotal: agActive + agInactive,
      claudeCount,
      codexCount,
      otherCount,
      clientKeysCount: keysRow?.count || 0
    };
  } catch (err) {
    console.warn('[TelegramBackup] Failed to get SQLite stats:', err.message);
    return {
      totalConnections: 0,
      agActive: 0,
      agInactive: 0,
      agTotal: 0,
      claudeCount: 0,
      codexCount: 0,
      otherCount: 0,
      clientKeysCount: 0
    };
  }
}

export async function sendBackupToChat({ chatId, botToken, trigger = 'manual' }) {
  if (!botToken || !chatId) {
    throw new Error('Thiếu Telegram Bot Token hoặc Chat ID');
  }

  const dbPath = DATA_FILE;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`File SQLite không tồn tại tại đường dẫn: ${dbPath}`);
  }

  // 1. Read SQLite file and compress with Gzip
  const rawBuffer = fs.readFileSync(dbPath);
  const rawSizeKB = Math.round(rawBuffer.length / 1024);
  const gzBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
  const gzSizeKB = Math.round(gzBuffer.length / 1024);

  // 2. Fetch system & SQLite stats
  const stats = await getStats();
  const vps = getServerMetrics();
  const now = new Date();
  const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const pad = n => String(n).padStart(2, '0');
  const dateTag = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `9router-data-${dateTag}.sqlite.gz`;

  const triggerLabel = trigger === 'daily_cron' ? '⏰ Tự động định kỳ mỗi ngày' : '⚡ Yêu cầu thủ công tức thì';

  // 3. Caption format with accurate VPS metrics
  const caption = [
    `📦 <b>BẢN SAO LƯU DỮ LIỆU 9ROUTER (SQLITE)</b>`,
    `📅 <b>Thời gian:</b> <code>${timeStr}</code>`,
    `🔄 <b>Hình thức:</b> ${triggerLabel}`,
    ``,
    `🖥 <b>Thông số máy chủ VPS:</b>`,
    `• <b>CPU Load:</b> <code>${vps.cpuLoad}</code>`,
    `• <b>RAM VPS:</b> <code>${vps.mem.usedMB} MB / ${vps.mem.totalMB} MB (${vps.mem.percent}%) — Trống: ${vps.mem.freeMB} MB</code>`,
    `• <b>Ổ cứng:</b> <code>${vps.disk.usedGB} GB / ${vps.disk.totalGB} GB (Trống: ${vps.disk.freeGB} GB)</code>`,
    `• <b>Uptime hệ thống:</b> <code>${vps.uptimeStr}</code>`,
    `• <b>RAM tiến trình 9Router:</b> <code>${vps.nodeMemMB} MB</code>`,
    ``,
    `📊 <b>Tài khoản AI đang kết nối:</b>`,
    `• <b>Antigravity:</b> ${stats.agActive} hoạt động${stats.agInactive > 0 ? ` (${stats.agInactive} lỗi 401)` : ''}`,
    `• <b>Claude Code:</b> ${stats.claudeCount} tài khoản`,
    `• <b>OpenAI Codex:</b> ${stats.codexCount} tài khoản`,
    `• <b>Client Keys:</b> ${stats.clientKeysCount} keys hoạt động`,
    `• <b>Dung lượng file nén:</b> <b>${gzSizeKB} KB</b> (Gốc: ${rawSizeKB} KB)`,
    ``,
    `<i>💡 File này lưu toàn bộ tài khoản, access token và lịch sử dùng key. Lưu về máy an toàn.</i>`
  ].join('\n');

  // 4. Send Document via Telegram Bot API using native FormData & Blob
  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('document', new Blob([gzBuffer], { type: 'application/gzip' }), filename);
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData
  });

  const resData = await res.json().catch(() => ({}));
  if (!res.ok || !resData.ok) {
    throw new Error(resData.description || `Telegram API error (${res.status})`);
  }

  return { ok: true, filename, rawSizeKB, gzSizeKB, messageId: resData.result?.message_id };
}

export async function sendBackupToAllAllowedUsers(trigger = 'daily_cron') {
  const { botToken, chatIds } = getTelegramConfig();
  if (!botToken || chatIds.length === 0) {
    console.warn('[TelegramBackup] TELEGRAM_BOT_TOKEN hoặc ALLOWED_USER_IDS chưa được cấu hình.');
    return { ok: false, sentCount: 0 };
  }

  const results = [];
  for (const chatId of chatIds) {
    try {
      const res = await sendBackupToChat({ chatId, botToken, trigger });
      results.push({ chatId, success: true, ...res });
    } catch (err) {
      console.error(`[TelegramBackup] Gửi backup tới ${chatId} thất bại:`, err.message);
      results.push({ chatId, success: false, error: err.message });
    }
  }

  return { ok: true, results };
}
