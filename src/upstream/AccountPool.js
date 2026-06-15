'use strict';

const config = require('../config');
const { ChatGPTClient } = require('./ChatGPTClient');
const logger            = require('../utils/logger').create('AccountPool');

const COOLDOWN_RATE_LIMIT  = 60 * 1000;         // 60 giây — rate limit tạm thời
const COOLDOWN_QUOTA_DEFAULT = 5 * 60 * 60 * 1000; // 5 tiếng default — hết quota window
const COOLDOWN_INVALID     = 30 * 60 * 1000;    // 30 phút — token hết hạn/sai

// Helper to normalize unix timestamps (seconds vs milliseconds) to timestamp number in ms
function parseResetTime(resetValue) {
  if (!resetValue) return null;
  try {
    if (typeof resetValue === 'number') {
      return resetValue < 1e12 ? resetValue * 1000 : resetValue;
    }
    if (typeof resetValue === 'string') {
      if (/^\d+$/.test(resetValue)) {
        const timestamp = Number(resetValue);
        return timestamp < 1e12 ? timestamp * 1000 : timestamp;
      }
      return new Date(resetValue).getTime();
    }
    return null;
  } catch (error) {
    return null;
  }
}

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

    /** @type {Map<string, number>} token → quota_resets_at (ms timestamp) - hết quota */
    this._quotaExhausted = new Map();

    /** @type {Map<string, number>} token → số request đang xử lý (in-flight) */
    this._inFlight = new Map();

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
        // Load last_used_at, quota_resets_at, last_error để restore state sau restart
        `SELECT id, name, session_token, quota_resets_at, last_used_at, last_error
         FROM upstream_accounts
         WHERE is_active = 1
         ORDER BY last_used_at ASC NULLS FIRST` // tiếp tục round-robin từ nơi đã dừng
      );

      // Build a lookup of existing clients keyed by their current sessionToken
      const existingClients = new Map(
        this._accounts.map(a => [a.client.sessionToken, a.client])
      );

      const now = Date.now();

      this._accounts = rows.map((row, i) => {
        const sessionToken  = row.sessionToken || row.session_token;
        const name          = row.name || `Account-${i + 1}`;
        const id            = row.id;
        const quotaResetsAt = row.quotaResetsAt || row.quota_resets_at;
        const lastError     = row.lastError || row.last_error;

        if (!sessionToken) return null;
        let client = existingClients.get(sessionToken);
        if (!client) {
          client = new ChatGPTClient(sessionToken);
        }
        client.id = id;
        client.name = name;

        // Restore quota cooldown từ DB sau khi restart
        if (quotaResetsAt) {
          const resetTs = new Date(quotaResetsAt).getTime();
          if (resetTs > now) {
            this._cooldowns.set(sessionToken, resetTs);
            this._quotaExhausted.set(sessionToken, resetTs);
            const minsLeft = Math.ceil((resetTs - now) / 60000);
            logger.debug(`[${name}] Quota cooldown restored — hồi sau ${minsLeft} phút`);
          }
        }

        // Restore trạng thái invalid từ DB sau khi restart/reload (ngoại trừ quota_exhausted)
        if (lastError && lastError !== 'quota_exhausted') {
          this._invalidTokens.add(sessionToken);
          this._cooldowns.set(sessionToken, now + COOLDOWN_INVALID);
          this._errors.set(sessionToken, lastError);
          logger.debug(`[${name}] Invalid session restored from DB: ${lastError}`);
        }

        return { id, name, client };
      }).filter(Boolean);

      if (this._index >= this._accounts.length) {
        this._index = 0;
      }

      const available = this._accounts.filter(a => !this._isOnCooldown(a.client.sessionToken)).length;
      logger.info(`Loaded ${this._accounts.length} account(s) from database (${available} sẵn sàng, ${this._accounts.length - available} đang cooldown)`);
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
    let primaryResetAt = null;
    let secondaryResetAt = null;

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
          primaryResetAt = parseResetTime(primary.reset_at || primary.resets_at);
        }
        if (secondary) {
          const used = secondary.used_percent ?? secondary.percent_used ?? 0;
          secondaryRemaining = Math.max(0, 100 - Math.ceil(used));
          secondaryResetAt = parseResetTime(secondary.reset_at || secondary.resets_at);
        }
        
        remainingPercent = Math.min(primaryRemaining, secondaryRemaining);

        if (remainingPercent > 0) {
          this._cooldowns.delete(sessionToken);
          this._quotaExhausted.delete(sessionToken);
          const db = require('../db');
          db.run(
            `UPDATE upstream_accounts SET quota_resets_at = NULL, last_error = NULL WHERE session_token = ?`,
            [sessionToken]
          ).catch(() => {});
        }
      } else {
        if (res.status === 401 || res.status === 403) {
          const err = new Error(`OpenAI Wham API returned HTTP ${res.status} (Session expired)`);
          err.code = 'INVALID_SESSION';
          throw err;
        }
        if (cached) return cached;
      }
    } catch (err) {
      logger.error('Failed to fetch account quota: ' + err.message);
      if (err.code === 'INVALID_SESSION') {
        this.markInvalid(sessionToken, err.message);
      }
      if (cached) return cached;
    }

    const resetAt = secondaryResetAt || primaryResetAt || null;
    const quotaInfo = { plan, remainingPercent, primaryRemaining, secondaryRemaining, resetAt, updatedAt: now };
    this._quotaCache.set(sessionToken, quotaInfo);
    if (!this._plans) this._plans = new Map();
    this._plans.set(sessionToken, plan);

    return quotaInfo;
  }

  async getPlan(sessionToken) {
    const quota = await this.getAccountQuota(sessionToken);
    return quota.plan;
  }

  markRateLimited(token, retryAfterMs = COOLDOWN_RATE_LIMIT) {
    const until = Date.now() + Math.min(retryAfterMs, 120_000); // tối đa 2 phút
    this._cooldowns.set(token, until);
    const account = this._accounts.find(a => a.client.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Rate limited — cooldown ${Math.ceil((until - Date.now()) / 1000)}s`);
  }

  /**
   * Đánh dấu acc đã hết quota window.
   * Acc này sẽ bị bỏ qua cho đến khi quota_resets_at qua đi (cooldown dài hạn theo đúng resetAt của OpenAI).
   */
  markQuotaExhausted(token, retryAfterMs = COOLDOWN_QUOTA_DEFAULT) {
    let finalCooldownMs = retryAfterMs;
    const cached = this._quotaCache?.get(token);
    if (cached && cached.resetAt) {
      const rem = cached.resetAt - Date.now();
      if (rem > 0) {
        // Sử dụng thời gian reset thực tế làm thời gian cooldown dài hạn
        finalCooldownMs = rem;
      }
    }

    const until = Date.now() + finalCooldownMs;
    // Lưu vào in-memory map để getNext() skip nhanh
    this._quotaExhausted.set(token, until);
    // Cũng đặt cooldown thông thường để _isOnCooldown() bắt được
    this._cooldowns.set(token, until);

    const account = this._accounts.find(a => a.client.sessionToken === token);
    
    let durationText = '';
    if (finalCooldownMs >= 24 * 3600000) {
      const days = Math.floor(finalCooldownMs / (24 * 3600000));
      const hours = Math.ceil((finalCooldownMs % (24 * 3600000)) / 3600000);
      durationText = `${days}d ${hours}h`;
    } else {
      durationText = `${Math.ceil(finalCooldownMs / 3600000)}h`;
    }

    logger.warn(`[${account?.name ?? 'unknown'}] Quota exhausted — cooldown ${durationText} (hồi lúc ${new Date(until).toLocaleString('vi-VN')})`);

    // Persist vào DB để survive restart
    const db = require('../db');
    const resetIso = new Date(until).toISOString();
    if (account?.id) {
      db.run(
        `UPDATE upstream_accounts SET quota_resets_at = ?, last_error = 'quota_exhausted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [resetIso, account.id]
      ).catch(err => logger.error('Failed to persist quota_resets_at: ' + err.message));
    } else {
      db.run(
        `UPDATE upstream_accounts SET quota_resets_at = ?, last_error = 'quota_exhausted', updated_at = CURRENT_TIMESTAMP WHERE session_token = ?`,
        [resetIso, token]
      ).catch(err => logger.error('Failed to persist quota_resets_at: ' + err.message));
    }
  }

  markInvalid(token, reason = 'Session token is invalid or expired') {
    const until = Date.now() + COOLDOWN_INVALID;
    this._cooldowns.set(token, until);
    this._invalidTokens.add(token);
    this._errors.set(token, reason);
    const account = this._accounts.find(a => a.client.sessionToken === token);
    logger.warn(`[${account?.name ?? 'unknown'}] Invalid session (${reason}) — cooling down for 30min`);

    // Chỉ cập nhật last_error để báo lỗi, giữ nguyên is_active = 1 để Extension quét thấy và tự động re-login
    const db = require('../db');
    if (account && account.id) {
      db.run('UPDATE upstream_accounts SET last_error = ? WHERE id = ?', [reason, account.id]).catch(err => {
        logger.error('Failed to update last_error in database for invalid token ID: ' + err.message);
      });
    } else {
      db.run('UPDATE upstream_accounts SET last_error = ? WHERE session_token = ?', [reason, token]).catch(err => {
        logger.error('Failed to update last_error in database for invalid token: ' + err.message);
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

    // Bước 1: Tìm tất cả acc không bị cooldown
    const available = [];
    for (let i = 0; i < total; i++) {
      const idx     = (this._index + i) % total;
      const account = this._accounts[idx];
      const token   = account.client.sessionToken;

      if (this._isOnCooldown(token)) {
        // Đang cooldown — log nếu là quota exhausted
        const quotaUntil = this._quotaExhausted.get(token);
        if (quotaUntil) {
          const minsLeft = Math.ceil((quotaUntil - Date.now()) / 60000);
          logger.debug(`[${account.name}] Skipped — quota hồi sau ${minsLeft} phút`);
        }
        continue;
      }

      // ── PROACTIVE QUOTA CHECK ───────────────────────────────────────────────
      // Hệ thống đã biết quota từ _quotaCache (dashboard gọi getAccountQuota).
      // Nếu remainingPercent = 0, và:
      //   - Hoặc dữ liệu cache còn mới (<30 phút)
      //   - Hoặc thời gian reset (resetAt) vẫn ở tương lai (chắc chắn vẫn bằng 0%)
      // -> skip ngay, KHÔNG thử request để tránh ban acc.
      const cachedQuota = this._quotaCache?.get(token);
      if (cachedQuota) {
        const cacheAge = Date.now() - cachedQuota.updatedAt;
        const isResetInFuture = cachedQuota.resetAt && cachedQuota.resetAt > Date.now();
        const isCacheFresh = cacheAge < 30 * 60 * 1000;

        if (cachedQuota.remainingPercent <= 0 && (isCacheFresh || isResetInFuture)) {
          // Pre-mark quota exhausted dựa trên reset window (hoặc default 5h nếu không biết)
          if (!this._quotaExhausted.has(token)) {
            const timeToReset = cachedQuota.resetAt ? (cachedQuota.resetAt - Date.now()) : COOLDOWN_QUOTA_DEFAULT;
            logger.info(`[${account.name}] Pre-skip: cache quota = 0% — đánh dấu exhausted proactively`);
            this.markQuotaExhausted(token, timeToReset);
          }
          continue; // bỏ qua, KHÔNG thêm vào available
        }
      }
      // ── END PROACTIVE CHECK ─────────────────────────────────────────────────

      available.push({ account, idx, token });
    }

    if (available.length > 0) {
      // Bước 2: Sắp xếp tài khoản theo độ rảnh (inFlight) và thời gian reset quota sớm nhất
      available.sort((a, b) => {
        // 1. Số request in-flight thấp nhất (tránh dồn dập vào 1 acc khi concurrency cao)
        const fa = this._inFlight.get(a.token) || 0;
        const fb = this._inFlight.get(b.token) || 0;
        if (fa !== fb) return fa - fb;

        // 2. Thời gian reset quota sớm nhất/gần nhất (resetAt tăng dần)
        const qA = this._quotaCache?.get(a.token);
        const qB = this._quotaCache?.get(b.token);
        const resetA = qA?.resetAt || null;
        const resetB = qB?.resetAt || null;

        if (resetA !== null && resetB !== null) {
          const diff = Math.abs(resetA - resetB);
          if (diff > 24 * 60 * 60 * 1000) {
            return resetA - resetB; // Ascending order
          }
          // Trong cùng lô reset (lệch nhau < 24h), ưu tiên acc còn nhiều quota (%) hơn để dùng đều các tài khoản
          const remA = qA?.remainingPercent ?? 100;
          const remB = qB?.remainingPercent ?? 100;
          if (remA !== remB) {
            return remB - remA; // Nhiều quota hơn lên trước
          }
        } else {
          if (resetA !== null) return -1;
          if (resetB !== null) return 1;
        }

        // 3. Giữ nguyên thứ tự idx ban đầu làm tie-breaker
        return a.idx - b.idx;
      });

      const { account, idx, token } = available[0];
      this._index = (idx + 1) % total;

      // Log chi tiết chọn tài khoản kèm inFlight và thời gian reset
      const q = this._quotaCache?.get(token);
      let resetInfo = 'unknown';
      if (q && q.resetAt) {
        const diff = q.resetAt - Date.now();
        if (diff > 0) {
          const days = Math.floor(diff / (24 * 3600 * 1000));
          const hrs = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
          resetInfo = `${days}d ${hrs}h (in ${Math.round(diff / 60000)}m)`;
        } else {
          resetInfo = 'due';
        }
      }
      logger.debug(`Selected [${account.name}] (inFlight: ${this._inFlight.get(token) || 0}, resetAt: ${resetInfo}, quota: ${q?.remainingPercent ?? 'unknown'}%)`);

      // Cập nhật last_used_at (fire-and-forget)
      if (account.id) {
        const db = require('../db');
        db.run(
          `UPDATE upstream_accounts SET last_used_at = CURRENT_TIMESTAMP, total_requests = total_requests + 1 WHERE id = ?`,
          [account.id]
        ).catch(() => {});
      }

      return { client: account.client, token, name: account.name };
    }

    // Bước 3: Không có acc nào sẵn sàng — tìm acc hồi sớm nhất
    let soonest = Infinity;
    let soonestName = '';
    let soonestIsQuota = false;
    for (const account of this._accounts) {
      const rem = this._cooldownRemaining(account.client.sessionToken);
      if (rem < soonest) {
        soonest = rem;
        soonestName = account.name;
        soonestIsQuota = this._quotaExhausted.has(account.client.sessionToken);
      }
    }

    // Nếu tất cả đang hết quota (>10 giây) → trả 503 ngay, không đợi hàng giờ
    if (soonest > 10_000) {
      const waitMins = Math.ceil(soonest / 60000);
      logger.warn(`Tất cả ${total} acc hết quota. Acc sớm nhất [${soonestName}] hồi sau ${waitMins} phút. Trả 503.`);
      const err = new Error(
        `Tất cả ${total} tài khoản đang cooldown. Thử lại sau ${waitMins} phút.`
      );
      err.code       = 'ALL_ACCOUNTS_FAILED';
      err.statusCode = 503;
      err.retryAfter = Math.ceil(soonest / 1000);
      throw err;
    }

    // Rate limit tạm thời (≤ 10s) → đợi ngắn rồi thử lại
    logger.warn(`[${soonestName}] Đang rate-limited. Đợi ${Math.ceil(soonest / 1000)}s…`);
    await new Promise(resolve => setTimeout(resolve, soonest + 100));
    return this.getNext();
  }


  // ── High-Level Chat ───────────────────────────────────────────────────────

  async chatWithRotation(messages, model, options = {}, maxAttempts = 0) {
    // maxAttempts = số acc tối đa thử (mỗi acc thử đúng 1 lần)
    const limit = maxAttempts > 0 ? maxAttempts : Math.max(this._accounts.length, 1);
    const tried = new Set(); // token đã thử trong request này

    for (let attempt = 0; attempt < limit; attempt++) {
      let accountInfo;
      try {
        accountInfo = await this.getNext();
      } catch (err) {
        // getNext() thả 503 khi tất cả hết quota — bắn thẳng ra ngoài
        throw err;
      }

      const { client, token, name } = accountInfo;

      // Nếu đã thử acc này trong request này rồi — vòng vòng, dừng
      if (tried.has(token)) {
        break;
      }
      tried.add(token);

      // Đánh dấu đang xử lý (in-flight) — getNext() sẽ ưu tiên acc khác trước
      this._inFlight.set(token, (this._inFlight.get(token) || 0) + 1);

      try {
        logger.debug(`[${name}] Thử gử request (attempt ${attempt + 1}/${limit}, in-flight: ${this._inFlight.get(token)})`);
        const response = await client.chat(messages, model, options);
        logger.info(`[${name}] Request thành công`);
        return response;
      } catch (err) {
        if (err.code === 'QUOTA_EXHAUSTED') {
          this.markQuotaExhausted(token, err.retryAfter || COOLDOWN_QUOTA_DEFAULT);
          logger.warn(`[${name}] Hết quota — chuyển sang acc khác`);
          continue;
        }
        if (err.code === 'RATE_LIMITED') {
          this.markRateLimited(token, err.retryAfter || COOLDOWN_RATE_LIMIT);
          logger.warn(`[${name}] Rate limited — chuyển sang acc khác`);
          continue;
        }
        if (err.code === 'INVALID_SESSION') {
          this.markInvalid(token, err.message);
          logger.warn(`[${name}] Token không hợp lệ — chuyển sang acc khác`);
          continue;
        }
        // Lỗi khác (network, etc.) — bắn ra ngoài ngay
        throw err;
      } finally {
        // LUÔN giảm in-flight dù thành công hay thất bại
        const cur = this._inFlight.get(token) || 1;
        if (cur <= 1) this._inFlight.delete(token);
        else this._inFlight.set(token, cur - 1);
      }
    }

    const err      = new Error('Tất cả tài khoản đã thử đều thất bại hoặc hết quota');
    err.code       = 'ALL_ACCOUNTS_FAILED';
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
    this._quotaExhausted.clear();
    this._inFlight.clear();
    this._invalidTokens.clear();
    this._errors.clear();
    if (this._plans) this._plans.clear();
    await this._loadAsync();
    // Chạy ngầm refresh quota ngay để cập nhật dữ liệu mới nhất
    this._backgroundRefreshQuotas().catch(() => {});
    return { count: this._accounts.length };
  }

  // ── Background Quota Refresh ──────────────────────────────────────────────

  /**
   * Chạy ngầm mỗi 10 phút — refresh quota cache cho tất cả acc đang active.
   * Nhờ đó proactive pre-skip trong getNext() luôn có data mới,
   * không cần đợi request fail mới biết acc nào đã hết quota.
   */
  async _backgroundRefreshQuotas() {
    const BATCH = 5; // max 5 concurrent requests cùng lúc (tránh spam OpenAI)
    const STALE_THRESHOLD = 8 * 60 * 1000; // chỉ refresh acc chưa check trong 8 phút

    const now = Date.now();
    const toRefresh = this._accounts.filter(acc => {
      const token = acc.client.sessionToken;
      // Bỏ qua acc đang hết quota (không cần check lại cho đến khi hồi)
      if (this._quotaExhausted.has(token)) return false;
      // Bỏ qua acc hỏng
      if (this._invalidTokens.has(token)) return false;
      // Chỉ refresh nếu cache cũ hơn STALE_THRESHOLD
      const cached = this._quotaCache?.get(token);
      if (cached && (now - cached.updatedAt) < STALE_THRESHOLD) return false;
      return true;
    });

    if (toRefresh.length === 0) return;

    logger.debug(`[QuotaRefresh] Refreshing quota cho ${toRefresh.length} acc...`);

    // Xử lý theo batch
    for (let i = 0; i < toRefresh.length; i += BATCH) {
      const batch = toRefresh.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async (acc) => {
        try {
          const quota = await this.getAccountQuota(acc.client.sessionToken);
          // Nếu 0% → pre-mark ngay, không đợi request fail
          if (quota.remainingPercent <= 0 && !this._quotaExhausted.has(acc.client.sessionToken)) {
            logger.info(`[${acc.name}] QuotaRefresh: 0% remaining → pre-marking exhausted`);
            this.markQuotaExhausted(acc.client.sessionToken, COOLDOWN_QUOTA_DEFAULT);
          }
        } catch (_) {
          // Lỗi khi check quota → bỏ qua, thử lần sau
        }
      }));
      // Nhỏ delay giữa các batch
      if (i + BATCH < toRefresh.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    logger.debug(`[QuotaRefresh] Done. ${this._quotaExhausted.size} acc đang exhausted.`);
  }
}

// Singleton
const pool = new AccountPool();

// Chạy background quota refresh mỗi 10 phút sau khi accounts đã load
setTimeout(() => {
  // Lần đầu sau 5s (chờ server khởi động xong)
  pool._backgroundRefreshQuotas().catch(() => {});
  // Sau đó mỗi 10 phút
  setInterval(() => {
    pool._backgroundRefreshQuotas().catch(() => {});
  }, 10 * 60 * 1000);
}, 5 * 1000);

module.exports = pool;

