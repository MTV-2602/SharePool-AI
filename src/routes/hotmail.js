// src/routes/hotmail.js — Hotmail route handlers for Admin and Extension API
'use strict';

const express = require('express');
const adminRouter = express.Router();
const apiRouter = express.Router();

const HotmailAccount = require('../models/HotmailAccount');
const hotmailService = require('../services/hotmail');
const totpService = require('../services/totp');
const { verifyExtensionPushToken } = require('../middleware/authHelpers');
const adminGuard = require('../middleware/adminGuard');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// ─── ADMIN ROUTES (protected by adminGuard) ──────────────────────────
adminRouter.use(adminGuard);

// GET /admin-api/hotmail/accounts — List all hotmail accounts (paginated & searched)
adminRouter.get('/accounts', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const skip = (page - 1) * limit;

  const state = String(req.query.state || 'all').trim().toLowerCase();
  const search = String(req.query.search || '').trim();

  const query = {};
  if (['available', 'reserved', 'used'].includes(state)) {
    query.state = state;
  }
  if (search) {
    query.email = search;
  }

  const total = HotmailAccount.count({});
  const filteredTotal = HotmailAccount.count(query);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
  const accounts = HotmailAccount.find(query, { skip, limit });

  res.json({
    ok: true,
    total,
    filteredTotal,
    page,
    limit,
    totalPages,
    accounts
  });
}));

// GET /admin-api/hotmail/account/:email — Get single account details
adminRouter.get('/account/:email', asyncHandler(async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  const account = HotmailAccount.findOne({ email });
  if (!account) {
    throw new AppError('Hotmail account not found.', 404, 'NOT_FOUND');
  }
  res.json({ ok: true, account });
}));

// POST /admin-api/hotmail/save — Save/update hotmail account (runs live check)
adminRouter.post('/save', asyncHandler(async (req, res) => {
  const { line } = req.body;
  const cred = hotmailService.parseStrictHotmailSaveLine(line) || hotmailService.parseHotmailLine(line);
  if (!cred || !cred.email) {
    throw new AppError('Sai format. Đúng: email|pass|refresh_token|client_id hoặc email|pass|refresh_token|client_id|secret2fa', 400, 'INVALID_FORMAT');
  }

  // Validate live by exchanging token and reading inbox
  const validation = await hotmailService.validateHotmailCredentialLive(cred, { top: 1 });
  const validatedCred = validation.credential || cred;

  const existing = HotmailAccount.findOne({ email: validatedCred.email });
  if (existing) {
    HotmailAccount.updateOne({ email: validatedCred.email }, validatedCred);
  } else {
    HotmailAccount.create({ ...validatedCred, state: 'available', usedCount: 0 });
  }

  res.json({
    ok: true,
    email: validatedCred.email,
    message: existing ? 'Updated' : 'Saved',
    validated: true,
    liveMessage: validation.liveMessage,
    messageCount: validation.messageCount,
    scope: validation.scope
  });
}));

// POST /admin-api/hotmail/bulk-import — Bulk import hotmail accounts
adminRouter.post('/bulk-import', asyncHandler(async (req, res) => {
  const { lines } = req.body;
  if (!lines || !lines.trim()) {
    throw new AppError('Dữ liệu trống.', 400, 'EMPTY_DATA');
  }

  const rawLines = lines.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];

  for (const line of rawLines) {
    const cred = hotmailService.parseStrictHotmailSaveLine(line) || hotmailService.parseHotmailLine(line);
    if (!cred || !cred.email) {
      results.push({ line, ok: false, error: 'Sai format' });
      continue;
    }
    try {
      const existing = HotmailAccount.findOne({ email: cred.email });
      if (existing) {
        HotmailAccount.updateOne({ email: cred.email }, cred);
        results.push({ email: cred.email, ok: true, action: 'updated' });
      } else {
        HotmailAccount.create({ ...cred, state: 'available', usedCount: 0 });
        results.push({ email: cred.email, ok: true, action: 'created' });
      }
    } catch (e) {
      results.push({ email: cred.email || 'unknown', ok: false, error: e.message });
    }
  }

  res.json({ ok: true, total: rawLines.length, results });
}));

// POST /admin-api/hotmail/read — Read inbox (admin panel)
adminRouter.post('/read', asyncHandler(async (req, res) => {
  const { email, line, top } = req.body;
  let cred = null;
  if (line) {
    cred = hotmailService.parseHotmailLine(line);
  } else if (email) {
    cred = HotmailAccount.findOne({ email });
  }

  if (!cred) {
    throw new AppError('Không tìm thấy tài khoản Hotmail.', 404, 'NOT_FOUND');
  }

  // Save/Update if line is provided and doesn't exist
  if (line && cred.email) {
    const existing = HotmailAccount.findOne({ email: cred.email });
    if (!existing) {
      HotmailAccount.create({ ...cred, state: 'available', usedCount: 0 });
    } else {
      HotmailAccount.updateOne({ email: cred.email }, cred);
    }
  }

  const topCount = parseInt(top || '5', 10);
  const result = await hotmailService.readStoredHotmailInbox(cred, topCount);
  res.json({
    ok: true,
    email: result.email,
    count: result.messages.length,
    scope: result.scope,
    messages: result.messages
  });
}));

// DELETE /admin-api/hotmail/delete/:email — Delete hotmail account
adminRouter.delete('/delete/:email', asyncHandler(async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  const deleted = HotmailAccount.findOneAndDelete({ email });
  if (!deleted) {
    throw new AppError('Hotmail account not found.', 404, 'NOT_FOUND');
  }
  res.json({ ok: true, email, message: 'Deleted' });
}));


// ─── API ROUTES (Extension or Public facing endpoints) ────────────────────────

// GET /api/hotmail/new — Reserve next available Hotmail (protected by verifyExtensionPushToken)
apiRouter.get('/new', verifyExtensionPushToken, asyncHandler(async (req, res) => {
  const note = String(req.query.note || req.body?.note || '').slice(0, 200);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 80);
  const now = new Date().toISOString();

  const account = HotmailAccount.findOneAndUpdate(
    { state: 'available' },
    {
      state: 'reserved',
      reservedAt: now,
      takenByIp: ip,
      takenAt: now,
      takenNote: note || `Lấy lúc ${now}`,
      usedAt: ''
    }
  );

  if (!account) {
    throw new AppError('Hết tài khoản trống trong kho Hotmail.', 404, 'OUT_OF_STOCK');
  }

  res.json({
    ok: true,
    account,
    formatted: hotmailService.buildHotmailFormattedLine(account)
  });
}));

// POST /api/hotmail/release — Release reserved account (protected by verifyExtensionPushToken)
apiRouter.post('/release', verifyExtensionPushToken, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    throw new AppError('Thiếu email Hotmail.', 400, 'INVALID_REQUEST');
  }

  const result = HotmailAccount.findOneAndUpdate(
    { email },
    {
      state: 'available',
      reservedAt: '',
      takenNote: '',
      takenByIp: '',
      takenAt: '',
      usedAt: ''
    }
  );

  if (!result) {
    throw new AppError(`Không tìm thấy tài khoản Hotmail ${email}.`, 404, 'NOT_FOUND');
  }

  res.json({ ok: true, email, state: 'available' });
}));

// POST /api/hotmail/mark-used — Mark reserved account as used (protected by verifyExtensionPushToken)
apiRouter.post('/mark-used', verifyExtensionPushToken, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    throw new AppError('Thiếu email Hotmail.', 400, 'INVALID_REQUEST');
  }

  const note = String(req.body?.note || '').slice(0, 200);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 80);
  const now = new Date().toISOString();

  const result = HotmailAccount.findOneAndUpdate(
    { email },
    {
      state: 'used',
      usedAt: now,
      takenByIp: ip,
      takenAt: now,
      takenNote: note || `Đã dùng lúc ${now}`,
      $inc: { usedCount: 1 }
    }
  );

  if (!result) {
    throw new AppError(`Không tìm thấy tài khoản Hotmail ${email}.`, 404, 'NOT_FOUND');
  }

  res.json({ ok: true, email, state: 'used', usedCount: result.usedCount + 1 });
}));

// POST /api/hotmail/2fa — Generate TOTP code
apiRouter.post('/2fa', asyncHandler(async (req, res) => {
  const { secret } = req.body;
  if (!secret) {
    throw new AppError('Thiếu 2FA secret.', 400, 'INVALID_REQUEST');
  }
  const code = totpService.getTOTP(secret);
  if (!code) {
    throw new AppError('Secret 2FA không hợp lệ.', 400, 'INVALID_SECRET');
  }
  res.json({ ok: true, code });
}));

// POST /api/hotmail/public-read — Read inbox by email (no password needed, useful for verification)
apiRouter.post('/public-read', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    throw new AppError('Thiếu email Hotmail.', 400, 'INVALID_REQUEST');
  }

  const cred = HotmailAccount.findOne({ email });
  if (!cred) {
    throw new AppError('Tài khoản Hotmail không tồn tại trong kho.', 404, 'NOT_FOUND');
  }

  const topCount = parseInt(req.body?.top || '10', 10);
  const result = await hotmailService.readStoredHotmailInbox(cred, topCount);
  res.json({
    ok: true,
    email: result.email,
    count: result.messages.length,
    messages: result.messages
  });
}));

module.exports = {
  adminRouter,
  apiRouter
};
