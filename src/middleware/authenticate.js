'use strict';

const ApiKey      = require('../models/ApiKey');
const { AppError, asyncHandler } = require('./errorHandler');

/**
 * Express middleware that authenticates requests using an API key
 * supplied in the Authorization header as:
 *
 *   Authorization: Bearer sk-<key>
 *
 * On success sets:
 *   req.apiKey       — the raw key string
 *   req.apiKeyRecord — the mapped ApiKey record (from ApiKey.validate)
 *
 * On failure throws an AppError which is caught by asyncHandler and
 * forwarded to the global error handler.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Bearer ')) {
    throw new AppError(
      'Missing or malformed Authorization header. Expected: Authorization: Bearer <key>',
      401,
      'MISSING_AUTH'
    );
  }

  const key = authHeader.slice('Bearer '.length).trim();

  if (!key) {
    throw new AppError('API key is empty', 401, 'MISSING_AUTH');
  }

  const validation = await ApiKey.validate(key);

  if (!validation.ok) {
    const statusCode = validation.reason === 'invalid_key' ? 401 : 403;
    throw new AppError(validation.reason, statusCode, 'INVALID_API_KEY');
  }

  req.apiKey       = key;
  req.apiKeyRecord = validation.record;

  next();
});

module.exports = authenticate;
