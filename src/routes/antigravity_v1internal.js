'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { createParser } = require('eventsource-parser');

const AntigravityKey = require('../models/AntigravityKey');
const AntigravityUsage = require('../models/AntigravityUsage');
const AntigravityPool = require('../upstream/AntigravityPool');
const logger = require('../utils/logger').create('AntigravityV1InternalProxy');

const router = Router();

// Authentication middleware
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!key) {
    return res.status(401).json({
      error: { message: 'API key is required', code: 'MISSING_API_KEY', statusCode: 401 }
    });
  }

  try {
    const validation = await AntigravityKey.validate(key);
    if (!validation.ok) {
      const msgs = {
        invalid_key: 'API key không hợp lệ.',
        key_disabled: 'API key này đã bị vô hiệu hóa.',
        key_expired: 'API key này đã hết hạn.',
        quota_exceeded: 'Đã sử dụng hết quota.',
      };
      return res.status(401).json({
        error: { message: msgs[validation.reason] || 'Không hợp lệ', code: validation.reason, statusCode: 401 }
      });
    }

    req.apiKey = key;
    req.apiKeyRecord = validation.record;
    next();
  } catch (err) {
    next(err);
  }
}

// NOTE: Do NOT use router.use(authenticate) here — this router is mounted at '/'
// and would block ALL requests (health, login, static files, etc.)

// We use path check since Express treats ':' as parameter prefix
router.post(/^\/v1internal:(streamGenerateContent|generateContent)$/, authenticate, async (req, res, next) => {
  const path = req.path; // e.g. "/v1internal:streamGenerateContent"
  const isStream = path.includes('streamGenerateContent');
  const action = isStream ? 'streamGenerateContent?alt=sse' : 'generateContent';

  const req_id = uuidv4().replace(/-/g, '').slice(0, 16);
  logger.info(`[v1internal] req_id=${req_id} key=${req.apiKeyRecord.name} path=${path} stream=${isStream}`);

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let poolResponse;
    try {
      poolResponse = await AntigravityPool.proxyRequestWithRotation(action, req.body, true);
    } catch (err) {
      logger.error(`Upstream error for v1internal stream: ${err.message}`);
      if (!res.headersSent) {
        const status = err.statusCode || 502;
        res.status(status).json({
          error: { message: err.message, code: err.code || 'UPSTREAM_ERROR', statusCode: status }
        });
      }
      return;
    }

    const { response, account } = poolResponse;
    let accumulatedText = '';
    let tokensIn = 0;
    let tokensOut = 0;

    const parser = createParser((event) => {
      if (event.type !== 'event') return;

      try {
        const json = JSON.parse(event.data);
        const candidate = json.candidates?.[0];
        if (candidate?.content?.parts?.[0]?.text) {
          accumulatedText += candidate.content.parts[0].text;
        }
        if (json.usageMetadata) {
          tokensIn = json.usageMetadata.promptTokenCount || tokensIn;
          tokensOut = json.usageMetadata.candidatesTokenCount || tokensOut;
        }
        res.write(`data: ${event.data}\n\n`);
      } catch (err) {
        res.write(`data: ${event.data}\n\n`);
      }
    });

    try {
      const textDecoder = new TextDecoder();
      for await (const byteChunk of response.body) {
        const text = textDecoder.decode(byteChunk, { stream: true });
        parser.feed(text);
      }
    } catch (streamErr) {
      logger.error(`Error during v1internal stream piping: ${streamErr.message}`);
    } finally {
      res.write('data: [DONE]\n\n');
      res.end();
    }

    if (tokensIn === 0) tokensIn = 500;
    if (tokensOut === 0) tokensOut = Math.ceil(accumulatedText.length / 4);

    setImmediate(async () => {
      try {
        await AntigravityKey.addUsage(req.apiKey, tokensIn, tokensOut);
        await AntigravityUsage.create({
          apiKey: req.apiKey,
          model: req.body.model || 'gemini-2.0-flash',
          tokensIn,
          tokensOut,
          reqId: req_id
        });
      } catch (err) {
        logger.error('Failed to log Antigravity usage:', err.message);
      }
    });

    return;
  }

  // Non-streaming Mode
  try {
    const poolResponse = await AntigravityPool.proxyRequestWithRotation(action, req.body, false);
    const { response, account } = poolResponse;
    const json = await response.json();

    let tokensIn = 500;
    let tokensOut = 500;
    const candidate = json.candidates?.[0];
    const contentText = candidate?.content?.parts?.[0]?.text || '';
    if (json.usageMetadata) {
      tokensIn = json.usageMetadata.promptTokenCount || tokensIn;
      tokensOut = json.usageMetadata.candidatesTokenCount || tokensOut;
    } else {
      tokensOut = Math.ceil(contentText.length / 4);
    }

    await AntigravityKey.addUsage(req.apiKey, tokensIn, tokensOut);
    await AntigravityUsage.create({
      apiKey: req.apiKey,
      model: req.body.model || 'gemini-2.0-flash',
      tokensIn,
      tokensOut,
      reqId: req_id
    });

    res.json(json);
  } catch (err) {
    const status = err.statusCode || 502;
    res.status(status).json({
      error: { message: err.message, code: err.code || 'UPSTREAM_ERROR', statusCode: status }
    });
  }
});

router.post(/^\/v1internal:(loadCodeAssist|onboardUser)$/, authenticate, async (req, res, next) => {
  const path = req.path;
  const action = path.includes('loadCodeAssist') ? 'loadCodeAssist' : 'onboardUser';

  logger.info(`[v1internal] API meta call key=${req.apiKeyRecord.name} path=${path}`);

  try {
    const poolResponse = await AntigravityPool.proxyRequestWithRotation(action, req.body, false);
    const { response } = poolResponse;
    const json = await response.json();
    res.json(json);
  } catch (err) {
    const status = err.statusCode || 502;
    res.status(status).json({
      error: { message: err.message, code: err.code || 'UPSTREAM_ERROR', statusCode: status }
    });
  }
});

module.exports = router;
