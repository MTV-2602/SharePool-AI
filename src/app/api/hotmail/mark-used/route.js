import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
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
    const email = String(body?.email || '').trim().toLowerCase();
    const note = String(body?.note || '').slice(0, 200);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const now = new Date().toISOString();

    if (!email) {
      return NextResponse.json({ error: 'Thiếu email Hotmail.' }, { status: 400 });
    }

    // First fetch the account to get the current usage_count
    const { data: accounts } = await supabase
      .from('hotmail_accounts')
      .select('id, usage_count')
      .eq('email', email)
      .limit(1);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ error: `Không tìm thấy tài khoản Hotmail ${email}.` }, { status: 404 });
    }

    const account = accounts[0];
    const newCount = (account.usage_count || 0) + 1;

    const { data, error } = await supabase
      .from('hotmail_accounts')
      .update({
        status: 'used',
        last_used_at: now,
        reserved_by_ip: ip,
        takenat: now,
        takennote: note || `Đã dùng lúc ${now}`,
        usage_count: newCount
      })
      .eq('id', account.id)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email, state: 'used', usedCount: newCount });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
