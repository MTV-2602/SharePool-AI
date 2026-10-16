import crypto from "node:crypto";
import { parseJson } from "./jsonCol.js";

/**
 * Trims and masks an API key for safe display.
 * Retains prefix and tail so team keys sharing a machine-id prefix don't collide in logs/display.
 *
 * @param {string|null|undefined} key
 * @returns {string|null}
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 12) return trimmed.charAt(0) + "***";
  return trimmed.slice(0, 8) + "***" + trimmed.slice(-4);
}

/**
 * Computes a stable, non-reversible opaque identifier for an API key.
 * Used for bucket keys and ID references so raw secrets are never exposed in API responses.
 *
 * @param {string|null|undefined} key
 * @returns {string}
 */
export function hashKeyId(key) {
  if (!key || typeof key !== "string") return "local-no-key";
  const trimmed = key.trim();
  if (!trimmed) return "local-no-key";
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
  return `key_${hash}`;
}

/**
 * Extracts and canonicalizes token counts and cost from row data and token JSON blob.
 * Provides fallback across prompt_tokens/input_tokens, completion_tokens/output_tokens,
 * cached_tokens/cache_read_input_tokens/prompt_tokens_details, and reasoning_tokens.
 *
 * @param {object|string|null} tokens - Raw tokens blob or parsed object
 * @param {object} [row={}] - DB row containing scalar columns
 * @returns {{ promptTokens: number, completionTokens: number, cachedTokens: number, reasoningTokens: number, cost: number }}
 */
export function extractTokenStats(tokens, row = {}) {
  const t = typeof tokens === "string" ? parseJson(tokens, {}) : (tokens || {});

  // 1. Cached tokens
  let cachedTokens = 0;
  if (t.cached_tokens !== undefined) cachedTokens = Number(t.cached_tokens);
  else if (t.cachedTokens !== undefined) cachedTokens = Number(t.cachedTokens);
  else if (t.cache_read_input_tokens !== undefined) cachedTokens = Number(t.cache_read_input_tokens);
  else if (t.prompt_tokens_details?.cached_tokens !== undefined) cachedTokens = Number(t.prompt_tokens_details.cached_tokens);
  else if (t.prompt_tokens_details?.cache_read_input_tokens !== undefined) cachedTokens = Number(t.prompt_tokens_details.cache_read_input_tokens);
  else if (t.input_tokens_details?.cached_tokens !== undefined) cachedTokens = Number(t.input_tokens_details.cached_tokens);
  else if (t.input_tokens_details?.cache_read_input_tokens !== undefined) cachedTokens = Number(t.input_tokens_details.cache_read_input_tokens);
  else if (row.cachedTokens !== undefined) cachedTokens = Number(row.cachedTokens);
  else if (row.cachedtokens !== undefined) cachedTokens = Number(row.cachedtokens);
  else if (row.cached_tokens !== undefined) cachedTokens = Number(row.cached_tokens);

  // 2. Cache creation tokens (nested aliases support)
  let cacheCreationTokens = 0;
  if (t.cache_creation_input_tokens !== undefined) cacheCreationTokens = Number(t.cache_creation_input_tokens);
  else if (t.cache_creation_tokens !== undefined) cacheCreationTokens = Number(t.cache_creation_tokens);
  else if (t.prompt_tokens_details?.cache_creation_input_tokens !== undefined) cacheCreationTokens = Number(t.prompt_tokens_details.cache_creation_input_tokens);
  else if (t.prompt_tokens_details?.cache_creation_tokens !== undefined) cacheCreationTokens = Number(t.prompt_tokens_details.cache_creation_tokens);
  else if (t.input_tokens_details?.cache_creation_input_tokens !== undefined) cacheCreationTokens = Number(t.input_tokens_details.cache_creation_input_tokens);
  else if (t.input_tokens_details?.cache_creation_tokens !== undefined) cacheCreationTokens = Number(t.input_tokens_details.cache_creation_tokens);

  // 3. Reasoning tokens (nested aliases support)
  let reasoningTokens = 0;
  if (t.reasoning_tokens !== undefined) reasoningTokens = Number(t.reasoning_tokens);
  else if (t.reasoningTokens !== undefined) reasoningTokens = Number(t.reasoningTokens);
  else if (t.completion_tokens_details?.reasoning_tokens !== undefined) reasoningTokens = Number(t.completion_tokens_details.reasoning_tokens);
  else if (t.output_tokens_details?.reasoning_tokens !== undefined) reasoningTokens = Number(t.output_tokens_details.reasoning_tokens);
  else if (row.reasoningTokens !== undefined) reasoningTokens = Number(row.reasoningTokens);
  else if (row.reasoningtokens !== undefined) reasoningTokens = Number(row.reasoningtokens);
  else if (row.reasoning_tokens !== undefined) reasoningTokens = Number(row.reasoning_tokens);

  // 4. Prompt tokens (Canonical JSON prompt/input first, scalar fallback last)
  let promptTokens = 0;
  if (t.prompt_tokens !== undefined) {
    promptTokens = Number(t.prompt_tokens);
  } else if (t.input_tokens !== undefined) {
    // Check if canonical cached_tokens presence is indicated
    const isHistoricalClaudeExclusive =
      t.cached_tokens === undefined &&
      t.prompt_tokens_details?.cached_tokens === undefined &&
      t.input_tokens_details?.cached_tokens === undefined &&
      (t.cache_read_input_tokens !== undefined || t.cache_creation_input_tokens !== undefined || t.cache_creation_tokens !== undefined);

    if (isHistoricalClaudeExclusive) {
      // Historical Claude exclusive read + creation: fold into prompt
      promptTokens = Number(t.input_tokens) + cachedTokens + cacheCreationTokens;
    } else {
      promptTokens = Number(t.input_tokens);
    }
  } else if (t.prompt_tokens_details?.input_tokens !== undefined) {
    promptTokens = Number(t.prompt_tokens_details.input_tokens);
  } else if (t.input_tokens_details?.input_tokens !== undefined) {
    promptTokens = Number(t.input_tokens_details.input_tokens);
  } else if (row.promptTokens !== undefined) {
    promptTokens = Number(row.promptTokens);
  } else if (row.prompt_tokens !== undefined) {
    promptTokens = Number(row.prompt_tokens);
  } else if (row.prompttokens !== undefined) {
    promptTokens = Number(row.prompttokens);
  }

  // 5. Completion tokens
  let completionTokens = 0;
  if (t.completion_tokens !== undefined) {
    completionTokens = Number(t.completion_tokens);
  } else if (t.output_tokens !== undefined) {
    completionTokens = Number(t.output_tokens);
  } else if (t.completion_tokens_details?.output_tokens !== undefined) {
    completionTokens = Number(t.completion_tokens_details.output_tokens);
  } else if (t.output_tokens_details?.output_tokens !== undefined) {
    completionTokens = Number(t.output_tokens_details.output_tokens);
  } else if (row.completionTokens !== undefined) {
    completionTokens = Number(row.completionTokens);
  } else if (row.completion_tokens !== undefined) {
    completionTokens = Number(row.completion_tokens);
  } else if (row.completiontokens !== undefined) {
    completionTokens = Number(row.completiontokens);
  }

  const cost = Number(row.cost ?? 0);

  return {
    promptTokens: isNaN(promptTokens) ? 0 : promptTokens,
    completionTokens: isNaN(completionTokens) ? 0 : completionTokens,
    cachedTokens: isNaN(cachedTokens) ? 0 : cachedTokens,
    reasoningTokens: isNaN(reasoningTokens) ? 0 : reasoningTokens,
    cacheCreationTokens: isNaN(cacheCreationTokens) ? 0 : cacheCreationTokens,
    cost: isNaN(cost) ? 0 : cost,
  };
}

/**
 * Builds the bounded SQL query for aggregating usage stats across groupings.
 * Grouped by provider, model, connectionId, apiKey, and endpoint.
 *
 * @param {string|null} startIso
 * @param {string} endIso
 * @returns {{ sql: string, params: Array<string> }}
 */
export function buildStatsAggregateSql(startIso, endIso) {
  let sql = `
    SELECT
      provider,
      model,
      connectionId,
      apiKey,
      endpoint,
      COUNT(*)::int AS "requests",
      COALESCE(SUM(
        CASE
          WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
            CASE
              WHEN jsonb_exists(tokens::jsonb, 'prompt_tokens') THEN
                (tokens::jsonb->>'prompt_tokens')::numeric
              WHEN jsonb_exists(tokens::jsonb, 'input_tokens') THEN
                CASE
                  WHEN (jsonb_exists(tokens::jsonb, 'cached_tokens'))
                    OR (tokens::jsonb #> '{prompt_tokens_details,cached_tokens}' IS NOT NULL)
                    OR (tokens::jsonb #> '{input_tokens_details,cached_tokens}' IS NOT NULL) THEN
                    (tokens::jsonb->>'input_tokens')::numeric
                  WHEN (jsonb_exists(tokens::jsonb, 'cache_read_input_tokens'))
                    OR (jsonb_exists(tokens::jsonb, 'cache_creation_input_tokens'))
                    OR (jsonb_exists(tokens::jsonb, 'cache_creation_tokens')) THEN
                    (tokens::jsonb->>'input_tokens')::numeric +
                    COALESCE((tokens::jsonb->>'cache_read_input_tokens')::numeric, 0) +
                    COALESCE(
                      (tokens::jsonb->>'cache_creation_input_tokens')::numeric,
                      (tokens::jsonb->>'cache_creation_tokens')::numeric,
                      0
                    )
                  ELSE
                    (tokens::jsonb->>'input_tokens')::numeric
                END
              WHEN tokens::jsonb #> '{prompt_tokens_details,input_tokens}' IS NOT NULL THEN
                (tokens::jsonb #>> '{prompt_tokens_details,input_tokens}')::numeric
              WHEN tokens::jsonb #> '{input_tokens_details,input_tokens}' IS NOT NULL THEN
                (tokens::jsonb #>> '{input_tokens_details,input_tokens}')::numeric
              ELSE
                COALESCE(promptTokens, 0)
            END
          ELSE
            COALESCE(promptTokens, 0)
        END
      ), 0)::numeric AS "promptTokens",
      COALESCE(SUM(
        CASE
          WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
            CASE
              WHEN jsonb_exists(tokens::jsonb, 'completion_tokens') THEN
                (tokens::jsonb->>'completion_tokens')::numeric
              WHEN jsonb_exists(tokens::jsonb, 'output_tokens') THEN
                (tokens::jsonb->>'output_tokens')::numeric
              WHEN tokens::jsonb #> '{completion_tokens_details,output_tokens}' IS NOT NULL THEN
                (tokens::jsonb #>> '{completion_tokens_details,output_tokens}')::numeric
              WHEN tokens::jsonb #> '{output_tokens_details,output_tokens}' IS NOT NULL THEN
                (tokens::jsonb #>> '{output_tokens_details,output_tokens}')::numeric
              ELSE
                COALESCE(completionTokens, 0)
            END
          ELSE
            COALESCE(completionTokens, 0)
        END
      ), 0)::numeric AS "completionTokens",
      COALESCE(SUM(
        CASE
          WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
            COALESCE(
              (tokens::jsonb->>'cached_tokens')::numeric,
              (tokens::jsonb->>'cachedTokens')::numeric,
              (tokens::jsonb->>'cache_read_input_tokens')::numeric,
              (tokens::jsonb #>> '{prompt_tokens_details,cached_tokens}')::numeric,
              (tokens::jsonb #>> '{prompt_tokens_details,cache_read_input_tokens}')::numeric,
              (tokens::jsonb #>> '{input_tokens_details,cached_tokens}')::numeric,
              (tokens::jsonb #>> '{input_tokens_details,cache_read_input_tokens}')::numeric,
              0
            )
          ELSE 0
        END
      ), 0)::numeric AS "cachedTokens",
      COALESCE(SUM(
        CASE
          WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
            COALESCE(
              (tokens::jsonb->>'reasoning_tokens')::numeric,
              (tokens::jsonb->>'reasoningTokens')::numeric,
              (tokens::jsonb #>> '{completion_tokens_details,reasoning_tokens}')::numeric,
              (tokens::jsonb #>> '{output_tokens_details,reasoning_tokens}')::numeric,
              0
            )
          ELSE 0
        END
      ), 0)::numeric AS "reasoningTokens",
      COALESCE(SUM(cost), 0)::numeric AS "cost",
      MAX(timestamp) AS "lastUsed",
      MIN(timestamp) AS "firstUsed"
    FROM usageHistory
    WHERE timestamp <= ?
  `;

  const params = [endIso];
  if (startIso) {
    sql += ` AND timestamp >= ?`;
    params.push(startIso);
  }
  sql += ` GROUP BY provider, model, connectionId, apiKey, endpoint`;

  return { sql: sql.trim(), params };
}

export function getLocalTzOffsetString(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

/**
 * Builds the bounded SQL query for chart aggregation buckets.
 *
 * @param {string} period
 * @param {string|null} startIso
 * @param {string} endIso
 * @param {string|null} [tzOffset] - Timezone offset string (e.g. "+07:00")
 * @returns {{ sql: string, params: Array<string> }}
 */
export function buildChartAggregateSql(period, startIso, endIso, tzOffset = null) {
  const isHourly = period === "today" || period === "24h";
  const formatStr = isHourly ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";
  const tz = tzOffset || getLocalTzOffsetString();
  const timestampExpr = tz ? `(timestamp::timestamptz AT TIME ZONE '${tz}')` : `timestamp`;

  let sql = `
    SELECT
      to_char(${timestampExpr}, '${formatStr}') AS bucket_key,
      COUNT(*)::int AS "requests",
      COALESCE(SUM(
        (
          CASE
            WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
              CASE
                WHEN jsonb_exists(tokens::jsonb, 'prompt_tokens') THEN
                  (tokens::jsonb->>'prompt_tokens')::numeric
                WHEN jsonb_exists(tokens::jsonb, 'input_tokens') THEN
                  CASE
                    WHEN (jsonb_exists(tokens::jsonb, 'cached_tokens'))
                      OR (tokens::jsonb #> '{prompt_tokens_details,cached_tokens}' IS NOT NULL)
                      OR (tokens::jsonb #> '{input_tokens_details,cached_tokens}' IS NOT NULL) THEN
                      (tokens::jsonb->>'input_tokens')::numeric
                    WHEN (jsonb_exists(tokens::jsonb, 'cache_read_input_tokens'))
                      OR (jsonb_exists(tokens::jsonb, 'cache_creation_input_tokens'))
                      OR (jsonb_exists(tokens::jsonb, 'cache_creation_tokens')) THEN
                      (tokens::jsonb->>'input_tokens')::numeric +
                      COALESCE((tokens::jsonb->>'cache_read_input_tokens')::numeric, 0) +
                      COALESCE(
                        (tokens::jsonb->>'cache_creation_input_tokens')::numeric,
                        (tokens::jsonb->>'cache_creation_tokens')::numeric,
                        0
                      )
                    ELSE
                      (tokens::jsonb->>'input_tokens')::numeric
                  END
                WHEN tokens::jsonb #> '{prompt_tokens_details,input_tokens}' IS NOT NULL THEN
                  (tokens::jsonb #>> '{prompt_tokens_details,input_tokens}')::numeric
                WHEN tokens::jsonb #> '{input_tokens_details,input_tokens}' IS NOT NULL THEN
                  (tokens::jsonb #>> '{input_tokens_details,input_tokens}')::numeric
                ELSE
                  COALESCE(promptTokens, 0)
              END
            ELSE
              COALESCE(promptTokens, 0)
          END
        ) +
        (
          CASE
            WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
              CASE
                WHEN jsonb_exists(tokens::jsonb, 'completion_tokens') THEN
                  (tokens::jsonb->>'completion_tokens')::numeric
                WHEN jsonb_exists(tokens::jsonb, 'output_tokens') THEN
                  (tokens::jsonb->>'output_tokens')::numeric
                WHEN tokens::jsonb #> '{completion_tokens_details,output_tokens}' IS NOT NULL THEN
                  (tokens::jsonb #>> '{completion_tokens_details,output_tokens}')::numeric
                WHEN tokens::jsonb #> '{output_tokens_details,output_tokens}' IS NOT NULL THEN
                  (tokens::jsonb #>> '{output_tokens_details,output_tokens}')::numeric
                ELSE
                  COALESCE(completionTokens, 0)
              END
            ELSE
              COALESCE(completionTokens, 0)
          END
        )
      ), 0)::numeric AS "tokens",
      COALESCE(SUM(
        CASE
          WHEN tokens IS NOT NULL AND tokens ~ '^\\s*\\{' THEN
            COALESCE(
              (tokens::jsonb->>'cached_tokens')::numeric,
              (tokens::jsonb->>'cachedTokens')::numeric,
              (tokens::jsonb->>'cache_read_input_tokens')::numeric,
              (tokens::jsonb #>> '{prompt_tokens_details,cached_tokens}')::numeric,
              (tokens::jsonb #>> '{prompt_tokens_details,cache_read_input_tokens}')::numeric,
              (tokens::jsonb #>> '{input_tokens_details,cached_tokens}')::numeric,
              (tokens::jsonb #>> '{input_tokens_details,cache_read_input_tokens}')::numeric,
              0
            )
          ELSE 0
        END
      ), 0)::numeric AS "cachedTokens",
      COALESCE(SUM(cost), 0)::numeric AS "cost",
      MIN(timestamp) AS "firstUsed"
    FROM usageHistory
    WHERE timestamp <= ?
  `;

  const params = [endIso];
  if (startIso) {
    sql += ` AND timestamp >= ?`;
    params.push(startIso);
  }
  sql += ` GROUP BY bucket_key ORDER BY bucket_key ASC`;

  return { sql: sql.trim(), params };
}

/**
 * Processes grouped SQL rows into the canonical stats response structure.
 * Redacts raw API keys, maps connections and node display names, and accumulates totals.
 *
 * @param {Array<object>} rows
 * @param {object} options
 * @param {string} options.period
 * @param {object} options.connectionMap
 * @param {object} options.providerNodeNameMap
 * @param {object} options.apiKeyMap
 * @param {string} [options.source="authoritative"]
 * @param {boolean} [options.isPartial=false]
 * @param {boolean} [options.isStale=false]
 * @returns {object}
 */
export function processGroupedStatsRows(rows = [], {
  period = "7d",
  connectionMap = {},
  providerNodeNameMap = {},
  apiKeyMap = {},
  source = "authoritative",
  isPartial = false,
  isStale = false,
} = {}) {
  let totalRequests = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCachedTokens = 0;
  let totalReasoningTokens = 0;
  let totalCost = 0;

  const byProvider = {};
  const byModel = {};
  const byAccount = {};
  const byApiKey = {};
  const byEndpoint = {};

  let oldestTimestamp = null;
  let newestTimestamp = null;

  for (const r of rows) {
    const requests = Number(r.requests ?? r.request_count ?? 0);
    const promptTokens = Number(r.promptTokens ?? r.prompttokens ?? r.prompt_tokens ?? 0);
    const completionTokens = Number(r.completionTokens ?? r.completiontokens ?? r.completion_tokens ?? 0);
    const cachedTokens = Number(r.cachedTokens ?? r.cachedtokens ?? r.cached_tokens ?? 0);
    const reasoningTokens = Number(r.reasoningTokens ?? r.reasoningtokens ?? r.reasoning_tokens ?? 0);
    const cost = Number(r.cost ?? 0);
    const provider = r.provider || "unknown";
    const model = r.model || "unknown";
    const providerDisplayName = providerNodeNameMap[provider] || provider;
    const lastUsed = r.lastUsed || r.lastused || r.last_used || null;
    const firstUsed = r.firstUsed || r.firstused || r.first_used || r.lastUsed || r.lastused || null;

    totalRequests += requests;
    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;
    totalCachedTokens += cachedTokens;
    totalReasoningTokens += reasoningTokens;
    totalCost += cost;

    if (firstUsed && (!oldestTimestamp || firstUsed < oldestTimestamp)) {
      oldestTimestamp = firstUsed;
    }
    if (lastUsed && (!newestTimestamp || lastUsed > newestTimestamp)) {
      newestTimestamp = lastUsed;
    }

    // byProvider
    if (!byProvider[provider]) {
      byProvider[provider] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        cost: 0,
      };
    }
    byProvider[provider].requests += requests;
    byProvider[provider].promptTokens += promptTokens;
    byProvider[provider].completionTokens += completionTokens;
    byProvider[provider].cachedTokens += cachedTokens;
    byProvider[provider].reasoningTokens += reasoningTokens;
    byProvider[provider].cost += cost;

    // byModel
    const modelKey = provider ? `${model} (${provider})` : model;
    if (!byModel[modelKey]) {
      byModel[modelKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        rawModel: model,
        provider: providerDisplayName,
        lastUsed,
      };
    }
    byModel[modelKey].requests += requests;
    byModel[modelKey].promptTokens += promptTokens;
    byModel[modelKey].completionTokens += completionTokens;
    byModel[modelKey].cachedTokens += cachedTokens;
    byModel[modelKey].reasoningTokens += reasoningTokens;
    byModel[modelKey].cost += cost;
    if (lastUsed && (!byModel[modelKey].lastUsed || lastUsed > byModel[modelKey].lastUsed)) {
      byModel[modelKey].lastUsed = lastUsed;
    }

    // byAccount
    if (r.connectionId) {
      const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
      const accountKey = `${model} (${provider} - ${accountName})`;
      if (!byAccount[accountKey]) {
        byAccount[accountKey] = {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          cost: 0,
          rawModel: model,
          provider: providerDisplayName,
          connectionId: r.connectionId,
          accountName,
          lastUsed,
        };
      }
      byAccount[accountKey].requests += requests;
      byAccount[accountKey].promptTokens += promptTokens;
      byAccount[accountKey].completionTokens += completionTokens;
      byAccount[accountKey].cost += cost;
      if (lastUsed && (!byAccount[accountKey].lastUsed || lastUsed > byAccount[accountKey].lastUsed)) {
        byAccount[accountKey].lastUsed = lastUsed;
      }
    }

    // byApiKey (NO raw secret keys in property names or values!)
    const rawKey = r.apiKey && typeof r.apiKey === "string" ? r.apiKey.trim() : null;
    const keyId = hashKeyId(rawKey);
    const apiKeyMasked = maskApiKey(rawKey);
    const keyInfo = rawKey ? apiKeyMap[rawKey] : null;
    const keyName = keyInfo?.name || (rawKey ? (apiKeyMasked || `Key ${keyId.slice(0, 8)}`) : "Local (No API Key)");
    const akKey = `${keyId}|${model}|${provider || "unknown"}`;

    if (!byApiKey[akKey]) {
      byApiKey[akKey] = {
        id: keyId,
        keyId,
        keyName,
        label: keyName,
        apiKeyMasked,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        cost: 0,
        rawModel: model,
        provider: providerDisplayName,
        lastUsed,
      };
    }
    const ake = byApiKey[akKey];
    ake.requests += requests;
    ake.promptTokens += promptTokens;
    ake.completionTokens += completionTokens;
    ake.cachedTokens += cachedTokens;
    ake.cost += cost;
    if (lastUsed && (!ake.lastUsed || lastUsed > ake.lastUsed)) {
      ake.lastUsed = lastUsed;
    }

    // byEndpoint
    const endpoint = r.endpoint || "Unknown";
    const epKey = `${endpoint}|${model}|${provider || "unknown"}`;
    if (!byEndpoint[epKey]) {
      byEndpoint[epKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        endpoint,
        rawModel: model,
        provider: providerDisplayName,
        lastUsed,
      };
    }
    const epe = byEndpoint[epKey];
    epe.requests += requests;
    epe.promptTokens += promptTokens;
    epe.completionTokens += completionTokens;
    epe.cost += cost;
    if (lastUsed && (!epe.lastUsed || lastUsed > epe.lastUsed)) {
      epe.lastUsed = lastUsed;
    }
  }

  return {
    totalRequests,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    totalCachedTokens,
    totalReasoningTokens,
    totalCost,
    byProvider,
    byModel,
    byAccount,
    byApiKey,
    byEndpoint,
    metadata: {
      period,
      isPartial,
      isStale,
      asOf: new Date().toISOString(),
      sliceCount: rows.length,
      oldestTimestamp,
      newestTimestamp,
      source,
    },
  };
}
