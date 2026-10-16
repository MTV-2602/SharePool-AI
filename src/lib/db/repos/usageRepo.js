import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";
import {
  getPeriodRange,
  buildEmptyChartBuckets,
  formatLocalDateKey,
} from "../helpers/usageRangeHelper.js";
import {
  maskApiKey,
  hashKeyId,
  extractTokenStats,
  buildStatsAggregateSql,
  buildChartAggregateSql,
  processGroupedStatsRows,
} from "../helpers/usageAggregationHelper.js";

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const CLIENT_KEYS_CACHE_TTL_MS = 60 * 1000;
const USAGE_STATS_CACHE_TTL_MS = 15 * 1000;
const CHART_CACHE_TTL_MS = 20 * 1000;
const DISK_STATS_KEY = "repo:usageStatsCache";

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._clientKeysCache) global._clientKeysCache = { data: [], ts: 0 };
if (!global._usageStatsCache) global._usageStatsCache = new Map();
if (!global._chartDataCache) global._chartDataCache = new Map();

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
let clientKeysCache = global._clientKeysCache;
export const usageStatsCache = global._usageStatsCache;
export const chartDataCache = global._chartDataCache;

export const statsEmitter = global._statsEmitter;

export function clearUsageCaches() {
  usageStatsCache.clear();
  chartDataCache.clear();
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = await db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [RING_CAP]
    );
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      apiKey: r.apiKey,
      endpoint: r.endpoint,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      cost: r.cost,
      status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

export async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    let cost = 0;
    // cached_tokens presence discriminator: canonical usage payloads explicitly supply cached_tokens
    // (or cachedTokens or nested cached_tokens). Legacy payloads supply cache_read_input_tokens / input_tokens without cached_tokens.
    const hasCachedTokensDiscriminator =
      tokens.cached_tokens !== undefined ||
      tokens.cachedTokens !== undefined ||
      tokens.prompt_tokens_details?.cached_tokens !== undefined ||
      tokens.input_tokens_details?.cached_tokens !== undefined;

    const inputTokens = Number(tokens.prompt_tokens ?? tokens.input_tokens ?? 0);
    const cachedTokens = Number(
      tokens.cached_tokens ??
      tokens.cachedTokens ??
      tokens.cache_read_input_tokens ??
      tokens.prompt_tokens_details?.cached_tokens ??
      tokens.prompt_tokens_details?.cache_read_input_tokens ??
      tokens.input_tokens_details?.cached_tokens ??
      tokens.input_tokens_details?.cache_read_input_tokens ??
      0
    );
    const cacheCreationTokens = Number(
      tokens.cache_creation_input_tokens ??
      tokens.cache_creation_tokens ??
      tokens.prompt_tokens_details?.cache_creation_input_tokens ??
      tokens.prompt_tokens_details?.cache_creation_tokens ??
      tokens.input_tokens_details?.cache_creation_input_tokens ??
      tokens.input_tokens_details?.cache_creation_tokens ??
      0
    );

    // If cached_tokens presence discriminator is active, inputTokens is canonical inclusive
    // (subtract cachedTokens + cacheCreationTokens before applying base rate).
    // If discriminator is inactive, inputTokens is legacy exclusive (already base-only).
    const nonCachedInput = hasCachedTokensDiscriminator
      ? Math.max(0, inputTokens - cachedTokens - cacheCreationTokens)
      : Math.max(0, inputTokens);

    cost += nonCachedInput * (pricing.input / 1000000);

    if (cachedTokens > 0) {
      const cachedRate = pricing.cached ?? pricing.input;
      cost += cachedTokens * (cachedRate / 1000000);
    }

    if (cacheCreationTokens > 0) {
      const creationRate = pricing.cache_creation ?? pricing.input;
      cost += cacheCreationTokens * (creationRate / 1000000);
    }

    const outputTokens = Number(tokens.completion_tokens ?? tokens.output_tokens ?? 0);
    const reasoningTokens = Number(
      tokens.reasoning_tokens ??
      tokens.reasoningTokens ??
      tokens.completion_tokens_details?.reasoning_tokens ??
      tokens.output_tokens_details?.reasoning_tokens ??
      0
    );

    // If reasoning has a distinct rate and outputTokens is inclusive, separate them.
    // Otherwise charge outputTokens at pricing.output without double counting.
    if (reasoningTokens > 0 && pricing.reasoning && pricing.reasoning !== pricing.output) {
      const nonReasoningOutput = Math.max(0, outputTokens - reasoningTokens);
      cost += nonReasoningOutput * (pricing.output / 1000000);
      cost += reasoningTokens * (pricing.reasoning / 1000000);
    } else {
      cost += outputTokens * (pricing.output / 1000000);
    }

    return cost;
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      statsEmitter.emit("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  const t = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`[${t}] [PENDING] ${started ? "START" : "END"}${error ? " (ERROR)" : ""} | provider=${provider} | model=${model}`);
  statsEmitter.emit("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName,
          count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const stats = extractTokenStats(e.tokens, e);
      return {
        timestamp: e.timestamp,
        model: e.model,
        provider: e.provider || "",
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  if (!entry.timestamp) entry.timestamp = new Date().toISOString();
  try {
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);
  } catch {
    entry.cost = 0;
  }

  const tokenStats = extractTokenStats(entry.tokens, entry);
  const promptTokens = tokenStats.promptTokens;
  const completionTokens = tokenStats.completionTokens;

  try {
    // 1. Single asynchronous DB insert FIRST — persistence must succeed before event/cache invalidation
    const db = await getAdapter();
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.timestamp,
        entry.provider || null,
        entry.model || null,
        entry.connectionId || null,
        entry.apiKey || null,
        entry.endpoint || null,
        promptTokens,
        completionTokens,
        entry.cost || 0,
        entry.status || "ok",
        stringifyJson(entry.tokens || {}),
        stringifyJson({}),
      ]
    );

    // 2. AFTER successful persisted write: update memory, invalidate caches, and emit
    pushToRing(entry);
    clearUsageCaches();
    statsEmitter.emit("update");
  } catch (e) {
    console.warn("[usageRepo] Failed to save usage stats to DB:", e?.message || e);
    throw e;
  }
}

export async function getUsageHistory(limit = 100) {
  try {
    const db = await getAdapter();
    return await db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit]
    );
  } catch (err) {
    console.warn("[usageRepo] Failed to fetch usage history:", err?.message || err);
    return [];
  }
}

async function loadMetadataDependencies() {
  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}

  let allClientKeys = [];
  if (Date.now() - clientKeysCache.ts < CLIENT_KEYS_CACHE_TTL_MS) {
    allClientKeys = clientKeysCache.data;
  } else {
    try {
      const { supabase } = await import("../../supabase.js");
      if (supabase) {
        const { data, error } = await supabase
          .from("client_keys")
          .select("id, key, label, created_at");
        if (!error && data) {
          allClientKeys = data;
          clientKeysCache.data = data;
          clientKeysCache.ts = Date.now();
        }
      }
    } catch {}
  }

  const apiKeyMap = {};
  for (const k of allApiKeys) {
    if (k.key) apiKeyMap[k.key.trim()] = { name: k.name, id: k.id, createdAt: k.createdAt };
  }
  for (const ck of allClientKeys) {
    if (ck.key) apiKeyMap[ck.key.trim()] = { name: ck.label || "Unnamed Client Key", id: ck.id || ck.key, createdAt: ck.created_at };
  }

  return { connectionMap, providerNodeNameMap, apiKeyMap };
}

export async function getUsageStats(period = "all") {
  const cachedEntry = usageStatsCache.get(period);
  if (cachedEntry && Date.now() - cachedEntry.ts < USAGE_STATS_CACHE_TTL_MS) {
    return cachedEntry.data;
  }

  const now = new Date();
  const range = getPeriodRange(period, now);
  const { connectionMap, providerNodeNameMap, apiKeyMap } = await loadMetadataDependencies();

  let stats;
  let isAuthoritative = false;
  try {
    const db = await getAdapter();
    const { sql, params } = buildStatsAggregateSql(range.startIso, range.endIso);
    const rows = await db.all(sql, params);

    stats = processGroupedStatsRows(rows, {
      period,
      connectionMap,
      providerNodeNameMap,
      apiKeyMap,
      source: "authoritative",
      isPartial: false,
      isStale: false,
    });
    isAuthoritative = true;
  } catch (err) {
    console.warn("[usageRepo] Authoritative query failed, using fallback:", err?.message || err);
    const diskFallback = getDiskCache(DISK_STATS_KEY + ":" + period, null);
    const memFallback = cachedEntry?.data || null;
    const existingFallback = diskFallback || memFallback;

    if (existingFallback) {
      stats = {
        ...existingFallback,
        metadata: {
          ...existingFallback.metadata,
          isPartial: true,
          isStale: true,
          source: "fallback",
          // Retain original authoritative asOf; never timestamp old data as now
          asOf: existingFallback.metadata?.asOf || null,
        },
      };
    } else {
      stats = processGroupedStatsRows([], {
        period,
        connectionMap,
        providerNodeNameMap,
        apiKeyMap,
        source: "fallback",
        isPartial: true,
        isStale: true,
      });
      const realAsOf = cachedEntry?.data?.metadata?.asOf || null;
      stats.metadata.asOf = realAsOf;
    }
  }

  // Realtime & in-memory counters
  const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
  stats.activeRequests = activeRequests;
  stats.recentRequests = recentRequests;
  stats.errorProvider = errorProvider;
  stats.pending = pendingRequests;

  // Build last10Minutes from recent memory slice
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgoMs = currentMinuteStart.getTime() - 9 * 60 * 1000;
  const minuteBuckets = [];
  const bucketMap = {};

  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    const bucket = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    bucketMap[ts] = bucket;
    minuteBuckets.push(bucket);
  }

  for (const item of recentRing.items) {
    const tt = new Date(item.timestamp).getTime();
    if (tt >= tenMinutesAgoMs && tt <= now.getTime()) {
      const minuteStart = Math.floor(tt / 60000) * 60000;
      const b = bucketMap[minuteStart];
      if (b) {
        const itemStats = extractTokenStats(item.tokens, item);
        b.requests++;
        b.promptTokens += itemStats.promptTokens;
        b.completionTokens += itemStats.completionTokens;
        b.cost += itemStats.cost;
      }
    }
  }
  stats.last10Minutes = minuteBuckets;

  // Only persist authoritative data; never overwrite last good cache with failed fallback
  if (isAuthoritative) {
    usageStatsCache.set(period, { data: stats, ts: Date.now() });
    setDiskCache(DISK_STATS_KEY + ":" + period, stats);
  }

  return stats;
}

export async function getChartData(period = "7d") {
  const cached = chartDataCache.get(period);
  if (cached && Date.now() - cached.ts < CHART_CACHE_TTL_MS) {
    return cached.data;
  }

  const now = new Date();
  const range = getPeriodRange(period, now);

  try {
    const db = await getAdapter();

    let earliestDateStr = null;
    if (period === "all") {
      try {
        const earliestRow = await db.get(
          `SELECT MIN(timestamp) AS earliest FROM usageHistory WHERE timestamp <= ?`,
          [range.endIso]
        );
        if (earliestRow?.earliest) {
          earliestDateStr = formatLocalDateKey(new Date(earliestRow.earliest));
        }
      } catch {}
    }

    const emptyBuckets = buildEmptyChartBuckets(period, now, earliestDateStr);
    const { sql, params } = buildChartAggregateSql(period, range.startIso, range.endIso);
    const rows = await db.all(sql, params);

    const isHourly = period === "today" || period === "24h";

    if (isHourly) {
      const rowMap = {};
      for (const r of rows) {
        // bucketKey is "YYYY-MM-DD HH:00" or "YYYY-MM-DD HH24:00"
        const key = r.bucketKey || r.bucket_key || "";
        rowMap[key] = r;
      }

      const assignedRows = new Set();
      for (const bucket of emptyBuckets) {
        let match = rowMap[bucket.bucketKey] || (bucket.hourKey && rowMap[bucket.hourKey]);
        if (!match && bucket.baseKey && rowMap[bucket.baseKey] && !assignedRows.has(bucket.baseKey)) {
          match = rowMap[bucket.baseKey];
          assignedRows.add(bucket.baseKey);
        }
        if (match) {
          bucket.tokens = Number(match.tokens ?? 0);
          bucket.cost = Number(match.cost ?? 0);
          bucket.requests = Number(match.requests ?? 0);
          bucket.cachedTokens = Number(match.cachedTokens ?? match.cachedtokens ?? match.cached_tokens ?? 0);
        }
        delete bucket.bucketKey;
        delete bucket.hourKey;
        delete bucket.baseKey;
        delete bucket.bucketTs;
      }
    } else {
      const rowMap = {};
      for (const r of rows) {
        // bucketKey is "YYYY-MM-DD"
        const key = r.bucketKey || r.bucket_key || "";
        rowMap[key] = r;
      }

      for (const bucket of emptyBuckets) {
        const match = rowMap[bucket.dateKey];
        if (match) {
          bucket.tokens = Number(match.tokens ?? 0);
          bucket.cost = Number(match.cost ?? 0);
          bucket.requests = Number(match.requests ?? 0);
          bucket.cachedTokens = Number(match.cachedTokens ?? match.cachedtokens ?? match.cached_tokens ?? 0);
        }
        delete bucket.dateKey;
      }
    }

    chartDataCache.set(period, { data: emptyBuckets, ts: Date.now() });
    return emptyBuckets;
  } catch (err) {
    console.warn("[usageRepo] getChartData authoritative query failed:", err?.message || err);
    // NEVER silently return stale 200 or masquerade failure as fresh zeros!
    // Re-throw so callers (API route) can return a truthful error (500)
    throw new Error(`Chart data query failed: ${err?.message || err}`);
  }
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = await db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const stats = extractTokenStats(r.tokens, r);
      const sent = stats.promptTokens || "-";
      const received = stats.completionTokens || "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}
