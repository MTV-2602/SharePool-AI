// src/models/ApiKey.js — Repository for api_keys table
'use strict';

const crypto = require('crypto');
const db     = require('../db');

function generateKey() {
  return 'sk-' + crypto.randomBytes(24).toString('hex');
}

const ApiKey = {
  /** Create a new API key */
  create({ name, quotaTotal = 100_000_000, expiresAt = null, note = '' }) {
    const key = generateKey();
    const { lastInsertRowid } = db.run(
      `INSERT INTO api_keys (key, name, quota_total, expires_at, note)
       VALUES (?, ?, ?, ?, ?)`,
      [key, name, quotaTotal, expiresAt || null, note]
    );
    return ApiKey.findById(lastInsertRowid);
  },

  /** Find by API key string */
  findByKey(key) {
    return db.get('SELECT * FROM api_keys WHERE key = ?', [key]);
  },

  /** Find by row ID */
  findById(id) {
    return db.get(
      `SELECT *, ROUND(CAST(quota_used AS REAL) * 100.0 / quota_total, 1) as usage_pct
       FROM api_keys WHERE id = ?`,
      [id]
    );
  },

  /** List all keys, newest first */
  findAll() {
    return db.query(
      `SELECT *, ROUND(CAST(quota_used AS REAL) * 100.0 / quota_total, 1) as usage_pct
       FROM api_keys ORDER BY id DESC`
    );
  },

  /** Partial update — only update provided fields */
  update(id, fields) {
    const allowed = ['name', 'quota_total', 'quota_used', 'expires_at', 'is_active', 'note'];
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

    db.run(`UPDATE api_keys SET ${pairs.join(', ')} WHERE id = ?`, vals);
    return true;
  },

  /** Soft delete (hard delete in this impl) */
  delete(id) {
    db.run('DELETE FROM api_keys WHERE id = ?', [id]);
  },

  /** Atomically add usage tokens */
  addUsage(key, tokensIn, tokensOut) {
    const total = (tokensIn || 0) + (tokensOut || 0);
    db.run(
      `UPDATE api_keys SET quota_used = quota_used + ?, updated_at = datetime('now', 'localtime')
       WHERE key = ?`,
      [total, key]
    );
    return total;
  },

  /** Reset quota_used to 0 */
  resetUsage(id) {
    db.run(
      `UPDATE api_keys SET quota_used = 0, updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [id]
    );
  },

  /**
   * Validate a key — returns { ok: true, record } or { ok: false, reason }
   * Reasons: invalid_key | key_disabled | key_expired | quota_exceeded
   */
  validate(key) {
    if (!key) return { ok: false, reason: 'invalid_key' };
    const rec = ApiKey.findByKey(key);
    if (!rec)          return { ok: false, reason: 'invalid_key' };
    if (!rec.is_active)return { ok: false, reason: 'key_disabled' };
    if (rec.expires_at && new Date(rec.expires_at) < new Date())
                       return { ok: false, reason: 'key_expired' };
    if (rec.quota_used >= rec.quota_total)
                       return { ok: false, reason: 'quota_exceeded' };
    return { ok: true, record: rec };
  },
};

module.exports = ApiKey;
