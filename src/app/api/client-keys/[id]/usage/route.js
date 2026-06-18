import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { verifyDashboardAuthToken } from '@/lib/auth/dashboardSession';
import { getSettings } from '@/lib/localDb';
import { extractBearerToken } from '@/lib/auth/clientKeyAuth';

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
      const { data: keys, error: keyError } = await supabase
        .from('client_keys')
        .select('id, active, expires_at')
        .eq('key', clientKey)
        .limit(1);

      if (!keyError && keys?.length > 0) {
        const keyData = keys[0];
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

  const { data, error } = await supabase
    .from('client_key_usage_logs')
    .select('*')
    .eq('client_key_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

