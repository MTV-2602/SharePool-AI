// Direct test: try to get access token from JWE session and call Codex Responses API
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const accounts = await pool.query('SELECT id, name, session_token FROM upstream_accounts WHERE is_active = 1 ORDER BY id');
  await pool.end();

  if (accounts.rows.length === 0) {
    console.log('❌ No upstream accounts found');
    return;
  }

  for (const acc of accounts.rows) {
    console.log(`\n=== Testing account: [${acc.id}] ${acc.name} ===`);
    const token = acc.session_token;
    console.log(`Token type: ${token.startsWith('{') ? 'JSON' : token.startsWith('eyJhbGciOiJkaXI') ? 'JWE Session Cookie' : token.startsWith('eyJhbGciOiJSUzI1Ni') ? 'JWT Access Token' : 'Unknown'}`);
    console.log(`Token preview: ${token.slice(0, 80)}...`);

    // Step 1: Try to get access token from session cookie
    if (token.startsWith('eyJhbGciOiJkaXI')) {
      console.log('\n--- Step 1: Getting access token from session cookie ---');
      try {
        const sessionRes = await fetch('https://chatgpt.com/api/auth/session', {
          headers: {
            'Cookie': `__Secure-next-auth.session-token=${token}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://chatgpt.com/',
          },
        });
        console.log(`Session endpoint status: ${sessionRes.status}`);
        const body = await sessionRes.text();
        console.log(`Session response (first 500 chars): ${body.slice(0, 500)}`);

        if (sessionRes.status === 200) {
          try {
            const json = JSON.parse(body);
            if (json.accessToken) {
              console.log(`✅ Got access token! Length: ${json.accessToken.length}`);
              console.log(`Access token preview: ${json.accessToken.slice(0, 60)}...`);

              // Step 2: Try calling Codex Responses API
              console.log('\n--- Step 2: Testing Codex Responses API ---');
              const codexRes = await fetch('https://chatgpt.com/backend-api/codex/responses', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'text/event-stream',
                  'Authorization': `Bearer ${json.accessToken}`,
                  'originator': 'codex_cli_rs',
                  'User-Agent': 'codex-cli/1.0.18 (macOS; arm64)',
                },
                body: JSON.stringify({
                  model: 'gpt-4o',
                  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hello' }] }],
                  instructions: 'You are a helpful assistant.',
                  stream: true,
                  store: false,
                  reasoning: { effort: 'low', summary: 'auto' },
                }),
              });
              console.log(`Codex Responses API status: ${codexRes.status}`);
              const codexBody = await codexRes.text();
              console.log(`Codex response (first 1000 chars): ${codexBody.slice(0, 1000)}`);
            } else {
              console.log('❌ No accessToken in session response');
              console.log('Full response:', body.slice(0, 300));
            }
          } catch (e) {
            console.log('❌ Failed to parse session response:', e.message);
          }
        } else {
          console.log('❌ Session endpoint returned error');
        }
      } catch (err) {
        console.log('❌ Network error:', err.message);
      }
    } else if (token.startsWith('{')) {
      console.log('This is an OAuth JSON token, testing directly...');
      try {
        const wrapper = JSON.parse(token);
        const accessToken = wrapper.accessToken;
        console.log(`Access token preview: ${accessToken?.slice(0, 60) || 'MISSING'}...`);
        
        // Try Codex Responses API
        const codexRes = await fetch('https://chatgpt.com/backend-api/codex/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${accessToken}`,
            'originator': 'codex_cli_rs',
            'User-Agent': 'codex-cli/1.0.18 (macOS; arm64)',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Say hello' }] }],
            instructions: 'You are a helpful assistant.',
            stream: true,
            store: false,
            reasoning: { effort: 'low', summary: 'auto' },
          }),
        });
        console.log(`Codex Responses API status: ${codexRes.status}`);
        const codexBody = await codexRes.text();
        console.log(`Codex response (first 1000 chars): ${codexBody.slice(0, 1000)}`);
      } catch (e) {
        console.log('❌ Error:', e.message);
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
