import { EventEmitter } from "events";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getMeta, setMeta } from "../helpers/metaStore.js";

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

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

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;

export const statsEmitter = global._statsEmitter;

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.apiKey && typeof entry.apiKey === "string" ? entry.apiKey : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKey: entry.apiKey || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
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

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = await db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      apiKey: r.apiKey, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    let cost = 0;
    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
    cost += nonCachedInput * (pricing.input / 1000000);

    if (cachedTokens > 0) {
      const cachedRate = pricing.cached || pricing.input;
      cost += cachedTokens * (cachedRate / 1000000);
    }

    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += outputTokens * (pricing.output / 1000000);

    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
      const rate = pricing.reasoning || pricing.output;
      cost += reasoningTokens * (rate / 1000000);
    }

    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    if (cacheCreationTokens > 0) {
      const rate = pricing.cache_creation || pricing.input;
      cost += cacheCreationTokens * (rate / 1000000);
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
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
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

import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";

const USAGE_SLICE_CACHE_TTL_MS = 20_000;
const DISK_SLICE_KEY = "repo:usageHistorySlice";
let _recentHistoryCache = { data: null, ts: 0 };

async function getRecentHistorySlice() {
  if (_recentHistoryCache.data && Date.now() - _recentHistoryCache.ts < USAGE_SLICE_CACHE_TTL_MS) {
    return _recentHistoryCache.data;
  }
  try {
    const db = await getAdapter();
    // Query last 500 rows WITHOUT WHERE clause — stops instantly at 500 rows using pkey index, NO full table scan!
    const rows = await db.all(
      `SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT 500`
    );
    _recentHistoryCache = { data: rows, ts: Date.now() };
    setDiskCache(DISK_SLICE_KEY, rows);
    return rows;
  } catch (err) {
    console.warn("[usageRepo] Error reading usage history slice, using cached/disk:", err?.message || err);
    if (_recentHistoryCache.data) {
      _recentHistoryCache.ts = Date.now();
      return _recentHistoryCache.data;
    }
    const disk = getDiskCache(DISK_SLICE_KEY, []);
    _recentHistoryCache = { data: disk, ts: Date.now() };
    return disk;
  }
}

export async function saveRequestUsage(entry) {
  try {
    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    try {
      entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);
    } catch {
      entry.cost = 0;
    }

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    // 1. Immediate in-memory update for 0ms Dashboard latency
    pushToRing(entry);
    if (_recentHistoryCache.data) {
      _recentHistoryCache.data.unshift({
        timestamp: entry.timestamp,
        provider: entry.provider || null,
        model: entry.model || null,
        connectionId: entry.connectionId || null,
        apiKey: entry.apiKey || null,
        endpoint: entry.endpoint || null,
        promptTokens,
        completionTokens,
        cost: entry.cost || 0,
        status: entry.status || "ok",
        tokens: stringifyJson(tokens),
      });
      if (_recentHistoryCache.data.length > 500) _recentHistoryCache.data.pop();
    }
    statsEmitter.emit("update");

    // 2. Single asynchronous DB insert (skip redundant daily/meta query storms)
    const db = await getAdapter();
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.timestamp, entry.provider || null, entry.model || null,
        entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
        promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
        stringifyJson(tokens), stringifyJson({}),
      ]
    );
  } catch (e) {
    console.warn("[usageRepo] Failed to save usage stats to DB:", e?.message || e);
  }
}

let _clientKeysCache = { data: [], ts: 0 };
const CLIENT_KEYS_CACHE_TTL_MS = 60_000;

const _usageStatsCache = new Map();
const USAGE_STATS_CACHE_TTL_MS = 15_000;

export async function getUsageStats(period = "all") {
  const cachedEntry = _usageStatsCache.get(period);
  if (cachedEntry && Date.now() - cachedEntry.ts < USAGE_STATS_CACHE_TTL_MS) {
    return cachedEntry.data;
  }

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
  if (Date.now() - _clientKeysCache.ts < CLIENT_KEYS_CACHE_TTL_MS) {
    allClientKeys = _clientKeysCache.data;
  } else {
    try {
      const { supabase } = await import("../../supabase.js");
      if (supabase) {
        const { data, error } = await supabase
          .from('client_keys')
          .select('key, label, created_at');
        if (!error && data) {
          allClientKeys = data;
          _clientKeysCache = { data, ts: Date.now() };
        }
      }
    } catch {}
  }

  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id, createdAt: k.createdAt };
  for (const ck of allClientKeys) {
    apiKeyMap[ck.key] = { name: ck.label || "Unnamed Client Key", id: ck.key, createdAt: ck.created_at };
  }

  // Get cached history slice (500 rows, fast, zero full table scans)
  const historySlice = await getRecentHistorySlice();

  const seen = new Set();
  const recentRequests = historySlice
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        status: r.status || "ok",
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

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — aggregated in memory from slice
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgoMs = currentMinuteStart.getTime() - 9 * 60 * 1000;
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  for (const r of historySlice) {
    const tt = new Date(r.timestamp).getTime();
    if (tt >= tenMinutesAgoMs && tt <= now.getTime()) {
      const minuteStart = Math.floor(tt / 60000) * 60000;
      if (bucketMap[minuteStart]) {
        bucketMap[minuteStart].requests++;
        bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
        bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
        bucketMap[minuteStart].cost += r.cost || 0;
      }
    }
  }

  let cutoffTimeMs = 0;
  if (period === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    cutoffTimeMs = startOfDay.getTime();
  } else if (PERIOD_MS[period]) {
    cutoffTimeMs = Date.now() - PERIOD_MS[period];
  }

  const filtered = cutoffTimeMs > 0
    ? historySlice.filter((r) => new Date(r.timestamp).getTime() >= cutoffTimeMs)
    : historySlice;

  for (const r of filtered) {
    stats.totalRequests++;
    const tokens = parseJson(r.tokens, {}) || {};
    const promptTokens = tokens.prompt_tokens || 0;
    const completionTokens = tokens.completion_tokens || 0;
    const entryCost = r.cost || 0;
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;

    stats.totalPromptTokens += promptTokens;
    stats.totalCompletionTokens += completionTokens;
    stats.totalCost += entryCost;

    if (!stats.byProvider[r.provider]) stats.byProvider[r.provider] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.byProvider[r.provider].requests++;
    stats.byProvider[r.provider].promptTokens += promptTokens;
    stats.byProvider[r.provider].completionTokens += completionTokens;
    stats.byProvider[r.provider].cost += entryCost;

    const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
    if (!stats.byModel[modelKey]) {
      stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
    }
    stats.byModel[modelKey].requests++;
    stats.byModel[modelKey].promptTokens += promptTokens;
    stats.byModel[modelKey].completionTokens += completionTokens;
    stats.byModel[modelKey].cost += entryCost;
    if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

    if (r.connectionId) {
      const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
      const accountKey = `${r.model} (${r.provider} - ${accountName})`;
      if (!stats.byAccount[accountKey]) {
        stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
      }
      stats.byAccount[accountKey].requests++;
      stats.byAccount[accountKey].promptTokens += promptTokens;
      stats.byAccount[accountKey].completionTokens += completionTokens;
      stats.byAccount[accountKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
    }

    if (r.apiKey && typeof r.apiKey === "string") {
      const keyInfo = apiKeyMap[r.apiKey];
      const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
      const akKey = `${r.apiKey}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byApiKey[akKey]) {
        stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: r.apiKey, keyName, apiKeyKey: r.apiKey, lastUsed: r.timestamp };
      }
      const ake = stats.byApiKey[akKey];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cost += entryCost;
      if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
    } else {
      if (!stats.byApiKey["local-no-key"]) {
        stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKey: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
      }
      const ake = stats.byApiKey["local-no-key"];
      ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cost += entryCost;
      if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
    }

    const endpoint = r.endpoint || "Unknown";
    const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    if (!stats.byEndpoint[epKey]) {
      stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
    }
    const epe = stats.byEndpoint[epKey];
    epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cost += entryCost;
    if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
  }

  _usageStatsCache.set(period, { data: stats, ts: Date.now() });
  return stats;
}

const _chartDataCache = new Map();
const CHART_CACHE_TTL_MS = 20_000;

export async function getChartData(period = "7d") {
  const cached = _chartDataCache.get(period);
  if (cached && Date.now() - cached.ts < CHART_CACHE_TTL_MS) {
    return cached.data;
  }

  const now = Date.now();
  const rows = await getRecentHistorySlice();

  let result;
  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    result = buckets;
  } else if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    result = buckets;
  } else {
    const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
    const today = new Date();
    const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - bucketCount + 1);
    cutoffDate.setHours(0, 0, 0, 0);
    const cutoffMs = cutoffDate.getTime();

    const dayMap = {};
    for (const r of rows) {
      const d = new Date(r.timestamp);
      if (d.getTime() < cutoffMs) continue;
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = { tokens: 0, cost: 0 };
      }
      dayMap[dateKey].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      dayMap[dateKey].cost += r.cost || 0;
    }

    result = Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (bucketCount - 1 - i));
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dayData = dayMap[dateKey];
      return {
        label: labelFn(d),
        tokens: dayData ? dayData.tokens : 0,
        cost: dayData ? dayData.cost : 0,
      };
    });
  }

  _chartDataCache.set(period, { data: result, ts: Date.now() });
  return result;
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    const db = getAdapter();
    const rows = await db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
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
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}
