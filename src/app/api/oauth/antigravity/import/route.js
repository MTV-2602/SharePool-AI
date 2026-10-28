import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { ANTIGRAVITY_CONFIG, getOAuthClientMetadata } from "@/lib/oauth/constants/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/antigravity/import
 * Imports or updates an Antigravity Google OAuth account directly into SQLite.
 * Compatible with antigravity_listener.bat and antigravity_listener.ps1.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    let { code, refreshToken, accessToken, email, projectId, expiresIn, scope, redirectUri } = body;

    // 1. If authorization code is provided, exchange it for tokens
    if (code) {
      const tokenUri = redirectUri || "http://localhost:1455/auth/callback";
      const tokenRes = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ANTIGRAVITY_CONFIG.clientId,
          client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          code: code,
          redirect_uri: tokenUri,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return NextResponse.json({ error: `Token exchange failed: ${errText}` }, { status: 400 });
      }

      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token || refreshToken;
      expiresIn = tokenData.expires_in;
      scope = tokenData.scope || scope;
    }

    if (!refreshToken) {
      return NextResponse.json({ error: "refreshToken or code is required" }, { status: 400 });
    }

    // 2. Validate/refresh access token if needed
    if (!accessToken) {
      const refreshRes = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: ANTIGRAVITY_CONFIG.clientId,
          client_secret: ANTIGRAVITY_CONFIG.clientSecret,
          refresh_token: refreshToken,
        }),
      });

      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        return NextResponse.json({ error: `Refresh token validation failed: ${errText}` }, { status: 400 });
      }

      const refreshed = await refreshRes.json();
      accessToken = refreshed.access_token;
      expiresIn = refreshed.expires_in || expiresIn || 3599;
      scope = refreshed.scope || scope;
    }

    // 3. Resolve user email from Google userInfo if not provided
    if (!email && accessToken) {
      try {
        const userRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const uInfo = await userRes.json();
          if (uInfo.email) email = uInfo.email;
        }
      } catch (e) {
        console.warn("[AG-IMPORT] Failed to fetch userInfo:", e.message);
      }
    }

    if (!email) {
      email = "antigravity-user";
    }

    // 4. Resolve Code Assist Project ID if not provided
    let tierId = "legacy-tier";
    if (!projectId && accessToken) {
      try {
        const loadHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
          "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
          "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
          "x-request-source": "local",
        };
        const metadata = getOAuthClientMetadata();
        const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
          method: "POST",
          headers: loadHeaders,
          body: JSON.stringify({ metadata }),
        });
        if (loadRes.ok) {
          const loadData = await loadRes.json();
          projectId = loadData.cloudaicompanionProject?.id || loadData.cloudaicompanionProject || "";
          if (Array.isArray(loadData.allowedTiers)) {
            for (const tier of loadData.allowedTiers) {
              if (tier.isDefault && tier.id) {
                tierId = tier.id.trim();
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn("[AG-IMPORT] Failed to load code assist project:", e.message);
      }
    }

    if (!projectId) {
      projectId = "aicode-consumers";
    }

    // 5. Fire-and-forget onboarding user if project ID found
    if (projectId && accessToken) {
      const doOnboard = async () => {
        try {
          const loadHeaders = {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent,
            "X-Goog-Api-Client": ANTIGRAVITY_CONFIG.loadCodeAssistApiClient,
            "Client-Metadata": ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata,
            "x-request-source": "local",
          };
          const metadata = getOAuthClientMetadata();
          await fetch(ANTIGRAVITY_CONFIG.onboardUserEndpoint, {
            method: "POST",
            headers: loadHeaders,
            body: JSON.stringify({ tierId, metadata }),
          });
        } catch (_) {}
      };
      doOnboard().catch(() => {});
    }

    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : new Date(Date.now() + 3599 * 1000).toISOString();

    // 6. Save directly into SQLite via model repo
    const connection = await createProviderConnection({
      provider: "antigravity",
      authType: "oauth",
      accessToken,
      refreshToken,
      expiresAt,
      expiresIn: expiresIn || 3599,
      projectId,
      scope: scope || "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cloud-platform openid",
      name: email,
      email: email,
      priority: 1,
      testStatus: "active",
      lastRefreshAt: new Date().toISOString(),
    });

    console.log(`[AG-IMPORT] Successfully imported Antigravity account: ${email} (${connection.id}) into SQLite`);

    return NextResponse.json({
      success: true,
      message: `Account ${email} imported successfully into 9Router SQLite!`,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
        projectId: connection.projectId,
      },
    });
  } catch (err) {
    console.error("[AG-IMPORT] Error importing Antigravity account:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
