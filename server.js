// server.js — Production Entry Point
// Initializes database, then starts Express server

'use strict';

require('dotenv').config();

const express    = require('express');
const path       = require('path');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const config     = require('./src/config');
const { initDB } = require('./src/db');
const logger     = require('./src/utils/logger').create('Server');

// ─── Express App & Database Setup ───────────────────────────────
const app = express();
app.set('trust proxy', 1); // Trust Vercel's proxy headers for rate limiting

logger.info('Initializing database connection...');
const dbPromise = initDB()
  .then(() => {
    logger.info('Database connection verified.');
  })
  .catch((err) => {
    logger.error('Database connection failed:', err.message);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  });

// Block requests until DB initialization is completed (extremely important for Vercel cold starts)
app.use(async (req, res, next) => {
  try {
    await dbPromise;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database initialization failed: ' + err.message });
  }
});


// ─── Security middleware ─────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled to allow CDN scripts in HTML
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-api-key', 'x-extension-push-token'],
}));

// ─── Global rate limiter (protect against DDoS) ─────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 300,                  // 300 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many requests', type: 'rate_limit_error' } },
  skip: (req) => req.path.startsWith('/admin'), // admin has separate limit
}));

// ─── Body parsing ────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── Request ID middleware ──────────────────────────────────────
app.use((req, _res, next) => {
  req.id = uuidv4().split('-')[0]; // short ID like 'a1b2c3d4'
  next();
});

// ─── Request logger ──────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const color = res.statusCode >= 500 ? 31 : res.statusCode >= 400 ? 33 : 32;
    if (!req.path.startsWith('/health')) {
      logger.info(`[\x1b[${color}m${res.statusCode}\x1b[0m] ${req.method} ${req.path} — ${ms}ms`);
    }
  });
  next();
});

// ── Serve React frontend (client/dist) ───────────────────────
const clientDist = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDist));

// ── API routes ────────────────────────────────────────────────
app.use('/v1/antigravity',    require('./src/routes/antigravity_proxy'));
app.use('/',                  require('./src/routes/antigravity_v1internal'));
app.use('/v1',        require('./src/routes/proxy'));
app.use('/antigravity-admin-api', require('./src/routes/antigravity_admin'));
app.use('/antigravity-user-api',  require('./src/routes/antigravity_user'));
app.use('/admin-api/hotmail', require('./src/routes/hotmail').adminRouter);
app.use('/admin-api', require('./src/routes/admin'));
app.use('/user-api',  require('./src/routes/user'));
app.use('/api/hotmail',       require('./src/routes/hotmail').apiRouter);
app.use('/api',       require('./src/routes/telegram'));
app.use('/api',       require('./src/routes/api'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'ok',
  version: '2.0.0',
  uptime: Math.floor(process.uptime()),
  time: new Date().toISOString(),
}));

// ── SPA fallback — serve React index.html for all non-API routes ──
app.use((req, res, next) => {
  const isApi = /^\/(admin-api|user-api|antigravity-admin-api|antigravity-user-api|api|v1|v1internal|health)($|\/)/.test(req.path);
  if (isApi) return next();
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// ── API 404 handler ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      type: 'not_found',
      code: 'route_not_found',
    }
  });
});

// ── Global error handler ──────────────────────────────────────
app.use(require('./src/middleware/errorHandler').globalErrorHandler);

// ── Start listening ───────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = config.PORT;
  app.listen(PORT, () => {
    const line = '═'.repeat(50);
    console.log(`\n\x1b[34m╔${line}╗`);
    console.log(`║  🚀  API KEY MANAGEMENT PORTAL v2.0           ║`);
    console.log(`╚${line}╝\x1b[0m\n`);
    console.log(`  \x1b[36m👤 User Login   \x1b[0m→  http://localhost:${PORT}/login`);
    console.log(`  \x1b[36m📊 Dashboard    \x1b[0m→  http://localhost:${PORT}/dashboard`);
    console.log(`  \x1b[36m🔐 Admin Panel  \x1b[0m→  http://localhost:${PORT}/admin`);
    console.log(`  \x1b[36m📡 API Endpoint \x1b[0m→  http://localhost:${PORT}/v1`);
    console.log(`\n  \x1b[33m⚙  Admin Key    \x1b[0m→  ${config.ADMIN_KEY}`);
    console.log('\n' + '─'.repeat(52) + '\n');
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down gracefully');
    process.exit(0);
  });
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.message);
  if (!process.env.VERCEL) {
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

module.exports = app;

