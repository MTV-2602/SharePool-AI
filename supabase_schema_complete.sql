-- ═══════════════════════════════════════════════════════════════════
-- 9Router Supabase Master Schema  –  Unified Complete Setup Script
-- Run this ONCE in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- This file creates all 22 tables, indexes, custom functions, and configures RLS.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. CORE SYSTEM TABLES ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS usage_daily (
  date_key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- ─── 2. API KEYS & USER ACCOUNTS ──────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Unnamed',
  quota_total BIGINT NOT NULL DEFAULT 100000000,
  quota_used  BIGINT NOT NULL DEFAULT 0,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  note        TEXT DEFAULT '',
  model_allowlist TEXT DEFAULT '',
  max_concurrent INTEGER DEFAULT 0,
  rate_limit_per_minute INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  quota_tokens BIGINT DEFAULT 100000000,
  used_tokens BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  note TEXT,
  model_allowlist TEXT DEFAULT '',
  max_concurrent INT DEFAULT 0,
  rate_limit_per_minute INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotmail_accounts (
  id           SERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  password     TEXT DEFAULT '',
  refreshToken TEXT DEFAULT '',
  clientId     TEXT DEFAULT '',
  secret2fa    TEXT DEFAULT '',
  state        TEXT DEFAULT 'available',
  takenByIp    TEXT DEFAULT '',
  takenAt      TEXT DEFAULT '',
  takenNote    TEXT DEFAULT '',
  usedCount    INTEGER DEFAULT 0,
  lastReadAt   TEXT DEFAULT '',
  reservedAt   TEXT DEFAULT '',
  usedAt       TEXT DEFAULT '',
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chatgpt_credentials (
  id           SERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  password     TEXT DEFAULT '',
  otp_secret   TEXT DEFAULT '',
  worker_id    TEXT DEFAULT '',
  source       TEXT DEFAULT 'AutoReg',
  status       TEXT DEFAULT 'active',
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upstream_accounts (
  id                       SERIAL PRIMARY KEY,
  name                     TEXT NOT NULL,
  session_token            TEXT NOT NULL UNIQUE,
  is_active                INTEGER DEFAULT 1,
  total_requests           INTEGER DEFAULT 0,
  last_error               TEXT,
  quota_resets_at          TIMESTAMP,
  last_used_at             TIMESTAMP,
  quota_remaining_percent  REAL,
  quota_primary_remaining  REAL,
  quota_secondary_remaining REAL,
  quota_reset_at           TIMESTAMP,
  quota_checked_at         TIMESTAMP,
  quota_family             TEXT DEFAULT 'codex',
  model_locks              TEXT DEFAULT '{}',
  last_selected_at         TIMESTAMP,
  created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_oauth_sessions (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  email         TEXT DEFAULT '',
  error         TEXT DEFAULT '',
  created_at    BIGINT NOT NULL
);

-- ─── 3. ANTIGRAVITY SPECIFIC TABLES ────────────────────────────────

CREATE TABLE IF NOT EXISTS antigravity_accounts (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT UNIQUE,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT,
  project_id       TEXT,
  is_active        INTEGER DEFAULT 1,
  last_error       TEXT,
  quota_resets_at  TIMESTAMP,
  last_used_at     TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antigravity_api_keys (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Unnamed',
  quota_total BIGINT NOT NULL DEFAULT 100000000,
  quota_used  BIGINT NOT NULL DEFAULT 0,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  note        TEXT DEFAULT '',
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antigravity_usage_logs (
  id           SERIAL PRIMARY KEY,
  api_key      TEXT NOT NULL,
  model        TEXT DEFAULT 'gemini-2.0-flash',
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  req_id       TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antigravity_pending_oauth_sessions (
  state         TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  email         TEXT DEFAULT '',
  error         TEXT DEFAULT '',
  created_at    BIGINT NOT NULL
);

-- ─── 4. LOGS & Observability ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_logs (
  id                    SERIAL PRIMARY KEY,
  api_key               TEXT NOT NULL,
  model                 TEXT DEFAULT 'gpt-4o',
  tokens_in             INTEGER DEFAULT 0,
  tokens_out            INTEGER DEFAULT 0,
  tokens_total          INTEGER DEFAULT 0,
  req_id                TEXT,
  endpoint              TEXT DEFAULT '',
  upstream_account_id   INTEGER,
  upstream_account_name TEXT DEFAULT '',
  status                TEXT DEFAULT 'ok',
  latency_ms            INTEGER DEFAULT 0,
  error_code            TEXT DEFAULT '',
  error_message         TEXT DEFAULT '',
  quota_reserved        INTEGER DEFAULT 0,
  created_at            TEXT DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS client_key_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key_id UUID REFERENCES client_keys(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_details (
  id                    TEXT PRIMARY KEY,
  req_id                TEXT,
  api_key               TEXT,
  endpoint              TEXT,
  model                 TEXT,
  upstream_account_id   INTEGER,
  upstream_account_name TEXT,
  status                TEXT DEFAULT 'ok',
  latency_ms            INTEGER DEFAULT 0,
  data                  TEXT NOT NULL,
  created_at            TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ─── 5. INDEXES FOR HIGH PERFORMANCE ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys (key);
CREATE INDEX IF NOT EXISTS idx_client_keys_key ON client_keys (key);
CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key ON usage_logs (api_key);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_account ON usage_logs(upstream_account_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_endpoint ON usage_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_hotmail_email ON hotmail_accounts (email);
CREATE INDEX IF NOT EXISTS idx_hotmail_state ON hotmail_accounts (state);
CREATE INDEX IF NOT EXISTS idx_upstream_is_active ON upstream_accounts (is_active);
CREATE INDEX IF NOT EXISTS idx_upstream_rotation ON upstream_accounts (is_active, last_used_at) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_request_details_created_at ON request_details(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_details_account ON request_details(upstream_account_id);
CREATE INDEX IF NOT EXISTS idx_usage_history_timestamp ON usage_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_history_api_key ON usage_history(api_key);
CREATE INDEX IF NOT EXISTS idx_client_key_usage_logs_key_id ON client_key_usage_logs(client_key_id);
CREATE INDEX IF NOT EXISTS idx_client_key_usage_logs_created ON client_key_usage_logs(created_at);

-- ─── 6. DYNAMIC RPC & UTILITY FUNCTIONS ──────────────────────────

-- A. Safe Increment Client Key Used Tokens
CREATE OR REPLACE FUNCTION public.increment_client_key_tokens(p_key_id uuid, p_tokens bigint)
 RETURNS TABLE(used_tokens bigint, quota_tokens bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 AS $$
 BEGIN
   UPDATE client_keys ck
   SET used_tokens = ck.used_tokens + p_tokens
   WHERE ck.id = p_key_id;
 
   RETURN QUERY
   SELECT ck.used_tokens, ck.quota_tokens
   FROM client_keys ck
   WHERE ck.id = p_key_id;
 END;
 $$;

-- B. Dynamic SQL Execution RPC Function (exec_sql)
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

-- ─── 7. ROW LEVEL SECURITY (RLS) FOR ALL 22 TABLES ───────────────

ALTER TABLE IF EXISTS public.hotmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_key_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.proxy_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chatgpt_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_pending_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.request_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.upstream_accounts ENABLE ROW LEVEL SECURITY;

-- ─── 8. FUNCTION EXECUTE PERMISSIONS ──────────────────────────────

-- Revoke dynamic sql execution from public, anon, and authenticated roles
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Grant execution exclusively to the database owner and service_role (backend client)
GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT, JSONB) TO service_role;

-- Done message
SELECT '9Router master schema setup and security policies completed successfully ✓' AS status;
