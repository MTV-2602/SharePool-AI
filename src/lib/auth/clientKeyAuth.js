import { supabase } from '../supabase.js';
import { extractUsage } from "open-sse/utils/usageTracking.js";

// Cache of sent quota alerts to avoid spamming (keyId -> timestamp)
const sentQuotaAlerts = new Map();

// ─── In-memory cache: giảm số lần query Supabase ─────────────────────────────
// TTL 30 giây — đủ để giảm tải nhưng không bỏ lỡ quota cập nhật quan trọng
const KEY_CACHE_TTL_MS = 30_000;
const keyCache = new Map(); // token -> { data, expiresAt }

function getCachedKey(token) {
  const entry = keyCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    keyCache.delete(token);
    return null;
  }
  return entry.data;
}

function setCachedKey(token, data) {
  keyCache.set(token, { data, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  // Giới hạn cache size để tránh memory leak
  if (keyCache.size > 500) {
    const firstKey = keyCache.keys().next().value;
    keyCache.delete(firstKey);
  }
}

function invalidateCachedKey(token) {
  keyCache.delete(token);
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a client key (prefix `ck-`) against Supabase.
 * Returns { valid: true, keyData: {...} } or { valid: false, error: '...' }
 * Uses 30s in-memory cache to reduce Supabase round-trips.
 */
export async function validateClientKey(bearerToken) {
  const token = (bearerToken || '').trim();
  if (!token) {
    return { valid: false, error: 'Invalid client key' };
  }

  // Thử lấy từ cache trước
  const cached = getCachedKey(token);
  if (cached) {
    // Vẫn kiểm tra quota từ cached data (nhanh, không tốn DB call)
    if (cached.expires_at && new Date(cached.expires_at) < new Date()) {
      invalidateCachedKey(token);
      return { valid: false, error: 'Client key has expired' };
    }
    const quota = Number(cached.quota_tokens) || 0;
    const used = Number(cached.used_tokens) || 0;
    if (quota > 0 && used >= quota) {
      invalidateCachedKey(token); // Force refresh khi hết quota
      return { valid: false, error: 'Token quota exceeded' };
    }
    return { valid: true, keyData: cached };
  }

  // Cache miss → query Supabase (bao gồm luôn model_multiplier để tránh query lần 2)
  const { data: keys, error } = await supabase
    .from('client_keys')
    .select('*')
    .eq('key', token)
    .eq('active', true)
    .limit(1);

  if (error || !keys?.length) {
    if (error) {
      console.error('[ClientKeyAuth] Supabase query error:', error.message);
    }
    return { valid: false, error: 'Invalid or inactive client key' };
  }

  const keyData = keys[0];

  // Check expiration
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    return { valid: false, error: 'Client key has expired' };
  }

  // Check token quota (ensure numeric comparison)
  const quota = Number(keyData.quota_tokens) || 0;
  const used = Number(keyData.used_tokens) || 0;
  if (quota > 0 && used >= quota) {
    return { valid: false, error: 'Token quota exceeded' };
  }

  // Check rate limit (sliding window: count requests in last minute)
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
  const { count, error: limitError } = await supabase
    .from('client_key_usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('client_key_id', keyData.id)
    .gte('created_at', oneMinuteAgo);

  if (limitError) {
    console.error('[ClientKeyAuth] Rate limit query error:', limitError.message);
  }

  const requestCount = count || 0;
  const rateLimit = Number(keyData.rate_limit_per_minute) || 60;
  if (requestCount >= rateLimit) {
    return { valid: false, error: `Rate limit exceeded (${rateLimit}/min)` };
  }

  // Lưu vào cache
  setCachedKey(token, keyData);

  return { valid: true, keyData };
}


// Cache model_multiplier theo keyId (không cần TTL — cùng lifecycle với keyCache)
const multiplierCache = new Map(); // clientKeyId -> model_multiplier object

/**
 * Log token usage for a client key after request completion.
 * model_multiplier lấy từ keyCache (SELECT * đã có sẵn) — không query lại.
 */
export async function logClientKeyUsage(clientKeyId, model, promptTokens, completionTokens) {
  let multiplier = 1;
  try {
    // ưu tiên lấy model_multiplier từ keyCache (SELECT * đã fetch sẵn trong validateClientKey)
    let mm = multiplierCache.get(clientKeyId);
    if (!mm) {
      // Tìm trong keyCache theo clientKeyId
      for (const entry of keyCache.values()) {
        if (entry.data?.id === clientKeyId) {
          mm = entry.data.model_multiplier || {};
          multiplierCache.set(clientKeyId, mm);
          break;
        }
      }
    }
    if (!mm) {
      // Chỉ query Supabase nếu cache miss hoàn toàn (hiếm khi xảy ra)
      const { data: keys, error: fetchError } = await supabase
        .from('client_keys')
        .select('model_multiplier')
        .eq('id', clientKeyId)
        .limit(1);
      if (fetchError) {
        console.error('[ClientKeyAuth] Failed to fetch key multiplier:', fetchError.message);
      } else if (keys?.length) {
        mm = keys[0].model_multiplier || {};
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
        // Fallback pattern matching
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

  // ── Chạy song song: ghi log VÀ cập nhật used_tokens cùng lúc ────────────────
  // increment_client_key_tokens: 1 RPC call = UPDATE + trả về {used_tokens, quota_tokens}
  // Thay thế 3 calls cũ: exec_sql UPDATE + fallback SELECT/UPDATE + SELECT quota check
  const [insertResult, rpcResult] = await Promise.allSettled([
    supabase.from('client_key_usage_logs').insert({
      client_key_id: clientKeyId,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      billed_tokens: billedTokens,
    }),
    supabase.rpc('increment_client_key_tokens', {
      p_key_id: clientKeyId,
      p_tokens: billedTokens,
    }),
  ]);

  // Sync log into Admin Dashboard (usageHistory table / ring buffer)
  try {
    const { saveRequestUsage } = await import("../db/repos/usageRepo.js");
    const providerCandidate = model.startsWith("gemini") || model.includes("flash") || model.includes("pro")
      ? "antigravity"
      : model.startsWith("gpt")
      ? "codex"
      : "antigravity";
    saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: providerCandidate,
      model: model,
      apiKey: clientKeyId,
      tokens: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      status: "ok"
    }).catch(e => console.error("[ClientKeyAuth] Failed to sync usage to Admin Dashboard:", e));
  } catch (syncErr) {
    console.error("[ClientKeyAuth] Error importing usageRepo:", syncErr);
  }

  if (insertResult.status === 'rejected' || insertResult.value?.error) {
    const err = insertResult.value?.error || insertResult.reason;
    console.error('[ClientKeyAuth] Failed to insert usage log:', err?.message || err);
  }

  // Dùng kết quả trả về từ RPC để check quota alert — không cần query thêm
  if (rpcResult.status === 'rejected' || rpcResult.value?.error) {
    const err = rpcResult.value?.error || rpcResult.reason;
    console.error('[ClientKeyAuth] Failed to increment used_tokens:', err?.message || err);
    // Fallback: dùng direct UPDATE nếu RPC chưa deploy — dùng RPC exec_sql để cộng dồn đúng
    try {
      await supabase.rpc('exec_sql', {
        query_text: 'UPDATE client_keys SET used_tokens = used_tokens + CAST($1 AS bigint) WHERE id = CAST($2 AS uuid)',
        query_params: [billedTokens, clientKeyId],
      });
    } catch (fallbackErr) {
      console.error('[ClientKeyAuth] Fallback update failed:', fallbackErr);
    }
  } else {
    // Lấy used/quota từ kết quả RPC — không tốn thêm round-trip
    const rows = rpcResult.value?.data;
    const updatedRow = Array.isArray(rows) ? rows[0] : rows;
    if (updatedRow) {
      const used = Number(updatedRow.used_tokens) || 0;
      const quota = Number(updatedRow.quota_tokens) || 0;

      // ── Sync used_tokens mới vào keyCache để quota check trong 30s tiếp chính xác ──
      for (const [tk, entry] of keyCache.entries()) {
        if (entry.data?.id === clientKeyId) {
          entry.data.used_tokens = used; // cập nhật in-place, giữ nguyên TTL
          break;
        }
      }
      // ────────────────────────────────────────────────────────────────────────────────

      if (quota > 0) {
        const pct = (used / quota) * 100;
        if (pct >= 90) {
          const keyId = clientKeyId.toString();
          const now = Date.now();
          const lastAlertTime = sentQuotaAlerts.get(keyId) || 0;
          if (now - lastAlertTime > 12 * 60 * 60 * 1000) {
            sentQuotaAlerts.set(keyId, now);
            const { sendTelegramAlert } = await import('@/lib/telegramAlert.js');
            // Lấy key/label từ cache
            let keyLabel = 'Unnamed Key';
            let maskedKey = 'unknown';
            for (const entry of keyCache.values()) {
              if (entry.data?.id === clientKeyId) {
                keyLabel = entry.data.label || keyLabel;
                maskedKey = entry.data.key
                  ? entry.data.key.slice(0, 7) + '...' + entry.data.key.slice(-4)
                  : maskedKey;
                break;
              }
            }
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
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────
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
 * Wrap a Next.js Response to intercept, read tokens usage, and log it to Supabase.
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

export async function wrapResponseWithClientKeyLogging(response, clientKeyId, model, reqBody = null) {
  if (!response.ok) return response;

  // Lấy tên model thực tế được thực thi từ header x-9r-actual-model (vd: gemini-3.6-flash-high).
  // Nếu gọi qua Combo (vd: gpt-5.4), header này sẽ chứa model thực sự đã chạy.
  const internalModel = response.headers.get("x-9r-actual-model");
  const actualModel = internalModel || model || "unknown";


  const contentType = response.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (isStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let buffer = '';
    let hasLogged = false;
    let accumulatedText = '';

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
                        accumulatedText += extractTextFromChunk(parsed);
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

              // Fallback if no usage was returned in stream
              if (!hasLogged) {
                const promptTokens = reqBody ? Math.ceil(JSON.stringify(reqBody).length / 4) : 1000;
                const completionTokens = Math.max(1, Math.floor(accumulatedText.length / 4));
                logClientKeyUsage(clientKeyId, actualModel, promptTokens, completionTokens)
                  .catch(err => console.error('[ClientKeyAuth] Failed to log fallback usage:', err.message));
              }

              controller.close();
              break;
            }

            // Forward the chunk to the client
            controller.enqueue(value);

            // Process chunk for usage logging
            const text = decoder.decode(value, { stream: true });
            buffer += text;

            const lines = buffer.split(/\r?\n/);
            // Keep the last partial line in buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr);
                    accumulatedText += extractTextFromChunk(parsed);
                    // Check if usage information exists using general extractUsage (supports OpenAI, Responses API, Gemini, Claude)
                    const usage = extractUsage(parsed);
                    if (usage) {
                      const { prompt_tokens = 0, completion_tokens = 0 } = usage;
                      if (prompt_tokens > 0 || completion_tokens > 0) {
                        hasLogged = true;
                        // Log usage asynchronously to not block the stream finish
                        logClientKeyUsage(clientKeyId, actualModel, prompt_tokens, completion_tokens)
                          .catch(err => console.error('[ClientKeyAuth] Failed to log usage:', err.message));
                      }
                    }
                  } catch (e) {
                    // Ignore parse errors (likely partial or empty lines)
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error('[ClientKeyAuth] Stream processing error:', err);
          controller.error(err);
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
          prompt_tokens: reqBody ? Math.ceil(JSON.stringify(reqBody).length / 4) : 1000,
          completion_tokens: Math.max(1, Math.floor(content.length / 4))
        };
      }
      if (usage) {
        const { prompt_tokens = 0, completion_tokens = 0 } = usage;
        await logClientKeyUsage(clientKeyId, actualModel, prompt_tokens, completion_tokens);
      }
    } catch (err) {
      console.error('[ClientKeyAuth] Failed to parse non-stream response for logging:', err.message);
    }
    return response;
  }
}
