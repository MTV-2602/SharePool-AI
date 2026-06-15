'use strict';

const REFRESH_RESULT_TTL_MS = 30 * 1000;
const inFlight = new Map();
const recent = new Map();

function cacheKey(refreshToken) {
  return String(refreshToken || '').slice(-32);
}

function parseFailure(status, bodyText) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch (_) {}
  const code = body?.error || body?.error_code || body?.code || '';
  const description = body?.error_description || body?.message || bodyText || '';
  const text = `${code} ${description}`.toLowerCase();
  const permanent = [
    'invalid_grant',
    'invalid_request',
    'refresh_token_reused',
    'refresh_token_expired',
    'refresh_token_invalidated'
  ].some(marker => text.includes(marker));

  return {
    status,
    code: code || (permanent ? 'invalid_grant' : 'refresh_failed'),
    description,
    permanent
  };
}

async function doRefresh(refreshToken) {
  const fetch = global.fetch || require('node-fetch');
  const response = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      refresh_token: refreshToken,
      scope: 'openid profile email offline_access',
    }).toString(),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    const failure = parseFailure(response.status, bodyText);
    const err = new Error(failure.description || `OpenAI token server returned ${response.status}`);
    err.code = failure.code;
    err.statusCode = response.status;
    err.permanent = failure.permanent;
    throw err;
  }

  let tokens;
  try {
    tokens = JSON.parse(bodyText);
  } catch (_) {
    const err = new Error('OpenAI token server returned invalid JSON');
    err.code = 'invalid_token_response';
    throw err;
  }

  if (!tokens.access_token) {
    const err = new Error('OpenAI token response did not contain access_token');
    err.code = 'invalid_token_response';
    throw err;
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn: tokens.expires_in || 3600,
    hasNewRefreshToken: Boolean(tokens.refresh_token)
  };
}

async function refreshCodexToken(refreshToken, log) {
  if (!refreshToken) {
    const err = new Error('Missing Codex refresh token');
    err.code = 'missing_refresh_token';
    err.permanent = true;
    throw err;
  }

  const key = cacheKey(refreshToken);
  const hit = recent.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    log?.debug?.('Reusing recent Codex refresh result');
    return hit.result;
  }

  if (inFlight.has(key)) {
    log?.debug?.('Waiting for in-flight Codex token refresh');
    return inFlight.get(key);
  }

  const promise = doRefresh(refreshToken)
    .then(result => {
      recent.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

module.exports = { refreshCodexToken };
