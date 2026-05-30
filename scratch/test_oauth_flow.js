'use strict';

require('dotenv').config();
const { initDB, query, run } = require('../src/db');
const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');

async function main() {
  console.log('Initializing DB...');
  await initDB();

  // Create expired mock JWT
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64').replace(/=/g, '');
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 300 })).toString('base64').replace(/=/g, '');
  const mockExpiredJwt = `eyJhbGciOiJSUzI1Ni.${expiredPayload}.signature`;

  const initialWrapper = {
    accessToken: mockExpiredJwt,
    refreshToken: 'mock_refresh_token_123',
    deviceId: 'mock_device_456'
  };

  const accountName = 'MockOAuthTestAccount';
  const initialWrapperStr = JSON.stringify(initialWrapper);

  console.log('Cleaning up any old test accounts...');
  await run('DELETE FROM upstream_accounts WHERE name = ?', [accountName]);

  console.log('Inserting mock expired OAuth account into DB...');
  await run(
    'INSERT INTO upstream_accounts (name, session_token, is_active, total_requests) VALUES (?, ?, 1, 0)',
    [accountName, initialWrapperStr]
  );

  // Setup got-scraping mock using dynamic import
  const gotScrapingModule = await import('got-scraping');
  const gotScraping = gotScrapingModule.gotScraping;
  const originalPost = gotScraping.post;

  let refreshCalled = false;
  let freshJwt = '';

  gotScraping.post = async (url, options) => {
    if (url === 'https://auth.openai.com/oauth/token') {
      console.log('   [MOCK] Intercepted call to OpenAI OAuth token exchange!');
      refreshCalled = true;
      
      const freshPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64').replace(/=/g, '');
      freshJwt = `eyJhbGciOiJSUzI1Ni.${freshPayload}.signature`;
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          access_token: freshJwt,
          refresh_token: 'new_mock_refresh_token_789'
        })
      };
    }
    return originalPost.call(gotScraping, url, options);
  };

  try {
    console.log('Initializing ChatGPTClient with expired wrapper string...');
    const client = new ChatGPTClient(initialWrapperStr);

    console.log('Calling client.getAccessToken() — this should trigger a refresh...');
    const token = await client.getAccessToken();

    console.log('Asserting results...');
    if (!refreshCalled) {
      throw new Error('Test failed: got-scraping was not called to refresh the token!');
    }
    if (token !== freshJwt) {
      throw new Error('Test failed: returned token does not match the fresh mocked token!');
    }
    console.log('✅ Client successfully returned the refreshed token.');

    console.log('Checking database to see if tokens were updated...');
    const row = await query('SELECT session_token FROM upstream_accounts WHERE name = ?', [accountName]);
    if (row.length === 0) {
      throw new Error('Test failed: Test account was deleted from DB!');
    }

    const updatedWrapper = JSON.parse(row[0].sessionToken);
    if (updatedWrapper.accessToken !== freshJwt) {
      throw new Error('Test failed: Database session_token was not updated with the new access token!');
    }
    if (updatedWrapper.refreshToken !== 'new_mock_refresh_token_789') {
      throw new Error('Test failed: Database session_token was not updated with the new refresh token!');
    }
    console.log('✅ Database record successfully updated with fresh tokens.');
    console.log('Test completed successfully! 🎉');

  } catch (err) {
    console.error('❌ TEST FAILED:', err);
  } finally {
    // Restore gotScraping
    gotScraping.post = originalPost;
    console.log('Cleaning up mock account from database...');
    await run('DELETE FROM upstream_accounts WHERE name = ?', [accountName]);
  }
}

main().catch(console.error);
