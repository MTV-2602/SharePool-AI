'use strict';

const { createParser } = require('eventsource-parser');
const { v4: uuidv4 }   = require('uuid');
const logger           = require('../utils/logger').create('Converter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an OpenAI-compatible SSE chunk string.
 *
 * @param {Object} delta        - The delta object ({ role? } or { content })
 * @param {string} completionId
 * @param {string} model
 * @param {string|null} finishReason
 * @returns {string}  Formatted "data: {...}\n\n" string
 */
function buildChunk(delta, completionId, model, finishReason = null) {
  const chunk = {
    id:      completionId,
    object:  'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index:         0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Extract the text content from a ChatGPT SSE data payload.
 * ChatGPT sends JSON lines with a 'message.content.parts' array.
 *
 * @param {string} raw - Raw JSON string from the event data field
 * @returns {string|null} Extracted text, or null if not applicable
 */
function extractText(raw) {
  try {
    const json = JSON.parse(raw);
    // Only process assistant text messages
    if (json?.message?.author?.role !== 'assistant') return null;
    if (json?.message?.content?.content_type !== 'text') return null;

    const parts = json?.message?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) return null;

    return parts.join('');
  } catch {
    return null;
  }
}

// ─── Streaming Converter ──────────────────────────────────────────────────────

/**
 * Async generator that reads a ChatGPT SSE stream and yields OpenAI-compatible
 * SSE chunk strings.
 *
 * Yield order:
 *  1. Role chunk:    { role: 'assistant', content: '' }
 *  2. Delta chunks:  { content: '<incremental text>' }   (one or more)
 *  3. Stop chunk:    { } with finish_reason: 'stop'
 *  4. [DONE] marker: 'data: [DONE]\n\n'
 *
 * @param {import('node-fetch').Response} response   - Raw fetch Response (streaming)
 * @param {string}                        model      - Model name to echo back
 * @param {string}                        [completionId] - Optional completion id
 * @yields {string}
 */
async function* streamToOpenAI(response, model, completionId) {
  const id = completionId || ('chatcmpl-' + uuidv4().replace(/-/g, '').slice(0, 24));

  // Yield opening role chunk
  yield buildChunk({ role: 'assistant', content: '' }, id, model, null);

  let previousText = '';
  let finishedNaturally = false;

  // We'll feed chunks to eventsource-parser and collect parsed events
  const eventQueue = [];
  let resolveWait  = null;

  const parser = createParser((event) => {
    if (event.type === 'event') {
      eventQueue.push(event);
      if (resolveWait) {
        const res  = resolveWait;
        resolveWait = null;
        res();
      }
    }
  });

  // Async iterator over the node-fetch body
  const bodyIterator = response.body[Symbol.asyncIterator]
    ? response.body[Symbol.asyncIterator]()
    : (async function* () {
        for await (const chunk of response.body) {
          yield chunk;
        }
      })();

  let bodyDone = false;

  (async () => {
    try {
      for await (const chunk of bodyIterator) {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
        parser.feed(text);
      }
    } catch (err) {
      logger.error('Error reading upstream body', err);
    } finally {
      bodyDone = true;
      if (resolveWait) {
        const res  = resolveWait;
        resolveWait = null;
        res();
      }
    }
  })();

  // Drain events as they arrive
  while (true) {
    while (eventQueue.length > 0) {
      const event = eventQueue.shift();

      if (event.data === '[DONE]') {
        finishedNaturally = true;
        break;
      }

      const fullText = extractText(event.data);
      if (fullText === null) continue;

      // Compute incremental delta
      const delta = fullText.slice(previousText.length);
      previousText = fullText;

      if (delta.length > 0) {
        yield buildChunk({ content: delta }, id, model, null);
      }
    }

    if (finishedNaturally) break;
    if (bodyDone && eventQueue.length === 0) break;

    // Wait for more data
    await new Promise(resolve => { resolveWait = resolve; });
  }

  // Stop chunk
  yield buildChunk({}, id, model, 'stop');

  // [DONE] sentinel
  yield 'data: [DONE]\n\n';

  logger.debug(`Stream complete. Total output chars: ${previousText.length}`);
}

// ─── Non-Streaming Collector ──────────────────────────────────────────────────

/**
 * Consume the entire ChatGPT SSE stream and return a complete OpenAI
 * chat completion object (non-streaming format).
 *
 * @param {import('node-fetch').Response} response
 * @param {string}                        model
 * @returns {Promise<Object>}  Full OpenAI completion object
 */
async function collectFull(response, model) {
  const id = 'chatcmpl-' + uuidv4().replace(/-/g, '').slice(0, 24);
  let fullText = '';

  const parser = createParser((event) => {
    if (event.type !== 'event') return;
    if (event.data === '[DONE]') return;

    const text = extractText(event.data);
    if (text !== null && text.length > fullText.length) {
      fullText = text;
    }
  });

  for await (const chunk of response.body) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
    parser.feed(text);
  }

  // Build a minimal usage object (exact values come from addUsage later)
  const promptTokens     = 0;  // filled in by caller using estimateMessages
  const completionTokens = Math.ceil(fullText.length / 4);

  return {
    id,
    object:  'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index:         0,
        message:       { role: 'assistant', content: fullText },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
      total_tokens:      promptTokens + completionTokens,
    },
  };
}

module.exports = { streamToOpenAI, collectFull };
