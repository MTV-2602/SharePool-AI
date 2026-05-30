'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await db.query('SELECT name, session_token FROM upstream_accounts');
  for (const row of result.rows) {
    const token = row.session_token || '';
    console.log(`Account: ${row.name}`);
    console.log(`Token length: ${token.length}`);
    console.log(`Starts with: ${token.substring(0, 15)}...`);
    console.log(`Ends with: ...${token.substring(token.length - 15)}`);
    
    // Check if it looks like a JWT
    const parts = token.split('.');
    console.log(`Number of JWT parts: ${parts.length}`);
    if (parts.length === 3) {
      try {
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        const parsed = JSON.parse(payload);
        console.log('Decoded payload info:');
        console.log(`- exp: ${parsed.exp} (${new Date(parsed.exp * 1000).toISOString()})`);
        console.log(`- email: ${parsed.https?.['https://api.openai.com/profile']?.email}`);
        console.log(`- plan: ${parsed.https?.['https://api.openai.com/auth']?.chatgpt_plan_type}`);
      } catch (err) {
        console.log(`Failed to decode JWT payload: ${err.message}`);
      }
    }
  }
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
