-- ============================================================
-- CodeX Portal — Supabase Migration v2 (ALTER existing tables)
-- Run this if tables already exist from v1
-- ============================================================

-- Add updated_at column to upstream_accounts (if not exists)
ALTER TABLE upstream_accounts 
  ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT CURRENT_TIMESTAMP;

-- Create chatgpt_credentials table (if not exists)
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

-- Add UNIQUE constraint on session_token (if not already unique)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'upstream_accounts_session_token_key'
      AND conrelid = 'upstream_accounts'::regclass
  ) THEN
    ALTER TABLE upstream_accounts ADD CONSTRAINT upstream_accounts_session_token_key UNIQUE (session_token);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Already exists or other issue, skip
  NULL;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_upstream_is_active ON upstream_accounts (is_active);
CREATE INDEX IF NOT EXISTS idx_upstream_session_token ON upstream_accounts (session_token);

SELECT 'Migration v2 completed ✓' AS status;
