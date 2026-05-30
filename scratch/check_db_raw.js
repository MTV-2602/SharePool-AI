// Check raw DB data
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Check all accounts without filtering
  console.log('=== ALL upstream_accounts (no filter) ===');
  const all = await pool.query('SELECT id, name, is_active, LEFT(session_token, 80) as token_preview FROM upstream_accounts ORDER BY id');
  console.log(`Total rows: ${all.rows.length}`);
  for (const row of all.rows) {
    console.log(`  [${row.id}] ${row.name} | is_active=${JSON.stringify(row.is_active)} (type: ${typeof row.is_active}) | token: ${row.token_preview}...`);
  }

  // Check with is_active = 1
  console.log('\n=== With is_active = 1 ===');
  const active1 = await pool.query('SELECT id, name FROM upstream_accounts WHERE is_active = 1');
  console.log(`Rows: ${active1.rows.length}`);

  // Check with is_active = true
  console.log('\n=== With is_active = true ===');
  const activeTrue = await pool.query('SELECT id, name FROM upstream_accounts WHERE is_active = $1', [true]);
  console.log(`Rows: ${activeTrue.rows.length}`);

  // Check column type
  console.log('\n=== Column info for upstream_accounts ===');
  const colInfo = await pool.query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'upstream_accounts' 
    ORDER BY ordinal_position
  `);
  for (const col of colInfo.rows) {
    console.log(`  ${col.column_name}: ${col.data_type} (default: ${col.column_default})`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
