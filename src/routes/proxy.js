'use strict';

const { Router }  = require('express');
const { v4: uuidv4 } = require('uuid');

const authenticate = require('../middleware/authenticate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const AccountPool  = require('../upstream/AccountPool');
const Converter    = require('../upstream/Converter');
const { mapModel } = require('../upstream/ChatGPTClient');

const ApiKey   = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const { estimateMessages, estimateText } = require('../utils/tokens');
const logger   = require('../utils/logger').create('ProxyRoute');

const router = Router();

// ─── All proxy routes require authentication ──────────────────────────────────

router.use(authenticate);

// ─── GET /v1/models ──────────────────────────────────────────────────────────

router.get('/v1/models', asyncHandler(async (req, res) => {
  const models = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3',
    'o3-mini',
    'codex',
  ].map(id => ({
    id,
    object:   'model',
    created:  Math.floor(Date.now() / 1000),
    owned_by: 'openai',
  }));

  res.json({ object: 'list', data: models });
}));

// ─── POST /v1/chat/completions ────────────────────────────────────────────────

router.post('/v1/chat/completions', asyncHandler(async (req, res) => {
  const { messages, model = 'gpt-4o', stream = false, ...rest } = req.body || {};

  // Validate messages
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AppError(
      'Request body must include a non-empty "messages" array',
      400,
      'INVALID_REQUEST'
    );
  }

  for (const [i, msg] of messages.entries()) {
    if (!msg || typeof msg.role !== 'string') {
      throw new AppError(
        `messages[${i}] must have a "role" field`,
        400,
        'INVALID_REQUEST'
      );
    }
    if (msg.content === undefined || msg.content === null) {
      throw new AppError(
        `messages[${i}] must have a "content" field`,
        400,
        'INVALID_REQUEST'
      );
    }
  }

  const req_id     = uuidv4().replace(/-/g, '').slice(0, 16);
  const mappedModel = mapModel(model);

  // Estimate input tokens for quota tracking
  const tokensIn = estimateMessages(messages);

  logger.info(
    `[${req.apiKeyRecord?.name}] req_id=${req_id} model=${mappedModel} ` +
    `stream=${stream} est_in=${tokensIn}`
  );

  // ── Streaming response ─────────────────────────────────────────────────

  if (stream) {
    // Set SSE headers before any await that could fail after headers sent
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let upstreamResponse;
    try {
      upstreamResponse = await AccountPool.chatWithRotation(messages, mappedModel);
    } catch (err) {
      // Headers not sent yet at this point — we can still send JSON error
      if (!res.headersSent) {
        const status = err.statusCode || 502;
        res.status(status).json({
          error: {
            message:    err.message,
            code:       err.code || 'UPSTREAM_ERROR',
            statusCode: status,
          },
        });
        return;
      }
      return;
    }

    const completionId = 'chatcmpl-' + req_id;
    let   tokensOut    = 0;
    let   outputBuffer = '';

    try {
      for await (const chunk of Converter.streamToOpenAI(upstreamResponse, mappedModel, completionId)) {
        // Accumulate output to estimate tokens after stream ends
        outputBuffer += chunk;
        res.write(chunk);
      }
    } catch (streamErr) {
      logger.error('Error during stream pipe', streamErr);
    } finally {
      res.end();
    }

    // Rough output token estimate from raw SSE output length
    tokensOut = Math.ceil(outputBuffer.length / 16);

    // Record usage asynchronously (non-blocking)
    setImmediate(() => {
      try {
        ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
        UsageLog.create({
          apiKey:   req.apiKey,
          model:    mappedModel,
          tokensIn,
          tokensOut,
          reqId:    req_id,
        });
      } catch (logErr) {
        logger.error('Failed to record usage', logErr);
      }
    });

    return;
  }

  // ── Non-streaming response ─────────────────────────────────────────────

  let upstreamResponse;
  try {
    upstreamResponse = await AccountPool.chatWithRotation(messages, mappedModel);
  } catch (err) {
    const status = err.statusCode || 502;
    throw new AppError(err.message, status, err.code || 'UPSTREAM_ERROR');
  }

  const completion = await Converter.collectFull(upstreamResponse, mappedModel);

  // Fill in realistic usage stats
  const tokensOut        = completion.usage?.completion_tokens ?? 0;
  completion.usage       = {
    prompt_tokens:     tokensIn,
    completion_tokens: tokensOut,
    total_tokens:      tokensIn + tokensOut,
  };
  completion.id          = 'chatcmpl-' + req_id;

  // Record usage
  setImmediate(() => {
    try {
      ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
      UsageLog.create({
        apiKey:   req.apiKey,
        model:    mappedModel,
        tokensIn,
        tokensOut,
        reqId:    req_id,
      });
    } catch (logErr) {
      logger.error('Failed to record usage', logErr);
    }
  });

  res.json(completion);
}));

// ─── Catch-all for unsupported /v1/* endpoints ────────────────────────────────

router.all('/v1/*', (req, res) => {
  res.status(404).json({
    error: {
      message:    `The endpoint ${req.method} ${req.path} is not supported by this proxy.`,
      code:       'UNSUPPORTED_ENDPOINT',
      statusCode: 404,
    },
  });
});

module.exports = router;
