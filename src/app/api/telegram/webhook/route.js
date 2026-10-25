import { NextResponse } from 'next/server';
import { getAdapter } from '@/lib/db/driver';
import { DATA_FILE } from '@/lib/db/paths';
import { getSettings } from '@/lib/localDb';
import { sendBackupToChat, isUserAllowed, getStats, getServerMetrics } from '@/lib/telegramBackup';

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// Keyboard layout for authorized users
const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📦 Lấy Backup Data Ngay' }],
    [{ text: '📊 Trạng Thái Hệ Thống' }, { text: '👥 Danh Sách Tài Khoản' }],
    [{ text: '🔑 Danh Sách Client Key' }, { text: 'ℹ️ Hướng Dẫn' }]
  ],
  resize_keyboard: true,
  persistent: true
};

function maskEmail(email = '') {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 4) return `${name.slice(0, 1)}***@${domain}`;
  return `${name.slice(0, 2)}***${name.slice(-2)}@${domain}`;
}

function maskKey(key = '') {
  if (!key || key.length < 12) return key;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function parseCourseraSheetAccounts(text = '') {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const accounts = [];
  for (const line of lines) {
    if (!line.includes(',') || !line.includes('@')) return [];
    const parts = line.split(',').map(part => part.trim());
    if (parts.length < 2 || parts.length > 3) return [];
    const [email, password, courseCode] = parts;
    if (!email || !password || !EMAIL_REGEX.test(email)) return [];
    accounts.push({
      email: email.toLowerCase(),
      password,
      courseCode: courseCode || ''
    });
  }
  return accounts;
}

function parseHotmailLine(line) {
  const cleanLine = line.trim();
  const separator = cleanLine.includes('|') ? '|' : ':';
  const parts = cleanLine.split(separator).map(p => p.trim());
  if (parts.length < 2) return null;

  const email = parts[0].toLowerCase();
  const password = parts[1];
  if (!email || !password || !EMAIL_REGEX.test(email)) return null;

  return {
    email,
    password,
    totp_secret: parts[2] || null,
    client_id: parts[3] || null,
    refresh_token: parts[4] || null
  };
}

async function pushToGoogleSheet(scriptUrl, sheetName = '', data = []) {
  const cleanUrl = String(scriptUrl || '').replace(/[\r\n\s]/g, '').trim();
  if (!cleanUrl) {
    throw new Error('Google Sheet script URL is not configured.');
  }
  const res = await fetch(cleanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetName, data })
  });
  if (!res.ok) {
    throw new Error(`Google Script returned HTTP ${res.status}`);
  }
  const responseText = await res.text();
  try {
    return JSON.parse(responseText);
  } catch {
    return { success: true, raw: responseText };
  }
}

export async function POST(request) {
  try {
    let settings = {};
    try {
      settings = (await getSettings()) || {};
    } catch (e) {
      console.warn('[Telegram Webhook] getSettings fallback:', e?.message);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN || settings?.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' });
    }

    const sendTelegramMessage = async (chatId, text, extraOptions = {}) => {
      try {
        const payload = {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: MAIN_KEYBOARD,
          ...extraOptions
        };
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.error('[Telegram Send Error]', err.message);
      }
    };

    let update;
    try {
      update = await request.json();
    } catch {
      return NextResponse.json({ ok: true, message: 'Invalid JSON payload' });
    }

    const message = update?.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat?.id;
    const senderId = message.from?.id || chatId;
    const text = String(message.text || '').trim();

    if (!chatId) return NextResponse.json({ ok: true });

    // 🔒 Security: Check allowed users
    if (!isUserAllowed(senderId) && !isUserAllowed(chatId)) {
      await sendTelegramMessage(
        chatId,
        `⛔ <b>Từ chối truy cập!</b>\nBạn không có quyền tương tác với bot này.\nID của bạn: <code>${senderId}</code>`
      );
      return NextResponse.json({ ok: true });
    }

    // 📦 1. TẢI BACKUP DATABASE (Button or Command)
    if (text === '📦 Lấy Backup Data Ngay' || text === '/backup' || text === '/getdb') {
      await sendTelegramMessage(chatId, `⏳ <i>Đang đóng băng cơ sở dữ liệu SQLite và nén file an toàn...</i>`);
      try {
        const res = await sendBackupToChat({ chatId, botToken, trigger: 'manual' });
        console.log(`[Telegram Webhook] Đã gửi backup cho chat ${chatId}: ${res.filename} (${res.gzSizeKB} KB)`);
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ <b>Lỗi tạo bản sao lưu:</b> ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // 📊 2. TRẠNG THÁI HỆ THỐNG (VPS Hardware Metrics & Accounts)
    if (text === '📊 Trạng Thái Hệ Thống' || text === '/status') {
      try {
        const stats = await getStats();
        const vps = getServerMetrics();

        const statusMsg = [
          `<b>📊 TRẠNG THÁI HỆ THỐNG VPS & 9ROUTER</b>`,
          `━━━━━━━━━━━━━━━━━━━`,
          `🖥 <b>THÔNG SỐ MÁY CHỦ VPS:</b>`,
          `• <b>CPU Load:</b> <code>${vps.cpuLoad}</code>`,
          `• <b>RAM VPS:</b> <code>${vps.mem.usedMB} MB / ${vps.mem.totalMB} MB (${vps.mem.percent}%) — Trống: ${vps.mem.freeMB} MB</code>`,
          `• <b>Ổ cứng (Disk):</b> <code>${vps.disk.usedGB} GB / ${vps.disk.totalGB} GB (Trống: ${vps.disk.freeGB} GB)</code>`,
          `• <b>Uptime hệ thống:</b> <code>${vps.uptimeStr}</code>`,
          `• <b>RAM tiến trình 9Router:</b> <code>${vps.nodeMemMB} MB</code>`,
          `━━━━━━━━━━━━━━━━━━━`,
          `🤖 <b>TÀI KHOẢN AI ĐANG KẾT NỐI:</b>`,
          `• <b>Antigravity:</b> <code>${stats.agActive}</code> hoạt động${stats.agInactive > 0 ? ` (<code>${stats.agInactive}</code> lỗi 401)` : ''}`,
          `• <b>Claude Code:</b> <code>${stats.claudeCount}</code> tài khoản`,
          `• <b>OpenAI Codex:</b> <code>${stats.codexCount}</code> tài khoản`,
          `• <b>Client Keys quản lý:</b> <code>${stats.clientKeysCount}</code> keys`,
          `🗄 <b>Cơ sở dữ liệu:</b> <code>SQLite (Local VPS)</code>`,
          ``,
          `<i>Bấm nút bên dưới để lấy bản sao lưu ngay lập tức.</i>`
        ].join('\n');

        await sendTelegramMessage(chatId, statusMsg);
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi đọc trạng thái: ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // 👥 3. DANH SÁCH TÀI KHOẢN THEO NHÓM
    if (text === '👥 Danh Sách Tài Khoản' || text === '/accounts') {
      try {
        const adapter = await getAdapter();
        const accounts = (await adapter.all('SELECT id, provider, authType, email, name, isActive FROM providerConnections ORDER BY provider, id')) || [];

        if (accounts.length === 0) {
          await sendTelegramMessage(chatId, `ℹ️ Chưa có tài khoản AI nào được cấu hình trong SQLite.`);
          return NextResponse.json({ ok: true });
        }

        const lines = [
          `<b>👥 DANH SÁCH TÀI KHOẢN AI (${accounts.length} KẾT NỐI)</b>`,
          `━━━━━━━━━━━━━━━━━━━`
        ];

        // Group by provider
        const grouped = {};
        for (const acc of accounts) {
          const prov = acc.provider || 'khác';
          if (!grouped[prov]) grouped[prov] = [];
          grouped[prov].push(acc);
        }

        const providerNames = {
          antigravity: '🤖 Antigravity (Google)',
          codex: '🧠 OpenAI Codex',
          claude: '✨ Claude Code',
          anthropic: '✨ Anthropic Official',
          gemini: '💎 Google Gemini API'
        };

        for (const [prov, list] of Object.entries(grouped)) {
          const header = providerNames[prov] || `🔹 ${prov.toUpperCase()}`;
          lines.push(`<b>${header} (${list.length}):</b>`);
          list.forEach((acc, idx) => {
            const statusIcon = acc.isActive ? '🟢' : '🔴';
            const statusText = acc.isActive ? '' : ' <i>(Tắt/Lỗi)</i>';
            const display = acc.email ? maskEmail(acc.email) : (acc.name || acc.id?.slice(0, 8));
            lines.push(`  ${idx + 1}. ${statusIcon} <code>${display}</code>${statusText}`);
          });
          lines.push(``);
        }

        await sendTelegramMessage(chatId, lines.join('\n'));
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi đọc danh sách tài khoản: ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // 🔑 4. DANH SÁCH CLIENT KEYS
    if (text === '🔑 Danh Sách Client Key' || text === '/keys') {
      try {
        const adapter = await getAdapter();
        const keys = (await adapter.all('SELECT key, label, quota_tokens, used_tokens, active FROM client_keys ORDER BY created_at DESC')) || [];

        if (keys.length === 0) {
          await sendTelegramMessage(chatId, `ℹ️ Chưa có Client Key nào trong hệ thống.`);
          return NextResponse.json({ ok: true });
        }

        const lines = [
          `<b>🔑 DANH SÁCH CLIENT KEYS (${keys.length})</b>`,
          `━━━━━━━━━━━━━━━━━━━`
        ];

        keys.forEach((k, idx) => {
          const statusIcon = k.active ? '🟢' : '🔴';
          const label = k.label || 'Không tên';
          const masked = maskKey(k.key);
          const used = Number(k.used_tokens || 0).toLocaleString();
          lines.push(`${idx + 1}. ${statusIcon} <b>${label}</b>`);
          lines.push(`   Key: <code>${masked}</code>`);
          lines.push(`   Đã dùng: <code>${used}</code> tokens`);
        });

        await sendTelegramMessage(chatId, lines.join('\n'));
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi đọc danh sách client key: ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // ℹ️ 5. HƯỚNG DẪN / HELP / START
    if (text === '/start' || text === '/help' || text === 'ℹ️ Hướng Dẫn' || text === '/menu') {
      const welcome = [
        `<b>👋 XIN CHÀO BẠN ĐẾN VỚI 9ROUTER BOT!</b>`,
        ``,
        `Bot hỗ trợ quản trị hệ thống và sao lưu cơ sở dữ liệu tự động.`,
        ``,
        `<b>Các chức năng chính:</b>`,
        `• <b>📦 Lấy Backup Data Ngay:</b> Nhận file nén <code>.sqlite.gz</code> chứa toàn bộ tài khoản & key ngay lập tức.`,
        `• <b>📊 Trạng Thái Hệ Thống:</b> Xem thông số máy chủ VPS (CPU, RAM, Ổ cứng, Uptime) & tài khoản AI.`,
        `• <b>👥 Danh Sách Tài Khoản:</b> Xem danh sách chi tiết các tài khoản theo nhóm (Antigravity, Codex, Claude).`,
        `• <b>🔑 Danh Sách Client Key:</b> Tra cứu mức độ sử dụng token của các key.`,
        ``,
        `<i>⏰ Hệ thống cũng sẽ tự động gửi bản sao lưu mới nhất vào lúc 00:00 hàng ngày.</i>`
      ].join('\n');

      await sendTelegramMessage(chatId, welcome);
      return NextResponse.json({ ok: true });
    }

    // 6. HOTMAIL & COURSERA PARSER (Tương thích ngược)
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const hasPipe = lines.some(l => l.includes('|'));

    if (hasPipe) {
      try {
        await sendTelegramMessage(chatId, `⏳ Đang nhập ${lines.length} tài khoản Hotmail vào SQLite...`);
        const adapter = await getAdapter();
        let successCount = 0;
        let errorCount = 0;

        const insertSql = `
          INSERT INTO hotmail_accounts (email, password, totp_secret, client_id, refresh_token, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'available', datetime('now'), datetime('now'))
          ON CONFLICT(email) DO UPDATE SET
            password = excluded.password,
            totp_secret = coalesce(excluded.totp_secret, hotmail_accounts.totp_secret),
            client_id = coalesce(excluded.client_id, hotmail_accounts.client_id),
            refresh_token = coalesce(excluded.refresh_token, hotmail_accounts.refresh_token),
            updated_at = datetime('now')
        `;

        for (const line of lines) {
          const cred = parseHotmailLine(line);
          if (!cred || !cred.email) {
            errorCount++;
            continue;
          }
          try {
            await adapter.run(insertSql, [cred.email, cred.password, cred.totp_secret, cred.client_id, cred.refresh_token]);
            successCount++;
          } catch {
            errorCount++;
          }
        }

        const resMsg = [
          `<b>✅ KẾT QUẢ NHẬP HOTMAIL (SQLITE)</b>`,
          `• Thành công: <code>${successCount}</code>`,
          `• Lỗi/Sai định dạng: <code>${errorCount}</code>`
        ].join('\n');
        await sendTelegramMessage(chatId, resMsg);
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi khi nhập Hotmail: ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // Coursera parse
    const courseraAccounts = parseCourseraSheetAccounts(text);
    if (courseraAccounts.length > 0) {
      try {
        const scriptUrl = settings?.COURSERA_SHEET_SCRIPT_URL || process.env.COURSERA_SHEET_SCRIPT_URL;
        if (!scriptUrl) {
          throw new Error('Chưa cấu hình COURSERA_SHEET_SCRIPT_URL');
        }
        await sendTelegramMessage(chatId, `⏳ Đang thêm ${courseraAccounts.length} tài khoản Coursera vào Sheet...`);
        const sheetData = courseraAccounts.map(a => [a.email, a.password, a.courseCode]);
        await pushToGoogleSheet(scriptUrl, '', sheetData);

        const successLines = [
          `<b>✅ ĐÃ THÊM ${courseraAccounts.length} TÀI KHOẢN COURSERA VÀO SHEET</b>`,
          '',
          ...courseraAccounts.map((a, i) => `${i + 1}. <code>${a.email}</code> | <code>${a.password}</code>${a.courseCode ? ` | Course: <code>${a.courseCode}</code>` : ''}`)
        ];
        await sendTelegramMessage(chatId, successLines.join('\n'));
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi khi thêm Coursera: ${err.message}`);
      }
      return NextResponse.json({ ok: true });
    }

    // Default response if not recognized
    await sendTelegramMessage(
      chatId,
      `💡 <i>Vui lòng chọn một chức năng trên bàn phím menu bên dưới hoặc gõ /backup để nhận file sao lưu.</i>`
    );
    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error('[Telegram Webhook Error]', err);
    return NextResponse.json({ ok: false, error: err.message });
  }
}
