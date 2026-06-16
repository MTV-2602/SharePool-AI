import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const COURSERA_SHEET_SCRIPT_URL = process.env.COURSERA_SHEET_SCRIPT_URL;
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

async function sendTelegramMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...options
    }),
  });
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

  if (parts.length === 2) {
    return { email, password, refresh_token: null, client_id: null, totp_secret: null };
  }
  if (parts.length === 3) {
    return { email, password, refresh_token: null, client_id: null, totp_secret: parts[2] };
  }
  if (parts.length === 4) {
    return { email, password, refresh_token: parts[2], client_id: parts[3], totp_secret: null };
  }
  return { email, password, refresh_token: parts[2], client_id: parts[3], totp_secret: parts[4] };
}

async function pushToGoogleSheet(scriptUrl, sheetName = '', data = []) {
  if (!scriptUrl) {
    throw new Error('Google Sheet script URL is not configured.');
  }
  const res = await fetch(scriptUrl, {
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
    const update = await request.json();
    const message = update.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    // 1. Check if it's a command
    if (text.startsWith('/')) {
      if (text === '/start' || text === '/help') {
        await sendTelegramMessage(chatId, 
          '<b>👋 Welcome to 9Router Bot!</b>\n\n' +
          '<b>Commands:</b>\n' +
          '/listhotmail - List last 20 hotmails\n' +
          '/status - System status\n\n' +
          '<b>Quick Import Formats (Send directly):</b>\n' +
          '• <b>Coursera (CSV):</b> <code>email,password,courseCode</code>\n' +
          '• <b>Hotmail (Pipe):</b> <code>email|password</code> or <code>email|password|totp</code>'
        );
        return NextResponse.json({ ok: true });
      }

      if (text === '/listhotmail') {
        const { data } = await supabase
          .from('hotmail_accounts')
          .select('email, status, usage_count')
          .order('created_at', { ascending: false })
          .limit(20);

        const list = data?.map(a => `• ${a.email} [${a.status}] (${a.usage_count} uses)`).join('\n') || 'No accounts';
        await sendTelegramMessage(chatId, `<b>📧 Hotmail Accounts:</b>\n${list}`);
        return NextResponse.json({ ok: true });
      }

      if (text === '/status') {
        const { count: hotmailCount } = await supabase
          .from('hotmail_accounts')
          .select('*', { count: 'exact', head: true });
        const { count: keyCount } = await supabase
          .from('client_keys')
          .select('*', { count: 'exact', head: true });

        await sendTelegramMessage(chatId,
          `<b>📊 System Status:</b>\n` +
          `📧 Hotmail accounts: ${hotmailCount || 0}\n` +
          `🔑 Client keys: ${keyCount || 0}`
        );
        return NextResponse.json({ ok: true });
      }

      await sendTelegramMessage(chatId, 'Unknown command. Type /start for help.');
      return NextResponse.json({ ok: true });
    }

    // 2. Parse text lines for Hotmail or Coursera format
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const hasPipe = lines.some(l => l.includes('|'));

    if (hasPipe) {
      // Import Hotmail
      try {
        await sendTelegramMessage(chatId, `⏳ Đang nhập ${lines.length} tài khoản Hotmail vào cơ sở dữ liệu...`);
        let successCount = 0;
        let errorCount = 0;

        for (const line of lines) {
          const cred = parseHotmailLine(line);
          if (!cred || !cred.email) {
            errorCount++;
            continue;
          }

          const { error } = await supabase
            .from('hotmail_accounts')
            .upsert({
              email: cred.email,
              password: cred.password,
              totp_secret: cred.totp_secret || null,
              client_id: cred.client_id || null,
              refresh_token: cred.refresh_token || null,
              status: 'available'
            }, { onConflict: 'email' });

          if (error) errorCount++; else successCount++;
        }

        const resMsg = [
          `<b>✅ KẾT QUẢ NHẬP HOTMAIL</b>`,
          `• Thành công: <code>${successCount}</code>`,
          `• Lỗi/Sai format: <code>${errorCount}</code>`
        ].join('\n');
        await sendTelegramMessage(chatId, resMsg);
      } catch (err) {
        await sendTelegramMessage(chatId, `❌ Lỗi hệ thống khi nhập Hotmail: ${err.message}`);
      }
    } else {
      // Try parsing as Coursera accounts list
      const accounts = parseCourseraSheetAccounts(text);
      if (accounts.length > 0) {
        try {
          await sendTelegramMessage(chatId, `⏳ Đang thêm ${accounts.length} tài khoản Coursera vào Sheet...`);
          
          const scriptUrl = COURSERA_SHEET_SCRIPT_URL;
          if (!scriptUrl) {
            throw new Error('COURSERA_SHEET_SCRIPT_URL is not configured on server.');
          }

          const sheetData = accounts.map(a => [a.email, a.password, a.courseCode]);
          await pushToGoogleSheet(scriptUrl, '', sheetData);

          const successLines = [
            `<b>✅ ĐÃ THÊM ${accounts.length} TÀI KHOẢN COURSERA VÀO SHEET</b>`,
            '',
            ...accounts.map((a, i) => `${i + 1}. <code>${a.email}</code> | <code>${a.password}</code>${a.courseCode ? ` | Course: <code>${a.courseCode}</code>` : ''}`),
            '',
            'Paste tiếp format <code>email,password,courseCode</code> để nhập nhanh.'
          ];
          await sendTelegramMessage(chatId, successLines.join('\n'));
        } catch (err) {
          await sendTelegramMessage(chatId, `❌ Lỗi khi thêm Coursera: ${err.message}`);
        }
      } else {
        // Unknown format
        await sendTelegramMessage(chatId, 
          '<b>⚠️ Format không đúng</b>\n\n' +
          'Vui lòng gửi danh sách tài khoản theo định dạng:\n' +
          '• <b>Coursera (CSV):</b> <code>email,password,courseCode</code>\n' +
          '• <b>Hotmail (Pipe):</b> <code>email|password</code> or <code>email|password|totp</code>'
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telegram Webhook Error]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
