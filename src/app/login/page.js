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
  const [guideTab, setGuideTab] = useState("antigravity");
  const [copiedField, setCopiedField] = useState("");
  const [origin, setOrigin] = useState("https://ainoname.site");
  const [apiOrigin, setApiOrigin] = useState("https://api.ainoname.site");
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
      setApiOrigin(window.location.origin);
      
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
          "Authorization": `Bearer ${keyToUse}`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      if (res.ok) {
        const data = await res.json();
        const cleanModelName = (modelName) => {
          let m = modelName || "";
          if (m.startsWith("ag/")) {
            m = m.slice(3);
          } else if (m.startsWith("antigravity/")) {
            m = m.slice(12);
          } else if (m.startsWith("codex/")) {
            m = m.slice(6);
          }
          return m;
        };
        const normalizedLogs = (data.logs || []).map(log => ({ ...log, model: cleanModelName(log.model) }));
        const normalizedSummary = (data.summary || []).reduce((acc, item) => {
          const modelName = cleanModelName(item.model);
          const existing = acc.find(x => x.model === modelName);
          if (existing) {
            existing.prompt_tokens += Number(item.prompt_tokens) || 0;
            existing.completion_tokens += Number(item.completion_tokens) || 0;
            existing.billed_tokens += Number(item.billed_tokens) || 0;
            existing.count += Number(item.count) || 0;
          } else {
            acc.push({
              ...item,
              model: modelName,
              prompt_tokens: Number(item.prompt_tokens) || 0,
              completion_tokens: Number(item.completion_tokens) || 0,
              billed_tokens: Number(item.billed_tokens) || 0,
              count: Number(item.count) || 0
            });
          }
          return acc;
        }, []);
        setUsageLogs(normalizedLogs);
        setUsageSummary(normalizedSummary);
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
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        },
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
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        },
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
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        try {
          const el = document.createElement("textarea");
          el.value = text;
          el.setAttribute("readonly", "");
          el.style.position = "absolute";
          el.style.left = "-9999px";
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
        } catch (e) {}
      });
    } else {
      try {
        const el = document.createElement("textarea");
        el.value = text;
        el.setAttribute("readonly", "");
        el.style.position = "absolute";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch (e) {}
    }
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(""), 2000);
  };

  const getProviderFromModel = (model) => {
    if (!model) return "N/A";
    const m = model.toLowerCase();
    
    // Codex models
    if (
      m.startsWith("codex/") ||
      m.startsWith("cx/") ||
      m.includes("gpt-5.5") ||
      m.includes("gpt-5.4-image") ||
      m.includes("gpt-5.3")
    ) {
      return "Codex";
    }

    // Antigravity models (All Gemini models, AG slots, Claude on AG, GPT-OSS, gpt-5.4 combo)
    if (
      m.startsWith("antigravity/") || 
      m.startsWith("ag/") ||
      m.includes("gemini") ||
      m.includes("gpt-oss") ||
      m.includes("claude-sonnet-4") ||
      m.includes("claude-opus-4") ||
      m === "gpt-5.4"
    ) {
      return "Antigravity";
    }

    if (m.includes("gpt-") || m.startsWith("gpt") || m.includes("o1") || m.includes("o3")) return "OpenAI";
    if (m.includes("claude")) return "Anthropic";
    if (m.includes("deepseek")) return "DeepSeek";
    if (m.includes("llama") || m.includes("meta")) return "Meta";
    return "Custom/Other";
  };

  const getAntigravityMarkdown = () => {
    return `# Hướng dẫn tích hợp AntiGravity (Gemini / Claude / Cursor / IDEs)

Cổng kết nối AI Gateway hỗ trợ toàn diện các mô hình AntiGravity với tốc độ cao và độ ổn định tối đa.

---

## 🔑 1. Thông số kết nối API (OpenAI Compatible)
- **Base URL**: \`${apiOrigin}/v1\`
- **API Key**: \`${savedKey}\`
- **Tiền tố Model chuẩn**: Sử dụng tiền tố \`ag/\` vào trước tên model để đảm bảo hệ thống điều hướng chính xác 100% về cụm AntiGravity:

| Model ID chuẩn (Khuyên dùng) | Tên mô hình | Đặc điểm & Khuyến nghị |
| :--- | :--- | :--- |
| \`ag/gemini-3.8-flash-high\` | Gemini 3.8 Flash (High) | ⚡ **Khuyên dùng nhất** - Phản hồi siêu tốc (~1.5s - 3s), cực kỳ thông minh |
| \`ag/claude-sonnet-4-6\` | Claude Sonnet 4.6 (Thinking) | 🧠 Lựa chọn hàng đầu cho Coding trong Cursor, Claude Code, Cline |
| \`ag/claude-opus-4-6-thinking\` | Claude Opus 4.6 (Thinking) | 👑 Siêu suy luận, giải quyết các tác vụ kiến trúc & thuật toán phức tạp |
| \`ag/gpt-oss-120b-medium\` | GPT-OSS 120B (Medium) | 🔥 Model mã nguồn mở siêu mạnh, hỗ trợ suy luận linh hoạt |
| \`ag/gemini-3-flash\` | Gemini 3 Flash / 3.7 Tiered | 🚀 Phản hồi cực tốc, ổn định, tiết kiệm token |
| \`ag/gemini-pro-agent\` | Gemini 3.1 Pro (High) | 💎 Phân tích dữ liệu & xử lý ngữ cảnh cực lớn |
| \`gpt-5.4\` | Combo AntiGravity | 🔄 Dành riêng cho Codex Desktop App (Tự động map sang AntiGravity Flash) |

---

## 🚀 2. Cấu hình trên Cursor / Windsurf / Cline / RooCode
1. Mở cài đặt (Settings) của công cụ -> Tìm mục **Models** hoặc **API Provider**.
2. Chọn Provider: **OpenAI Compatible** (hoặc **Custom OpenAI**).
3. Điền các trường:
   - **Base URL**: \`${apiOrigin}/v1\`
   - **API Key**: \`${savedKey}\`
4. Thêm các Model ID sau vào danh sách:
   - \`ag/gemini-3.8-flash-high\`
   - \`ag/claude-sonnet-4-6\`
   - \`ag/gpt-oss-120b-medium\`

---

## 🧪 3. Kiểm tra kết nối nhanh trên Terminal (Quick Test cURL)

### 🔷 Test model Flash High (\`ag/gemini-3.8-flash-high\`):
\`\`\`bash
curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối AntiGravity Gateway."}]
  }'
\`\`\`

### 🧠 Test model Claude Sonnet (\`ag/claude-sonnet-4-6\`):
\`\`\`bash
curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Xin chào! Bạn là mô hình nào?"}]
  }'
\`\`\`

---

## 🤖 4. Sử dụng với Claude Code CLI
Nếu bạn sử dụng công cụ dòng lệnh **Claude Code**, hãy đặt biến môi trường trước khi chạy:

### 🔷 Trên Windows (PowerShell):
\`\`\`powershell
$env:ANTHROPIC_BASE_URL="${apiOrigin}/v1"
$env:ANTHROPIC_API_KEY="${savedKey}"
claude
\`\`\`

### 🍎 Trên Mac / Linux:
\`\`\`bash
export ANTHROPIC_BASE_URL="${apiOrigin}/v1"
export ANTHROPIC_API_KEY="${savedKey}"
claude
\`\`\`

---

## 🐍 5. Sử dụng qua OpenAI SDK (Python & Node.js)

### Python:
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="${apiOrigin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="ag/gemini-3.8-flash-high",
    messages=[{"role": "user", "content": "Xin chào AntiGravity!"}]
)

print(response.choices[0].message.content)
\`\`\`

### Node.js / JavaScript:
\`\`\`javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${apiOrigin}/v1",
  apiKey: "${savedKey}"
});

const response = await client.chat.completions.create({
  model: "ag/gemini-3.8-flash-high",
  messages: [{ role: "user", content: "Xin chào AntiGravity!" }]
});

console.log(response.choices[0].message.content);
\`\`\``;
  };

  const getCodexMarkdown = () => {
    return `# Hướng dẫn tích hợp Client (Codex Desktop App & IDEs)

Hệ thống hỗ trợ 2 dòng model chính chạy qua cổng API Gateway:
- **AntiGravity (Gemini / Claude / GPT-OSS)**: Sử dụng Model ID \`ag/gemini-3.8-flash-high\` (hoặc Combo ID \`gpt-5.4\`)
- **Codex (ChatGPT-backed)**: Sử dụng Model ID \`gpt-5.5\`

---

## ⚡ 1. Cấu hình tự động 1-Click trên Terminal (Khuyên dùng)
Copy và dán dòng lệnh bên dưới vào Terminal để hệ thống tự động tạo thư mục và ghi file cấu hình \`.codex/config.toml\` & \`.codex/auth.json\` với API Key của bạn:

### 🔷 Trên Windows (Mở PowerShell dán lệnh sau - Mặc định AntiGravity gpt-5.4):
\`\`\`powershell
mkdir -Force $env:USERPROFILE\\.codex; Set-Content $env:USERPROFILE\\.codex\\config.toml "model_reasoning_effort = \`"low\`"\`nmodel_provider = \`"openai-custom\`"\`nmodel = \`"gpt-5.4\`"\`n\`n[model_providers.openai-custom]\`nexperimental_bearer_token = \`"${savedKey}\`"\`nname = \`"VinAi\`"\`nbase_url = \`"${apiOrigin}/v1\`"\`nwire_api = \`"responses\`"\`nrequires_openai_auth = false\`nsupports_websockets = false"; Set-Content $env:USERPROFILE\\.codex\\auth.json '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}'
\`\`\`

### 🍎 Trên Mac / Linux (Mở Terminal dán lệnh sau):
\`\`\`bash
mkdir -p ~/.codex && cat << 'EOF' > ~/.codex/config.toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
EOF
echo '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}' > ~/.codex/auth.json
\`\`\`

*(Lưu ý: Tắt hoàn toàn ứng dụng Codex Desktop App và mở lại để áp dụng cấu hình).*

---

## 🧪 2. Kiểm tra kết nối nhanh trên Terminal (Quick Test)
Bạn có thể copy lệnh này dán vào Terminal để test gọi trực tiếp xem API có phản hồi chuẩn chưa:

\`\`\`bash
curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối API Gateway."}]
  }'
\`\`\`

---

## ⚙️ 3. Cấu hình thủ công qua file config.toml
Nếu bạn muốn sửa file thủ công, hãy tìm file theo đường dẫn:
- **Windows**: \`%USERPROFILE%\\.codex\\config.toml\` (Ví dụ: \`C:\\Users\\tên_user\\.codex\\config.toml\`)
- **Mac / Linux**: \`~/.codex/config.toml\`

### Mẫu file config.toml (Sử dụng model AntiGravity qua gpt-5.4):
\`\`\`toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
\`\`\`

### Mẫu file auth.json (Bypass Login):
\`\`\`json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${savedKey}"
}
\`\`\`

---

## 🚀 4. Cấu hình trên Cursor / Cline / RooCode (OpenAI Compatible)
- **Provider**: Chọn \`OpenAI Compatible\` (hoặc Custom OpenAI)
- **Base URL**: \`${apiOrigin}/v1\`
- **API Key**: \`${savedKey}\`
- **Model ID chuẩn**: \`ag/gemini-3.8-flash-high\` (hoặc \`ag/claude-sonnet-4-6\`, \`ag/gpt-oss-120b-medium\`, \`gpt-5.4\`, \`gpt-5.5\`)`;
  };

  const getOpenclawMarkdown = () => {
    return `# Hướng dẫn cấu hình OpenClaw

Cấu hình OpenClaw để gọi qua API Gateway sử dụng các model AntiGravity và Codex.

---

## 🛠️ 1. Cấu hình tự động từ Dashboard
Nếu bạn chạy OpenClaw cục bộ trên cùng máy chủ 9Router:
1. Truy cập giao diện quản trị 9Router: **Dashboard** -> **CLI Tools** -> **OpenClaw**.
2. Chọn mô hình bạn muốn sử dụng và nhấn **Áp dụng**. Hệ thống sẽ tự động ghi đè tệp cấu hình của OpenClaw.

---

## 📄 2. Cấu hình thủ công qua openclaw.json
Nếu bạn muốn cấu hình thủ công hoặc chạy OpenClaw từ xa:
1. Mở hoặc tạo tệp cấu hình của OpenClaw theo hệ điều hành:
   - **Windows**: \`%USERPROFILE%\\.openclaw\\openclaw.json\` (Ví dụ: \`C:\\Users\\tên_user\\.openclaw\\openclaw.json\`)
   - **Mac / Linux**: \`~/.openclaw/openclaw.json\`
2. Chỉnh sửa tệp **openclaw.json** và dán nội dung cấu hình nhà cung cấp \`9router\` vào phần \`models.providers\` (sử dụng tiền tố \`ag/\` chuẩn):
\`\`\`json
{
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "${apiOrigin}/v1",
        "apiKey": "${savedKey}",
        "api": "openai-completions",
        "models": [
          { "id": "ag/gemini-3.8-flash-high", "name": "ag/gemini-3.8-flash-high" },
          { "id": "ag/claude-sonnet-4-6", "name": "ag/claude-sonnet-4-6" },
          { "id": "ag/gpt-oss-120b-medium", "name": "ag/gpt-oss-120b-medium" },
          { "id": "gpt-5.4", "name": "gpt-5.4" },
          { "id": "gpt-5.5", "name": "gpt-5.5" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/ag/gemini-3.8-flash-high"
      },
      "models": {
        "9router/ag/gemini-3.8-flash-high": {},
        "9router/ag/claude-sonnet-4-6": {},
        "9router/gpt-5.4": {},
        "9router/gpt-5.5": {}
      }
    }
  }
}
\`\`\`
3. Khởi động lại **OpenClaw CLI** để áp dụng cấu hình mới.`;
  };

  const getGeminiMarkdown = () => {
    return `# Hướng dẫn tích hợp SDK (Python & REST API)

Bạn có thể gọi trực tiếp các model AntiGravity (ví dụ: \`ag/gemini-3.8-flash-high\`, \`ag/claude-sonnet-4-6\`, \`ag/gpt-oss-120b-medium\`) thông qua API Gateway bằng các SDK phổ biến:

---

## ⚡ 1. Test kết nối nhanh trên Terminal (Quick Test cURL)
Copy và dán lệnh cURL bên dưới vào Terminal để test gọi trực tiếp model \`ag/gemini-3.8-flash-high\`:

\`\`\`bash
curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào! Bạn là ai?"}]
  }'
\`\`\`

---

## 🤖 2. Sử dụng OpenAI SDK (Python)
Cài đặt thư viện: \`pip install openai\`
\`\`\`python
import openai

client = openai.OpenAI(
    base_url="${apiOrigin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="ag/gemini-3.8-flash-high",
    messages=[
        {"role": "user", "content": "Xin chào! Giới thiệu về bạn."}
    ]
)

print(response.choices[0].message.content)
\`\`\`

---

## 📦 3. Sử dụng OpenAI SDK (Node.js / TypeScript)
Cài đặt thư viện: \`npm install openai\`
\`\`\`javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${apiOrigin}/v1",
  apiKey: "${savedKey}"
});

const response = await client.chat.completions.create({
  model: "ag/gemini-3.8-flash-high",
  messages: [{ role: "user", content: "Xin chào! Giới thiệu về bạn." }]
});

console.log(response.choices[0].message.content);
\`\`\`

---

## 🐍 4. Sử dụng Google GenAI SDK (Thư viện Gemini chính thức)
Cài đặt thư viện: \`pip install google-genai\`
\`\`\`python
from google import genai

client = genai.Client(
    api_key="${savedKey}",
    http_options={"api_endpoint": "${origin}"}
)

response = client.models.generate_content(
    model="ag/gemini-3.8-flash-high",
    contents="Xin chào! Bạn là ai?"
)

print(response.text)
\`\`\`

---

## 📡 5. Gọi qua REST API Gemini gốc (cURL)
Bạn cũng có thể gọi trực tiếp Endpoint tương thích định dạng API của Google AI Studio:
\`\`\`bash
curl -X POST "${apiOrigin}/v1beta/models/ag/gemini-3.8-flash-high:streamGenerateContent?key=${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{
      "parts": [{
        "text": "Hello!"
      }]
    }]
  }'
\`\`\``;
  };

  const handleCopyFullMarkdown = () => {
    const md =
      guideTab === "antigravity"
        ? getAntigravityMarkdown()
        : guideTab === "codex"
        ? getCodexMarkdown()
        : guideTab === "openclaw"
        ? getOpenclawMarkdown()
        : getGeminiMarkdown();
    copyText(md, "fullMarkdown");
  };


  // Calculations for stats
  const used = keyData?.used_tokens || 0;
  const total = keyData?.quota_tokens || 0;
  const isInfinite = total === 0 || total >= 999999999999;
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
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setGuideTab("antigravity")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      guideTab === "antigravity" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    ⚡ AntiGravity (Gemini / Claude / Cursor)
                  </button>
                  <button
                    onClick={() => setGuideTab("codex")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      guideTab === "codex" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    💻 Codex App & CLI
                  </button>
                  <button
                    onClick={() => setGuideTab("openclaw")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      guideTab === "openclaw" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    🐾 OpenClaw
                  </button>
                  <button
                    onClick={() => setGuideTab("gemini")}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      guideTab === "gemini" ? "bg-surface-2 text-primary" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    🐍 Python & REST API
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

              {guideTab === "antigravity" && (
                <div className="space-y-6 animate-fade-in">
                  <Card title="🌟 Danh sách Model IDs AntiGravity (Khuyên dùng tiền tố ag/)" icon="stars">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>
                        Để hệ thống tự động điều hướng 100% chính xác tới cụm máy chủ AntiGravity và tránh xung đột với các provider khác, hãy thêm tiền tố <code className="bg-surface px-1.5 py-0.5 rounded border border-border text-primary font-mono font-bold">ag/</code> vào trước tên model:
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Model 1: gemini-3.8-flash-high */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-primary/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-amber-500 flex items-center gap-1">
                                ⚡ Khuyên dùng (Fastest & Smartest)
                              </span>
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono font-bold">~1.5s - 3s</span>
                            </div>
                            <strong className="text-xs text-text-main block">Gemini 3.8 Flash (High)</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/gemini-3.8-flash-high</code></span>
                          </div>
                          <button
                            onClick={() => copyText("ag/gemini-3.8-flash-high", "modelAgFlashHigh")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelAgFlashHigh" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelAgFlashHigh" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>

                        {/* Model 2: claude-sonnet-4-6 */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-purple-500/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-purple-400 flex items-center gap-1">
                                🧠 Coding & Cursor Top Choice
                              </span>
                              <span className="text-[10px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded font-mono font-bold">Thinking</span>
                            </div>
                            <strong className="text-xs text-text-main block">Claude Sonnet 4.6 (Thinking)</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/claude-sonnet-4-6</code></span>
                          </div>
                          <button
                            onClick={() => copyText("ag/claude-sonnet-4-6", "modelAgSonnet")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelAgSonnet" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelAgSonnet" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>

                        {/* Model 3: claude-opus-4-6-thinking */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-rose-500/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                                👑 Deep Reasoning & Architecture
                              </span>
                              <span className="text-[10px] bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded font-mono font-bold">Heavy</span>
                            </div>
                            <strong className="text-xs text-text-main block">Claude Opus 4.6 (Thinking)</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/claude-opus-4-6-thinking</code></span>
                          </div>
                          <button
                            onClick={() => copyText("ag/claude-opus-4-6-thinking", "modelAgOpus")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelAgOpus" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelAgOpus" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>

                        {/* Model 4: gpt-oss-120b-medium */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-emerald-500/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                                🔥 Powerful Open Weights
                              </span>
                              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-bold">120B</span>
                            </div>
                            <strong className="text-xs text-text-main block">GPT-OSS 120B (Medium)</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/gpt-oss-120b-medium</code></span>
                          </div>
                          <button
                            onClick={() => copyText("ag/gpt-oss-120b-medium", "modelAgGptOss")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelAgGptOss" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelAgGptOss" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>

                        {/* Model 5: gemini-3-flash */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-cyan-500/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                                🚀 Ultra Fast Tiered
                              </span>
                              <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded font-mono font-bold">&lt; 2s</span>
                            </div>
                            <strong className="text-xs text-text-main block">Gemini 3 Flash</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/gemini-3-flash</code></span>
                          </div>
                          <button
                            onClick={() => copyText("ag/gemini-3-flash", "modelAgFlash3")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelAgFlash3" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelAgFlash3" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>

                        {/* Model 6: gpt-5.4 */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 flex flex-col justify-between gap-2.5 hover:border-blue-500/50 transition-colors">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-blue-400 flex items-center gap-1">
                                🔄 Codex App Combo
                              </span>
                              <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-mono font-bold">Auto Map</span>
                            </div>
                            <strong className="text-xs text-text-main block">GPT-5.4 (AntiGravity Mapping)</strong>
                            <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">gpt-5.4</code></span>
                          </div>
                          <button
                            onClick={() => copyText("gpt-5.4", "modelGpt54Ag")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors self-start"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {copiedField === "modelGpt54Ag" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "modelGpt54Ag" ? "Đã copy!" : "Copy Model ID"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="🚀 Cấu hình trên Cursor / Windsurf / Cline / RooCode" icon="rocket">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng trực tiếp các thông số sau để tích hợp vào các IDE hỗ trợ OpenAI Compatible:</p>
                      
                      <div className="bg-surface-2 border border-border rounded-lg p-4 space-y-3 text-text-main">
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2.5">
                          <div>
                            <span className="text-xs text-text-muted block">Provider / Protocol</span>
                            <strong className="text-sm">OpenAI Compatible</strong> <span className="text-xs text-text-muted">(hoặc Custom OpenAI)</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2.5">
                          <div className="overflow-hidden">
                            <span className="text-xs text-text-muted block">Base URL (Endpoint)</span>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs font-mono font-bold text-primary truncate max-w-[280px] sm:max-w-[420px] inline-block">{apiOrigin}/v1</code>
                          </div>
                          <button
                            onClick={() => copyText(`${apiOrigin}/v1`, "urlBaseAg")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "urlBaseAg" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "urlBaseAg" ? "Đã copy" : "Copy Base URL"}
                          </button>
                        </div>

                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2.5">
                          <div className="overflow-hidden">
                            <span className="text-xs text-text-muted block">API Key</span>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs font-mono font-bold text-primary truncate max-w-[280px] sm:max-w-[420px] inline-block">{savedKey}</code>
                          </div>
                          <button
                            onClick={() => copyText(savedKey, "keyBaseAg")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "keyBaseAg" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "keyBaseAg" ? "Đã copy" : "Copy API Key"}
                          </button>
                        </div>

                        <div>
                          <span className="text-xs text-text-muted block mb-1.5">Cách thêm model vào Cursor / VS Code Extension:</span>
                          <ol className="list-decimal pl-5 text-xs text-text-muted space-y-1">
                            <li>Mở <strong>Cursor Settings</strong> (hoặc Cline / RooCode Settings) → Chọn mục <strong>Models</strong>.</li>
                            <li>Tắt các model mặc định không sử dụng và nhấn <strong>Add Model</strong>.</li>
                            <li>Dán Model ID: <code className="bg-surface px-1 py-0.5 rounded text-text-main font-mono">ag/gemini-3.8-flash-high</code> hoặc <code className="bg-surface px-1 py-0.5 rounded text-text-main font-mono">ag/claude-sonnet-4-6</code>.</li>
                          </ol>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="🧪 Kiểm tra kết nối nhanh trên Terminal (Quick Test cURL)" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Copy và dán các lệnh cURL bên dưới vào Terminal máy tính để kiểm tra kết nối tới Gateway:</p>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">⚡ Test model Flash High (ag/gemini-3.8-flash-high):</span>
                          <button
                            onClick={() => copyText(`curl ${apiOrigin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "ag/gemini-3.8-flash-high",\n    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối AntiGravity Gateway."}]\n  }'`, "cmdTestAgFlash")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdTestAgFlash" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdTestAgFlash" ? "Đã copy!" : "Copy cURL Flash"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối AntiGravity Gateway."}]
  }'`}
                        </pre>
                      </div>

                      <div className="pt-3 border-t border-border/40">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">🧠 Test model Claude Sonnet Thinking (ag/claude-sonnet-4-6):</span>
                          <button
                            onClick={() => copyText(`curl ${apiOrigin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "ag/claude-sonnet-4-6",\n    "messages": [{"role": "user", "content": "Xin chào! Bạn là mô hình nào?"}]\n  }'`, "cmdTestAgSonnet")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdTestAgSonnet" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdTestAgSonnet" ? "Đã copy!" : "Copy cURL Claude"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Xin chào! Bạn là mô hình nào?"}]
  }'`}
                        </pre>
                      </div>
                    </div>
                  </Card>

                  <Card title="🤖 Hướng dẫn tích hợp Claude Code CLI" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng công cụ dòng lệnh <strong>Claude Code</strong> của Anthropic chạy qua Gateway bằng cách trỏ biến môi trường:</p>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">🔷 Trên Windows (Mở PowerShell dán lệnh này):</span>
                          <button
                            onClick={() => copyText(`$env:ANTHROPIC_BASE_URL="${apiOrigin}/v1"; $env:ANTHROPIC_API_KEY="${savedKey}"; claude`, "cmdPsClaudeCode")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdPsClaudeCode" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdPsClaudeCode" ? "Đã copy!" : "Copy PowerShell"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono whitespace-pre-wrap break-all">
{`$env:ANTHROPIC_BASE_URL="${apiOrigin}/v1"; $env:ANTHROPIC_API_KEY="${savedKey}"; claude`}
                        </pre>
                      </div>

                      <div className="pt-3 border-t border-border/40">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">🍎 Trên Mac / Linux (Mở Terminal dán lệnh này):</span>
                          <button
                            onClick={() => copyText(`export ANTHROPIC_BASE_URL="${apiOrigin}/v1" && export ANTHROPIC_API_KEY="${savedKey}" && claude`, "cmdBashClaudeCode")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdBashClaudeCode" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdBashClaudeCode" ? "Đã copy!" : "Copy Mac/Linux"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`export ANTHROPIC_BASE_URL="${apiOrigin}/v1" && export ANTHROPIC_API_KEY="${savedKey}" && claude`}
                        </pre>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {guideTab === "codex" && (
                <div className="space-y-6 animate-fade-in">
                  <Card title="⚡ 1-Click Cấu hình tự động trên Terminal (Khuyên dùng)" icon="bolt">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Không cần sửa file thủ công. Chỉ cần mở Terminal trên máy tính, copy 1 dòng lệnh dưới đây và dán vào để tự động cấu hình Codex Desktop App:</p>
                      
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main flex items-center gap-1">
                            🔷 Trên Windows (Mở PowerShell dán lệnh này):
                          </span>
                          <button
                            onClick={() => copyText(`mkdir -Force $env:USERPROFILE\\.codex; Set-Content $env:USERPROFILE\\.codex\\config.toml "model_reasoning_effort = \`"low\`"\`nmodel_provider = \`"openai-custom\`"\`nmodel = \`"gpt-5.4\`"\`n\`n[model_providers.openai-custom]\`nexperimental_bearer_token = \`"${savedKey}\`"\`nname = \`"VinAi\`"\`nbase_url = \`"${apiOrigin}/v1\`"\`nwire_api = \`"responses\`"\`nrequires_openai_auth = false\`nsupports_websockets = false"; Set-Content $env:USERPROFILE\\.codex\\auth.json '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}'`, "cmdPsCodex")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdPsCodex" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdPsCodex" ? "Đã copy!" : "Copy lệnh PowerShell"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono whitespace-pre-wrap break-all">
{`mkdir -Force $env:USERPROFILE\\.codex; Set-Content $env:USERPROFILE\\.codex\\config.toml "model_reasoning_effort = \`"low\`"\`nmodel_provider = \`"openai-custom\`"\`nmodel = \`"gpt-5.4\`"\`n\`n[model_providers.openai-custom]\`nexperimental_bearer_token = \`"${savedKey}\`"\`nname = \`"VinAi\`"\`nbase_url = \`"${apiOrigin}/v1\`"\`nwire_api = \`"responses\`"\`nrequires_openai_auth = false\`nsupports_websockets = false"; Set-Content $env:USERPROFILE\\.codex\\auth.json '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}'`}
                        </pre>
                      </div>

                      <div className="pt-3 border-t border-border/40">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main flex items-center gap-1">
                            🍎 Trên Mac / Linux (Mở Terminal dán lệnh này):
                          </span>
                          <button
                            onClick={() => copyText(`mkdir -p ~/.codex && cat << 'EOF' > ~/.codex/config.toml\nmodel_reasoning_effort = "low"\nmodel_provider = "openai-custom"\nmodel = "gpt-5.4"\n\n[model_providers.openai-custom]\nexperimental_bearer_token = "${savedKey}"\nname = "VinAi"\nbase_url = "${apiOrigin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nEOF\necho '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}' > ~/.codex/auth.json`, "cmdBashCodex")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdBashCodex" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdBashCodex" ? "Đã copy!" : "Copy lệnh Bash"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`mkdir -p ~/.codex && cat << 'EOF' > ~/.codex/config.toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
EOF
echo '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}' > ~/.codex/auth.json`}
                        </pre>
                      </div>

                      <p className="text-xs italic text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                        💡 <strong>Sau khi dán lệnh xong:</strong> Hãy tắt hoàn toàn ứng dụng <strong>Codex Desktop App</strong> và mở lại để áp dụng cấu hình mới.
                      </p>
                    </div>
                  </Card>

                  <Card title="🧪 Kiểm tra kết nối nhanh trên Terminal (Quick Test)" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Bạn có thể copy lệnh test bên dưới dán trực tiếp vào Terminal trên máy tính của bạn:</p>

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">🔷 Trên Windows (Command Prompt / CMD):</span>
                          <button
                            onClick={() => copyText(`curl -X POST "${apiOrigin}/v1/chat/completions" -H "Authorization: Bearer ${savedKey}" -H "Content-Type: application/json" -d "{\\"model\\":\\"gpt-5.4\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Xin chao!\\"}]}"`, "cmdTestCurlWin")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdTestCurlWin" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdTestCurlWin" ? "Đã copy!" : "Copy lệnh Windows CMD"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono whitespace-pre-wrap break-all">
{`curl -X POST "${apiOrigin}/v1/chat/completions" -H "Authorization: Bearer ${savedKey}" -H "Content-Type: application/json" -d "{\\"model\\":\\"gpt-5.4\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Xin chao!\\"}]}"`}
                        </pre>
                      </div>

                      <div className="pt-3 border-t border-border/40">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-text-main">🍎 Trên Mac / Linux / Git Bash:</span>
                          <button
                            onClick={() => copyText(`curl ${apiOrigin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "gpt-5.4",\n    "messages": [{"role": "user", "content": "Xin chào!"}]\n  }'`, "cmdTestCurlMac")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "cmdTestCurlMac" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "cmdTestCurlMac" ? "Đã copy!" : "Copy lệnh Mac/Linux"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "Xin chào!"}]
  }'`}
                        </pre>
                      </div>
                    </div>
                  </Card>

                  <Card title="⚙️ Thông số kết nối API cơ bản" icon="api">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Sử dụng các thông số dưới đây để cấu hình thủ công hoặc điền vào các công cụ lập trình hỗ trợ Custom Base URL:</p>
                      <div className="bg-surface-2 border border-border rounded-lg p-4 space-y-3 text-text-main">
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2">
                          <div>
                            <strong>Base URL (Endpoint):</strong>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono">{apiOrigin}/v1</code>
                          </div>
                          <button
                            onClick={() => copyText(`${apiOrigin}/v1`, "urlBaseCodex")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "urlBaseCodex" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "urlBaseCodex" ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-border/40 pb-2">
                          <div>
                            <strong>API Key:</strong>
                            <code className="bg-surface px-2 py-0.5 rounded border border-border text-xs ml-2 font-mono">{savedKey}</code>
                          </div>
                          <button
                            onClick={() => copyText(savedKey, "keyBaseCodex")}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "keyBaseCodex" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "keyBaseCodex" ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                        <div className="space-y-1 text-xs text-text-muted">
                          <div>
                            <strong>Model Codex (ChatGPT-backed):</strong> <code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main font-mono">gpt-5.5</code>
                          </div>
                          <div className="mt-1">
                            <strong>Model AntiGravity (Khuyên dùng):</strong> <code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main font-mono">ag/gemini-3.8-flash-high</code> (hoặc <code className="bg-surface px-1.5 py-0.5 rounded border border-border text-text-main font-mono">gpt-5.4</code>)
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="💻 Cấu hình trên Codex Desktop App / IDE" icon="laptop_mac">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng ứng dụng Codex Desktop App và tự động bypass màn hình login:</p>
                      <div>
                        <p className="text-xs mb-2 font-semibold text-text-main">1. Tìm hoặc tạo thư mục cấu hình của Codex:</p>
                        <ul className="list-disc pl-5 text-xs mb-3 space-y-1">
                          <li><strong>Windows</strong>: <code>%USERPROFILE%\.codex\config.toml</code> (Ví dụ: <code>C:\Users\tên_user\.codex\config.toml</code>)</li>
                          <li><strong>Mac / Linux</strong>: <code>~/.codex/config.toml</code></li>
                        </ul>

                        <div className="space-y-4">
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-xs font-semibold text-text-main">Cấu hình file config.toml cho model Codex (gpt-5.5):</span>
                              <button
                                onClick={() => copyText(`model_reasoning_effort = \"low\"\nmodel_provider = \"openai-custom\"\nmodel = \"gpt-5.5\"\n\n[model_providers.openai-custom]\nexperimental_bearer_token = \"${savedKey}\"\nname = \"VinAi\"\nbase_url = \"${apiOrigin}/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nsupports_websockets = false`, "tomlConfigCodex")}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {copiedField === "tomlConfigCodex" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "tomlConfigCodex" ? "Đã copy" : "Copy"}
                              </button>
                            </div>
                            <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`}
                            </pre>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-xs font-semibold text-text-main">Cấu hình file config.toml cho model AntiGravity (gpt-5.4):</span>
                              <button
                                onClick={() => copyText(`model_reasoning_effort = \"low\"\nmodel_provider = \"openai-custom\"\nmodel = \"gpt-5.4\"\n\n[model_providers.openai-custom]\nexperimental_bearer_token = \"${savedKey}\"\nname = \"VinAi\"\nbase_url = \"${apiOrigin}/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nsupports_websockets = false`, "tomlConfigAG")}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {copiedField === "tomlConfigAG" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "tomlConfigAG" ? "Đã copy" : "Copy"}
                              </button>
                            </div>
                            <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.4"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false`}
                            </pre>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/40">
                        <div className="flex justify-between items-center mb-1.5">
                          <p className="text-xs font-semibold text-text-main">2. Tạo tiếp file auth.json trong cùng thư mục để bypass login:</p>
                          <button
                            onClick={() => copyText(`{\n  \"auth_mode\": \"apikey\",\n  \"OPENAI_API_KEY\": \"${savedKey}\"\n}`, "authConfigCodex")}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "authConfigCodex" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "authConfigCodex" ? "Đã copy" : "Copy"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "${savedKey}"
}`}
                        </pre>
                      </div>

                      <p className="text-xs italic text-text-muted bg-surface-2 p-2.5 rounded-lg border border-border/60">
                        💡 Lưu ý: Tắt hoàn toàn ứng dụng <strong>Codex Desktop App</strong> và mở lại để áp dụng cấu hình mới. Cả 2 cách cấu hình trên đều gọi trực tiếp về hệ thống Codex của bạn.
                      </p>
                    </div>
                  </Card>

                  <Card title="🚀 Cấu hình trên Cursor / Cline / RooCode / VS Code Extensions" icon="rocket">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Bạn có thể sử dụng trực tiếp khóa API này trên các IDE phổ biến để gọi model qua Gateway:</p>
                      
                      <div className="space-y-3">
                        <h4 className="font-semibold text-text-main text-xs">Cấu hình chung:</h4>
                        <div className="bg-surface-2 border border-border rounded-lg p-3 space-y-2.5">
                          <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                            <div>
                              <strong>Provider:</strong> <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main">OpenAI Compatible</code> <span className="text-text-muted">(hoặc Custom OpenAI)</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between flex-wrap gap-2 text-xs pt-2 border-t border-border/40">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <strong>Base URL:</strong> <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main truncate max-w-[280px] sm:max-w-[400px]">{apiOrigin}/v1</code>
                            </div>
                            <button
                              onClick={() => copyText(`${apiOrigin}/v1`, "cursorBaseUrl")}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedField === "cursorBaseUrl" ? "check" : "content_copy"}
                              </span>
                              {copiedField === "cursorBaseUrl" ? "Đã copy" : "Copy"}
                            </button>
                          </div>

                          <div className="flex items-center justify-between flex-wrap gap-2 text-xs pt-2 border-t border-border/40">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                              <strong>API Key:</strong> <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main truncate max-w-[280px] sm:max-w-[400px]">{savedKey}</code>
                            </div>
                            <button
                              onClick={() => copyText(savedKey, "cursorApiKey")}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedField === "cursorApiKey" ? "check" : "content_copy"}
                              </span>
                              {copiedField === "cursorApiKey" ? "Đã copy" : "Copy"}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 pt-3 border-t border-border/40">
                        <h4 className="font-semibold text-text-main text-xs">Lựa chọn Model ID (Có nút Copy):</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col justify-between gap-2">
                            <div>
                              <strong className="text-xs text-text-main block mb-1">Model Codex (ChatGPT-backed)</strong>
                              <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">gpt-5.5</code></span>
                            </div>
                            <button
                              onClick={() => copyText("gpt-5.5", "modelCodex55")}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors self-start"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedField === "modelCodex55" ? "check" : "content_copy"}
                              </span>
                              {copiedField === "modelCodex55" ? "Đã copy gpt-5.5" : "Copy gpt-5.5"}
                            </button>
                          </div>

                          <div className="bg-surface-2 border border-border rounded-lg p-3 flex flex-col justify-between gap-2">
                            <div>
                              <strong className="text-xs text-text-main block mb-1">Model AntiGravity (Khuyên dùng)</strong>
                              <span className="text-xs text-text-muted">Model ID: <code className="bg-surface px-1.5 py-0.5 rounded border border-border font-mono text-text-main font-semibold">ag/gemini-3.8-flash-high</code></span>
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                              <button
                                onClick={() => copyText("ag/gemini-3.8-flash-high", "modelAGFlash")}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {copiedField === "modelAGFlash" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "modelAGFlash" ? "Đã copy" : "Copy ag/gemini-3.8-flash-high"}
                              </button>
                              <button
                                onClick={() => copyText("ag/claude-sonnet-4-6", "modelAGSonnetCodex")}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {copiedField === "modelAGSonnetCodex" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "modelAGSonnetCodex" ? "Đã copy" : "Copy ag/claude-sonnet-4-6"}
                              </button>
                              <button
                                onClick={() => copyText("gpt-5.4", "modelGpt54")}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {copiedField === "modelGpt54" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "modelGpt54" ? "Đã copy" : "Copy gpt-5.4"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card title="🤖 Hướng dẫn Cài đặt & Kết nối Codex CLI" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Codex CLI cho phép bạn chạy mô hình AI trực tiếp trong Terminal của máy tính. Dưới đây là hướng dẫn cài đặt và kết nối 1-Click về máy chủ 9Router:</p>

                      <div className="space-y-4">
                        {/* Bước 1: Cài đặt */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <strong className="text-xs text-text-main flex items-center gap-1.5">
                              📥 Bước 1: Cài đặt Codex CLI toàn cục (Global)
                            </strong>
                            <button
                              onClick={() => copyText("npm install -g @openai/codex", "installCodexCliOnly")}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-white hover:opacity-90 text-xs font-semibold cursor-pointer transition-opacity"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedField === "installCodexCliOnly" ? "check" : "content_copy"}
                              </span>
                              {copiedField === "installCodexCliOnly" ? "Đã copy!" : "Copy lệnh cài đặt"}
                            </button>
                          </div>
                          <p className="text-xs text-text-muted">Mở Terminal/PowerShell và chạy lệnh dưới đây để cài đặt Codex CLI:</p>
                          <pre className="bg-surface border border-border rounded p-2.5 text-xs font-mono text-text-main">
npm install -g @openai/codex
                          </pre>
                        </div>

                        {/* Bước 2: Cấu hình kết nối */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 space-y-3">
                          <strong className="text-xs text-text-main block">
                            ⚙️ Bước 2: Cấu hình 1-Click tự động kết nối với Server 9Router
                          </strong>
                          
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-xs font-semibold text-text-main">🔷 Trên Windows (Mở PowerShell dán lệnh này):</span>
                              <button
                                onClick={() => copyText(`mkdir -Force $env:USERPROFILE\\.codex; Set-Content $env:USERPROFILE\\.codex\\config.toml "model_reasoning_effort = \`"low\`"\`nmodel_provider = \`"openai-custom\`"\`nmodel = \`"gpt-5.5\`"\`n\`n[model_providers.openai-custom]\`nexperimental_bearer_token = \`"${savedKey}\`"\`nname = \`"VinAi\`"\`nbase_url = \`"${apiOrigin}/v1\`"\`nwire_api = \`"responses\`"\`nrequires_openai_auth = false\`nsupports_websockets = false"; Set-Content $env:USERPROFILE\\.codex\\auth.json '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}'`, "cmdPsCodexCli")}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {copiedField === "cmdPsCodexCli" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "cmdPsCodexCli" ? "Đã copy!" : "Copy PowerShell"}
                              </button>
                            </div>
                            <pre className="bg-surface border border-border rounded p-2.5 text-xs font-mono text-text-main whitespace-pre-wrap break-all">
{`mkdir -Force $env:USERPROFILE\\.codex; Set-Content $env:USERPROFILE\\.codex\\config.toml "model_reasoning_effort = \`"low\`"\`nmodel_provider = \`"openai-custom\`"\`nmodel = \`"gpt-5.5\`"\`n\`n[model_providers.openai-custom]\`nexperimental_bearer_token = \`"${savedKey}\`"\`nname = \`"VinAi\`"\`nbase_url = \`"${apiOrigin}/v1\`"\`nwire_api = \`"responses\`"\`nrequires_openai_auth = false\`nsupports_websockets = false"; Set-Content $env:USERPROFILE\\.codex\\auth.json '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}'`}
                            </pre>
                          </div>

                          <div className="pt-2 border-t border-border/40">
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-xs font-semibold text-text-main">🍎 Trên Mac / Linux (Mở Terminal dán lệnh này):</span>
                              <button
                                onClick={() => copyText(`mkdir -p ~/.codex && cat << 'EOF' > ~/.codex/config.toml\nmodel_reasoning_effort = "low"\nmodel_provider = "openai-custom"\nmodel = "gpt-5.5"\n\n[model_providers.openai-custom]\nexperimental_bearer_token = "${savedKey}"\nname = "VinAi"\nbase_url = "${apiOrigin}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nEOF\necho '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}' > ~/.codex/auth.json`, "cmdBashCodexCli")}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                              >
                                <span className="material-symbols-outlined text-[13px]">
                                  {copiedField === "cmdBashCodexCli" ? "check" : "content_copy"}
                                </span>
                                {copiedField === "cmdBashCodexCli" ? "Đã copy!" : "Copy Mac/Linux"}
                              </button>
                            </div>
                            <pre className="bg-surface border border-border rounded p-2.5 text-xs font-mono text-text-main">
{`mkdir -p ~/.codex && cat << 'EOF' > ~/.codex/config.toml
model_reasoning_effort = "low"
model_provider = "openai-custom"
model = "gpt-5.5"

[model_providers.openai-custom]
experimental_bearer_token = "${savedKey}"
name = "VinAi"
base_url = "${apiOrigin}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
EOF
echo '{"auth_mode":"apikey","OPENAI_API_KEY":"${savedKey}"}' > ~/.codex/auth.json`}
                            </pre>
                          </div>
                        </div>

                        {/* Bước 3: Sử dụng */}
                        <div className="bg-surface-2 border border-border rounded-lg p-3.5 space-y-2">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <strong className="text-xs text-text-main flex items-center gap-1.5">
                              🚀 Bước 3: Khởi chạy Codex CLI
                            </strong>
                            <button
                              onClick={() => copyText('codex "Viết một hàm Node.js kết nối Supabase"', "runCodexExample")}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer transition-colors"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {copiedField === "runCodexExample" ? "check" : "content_copy"}
                              </span>
                              {copiedField === "runCodexExample" ? "Đã copy" : "Copy ví dụ"}
                            </button>
                          </div>
                          <p className="text-xs text-text-muted">Bây giờ bạn có thể gõ câu hỏi trực tiếp cho AI ngay trên Terminal:</p>
                          <pre className="bg-surface border border-border rounded p-2.5 text-xs font-mono text-text-main">
codex "Viết một hàm Node.js kết nối Supabase"
                          </pre>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              

              {guideTab === "openclaw" && (
                <div className="space-y-6 animate-fade-in">
                  <Card title="🛠️ 1. Cấu hình tự động từ Dashboard" icon="construction">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Nếu bạn cài đặt OpenClaw cục bộ trên cùng máy chủ với 9Router:</p>
                      <ul className="list-disc pl-5 space-y-1 text-text-muted">
                        <li>Truy cập vào giao diện quản trị 9Router: <strong>Dashboard</strong> → <strong>CLI Tools</strong> → <strong>OpenClaw</strong>.</li>
                        <li>Chọn mô hình bạn mong muốn sử dụng và nhấn <strong>Áp dụng</strong>. Hệ thống sẽ tự động ghi đè tệp cấu hình của OpenClaw một cách chính xác.</li>
                      </ul>
                    </div>
                  </Card>

                  <Card title="💻 2. Cài đặt và Cấu hình thủ công" icon="laptop_mac">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <div>
                        <p className="text-xs mb-2">1. Tìm hoặc tạo tệp cấu hình của OpenClaw tùy theo hệ điều hành:</p>
                        <ul className="list-disc pl-5 text-xs mb-2 space-y-1">
                          <li><strong>Windows</strong>: <code>%USERPROFILE%\.openclaw\openclaw.json</code> (Ví dụ: <code>C:\Users\tên_user\.openclaw\openclaw.json</code>)</li>
                          <li><strong>Mac / Linux</strong>: <code>~/.openclaw/openclaw.json</code></li>
                        </ul>
                        <p className="text-xs mb-2">2. Chỉnh sửa tệp <code>openclaw.json</code> và dán nội dung cấu hình nhà cung cấp <code>9router</code> vào phần <code>models.providers</code>:</p>
                        <div className="relative bg-surface-2 border border-border rounded-lg p-3 font-mono text-xs text-text-main overflow-x-auto pr-12">
                          <pre>{`{
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "${apiOrigin}/v1",
        "apiKey": "${savedKey}",
        "api": "openai-completions",
        "models": [
          { "id": "ag/gemini-3.8-flash-high", "name": "ag/gemini-3.8-flash-high" },
          { "id": "ag/claude-sonnet-4-6", "name": "ag/claude-sonnet-4-6" },
          { "id": "ag/gpt-oss-120b-medium", "name": "ag/gpt-oss-120b-medium" },
          { "id": "gpt-5.4", "name": "gpt-5.4" },
          { "id": "gpt-5.5", "name": "gpt-5.5" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/ag/gemini-3.8-flash-high"
      },
      "models": {
        "9router/ag/gemini-3.8-flash-high": {},
        "9router/ag/claude-sonnet-4-6": {},
        "9router/gpt-5.4": {},
        "9router/gpt-5.5": {}
      }
    }
  }
}`}</pre>
                          <button
                            onClick={() => copyText(`{\n  "models": {\n    "providers": {\n      "9router": {\n        "baseUrl": "${apiOrigin}/v1",\n        "apiKey": "${savedKey}",\n        "api": "openai-completions",\n        "models": [\n          { "id": "ag/gemini-3.8-flash-high", "name": "ag/gemini-3.8-flash-high" },\n          { "id": "ag/claude-sonnet-4-6", "name": "ag/claude-sonnet-4-6" },\n          { "id": "ag/gpt-oss-120b-medium", "name": "ag/gpt-oss-120b-medium" },\n          { "id": "gpt-5.4", "name": "gpt-5.4" },\n          { "id": "gpt-5.5", "name": "gpt-5.5" }\n        ]\n      }\n    }\n  },\n  "agents": {\n    "defaults": {\n      "model": {\n        "primary": "9router/ag/gemini-3.8-flash-high"\n      },\n      "models": {\n        "9router/ag/gemini-3.8-flash-high": {},\n        "9router/ag/claude-sonnet-4-6": {},\n        "9router/gpt-5.4": {},\n        "9router/gpt-5.5": {}\n      }\n    }\n  }\n}`, "jsonConfigOpenClaw")}
                            className="absolute right-3 top-3 p-1 bg-surface hover:bg-surface-3 rounded border border-border cursor-pointer"
                            title="Copy cấu hình openclaw.json"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedField === "jsonConfigOpenClaw" ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </div>
                      <p className="text-xs">3. Khởi động lại <strong>OpenClaw CLI</strong> để áp dụng cấu hình mới.</p>
                    </div>
                  </Card>
                </div>
              )}

              {guideTab === "gemini" && (
                <div className="space-y-6 animate-fade-in">
                  <Card title="🧪 Kiểm tra kết nối nhanh trên Terminal (Quick Test cURL)" icon="terminal">
                    <div className="space-y-3 text-sm text-text-muted mt-2">
                      <p>Copy lệnh cURL này dán vào Terminal để test gọi trực tiếp model <strong>ag/gemini-3.8-flash-high</strong>:</p>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-text-main">Lệnh cURL Quick Test:</span>
                        <button
                          onClick={() => copyText(`curl ${apiOrigin}/v1/chat/completions \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "ag/gemini-3.8-flash-high",\n    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối API Gateway."}]\n  }'`, "cmdTestCurlGemini")}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border hover:bg-surface-3 text-xs font-medium cursor-pointer transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedField === "cmdTestCurlGemini" ? "check" : "content_copy"}
                          </span>
                          {copiedField === "cmdTestCurlGemini" ? "Đã copy!" : "Copy Test cURL"}
                        </button>
                      </div>
                      <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${apiOrigin}/v1/chat/completions \\
  -H "Authorization: Bearer ${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối API Gateway."}]
  }'`}
                      </pre>
                    </div>
                  </Card>

                  <Card title="🐍 Tích hợp trực tiếp bằng Code (Python & Node.js)" icon="code">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <p>Sử dụng OpenAI SDK hoặc Google GenAI SDK để gọi trực tiếp các model AntiGravity:</p>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main text-xs">Option 1: Sử dụng OpenAI SDK (Python - Khuyên dùng):</span>
                          <button
                            onClick={() => {
                              const code = `import openai\n\nclient = openai.OpenAI(\n    base_url="${apiOrigin}/v1",\n    api_key="${savedKey}"\n)\n\nresponse = client.chat.completions.create(\n    model="ag/gemini-3.8-flash-high",\n    messages=[{"role": "user", "content": "Xin chào! Bạn là ai?"}]\n)\nprint(response.choices[0].message.content)`;
                              copyText(code, "codePythonGeminiOpenAI");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "codePythonGeminiOpenAI" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "codePythonGeminiOpenAI" ? "Đã copy!" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`import openai

client = openai.OpenAI(
    base_url="${apiOrigin}/v1",
    api_key="${savedKey}"
)

response = client.chat.completions.create(
    model="ag/gemini-3.8-flash-high",
    messages=[{"role": "user", "content": "Xin chào! Bạn là ai?"}]
)
print(response.choices[0].message.content)`}
                        </pre>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main text-xs">Option 2: Sử dụng OpenAI SDK (Node.js / TypeScript):</span>
                          <button
                            onClick={() => {
                              const code = `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${apiOrigin}/v1",\n  apiKey: "${savedKey}"\n});\n\nconst response = await client.chat.completions.create({\n  model: "ag/gemini-3.8-flash-high",\n  messages: [{ role: "user", content: "Xin chào!" }]\n});\nconsole.log(response.choices[0].message.content);`;
                              copyText(code, "codeNodeGeminiOpenAI");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "codeNodeGeminiOpenAI" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "codeNodeGeminiOpenAI" ? "Đã copy!" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${apiOrigin}/v1",
  apiKey: "${savedKey}"
});

const response = await client.chat.completions.create({
  model: "ag/gemini-3.8-flash-high",
  messages: [{ role: "user", content: "Xin chào!" }]
});
console.log(response.choices[0].message.content);`}
                        </pre>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main text-xs">Option 3: Sử dụng Google GenAI SDK (Python):</span>
                          <button
                            onClick={() => {
                              const code = `from google import genai\n\nclient = genai.Client(\n    api_key="${savedKey}",\n    http_options={"api_endpoint": "${origin}"}\n)\n\nresponse = client.models.generate_content(\n    model="ag/gemini-3.8-flash-high",\n    contents="Xin chào! Bạn là ai?"\n)\nprint(response.text)`;
                              copyText(code, "codePythonGeminiSDK");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "codePythonGeminiSDK" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "codePythonGeminiSDK" ? "Đã copy!" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`from google import genai

client = genai.Client(
    api_key="${savedKey}",
    http_options={"api_endpoint": "${origin}"}
)

response = client.models.generate_content(
    model="ag/gemini-3.8-flash-high",
    contents="Xin chào! Bạn là ai?"
)
print(response.text)`}
                        </pre>
                      </div>
                    </div>
                  </Card>

                  <Card title="📡 Gọi qua REST API (cURL)" icon="terminal">
                    <div className="space-y-4 text-sm text-text-muted mt-2">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main text-xs">Option 1: Gọi qua định dạng OpenAI Chat Completions:</span>
                          <button
                            onClick={() => {
                              const code = `curl ${apiOrigin}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${savedKey}" \\\n  -d '{\n    "model": "ag/gemini-3.8-flash-high",\n    "messages": [{"role": "user", "content": "Xin chào!"}]\n  }'`;
                              copyText(code, "curlGeminiOpenAI");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "curlGeminiOpenAI" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "curlGeminiOpenAI" ? "Đã copy!" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl ${apiOrigin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${savedKey}" \\
  -d '{
    "model": "ag/gemini-3.8-flash-high",
    "messages": [{"role": "user", "content": "Xin chào!"}]
  }'`}
                        </pre>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-text-main text-xs">Option 2: Gọi qua REST API Gemini gốc (cURL):</span>
                          <button
                            onClick={() => {
                              const code = `curl -X POST "${apiOrigin}/v1beta/models/ag/gemini-3.8-flash-high:streamGenerateContent?key=${savedKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "contents": [{"parts": [{"text": "Hello!"}]}]\n  }'`;
                              copyText(code, "curlGeminiREST");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-border hover:bg-surface-3 text-xs cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {copiedField === "curlGeminiREST" ? "check" : "content_copy"}
                            </span>
                            {copiedField === "curlGeminiREST" ? "Đã copy" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="bg-surface-2 border border-border rounded-lg p-3 text-xs overflow-x-auto text-text-main font-mono">
{`curl -X POST "${apiOrigin}/v1beta/models/ag/gemini-3.8-flash-high:streamGenerateContent?key=${savedKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"parts": [{"text": "Hello!"}]}]
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
