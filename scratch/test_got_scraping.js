'use strict';

require('dotenv').config();
const { Pool } = require('pg');
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
  
  console.log('Got-scraping: testing https://chatgpt.com/...');
  try {
    const rootRes = await gotScraping('https://chatgpt.com/');
    console.log('Root Status:', rootRes.statusCode);
  } catch (err) {
    console.error('Root Fetch Failed:', err.message);
  }
  
  console.log('\nGot-scraping: testing /backend-api/models...');
  try {
    const modelsRes = await gotScraping('https://chatgpt.com/backend-api/models', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Referer': 'https://chatgpt.com/',
        'Origin': 'https://chatgpt.com'
      }
    });
    console.log('Models Status:', modelsRes.statusCode);
    console.log('Models Body snippet:', modelsRes.body.substring(0, 500));
  } catch (err) {
    console.error('Models Fetch Failed:', err.message);
    if (err.response) {
      console.log('Status code:', err.response.statusCode);
      console.log('Response body:', err.response.body.substring(0, 1000));
    }
  }
  
  await db.end();
}

main().catch(console.error);
