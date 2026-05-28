'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const AccountPool = require('../upstream/AccountPool');
const UpstreamAccount = require('../models/UpstreamAccount');
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

// POST /api/chatgpt-extension-push
router.post('/chatgpt-extension-push', extensionAuth, asyncHandler(async (req, res) => {
  const { username, sessionToken } = req.body;

  if (!username) {
    return res.status(400).json({ ok: false, error: 'username is required' });
  }

  if (!sessionToken || !sessionToken.trim()) {
    // If no sessionToken, just acknowledge (credentials only, no session)
    return res.json({ ok: true, message: 'Credentials received (no session token)' });
  }

  const tokenClean = sessionToken.trim();
  const nameClean  = username.trim() || `Ext-${Date.now()}`;

  // Save/update in database
  await UpstreamAccount.upsertByToken(nameClean, tokenClean);

  // Reload the in-memory pool
  await AccountPool.reload();

  res.json({ ok: true, message: `Account '${nameClean}' added to pool` });
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
