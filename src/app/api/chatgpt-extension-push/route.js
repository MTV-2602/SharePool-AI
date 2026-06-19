import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/chatgpt-extension-push
// Lưu thông tin đăng nhập (email/password/OTP) vào kho acc chatgpt_credentials.
// MỤC ĐÍCH: Khi acc lỗi → vào kho lấy thông tin để đăng nhập lại.
// KHÔNG lưu session token / OAuth token vào đây.
// OAuth pool được xử lý riêng tại /api/chatgpt-oauth-callback.
export async function POST(request) {
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

    const body = await request.json();
    const { username, password, otpSecret, source } = body;

    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    if (!password || !password.trim()) {
      return NextResponse.json({ error: "password is required for kho acc push" }, { status: 400 });
    }

    const email = username.trim();

    // Upsert vào kho acc — dùng để đăng nhập lại khi acc bị lỗi
    const { data: existing } = await supabase
      .from("chatgpt_credentials")
      .select("id")
      .eq("email", email)
      .limit(1);

    if (existing && existing.length > 0) {
      const { error: updateErr } = await supabase
        .from("chatgpt_credentials")
        .update({
          password: password.trim(),
          otp_secret: otpSecret || "",
          source: source || "AutoRegUnified",
          status: "active",
          reserved_at: null,
          reserved_by_ip: null,
        })
        .eq("email", email);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase
        .from("chatgpt_credentials")
        .insert({
          email,
          password: password.trim(),
          otp_secret: otpSecret || "",
          source: source || "AutoRegUnified",
          status: "active",
          reserved_at: null,
          reserved_by_ip: null,
        });
      if (insertErr) throw insertErr;
    }

    return NextResponse.json({
      ok: true,
      message: `Đã lưu thông tin đăng nhập cho '${email}' vào kho acc.`,
      email,
    });
  } catch (err) {
    console.error("chatgpt-extension-push error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
