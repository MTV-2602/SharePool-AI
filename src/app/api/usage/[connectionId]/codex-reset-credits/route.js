import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

const AUTH_EXPIRED_PATTERNS = ["token_expired", "invalid_token", "unauthorized", "re-authenticate", "401"];

function isAuthExpiredResult(result) {
  if (!result) return false;
  const values = [result.code, result.message, String(result.status || "")].filter(Boolean).map((v) => String(v).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function isAuthExpiredError(error) {
  return isAuthExpiredResult({ message: error?.message });
}

function getResponseForConsumeResult(result, redeemRequestId) {
  if (result.ok) {
    return Response.json({
      success: true,
      code: result.code,
      windowsReset: result.windowsReset,
      redeemRequestId,
      message: result.message || "Reset credit consumed successfully.",
      raw: result.raw,
    });
  }

  if (result.noCredit) {
    return Response.json({
      success: false,
      code: "no_credit",
      message: result.message || "No reset credits available.",
      raw: result.raw,
    }, { status: 409 });
  }

  return Response.json({
    error: result.message || "Failed to consume reset credit.",
    code: result.code,
    raw: result.raw,
  }, { status: result.status >= 400 && result.status < 500 ? result.status : 502 });
}

async function getCodexConnection(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return { response: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }

  if (connection.provider !== "codex") {
    return { response: Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 }) };
  }

  const isOAuth = connection.authType === "oauth";
  const isAccessToken = connection.authType === "access_token";
  if (!isOAuth && !isAccessToken) {
    return { response: Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 }) };
  }

  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  return { connection, isOAuth, proxyOptions };
}

async function refreshCodexConnection(connection, proxyOptions) {
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    return { connection: result.connection };
  } catch (refreshError) {
    console.error("[Codex Reset Credits API] Credential refresh failed:", refreshError);
    return { response: Response.json({ error: `Credential refresh failed: ${refreshError.message}` }, { status: 401 }) };
  }
}

export async function GET(_request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    let result;
    try {
      result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    } catch (fetchError) {
      if (!isOAuth || !connection.refreshToken || !isAuthExpiredError(fetchError)) throw fetchError;
      const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
      connection = retryResult.connection;
      result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    }

    return Response.json(result);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    // Server-generated redeem id prevents client-controlled replay
    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);

    if (isOAuth && isAuthExpiredResult(consumeResult) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);
      } catch (retryError) {
        console.warn(`[Codex Reset Credits] force refresh failed: ${retryError.message}`);
      }
    }

    return getResponseForConsumeResult(consumeResult, redeemRequestId);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
