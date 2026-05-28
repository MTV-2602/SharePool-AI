'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

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

function solve(seed, difficulty, userAgent) {
  const config = buildSentinelConfig(userAgent);
  const solution = solveSentinelPow(seed, difficulty, config);
  return 'gAAAAAC' + solution;
}

module.exports = {
  buildSentinelConfig,
  encodePowPayload,
  solveSentinelPow,
  solve
};
