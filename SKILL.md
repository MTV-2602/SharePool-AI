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

## 9. Thư Mục Dự Án Mắt Kính AI CyberVision AR (Project Root Location)
- **Đường dẫn thư mục cố định:** Tất cả mã nguồn, giao diện (`index.html`), server proxy (`server.js`), file thực thi và tệp cấu hình của dự án Mắt Kính AI CyberVision AR **BẮT BUỘC CHỈ NẰM TRONG**:
  `D:\codex xoay\scratch\ai-glasses-demo\`


