import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getDiskCache, setDiskCache } from "../helpers/diskCache.js";

const COMBOS_CACHE_TTL_MS = 60_000;
const DISK_KEY = "repo:combos";
let _combosCache = { data: null, ts: 0 };

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  if (_combosCache.data && Date.now() - _combosCache.ts < COMBOS_CACHE_TTL_MS) {
    return _combosCache.data;
  }
  try {
    const db = await getAdapter();
    const rows = await db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
    const list = rows.map(rowToCombo);
    _combosCache = { data: list, ts: Date.now() };
    setDiskCache(DISK_KEY, list);
    return list;
  } catch (err) {
    if (_combosCache.data) {
      _combosCache.ts = Date.now();
      return _combosCache.data;
    }
    const disk = getDiskCache(DISK_KEY, []);
    _combosCache = { data: disk, ts: Date.now() };
    return disk;
  }
}

export async function getComboById(id) {
  const all = await getCombos();
  return all.find((c) => c.id === id) || null;
}

export async function getComboByName(name) {
  const all = await getCombos();
  return all.find((c) => c.name === name) || null;
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  _combosCache = { data: null, ts: 0 };
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    await db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  _combosCache = { data: null, ts: 0 };
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  _combosCache = { data: null, ts: 0 };
  return (res?.changes ?? 0) > 0;
}
