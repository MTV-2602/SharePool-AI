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
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request) {
  await ensureInitialized();
  
  const token = extractBearerToken(request);
  const isClientKey = token && (token.startsWith("ck-") || (token.startsWith("sk-") && token.split("-").length === 2));
  if (isClientKey) {
    const authResult = await validateClientKey(token);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error } }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    
    // Parse the body to extract the model (for logging fallback)
    let model = "unknown";
    try {
      const clonedReq = request.clone();
      const body = await clonedReq.json();
      model = body.model || model;
    } catch (e) {}

    const response = await handleChat(request);
    return await wrapResponseWithClientKeyLogging(response, authResult.keyData.id, model);
  }

  return await handleChat(request);
}
