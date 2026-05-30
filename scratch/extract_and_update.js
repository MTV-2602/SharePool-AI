const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const logPath = 'C:\\Users\\vinhmt\\.gemini\\antigravity\\brain\\948320a0-2ecc-42a8-b8ee-57d7df4ae18e\\.system_generated\\logs\\transcript.jsonl';

const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');

// Find the last line that has type USER_INPUT
let lastUserLine = null;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('"type":"USER_INPUT"')) {
    lastUserLine = lines[i];
    break;
  }
}

if (!lastUserLine) {
  console.error('Could not find last user input line.');
  process.exit(1);
}

const parsedStep = JSON.parse(lastUserLine);
const contentText = parsedStep.content;

// Extract JSON object from contentText (removing <USER_REQUEST> tags)
const cleanText = contentText.replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, '').trim();
const payload = JSON.parse(cleanText);
const sessionToken = payload.sessionToken;

console.log('Extracted Session Token length:', sessionToken.length);
console.log('Number of parts:', sessionToken.split('.').length);
console.log('First 20 chars:', sessionToken.substring(0, 20));
console.log('Last 20 chars:', sessionToken.substring(sessionToken.length - 20));

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('Updating DB token for team89a6@gmail.com...');
  await db.query(
    'UPDATE upstream_accounts SET session_token = $1 WHERE name = $2',
    [sessionToken, 'team89a6@gmail.com']
  );
  console.log('Successfully updated token in DB!');
  await db.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
