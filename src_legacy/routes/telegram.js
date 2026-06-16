// src/routes/telegram.js — Telegram webhook and Google Sheets proxy routes
'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

const config = require('../config');
const { parseCourseraSheetAccounts, pushToGoogleSheet } = require('../services/coursera');
const { verifyTelegramWebhookSecret, verifyAdminOrBotInternalToken } = require('../middleware/authHelpers');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const HotmailAccount = require('../models/HotmailAccount');
const hotmailService = require('../services/hotmail');

/**
 * Sends a message to a Telegram chat
 */
async function sendTelegramMessage(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...options
      })
    });
    if (!res.ok) {
      console.error(`Telegram API error: ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to send Telegram message:', err.message);
  }
}

// POST /api/telegram-webhook — Webhook bot handler (protected by secret)
router.post('/telegram-webhook', verifyTelegramWebhookSecret, asyncHandler(async (req, res) => {
  const update = req.body;

  if (update && update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();

    if (text) {
      // Basic Authorization checks (if allowed user/chat IDs are configured)
      const allowedUsers = config.ALLOWED_USER_IDS || [];
      const userId = msg.from?.id;

      const isAuthorized = allowedUsers.length === 0 || allowedUsers.includes(userId);

      if (isAuthorized) {
        if (text === '/start' || text === '/help' || text.startsWith('/')) {
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

          await sendTelegramMessage(chatId, welcome, { parse_mode: 'Markdown' });
        } else {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          const hasPipe = lines.some(l => l.includes('|'));

          if (hasPipe) {
            try {
              await sendTelegramMessage(chatId, `⏳ Đang nhập ${lines.length} tài khoản Hotmail vào cơ sở dữ liệu...`);
              let successCount = 0;
              let errorCount = 0;

              for (const line of lines) {
                const cred = hotmailService.parseStrictHotmailSaveLine(line) || hotmailService.parseHotmailLine(line);
                if (!cred || !cred.email) {
                  errorCount++;
                  continue;
                }
                const existing = await HotmailAccount.findOne({ email: cred.email });
                if (existing) {
                  await HotmailAccount.updateOne({ email: cred.email }, cred);
                } else {
                  await HotmailAccount.create({ ...cred, state: 'available', usedCount: 0 });
                }
                successCount++;
              }

              const resMsg = [
                `<b>✅ KẾT QUẢ NHẬP HOTMAIL</b>`,
                `• Thành công: <code>${successCount}</code>`,
                `• Lỗi/Sai format: <code>${errorCount}</code>`
              ].join('\n');
              await sendTelegramMessage(chatId, resMsg, { parse_mode: 'HTML' });
            } catch (err) {
              console.error('Failed to import Hotmail from bot:', err.message);
              await sendTelegramMessage(chatId, `❌ Lỗi hệ thống: ${err.message}`);
            }
          } else {
            const accounts = parseCourseraSheetAccounts(text);
            if (accounts.length > 0) {
              try {
                await sendTelegramMessage(chatId, `Đang thêm ${accounts.length} tài khoản Coursera vào Sheet...`);
                
                const sheetData = accounts.map(a => [a.email, a.password, a.courseCode]);
                await pushToGoogleSheet(config.COURSERA_SHEET_SCRIPT_URL, '', sheetData);

                const successLines = [
                  `<b>ĐÃ THÊM ${accounts.length} TÀI KHOẢN COURSERA VÀO SHEET</b>`,
                  '',
                  ...accounts.map((a, i) => `${i + 1}. <code>${a.email}</code> | <code>${a.password}</code>${a.courseCode ? ` | Course: <code>${a.courseCode}</code>` : ''}`),
                  '',
                  'Paste tiếp format email,password,courseCode để nhập nhanh.'
                ];
                await sendTelegramMessage(chatId, successLines.join('\n'), { parse_mode: 'HTML' });
              } catch (err) {
                console.error('Coursera webhook push failed:', err.message);
                await sendTelegramMessage(chatId, `Lỗi khi thêm Coursera: ${err.message}`);
              }
            } else {
              // Not a valid Coursera or Hotmail list, send help message
              const welcome = [
                '*Format không đúng*',
                'Vui lòng nhập danh sách tài khoản theo định dạng:',
                '• Coursera: `email,password,courseCode`',
                '• Hotmail: `email|password`'
              ].join('\n');
              await sendTelegramMessage(chatId, welcome, { parse_mode: 'Markdown' });
            }
          }
        }
      }
    }
  }

  res.json({ ok: true });
}));

// POST /api/proxy-sheet — Proxy to Google Sheet (protected by admin or bot internal token)
router.post('/proxy-sheet', verifyAdminOrBotInternalToken, asyncHandler(async (req, res) => {
  const { scriptUrl, sheetName, data } = req.body;
  const targetUrl = scriptUrl || config.COURSERA_SHEET_SCRIPT_URL;

  if (!targetUrl) {
    throw new AppError('Google Sheet script URL is not configured.', 400, 'MISSING_SHEET_URL');
  }

  const result = await pushToGoogleSheet(targetUrl, sheetName || '', data || []);
  res.json(result);
}));

module.exports = router;
