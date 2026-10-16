"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

export const VIEW_CONFIG = {
  tokens: {
    label: "Tokens",
    dataKey: "tokens",
    stroke: "#6366f1",
    fillId: "gradTokens",
    formatter: fmtTokens,
  },
  requests: {
    label: "Requests",
    dataKey: "requests",
    stroke: "#14b8a6",
    fillId: "gradRequests",
    formatter: (v) => String(v || 0),
  },
  cost: {
    label: "Cost",
    dataKey: "cost",
    stroke: "#f59e0b",
    fillId: "gradCost",
    formatter: fmtCost,
  },
};

export default function UsageChart({ period = "7d", refreshTrigger = 0 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("tokens");

  const abortControllerRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json();
        if (!controller.signal.aborted && isMountedRef.current) {
          setData(Array.isArray(json) ? json : []);
          setError(null);
        }
      } else {
        if (!controller.signal.aborted && isMountedRef.current) {
          setError(`HTTP ${res.status}`);
          setData([]);
        }
      }
    } catch (e) {
      if (e.name === "AbortError" || controller.signal.aborted) return;
      if (isMountedRef.current) {
        console.error("Failed to fetch chart data:", e);
        setError(e.message || "Network error");
        setData([]);
      }
    } finally {
      if (!controller.signal.aborted && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData, refreshTrigger]);

  const cfg = VIEW_CONFIG[viewMode] || VIEW_CONFIG.tokens;
  const hasData = Array.isArray(data) && data.some((d) => (d[cfg.dataKey] || 0) > 0);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div
        role="group"
        aria-label="Chart metric mode"
        className="grid w-full grid-cols-3 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start"
      >
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
        <button
          type="button"
          onClick={() => setViewMode("requests")}
          aria-pressed={viewMode === "requests"}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            viewMode === "requests"
              ? "bg-primary text-white shadow-sm"
              : "text-text-muted hover:bg-bg-hover hover:text-text"
          }`}
        >
          Requests
        </button>
        <button
          type="button"
          onClick={() => setViewMode("cost")}
          aria-pressed={viewMode === "cost"}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            viewMode === "cost"
              ? "bg-primary text-white shadow-sm"
              : "text-text-muted hover:bg-bg-hover hover:text-text"
          }`}
        >
          Cost
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-text-muted">
          Loading...
        </div>
      ) : error ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-error">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>Failed to load chart data for {period} ({error})</span>
          </div>
          <button
            type="button"
            onClick={fetchData}
            className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-text-main hover:bg-bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : !hasData ? (
        <div className="flex h-48 items-center justify-center text-sm text-text-muted">
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={cfg.formatter}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "var(--color-text)",
              }}
              formatter={(value) => [cfg.formatter(value), cfg.label]}
            />
            <Area
              type="monotone"
              dataKey={cfg.dataKey}
              stroke={cfg.stroke}
              strokeWidth={2}
              fill={`url(#${cfg.fillId})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  refreshTrigger: PropTypes.number,
};
