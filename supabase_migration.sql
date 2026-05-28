-- ============================================================
-- CodeX Portal — Supabase Migration v1
-- Run this in Supabase Dashboard → SQL Editor
-- or via psql connection
-- ============================================================

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL DEFAULT 'Unnamed',
  quota_total BIGINT NOT NULL DEFAULT 100000000,
  quota_used  BIGINT NOT NULL DEFAULT 0,
  expires_at  TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active   INTEGER DEFAULT 1,
  note        TEXT DEFAULT ''
);

-- Usage Logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id           SERIAL PRIMARY KEY,
  api_key      TEXT NOT NULL,
  model        TEXT DEFAULT 'gpt-4o',
  tokens_in    INTEGER DEFAULT 0,
  tokens_out   INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  req_id       TEXT,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Upstream ChatGPT Accounts (session token pool)
CREATE TABLE IF NOT EXISTS upstream_accounts (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  session_token  TEXT NOT NULL UNIQUE,
  is_active      INTEGER DEFAULT 1,
  total_requests INTEGER DEFAULT 0,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Hotmail Accounts
CREATE TABLE IF NOT EXISTS hotmail_accounts (
  id           SERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  password     TEXT DEFAULT '',
  refreshtoken TEXT DEFAULT '',
  clientid     TEXT DEFAULT '',
  secret2fa    TEXT DEFAULT '',
  state        TEXT DEFAULT 'available',
  takenbyip    TEXT DEFAULT '',
  takenat      TEXT DEFAULT '',
  takennote    TEXT DEFAULT '',
  usedcount    INTEGER DEFAULT 0,
  lastreadat   TEXT DEFAULT '',
  reservedat   TEXT DEFAULT '',
  usedat       TEXT DEFAULT '',
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys (key);
CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key ON usage_logs (api_key);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_hotmail_email ON hotmail_accounts (email);
CREATE INDEX IF NOT EXISTS idx_hotmail_state ON hotmail_accounts (state);
CREATE INDEX IF NOT EXISTS idx_upstream_is_active ON upstream_accounts (is_active);

-- Done!
SELECT 'Migration completed successfully ✓' AS status;
