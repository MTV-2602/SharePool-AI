// src/middleware/auth.js — Validate API key + check quota
const KeyManager = require('../apiKeyManager');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!key) {
    return res.status(401).json({
      error: {
        message: 'Missing API key. Provide Authorization: Bearer <key>',
        type: 'auth_error',
        code: 'missing_key',
      }
    });
  }

  const result = KeyManager.validate(key);
  if (!result.ok) {
    const messages = {
      invalid_key:     'Invalid API key.',
      key_disabled:    'This API key has been disabled.',
      key_expired:     'This API key has expired.',
      quota_exceeded:  'Token quota exceeded for this key.',
    };
    return res.status(401).json({
      error: {
        message: messages[result.reason] || 'Unauthorized',
        type: 'auth_error',
        code: result.reason,
      }
    });
  }

  req.apiKey = key;
  req.apiKeyRecord = result.record;
  next();
}

module.exports = authMiddleware;
