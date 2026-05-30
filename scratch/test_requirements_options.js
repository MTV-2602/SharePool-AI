'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const USER_AGENTS = {
  chrome_windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  chrome_mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  safari_ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chatgpt_ios_app: 'ChatGPT/1.2024.133 (iPhone; iOS 17.5.1; Scale/3.00)'
};

async function testRequirements(name, headers, useHeaderGenerator) {
  const { gotScraping } = await import('got-scraping');
  try {
    const response = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
      headers: headers,
      useHeaderGenerator: useHeaderGenerator,
      json: {}
    });
    
    const data = JSON.parse(response.body);
    console.log(`[${name}] Status: ${response.statusCode}`);
    console.log(`- turnstile: ${data.turnstile ? data.turnstile.required : 'none'}`);
    console.log(`- proofofwork: ${data.proofofwork ? data.proofofwork.required : 'none'} (difficulty: ${data.proofofwork ? data.proofofwork.difficulty : ''})`);
    console.log(`- so: ${data.so ? data.so.required : 'none'}`);
  } catch (err) {
    console.log(`[${name}] FAILED: ${err.message}`);
    if (err.response) {
      console.log(`- Status: ${err.response.statusCode}`);
      console.log(`- Body: ${err.response.body.substring(0, 200)}`);
    }
  }
}

async function main() {
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  const staticDevice = '8f4a39b2-b6db-4d0e-814a-8556d48e1af7';
  
  console.log('--- Testing requirements with various headers ---');
  
  // Test 1: Chrome Windows, static device ID, gotScraping headers
  await testRequirements('Chrome Win + Static Device ID', {
    'Authorization': `Bearer ${accessToken}`,
    'Referer': 'https://chatgpt.com/',
    'Origin': 'https://chatgpt.com',
    'oai-device-id': staticDevice,
    'Cookie': `oai-did=${staticDevice}`,
    'user-agent': USER_AGENTS.chrome_windows
  }, false);

  // Test 2: Chrome Mac, static device ID
  await testRequirements('Chrome Mac + Static Device ID', {
    'Authorization': `Bearer ${accessToken}`,
    'Referer': 'https://chatgpt.com/',
    'Origin': 'https://chatgpt.com',
    'oai-device-id': staticDevice,
    'Cookie': `oai-did=${staticDevice}`,
    'user-agent': USER_AGENTS.chrome_mac
  }, false);

  // Test 3: Safari iOS
  await testRequirements('Safari iOS + Static Device ID', {
    'Authorization': `Bearer ${accessToken}`,
    'Referer': 'https://chatgpt.com/',
    'Origin': 'https://chatgpt.com',
    'oai-device-id': staticDevice,
    'Cookie': `oai-did=${staticDevice}`,
    'user-agent': USER_AGENTS.safari_ios
  }, false);

  // Test 4: ChatGPT iOS App UA
  await testRequirements('ChatGPT iOS App UA', {
    'Authorization': `Bearer ${accessToken}`,
    'oai-device-id': staticDevice,
    'Cookie': `oai-did=${staticDevice}`,
    'user-agent': USER_AGENTS.chatgpt_ios_app
  }, false);

  await db.end();
}

main().catch(err => {
  console.error(err);
  db.end();
});
