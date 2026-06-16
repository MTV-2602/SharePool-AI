// src/services/totp.js — TOTP generator helper
'use strict';

const crypto = require('crypto');

function getTOTP(secret) {
  if (!secret) return null;
  try {
    const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    const cleanSecret = String(secret).replace(/\s+/g, '').toUpperCase();
    
    for (let i = 0; i < cleanSecret.length; i++) {
      const val = base32chars.indexOf(cleanSecret[i]);
      if (val !== -1) {
        bits += val.toString(2).padStart(5, '0');
      }
    }
    
    const matches = bits.match(/.{4}/g);
    if (!matches) return null;
    
    const hex = matches.map((chunk) => parseInt(chunk, 2).toString(16)).join('');
    const key = Buffer.from(hex, 'hex');
    const epoch = Math.round(new Date().getTime() / 1000.0);
    const time = Buffer.alloc(8);
    time.writeUInt32BE(Math.floor(epoch / 30), 4);
    
    const hmac = crypto.createHmac('sha1', key).update(time).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const otp = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
    
    return otp.toString().padStart(6, '0');
  } catch (_) {
    return null;
  }
}

module.exports = { getTOTP };
