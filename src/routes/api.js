'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const AccountPool = require('../upstream/AccountPool');
const UpstreamAccount = require('../models/UpstreamAccount');
const ChatGPTCredential = require('../models/ChatGPTCredential');
const { asyncHandler } = require('../middleware/errorHandler');

// Retrieve push token from env (default fallback to the one in the extension)
const PUSH_TOKEN = process.env.EXTENSION_PUSH_TOKEN || config.EXTENSION_PUSH_TOKEN || 'b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b';

// Middleware to check extension push token
function extensionAuth(req, res, next) {
  const token = req.headers['x-extension-push-token'] || '';
  if (token !== PUSH_TOKEN) {
    return res.status(403).json({ ok: false, error: 'Invalid push token' });
  }
  next();
}

router.post('/chatgpt-extension-push', extensionAuth, asyncHandler(async (req, res) => {
  const { username, password, otpSecret, sessionToken, source } = req.body;

  if (!username) {
    return res.status(400).json({ ok: false, error: 'username is required' });
  }

  let savedToken = false;
  let savedCred = false;

  // CASE 1: Có sessionToken → lưu vào pool
  if (sessionToken && sessionToken.trim()) {
    const tokenClean = sessionToken.trim();
    const nameClean  = username.trim() || `Ext-${Date.now()}`;
    const deviceId   = req.body.deviceId ? req.body.deviceId.trim() : '';

    let tokenToSave = tokenClean;
    if (deviceId) {
      try {
        if (tokenClean.startsWith('{')) {
          const obj = JSON.parse(tokenClean);
          obj.deviceId = deviceId;
          tokenToSave = JSON.stringify(obj);
        } else {
          tokenToSave = JSON.stringify({
            accessToken: tokenClean,
            deviceId: deviceId
          });
        }
      } catch (_) {}
    }

    await UpstreamAccount.upsertByToken(nameClean, tokenToSave);
    await AccountPool.reload();
    savedToken = true;
  }

  // CASE 2: Có email+password (từ AutoRegUnified sau khi tự đăng ký)
  if (password && password.trim()) {
    const email = username.trim();

    // Lưu credentials vào DB
    await ChatGPTCredential.upsert({
      email,
      password: password.trim(),
      otpSecret: otpSecret || '',
      source: source || 'AutoRegUnified'
    });
    savedCred = true;
  }

  if (savedToken || savedCred) {
    let msg = '';
    if (savedToken && savedCred) {
      msg = `Credentials and session token for '${username}' saved successfully`;
    } else if (savedToken) {
      msg = `Account '${username}' session token added to pool`;
    } else {
      msg = `Credentials for '${username}' saved to database`;
    }
    return res.json({
      ok: true,
      message: msg,
      email: username
    });
  }

  // Không có gì hữu ích
  return res.status(400).json({ ok: false, error: 'sessionToken or password is required' });
}));

// POST /api/chatgpt-oauth-callback — Exchange code for OAuth tokens
router.post('/chatgpt-oauth-callback', extensionAuth, asyncHandler(async (req, res) => {
  const { username, code, codeVerifier, redirectUri } = req.body;

  if (!code || !codeVerifier) {
    return res.status(400).json({ ok: false, error: 'code and codeVerifier are required' });
  }

  const { gotScraping } = await import('got-scraping');

  let tokenRes;
  try {
    tokenRes = await gotScraping.post('https://auth.openai.com/oauth/token', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        code: code,
        redirect_uri: redirectUri || 'http://localhost:1455/auth/callback',
        code_verifier: codeVerifier,
      }).toString(),
      useHeaderGenerator: false
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'OpenAI auth server returned error: ' + err.message });
  }

  if (tokenRes.statusCode !== 200) {
    return res.status(tokenRes.statusCode).json({ ok: false, error: `Auth exchange failed: ${tokenRes.body}` });
  }

  let tokens;
  try {
    tokens = JSON.parse(tokenRes.body);
  } catch (_) {
    return res.status(502).json({ ok: false, error: 'Failed to parse tokens response as JSON' });
  }

  const accessToken = tokens.access_token;
  const refreshToken = tokens.refresh_token;
  if (!accessToken || !refreshToken) {
    return res.status(502).json({ ok: false, error: 'Token response did not include access_token or refresh_token' });
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

  const accountName = username || (email ? `OAuth-${email}` : `OAuth-${Date.now()}`);
  
  const sessionTokenWrapper = JSON.stringify({
    accessToken,
    refreshToken,
    deviceId: ''
  });

  await UpstreamAccount.upsertByToken(accountName, sessionTokenWrapper);
  await AccountPool.reload();

  return res.json({
    ok: true,
    message: `Tài khoản '${accountName}' đã được kết nối OAuth thành công!`,
    email: email || accountName
  });
}));

// GET /api/credentials — Xem danh sách credentials đã đăng ký (admin only via token)
router.get('/credentials', extensionAuth, asyncHandler(async (req, res) => {
  const creds = await ChatGPTCredential.findAll({ limit: 200 });
  res.json({ ok: true, count: creds.length, credentials: creds });
}));

// Stubs for Hotmail endpoints so the extension doesn't fail
router.get('/hotmail/new', extensionAuth, (req, res) => {
  res.status(503).json({ ok: false, error: 'Hotmail backend not configured' });
});

router.post('/hotmail/release', extensionAuth, (req, res) => {
  res.json({ ok: true });
});

router.post('/hotmail/mark-used', extensionAuth, (req, res) => {
  res.json({ ok: true });
});

router.get('/diagnose-token', asyncHandler(async (req, res) => {
  const db = require('../db');
  const rows = await db.query('SELECT name, session_token FROM upstream_accounts WHERE is_active = 1 LIMIT 1');
  if (rows.length === 0) {
    return res.json({ ok: false, message: 'No active accounts in DB' });
  }
  const name = rows[0].name;
  const sessionToken = rows[0].sessionToken || rows[0].session_token;
  
  const { ChatGPTClient } = require('../upstream/ChatGPTClient');
  const client = new ChatGPTClient(sessionToken);
  
  try {
    const accessToken = await client.getAccessToken();
    let decoded = {};
    try {
      const parts = accessToken.split('.');
      if (parts.length >= 2) {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
      }
    } catch (_) {}

    return res.json({
      ok: true,
      name,
      message: 'Token parsed and validated successfully.',
      hasAccessToken: !!accessToken,
      expiry: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'unknown',
      email: decoded['https://api.openai.com/profile']?.email || 'unknown',
      plan: decoded['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown'
    });
  } catch (err) {
    return res.json({
      ok: false,
      name,
      error: err.message,
      code: err.code || 'VALIDATION_FAILED'
    });
  }
}));

module.exports = router;
