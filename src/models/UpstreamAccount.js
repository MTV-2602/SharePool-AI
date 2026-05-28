// src/models/UpstreamAccount.js — Repository for upstream_accounts table
'use strict';

const db = require('../db');

const UpstreamAccount = {
  /** Find all accounts */
  async findAll() {
    return await db.query(
      `SELECT * FROM upstream_accounts ORDER BY id ASC`
    );
  },

  /** Find by session token */
  async findByToken(sessionToken) {
    return await db.get(
      `SELECT * FROM upstream_accounts WHERE session_token = ?`,
      [sessionToken]
    );
  },

  /** Find by name */
  async findByName(name) {
    return await db.get(
      `SELECT * FROM upstream_accounts WHERE name = ?`,
      [name]
    );
  },

  /** Insert or update by session token */
  async upsertByToken(name, sessionToken) {
    const existing = await UpstreamAccount.findByToken(sessionToken);
    if (existing) {
      // Update name if different
      if (existing.name !== name) {
        await db.run(
          `UPDATE upstream_accounts SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE session_token = ?`,
          [name, sessionToken]
        );
      }
      return await UpstreamAccount.findByToken(sessionToken);
    }
    const { lastInsertRowid } = await db.run(
      `INSERT INTO upstream_accounts (name, session_token, is_active, total_requests) VALUES (?, ?, 1, 0)`,
      [name, sessionToken]
    );
    return await UpstreamAccount.findById(lastInsertRowid);
  },

  /** Find by ID */
  async findById(id) {
    return await db.get(
      `SELECT * FROM upstream_accounts WHERE id = ?`,
      [id]
    );
  },

  /** Delete by session token */
  async deleteByToken(sessionToken) {
    return await db.run(
      `DELETE FROM upstream_accounts WHERE session_token = ?`,
      [sessionToken]
    );
  },

  /** Update name and/or session token */
  async update(oldToken, { name, newSessionToken }) {
    const pairs = [];
    const vals = [];
    if (name !== undefined) { pairs.push('name = ?'); vals.push(name); }
    if (newSessionToken !== undefined) { pairs.push('session_token = ?'); vals.push(newSessionToken); }
    if (!pairs.length) return false;
    vals.push(oldToken);
    await db.run(
      `UPDATE upstream_accounts SET ${pairs.join(', ')} WHERE session_token = ?`,
      vals
    );
    return true;
  },

  /** Increment request counter */
  async incrementRequests(sessionToken) {
    await db.run(
      `UPDATE upstream_accounts SET total_requests = total_requests + 1 WHERE session_token = ?`,
      [sessionToken]
    );
  },
};

module.exports = UpstreamAccount;
