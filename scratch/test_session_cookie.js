'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['CodexAcc-698499']);
  if (res.rows.length === 0) {
    console.error('No CodexAcc-698499 account found.');
    await db.end();
    return;
  }
  const sessionToken = res.rows[0].session_token.trim();
  console.log('Using JWE Cookie (first 20 chars):', sessionToken.substring(0, 20));
  
  console.log('\n--- Fetching from api/auth/session ---');
  try {
    const response = await gotScraping.get('https://chatgpt.com/api/auth/session', {
      headers: {
        'Cookie': `__Secure-next-auth.session-token=${sessionToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://chatgpt.com/',
      },
      useHeaderGenerator: false
    });
    console.log('Status Code:', response.statusCode);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));
    console.log('Body:', response.body);
  } catch (err) {
    console.error('Fetch Failed:', err.message);
    if (err.response) {
      console.log('Status Code:', err.response.statusCode);
      console.log('Headers:', JSON.stringify(err.response.headers, null, 2));
      console.log('Body:', err.response.body);
    }
  }
  
  await db.end();
}

main().catch(console.error);
