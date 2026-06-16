import { supabase } from '../../supabase.js';

const KEY_MAP = {
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  is_active: 'isActive',
  machine_id: 'machineId',
  auth_type: 'authType',
  test_status: 'testStatus',
  last_tested: 'lastTested',
  connection_id: 'connectionId',
  api_key: 'apiKey',
  prompt_tokens: 'promptTokens',
  completion_tokens: 'completionTokens',
  display_name: 'displayName',
  global_priority: 'globalPriority',
  default_model: 'defaultModel',
  access_token: 'accessToken',
  refresh_token: 'refreshToken',
  expires_at: 'expiresAt',
  token_type: 'tokenType',
  project_id: 'projectId',
  last_error: 'lastError',
  last_error_at: 'lastErrorAt',
  rate_limited_until: 'rateLimitedUntil',
  expires_in: 'expiresIn',
  consecutive_use_count: 'consecutiveUseCount',
  quota_total: 'quotaTotal',
  quota_used: 'quotaUsed',
  model_allowlist: 'modelAllowlist',
  max_concurrent: 'maxConcurrent',
  rate_limit_per_minute: 'rateLimitPerMinute',
  last_refresh_at: 'lastRefreshAt',
  id_token: 'idToken',
  date_key: 'dateKey',
};

function mapRowKeys(row) {
  if (!row) return row;
  const mapped = {};
  for (const [k, v] of Object.entries(row)) {
    const camelKey = KEY_MAP[k] || k;
    mapped[camelKey] = v;
  }
  return mapped;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;

function addCastsToQuery(sql, params) {
  if (!params || params.length === 0) return sql;

  let result = '';
  let inString = false;
  let paramIndex = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === "'") {
      if (i > 0 && sql[i - 1] === '\\') {
        // Escaped quote
      } else {
        inString = !inString;
      }
      result += char;
    } else if (char === '?' && !inString) {
      if (paramIndex < params.length) {
        const val = params[paramIndex++];
        if (typeof val === 'number') {
          result += '?::numeric';
        } else if (typeof val === 'boolean') {
          result += '?::boolean';
        } else if (typeof val === 'string' && DATE_REGEX.test(val)) {
          result += '?::timestamptz';
        } else {
          result += '?';
        }
      } else {
        result += '?';
      }
    } else {
      result += char;
    }
  }
  return result;
}

export function createSupabaseAdapter() {
  if (!supabase) {
    throw new Error('[DB] Supabase client not initialized. Check SUPABASE_URL and SUPABASE_KEY env vars.');
  }

  const adapter = {
    driver: 'supabase-rpc',

    /**
     * Execute a SELECT query and return all matching rows.
     * @param {string} sql - SQL query string with ? placeholders
     * @param {Array} params - Parameter values
     * @returns {Promise<Array>} Array of row objects
     */
    async all(sql, params = []) {
      const castedSql = addCastsToQuery(sql, params);
      const { data, error } = await supabase.rpc('exec_sql', {
        query_text: castedSql,
        query_params: params,
      });
      if (error) {
        console.error('[DB] Supabase RPC error (all):', error.message, '| SQL:', sql);
        throw new Error(`[DB] ${error.message}`);
      }
      if (data && data.error) {
        console.error('[DB] SQL execution error:', data.error, '| SQL:', sql);
        throw new Error(`[DB] ${data.error}`);
      }
      return Array.isArray(data) ? data.map(mapRowKeys) : [];
    },

    /**
     * Execute a SELECT query and return the first matching row.
     * @param {string} sql - SQL query string with ? placeholders
     * @param {Array} params - Parameter values
     * @returns {Promise<Object|undefined>} First row or undefined
     */
    async get(sql, params = []) {
      const rows = await adapter.all(sql, params);
      return rows[0];
    },

    /**
     * Execute an INSERT/UPDATE/DELETE statement.
     * @param {string} sql - SQL statement with ? placeholders
     * @param {Array} params - Parameter values
     * @returns {Promise<{changes: number}>} Number of affected rows
     */
    async run(sql, params = []) {
      const castedSql = addCastsToQuery(sql, params);
      const { data, error } = await supabase.rpc('exec_sql', {
        query_text: castedSql,
        query_params: params,
      });
      if (error) {
        console.error('[DB] Supabase RPC error (run):', error.message, '| SQL:', sql);
        throw new Error(`[DB] ${error.message}`);
      }
      if (data && data.error) {
        console.error('[DB] SQL execution error:', data.error, '| SQL:', sql);
        throw new Error(`[DB] ${data.error}`);
      }
      return { changes: data?.changes ?? 0 };
    },

    /**
     * Execute a transaction.
     * Supabase PostgREST doesn't support transactions over raw RPC statements sequentially.
     * We execute sequentially (best-effort).
     * @param {Function} fn - Function that receives the adapter and runs queries
     * @returns {Promise<*>} Result of the transaction function
     */
    async transaction(fn) {
      return await fn(adapter);
    },

    close() {
      // No-op for Supabase
    },
  };

  return adapter;
}
