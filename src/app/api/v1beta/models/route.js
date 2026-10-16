import { PROVIDER_MODELS } from "@/shared/constants/models";
import { extractBearerToken, validateClientKey } from "@/lib/auth/clientKeyAuth.js";
import { filterModelsForClientKey } from "@/lib/auth/clientModelGate.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1beta/models - Gemini compatible models list
 * Returns models in Gemini API format
 */
export async function GET(request) {
  try {
    // Collect all models from all providers
    const models = [];
    
    for (const [provider, providerModels] of Object.entries(PROVIDER_MODELS)) {
      for (const model of providerModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name || model.id,
          description: `${provider} model: ${model.name || model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    let filteredModels = models;
    const token = request ? extractBearerToken(request) : null;
    if (token) {
      const isClientKey = token.startsWith("ck-") || (token.startsWith("sk-") && token.split("-").length === 2);
      if (isClientKey) {
        const auth = await validateClientKey(token, { skipRateLimit: true });
        if (!auth.valid) {
          return Response.json(
            { error: { message: auth.error, code: 401 } },
            { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }
        if (auth.keyData) {
          filteredModels = await filterModelsForClientKey(models, auth.keyData);
        }
      }
    }

    return Response.json({ models: filteredModels }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message } },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}

