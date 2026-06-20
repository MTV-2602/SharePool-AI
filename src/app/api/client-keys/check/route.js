export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Định dạng yêu cầu không hợp lệ. Phải gửi dữ liệu JSON.' }, { status: 400 });
    }

    const { key } = body;
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'Vui lòng cung cấp mã API Key để tra cứu.' }, { status: 400 });
    }

    const trimmedKey = key.trim();
    if (!trimmedKey.startsWith('ck-') && !trimmedKey.startsWith('sk-')) {
      return NextResponse.json({ error: 'Mã API Key không đúng định dạng (phải bắt đầu bằng ck- hoặc sk-).' }, { status: 400 });
    }

    // Query key from client_keys table, fetching only user-facing fields
    const { data: keyData, error } = await supabase
      .from('client_keys')
      .select('id, key, label, quota_tokens, used_tokens, active, expires_at, max_concurrent, rate_limit_per_minute, created_at')
      .eq('key', trimmedKey)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Lỗi truy vấn cơ sở dữ liệu: ' + error.message }, { status: 500 });
    }

    if (!keyData) {
      return NextResponse.json({ error: 'Mã API Key không tồn tại trong hệ thống. Vui lòng kiểm tra lại.' }, { status: 404 });
    }

    // Check if key is active
    if (keyData.active === false) {
      return NextResponse.json({
        error: 'Mã API Key này đã bị vô hiệu hóa bởi quản trị viên.',
        keyData: {
          label: keyData.label,
          active: false,
          quota_tokens: keyData.quota_tokens,
          used_tokens: keyData.used_tokens
        }
      }, { status: 403 });
    }

    // Check expiration
    const isExpired = keyData.expires_at && new Date(keyData.expires_at) < new Date();
    if (isExpired) {
      return NextResponse.json({
        error: 'Mã API Key này đã hết hạn sử dụng.',
        keyData: {
          label: keyData.label,
          active: true,
          isExpired: true,
          expires_at: keyData.expires_at,
          quota_tokens: keyData.quota_tokens,
          used_tokens: keyData.used_tokens
        }
      }, { status: 403 });
    }

    // Check if quota exceeded (allow 0 as infinite)
    const isQuotaExceeded = keyData.quota_tokens > 0 && keyData.used_tokens >= keyData.quota_tokens;

    return NextResponse.json({
      valid: true,
      isQuotaExceeded,
      keyData: {
        id: keyData.id,
        key: keyData.key,
        label: keyData.label,
        quota_tokens: keyData.quota_tokens,
        used_tokens: keyData.used_tokens,
        active: keyData.active,
        expires_at: keyData.expires_at,
        max_concurrent: keyData.max_concurrent,
        rate_limit_per_minute: keyData.rate_limit_per_minute,
        created_at: keyData.created_at
      }
    });

  } catch (err) {
    return NextResponse.json({ error: 'Đã xảy ra lỗi hệ thống: ' + err.message }, { status: 500 });
  }
}
