const fetch = require('node-fetch');
const fs = require('fs');

async function main() {
  const res = await fetch('https://raw.githubusercontent.com/kschen202115/codex_register/main/sentinel_pow.py');
  const text = await res.text();
  console.log('Total length of fetched content:', text.length);
  console.log('Lines count:', text.split('\n').length);
  fs.writeFileSync('scratch/sentinel_pow_full.py', text);
}
main().catch(console.error);
