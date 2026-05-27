// src/middleware/authHelpers.js — Security helper middlewares
'use strict';

const config = require('../config');

const safeCompare = (provided, expected) => {
  if (!provided || !expected) return false;
  try {
    return provided.trim() === expected.trim();
  } catch (_) {
    return false;
  }
};

/**
 * Validates request from the Extension using EXTENSION_PUSH_TOKEN (or Admin key)
 */
function verifyExtensionPushToken(req, res, next) {
  const token = req.headers['x-extension-push-token'] || req.headers['x-extension-token'] || '';
  const adminKey = req.headers['x-admin-key'] || '';

  const isExtension = safeCompare(token, config.EXTENSION_PUSH_TOKEN);
  const isAdmin = safeCompare(adminKey, config.ADMIN_KEY);

  if (!isExtension && !isAdmin) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing extension push token or admin key.' });
  }
  next();
}

/**
 * Validates Telegram webhook request using TELEGRAM_WEBHOOK_SECRET
 */
function verifyTelegramWebhookSecret(req, res, next) {
  if (!config.TELEGRAM_WEBHOOK_SECRET) {
    // If not configured, we allow webhook to pass for ease of setup, or enforce strict check
    return next();
  }
  const secret = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (!safeCompare(secret, config.TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(403).json({ ok: false, error: 'Unauthorized Telegram Webhook request.' });
  }
  next();
}

/**
 * Validates requests by checking either x-admin-key (matching ADMIN_KEY)
 * OR x-bot-internal-token (matching BOT_INTERNAL_TOKEN)
 */
function verifyAdminOrBotInternalToken(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || '';
  const botToken = req.headers['x-bot-internal-token'] || req.headers['x-internal-bot-token'] || '';

  // If BOT_INTERNAL_TOKEN is empty in env, we generate a fallback legacy bot token
  const expectedBotToken = config.BOT_INTERNAL_TOKEN || 'bot-internal-fallback-secret-key-123';

  const isAdmin = safeCompare(adminKey, config.ADMIN_KEY);
  const isBot = safeCompare(botToken, expectedBotToken);

  if (!isAdmin && !isBot) {
    return res.status(403).json({ ok: false, error: 'Access denied. Valid Admin key or Bot token required.' });
  }
  next();
}

module.exports = {
  verifyExtensionPushToken,
  verifyTelegramWebhookSecret,
  verifyAdminOrBotInternalToken
};
