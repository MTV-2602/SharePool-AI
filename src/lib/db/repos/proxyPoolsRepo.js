import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";

const POOLS_CACHE_TTL_MS = 60_000;
const DISK_KEY = "repo:proxyPools";
let _poolsCache = { data: null, ts: 0 };

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function upsert(db, p) {
  const r = poolToRow(p);
  await db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

async function loadAllPools() {
  if (_poolsCache.data && Date.now() - _poolsCache.ts < POOLS_CACHE_TTL_MS) {
    return _poolsCache.data;
  }
  try {
    const db = await getAdapter();
    const rows = await db.all(`SELECT * FROM proxyPools`);
    const list = rows.map(rowToPool);
    list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    _poolsCache = { data: list, ts: Date.now() };
    setDiskCache(DISK_KEY, list);
    return list;
  } catch (err) {
    if (_poolsCache.data) {
      _poolsCache.ts = Date.now();
      return _poolsCache.data;
    }
    const disk = getDiskCache(DISK_KEY, []);
    _poolsCache = { data: disk, ts: Date.now() };
    return disk;
  }
}

export async function getProxyPools(filter = {}) {
  let list = await loadAllPools();
  if (filter.isActive !== undefined) {
    const want = !!filter.isActive;
    list = list.filter((p) => !!p.isActive === want);
  }
  if (filter.testStatus) {
    list = list.filter((p) => p.testStatus === filter.testStatus);
  }
  return list;
}

export async function getProxyPoolById(id) {
  const list = await loadAllPools();
  return list.find((p) => p.id === id) || null;
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, pool);
  _poolsCache = { data: null, ts: 0 };
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    result = merged;
  });
  _poolsCache = { data: null, ts: 0 };
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    await db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  _poolsCache = { data: null, ts: 0 };
  return removed;
}
