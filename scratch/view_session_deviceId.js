'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await db.query('SELECT name, session_token, created_at FROM upstream_accounts');
  for (const row of result.rows) {
    console.log(`Account: ${row.name}`);
    console.log(`- Created at: ${row.created_at || 'unknown'}`);
    try {
      const obj = JSON.parse(row.session_token);
      console.log(`- Stored keys: ${Object.keys(obj)}`);
      console.log(`- Stored deviceId: ${obj.deviceId || 'NOT FOUND'}`);
    } catch (_) {
      console.log(`- Token is not JSON (length: ${row.session_token.length})`);
    }
  }
  await db.end();
}

main().catch(console.error);
