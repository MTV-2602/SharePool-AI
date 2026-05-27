// src/db/index.js — Hybrid Database Client (PostgreSQL / SQLite fallback)
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

let _pgPool = null;
let _sqliteDb = null;
let _isPostgres = false;

// Ensure local data dir exists
if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}
const LOCAL_DB_FILE = path.join(config.DATA_DIR, 'portal.db');

// Schema Definition (compatible with both PostgreSQL and SQLite via adapter)
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
  req_id: 'reqId'
};

function mapRowKeys(row) {
  if (!row) return row;
  const mapped = {};
  for (const [k, v] of Object.entries(row)) {
    const targetKey = KEY_MAPS[k.toLowerCase()] || k;
    // SQLite can store numbers as number/string, coerce count columns if needed
    mapped[targetKey] = v;
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

  if (dbUrl && dbUrl.startsWith('postgres')) {
    console.log('📡 [Database] Connecting to Cloud PostgreSQL...');
    const { Pool } = require('pg');
    _pgPool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    _isPostgres = true;

    // Run Schema setup
    const pgSchema = sqliteToPostgres(SCHEMA);
    await _pgPool.query(pgSchema);
    console.log('✅ [Database] PostgreSQL connected and schema initialized.');
  } else if (process.env.VERCEL || process.env.NOW_REGION) {
    // On Vercel serverless, SQLite file system is read-only — require Postgres
    throw new Error(
      '❌ DATABASE_URL is not set! Set it in Vercel Dashboard → Settings → Environment Variables.\n' +
      'Value: postgresql://postgres:PASSWORD@db.eslfxpccttexenmsybbq.supabase.co:5432/postgres'
    );
  } else {
    // Local dev fallback: SQLite
    console.log('💾 [Database] DATABASE_URL not set. Falling back to local SQLite...');
    try {
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();

      if (fs.existsSync(LOCAL_DB_FILE)) {
        const buf = fs.readFileSync(LOCAL_DB_FILE);
        _sqliteDb = new SQL.Database(buf);
      } else {
        _sqliteDb = new SQL.Database();
      }

      let sqliteSchema = SCHEMA
        .replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
        .replace(/BIGINT/gi, 'INTEGER')
        .replace(/CURRENT_TIMESTAMP/gi, "datetime('now', 'localtime')");

      _sqliteDb.run(sqliteSchema);
      _saveSqlite();
      console.log(`✅ [Database] SQLite initialized at: ${LOCAL_DB_FILE}`);
    } catch (sqliteErr) {
      console.error('⚠️  SQLite fallback failed:', sqliteErr.message);
      throw new Error('No database available. Set DATABASE_URL environment variable.');
    }
  }
}


function _saveSqlite() {
  if (!_sqliteDb) return;
  fs.writeFileSync(LOCAL_DB_FILE, Buffer.from(_sqliteDb.export()));
}

// Unified Async Query Methods
async function query(sql, params = []) {
  if (_isPostgres) {
    const pgSql = sqliteToPostgres(sql);
    const res = await _pgPool.query(pgSql, params);
    return res.rows.map(mapRowKeys);
  } else {
    const stmt = _sqliteDb.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(mapRowKeys(stmt.getAsObject()));
    }
    stmt.free();
    return rows;
  }
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function run(sql, params = []) {
  if (_isPostgres) {
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
  } else {
    _sqliteDb.run(sql, params);
    const lastInsertRowid = _sqliteDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? null;
    const changes         = _sqliteDb.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0;
    _saveSqlite();
    return { lastInsertRowid, changes };
  }
}

async function exec(sql) {
  if (_isPostgres) {
    const pgSql = sqliteToPostgres(sql);
    await _pgPool.query(pgSql);
  } else {
    _sqliteDb.exec(sql);
    _saveSqlite();
  }
}

module.exports = { initDB, query, get, run, exec, isPostgres: () => _isPostgres };
