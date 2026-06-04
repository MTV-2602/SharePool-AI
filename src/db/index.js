const pg = require('pg');
// Parse PostgreSQL BIGINT (int8) columns as JavaScript Numbers
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => parseInt(value, 10));

const { Pool } = pg;
const config = require('../config');

let _pgPool = null;

// Schema Definition (PostgreSQL)
const SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS upstream_accounts (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    session_token  TEXT NOT NULL,
    is_active      INTEGER DEFAULT 1,
    total_requests INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
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
`;

// Helper map to transform lowercase pg columns back to camelCase properties for JavaScript models
const KEY_MAPS = {
  refreshtoken: 'refreshToken',
  clientid: 'clientId',
  secret2fa: 'secret2fa',
  takenbyip: 'takenByIp',
  takenat: 'takenAt',
  takennote: 'takenNote',
  usedcount: 'usedCount',
  lastreadat: 'lastReadAt',
  reservedat: 'reservedAt',
  usedat: 'usedAt',
  quota_total: 'quotaTotal',
  quota_used: 'quotaUsed',
  expires_at: 'expiresAt',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  session_token: 'sessionToken',
  is_active: 'isActive',
  total_requests: 'totalRequests',
  api_key: 'apiKey',
  tokens_in: 'tokensIn',
  tokens_out: 'tokensOut',
  tokens_total: 'tokensTotal',
  req_id: 'reqId',
  last_error: 'lastError'
};

function mapRowKeys(row) {
  if (!row) return row;
  const mapped = {};
  for (const [k, v] of Object.entries(row)) {
    mapped[KEY_MAPS[k.toLowerCase()] || k] = v;
  }
  return mapped;
}

// Convert SQLite query syntax with '?' placeholders to PostgreSQL '$1', '$2' placeholders
function sqliteToPostgres(sql) {
  let pgSql = sql;
  
  // Replace SQLite datetimes
  pgSql = pgSql.replace(/datetime\('now',\s*'localtime'\)/gi, 'CURRENT_TIMESTAMP');
  pgSql = pgSql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  
  // Replace SQLite dates
  pgSql = pgSql.replace(/date\('now',\s*'-30 days',\s*'localtime'\)/gi, "(CURRENT_DATE - INTERVAL '30 days')");
  pgSql = pgSql.replace(/date\('now',\s*'-30 days'\)/gi, "(CURRENT_DATE - INTERVAL '30 days')");
  pgSql = pgSql.replace(/date\('now',\s*'localtime'\)/gi, "CURRENT_DATE");
  pgSql = pgSql.replace(/date\('now'\)/gi, "CURRENT_DATE");
  
  // Convert sqlite INTEGER PRIMARY KEY AUTOINCREMENT
  pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  
  // Convert '?' to '$1, $2, ...'
  let index = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${index++}`);
  
  return pgSql;
}

// Initialize Database
async function initDB() {
  const dbUrl = process.env.DATABASE_URL || config.DATABASE_URL;

  if (!dbUrl) {
    throw new Error('❌ DATABASE_URL environment variable is missing! Database connection cannot be established.');
  }

  console.log('📡 [Database] Connecting to Cloud PostgreSQL...');
  _pgPool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Run lightweight connectivity check instead of heavy DDL schema setup
  await _pgPool.query('SELECT 1');
  await _pgPool.query('ALTER TABLE upstream_accounts ADD COLUMN IF NOT EXISTS last_error TEXT');
  console.log('✅ [Database] PostgreSQL connected successfully.');
}

// Unified Async Query Methods
async function query(sql, params = []) {
  const pgSql = sqliteToPostgres(sql);
  const res = await _pgPool.query(pgSql, params);
  return res.rows.map(mapRowKeys);
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function run(sql, params = []) {
  let pgSql = sqliteToPostgres(sql);
  const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT INTO');
  
  // Auto-append RETURNING id for PG inserts to mimic SQLite's lastInsertRowid
  if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
    pgSql += ' RETURNING id';
  }

  const res = await _pgPool.query(pgSql, params);
  const lastInsertRowid = res.rows[0]?.id || null;
  const changes = res.rowCount || 0;
  return { lastInsertRowid, changes };
}

async function exec(sql) {
  const pgSql = sqliteToPostgres(sql);
  await _pgPool.query(pgSql);
}

module.exports = { 
  initDB, 
  query, 
  get, 
  run, 
  exec, 
  isPostgres: () => true 
};
