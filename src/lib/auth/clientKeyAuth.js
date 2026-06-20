import { supabase } from '../supabase.js';
import { extractUsage } from "open-sse/utils/usageTracking.js";

// Cache of sent quota alerts to avoid spamming (keyId -> timestamp)
const sentQuotaAlerts = new Map();

/**
 * Validates a client key (prefix `ck-`) against Supabase.
 * Returns { valid: true, keyData: {...} } or { valid: false, error: '...' }
 */
export async function validateClientKey(bearerToken) {
  const token = (bearerToken || '').trim();
  if (!token) {
    return { valid: false, error: 'Invalid client key' };
  }

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

  return { valid: true, keyData };
}

/**
 * Log token usage for a client key after request completion.
 */
export async function logClientKeyUsage(clientKeyId, model, promptTokens, completionTokens) {
  let multiplier = 1;
  try {
    const { data: keys, error: fetchError } = await supabase
      .from('client_keys')
      .select('model_multiplier')
      .eq('id', clientKeyId)
      .limit(1);
    
    if (fetchError) {
      console.error('[ClientKeyAuth] Failed to fetch key multiplier:', fetchError.message);
    } else if (keys?.length) {
      const mm = keys[0].model_multiplier || {};
      if (model && mm[model] !== undefined) {
        multiplier = Number(mm[model]) || 1;
      } else if (model) {
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

  // Insert usage log
  const { error: insertError } = await supabase.from('client_key_usage_logs').insert({
    client_key_id: clientKeyId,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    billed_tokens: billedTokens,
  });
  if (insertError) {
    console.error('[ClientKeyAuth] Failed to insert usage log:', insertError.message);
  }

  // Increment used_tokens on the key using explicit type casts
  const { error: rpcError } = await supabase.rpc('exec_sql', {
    query_text: 'UPDATE client_keys SET used_tokens = used_tokens + CAST($1 AS bigint) WHERE id = CAST($2 AS uuid)',
    query_params: [billedTokens, clientKeyId],
  });
  if (rpcError) {
    console.error('[ClientKeyAuth] Failed to increment used_tokens via exec_sql:', rpcError.message);
  }

  // Quota Threshold Alert (>= 90%)
  try {
    const { data: updatedKeys, error: checkError } = await supabase
      .from('client_keys')
      .select('key, label, used_tokens, quota_tokens')
      .eq('id', clientKeyId)
      .limit(1);

    if (!checkError && updatedKeys?.length) {
      const keyData = updatedKeys[0];
      const used = Number(keyData.used_tokens) || 0;
      const quota = Number(keyData.quota_tokens) || 0;

      if (quota > 0) {
        const pct = (used / quota) * 100;
        if (pct >= 90) {
          const keyId = clientKeyId.toString();
          const now = Date.now();
          const lastAlertTime = sentQuotaAlerts.get(keyId) || 0;
          // Send alert only once every 12 hours per key
          if (now - lastAlertTime > 12 * 60 * 60 * 1000) {
            sentQuotaAlerts.set(keyId, now);
            const { sendTelegramAlert } = await import('@/lib/telegramAlert.js');
            const maskedKey = keyData.key ? keyData.key.slice(0, 7) + '...' + keyData.key.slice(-4) : 'unknown';
            sendTelegramAlert(
              '⚠️ <b>[9Router Alert] Client Key Quota Near Limit (>= 90%)</b>\n' +
              '• Key Label: <code>' + (keyData.label || 'Unnamed Key') + '</code>\n' +
              '• Key Value: <code>' + maskedKey + '</code>\n' +
              '• Used: <code>' + used.toLocaleString() + '</code> tokens\n' +
              '• Quota: <code>' + quota.toLocaleString() + '</code> tokens\n' +
              '• Usage: <b>' + pct.toFixed(2) + '%</b>'
            ).catch(err => console.error('[QuotaAlert] Alert failed:', err));
          }
        }
      }
    }
  } catch (err) {
    console.error('[ClientKeyAuth] Quota threshold check failed:', err.message);
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
 * Wrap a Next.js Response to intercept, read tokens usage, and log it to Supabase.
 */

function extractTextFromChunk(parsed) {
  if (!parsed) return "";
  if (parsed.choices?.[0]?.delta?.content) {
    return parsed.choices[0].delta.content;
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
                            logClientKeyUsage(clientKeyId, parsed.model || model, prompt_tokens, completion_tokens)
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
                logClientKeyUsage(clientKeyId, model, promptTokens, completionTokens)
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
                        logClientKeyUsage(clientKeyId, parsed.model || model, prompt_tokens, completion_tokens)
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
        await logClientKeyUsage(clientKeyId, body.model || model, prompt_tokens, completion_tokens);
      }
    } catch (err) {
      console.error('[ClientKeyAuth] Failed to parse non-stream response for logging:', err.message);
    }
    return response;
  }
}
