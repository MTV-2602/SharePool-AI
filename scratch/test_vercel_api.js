// Test API call to the deployed Vercel server
'use strict';

const API_BASE = 'https://vinhcousera.vercel.app';
const API_KEY = 'sk-d0203e7fc89aef139';  // Will be filled after checking

async function testChatCompletions() {
  console.log('=== Testing POST /v1/chat/completions (streaming) ===');
  console.log(`URL: ${API_BASE}/v1/chat/completions`);
  
  try {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Hello, say "test ok" in 3 words' }
        ],
        stream: true,
      }),
    });

    console.log(`Status: ${response.status}`);
    console.log('Headers:', Object.fromEntries(response.headers.entries()));

    const text = await response.text();
    console.log('Response body (first 2000 chars):');
    console.log(text.slice(0, 2000));
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

async function testHealth() {
  console.log('=== Testing GET /health ===');
  const response = await fetch(`${API_BASE}/health`);
  const json = await response.json();
  console.log('Health:', json);
}

async function main() {
  await testHealth();
  console.log('');
  
  // First get the full API key from DB
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const keys = await pool.query('SELECT key FROM api_keys WHERE is_active = 1 LIMIT 1');
  await pool.end();
  
  if (keys.rows.length === 0) {
    console.log('❌ No API keys found!');
    return;
  }
  
  const fullKey = keys.rows[0].key;
  console.log(`Using API key: ${fullKey.slice(0, 20)}...`);
  
  // Override the key
  const API_KEY_FULL = fullKey;
  
  console.log('\n=== Testing POST /v1/chat/completions (streaming) ===');
  console.log(`URL: ${API_BASE}/v1/chat/completions`);
  
  try {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY_FULL}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Hello, say "test ok" in 3 words' }
        ],
        stream: true,
      }),
    });

    console.log(`Status: ${response.status}`);
    
    const text = await response.text();
    console.log('Response body (first 2000 chars):');
    console.log(text.slice(0, 2000));
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
