"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useSearchParams, useRouter } from "next/navigation";
import { FREE_PROVIDERS, AI_PROVIDERS } from "@/shared/constants/providers";
import Badge from "./Badge";
import Card from "./Card";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import ProviderTopology from "@/app/(dashboard)/dashboard/usage/components/ProviderTopology";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";
import ProviderBarChart from "@/app/(dashboard)/dashboard/usage/components/ProviderBarChart";
import TopModelsChart from "@/app/(dashboard)/dashboard/usage/components/TopModelsChart";

// Keep providers without serviceKinds (default LLM) or with "llm" in serviceKinds
function isLLMProvider(id) {
  const p = AI_PROVIDERS[id];
  if (!p?.serviceKinds) return true;
  return p.serviceKinds.includes("llm");
}

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

TimeAgo.propTypes = {
  timestamp: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.instanceOf(Date)]),
};

function RecentRequests({ requests = [] }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header with distinct live/unfiltered indicator */}
      <div className="flex items-center justify-between border-b border-border px-1 py-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Recent Requests
        </span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          Live &bull; All Time
        </span>
      </div>

      {!requests.length ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
          No requests yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-bg">
              <tr className="border-b border-border">
                <th className="w-2 py-1.5 text-left font-semibold text-text-muted"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="whitespace-nowrap py-1.5 text-right font-semibold text-text-muted">
                  In / Out
                </th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="transition-colors hover:bg-bg-subtle">
                    <td className="py-1.5">
                      <span
                        className={`block h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`}
                      />
                    </td>
                    <td className="max-w-[120px] truncate font-mono py-1.5" title={r.model}>
                      {r.model}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <span className="text-primary">{fmt(r.promptTokens)}↑</span>{" "}
                      <span className="text-success">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right text-text-muted">
                      <TimeAgo timestamp={r.timestamp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

RecentRequests.propTypes = {
  requests: PropTypes.array,
};

export function OverviewCards({ stats, period, dataPeriod, isStalePeriod = false }) {
  if (!stats) return null;

  const periodLabel = isStalePeriod
    ? `Stale: Retained from ${PERIOD_LABELS[dataPeriod] || dataPeriod} (Failed to load ${PERIOD_LABELS[period] || period})`
    : PERIOD_LABELS[period] || period || "Selected Period";

  const cards = [
    {
      label: "Total Requests",
      value: fmt(stats?.totalRequests || 0),
      rawTitle: String(stats?.totalRequests || 0),
      subtext: "Completed calls",
    },
    {
      label: "Total Input Tokens",
      value: fmt(stats?.totalPromptTokens || 0),
      rawTitle: String(stats?.totalPromptTokens || 0),
      subtext: "Non-cached + cached",
    },
    {
      label: "Cached Tokens",
      value: fmt(stats?.totalCachedTokens || 0),
      rawTitle: String(stats?.totalCachedTokens || 0),
      subtext: "Subset of input tokens",
    },
    {
      label: "Output Tokens",
      value: fmt(stats?.totalCompletionTokens || 0),
      rawTitle: String(stats?.totalCompletionTokens || 0),
      subtext: "Completion tokens",
    },
    {
      label: "Est. Cost",
      value: `~${fmtCost(stats?.totalCost || 0)}`,
      rawTitle: `$${(stats?.totalCost || 0).toFixed(6)}`,
      subtext: "Estimated, not billing",
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted flex items-center gap-2">
          <span>Overview Totals ({periodLabel})</span>
          {isStalePeriod && (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning border border-warning/30">
              Stale Data
            </span>
          )}
        </span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
        {cards.map((c) => (
          <Card
            key={c.label}
            className="flex min-w-0 flex-col items-center justify-center p-3 text-center sm:p-4"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted flex items-center justify-center gap-1">
              {c.label}
              {isStalePeriod && (
                <span className="text-[10px] text-warning font-normal lowercase">(stale)</span>
              )}
            </span>
            <span
              className="w-full truncate text-lg font-bold text-text-main xl:text-xl"
              title={c.rawTitle}
            >
              {c.value}
            </span>
            <span className="text-[11px] text-text-muted">{c.subtext}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object,
  period: PropTypes.string,
  dataPeriod: PropTypes.string,
  isStalePeriod: PropTypes.bool,
};

export function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const promptTokens = data.promptTokens || 0;
      const completionTokens = data.completionTokens || 0;
      const totalTokens = promptTokens + completionTokens;
      const totalCost = data.cost || 0;
      const cachedTokens = data.cachedTokens || 0;
      const nonCachedInput = Math.max(0, promptTokens - cachedTokens);
      const inputCost = totalTokens > 0 ? nonCachedInput * (totalCost / totalTokens) : 0;
      const cachedCost = totalTokens > 0 ? cachedTokens * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? completionTokens * (totalCost / totalTokens) : 0;

      return {
        ...data,
        key,
        totalTokens,
        totalCost,
        cachedTokens,
        inputCost,
        cachedCost,
        outputCost,
        pending: pendingMap[key] || 0,
      };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

export function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel":
      return item.rawModel || "Unknown Model";
    case "accountName":
      return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": {
      // Stable identity: keyId is primary identity EVEN if same label and same mask
      // Distinct keys with same display name and same mask remain separated.
      // Same key across models groups correctly. Never exposes raw keys.
      if (item.keyId) {
        return item.keyId;
      }
      if (item.id) {
        return item.id;
      }
      if (item.apiKeyMasked) {
        return item.apiKeyMasked;
      }
      return item.keyName || "Local (No API Key)";
    }
    case "endpoint":
      return item.endpoint || "Unknown Endpoint";
    default:
      return item[keyField] || "Unknown";
  }
}

export function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: {
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
          cost: 0,
          inputCost: 0,
          cachedCost: 0,
          outputCost: 0,
          lastUsed: null,
          pending: 0,
        },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cachedTokens += item.cachedTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.cachedCost += item.cachedCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export const PERIOD_LABELS = {
  today: "Today",
  "24h": "Last 24h",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "60d": "Last 60 Days",
  all: "All Time",
};

export default function UsageStats({
  period: periodProp,
  setPeriod: setPeriodProp,
  hidePeriodSelector = false,
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState("costs");
  const [providers, setProviders] = useState([]);
  const [periodLocal, setPeriodLocal] = useState("today");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [dataPeriod, setDataPeriod] = useState(periodProp ?? "today");
  const [fetchError, setFetchError] = useState(null);

  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);
  const abortControllerRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const period = periodProp ?? periodLocal;
  const setPeriod = setPeriodProp ?? setPeriodLocal;

  // Fetch connected providers once, deduplicate by provider type
  useEffect(() => {
    isMountedRef.current = true;
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, nodesData]) => {
        if (!isMountedRef.current) return;
        const nodeNameMap = {};
        for (const node of nodesData?.nodes || []) {
          nodeNameMap[node.id] = node.name;
        }
        const seen = new Set();
        const unique = (d?.connections || [])
          .filter((c) => {
            if (c.isActive === false) return false;
            if (!isLLMProvider(c.provider)) return false;
            if (seen.has(c.provider)) return false;
            seen.add(c.provider);
            return true;
          })
          .map((c) => ({
            ...c,
            nodeName: nodeNameMap[c.provider] || null,
          }));
        const noAuthProviders = Object.values(FREE_PROVIDERS)
          .filter((p) => p.noAuth && !seen.has(p.id) && isLLMProvider(p.id))
          .map((p) => ({ provider: p.id, name: p.name }));
        setProviders([...unique, ...noAuthProviders]);
      })
      .catch(() => {});

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch stats via REST with abort controller to handle fast period switches
  const fetchStats = useCallback(
    async (isInitial = false) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const requestedPeriod = period;

      if (isInitial || !hasLoadedStats.current) {
        setLoading(true);
        setFetchError(null);
      } else {
        setFetching(true);
      }

      try {
        const res = await fetch(`/api/usage/stats?period=${requestedPeriod}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted && isMountedRef.current) {
            hasLoadedStats.current = true;
            setStats((prev) => ({ ...prev, ...data }));
            setDataPeriod(requestedPeriod);
            setFetchError(null);
          }
        } else {
          if (!controller.signal.aborted && isMountedRef.current) {
            setFetchError({
              status: res.status,
              failedPeriod: requestedPeriod,
              message: `Failed to load statistics for ${PERIOD_LABELS[requestedPeriod] || requestedPeriod} (HTTP ${res.status})`,
            });
          }
        }
      } catch (err) {
        if (err.name === "AbortError" || controller.signal.aborted) return;
        if (isMountedRef.current) {
          console.error("[UsageStats] Failed to fetch stats:", err);
          setFetchError({
            status: 0,
            failedPeriod: requestedPeriod,
            message: `Failed to load statistics for ${PERIOD_LABELS[requestedPeriod] || requestedPeriod}: ${err.message || "Network error"}`,
          });
        }
      } finally {
        if (!controller.signal.aborted && isMountedRef.current) {
          setLoading(false);
          setFetching(false);
        }
      }
    },
    [period]
  );

  // Trigger fetch on period change
  useEffect(() => {
    fetchStats(isInitialLoad.current);
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchStats]);

  // Bounded/debounced refresh to avoid polling storms from SSE
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (!isMountedRef.current) return;
      fetchStats(false);
      setRefreshTrigger((prev) => prev + 1);
    }, 1500);
  }, [fetchStats]);

  // SSE connection - real-time updates for activeRequests + recentRequests and debounced totals
  useEffect(() => {
    isMountedRef.current = true;
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      if (!isMountedRef.current) return;
      try {
        const data = JSON.parse(e.data);
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests ?? prev.activeRequests,
            recentRequests: data.recentRequests ?? prev.recentRequests,
            errorProvider: data.errorProvider ?? prev.errorProvider,
            pending: data.pending ?? prev.pending,
          };
        });
        scheduleRefresh();
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => {
      // SSE disconnection/error must NOT prematurely end loading of the initial pending API.
      // API/SSE failures retain last valid stats honestly and do not trigger page errors.
    };

    return () => {
      isMountedRef.current = false;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      es.close();
    };
  }, [scheduleRefresh]);

  const toggleSort = useCallback(
    (tableType, field) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("sortBy") === field) {
        params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
      } else {
        params.set("sortBy", field);
        params.set("sortOrder", "asc");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byModel, pendingMap, sortBy, sortOrder),
            "rawModel"
          ),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.rawModel}
              </td>
              <td className="px-6 py-3">
                <Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = stats.pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider
                ? `${data.rawModel} (${data.provider})`
                : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byAccount, pendingMap, sortBy, sortOrder),
            "accountName"
          ),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}
              </td>
              <td
                className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}
              >
                {item.rawModel}
              </td>
              <td className="px-6 py-3">
                <Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byApiKey, {}, sortBy, sortOrder),
            "keyName"
          ),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-mono text-xs font-medium" title={item.keyName}>
                {item.apiKeyMasked || item.keyName || "Local (No API Key)"}
              </td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3">
                <Badge variant="neutral" size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(
            sortData(stats.byEndpoint, {}, sortBy, sortOrder),
            "endpoint"
          ),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(group.summary.lastUsed)}
              </td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-mono text-sm font-medium">{item.endpoint}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3">
                <Badge variant="neutral" size="sm">
                  {item.provider}
                </Badge>
              </td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="whitespace-nowrap px-6 py-3 text-right text-text-muted">
                {fmtTime(item.lastUsed)}
              </td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined animate-spin text-[32px]">progress_activity</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Notice banner for stale or incomplete metadata */}
      {stats?.metadata &&
        (stats.metadata.isPartial ||
          stats.metadata.isStale ||
          stats.metadata.source === "fallback") && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <span className="material-symbols-outlined shrink-0 text-[16px]">info</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="font-semibold">Notice:</span>
              <span>
                {stats.metadata.isPartial
                  ? `Showing partial usage slice (${stats.metadata.sliceCount || "recent"} records).`
                  : stats.metadata.isStale
                  ? "Displaying cached or delayed statistics."
                  : "Aggregated from fallback source."}
              </span>
              {stats.metadata.oldestTimestamp && (
                <span className="text-text-muted">
                  (Range: {new Date(stats.metadata.oldestTimestamp).toLocaleDateString()} -{" "}
                  {stats.metadata.newestTimestamp
                    ? new Date(stats.metadata.newestTimestamp).toLocaleDateString()
                    : "now"}
                  )
                </span>
              )}
            </div>
          </div>
        )}

      {/* Period selector (hidden when controlled by parent) */}
      {!hidePeriodSelector && (
        <div className="flex w-full items-center gap-2 sm:w-auto sm:self-end">
          <div className="grid flex-1 grid-cols-6 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex sm:flex-none">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                disabled={fetching}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  period === p.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-bg-hover hover:text-text"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {fetching && (
            <span className="material-symbols-outlined animate-spin text-[16px] text-text-muted">
              progress_activity
            </span>
          )}
        </div>
      )}

      {/* Error banner on fetch failure */}
      {fetchError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-error/40 bg-error/10 p-3 text-xs text-error"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
            <span className="font-medium">{fetchError.message}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchStats(!hasLoadedStats.current)}
            disabled={loading || fetching}
            className="self-start sm:self-auto rounded-md bg-error px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-error/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-error transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading || fetching ? "Retrying..." : "Retry"}
          </button>
        </div>
      )}

      {/* Overview cards */}
      {loading ? (
        spinner
      ) : stats ? (
        <OverviewCards
          stats={stats}
          period={period}
          dataPeriod={dataPeriod}
          isStalePeriod={dataPeriod !== period && !!fetchError}
        />
      ) : null}

      {/* Provider topology + Recent Requests */}
      {loading ? (
        spinner
      ) : stats ? (
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ProviderTopology
            providers={providers}
            activeRequests={stats.activeRequests || []}
            lastProvider={stats.recentRequests?.[0]?.provider || ""}
            errorProvider={stats.errorProvider || ""}
          />
          <RecentRequests requests={stats.recentRequests || []} />
        </div>
      ) : null}

      {/* Token / Request / Cost chart - sync period & refreshTrigger */}
      {loading ? (
        spinner
      ) : (
        <UsageChart period={period} refreshTrigger={refreshTrigger} />
      )}

      {/* Provider & Model Breakdowns */}
      {loading ? (
        spinner
      ) : stats ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <ProviderBarChart byProvider={stats?.byProvider} />
          <TopModelsChart byModel={stats?.byModel} />
        </div>
      ) : null}

      {/* Table with dropdown selector */}
      {stats ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <select
              value={tableView}
              onChange={(e) => setTableView(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
              style={{ colorScheme: "auto" }}
            >
              {TABLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Table value mode"
              className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex"
            >
              <button
                type="button"
                onClick={() => setViewMode("costs")}
                aria-pressed={viewMode === "costs"}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  viewMode === "costs"
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-bg-hover hover:text-text"
                }`}
              >
                Costs
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tokens")}
                aria-pressed={viewMode === "tokens"}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  viewMode === "tokens"
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-muted hover:bg-bg-hover hover:text-text"
                }`}
              >
                Tokens
              </button>
            </div>
          </div>
          {loading
            ? spinner
            : activeTableConfig && (
                <UsageTable
                  title=""
                  columns={activeTableConfig.columns}
                  groupedData={activeTableConfig.groupedData}
                  tableType={tableView}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggleSort={toggleSort}
                  viewMode={viewMode}
                  storageKey={activeTableConfig.storageKey}
                  renderSummaryCells={activeTableConfig.renderSummaryCells}
                  renderDetailCells={activeTableConfig.renderDetailCells}
                  emptyMessage={activeTableConfig.emptyMessage}
                />
              )}
        </div>
      ) : null}
      {!stats && !loading && !fetchError && (
        <div className="py-12 text-center text-sm text-text-muted">
          No usage statistics available.
        </div>
      )}
    </div>
  );
}

UsageStats.propTypes = {
  period: PropTypes.string,
  setPeriod: PropTypes.func,
  hidePeriodSelector: PropTypes.bool,
};
