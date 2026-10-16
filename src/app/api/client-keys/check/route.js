export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseModelAllowlist } from '@/lib/auth/clientModelPolicy.js';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

function jsonResponse(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Định dạng yêu cầu không hợp lệ. Phải gửi dữ liệu JSON.' }, 400);
    }

    const { key } = body || {};
    if (!key || typeof key !== 'string') {
      return jsonResponse({ error: 'Vui lòng cung cấp mã API Key để tra cứu.' }, 400);
    }

    const trimmedKey = key.trim();
    if (!trimmedKey.startsWith('ck-') && !trimmedKey.startsWith('sk-')) {
      return jsonResponse({ error: 'Mã API Key không đúng định dạng (phải bắt đầu bằng ck- hoặc sk-).' }, 400);
    }

    // Query key from client_keys table, projecting model_allowlist and user-facing fields
    const { data: keyData, error } = await supabase
      .from('client_keys')
      .select('id, key, label, quota_tokens, used_tokens, active, expires_at, max_concurrent, rate_limit_per_minute, created_at, model_allowlist')
      .eq('key', trimmedKey)
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: 'Lỗi truy vấn cơ sở dữ liệu: ' + error.message }, 500);
    }

    if (!keyData) {
      return jsonResponse({ error: 'Mã API Key không tồn tại trong hệ thống. Vui lòng kiểm tra lại.' }, 404);
    }

    // Check if key is active
    if (keyData.active === false) {
      return jsonResponse({
        error: 'Mã API Key này đã bị vô hiệu hóa bởi quản trị viên.',
        keyData: {
          label: keyData.label,
          active: false,
          quota_tokens: keyData.quota_tokens,
          used_tokens: keyData.used_tokens,
        },
      }, 403);
    }

    // Check expiration
    const isExpired = keyData.expires_at && new Date(keyData.expires_at) < new Date();
    if (isExpired) {
      return jsonResponse({
        error: 'Mã API Key này đã hết hạn sử dụng.',
        keyData: {
          label: keyData.label,
          active: true,
          isExpired: true,
          expires_at: keyData.expires_at,
          quota_tokens: keyData.quota_tokens,
          used_tokens: keyData.used_tokens,
        },
      }, 403);
    }

    // Check if quota exceeded (allow 0 as infinite)
    const isQuotaExceeded = keyData.quota_tokens > 0 && keyData.used_tokens >= keyData.quota_tokens;

    // Derive sanitized normalized policy from token-matched database row, not client-supplied
    const modelPolicy = parseModelAllowlist(keyData.model_allowlist);

    return jsonResponse({
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
        created_at: keyData.created_at,
        model_allowlist: keyData.model_allowlist ?? null,
        model_policy: modelPolicy,
      },
    });
  } catch (err) {
    return jsonResponse({ error: 'Đã xảy ra lỗi hệ thống: ' + err.message }, 500);
  }
}
