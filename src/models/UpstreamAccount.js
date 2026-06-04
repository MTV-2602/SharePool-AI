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

  /** Insert or update by session token or name */
  async upsertByToken(name, sessionToken) {
    // 1. Try to find by name first to prevent duplicate accounts for the same email/username
    const existingByName = await UpstreamAccount.findByName(name);
    if (existingByName) {
      // Check if existing token is a Codex OAuth token (has refreshToken)
      let existingIsOAuth = false;
      try {
        const parsed = JSON.parse(existingByName.session_token);
        if (parsed.accessToken && parsed.refreshToken) {
          existingIsOAuth = true;
        }
      } catch (_) {}

      // Check if new token is Codex OAuth (has refreshToken)
      let newIsOAuth = false;
      try {
        const parsed = JSON.parse(sessionToken);
        if (parsed.accessToken && parsed.refreshToken) {
          newIsOAuth = true;
        }
      } catch (_) {}

      // If existing is OAuth but new is just a session cookie, do NOT overwrite the OAuth tokens
      if (existingIsOAuth && !newIsOAuth) {
        await db.run(
          `UPDATE upstream_accounts SET is_active = 1, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [existingByName.id]
        );
        return await UpstreamAccount.findById(existingByName.id);
      }

      await db.run(
        `UPDATE upstream_accounts SET session_token = ?, is_active = 1, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [sessionToken, existingByName.id]
      );
      return await UpstreamAccount.findById(existingByName.id);
    }

    // 2. Try to find by token (fallback)
    const existingByToken = await UpstreamAccount.findByToken(sessionToken);
    if (existingByToken) {
      if (existingByToken.name !== name) {
        await db.run(
          `UPDATE upstream_accounts SET name = ?, is_active = 1, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [name, existingByToken.id]
        );
      }
      return await UpstreamAccount.findById(existingByToken.id);
    }

    // 3. Otherwise, insert new row
    const { lastInsertRowid } = await db.run(
      `INSERT INTO upstream_accounts (name, session_token, is_active, last_error, total_requests) VALUES (?, ?, 1, NULL, 0)`,
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
    if (newSessionToken !== undefined) { 
      pairs.push('session_token = ?'); vals.push(newSessionToken); 
      pairs.push('is_active = 1');
      pairs.push('last_error = NULL');
    }
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
