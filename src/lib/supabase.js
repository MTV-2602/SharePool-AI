import { createClient } from '@supabase/supabase-js';

const cleanEnvVar = (val) => {
  if (!val) return "";
  return String(val).trim().replace(/[\r\n]/g, "");
};

const supabaseUrl = cleanEnvVar(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);

function getSupabaseKey() {
  return cleanEnvVar(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_KEY
  );
}

const SUPABASE_TIMEOUT_MS = 6000;
const CIRCUIT_COOLDOWN_MS = 15000;

if (!global._supabaseCircuit) {
  global._supabaseCircuit = { openUntil: 0, lastReason: "" };
}
const circuit = global._supabaseCircuit;

async function supabaseFetchWithCircuitBreaker(input, init = {}) {
  const now = Date.now();
  if (circuit.openUntil > now) {
    return new Response(
      JSON.stringify({
        message: `Supabase circuit breaker open (${circuit.lastReason || "522/timeout"})`,
        code: "CIRCUIT_OPEN",
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Supabase request timeout (6s)")), SUPABASE_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();

  const signal = init.signal
    ? (typeof AbortSignal.any === "function" ? AbortSignal.any([init.signal, controller.signal]) : controller.signal)
    : controller.signal;

  try {
    const res = await fetch(input, { ...init, signal });
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status >= 520) {
      circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      circuit.lastReason = `HTTP ${res.status}`;
      return new Response(
        JSON.stringify({
          message: `Supabase upstream HTTP ${res.status} (circuit opened for 15s)`,
          code: `HTTP_${res.status}`,
        }),
        { status: 503, headers: { "content-type": "application/json" } }
      );
    }
    return res;
  } catch (err) {
    circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    circuit.lastReason = err?.message || "timeout";
    return new Response(
      JSON.stringify({
        message: `Supabase connection timeout (${circuit.lastReason})`,
        code: "TIMEOUT",
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  } finally {
    clearTimeout(timer);
  }
}

const clientCache = new Map();

function getClient() {
  const url = supabaseUrl;
  const key = getSupabaseKey();
  if (!url || !key) {
    return null;
  }
  const cacheKey = `${url}:${key}`;
  if (!clientCache.has(cacheKey)) {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: supabaseFetchWithCircuitBreaker },
    });
    clientCache.set(cacheKey, client);
  }
  return clientCache.get(cacheKey);
}

export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getClient();
    if (!client) {
      console.warn(`[Supabase] Client not initialized. Property: "${String(prop)}"`);
      return undefined;
    }
    const val = Reflect.get(client, prop);
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  }
});