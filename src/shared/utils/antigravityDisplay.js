/**
 * Display filter for Antigravity models shown in Admin Dashboard, /v1/models,
 * and Client Portal.
 *
 * Keeps Gemini 3.8+ plus active Claude and GPT-OSS models with `-low` and `-high` tiers only to avoid cluttering pickers
 * with legacy versions and intermediate thinking tiers.
 *
 * Note: open-sse/providers/registry/antigravity.js intentionally retains all
 * upstream variants so direct routing, aliases, and upstream tests stay intact.
 */
export const ANTIGRAVITY_DISPLAY_MODEL_IDS = new Set([
  "gemini-4-hydrogen-high",
  "gemini-4-hydrogen-low",
  "gemini-4-neon-high",
  "gemini-4-neon-low",
  "gemini-4-carbon-high",
  "gemini-4-carbon-low",
  "gemini-4-argon-high",
  "gemini-4-argon-low",
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-low",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
]);

export function isAntigravityDisplayModel(modelId) {
  if (typeof modelId !== "string") return false;
  return ANTIGRAVITY_DISPLAY_MODEL_IDS.has(modelId.trim().replace(/^(?:ag|antigravity)\//, ""));
}

/**
 * Merge static display models with optional live catalog entries for Antigravity,
 * preserving static display order and enriching matching entries with live metadata.
 */
export function mergeAntigravityDisplayModels(liveModels = [], staticModels = []) {
  const liveById = new Map();
  for (const m of Array.isArray(liveModels) ? liveModels : []) {
    if (m?.id && isAntigravityDisplayModel(m.id)) {
      const id = m.id.trim().replace(/^(?:ag|antigravity)\//, "");
      liveById.set(id, { ...m, id });
    }
  }

  const merged = [];
  const seen = new Set();

  for (const s of Array.isArray(staticModels) ? staticModels : []) {
    if (!s?.id || !isAntigravityDisplayModel(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    const live = liveById.get(s.id);
    merged.push(live ? { ...s, ...live, name: s.name || live.name } : s);
  }

  for (const [id, live] of liveById.entries()) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(live);
    }
  }

  return merged;
}
