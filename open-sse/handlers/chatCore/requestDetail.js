import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  // Note: OpenAI Responses usage ({input_tokens, input_tokens_details:{cached_tokens}})
  // also matches this branch. Its prompt is cache-INCLUSIVE and its cache rides in
  // input_tokens_details, so emit it as cached_tokens — the convention
  // canonicalizeUsage() passes through without folding. Reading it here keeps
  // cache accounting correct for /v1/responses and codex traffic.
  if (responseBody.usage?.input_tokens !== undefined) {
    const u = responseBody.usage;
    const res = {
      prompt_tokens: u.input_tokens ?? 0,
      completion_tokens: u.output_tokens ?? 0
    };
    const cached = u.cached_tokens ?? u.input_tokens_details?.cached_tokens;
    if (cached !== undefined) res.cached_tokens = cached;
    const reasoning = u.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens;
    if (reasoning !== undefined) res.reasoning_tokens = reasoning;
    if (u.cache_read_input_tokens !== undefined) res.cache_read_input_tokens = u.cache_read_input_tokens;
    if (u.cache_creation_input_tokens !== undefined) res.cache_creation_input_tokens = u.cache_creation_input_tokens;
    return res;
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    const u = responseBody.usage;
    const res = {
      prompt_tokens: u.prompt_tokens ?? 0,
      completion_tokens: u.completion_tokens ?? 0
    };
    const cached = u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens;
    if (cached !== undefined) res.cached_tokens = cached;
    const reasoning = u.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens;
    if (reasoning !== undefined) res.reasoning_tokens = reasoning;
    return res;
  }

  // Gemini format. Antigravity / gemini-cli wrap the payload in { response: {...} }.
  const usageMetadata = (responseBody.usageMetadata && typeof responseBody.usageMetadata === "object")
    ? responseBody.usageMetadata
    : (responseBody.response?.usageMetadata && typeof responseBody.response?.usageMetadata === "object"
        ? responseBody.response.usageMetadata
        : null);
  if (usageMetadata) {
    const res = {
      prompt_tokens: usageMetadata.promptTokenCount ?? 0,
      completion_tokens: usageMetadata.candidatesTokenCount ?? 0
    };
    if (usageMetadata.cachedContentTokenCount !== undefined) {
      res.cached_tokens = usageMetadata.cachedContentTokenCount;
    }
    if (usageMetadata.thoughtsTokenCount !== undefined) {
      res.reasoning_tokens = usageMetadata.thoughtsTokenCount;
    }
    return res;
  }

  return null;
}

/**
 * Canonical convention (single source of truth for storage + cost):
 *   prompt_tokens               = total input INCLUDING cache read + cache creation
 *   cached_tokens               = cache-read portion (subset of prompt_tokens)
 *   cache_creation_input_tokens = cache-write portion (subset of prompt_tokens)
 *   completion_tokens, reasoning_tokens, total_tokens
 *
 * Discriminator: Claude reports cache_read_input_tokens with a prompt that
 * EXCLUDES cache, so we fold cache into prompt. OpenAI/Gemini/Codex report
 * cached_tokens already counted inside prompt, so we pass through. Idempotent:
 * once folded the output carries cached_tokens (not cache_read_input_tokens),
 * so re-running takes the passthrough branch and does not double-add.
 *
 * @param {object} usage - a token usage object
 * @returns {object|null} canonical token object, or null for invalid input
 */
export function canonicalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;

  const toFiniteNonNegative = (v) => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const promptVal = toFiniteNonNegative(usage.prompt_tokens ?? usage.input_tokens) ?? 0;
  const completionVal = toFiniteNonNegative(usage.completion_tokens ?? usage.output_tokens) ?? 0;

  const reasoning = toFiniteNonNegative(
    usage.reasoning_tokens !== undefined
      ? usage.reasoning_tokens
      : (usage.completion_tokens_details?.reasoning_tokens !== undefined
          ? usage.completion_tokens_details.reasoning_tokens
          : usage.output_tokens_details?.reasoning_tokens)
  );

  const cacheCreation = toFiniteNonNegative(
    usage.cache_creation_input_tokens !== undefined
      ? usage.cache_creation_input_tokens
      : usage.prompt_tokens_details?.cache_creation_tokens
  );

  let prompt = promptVal;
  let cached;

  if (usage.cached_tokens === undefined &&
      (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
    // Claude exclusive cache
    cached = toFiniteNonNegative(usage.cache_read_input_tokens) ?? 0;
    prompt = promptVal + cached + (cacheCreation ?? 0);
  } else {
    // OpenAI / Gemini / Codex Responses / already canonical (cache-inclusive)
    cached = toFiniteNonNegative(
      usage.cached_tokens !== undefined
        ? usage.cached_tokens
        : (usage.prompt_tokens_details?.cached_tokens !== undefined
            ? usage.prompt_tokens_details.cached_tokens
            : usage.input_tokens_details?.cached_tokens)
    );
  }

  const result = {
    prompt_tokens: prompt,
    completion_tokens: completionVal,
    total_tokens: prompt + completionVal,
    cached_tokens: cached ?? 0,
    cache_creation_input_tokens: cacheCreation ?? 0
  };

  if (reasoning !== undefined) {
    result.reasoning_tokens = reasoning;
  }

  // Canonical metadata fields for OpenAI forwarders & storage
  result.prompt_tokens_details = {
    cached_tokens: cached ?? 0,
    ...(cacheCreation ? { cache_creation_tokens: cacheCreation } : {})
  };
  if (reasoning !== undefined) {
    result.completion_tokens_details = {
      reasoning_tokens: reasoning
    };
  }

  return result;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    status: base.status || "success",
    ...overrides
  };
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE" }) {
  if (!tokens || typeof tokens !== "object") return;

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation/reasoning tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = canonicalizeUsage(tokens);
  if (!normalized) return;

  const inTokens = normalized.prompt_tokens;
  const outTokens = normalized.completion_tokens;
  const cachedTokens = normalized.cached_tokens ?? 0;
  const cacheCreationTokens = normalized.cache_creation_input_tokens ?? 0;

  // Guard after normalization: skip write ONLY when all token counters are 0.
  // Claude cache-only requests (input_tokens: 0, cache_read_input_tokens: 500)
  // have canonical prompt_tokens: 500, so they are not dropped.
  if (inTokens === 0 && outTokens === 0 && cachedTokens === 0 && cacheCreationTokens === 0) return;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
  console.log(`${COLORS.green}[${time}] 📊 [${label}] ${(provider || "unknown").toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null
  }).catch(() => {});
}
