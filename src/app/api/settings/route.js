import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import {
  isValidPayloadLimit,
  publishPayloadLimit,
  getPayloadLimitMetadata,
  PAYLOAD_LIMIT_SETTING_KEY,
} from "@/lib/settings/chatPayloadLimit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

export async function GET() {
  try {
    const settings = await getSettings();
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    safeSettings.payloadLimit = getPayloadLimitMetadata(settings);

    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    // Reject spoofing computed metadata write
    if (Object.prototype.hasOwnProperty.call(body, "payloadLimit")) {
      return NextResponse.json(
        { error: "Cannot write computed metadata 'payloadLimit'" },
        { status: 400 }
      );
    }

    // Guard payload limit field modifications before password work or persistence
    // Requires verified dashboard auth_token cookie even if requireLogin=false
    if (Object.prototype.hasOwnProperty.call(body, PAYLOAD_LIMIT_SETTING_KEY)) {
      const cookieStore = await cookies();
      const token = cookieStore.get("auth_token")?.value;
      if (!token || !(await verifyDashboardAuthToken(token))) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const val = body[PAYLOAD_LIMIT_SETTING_KEY];
      if (!isValidPayloadLimit(val)) {
        return NextResponse.json(
          {
            error: "Invalid chatCompletionsMaxBodyBytes: must be a safe integer between 1048576 (1MiB) and 33554432 (32MiB), or null to inherit",
          },
          { status: 400 }
        );
      }
    }

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    // Publish to bounded cache only after persistence success
    if (Object.prototype.hasOwnProperty.call(body, PAYLOAD_LIMIT_SETTING_KEY)) {
      publishPayloadLimit(settings[PAYLOAD_LIMIT_SETTING_KEY]);
    }

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    safeSettings.payloadLimit = getPayloadLimitMetadata(settings);
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
