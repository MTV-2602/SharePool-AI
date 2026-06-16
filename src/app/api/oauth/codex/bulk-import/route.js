import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/oauth/codex/bulk-import
 * Bulk import multiple codex (OAuth) account JSON objects or raw lines in one call.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *   - Raw Text: "email1|token1\nemail2|token2"
 */
export async function POST(request) {
  let accounts = [];
  let rawBody = "";

  try {
    rawBody = await request.text();
    try {
      const parsed = JSON.parse(rawBody);
      // Normalize JSON to array
      if (Array.isArray(parsed)) {
        accounts = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.accounts)) {
        accounts = parsed.accounts;
      } else if (parsed && typeof parsed === "object") {
        accounts = [parsed];
      }
    } catch (_) {
      // It's raw text lines! Parse line-by-line (format: email|token or just token)
      const lines = rawBody.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        let token = '';
        let email = '';
        if (line.includes('|')) {
          const parts = line.split('|').map(p => p.trim());
          const foundToken = parts.find(p => p.startsWith('ey') || p.length > 80);
          if (foundToken) {
            token = foundToken;
            email = parts.find(p => p !== foundToken) || '';
          }
        } else if (line.startsWith('ey') || line.length > 80) {
          token = line;
        }

        if (token) {
          // Decode JWT token to get email if possible
          if (!email) {
            try {
              const parts = token.split('.');
              if (parts.length >= 2) {
                let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) base64 += '=';
                const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
                email = payload['https://api.openai.com/profile']?.email || payload.email || '';
              }
            } catch (_) {}
          }
          if (email) {
            accounts.push({
              email: email.toLowerCase().trim(),
              accessToken: token
            });
          }
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid input format: ${err.message}` },
      { status: 400 }
    );
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided or parsed" },
      { status: 400 }
    );
  }

  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      const {
        id: _id,
        provider: _provider,
        authType: _authType,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = raw;

      if (!item.accessToken || typeof item.accessToken !== "string") {
        throw new Error("Missing accessToken");
      }

      // Backfill missing identity fields from JWT claims
      const psd = item.providerSpecificData || {};
      const needsEmail = !item.email;
      const needsAccountId = !psd.chatgptAccountId;
      const needsPlanType = !psd.chatgptPlanType;

      if (needsEmail || needsAccountId || needsPlanType) {
        const info = extractCodexAccountInfo(item.idToken || item.accessToken) || {};
        if (needsEmail && info.email) item.email = info.email;
        if (needsAccountId && info.chatgptAccountId) {
          psd.chatgptAccountId = info.chatgptAccountId;
        }
        if (needsPlanType && info.chatgptPlanType) {
          psd.chatgptPlanType = info.chatgptPlanType;
        }
      }
      if (Object.keys(psd).length > 0) {
        item.providerSpecificData = psd;
      }

      if (!item.email) {
        throw new Error("Could not determine email address for connection");
      }

      const emailClean = item.email.toLowerCase().trim();

      // Compute expiresAt from expiresIn if absent
      if (!item.expiresAt && typeof item.expiresIn === "number" && item.expiresIn > 0) {
        item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
      }

      // Defaults aligned with OAuth-completed flow
      if (item.testStatus === undefined) item.testStatus = "active";
      if (item.isActive === undefined) item.isActive = true;
      if (!item.lastRefreshAt) item.lastRefreshAt = new Date().toISOString();

      // Enforce Hotmail account existence: if not exists, create with status available
      const { data: existingHotmail } = await supabase
        .from('hotmail_accounts')
        .select('id')
        .eq('email', emailClean)
        .limit(1);

      if (!existingHotmail || existingHotmail.length === 0) {
        await supabase
          .from('hotmail_accounts')
          .insert({
            email: emailClean,
            status: 'available',
            usage_count: 0
          });
      }

      const created = await createProviderConnection({
        provider: "codex",
        authType: "oauth",
        ...item,
        email: emailClean,
      });

      results.push({ index: i, ok: true, id: created.id });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
