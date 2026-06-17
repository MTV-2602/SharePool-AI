"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState(""); // input field value (can be admin pass or API key)
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  
  // Client Portal states
  const [savedKey, setSavedKey] = useState(null);
  const [keyData, setKeyData] = useState(null);
  const [activeTab, setActiveTab] = useState("usage");
  const [guideTab, setGuideTab] = useState("codex");
  const [copiedField, setCopiedField] = useState("");
  const [origin, setOrigin] = useState("https://vinhcousera.vercel.app");
  const [showKey, setShowKey] = useState(false);

  const router = useRouter();

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
      
      // Check if clientKey is stored in localStorage
      const storedClientKey = localStorage.getItem("clientKey");
      if (storedClientKey) {
        setSavedKey(storedClientKey);
        fetchClientKeyDetails(storedClientKey);
      } else {
        checkAdminAuth();
      }
    }
  }, []);

  const checkAdminAuth = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

    try {
      const res = await fetch(`${baseUrl}/api/auth/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.requireLogin === false) {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        setHasPassword(!!data.hasPassword);
        setAuthMode(data.authMode || "password");
        setOidcConfigured(data.oidcConfigured === true);
        setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
      } else {
        setHasPassword(true);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      setHasPassword(true);
    }
  };

  const fetchClientKeyDetails = async (k) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/client-keys/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const data = await res.json();
      if (res.ok) {
        setKeyData(data.keyData);
        setSavedKey(k);
        localStorage.setItem("clientKey", k);
      } else {
        setError(data.error || "Có lỗi xảy ra khi kiểm tra Key.");
        setKeyData(null);
        localStorage.removeItem("clientKey");
        setSavedKey(null);
        // Fall back to checking admin auth status
        checkAdminAuth();
      }
    } catch (err) {
      setError("Không thể kết nối đến máy chủ. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const inputKey = password.trim();
    if (!inputKey) return;

    setLoading(true);
    setError("");
    setResetHint("");

    // If it looks like a client key (starts with ck-), try client verification directly
    if (inputKey.startsWith("ck-")) {
      await fetchClientKeyDetails(inputKey);
      return;
    }

    // Try admin password login first
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: inputKey }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          setLoading(false);
          return;
        }
        router.push("/dashboard");
        router.refresh();
      } else {
        // If admin login fails, try to verify as a client key just in case (e.g. custom key format)
        const checkRes = await fetch("/api/client-keys/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: inputKey }),
        });
        
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          setKeyData(checkData.keyData);
          setSavedKey(inputKey);
          localStorage.setItem("clientKey", inputKey);
        } else {
          // If both fail, show admin error
          const data = await res.json();
          setError(data.error || "Mật khẩu quản trị hoặc mã API Key không hợp lệ");
          if (data.resetHint) setResetHint(data.resetHint);
          if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
        }
      }
    } catch (err) {
      setError("Có lỗi kết nối xảy ra. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Lỗi đặt mật khẩu");
      }
    } catch (err) {
      setError("Có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const handleClientLogout = () => {
    localStorage.removeItem("clientKey");
    setSavedKey(null);
    setKeyData(null);
    setPassword("");
    setError("");
    checkAdminAuth();
  };

  const copyText = (text, fieldName) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(""), 2000);
  };

  // Calculations for stats
  const used = keyData?.used_tokens || 0;
  const total = keyData?.quota_tokens || 0;
  const isInfinite = total === 0 || total >= 9999999999;
  const remaining = isInfinite ? 0 : Math.max(0, total - used);
  const usagePct = isInfinite ? 0 : Math.min(100, Math.round((used / total) * 100));
  const costUsd = (used / 1000000) * 5.0;

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  // --- Render Client Portal ---
  if (keyData) {
    return (
      <div className="min-h-screen bg-bg text-text-main selection:bg-brand-500 selection:text-white pb-12">
        <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[24px]">vpn_key</span>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">9Router Client Portal</h1>
                <p className="text-xs text-text-muted">
                  Key: <span className="font-mono text-primary/80">{keyData.label || "Unnamed Key"}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchClientKeyDetails(savedKey)}
                disabled={loading}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-surface-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>
                  refresh
                </span>
                Làm mới
              </button>
              <button
                onClick={handleClientLogout}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm font-medium transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                Đăng xuất
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 mt-8">
          <div className="flex gap-2 border-b border-border pb-4 mb-6">
            <button
              onClick={() => setActiveTab("usage")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "usage"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-text-muted hover:bg-surface-2"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">data_usage</span>
              Hạn mức sử dụng
            </button>
            <button
              onClick={() => setActiveTab("guide")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === "guide"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-text-muted hover:bg-surface-2"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">menu_book</span>
              Hướng dẫn kết nối máy khách
            </button>
          </div>

          {activeTab === "usage" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-text-muted">Đã sử dụng</p>
                      <h3 className="text-3xl font-extrabold mt-1 text-primary">{used.toLocaleString()}</h3>
                      <p className="text-xs text-text-muted mt-2">Tokens</p>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-xl text-primary">
                      <span className="material-symbols-outlined text-[24px]">trending_up</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-text-muted">Còn lại</p>
                      <h3 className="text-3xl font-extrabold mt-1 text-green-500">
                        {isInfinite ? "∞" : remaining.toLocaleString()}
                      </h3>
                      <p className="text-xs text-text-muted mt-2">Tokens</p>
                    </div>
                    <div className="p-3 bg-green-500/10 rounded-xl text-green-500">
                      <span className="material-symbols-outlined text-[24px]">hourglass_empty</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-text-muted">Tổng Quota</p>
                      <h3 className="text-3xl font-extrabold mt-1">
                        {isInfinite ? "Không giới hạn" : total.toLocaleString()}
                      </h3>
                      <p className="text-xs text-text-muted mt-2">Tokens</p>
                    </div>
                    <div className="p-3 bg-surface-3 rounded-xl text-text-muted">
                      <span className="material-symbols-outlined text-[24px]">database</span>
                    </div>
                  </div>
                </Card>
              </div>

              {!isInfinite && (
                <Card>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">Tỷ lệ tiêu thụ</span>
                      <span className="font-bold">{usagePct}%</span>
                    </div>
                    <div className="w-full bg-surface-3 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          usagePct > 80 ? "bg-red-500" : "bg-primary"
                        }`}
                        style={{ width: `${usagePct}%` }}
                      />
                    </div>
                    <p className="text-xs text-text-muted">
                      Hạn mức sẽ tự khóa khi đạt đến 100% dung lượng. Vui lòng liên hệ quản trị viên để mua thêm.
                    </p>
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card title="Chi tiết Key" icon="info">
                  <div className="space-y-4 mt-2">
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Trạng thái:</span>
                      <span className="font-semibold text-green-500 flex items-center gap-1">
                        <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-ping" />
                        Hoạt động
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Ngày hết hạn:</span>
                      <span className="font-semibold">
                        {keyData.expires_at
                          ? new Date(keyData.expires_at).toLocaleDateString("vi-VN", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })
                          : "Vô thời hạn"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Chi phí ước tính (~USD):</span>
                      <span className="font-semibold text-primary">
                        ${costUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </span>
                    </div>
                  </div>
                </Card>

                <Card title="Giới hạn kỹ thuật" icon="speed">
                  <div className="space-y-4 mt-2">
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Tần suất tối đa (Rate Limit):</span>
                      <span className="font-semibold">{keyData.rate_limit_per_minute} requests / phút</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Kết nối đồng thời (Concurrency):</span>
                      <span className="font-semibold">{keyData.max_concurrent} session(s)</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-2 text-sm">
                      <span className="text-text-muted">Định danh Key:</span>
                      <div className="flex items-center gap-1 font-mono text-xs text-text-muted">
                        <span>{savedKey.slice(0, 10)}...{savedKey.slice(-10)}</span>
                        <button
                          onClick={() => copyText(savedKey, "fullKey")}
                          className="p-1 hover:bg-surface-3 rounded cursor-pointer"
                          title="Copy Key"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedField === "fullKey" ? "check" : "content_copy"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "guide" && (
            <div className="space-y-6">
              <div className="flex gap-2 border-b border-border/60 pb-3">
                <button
                  onClick={() => setGuideTab("codex")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    guideTab === "codex" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                  }`}
                >
                  💻 Hướng dẫn Codex (README)
                </button>
                <button
                  onClick={() => setGuideTab("antigravity")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    guideTab === "antigravity" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                  }`}
                >
                  🪐 Hướng dẫn AntiGravity (Gemini)
                </button>
              </div>

              {guideTab === "codex" && (
                <div className="space-y-6">
                  <Card title="🛠️ Bước 1: Cài đặt ứng dụng Codex" icon="settings">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <div>
                        <strong className="text-text-main block mb-1">Cách 1: Sử dụng Codex Desktop App (Khuyên dùng)</strong>
                        Tải và cài đặt ứng dụng <span className="font-semibold text-text-main">Codex Desktop</span> chính thức do OpenAI phát hành trên máy tính.
                      </div>
                      <div>
                        <strong className="text-text-main block mb-1">Cách 2: Sử dụng Codex CLI (Giao diện dòng lệnh)</strong>
                        Mở Terminal/PowerShell và chạy lệnh sau để cài đặt:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          npm install -g @openai/codex
                          <button
                            onClick={() => copyText("npm install -g @openai/codex", "installCodex")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "installCodex" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="⚙️ Bước 2: Thiết lập file cấu hình config.toml" icon="construction">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Trên máy khách, cần tạo hoặc chỉnh sửa tệp cấu hình của Codex để chuyển tiếp cuộc gọi qua Server của bạn:</p>
                      <div>
                        1. Tìm tệp cấu hình <strong className="text-text-main"><code>config.toml</code></strong> theo đường dẫn hệ điều hành:
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                          <li><strong>Windows</strong>: <code>C:\Users\&lt;Tên_Tài_Khoản_Máy_Tính&gt;\.codex\config.toml</code></li>
                          <li><strong>Mac / Linux</strong>: <code>~/.codex/config.toml</code></li>
                        </ul>
                        <p className="italic text-xs mt-1">(Nếu chưa có thư mục <code>.codex</code> hoặc file <code>config.toml</code>, hãy tự tạo thư mục và file văn bản mới).</p>
                      </div>
                      <div>
                        2. Mở file <code>config.toml</code> bằng Notepad hoặc Text Editor và điền cấu hình sau:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-4 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          <pre>{`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`}</pre>
                          <button
                            onClick={() => copyText(`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`, "tomlConfig")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                            title="Copy cấu hình"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "tomlConfig" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="🧪 Bước 3: Khởi động lại và Kiểm thử" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>1. Tắt hoàn toàn ứng dụng Codex Desktop (hoặc đóng các cửa sổ Terminal) và mở lại để Codex nạp cấu hình mới.</p>
                      <p>2. Thử nghiệm lệnh cơ bản qua CLI để kiểm tra kết nối:</p>
                      <div className="relative bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12">
                        codex "say hello"
                        <button
                          onClick={() => copyText('codex "say hello"', "test1")}
                          className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedField === "test1" ? "check" : "content_copy"}
                          </span>
                        </button>
                      </div>
                      <p>3. Thử nghiệm tính năng chạy công cụ hệ thống (Tool-calling) của Codex trên máy khách:</p>
                      <div className="relative bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12">
                        codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"
                        <button
                          onClick={() => copyText('codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"', "test2")}
                          className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedField === "test2" ? "check" : "content_copy"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {guideTab === "antigravity" && (
                <div className="space-y-6">
                  <Card title="🪐 Phương pháp A: Sử dụng Antigravity Desktop App (Khuyên dùng - Bypass Đăng ký/Login)" icon="settings">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng ứng dụng Antigravity Desktop (bản clone của Codex) và tự động bỏ qua màn hình Google Login:</p>
                      <div>
                        1. Truy cập thư mục cấu hình của Antigravity tùy theo hệ điều hành của bạn:
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                          <li><strong>Windows</strong>: <code>C:\Users\&lt;Tên_Tài_Khoản_Máy_Tính&gt;\.antigravity\</code></li>
                          <li><strong>Mac / Linux</strong>: <code>~/.antigravity/</code></li>
                        </ul>
                        <p className="italic text-xs mt-1">(Nếu chưa có thư mục <code>.antigravity</code>, hãy mở ứng dụng Antigravity một lần để nó tự tạo, hoặc tự tạo thư mục mới).</p>
                      </div>

                      <div>
                        2. Tạo hoặc sửa file <strong className="text-text-main"><code>config.toml</code></strong> trong thư mục trên và dán nội dung:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-4 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          <pre>{`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`}</pre>
                          <button
                            onClick={() => copyText(`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`, "tomlConfigAG")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                            title="Copy cấu hình config.toml"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "tomlConfigAG" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div>
                        3. Tạo tiếp file <strong className="text-text-main"><code>auth.json</code></strong> trong cùng thư mục trên (để bypass login) và dán nội dung:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-4 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          <pre>{`{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${savedKey}"
}`}</pre>
                          <button
                            onClick={() => copyText(`{\n  "auth_mode": "apikey",\n  "OPENAI_API_KEY": "${savedKey}"\n}`, "authConfigAG")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                            title="Copy cấu hình auth.json"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "authConfigAG" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                      <p>4. Tắt hoàn toàn ứng dụng **Antigravity IDE / Desktop App** (nhớ tắt cả process chạy ngầm) và mở lại để áp dụng cấu hình.</p>
                    </div>
                  </Card>

                  <Card title="🪐 Phương pháp B: Dành cho công cụ hỗ trợ Custom Base URL" icon="cloud">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Nếu bạn dùng các công cụ lập trình hỗ trợ Custom Base URL (Cursor, Cline, RooCode, Continue...):</p>
                      <div className="bg-surface-2 border border-border rounded-lg p-4 space-y-2 text-text-main">
                        <div><strong>1. Provider:</strong> <code>OpenAI Compatible</code> (hoặc Custom OpenAI)</div>
                        <div className="flex items-center gap-2">
                          <strong>2. Base URL:</strong>
                          <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs">{origin}/v1</code>
                          <button
                            onClick={() => copyText(`${origin}/v1`, "urlAG")}
                            className="p-1 hover:bg-surface-3 rounded cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "urlAG" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <strong>3. API Key:</strong>
                          <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs">{savedKey}</code>
                          <button
                            onClick={() => copyText(savedKey, "keyAG")}
                            className="p-1 hover:bg-surface-3 rounded cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "keyAG" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                        <div><strong>4. Models:</strong> <code>gemini-3.5-flash</code>, <code>gemini-3.1-pro</code></div>
                      </div>
                    </div>
                  </Card>

                  <Card title="🪐 Phương pháp C: Sử dụng Script Proxy Siêu Nhẹ (VS Code Extension)" icon="settings_ethernet">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Phương pháp này cho phép Extension Gemini chính thức trên VS Code hoạt động qua Server mà không cần đổi URL.</p>
                      <div>
                        1. Cài đặt Node.js trên máy tính của bạn (bản 18 trở lên).
                      </div>
                      <div>
                        2. Mở Terminal / PowerShell và chạy script proxy chuyển hướng với quyền Administrator:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12 space-y-2">
                          <div><strong>Windows (chạy PowerShell bằng Admin):</strong></div>
                          <code className="block select-all whitespace-pre-wrap">node client-proxy.js --server {origin} --key {savedKey}</code>
                          
                          <div className="mt-3"><strong>macOS / Linux:</strong></div>
                          <code className="block select-all whitespace-pre-wrap">sudo node client-proxy.js --server {origin} --key {savedKey}</code>

                          <button
                            onClick={() => copyText(`node client-proxy.js --server ${origin} --key ${savedKey}`, "proxyCmd")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                            title="Copy lệnh"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "proxyCmd" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    );
  }

  // --- Render Unified Login Form ---
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">9Router Portal</h1>
          <p className="text-text-muted">Nhập Admin Key hoặc API Key để tiếp tục</p>
        </div>

        <Card>
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              {oidcAvailable && (
                <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                  {oidcLoginLabel}
                </Button>
              )}

              {oidcAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

              {passwordAvailable ? (
                <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
                  {((authMode === "oidc" && !oidcConfigured) || (authMode === "both" && !oidcConfigured)) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                      OIDC login is enabled, but issuer fields are not configured yet. Password login is still available.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Khóa truy cập</label>
                    <div className="relative">
                      <Input
                        type={showKey ? "text" : "password"}
                        placeholder="Nhập Admin Key hoặc API Key..."
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoFocus={!oidcAvailable}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main cursor-pointer"
                        onClick={() => setShowKey(!showKey)}
                        tabIndex={-1}
                      >
                        <span className="material-symbols-outlined text-[18px] select-none">
                          {showKey ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                    {error && <p className="text-xs text-red-500">{error}</p>}
                    {retryAfter > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {resetHint && (
                      <p className="text-xs text-text-muted">
                        Forgot password? Open <code className="bg-sidebar px-1 rounded">9router</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    loading={loading}
                    disabled={retryAfter > 0}
                  >
                    {retryAfter > 0 ? `Wait ${retryAfter}s` : "Đăng nhập"}
                  </Button>

                  {hasPassword === false && (
                    <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                      Security risk: no password set. You will be asked to set one when logging in remotely.
                    </p>
                  )}
                </form>
              ) : (
                error && <p className="text-xs text-red-500">{error}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
