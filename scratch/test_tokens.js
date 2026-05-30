'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fetch = require('node-fetch');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkToken(email, sessionToken) {
  try {
    const res = await fetch('https://chatgpt.com/api/auth/session', {
      method:  'GET',
      headers: {
        'Cookie':     `__Secure-next-auth.session-token=${sessionToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/json',
        'Referer':    'https://chatgpt.com/',
      },
    });
    
    if (res.status === 200) {
      const json = await res.json();
      if (json && json.accessToken) {
        return { ok: true, email, status: 200, plan: json.user?.plan_type || 'free' };
      }
      return { ok: false, email, status: 200, reason: 'No accessToken in JSON response' };
    }
    
    return { ok: false, email, status: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, email, reason: err.message };
  }
}

async function main() {
  console.log('Connecting to database...');
  const result = await db.query('SELECT name, session_token FROM upstream_accounts');
  console.log(`Found ${result.rows.length} accounts in DB.`);
  
  for (const row of result.rows) {
    console.log(`Checking token for ${row.name}...`);
    const status = await checkToken(row.name, row.session_token);
    console.log(JSON.stringify(status, null, 2));
  }
  
  await db.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
