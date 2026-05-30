'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const body = {
  action: 'next',
  messages: [
    {
      id: crypto.randomUUID(),
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Hello! Reply with exactly "TEST SUCCEEDED".'] },
      metadata: {}
    }
  ],
  model: 'gpt-4o',
  parent_message_id: crypto.randomUUID(),
  history_and_training_disabled: true,
  conversation_mode: { kind: 'primary_assistant' },
  force_paragen: false,
  force_paragen_model_slug: '',
  force_nulligen: false,
  force_rate_limit: false
};

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  
  // Parse
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  console.log('Sending streaming request using gotScraping.stream...');
  
  const stream = gotScraping.stream('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Referer': 'https://chatgpt.com/',
      'Origin': 'https://chatgpt.com'
    },
    json: body
  });
  
  console.log('Listening to stream data events...');
  
  stream.on('data', chunk => {
    console.log('CHUNK:', chunk.toString('utf-8').substring(0, 100));
  });
  
  stream.on('end', () => {
    console.log('Stream ended successfully.');
    db.end();
  });
  
  stream.on('error', err => {
    console.error('Stream error:', err.message);
    db.end();
  });
}

main().catch(err => {
  console.error(err);
  db.end();
});
