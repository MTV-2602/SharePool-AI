'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const token = result.rows[0].session_token;
  const parsed = JSON.parse(token);
  console.log('Session Keys:', Object.keys(parsed));
  if (parsed.cookie) {
    console.log('Cookie exists! Length:', parsed.cookie.length);
  }
  if (parsed.accessToken) {
    console.log('accessToken exists!');
  }
  // Let's print the entire JSON structure except very long strings
  const copy = { ...parsed };
  if (copy.accessToken) copy.accessToken = copy.accessToken.substring(0, 20) + '...';
  if (copy.cookie) copy.cookie = copy.cookie.substring(0, 20) + '...';
  console.log('Session structure:', JSON.stringify(copy, null, 2));
  
  await db.end();
}

main().catch(console.error);
