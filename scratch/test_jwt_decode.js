'use strict';

require('dotenv').config();
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
  
  const parts = accessToken.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  console.log('Decoded Payload Keys:', Object.keys(payload));
  console.log('Payload Content:', JSON.stringify(payload, null, 2));
  
  await db.end();
}

main().catch(console.error);
