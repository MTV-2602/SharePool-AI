import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { extractBearerToken, validateClientKey, wrapResponseWithClientKeyLogging } from "@/lib/auth/clientKeyAuth.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
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
 * POST /v1/messages - Claude format (auto convert via handleChat)
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
    let reqBody = null;
    try {
      const clonedReq = request.clone();
      reqBody = await clonedReq.json();
      model = reqBody.model || model;
    } catch (e) {}

    const response = await handleChat(request);
    return await wrapResponseWithClientKeyLogging(response, authResult.keyData.id, model, reqBody);
  }

  return await handleChat(request);
}
