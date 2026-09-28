import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";
import { getDiskCache, setDiskCache } from "./diskCache.js";

const KV_CACHE_TTL_MS = 60_000;
if (!global._kvScopeCache) global._kvScopeCache = new Map();
const scopeCache = global._kvScopeCache;

export function makeKv(scope) {
  const diskKey = `kv:${scope}`;

  async function loadAll() {
    const cached = scopeCache.get(scope);
    if (cached && Date.now() - cached.ts < KV_CACHE_TTL_MS) {
      return cached.data;
    }
    try {
      const db = await getAdapter();
      const rows = await db.all(`SELECT key, value FROM kv WHERE scope = ?`, [scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      scopeCache.set(scope, { data: out, ts: Date.now() });
      setDiskCache(diskKey, out);
      return out;
    } catch (err) {
      if (cached) {
        cached.ts = Date.now();
        return cached.data;
      }
      const diskFallback = getDiskCache(diskKey, {});
      scopeCache.set(scope, { data: diskFallback, ts: Date.now() });
      return diskFallback;
    }
  }

  return {
    async get(key, fallback = null) {
      const all = await loadAll();
      return all[key] !== undefined ? all[key] : fallback;
    },
    async getAll() {
      const all = await loadAll();
      return { ...all };
    },
    async set(key, value) {
      const all = await loadAll();
      all[key] = value;
      scopeCache.set(scope, { data: all, ts: Date.now() });
      setDiskCache(diskKey, all);
      const db = await getAdapter();
      await db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, key, stringifyJson(value)]);
    },
    async setMany(obj) {
      const all = await loadAll();
      Object.assign(all, obj);
      scopeCache.set(scope, { data: all, ts: Date.now() });
      setDiskCache(diskKey, all);
      const db = await getAdapter();
      await db.transaction(async () => {
        for (const [k, v] of Object.entries(obj)) {
          await db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`, [scope, k, stringifyJson(v)]);
        }
      });
    },
    async remove(key) {
      const all = await loadAll();
      delete all[key];
      scopeCache.set(scope, { data: all, ts: Date.now() });
      setDiskCache(diskKey, all);
      const db = await getAdapter();
      await db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
    },
    async clear() {
      scopeCache.set(scope, { data: {}, ts: Date.now() });
      setDiskCache(diskKey, {});
      const db = await getAdapter();
      await db.run(`DELETE FROM kv WHERE scope = ?`, [scope]);
    },
  };
}
