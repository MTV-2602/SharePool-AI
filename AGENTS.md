# CÁC QUY TẮC BẮT BUỘC CHO AI AGENT (PROJECT RULES)

Tài liệu này áp dụng cho TẤT CẢ các AI Agent (Antigravity, Claude Code, Cursor, Windsurf, Codex,...) khi làm việc trong thư mục này. Bắt buộc đọc và tuân thủ trước khi thực hiện bất kỳ thao tác nào.

---

## 📌 1. ĐỊNH DANH DỰ ÁN (BẮT BUỘC GHI NHỚ)

* **`D:\codex xoay` (DỰ ÁN CHÍNH / MAIN PROJECT):**
  - Đây là kho mã nguồn làm việc chính của người dùng (repo: `MTV-2602/SharePool-AI`).
  - Chứa toàn bộ tính năng và logic riêng: SQLite driver, hệ thống auth client-keys, ainoname-client, MITM router, Hotmail, Telegram bot, v.v.
  - **Mọi chỉnh sửa code, tích hợp tính năng mới, kiểm tra build (`npm run build`) và commit Git đều PHẢI thực hiện tại đây.**

* **`D:\9router` (KHO THAM KHẢO GỐC / UPSTREAM REFERENCE):**
  - Đây CHỈ là thư mục clone/pull từ repository gốc 9Router (`github.com/decolua/9router`).
  - Dùng để chạy `git pull` và đọc commit / diff tính năng mới từ bản gốc.
  - **TUYỆT ĐỐI KHÔNG viết code tính năng vào đây và KHÔNG ĐƯỢC nhầm đây là dự án chính.**

* **VPS Production (`161.118.250.92` - domain `ainoname.site`):**
  - Thư mục chạy trên VPS: `/home/ubuntu/9router`.
  - VPS chỉ có 1GB RAM, **TUYỆT ĐỐI KHÔNG chạy `npm run build` trực tiếp trên VPS** (tránh bị OOM kill làm sập máy chủ).
  - Luôn build tại local `D:\codex xoay`, sau đó đóng gói thư mục `.next` và upload deploy lên VPS.

---

## 🧭 2. QUY TRÌNH KHI CẬP NHẬT TÍNH NĂNG TỪ 9ROUTER GỐC

Khi người dùng yêu cầu cập nhật hoặc nâng cấp từ bản 9Router gốc:
1. **Kiểm tra bản gốc:** Vào `D:\9router` kiểm tra `git pull` để lấy danh sách commit mới nhất.
2. **Xem diff chi tiết:** Chỉ đọc các commit liên quan đến các provider được yêu cầu (ví dụ: Antigravity, Codex, Claude).
3. **Tích hợp có chọn lọc vào `D:\codex xoay`:**
   - Đưa logic mới từ bản gốc sang các file tương ứng trong `D:\codex xoay`.
   - **BẢO TOÀN TUYỆT ĐỐI** các tính năng riêng của `D:\codex xoay` (SQLite database, ainoname-client, auth token, dynamic presets, custom endpoints,...). Không bao giờ sao chép đè nguyên file nếu file đó chứa mã tùy biến của người dùng.
4. **Kiểm tra build local:** Chạy `npm run build` tại `D:\codex xoay` để xác thực Next.js biên dịch không có lỗi.
5. **Tạo Git Commit:** Commit các thay đổi vào Git của `D:\codex xoay`.
6. **Deploy lên VPS (khi người dùng yêu cầu):** Dùng script deploy để đẩy bản build sang VPS.

---

## ⚡ 3. NGUYÊN TẮC LẬP TRÌNH (KARPATHY GUIDELINES)

1. **Hiểu rõ trước khi code:** Không tự suy đoán hoặc giả định ngầm. Nếu yêu cầu có nhiều cách hiểu, phải hỏi rõ trước khi làm.
2. **Tối giản là trên hết (Simplicity First):** Chỉ viết code vừa đủ để giải quyết vấn đề, không thêm tính năng suy đoán hay trừu tượng hóa không cần thiết.
3. **Chỉnh sửa chính xác (Surgical Changes):** Chỉ sửa đúng phạm vi được yêu cầu, không tự ý refactor hay format lại các phần code lân cận.
