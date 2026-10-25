export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyDashboardAuthToken } from '@/lib/auth/dashboardSession';
import { getSettings } from '@/lib/localDb';
import { getAdapter } from '@/lib/db/driver';

export async function POST(request) {
  // 1. Authenticate check: Admin only
  let isAuthorized = false;
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
    console.error("[Cleanup API] Admin auth check failed:", err);
  }

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized. Yêu cầu không được phép truy cập.' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    const intervalStr = `-${days} days`;

    const db = await getAdapter();
    
    // Prune client_key_usage_logs
    try {
      db.run("DELETE FROM client_key_usage_logs WHERE datetime(created_at) < datetime('now', ?)", [intervalStr]);
    } catch (e) {
      console.warn("[Cleanup API] client_key_usage_logs prune warning:", e.message);
    }

    // Prune request_details
    try {
      db.run("DELETE FROM request_details WHERE datetime(timestamp) < datetime('now', ?)", [intervalStr]);
    } catch (e) {
      console.warn("[Cleanup API] request_details prune warning:", e.message);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully pruned records older than ${days} days.`,
      days
    });
  } catch (err) {
    console.error("[Cleanup API] Unexpected error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
