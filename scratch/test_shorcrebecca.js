'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['shorcrebecca@outlook.com']);
  if (res.rows.length === 0) {
    console.error('No shorcrebecca@outlook.com account found.');
    await db.end();
    return;
  }
  const accessToken = res.rows[0].session_token.trim();
  console.log('Using Token (first 20 chars):', accessToken.substring(0, 20));
  
  console.log('\n--- Test 1: GET backend-api/models ---');
  try {
    const modelsRes = await gotScraping('https://chatgpt.com/backend-api/models', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Referer': 'https://chatgpt.com/',
        'Origin': 'https://chatgpt.com'
      }
    });
    console.log('Models Status:', modelsRes.statusCode);
    console.log('Models Body snippet:', modelsRes.body.substring(0, 300));
  } catch (err) {
    console.error('Models Fetch Failed:', err.message);
    if (err.response) {
      console.log('Status code:', err.response.statusCode);
      console.log('Response body:', err.response.body);
    }
  }
  
  console.log('\n--- Test 2: POST backend-api/codex/responses ---');
  try {
    const body = {
      model: 'gpt-4o',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
      instructions: 'You are a helpful assistant.',
      stream: false,
      store: false,
      reasoning: { effort: 'low', summary: 'auto' }
    };
    
    const responsesRes = await gotScraping.post('https://chatgpt.com/backend-api/codex/responses', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'originator': 'codex_cli_rs',
        'User-Agent': 'codex-cli/1.0.18 (macOS; arm64)',
        'session_id': 'test-session-123'
      },
      json: body
    });
    console.log('Responses Status:', responsesRes.statusCode);
    console.log('Responses Body snippet:', responsesRes.body.substring(0, 300));
  } catch (err) {
    console.error('Responses Fetch Failed:', err.message);
    if (err.response) {
      console.log('Status code:', err.response.statusCode);
      console.log('Response body:', err.response.body);
    }
  }
  
  await db.end();
}

main().catch(console.error);
