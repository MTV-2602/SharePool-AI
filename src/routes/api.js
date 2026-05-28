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
  const { username, password, otpSecret, sessionToken, workerId, source } = req.body;

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
      workerId: workerId || '',
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

module.exports = router;
