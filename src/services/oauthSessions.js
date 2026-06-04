'use strict';

const db = require('../db');

/**
 * Database-backed store for pending OAuth PKCE sessions.
 * Persists PKCE state across stateless serverless functions (Vercel).
 */
const pendingOAuthSessions = {
  async get(state) {
    if (!state) return null;
    try {
      const row = await db.get('SELECT * FROM pending_oauth_sessions WHERE state = ?', [state]);
      if (!row) return null;
      return {
        codeVerifier: row.codeVerifier || row.code_verifier,
        redirectUri: row.redirectUri || row.redirect_uri,
        status: row.status,
        email: row.email,
        error: row.error,
        createdAt: Number(row.createdAt || row.created_at || 0)
      };
    } catch (err) {
      console.error('Failed to get pending OAuth session from DB:', err.message);
      return null;
    }
  },

  async set(state, session) {
    if (!state || !session) return;
    try {
      const existing = await this.get(state);
      if (existing) {
        await db.run(
          'UPDATE pending_oauth_sessions SET code_verifier = ?, redirect_uri = ?, status = ?, email = ?, error = ?, created_at = ? WHERE state = ?',
          [session.codeVerifier, session.redirectUri, session.status, session.email || '', session.error || '', session.createdAt || Date.now(), state]
        );
      } else {
        await db.run(
          'INSERT INTO pending_oauth_sessions (state, code_verifier, redirect_uri, status, email, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [state, session.codeVerifier, session.redirectUri, session.status, session.email || '', session.error || '', session.createdAt || Date.now()]
        );
      }
    } catch (err) {
      console.error('Failed to save pending OAuth session to DB:', err.message);
    }
  },

  async delete(state) {
    if (!state) return;
    try {
      await db.run('DELETE FROM pending_oauth_sessions WHERE state = ?', [state]);
    } catch (err) {
      console.error('Failed to delete pending OAuth session from DB:', err.message);
    }
  }
};

async function cleanupOldSessions() {
  const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
  try {
    await db.run('DELETE FROM pending_oauth_sessions WHERE created_at < ?', [fifteenMinsAgo]);
  } catch (err) {
    console.error('Failed to clean up old OAuth sessions in DB:', err.message);
  }
}

module.exports = { pendingOAuthSessions, cleanupOldSessions };
