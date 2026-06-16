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
    '*COURSERA & HOTMAIL BOT*',
    '',
    'Bot dùng để nhập nhanh tài khoản Coursera hoặc Hotmail.',
    '',
    '*1. Nhập Coursera vào Google Sheet (Dùng dấu phẩy):*',
    '`email,password,courseCode`',
    '',
    '*2. Nhập Hotmail vào Database (Dùng dấu gạch dọc):*',
    '`email|password|clientId|refreshToken|secret2fa`',
    'hoặc đơn giản: `email|password`'
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

  try {
    // Delegate the message payload to local server webhook route
    const headers = { 'Content-Type': 'application/json' };
    if (config.TELEGRAM_WEBHOOK_SECRET) {
      headers['x-telegram-bot-api-secret-token'] = config.TELEGRAM_WEBHOOK_SECRET;
    }

    const response = await fetch(`${localBaseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: msg })
    });

    if (!response.ok) {
      const resData = await response.json().catch(() => ({}));
      throw new Error(resData.error || `Server error: ${response.status}`);
    }
  } catch (err) {
    console.error('❌ Failed to forward message to webhook route:', err.message);
    await bot.sendMessage(chatId, `❌ Lỗi đồng bộ hệ thống: ${err.message}`);
  }
});
