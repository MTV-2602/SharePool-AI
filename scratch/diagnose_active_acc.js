'use strict';

const db = require('../src/db');
const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');
const fetch = require('node-fetch');

async function run() {
  try {
    await db.initDB();
    const rows = await db.query('SELECT name, session_token FROM upstream_accounts WHERE is_active = 1 LIMIT 1');
    if (rows.length === 0) {
      console.log('No active accounts in database.');
      return;
    }
    const { name, sessionToken, session_token } = rows[0];
    const finalToken = sessionToken || session_token;
    console.log(`Diagnosing account: ${name}`);
    console.log(`Session Token stored length: ${finalToken ? finalToken.length : 0}`);
    console.log(`Raw Session Token: ${finalToken}`);

    const client = new ChatGPTClient(finalToken);
    
    console.log('Fetching access token...');
    const accessToken = await client.getAccessToken();
    console.log('Success! Access Token retrieved:', accessToken.slice(0, 30) + '...');

    const parts = accessToken.split('.');
    if (parts.length >= 2) {
      try {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        console.log('Access Token Payload:', JSON.stringify(payload, null, 2));
      } catch (e) {
        console.log('Error decoding JWT payload:', e.message);
      }
    }

    console.log('Fetching Wham API usage info...');
    const usageResponse = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    console.log(`Wham API Status: ${usageResponse.status} ${usageResponse.statusText}`);
    const body = await usageResponse.text();
    console.log('Wham API Body:', body);

  } catch (err) {
    console.error('Diagnosis failed with error:', err);
  } finally {
    process.exit(0);
  }
}

run();
