'use strict';

const fetch = require('node-fetch');
const db = require('../db');
const logger = require('../utils/logger').create('AntigravityPool');

const COOLDOWN_RATE_LIMIT = 60 * 1000;          // 1 minute
const COOLDOWN_QUOTA_DEFAULT = 4 * 60 * 60 * 1000; // 4 hours
const COOLDOWN_INVALID = 30 * 60 * 1000;        // 30 minutes

class AntigravityPool {
  constructor() {
    this._accounts = [];
    this._cooldowns = new Map(); // email -> cooldown_until (ms timestamp)
    this._errors = new Map();    // email -> last error message
    this._inFlight = new Map();  // email -> count of active requests
    this._index = 0;
    this._quotaExhausted = new Map(); // email -> quota_resets_at (ms timestamp)

    // Load from DB asynchronously at startup
    this._loadAsync();

    // Start background refresh timer (every 30 minutes)
    this._startRefreshTimer();
  }

  /**
   * Load active Antigravity accounts from database
   */
  async _loadAsync() {
    try {
      const rows = await db.query(
        `SELECT id, name, email, access_token, refresh_token, project_id, quota_resets_at, last_used_at, updated_at
         FROM antigravity_accounts
         WHERE is_active = 1
         ORDER BY last_used_at ASC NULLS FIRST`
      );

      const now = Date.now();
      this._accounts = rows.map((row, i) => {
        const email = row.email;
        const name = row.name || `Antigravity-${i + 1}`;
        const quotaResetsAt = row.quotaResetsAt || row.quota_resets_at;

        if (quotaResetsAt) {
          const resetTs = new Date(quotaResetsAt).getTime();
          if (resetTs > now) {
            this._cooldowns.set(email, resetTs);
            this._quotaExhausted.set(email, resetTs);
            const minsLeft = Math.ceil((resetTs - now) / 60000);
            logger.debug(`[${name}] Quota cooldown restored — hồi sau ${minsLeft} phút`);
          }
        }

        return {
          id: row.id,
          name,
          email,
          accessToken: row.accessToken || row.access_token,
          refreshToken: row.refreshToken || row.refresh_token,
          projectId: row.projectId || row.project_id,
          updatedAt: row.updatedAt || row.updated_at
        };
      });

      if (this._index >= this._accounts.length) {
        this._index = 0;
      }

      const available = this._accounts.filter(a => !this._isOnCooldown(a.email)).length;
      logger.info(`Loaded ${this._accounts.length} Antigravity account(s) (${available} sẵn sàng, ${this._accounts.length - available} đang cooldown)`);
    } catch (err) {
      logger.error('Failed to load Antigravity accounts from database:', err.message);
    }
  }

  _isOnCooldown(email) {
    const until = this._cooldowns.get(email);
    if (!until) return false;
    if (Date.now() >= until) {
      this._cooldowns.delete(email);
      this._quotaExhausted.delete(email);
      return false;
    }
    return true;
  }

  _cooldownRemaining(email) {
    const until = this._cooldowns.get(email);
    if (!until) return 0;
    const rem = until - Date.now();
    return rem > 0 ? rem : 0;
  }

  /**
   * Refreshes access token for a single account
   */
  async refreshAccessToken(account) {
    if (!account.refreshToken) {
      throw new Error(`Account ${account.email} has no refresh token`);
    }
    const clientId = process.env.ANTIGRAVITY_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
    const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET || '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';

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: account.refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Google OAuth refresh failed: ${errText}`);
      }

      const data = await res.json();
      const accessToken = data.access_token;
      const newRefreshToken = data.refresh_token || account.refreshToken;

      await db.run(
        `UPDATE antigravity_accounts
         SET access_token = ?, refresh_token = ?, updated_at = CURRENT_TIMESTAMP, last_error = NULL
         WHERE id = ?`,
        [accessToken, newRefreshToken, account.id]
      );

      account.accessToken = accessToken;
      account.refreshToken = newRefreshToken;
      account.updatedAt = new Date().toISOString();

      logger.info(`Successfully refreshed access token for Antigravity account: ${account.email}`);
      return accessToken;
    } catch (err) {
      logger.error(`Failed to refresh token for account ${account.email}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Refreshes all active tokens in background
   */
  async refreshAllTokens() {
    logger.debug('Running background refresh for all active Antigravity tokens...');
    for (const account of this._accounts) {
      try {
        await this.refreshAccessToken(account);
      } catch (err) {
        // Skip individual errors, continue others
      }
    }
  }

  _startRefreshTimer() {
    // Refresh all tokens every 35 minutes (tokens expire in 60 minutes)
    setInterval(() => {
      this.refreshAllTokens().catch(err => {
        logger.error('Background refreshAllTokens failed:', err.message);
      });
    }, 35 * 60 * 1000);
  }

  markRateLimited(email, retryAfterMs = COOLDOWN_RATE_LIMIT) {
    const until = Date.now() + Math.min(retryAfterMs, 120_000); // Max 2 minutes
    this._cooldowns.set(email, until);
    logger.warn(`[${email}] Antigravity account rate limited — cooldown ${Math.ceil((until - Date.now()) / 1000)}s`);
  }

  markQuotaExhausted(email, retryAfterMs = COOLDOWN_QUOTA_DEFAULT) {
    const until = Date.now() + retryAfterMs;
    this._quotaExhausted.set(email, until);
    this._cooldowns.set(email, until);

    logger.warn(`[${email}] Antigravity account quota exhausted — cooldown ${Math.ceil(retryAfterMs / 3600000)}h`);

    const resetIso = new Date(until).toISOString();
    db.run(
      `UPDATE antigravity_accounts SET quota_resets_at = ?, last_error = 'quota_exhausted', updated_at = CURRENT_TIMESTAMP WHERE email = ?`,
      [resetIso, email]
    ).catch(err => logger.error('Failed to persist quota_resets_at for Antigravity account: ' + err.message));
  }

  markInvalid(email, reason = 'Session token is invalid or expired') {
    const until = Date.now() + COOLDOWN_INVALID;
    this._cooldowns.set(email, until);
    this._errors.set(email, reason);

    logger.warn(`[${email}] Antigravity account token invalid (${reason}) — disabling`);

    db.run('UPDATE antigravity_accounts SET is_active = 0, last_error = ? WHERE email = ?', [reason, email]).catch(err => {
      logger.error('Failed to disable Antigravity account in DB: ' + err.message);
    });
  }

  /**
   * Get next available account
   */
  async getNext() {
    if (this._accounts.length === 0) {
      await this._loadAsync();
    }

    if (this._accounts.length === 0) {
      throw new Error('No active Antigravity accounts configured. Please link a Google account first.');
    }

    const total = this._accounts.length;
    const available = [];

    for (let i = 0; i < total; i++) {
      const idx = (this._index + i) % total;
      const account = this._accounts[idx];

      if (this._isOnCooldown(account.email)) {
        continue;
      }

      available.push({ account, idx });
    }

    if (available.length > 0) {
      // Prioritize account with least in-flight requests
      available.sort((a, b) => {
        const fa = this._inFlight.get(a.account.email) || 0;
        const fb = this._inFlight.get(b.account.email) || 0;
        return fa - fb;
      });

      const { account, idx } = available[0];
      this._index = (idx + 1) % total;

      // Update last_used_at in background
      db.run(
        `UPDATE antigravity_accounts SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [account.id]
      ).catch(() => {});

      // Proactively check if token is older than 50 minutes, refresh it before request
      const ageMs = Date.now() - new Date(account.updatedAt).getTime();
      if (ageMs > 50 * 60 * 1000) {
        logger.debug(`[${account.email}] Access token is old (${Math.round(ageMs / 60000)}m), proactive refreshing...`);
        try {
          await this.refreshAccessToken(account);
        } catch (e) {
          logger.warn(`Proactive refresh failed for ${account.email}, trying with current token.`);
        }
      }

      return account;
    }

    // No accounts ready - find the one resetting soonest
    let soonest = Infinity;
    let soonestEmail = '';
    for (const account of this._accounts) {
      const rem = this._cooldownRemaining(account.email);
      if (rem < soonest) {
        soonest = rem;
        soonestEmail = account.email;
      }
    }

    if (soonest > 10_000) {
      const waitMins = Math.ceil(soonest / 60000);
      const err = new Error(`Tất cả tài khoản Antigravity đang bận hoặc hết quota. Thử lại sau ${waitMins} phút.`);
      err.code = 'ALL_ACCOUNTS_COOLDOWN';
      err.statusCode = 503;
      err.retryAfter = Math.ceil(soonest / 1000);
      throw err;
    }

    // Short wait for rate limit
    logger.warn(`[AntigravityPool] All accounts rate-limited. Waiting ${Math.ceil(soonest / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, soonest + 100));
    return this.getNext();
  }

  /**
   * Proxies a raw Gemini/Antigravity request (e.g. from VS Code extension) with pool rotation
   */
  async proxyRequestWithRotation(action, reqBody, stream, triedEmails = new Set()) {
    let account;
    try {
      account = await this.getNext();
    } catch (err) {
      throw err;
    }

    if (triedEmails.has(account.email)) {
      throw new Error('All available Antigravity accounts returned errors for this request');
    }
    triedEmails.add(account.email);

    // Increment in-flight count
    this._inFlight.set(account.email, (this._inFlight.get(account.email) || 0) + 1);

    try {
      const envelope = { ...reqBody };
      if (envelope.project) {
        envelope.project = account.projectId;
      }
      if (envelope.request) {
        envelope.request = { ...envelope.request };
        const crypto = require('crypto');
        const deriveSessionId = (key) => {
          if (!key) return crypto.randomUUID();
          const hash = crypto.createHash("sha256").update(key).digest("hex");
          return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
        };
        envelope.request.sessionId = deriveSessionId(account.email);
      }

      const baseUrls = [
        'https://daily-cloudcode-pa.googleapis.com',
        'https://cloudcode-pa.googleapis.com'
      ];

      let lastError = null;
      let response = null;

      for (const baseUrl of baseUrls) {
        const url = `${baseUrl}/v1internal:${action}`;
        try {
          logger.debug(`[${account.email}] Forwarding proxy request to ${url}`);
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${account.accessToken}`,
              'User-Agent': 'antigravity/1.107.0',
              'x-request-source': 'local',
              'X-Machine-Session-Id': envelope.request?.sessionId || '',
              'Accept': stream ? 'text/event-stream' : 'application/json'
            },
            body: JSON.stringify(envelope),
            timeout: 60000
          });

          if (response.ok) {
            break;
          }

          const status = response.status;
          const bodyText = await response.text();
          logger.warn(`[${account.email}] Proxy URL failed with status ${status}: ${bodyText}`);
          lastError = { status, bodyText };
        } catch (e) {
          logger.warn(`[${account.email}] Failed connecting to ${baseUrl}: ${e.message}`);
          lastError = e;
        }
      }

      if (!response || !response.ok) {
        const status = lastError?.status || 502;
        const errText = lastError?.bodyText || lastError?.message || 'Upstream connection failed';

        if (status === 401) {
          logger.warn(`[${account.email}] Token expired (401). Retrying with token refresh.`);
          try {
            await this.refreshAccessToken(account);
            this._inFlight.set(account.email, Math.max(0, (this._inFlight.get(account.email) || 1) - 1));
            triedEmails.delete(account.email);
            return await this.proxyRequestWithRotation(action, reqBody, stream, triedEmails);
          } catch (refreshErr) {
            this.markInvalid(account.email, `Token refresh failed: ${refreshErr.message}`);
          }
        } else if (status === 429) {
          if (errText.includes('quota') || errText.toLowerCase().includes('exhausted') || errText.includes('limit')) {
            this.markQuotaExhausted(account.email, COOLDOWN_QUOTA_DEFAULT);
          } else {
            this.markRateLimited(account.email, COOLDOWN_RATE_LIMIT);
          }
        } else if (status === 403 || status === 400) {
          if (errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('limit')) {
            this.markQuotaExhausted(account.email, COOLDOWN_QUOTA_DEFAULT);
          } else {
            this.markInvalid(account.email, `Received ${status} error: ${errText}`);
          }
        } else {
          logger.error(`[${account.email}] Server error ${status}: ${errText}`);
        }

        this._inFlight.set(account.email, Math.max(0, (this._inFlight.get(account.email) || 1) - 1));
        return await this.proxyRequestWithRotation(action, reqBody, stream, triedEmails);
      }

      logger.info(`[${account.email}] Proxy request completed successfully`);
      return { response, account };
    } catch (e) {
      logger.error(`[${account.email}] Proxy request failed: ${e.message}`);
      throw e;
    } finally {
      const cur = this._inFlight.get(account.email) || 1;
      if (cur <= 1) this._inFlight.delete(account.email);
      else this._inFlight.set(account.email, cur - 1);
    }
  }

  /**
   * Executes a chat generation request with pool rotation
   */
  async chatWithRotation(model, body, stream, triedEmails = new Set()) {
    let account;
    try {
      account = await this.getNext();
    } catch (err) {
      throw err;
    }

    if (triedEmails.has(account.email)) {
      throw new Error('All available Antigravity accounts returned errors for this request');
    }
    triedEmails.add(account.email);

    // Increment in-flight count
    this._inFlight.set(account.email, (this._inFlight.get(account.email) || 0) + 1);

    try {
      const Translator = require('./AntigravityTranslator');
      const { envelope, toolNameMap } = Translator.openaiToAntigravityRequest(model, body, stream, account);

      const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      // Fallback base URLs matching 9router
      const baseUrls = [
        'https://daily-cloudcode-pa.googleapis.com',
        'https://cloudcode-pa.googleapis.com'
      ];

      let lastError = null;
      let response = null;

      for (const baseUrl of baseUrls) {
        const url = `${baseUrl}/v1internal:${action}`;
        try {
          logger.debug(`[${account.email}] Forwarding request to ${url}`);
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${account.accessToken}`,
              'User-Agent': 'antigravity/1.107.0',
              'x-request-source': 'local',
              'X-Machine-Session-Id': envelope.request.sessionId,
              'Accept': stream ? 'text/event-stream' : 'application/json'
            },
            body: JSON.stringify(envelope),
            timeout: 60000
          });

          if (response.ok) {
            break;
          }

          // Read response body for details
          const status = response.status;
          const bodyText = await response.text();
          logger.warn(`[${account.email}] Staging URL failed with status ${status}: ${bodyText}`);
          lastError = { status, bodyText };
        } catch (e) {
          logger.warn(`[${account.email}] Failed connecting to ${baseUrl}: ${e.message}`);
          lastError = e;
        }
      }

      if (!response || !response.ok) {
        const status = lastError?.status || 502;
        const errText = lastError?.bodyText || lastError?.message || 'Upstream connection failed';

        // Check for specific error status codes
        if (status === 401) {
          logger.warn(`[${account.email}] Token expired (401). Retrying with token refresh.`);
          try {
            await this.refreshAccessToken(account);
            // Decrement in-flight before recursion
            this._inFlight.set(account.email, Math.max(0, (this._inFlight.get(account.email) || 1) - 1));
            triedEmails.delete(account.email); // Allow retry with same account after refresh
            return await this.chatWithRotation(model, body, stream, triedEmails);
          } catch (refreshErr) {
            this.markInvalid(account.email, `Token refresh failed: ${refreshErr.message}`);
          }
        } else if (status === 429) {
          // Parse quota resets from error message if available
          let waitMs = COOLDOWN_RATE_LIMIT;
          if (errText.includes('quota') || errText.toLowerCase().includes('exhausted') || errText.includes('limit')) {
            this.markQuotaExhausted(account.email, COOLDOWN_QUOTA_DEFAULT);
          } else {
            this.markRateLimited(account.email, waitMs);
          }
        } else if (status === 403 || status === 400) {
          if (errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('limit')) {
            this.markQuotaExhausted(account.email, COOLDOWN_QUOTA_DEFAULT);
          } else {
            this.markInvalid(account.email, `Received ${status} error: ${errText}`);
          }
        } else {
          logger.error(`[${account.email}] Server error ${status}: ${errText}`);
        }

        // Retry with another account
        this._inFlight.set(account.email, Math.max(0, (this._inFlight.get(account.email) || 1) - 1));
        return await this.chatWithRotation(model, body, stream, triedEmails);
      }

      // Successful request
      logger.info(`[${account.email}] Request completed successfully`);
      return { response, toolNameMap };
    } catch (e) {
      logger.error(`[${account.email}] Request failed: ${e.message}`);
      throw e;
    } finally {
      // Decrement in-flight count
      const cur = this._inFlight.get(account.email) || 1;
      if (cur <= 1) this._inFlight.delete(account.email);
      else this._inFlight.set(account.email, cur - 1);
    }
  }
}

// Singleton pool instance
module.exports = new AntigravityPool();
