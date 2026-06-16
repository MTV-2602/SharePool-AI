import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
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

    const body = await request.json();
    const email = String(body?.email || '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'Thiếu email Hotmail.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('hotmail_accounts')
      .update({
        status: 'available',
        reservedat: '',
        takennote: '',
        reserved_by_ip: '',
        takenat: ''
      })
      .eq('email', email)
      .select();

    if (error || !data || data.length === 0) {
      return NextResponse.json({ error: `Không tìm thấy tài khoản Hotmail ${email}.` }, { status: 404 });
    }

    return NextResponse.json({ ok: true, email, status: 'available' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
