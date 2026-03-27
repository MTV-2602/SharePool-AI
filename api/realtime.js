const axios = require("axios");
const crypto = require("crypto");

const toNonEmptyString = (value) => String(value || "").trim();

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const getSupabaseUrl = () => toNonEmptyString(process.env.SUPABASE_URL);
const getSupabaseAnonKey = () => toNonEmptyString(process.env.SUPABASE_ANON_KEY);
const getSupabaseServiceRoleKey = () =>
  toNonEmptyString(process.env.SUPABASE_SERVICE_ROLE_KEY);

const isRealtimeEnabled = () =>
  !!getSupabaseUrl() && !!getSupabaseAnonKey() && !!getSupabaseServiceRoleKey();

const getRealtimeSafetySyncMs = () =>
  toPositiveInt(process.env.STORE_REALTIME_SAFETY_SYNC_MS, 90000);

const getRealtimeTopicSecret = () =>
  toNonEmptyString(
    process.env.SUPABASE_REALTIME_TOPIC_SECRET ||
      process.env.STORE_USER_JWT_SECRET ||
      process.env.JWT_SECRET ||
      "store-realtime-secret",
  );

const buildRealtimeTopic = (scope = "topic", identifier = "") => {
  const normalizedScope = toNonEmptyString(scope) || "topic";
  const normalizedIdentifier = toNonEmptyString(identifier) || "default";
  const digest = crypto
    .createHmac("sha256", getRealtimeTopicSecret())
    .update(`${normalizedScope}:${normalizedIdentifier}`)
    .digest("hex");
  return `${normalizedScope}:${digest.slice(0, 24)}`;
};

const buildAdminRealtimeTopic = () =>
  buildRealtimeTopic("admin-dashboard", "main");

const buildStoreUserRealtimeTopic = (userId = "") =>
  buildRealtimeTopic("user", userId);

const buildStoreSupportRealtimeTopic = (conversationId = "") =>
  buildRealtimeTopic("support", conversationId);

const buildStoreRealtimeClientConfig = () => ({
  enabled: isRealtimeEnabled(),
  url: isRealtimeEnabled() ? getSupabaseUrl() : "",
  anonKey: isRealtimeEnabled() ? getSupabaseAnonKey() : "",
  safetySyncMs: getRealtimeSafetySyncMs(),
});

const emitRealtimeEvents = async (events = []) => {
  if (!isRealtimeEnabled()) {
    return { success: false, reason: "disabled", count: 0 };
  }

  const messages = (Array.isArray(events) ? events : [])
    .map((event) => ({
      topic: toNonEmptyString(event?.topic),
      event: toNonEmptyString(event?.event),
      payload:
        event?.payload && typeof event.payload === "object" ? event.payload : {},
    }))
    .filter((event) => event.topic && event.event);

  if (messages.length === 0) {
    return { success: true, count: 0 };
  }

  await axios.post(
    `${getSupabaseUrl().replace(/\/+$/, "")}/realtime/v1/api/broadcast`,
    { messages },
    {
      timeout: 5000,
      headers: {
        apikey: getSupabaseServiceRoleKey(),
        Authorization: `Bearer ${getSupabaseServiceRoleKey()}`,
        "Content-Type": "application/json",
      },
    },
  );

  return { success: true, count: messages.length };
};

module.exports = {
  buildAdminRealtimeTopic,
  buildStoreRealtimeClientConfig,
  buildStoreSupportRealtimeTopic,
  buildStoreUserRealtimeTopic,
  emitRealtimeEvents,
  getRealtimeSafetySyncMs,
  isRealtimeEnabled,
};
