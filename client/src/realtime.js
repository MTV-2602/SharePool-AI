import { createClient } from "@supabase/supabase-js";

let cachedClient = null;
let cachedKey = "";

const toTrimmedString = (value) => String(value || "").trim();

export const canUseRealtimeRuntime = (config = {}) =>
  !!toTrimmedString(config?.url) && !!toTrimmedString(config?.anonKey);

export const getRealtimeSafetySyncMs = (config = {}, fallback = 90000) => {
  const parsed = Number(config?.safetySyncMs || 0);
  if (!Number.isFinite(parsed) || parsed < 5000) return fallback;
  return Math.floor(parsed);
};

export const getRealtimeClient = (config = {}) => {
  const url = toTrimmedString(config?.url);
  const anonKey = toTrimmedString(config?.anonKey);
  if (!url || !anonKey) return null;

  const nextKey = `${url}::${anonKey}`;
  if (cachedClient && cachedKey === nextKey) {
    return cachedClient;
  }

  cachedKey = nextKey;
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return cachedClient;
};

export const subscribeToBroadcastTopic = ({
  config = {},
  topic = "",
  onMessage,
} = {}) => {
  const client = getRealtimeClient(config);
  const normalizedTopic = toTrimmedString(topic);
  if (!client || !normalizedTopic || typeof onMessage !== "function") {
    return () => {};
  }

  const channel = client.channel(normalizedTopic, {
    config: {
      broadcast: {
        ack: false,
        self: false,
      },
    },
  });

  channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
    onMessage({
      topic: normalizedTopic,
      event: toTrimmedString(event),
      payload: payload && typeof payload === "object" ? payload : {},
    });
  });

  channel.subscribe();

  return () => {
    try {
      channel.unsubscribe();
    } catch {}
    try {
      const removal = client.removeChannel(channel);
      if (removal && typeof removal.catch === "function") {
        removal.catch(() => {});
      }
    } catch {}
  };
};
