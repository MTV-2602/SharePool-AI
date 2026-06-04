'use strict';
require('dotenv').config();
const { initDB, query } = require('../src/db');
const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');
const fetch = require('node-fetch');

async function run() {
  try {
    await initDB();

    const accounts = await query(`
      SELECT name, session_token 
      FROM upstream_accounts 
      WHERE is_active = 1
    `);

    console.log(`\nFound ${accounts.length} active upstream accounts. Checking plans...`);

    let plusCount = 0;
    let freeCount = 0;
    let unknownCount = 0;

    for (const acc of accounts) {
      const token = acc.sessionToken;
      if (!token) continue;

      const client = new ChatGPTClient(token);
      try {
        const accessToken = await client.getAccessToken();
        const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });

        if (res.ok) {
          const data = await res.json();
          const plan = data.plan_type || data.summary?.plan || 'unknown';
          console.log(`- Acc [${acc.name}]: Plan = ${plan}`);
          if (plan.toLowerCase().includes('plus') || plan.toLowerCase().includes('pro') || plan.toLowerCase().includes('premium')) {
            plusCount++;
          } else {
            freeCount++;
          }
        } else {
          console.log(`- Acc [${acc.name}]: Failed to check (HTTP ${res.status}). Treating as Free.`);
          freeCount++;
        }
      } catch (err) {
        console.log(`- Acc [${acc.name}]: Error fetching plan (${err.message}). Treating as Free.`);
        freeCount++;
      }
    }

    // 1. Calculate available token capacity
    const plusCapacity = plusCount * 76800000;
    const freeCapacity = freeCount * 9600000;
    const totalCapacity = plusCapacity + freeCapacity;

    // 2. Query keys quota
    const keys = await query(`
      SELECT SUM(quota_total) as sum_quota_total
      FROM api_keys
      WHERE is_active = 1
    `);
    const allocatedQuota = Number(keys[0]?.sum_quota_total || 0);

    const remainingToSell = totalCapacity - allocatedQuota;

    console.log('\n=== LIVE CAPACITY REPORT ===');
    console.log(`Plus Accounts: ${plusCount}`);
    console.log(`Free Accounts: ${freeCount}`);
    console.log(`Total Upstream Pool Capacity: ${totalCapacity.toLocaleString()} tokens/month`);
    console.log(`Allocated Quota on Active Keys: ${allocatedQuota.toLocaleString()} tokens`);
    console.log(`-------------------------------------------`);
    console.log(`Concrete Remaining Tokens to Sell: ${remainingToSell.toLocaleString()} tokens/month`);

    process.exit(0);
  } catch (err) {
    console.error('Error running script:', err);
    process.exit(1);
  }
}

run();
