'use strict';

const logger = require('../utils/logger').create('ChatGPTClient');
const pow    = require('./pow');

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

  /**
   * Return device ID if stored in the session token JSON, or generate a deterministic one based on token hash.
   */
  getDeviceId() {
    const clean = (this.sessionToken || '').trim();
    if (clean.startsWith('{')) {
      try {
        const obj = JSON.parse(clean);
        if (obj.deviceId && typeof obj.deviceId === 'string') {
          return obj.deviceId.trim();
        }
      } catch (_) {}
    }
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(this.sessionToken).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve (or use cached) access token.
   *
   * @returns {Promise<string>} Bearer access token
   * @throws {{ code: 'INVALID_SESSION' }}
   */
  _isCodexOAuth() {
    const clean = (this.sessionToken || '').trim();
    if (clean.startsWith('{')) {
      try {
        const obj = JSON.parse(clean);
        return !!(obj.accessToken && obj.refreshToken);
      } catch (_) {}
    }
    return false;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve (or use cached) access token.
   *
   * @returns {Promise<string>} Bearer access token
   * @throws {{ code: 'INVALID_SESSION' }}
   */
  async getAccessToken() {
    const now = Date.now();

    if (this._isCodexOAuth()) {
      const wrapper = JSON.parse(this.sessionToken);
      
      if (this._accessToken && now < this._tokenExpiry) {
        return this._accessToken;
      }

      const tokenParsed = parseTokenInput(wrapper.accessToken);
      if (tokenParsed.type === 'accessToken' && now < tokenParsed.expiry) {
        this._accessToken = wrapper.accessToken;
        this._tokenExpiry = tokenParsed.expiry;
        return this._accessToken;
      }

      logger.info('Refreshing Codex OAuth access token using refresh_token...');
      try {
        const { gotScraping } = await import('got-scraping');
        const response = await gotScraping.post('https://auth.openai.com/oauth/token', {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
            refresh_token: wrapper.refreshToken,
            scope: 'openid profile email offline_access',
          }).toString(),
          useHeaderGenerator: false
        });

        if (response.statusCode !== 200) {
          throw new Error(`OpenAI token server returned ${response.statusCode}: ${response.body}`);
        }

        const tokens = JSON.parse(response.body);
        const nextAccessToken = tokens.access_token;
        const nextRefreshToken = tokens.refresh_token || wrapper.refreshToken;

        if (!nextAccessToken) {
          throw new Error('Response did not contain access_token');
        }

        const newWrapper = {
          accessToken: nextAccessToken,
          refreshToken: nextRefreshToken,
          deviceId: wrapper.deviceId || ''
        };

        const db = require('../db');
        await db.run(
          'UPDATE upstream_accounts SET session_token = ? WHERE session_token = ?',
          [JSON.stringify(newWrapper), this.sessionToken]
        );

        this.sessionToken = JSON.stringify(newWrapper);
        this._accessToken = nextAccessToken;
        const nextParsed = parseTokenInput(nextAccessToken);
        this._tokenExpiry = nextParsed.expiry;

        logger.info('Codex OAuth token refreshed and updated in database successfully.');
        return this._accessToken;
      } catch (err) {
        logger.error('Failed to refresh Codex OAuth token:', err.message);
        const error = new Error('Failed to refresh Codex OAuth token: ' + err.message);
        error.code = 'INVALID_SESSION';
        throw error;
      }
    }

    const parsed = parseTokenInput(this.sessionToken);

    if (parsed.type === 'invalid') {
      const err = new Error('The configured upstream token/JSON is invalid or empty');
      err.code = 'INVALID_SESSION';
      throw err;
    }

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

    const { gotScraping } = await import('got-scraping');
    let res;
    try {
      res = await gotScraping.get('https://chatgpt.com/api/auth/session', {
        headers: {
          'Cookie':     `__Secure-next-auth.session-token=${sessionTokenVal}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept':     'application/json',
          'Referer':    'https://chatgpt.com/',
        },
        useHeaderGenerator: false
      });
    } catch (networkErr) {
      logger.error('Network error fetching session', networkErr);
      const status = networkErr.response ? networkErr.response.statusCode : 500;
      if (status === 401 || status === 403) {
        const invalid = new Error('Session token is invalid or expired');
        invalid.code  = 'INVALID_SESSION';
        throw invalid;
      }
      const err = new Error('Network error reaching ChatGPT auth endpoint');
      err.code  = 'NETWORK_ERROR';
      throw err;
    }

    let json;
    try {
      json = JSON.parse(res.body);
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
   * @returns {Promise<Object>} Raw streaming Response wrapper
   * @throws {{ code: 'RATE_LIMITED' | 'INVALID_SESSION' | 'NETWORK_ERROR' }}
   */
  async chat(messages, model = 'gpt-4o') {
    const accessToken  = await this.getAccessToken();
    if (this._isCodexOAuth()) {
      return this._chatCodexResponses(messages, model, accessToken);
    }
    const mappedModel  = mapModel(model);
    const turns        = this._convertMessages(messages);

    const { gotScraping } = await import('got-scraping');

    // Deterministic device ID based on token hash to build reputation
    const deviceId = this.getDeviceId();
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const baseHeaders = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'oai-device-id': deviceId,
      'oai-language': 'en-US',
      'origin': 'https://chatgpt.com',
      'referer': 'https://chatgpt.com/',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': userAgent,
    };

    // Add cookies if JWE session token is used
    const parsed = parseTokenInput(this.sessionToken);
    if (parsed.type === 'sessionToken') {
      baseHeaders['Cookie'] = `__Secure-next-auth.session-token=${parsed.sessionToken}; oai-did=${deviceId}`;
    } else {
      baseHeaders['Cookie'] = `oai-did=${deviceId}`;
    }

    // 1. Fetch requirements
    logger.debug(`[${deviceId}] Fetching sentinel chat-requirements`);
    let reqRes;
    try {
      reqRes = await gotScraping.post('https://chatgpt.com/backend-api/sentinel/chat-requirements', {
        headers: baseHeaders,
        useHeaderGenerator: false,
        json: {}
      });
    } catch (reqErr) {
      logger.error('Failed to fetch chat-requirements', reqErr);
      const status = reqErr.response ? reqErr.response.statusCode : 502;
      const err = new Error(`Failed to fetch chat-requirements: ${reqErr.message}`);
      err.code = 'UPSTREAM_ERROR';
      err.statusCode = status;
      throw err;
    }

    if (reqRes.statusCode !== 200) {
      const err = new Error(`Chat requirements returned status ${reqRes.statusCode}`);
      err.code = 'UPSTREAM_ERROR';
      err.statusCode = reqRes.statusCode;
      throw err;
    }

    let reqData;
    try {
      reqData = JSON.parse(reqRes.body);
    } catch (_) {
      const err = new Error('Failed to parse chat-requirements response');
      err.code = 'UPSTREAM_ERROR';
      err.statusCode = 502;
      throw err;
    }

    // 2. Solve Proof of Work
    let proofToken = null;
    if (reqData.proofofwork && reqData.proofofwork.required) {
      logger.debug(`Solving PoW challenge... seed=${reqData.proofofwork.seed}, diff=${reqData.proofofwork.difficulty}`);
      try {
        proofToken = pow.solve(reqData.proofofwork.seed, reqData.proofofwork.difficulty, userAgent);
        logger.debug('PoW challenge solved successfully');
      } catch (powErr) {
        logger.error('Failed to solve Proof of Work', powErr);
        const err = new Error('Failed to solve Proof of Work challenge');
        err.code = 'UPSTREAM_ERROR';
        err.statusCode = 500;
        throw err;
      }
    }

    // 3. Construct final headers
    const finalHeaders = {
      ...baseHeaders,
      'accept': 'text/event-stream',
      'openai-sentinel-chat-requirements-token': reqData.token,
    };

    if (proofToken) {
      finalHeaders['openai-sentinel-proof-token'] = proofToken;
    }

    // 4. Send chat request to conversation API
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

    logger.debug(`Sending chat stream to ChatGPT (model=${mappedModel})`);

    return new Promise((resolve, reject) => {
      const stream = gotScraping.stream('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
        headers: finalHeaders,
        json: body,
        useHeaderGenerator: false
      });

      stream.on('response', (response) => {
        if (response.statusCode >= 400) {
          let errorBody = '';
          stream.on('data', chunk => {
            errorBody += chunk.toString('utf-8');
          });
          stream.on('end', () => {
            let message = 'Upstream error';
            try {
              const parsed = JSON.parse(errorBody);
              message = parsed.detail || parsed.message || errorBody;
            } catch (_) {
              message = errorBody || `HTTP ${response.statusCode}`;
            }
            logger.error(`Upstream error response (${response.statusCode}): ${message}`);
            const err = new Error(message);
            err.statusCode = response.statusCode;
            if (response.statusCode === 429) err.code = 'RATE_LIMITED';
            else if (response.statusCode === 401 || response.statusCode === 403) err.code = 'INVALID_SESSION';
            else err.code = 'UPSTREAM_ERROR';
            reject(err);
          });
        } else {
          logger.info('Conversation stream connection established successfully');
          resolve({
            ok: true,
            status: response.statusCode,
            headers: response.headers,
            body: stream
          });
        }
      });

    });
  }

  // ── Codex Responses API Support ───────────────────────────────────────────

  _extractInstructions(messages) {
    const sys = messages.find(m => m.role === 'system');
    return sys ? sys.content : '';
  }

  _convertToCodexInput(messages) {
    const input = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user' || msg.role === 'assistant') {
        const contentType = msg.role === 'user' ? 'input_text' : 'output_text';
        let textContent = '';
        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (Array.isArray(msg.content)) {
          textContent = msg.content
            .map(c => {
              if (c.type === 'text') return c.text;
              return c.text || c.content || '';
            })
            .filter(Boolean)
            .join('');
        }

        if (textContent) {
          input.push({
            type: 'message',
            role: msg.role,
            content: [{ type: contentType, text: textContent }]
          });
        }
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          input.push({
            type: 'function_call',
            call_id: tc.id || `call_${Date.now()}`,
            name: tc.function?.name || '_unknown',
            arguments: tc.function?.arguments || '{}'
          });
        }
      }

      if (msg.role === 'tool') {
        const output = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output
        });
      }
    }

    if (input.length === 0) {
      input.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '...' }]
      });
    }

    return input;
  }

  async _chatCodexResponses(messages, model, accessToken) {
    const mappedModel = mapModel(model);
    const { gotScraping } = await import('got-scraping');
    
    const input = this._convertToCodexInput(messages);
    const instructions = this._extractInstructions(messages);

    const body = {
      model: mappedModel,
      input: input,
      instructions: instructions || "You are a helpful assistant.",
      stream: true,
      store: false,
      reasoning: {
        effort: "low",
        summary: "auto"
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${accessToken}`,
      'originator': 'codex_cli_rs',
      'User-Agent': 'codex-cli/1.0.18 (macOS; arm64)',
      'session_id': this.getDeviceId() || 'default'
    };

    logger.debug(`Sending request to Codex Responses API (model=${mappedModel})`);

    return new Promise((resolve, reject) => {
      const stream = gotScraping.stream('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers,
        json: body,
        useHeaderGenerator: false
      });

      stream.on('response', (response) => {
        if (response.statusCode >= 400) {
          let errorBody = '';
          stream.on('data', chunk => {
            errorBody += chunk.toString('utf-8');
          });
          stream.on('end', () => {
            let message = 'Codex responses API error';
            try {
              const parsed = JSON.parse(errorBody);
              message = parsed.error?.message || parsed.detail || errorBody;
            } catch (_) {
              message = errorBody || `HTTP ${response.statusCode}`;
            }
            logger.error(`Codex Responses error response (${response.statusCode}): ${message}`);
            const err = new Error(message);
            err.statusCode = response.statusCode;
            if (response.statusCode === 429) err.code = 'RATE_LIMITED';
            else if (response.statusCode === 401 || response.statusCode === 403) err.code = 'INVALID_SESSION';
            else err.code = 'UPSTREAM_ERROR';
            reject(err);
          });
        } else {
          logger.info('Codex Responses stream connection established successfully');
          resolve({
            ok: true,
            status: response.statusCode,
            headers: response.headers,
            body: stream,
            isCodex: true
          });
        }
      });

      stream.on('error', (err) => {
        if (err.name === 'HTTPError') return;
        logger.error('Codex stream network error', err);
        reject(err);
      });
    });
  }
}

module.exports = { ChatGPTClient, mapModel };

