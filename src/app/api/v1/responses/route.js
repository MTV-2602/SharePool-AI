import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { extractBearerToken, isClientKeyToken, validateClientKey, wrapResponseWithClientKeyLogging } from "@/lib/auth/clientKeyAuth.js";

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
  if (isClientKeyToken(token)) {
    const authResult = await validateClientKey(token);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error } }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    request._clientKeyValidated = true;
    request._clientKeyData = authResult.keyData;

    let model = "unknown";
    let reqBody = null;
    try {
      reqBody = await request.json();
      request._parsedBody = reqBody;
      model = reqBody.model || model;
    } catch {}

    const response = await handleChat(request);
    return await wrapResponseWithClientKeyLogging(response, authResult.keyData.id, model, reqBody);
  }

  return await handleChat(request);
}
