// src/db/index.js — sql.js wrapper with synchronous interface after async init
'use strict';

const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');
const config    = require('../config');

// Ensure data directory exists
if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

const DB_FILE = path.join(config.DATA_DIR, 'portal.db');

let _db = null;

// ─── Schema ─────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL DEFAULT 'Unnamed',
    quota_total INTEGER NOT NULL DEFAULT 100000000,
    quota_used  INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT,
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
    is_active   INTEGER DEFAULT 1,
    note        TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key      TEXT NOT NULL,
    model        TEXT DEFAULT 'gpt-4o',
    tokens_in    INTEGER DEFAULT 0,
    tokens_out   INTEGER DEFAULT 0,
    tokens_total INTEGER DEFAULT 0,
    req_id       TEXT,
    created_at   TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS upstream_accounts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    session_token  TEXT NOT NULL,
    is_active      INTEGER DEFAULT 1,
    total_requests INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS hotmail_accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_usage_key  ON usage_logs(api_key);
  CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_keys_active ON api_keys(is_active);
  CREATE INDEX IF NOT EXISTS idx_hotmail_state ON hotmail_accounts(state);
  CREATE INDEX IF NOT EXISTS idx_hotmail_email ON hotmail_accounts(email);
`;

// ─── Init ────────────────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }

  _db.run(SCHEMA);
  _save();
}

// ─── Save to disk ────────────────────────────────────────────────
function _save() {
  if (!_db) return;
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

// ─── Helpers ─────────────────────────────────────────────────────
function _assertReady() {
  if (!_db) throw new Error('Database not initialized — call initDB() first');
}

/**
 * Execute SELECT, return all rows as objects
 */
function query(sql, params = []) {
  _assertReady();
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * Execute SELECT, return first row or null
 */
function get(sql, params = []) {
  return query(sql, params)[0] ?? null;
}

/**
 * Execute INSERT/UPDATE/DELETE — saves DB to disk after each write
 * Returns { lastInsertRowid, changes }
 */
function run(sql, params = []) {
  _assertReady();
  _db.run(sql, params);
  const lastInsertRowid = _db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? null;
  const changes         = _db.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0;
  _save();
  return { lastInsertRowid, changes };
}

/**
 * Execute multiple SQL statements (no params, no return)
 */
function exec(sql) {
  _assertReady();
  _db.exec(sql);
  _save();
}

module.exports = { initDB, query, get, run, exec };
