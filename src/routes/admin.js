'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const adminGuard = require('../middleware/adminGuard');
const ApiKey = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const AccountPool = require('../upstream/AccountPool');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Protect all admin routes with adminGuard
router.use(adminGuard);

// GET & POST /admin-api/stats — Admin dashboard stats (supports verification)
const statsHandler = asyncHandler(async (req, res) => {
  const stats = UsageLog.getAdminStats();
  const daily = UsageLog.getGlobalDailyStats();
  const topKeys = UsageLog.getTopKeys(5);
  const accounts = AccountPool.getStatus();
  res.json({
    ...stats,
    daily,
    topKeys,
    accounts
  });
});

router.route('/stats')
  .get(statsHandler)
  .post(statsHandler);

// GET /admin-api/keys — List all API keys
router.get('/keys', asyncHandler(async (req, res) => {
  const keys = ApiKey.findAll();
  res.json(keys);
}));

// POST /admin-api/keys — Create a new API key (supports quota and expires mapped fields)
router.post('/keys', asyncHandler(async (req, res) => {
  const name = req.body.name;
  if (!name) {
    throw new AppError('Name is required', 400, 'INVALID_REQUEST');
  }

  const quotaInput = req.body.quota !== undefined ? req.body.quota : req.body.quotaTotal;
  const expiresInput = req.body.expires !== undefined ? req.body.expires : req.body.expiresAt;

  const key = ApiKey.create({
    name,
    quotaTotal: quotaInput !== undefined ? parseInt(quotaInput, 10) : 100000000,
    expiresAt: expiresInput || null,
    note: req.body.note || ''
  });

  res.json(key);
}));

// GET /admin-api/keys/:id — Get a single key
router.get('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  res.json(key);
}));

// PATCH /admin-api/keys/:id — Update a key
router.patch('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }

  const fields = {};
  if (req.body.name !== undefined) fields.name = req.body.name;
  if (req.body.quotaTotal !== undefined) fields.quota_total = parseInt(req.body.quotaTotal, 10);
  if (req.body.quota_total !== undefined) fields.quota_total = parseInt(req.body.quota_total, 10);
  if (req.body.expiresAt !== undefined) fields.expires_at = req.body.expiresAt;
  if (req.body.expires_at !== undefined) fields.expires_at = req.body.expires_at;
  if (req.body.isActive !== undefined) fields.is_active = req.body.isActive ? 1 : 0;
  if (req.body.is_active !== undefined) fields.is_active = req.body.is_active ? 1 : 0;
  if (req.body.note !== undefined) fields.note = req.body.note;

  ApiKey.update(id, fields);
  res.json({ success: true, key: ApiKey.findById(id) });
}));

// POST /admin-api/keys/:id/enable — Enable a key
router.post('/keys/:id/enable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  ApiKey.update(id, { is_active: 1 });
  res.json({ success: true });
}));

// POST /admin-api/keys/:id/disable — Disable a key
router.post('/keys/:id/disable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  ApiKey.update(id, { is_active: 0 });
  res.json({ success: true });
}));

// DELETE /admin-api/keys/:id — Delete a key
router.delete('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  ApiKey.delete(id);
  res.json({ success: true });
}));

// POST /admin-api/keys/:id/reset — Reset usage to 0
router.post('/keys/:id/reset', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  ApiKey.resetUsage(id);
  res.json({ success: true });
}));

// GET /admin-api/usage — Global daily stats (last 30 days)
router.get('/usage', asyncHandler(async (req, res) => {
  const usage = UsageLog.getGlobalDailyStats();
  res.json(usage);
}));

// GET /admin-api/top-keys — Top keys by usage
router.get('/top-keys', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
  const topKeys = UsageLog.getTopKeys(limit);
  res.json(topKeys);
}));

// GET & POST /admin-api/upstream — Upstream accounts status & reload
const upstreamHandler = asyncHandler(async (req, res) => {
  AccountPool.reload();
  const accounts = AccountPool.getStatus();
  res.json(accounts);
});

router.route('/upstream')
  .get(upstreamHandler)
  .post(upstreamHandler);

// GET /admin-api/accounts — Upstream accounts status
router.get('/accounts', asyncHandler(async (req, res) => {
  const accounts = AccountPool.getStatus();
  res.json(accounts);
}));

// POST /admin-api/accounts/import-manual — Nhập tay tài khoản
router.post('/accounts/import-manual', asyncHandler(async (req, res) => {
  const { name, sessionToken } = req.body;
  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  const file = config.ACCOUNTS_FILE;
  let accounts = [];
  if (fs.existsSync(file)) {
    try {
      accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      accounts = [];
    }
  }

  const tokenClean = sessionToken.trim();
  const existingIdx = accounts.findIndex(a => a.sessionToken === tokenClean);

  const accName = (name && name.trim()) || `Acc-${Date.now()}`;
  const newAcc = { name: accName, sessionToken: tokenClean };

  if (existingIdx >= 0) {
    accounts[existingIdx] = newAcc;
  } else {
    accounts.push(newAcc);
  }

  fs.writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf-8');
  AccountPool.reload();

  res.json({ success: true, count: accounts.length });
}));

// POST /admin-api/accounts/import-bulk — Nhập nhanh / Bulk import
router.post('/accounts/import-bulk', asyncHandler(async (req, res) => {
  const { rawText } = req.body;
  if (!rawText || !rawText.trim()) {
    throw new AppError('rawText is required', 400, 'INVALID_REQUEST');
  }

  const file = config.ACCOUNTS_FILE;
  let accounts = [];
  if (fs.existsSync(file)) {
    try {
      accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      accounts = [];
    }
  }

  const lines = rawText.split(/\r?\n/);
  let importedCount = 0;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    let token = '';
    let name = '';

    if (clean.includes('|')) {
      const parts = clean.split('|').map(p => p.trim());
      // Try to find the sessionToken: it is the longest part or starts with 'ey'
      const foundToken = parts.find(p => p.startsWith('ey') || p.length > 80);
      if (foundToken) {
        token = foundToken;
        name = parts[0] || `Imported-${Date.now()}`;
      }
    } else if (clean.startsWith('ey') || clean.length > 80) {
      token = clean;
      name = `Imported-${clean.substring(0, 8)}`;
    }

    if (token) {
      const existingIdx = accounts.findIndex(a => a.sessionToken === token);
      const newAcc = { name, sessionToken: token };

      if (existingIdx >= 0) {
        accounts[existingIdx] = newAcc;
      } else {
        accounts.push(newAcc);
      }
      importedCount++;
    }
  }

  if (importedCount > 0) {
    fs.writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf-8');
    AccountPool.reload();
  }

  res.json({ success: true, imported: importedCount, total: accounts.length });
}));

// DELETE /admin-api/accounts — Delete an account by sessionToken
router.delete('/accounts', asyncHandler(async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  const file = config.ACCOUNTS_FILE;
  let accounts = [];
  if (fs.existsSync(file)) {
    try {
      accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      accounts = [];
    }
  }

  const tokenClean = sessionToken.trim();
  const idx = accounts.findIndex(a => a.sessionToken === tokenClean);
  if (idx === -1) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  accounts.splice(idx, 1);
  fs.writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf-8');
  AccountPool.reload();

  res.json({ success: true, total: accounts.length });
}));

// PATCH /admin-api/accounts — Edit name or sessionToken of an account
router.patch('/accounts', asyncHandler(async (req, res) => {
  const { oldSessionToken, name, newSessionToken } = req.body;
  if (!oldSessionToken || !oldSessionToken.trim()) {
    throw new AppError('oldSessionToken is required', 400, 'INVALID_REQUEST');
  }

  const file = config.ACCOUNTS_FILE;
  let accounts = [];
  if (fs.existsSync(file)) {
    try {
      accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      accounts = [];
    }
  }

  const oldTokenClean = oldSessionToken.trim();
  const idx = accounts.findIndex(a => a.sessionToken === oldTokenClean);
  if (idx === -1) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  if (name !== undefined) {
    accounts[idx].name = name.trim() || `Acc-${Date.now()}`;
  }

  if (newSessionToken !== undefined && newSessionToken.trim()) {
    const newTokenClean = newSessionToken.trim();
    // Check if new token already exists on another account to avoid duplicates
    const duplicateIdx = accounts.findIndex((a, i) => i !== idx && a.sessionToken === newTokenClean);
    if (duplicateIdx >= 0) {
      throw new AppError('New session token is already in use by another account', 400, 'DUPLICATE_ENTRY');
    }
    accounts[idx].sessionToken = newTokenClean;
  }

  fs.writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf-8');
  AccountPool.reload();

  res.json({ success: true });
}));

// GET /admin-api/settings — Retrieve current configuration settings
router.get('/settings', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    settings: {
      ADMIN_KEY: config.ADMIN_KEY,
      TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN,
      COURSERA_SHEET_SCRIPT_URL: config.COURSERA_SHEET_SCRIPT_URL,
      SITE_NAME: config.SITE_NAME
    }
  });
}));

// POST /admin-api/settings — Save and hot-reload config settings
router.post('/settings', asyncHandler(async (req, res) => {
  const { ADMIN_KEY, TELEGRAM_BOT_TOKEN, COURSERA_SHEET_SCRIPT_URL, SITE_NAME } = req.body;

  let current = {};
  if (fs.existsSync(config.SETTINGS_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
    } catch (_) {}
  }

  // Update fields
  if (ADMIN_KEY !== undefined) current.ADMIN_KEY = ADMIN_KEY.trim();
  if (TELEGRAM_BOT_TOKEN !== undefined) current.TELEGRAM_BOT_TOKEN = TELEGRAM_BOT_TOKEN.trim();
  if (COURSERA_SHEET_SCRIPT_URL !== undefined) current.COURSERA_SHEET_SCRIPT_URL = COURSERA_SHEET_SCRIPT_URL.trim();
  if (SITE_NAME !== undefined) current.SITE_NAME = SITE_NAME.trim();

  // Save changes
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify(current, null, 2), 'utf-8');

  // Apply to config directly in-memory
  if (current.ADMIN_KEY) config.ADMIN_KEY = current.ADMIN_KEY;
  if (current.TELEGRAM_BOT_TOKEN) config.TELEGRAM_BOT_TOKEN = current.TELEGRAM_BOT_TOKEN;
  if (current.COURSERA_SHEET_SCRIPT_URL) config.COURSERA_SHEET_SCRIPT_URL = current.COURSERA_SHEET_SCRIPT_URL;
  if (current.SITE_NAME) config.SITE_NAME = current.SITE_NAME;

  // Auto-register Vercel Webhook if token changes
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN.trim() !== '') {
    const isVercel = !!process.env.VERCEL;
    if (isVercel) {
      try {
        const fetch = require('node-fetch');
        const token = TELEGRAM_BOT_TOKEN.trim();
        const webhookUrl = `https://api.telegram.org/bot${token}/setWebhook?url=https://vinhcousera.vercel.app/api/telegram-webhook`;
        await fetch(webhookUrl);
      } catch (err) {
        console.error('Webhook auto-registration failed inside settings post:', err.message);
      }
    }
  }

  res.json({ ok: true, message: 'Settings saved and applied successfully.' });
}));

module.exports = router;
