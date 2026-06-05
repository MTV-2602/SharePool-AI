'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');

const adminGuard = require('../middleware/adminGuard');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const AntigravityKey = require('../models/AntigravityKey');
const AntigravityAccount = require('../models/AntigravityAccount');
const AntigravityUsage = require('../models/AntigravityUsage');
const AntigravityPool = require('../upstream/AntigravityPool');

const { antigravityOauthSessions, cleanupOldSessions } = require('../services/antigravityOauthSessions');
const logger = require('../utils/logger').create('AntigravityAdminRoute');

// Protect all admin routes
router.use(adminGuard);

// === 1. Stats and usage ===

router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await AntigravityUsage.getAdminStats();
  const daily = await AntigravityUsage.getGlobalDailyStats();
  const topKeys = await AntigravityUsage.getTopKeys(5);

  const dbAccounts = await AntigravityAccount.findAll();
  const poolAccounts = AntigravityPool._accounts || [];
  
  let available = 0;
  let cooldown = 0;
  let failed = 0;

  const accountsDetails = dbAccounts.map(acc => {
    const isPoolActive = poolAccounts.some(pa => pa.email === acc.email);
    let status = 'active';

    if (acc.isActive === 0 || acc.is_active === 0) {
      status = 'failed';
      failed++;
    } else if (AntigravityPool._isOnCooldown(acc.email)) {
      status = 'cooldown';
      cooldown++;
    } else {
      status = isPoolActive ? 'active' : 'loaded';
      available++;
    }

    return {
      id: acc.id,
      name: acc.name,
      email: acc.email,
      projectId: acc.projectId || acc.project_id,
      status,
      cooldownRemaining: AntigravityPool._cooldownRemaining(acc.email),
      lastError: acc.lastError || acc.last_error || '',
      lastUsedAt: acc.lastUsedAt || acc.last_used_at,
      createdAt: acc.createdAt || acc.created_at
    };
  });

  res.json({
    ...stats,
    daily,
    topKeys,
    accounts: {
      total: dbAccounts.length,
      available,
      cooldown,
      failed,
      details: accountsDetails
    }
  });
}));

// === 2. API Keys Management ===

router.get('/keys', asyncHandler(async (req, res) => {
  const keys = await AntigravityKey.findAll();
  res.json(keys);
}));

router.post('/keys', asyncHandler(async (req, res) => {
  const { name, quotaTotal, expiresAt, note } = req.body;
  if (!name) {
    throw new AppError('Name is required', 400, 'INVALID_REQUEST');
  }
  const key = await AntigravityKey.create({
    name,
    quotaTotal: quotaTotal !== undefined ? parseInt(quotaTotal, 10) : 100000000,
    expiresAt: expiresAt || null,
    note: note || ''
  });
  res.json(key);
}));

router.get('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = await AntigravityKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }
  res.json(key);
}));

router.patch('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const key = await AntigravityKey.findById(id);
  if (!key) {
    throw new AppError('API key not found', 404, 'NOT_FOUND');
  }

  const fields = {};
  if (req.body.name !== undefined) fields.name = req.body.name;
  if (req.body.quotaTotal !== undefined) fields.quotaTotal = parseInt(req.body.quotaTotal, 10);
  if (req.body.expiresAt !== undefined) fields.expiresAt = req.body.expiresAt;
  if (req.body.isActive !== undefined) fields.isActive = req.body.isActive ? 1 : 0;
  if (req.body.note !== undefined) fields.note = req.body.note;

  await AntigravityKey.update(id, fields);
  res.json({ success: true, key: await AntigravityKey.findById(id) });
}));

router.post('/keys/:id/enable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await AntigravityKey.update(id, { isActive: 1 });
  res.json({ success: true });
}));

router.post('/keys/:id/disable', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await AntigravityKey.update(id, { isActive: 0 });
  res.json({ success: true });
}));

router.post('/keys/:id/reset', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await AntigravityKey.resetUsage(id);
  res.json({ success: true });
}));

router.delete('/keys/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await AntigravityKey.delete(id);
  res.json({ success: true });
}));

// === 3. Accounts and Google OAuth ===

router.get('/accounts', asyncHandler(async (req, res) => {
  const dbAccounts = await AntigravityAccount.findAll();
  const poolAccounts = AntigravityPool._accounts || [];

  const accounts = dbAccounts.map(acc => {
    const isPoolActive = poolAccounts.some(pa => pa.email === acc.email);
    let status = 'active';

    if (acc.isActive === 0 || acc.is_active === 0) status = 'failed';
    else if (AntigravityPool._isOnCooldown(acc.email)) status = 'cooldown';
    else status = isPoolActive ? 'active' : 'loaded';

    return {
      id: acc.id,
      name: acc.name,
      email: acc.email,
      projectId: acc.projectId || acc.project_id,
      status,
      cooldownRemaining: AntigravityPool._cooldownRemaining(acc.email),
      lastError: acc.lastError || acc.last_error || '',
      lastUsedAt: acc.lastUsedAt || acc.last_used_at,
      createdAt: acc.createdAt || acc.created_at
    };
  });

  res.json({ ok: true, accounts });
}));

router.delete('/accounts/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await AntigravityAccount.delete(id);
  await AntigravityPool._loadAsync(); // reload pool
  res.json({ success: true });
}));

// Google OAuth link generator for Admin Dashboard
router.get('/oauth/google/authorize', asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  const redirectUri = `${req.protocol}://${req.get('host')}/antigravity-admin-api/oauth/google/callback`;
  
  await antigravityOauthSessions.set(state, {
    redirectUri,
    status: 'pending',
    createdAt: Date.now()
  });

  const clientId = process.env.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
  const scopes = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent'
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ authUrl, state });
}));

// Google OAuth Callback endpoint
router.get('/oauth/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  const session = state ? await antigravityOauthSessions.get(state) : null;
  if (!session) {
    return res.send('<h1>Lỗi OAuth Session</h1><p>Không tìm thấy phiên OAuth hoặc phiên đã hết hạn. Vui lòng đóng cửa sổ này và thử lại.</p>');
  }

  if (error) {
    session.status = 'failed';
    session.error = error_description || error;
    await antigravityOauthSessions.set(state, session);
    return res.send(`<h1>OAuth Lỗi</h1><p>${error_description || error}</p>`);
  }

  if (!code) {
    session.status = 'failed';
    session.error = 'No code received';
    await antigravityOauthSessions.set(state, session);
    return res.send('<h1>OAuth Lỗi</h1><p>Không nhận được Code từ Google.</p>');
  }

  session.status = 'exchanging';
  await antigravityOauthSessions.set(state, session);

  try {
    const clientId = process.env.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
    const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET || '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';

    // 1. Exchange authorization code for Google access/refresh tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: session.redirectUri
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Google OAuth code exchange failed: ${errText}`);
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;

    // 2. Fetch User Profile (email)
    const userRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      throw new Error(`Failed to fetch Google userinfo: ${errText}`);
    }

    const userInfo = await userRes.json();
    const email = userInfo.email;
    const name = userInfo.name || email;
    session.email = email;

    // 3. Load Code Assist Config (fetch project ID and default tier)
    const metadata = { ideType: 9, platform: 5, pluginType: 2 };
    const loadRes = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': JSON.stringify(metadata)
      },
      body: JSON.stringify({ metadata })
    });

    if (!loadRes.ok) {
      const errText = await loadRes.text();
      throw new Error(`Google Cloud Code loadCodeAssist failed: ${errText}`);
    }

    const loadData = await loadRes.json();
    let projectId = loadData.cloudaicompanionProject;
    if (typeof projectId === 'object' && projectId !== null && projectId.id) {
      projectId = projectId.id;
    }

    let tierId = 'legacy-tier';
    if (Array.isArray(loadData.allowedTiers)) {
      for (const tier of loadData.allowedTiers) {
        if (tier.isDefault && tier.id) {
          tierId = tier.id.trim();
          break;
        }
      }
    }

    if (!projectId) {
      throw new Error('No Google Cloud Project found with Gemini Code Assist enabled.');
    }

    // 4. Onboard user
    const onboardRes = await fetch('https://cloudcode-pa.googleapis.com/v1internal:onboardUser', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'google-api-nodejs-client/9.15.1',
        'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        'Client-Metadata': JSON.stringify(metadata)
      },
      body: JSON.stringify({ tierId, metadata })
    });

    if (!onboardRes.ok) {
      const errText = await onboardRes.text();
      throw new Error(`Google Cloud Code onboardUser failed: ${errText}`);
    }

    // Onboard user is typically fast, so we write to DB
    await AntigravityAccount.upsert({
      email,
      name,
      accessToken,
      refreshToken,
      projectId
    });

    // Reload active pool accounts
    await AntigravityPool._loadAsync();

    session.status = 'completed';
    await antigravityOauthSessions.set(state, session);

    return res.send(`
      <html>
        <head>
          <title>Kết nối Antigravity thành công</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px; background-color: #0d1117; color: #c9d1d9; }
            h1 { color: #58a6ff; }
            .card { background-color: #161b22; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Liên kết thành công!</h1>
            <p>Tài khoản <strong>${email}</strong> đã được thêm thành công vào hệ thống xoay vòng Antigravity.</p>
            <p>Dự án liên kết: <strong>${projectId}</strong></p>
            <p style="color: #8b949e; margin-top: 20px;">Bạn có thể đóng cửa sổ này ngay bây giờ.</p>
          </div>
          <script>
            setTimeout(() => { window.close(); }, 5000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error('Google OAuth callback handler error:', err);
    session.status = 'failed';
    session.error = err.message;
    await antigravityOauthSessions.set(state, session);

    return res.send(`<h1>Lỗi Kết Nối</h1><p>Đã xảy ra lỗi: ${err.message}</p>`);
  }
}));

// Poll OAuth connection status from frontend
router.get('/oauth/google/poll-status', asyncHandler(async (req, res) => {
  const { state } = req.query;
  if (!state) {
    throw new AppError('state is required', 400, 'INVALID_REQUEST');
  }

  const session = await antigravityOauthSessions.get(state);
  if (!session) {
    return res.json({ status: 'not_found' });
  }

  if (session.status === 'completed') {
    await antigravityOauthSessions.delete(state);
  }

  res.json({
    status: session.status,
    email: session.email,
    error: session.error
  });
}));

module.exports = router;
