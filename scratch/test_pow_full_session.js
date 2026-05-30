'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const sessionToken = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..y6871HhlzEl426v0.vZuXT-KJJNbFvNeu5ppZWbrA-wbMiw8b2HrCY-wXXW1MFX8ZvYDAyPY-8bKGdB2qJRZGfbJguI4cI9xQJRSOtXnCD4aDS_OqlLzEzKBxgas9HXV1sqTqaDuKzHlqN7Vnb8fBhiOh3expK9clGPryJtTfRh9jm4iNKQ-idf4ee2PE2ufXaSHc52srgOvKn6TJ6OjmAoNRGXyAXqFskQdLo-vBRr8S8WWDyVbtBT_gzxgrQjY9IMtP4tXsiedtuF0KfZ0psKk2RVUZmSKws0iRZUAdN_xMZlSRTX3VCUcyQRBKFieOiAPWN7M7JXG4FDHbh-f33tvvh_Njyi-nVmVP30kbu3z_I89h2zkcKuWYLiZ-HGK-nyh3-Z-YB1pCNc57Zq3hrsSdU_Hje7o0V_n7vm1CPL3x6SNX8pWAvwmBG8aq8br2LitLimPmrgSNEAQH0By5v_YKDQoSVjtNQzmo0vu_Bfl_fD7V5_p7aI1JR7_FSqToOtqL8WsNm_VxP4RlZ11cKiobU-wGMz6amAEQKWwX-fMp8ylJFCfFMmLSGtqrEgDaSqppFQNIfGPQ5RwXmJLTOa9bcLmwrS7q6PF9RkTwzcXhv8m5-rkWj9jxOUEYp3iT-jNQfTRPz6MWZvETYdh-nxb0ejxz05MFjl8GDDKAVMQmHNPqsqQ3QKgTu6k0dGCPV62mTaPPNg6-Pi5Ujei4L8b1Dlob8aQw3dGSVSnM1t3DCTencnVemQgELWA1YfFeCsWGhHYvodOFL29RLpx0YHKD95eFZotzoKIXmtWAv5j108dborHxEd4EPc7rJirIEOsYn3CnFn176xFSSeD_BP2_Q1RbBByc_kSYMQUAsUAWPSwYfTtDhC2F-G-hzQfFEoHU6GjLVPPalUSSU0EL80xF5YDa_lKo939m0463KnpJepO1u9WCwAMjwFuW49oKIhrK9cmFj9tPP-qQ95m";

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
  
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const deviceId = uuidv4();
  
  console.log('Using Device ID:', deviceId);
  console.log('1. Refreshing Access Token from auth/session...');
  
  const sessionRes = await gotScraping.get('https://chatgpt.com/api/auth/session', {
    headers: {
      'Cookie': `__Secure-next-auth.session-token=${sessionToken}`,
      'User-Agent': userAgent,
      'Referer': 'https://chatgpt.com/',
      'Accept': 'application/json'
    }
  });
  
  console.log('Session Refresh Status:', sessionRes.statusCode);
  if (sessionRes.statusCode !== 200) {
    console.error('Failed to refresh session:', sessionRes.body);
    return;
  }
  
  const sessionData = JSON.parse(sessionRes.body);
  console.log('Session Keys:', Object.keys(sessionData));
  const accessToken = sessionData.accessToken;
  if (!accessToken) {
    console.error('AccessToken is missing in sessionData!', sessionData);
    return;
  }
  console.log('Access Token Refreshed successfully! Starts with:', accessToken.substring(0, 20));
  
  console.log('2. Fetching requirements...');
  const reqRes = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Referer': 'https://chatgpt.com/',
      'Origin': 'https://chatgpt.com',
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'oai-device-id': deviceId,
      'Cookie': `__Secure-next-auth.session-token=${sessionToken}; oai-did=${deviceId}`
    },
    json: {}
  });
  
  const reqData = JSON.parse(reqRes.body);
  console.log('Requirements status:', reqRes.statusCode);
  console.log('Turnstile required:', reqData.turnstile ? reqData.turnstile.required : 'none');
  console.log('Proof of Work:', JSON.stringify(reqData.proofofwork));
  
  if (!reqData.proofofwork || !reqData.proofofwork.required) {
    console.log('PoW not required. Exiting.');
    return;
  }
  
  console.log('3. Solving PoW...');
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
  
  console.log('4. Sending chat stream...');
  const stream = gotScraping.stream('https://chatgpt.com/backend-api/conversation', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Referer': 'https://chatgpt.com/',
      'Origin': 'https://chatgpt.com',
      'User-Agent': userAgent,
      'oai-device-id': deviceId,
      'Cookie': `__Secure-next-auth.session-token=${sessionToken}; oai-did=${deviceId}`,
      'openai-sentinel-chat-requirements-token': reqData.token,
      'openai-sentinel-proof-token': proofToken
    },
    json: body
  });
  
  stream.on('data', chunk => {
    console.log('CHUNK:', chunk.toString('utf-8'));
  });
  
  stream.on('end', () => {
    console.log('Stream ended successfully.');
  });
  
  stream.on('error', err => {
    console.error('Stream error:', err.message);
  });
}

main().catch(console.error);
