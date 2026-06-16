'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db');

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (_) {
    return JSON.stringify({ error: 'Failed to serialize detail' });
  }
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (_) {
    return {};
  }
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const sensitive = ['authorization', 'cookie', 'token', 'api-key', 'x-api-key'];
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (sensitive.some(s => lower.includes(s))) continue;
    clean[key] = value;
  }
  return clean;
}

function sanitizeDetail(detail) {
  const clean = { ...(detail || {}) };
  if (clean.request?.headers) {
    clean.request = { ...clean.request, headers: sanitizeHeaders(clean.request.headers) };
  }
  if (clean.apiKey && typeof clean.apiKey === 'string') {
    clean.apiKeyPreview = `${clean.apiKey.slice(0, 8)}...`;
    delete clean.apiKey;
  }
  return clean;
}

const RequestDetail = {
  async create(detail = {}) {
    const id = detail.id || uuidv4();
    const reqId = detail.reqId || detail.req_id || id;
    const account = detail.account || {};
    const data = sanitizeDetail(detail);

    await db.run(
      `INSERT INTO request_details (
         id, req_id, api_key, endpoint, model, upstream_account_id,
         upstream_account_name, status, latency_ms, data
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         req_id = EXCLUDED.req_id,
         api_key = EXCLUDED.api_key,
         endpoint = EXCLUDED.endpoint,
         model = EXCLUDED.model,
         upstream_account_id = EXCLUDED.upstream_account_id,
         upstream_account_name = EXCLUDED.upstream_account_name,
         status = EXCLUDED.status,
         latency_ms = EXCLUDED.latency_ms,
         data = EXCLUDED.data`,
      [
        id,
        reqId,
        detail.apiKey || '',
        detail.endpoint || '',
        detail.model || '',
        account.id || detail.upstreamAccountId || null,
        account.name || detail.upstreamAccountName || '',
        detail.status || 'ok',
        detail.latencyMs || 0,
        safeJson(data)
      ]
    );

    return { id, reqId };
  },

  async findAll({ limit = 100, accountId = null, apiKey = '', model = '', endpoint = '' } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const conds = [];
    const params = [];

    if (accountId) { conds.push('upstream_account_id = ?'); params.push(accountId); }
    if (apiKey) { conds.push('api_key = ?'); params.push(apiKey); }
    if (model) { conds.push('model = ?'); params.push(model); }
    if (endpoint) { conds.push('endpoint = ?'); params.push(endpoint); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.query(
      `SELECT * FROM request_details ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map(row => ({
      id: row.id,
      reqId: row.reqId || row.req_id,
      createdAt: row.createdAt || row.created_at,
      apiKey: row.apiKey || row.api_key,
      endpoint: row.endpoint,
      model: row.model,
      upstreamAccountId: row.upstreamAccountId || row.upstream_account_id,
      upstreamAccountName: row.upstreamAccountName || row.upstream_account_name,
      status: row.status,
      latencyMs: row.latencyMs || row.latency_ms,
      data: parseJson(row.data)
    }));
  }
};

module.exports = RequestDetail;
