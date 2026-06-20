import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { extractBearerToken, validateClientKey, wrapResponseWithClientKeyLogging } from "@/lib/auth/clientKeyAuth.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses/compact - Compact conversation context
 * Reuses the same handleChat pipeline, signals compact via body._compact
 */
export async function POST(request) {
  await ensureInitialized();
  
  const token = extractBearerToken(request);
  const isClientKey = token && (token.startsWith("ck-") || (token.startsWith("sk-") && token.split("-").length === 2));
  let authResult = null;
  if (isClientKey) {
    authResult = await validateClientKey(token);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error } }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }

  const body = await request.json();
  body._compact = true;
  const newRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body)
  });
  
  const response = await handleChat(newRequest);
  
  if (isClientKey && authResult) {
    return await wrapResponseWithClientKeyLogging(response, authResult.keyData.id, body.model || "unknown", body);
  }
  return response;
}
