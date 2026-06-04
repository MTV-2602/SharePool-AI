'use strict';

const { v4: uuidv4 } = require('uuid');
const db     = require('../db');
const logger = require('../utils/logger').create('UsageLog');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(row) {
  if (!row) return null;
  return {
    id:          row.id,
    apiKey:      row.apiKey || row.api_key,
    model:       row.model,
    tokensIn:    row.tokensIn || row.tokens_in,
    tokensOut:   row.tokensOut || row.tokens_out,
    tokensTotal: row.tokensTotal || row.tokens_total,
    reqId:       row.reqId || row.req_id,
    createdAt:   row.createdAt || row.created_at,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * Insert a new usage log entry.
 *
 * @param {{ apiKey: string, model?: string, tokensIn?: number, tokensOut?: number, reqId?: string }} opts
 * @returns {Promise<Object>} The created record.
 */
async function create({ apiKey, model = 'gpt-4o', tokensIn = 0, tokensOut = 0, reqId = null } = {}) {
  const tokensTotal = tokensIn + tokensOut;
  const id          = reqId || uuidv4();

  const result = await db.run(
    `INSERT INTO usage_logs (api_key, model, tokens_in, tokens_out, tokens_total, req_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [apiKey, model, tokensIn, tokensOut, tokensTotal, id]
  );

  const row = await db.get('SELECT * FROM usage_logs WHERE id = ?', [result.lastInsertRowid]);
  return mapRow(row);
}

/**
 * Return paginated usage logs for a specific API key.
 *
 * @param {string} key
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<{ rows: Array, total: number, limit: number, offset: number }>}
 */
async function findByKey(key, { limit = 50, offset = 0 } = {}) {
  const safeLimit  = Math.min(Math.max(1, parseInt(limit, 10) || 50), 500);
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const rows = await db.query(
    `SELECT * FROM usage_logs WHERE api_key = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [key, safeLimit, safeOffset]
  );

  const countRow = await db.get(
    `SELECT COUNT(*) AS cnt FROM usage_logs WHERE api_key = ?`,
    [key]
  );

  return {
    rows:   rows.map(mapRow),
    total:  parseInt(countRow?.cnt ?? 0, 10),
    limit:  safeLimit,
    offset: safeOffset,
  };
}

/**
 * Return daily usage stats for a single API key over the last 30 days.
 *
 * @param {string} key
 * @returns {Promise<Array<{ date: string, requests: number, tokens_in: number, tokens_out: number, tokens_total: number }>>}
 */
async function getDailyStats(key) {
  if (db.isPostgres()) {
    return await db.query(
      `SELECT
         CAST(created_at AS DATE) AS date,
         COUNT(*)               AS requests,
         SUM(tokens_in)         AS tokens_in,
         SUM(tokens_out)        AS tokens_out,
         SUM(tokens_total)      AS tokens_total
       FROM usage_logs
       WHERE api_key = ?
         AND CAST(created_at AS TIMESTAMP) >= (CURRENT_DATE - INTERVAL '30 days')
       GROUP BY CAST(created_at AS DATE)
       ORDER BY date ASC`,
      [key]
    );
  } else {
    return await db.query(
      `SELECT
         date(created_at)       AS date,
         COUNT(*)               AS requests,
         SUM(tokens_in)         AS tokens_in,
         SUM(tokens_out)        AS tokens_out,
         SUM(tokens_total)      AS tokens_total
       FROM usage_logs
       WHERE api_key = ?
         AND created_at >= date('now', '-30 days', 'localtime')
       GROUP BY date(created_at)
       ORDER BY date ASC`,
      [key]
    );
  }
}

/**
 * Return daily usage stats across ALL keys for the last 30 days.
 *
 * @returns {Promise<Array<{ date, requests, tokens_in, tokens_out, tokens_total }>>}
 */
async function getGlobalDailyStats() {
  if (db.isPostgres()) {
    return await db.query(
      `SELECT
         CAST(created_at AS DATE) AS date,
         COUNT(*)               AS requests,
         SUM(tokens_in)         AS tokens_in,
         SUM(tokens_out)        AS tokens_out,
         SUM(tokens_total)      AS tokens_total
       FROM usage_logs
       WHERE CAST(created_at AS TIMESTAMP) >= (CURRENT_DATE - INTERVAL '30 days')
       GROUP BY CAST(created_at AS DATE)
       ORDER BY date ASC`
    );
  } else {
    return await db.query(
      `SELECT
         date(created_at)       AS date,
         COUNT(*)               AS requests,
         SUM(tokens_in)         AS tokens_in,
         SUM(tokens_out)        AS tokens_out,
         SUM(tokens_total)      AS tokens_total
       FROM usage_logs
       WHERE created_at >= date('now', '-30 days', 'localtime')
       GROUP BY date(created_at)
       ORDER BY date ASC`
    );
  }
}

/**
 * Aggregate stats for the admin dashboard.
 *
 * @returns {Promise<{
 *   totalKeys: number,
 *   activeKeys: number,
 *   totalRequests: number,
 *   totalTokens: number,
 *   todayRequests: number,
 *   todayTokens: number
 * }>}
 */
async function getAdminStats() {
  const keyStats = await db.get(
    `SELECT
       COUNT(*)                       AS total_keys,
       SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_keys,
       SUM(CASE WHEN is_active = 1 THEN quota_total ELSE 0 END) AS sum_quota_total,
       SUM(CASE WHEN is_active = 1 THEN quota_used ELSE 0 END) AS sum_quota_used
     FROM api_keys`
  );

  const globalStats = await db.get(
    `SELECT
       COUNT(*)          AS total_requests,
       SUM(tokens_total) AS total_tokens
     FROM usage_logs`
  );

  const todayCondition = db.isPostgres()
    ? `CAST(created_at AS DATE) = CURRENT_DATE`
    : `date(created_at) = date('now', 'localtime')`;

  const todayStats = await db.get(
    `SELECT
       COUNT(*)          AS today_requests,
       SUM(tokens_total) AS today_tokens
     FROM usage_logs
     WHERE ${todayCondition}`
  );

  return {
    totalKeys:     parseInt(keyStats?.total_keys || 0, 10),
    activeKeys:    parseInt(keyStats?.active_keys || 0, 10),
    sumQuotaTotal: Number(keyStats?.sum_quota_total || 0),
    sumQuotaUsed:  Number(keyStats?.sum_quota_used || 0),
    totalRequests: parseInt(globalStats?.totalRequests || globalStats?.total_requests || 0, 10),
    totalTokens:   parseInt(globalStats?.total_tokens || 0, 10),
    todayRequests: parseInt(todayStats?.today_requests || 0, 10),
    todayTokens:   parseInt(todayStats?.today_tokens || 0, 10),
  };
}

/**
 * Return the top N API keys by total token usage.
 *
 * @param {number} limit
 * @returns {Promise<Array<{ api_key, total_requests, total_tokens, name }>>}
 */
async function getTopKeys(limit = 10) {
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);

  return await db.query(
    `SELECT
       ul.api_key,
       ak.name,
       COUNT(ul.id)      AS total_requests,
       SUM(ul.tokens_total) AS total_tokens
     FROM usage_logs ul
     LEFT JOIN api_keys ak ON ak.key = ul.api_key
     GROUP BY ul.api_key, ak.name
     ORDER BY total_tokens DESC
     LIMIT ?`,
    [safeLimit]
  );
}

module.exports = {
  create,
  findByKey,
  getDailyStats,
  getGlobalDailyStats,
  getAdminStats,
  getTopKeys,
};
