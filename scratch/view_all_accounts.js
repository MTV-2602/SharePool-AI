'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const result = await db.query('SELECT id, name, created_at, is_active FROM upstream_accounts ORDER BY id DESC');
  console.log('Total accounts in database:', result.rows.length);
  for (const row of result.rows) {
    console.log(`ID: ${row.id} | Name: ${row.name} | Created At: ${row.created_at} | Active: ${row.is_active}`);
  }
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
