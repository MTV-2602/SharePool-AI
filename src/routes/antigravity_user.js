'use strict';

const express = require('express');
const router = express.Router();
const AntigravityKey = require('../models/AntigravityKey');
const AntigravityUsage = require('../models/AntigravityUsage');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Local helper to authenticate Antigravity user endpoints
async function userAuth(req, res, next) {
  const key = (req.headers['x-api-key'] || req.query.key || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  try {
    const validation = await AntigravityKey.validate(key);
    if (!validation.ok) {
      const msgs = {
        invalid_key: 'API key không hợp lệ.',
        key_disabled: 'API key này đã bị vô hiệu hóa.',
        key_expired: 'API key này đã hết hạn.',
        quota_exceeded: 'Đã sử dụng hết quota.',
      };
      return res.status(401).json({
        error: msgs[validation.reason] || 'Không hợp lệ',
        code: validation.reason
      });
    }

    req.apiKey = key;
    req.apiKeyRecord = validation.record;
    next();
  } catch (err) {
    next(err);
  }
}

// POST /antigravity-user-api/login
router.post('/login', asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  const validation = await AntigravityKey.validate(key);
  if (!validation.ok) {
    const msgs = {
      invalid_key: 'API key không hợp lệ.',
      key_disabled: 'API key này đã bị vô hiệu hóa.',
      key_expired: 'API key này đã hết hạn.',
      quota_exceeded: 'Đã sử dụng hết quota.',
    };
    return res.status(401).json({
      error: msgs[validation.reason] || 'Không hợp lệ',
      code: validation.reason
    });
  }

  const rec = validation.record;
  const db = require('../db');
  const tokenSums = await db.get(
    `SELECT SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out FROM antigravity_usage_logs WHERE api_key = ?`,
    [rec.key]
  );
  const tokensIn = parseInt(tokenSums?.tokens_in || 0, 10);
  const tokensOut = parseInt(tokenSums?.tokens_out || 0, 10);

  res.json({
    ok: true,
    name: rec.name,
    key: rec.key,
    quotaTotal: rec.quotaTotal || rec.quota_total,
    quotaUsed: rec.quotaUsed || rec.quota_used,
    quotaRemaining: (rec.quotaTotal || rec.quota_total) - (rec.quotaUsed || rec.quota_used),
    usagePct: Math.min(100, Math.round((rec.quotaUsed || rec.quota_used) * 100 / (rec.quotaTotal || rec.quota_total))),
    expiresAt: rec.expiresAt || rec.expires_at,
    createdAt: rec.createdAt || rec.created_at,
    note: rec.note,
    tokensIn,
    tokensOut,
  });
}));

// GET /antigravity-user-api/me
router.get('/me', userAuth, asyncHandler(async (req, res) => {
  const rec = req.apiKeyRecord;
  const db = require('../db');
  const tokenSums = await db.get(
    `SELECT SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out FROM antigravity_usage_logs WHERE api_key = ?`,
    [rec.key]
  );
  const tokensIn = parseInt(tokenSums?.tokens_in || 0, 10);
  const tokensOut = parseInt(tokenSums?.tokens_out || 0, 10);

  res.json({
    name: rec.name,
    quota: rec.quotaTotal >= 9999999999 ? -1 : rec.quotaTotal,
    used: rec.quotaUsed,
    expires: rec.expiresAt,
    note: rec.note,
    tokensIn,
    tokensOut,
  });
}));

// GET /antigravity-user-api/daily
router.get('/daily', userAuth, asyncHandler(async (req, res) => {
  const stats = await AntigravityUsage.getDailyStats(req.apiKey);
  const mapped = stats.map(d => ({
    date: d.date,
    requests: parseInt(d.requests || 0, 10),
    total: parseInt(d.requests || 0, 10),
    tokens_in: parseInt(d.tokensIn || d.tokens_in || 0, 10),
    tokens_out: parseInt(d.tokensOut || d.tokens_out || 0, 10),
    tokens_total: parseInt(d.tokensTotal || d.tokens_total || 0, 10),
    tokens: parseInt(d.tokensTotal || d.tokens_total || 0, 10),
  }));
  res.json(mapped);
}));

// GET /antigravity-user-api/usage
router.get('/usage', userAuth, asyncHandler(async (req, res) => {
  const result = await AntigravityUsage.findByKey(req.apiKey, { limit: 100 });
  const mapped = result.rows.map(r => ({
    created_at: r.createdAt,
    model: r.model,
    prompt_tokens: r.tokensIn,
    completion_tokens: r.tokensOut,
    total_tokens: r.tokensTotal
  }));
  res.json(mapped);
}));

module.exports = router;
