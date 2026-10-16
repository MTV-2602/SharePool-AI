import { buildModelsList } from "../route.js";
import { extractBearerToken, validateClientKey } from "@/lib/auth/clientKeyAuth.js";
import { filterModelsForClientKey } from "@/lib/auth/clientModelGate.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  "image": ["image"],
  "tts": ["tts"],
  "stt": ["stt"],
  "embedding": ["embedding"],
  "image-to-text": ["imageToText"],
  "web": ["webSearch", "webFetch"],
};

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models/{kind} - OpenAI-compatible models list filtered by capability.
 * Supported kinds: image, tts, stt, embedding, image-to-text, web.
 */
export async function GET(request, { params }) {
  try {
    const { kind } = await params;
    const kindFilter = KIND_SLUG_MAP[kind];

    if (!kindFilter) {
      return Response.json(
        {
          error: {
            message: `Unknown model kind: ${kind}. Supported: ${Object.keys(KIND_SLUG_MAP).join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const data = await buildModelsList(kindFilter);
    let filteredData = data;

    const token = request ? extractBearerToken(request) : null;
    if (token) {
      const isClientKey = token.startsWith("ck-") || (token.startsWith("sk-") && token.split("-").length === 2);
      if (isClientKey) {
        const auth = await validateClientKey(token, { skipRateLimit: true });
        if (!auth.valid) {
          return Response.json(
            { error: { message: auth.error, type: "invalid_request_error" } },
            { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }
        if (auth.keyData) {
          filteredData = await filterModelsForClientKey(data, auth.keyData);
        }
      }
    }

    return Response.json({ object: "list", data: filteredData }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching models by kind:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
