'use strict';

const express = require('express');
const router = express.Router();
const ApiKey = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Local helper to authenticate user endpoints
function userAuth(req, res, next) {
  const key = (req.headers['x-api-key'] || req.query.key || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  const validation = ApiKey.validate(key);
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
}

// POST /user-api/login
router.post('/login', asyncHandler(async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'API key is required', code: 'MISSING_API_KEY' });
  }

  const validation = ApiKey.validate(key);
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
    quotaTotal: rec.quota_total,
    quotaUsed: rec.quota_used,
    quotaRemaining: rec.quota_total - rec.quota_used,
    usagePct: Math.min(100, Math.round(rec.quota_used * 100 / rec.quota_total)),
    expiresAt: rec.expires_at,
    createdAt: rec.created_at,
    note: rec.note,
  });
}));

// GET /user-api/me
router.get('/me', userAuth, asyncHandler(async (req, res) => {
  const rec = req.apiKeyRecord;
  res.json({
    name: rec.name,
    quota: rec.quota_total >= 9999999999 ? -1 : rec.quota_total,
    used: rec.quota_used,
    expires: rec.expires_at,
    note: rec.note
  });
}));

// GET /user-api/daily
router.get('/daily', userAuth, asyncHandler(async (req, res) => {
  const stats = UsageLog.getDailyStats(req.apiKey);
  // Map tokens_total to tokens for frontend chart compatibility
  const mapped = stats.map(d => ({
    date: d.date,
    requests: d.requests,
    tokens: d.tokens_total
  }));
  res.json(mapped);
}));

// GET /user-api/usage
router.get('/usage', userAuth, asyncHandler(async (req, res) => {
  const result = UsageLog.findByKey(req.apiKey, { limit: 100 });
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
