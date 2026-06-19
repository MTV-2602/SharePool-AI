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
  const [usageLogs, setUsageLogs] = useState([]);
  const [usageSummary, setUsageSummary] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showDetailedLogs, setShowDetailedLogs] = useState(false);

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

  const fetchUsageLogs = async (keyId, currentKey) => {
    const keyToUse = currentKey || savedKey;
    if (!keyToUse) return;

    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/client-keys/${keyId}/usage?limit=50&include_summary=true`, {
        headers: {
          "Authorization": `Bearer ${keyToUse}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setUsageLogs(data.logs || []);
        setUsageSummary(data.summary || []);
      }
    } catch (err) {
      console.error("Lỗi khi tải lịch sử sử dụng:", err);
    } finally {
      setLoadingLogs(false);
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
        fetchUsageLogs(data.keyData.id, k);
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
          fetchUsageLogs(checkData.keyData.id, inputKey);
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

  const getProviderFromModel = (model) => {
    if (!model) return "N/A";
    const m = model.toLowerCase();
    
    // Explicitly check for Codex models
    if (
      m.startsWith("codex/") ||
      m.startsWith("cx/") ||
      m.includes("gpt-5.5") ||
      m.includes("gpt-5.4") ||
      m.includes("gpt-5.3")
    ) {
      return "Codex";
    }

    // Explicitly check for antigravity prefix or specific antigravity models
    const isAntigravityModel =
      m === "gemini-3-flash" ||
      m.startsWith("gemini-3-flash-a") ||
      m.includes("gemini-3-flash-agent") ||
      m.includes("gemini-3.5-flash") ||
      m.includes("gemini-pro-agent") ||
      m.includes("gemini-3.1-pro-low") ||
      m.includes("gemini-pro-default") ||
      m.includes("gpt-oss") ||
      m.includes("claude-sonnet-4-6") ||
      m.includes("claude-opus-4-6-thinking");

    if (
      m.startsWith("antigravity/") || 
      m.startsWith("ag/") ||
      isAntigravityModel
    ) {
      return "Antigravity";
    }

    if (m.includes("gemini")) return "Google Gemini";
    if (m.includes("gpt-") || m.startsWith("gpt") || m.includes("o1") || m.includes("o3")) return "OpenAI";
    if (m.includes("claude")) return "Anthropic";
    if (m.includes("deepseek")) return "DeepSeek";
    if (m.includes("llama") || m.includes("meta")) return "Meta";
    return "Custom/Other";
  };

  const getCodexMarkdown = () => {
    return `# Hướng dẫn kết nối máy khách - Codex

Bạn có thể kết nối Codex CLI / Desktop App hoặc cấu hình các công cụ lập trình của mình để gọi qua API Gateway 9Router theo các cách dưới đây:

---

## 🛠️ 1. Thông số kết nối API cơ bản
Để cấu hình thủ công cho các thư viện hoặc phần mềm khác:
- **Base URL (Endpoint)**: \`${origin}/v1\`
- **API Key**: \`${savedKey}\`
- **Model ID khuyên dùng**: \`gpt-5.5\` (hoặc \`gpt-5.4\`, \`gpt-5.3-codex\`)

---

## 💻 2. Cài đặt và Cấu hình thủ công trên Codex Desktop App / CLI
### Bước 1: Cài đặt ứng dụng Codex
- **Cách A: Sử dụng Codex Desktop App**
  Tải và cài đặt ứng dụng Codex Desktop chính thức do OpenAI phát hành trên máy tính.
- **Cách B: Sử dụng Codex CLI (Giao diện dòng lệnh)**
  Mở Terminal/PowerShell và chạy lệnh:
  \`\`\`bash
  npm install -g @openai/codex
  \`\`\`

### Bước 2: Thiết lập file cấu hình config.toml
1. Tìm hoặc tạo tệp cấu hình **config.toml** theo đường dẫn hệ điều hành của bạn:
   - **Windows**: \`%%USERPROFILE%%\\.codex\\config.toml\` (Ví dụ: \`C:\\Users\\tên_user\\.codex\\config.toml\`)
   - **Mac / Linux**: \`~/.codex/config.toml\`
   *(Nếu chưa có thư mục \`.codex\` hoặc file \`config.toml\`, bạn hãy tự tạo thư mục và file mới).*

2. Mở file \`config.toml\` bằng Notepad hoặc Text Editor và điền cấu hình sau:
\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

### Bước 3: Khởi động lại và Kiểm thử
1. Khởi động lại ứng dụng Codex Desktop (hoặc Terminal) để nạp cấu hình mới.
2. Thử nghiệm lệnh:
   \`\`\`bash
   codex "say hello"
   \`\`\`
3. Thử nghiệm Tool-calling:
   \`\`\`bash
   codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"
   \`\`\`

---

## 🚀 3. Cấu hình trên Cursor / Cline / RooCode (OpenAI Compatible)
1. **Provider**: Chọn \`OpenAI Compatible\` (hoặc Custom OpenAI).
2. **Base URL**: Điền \`${origin}/v1\`
3. **API Key**: Điền \`${savedKey}\`
4. **Model ID**: Điền \`gpt-5.5\` (hoặc model mong muốn).

---

## 🐍 4. Tích hợp Python (sử dụng thư viện OpenAI SDK)
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="${origin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="gpt-5.5",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
\`\`\`

---

## 📡 5. Gọi nhanh qua cURL (Terminal / Command Prompt)
\`\`\`bash
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${savedKey}" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
\`\`\``;
  };

  const getAntigravityMarkdown = () => {
    return `# Hướng dẫn kết nối máy khách - Antigravity (Gemini)

Bạn có thể kết nối Antigravity Desktop App hoặc cấu hình các công cụ lập trình của mình để gọi qua API Gateway 9Router theo các cách dưới đây:

---

## 🛠️ 1. Thông số kết nối API cơ bản
Để cấu hình thủ công cho các thư viện hoặc phần mềm khác:
- **Base URL (Endpoint)**: \`${origin}/v1\`
- **API Key**: \`${savedKey}\`
- **Model ID khuyên dùng**: \`gemini-3-flash-agent\` (hoặc \`gemini-pro-agent\`)

---

## 💻 2. Cài đặt và Cấu hình thủ công trên Antigravity Desktop App / CLI
Sử dụng ứng dụng Antigravity Desktop (bản clone của Codex) và tự động bypass màn hình Google Login:
1. Tìm hoặc tạo thư mục cấu hình của Antigravity tùy theo hệ điều hành của bạn:
   - **Windows**: \`%%USERPROFILE%%\\.antigravity\` (Ví dụ: \`C:\\Users\\tên_user\\.antigravity\`)
   - **Mac / Linux**: \`~/.antigravity/\`
   *(Nếu chưa có thư mục \`.antigravity\`, hãy mở ứng dụng Antigravity một lần hoặc tự tạo thư mục mới).*

2. Tạo hoặc sửa file **config.toml** trong thư mục trên và dán nội dung:
\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gemini-3-flash-agent"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

3. Tạo tiếp file **auth.json** trong cùng thư mục trên (để bypass login) và dán nội dung:
\`\`\`json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${savedKey}"
}
\`\`\`

4. Khởi động lại ứng dụng **Antigravity IDE / Desktop App** để áp dụng cấu hình.

---

## 🚀 3. Cấu hình trên Cursor / Cline / RooCode (OpenAI Compatible)
1. **Provider**: Chọn \`OpenAI Compatible\` (hoặc Custom OpenAI).
2. **Base URL**: Điền \`${origin}/v1\`
3. **API Key**: Điền \`${savedKey}\`
4. **Model ID**: Điền \`gemini-3-flash-agent\` (hoặc \`gemini-pro-agent\`).

---

## 🐍 4. Tích hợp Python (sử dụng thư viện OpenAI SDK)
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="${origin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="gemini-3-flash-agent",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
\`\`\`

---

## 📡 5. Gọi nhanh qua cURL (Terminal / Command Prompt)
\`\`\`bash
curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${savedKey}" \\
  -d '{
    "model": "gemini-3-flash-agent",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
\`\`\``;
  };

  const getGeminiMarkdown = () => {
    return `# Hướng dẫn kết nối Google Gemini qua 9Router API Gateway

Sử dụng API Key được cấp để gọi trực tiếp các model Google Gemini thông qua cổng kết nối 9Router.

---

## 🛠️ 1. Thông số kết nối API
Để kết nối, bạn điền cấu hình API sau vào công cụ của mình:
- **Base URL (Endpoint)**: \`${origin}/v1\`
- **API Key**: \`${savedKey}\`
- **Model ID**: \`gemini-2.5-flash\` (hoặc \`gemini-2.0-flash\`, \`gemini-2.5-pro\`)

---

## 💻 2. Cấu hình trên Cursor / Cline / RooCode (Lập trình AI)
Cấu hình các công cụ lập trình của bạn như sau để chạy trực tiếp:
1. **Provider**: Chọn \`OpenAI Compatible\` hoặc \`Custom OpenAI\`.
2. **Base URL**: Điền \`${origin}/v1\`
3. **API Key**: Điền \`${savedKey}\`
4. **Model ID**: Điền \`gemini-2.5-flash\` (hoặc \`gemini-2.0-flash\`, \`gemini-2.5-pro\`).

---

## 🐍 3. Tích hợp Python (sử dụng thư viện OpenAI SDK)
Cài đặt thư viện: \`pip install openai\` sau đó chạy đoạn mã:
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="${origin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[
        {"role": "user", "content": "Xin chào, hãy giới thiệu ngắn gọn về bạn."}
    ]
)

print(response.choices[0].message.content)
\`\`\`

---

## 📡 4. Gọi nhanh qua cURL (Terminal / Giao diện dòng lệnh)
Kiểm tra kết nối và chạy kiểm thử ngay lập tức bằng lệnh cURL:
\`\`\`bash
curl \${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${savedKey}" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
\`\`\``;
  };

  const handleCopyFullMarkdown = () => {
    const md =
      guideTab === "codex"
        ? getCodexMarkdown()
        : guideTab === "antigravity"
        ? getAntigravityMarkdown()
        : getGeminiMarkdown();
    copyText(md, "fullMarkdown");
  };

  // Calculations for stats
  const used = keyData?.used_tokens || 0;
  const total = keyData?.quota_tokens || 0;
  const isInfinite = total === 0 || total >= 9999999999;
  const remaining = isInfinite ? 0 : Math.max(0, total - used);
  const usagePct = isInfinite ? 0 : Math.min(100, Math.round((used / total) * 100));
  const costUsd = (used / 1000000) * 5.0;

  // Group logs by provider for aggregation
  const getProviderSummary = () => {
    const summary = {};
    usageSummary.forEach((log) => {
      const provider = getProviderFromModel(log.model);
      if (!summary[provider]) {
        summary[provider] = {
          name: provider,
          prompt: 0,
          completion: 0,
          total: 0,
          count: 0,
          models: new Set()
        };
      }
      summary[provider].prompt += log.prompt_tokens || 0;
      summary[provider].completion += log.completion_tokens || 0;
      summary[provider].total += log.billed_tokens || 0;
      summary[provider].count += log.count || 0;
      if (log.model) {
        summary[provider].models.add(log.model);
      }
    });
    return Object.values(summary).map(p => ({
      ...p,
      models: Array.from(p.models)
    }));
  };

  const summaryData = getProviderSummary();

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

              <Card 
                title={showDetailedLogs ? "Lịch sử yêu cầu (chi tiết)" : "Thống kê theo nhà cung cấp"} 
                icon="history"
                action={
                  usageLogs.length > 0 && (
                    <button
                      onClick={() => setShowDetailedLogs(!showDetailedLogs)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {showDetailedLogs ? "leaderboard" : "list"}
                      </span>
                      {showDetailedLogs ? "Xem tổng hợp" : "Xem chi tiết"}
                    </button>
                  )
                }
              >
                {loadingLogs ? (
                  <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                    <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
                      sync
                    </span>
                    <p className="text-sm mt-2">Đang tải lịch sử sử dụng...</p>
                  </div>
                ) : usageLogs.length === 0 ? (
                  <div className="text-center py-12 text-text-muted">
                    <span className="material-symbols-outlined text-[36px]">
                      history_toggle_off
                    </span>
                    <p className="text-sm mt-2">Không có lịch sử yêu cầu nào gần đây.</p>
                  </div>
                ) : showDetailedLogs ? (
                  // Detailed logs view
                  <div className="overflow-x-auto -mx-6 px-6 max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-muted font-medium text-xs uppercase tracking-wider">
                          <th className="pb-3 pr-4">Thời gian</th>
                          <th className="pb-3 px-4">Provider</th>
                          <th className="pb-3 px-4">Model</th>
                          <th className="pb-3 px-4 text-right">Prompt</th>
                          <th className="pb-3 px-4 text-right">Completion</th>
                          <th className="pb-3 pl-4 text-right">Tổng (Billed)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageLogs.map((log) => {
                          const dateStr = log.created_at
                            ? new Date(log.created_at).toLocaleString("vi-VN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })
                            : "Không rõ";
                          
                          const provider = getProviderFromModel(log.model);
                          
                          let modelBadgeColor = "bg-surface-3 text-text-muted border border-border";
                          if (log.model?.includes("gemini")) {
                            modelBadgeColor = "bg-blue-500/10 text-blue-400 border border-blue-500/20";
                          } else if (log.model?.includes("gpt") || log.model?.includes("o1") || log.model?.includes("o3")) {
                            modelBadgeColor = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                          } else if (log.model?.includes("claude")) {
                            modelBadgeColor = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                          } else if (log.model?.includes("deepseek")) {
                            modelBadgeColor = "bg-purple-500/10 text-purple-400 border border-purple-500/20";
                          }

                          return (
                            <tr key={log.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors last:border-0">
                              <td className="py-3 pr-4 font-mono text-xs text-text-muted whitespace-nowrap">
                                {dateStr}
                              </td>
                              <td className="py-3 px-4 font-medium text-text-main whitespace-nowrap">
                                {provider}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-medium ${modelBadgeColor}`}>
                                  {log.model}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-text-muted whitespace-nowrap">
                                {(log.prompt_tokens || 0).toLocaleString()}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-text-muted whitespace-nowrap">
                                {(log.completion_tokens || 0).toLocaleString()}
                              </td>
                              <td className="py-3 pl-4 text-right font-mono font-semibold text-primary whitespace-nowrap">
                                {(log.billed_tokens || 0).toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  // Aggregated summary view
                  <div className="overflow-x-auto -mx-6 px-6 max-h-[400px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-text-muted font-medium text-xs uppercase tracking-wider">
                          <th className="pb-3 pr-4">Nhà cung cấp</th>
                          <th className="pb-3 px-4 text-center">Yêu cầu</th>
                          <th className="pb-3 px-4">Models đã gọi</th>
                          <th className="pb-3 px-4 text-right">Tổng Prompt</th>
                          <th className="pb-3 px-4 text-right">Tổng Completion</th>
                          <th className="pb-3 pl-4 text-right">Tổng Billed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.map((row) => {
                          let providerColor = "text-text-main";
                          if (row.name === "Google Gemini") providerColor = "text-blue-400 font-semibold";
                          else if (row.name === "OpenAI") providerColor = "text-emerald-400 font-semibold";
                          else if (row.name === "Anthropic") providerColor = "text-amber-400 font-semibold";
                          else if (row.name === "DeepSeek") providerColor = "text-purple-400 font-semibold";
                          else if (row.name === "Antigravity") providerColor = "text-amber-500 font-semibold";
                          else if (row.name === "Codex") providerColor = "text-indigo-400 font-semibold";

                          return (
                            <tr key={row.name} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors last:border-0">
                              <td className={`py-4 pr-4 whitespace-nowrap ${providerColor}`}>
                                {row.name}
                              </td>
                              <td className="py-4 px-4 text-center font-mono whitespace-nowrap">
                                {row.count.toLocaleString()}
                              </td>
                              <td className="py-4 px-4 max-w-xs md:max-w-md">
                                <div className="flex flex-wrap gap-1">
                                  {row.models.map((model) => {
                                    let modelBadgeColor = "bg-surface-3 text-text-muted border border-border";
                                    if (model.includes("gemini")) {
                                      modelBadgeColor = "bg-blue-500/10 text-blue-400 border border-blue-500/20";
                                    } else if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) {
                                      modelBadgeColor = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                                    } else if (model.includes("claude")) {
                                      modelBadgeColor = "bg-amber-500/10 text-amber-400 border border-amber-500/20";
                                    } else if (model.includes("deepseek")) {
                                      modelBadgeColor = "bg-purple-500/10 text-purple-400 border border-purple-500/20";
                                    }
                                    return (
                                      <span key={model} className={`px-2 py-0.5 rounded-full text-xs font-mono font-medium whitespace-nowrap ${modelBadgeColor}`}>
                                        {model}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="py-4 px-4 text-right font-mono text-text-muted whitespace-nowrap">
                                {row.prompt.toLocaleString()}
                              </td>
                              <td className="py-4 px-4 text-right font-mono text-text-muted whitespace-nowrap">
                                {row.completion.toLocaleString()}
                              </td>
                              <td className="py-4 pl-4 text-right font-mono font-semibold text-primary whitespace-nowrap">
                                {row.total.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}

          {activeTab === "guide" && (
            <div className="space-y-6">
              <div className="flex gap-2 border-b border-border/60 pb-3 justify-between items-center flex-wrap gap-y-2">
                <div className="flex gap-2">
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
                    🪐 Hướng dẫn AntiGravity (Code Assist)
                  </button>
                  <button
                    onClick={() => setGuideTab("gemini")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      guideTab === "gemini" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    💎 Hướng dẫn Google Gemini (API/SDK)
                  </button>
                </div>

                <button
                  onClick={handleCopyFullMarkdown}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-xs font-semibold transition-colors cursor-pointer animate-fade-in"
                  title="Sao chép toàn bộ hướng dẫn bằng định dạng Markdown"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copiedField === "fullMarkdown" ? "check" : "content_copy"}
                  </span>
                  {copiedField === "fullMarkdown" ? "Đã sao chép!" : "Copy Full Markdown"}
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
                          <li><strong>Windows</strong>: <code>%USERPROFILE%\.codex\config.toml</code></li>
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
                  <Card title="🪐 Hướng dẫn AntiGravity (Bản build Desktop)" icon="settings">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng ứng dụng Antigravity Desktop (bản clone của Codex) và tự động bỏ qua màn hình Google Login:</p>
                      <div>
                        1. Truy cập thư mục cấu hình của Antigravity tùy theo hệ điều hành của bạn:
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                          <li><strong>Windows</strong>: <code>%USERPROFILE%\.antigravity\</code></li>
                          <li><strong>Mac / Linux</strong>: <code>~/.antigravity/</code></li>
                        </ul>
                        <p className="italic text-xs mt-1">(Nếu chưa có thư mục <code>.antigravity</code>, hãy mở ứng dụng Antigravity một lần để nó tự tạo, hoặc tự tạo thư mục mới).</p>
                      </div>

                      <div>
                        2. Tạo hoặc sửa file <strong className="text-text-main"><code>config.toml</code></strong> trong thư mục trên và dán nội dung:
                        <div className="relative mt-2 bg-surface-2 border border-border rounded-lg p-4 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          <pre>{`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gemini-3-flash-agent"

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
model = "gemini-3-flash-agent"

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
                        <div><strong>4. Models:</strong> <code>gemini-3-flash-agent</code>, <code>gemini-pro-agent</code></div>
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

              {guideTab === "gemini" && (
                <div className="space-y-6 animate-fade-in">
                  <Card title="⚙️ Thông số kết nối API" icon="api">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Sử dụng API Key và Gateway của bạn để kết nối trực tiếp với các dòng model Google Gemini:</p>
                      <div className="bg-surface-2 border border-border rounded-lg p-4 space-y-3 text-text-main">
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2">
                          <div>
                            <strong>Base URL:</strong>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono">{origin}/v1</code>
                          </div>
                          <button
                            onClick={() => copyText(`${origin}/v1`, "urlGemini")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "urlGemini" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "urlGemini" ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2">
                          <div>
                            <strong>API Key:</strong>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono">{savedKey}</code>
                          </div>
                          <button
                            onClick={() => copyText(savedKey, "keyGemini")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "keyGemini" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "keyGemini" ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                        <div>
                          <strong>Các model khuyên dùng:</strong>
                          <ul className="list-disc pl-5 mt-1 space-y-1 text-xs text-text-muted">
                            <li><code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main">gemini-2.5-flash</code> (Tốc độ cực nhanh, đa năng)</li>
                            <li><code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main">gemini-2.0-flash</code> (Ổn định, tiết kiệm)</li>
                            <li><code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main">gemini-2.5-pro</code> (Thông minh nhất, hỗ trợ tốt tác vụ phức tạp)</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="💻 Cấu hình trên IDE / Cursor / Cline / RooCode" icon="terminal">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Nhập các thông số sau vào phần cấu hình Custom OpenAI hoặc OpenAI Compatible của ứng dụng lập trình:</p>
                      <ul className="list-disc pl-5 space-y-1 text-text-muted">
                        <li><strong>Provider/Dịch vụ:</strong> Chọn <code className="bg-surface px-1 rounded text-text-main">OpenAI Compatible</code> (hoặc Custom OpenAI/Compatible)</li>
                        <li><strong>Base URL:</strong> Điền <code className="bg-surface px-1 rounded text-text-main">{origin}/v1</code></li>
                        <li><strong>API Key:</strong> Điền Client Key của bạn (<code className="bg-surface px-1 rounded text-text-main">{savedKey}</code>)</li>
                        <li><strong>Model ID:</strong> Nhập model mong muốn (ví dụ: <code className="bg-surface px-1 rounded text-text-main font-mono">gemini-2.5-flash</code>)</li>
                      </ul>
                      <p className="text-xs italic text-text-muted bg-surface-2 p-2.5 rounded-lg border border-border">
                        💡 Mẹo: Cấu hình này giúp bạn lập trình trực tiếp bằng model Gemini cao cấp mà không cần tài khoản Google Studio hay VPN.
                      </p>
                    </div>
                  </Card>

                  <Card title="🐍 Tích hợp trực tiếp bằng Code (Python / JavaScript / cURL)" icon="code">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main">Ví dụ Python (OpenAI SDK):</span>
                          <button
                            onClick={() => {
                              const code = `import openai\n\nclient = openai.OpenAI(\n    base_url="${origin}/v1",\n    api_key="${savedKey}"\n)\n\nresponse = client.chat.completions.create(\n    model="gemini-2.5-flash",\n    messages=[{"role": "user", "content": "Hello!"}]\n)\nprint(response.choices[0].message.content)`;
                              copyText(code, "codePython");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "codePython" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "codePython" ? "Đã copy" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`import openai

client = openai.OpenAI(
    base_url="${origin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)`}
                        </pre>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main">Ví dụ cURL (Terminal):</span>
                          <button
                            onClick={() => {
                              const code = `curl ${origin}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -d '{\n    "model": "gemini-2.5-flash",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`;
                              copyText(code, "codeCurl");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "codeCurl" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "codeCurl" ? "Đã copy" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${savedKey}" \\
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                        </pre>
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
