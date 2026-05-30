'use strict';

require('dotenv').config();
const { initDB } = require('../src/db');
const AccountPool = require('../src/upstream/AccountPool');

async function main() {
  console.log('Initializing DB...');
  await initDB();
  
  console.log('Reloading AccountPool...');
  await AccountPool.reload();
  
  const status = AccountPool.getStatus();
  console.log('Pool Status:', JSON.stringify(status, null, 2));
  
  if (status.length === 0) {
    console.error('No accounts loaded. Exiting.');
    return;
  }
  
  console.log('Sending test message: "Hello, ChatGPT!"...');
  try {
    const response = await AccountPool.chatWithRotation([
      { role: 'user', content: 'Hello, ChatGPT!' }
    ], 'gpt-4o');
    
    console.log('Response Status:', response.status);
    console.log('Response OK:', response.ok);
    console.log('Response Headers:', JSON.stringify([...response.headers.entries()], null, 2));
    
    console.log('Reading body chunk by chunk...');
    const body = response.body;
    let count = 0;
    
    for await (const chunk of body) {
      const text = chunk.toString('utf-8');
      console.log(`CHUNK ${++count}:`, text.substring(0, 100));
      if (count >= 5) {
        console.log('Stopping after 5 chunks.');
        break;
      }
    }
  } catch (err) {
    console.error('CHAT ERROR:', err);
  }
}

main().catch(console.error);
