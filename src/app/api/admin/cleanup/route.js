export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { verifyDashboardAuthToken } from '@/lib/auth/dashboardSession';
import { getSettings } from '@/lib/localDb';

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
    
    // Prune client_key_usage_logs
    const { data: logsPruned, error: logsError } = await supabase.rpc('exec_sql', {
      query_text: `DELETE FROM client_key_usage_logs WHERE created_at < NOW() - CAST($1 AS interval)`,
      query_params: [`${days} days`]
    });

    if (logsError) {
      console.error("[Cleanup API] Failed to prune client_key_usage_logs:", logsError);
      return NextResponse.json({ error: `Prune usage logs failed: ${logsError.message}` }, { status: 500 });
    }

    // Prune request_details
    const { data: reqsPruned, error: reqsError } = await supabase.rpc('exec_sql', {
      query_text: `DELETE FROM request_details WHERE timestamp < NOW() - CAST($1 AS interval)`,
      query_params: [`${days} days`]
    });

    if (reqsError) {
      console.error("[Cleanup API] Failed to prune request_details:", reqsError);
      return NextResponse.json({ error: `Prune request details failed: ${reqsError.message}` }, { status: 500 });
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