import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    ...row,
    active: !!row.active,
    model_multiplier: typeof row.model_multiplier === "string" ? JSON.parse(row.model_multiplier || "{}") : (row.model_multiplier || {}),
  };
}

export async function getAllClientKeys() {
  const db = await getAdapter();
  const rows = db.all("SELECT * FROM client_keys ORDER BY created_at DESC");
  return rows.map(rowToKey);
}

export async function getClientKeyById(id) {
  const db = await getAdapter();
  const row = db.get("SELECT * FROM client_keys WHERE id = ?", [id]);
  return rowToKey(row);
}

export async function getClientKeyByToken(token, { includeInactive = false } = {}) {
  const db = await getAdapter();
  const query = includeInactive
    ? "SELECT * FROM client_keys WHERE key = ?"
    : "SELECT * FROM client_keys WHERE key = ? AND active = 1";
  const row = db.get(query, [token]);
  return rowToKey(row);
}

export async function createClientKey(k) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO client_keys (
      id, key, label, owner_note, quota_tokens, used_tokens,
      max_concurrent, rate_limit_per_minute, model_multiplier,
      model_allowlist, active, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    k.id,
    k.key,
    k.label || "",
    k.owner_note || "",
    k.quota_tokens || 0,
    k.used_tokens || 0,
    k.max_concurrent !== undefined ? k.max_concurrent : 15,
    k.rate_limit_per_minute !== undefined ? k.rate_limit_per_minute : 1024,
    typeof k.model_multiplier === "string" ? k.model_multiplier : JSON.stringify(k.model_multiplier || {}),
    k.model_allowlist || null,
    k.active !== false ? 1 : 0,
    k.expires_at || null,
    k.created_at || now,
    k.updated_at || now
  ]);
  return getClientKeyById(k.id);
}

export async function updateClientKey(id, updates) {
  const db = await getAdapter();
  const existing = await getClientKeyById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  db.run(`
    UPDATE client_keys SET
      label = ?,
      owner_note = ?,
      quota_tokens = ?,
      used_tokens = ?,
      max_concurrent = ?,
      rate_limit_per_minute = ?,
      model_multiplier = ?,
      model_allowlist = ?,
      active = ?,
      expires_at = ?,
      updated_at = ?
    WHERE id = ?
  `, [
    merged.label,
    merged.owner_note,
    merged.quota_tokens,
    merged.used_tokens,
    merged.max_concurrent,
    merged.rate_limit_per_minute,
    typeof merged.model_multiplier === "string" ? merged.model_multiplier : JSON.stringify(merged.model_multiplier || {}),
    merged.model_allowlist,
    merged.active ? 1 : 0,
    merged.expires_at,
    merged.updated_at,
    id
  ]);

  return getClientKeyById(id);
}

export async function deleteClientKey(id) {
  const db = await getAdapter();
  db.run("DELETE FROM client_keys WHERE id = ?", [id]);
  db.run("DELETE FROM client_key_usage_logs WHERE client_key_id = ? OR key_id = ?", [id, id]);
  return true;
}

export async function incrementClientKeyTokens(keyId, tokens) {
  const db = await getAdapter();
  db.run("UPDATE client_keys SET used_tokens = used_tokens + ? WHERE id = ?", [tokens, keyId]);
  const row = db.get("SELECT id, key, label, used_tokens, quota_tokens FROM client_keys WHERE id = ?", [keyId]);
  return row || { used_tokens: 0, quota_tokens: 0 };
}

export async function logClientKeyUsage(logData) {
  const db = await getAdapter();
  const id = logData.id || crypto.randomUUID();
  const keyId = logData.client_key_id || logData.key_id;
  const model = logData.model || "";
  const promptTokens = logData.prompt_tokens || 0;
  const completionTokens = logData.completion_tokens || 0;
  const billedTokens = logData.billed_tokens || (promptTokens + completionTokens) || logData.tokens || 0;
  const cost = logData.cost || 0;
  const createdAt = logData.created_at || new Date().toISOString();

  db.run(`
    INSERT INTO client_key_usage_logs (
      id, client_key_id, key_id, model, prompt_tokens, completion_tokens, billed_tokens, tokens, cost, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    keyId,
    keyId,
    model,
    promptTokens,
    completionTokens,
    billedTokens,
    billedTokens,
    cost,
    createdAt
  ]);
}

export async function getClientKeyUsageLogs(keyId, limit = 100) {
  const db = await getAdapter();
  return db.all(
    "SELECT * FROM client_key_usage_logs WHERE client_key_id = ? OR key_id = ? ORDER BY created_at DESC LIMIT ?",
    [keyId, keyId, limit]
  );
}

export async function getClientKeyUsageSummary(keyId) {
  const db = await getAdapter();
  return db.all(`
    SELECT 
      model,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(billed_tokens), 0) AS billed_tokens,
      COUNT(*) AS count
    FROM client_key_usage_logs
    WHERE client_key_id = ? OR key_id = ?
    GROUP BY model
  `, [keyId, keyId]);
}
