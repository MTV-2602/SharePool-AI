'use strict';

const config  = require('../config');
const { AppError } = require('./errorHandler');

/**
 * Express middleware that validates the admin key supplied in the
 * x-admin-key request header.
 *
 * Usage:
 *   router.use(adminGuard);
 *   router.get('/admin-api/...', handler);
 *
 * Throws a 403 AppError if:
 *   - The x-admin-key header is missing
 *   - The header value does not match ADMIN_KEY from config
 */
function adminGuard(req, res, next) {
  const provided = req.headers['x-admin-key'] || '';

  if (!provided) {
    return next(new AppError('Admin key is required (x-admin-key header)', 403, 'MISSING_ADMIN_KEY'));
  }

  if (provided !== config.ADMIN_KEY) {
    return next(new AppError('Invalid admin key', 403, 'INVALID_ADMIN_KEY'));
  }

  next();
}

module.exports = adminGuard;
