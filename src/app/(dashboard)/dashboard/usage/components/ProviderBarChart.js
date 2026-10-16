"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Card from "@/shared/components/Card";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";

const FALLBACK_COLORS = {
  antigravity: "#F59E0B",
  codex: "#3B82F6",
};

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

export default function ProviderBarChart({ byProvider }) {
  const [viewMode, setViewMode] = useState("tokens");

  const chartData = useMemo(() => {
    if (!byProvider || typeof byProvider !== "object") return [];

    // Filter strictly for Antigravity and Codex visualization via registry aliases
    const rows = [];
    for (const [key, data] of Object.entries(byProvider)) {
      if (!data) continue;
      const canonical = (resolveProviderId(key) || key || "").toLowerCase();
      const isAg = canonical === "antigravity" || canonical === "ag";
      const isCx = canonical === "codex" || canonical === "cx";

      if (!isAg && !isCx) continue;

      const providerId = isAg ? "antigravity" : "codex";
      const config = AI_PROVIDERS[providerId] || {};
      const displayName = config.name || (isAg ? "Antigravity" : "OpenAI Codex");
      const color = config.color || FALLBACK_COLORS[providerId];

      const promptTokens = data.promptTokens || 0;
      const completionTokens = data.completionTokens || 0;
      const tokens = promptTokens + completionTokens;
      const requests = data.requests || 0;
      const cachedTokens = data.cachedTokens || 0;

      rows.push({
        id: providerId,
        name: displayName,
        color,
        tokens,
        requests,
        cachedTokens,
      });
    }

    return rows
      .filter((d) => d[viewMode] > 0)
      .sort((a, b) => b[viewMode] - a[viewMode]);
  }, [byProvider, viewMode]);

  const fmt = viewMode === "tokens" ? fmtTokens : String;
  const label = viewMode === "tokens" ? "Tokens" : "Requests";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted sm:text-sm">
          By Provider
        </span>
        <div
          role="group"
          aria-label="Provider chart metric"
          className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1"
        >
          <button
            type="button"
            onClick={() => setViewMode("tokens")}
            aria-pressed={viewMode === "tokens"}
            className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
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
            className={`rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              viewMode === "requests"
                ? "bg-primary text-white shadow-sm"
                : "text-text-muted hover:bg-bg-hover hover:text-text"
            }`}
          >
            Requests
          </button>
        </div>
      </div>

      {!chartData.length ? (
        <div className="flex h-44 items-center justify-center text-sm text-text-muted">
          No provider usage yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              tickFormatter={(v) => (v.length > 12 ? v.slice(0, 12) + "…" : v)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmt}
              width={44}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                borderColor: "var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "var(--color-text)",
              }}
              formatter={(value) => [fmt(value), label]}
            />
            <Bar dataKey={viewMode} radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.id} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

ProviderBarChart.propTypes = {
  byProvider: PropTypes.object,
};
