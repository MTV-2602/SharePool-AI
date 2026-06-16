import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function buildFormattedLine(acc) {
  const email = acc.email;
  const password = acc.password || '';
  const refresh = acc.refresh_token || '';
  const client = acc.client_id || '';
  const secret = acc.totp_secret || '';
  if (secret) {
    return `${email}|${password}|${refresh}|${client}|${secret}`;
  }
  return `${email}|${password}|${refresh}|${client}`;
}

export async function GET(request) {
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

    const { searchParams } = new URL(request.url);
    const note = searchParams.get('note') || `Lấy lúc ${new Date().toISOString()}`;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const now = new Date().toISOString();

    // Reserve next available account atomically using RPC
    const { data: reservedAccounts, error: rpcError } = await supabase
      .rpc('reserve_hotmail_account', {
        ip: ip,
        note: note
      });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    if (!reservedAccounts || reservedAccounts.length === 0) {
      return NextResponse.json({ error: 'Hết tài khoản trống trong kho Hotmail.' }, { status: 404 });
    }

    const account = reservedAccounts[0];

    return NextResponse.json({
      ok: true,
      account: account,
      formatted: buildFormattedLine(account)
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
