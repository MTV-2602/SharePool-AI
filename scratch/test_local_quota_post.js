'use strict';

const fetch = require('node-fetch');

async function main() {
  const url = 'http://localhost:3040/admin-api/accounts/quota';
  
  console.log('Fetching quota from local server (POST)...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': 'admin123'
      },
      body: JSON.stringify({
        name: 'CodexAcc-425926'
      })
    });
    
    console.log('Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

main();
