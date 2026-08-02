import { NextResponse } from "next/server";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return "disabled-on-edge";
  }
  const machineIdModule = "@/shared/utils/machineId";
  const { getConsistentMachineId } = await import(machineIdModule);
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/version",
  "/api/settings/require-login",
  "/api/chatgpt-extension-push",
  "/api/chatgpt-oauth-callback",
  "/api/accounts/expired",
  "/api/hotmail/new",
  "/api/hotmail/release",
  "/api/hotmail/mark-used",
  "/api/hotmail/read",
  "/api/oauth/codex/init",
  "/api/telegram/webhook",
  "/api/telegram/setup",
  "/api/telegram-webhook",
  "/api/client-keys/check",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
];

// Require auth, but allow through if requireLogin is disabled
const PROTECTED_API_PATHS = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
];

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(h) {
  if (!h) return false;
  const name = h.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}

export function isLocalRequest(request) {
  // Trusted peer IP from TCP socket (custom-server.js); unspoofable. Primary anchor for "local".
  const realIp = request.headers.get("x-9r-real-ip");
  if (realIp) {
    if (!isLoopbackHostname(realIp)) return false;
  } else if (!isLoopbackHostname(request.headers.get("host"))) {
    // Fallback for bare server.js (dev) without custom-server: legacy Host-based check.
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = (request.headers.get("authorization") || request.headers.get("Authorization") || "").trim();
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader.startsWith("sk-") || authHeader.startsWith("ck-")) {
    return authHeader;
  }

  const googKey = request.headers.get("x-goog-api-key") || request.headers.get("X-Goog-Api-Key");
  if (googKey) return googKey.trim();

  const xApiKey = request.headers.get("x-api-key") || request.headers.get("X-Api-Key");
  if (xApiKey) return xApiKey.trim();

  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    if (keyParam) return keyParam.trim();
  } catch (e) {}

  return null;
}

async function validateApiKeyDirect(key) {
  if (process.env.NEXT_RUNTIME === "edge") {
    const { supabase } = await import("@/lib/supabase");
    if (!supabase) return false;
    const { data, error } = await supabase
      .from('api_keys')
      .select('is_active')
      .eq('key', key)
      .limit(1);
    if (error || !data || data.length === 0) return false;
    return data[0].is_active === true || data[0].is_active === 1;
  } else {
    const { validateApiKey } = await import("@/lib/localDb");
    return await validateApiKey(key);
  }
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKeyDirect(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return { authorized: true };
  if (await hasValidCliToken(request)) return { authorized: true };

  const apiKey = extractApiKey(request);
  if (!apiKey) return { authorized: false, error: "API key required for remote API access" };

  try {
    const isValidAdmin = await validateApiKeyDirect(apiKey);
    if (isValidAdmin) return { authorized: true };
  } catch (err) {
    console.error("[Guard] Admin key validation failed:", err);
  }

  try {
    const { validateClientKey } = await import("@/lib/auth/clientKeyAuth.js");
    const clientResult = await validateClientKey(apiKey);
    if (clientResult.valid) return { authorized: true };
    return { authorized: false, error: clientResult.error || "Invalid client key" };
  } catch (err) {
    console.error("[Guard] Failed to validate client key:", err);
    return { authorized: false, error: `Client key validation error: ${err.message}` };
  }
}

async function canAccessLocalOnlyRoute(request) {
  if (await hasValidCliToken(request)) return true;
  // Browser on host: loopback Host + Origin (blocks tunnel/CSRF) + auth (JWT or requireLogin=false)
  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    if (process.env.NEXT_RUNTIME === "edge") {
      const { supabase } = await import("@/lib/supabase");
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('settings')
        .select('data')
        .eq('id', 1)
        .maybeSingle();
      if (error || !data) return null;
      const raw = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      return raw;
    } else {
      const { getSettings } = await import("@/lib/localDb");
      return await getSettings();
    }
  } catch (err) {
    console.error("[Guard] Failed to load settings:", err);
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  if (pathname.match(/^\/api\/client-keys\/[^/]+\/usage$/)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or local CLI token (machineId-based)
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasValidCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    const authResult = await canAccessPublicLlmApi(request);
    if (authResult.authorized) return NextResponse.next();
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasValidCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get("auth_token")?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
