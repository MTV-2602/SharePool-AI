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

function getModelMultiplier(modelName) {
  if (!modelName) return 1.0;
  const name = modelName.toLowerCase();
  
  if (name.includes('xhigh') || name.includes('extra')) {
    return 4.0;
  }
  if (name.includes('high')) {
    return 3.2;
  }
  if (name.includes('max')) {
    return 3.2;
  }
  if (name.includes('low')) {
    return 1.6;
  }
  if (name.includes('mini')) {
    if (name.includes('gpt-4o') || name.includes('gpt-4')) {
      return 0.06;
    }
    return 0.6;
  }
  if (name.includes('spark')) {
    return 1.2;
  }
  if (name.includes('gpt-5')) {
    return 1.2;
  }
  if (name.includes('gpt-3.5')) {
    return 0.15;
  }
  
  return 1.0;
}

// ─── All proxy routes require authentication ──────────────────────────────────

router.use(authenticate);

// ─── GET /v1/models ──────────────────────────────────────────────────────────

router.get('/models', asyncHandler(async (req, res) => {
  const models = [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.3-codex',
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

router.post('/chat/completions', asyncHandler(async (req, res) => {
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
  const multiplier = getModelMultiplier(model);

  // Estimate input tokens for quota tracking
  const rawTokensIn = estimateMessages(messages);
  const tokensIn = Math.ceil(rawTokensIn * multiplier);

  logger.info(
    `[${req.apiKeyRecord?.name}] req_id=${req_id} model=${model} (mapped to ${mappedModel}) ` +
    `stream=${stream} est_in=${tokensIn} (multiplier=${multiplier}x)`
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
      upstreamResponse = await AccountPool.chatWithRotation(messages, mappedModel, {
        tools: req.body.tools,
        tool_choice: req.body.tool_choice,
        reasoning: req.body.reasoning_effort || req.body.reasoning,
      });
    } catch (err) {
      if (!res.headersSent) {
        const status = err.statusCode || 502;
        const errPayload = {
          error: {
            message:    err.message,
            code:       err.code || 'UPSTREAM_ERROR',
            statusCode: status,
          },
        };
        res.write(`data: ${JSON.stringify(errPayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
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
    const rawTokensOut = Math.ceil(outputBuffer.length / 16);
    tokensOut = Math.ceil(rawTokensOut * multiplier);

    // Record usage asynchronously (non-blocking)
    setImmediate(async () => {
      try {
        await ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
        await UsageLog.create({
          apiKey:   req.apiKey,
          model:    model,
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
    upstreamResponse = await AccountPool.chatWithRotation(messages, mappedModel, {
      tools: req.body.tools,
      tool_choice: req.body.tool_choice,
      reasoning: req.body.reasoning_effort || req.body.reasoning,
    });
  } catch (err) {
    const status = err.statusCode || 502;
    throw new AppError(err.message, status, err.code || 'UPSTREAM_ERROR');
  }

  const completion = await Converter.collectFull(upstreamResponse, mappedModel);

  // Fill in realistic usage stats
  const rawTokensOut     = completion.usage?.completion_tokens ?? 0;
  const tokensOut        = Math.ceil(rawTokensOut * multiplier);
  completion.usage       = {
    prompt_tokens:     tokensIn,
    completion_tokens: tokensOut,
    total_tokens:      tokensIn + tokensOut,
  };
  completion.id          = 'chatcmpl-' + req_id;
  completion.model       = model; // Return original model

  // Record usage
  setImmediate(async () => {
    try {
      await ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
      await UsageLog.create({
        apiKey:   req.apiKey,
        model:    model,
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

// ─── POST /v1/responses ───────────────────────────────────────────────────────
// Codex Desktop App uses wire_api = "responses" which sends requests here.
// We translate the Responses API format → messages array → ChatGPT pool.

router.post('/responses', asyncHandler(async (req, res) => {
  const {
    model = 'gpt-4o',
    input,
    instructions,
    stream = false,
    ...rest
  } = req.body || {};

  // ── Build messages from Responses API format ──────────────────────────────

  const messages = [];

  // "instructions" → system message
  if (instructions && typeof instructions === 'string') {
    messages.push({ role: 'system', content: instructions });
  }

  // "input" can be:
  //   1. A plain string
  //   2. An array of { role, content } objects where content can be:
  //      - A plain string
  //      - An array of { type, text } blocks (input_text / output_text)
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      let textContent = '';
      if (typeof item.content === 'string') {
        textContent = item.content;
      } else if (Array.isArray(item.content)) {
        // Extract text from typed content blocks
        textContent = item.content
          .filter(b => b.type === 'input_text' || b.type === 'output_text' || b.type === 'text')
          .map(b => b.text || '')
          .join('');
      }
      if (textContent) {
        messages.push({ role: item.role || 'user', content: textContent });
      }
    }
  }

  let rawInput = input;
  if (typeof input === 'string') {
    rawInput = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }];
  }

  if (!rawInput || (Array.isArray(rawInput) && rawInput.length === 0)) {
    throw new AppError(
      'Request body must include a non-empty "input" field',
      400,
      'INVALID_REQUEST'
    );
  }

  const req_id      = uuidv4().replace(/-/g, '').slice(0, 16);
  const mappedModel = mapModel(model);
  const multiplier = getModelMultiplier(model);
  const rawTokensIn = estimateMessages(messages.length > 0 ? messages : [{ role: 'user', content: '...' }]);
  const tokensIn    = Math.ceil(rawTokensIn * multiplier);

  logger.info(
    `[${req.apiKeyRecord?.name}] /v1/responses req_id=${req_id} model=${model} (mapped to ${mappedModel}) stream=${stream} est_in=${tokensIn} (multiplier=${multiplier}x)`
  );

  // ── Helper: format output in Responses API shape ──────────────────────────

  function buildResponsesObject(text, usageIn, usageOut) {
    return {
      id:      'resp-' + req_id,
      object:  'response',
      created: Math.floor(Date.now() / 1000),
      model:   model, // Return original model name to user!
      output:  [
        {
          type:    'message',
          id:      'msg-' + req_id,
          role:    'assistant',
          content: [
            { type: 'output_text', text },
          ],
          status:  'completed',
        },
      ],
      usage: {
        input_tokens:  usageIn,
        output_tokens: usageOut,
        total_tokens:  usageIn + usageOut,
      },
      status: 'completed',
    };
  }

  // ── Streaming response ────────────────────────────────────────────────────

  if (stream) {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let upstreamResponse;
    try {
      upstreamResponse = await AccountPool.chatWithRotation(rawInput, mappedModel, {
        isResponsesApi: true,
        instructions: req.body.instructions || instructions,
        tools: req.body.tools,
        tool_choice: req.body.tool_choice,
        reasoning: req.body.reasoning,
      });
    } catch (err) {
      if (!res.headersSent) {
        const status = err.statusCode || 502;
        const errMsg = `⚠️ Lỗi Upstream (Status ${status}): ${err.message}`;
        
        // 1. Send response.created event
        const responseId = 'resp-' + req_id;
        const createdEvt = {
          type:   'response.created',
          response: { id: responseId, object: 'response', status: 'in_progress', model: model, output: [] },
        };
        res.write(`event: response.created\ndata: ${JSON.stringify(createdEvt)}\n\n`);
        
        // 2. Send delta event with the error text
        const deltaEvt = {
          type:           'response.output_item.delta',
          item_id:        'msg-' + req_id,
          output_index:   0,
          content_index:  0,
          delta:          { type: 'text', text: errMsg },
        };
        res.write(`event: response.output_item.delta\ndata: ${JSON.stringify(deltaEvt)}\n\n`);
        
        // 3. Send response.completed event
        const completedEvt = {
          type: 'response.completed',
          response: buildResponsesObject(errMsg, tokensIn, Math.ceil(Math.ceil(errMsg.length / 4) * multiplier)),
        };
        res.write(`event: response.completed\ndata: ${JSON.stringify(completedEvt)}\n\n`);
        res.end();
        return;
      }
      return;
    }

    let accumulatedText = '';
    let tokensOut       = 0;

    const { createParser } = require('eventsource-parser');
    const parser = createParser((event) => {
      if (event.type === 'event' && event.event === 'response.output_text.delta') {
        try {
          const data = JSON.parse(event.data);
          accumulatedText += data.delta || '';
        } catch (_) {}
      }
    });

    try {
      const textDecoder = new TextDecoder();
      for await (const chunk of upstreamResponse.body) {
        res.write(chunk);
        const text = textDecoder.decode(chunk, { stream: true });
        parser.feed(text);
      }
    } catch (streamErr) {
      logger.error('Error during responses stream', streamErr);
    } finally {
      res.end();
    }

    const rawTokensOut = Math.ceil(accumulatedText.length / 4);
    tokensOut = Math.ceil(rawTokensOut * multiplier);

    setImmediate(async () => {
      try {
        await ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
        await UsageLog.create({ apiKey: req.apiKey, model: model, tokensIn, tokensOut, reqId: req_id });
      } catch (logErr) {
        logger.error('Failed to record usage (responses stream)', logErr);
      }
    });
    return;
  }

  // ── Non-streaming response ────────────────────────────────────────────────

  let upstreamResponse;
  try {
    upstreamResponse = await AccountPool.chatWithRotation(rawInput, mappedModel, {
      isResponsesApi: true,
      instructions: req.body.instructions || instructions,
      tools: req.body.tools,
      tool_choice: req.body.tool_choice,
      reasoning: req.body.reasoning,
    });
  } catch (err) {
    const status = err.statusCode || 502;
    throw new AppError(err.message, status, err.code || 'UPSTREAM_ERROR');
  }

  const completion = await Converter.collectFull(upstreamResponse, mappedModel);
  const outputText = completion?.choices?.[0]?.message?.content ?? '';
  const rawTokensOut = Math.ceil(outputText.length / 4);
  const tokensOut = Math.ceil(rawTokensOut * multiplier);

  setImmediate(async () => {
    try {
      await ApiKey.addUsage(req.apiKey, tokensIn, tokensOut);
      await UsageLog.create({ apiKey: req.apiKey, model: model, tokensIn, tokensOut, reqId: req_id });
    } catch (logErr) {
      logger.error('Failed to record usage (responses)', logErr);
    }
  });

  res.json(buildResponsesObject(outputText, tokensIn, tokensOut));
}));

// ─── Catch-all for unsupported /v1/* endpoints ────────────────────────────────

router.all('/*', (req, res) => {
  res.status(404).json({
    error: {
      message:    `The endpoint ${req.method} ${req.path} is not supported by this proxy.`,
      code:       'UNSUPPORTED_ENDPOINT',
      statusCode: 404,
    },
  });
});

module.exports = router;
