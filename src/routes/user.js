'use strict';

const express = require('express');
const router = express.Router();
const ApiKey = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Local helper to authenticate user endpoints
async function userAuth(req, res, next) {
  const key = (req.headers['x-api-key'] || req.query.key || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  try {
    const validation = await ApiKey.validate(key);
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

// POST /user-api/login
router.post('/login', asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  const validation = await ApiKey.validate(key);
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
  res.json({
    ok: true,
    name: rec.name,
    key: rec.key,
    quotaTotal: rec.quotaTotal,
    quotaUsed: rec.quotaUsed,
    quotaRemaining: rec.quotaTotal - rec.quotaUsed,
    usagePct: Math.min(100, Math.round(rec.quotaUsed * 100 / rec.quotaTotal)),
    expiresAt: rec.expiresAt,
    createdAt: rec.createdAt,
    note: rec.note,
  });
}));

// GET /user-api/me
router.get('/me', userAuth, asyncHandler(async (req, res) => {
  const rec = req.apiKeyRecord;
  res.json({
    name: rec.name,
    quota: rec.quotaTotal >= 9999999999 ? -1 : rec.quotaTotal,
    used: rec.quotaUsed,
    expires: rec.expiresAt,
    note: rec.note
  });
}));

// GET /user-api/daily
router.get('/daily', userAuth, asyncHandler(async (req, res) => {
  const stats = await UsageLog.getDailyStats(req.apiKey);
  // Map fields for frontend usage compatibility (both chart and table)
  const mapped = stats.map(d => ({
    date: d.date,
    requests: parseInt(d.requests || 0, 10),
    total: parseInt(d.requests || 0, 10), // chart compatibility
    tokens_in: parseInt(d.tokensIn || d.tokens_in || 0, 10),
    tokens_out: parseInt(d.tokensOut || d.tokens_out || 0, 10),
    tokens_total: parseInt(d.tokensTotal || d.tokens_total || 0, 10),
    tokens: parseInt(d.tokensTotal || d.tokens_total || 0, 10), // chart compatibility
  }));
  res.json(mapped);
}));

// GET /user-api/usage
router.get('/usage', userAuth, asyncHandler(async (req, res) => {
  const result = await UsageLog.findByKey(req.apiKey, { limit: 100 });
  const mapped = result.rows.map(r => ({
    created_at: r.createdAt,
    model: r.model,
    prompt_tokens: r.prompt_tokens || r.tokensIn,
    completion_tokens: r.completion_tokens || r.tokensOut,
    total_tokens: r.total_tokens || r.tokensTotal
  }));
  res.json(mapped);
}));

module.exports = router;
