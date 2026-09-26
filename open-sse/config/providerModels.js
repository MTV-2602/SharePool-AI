import { PROVIDERS } from "./providers.js";
import REGISTRY from "../providers/registry/index.js";
// PROVIDER_MODELS now built from providers/registry (transport + models co-located)
import { PROVIDER_MODELS } from "../providers/index.js";
import { modelQuotaFamily, modelStrip, modelTargetFormat } from "../providers/models/schema.js";
import { CODEX_REVIEW_SUFFIX } from "../providers/models/helpers.js";

export { PROVIDER_MODELS };


// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = models.find(m => m.id === modelId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  return modelTargetFormat(models.find(m => m.id === modelId));
}

export function getModelType(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = models.find(m => m.id === modelId);
  return found?.kind || found?.type || null;
}

const THINKING_SUFFIX_RE = /^(.*)\(([^()]+)\)\s*$/;
const DASH_THINKING_SUFFIX_RE = /^(gemini-[a-z0-9.-]+?)-(high|medium|low|minimal|extra-low)$/i;

// Strip "(high)" / "(low)" / "(8192)" / "(none)" / "(auto)" thinking suffix from a model ID.
export function stripThinkingSuffix(modelId) {
  if (typeof modelId !== "string") return modelId;
  const m = modelId.match(THINKING_SUFFIX_RE);
  return m ? m[1].trim() : modelId;
}

/**
 * Dynamically resolve any current or future Gemini model on Antigravity (e.g. gemini-3.8-flash-high,
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

  // 2. Keep image models intact
  if (/image|imagen/i.test(modelId)) {
    return explicitUpstream || modelId;
  }

  // 3. Check "-high" / "-medium" / "-low" / "-minimal" / "-extra-low" suffix on Gemini models
  const dashMatch = modelId.match(DASH_THINKING_SUFFIX_RE);
  const rawLevel = dashMatch ? dashMatch[2].toLowerCase() : null;
  const normLevel = rawLevel === "extra-low" ? "minimal" : rawLevel;
  const baseModel = dashMatch ? dashMatch[1].toLowerCase() : modelId.toLowerCase();

  // Flash family (gemini-3-flash, gemini-3.7-flash, gemini-3.8-flash, gemini-3.9-flash, gemini-4.x-flash...)
  if (/^gemini-\d+(?:\.\d+)?-flash(?:-agent)?$/i.test(baseModel) || baseModel === "gemini-default") {
    const target = explicitUpstream || "gemini-3-flash-agent";
    return normLevel ? `${target}(${normLevel})` : target;
  }

  // Pro family (gemini-pro-agent, gemini-3.1-pro, gemini-3.9-pro, gemini-4.x-pro...)
  if (/^gemini-(?:pro-agent|\d+(?:\.\d+)?-pro(?:-agent)?)$/i.test(baseModel)) {
    const isLow = normLevel === "low" || normLevel === "minimal";
    const target = explicitUpstream || (isLow ? "gemini-3.1-pro-low" : "gemini-3.1-pro-high");
    const effectiveLevel = normLevel || (target.endsWith("-low") ? "low" : "high");
    return `${target}(${effectiveLevel})`;
  }

  return explicitUpstream || modelId;
}

export function getModelUpstreamId(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const isAg = alias === "ag" || aliasOrId === "antigravity";
  const models = PROVIDER_MODELS[alias];
  const found = models?.find(m => m.id === modelId);

  if (isAg) {
    return resolveDynamicAntigravityUpstream(modelId, found?.upstreamModelId || null);
  }

  if (found?.upstreamModelId) {
    if (typeof modelId === "string") {
      const suffixMatch = modelId.match(THINKING_SUFFIX_RE);
      if (suffixMatch) return `${found.upstreamModelId}(${suffixMatch[2]})`;
    }
    return found.upstreamModelId;
  }
  // Strip "(high)"/"(low)"/... suffix before lookup so e.g. "gemini-3-flash(high)" resolves
  // to "gemini-3-flash-agent(high)" (keeping the suffix for applyThinking to consume).
  if (typeof modelId === "string") {
    const suffixMatch = modelId.match(THINKING_SUFFIX_RE);
    if (suffixMatch) {
      const baseFound = models?.find(m => m.id === suffixMatch[1].trim());
      if (baseFound?.upstreamModelId) {
        return `${baseFound.upstreamModelId}(${suffixMatch[2]})`;
      }
    }
  }
  if (alias === "cx" && typeof modelId === "string" && modelId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return modelId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const alias = PROVIDER_ID_TO_ALIAS[aliasOrId] || aliasOrId;
  const models = PROVIDER_MODELS[alias];
  return modelQuotaFamily(models?.find(m => m.id === modelId));
}

// OAuth short aliases — derived from registry `alias` (single source). everything else: alias = id.
// vertex/vertex-partner keep alias=id (kept via the `|| id` fallback in consumers).
export const OAUTH_ALIASES = Object.fromEntries(
  REGISTRY.filter(r => r.alias && r.alias !== r.id).map(r => [r.id, r.alias])
);

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  return modelStrip(PROVIDER_MODELS[alias]?.find(m => m.id === modelId));
}
