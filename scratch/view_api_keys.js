'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await db.query('SELECT key, name, is_active FROM api_keys');
  console.log('Total API keys in database:', result.rows.length);
  for (const row of result.rows) {
    console.log(`Name: ${row.name} | Key: ${row.key} | Active: ${row.is_active}`);
  }
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
