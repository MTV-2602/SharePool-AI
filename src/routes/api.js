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

    await UpstreamAccount.upsertByToken(nameClean, tokenClean);
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
  const { name, session_token } = rows[0];
  
  const fetch = require('node-fetch');
  let fetchRes;
  let fetchErr = null;
  try {
    fetchRes = await fetch('https://chatgpt.com/api/auth/session', {
      method:  'GET',
      headers: {
        'Cookie':     `__Secure-next-auth.session-token=${session_token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/json',
        'Referer':    'https://chatgpt.com/',
      },
    });
  } catch (err) {
    fetchErr = err.message;
  }
  
  if (fetchErr) {
    return res.json({ ok: false, error: fetchErr });
  }
  
  const status = fetchRes.status;
  const contentType = fetchRes.headers.get('content-type');
  const bodyText = await fetchRes.text();
  
  return res.json({
    ok: status === 200,
    name,
    status,
    contentType,
    bodySnippet: bodyText.substring(0, 1000),
    isCloudflare: bodyText.includes('cf-challenge') || bodyText.includes('cloudflare') || bodyText.includes('Turnstile') || bodyText.includes('cf-cookie-error')
  });
}));

module.exports = router;
