const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const SCREEN_SIGNATURES = [3000, 3120, 4000, 4160];
const LANGUAGE_SIGNATURE = "en-US,es-US,en,es";
const NAVIGATOR_KEYS = ["location", "ontransitionend", "onprogress"];
const WINDOW_KEYS = ["window", "document", "navigator"];

function formatBrowserTime() {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const estDate = new Date(utc - (3600000 * 5));
  
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const dayName = days[estDate.getDay()];
  const monthName = months[estDate.getMonth()];
  const date = estDate.getDate();
  const year = estDate.getFullYear();
  
  const pad = (num) => String(num).padStart(2, '0');
  const hours = pad(estDate.getHours());
  const minutes = pad(estDate.getMinutes());
  const seconds = pad(estDate.getSeconds());
  
  return `${dayName} ${monthName} ${pad(date)} ${year} ${hours}:${minutes}:${seconds} GMT-0500 (Eastern Standard Time)`;
}

function buildSentinelConfig(userAgent) {
  const perfMs = 12.345; // static or dynamic performance.now()
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
  
  console.log(`Solving PoW for seed: ${seed}, difficulty: ${difficulty}...`);
  const start = Date.now();
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const encodedPayloadStr = encodePowPayload(config, nonce);
    const payloadBytes = Buffer.from(encodedPayloadStr, 'ascii');
    
    const hash = crypto.createHash('sha3-512');
    hash.update(seedBytes);
    hash.update(payloadBytes);
    const digest = hash.digest();
    
    if (digest.subarray(0, prefixLength).compare(target) <= 0) {
      console.log(`Found solution at nonce ${nonce} in ${Date.now() - start}ms`);
      return encodedPayloadStr;
    }
  }
  
  throw new Error(`Failed to solve sentinel pow after ${maxIterations} attempts`);
}

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const config = buildSentinelConfig(ua);
const seed = "0.37034536662063644";
const difficulty = "0719e5";

try {
  const solution = solveSentinelPow(seed, difficulty, config);
  console.log('Proof token:', 'gAAAAAC' + solution);
} catch (e) {
  console.error(e);
}
