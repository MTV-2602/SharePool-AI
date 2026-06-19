-- ═══════════════════════════════════════════════════════════════════
-- CodeX Portal — Supabase Security & RLS Migration
-- Run this in Supabase Dashboard → SQL Editor (New Query)
-- ═══════════════════════════════════════════════════════════════════

-- 1. Bật Row Level Security (RLS) cho tất cả các bảng công khai trong public schema
ALTER TABLE IF EXISTS public.hotmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.client_key_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.proxy_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chatgpt_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.antigravity_pending_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.request_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.upstream_accounts ENABLE ROW LEVEL SECURITY;

-- 2. Hạn chế quyền thực thi của hàm exec_sql RPC
-- Thu hồi quyền chạy hàm từ PUBLIC (tất cả mọi người), anon, và authenticated roles
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Chỉ cho phép service_role (và các admin/owner mặc định) thực thi hàm này
GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT, JSONB) TO service_role;

-- Hoàn tất thông báo
SELECT 'Bảo mật database hoàn tất: Đã bật RLS cho 22 bảng & hạn chế hàm exec_sql ✓' AS status;
