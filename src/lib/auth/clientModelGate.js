/**
 * Client Key Model Gate
 *
 * Preflight access authorization and model discovery filtering.
 * Prevents unauthorized requests from reaching credential selection,
 * OAuth token refresh, or upstream dispatch.
 */

import { parseModelAllowlist, isConcreteModelAllowed } from "./clientModelPolicy.js";

/**
 * Protocol detection from request URL
 */
export function detectProtocolFromRequest(request) {
  if (!request?.url) return "openai";
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/v1/messages") || pathname.startsWith("/api/v1/messages")) return "claude";
    if (pathname.startsWith("/v1beta") || pathname.startsWith("/api/v1beta")) return "gemini";
    return "openai";
  } catch {
    return "openai";
  }
}

/**
 * Formats a protocol-appropriate 403 Forbidden Response.
 */
export function createForbiddenResponse(model, protocol = "openai", reason = null) {
  const message = reason || `Model '${model}' is not allowed by client key policy`;

  if (protocol === "claude") {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "permission_error",
          message,
        },
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  if (protocol === "gemini") {
    return new Response(
      JSON.stringify({
        error: {
          code: 403,
          message,
          status: "PERMISSION_DENIED",
        },
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  // Default: OpenAI format
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "permission_denied",
        code: "model_not_allowed",
      },
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

/**
 * Check if a client key is permitted to execute the requested model,
 * preflighting combos, fusions, and aliases recursively.
 */
export async function checkClientKeyModelAccess(clientKeyData, requestedModel, options = {}) {
  // If no client key data or no allowlist attribute -> unrestricted
  if (!clientKeyData || clientKeyData.model_allowlist === undefined) {
    return { allowed: true };
  }

  const policy = parseModelAllowlist(clientKeyData.model_allowlist);
  if (policy.unrestricted) {
    return { allowed: true };
  }
  if (policy.malformed) {
    return {
      allowed: false,
      reason: `Client key policy is malformed: ${policy.error || "syntax error"}`,
      forbiddenModel: requestedModel,
    };
  }

  if (typeof requestedModel !== "string") {
    return {
      allowed: false,
      reason: "Invalid model identifier: model must be a non-empty string",
      forbiddenModel: String(requestedModel ?? ""),
    };
  }

  const modelStr = requestedModel.trim();
  if (!modelStr) {
    return { allowed: false, reason: "Missing model", forbiddenModel: "" };
  }

  // Resolvers with injection support for unit testing
  const getCombo = options.getComboByName || (async (name) => {
    const { getComboByName } = await import("@/lib/localDb");
    return await getComboByName(name);
  });

  const getInfo = options.getModelInfo || (async (name) => {
    const { getModelInfo } = await import("@/sse/services/model.js");
    return await getModelInfo(name);
  });

  const getSettingsObj = options.getSettings || (async () => {
    const { getSettings } = await import("@/lib/localDb");
    return await getSettings();
  });

  // Cycle-safe bounded recursion to collect all concrete models
  const visitedCombos = new Set();
  const activeStack = new Set();
  const concreteTargets = [];
  let hasCycle = false;
  let cycleModel = null;
  let depthExceeded = false;
  let emptyCombo = false;
  let emptyComboName = null;
  let invalidComboChild = null;
  let invalidJudge = null;
  let resolverError = null;

  async function resolveTargets(currModel, depth = 0) {
    if (resolverError || hasCycle || depthExceeded || emptyCombo || invalidComboChild || invalidJudge) return;

    if (typeof currModel !== "string" || !currModel.trim()) {
      invalidComboChild = { combo: "unknown", child: currModel };
      return;
    }

    if (depth > 5) {
      depthExceeded = true;
      return;
    }

    const cleanModel = currModel.trim();

    // Provider-qualified aliases bypass combo lookup to match runtime precedence and prevent shadowing
    if (cleanModel.includes("/")) {
      let info;
      try {
        info = await getInfo(cleanModel);
      } catch (err) {
        resolverError = err;
        return;
      }
      if (!info?.provider) {
        concreteTargets.push({ provider: null, model: info?.model || cleanModel, raw: cleanModel });
      } else {
        concreteTargets.push({ provider: info.provider, model: info.model, raw: cleanModel });
      }
      return;
    }

    let combo = null;
    try {
      combo = await getCombo(cleanModel);
    } catch (err) {
      resolverError = err;
      return;
    }

    if (combo) {
      if (!Array.isArray(combo.models) || combo.models.length === 0) {
        emptyCombo = true;
        emptyComboName = cleanModel;
        return;
      }

      if (activeStack.has(cleanModel)) {
        hasCycle = true;
        cycleModel = cleanModel;
        return;
      }

      if (visitedCombos.has(cleanModel)) {
        return;
      }

      activeStack.add(cleanModel);
      visitedCombos.add(cleanModel);

      try {
        // Check fusion judge model
        let settings = {};
        try {
          settings = await getSettingsObj();
        } catch (err) {
          resolverError = err;
          return;
        }

        const comboStrategies = settings?.comboStrategies || {};
        const comboSpecificStrategy = comboStrategies[cleanModel]?.fallbackStrategy;
        const comboStrategy = comboSpecificStrategy || settings?.comboStrategy || "fallback";

        if (comboStrategy === "fusion") {
          const rawJudge = comboStrategies[cleanModel]?.judgeModel;
          let judge;
          if (rawJudge !== undefined) {
            if (typeof rawJudge !== "string" || !rawJudge.trim()) {
              invalidJudge = { combo: cleanModel, judge: rawJudge };
              return;
            }
            judge = rawJudge.trim();
          } else {
            const firstChild = combo.models[0];
            if (typeof firstChild !== "string" || !firstChild.trim()) {
              invalidComboChild = { combo: cleanModel, child: firstChild };
              return;
            }
            judge = firstChild.trim();
          }

          if (judge) {
            await resolveTargets(judge, depth + 1);
            if (resolverError || hasCycle || depthExceeded || emptyCombo || invalidComboChild || invalidJudge) return;
          }
        }

        for (const child of combo.models) {
          if (typeof child !== "string" || !child.trim()) {
            invalidComboChild = { combo: cleanModel, child };
            return;
          }
          await resolveTargets(child.trim(), depth + 1);
          if (resolverError || hasCycle || depthExceeded || emptyCombo || invalidComboChild || invalidJudge) return;
        }
      } finally {
        activeStack.delete(cleanModel);
      }
      return;
    }

    // Single model or alias (unqualified)
    let info = null;
    try {
      info = await getInfo(cleanModel);
    } catch (err) {
      resolverError = err;
      return;
    }

    if (!info?.provider) {
      // Could be an unresolvable model or bare name
      concreteTargets.push({ provider: null, model: info?.model || cleanModel, raw: cleanModel });
    } else {
      concreteTargets.push({ provider: info.provider, model: info.model, raw: cleanModel });
    }
  }

  await resolveTargets(modelStr, 0);

  if (resolverError) {
    return {
      allowed: false,
      reason: `Resolver failure while evaluating model '${modelStr}': ${resolverError.message}`,
      forbiddenModel: modelStr,
    };
  }

  if (invalidJudge) {
    return {
      allowed: false,
      reason: `Combo '${invalidJudge.combo}' has invalid non-string or empty judgeModel`,
      forbiddenModel: invalidJudge.combo,
    };
  }

  if (invalidComboChild) {
    return {
      allowed: false,
      reason: `Combo '${invalidComboChild.combo}' contains invalid, empty, or non-string child model: ${JSON.stringify(invalidComboChild.child)}`,
      forbiddenModel: invalidComboChild.combo,
    };
  }

  if (hasCycle) {
    return {
      allowed: false,
      reason: `Cyclic combo dependency detected involving '${cycleModel || modelStr}'`,
      forbiddenModel: cycleModel || modelStr,
    };
  }

  if (depthExceeded) {
    return {
      allowed: false,
      reason: `Combo recursion depth limit exceeded while evaluating model '${modelStr}'`,
      forbiddenModel: modelStr,
    };
  }

  if (emptyCombo) {
    return {
      allowed: false,
      reason: `Combo '${emptyComboName || modelStr}' has no models configured`,
      forbiddenModel: emptyComboName || modelStr,
    };
  }

  if (concreteTargets.length === 0) {
    // Unresolvable model target
    return {
      allowed: false,
      reason: `Model '${modelStr}' could not be resolved`,
      forbiddenModel: modelStr,
    };
  }

  for (const target of concreteTargets) {
    const isAllowed = isConcreteModelAllowed(target, policy);
    if (!isAllowed) {
      const displayTarget = target.provider ? `${target.provider}/${target.model}` : target.model;
      return {
        allowed: false,
        reason: target.raw !== modelStr
          ? `Model '${displayTarget}' in combo '${modelStr}' is not allowed by client key policy`
          : `Model '${displayTarget}' is not allowed by client key policy`,
        forbiddenModel: displayTarget,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter an array of models based on client key permissions.
 */
export async function filterModelsForClientKey(modelsList, clientKeyData, options = {}) {
  if (!Array.isArray(modelsList) || modelsList.length === 0) return [];
  if (!clientKeyData || clientKeyData.model_allowlist === undefined) return modelsList;

  const policy = parseModelAllowlist(clientKeyData.model_allowlist);
  if (policy.unrestricted) return modelsList;
  if (policy.malformed) return []; // Fail closed

  const filtered = [];
  for (const item of modelsList) {
    const rawId = typeof item === "string" ? item : (item && typeof item === "object" ? (item.id || item.name) : null);
    if (typeof rawId !== "string" || !rawId.trim()) {
      continue;
    }
    const cleanId = rawId.trim().replace(/^models\//, "");
    const check = await checkClientKeyModelAccess(clientKeyData, cleanId, options);
    if (check.allowed) {
      filtered.push(item);
    }
  }

  return filtered;
}
