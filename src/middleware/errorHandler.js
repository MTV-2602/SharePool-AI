'use strict';

/**
 * AppError — a known, intentional error with an HTTP status code and
 * an optional machine-readable error code string.
 *
 * Throw this from route handlers / services to produce structured JSON
 * error responses without leaking stack traces.
 */
class AppError extends Error {
  /**
   * @param {string} message    - Human-readable error message
   * @param {number} statusCode - HTTP status code (e.g. 400, 401, 404, 429)
   * @param {string} [code]     - Machine-readable error code (e.g. 'INVALID_API_KEY')
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name       = 'AppError';
    this.statusCode = statusCode;
    this.code       = code;
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

/**
 * Wrap an async Express route handler so that any rejected promise
 * is forwarded to next() instead of causing an unhandled rejection.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res, next) => { ... }));
 *
 * @param {Function} fn - async (req, res, next) => void
 * @returns {Function}
 */
function asyncHandler(fn) {
  return function asyncHandlerWrapper(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global Express error-handling middleware.
 * Must be registered LAST, after all routes:
 *   app.use(globalErrorHandler);
 *
 * Returns JSON:
 *   { error: { message, code, statusCode } }
 *
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
function globalErrorHandler(err, req, res, next) {
  // Known operational errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message:    err.message,
        code:       err.code,
        statusCode: err.statusCode,
      },
    });
  }

  // Express body-parser / JSON syntax errors
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      error: {
        message:    'Invalid JSON in request body',
        code:       'INVALID_JSON',
        statusCode: 400,
      },
    });
  }

  // Unexpected / programming errors — temporarily leak details to debug
  const isDev = true; // process.env.NODE_ENV !== 'production';

  console.error('[ERROR] [globalErrorHandler] Unhandled error:', err);

  return res.status(500).json({
    error: {
      message:    err.message,
      code:       'INTERNAL_ERROR',
      statusCode: 500,
      stack:      err.stack,
    },
  });
}

module.exports = { AppError, asyncHandler, globalErrorHandler };
