# 🔄 Codex Rotation Proxy

Proxy xoay nhiều tài khoản ChatGPT Free tự động — dùng với Codex CLI.

---

## 📋 Bước 1: Lấy Session Token từ ChatGPT

1. Mở **Chrome** → vào [chatgpt.com](https://chatgpt.com) → **đăng nhập**
2. Nhấn **F12** mở DevTools
3. Chọn tab **Application** (hoặc **Storage** trên Firefox)
4. Mở **Cookies** → chọn `https://chatgpt.com`
5. Tìm cookie tên **`__Secure-next-auth.session-token`**
6. Copy toàn bộ **Value** (chuỗi rất dài)

![Hướng dẫn lấy cookie](https://i.imgur.com/example.png)

> ⚠️ **Lưu ý**: Token này sẽ hết hạn sau vài ngày hoặc khi bạn đăng xuất.  
> Mỗi tài khoản bạn muốn xoay, hãy đăng nhập và lấy token tương tự.

---

## 📋 Bước 2: Điền token vào accounts.json

Mở file `accounts.json` và điền vào:

```json
[
  {
    "name": "Acc Gmail chính",
    "sessionToken": "eyJhbGc...token dài ở đây..."
  },
  {
    "name": "Acc Gmail phụ",
    "sessionToken": "eyJhbGc...token acc thứ 2..."
  }
]
```

---

## 📋 Bước 3: Khởi động proxy

**Cách 1 — Double-click:** Mở file `start.bat`

**Cách 2 — Terminal:**
```powershell
cd "d:\codex xoay"
npm install
node server.js
```

Proxy chạy tại: **http://localhost:3040**  
Dashboard xem trạng thái: **http://localhost:3040/status**

---

## 📋 Bước 4: Cài và dùng Codex CLI

```powershell
# Cài Codex CLI (1 lần)
npm install -g @openai/codex

# Mở terminal MỚI và set biến môi trường
$env:OPENAI_BASE_URL = "http://localhost:3040/v1"
$env:OPENAI_API_KEY = "proxy"

# Chạy Codex!
codex "tạo cho tôi một web app todo list"
```

> 💡 **Tip**: Mở 2 cửa sổ terminal — 1 chạy proxy, 1 chạy Codex CLI

---

## 🔍 Cách proxy hoạt động

```
Codex CLI → localhost:3040/v1 → [Acc1] → chatgpt.com
                                        ↗ nếu hết limit
                               [Acc2] → chatgpt.com
                                        ↗ nếu hết limit
                               [Acc3] → chatgpt.com
```

- **Round-robin**: Xoay tuần tự qua từng tài khoản
- **Auto-fallback**: Khi 1 acc bị rate limit (429) → tự động thử acc tiếp theo
- **Cooldown 60s**: Acc bị limit sẽ được thử lại sau 60 giây
- **Token cache**: Access token được cache 55 phút, không cần auth lại mỗi request

---

## ❓ Hỏi đáp

**Q: Dùng được model nào?**  
A: Proxy tự động map sang `gpt-4o` (free) hoặc `gpt-4o-mini`. Codex CLI có thể yêu cầu model khác nhưng proxy sẽ dùng gpt-4o.

**Q: Proxy có lưu lịch sử chat không?**  
A: Không — mỗi request đều set `history_and_training_disabled: true`.

**Q: Token session hết hạn bao lâu?**  
A: Thường 7-30 ngày, hoặc khi bạn đăng xuất ChatGPT. Cần cập nhật lại trong accounts.json.

**Q: Có thể deploy lên Vercel không?**  
A: Không khuyến khích vì session cookie cần được bảo mật, và Vercel có giới hạn timeout 10s.

---

## 📊 Dashboard

Truy cập `http://localhost:3040/status` để xem:
- Trạng thái từng tài khoản (Ready / Cooldown / Invalid)  
- Thời gian còn lại của cooldown
- Token đã được xác thực chưa
