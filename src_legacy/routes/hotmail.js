// src/routes/hotmail.js — Hotmail route handlers for Admin and Extension API
'use strict';

const express = require('express');
const adminRouter = express.Router();
const apiRouter = express.Router();

const HotmailAccount = require('../models/HotmailAccount');
const db = require('../db');
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

  const total = await HotmailAccount.count({});
  const filteredTotal = await HotmailAccount.count(query);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
  const accounts = await HotmailAccount.find(query, { skip, limit });

  if (accounts.length > 0) {
    const emails = accounts.map(a => a.email.toLowerCase().trim());
    const placeholders = emails.map(() => '?').join(', ');
    const chatgptCreds = await db.query(
      `SELECT email FROM chatgpt_credentials WHERE email IN (${placeholders})`,
      emails
    );
    const existingEmails = new Set(chatgptCreds.map(c => c.email.toLowerCase().trim()));
    accounts.forEach(acc => {
      acc.hasChatGPT = existingEmails.has(acc.email.toLowerCase().trim());
    });
  }

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
  const account = await HotmailAccount.findOne({ email });
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

  const existing = await HotmailAccount.findOne({ email: validatedCred.email });
  if (existing) {
    await HotmailAccount.updateOne({ email: validatedCred.email }, validatedCred);
  } else {
    await HotmailAccount.create({ ...validatedCred, state: 'available', usedCount: 0 });
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
  const parsedCreds = [];
  const results = [];

  for (const line of rawLines) {
    const cred = hotmailService.parseStrictHotmailSaveLine(line) || hotmailService.parseHotmailLine(line);
    if (!cred || !cred.email) {
      results.push({ line, ok: false, error: 'Sai format' });
      continue;
    }
    parsedCreds.push({ cred, line });
  }

  if (parsedCreds.length === 0) {
    return res.json({ ok: true, total: rawLines.length, results });
  }

  const emailsToCheck = parsedCreds.map(p => p.cred.email.toLowerCase().trim());
  
  // Fetch existing in one query
  const placeholders = emailsToCheck.map(() => '?').join(', ');
  const existingRows = await db.query(
    `SELECT email FROM hotmail_accounts WHERE email IN (${placeholders})`,
    emailsToCheck
  );
  const existingEmailsSet = new Set(existingRows.map(r => r.email.toLowerCase().trim()));

  const toInsert = [];
  const toUpdate = [];
  const processedEmails = new Set();

  for (const item of parsedCreds) {
    const emailClean = item.cred.email.toLowerCase().trim();
    if (processedEmails.has(emailClean)) {
      results.push({ email: item.cred.email, ok: true, action: 'skipped_duplicate' });
      continue;
    }
    processedEmails.add(emailClean);

    const exists = existingEmailsSet.has(emailClean);
    if (exists) {
      toUpdate.push(item.cred);
      results.push({ email: item.cred.email, ok: true, action: 'updated' });
    } else {
      toInsert.push(item.cred);
      results.push({ email: item.cred.email, ok: true, action: 'created' });
    }
  }

  // Execute updates in parallel
  const updatePromises = toUpdate.map(cred => {
    return HotmailAccount.updateOne({ email: cred.email }, cred);
  });

  // Execute inserts as a single bulk query
  if (toInsert.length > 0) {
    const cols = ['email', 'password', 'refreshtoken', 'clientid', 'secret2fa', 'state', 'takenbyip', 'takenat', 'takennote', 'usedcount', 'lastreadat', 'reservedat', 'usedat', 'created_at', 'updated_at'];
    const insertValues = [];
    const insertParams = [];

    for (const cred of toInsert) {
      insertValues.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)');
      insertParams.push(
        cred.email.toLowerCase().trim(),
        cred.password || '',
        cred.refreshToken || '',
        cred.clientId || '',
        cred.secret2fa || '',
        cred.state || 'available',
        cred.takenByIp || '',
        cred.takenAt || '',
        cred.takenNote || '',
        cred.usedCount || 0,
        cred.lastReadAt || '',
        cred.reservedAt || '',
        cred.usedAt || ''
      );
    }

    const insertSql = `INSERT INTO hotmail_accounts (${cols.join(', ')}) VALUES ${insertValues.join(', ')}`;
    updatePromises.push(db.run(insertSql, insertParams));
  }

  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
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
    cred = await HotmailAccount.findOne({ email });
  }

  if (!cred) {
    throw new AppError('Không tìm thấy tài khoản Hotmail.', 404, 'NOT_FOUND');
  }

  // Save/Update if line is provided and doesn't exist
  if (line && cred.email) {
    const existing = await HotmailAccount.findOne({ email: cred.email });
    if (!existing) {
      await HotmailAccount.create({ ...cred, state: 'available', usedCount: 0 });
    } else {
      await HotmailAccount.updateOne({ email: cred.email }, cred);
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
  const deleted = await HotmailAccount.findOneAndDelete({ email });
  if (!deleted) {
    throw new AppError('Hotmail account not found.', 404, 'NOT_FOUND');
  }
  res.json({ ok: true, email, message: 'Deleted' });
}));

// POST /admin-api/hotmail/reset-all — Reset all hotmail accounts to available
adminRouter.post('/reset-all', asyncHandler(async (req, res) => {
  await HotmailAccount.resetAll();
  res.json({ ok: true, message: 'All Hotmail accounts reset to Available successfully.' });
}));

// POST /admin-api/hotmail/update-state — Update state of a hotmail account
adminRouter.post('/update-state', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const state = String(req.body.state || '').trim().toLowerCase();

  if (!['available', 'reserved', 'used'].includes(state)) {
    throw new AppError('Trạng thái không hợp lệ. Chỉ chấp nhận available, reserved, used.', 400, 'INVALID_STATE');
  }

  const account = await HotmailAccount.findOne({ email });
  if (!account) {
    throw new AppError('Không tìm thấy tài khoản Hotmail.', 404, 'NOT_FOUND');
  }

  const updateFields = { state };
  if (state === 'available') {
    updateFields.reservedAt = '';
    updateFields.usedAt = '';
    updateFields.takenAt = '';
    updateFields.takenNote = '';
  } else if (state === 'used') {
    updateFields.usedAt = new Date().toISOString();
  }

  await HotmailAccount.updateOne({ email }, updateFields);
  res.json({ ok: true, email, state });
}));


// ─── API ROUTES (Extension or Public facing endpoints) ────────────────────────

// GET /api/hotmail/new — Reserve next available Hotmail (protected by verifyExtensionPushToken)
apiRouter.get('/new', verifyExtensionPushToken, asyncHandler(async (req, res) => {
  const note = String(req.query.note || req.body?.note || '').slice(0, 200);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 80);
  const now = new Date().toISOString();

  const account = await HotmailAccount.findOneAndUpdate(
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

  const result = await HotmailAccount.findOneAndUpdate(
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

  const result = await HotmailAccount.findOneAndUpdate(
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

// POST /api/hotmail/read — Read inbox by email or raw line (used by AutoRegUnified extension to get OTP)
// Accepts: { email, top } OR { line, top }
// Protected by extensionPushToken OR works with email lookup from DB
apiRouter.post('/read', asyncHandler(async (req, res) => {
  const { email, line, top } = req.body;
  let cred = null;

  if (line && line.trim()) {
    cred = hotmailService.parseHotmailLine(line.trim());
  } else if (email && email.trim()) {
    cred = await HotmailAccount.findOne({ email: email.trim().toLowerCase() });
  }

  if (!cred) {
    throw new AppError('Không tìm thấy tài khoản Hotmail.', 404, 'NOT_FOUND');
  }

  // Auto-save if provided via raw line and not in DB yet
  if (line && cred.email) {
    const existing = await HotmailAccount.findOne({ email: cred.email });
    if (!existing) {
      await HotmailAccount.create({ ...cred, state: 'available', usedCount: 0 });
    } else {
      await HotmailAccount.updateOne({ email: cred.email }, cred);
    }
  }

  const topCount = Math.min(50, Math.max(1, parseInt(top || '10', 10)));
  const result = await hotmailService.readStoredHotmailInbox(cred, topCount);
  res.json({
    ok: true,
    email: result.email,
    count: result.messages.length,
    scope: result.scope,
    messages: result.messages
  });
}));

// POST /api/hotmail/public-read — Read inbox by email (no password needed, useful for verification)
apiRouter.post('/public-read', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    throw new AppError('Thiếu email Hotmail.', 400, 'INVALID_REQUEST');
  }

  const cred = await HotmailAccount.findOne({ email });
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
