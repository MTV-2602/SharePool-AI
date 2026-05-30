'use strict';

const AccountPool = require('../src/upstream/AccountPool');
const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');

// We will mock the database query to return three test accounts
// one cookie-based session, one OAuth session, one raw token session
const mockAccounts = [
  { name: 'Mock-Cookie-Acc', session_token: 'eyJhbGciOiJkaXI...mock-cookie' },
  { name: 'Mock-OAuth-Acc', session_token: JSON.stringify({ accessToken: 'eyJhbGciOiJSUzI1Ni...oauth-access', refreshToken: 'refresh-123', deviceId: 'dev-123' }) },
  { name: 'Mock-Raw-Acc', session_token: 'eyJhbGciOiJSUzI1Ni...raw-access' }
];

// Backup original db module functions
const db = require('../src/db');
const originalQuery = db.query;

db.query = async (sql) => {
  if (sql.includes('upstream_accounts')) {
    console.log('[MOCK DB] Querying upstream_accounts table...');
    return mockAccounts;
  }
  return [];
};

async function runTest() {
  console.log('--- Loading Mock Accounts into Pool ---');
  await AccountPool.reload();
  
  const status = AccountPool.getStatus();
  console.log('Initial Pool Status:');
  console.log(status.map(a => `- ${a.name}: ${a.status}`).join('\n'));
  
  // Mock the clients' getAccessToken and chat methods
  let callCount = 0;
  for (const acc of AccountPool._accounts) {
    const client = acc.client;
    
    // Mock getAccessToken to return mock token
    client.getAccessToken = async () => 'mock-access-token';
    
    // Mock chat
    client.chat = async (messages, model) => {
      callCount++;
      console.log(`   [CLIENT MOCK] ${acc.name} received chat request.`);
      
      if (acc.name === 'Mock-Cookie-Acc') {
        console.log(`   [CLIENT MOCK] ${acc.name} simulating RATE LIMIT error (429)...`);
        const err = new Error('Too many requests');
        err.code = 'RATE_LIMITED';
        throw err;
      }
      
      if (acc.name === 'Mock-OAuth-Acc') {
        console.log(`   [CLIENT MOCK] ${acc.name} simulating INVALID SESSION error (401)...`);
        const err = new Error('Unauthorized');
        err.code = 'INVALID_SESSION';
        throw err;
      }
      
      if (acc.name === 'Mock-Raw-Acc') {
        console.log(`   [CLIENT MOCK] ${acc.name} simulating SUCCESS response!`);
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          body: 'Mocked Stream Output'
        };
      }
    };
  }
  
  console.log('\n--- Running chatWithRotation ---');
  try {
    const response = await AccountPool.chatWithRotation([{ role: 'user', content: 'test' }], 'gpt-4o');
    console.log('\nResult: chatWithRotation returned successfully!');
    console.log('Response status:', response.status);
    console.log('Total chat calls triggered:', callCount);
  } catch (err) {
    console.error('Test Failed: chatWithRotation failed:', err);
  }
  
  console.log('\nChecking Cool-down statuses:');
  const postStatus = AccountPool.getStatus();
  console.log(postStatus.map(a => `- ${a.name}: ${a.status} (remaining cooldown: ${a.cooldownRemaining}ms)`).join('\n'));
  
  // Assertions
  if (callCount !== 3) {
    throw new Error(`Expected 3 total calls, but got ${callCount}`);
  }
  
  const cookieAcc = postStatus.find(a => a.name === 'Mock-Cookie-Acc');
  const oauthAcc = postStatus.find(a => a.name === 'Mock-OAuth-Acc');
  const rawAcc = postStatus.find(a => a.name === 'Mock-Raw-Acc');
  
  if (cookieAcc.status !== 'cooldown') {
    throw new Error('Expected Mock-Cookie-Acc to be on cooldown due to rate limit');
  }
  if (oauthAcc.status !== 'cooldown') {
    throw new Error('Expected Mock-OAuth-Acc to be on cooldown due to invalid session');
  }
  if (rawAcc.status !== 'active') {
    throw new Error('Expected Mock-Raw-Acc to remain active after success');
  }
  
  console.log('\n✅ Mock Rotation and Fallback test passed successfully! 🎉');
}

runTest().catch(console.error).finally(() => {
  // Restore original DB query
  db.query = originalQuery;
});
