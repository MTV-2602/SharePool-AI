'use strict';
require('dotenv').config();
const { initDB, query } = require('../src/db');

async function run() {
  try {
    await initDB();
    
    // 1. API Keys details
    const keys = await query(`
      SELECT name, key, quota_total, quota_used, is_active
      FROM api_keys
    `);
    
    console.log('\n=== API KEYS DETAILS ===');
    for (const key of keys) {
      const quotaTotal = Number(key.quotaTotal || 0);
      const quotaUsed = Number(key.quotaUsed || 0);
      const remaining = quotaTotal - quotaUsed;
      console.log(`- Tên: ${key.name}`);
      console.log(`  Key: ${key.key.substring(0, 15)}...`);
      console.log(`  Trạng thái: ${key.isActive === 1 ? 'Hoạt động (Active)' : 'Tắt (Disabled)'}`);
      console.log(`  Tổng Quota: ${quotaTotal.toLocaleString()}`);
      console.log(`  Đã dùng:    ${quotaUsed.toLocaleString()}`);
      console.log(`  Còn lại:    ${remaining.toLocaleString()}`);
      console.log('-----------------------------------');
    }

    // 2. Upstream accounts details
    const upstream = await query(`
      SELECT name, is_active, total_requests
      FROM upstream_accounts
    `);

    console.log('\n=== UPSTREAM CHATGPT ACCOUNTS ===');
    for (const acc of upstream) {
      console.log(`- Tài khoản: ${acc.name}`);
      console.log(`  Trạng thái:  ${acc.isActive === 1 ? 'Hoạt động' : 'Bị tắt'}`);
      console.log(`  Số Requests: ${acc.totalRequests || 0}`);
      console.log('-----------------------------------');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error running script:', err);
    process.exit(1);
  }
}

run();
