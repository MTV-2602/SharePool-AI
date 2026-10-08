import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat, modelSupportedFormats, normalizeModelId } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX, isMuseSparkModel, opencodeFamilyFormats } from "../providers/models/helpers.js";
import { FORMATS } from "../translator/formats.js";

export { PROVIDER_MODELS };

// OpenCode providers sharing the endpoint-family fallback for unknown model ids
const isOpenCodeAlias = (aliasOrId) => !aliasOrId || ["oc", "opencode", "ocg", "opencode-go", "ocz", "opencode-zen"].includes(aliasOrId);


// Helper functions
export function getProviderModels(aliasOrId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  return PROVIDER_MODELS[alias] || [];
}

export function getDefaultModel(aliasOrId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  return models?.[0]?.id || null;
}

// Providers whose registry uses dots in version numbers (e.g. "claude-sonnet-4.5").
// For these, we tolerate clients sending dashes ("claude-sonnet-4-5") by normalizing
// digit-hyphen-digit to digit-dot-digit before lookup. Other providers are left untouched.
const DOT_VERSION_PROVIDERS = new Set(["kr", "kiro"]);

// Find a registry entry by id. For Kiro models, tolerates dash/dot version separators
// ("claude-sonnet-4-5" ~= "claude-sonnet-4.5"). Other providers use exact match only.
function findModel(models, modelId, aliasOrId) {
  if (!models) return undefined;
  const baseModelId = typeof modelId === "string"
    ? modelId.replace(/\([^()]+\)\s*$/, "").trim()
    : modelId;
  const found = models.find(m => m.id === modelId || m.id === baseModelId);
  if (found) return found;
  if (!DOT_VERSION_PROVIDERS.has(aliasOrId)) return undefined;
  const normalized = normalizeModelId(baseModelId);
  if (normalized === baseModelId) return undefined;
  return models.find(m => m.id === normalized);
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  if (passthroughProviders.has(alias) || passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[alias];
  if (!models) return false;
  return !!findModel(models, modelId, aliasOrId);
}

export function findModelName(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  if (!models) return modelId;
  const found = findModel(models, modelId, aliasOrId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  if (isOpenCodeAlias(aliasOrId) && isMuseSparkModel(modelId)) {
    return FORMATS.OPENAI_RESPONSES;
  }
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  if (found) return modelTargetFormat(found);
  // Family fallback keeps modelsFetcher/passthrough ids on their endpoint lane
  if (isOpenCodeAlias(aliasOrId)) return opencodeFamilyFormats(modelId)?.targetFormat || null;
  return null;
}

// Declared upstream formats for a model (registry `supportedFormats`). Drives the
// per-model guard on the sourceFormat-matched transport; null when undeclared.
// Unknown OpenCode ids fall back to the family regex (chat lane by default) so
// auto-fetched models never wrongly use the sourceFormat-matched transport.
export function getModelSupportedFormats(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  if (found) return modelSupportedFormats(found);
  if (isOpenCodeAlias(aliasOrId)) return opencodeFamilyFormats(modelId)?.supportedFormats || [FORMATS.OPENAI];
  return null;
}

export function getModelType(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  if (!models) return null;
  const found = findModel(models, modelId, aliasOrId);
  return found?.kind || found?.type || null;
}

const THINKING_SUFFIX_RE = /^(.*)\(([^()]+)\)\s*$/;
const DASH_THINKING_SUFFIX_RE = /^((?:gemini|claude|gpt)-[a-z0-9.-]+?)-(high|medium|low|minimal|extra-low)$/i;

// Strip "(high)" / "(low)" / "(8192)" / "(none)" / "(auto)" thinking suffix from a model ID.
export function stripThinkingSuffix(modelId) {
  if (typeof modelId !== "string") return modelId;
  const m = modelId.match(THINKING_SUFFIX_RE);
  return m ? m[1].trim() : modelId;
}

// Live model IDs discovered from Antigravity's fetchAvailableModels endpoint at runtime
const liveAntigravityModels = new Set();

export function registerLiveAntigravityModels(modelIds = []) {
  if (!Array.isArray(modelIds)) return;
  for (const id of modelIds) {
    if (typeof id === "string" && id.trim()) {
      liveAntigravityModels.add(id.trim().toLowerCase());
    }
  }
}

function getLatestAntigravityFlashUpstream(level = "high") {
  const bucket = level === "medium" ? "medium" : (level === "low" || level === "minimal" ? "low" : "high");
  let bestModel = `gemini-3.8-flash-${bucket}`;
  let bestVer = 3.8;

  for (const id of liveAntigravityModels) {
    const m = id.match(/^gemini-(\d+(?:\.\d+)?)-flash-(high|medium|low)$/i);
    if (m && m[2].toLowerCase() === bucket) {
      const ver = parseFloat(m[1]);
      if (!Number.isNaN(ver) && ver >= bestVer) {
        bestVer = ver;
        bestModel = id;
      }
    }
  }
  return bestModel;
}

/**
 * Dynamically map any current or future Gemini model on Antigravity (e.g. gemini-3.8-flash-high,
 * gemini-3.9-flash-medium, gemini-4.0-flash, gemini-3.9-pro-low) to its valid Antigravity upstream slot
 * while preserving the thinking level as "(level)" for thinkingUnified.js.
 */
function resolveDynamicAntigravityUpstream(modelId, explicitUpstream = null) {
  if (typeof modelId !== "string") return explicitUpstream || modelId;

  // 1. Check "(level)" suffix first (e.g. "gemini-3-flash(high)", "gemini-3.1-pro(low)", "gemini-4.0-pro(low)")
  const parenMatch = modelId.match(THINKING_SUFFIX_RE);
  if (parenMatch) {
    const level = parenMatch[2].trim().toLowerCase();
    if (explicitUpstream) {
      return `${stripThinkingSuffix(explicitUpstream)}(${level})`;
    }
    const resolved = resolveDynamicAntigravityUpstream(`${parenMatch[1].trim()}-${level}`);
    return `${stripThinkingSuffix(resolved)}(${level})`;
  }

  // 2. Keep image and lite models intact
  if (/image|imagen|flash-lite/i.test(modelId)) {
    return explicitUpstream || modelId;
  }

  // 3. Check "-high" / "-medium" / "-low" / "-minimal" / "-extra-low" suffix on Gemini models
  const dashMatch = modelId.match(DASH_THINKING_SUFFIX_RE);
  const rawLevel = dashMatch ? dashMatch[2].toLowerCase() : null;
  const normLevel = rawLevel === "extra-low" ? "minimal" : rawLevel;
  const baseModel = dashMatch ? dashMatch[1].toLowerCase() : modelId.toLowerCase();
  const lowerId = modelId.toLowerCase();

  // Flash family (gemini-3-flash, gemini-3.7-flash, gemini-3.8-flash, gemini-3.9-flash, gemini-4.x-flash...)
  if (/^gemini-\d+(?:\.\d+)?-flash(?:-agent)?$/i.test(baseModel) || baseModel === "gemini-default") {
    let target = explicitUpstream;
    if (!target) {
      if (liveAntigravityModels.has(lowerId) && lowerId !== "gemini-3-flash-agent") {
        target = lowerId;
      } else if (baseModel === "gemini-3-flash" && !normLevel) {
        target = "gemini-3-flash";
      } else {
        target = getLatestAntigravityFlashUpstream(normLevel || "high");
      }
    }
    return normLevel ? `${target}(${normLevel})` : target;
  }

  // Pro family (gemini-pro-agent, gemini-3.1-pro, gemini-3.9-pro, gemini-4.x-pro...)
  if (/^gemini-(?:pro-agent|\d+(?:\.\d+)?-pro(?:-agent)?)$/i.test(baseModel)) {
    const isLow = normLevel === "low" || normLevel === "minimal";
    const target = explicitUpstream || (isLow ? "gemini-3.1-pro-low" : "gemini-pro-agent");
    const effectiveLevel = normLevel || (target.endsWith("-low") ? "low" : "high");
    return `${target}(${effectiveLevel})`;
  }

  // Claude Sonnet family (claude-sonnet-5-5, claude-sonnet-5.5, claude-sonnet-4-6, claude-3-5-sonnet, etc.)
  if (/^claude-(?:sonnet|3(?:-|\.)(?:5|7)-sonnet)(?:-\d+(?:[-.]\d+)?)?(?:-thinking)?$/i.test(baseModel)) {
    const level = normLevel || "high";
    return explicitUpstream ? (normLevel ? `claude-sonnet-5-5-${level}` : explicitUpstream) : `claude-sonnet-5-5-${level}`;
  }

  // Claude Opus family (claude-opus-5-5, claude-opus-5.5, claude-opus-4-6, claude-opus-4-6-thinking...)
  if (/^claude-(?:opus|3(?:-|\.)(?:5|7)-opus)(?:-\d+(?:[-.]\d+)?)?(?:-thinking)?$/i.test(baseModel)) {
    const level = normLevel || "high";
    return explicitUpstream ? (normLevel ? `claude-opus-5-5-${level}` : explicitUpstream) : `claude-opus-5-5-${level}`;
  }

  return explicitUpstream || modelId;
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const isAg = alias === "ag" || aliasOrId === "antigravity";
  const models = PROVIDER_MODELS[alias];
  const found = findModel(models, modelId, aliasOrId);

  if (isAg) {
    return resolveDynamicAntigravityUpstream(modelId, found?.upstreamModelId || null);
  }

  // Split off thinking suffix "(level)" so lookup hits the base id; re-append it to
  // the result so downstream applyThinking still sees the suffix (body.model is stripped separately).
  const sufMatch = typeof modelId === "string" ? modelId.match(/\([^()]+\)\s*$/) : null;
  const suffix = sufMatch ? sufMatch[0] : "";
  const baseId = suffix ? modelId.slice(0, sufMatch.index).trim() : modelId;
  const resolvedId = found?.upstreamModelId || found?.id;
  if (resolvedId) {
    const presetMatch = resolvedId.match(/\([^()]+\)\s*$/);
    const presetSuffix = presetMatch?.[0] || "";
    const resolvedBase = presetSuffix ? resolvedId.slice(0, presetMatch.index).trim() : resolvedId;
    return resolvedBase + (suffix || presetSuffix);
  }
  if (alias === "cx" && typeof baseId === "string" && baseId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return baseId.slice(0, -CODEX_REVIEW_SUFFIX.length) + suffix;
  }
  return baseId + suffix;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  return modelQuotaFamily(findModel(models, modelId, aliasOrId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from REGISTRY — no need to maintain manually. REGISTRY (not PROVIDERS):
// media-only entries (elevenlabs, cartesia, inworld, ...) declare no transport, so
// keying off PROVIDERS dropped their alias and made their registry `models`
// unreachable — the exact same map PROVIDER_MODELS is keyed by
// (`entry.alias || entry.id` in providers/index.js).
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  REGISTRY.map(r => [r.id, r.alias || r.id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(findModel(PROVIDER_MODELS[alias], modelId, alias));
}
