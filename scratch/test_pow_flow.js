'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SCREEN_SIGNATURES = [3000, 3120, 4000, 4160];
const LANGUAGE_SIGNATURE = "en-US,es-US,en,es";
const NAVIGATOR_KEYS = ["location", "ontransitionend", "onprogress"];
const WINDOW_KEYS = ["window", "document", "navigator"];

function formatBrowserTime() {
  return new Date().toString();
}

function buildSentinelConfig(userAgent) {
  const perfMs = 1000 + Math.random() * 4000;
  const epochMs = Date.now() - perfMs;
  
  const screen = SCREEN_SIGNATURES[Math.floor(Math.random() * SCREEN_SIGNATURES.length)];
  const navKey = NAVIGATOR_KEYS[Math.floor(Math.random() * NAVIGATOR_KEYS.length)];
  const winKey = WINDOW_KEYS[Math.floor(Math.random() * WINDOW_KEYS.length)];
  
  return [
    screen,
    formatBrowserTime(),
    4294705152,
    0,
    userAgent,
    "",
    "",
    "en-US",
    LANGUAGE_SIGNATURE,
    0,
    navKey,
    "location",
    winKey,
    perfMs,
    uuidv4(),
    "",
    8,
    epochMs
  ];
}

function encodePowPayload(config, nonce) {
  const prefixStr = JSON.stringify(config.slice(0, 3)).slice(0, -1) + ",";
  const middleStr = "," + JSON.stringify(config.slice(4, 9)).slice(1, -1) + ",";
  const suffixStr = "," + JSON.stringify(config.slice(10)).slice(1);
  
  const body = Buffer.concat([
    Buffer.from(prefixStr, 'utf-8'),
    Buffer.from(String(nonce), 'ascii'),
    Buffer.from(middleStr, 'utf-8'),
    Buffer.from(String(nonce >> 1), 'ascii'),
    Buffer.from(suffixStr, 'utf-8')
  ]);
  
  return body.toString('base64');
}

function solveSentinelPow(seed, difficulty, config, maxIterations = 500000) {
  const seedBytes = Buffer.from(seed, 'utf-8');
  const target = Buffer.from(difficulty, 'hex');
  const prefixLength = target.length;
  
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const encodedPayloadStr = encodePowPayload(config, nonce);
    const payloadBytes = Buffer.from(encodedPayloadStr, 'ascii');
    
    const hash = crypto.createHash('sha3-512');
    hash.update(seedBytes);
    hash.update(payloadBytes);
    const digest = hash.digest();
    
    if (digest.subarray(0, prefixLength).compare(target) <= 0) {
      return encodedPayloadStr;
    }
  }
  
  throw new Error(`Failed to solve sentinel pow after ${maxIterations} attempts`);
}

async function main() {
  const { gotScraping } = await import('got-scraping');
  
  const res = await db.query('SELECT session_token FROM upstream_accounts WHERE name = $1', ['team89a6@gmail.com']);
  const rawToken = res.rows[0].session_token;
  
  const json = JSON.parse(rawToken);
  const accessToken = json.accessToken;
  
  const deviceId = uuidv4();
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  
  console.log('Using Device ID:', deviceId);
  console.log('Fetching requirements with static headers...');
  
  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'authorization': `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'oai-device-id': deviceId,
    'oai-language': 'en-US',
    'origin': 'https://chatgpt.com',
    'referer': 'https://chatgpt.com/',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': userAgent,
    'Cookie': `oai-did=${deviceId}`
  };
  
  const reqRes = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
    method: 'POST',
    useHeaderGenerator: false,
    headers: headers,
    json: {}
  });
  
  const reqData = JSON.parse(reqRes.body);
  console.log('Requirements status:', reqRes.statusCode);
  console.log('Turnstile required:', reqData.turnstile ? reqData.turnstile.required : 'none');
  console.log('Proof of Work:', JSON.stringify(reqData.proofofwork));
  
  if (!reqData.proofofwork || !reqData.proofofwork.required) {
    console.log('PoW not required. Exiting.');
    db.end();
    return;
  }
  
  console.log('Solving PoW...');
  const config = buildSentinelConfig(userAgent);
  const solution = solveSentinelPow(reqData.proofofwork.seed, reqData.proofofwork.difficulty, config);
  const proofToken = 'gAAAAAC' + solution;
  console.log('Solved! Proof token length:', proofToken.length);
  
  const body = {
    action: 'next',
    messages: [
      {
        id: crypto.randomUUID(),
        author: { role: 'user' },
        content: { content_type: 'text', parts: ['Hello! Reply with exactly "TEST SUCCEEDED".'] },
        metadata: {}
      }
    ],
    model: 'gpt-4o',
    parent_message_id: crypto.randomUUID(),
    history_and_training_disabled: true,
    conversation_mode: { kind: 'primary_assistant' },
    force_paragen: false,
    force_paragen_model_slug: '',
    force_nulligen: false,
    force_rate_limit: false
  };
  
  const finalHeaders = {
    ...headers,
    'accept': 'text/event-stream',
    'openai-sentinel-chat-requirements-token': reqData.token,
    'openai-sentinel-proof-token': proofToken
  };
  
  console.log('Sending chat stream...');
  const stream = gotScraping.stream('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    useHeaderGenerator: false,
    headers: finalHeaders,
    json: body
  });
  
  stream.on('data', chunk => {
    console.log('CHUNK:', chunk.toString('utf-8'));
  });
  
  stream.on('end', () => {
    console.log('Stream ended successfully.');
    db.end();
  });
  
  stream.on('error', err => {
    console.error('Stream error:', err.message);
    db.end();
  });
}

main().catch(err => {
  console.error(err);
  db.end();
});
