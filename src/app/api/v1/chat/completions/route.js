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
    request._clientKeyValidated = true;
    
    // Parse the body ONCE and pass via request._parsedBody to avoid 2x RAM spike on 400k-token requests
    let model = "unknown";
    let approxPromptTokens = 1000;
    try {
      const contentLen = Number(request.headers.get("content-length")) || 0;
      const reqBody = await request.json();
      request._parsedBody = reqBody;
      model = reqBody.model || model;
      approxPromptTokens = contentLen > 0 ? Math.ceil(contentLen / 4) : 1000;
    } catch (e) {}

    const response = await handleChat(request);
    return await wrapResponseWithClientKeyLogging(response, authResult.keyData.id, model, approxPromptTokens);
  }

  // Fallback to local handling (developer sk- key or other credentials)
  return await handleChat(request);
}

