---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Vinh Pro
- Always write "Vinh Pro" at the end of the response when completing or applying these guidelines (skills) to prove you have read and followed them.

## 6. Auto Git Push (Tự Động Đẩy Code Chuẩn Hóa)
- **Tự động Push:** Sau khi hoàn thành bất kỳ thay đổi nào và kiểm tra hoạt động ổn định, luôn thực hiện commit bằng tiếng Việt và push thay đổi lên Git repository của dự án hiện tại.
- **Quy trình cấu hình tránh bị treo khi Push:**
  Khi bắt đầu làm việc trên bất kỳ repository mới nào, AI phải kiểm tra và thiết lập phương thức push tối ưu theo các bước sau để tránh việc Git bị treo do Credential Manager cố gắng mở hộp thoại đăng nhập UI ẩn trong terminal chạy ngầm:
  1. **Kiểm tra kết nối SSH:** Chạy `ssh -o StrictHostKeyChecking=no -T git@github.com` (hoặc git@gitlab.com tùy dịch vụ).
     - Nếu kết nối SSH thành công (trả về thông báo chào mừng của GitHub/GitLab), cập nhật remote URL sang SSH:
       ```bash
       git remote set-url origin git@github.com:<OWNER>/<REPO>.git
       ```
  2. **Nếu phải dùng HTTPS:**
     - Chạy `git remote -v` để xem URL hiện tại và `git config user.name` để xem username cấu hình.
     - Nếu URL chưa có username, hãy cập nhật lại remote URL chứa username (ví dụ `<USERNAME>@`) để Git tự động lấy thông tin xác thực đã lưu trong Credential Manager của hệ thống mà không yêu cầu tương tác UI:
       ```bash
       git remote set-url origin https://<USERNAME>@github.com/<OWNER>/<REPO>.git
       ```
       *(Nếu không chắc chắn về Username của máy khách, hãy hỏi trực tiếp người dùng trước khi cấu hình).*
- **Quy trình thực hiện đẩy code:**
  ```bash
  git add .
  git commit -m "nội dung commit ngắn gọn bằng tiếng Việt"
  git push origin <tên_nhánh_hiện_tại>
  ```

---

## 7. Quy Tắc Deploy 9Router (KHÔNG BUILD VPS KHI SỬA UI)

> **QUAN TRỌNG:** VPS Oracle chỉ có 952MB RAM. Build 2-3 lần liên tiếp = RAM 91% = VPS chết!

### 🟢 Chỉ sửa UI / text / CSS → CHỈ GIT PUSH, KHÔNG ĐỘNG VPS:
Áp dụng khi sửa: `src/app/login/`, `src/app/dashboard/`, `*.css`, `public/`
```bash
git add . && git commit -m "ui: mô tả thay đổi" && git push origin main
```
Vercel tự build và deploy trong 1-2 phút. Không cần SSH vào VPS!

### 🔴 Sửa API / Backend / Config → Mới cần SSH VPS và Build:
Áp dụng khi sửa: `src/app/api/`, `src/lib/`, `next.config.mjs`, `package.json`
```bash
# LUÔN kiểm tra trước khi build:
ps aux | grep 'next build' | grep -v grep
# Nếu có process zombie → Kill trước:
pkill -9 -f 'next build' && sleep 3
# Mới build:
cd ~/9router && git pull origin main && npm run build && pm2 restart 9router --update-env
```

### 🚨 Cấp cứu RAM VPS đầy (> 80%):
```bash
ps aux | grep 'next build' | grep -v grep   # Tìm PID zombie
kill -9 <PID1> <PID2>                       # Kill đúng PID
free -h && pm2 status                       # Kiểm tra kết quả
```

### Thông tin kết nối VPS:
- **IP:** `161.118.250.92` | **Port:** `20127` | **User:** `ubuntu`
- **SSH:** `ssh -i "C:\Users\vinhmt\Downloads\ssh-key-2026-07-27.key" -o StrictHostKeyChecking=no ubuntu@161.118.250.92`

---

## 8. Quy Tắc Dọn Dẹp File Test / Scratch Tạm Thời (Temporary Test Clean Up)
- **Tự động Dọn Dẹp:** Bất kỳ file script test, scratch, benchmark hay debug tạm thời nào được tạo ra trong quá trình làm việc (như các file `.js`, `.mjs`, `.py` lẻ trong thư mục `scratch/`) **PHẢI ĐƯỢC XÓA SẠCH NGAY** sau khi hoàn thành test hoặc kết thúc công việc.
- Tuyệt đối không để lại file rác tích tụ trong codebase làm rối dự án!

---

## 9. Cẩm Nang Cập Nhật Model Antigravity Mới Nhanh & Chuẩn Xác (Playbook)

Khi Google Antigravity ra mắt model mới (ví dụ `gemini-3.8-flash`, `gemini-3.9-flash`, `gemini-4.0-flash`...), hãy làm đúng theo 5 bước dưới đây để cập nhật toàn diện chỉ trong 3-5 phút:

### ⚠️ NGUYÊN TẮC VÀNG UPSTREAM CỦA GOOGLE ANTIGRAVITY:
1. **Slot nội bộ hợp lệ của Google:**
   - Dòng Flash: Hiện tại Google Cloud Code dùng slot **`gemini-3-flash`**.
   - Dòng Pro: Google dùng slot **`gemini-pro-agent`** (High) và **`gemini-3.1-pro-low`** (Low).
   - Tuyệt đối **KHÔNG** trỏ upstream về các slot đã bị Google khai tử như `gemini-3.5-flash-low`, `gemini-3-flash-agent` (sẽ dính ngay lỗi: *"Gemini 3.5 Flash is no longer available"*).
2. **User-Agent Antigravity:**
   - Luôn duy trì User-Agent phiên bản mới (`antigravity/1.120.0` trở lên) tại `open-sse/config/appConstants.js` và `open-sse/providers/registry/antigravity.js` để tránh bị Google chặn version cũ.

---

### 📋 Checklist 7 File Cần Sửa:

#### 1. Provider Registry: `open-sse/providers/registry/antigravity.js`
Thêm khai báo model mới vào mảng `models`, trỏ `upstreamModelId` về slot nội bộ chuẩn (`gemini-3-flash`):
```javascript
{ id: "gemini-3.8-flash-high",   name: "Gemini 3.8 Flash (High)",   upstreamModelId: "gemini-3-flash" },
{ id: "gemini-3.8-flash",        name: "Gemini 3.8 Flash",          upstreamModelId: "gemini-3-flash" },
```

#### 2. Nhận diện Prefix Model: `open-sse/services/model.js`
Cập nhật regex `MODEL_PREFIX_PROVIDERS` để nhận diện phiên bản mới và tự map sang provider `antigravity`:
```javascript
[/^gemini-3\.[5678]/, "antigravity"], // Cập nhật số phiên bản nếu lên 3.9, 4.0...
```

#### 3. Bảng giá Token: `open-sse/providers/pricing.js`
Thêm giá token cho model mới vào object pricing:
```javascript
"gemini-3.8-flash-high": { input: 0.50, output: 2.00 },
"gemini-3.8-flash":      { input: 0.15, output: 0.60 },
```

#### 4. Proxy MITM: `src/mitm/config.js`
Thêm ánh xạ đồng nghĩa vào `MODEL_SYNONYMS.antigravity` và regex trong `MODEL_PATTERNS`:
```javascript
"gemini-3.8-flash-high": "gemini-3-flash",
"gemini-3.8-flash": "gemini-3-flash",
```

#### 5. Menu CLI & Constants:
- **`src/shared/constants/cliTools.js`**: Cập nhật `modelAliases` và `defaultModels` của `MITM_TOOLS.antigravity`.
- **`cli/src/cli/menus/providers.js`**: Cập nhật danh sách model hiển thị ở menu `ag`.

#### 6. Ứng dụng Web AI Studio:
- **`ai-studio/src/core/gateway/client.js`**: Cập nhật danh sách `POPULAR_MODELS` và `model = 'gemini-3.8-flash-high'` mặc định.
- **`ai-studio/src/App.jsx`**: Cập nhật `activeModel` state mặc định và bộ lọc `localStorage` để tự loại bỏ các model cũ đã ngừng hỗ trợ.

#### 7. Hướng dẫn Portal / Trang đăng nhập: `src/app/login/page.js`
Cập nhật thẻ thông số kết nối API cơ bản:
```jsx
<strong>Model AntiGravity (Gemini-backed):</strong> <code>gemini-3.8-flash-high</code>
```
Và cập nhật tên model mẫu trong hàm `getTomlMarkdown()` / `getGeminiMarkdown()`.

---

### 🧪 Lệnh Test Tự Động Xác Nhận:
Chạy lệnh test nhanh trực tiếp qua Gateway:
```bash
node -e "fetch('https://ainoname.site/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer sk-913895af49422e1ced953e6531e01d831ec235c818c9ceb5', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'ag/gemini-3.8-flash-high', messages: [{ role: 'user', content: 'chao ban' }] }) }).then(r => r.text()).then(t => console.log(t.slice(0, 200)))"
```
*Yêu cầu:* Phải trả về `HTTP 200 OK` và nội dung chữ stream bình thường (không có thông báo lỗi "is no longer available").

---

### 🚀 Quy Trình Deploy Đồng Bộ (1 Lần Là Xong):
1. **Gom thành 1 commit duy nhất bằng tiếng Việt và push:**
   ```bash
   git commit -a --amend -m "feat: cap nhat ho tro model Gemini <VERSION> tren toan he thong"
   git push origin main --force
   ```
2. **Cập nhật VPS qua SSH (không build lại tránh tràn RAM):**
   ```bash
   ssh -i "C:\Users\vinhmt\Downloads\ssh-key-2026-07-27.key" -o StrictHostKeyChecking=no ubuntu@161.118.250.92 "cd ~/9router && git fetch origin main && git reset --hard origin/main && pm2 restart 9router --update-env"
   ```
3. Đợi Vercel hoàn tất build giao diện (khoảng 1 phút).


