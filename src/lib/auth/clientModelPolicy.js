/**
 * Client Key Model Policy Engine (Pure Logic)
 * 
 * Centralized, pure policy validation and matching for Client Keys.
 * No direct database or network I/O to keep it lightweight, fast, and 100% testable.
 */

// Normalizes version separators: (\d)-(\d) <-> (\d).(\d)
export function normalizeModelId(modelId) {
  if (typeof modelId !== "string") return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Strips thinking suffix: e.g. "(high)" or "-high" / "-low" / "-medium" / "-minimal" / "-extra-low"
export function stripThinking(modelId) {
  if (typeof modelId !== "string") return modelId;
  return modelId
    .replace(/\([^()]+\)\s*$/, "")
    .replace(/-(high|medium|low|minimal|extra-low)$/i, "");
}

// Canonical provider alias map for strict provider identity comparison
const CANONICAL_PROVIDER_MAP = {
  ag: "antigravity",
  antigravity: "antigravity",
  cx: "codex",
  codex: "codex",
  gc: "google-claude",
  "google-claude": "google-claude",
  cl: "claude-cli",
  "claude-cli": "claude-cli",
  cc: "claude-code",
  "claude-code": "claude-code",
  gh: "github-copilot",
  "github-copilot": "github-copilot",
  kr: "kiro",
  kiro: "kiro",
  anthropic: "anthropic",
  claude: "anthropic",
  openai: "openai",
  gemini: "gemini",
  "gemini-cli": "gemini",
  vertex: "vertex",
  openrouter: "openrouter",
  deepseek: "deepseek",
  groq: "groq",
  xai: "xai",
};

export function canonicalProvider(provider) {
  if (!provider) return "";
  const lower = String(provider).trim().toLowerCase();
  return CANONICAL_PROVIDER_MAP[lower] || lower;
}

// Known Codex models and patterns (explicit product, not speculative guesses)
const CODEX_MODEL_PATTERNS = [
  /^codex-auto-review$/i,
  /^gpt-[56]\./i,
  /^gpt-6-/i,
  /^gpt-daybreak-/i,
  /^gpt-reserve/i,
  /^gpt-image-(?:1\.5|2|2\.5)/i,
];

const CLAUDE_PROVIDERS = new Set([
  "anthropic",
  "google-claude",
  "claude-cli",
  "claude-code",
  "antigravity",
  "vertex",
  "openrouter",
  "kiro",
]);

const GEMINI_PROVIDERS = new Set([
  "gemini",
  "antigravity",
  "vertex",
]);

export function isCodexModel(model, provider) {
  const canon = canonicalProvider(provider);
  // Unresolved provider must never match family policy based on model string naming alone
  if (!canon) return false;
  if (canon === "codex") return true;
  return false;
}

export function isClaudeModel(model, provider) {
  const canon = canonicalProvider(provider);
  // Unresolved provider must never match family policy based on model string naming alone
  if (!canon || !CLAUDE_PROVIDERS.has(canon)) return false;
  if (!model) return false;
  const clean = String(model).trim().toLowerCase();
  if (/^(?:gemini|gemma|gpt)(?:-|$)/i.test(clean)) return false;
  return /^claude(?:-|$)/i.test(clean);
}

export function isGeminiModel(model, provider) {
  const canon = canonicalProvider(provider);
  // Unresolved provider must never match family policy based on model string naming alone
  if (!canon || !GEMINI_PROVIDERS.has(canon)) return false;
  if (!model) return false;
  const clean = String(model).trim().toLowerCase();
  // Strictly exclude Gemma, Claude, and GPT
  if (/^(?:gemma|claude|gpt)(?:-|$)/i.test(clean)) return false;
  return /^gemini(?:-|$)/i.test(clean);
}

/**
 * Parse raw model_allowlist into a structured policy.
 * Empty, null, undefined, "*", "[]" -> unrestricted (backward compatible).
 * Malformed nonempty string -> malformed (fail closed).
 */
export function parseModelAllowlist(raw) {
  if (raw === null || raw === undefined) {
    return { unrestricted: true, rules: [], malformed: false };
  }

  let rules = [];

  if (Array.isArray(raw)) {
    rules = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "*" || trimmed === "[]") {
      return { unrestricted: true, rules: [], malformed: false };
    }
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return { unrestricted: false, rules: [], malformed: true, error: "Policy JSON must be an array" };
        }
        rules = parsed;
      } catch (err) {
        return { unrestricted: false, rules: [], malformed: true, error: `Invalid JSON policy: ${err.message}` };
      }
    } else {
      rules = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    }
  } else {
    return { unrestricted: false, rules: [], malformed: true, error: "Policy must be a string or array" };
  }

  if (rules.length === 0) {
    return { unrestricted: true, rules: [], malformed: false };
  }

  // Validate and normalize individual rules
  const normalizedRules = [];
  for (const item of rules) {
    if (typeof item !== "string") {
      return { unrestricted: false, rules: [], malformed: true, error: "Rule entries must be strings" };
    }
    const clean = item.trim();
    if (!clean) continue;

    // Reject dangerous characters or invalid wildcard syntax
    if (/\s/.test(clean)) {
      return { unrestricted: false, rules: [], malformed: true, error: `Rule cannot contain whitespace: '${clean}'` };
    }

    normalizedRules.push(clean);
  }

  return {
    unrestricted: false,
    rules: normalizedRules,
    malformed: false,
  };
}

/**
 * Strict validator for API requests (POST/PUT).
 * Returns { valid: boolean, normalized: string[], serialized: string, error?: string }
 */
export function validateModelAllowlistConfig(rawInput) {
  if (rawInput === null || rawInput === undefined || rawInput === "" || rawInput === "*") {
    return { valid: true, normalized: [], serialized: "" };
  }

  let candidates = [];
  if (Array.isArray(rawInput)) {
    candidates = rawInput;
  } else if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed || trimmed === "*" || trimmed === "[]") {
      return { valid: true, normalized: [], serialized: "" };
    }
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return { valid: false, error: "model_allowlist JSON must be an array" };
        }
        candidates = parsed;
      } catch (e) {
        return { valid: false, error: `Malformed model_allowlist JSON: ${e.message}` };
      }
    } else {
      candidates = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    }
  } else {
    return { valid: false, error: "model_allowlist must be an array or string" };
  }

  const validTokenPattern = /^[a-zA-Z0-9_.:/()\[\]*-]+$/;
  const normalized = [];

  for (const item of candidates) {
    if (typeof item !== "string" || !item.trim()) {
      return { valid: false, error: "All model allowlist rules must be non-empty strings" };
    }
    const clean = item.trim();
    if (!validTokenPattern.test(clean)) {
      return { valid: false, error: `Invalid characters in rule: '${clean}'` };
    }
    // Normalize family tokens
    if (clean === "claude" || clean === "family:claude" || clean === "claude/*") {
      normalized.push("family:claude");
    } else if (clean === "gemini" || clean === "family:gemini" || clean === "gemini/*") {
      normalized.push("family:gemini");
    } else if (clean === "codex" || clean === "family:codex" || clean === "codex/*" || clean === "cx/*") {
      normalized.push("family:codex");
    } else {
      normalized.push(clean);
    }
  }

  const unique = Array.from(new Set(normalized));
  return {
    valid: true,
    normalized: unique,
    serialized: unique.length > 0 ? JSON.stringify(unique) : "",
  };
}

/**
 * Check if a single concrete target { provider, model } is allowed under policy.
 */
export function isConcreteModelAllowed(target, policy) {
  if (!policy || policy.unrestricted) return true;
  if (policy.malformed) return false; // Fail closed
  if (!policy.rules || policy.rules.length === 0) return false;

  const targetProvider = canonicalProvider(target?.provider);
  const targetModel = target?.model ? String(target.model).trim() : "";
  const normTargetModel = normalizeModelId(targetModel);
  const cleanTargetModel = stripThinking(normTargetModel);

  for (const rule of policy.rules) {
    const lowerRule = rule.toLowerCase();

    // 1. Family: Claude
    if (lowerRule === "family:claude" || lowerRule === "claude/*" || lowerRule === "claude") {
      if (isClaudeModel(targetModel, targetProvider)) return true;
      continue;
    }

    // 2. Family: Gemini (Antigravity Claude is NOT Gemini!)
    if (lowerRule === "family:gemini" || lowerRule === "gemini/*" || lowerRule === "gemini") {
      if (isGeminiModel(targetModel, targetProvider)) return true;
      continue;
    }

    // 3. Family: Codex
    if (lowerRule === "family:codex" || lowerRule === "codex/*" || lowerRule === "cx/*" || lowerRule === "codex") {
      if (isCodexModel(targetModel, targetProvider)) return true;
      continue;
    }

    // 4. Exact Provider-Qualified rule (e.g. "anthropic/claude-3-7-sonnet" or "ag/gemini-3.8-flash-high")
    if (rule.includes("/")) {
      const slashIdx = rule.indexOf("/");
      const ruleProvider = canonicalProvider(rule.slice(0, slashIdx));
      const ruleModel = rule.slice(slashIdx + 1);
      const normRuleModel = normalizeModelId(ruleModel);
      const cleanRuleModel = stripThinking(normRuleModel);

      // Suffix cannot match a different provider
      if (ruleProvider !== targetProvider) continue;

      if (ruleModel === "*" || normRuleModel === normTargetModel || cleanRuleModel === cleanTargetModel) {
        return true;
      }
      continue;
    }

    // 5. Unqualified exact model rule (e.g. "gpt-4o", "claude-sonnet-4-5")
    const normRule = normalizeModelId(rule);
    const cleanRule = stripThinking(normRule);
    if (normRule === normTargetModel || cleanRule === cleanTargetModel) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a model string or target object is allowed by policy.
 * Convenient wrapper supporting both string ("provider/model" or bare name)
 * and concrete target objects ({ provider, model }).
 */
export function isModelAllowedByPolicy(modelOrTarget, policy) {
  if (!modelOrTarget) return false;
  if (typeof modelOrTarget === "object") {
    return isConcreteModelAllowed(modelOrTarget, policy);
  }

  const modelStr = String(modelOrTarget).trim();
  if (modelStr.includes("/")) {
    const slashIdx = modelStr.indexOf("/");
    const p = modelStr.slice(0, slashIdx);
    const m = modelStr.slice(slashIdx + 1);
    return isConcreteModelAllowed({ provider: p, model: m }, policy);
  }

  // Infer default provider for standard prefixes when bare model is passed
  let inferredProvider = null;
  const clean = modelStr.toLowerCase();
  if (/^gemini(?:-|$)/i.test(clean)) {
    inferredProvider = "gemini";
  } else if (/^gemma(?:-|$)/i.test(clean)) {
    inferredProvider = "gemini";
  } else if (/^claude(?:-|$)/i.test(clean)) {
    inferredProvider = "anthropic";
  } else if (/^gpt(?:-|$)/i.test(clean)) {
    inferredProvider = "openai";
  }

  return isConcreteModelAllowed({ provider: inferredProvider, model: modelStr }, policy);
}
