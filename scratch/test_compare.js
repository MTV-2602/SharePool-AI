const crypto = require('crypto');

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

const config = [
  3120,
  "Thu May 28 2026 16:39:48 GMT+0700 (Indochina Time)",
  4294705152,
  0,
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "",
  "",
  "en-US",
  "en-US,es-US,en,es",
  0,
  "location",
  "location",
  "window",
  1234.56,
  "e40e9d4a-77df-4d18-ade9-02e5c988de0c",
  "",
  8,
  1779961068359
];

const nonce = 459;
const encoded = encodePowPayload(config, nonce);
console.log('JS payload encoded length:', encoded.length);
console.log('JS payload encoded string:', encoded);
console.log('JS body decoded:', Buffer.from(encoded, 'base64').toString('utf-8'));
