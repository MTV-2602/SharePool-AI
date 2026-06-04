'use strict';

const config = require('../config');
const { ChatGPTClient } = require('./ChatGPTClient');
const logger            = require('../utils/logger').create('AccountPool');

const COOLDOWN_RATE_LIMIT = 60 * 1000;        // 60 seconds
const COOLDOWN_INVALID    = 30 * 60 * 1000;   // 30 minutes

// ─── AccountPool ──────────────────────────────────────────────────────────────

class AccountPool {
  constructor() {
    /** @type {Array<{ name: string, sessionToken: string, client: ChatGPTClient }> } */
    this._accounts  = [];

    /** @type {Map<string, number>} token → cooldown_until (ms timestamp) */
    this._cooldowns = new Map();

    /** @type {Set<string>} set of invalid/expired session tokens */
    this._invalidTokens = new Set();

    /** @type {Map<string, string>} token → last error message */
    this._errors = new Map();

    /** Round-robin index */
    this._index = 0;

    // Load from DB async (non-blocking at startup; reload() can be awaited later)
    this._loadAsync();
  }

  // ── Loader ───────────────────────────────────────────────────────────────

  /**
   * Async: Load accounts from the database.
   * Falls back to accounts.json if DB is unavailable.
   */
  async _loadAsync() {
    try {
      const db = require('../db');
      const rows = await db.query(
        `SELECT id, name, session_token FROM upstream_accounts WHERE is_active = 1 ORDER BY id ASC`
      );

      // Build a lookup of existing clients keyed by their current sessionToken
      const existingClients = new Map(
        this._accounts.map(a => [a.client.sessionToken, a.client])
      );

      this._accounts = rows.map((row, i) => {
        const sessionToken = row.sessionToken || row.session_token;
        const name         = row.name || `Account-${i + 1}`;
        const id           = row.id;

        if (!sessionToken) return null;
        let client = existingClients.get(sessionToken);
        if (!client) {
          client = new ChatGPTClient(sessionToken);
        }
        client.id = id;
        client.name = name;
        return { id, name, client };
      }).filter(Boolean);

      if (this._index >= this._accounts.length) {
        this._index = 0;
      }

      logger.info(`Loaded ${this._accounts.length} account(s) from database`);
    } catch (err) {
      logger.error('Failed to load from DB, falling back to file:', err.message);
      this._loadFromFile();
    }
  }

  /**
   * Fallback: Load from accounts.json file
   */
  _loadFromFile() {
    const fs   = require('fs');
    const ACCOUNTS_FILE = config.ACCOUNTS_FILE;

    if (!fs.existsSync(ACCOUNTS_FILE)) {
      logger.warn(`accounts.json not found at ${ACCOUNTS_FILE}. Pool is empty.`);
      this._accounts = [];
      return;
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    } catch (err) {
      logger.error('Failed to parse accounts.json', err);
      return;
    }

    if (!Array.isArray(raw)) {
      logger.error('accounts.json must be a JSON array');
      return;
    }

    const existingClients = new Map(
      this._accounts.map(a => [a.client.sessionToken, a.client])
    );

    this._accounts = raw
      .map((entry, i) => {
        const sessionToken = typeof entry === 'string' ? entry : entry?.sessionToken;
        const name         = typeof entry === 'object' && entry?.name
                               ? entry.name
                               : `Account-${i + 1}`;

        if (!sessionToken || typeof sessionToken !== 'string') {
          logger.warn(`Entry at index ${i} is missing a valid sessionToken — skipped`);
          return null;
        }

        let client = existingClients.get(sessionToken);
        if (!client) {
          client = new ChatGPTClient(sessionToken);
        }
        client.id = null;
        client.name = name;
        return { id: null, name, client };
      })
      .filter(Boolean);

    if (this._index >= this._accounts.length) {
      this._index = 0;
    }

    logger.info(`Loaded ${this._accounts.length} account(s) from accounts.json (fallback)`);
  }

  // ── Cooldown Helpers ─────────────────────────────────────────────────────

  _isOnCooldown(token) {
    const until = this._cooldowns.get(token);
    if (!until) return false;
    if (Date.now() >= until) {
      this._cooldowns.delete(token);
      return false;
    }
    return true;
  }

  _cooldownRemaining(token) {
    const until = this._cooldowns.get(token);
    if (!until) return 0;
    const rem = until - Date.now();
    return rem > 0 ? rem : 0;
  }

  async getAccountQuota(sessionToken) {
    if (!this._quotaCache) this._quotaCache = new Map();
    const cached = this._quotaCache.get(sessionToken);
    const now = Date.now();
    if (cached && (now - cached.updatedAt < 5 * 60 * 1000)) {
      return cached;
    }

    let plan = 'free';
    let remainingPercent = 100;
    let primaryRemaining = 100;
    let secondaryRemaining = 100;

    try {
      const { ChatGPTClient } = require('./ChatGPTClient');
      const client = new ChatGPTClient(sessionToken);
      const accessToken = await client.getAccessToken();
      const fetch = require('node-fetch');
      const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        timeout: 4000
      });

      if (res.ok) {
        const data = await res.json();
        plan = data.plan_type || data.summary?.plan || 'free';
        
        const byLimitId = data.rate_limits_by_limit_id || data.rate_limits || {};
        const codexLimit = byLimitId.codex || byLimitId.code_review || Object.values(byLimitId)[0] || {};
        
        const primary = codexLimit.primary_window || codexLimit.primary || data.rate_limit?.primary_window || data.rate_limit?.primary;
        const secondary = codexLimit.secondary_window || codexLimit.secondary || data.rate_limit?.secondary_window || data.rate_limit?.secondary;
        
        if (primary) {
          const used = primary.used_percent ?? primary.percent_used ?? 0;
          primaryRemaining = Math.max(0, 100 - Math.ceil(used));
        }
        if (secondary) {
          const used = secondary.used_percent ?? secondary.percent_used ?? 0;
          secondaryRemaining = Math.max(0, 100 - Math.ceil(used));
        }
        
        remainingPercent = primaryRemaining;
      } else if (cached) {
        return cached;
      }
    } catch (err) {
      logger.error('Failed to fetch account quota: ' + err.message);
      if (cached) return cached;
    }

    const quotaInfo = { plan, remainingPercent, primaryRemaining, secondaryRemaining, updatedAt: now };
    this._quotaCache.set(sessionToken, quotaInfo);
    if (!this._plans) this._plans = new Map();
    this._plans.set(sessionToken, plan);

    return quotaInfo;
  }

  async getPlan(sessionToken) {
    const quota = await this.getAccountQuota(sessionToken);
    return quota.plan;
  }

  markRateLimited(token) {
    const until = Date.now() + COOLDOWN_RATE_LIMIT;
    this._cooldowns.set(token, until);
    const account = this._accounts.find(a => a.client.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Rate limited — cooling down for 60s`);
  }

  markInvalid(token, reason = 'Session token is invalid or expired') {
    const until = Date.now() + COOLDOWN_INVALID;
    this._cooldowns.set(token, until);
    this._invalidTokens.add(token);
    this._errors.set(token, reason);
    const account = this._accounts.find(a => a.client.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Invalid session (${reason}) — cooling down for 30min`);

    // Set is_active = 0 in database so it is persistent and triggers re-login
    const db = require('../db');
    if (account && account.id) {
      db.run('UPDATE upstream_accounts SET is_active = 0, last_error = ? WHERE id = ?', [reason, account.id]).catch(err => {
        logger.error('Failed to set is_active = 0 and last_error in database for invalid token ID: ' + err.message);
      });
    } else {
      db.run('UPDATE upstream_accounts SET is_active = 0, last_error = ? WHERE session_token = ?', [reason, token]).catch(err => {
        logger.error('Failed to set is_active = 0 and last_error in database for invalid token: ' + err.message);
      });
    }
  }

  // ── Rotation ─────────────────────────────────────────────────────────────

  async getNext() {
    // If pool is empty on first call, wait for async load
    if (this._accounts.length === 0) {
      await this._loadAsync();
    }

    if (this._accounts.length === 0) {
      throw new Error('No upstream accounts configured. Please add accounts via admin panel or extension.');
    }

    const total = this._accounts.length;

    for (let i = 0; i < total; i++) {
      const idx     = (this._index + i) % total;
      const account = this._accounts[idx];

      if (!this._isOnCooldown(account.client.sessionToken)) {
        this._index = (idx + 1) % total;
        return {
          client: account.client,
          token:  account.client.sessionToken,
          name:   account.name,
        };
      }
    }

    let soonest = Infinity;
    for (const account of this._accounts) {
      const rem = this._cooldownRemaining(account.client.sessionToken);
      if (rem < soonest) soonest = rem;
    }

    logger.warn(`All accounts on cooldown. Waiting ${Math.ceil(soonest / 1000)}s…`);
    await new Promise(resolve => setTimeout(resolve, soonest + 100));

    return this.getNext();
  }

  // ── High-Level Chat ───────────────────────────────────────────────────────

  async chatWithRotation(messages, model, options = {}, maxAttempts = 0) {
    const limit   = maxAttempts > 0 ? maxAttempts : Math.max(this._accounts.length, 1);
    let   attempts = 0;
    const tried   = new Set();

    while (attempts < limit) {
      const { client, token, name } = await this.getNext();

      if (tried.has(token)) {
        attempts++;
        continue;
      }
      tried.add(token);
      attempts++;

      try {
        logger.debug(`[${name}] Attempting chat (attempt ${attempts}/${limit})`);
        const response = await client.chat(messages, model, options);
        logger.info(`[${name}] Chat request succeeded`);
        return response;
      } catch (err) {
        if (err.code === 'RATE_LIMITED') {
          this.markRateLimited(token);
          logger.warn(`[${name}] Rate limited — trying next account`);
          continue;
        }

        if (err.code === 'INVALID_SESSION') {
          this.markInvalid(token, err.message);
          logger.warn(`[${name}] Invalid session — trying next account`);
          continue;
        }

        throw err;
      }
    }

    const err     = new Error('All upstream accounts failed or are on cooldown');
    err.code      = 'ALL_ACCOUNTS_FAILED';
    err.statusCode = 503;
    throw err;
  }

  // ── Status ───────────────────────────────────────────────────────────────

  getStatus() {
    return this._accounts.map(account => {
      const isInvalid  = this._invalidTokens.has(account.client.sessionToken);
      const onCooldown = this._isOnCooldown(account.client.sessionToken);
      const remaining  = this._cooldownRemaining(account.client.sessionToken);
      const lastError  = this._errors.get(account.client.sessionToken) || '';

      let status = 'active';
      if (isInvalid) {
        status = 'failed';
      } else if (onCooldown) {
        status = 'cooldown';
      }

      return {
        id:                account.id,
        name:              account.name,
        status,
        cooldownRemaining: remaining,
        hasToken:          Boolean(account.client.sessionToken),
        sessionToken:      account.client.sessionToken,
        lastError,
      };
    });
  }

  // ── Hot-Reload ───────────────────────────────────────────────────────────

  async reload() {
    logger.info('Reloading accounts from database and resetting cooldowns…');
    this._cooldowns.clear();
    this._invalidTokens.clear();
    this._errors.clear();
    if (this._plans) this._plans.clear();
    await this._loadAsync();
    return { count: this._accounts.length };
  }
}

// Singleton
const pool = new AccountPool();

module.exports = pool;
