'use strict';

const fetch  = require('node-fetch');
const logger = require('../utils/logger').create('ChatGPTClient');

// ─── Model Mapping ────────────────────────────────────────────────────────────

/**
 * Map any OpenAI model string to a ChatGPT-supported model ID.
 *
 * Rules:
 *   - Mini/small/nano/flash variants → gpt-4o-mini
 *   - Everything else               → gpt-4o
 *
 * @param {string} model
 * @returns {'gpt-4o' | 'gpt-4o-mini'}
 */
function mapModel(model) {
  const m = (model || '').toLowerCase();

  const miniPatterns = [
    'mini', 'small', 'nano', 'flash',
    'gpt-4o-mini', 'gpt-3.5', 'gpt-35',
  ];

  for (const pat of miniPatterns) {
    if (m.includes(pat)) return 'gpt-4o-mini';
  }

  // gpt-4, gpt-4o, o1, o3, gpt-4.1, codex, gpt-4-turbo, etc.
  return 'gpt-4o';
}

// ─── ChatGPTClient ────────────────────────────────────────────────────────────

/**
 * Parse token input which can be:
 * 1. JSON payload containing accessToken (either full or partial)
 * 2. Direct accessToken JWT (starts with eyJhbGciOiJSUzI1Ni)
 * 3. Session token cookie JWE (starts with eyJhbGciOiJkaXI)
 * 
 * @param {string} input
 * @returns {{ type: 'accessToken'|'sessionToken'|'invalid', accessToken?: string, sessionToken?: string, expiry?: number }}
 */
function parseTokenInput(input) {
  if (!input || typeof input !== 'string') {
    return { type: 'invalid' };
  }
  
  const clean = input.trim();
  if (!clean) {
    return { type: 'invalid' };
  }

  // Check if it's a JSON string
  if (clean.startsWith('{')) {
    try {
      const obj = JSON.parse(clean);
      const accTok = obj.accessToken || obj.access_token;
      if (accTok && typeof accTok === 'string') {
        return parseTokenInput(accTok); // Recurse with the extracted access token
      }
    } catch (_) {
      // Continue to regex check if JSON parse fails
    }
  }

  // Regex to extract token from JSON-like or key-value structures
  const regexMatch = clean.match(/"access_token"\s*:\s*"([^"]+)"|"accessToken"\s*:\s*"([^"]+)"/i);
  if (regexMatch) {
    const extracted = regexMatch[1] || regexMatch[2];
    if (extracted) {
      return parseTokenInput(extracted);
    }
  }

  // Check if it's an accessToken JWT (starts with eyJhbGciOiJSUzI1Ni)
  if (clean.startsWith('eyJhbGciOiJSUzI1Ni')) {
    // It's a JWT. Let's decode it to get the expiry
    const parts = clean.split('.');
    let expiry = Date.now() + 55 * 60 * 1000; // default to 55 minutes
    if (parts.length >= 2) {
      try {
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
          base64 += '=';
        }
        const payloadJson = Buffer.from(base64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);
        if (payload.exp && typeof payload.exp === 'number') {
          // Subtract a 2-minute safety margin
          expiry = (payload.exp * 1000) - 2 * 60 * 1000;
        }
      } catch (err) {
        // Fallback to default expiry
      }
    }
    return {
      type: 'accessToken',
      accessToken: clean,
      expiry
    };
  }

  // Check if it's a next-auth session token JWE (starts with eyJhbGciOiJkaXI)
  if (clean.startsWith('eyJhbGciOiJkaXI')) {
    return {
      type: 'sessionToken',
      sessionToken: clean
    };
  }

  // Fallback: If it's a long string, treat it as a sessionToken
  if (clean.length > 100) {
    return {
      type: 'sessionToken',
      sessionToken: clean
    };
  }

  return { type: 'invalid' };
}

// ─── ChatGPTClient ────────────────────────────────────────────────────────────

/**
 * Reverse-engineered client for the unofficial ChatGPT web API.
 * Supports JWE session cookies, raw JWT access tokens, and session JSON payloads.
 */
class ChatGPTClient {
  /**
   * @param {string} sessionToken - JWE cookie value, JWT access token, or session JSON
   */
  constructor(sessionToken) {
    this.sessionToken = sessionToken;
    this._accessToken  = null;
    this._tokenExpiry  = 0; // Unix ms timestamp
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve (or use cached) access token.
   *
   * @returns {Promise<string>} Bearer access token
   * @throws {{ code: 'INVALID_SESSION' }}
   */
  async getAccessToken() {
    const parsed = parseTokenInput(this.sessionToken);

    if (parsed.type === 'invalid') {
      const err = new Error('The configured upstream token/JSON is invalid or empty');
      err.code = 'INVALID_SESSION';
      throw err;
    }

    const now = Date.now();

    if (parsed.type === 'accessToken') {
      // If it's a direct access token, check if it has expired
      if (now >= parsed.expiry) {
        const err = new Error('The provided ChatGPT Access Token has expired. Please update it with a new one.');
        err.code = 'INVALID_SESSION';
        throw err;
      }
      return parsed.accessToken;
    }

    // Otherwise, it's a sessionToken (JWE). Refresh from the session endpoint.
    const sessionTokenVal = parsed.sessionToken;

    // Return cached token if still valid
    if (this._accessToken && now < this._tokenExpiry) {
      return this._accessToken;
    }

    logger.debug('Fetching new access token from ChatGPT session endpoint');

    let res;
    try {
      res = await fetch('https://chatgpt.com/api/auth/session', {
        method:  'GET',
        headers: {
          'Cookie':     `__Secure-next-auth.session-token=${sessionTokenVal}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':     'application/json',
          'Referer':    'https://chatgpt.com/',
        },
      });
    } catch (networkErr) {
      logger.error('Network error fetching session', networkErr);
      const err = new Error('Network error reaching ChatGPT auth endpoint');
      err.code  = 'NETWORK_ERROR';
      throw err;
    }

    if (res.status === 401 || res.status === 403) {
      const invalid = new Error('Session token is invalid or expired');
      invalid.code  = 'INVALID_SESSION';
      throw invalid;
    }

    if (!res.ok) {
      const invalid = new Error(`Unexpected auth response: ${res.status}`);
      invalid.code  = 'INVALID_SESSION';
      throw invalid;
    }

    let json;
    try {
      json = await res.json();
    } catch {
      const invalid = new Error('Could not parse session response as JSON');
      invalid.code  = 'INVALID_SESSION';
      throw invalid;
    }

    const accessToken = json?.accessToken;
    if (!accessToken) {
      const invalid = new Error('No access token in session response — session may be expired');
      invalid.code  = 'INVALID_SESSION';
      throw invalid;
    }

    // Cache for 55 minutes
    this._accessToken = accessToken;
    this._tokenExpiry = now + 55 * 60 * 1000;
    logger.debug('Access token cached (valid 55 min)');

    return this._accessToken;
  }

  // ── Message Conversion ────────────────────────────────────────────────────

  /**
   * Convert an array of OpenAI-style messages to ChatGPT conversation turns.
   * System messages are prepended to the first user message.
   *
   * @param {Array<{ role: string, content: string }>} messages
   * @returns {{ parts: Array, systemPrefix: string }}
   */
  _convertMessages(messages) {
    // Extract system messages
    const systemParts  = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const nonSystem    = messages.filter(m => m.role !== 'system');

    // Build ChatGPT-format turns
    const turns = nonSystem.map((m, idx) => {
      let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);

      // Prepend system prompt to the first user message
      if (idx === 0 && systemParts && m.role === 'user') {
        content = `${systemParts}\n\n${content}`;
      }

      return {
        id:           crypto.randomUUID ? crypto.randomUUID() : `turn-${idx}`,
        author:       { role: m.role === 'assistant' ? 'assistant' : 'user' },
        content:      { content_type: 'text', parts: [content] },
        metadata:     {},
      };
    });

    return turns;
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  /**
   * Send a chat request to the ChatGPT backend API.
   *
   * @param {Array<{ role: string, content: string }>} messages
   * @param {string} [model='gpt-4o']
   * @returns {Promise<import('node-fetch').Response>} Raw streaming Response
   * @throws {{ code: 'RATE_LIMITED' | 'INVALID_SESSION' | 'NETWORK_ERROR' }}
   */
  async chat(messages, model = 'gpt-4o') {
    const accessToken  = await this.getAccessToken();
    const mappedModel  = mapModel(model);
    const turns        = this._convertMessages(messages);

    const body = {
      action:     'next',
      messages:   turns,
      model:      mappedModel,
      parent_message_id: 'aaa1' + Math.random().toString(36).slice(2),
      history_and_training_disabled: true,
      conversation_mode: { kind: 'primary_assistant' },
      force_paragen:        false,
      force_paragen_model_slug: '',
      force_nulligen:       false,
      force_rate_limit:     false,
    };

    logger.debug(`Sending chat to ChatGPT (model=${mappedModel}, turns=${turns.length})`);

    let res;
    try {
      res = await fetch('https://chatgpt.com/backend-api/conversation', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
          'Accept':        'text/event-stream',
          'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer':       'https://chatgpt.com/',
          'Origin':        'https://chatgpt.com',
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      logger.error('Network error during chat request', networkErr);
      const err = new Error('Network error reaching ChatGPT API');
      err.code  = 'NETWORK_ERROR';
      throw err;
    }

    if (res.status === 429) {
      logger.warn('ChatGPT rate limited (429)');
      const err = new Error('ChatGPT rate limit hit');
      err.code  = 'RATE_LIMITED';
      throw err;
    }

    if (res.status === 401 || res.status === 403) {
      logger.warn(`ChatGPT auth error (${res.status}) — invalidating token cache`);
      // Invalidate cached token so next attempt re-fetches
      this._accessToken = null;
      this._tokenExpiry = 0;
      const err = new Error('ChatGPT session rejected request');
      err.code  = 'INVALID_SESSION';
      throw err;
    }

    if (!res.ok) {
      logger.error(`ChatGPT unexpected error status: ${res.status}`);
      const err = new Error(`ChatGPT returned unexpected status ${res.status}`);
      err.code  = 'UPSTREAM_ERROR';
      throw err;
    }

    return res;
  }
}

module.exports = { ChatGPTClient, mapModel };
