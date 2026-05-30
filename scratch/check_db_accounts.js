// Check upstream accounts in the database
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('=== Upstream Accounts ===');
  const accounts = await pool.query('SELECT id, name, is_active, total_requests, LEFT(session_token, 80) as token_preview FROM upstream_accounts ORDER BY id');
  if (accounts.rows.length === 0) {
    console.log('❌ KHÔNG CÓ TÀI KHOẢN UPSTREAM NÀO TRONG DATABASE!');
    console.log('   Bạn cần thêm tài khoản qua Extension OAuth hoặc Admin Panel.');
  } else {
    for (const row of accounts.rows) {
      console.log(`  [${row.id}] ${row.name} | active=${row.is_active} | requests=${row.total_requests}`);
      console.log(`      token: ${row.token_preview}...`);
    }
  }

  console.log('\n=== API Keys ===');
  const keys = await pool.query('SELECT id, key, name, is_active, quota_total, quota_used FROM api_keys ORDER BY id');
  if (keys.rows.length === 0) {
    console.log('❌ KHÔNG CÓ API KEY NÀO!');
  } else {
    for (const row of keys.rows) {
      console.log(`  [${row.id}] ${row.name} | key=${row.key.slice(0, 20)}... | active=${row.is_active} | used=${row.quota_used}/${row.quota_total}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
