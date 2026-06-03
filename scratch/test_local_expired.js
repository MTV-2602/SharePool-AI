'use strict';

const fetch = require('node-fetch');

async function main() {
  const url = 'http://localhost:3040/api/accounts/expired';
  const pushToken = 'b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b';

  console.log('Fetching expired accounts from local server...');
  try {
    const res = await fetch(url, {
      headers: {
        'x-extension-push-token': pushToken
      }
    });
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('Response:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

main();
