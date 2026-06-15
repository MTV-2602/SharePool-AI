// src/models/ApiKey.js — Repository for api_keys table
'use strict';

const crypto = require('crypto');
const db     = require('../db');

function generateKey() {
  return 'sk-' + crypto.randomBytes(24).toString('hex');
}

const ApiKey = {
  /** Create a new API key */
  async create({
    name,
    quotaTotal = 100_000_000,
    expiresAt = null,
    note = '',
    modelAllowlist = '',
    maxConcurrent = 0,
    rateLimitPerMinute = 0
  }) {
    const key = generateKey();
    const { lastInsertRowid } = await db.run(
      `INSERT INTO api_keys (key, name, quota_total, expires_at, note, model_allowlist, max_concurrent, rate_limit_per_minute)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [key, name, quotaTotal, expiresAt || null, note, modelAllowlist || '', maxConcurrent || 0, rateLimitPerMinute || 0]
    );
    return await ApiKey.findById(lastInsertRowid);
  },

  /** Find by API key string */
  async findByKey(key) {
    return await db.get('SELECT * FROM api_keys WHERE key = ?', [key]);
  },

  /** Find by row ID */
  async findById(id) {
    return await db.get(
      `SELECT *, ROUND(CAST(quota_used AS NUMERIC) * 100.0 / quota_total, 1) as usage_pct
       FROM api_keys WHERE id = ?`,
      [id]
    );
  },

  /** List all keys, newest first */
  async findAll() {
    return await db.query(
      `SELECT *, ROUND(CAST(quota_used AS NUMERIC) * 100.0 / quota_total, 1) as usage_pct
       FROM api_keys ORDER BY id DESC`
    );
  },

  /** Partial update — only update provided fields */
  async update(id, fields) {
    const allowed = [
      'name',
      'quota_total',
      'quota_used',
      'expires_at',
      'is_active',
      'note',
      'model_allowlist',
      'max_concurrent',
      'rate_limit_per_minute'
    ];
    const pairs   = [];
    const vals    = [];

    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      pairs.push(`${k} = ?`);
      vals.push(v);
    }
    if (!pairs.length) return false;

    pairs.push(`updated_at = datetime('now', 'localtime')`);
    vals.push(id);

    await db.run(`UPDATE api_keys SET ${pairs.join(', ')} WHERE id = ?`, vals);
    return true;
  },

  /** Soft delete (hard delete in this impl) */
  async delete(id) {
    await db.run('DELETE FROM api_keys WHERE id = ?', [id]);
  },

  /** Atomically add usage tokens */
  async addUsage(key, tokensIn, tokensOut) {
    const total = (tokensIn || 0) + (tokensOut || 0);
    await db.run(
      `UPDATE api_keys SET quota_used = quota_used + ?, updated_at = datetime('now', 'localtime')
       WHERE key = ?`,
      [total, key]
    );
    return total;
  },

  /**
   * Atomically reserve quota before hitting upstream.
   * Returns { ok, reserved, record, reason }.
   */
  async reserveQuota(key, estimatedTokens) {
    const reserve = Math.max(0, Math.ceil(Number(estimatedTokens || 0)));
    if (reserve <= 0) {
      const record = await ApiKey.findByKey(key);
      return { ok: true, reserved: 0, record };
    }

    const result = await db.run(
      `UPDATE api_keys
       SET quota_used = quota_used + ?, updated_at = datetime('now', 'localtime')
       WHERE key = ?
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at = '' OR CAST(expires_at AS TIMESTAMP) >= CURRENT_TIMESTAMP)
         AND quota_used + ? <= quota_total`,
      [reserve, key, reserve]
    );

    if (!result.changes) {
      const validation = await ApiKey.validate(key);
      return {
        ok: false,
        reserved: 0,
        reason: validation.ok ? 'quota_exceeded' : validation.reason,
        record: validation.record || null
      };
    }

    return { ok: true, reserved: reserve, record: await ApiKey.findByKey(key) };
  },

  /**
   * Adjust reserved quota after the request finishes.
   * Pass actualTokens < reserved to refund; actualTokens > reserved to add the delta.
   */
  async finalizeReservation(key, reservedTokens, actualTokens) {
    const reserved = Math.max(0, Math.ceil(Number(reservedTokens || 0)));
    const actual = Math.max(0, Math.ceil(Number(actualTokens || 0)));
    const delta = actual - reserved;
    if (delta === 0) return { delta: 0 };

    if (delta > 0) {
      await db.run(
        `UPDATE api_keys SET quota_used = quota_used + ?, updated_at = datetime('now', 'localtime')
         WHERE key = ?`,
        [delta, key]
      );
    } else {
      await db.run(
        `UPDATE api_keys SET quota_used = GREATEST(0, quota_used - ?), updated_at = datetime('now', 'localtime')
         WHERE key = ?`,
        [Math.abs(delta), key]
      );
    }

    return { delta };
  },

  /** Reset quota_used to 0 */
  async resetUsage(id) {
    await db.run(
      `UPDATE api_keys SET quota_used = 0, updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [id]
    );
  },

  /**
   * Validate a key — returns { ok: true, record } or { ok: false, reason }
   * Reasons: invalid_key | key_disabled | key_expired | quota_exceeded
   */
  async validate(key) {
    if (!key) return { ok: false, reason: 'invalid_key' };
    const rec = await ApiKey.findByKey(key);
    if (!rec)          return { ok: false, reason: 'invalid_key' };
    if (!rec.isActive) return { ok: false, reason: 'key_disabled' }; // Use camelCase isActive mapped key
    if (rec.expiresAt && new Date(rec.expiresAt) < new Date())
                       return { ok: false, reason: 'key_expired' };
    if (Number(rec.quotaUsed) >= Number(rec.quotaTotal))
                       return { ok: false, reason: 'quota_exceeded' };
    return { ok: true, record: rec };
  },
};

module.exports = ApiKey;
