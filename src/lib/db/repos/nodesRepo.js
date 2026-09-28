import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";

const NODES_CACHE_TTL_MS = 60_000;
const DISK_KEY = "repo:providerNodes";
let _nodesCache = { data: null, ts: 0 };

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function upsert(db, n) {
  const r = nodeToRow(n);
  await db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

async function loadAllNodes() {
  if (_nodesCache.data && Date.now() - _nodesCache.ts < NODES_CACHE_TTL_MS) {
    return _nodesCache.data;
  }
  try {
    const db = await getAdapter();
    const rows = await db.all(`SELECT * FROM providerNodes`);
    const list = rows.map(rowToNode);
    _nodesCache = { data: list, ts: Date.now() };
    setDiskCache(DISK_KEY, list);
    return list;
  } catch (err) {
    if (_nodesCache.data) {
      _nodesCache.ts = Date.now();
      return _nodesCache.data;
    }
    const disk = getDiskCache(DISK_KEY, []);
    _nodesCache = { data: disk, ts: Date.now() };
    return disk;
  }
}

export async function getProviderNodes(filter = {}) {
  const all = await loadAllNodes();
  if (filter.type) {
    return all.filter((n) => n.type === filter.type);
  }
  return all;
}

export async function getProviderNodeById(id) {
  const all = await loadAllNodes();
  return all.find((n) => n.id === id) || null;
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, node);
  _nodesCache = { data: null, ts: 0 };
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    await upsert(db, merged);
    result = merged;
  });
  _nodesCache = { data: null, ts: 0 };
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    await db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  _nodesCache = { data: null, ts: 0 };
  return removed;
}
