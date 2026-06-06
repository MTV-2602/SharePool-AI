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
const ChatGPTCredential = require('../models/ChatGPTCredential');
const HotmailAccount = require('../models/HotmailAccount');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Protect all admin routes with adminGuard
router.use(adminGuard);

// GET & POST /admin-api/stats — Admin dashboard stats (supports verification)
const statsHandler = asyncHandler(async (req, res) => {
  const stats = await UsageLog.getAdminStats();
  const daily = await UsageLog.getGlobalDailyStats();
  const topKeys = await UsageLog.getTopKeys(5);
  const hotmailTotal = await HotmailAccount.count({});
  
  const accountsStatus = AccountPool.getStatus();
  const accountsDetails = [];
  
  let totalCapacitySession = 0;
  let totalCapacityMonthly = 0;
  let available = 0;
  let exhausted = 0;
  let failed = 0;

  const quotaPromises = accountsStatus.map(async (acc) => {
    let plan = 'free';
    let remainingPercent = 100;
    let primaryRemaining = 100;
    let secondaryRemaining = 100;

    if (acc.hasToken && acc.status !== 'failed') {
      const quotaInfo = await AccountPool.getAccountQuota(acc.sessionToken);
      plan = quotaInfo.plan;
      remainingPercent = quotaInfo.remainingPercent;
      primaryRemaining = quotaInfo.primaryRemaining ?? 100;
      secondaryRemaining = quotaInfo.secondaryRemaining ?? 100;
    }

    const isPlus = plan.toLowerCase().includes('plus') || plan.toLowerCase().includes('pro') || plan.toLowerCase().includes('premium');
    
    // Limits based on OpenAI's actual parameters:
    // Free: Session (5h) = 0 (no session limit). Monthly (30d) = 200 requests * 8,192 tokens = 1.6M. (1 reset per month)
    // Plus: Session (5h) = 80 requests * 8,192 tokens = 640K. Monthly (30d) = 1600 requests * 8,192 tokens * 4 weeks = 51.2M. (weekly resets)
    const capacitySessionBase = isPlus ? 640000 : 0;
    const capacityMonthlyBase = isPlus ? 51200000 : 1600000;

    const remainingCapacitySession = Math.ceil(capacitySessionBase * (primaryRemaining / 100));
    const remainingCapacityMonthly = isPlus
      ? Math.ceil(capacityMonthlyBase * (secondaryRemaining / 100))
      : Math.ceil(capacityMonthlyBase * (primaryRemaining / 100));

    if (acc.status === 'failed') {
      failed++;
    } else if (acc.status === 'cooldown' || remainingPercent === 0) {
      exhausted++;
    } else {
      available++;
    }

    if (acc.status !== 'failed') {
      totalCapacitySession += remainingCapacitySession;
      totalCapacityMonthly += remainingCapacityMonthly;
    }

    accountsDetails.push({
      ...acc,
      plan,
      remainingPercent,
      primaryRemaining,
      secondaryRemaining,
      remainingCapacitySession,
      remainingCapacityMonthly
    });
  });

  await Promise.all(quotaPromises);

  // Calculate the system average multiplier over the last 30 days
  const db = require('../db');
  const todayCondition = db.isPostgres()
    ? `created_at >= CAST(CURRENT_DATE - INTERVAL '30 days' AS TEXT)`
    : `created_at >= date('now', '-30 days', 'localtime')`;

  const multQuery = `
    SELECT 
      SUM(tokens_total) AS total_quota,
      SUM(CASE 
        WHEN LOWER(model) LIKE '%xhigh%' OR LOWER(model) LIKE '%extra%' THEN tokens_total / 4.0
        WHEN LOWER(model) LIKE '%high%' OR LOWER(model) LIKE '%max%' THEN tokens_total / 3.2
        WHEN LOWER(model) LIKE '%low%' THEN tokens_total / 1.6
        WHEN LOWER(model) LIKE '%mini%' AND (LOWER(model) LIKE '%gpt-4o%' OR LOWER(model) LIKE '%gpt-4%') THEN tokens_total / 0.06
        WHEN LOWER(model) LIKE '%mini%' THEN tokens_total / 0.6
        WHEN LOWER(model) LIKE '%spark%' THEN tokens_total / 1.2
        WHEN LOWER(model) LIKE '%gpt-5%' THEN tokens_total / 1.2
        WHEN LOWER(model) LIKE '%gpt-3.5%' THEN tokens_total / 0.15
        ELSE tokens_total
      END) AS total_raw
    FROM usage_logs
    WHERE ${todayCondition}
  `;

  const multStats = await db.get(multQuery);
  const totalQuota = Number(multStats?.total_quota || 0);
  const totalRaw = Number(multStats?.total_raw || 0);
  const averageMultiplier = totalRaw > 0 ? (totalQuota / totalRaw) : 1.2;

  const totalCapacity = totalCapacityMonthly; // Default raw pool tokens (using monthly capacity as business base)
  const allocatedQuota = stats.sumQuotaTotal || 0;
  const allocatedQuotaRaw = Math.ceil(allocatedQuota / averageMultiplier);
  const remainingToSellRaw = totalCapacityMonthly - allocatedQuotaRaw;
  const remainingToSellQuota = Math.ceil(remainingToSellRaw * averageMultiplier);

  res.json({
    ...stats,
    hotmailTotal,
    daily,
    topKeys,
    accounts: {
      total: accountsStatus.length,
      available,
      exhausted,
      failed,
      details: accountsDetails
    },
    totalCapacity,
    totalCapacitySession,
    totalCapacityMonthly,
    allocatedQuotaRaw,
    remainingToSell: remainingToSellQuota,
    averageMultiplier
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

// GET /admin-api/accounts — Trả về danh sách tài khoản ChatGPT đã được gộp trạng thái cooldown từ bộ nhớ (in-memory) và phân trang
router.get('/accounts', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const skip = (page - 1) * limit;

  const search = String(req.query.search || '').trim().toLowerCase();
  const filterStatus = String(req.query.status || 'all').trim().toLowerCase();

  // Return merged view: DB records with cooldown status from in-memory pool
  const dbAccounts = await UpstreamAccount.findAll();
  const poolStatus = AccountPool.getStatus();
  const statusMap = new Map();
  for (const a of poolStatus) {
    if (a.id !== undefined && a.id !== null) {
      statusMap.set(String(a.id), a);
    }
    if (a.sessionToken) {
      statusMap.set(String(a.sessionToken), a);
    }
  }

  const stats = { total: dbAccounts.length, active: 0, cooldown: 0, failed: 0, disabled: 0 };

  const merged = dbAccounts.map(acc => {
    const token = acc.sessionToken || acc.session_token;
    const poolAcc = statusMap.get(acc.id ? String(acc.id) : '') || (token ? statusMap.get(String(token)) : null);
    const isActive = !(acc.is_active === 0 || acc.isActive === 0);
    const status = !isActive ? 'disabled' : (poolAcc ? poolAcc.status : 'loaded');
    
    if (status === 'disabled') stats.disabled++;
    else if (status === 'failed') stats.failed++;
    else if (status === 'cooldown') stats.cooldown++;
    else stats.active++; // loaded/active

    return {
      id: acc.id,
      name: acc.name || '',
      sessionToken: token || '',
      status,
      isActive,
      cooldownRemaining: poolAcc ? poolAcc.cooldownRemaining : 0,
      lastError: acc.lastError || acc.last_error || (poolAcc ? poolAcc.lastError : ''),
      hasToken: !!token,
      totalRequests: acc.totalRequests || acc.total_requests || 0,
      createdAt: acc.createdAt || acc.created_at,
      lastUsedAt: acc.lastUsedAt || acc.last_used_at,
    };
  });

  // Filter
  let filtered = merged;
  if (search) {
    filtered = filtered.filter(a => 
      a.name.toLowerCase().includes(search) || 
      a.sessionToken.toLowerCase().includes(search)
    );
  }

  if (filterStatus !== 'all') {
    filtered = filtered.filter(a => {
      if (filterStatus === 'active') return a.status === 'loaded' || a.status === 'active';
      return a.status === filterStatus;
    });
  }

  const filteredTotal = filtered.length;
  const totalPages = Math.ceil(filteredTotal / limit);
  const pageSlice = filtered.slice(skip, skip + limit);

  res.json({
    ok: true,
    total: dbAccounts.length,
    filteredTotal,
    page,
    limit,
    totalPages,
    stats,
    accounts: pageSlice
  });
}));

// POST /admin-api/accounts/mark-failed — Mark a session token as failed to test auto-login/re-login from extension
router.post('/accounts/mark-failed', asyncHandler(async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  // Mark token as invalid in the in-memory pool
  AccountPool.markInvalid(sessionToken);

  res.json({
    ok: true,
    message: 'Đã đánh dấu tài khoản lỗi để kích hoạt re-login test'
  });
}));

// GET & POST /admin-api/accounts/quota — Get wham usage/quota for a specific account
const quotaRouteHandler = asyncHandler(async (req, res) => {
  const name = (req.query.name || req.body.name || '').trim();
  const sessionToken = (req.query.sessionToken || req.body.sessionToken || '').trim();

  let tokenClean = '';
  if (name) {
    const acc = await UpstreamAccount.findByName(name);
    if (acc) {
      tokenClean = (acc.sessionToken || acc.session_token || '').trim();
    }
  }

  if (!tokenClean && sessionToken) {
    tokenClean = sessionToken;
  }

  if (!tokenClean) {
    throw new AppError('sessionToken or name is required', 400, 'INVALID_REQUEST');
  }

  const { ChatGPTClient } = require('../upstream/ChatGPTClient');
  const client = new ChatGPTClient(tokenClean);

  try {
    const accessToken = await client.getAccessToken();
    const fetch = require('node-fetch');
    
    const usageResponse = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (!usageResponse.ok) {
      const err = new Error(`OpenAI Wham API returned ${usageResponse.status}`);
      if (usageResponse.status === 401 || usageResponse.status === 403) {
        err.code = 'INVALID_SESSION';
      }
      throw err;
    }

    const data = await usageResponse.json();
    const limits = [];

    // Helper to normalize unix timestamps (seconds vs milliseconds) to ISO format
    function parseResetTime(resetValue) {
      if (!resetValue) return null;
      try {
        if (typeof resetValue === 'number') {
          return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
        }
        if (typeof resetValue === 'string') {
          if (/^\d+$/.test(resetValue)) {
            const timestamp = Number(resetValue);
            return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
          }
          return new Date(resetValue).toISOString();
        }
        return null;
      } catch (error) {
        return null;
      }
    }

    // Helper to suffix quota names depending on the window length
    function getWindowName(baseName, limitWindowSeconds) {
      if (!limitWindowSeconds) return baseName;
      const secs = Number(limitWindowSeconds);
      if (secs <= 18000) return `${baseName} (5h)`;
      if (secs <= 604800) return `${baseName} (Weekly)`;
      if (secs <= 2592000) return `${baseName} (Monthly)`;
      return `${baseName}`;
    }

    function addWindow(id, baseName, window) {
      if (!window || typeof window !== 'object') return;
      const usedPercent = Math.max(0, Math.min(100, Math.ceil(window.used_percent ?? window.percent_used ?? 0)));
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const resetAt = parseResetTime(window.reset_at || window.resets_at || null);
      const name = getWindowName(baseName, window.limit_window_seconds || window.window_seconds);
      
      limits.push({
        id,
        name,
        used: usedPercent,
        total: 100,
        remaining: remainingPercent,
        resetAt
      });
    }

    // 1. Parse limit id mapping (Plus/Codex/Pro specific)
    const byLimitId = data.rate_limits_by_limit_id || data.rate_limits || {};
    for (const [key, limitObj] of Object.entries(byLimitId)) {
      if (limitObj && typeof limitObj === 'object') {
        const primary = limitObj.primary_window || limitObj.primary;
        const secondary = limitObj.secondary_window || limitObj.secondary;
        
        let friendlyName = key === 'codex' ? 'Codex Quota' : key === 'code_review' || key === 'review' ? 'Review Quota' : `${key} Quota`;
        
        if (primary) {
          addWindow(`${key}_session`, friendlyName, primary);
        }
        if (secondary) {
          addWindow(`${key}_weekly`, friendlyName, secondary);
        }
      }
    }

    // 2. Fallback to general rate_limit (Free / other accounts)
    if (limits.length === 0 && data.rate_limit) {
      const primary = data.rate_limit.primary_window || data.rate_limit.primary;
      const secondary = data.rate_limit.secondary_window || data.rate_limit.secondary;
      if (primary) {
        addWindow('session', 'Codex Quota', primary);
      }
      if (secondary) {
        addWindow('weekly', 'Codex Quota', secondary);
      }
    }

    const primaryQuota = limits[0] || null;

    res.json({
      ok: true,
      plan: data.plan_type || data.summary?.plan || 'unknown',
      limitReached: limits.some(l => l.remaining === 0),
      quota: primaryQuota,
      limits
    });
  } catch (err) {
    if (err.code === 'INVALID_SESSION') {
      AccountPool.markInvalid(tokenClean, err.message);
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.route('/accounts/quota')
  .get(quotaRouteHandler)
  .post(quotaRouteHandler);

router.post('/accounts/import-manual', asyncHandler(async (req, res) => {
  const { name, sessionToken } = req.body;
  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken is required', 400, 'INVALID_REQUEST');
  }

  const tokenClean = sessionToken.trim();
  const accName = (name && name.trim()) || '';

  if (!accName) {
    throw new AppError('Tên tài khoản (Email) là bắt buộc.', 400, 'INVALID_REQUEST');
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (!emailRegex.test(accName)) {
    throw new AppError('Tên tài khoản phải là một địa chỉ Email hợp lệ.', 400, 'INVALID_FORMAT');
  }

  // Verify that the email exists in the Hotmail account database first
  const HotmailAccount = require('../models/HotmailAccount');
  const hotmail = await HotmailAccount.findOne({ email: accName });
  if (!hotmail) {
    throw new AppError(`Email '${accName}' không tồn tại trong kho Hotmail. Vui lòng thêm Hotmail trước.`, 400, 'HOTMAIL_NOT_FOUND');
  }

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
  const errors = [];
  const parsedAccounts = [];

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const HotmailAccount = require('../models/HotmailAccount');
  const db = require('../db');

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    let token = '';
    let emailInput = '';

    if (clean.includes('|')) {
      const parts = clean.split('|').map(p => p.trim());
      const foundToken = parts.find(p => p.startsWith('ey') || p.length > 80);
      if (foundToken) {
        token = foundToken;
        emailInput = parts.find(p => p !== foundToken) || '';
      }
    } else if (clean.startsWith('ey') || clean.length > 80) {
      token = clean;
    }

    if (!token) {
      errors.push(`Dòng "${clean}": Không tìm thấy token hợp lệ.`);
      continue;
    }

    if (!emailInput) {
      // Decode JWT token to get email if possible
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) base64 += '=';
          const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
          emailInput = payload['https://api.openai.com/profile']?.email || payload.email || '';
        }
      } catch (_) {}
    }

    if (!emailInput || !emailRegex.test(emailInput)) {
      errors.push(`Dòng "${clean}": Thiếu email hoặc định dạng email không hợp lệ.`);
      continue;
    }

    parsedAccounts.push({
      email: emailInput.toLowerCase().trim(),
      token,
      rawLine: clean
    });
  }

  if (parsedAccounts.length === 0) {
    const all = await UpstreamAccount.findAll();
    return res.json({ success: true, imported: 0, total: all.length, errors });
  }

  // Deduplicate sets to search DB efficiently
  const emailsToCheck = [...new Set(parsedAccounts.map(a => a.email))];
  const tokensToCheck = [...new Set(parsedAccounts.map(a => a.token))];

  // Fetch valid Hotmail accounts in one query
  const hotmailEmailsSet = new Set();
  if (emailsToCheck.length > 0) {
    const placeholders = emailsToCheck.map(() => '?').join(', ');
    const hotmailRows = await db.query(
      `SELECT email FROM hotmail_accounts WHERE email IN (${placeholders})`,
      emailsToCheck
    );
    for (const r of hotmailRows) {
      hotmailEmailsSet.add(r.email.toLowerCase().trim());
    }
  }

  // Fetch existing upstream accounts in one query
  let existingRows = [];
  if (emailsToCheck.length > 0) {
    const oauthEmails = emailsToCheck.map(e => `OAuth-${e}`);
    const namePlaceholders = emailsToCheck.map(() => '?').join(', ');
    const oauthPlaceholders = oauthEmails.map(() => '?').join(', ');
    const tokenPlaceholders = tokensToCheck.map(() => '?').join(', ');

    existingRows = await db.query(
      `SELECT id, name, session_token FROM upstream_accounts 
       WHERE name IN (${namePlaceholders}) 
          OR name IN (${oauthPlaceholders})
          OR session_token IN (${tokenPlaceholders})`,
      [
        ...emailsToCheck,
        ...oauthEmails,
        ...tokensToCheck
      ]
    );
  }

  const getExistingAccount = (name, token) => {
    const cleanName = name.replace(/^OAuth-/i, '').toLowerCase();
    const nameLower = name.toLowerCase();
    const oauthNameLower = `oauth-${cleanName}`;

    // 1. Find by name
    let found = existingRows.find(r => {
      const rNameLower = r.name.toLowerCase();
      return rNameLower === nameLower || rNameLower === cleanName || rNameLower === oauthNameLower;
    });
    if (found) return { matchType: 'name', account: found };

    // 2. Find by token
    found = existingRows.find(r => r.sessionToken === token);
    if (found) return { matchType: 'token', account: found };

    return null;
  };

  const toInsert = [];
  const toUpdate = [];
  const processedEmails = new Set();
  const processedTokens = new Set();

  for (const item of parsedAccounts) {
    if (!hotmailEmailsSet.has(item.email)) {
      errors.push(`Dòng "${item.rawLine}": Email '${item.email}' không tồn tại trong kho Hotmail.`);
      continue;
    }

    const name = item.email;
    const token = item.token;

    if (processedEmails.has(name) || processedTokens.has(token)) {
      continue;
    }
    processedEmails.add(name);
    processedTokens.add(token);

    const match = getExistingAccount(name, token);

    if (match) {
      const existing = match.account;
      if (match.matchType === 'name') {
        let existingIsOAuth = false;
        try {
          const parsed = JSON.parse(existing.sessionToken);
          if (parsed.accessToken && parsed.refreshToken) {
            existingIsOAuth = true;
          }
        } catch (_) {}

        let newIsOAuth = false;
        try {
          const parsed = JSON.parse(token);
          if (parsed.accessToken && parsed.refreshToken) {
            newIsOAuth = true;
          }
        } catch (_) {}

        if (existingIsOAuth && !newIsOAuth) {
          toUpdate.push({
            id: existing.id,
            sessionToken: existing.sessionToken,
            name: existing.name,
            isActive: 1,
            lastError: null
          });
        } else {
          toUpdate.push({
            id: existing.id,
            sessionToken: token,
            name: existing.name,
            isActive: 1,
            lastError: null
          });
        }
      } else {
        toUpdate.push({
          id: existing.id,
          sessionToken: token,
          name: existing.name !== name ? name : existing.name,
          isActive: 1,
          lastError: null
        });
      }
    } else {
      toInsert.push({
        name,
        sessionToken: token
      });
    }
  }

  const updatePromises = toUpdate.map(item => {
    return db.run(
      `UPDATE upstream_accounts 
       SET session_token = ?, name = ?, is_active = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [item.sessionToken, item.name, item.isActive, item.lastError, item.id]
    );
  });

  if (toInsert.length > 0) {
    const insertValues = [];
    const insertParams = [];

    for (const item of toInsert) {
      insertValues.push('(?, ?, 1, NULL, 0)');
      insertParams.push(item.name, item.sessionToken);
    }

    const insertSql = `INSERT INTO upstream_accounts (name, session_token, is_active, last_error, total_requests) VALUES ${insertValues.join(', ')}`;
    updatePromises.push(db.run(insertSql, insertParams));
  }

  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }

  const importedCount = toInsert.length + toUpdate.length;
  if (importedCount > 0) {
    await AccountPool.reload();
  }

  const all = await UpstreamAccount.findAll();
  res.json({ success: true, imported: importedCount, total: all.length, errors });
}));

// DELETE /admin-api/accounts — Delete an account or multiple accounts by sessionToken (từ DB)
router.delete('/accounts', asyncHandler(async (req, res) => {
  const { sessionToken, sessionTokens } = req.body;

  if (Array.isArray(sessionTokens)) {
    for (const token of sessionTokens) {
      if (token) {
        await UpstreamAccount.deleteByToken(token.trim());
      }
    }
    await AccountPool.reload();
    const all = await UpstreamAccount.findAll();
    return res.json({ success: true, total: all.length });
  }

  if (!sessionToken || !sessionToken.trim()) {
    throw new AppError('sessionToken or sessionTokens is required', 400, 'INVALID_REQUEST');
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

// PATCH /admin-api/accounts — Edit name, sessionToken, or isActive of an account or multiple accounts (trong DB)
router.patch('/accounts', asyncHandler(async (req, res) => {
  const { oldSessionToken, sessionTokens, name, newSessionToken, isActive } = req.body;

  if (Array.isArray(sessionTokens)) {
    if (isActive !== undefined) {
      const activeVal = isActive ? 1 : 0;
      const updatePromises = sessionTokens.map(token => {
        if (token) {
          return UpstreamAccount.update(token.trim(), { isActive: activeVal });
        }
        return Promise.resolve();
      });
      await Promise.all(updatePromises);
      await AccountPool.reload();
    }
    return res.json({ success: true });
  }

  if (!oldSessionToken || !oldSessionToken.trim()) {
    throw new AppError('oldSessionToken or sessionTokens is required', 400, 'INVALID_REQUEST');
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
  if (isActive !== undefined) {
    updates.isActive = isActive ? 1 : 0;
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
      SITE_NAME: config.SITE_NAME,
      ANTIGRAVITY_CLIENT_ID: config.ANTIGRAVITY_CLIENT_ID,
      ANTIGRAVITY_CLIENT_SECRET: config.ANTIGRAVITY_CLIENT_SECRET
    }
  });
}));

// POST /admin-api/settings — Save and hot-reload config settings
router.post('/settings', asyncHandler(async (req, res) => {
  const { ADMIN_KEY, TELEGRAM_BOT_TOKEN, COURSERA_SHEET_SCRIPT_URL, SITE_NAME, ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } = req.body;

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
  if (ANTIGRAVITY_CLIENT_ID !== undefined) current.ANTIGRAVITY_CLIENT_ID = ANTIGRAVITY_CLIENT_ID.trim();
  if (ANTIGRAVITY_CLIENT_SECRET !== undefined) current.ANTIGRAVITY_CLIENT_SECRET = ANTIGRAVITY_CLIENT_SECRET.trim();

  // Save changes
  fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify(current, null, 2), 'utf-8');

  // Apply to config directly in-memory
  if (current.ADMIN_KEY) config.ADMIN_KEY = current.ADMIN_KEY;
  if (current.TELEGRAM_BOT_TOKEN) config.TELEGRAM_BOT_TOKEN = current.TELEGRAM_BOT_TOKEN;
  if (current.COURSERA_SHEET_SCRIPT_URL) config.COURSERA_SHEET_SCRIPT_URL = current.COURSERA_SHEET_SCRIPT_URL;
  if (current.SITE_NAME) config.SITE_NAME = current.SITE_NAME;
  if (current.ANTIGRAVITY_CLIENT_ID) config.ANTIGRAVITY_CLIENT_ID = current.ANTIGRAVITY_CLIENT_ID;
  if (current.ANTIGRAVITY_CLIENT_SECRET) config.ANTIGRAVITY_CLIENT_SECRET = current.ANTIGRAVITY_CLIENT_SECRET;

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

// ─── ChatGPT Credentials (AutoRegUnified push) ───────────────────────────────

// GET /admin-api/chatgpt-credentials — Danh sách credentials đã đăng ký
router.get('/chatgpt-credentials', asyncHandler(async (req, res) => {
  const creds = await ChatGPTCredential.findAll({ limit: 500 });
  const count = await ChatGPTCredential.count();
  res.json({ ok: true, count, credentials: creds });
}));

// POST /admin-api/chatgpt-credentials — Thêm/cập nhật credential thủ công
router.post('/chatgpt-credentials', asyncHandler(async (req, res) => {
  const { email, password, otpSecret, triggerReLogin } = req.body;
  if (!email || !email.trim()) {
    throw new AppError('email is required', 400, 'INVALID_REQUEST');
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (!emailRegex.test(email.trim())) {
    throw new AppError('Định dạng email không hợp lệ.', 400, 'INVALID_FORMAT');
  }

  // Verify that the email exists in the Hotmail account database first
  const HotmailAccount = require('../models/HotmailAccount');
  const hotmail = await HotmailAccount.findOne({ email: email.trim() });
  if (!hotmail) {
    throw new AppError(`Email '${email.trim()}' không tồn tại trong kho Hotmail. Vui lòng thêm Hotmail trước.`, 400, 'HOTMAIL_NOT_FOUND');
  }

  const cred = await ChatGPTCredential.upsert({
    email: email.trim(),
    password: (password || '').trim(),
    otpSecret: (otpSecret || '').trim(),
    source: 'ManualInput'
  });

  // Check if account exists in pool and optionally trigger re-login
  let poolStatus = null;
  if (triggerReLogin) {
    // Find the upstream account by email name match
    const dbAccounts = await UpstreamAccount.findAll();
    const emailClean = email.trim().toLowerCase();
    const upstream = dbAccounts.find(a => {
      const name = (a.name || '').trim().toLowerCase();
      return name === emailClean || name.includes(emailClean);
    });

    if (upstream) {
      const token = upstream.sessionToken || upstream.session_token;
      AccountPool.markInvalid(token);
      poolStatus = 'marked_failed';
    } else {
      poolStatus = 'not_in_pool';
    }
  }

  const count = await ChatGPTCredential.count();
  res.json({
    ok: true,
    message: `Credential cho '${email.trim()}' đã được lưu.`,
    count,
    credential: cred,
    poolStatus
  });
}));

// DELETE /admin-api/chatgpt-credentials/:id — Xóa 1 credential
router.delete('/chatgpt-credentials/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await ChatGPTCredential.delete(id);
  res.json({ success: true });
}));

// ─── Codex OAuth Flow (Server-side callback) ─────────────────────────────────

const crypto = require('crypto');
const { pendingOAuthSessions, cleanupOldSessions } = require('../services/oauthSessions');

// Helper to get the server's public base URL from the request
function getServerBaseUrl(req) {
  // Support X-Forwarded-Proto for Vercel/Cloudflare proxies
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'] || 'localhost:3040';
  return `${proto}://${host}`;
}

// Helper to generate PKCE pair
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  return { codeVerifier, codeChallenge, state };
}

// GET /admin-api/oauth/codex/authorize — Tạo link ủy quyền PKCE (server-side redirect)
router.get('/oauth/codex/authorize', asyncHandler(async (req, res) => {
  const { codeVerifier, codeChallenge, state } = generatePKCE();

  // We MUST use the registered OpenAI redirect URI so it's whitelisted
  const redirectUri = 'http://localhost:1455/auth/callback';

  // Lưu state và codeVerifier vào DB
  await pendingOAuthSessions.set(state, {
    codeVerifier,
    redirectUri,
    status: 'pending',
    createdAt: Date.now()
  });

  // Tự động dọn dẹp các phiên cũ hơn 15 phút
  await cleanupOldSessions();

  const authUrl = `https://auth.openai.com/oauth/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
    state: state
  }).toString();

  res.json({
    authUrl,
    state,
    redirectUri
    // codeVerifier NOT sent to client (kept secret on server)
  });
}));

// GET /admin-api/oauth/codex/callback — OpenAI redirects here automatically after login
router.get('/oauth/codex/callback', asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  const session = state ? await pendingOAuthSessions.get(state) : null;

  const successHtml = (email) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kết nối thành công</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: #f1f5f9; }
    .card { text-align: center; padding: 2.5rem 3rem; background: #1e293b; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); border: 1px solid #334155; max-width: 420px; width: 90%; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; color: #22c55e; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.9rem; margin-top: 0.5rem; }
    strong { color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Kết nối thành công!</h1>
    <p>Tài khoản: <strong>${email || 'Unknown'}</strong></p>
    <p>Cửa sổ này sẽ tự đóng sau 3 giây...</p>
  </div>
  <script>setTimeout(() => { try { window.close(); } catch(_) {} }, 3000);</script>
</body>
</html>`;

  const errorHtml = (msg) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kết nối thất bại</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: #f1f5f9; }
    .card { text-align: center; padding: 2.5rem 3rem; background: #1e293b; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); border: 1px solid #334155; max-width: 420px; width: 90%; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; color: #ef4444; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Kết nối thất bại</h1>
    <p>${msg}</p>
    <p style="margin-top:1rem">Vui lòng đóng cửa sổ này và thử lại.</p>
  </div>
</body>
</html>`;

  if (!session) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorHtml('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
  }

  if (error) {
    session.status = 'error';
    session.error = error_description || error;
    await pendingOAuthSessions.set(state, session);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorHtml(session.error));
  }

  if (!code) {
    session.status = 'error';
    session.error = 'Không nhận được authorization code từ OpenAI.';
    await pendingOAuthSessions.set(state, session);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorHtml(session.error));
  }

  try {
    const fetch = global.fetch || require('node-fetch');
    const tokenResponse = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        code: code,
        redirect_uri: session.redirectUri,
        code_verifier: session.codeVerifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      throw new Error(`OpenAI token server returned ${tokenResponse.status}: ${errText}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    if (!accessToken || !refreshToken) {
      throw new Error('OpenAI response missing access_token or refresh_token fields');
    }

    let email = '';
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        email = payload['https://api.openai.com/profile']?.email || payload.email || '';
      }
    } catch (_) {}

    const accountName = email ? `OAuth-${email}` : `OAuth-${Date.now()}`;
    const sessionTokenWrapper = JSON.stringify({ accessToken, refreshToken, deviceId: '' });

    await UpstreamAccount.upsertByToken(accountName, sessionTokenWrapper);
    await AccountPool.reload();

    session.status = 'done';
    session.email = email;
    await pendingOAuthSessions.set(state, session);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(successHtml(email));
  } catch (err) {
    session.status = 'error';
    session.error = err.message;
    await pendingOAuthSessions.set(state, session);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(errorHtml(err.message));
  }
}));

// GET /admin-api/oauth/codex/start-proxy — Legacy stub (no longer needed)
router.get('/oauth/codex/start-proxy', asyncHandler(async (req, res) => {
  res.json({ success: true, serverSide: true });
}));

// GET /admin-api/oauth/codex/stop-proxy — Legacy stub
router.get('/oauth/codex/stop-proxy', asyncHandler(async (req, res) => {
  res.json({ success: true });
}));

// GET /admin-api/oauth/codex/poll-status — Polling lấy trạng thái OAuth từ frontend
router.get('/oauth/codex/poll-status', asyncHandler(async (req, res) => {
  const { state } = req.query;
  if (!state) {
    throw new AppError('State is required', 400, 'INVALID_REQUEST');
  }

  const session = await pendingOAuthSessions.get(state);
  if (!session) {
    return res.json({ status: 'unknown' });
  }

  res.json({
    status: session.status,
    email: session.email,
    error: session.error
  });
}));

// POST /admin-api/oauth/codex/exchange — Trao đổi code thủ công (fallback / paste URL)
router.post('/oauth/codex/exchange', asyncHandler(async (req, res) => {
  const { code, state } = req.body;
  if (!code) {
    throw new AppError('Missing authorization code', 400, 'INVALID_REQUEST');
  }

  // 1. Kiểm tra nếu code thực chất là một Access Token trực tiếp (bắt đầu bằng eyJ)
  if (code.startsWith('eyJ') && code.includes('.')) {
    let email = '';
    try {
      const parts = code.split('.');
      if (parts.length >= 2) {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        email = payload['https://api.openai.com/profile']?.email || payload.email || '';
      }
    } catch (_) {}

    const accountName = email ? `Token-${email}` : `Token-${Date.now()}`;
    const tokenWrapper = JSON.stringify({ accessToken: code, deviceId: '' });

    await UpstreamAccount.upsertByToken(accountName, tokenWrapper);
    await AccountPool.reload();

    return res.json({ success: true, email });
  }

  // 2. Trao đổi mã auth code dùng PKCE verifier từ session
  let codeVerifier = '';
  let redirectUri = `${req.protocol}://${req.headers.host}/admin-api/oauth/codex/callback`;

  if (state) {
    const session = await pendingOAuthSessions.get(state);
    if (session) {
      codeVerifier = session.codeVerifier;
      redirectUri = session.redirectUri;
      await pendingOAuthSessions.delete(state);
    }
  }

  const fetch = global.fetch || require('node-fetch');
  const tokenResponse = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new AppError(`OpenAI auth exchange failed: ${errText}`, 400, 'AUTH_ERROR');
  }

  const tokens = await tokenResponse.json();
  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;

  if (!accessToken || !refreshToken) {
    throw new AppError('OpenAI response missing token fields', 400, 'AUTH_ERROR');
  }

  let email = '';
  try {
    const parts = accessToken.split('.');
    if (parts.length >= 2) {
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      email = payload['https://api.openai.com/profile']?.email || payload.email || '';
    }
  } catch (_) {}

  const accountName = email ? `OAuth-${email}` : `OAuth-${Date.now()}`;
  const sessionTokenWrapper = JSON.stringify({ accessToken, refreshToken, deviceId: '' });

  await UpstreamAccount.upsertByToken(accountName, sessionTokenWrapper);
  await AccountPool.reload();

  res.json({ success: true, email });
}));

module.exports = router;

