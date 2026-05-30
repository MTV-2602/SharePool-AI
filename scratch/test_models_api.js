'use strict';

require('dotenv').config();
const fetch = require('node-fetch');
const { Pool } = require('pg');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  
  // Parse
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  console.log('Sending request to /backend-api/models using accessToken...');
  const response = await fetch('https://chatgpt.com/backend-api/models', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://chatgpt.com/',
      'Origin': 'https://chatgpt.com'
    }
  });
  
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Body snippet:', text.substring(0, 1000));
  
  await db.end();
}

main().catch(console.error);
