import { extractUsage } from "open-sse/utils/usageTracking.js";
import { getDiskCache, setDiskCache } from "../db/helpers/diskCache.js";
import { 
  getClientKeyByToken, 
  getClientKeyById, 
  incrementClientKeyTokens, 
  logClientKeyUsage as logClientKeyUsageInDb 
} from "../db/repos/clientKeysRepo.js";

// Cache of sent quota alerts to avoid spamming (keyId -> timestamp)
const sentQuotaAlerts = new Map();

// ─── In-memory + Disk cache: giảm số lần query DB ───────────────────────────
const KEY_CACHE_TTL_MS = 120_000;
const DISK_CACHE_KEY = "auth:clientKeysByToken";
const keyCache = new Map(); // token -> { data, expiresAt }

function getCachedKey(token) {
  const entry = keyCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    return null;
  }
  return entry.data;
}

function getStaleCachedKey(token) {
  const entry = keyCache.get(token);
  if (entry) return entry.data;
  const diskMap = getDiskCache(DISK_CACHE_KEY, {});
  return diskMap[token] || null;
}

function setCachedKey(token, data) {
  keyCache.set(token, { data, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  if (keyCache.size > 5000) {
    const firstKey = keyCache.keys().next().value;
    keyCache.delete(firstKey);
  }
  const diskMap = getDiskCache(DISK_CACHE_KEY, {});
  diskMap[token] = data;
  setDiskCache(DISK_CACHE_KEY, diskMap);
}

function invalidateCachedKey(token) {
  keyCache.delete(token);
}

/**
 * Invalidate client key in-memory and disk cache.
 */
export function invalidateClientKeyCache({ id, token } = {}) {
  if (token) {
    keyCache.delete(token);
  }
  if (id) {
    for (const [t, entry] of keyCache.entries()) {
      if (entry?.data?.id === id) {
        keyCache.delete(t);
      }
    }
    multiplierCache.delete(id);
  }

  try {
    const diskMap = getDiskCache(DISK_CACHE_KEY, {});
    let changed = false;
    if (token && diskMap[token]) {
      delete diskMap[token];
      changed = true;
    }
    if (id) {
      for (const [t, data] of Object.entries(diskMap)) {
        if (data?.id === id) {
          delete diskMap[t];
          changed = true;
        }
      }
    }
    if (changed) {
      setDiskCache(DISK_CACHE_KEY, diskMap);
    }
  } catch (err) {
    console.error("[ClientKeyAuth] Failed to invalidate disk cache:", err?.message || err);
  }
}

// ─── Rate limit sliding window ──────────────────────────────────────────────
const rateLimitWindows = new Map();
const RATE_WINDOW_MS = 60_000;

function checkRateLimitLocal(keyId, rateLimit) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const window = (rateLimitWindows.get(keyId) || []).filter(t => t > cutoff);
  if (window.length >= rateLimit) {
    rateLimitWindows.set(keyId, window);
    return { allowed: false, count: window.length };
  }
  window.push(now);
  rateLimitWindows.set(keyId, window);
  if (rateLimitWindows.size > 10000) {
    const firstKey = rateLimitWindows.keys().next().value;
    rateLimitWindows.delete(firstKey);
  }
  return { allowed: true, count: window.length };
}

/**
 * Validates a client key (prefix `ck-` or `sk-`) against SQLite database.
 * Returns { valid: true, keyData: {...} } or { valid: false, error: '...' }
 */
export async function validateClientKey(bearerToken, options = {}) {
  const token = (bearerToken || '').trim();
  if (!token) {
    return { valid: false, error: 'Invalid client key' };
  }

  // Check cache first
  const cached = getCachedKey(token);
  if (cached) {
    if (cached.expires_at && new Date(cached.expires_at) < new Date()) {
      invalidateCachedKey(token);
      return { valid: false, error: 'Client key has expired' };
    }
    const quota = Number(cached.quota_tokens) || 0;
    const used = Number(cached.used_tokens) || 0;
    if (quota > 0 && used >= quota) {
      invalidateCachedKey(token);
      return { valid: false, error: 'Token quota exceeded' };
    }
    if (!options.skipRateLimit) {
      const rateLimit = Number(cached.rate_limit_per_minute) || 1024;
      const rlResult = checkRateLimitLocal(cached.id, rateLimit);
      if (!rlResult.allowed) {
        return { valid: false, error: `Rate limit exceeded (${rateLimit}/min)` };
      }
    }
    return { valid: true, keyData: cached };
  }

  // Cache miss → query local SQLite via repository
  let keyData;
  try {
    keyData = await getClientKeyByToken(token, { includeInactive: false });
  } catch (err) {
    console.error('[ClientKeyAuth] SQLite query error:', err.message);
    const stale = getStaleCachedKey(token);
    if (stale) {
      setCachedKey(token, stale);
      return { valid: true, keyData: stale };
    }
    return { valid: false, error: 'Database error validating client key' };
  }

  if (!keyData || keyData.active === false || keyData.active === 0) {
    return { valid: false, error: 'Invalid or inactive client key' };
  }

  // Check expiration
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    return { valid: false, error: 'Client key has expired' };
  }

  // Check token quota
  const quota = Number(keyData.quota_tokens) || 0;
  const used = Number(keyData.used_tokens) || 0;
  if (quota > 0 && used >= quota) {
    return { valid: false, error: 'Token quota exceeded' };
  }

  // Check rate limit
  if (!options.skipRateLimit) {
    const rateLimit = Number(keyData.rate_limit_per_minute) || 1024;
    const rlResult = checkRateLimitLocal(keyData.id, rateLimit);
    if (!rlResult.allowed) {
      return { valid: false, error: `Rate limit exceeded (${rateLimit}/min)` };
    }
  }

  // Save to cache
  setCachedKey(token, keyData);

  return { valid: true, keyData };
}

// Cache model_multiplier per keyId
const multiplierCache = new Map();

/**
 * Log token usage for a client key after request completion.
 */
export async function logClientKeyUsage(clientKeyId, model, promptTokens, completionTokens) {
  let multiplier = 1;
  try {
    let mm = multiplierCache.get(clientKeyId);
    if (!mm) {
      for (const entry of keyCache.values()) {
        if (entry.data?.id === clientKeyId) {
          mm = entry.data.model_multiplier || {};
          multiplierCache.set(clientKeyId, mm);
          break;
        }
      }
    }
    if (!mm) {
      const keyData = await getClientKeyById(clientKeyId);
      if (keyData) {
        mm = keyData.model_multiplier || {};
        multiplierCache.set(clientKeyId, mm);
        if (multiplierCache.size > 500) {
          const firstKey = multiplierCache.keys().next().value;
          multiplierCache.delete(firstKey);
        }
      }
    }
    if (mm && model) {
      if (mm[model] !== undefined) {
        multiplier = Number(mm[model]) || 1;
      } else {
        for (const [keyPattern, value] of Object.entries(mm)) {
          if (model.includes(keyPattern)) {
            multiplier = Number(value) || 1;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error('[ClientKeyAuth] Failed to load model multiplier:', err);
  }

  const billedTokens = Math.ceil((promptTokens + completionTokens) * multiplier);

  try {
    // 1. Insert usage log into SQLite
    await logClientKeyUsageInDb({
      client_key_id: clientKeyId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      billed_tokens: billedTokens,
    });

    // 2. Increment used_tokens in SQLite
    const updated = await incrementClientKeyTokens(clientKeyId, billedTokens);
    const used = Number(updated?.used_tokens) || 0;
    const quota = Number(updated?.quota_tokens) || 0;

    // Update in-memory cache
    for (const entry of keyCache.values()) {
      if (entry.data?.id === clientKeyId) {
        entry.data.used_tokens = used;
        break;
      }
    }

    // 3. Telegram quota alert if >= 90%
    if (quota > 0) {
      const pct = (used / quota) * 100;
      if (pct >= 90) {
        const keyIdStr = clientKeyId.toString();
        const now = Date.now();
        const lastAlertTime = sentQuotaAlerts.get(keyIdStr) || 0;
        if (now - lastAlertTime > 12 * 60 * 60 * 1000) {
          sentQuotaAlerts.set(keyIdStr, now);
          const { sendTelegramAlert } = await import('@/lib/telegramAlert.js');
          let keyLabel = updated?.label || 'Client Key';
          let maskedKey = updated?.key ? (updated.key.slice(0, 7) + '...' + updated.key.slice(-4)) : 'unknown';
          sendTelegramAlert(
            '⚠️ <b>[9Router Alert] Client Key Quota Near Limit (>= 90%)</b>\n' +
            '• Key Label: <code>' + keyLabel + '</code>\n' +
            '• Key Value: <code>' + maskedKey + '</code>\n' +
            '• Used: <code>' + used.toLocaleString() + '</code> tokens\n' +
            '• Quota: <code>' + quota.toLocaleString() + '</code> tokens\n' +
            '• Usage: <b>' + pct.toFixed(2) + '%</b>'
          ).catch(err => console.error('[QuotaAlert] Alert failed:', err));
        }
      }
    }
  } catch (err) {
    console.warn('[ClientKeyAuth] Error recording usage:', err.message);
  }
}

/**
 * Extract Bearer token from request headers.
 */
export function extractBearerToken(request) {
  const authHeader = (request.headers.get("authorization") || request.headers.get("Authorization") || "").trim();
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader.startsWith("sk-") || authHeader.startsWith("ck-")) {
    return authHeader;
  }

  const googKey = request.headers.get("x-goog-api-key") || request.headers.get("X-Goog-Api-Key");
  if (googKey) return googKey.trim();

  const xApiKey = request.headers.get("x-api-key") || request.headers.get("X-Api-Key");
  if (xApiKey) return xApiKey.trim();

  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    if (keyParam) return keyParam.trim();
  } catch (e) {}

  return null;
}

/**
 * Wrap a Next.js Response to intercept, read tokens usage, and log it to SQLite.
 */
function extractTextFromChunk(parsed) {
  if (!parsed) return "";
  if (parsed.choices?.[0]?.delta?.content) {
    return parsed.choices[0].delta.content;
  }
  if (typeof parsed.delta === "string") {
    return parsed.delta;
  }
  if (parsed.delta?.text) {
    return parsed.delta.text;
  }
  if (parsed.content?.text) {
    return parsed.content.text;
  }
  if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
    return parsed.candidates[0].content.parts[0].text;
  }
  const parts = parsed.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map(p => p.text || "").join("");
  }
  return "";
}

export async function wrapResponseWithClientKeyLogging(response, clientKeyId, model, reqBodyOrTokens = null) {
  if (!response.ok) return response;

  const fallbackPromptTokens = typeof reqBodyOrTokens === "number"
    ? reqBodyOrTokens
    : (reqBodyOrTokens ? Math.ceil(JSON.stringify(reqBodyOrTokens).length / 4) : 1000);

  const internalModel = response.headers.get("x-9r-actual-model");
  const actualModel = internalModel || model || "unknown";

  const contentType = response.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (isStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let hasLogged = false;
    let accumulatedLen = 0;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer) {
                const lines = buffer.split(/\r?\n/);
                for (const line of lines) {
                  if (line.startsWith('data:')) {
                    const dataStr = line.slice(5).trim();
                    if (dataStr && dataStr !== '[DONE]') {
                      try {
                        const parsed = JSON.parse(dataStr);
                        accumulatedLen += extractTextFromChunk(parsed).length;
                        const usage = extractUsage(parsed);
                        if (usage) {
                          const { prompt_tokens = 0, completion_tokens = 0 } = usage;
                          if (prompt_tokens > 0 || completion_tokens > 0) {
                            hasLogged = true;
                            logClientKeyUsage(clientKeyId, actualModel, prompt_tokens, completion_tokens)
                              .catch(err => console.error('[ClientKeyAuth] Failed to log usage:', err.message));
                          }
                        }
                      } catch (e) {}
                    }
                  }
                }
              }

              if (!hasLogged) {
                const completionTokens = Math.max(1, Math.floor(accumulatedLen / 4));
                logClientKeyUsage(clientKeyId, actualModel, fallbackPromptTokens, completionTokens)
                  .catch(err => console.error('[ClientKeyAuth] Failed to log fallback usage:', err.message));
              }

              controller.close();
              break;
            }

            controller.enqueue(value);

            const text = decoder.decode(value, { stream: true });
            buffer += text;

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr);
                    accumulatedLen += extractTextFromChunk(parsed).length;
                    const usage = extractUsage(parsed);
                    if (usage) {
                      const { prompt_tokens = 0, completion_tokens = 0 } = usage;
                      if (prompt_tokens > 0 || completion_tokens > 0) {
                        hasLogged = true;
                        logClientKeyUsage(clientKeyId, actualModel, prompt_tokens, completion_tokens)
                          .catch(err => console.error('[ClientKeyAuth] Failed to log usage:', err.message));
                      }
                    }
                  } catch (e) {}
                }
              }
            }
          }
        } catch (err) {
          console.error('[ClientKeyAuth] Stream processing error:', err);
          try { controller.error(err); } catch {}
        }
      }
    });

    return new Response(stream, {
      status: response.status,
      headers: response.headers,
    });
  } else {
    // Non-streaming response
    try {
      const clonedResponse = response.clone();
      const body = await clonedResponse.json();
      
      let usage = extractUsage(body);
      if (!usage) {
        const content = body.choices?.[0]?.message?.content || body.content || "";
        usage = {
          prompt_tokens: fallbackPromptTokens,
          completion_tokens: Math.max(1, Math.floor(content.length / 4))
        };
      }
      if (usage) {
        const { prompt_tokens = 0, completion_tokens = 0 } = usage;
        logClientKeyUsage(clientKeyId, actualModel, prompt_tokens, completion_tokens)
          .catch(err => console.error('[ClientKeyAuth] Failed to log non-stream usage:', err.message));
      }
    } catch (err) {
      console.error('[ClientKeyAuth] Failed to parse non-stream response for logging:', err.message);
    }
    return response;
  }
}
