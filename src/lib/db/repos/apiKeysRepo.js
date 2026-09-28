import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";

const API_KEYS_CACHE_TTL_MS = 60_000;
const DISK_KEY = "repo:apiKeys";
let _apiKeysCache = { data: null, ts: 0 };

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  if (_apiKeysCache.data && Date.now() - _apiKeysCache.ts < API_KEYS_CACHE_TTL_MS) {
    return _apiKeysCache.data;
  }
  try {
    const db = await getAdapter();
    const rows = await db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
    const list = rows.map(rowToKey);
    _apiKeysCache = { data: list, ts: Date.now() };
    setDiskCache(DISK_KEY, list);
    return list;
  } catch (err) {
    if (_apiKeysCache.data) {
      _apiKeysCache.ts = Date.now();
      return _apiKeysCache.data;
    }
    const disk = getDiskCache(DISK_KEY, []);
    _apiKeysCache = { data: disk, ts: Date.now() };
    return disk;
  }
}

export async function getApiKeyById(id) {
  const all = await getApiKeys();
  return all.find((k) => k.id === id) || null;
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  await db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
  );
  _apiKeysCache = { data: null, ts: 0 };
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    await db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  _apiKeysCache = { data: null, ts: 0 };
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  _apiKeysCache = { data: null, ts: 0 };
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  try {
    const all = await getApiKeys();
    const match = all.find((k) => k.key === key);
    if (!match) return false;
    return match.isActive === true;
  } catch {
    return false;
  }
}
