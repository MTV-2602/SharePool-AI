'use strict';

const db = require('../src/db');
const fetch = require('node-fetch');

const VERCEL_URL = 'https://vinhcousera.vercel.app';
const ADMIN_KEY = 'admin123';

async function run() {
  try {
    await db.initDB();
    const rows = await db.query('SELECT name, session_token FROM upstream_accounts WHERE is_active = 1 LIMIT 1');
    if (rows.length === 0) {
      console.log('No active accounts in database.');
      return;
    }
    const { name, sessionToken, session_token } = rows[0];
    const finalToken = sessionToken || session_token;
    console.log(`Using account: ${name}`);

    const url = `${VERCEL_URL}/admin-api/accounts/quota?sessionToken=${encodeURIComponent(finalToken)}`;
    console.log(`Fetching: ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-admin-key': ADMIN_KEY,
        'Accept': 'application/json'
      }
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.log('Response body:', body);

  } catch (err) {
    console.error('Request failed:', err);
  } finally {
    process.exit(0);
  }
}

run();
