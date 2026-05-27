'use strict';

const path = require('path');
const fs   = require('fs');
const config = require('../config');
const { ChatGPTClient } = require('./ChatGPTClient');
const logger            = require('../utils/logger').create('AccountPool');

const ACCOUNTS_FILE       = config.ACCOUNTS_FILE;
const COOLDOWN_RATE_LIMIT = 60 * 1000;        // 60 seconds
const COOLDOWN_INVALID    = 30 * 60 * 1000;   // 30 minutes

// ─── AccountPool ──────────────────────────────────────────────────────────────

class AccountPool {
  constructor() {
    /** @type {Array<{ name: string, sessionToken: string, client: ChatGPTClient }>} */
    this._accounts  = [];

    /** @type {Map<string, number>} token → cooldown_until (ms timestamp) */
    this._cooldowns = new Map();

    /** Round-robin index */
    this._index = 0;

    this._load();
  }

  // ── Loader ───────────────────────────────────────────────────────────────

  /**
   * Load / reload accounts from accounts.json.
   * Accepts an array of:
   *   - { name, sessionToken }   objects
   *   - plain strings (treated as session tokens)
   *
   * Existing ChatGPTClient instances are reused for known tokens to preserve
   * their cached access tokens.
   */
  _load() {
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

    // Build a lookup of existing clients keyed by sessionToken
    const existingClients = new Map(
      this._accounts.map(a => [a.sessionToken, a.client])
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

        // Reuse existing client if we already have one for this token
        const client = existingClients.get(sessionToken) || new ChatGPTClient(sessionToken);

        return { name, sessionToken, client };
      })
      .filter(Boolean);

    // Reset the round-robin index if it's now out of bounds
    if (this._index >= this._accounts.length) {
      this._index = 0;
    }

    logger.info(`Loaded ${this._accounts.length} account(s) from accounts.json`);
  }

  // ── Cooldown Helpers ─────────────────────────────────────────────────────

  /**
   * @param {string} token
   * @returns {boolean}
   */
  _isOnCooldown(token) {
    const until = this._cooldowns.get(token);
    if (!until) return false;
    if (Date.now() >= until) {
      this._cooldowns.delete(token);
      return false;
    }
    return true;
  }

  /**
   * @param {string} token
   * @returns {number} remaining ms, or 0
   */
  _cooldownRemaining(token) {
    const until = this._cooldowns.get(token);
    if (!until) return 0;
    const rem = until - Date.now();
    return rem > 0 ? rem : 0;
  }

  /**
   * Put an account into a rate-limit cooldown (60 seconds).
   * @param {string} token
   */
  markRateLimited(token) {
    const until = Date.now() + COOLDOWN_RATE_LIMIT;
    this._cooldowns.set(token, until);
    const account = this._accounts.find(a => a.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Rate limited — cooling down for 60s`);
  }

  /**
   * Put an account into an invalid-session cooldown (30 minutes).
   * @param {string} token
   */
  markInvalid(token) {
    const until = Date.now() + COOLDOWN_INVALID;
    this._cooldowns.set(token, until);
    const account = this._accounts.find(a => a.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Invalid session — cooling down for 30min`);
  }

  // ── Rotation ─────────────────────────────────────────────────────────────

  /**
   * Get the next available account using round-robin, skipping cooldowns.
   * If ALL accounts are on cooldown, waits until the soonest one is available.
   *
   * @returns {Promise<{ client: ChatGPTClient, token: string, name: string }>}
   */
  async getNext() {
    if (this._accounts.length === 0) {
      throw new Error('No upstream accounts configured. Add entries to accounts.json.');
    }

    const total = this._accounts.length;

    // Try each account once round-robin
    for (let i = 0; i < total; i++) {
      const idx     = (this._index + i) % total;
      const account = this._accounts[idx];

      if (!this._isOnCooldown(account.sessionToken)) {
        this._index = (idx + 1) % total;
        return {
          client: account.client,
          token:  account.sessionToken,
          name:   account.name,
        };
      }
    }

    // All on cooldown — find soonest expiry and wait
    let soonest = Infinity;
    for (const account of this._accounts) {
      const rem = this._cooldownRemaining(account.sessionToken);
      if (rem < soonest) soonest = rem;
    }

    logger.warn(`All accounts on cooldown. Waiting ${Math.ceil(soonest / 1000)}s…`);
    await new Promise(resolve => setTimeout(resolve, soonest + 100));

    return this.getNext();
  }

  // ── High-Level Chat ───────────────────────────────────────────────────────

  /**
   * Send a chat request, rotating through accounts on failure.
   *
   * @param {Array}  messages
   * @param {string} model
   * @param {number} [maxAttempts=0]  0 = try all accounts
   * @returns {Promise<import('node-fetch').Response>} Raw streaming response
   */
  async chatWithRotation(messages, model, maxAttempts = 0) {
    const limit   = maxAttempts > 0 ? maxAttempts : this._accounts.length;
    let   attempts = 0;
    const tried   = new Set();

    while (attempts < limit) {
      const { client, token, name } = await this.getNext();

      // Avoid retrying the same account more than once per call
      if (tried.has(token)) {
        attempts++;
        continue;
      }
      tried.add(token);
      attempts++;

      try {
        logger.debug(`[${name}] Attempting chat (attempt ${attempts}/${limit})`);
        const response = await client.chat(messages, model);
        logger.info(`[${name}] Chat request succeeded`);
        return response;
      } catch (err) {
        if (err.code === 'RATE_LIMITED') {
          this.markRateLimited(token);
          logger.warn(`[${name}] Rate limited — trying next account`);
          continue;
        }

        if (err.code === 'INVALID_SESSION') {
          this.markInvalid(token);
          logger.warn(`[${name}] Invalid session — trying next account`);
          continue;
        }

        // Unexpected error — rethrow
        throw err;
      }
    }

    const err     = new Error('All upstream accounts failed or are on cooldown');
    err.code      = 'ALL_ACCOUNTS_FAILED';
    err.statusCode = 503;
    throw err;
  }

  // ── Status ───────────────────────────────────────────────────────────────

  /**
   * Return current status of all accounts.
   *
   * @returns {Array<{ name, status, cooldownRemaining, hasToken }>}
   */
  getStatus() {
    return this._accounts.map(account => {
      const onCooldown = this._isOnCooldown(account.sessionToken);
      const remaining  = this._cooldownRemaining(account.sessionToken);

      return {
        name:              account.name,
        status:            onCooldown ? 'cooldown' : 'active',
        cooldownRemaining: remaining,
        hasToken:          Boolean(account.sessionToken),
        sessionToken:      account.sessionToken,
      };
    });
  }

  // ── Hot-Reload ───────────────────────────────────────────────────────────

  /**
   * Reload accounts from the accounts.json file without restarting.
   * @returns {{ count: number }}
   */
  reload() {
    logger.info('Reloading accounts from file…');
    this._load();
    return { count: this._accounts.length };
  }
}

// Singleton
const pool = new AccountPool();

module.exports = pool;
