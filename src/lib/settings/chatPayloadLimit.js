/**
 * Chat Completions Global Request Payload Limit Handler
 * 
 * Manages validation, precedence resolution, bounded caching with singleflight
 * refresh, generation protection against save-refresh races, and fallback
 * mechanisms for Chat Completions request body limits.
 * 
 * Precedence:
 *   1. Valid saved setting (`chatCompletionsMaxBodyBytes` in settingsRepo)
 *   2. Strict valid env (`MAX_REQUEST_BODY_BYTES`)
 *   3. System default (8 MiB = 8,388,608 bytes)
 * 
 * Note on consistency & staleness:
 *   Cross-worker caching has a two-tier TTL: generic `settingsRepo` (60s) + helper-level
 *   `_effectiveLimitCache` (60s). Across separate worker processes, updates are eventually
 *   consistent and may take up to ~120s to propagate if caches expire out of phase without
 *   process restarts.
 * 
 * Note on DB errors & fallback:
 *   `getSettings()` catches DB errors and falls back to in-memory `_settingsCache`, then disk cache,
 *   and finally to defaults where `chatCompletionsMaxBodyBytes` is unset. Thus, during DB outages
 *   where no prior in-memory or disk cache exists, the system falls back to default 8 MiB (or env)
 *   rather than guaranteeing last-known-good on all error paths.
 */

import { getSettings } from "../db/repos/settingsRepo.js";

export const DEFAULT_PAYLOAD_LIMIT_BYTES = 8388608; // 8 MiB = 8 * 1024 * 1024
export const MIN_PAYLOAD_LIMIT_BYTES = 1048576; // 1 MiB = 1 * 1024 * 1024
export const MAX_PAYLOAD_LIMIT_BYTES = 33554432; // 32 MiB = 32 * 1024 * 1024
export const PAYLOAD_LIMIT_SETTING_KEY = "chatCompletionsMaxBodyBytes";

const CACHE_TTL_MS = 60000; // 60s
const REFRESH_TIMEOUT_MS = 1000; // 1s bounded wait

let _effectiveLimitCache = null;
let _effectiveLimitCacheTs = 0;
let _lastKnownValid = null;
let _currentGeneration = 0;
let _inFlightRefreshPromise = null;

/**
 * Validates payload limit input.
 * Allowed: null (inherit), or safe integer between 1 MiB and 32 MiB.
 * Rejects: string, bool, NaN, frac, zero, negative, out of bounds.
 */
export function isValidPayloadLimit(value) {
  if (value === null) return true;
  if (typeof value !== "number") return false;
  if (!Number.isSafeInteger(value)) return false;
  return value >= MIN_PAYLOAD_LIMIT_BYTES && value <= MAX_PAYLOAD_LIMIT_BYTES;
}

/**
 * Strictly parses MAX_REQUEST_BODY_BYTES from environment.
 * Must be pure numeric digits without trailing junk, decimals, or signs,
 * and within safe integer bounds [1 MiB, 32 MiB].
 * Returns null if invalid or unset.
 */
export function parseStrictEnvLimit(rawVal = process.env.MAX_REQUEST_BODY_BYTES) {
  if (typeof rawVal !== "string") return null;
  const trimmed = rawVal.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num)) return null;
  if (num < MIN_PAYLOAD_LIMIT_BYTES || num > MAX_PAYLOAD_LIMIT_BYTES) return null;
  return num;
}

/**
 * Resolves effective payload limit and source with strict precedence:
 *   valid saved > strict valid env > default (8 MiB)
 */
export function resolvePayloadLimit({ savedBytes, envVal = process.env.MAX_REQUEST_BODY_BYTES } = {}) {
  // 1. Valid saved setting
  if (
    typeof savedBytes === "number" &&
    Number.isSafeInteger(savedBytes) &&
    savedBytes >= MIN_PAYLOAD_LIMIT_BYTES &&
    savedBytes <= MAX_PAYLOAD_LIMIT_BYTES
  ) {
    return {
      effectiveBytes: savedBytes,
      source: "saved",
    };
  }

  // 2. Strict valid env var
  const envBytes = parseStrictEnvLimit(envVal);
  if (envBytes !== null) {
    return {
      effectiveBytes: envBytes,
      source: "env",
    };
  }

  // 3. System default (8 MiB)
  return {
    effectiveBytes: DEFAULT_PAYLOAD_LIMIT_BYTES,
    source: "default",
  };
}

/**
 * Computes non-persisted payloadLimit metadata for GET / PATCH settings API.
 */
export function getPayloadLimitMetadata(settings, envVal = process.env.MAX_REQUEST_BODY_BYTES) {
  const savedBytes = settings?.[PAYLOAD_LIMIT_SETTING_KEY];
  const { effectiveBytes, source } = resolvePayloadLimit({ savedBytes, envVal });
  return {
    effectiveBytes,
    source,
    min: MIN_PAYLOAD_LIMIT_BYTES,
    max: MAX_PAYLOAD_LIMIT_BYTES,
    minBytes: MIN_PAYLOAD_LIMIT_BYTES,
    maxBytes: MAX_PAYLOAD_LIMIT_BYTES,
    minMiB: 1,
    maxMiB: 32,
    defaultBytes: DEFAULT_PAYLOAD_LIMIT_BYTES,
  };
}

/**
 * Publishes a newly persisted payload limit into local cache.
 * Bumps generation to protect against in-flight refreshes overwriting this save.
 * Must only be called after persistence success!
 */
export function publishPayloadLimit(newSavedBytes) {
  _currentGeneration++;
  const resolved = resolvePayloadLimit({ savedBytes: newSavedBytes });
  _effectiveLimitCache = resolved;
  _effectiveLimitCacheTs = Date.now();
  _lastKnownValid = resolved;
  return resolved;
}

/**
 * Bounded cache getter with singleflight refresh:
 * - Returns warm cache immediately if < 60s
 * - Singleflight deduplication if refresh already active
 * - Bounded 1s wait; times out without aborting background in-flight promise
 * - Generation check prevents old refresh from overwriting successful save
 * - Falls back to last-known-valid or env/default on timeout/error
 */
export async function getChatPayloadLimitInfo() {
  const now = Date.now();
  if (_effectiveLimitCache && now - _effectiveLimitCacheTs < CACHE_TTL_MS) {
    return _effectiveLimitCache;
  }

  if (!_inFlightRefreshPromise) {
    const requestGen = _currentGeneration;
    _inFlightRefreshPromise = (async () => {
      try {
        const settings = await getSettings();
        const resolved = resolvePayloadLimit({
          savedBytes: settings?.[PAYLOAD_LIMIT_SETTING_KEY],
        });
        // Generation guard: ignore if a save published a newer generation while in flight
        if (requestGen === _currentGeneration) {
          _effectiveLimitCache = resolved;
          _effectiveLimitCacheTs = Date.now();
          _lastKnownValid = resolved;
          return resolved;
        }
        // Generation changed while in flight: return published cache so waiters do not receive stale resolved
        return _effectiveLimitCache || resolved;
      } catch (err) {
        console.warn("[chatPayloadLimit] Transient error refreshing settings, using fallback:", err?.message || err);
        if (_lastKnownValid) return _lastKnownValid;
        return resolvePayloadLimit({ savedBytes: null });
      } finally {
        _inFlightRefreshPromise = null;
      }
    })();
  }

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      // Timeout triggered: return last known valid or fallback, leaving in-flight running
      if (_lastKnownValid) {
        resolve(_lastKnownValid);
      } else {
        resolve(resolvePayloadLimit({ savedBytes: null }));
      }
    }, REFRESH_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([_inFlightRefreshPromise, timeoutPromise]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Returns effective chat payload limit in bytes.
 */
export async function getChatPayloadLimit() {
  const info = await getChatPayloadLimitInfo();
  return info.effectiveBytes;
}

/**
 * Alias for getChatPayloadLimit
 */
export const getEffectiveChatPayloadLimit = getChatPayloadLimit;

/**
 * Testing helper: resets internal cache state
 */
export function _resetPayloadLimitCacheForTesting() {
  _effectiveLimitCache = null;
  _effectiveLimitCacheTs = 0;
  _lastKnownValid = null;
  _currentGeneration = 0;
  _inFlightRefreshPromise = null;
}
