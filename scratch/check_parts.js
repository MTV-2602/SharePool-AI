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
    const parts = token.split('.');
    console.log(`Account: ${row.name}`);
    console.log(`Number of parts: ${parts.length}`);
    parts.forEach((part, i) => {
      console.log(`Part ${i+1}: length=${part.length}, prefix=${part.substring(0, 10)}`);
    });
  }
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
