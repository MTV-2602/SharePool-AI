// telegram-bot.js — Standalone Telegram Polling Bot for Coursera accounts insertion
'use strict';

const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const config = require('./src/config');
const { parseCourseraSheetAccounts } = require('./src/services/coursera');

// Verify token
const token = config.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not defined in .env configuration.');
  process.exit(1);
}

const botInternalToken = config.BOT_INTERNAL_TOKEN || 'bot-internal-fallback-secret-key-123';
const localPort = config.PORT || 3040;
const localBaseUrl = `http://localhost:${localPort}`;

// Initialize bot in Polling mode
console.log('🤖 Starting Telegram Bot in Polling Mode...');
const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  console.error(`[Polling Error] ${error.code}: ${error.message}`);
});

console.log('✅ Telegram Bot is running and polling for updates.');

// Handle /start or /help commands
bot.onText(/\/start|\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const welcome = [
    '*COURSERA SHEET BOT (POLLING MODE)*',
    '',
    'Bot dùng để nhập nhanh tài khoản Coursera vào Google Sheet.',
    '',
    '*Định dạng tin nhắn:*',
    '`email,password,courseCode`',
    '',
    '*Nhập hàng loạt (mỗi dòng một tài khoản):*',
    '`email1,password1,courseCode1`',
    '`email2,password2,courseCode2`',
    '',
    'courseCode có thể để trống nếu không cần thiết.'
  ].join('\n');

  try {
    await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Failed to send welcome message:', err.message);
  }
});

// Handle incoming messages
bot.on('message', async (msg) => {
  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;

  // Ignore commands
  if (text.startsWith('/')) {
    return;
  }

  // Parse Coursera accounts
  const accounts = parseCourseraSheetAccounts(text);
  if (accounts.length > 0) {
    try {
      await bot.sendMessage(chatId, `⏳ Đang gửi ${accounts.length} tài khoản Coursera tới backend server...`);

      // Prepare request data
      const sheetData = accounts.map(a => [a.email, a.password, a.courseCode]);

      // Call local backend endpoint
      const response = await fetch(`${localBaseUrl}/api/proxy-sheet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bot-internal-token': botInternalToken
        },
        body: JSON.stringify({
          scriptUrl: config.COURSERA_SHEET_SCRIPT_URL,
          sheetName: '',
          data: sheetData
        })
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || `Server responded with ${response.status}`);
      }

      const successLines = [
        `<b>✅ ĐÃ THÊM THÀNH CÔNG ${accounts.length} TÀI KHOẢN VÀO SHEET</b>`,
        '',
        ...accounts.map((a, i) => `${i + 1}. <code>${a.email}</code> | <code>${a.password}</code>${a.courseCode ? ` | Course: <code>${a.courseCode}</code>` : ''}`),
        '',
        '👉 Gửi tiếp theo định dạng <code>email,password,courseCode</code> để thêm tiếp.'
      ];

      await bot.sendMessage(chatId, successLines.join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      console.error('❌ Failed to push Coursera accounts via backend:', err.message);
      await bot.sendMessage(chatId, `❌ Lỗi khi thêm Coursera: ${err.message}`);
    }
  } else {
    // Send help message if format is unrecognized
    const helpMsg = [
      '*⚠️ Định dạng không đúng*',
      'Vui lòng gửi danh sách tài khoản theo định dạng chính xác:',
      '`email,password,courseCode`'
    ].join('\n');
    await bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
  }
});
