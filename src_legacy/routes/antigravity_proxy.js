'use strict';

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { createParser } = require('eventsource-parser');

const AntigravityKey = require('../models/AntigravityKey');
const AntigravityUsage = require('../models/AntigravityUsage');
const AntigravityPool = require('../upstream/AntigravityPool');
const AntigravityTranslator = require('../upstream/AntigravityTranslator');
const { estimateMessages } = require('../utils/tokens');
const logger = require('../utils/logger').create('AntigravityProxyRoute');

const router = Router();

// Authentication middleware for Antigravity API keys
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

router.use(authenticate);

// GET /v1/antigravity/models
router.get('/models', (req, res) => {
  const models = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash'
  ].map(id => ({
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'google'
  }));

  res.json({ object: 'list', data: models });
});

// POST /v1/antigravity/chat/completions
router.post('/chat/completions', async (req, res, next) => {
  const { messages, model = 'gemini-2.0-flash', stream = false } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: { message: 'Request body must include a non-empty "messages" array', code: 'INVALID_REQUEST', statusCode: 400 }
    });
  }

  const req_id = uuidv4().replace(/-/g, '').slice(0, 16);
  const estTokensIn = estimateMessages(messages);

  logger.info(`[AntigravityProxy] req_id=${req_id} key=${req.apiKeyRecord.name} model=${model} stream=${stream} est_in=${estTokensIn}`);

  // === 1. Streaming Mode ===
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let poolResponse;
    try {
      poolResponse = await AntigravityPool.chatWithRotation(model, req.body, stream);
    } catch (err) {
      logger.error(`Upstream error for stream: ${err.message}`);
      if (!res.headersSent) {
        const status = err.statusCode || 502;
        res.status(status).json({
          error: { message: err.message, code: err.code || 'UPSTREAM_ERROR', statusCode: status }
        });
      }
      return;
    }

    const { response, toolNameMap } = poolResponse;
    const state = { toolNameMap };
    let accumulatedText = '';
    let tokensIn = estTokensIn;
    let tokensOut = 0;

    const parser = createParser((event) => {
      if (event.type !== 'event') return;

      try {
        const json = JSON.parse(event.data);
        const openaiChunks = AntigravityTranslator.geminiToOpenAIResponse(json, state);

        if (Array.isArray(openaiChunks)) {
          for (const chunk of openaiChunks) {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              accumulatedText += delta.content;
            }
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      } catch (err) {
        // Skip malformed chunks
      }
    });

    try {
      const textDecoder = new TextDecoder();
      for await (const byteChunk of response.body) {
        const text = textDecoder.decode(byteChunk, { stream: true });
        parser.feed(text);
      }
    } catch (streamErr) {
      logger.error(`Error during SSE stream piping: ${streamErr.message}`);
    } finally {
      res.write('data: [DONE]\n\n');
      res.end();
    }

    // Resolve usage metadata
    if (state.usage) {
      tokensIn = state.usage.prompt_tokens || tokensIn;
      tokensOut = state.usage.completion_tokens || tokensOut;
    } else {
      tokensOut = Math.ceil(accumulatedText.length / 4);
    }

    // Record usage asynchronously
    setImmediate(async () => {
      try {
        await AntigravityKey.addUsage(req.apiKey, tokensIn, tokensOut);
        await AntigravityUsage.create({
          apiKey: req.apiKey,
          model,
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

  // === 2. Non-Streaming Mode ===
  let poolResponse;
  try {
    poolResponse = await AntigravityPool.chatWithRotation(model, req.body, stream);
  } catch (err) {
    const status = err.statusCode || 502;
    return res.status(status).json({
      error: { message: err.message, code: err.code || 'UPSTREAM_ERROR', statusCode: status }
    });
  }

  try {
    const { response, toolNameMap } = poolResponse;
    const json = await response.json();

    const state = { toolNameMap };
    const openaiChunks = AntigravityTranslator.geminiToOpenAIResponse(json, state);

    // Reconstruct single non-streamed response object from chunks
    let content = '';
    let reasoningContent = '';
    let toolCalls = [];
    let finishReason = 'stop';

    if (Array.isArray(openaiChunks)) {
      for (const chunk of openaiChunks) {
        const choice = chunk.choices?.[0];
        if (choice) {
          if (choice.delta?.content) content += choice.delta.content;
          if (choice.delta?.reasoning_content) reasoningContent += choice.delta.reasoning_content;
          if (choice.delta?.tool_calls) toolCalls.push(...choice.delta.tool_calls);
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
    }

    let tokensIn = estTokensIn;
    let tokensOut = state.usage?.completion_tokens || Math.ceil(content.length / 4);

    if (state.usage) {
      tokensIn = state.usage.prompt_tokens || tokensIn;
    }

    const completion = {
      id: `chatcmpl-${state.messageId || req_id}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(reasoningContent && { reasoning_content: reasoningContent }),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls })
        },
        finish_reason: finishReason
      }],
      usage: {
        prompt_tokens: tokensIn,
        completion_tokens: tokensOut,
        total_tokens: tokensIn + tokensOut
      }
    };

    // Save usage logs and update quota
    await AntigravityKey.addUsage(req.apiKey, tokensIn, tokensOut);
    await AntigravityUsage.create({
      apiKey: req.apiKey,
      model,
      tokensIn,
      tokensOut,
      reqId: req_id
    });

    res.json(completion);
  } catch (err) {
    logger.error('Failed to parse non-stream Antigravity response:', err.message);
    res.status(500).json({
      error: { message: 'Failed to process upstream response', code: 'TRANSLATION_ERROR', statusCode: 500 }
    });
  }
});

module.exports = router;
