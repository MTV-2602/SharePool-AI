'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const fs = require('fs');
const adminGuard = require('../middleware/adminGuard');
const ApiKey = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const AccountPool = require('../upstream/AccountPool');
const UpstreamAccount = require('../models/UpstreamAccount');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Protect all admin routes with adminGuard
router.use(adminGuard);

// GET & POST /admin-api/stats — Admin dashboard stats (supports verification)
const statsHandler = asyncHandler(async (req, res) => {
  const stats = await UsageLog.getAdminStats();
  const daily = await UsageLog.getGlobalDailyStats();
  const topKeys = await UsageLog.getTopKeys(5);
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
  const keys = await ApiKey.findAll();
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

  const key = await ApiKey.create({
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
  const key = await ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  res.json(key);
}));

// PATCH /admin-api/keys/:id — Update a key
router.patch('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = await ApiKey.findById(id);
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

  await ApiKey.update(id, fields);
  res.json({ success: true, key: await ApiKey.findById(id) });
}));

// POST /admin-api/keys/:id/enable — Enable a key
router.post('/keys/:id/enable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = await ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  await ApiKey.update(id, { is_active: 1 });
  res.json({ success: true });
}));

// POST /admin-api/keys/:id/disable — Disable a key
router.post('/keys/:id/disable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = await ApiKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  await ApiKey.update(id, { is_active: 0 });
  res.json({ success: true });
}));

// DELETE /admin-api/keys/:id — Delete a key
router.delete('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await ApiKey.delete(id);
  res.json({ success: true });
}));

// POST /admin-api/keys/:id/reset — Reset usage to 0
router.post('/keys/:id/reset', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await ApiKey.resetUsage(id);
  res.json({ success: true });
}));

// GET /admin-api/usage — Global daily stats (last 30 days)
router.get('/usage', asyncHandler(async (req, res) => {
  const usage = await UsageLog.getGlobalDailyStats();
  res.json(usage);
}));

// GET /admin-api/top-keys — Top keys by usage
router.get('/top-keys', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
  const topKeys = await UsageLog.getTopKeys(limit);
  res.json(topKeys);
}));

// GET & POST /admin-api/upstream — Upstream accounts status & reload
const upstreamHandler = asyncHandler(async (req, res) => {
  await AccountPool.reload();
  const accounts = AccountPool.getStatus();
  res.json(accounts);
});

router.route('/upstream')
  .get(upstreamHandler)
  .post(upstreamHandler);

// GET /admin-api/accounts — Upstream accounts status (from DB)
router.get('/accounts', asyncHandler(async (req, res) => {
  // Return merged view: DB records with cooldown status from in-memory pool
  const dbAccounts = await UpstreamAccount.findAll();
  const poolStatus = AccountPool.getStatus();
  const statusMap = new Map(poolStatus.map(a => [a.sessionToken, a]));

  const result = dbAccounts.map(acc => {
    const token = acc.sessionToken || acc.session_token;
    const poolAcc = statusMap.get(token);
    return {
      name: acc.name,
      sessionToken: token,
      status: poolAcc ? poolAcc.status : 'loaded',
      cooldownRemaining: poolAcc ? poolAcc.cooldownRemaining : 0,
      hasToken: !!token,
      totalRequests: acc.totalRequests || acc.total_requests || 0,
      createdAt: acc.createdAt || acc.created_at,
    };
  });
  res.json(result);
}));

// POST /admin-api/accounts/import-manual — Nhập tay tài khoản (lưu vào DB)
router.post('/accounts/import-manual', asyncHandler(async (req, res) => {
  const { name, sessionToken } = req.body;
  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  const tokenClean = sessionToken.trim();
  const accName = (name && name.trim()) || `Acc-${Date.now()}`;

  await UpstreamAccount.upsertByToken(accName, tokenClean);
  await AccountPool.reload();

  const all = await UpstreamAccount.findAll();
  res.json({ success: true, count: all.length });
}));

// POST /admin-api/accounts/import-bulk — Nhập nhanh / Bulk import (lưu vào DB)
router.post('/accounts/import-bulk', asyncHandler(async (req, res) => {
  const { rawText } = req.body;
  if (!rawText || !rawText.trim()) {
    throw new AppError('rawText is required', 400, 'INVALID_REQUEST');
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
      await UpstreamAccount.upsertByToken(name || `Imported-${Date.now()}`, token);
      importedCount++;
    }
  }

  if (importedCount > 0) {
    await AccountPool.reload();
  }

  const all = await UpstreamAccount.findAll();
  res.json({ success: true, imported: importedCount, total: all.length });
}));

// DELETE /admin-api/accounts — Delete an account by sessionToken (từ DB)
router.delete('/accounts', asyncHandler(async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  const tokenClean = sessionToken.trim();
  const existing = await UpstreamAccount.findByToken(tokenClean);
  if (!existing) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  await UpstreamAccount.deleteByToken(tokenClean);
  await AccountPool.reload();

  const all = await UpstreamAccount.findAll();
  res.json({ success: true, total: all.length });
}));

// PATCH /admin-api/accounts — Edit name or sessionToken of an account (trong DB)
router.patch('/accounts', asyncHandler(async (req, res) => {
  const { oldSessionToken, name, newSessionToken } = req.body;
  if (!oldSessionToken || !oldSessionToken.trim()) {
    throw new AppError('oldSessionToken is required', 400, 'INVALID_REQUEST');
  }

  const oldTokenClean = oldSessionToken.trim();
  const existing = await UpstreamAccount.findByToken(oldTokenClean);
  if (!existing) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim() || `Acc-${Date.now()}`;
  if (newSessionToken !== undefined && newSessionToken.trim()) {
    const newTokenClean = newSessionToken.trim();
    const dup = await UpstreamAccount.findByToken(newTokenClean);
    if (dup && dup.id !== existing.id) {
      throw new AppError('New session token is already in use by another account', 400, 'DUPLICATE_ENTRY');
    }
    updates.newSessionToken = newTokenClean;
  }

  await UpstreamAccount.update(oldTokenClean, updates);
  await AccountPool.reload();

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
