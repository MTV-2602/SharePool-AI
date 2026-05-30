'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  console.log('Sending request...');
  const response = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Referer': 'https://chatgpt.com/',
      'Origin': 'https://chatgpt.com',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    },
    json: {}
  });
  
  console.log('Response Status:', response.statusCode);
  console.log('Request headers actually sent by got-scraping:');
  console.log(response.request.options.headers);
  
  await db.end();
}

main().catch(console.error);
