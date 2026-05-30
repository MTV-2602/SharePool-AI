'use strict';

const fetch = require('node-fetch');

async function main() {
  const url = 'http://localhost:3040/api/diagnose-token';
  
  console.log('Fetching diagnose-token from local server...');
  try {
    const res = await fetch(url);
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('Response JSON:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

main();
