// test-db.js — Chạy: node test-db.js để kiểm tra kết nối Supabase
'use strict';
require('dotenv').config();

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('❌ Chưa set DATABASE_URL hoặc vẫn còn placeholder [YOUR-PASSWORD] trong .env');
  process.exit(1);
}

console.log('🔄 Đang kết nối tới Supabase...');
const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW() as time, current_database() as db')
  .then(res => {
    const { time, db } = res.rows[0];
    console.log(`✅ Kết nối thành công!`);
    console.log(`   Database: ${db}`);
    console.log(`   Server time: ${time}`);
    pool.end();
  })
  .catch(err => {
    console.error('❌ Kết nối thất bại:', err.message);
    pool.end();
    process.exit(1);
  });
