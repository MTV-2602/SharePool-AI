import { supabase } from '../supabase.js';
import { extractUsage } from "open-sse/utils/usageTracking.js";

/**
 * Validates a client key (prefix `ck-`) against Supabase.
 * Returns { valid: true, keyData: {...} } or { valid: false, error: '...' }
 */
export async function validateClientKey(bearerToken) {
  const token = (bearerToken || '').trim();
  const isCk = token.startsWith('ck-');
  const isLegacySk = token.startsWith('sk-') && token.split('-').length === 2;

  if (!token || (!isCk && !isLegacySk)) {
    return { valid: false, error: 'Invalid client key format. Expected ck-... or sk-...' };
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
  const multiplier = 1; // Could be model-specific from keyData.model_multiplier
  const billedTokens = Math.ceil((promptTokens + completionTokens) * multiplier);

  // Insert usage log
  await supabase.from('client_key_usage_logs').insert({
    client_key_id: clientKeyId,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    billed_tokens: billedTokens,
  });

  // Increment used_tokens on the key
  await supabase.rpc('exec_sql', {
    query_text: 'UPDATE client_keys SET used_tokens = used_tokens + $1 WHERE id = $2',
    query_params: [billedTokens, clientKeyId],
  });
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
export async function wrapResponseWithClientKeyLogging(response, clientKeyId, model) {
  if (!response.ok) return response;

  const contentType = response.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (isStream && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    let buffer = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }

            // Forward the chunk to the client
            controller.enqueue(value);

            // Process chunk for usage logging
            const text = decoder.decode(value, { stream: true });
            buffer += text;

            const lines = buffer.split('\n');
            // Keep the last partial line in buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr && dataStr !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(dataStr);
                    // Check if usage information exists using general extractUsage (supports OpenAI, Responses API, Gemini, Claude)
                    const usage = extractUsage(parsed);
                    if (usage) {
                      const { prompt_tokens = 0, completion_tokens = 0 } = usage;
                      if (prompt_tokens > 0 || completion_tokens > 0) {
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
      
      const usage = extractUsage(body);
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
