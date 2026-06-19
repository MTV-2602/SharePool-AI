'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');
const config = require('../config');

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
      isActive: acc.isActive !== undefined ? acc.isActive : acc.is_active,
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
      isActive: acc.isActive !== undefined ? acc.isActive : acc.is_active,
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

// PATCH /antigravity-admin-api/accounts/:id
router.patch('/accounts/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const account = await AntigravityAccount.findById(id);
  if (!account) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  const fields = {};
  if (req.body.name !== undefined) fields.name = req.body.name;
  if (req.body.isActive !== undefined) fields.isActive = req.body.isActive ? 1 : 0;
  if (req.body.projectId !== undefined) fields.projectId = req.body.projectId;

  await AntigravityAccount.update(id, fields);
  await AntigravityPool._loadAsync(); // reload pool

  res.json({ success: true, account: await AntigravityAccount.findById(id) });
}));

// GET /antigravity-admin-api/accounts/:id/quota
router.get('/accounts/:id/quota', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const account = await AntigravityAccount.findById(id);
  if (!account) {
    throw new AppError('Account not found', 404, 'NOT_FOUND');
  }

  // Find in pool to leverage current active credentials/refreshes
  const poolAcc = AntigravityPool._accounts.find(a => a.email === account.email);
  const activeAcc = poolAcc || {
    id: account.id,
    email: account.email,
    accessToken: account.accessToken || account.access_token,
    refreshToken: account.refreshToken || account.refresh_token,
    projectId: account.projectId || account.project_id,
    updatedAt: account.updatedAt || account.updated_at
  };

  // Proactive token refresh if older than 50 minutes
  const ageMs = Date.now() - new Date(activeAcc.updatedAt || account.updatedAt || 0).getTime();
  if (ageMs > 50 * 60 * 1000 || !activeAcc.accessToken) {
    try {
      await AntigravityPool.refreshAccessToken(activeAcc);
    } catch (refreshErr) {
      logger.warn(`Failed to refresh token for quota query on ${activeAcc.email}: ${refreshErr.message}`);
    }
  }

  let projectId = activeAcc.projectId;
  if (!projectId || projectId.startsWith('pending-')) {
    // Try to retrieve project via loadCodeAssist
    try {
      const metadata = { ideType: 9, platform: 5, pluginType: 2 };
      const loadRes = await fetch('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeAcc.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'google-api-nodejs-client/9.15.1'
        },
        body: JSON.stringify({ metadata, mode: 1 })
      });
      if (loadRes.ok) {
        const loadData = await loadRes.json();
        let loadedProject = loadData.cloudaicompanionProject;
        if (typeof loadedProject === 'object' && loadedProject !== null && loadedProject.id) {
          loadedProject = loadedProject.id;
        }
        if (loadedProject) {
          projectId = loadedProject;
          activeAcc.projectId = projectId;
          await AntigravityAccount.update(activeAcc.id, { projectId });
        }
      }
    } catch (e) {
      logger.warn(`Failed to retrieve project ID for quota check: ${e.message}`);
    }
  }

  try {
    const response = await fetch('https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeAcc.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'antigravity/1.107.0',
        'X-Client-Name': 'antigravity',
        'X-Client-Version': '1.107.0',
        'x-request-source': 'local'
      },
      body: JSON.stringify({
        project: projectId
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`fetchAvailableModels status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const quotas = [];

    const importantModels = [
      'gemini-3-flash-agent',
      'gemini-3.5-flash-low',
      'gemini-pro-agent',
      'gemini-3.1-pro-low',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
      'gemini-3-flash',
    ];

    const displayNameMap = {
      'gemini-pro-agent': 'Gemini 3.1 Pro (High)',
      'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
      'gemini-3-flash': 'Gemini 3 Flash',
      'gemini-3.5-flash-low': 'Gemini 3.5 Flash (Medium)',
      'gemini-3-flash-agent': 'Gemini 3 Flash (Agent)',
      'claude-sonnet-4-6': 'Claude Sonnet 4.6 (Thinking)',
      'claude-opus-4-6-thinking': 'Claude Opus 4.6 (Thinking)',
      'gpt-oss-120b-medium': 'GPT-OSS 120B (Medium)',
    };

    if (data.models) {
      // Sort to match display order
      const sortedKeys = Object.keys(data.models).sort((a, b) => {
        const idxA = importantModels.indexOf(a);
        const idxB = importantModels.indexOf(b);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
      });

      for (const modelKey of sortedKeys) {
        const info = data.models[modelKey];
        if (!info || !info.quotaInfo || info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = Math.round(remainingFraction * 100);
        const total = 1000;
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        quotas.push({
          modelKey,
          name: displayNameMap[modelKey] || info.displayName || modelKey,
          used,
          total,
          remainingPercentage,
          resetAt: info.quotaInfo.resetTime || null
        });
      }
    }

    res.json({ ok: true, quotas });
  } catch (err) {
    logger.error(`Quota check failed for ${activeAcc.email}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}));


// Google OAuth link generator for Admin Dashboard
router.get('/oauth/google/authorize', asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(32).toString('hex');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'vinhcousera.vercel.app';
  const redirectUri = `${proto}://${host}/antigravity-admin-api/oauth/google/callback`;
  
  await antigravityOauthSessions.set(state, {
    redirectUri,
    status: 'pending',
    createdAt: Date.now()
  });

  const clientId = config.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
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
    const clientId = config.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
    const clientSecret = config.ANTIGRAVITY_CLIENT_SECRET || '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';

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
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
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
    // This step is OPTIONAL — if the API is not enabled on the account's project,
    // we still save the account and it will work once the API is enabled.
    const metadata = { ideType: 9, platform: 5, pluginType: 2 };
    let projectId = null;
    let tierId = 'legacy-tier';
    let loadCodeAssistWarning = null;

    try {
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

      if (loadRes.ok) {
        const loadData = await loadRes.json();
        projectId = loadData.cloudaicompanionProject;
        if (typeof projectId === 'object' && projectId !== null && projectId.id) {
          projectId = projectId.id;
        }

        if (Array.isArray(loadData.allowedTiers)) {
          for (const tier of loadData.allowedTiers) {
            if (tier.isDefault && tier.id) {
              tierId = tier.id.trim();
              break;
            }
          }
        }
      } else {
        const errText = await loadRes.text();
        logger.warn(`loadCodeAssist failed for ${email} (non-fatal): ${errText}`);
        
        let activationUrl = null;
        try {
          const errJson = JSON.parse(errText);
          const msg = errJson.error?.message || '';
          const match = msg.match(/https:\/\/console\.[^\s'"]+/);
          if (match) {
            // Remove trailing dot if matched by mistake
            activationUrl = match[0].replace(/\.+$/, '');
          }
        } catch (e) {
          // Ignore parse errors
        }

        loadCodeAssistWarning = {
          text: 'Cloud Code Private API chưa được bật trên project Google Cloud của tài khoản này.',
          url: activationUrl
        };
      }
    } catch (loadErr) {
      logger.warn(`loadCodeAssist error for ${email} (non-fatal): ${loadErr.message}`);
      loadCodeAssistWarning = {
        text: 'Không thể kiểm tra trạng thái Cloud Code API. Vui lòng kiểm tra lại sau.',
        url: null
      };
    }

    // Use a default project ID if loadCodeAssist didn't return one
    if (!projectId) {
      projectId = `pending-${email.split('@')[0]}`;
      logger.info(`Using placeholder projectId for ${email}: ${projectId}`);
    }

    // 4. Onboard user (optional, skip if loadCodeAssist failed)
    if (!loadCodeAssistWarning) {
      try {
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
          logger.warn(`onboardUser failed for ${email} (non-fatal): ${errText}`);
        }
      } catch (onboardErr) {
        logger.warn(`onboardUser error for ${email} (non-fatal): ${onboardErr.message}`);
      }
    }

    // Always save to DB — account can still be used when API is enabled later
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

    let warningHtml = '';
    if (loadCodeAssistWarning) {
      if (loadCodeAssistWarning.url) {
        warningHtml = `
          <div style="margin-top: 20px; padding: 16px; background: rgba(245, 158, 11, 0.08); border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.25); text-align: left; box-sizing: border-box;">
            <p style="color: #f59e0b; margin: 0 0 14px 0; font-weight: 500; font-size: 14px; line-height: 1.5; font-family: inherit;">
              ⚠️ ${loadCodeAssistWarning.text}
            </p>
            <a href="${loadCodeAssistWarning.url}" target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background-color: #f59e0b; color: #0d1117; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; transition: background-color 0.2s; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.2); font-family: inherit;">
              👉 Bật API Ngay trên Google Cloud
            </a>
            <p style="color: #8b949e; margin: 12px 0 0 0; font-size: 12px; line-height: 1.4; font-family: inherit;">
              * Sau khi nhấp và bấm "Bật/Enable" trên console của Google Cloud, tài khoản này sẽ tự động hoạt động trên hệ thống.
            </p>
          </div>
        `;
      } else {
        warningHtml = `
          <div style="margin-top: 20px; padding: 16px; background: rgba(245, 158, 11, 0.08); border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.25); text-align: left; box-sizing: border-box;">
            <p style="color: #f59e0b; margin: 0; font-weight: 500; font-size: 14px; line-height: 1.5; font-family: inherit;">
              ⚠️ ${loadCodeAssistWarning.text}
            </p>
          </div>
        `;
      }
    }

    return res.send(`
      <html>
        <head>
          <title>Kết nối Antigravity thành công</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 50px; background-color: #0d1117; color: #c9d1d9; }
            h1 { color: #58a6ff; }
            .card { background-color: #161b22; padding: 30px; border-radius: 8px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.5); max-width: 500px; width: 100%; box-sizing: border-box; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Liên kết thành công!</h1>
            <p>Tài khoản <strong>${email}</strong> đã được thêm thành công vào hệ thống xoay vòng Antigravity.</p>
            <p>Dự án liên kết: <strong>${projectId}</strong></p>
            ${warningHtml}
            <p style="color: #8b949e; margin-top: 20px;">Bạn có thể đóng cửa sổ này ngay bây giờ.</p>
          </div>
          <script>
            ${loadCodeAssistWarning && loadCodeAssistWarning.url ? '' : 'setTimeout(() => { window.close(); }, 5000);'}
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

// POST /antigravity-admin-api/accounts/import-manual — Nhập tài khoản thủ công bằng Refresh Token
router.post('/accounts/import-manual', asyncHandler(async (req, res) => {
  const { email, refreshToken, projectId } = req.body;
  if (!email || !refreshToken || !projectId) {
    throw new AppError('Email, Refresh Token, and Project ID are required', 400, 'INVALID_REQUEST');
  }

  const emailClean = email.trim().toLowerCase();
  const tokenClean = refreshToken.trim();
  const projClean = projectId.trim();

  // Validate the refresh token by fetching an access token using the official Client ID
  const clientId = config.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
  const clientSecret = config.ANTIGRAVITY_CLIENT_SECRET || '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';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenClean
      })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Failed to verify refresh token: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Save to DB
    await AntigravityAccount.upsert({
      email: emailClean,
      name: emailClean,
      accessToken,
      refreshToken: tokenClean,
      projectId: projClean
    });

    // Reload active pool accounts
    await AntigravityPool._loadAsync();

    res.json({ success: true, message: 'Tài khoản đã được thêm thủ công thành công!' });
  } catch (err) {
    logger.error('Failed to manually import Antigravity account:', err);
    throw new AppError(`Xác thực thất bại: ${err.message}`, 400, 'VERIFICATION_FAILED');
  }
}));

module.exports = router;
