-- ═══════════════════════════════════════════════════════════════════
-- 9Router Supabase Schema  –  Full Migration from SQLite
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
-- ═══════════════════════════════════════════════════════════════════

-- Meta & Settings
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

-- 9Router Core tables
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  name TEXT,
  email TEXT,
  priority INT,
  is_active BOOLEAN DEFAULT true,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provider_nodes (
  id TEXT PRIMARY KEY,
  type TEXT,
  name TEXT,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxy_pools (
  id TEXT PRIMARY KEY,
  is_active BOOLEAN DEFAULT true,
  test_status TEXT,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  machine_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS combos (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  kind TEXT,
  models TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kv (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS usage_history (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT,
  model TEXT,
  connection_id TEXT,
  api_key TEXT,
  endpoint TEXT,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  cost REAL DEFAULT 0,
  status TEXT,
  tokens TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS usage_daily (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_details (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  provider TEXT,
  model TEXT,
  connection_id TEXT,
  status TEXT,
  data TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════
-- Resale Client Keys (Module 1.5)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT,
  owner_note TEXT,
  quota_tokens BIGINT NOT NULL DEFAULT 0,
  used_tokens BIGINT NOT NULL DEFAULT 0,
  max_concurrent INT DEFAULT 1,
  rate_limit_per_minute INT DEFAULT 60,
  model_multiplier JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_key_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  client_key_id UUID REFERENCES client_keys(id) ON DELETE SET NULL,
  model TEXT,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  billed_tokens INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- Hotmail Accounts (Module 1.2)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hotmail_accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  totp_secret TEXT,
  client_id TEXT,
  refresh_token TEXT,
  status TEXT DEFAULT 'available',
  reserved_by_ip TEXT,
  usage_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- Indexes for performance
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_usage_history_timestamp ON usage_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_history_api_key ON usage_history(api_key);
CREATE INDEX IF NOT EXISTS idx_client_key_usage_logs_key_id ON client_key_usage_logs(client_key_id);
CREATE INDEX IF NOT EXISTS idx_client_key_usage_logs_created ON client_key_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_hotmail_accounts_status ON hotmail_accounts(status);

-- ═══════════════════════════════════════════════════════════════════
-- Dynamic SQL Execution RPC Function (exec_sql)
-- This allows the existing 9Router repo code to send raw SQL
-- through Supabase RPC, mapping ? placeholders to $1, $2...
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION exec_sql(query_text TEXT, query_params JSONB DEFAULT '[]'::jsonb)
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
    val JSONB;
    final_query TEXT := query_text;
    i INT := 1;
    param_count INT;
BEGIN
    param_count := jsonb_array_length(query_params);
    
    -- Map ? placeholders to Postgres $1, $2...
    WHILE position('?' IN final_query) > 0 LOOP
        final_query := regexp_replace(final_query, '\?', '$' || i, 'i');
        i := i + 1;
    END LOOP;

    -- Adjust table names: camelCase -> snake_case
    final_query := replace(final_query, 'providerConnections', 'provider_connections');
    final_query := replace(final_query, 'providerNodes', 'provider_nodes');
    final_query := replace(final_query, 'proxyPools', 'proxy_pools');
    final_query := replace(final_query, 'apiKeys', 'api_keys');
    final_query := replace(final_query, 'usageHistory', 'usage_history');
    final_query := replace(final_query, 'usageDaily', 'usage_daily');
    final_query := replace(final_query, 'requestDetails', 'request_details');
    final_query := replace(final_query, 'clientKeys', 'client_keys');
    final_query := replace(final_query, 'clientKeyUsageLogs', 'client_key_usage_logs');
    final_query := replace(final_query, 'hotmailAccounts', 'hotmail_accounts');

    -- Adjust column names: camelCase -> snake_case
    final_query := replace(final_query, 'createdAt', 'created_at');
    final_query := replace(final_query, 'updatedAt', 'updated_at');
    final_query := replace(final_query, 'isActive', 'is_active');
    final_query := replace(final_query, 'machineId', 'machine_id');
    final_query := replace(final_query, 'authType', 'auth_type');
    final_query := replace(final_query, 'testStatus', 'test_status');
    final_query := replace(final_query, 'lastTestedAt', 'last_tested_at');
    final_query := replace(final_query, 'lastTested', 'last_tested');
    final_query := replace(final_query, 'connectionId', 'connection_id');
    final_query := replace(final_query, 'apiKey', 'api_key');
    final_query := replace(final_query, 'promptTokens', 'prompt_tokens');
    final_query := replace(final_query, 'completionTokens', 'completion_tokens');
    final_query := replace(final_query, 'displayName', 'display_name');
    final_query := replace(final_query, 'globalPriority', 'global_priority');
    final_query := replace(final_query, 'defaultModel', 'default_model');
    final_query := replace(final_query, 'accessToken', 'access_token');
    final_query := replace(final_query, 'refreshToken', 'refresh_token');
    final_query := replace(final_query, 'expiresAt', 'expires_at');
    final_query := replace(final_query, 'tokenType', 'token_type');
    final_query := replace(final_query, 'projectId', 'project_id');
    final_query := replace(final_query, 'lastError', 'last_error');
    final_query := replace(final_query, 'lastErrorAt', 'last_error_at');
    final_query := replace(final_query, 'rateLimitedUntil', 'rate_limited_until');
    final_query := replace(final_query, 'expiresIn', 'expires_in');
    final_query := replace(final_query, 'consecutiveUseCount', 'consecutive_use_count');
    final_query := replace(final_query, 'quotaTotal', 'quota_total');
    final_query := replace(final_query, 'quotaUsed', 'quota_used');
    final_query := replace(final_query, 'modelAllowlist', 'model_allowlist');
    final_query := replace(final_query, 'maxConcurrent', 'max_concurrent');
    final_query := replace(final_query, 'rateLimitPerMinute', 'rate_limit_per_minute');
    final_query := replace(final_query, 'lastRefreshAt', 'last_refresh_at');
    final_query := replace(final_query, 'idToken', 'id_token');
    final_query := replace(final_query, 'dateKey', 'date_key');

    -- Handle PRAGMA (SQLite compat - return empty)
    IF UPPER(TRIM(final_query)) LIKE 'PRAGMA%' THEN
        RETURN '[]'::jsonb;
    END IF;

    IF UPPER(TRIM(final_query)) LIKE 'SELECT%' THEN
        -- SELECT: return rows as JSON array
        EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', final_query)
        INTO val
        USING 
            CASE WHEN param_count > 0 THEN query_params->>0 ELSE NULL END,
            CASE WHEN param_count > 1 THEN query_params->>1 ELSE NULL END,
            CASE WHEN param_count > 2 THEN query_params->>2 ELSE NULL END,
            CASE WHEN param_count > 3 THEN query_params->>3 ELSE NULL END,
            CASE WHEN param_count > 4 THEN query_params->>4 ELSE NULL END,
            CASE WHEN param_count > 5 THEN query_params->>5 ELSE NULL END,
            CASE WHEN param_count > 6 THEN query_params->>6 ELSE NULL END,
            CASE WHEN param_count > 7 THEN query_params->>7 ELSE NULL END,
            CASE WHEN param_count > 8 THEN query_params->>8 ELSE NULL END,
            CASE WHEN param_count > 9 THEN query_params->>9 ELSE NULL END,
            CASE WHEN param_count > 10 THEN query_params->>10 ELSE NULL END,
            CASE WHEN param_count > 11 THEN query_params->>11 ELSE NULL END,
            CASE WHEN param_count > 12 THEN query_params->>12 ELSE NULL END,
            CASE WHEN param_count > 13 THEN query_params->>13 ELSE NULL END,
            CASE WHEN param_count > 14 THEN query_params->>14 ELSE NULL END,
            CASE WHEN param_count > 15 THEN query_params->>15 ELSE NULL END,
            CASE WHEN param_count > 16 THEN query_params->>16 ELSE NULL END,
            CASE WHEN param_count > 17 THEN query_params->>17 ELSE NULL END,
            CASE WHEN param_count > 18 THEN query_params->>18 ELSE NULL END,
            CASE WHEN param_count > 19 THEN query_params->>19 ELSE NULL END,
            CASE WHEN param_count > 20 THEN query_params->>20 ELSE NULL END,
            CASE WHEN param_count > 21 THEN query_params->>21 ELSE NULL END,
            CASE WHEN param_count > 22 THEN query_params->>22 ELSE NULL END,
            CASE WHEN param_count > 23 THEN query_params->>23 ELSE NULL END,
            CASE WHEN param_count > 24 THEN query_params->>24 ELSE NULL END,
            CASE WHEN param_count > 25 THEN query_params->>25 ELSE NULL END,
            CASE WHEN param_count > 26 THEN query_params->>26 ELSE NULL END,
            CASE WHEN param_count > 27 THEN query_params->>27 ELSE NULL END,
            CASE WHEN param_count > 28 THEN query_params->>28 ELSE NULL END,
            CASE WHEN param_count > 29 THEN query_params->>29 ELSE NULL END;
        
        RETURN val;
    ELSE
        -- INSERT/UPDATE/DELETE: execute and return changes count
        EXECUTE final_query
        USING 
            CASE WHEN param_count > 0 THEN query_params->>0 ELSE NULL END,
            CASE WHEN param_count > 1 THEN query_params->>1 ELSE NULL END,
            CASE WHEN param_count > 2 THEN query_params->>2 ELSE NULL END,
            CASE WHEN param_count > 3 THEN query_params->>3 ELSE NULL END,
            CASE WHEN param_count > 4 THEN query_params->>4 ELSE NULL END,
            CASE WHEN param_count > 5 THEN query_params->>5 ELSE NULL END,
            CASE WHEN param_count > 6 THEN query_params->>6 ELSE NULL END,
            CASE WHEN param_count > 7 THEN query_params->>7 ELSE NULL END,
            CASE WHEN param_count > 8 THEN query_params->>8 ELSE NULL END,
            CASE WHEN param_count > 9 THEN query_params->>9 ELSE NULL END,
            CASE WHEN param_count > 10 THEN query_params->>10 ELSE NULL END,
            CASE WHEN param_count > 11 THEN query_params->>11 ELSE NULL END,
            CASE WHEN param_count > 12 THEN query_params->>12 ELSE NULL END,
            CASE WHEN param_count > 13 THEN query_params->>13 ELSE NULL END,
            CASE WHEN param_count > 14 THEN query_params->>14 ELSE NULL END,
            CASE WHEN param_count > 15 THEN query_params->>15 ELSE NULL END,
            CASE WHEN param_count > 16 THEN query_params->>16 ELSE NULL END,
            CASE WHEN param_count > 17 THEN query_params->>17 ELSE NULL END,
            CASE WHEN param_count > 18 THEN query_params->>18 ELSE NULL END,
            CASE WHEN param_count > 19 THEN query_params->>19 ELSE NULL END,
            CASE WHEN param_count > 20 THEN query_params->>20 ELSE NULL END,
            CASE WHEN param_count > 21 THEN query_params->>21 ELSE NULL END,
            CASE WHEN param_count > 22 THEN query_params->>22 ELSE NULL END,
            CASE WHEN param_count > 23 THEN query_params->>23 ELSE NULL END,
            CASE WHEN param_count > 24 THEN query_params->>24 ELSE NULL END,
            CASE WHEN param_count > 25 THEN query_params->>25 ELSE NULL END,
            CASE WHEN param_count > 26 THEN query_params->>26 ELSE NULL END,
            CASE WHEN param_count > 27 THEN query_params->>27 ELSE NULL END,
            CASE WHEN param_count > 28 THEN query_params->>28 ELSE NULL END,
            CASE WHEN param_count > 29 THEN query_params->>29 ELSE NULL END;
        
        GET DIAGNOSTICS i = ROW_COUNT;
        RETURN jsonb_build_object('changes', i);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
