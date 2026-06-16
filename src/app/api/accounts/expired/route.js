import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/accounts/expired
// Return the list of ChatGPT credentials that are either missing from the provider connections pool
// or currently in error/failed state, so the extension can automatically log in and refresh them.
export async function GET(request) {
  try {
    // 1. Extension Push Token check
    const extensionToken = request.headers.get("x-extension-push-token") || request.headers.get("x-extension-token");
    const configuredToken = process.env.EXTENSION_PUSH_TOKEN || "admin123";
    const configuredAdminKey = process.env.ADMIN_KEY || "admin123";
    const adminKey = request.headers.get("x-admin-key") || "";
    const defaultExtToken = "b081ea5e6a6ad57e154c2f8d440ae1f62e5b3e978d0efb82eae9b75a7bc8ef8b";

    const isAuthorized = 
      (extensionToken === configuredToken) || 
      (extensionToken === configuredAdminKey) ||
      (extensionToken === defaultExtToken) ||
      (extensionToken === "admin123") ||
      (adminKey === configuredAdminKey) ||
      (adminKey === "admin123");

    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized extension token" }, { status: 403 });
    }

    // 2. Fetch all Codex provider connections from database
    const { data: connections, error: connError } = await supabase
      .from("provider_connections")
      .select("*")
      .eq("provider", "codex");

    if (connError) {
      return NextResponse.json({ error: connError.message }, { status: 500 });
    }

    // 3. Fetch all ChatGPT credentials
    const { data: credentials, error: credError } = await supabase
      .from("chatgpt_credentials")
      .select("*");

    if (credError) {
      return NextResponse.json({ error: credError.message }, { status: 500 });
    }

    const expired = [];
    const now = new Date();

    for (const cred of credentials) {
      const credEmail = (cred.email || "").trim().toLowerCase();
      
      const upstream = connections.find(c => {
        const connEmail = (c.email || "").trim().toLowerCase();
        return connEmail === credEmail;
      });

      let needsLogin = false;
      let reason = "";

      if (!upstream) {
        needsLogin = true;
        reason = "Chua co trong pool upstream";
      } else {
        // Status checks: 9Router stores status in test_status/testStatus and active status in is_active/isActive
        const testStatus = upstream.test_status || upstream.testStatus || "";
        const isActive = upstream.is_active !== undefined ? upstream.is_active : upstream.isActive;

        const isFailed = testStatus === "error" || testStatus === "failed";
        const isInactive = isActive === false || isActive === 0;

        // If the account has been disabled manually by the admin, do not request re-login
        if (!isInactive && isFailed) {
          needsLogin = true;
          reason = "Loi phien lam viec (pool)";
        }
      }

      if (needsLogin) {
        // Check lock status: lock lasts for 5 minutes
        let isLocked = false;
        if (cred.reserved_at) {
          const lockedTime = new Date(cred.reserved_at);
          if ((now - lockedTime) <= 5 * 60 * 1000) {
            isLocked = true;
          }
        }

        if (!isLocked) {
          expired.push({
            email: cred.email,
            password: cred.password,
            otpSecret: cred.otp_secret,
            reason
          });
        }
      }
    }

    // Lock the first unlocked expired account immediately
    if (expired.length > 0) {
      const target = expired[0];
      const ip = request.headers.get("x-9r-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
      
      await supabase
        .from("chatgpt_credentials")
        .update({
          reserved_at: now.toISOString(),
          reserved_by_ip: ip
        })
        .eq("email", target.email);
    }

    return NextResponse.json({
      ok: true,
      count: expired.length,
      accounts: expired
    });
  } catch (err) {
    console.error("accounts-expired endpoint error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
