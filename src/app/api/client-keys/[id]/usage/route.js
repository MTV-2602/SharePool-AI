export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyDashboardAuthToken } from '@/lib/auth/dashboardSession';
import { getSettings } from '@/lib/localDb';
import { extractBearerToken } from '@/lib/auth/clientKeyAuth';
import { getClientKeyById, getClientKeyByToken, getClientKeyUsageLogs, getClientKeyUsageSummary } from '@/lib/db/repos/clientKeysRepo.js';

// GET: Get usage logs for a specific client key
export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100');

  // 1. Authenticate check: Admin or client key owner
  let isAuthorized = false;

  // Check Admin auth first
  try {
    const settings = await getSettings();
    if (settings.requireLogin === false) {
      isAuthorized = true;
    } else {
      const cookieStore = await cookies();
      const token = cookieStore.get("auth_token")?.value;
      if (token && await verifyDashboardAuthToken(token)) {
        isAuthorized = true;
      }
    }
  } catch (err) {
    console.error("[Usage API] Admin auth check failed:", err);
  }

  // If not authorized as admin, verify client key
  if (!isAuthorized) {
    const clientKey = extractBearerToken(request);
    if (clientKey) {
      const keyData = await getClientKeyByToken(clientKey, { includeInactive: false });
      if (keyData) {
        const isExpired = keyData.expires_at && new Date(keyData.expires_at) < new Date();
        if (keyData.id === id && keyData.active !== false && !isExpired) {
          isAuthorized = true;
        }
      }
    }
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized. Yêu cầu không được phép truy cập.' }, { status: 401 });
  }

  const includeSummary = searchParams.get('include_summary') === 'true';

  try {
    const logs = await getClientKeyUsageLogs(id, limit);

    if (includeSummary) {
      const summary = await getClientKeyUsageSummary(id);
      return NextResponse.json({ logs, summary });
    }

    return NextResponse.json(logs);
  } catch (err) {
    console.error("[Usage API] Failed to fetch usage logs:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
