'use strict';

require('dotenv').config();
const app = require('../server');
const { Pool } = require('pg');

async function main() {
  // 1. Get an active API key from the DB
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const keysRes = await pool.query('SELECT key FROM api_keys WHERE is_active = 1 LIMIT 1');
  await pool.end();

  if (keysRes.rows.length === 0) {
    console.error('❌ No active API key found in the database. Please add one first.');
    process.exit(1);
  }

  const apiKey = keysRes.rows[0].key;
  console.log(`Using API Key: ${apiKey.slice(0, 20)}...`);

  // 2. Start the local server
  const server = app.listen(3099, async () => {
    console.log('🚀 Local test server running on port 3099');

    try {
      // 3. Make POST request to local /v1/responses
      console.log('Sending request to http://localhost:3099/v1/responses...');
      const response = await fetch('http://localhost:3099/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say "hello world" in 2 words.' }] }],
          instructions: 'You are a helpful assistant.',
          stream: true,
        }),
      });

      console.log(`Response status: ${response.status}`);
      console.log('Headers:', Object.fromEntries(response.headers.entries()));

      if (response.status !== 200) {
        const bodyText = await response.text();
        console.error('❌ Error response body:', bodyText);
        server.close();
        process.exit(1);
      }

      // 4. Stream output
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunkStr = decoder.decode(value);
        console.log('--- CHUNK START ---');
        console.log(chunkStr);
        console.log('--- CHUNK END ---');
      }

      console.log('✅ Stream completed successfully');
    } catch (err) {
      console.error('❌ Test failed with error:', err);
    } finally {
      server.close();
      console.log('Server shut down');
    }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
