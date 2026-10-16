export const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const PERIOD_MS = {
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "60d": 5184000000,
};

/**
 * Returns date range boundaries for a requested period.
 * Guarantees endIso is never in the future (capped at now).
 *
 * @param {string} period - "today" | "24h" | "7d" | "30d" | "60d" | "all"
 * @param {Date} [now] - Current reference time (defaults to new Date())
 * @returns {{ period: string, startIso: string | null, endIso: string, startTimeMs: number | null, endTimeMs: number }}
 */
export function getPeriodRange(period = "7d", now = new Date()) {
  const normalizedPeriod = VALID_PERIODS.has(period) ? period : "7d";
  const endTimeMs = now.getTime();
  const endIso = now.toISOString();

  if (normalizedPeriod === "all") {
    return {
      period: "all",
      startIso: null,
      endIso,
      startTimeMs: null,
      endTimeMs,
    };
  }

  if (normalizedPeriod === "today") {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startTimeMs = startOfDay.getTime();
    return {
      period: "today",
      startIso: startOfDay.toISOString(),
      endIso,
      startTimeMs,
      endTimeMs,
    };
  }

  if (normalizedPeriod === "24h") {
    const startTimeMs = endTimeMs - 24 * 3600 * 1000;
    return {
      period: "24h",
      startIso: new Date(startTimeMs).toISOString(),
      endIso,
      startTimeMs,
      endTimeMs,
    };
  }

  const days = normalizedPeriod === "7d" ? 7 : normalizedPeriod === "30d" ? 30 : 60;
  // Start from midnight (days - 1) days ago to include today as full day
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  const startTimeMs = cutoffDate.getTime();

  return {
    period: normalizedPeriod,
    startIso: cutoffDate.toISOString(),
    endIso,
    startTimeMs,
    endTimeMs,
  };
}

/**
 * Formats a Date object to YYYY-MM-DD in local time.
 * @param {Date} date
 * @returns {string}
 */
export function formatLocalDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Creates empty chart buckets for the specified period.
 *
 * @param {string} period
 * @param {Date} [now]
 * @param {string|null} [earliestDateStr] - Earliest date (YYYY-MM-DD) for "all" period
 * @returns {Array<{ label: string, dateKey?: string, hourKey?: string, tokens: number, cost: number, requests: number, cachedTokens: number }>}
 */
export function buildEmptyChartBuckets(period = "7d", now = new Date(), earliestDateStr = null) {
  const normalizedPeriod = VALID_PERIODS.has(period) ? period : "7d";

  if (normalizedPeriod === "today") {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfNextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    // Dynamic hour count for today: 24 on normal days, 23 on Spring Forward, 25 on Fall Back
    const bucketCount = Math.max(1, Math.round((startOfNextDay.getTime() - startOfDay.getTime()) / 3600000));
    const bucketMs = 3600000;
    const startTimeMs = startOfDay.getTime();

    const rawBuckets = Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(startTimeMs + i * bucketMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const baseKey = `${y}-${m}-${day} ${h}:00`;
      const baseLabel = `${h}:00`;
      let tzName = "";
      try {
        const parts = d.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ");
        tzName = parts[parts.length - 1] || "";
      } catch {}
      return { d, baseKey, baseLabel, tzName, ts: d.getTime() };
    });

    const counts = {};
    for (const b of rawBuckets) counts[b.baseKey] = (counts[b.baseKey] || 0) + 1;
    const seenIndex = {};

    return rawBuckets.map((b) => {
      const hasDup = counts[b.baseKey] > 1;
      let suffixKey = "";
      let suffixLabel = "";
      if (hasDup) {
        if (b.tzName) {
          suffixKey = ` (${b.tzName})`;
          suffixLabel = ` ${b.tzName}`;
        } else {
          seenIndex[b.baseKey] = (seenIndex[b.baseKey] || 0) + 1;
          suffixKey = ` [${seenIndex[b.baseKey]}]`;
          suffixLabel = ` [${seenIndex[b.baseKey]}]`;
        }
      }
      const bucketKey = b.baseKey + suffixKey;
      const label = b.baseLabel + suffixLabel;
      return {
        label,
        bucketKey,
        hourKey: bucketKey,
        baseKey: b.baseKey,
        bucketTs: b.ts,
        tokens: 0,
        cost: 0,
        requests: 0,
        cachedTokens: 0,
      };
    });
  }

  if (normalizedPeriod === "24h") {
    // Current hour rounded down to hour boundary
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    // 24 hours ago rounded down to hour boundary
    const oldestHour = new Date(currentHour.getTime() - 24 * 3600000);

    // Bounded bucket count: exactly 25 hour buckets spanning oldest partial hour to current partial hour
    // Guarantees endpoints are distinct full timestamps, not HH only, without losing oldest or newest events
    const bucketCount = 25;
    const bucketMs = 3600000;
    const startTimeMs = oldestHour.getTime();

    const rawBuckets = Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(startTimeMs + i * bucketMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const baseKey = `${y}-${m}-${day} ${h}:00`;
      const baseLabel = `${m}/${day} ${h}:00`;
      let tzName = "";
      try {
        const parts = d.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ");
        tzName = parts[parts.length - 1] || "";
      } catch {}
      return { d, baseKey, baseLabel, tzName, ts: d.getTime() };
    });

    const counts = {};
    for (const b of rawBuckets) counts[b.baseKey] = (counts[b.baseKey] || 0) + 1;
    const seenIndex = {};

    return rawBuckets.map((b) => {
      const hasDup = counts[b.baseKey] > 1;
      let suffixKey = "";
      let suffixLabel = "";
      if (hasDup) {
        if (b.tzName) {
          suffixKey = ` (${b.tzName})`;
          suffixLabel = ` ${b.tzName}`;
        } else {
          seenIndex[b.baseKey] = (seenIndex[b.baseKey] || 0) + 1;
          suffixKey = ` [${seenIndex[b.baseKey]}]`;
          suffixLabel = ` [${seenIndex[b.baseKey]}]`;
        }
      }
      const bucketKey = b.baseKey + suffixKey;
      const label = b.baseLabel + suffixLabel;

      return {
        label,
        bucketKey,
        hourKey: bucketKey,
        baseKey: b.baseKey,
        bucketTs: b.ts,
        tokens: 0,
        cost: 0,
        requests: 0,
        cachedTokens: 0,
      };
    });
  }

  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (normalizedPeriod === "all") {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    let earliest = today;
    if (earliestDateStr) {
      const parts = earliestDateStr.split("-").map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        earliest = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      }
    }
    const diffDays = Math.max(1, Math.round((today.getTime() - earliest.getTime()) / 86400000) + 1);

    return Array.from({ length: diffDays }, (_, i) => {
      const d = new Date(earliest);
      d.setDate(d.getDate() + i);
      const dateKey = formatLocalDateKey(d);
      return {
        label: labelFn(d),
        dateKey,
        tokens: 0,
        cost: 0,
        requests: 0,
        cachedTokens: 0,
      };
    });
  }

  const days = normalizedPeriod === "7d" ? 7 : normalizedPeriod === "30d" ? 30 : 60;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    const dateKey = formatLocalDateKey(d);
    return {
      label: labelFn(d),
      dateKey,
      tokens: 0,
      cost: 0,
      requests: 0,
      cachedTokens: 0,
    };
  });
}
