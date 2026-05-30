'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  
  // Parse
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  console.log('Got-scraping: calling chat-requirements...');
  try {
    const response = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Referer': 'https://chatgpt.com/',
        'Origin': 'https://chatgpt.com',
        'Content-Type': 'application/json'
      },
      json: {}
    });
    
    fs.writeFileSync('scratch/requirements_output.json', response.body, 'utf-8');
    console.log('Saved to scratch/requirements_output.json. Status:', response.statusCode);
  } catch (err) {
    console.error('Failed:', err.message);
    if (err.response) {
      console.log('Status code:', err.response.statusCode);
      fs.writeFileSync('scratch/requirements_output.json', err.response.body, 'utf-8');
    }
  }
  
  await db.end();
}

main().catch(console.error);
