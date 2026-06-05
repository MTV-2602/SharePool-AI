// src/models/AntigravityAccount.js — Repository for antigravity_accounts table
'use strict';

const db = require('../db');

const AntigravityAccount = {
  /** Find all accounts */
  async findAll() {
    return await db.query(
      `SELECT * FROM antigravity_accounts ORDER BY id ASC`
    );
  },

  /** Find by ID */
  async findById(id) {
    return await db.get(
      `SELECT * FROM antigravity_accounts WHERE id = ?`,
      [id]
    );
  },

  /** Find by email */
  async findByEmail(email) {
    if (!email) return null;
    return await db.get(
      `SELECT * FROM antigravity_accounts WHERE email = ?`,
      [email]
    );
  },

  /** Insert or update by email */
  async upsert({ email, name, accessToken, refreshToken, projectId }) {
    const existing = await AntigravityAccount.findByEmail(email);
    if (existing) {
      await db.run(
        `UPDATE antigravity_accounts
         SET name = ?, access_token = ?, refresh_token = COALESCE(?, refresh_token), project_id = COALESCE(?, project_id), is_active = 1, last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [name || existing.name, accessToken, refreshToken || null, projectId || null, existing.id]
      );
      return await AntigravityAccount.findById(existing.id);
    }

    const { lastInsertRowid } = await db.run(
      `INSERT INTO antigravity_accounts (name, email, access_token, refresh_token, project_id, is_active, last_error)
       VALUES (?, ?, ?, ?, ?, 1, NULL)`,
      [name || email, email, accessToken, refreshToken || null, projectId || null]
    );
    return await AntigravityAccount.findById(lastInsertRowid);
  },

  /** Update account fields */
  async update(id, fields) {
    const allowed = ['name', 'access_token', 'refresh_token', 'project_id', 'is_active', 'last_error', 'quota_resets_at', 'last_used_at'];
    const pairs = [];
    const vals = [];

    for (const [k, v] of Object.entries(fields)) {
      let dbKey = k;
      if (k === 'accessToken') dbKey = 'access_token';
      else if (k === 'refreshToken') dbKey = 'refresh_token';
      else if (k === 'projectId') dbKey = 'project_id';
      else if (k === 'isActive') dbKey = 'is_active';
      else if (k === 'lastError') dbKey = 'last_error';
      else if (k === 'quotaResetsAt') dbKey = 'quota_resets_at';
      else if (k === 'lastUsedAt') dbKey = 'last_used_at';

      const snakeAllowed = ['name', 'access_token', 'refresh_token', 'project_id', 'is_active', 'last_error', 'quota_resets_at', 'last_used_at'];
      if (!snakeAllowed.includes(dbKey)) continue;

      pairs.push(`${dbKey} = ?`);
      vals.push(v);
    }

    if (!pairs.length) return false;
    pairs.push(`updated_at = CURRENT_TIMESTAMP`);
    vals.push(id);

    await db.run(`UPDATE antigravity_accounts SET ${pairs.join(', ')} WHERE id = ?`, vals);
    return true;
  },

  /** Delete by ID */
  async delete(id) {
    await db.run(
      `DELETE FROM antigravity_accounts WHERE id = ?`,
      [id]
    );
  },
};

module.exports = AntigravityAccount;
