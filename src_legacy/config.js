const path = require('path');
const fs = require('fs');

// Load .env
try { require('dotenv').config(); } catch {}

const isVercel = !!process.env.VERCEL;
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = isVercel ? '/tmp' : path.join(ROOT_DIR, 'data');
const ACCOUNTS_FILE = isVercel ? '/tmp/accounts.json' : path.join(ROOT_DIR, 'accounts.json');
const SETTINGS_FILE = isVercel ? '/tmp/settings.json' : path.join(DATA_DIR, 'settings.json');

if (isVercel) {
  try {
    const srcAccounts = path.join(ROOT_DIR, 'accounts.json');
    if (fs.existsSync(srcAccounts) && !fs.existsSync(ACCOUNTS_FILE)) {
      fs.copyFileSync(srcAccounts, ACCOUNTS_FILE);
    }
  } catch (err) {
    console.error('Failed to copy initial files to /tmp:', err.message);
  }
}

// Load dynamic settings
let dynamicSettings = {};
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    dynamicSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  }
} catch (e) {
  console.error('Failed to load dynamic settings:', e.message);
}

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env variable: ${key}`);
  return val;
}

function optional(key, defaultVal) {
  if (dynamicSettings[key] !== undefined && dynamicSettings[key] !== '') {
    return dynamicSettings[key];
  }
  return process.env[key] || defaultVal;
}

const config = {
  // Server
  PORT:     parseInt(optional('PORT', '3040'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
  isProd:   optional('NODE_ENV', 'development') === 'production',

  // Admin
  ADMIN_KEY: optional('ADMIN_KEY', 'admin-change-me'),

  // Site
  SITE_NAME: optional('SITE_NAME', 'My API Portal'),

  // Upstream
  UPSTREAM_TIMEOUT_MS: parseInt(optional('UPSTREAM_TIMEOUT_MS', '60000'), 10),

  // Paths
  ROOT_DIR,
  DATA_DIR,
  ACCOUNTS_FILE,
  SETTINGS_FILE,

  // Hotmail & Coursera & Telegram integration
  TELEGRAM_BOT_TOKEN:        optional('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN'),
  TELEGRAM_WEBHOOK_SECRET:   optional('TELEGRAM_WEBHOOK_SECRET', 'YOUR_TELEGRAM_WEBHOOK_SECRET'),
  EXTENSION_PUSH_TOKEN:      optional('EXTENSION_PUSH_TOKEN', 'YOUR_EXTENSION_PUSH_TOKEN'),
  BOT_INTERNAL_TOKEN:        optional('BOT_INTERNAL_TOKEN', 'YOUR_BOT_INTERNAL_TOKEN'),
  COURSERA_SHEET_SCRIPT_URL: optional('COURSERA_SHEET_SCRIPT_URL', 'YOUR_COURSERA_SHEET_SCRIPT_URL'),
  ADMIN_EMAIL:               optional('ADMIN_EMAIL', 'admin@example.com'),
  ADMIN_PASSWORD:            optional('ADMIN_PASSWORD', 'changeme'),
  ALLOWED_USER_IDS:          optional('ALLOWED_USER_IDS', 'YOUR_ALLOWED_USER_IDS')
                               .split(',')
                               .map(id => parseInt(id.trim(), 10))
                               .filter(id => !isNaN(id)),

  // AntiGravity Google OAuth credentials
  ANTIGRAVITY_CLIENT_ID:     optional('ANTIGRAVITY_CLIENT_ID', 'YOUR_ANTIGRAVITY_CLIENT_ID'),
  ANTIGRAVITY_CLIENT_SECRET: optional('ANTIGRAVITY_CLIENT_SECRET', 'YOUR_ANTIGRAVITY_CLIENT_SECRET'),
};

// Warn if using default admin key
if (config.ADMIN_KEY === 'admin-change-me' || config.ADMIN_KEY === 'change-this-admin-key-immediately') {
  console.warn('\x1b[33m⚠  WARNING: Using default ADMIN_KEY — please set a secure key in .env!\x1b[0m');
}

module.exports = config;
