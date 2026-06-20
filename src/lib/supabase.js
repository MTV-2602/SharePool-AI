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