'use strict';

/**
 * Shared in-memory store for pending OAuth PKCE sessions.
 * Used by both admin routes (callback handler) and api routes (extension init).
 * Keyed by `state` string → session object.
 */
const pendingOAuthSessions = new Map();

/**
 * Clean up sessions older than 15 minutes.
 */
function cleanupOldSessions() {
  const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
  for (const [key, val] of pendingOAuthSessions.entries()) {
    if (val.createdAt < fifteenMinsAgo) pendingOAuthSessions.delete(key);
  }
}

module.exports = { pendingOAuthSessions, cleanupOldSessions };
