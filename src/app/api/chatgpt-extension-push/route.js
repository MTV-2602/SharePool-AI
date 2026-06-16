import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

// POST /api/chatgpt-extension-push
// Save newly registered ChatGPT credentials into `chatgpt_credentials`
// and optionally save/update session tokens in the provider connections pool.
export async function POST(request) {
  try {
    // 1. Extension Push Token check
    const extensionToken = request.headers.get("x-extension-push-token") || request.headers.get("x-extension-token");
    const configuredToken = process.env.EXTENSION_PUSH_TOKEN || "admin123";
    if (configuredToken && extensionToken !== configuredToken) {
      const adminKey = request.headers.get("x-admin-key") || "";
      const configuredAdminKey = process.env.ADMIN_KEY || "admin123";
      if (adminKey !== configuredAdminKey) {
        return NextResponse.json({ error: "Unauthorized extension token" }, { status: 403 });
      }
    }

    const body = await request.json();
    const { username, password, otpSecret, sessionToken, deviceId, source } = body;

    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    let savedToken = false;
    let savedCred = false;

    // CASE 1: Save session token to provider pool if present
    if (sessionToken && sessionToken.trim()) {
      const tokenClean = sessionToken.trim();
      const nameClean = username.trim();
      
      let tokenToSave = tokenClean;
      if (deviceId) {
        try {
          if (tokenClean.startsWith("{")) {
            const obj = JSON.parse(tokenClean);
            obj.deviceId = deviceId;
            tokenToSave = JSON.stringify(obj);
          } else {
            tokenToSave = JSON.stringify({
              accessToken: tokenClean,
              deviceId: deviceId
            });
          }
        } catch (_) {}
      }

      // Check if this is a JWT or JSON wrapper containing accessToken and refreshToken
      let accessToken = tokenToSave;
      let refreshToken = null;
      try {
        if (tokenToSave.startsWith("{")) {
          const parsed = JSON.parse(tokenToSave);
          accessToken = parsed.accessToken || accessToken;
          refreshToken = parsed.refreshToken || null;
        }
      } catch (_) {}

      // Backfill info from JWT
      let email = nameClean;
      let providerSpecificData = { authMethod: "access_token" };
      if (deviceId) {
        providerSpecificData.deviceId = deviceId;
      }
      try {
        const info = extractCodexAccountInfo(accessToken) || {};
        if (info.email) email = info.email;
        if (info.chatgptAccountId) providerSpecificData.chatgptAccountId = info.chatgptAccountId;
        if (info.chatgptPlanType) providerSpecificData.chatgptPlanType = info.chatgptPlanType;
      } catch (_) {}

      await createProviderConnection({
        provider: "codex",
        authType: refreshToken ? "oauth" : "access_token",
        accessToken,
        refreshToken,
        email,
        name: nameClean,
        providerSpecificData,
        testStatus: "active",
      });
      savedToken = true;
    }

    // CASE 2: Save credentials into chatgpt_credentials table
    if (password && password.trim()) {
      const email = username.trim();
      
      // Check if credentials already exist
      const { data: existing } = await supabase
        .from("chatgpt_credentials")
        .select("*")
        .eq("email", email)
        .limit(1);

      if (existing && existing.length > 0) {
        const { error: updateErr } = await supabase
          .from("chatgpt_credentials")
          .update({
            password: password.trim(),
            otp_secret: otpSecret || "",
            source: source || "AutoRegUnified",
            status: "active",
          })
          .eq("email", email);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("chatgpt_credentials")
          .insert({
            email,
            password: password.trim(),
            otp_secret: otpSecret || "",
            source: source || "AutoRegUnified",
            status: "active",
          });
        if (insertErr) throw insertErr;
      }
      savedCred = true;
    }

    if (savedToken || savedCred) {
      let msg = "";
      if (savedToken && savedCred) {
        msg = `Credentials and session token for '${username}' saved successfully`;
      } else if (savedToken) {
        msg = `Account '${username}' session token added to pool`;
      } else {
        msg = `Credentials for '${username}' saved to database`;
      }
      return NextResponse.json({
        ok: true,
        message: msg,
        email: username
      });
    }

    return NextResponse.json({ error: "sessionToken or password is required" }, { status: 400 });
  } catch (err) {
    console.error("chatgpt-extension-push error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
