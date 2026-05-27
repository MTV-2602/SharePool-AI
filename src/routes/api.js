'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const AccountPool = require('../upstream/AccountPool');
const { asyncHandler } = require('../middleware/errorHandler');

// Retrieve push token from env (default fallback to the one in the extension)
const PUSH_TOKEN = process.env.EXTENSION_PUSH_TOKEN || 'b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b';

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
  const { username, password, otpSecret, sessionToken } = req.body;

  if (!username) {
    return res.status(400).json({ ok: false, error: 'username is required' });
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

  // If sessionToken is present, save it to the accounts pool
  if (sessionToken && sessionToken.trim()) {
    const existingIdx = accounts.findIndex(a => 
      a.sessionToken === sessionToken || 
      (a.name && a.name.includes(username))
    );

    const newAcc = {
      name: username,
      sessionToken: sessionToken.trim()
    };

    if (existingIdx >= 0) {
      accounts[existingIdx] = newAcc;
    } else {
      accounts.push(newAcc);
    }

    // Save to accounts.json
    fs.writeFileSync(file, JSON.stringify(accounts, null, 2), 'utf-8');

    // Reload the pool
    AccountPool.reload();
  } else {
    // If no sessionToken, save to a credentials log file
    const credFile = path.join(config.ROOT_DIR, 'data', 'registered_credentials.txt');
    const dir = path.dirname(credFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.appendFileSync(credFile, `${username}|${password}|${otpSecret || ''}\n`, 'utf-8');
  }

  res.json({ ok: true });
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
