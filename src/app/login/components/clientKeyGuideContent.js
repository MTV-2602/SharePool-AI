/**
 * Client Key Guide Content Generator (Pure Logic)
 *
 * Generates dynamic, model-tailored integration guides, markdown files,
 * and code snippets based strictly on permitted catalog models.
 * No hardcoded fallback models or secrets leakage.
 */

import {
  isCodexModel,
  parseModelAllowlist,
} from "../../../lib/auth/clientModelPolicy.js";

/**
 * Sanitize model ID: returns exact original string if safe, or empty string.
 * Strictly rejects quotes, backticks, backslashes, CR, LF, $, whitespace,
 * and command injection metacharacters. Does not mutate or trim unsafe IDs.
 */
export function sanitizeModelId(modelId) {
  if (typeof modelId !== "string") return "";
  if (/^[a-zA-Z0-9_.:/()\[\]-]+$/.test(modelId)) {
    return modelId;
  }
  return "";
}

/**
 * Sanitize human-readable label for safe markdown output
 */
export function sanitizeLabel(label) {
  if (typeof label !== "string") return "";
  return label.replace(/[\r\n`\\]/g, "").trim();
}

/**
 * Sanitize and validate API key for code snippets.
 * Returns 'YOUR_API_KEY' if omitted, placeholder is requested, or empty.
 * Rejects newlines, carriage returns, quotes, backslashes, and control characters to prevent code injection.
 */
export function sanitizeApiKey(key, { placeholder = false } = {}) {
  if (placeholder || key === null || key === undefined || key === "") {
    return "YOUR_API_KEY";
  }
  if (typeof key !== "string") {
    throw new Error("Khóa API phải là chuỗi ký tự");
  }
  // Check for raw C0 controls (\x00-\x1F) and DEL (\x7F) before trimming
  if (/[\x00-\x1F\x7F]/.test(key)) {
    throw new Error("Khóa API chứa ký tự xuống dòng hoặc điều khiển không an toàn");
  }
  const trimmed = key.trim();
  if (trimmed === "" || trimmed === "YOUR_API_KEY") {
    return "YOUR_API_KEY";
  }
  if (/[\x00-\x1F\x7F"'`\\<>]/.test(trimmed)) {
    throw new Error("Khóa API chứa ký tự không an toàn (newline, quotes hoặc escape)");
  }
  if (!/^[a-zA-Z0-9_\-.:+=/]+$/.test(trimmed)) {
    throw new Error("Khóa API chứa ký tự không hợp lệ");
  }
  return trimmed;
}

/**
 * Sanitize and validate API origin URL.
 * Rejects raw CRLF, credentials/userinfo, query strings, hashes, and non-slash paths.
 * Enforces http or https protocol and returns clean normalized origin.
 */
export function sanitizeOrigin(origin) {
  if (origin === null || origin === undefined || origin === "") {
    return "http://localhost:20127";
  }
  if (typeof origin !== "string") {
    throw new Error("Địa chỉ máy chủ (origin) phải là chuỗi ký tự");
  }
  // Check for raw C0 controls (\x00-\x1F) and DEL (\x7F) before trimming
  if (/[\x00-\x1F\x7F]/.test(origin)) {
    throw new Error("Địa chỉ máy chủ (origin) chứa ký tự xuống dòng hoặc điều khiển không an toàn");
  }
  const trimmed = origin.trim();
  if (trimmed === "") {
    return "http://localhost:20127";
  }
  if (/[\x00-\x1F\x7F"'`\\<>]/.test(trimmed)) {
    throw new Error("Địa chỉ máy chủ (origin) chứa ký tự không an toàn");
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Địa chỉ máy chủ không đúng định dạng URL hợp lệ");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Giao thức của địa chỉ máy chủ phải là http hoặc https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Địa chỉ máy chủ (origin) không được chứa thông tin xác thực (userinfo)");
  }
  if (parsed.search) {
    throw new Error("Địa chỉ máy chủ (origin) không được chứa chuỗi truy vấn (query)");
  }
  if (parsed.hash) {
    throw new Error("Địa chỉ máy chủ (origin) không được chứa thẻ định danh (hash)");
  }
  if (!/^\/*$/.test(parsed.pathname)) {
    throw new Error("Địa chỉ máy chủ (origin) không được chứa đường dẫn con (path)");
  }
  return parsed.origin;
}

/**
 * Formats a friendly policy description for the user
 */
export function describePolicy(rawPolicy) {
  if (rawPolicy === null || rawPolicy === undefined) {
    return {
      type: "missing",
      summary: "Chưa cấu hình chính sách (Bị vô hiệu hóa)",
      details: ["Khóa này chưa có thông tin chính sách mô hình hợp lệ."],
      isBlocked: true,
      rules: [],
    };
  }

  let policy;
  if (typeof rawPolicy === "object" && rawPolicy !== null) {
    if ("unrestricted" in rawPolicy || "rules" in rawPolicy || "malformed" in rawPolicy) {
      policy = rawPolicy;
    } else {
      policy = parseModelAllowlist(rawPolicy);
    }
  } else {
    policy = parseModelAllowlist(rawPolicy);
  }

  // Type validation: fail closed on malformed policy shapes
  if (policy.unrestricted !== undefined && typeof policy.unrestricted !== "boolean") {
    return {
      type: "malformed",
      summary: "Chính sách không hợp lệ (Bị vô hiệu hóa)",
      details: ["Trường unrestricted trong chính sách phải là kiểu boolean."],
      isBlocked: true,
      rules: [],
    };
  }

  if (policy.rules !== undefined && !Array.isArray(policy.rules)) {
    return {
      type: "malformed",
      summary: "Chính sách không hợp lệ (Bị vô hiệu hóa)",
      details: ["Danh sách rules trong chính sách phải là một mảng."],
      isBlocked: true,
      rules: [],
    };
  }

  if (policy.malformed) {
    return {
      type: "malformed",
      summary: "Chính sách không hợp lệ (Bị vô hiệu hóa)",
      details: [policy.error || "Cú pháp danh sách mô hình bị lỗi"],
      isBlocked: true,
      rules: [],
    };
  }

  if (policy.unrestricted === true) {
    return {
      type: "unrestricted",
      summary: "Toàn bộ mô hình (Không giới hạn)",
      details: ["Khóa này có quyền truy cập tất cả các mô hình trong hệ thống."],
      isBlocked: false,
      rules: [],
    };
  }

  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  if (rules.length === 0) {
    return {
      type: "empty",
      summary: "Chưa cấu hình mô hình",
      details: ["Khóa này chưa được gán bất kỳ quyền truy cập mô hình nào."],
      isBlocked: true,
      rules: [],
    };
  }

  const details = rules.map((rule) => {
    const clean = String(rule).trim().toLowerCase();
    if (clean === "family:claude" || clean === "claude/*" || clean === "claude") {
      return "Dòng Claude (Anthropic / Claude Code / Cursor)";
    }
    if (clean === "family:gemini" || clean === "gemini/*" || clean === "gemini") {
      return "Dòng Gemini (Google / AntiGravity)";
    }
    if (clean === "family:codex" || clean === "codex/*" || clean === "cx/*" || clean === "codex") {
      return "Dòng Codex (ChatGPT Plus/Pro / Codex CLI)";
    }
    return `Mô hình: ${rule}`;
  });

  return {
    type: "restricted",
    summary: `Giới hạn (${rules.length} quy tắc)`,
    details,
    isBlocked: false,
    rules,
  };
}

/**
 * Select the first valid model in server order.
 * No hardcoded preferred models, heuristics, or bias.
 */
export function selectDefaultModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;

  for (const m of models) {
    const rawId = typeof m === "string" ? m : m?.id || m?.name;
    if (typeof rawId === "string") {
      const sanitized = sanitizeModelId(rawId);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  return null;
}

/**
 * Generate code snippets for a chosen model and API origin.
 * Sanitizes API key and origin URL against injection attacks.
 * Uses signed-in apiKey when provided, or 'YOUR_API_KEY' when placeholder is true or key omitted.
 * Infers provider directly from selectedModel prefix if not explicitly provided.
 */
export function generateCodeSnippets({
  selectedModel,
  provider,
  apiOrigin = "http://localhost:20127",
  apiKey = "YOUR_API_KEY",
  placeholder = false,
} = {}) {
  const model = sanitizeModelId(selectedModel);
  if (!model) return null;

  const safeOrigin = sanitizeOrigin(apiOrigin);
  const keyToUse = sanitizeApiKey(apiKey, { placeholder });
  const baseUrl = `${safeOrigin}/v1`;

  // Infer provider directly from prefix if provider is not provided
  let effectiveProvider = provider;
  let bareModel = model;
  if (model.includes("/")) {
    const parts = model.split("/");
    if (!effectiveProvider) {
      effectiveProvider = parts[0];
    }
    bareModel = parts.slice(1).join("/");
  }

  // Codex CLI & Desktop App configuration is available for all permitted catalog models
  // (Codex, Gemini, combo, Claude, etc.) through the gateway Responses API translation
  // (wire_api = "responses"). Not gated by isCodexModel naming.
  const isCodex = true;

  const curlChat = `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${keyToUse}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Xin chào! Kiểm tra kết nối AI Gateway."}]
  }'`;

  const pythonSdk = `import openai

client = openai.OpenAI(
    base_url="${baseUrl}",
    api_key="${keyToUse}"
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Xin chào AI Gateway!"}]
)

print(response.choices[0].message.content)`;

  const nodeSdk = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${keyToUse}",
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Xin chào AI Gateway!" }],
});

console.log(response.choices[0].message.content);`;

  const codexToml = `model = "${model}"
model_provider = "ainoname"

[model_providers.ainoname]
name = "ainoname"
base_url = "${baseUrl}"
wire_api = "responses"

[model_providers.ainoname.http_headers]
Authorization = "Bearer ${keyToUse}"

[agents]
default_subagent_model = "${model}"`;

  return {
    model,
    baseUrl,
    keyToUse,
    isCodex,
    curlChat,
    pythonSdk,
    nodeSdk,
    codexToml,
  };
}

/**
 * Generate full Markdown document for viewing, copying, or downloading.
 * Validates policy and catalog strictly.
 * Embeds signed-in key when provided (with private key security notice), or placeholder if requested.
 */
export function generateFullMarkdown({
  selectedModel,
  provider,
  apiOrigin = "http://localhost:20127",
  apiKey = "YOUR_API_KEY",
  keyLabel = "",
  policy,
  models = [],
  forDownload = false,
  placeholder = false,
} = {}) {
  // Always evaluate policy; missing or blocked throws
  const policyDesc = describePolicy(policy);
  if (policyDesc.isBlocked) {
    throw new Error(`Chính sách mô hình không hợp lệ hoặc bị khóa: ${policyDesc.summary}`);
  }

  // Validate catalog nonempty
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Danh mục mô hình trống, không thể tạo hướng dẫn");
  }

  const validCatalogIds = models
    .map((m) => (typeof m === "string" ? m : m?.id || m?.name))
    .map((id) => (typeof id === "string" ? sanitizeModelId(id) : ""))
    .filter(Boolean);

  if (validCatalogIds.length === 0) {
    throw new Error("Danh mục mô hình không chứa mô hình hợp lệ");
  }

  if (typeof selectedModel !== "string" || !selectedModel) {
    throw new Error("Mô hình không được để trống");
  }

  const sanitizedSelected = sanitizeModelId(selectedModel);
  if (!sanitizedSelected || sanitizedSelected !== selectedModel) {
    throw new Error(`Mã mô hình '${selectedModel}' không hợp lệ hoặc chứa ký tự không an toàn`);
  }

  if (!validCatalogIds.includes(sanitizedSelected)) {
    throw new Error(`Mô hình '${selectedModel}' không tồn tại trong danh mục được phép`);
  }

  const model = sanitizedSelected;

  let effectiveProvider = provider;
  if (!effectiveProvider && model.includes("/")) {
    effectiveProvider = model.split("/")[0];
  }

  const snippets = generateCodeSnippets({
    selectedModel: model,
    provider: effectiveProvider,
    apiOrigin,
    apiKey,
    placeholder,
  });

  if (!snippets) {
    throw new Error("Không thể tạo nội dung hướng dẫn cho mô hình này");
  }

  const safeLabel = sanitizeLabel(keyLabel);
  const labelLine = safeLabel ? `\n- **Khóa**: \`${safeLabel}\`` : "";
  const allowedList = validCatalogIds.slice(0, 10).map((id) => `\`${id}\``).join(", ");

  let doc = `# ainoname — Hướng dẫn tích hợp AI Gateway
${labelLine}
- **Base URL**: \`${snippets.baseUrl}\`
- **Mô hình cấu hình**: \`${model}\`
- **Chính sách**: ${policyDesc.summary}
- **Mô hình khả dụng tiêu biểu**: ${allowedList}

> ⚠️ **Bảo mật**: Tệp này chứa khóa API riêng tư (private key). Vui lòng bảo mật tệp và không chia sẻ hoặc tải lên kho lưu trữ mã nguồn công khai.

---

## 1. Thông số kết nối API (OpenAI Compatible)
- **Base URL**: \`${snippets.baseUrl}\`
- **API Key**: \`${snippets.keyToUse}\`
- **Model ID**: \`${model}\`

---

## 2. Cấu hình trên Cursor / Windsurf / Cline / RooCode
1. Mở cài đặt (Settings) -> Chọn **Models** hoặc **API Provider**.
2. Chọn loại: **OpenAI Compatible** (hoặc Custom OpenAI).
3. Điền các trường:
   - **Base URL**: \`${snippets.baseUrl}\`
   - **API Key**: \`${snippets.keyToUse}\`
4. Thêm mô hình: \`${model}\`

---

## 3. Kiểm tra kết nối nhanh (cURL)
Kiểm tra kết nối cơ bản qua endpoint Chat Completions (lưu ý: kiểm tra này chỉ xác thực reachability và khóa, không thay thế cho việc xác thực giao diện thực tế):
\`\`\`bash
${snippets.curlChat}
\`\`\`

---

## 4. Code mẫu SDK

### Python (OpenAI SDK):
\`\`\`python
${snippets.pythonSdk}
\`\`\`

### Node.js (OpenAI SDK):
\`\`\`javascript
${snippets.nodeSdk}
\`\`\`
`;

  if (snippets.isCodex) {
    doc += `
---

## 5. Cấu hình Codex CLI & Desktop App
Codex là ứng dụng máy khách (client interface) của OpenAI, kết nối đến AI Gateway qua giao thức Responses API (\`wire_api = "responses"\`) tại đường dẫn \`${snippets.baseUrl}\`.
Tài liệu chính thức về Gateway của Codex: https://developers.openai.com/codex/enterprise/connect-to-a-gateway.md

### Cấu hình tệp \`config.toml\`:
*Lưu ý: \`model\` và \`model_provider\` phải đặt ở phần đầu, trước bảng TOML đầu tiên. Khóa xác thực đã được cấu hình trực tiếp trong phần \`http_headers\`.*
\`\`\`toml
${snippets.codexToml}
\`\`\`

<details>
<summary><b>Lưu ý quan trọng & Hướng dẫn định tuyến (Admin / Routing Notes)</b></summary>

- **Phân biệt ứng dụng Codex Client vs Nhà cung cấp / Mô hình thực tế**:
  Codex CLI và Desktop App chỉ đóng vai trò là giao diện máy khách. Mô hình được cấu hình trong tệp (\`${model}\`) là mã định danh công khai gửi tới gateway. AI Gateway có khả năng chuyển đổi giao thức và định tuyến yêu cầu từ Codex client tới các mô hình khác nhau (như Google / AntiGravity Gemini, Anthropic Claude, hoặc các mô hình dự phòng / kết hợp) khi được cấp phép, chứ không giới hạn ở OpenAI GPT.
- **Lưu ý về bí danh và combo (Ví dụ điều kiện về gpt-5.5 / Gemini)**:
  Tên mô hình công khai (ví dụ minh họa: \`gpt-5.5\`) có thể được gateway định tuyến dưới dạng bí danh (alias) hoặc bộ kết hợp (combo) trỏ tới mô hình Gemini của Google / AntiGravity (như \`ag/gemini-3.8-flash-high\`, \`gemini-2.5-flash\`...) hoặc nhà cung cấp khác tùy theo cấu hình hệ thống. Tên gọi này là một ví dụ minh họa về khả năng định tuyến theo cấu hình và không phải là sự đảm bảo rằng yêu cầu sẽ luôn được xử lý bởi OpenAI GPT.
- **Định tuyến tại thời điểm thực thi (Runtime Routing)**:
  Đường dẫn thực tế xử lý yêu cầu được gateway quyết định linh hoạt tại thời điểm thực thi dựa trên tính khả dụng của tài khoản và quy tắc định tuyến của gateway.
- **Quy định cấp phép đích dự phòng (Fallback Targets)**:
  Đối với mô hình dạng combo hoặc có cơ chế tự động chuyển đổi khi lỗi, **tất cả** các mô hình đích dự phòng (fallback targets) đều phải nằm trong danh mục mô hình được cấp phép của khóa (chính sách \`model_policy\`).
- **Tái xác thực khi thay đổi cấu hình combo trong tương lai**:
  Nếu trong tương lai quản trị viên cập nhật cấu hình định tuyến combo (thay đổi hoặc bổ sung thêm đích mới), các yêu cầu tiếp theo sẽ tự động được kiểm tra lại quyền truy cập; nếu đích mới không nằm trong chính sách cấp phép của khóa, yêu cầu sẽ bị từ chối (\`403 model_not_allowed\`).
- **Lệnh /status không phải bằng chứng mô hình thực tế**:
  Lệnh \`/status\` trong Codex CLI chỉ hiển thị tên mô hình công khai đã được cấu hình trong \`config.toml\` (hoặc phản hồi danh nghĩa từ gateway); lệnh này **không phải là bằng chứng** xác nhận mô hình hay nhà cung cấp thực tế đang chạy ở thượng nguồn (actual upstream).
- **Kiểm tra cấu hình Combos vs Tuyến thực thi thực tế (Usage / Key Request Log)**:
  Để kiểm tra các đích được cấu hình trước, xem mục **Combos** trên Dashboard (\`configured targets\`). Để kiểm tra tuyến định tuyến thực tế được chọn khi xử lý yêu cầu, xem thông tin **Actual model** trong nhật ký yêu cầu (Usage / client key request log) hoặc các header phản hồi của gateway như \`x-9r-actual-model\` (mô hình gateway phân giải) và \`x-9r-actual-provider\` (nhà cung cấp chuẩn hóa). Lưu ý: Tuyến phân giải phản ánh quyết định định tuyến của gateway tại thời điểm thực thi, không phải là bảo đảm mã định danh luồng trực tiếp (exact upstream wireID) ở thượng nguồn vì registry nội bộ của nhà cung cấp có thể có cơ chế ánh xạ phiên bản động (dynamic mapping).
- **Không cam kết tương đương tính năng nếu chưa kiểm thử**:
  Việc hỗ trợ giao thức Responses API giúp Codex client kết nối được với nhiều loại mô hình, nhưng không cam kết sự tương đương 100% về tính năng (như gọi công cụ / tool calling, streaming nâng cao, xử lý đa lượt...) giữa các nhà cung cấp hoặc mô hình khác nhau khi chưa có kiểm thử thực tế. Người dùng nên tự kiểm chứng trên công cụ và luồng công việc cụ thể.
- **Hợp nhất thủ công tệp cấu hình**:
  Hợp nhất nội dung dưới đây vào tệp cấu hình Codex của bạn, không tạo trùng lặp bảng cấu hình (tables) hoặc khóa. Vui lòng sao lưu trước khi chỉnh sửa. Không tự động thực thi tệp.
- **Vị trí tệp config.toml**:
  Tệp nằm tại \`~/.codex/config.toml\` (macOS/Linux/WSL) hoặc \`%USERPROFILE%\\.codex\\config.toml\` (Windows). Nếu biến môi trường \`CODEX_HOME\` được thiết lập, đường dẫn là \`$CODEX_HOME/config.toml\`.
- **Dùng chung cấu hình giữa CLI và Desktop App**:
  Codex CLI và Desktop App đọc chung tệp \`config.toml\`. Khởi động lại ứng dụng sau khi cập nhật tệp cấu hình.
- **Metadata mô hình**:
  Các định danh hoặc bí danh tùy chỉnh (như tiền tố \`cx/\`) có thể yêu cầu quản trị viên cung cấp metadata danh mục (catalog) khớp với mô hình và phiên bản Codex đã cài đặt, không phải danh sách \`/v1/models\` thông thường. Không tự ý tạo hoặc chỉ định đường dẫn catalog nếu chưa được cung cấp.

</details>
`;
  }

  return doc;
}
