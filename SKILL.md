# QUY TẮC DỰ ÁN & HƯỚNG DẪN BẮT BUỘC CHO AI AGENT (MASTER RULES)

> **Tài liệu này là BỘ QUY TẮC DUY NHẤT VÀ CHÍNH THỨC** áp dụng cho TẤT CẢ các AI Agent (Antigravity, Claude Code, Cursor, Windsurf, Codex,...) khi làm việc trong kho mã nguồn này. Bắt buộc đọc và tuân thủ trước khi thực hiện bất kỳ thao tác nào.

---

## 📌 1. ĐỊNH DANH DỰ ÁN & VAI TRÒ THƯ MỤC (BẮT BUỘC GHI NHỚ)

* **`D:\codex xoay` (DỰ ÁN CHÍNH / MAIN PROJECT):**
  - Đây là kho mã nguồn làm việc chính của người dùng (Git repository: `MTV-2602/SharePool-AI`, nhánh `main`).
  - Chứa toàn bộ tính năng và logic tùy biến riêng: Database SQLite nội bộ (`/data/db/data.sqlite`), hệ thống auth `client_keys`, bộ công cụ `ainoname-client`, MITM router, Hotmail integration, Telegram notification bot, v.v.
  - **Mọi chỉnh sửa code, tích hợp tính năng mới, kiểm tra build (`npm run build`) và commit Git đều PHẢI thực hiện tại đây.**

* **`D:\9router` (KHO THAM KHẢO GỐC / UPSTREAM REFERENCE):**
  - Đây CHỈ là thư mục clone/pull từ repository gốc 9Router (`github.com/decolua/9router`).
  - Dùng để chạy `git pull` và đọc commit / diff tính năng mới từ bản gốc.
  - **TUYỆT ĐỐI KHÔNG viết code tính năng vào đây và KHÔNG ĐƯỢC nhầm đây là dự án chính.**

* **VPS Oracle Production (`161.118.250.92`, domain `https://ainoname.site`, PM2 `9router` cổng `20127`):**
  - Thư mục ứng dụng trên VPS: `/home/ubuntu/9router`.
  - Database SQLite trên VPS: `/home/ubuntu/9router/data/db/data.sqlite`.
  - VPS chỉ có 1GB RAM, **TUYỆT ĐỐI KHÔNG chạy `npm run build` hoặc `npm run dev` trực tiếp trên VPS** (sẽ bị Linux OOM-Killed làm sập máy chủ).
  - Luôn build tại local `D:\codex xoay`, sau đó dùng script `deploy-code.ps1` để đẩy thư mục `.next` lên VPS và restart PM2.

---

## 🧭 2. QUY TRÌNH CHUẨN KHI CẬP NHẬT TỪ 9ROUTER GỐC

Khi người dùng yêu cầu cập nhật hoặc nâng cấp từ bản 9Router gốc:
1. **Kiểm tra bản gốc:** Vào `D:\9router` chạy `git pull` để lấy danh sách commit mới nhất từ upstream.
2. **Xem diff chi tiết:** Chỉ đọc các commit liên quan đến các provider được yêu cầu (ví dụ: Antigravity, Codex, Claude).
3. **Tích hợp có chọn lọc vào `D:\codex xoay`:**
   - Đưa logic và tính năng mới từ bản gốc sang các file tương ứng trong `D:\codex xoay`.
   - **BẢO TOÀN TUYỆT ĐỐI** các tính năng riêng của `D:\codex xoay` (SQLite database, ainoname-client, auth client-keys, custom API endpoints, Telegram bot...). Không bao giờ sao chép đè nguyên file nếu file đó chứa mã tùy biến của người dùng.
4. **Kiểm tra build local:** Chạy `npm run build` tại `D:\codex xoay` để xác thực Next.js biên dịch hoàn toàn sạch không lỗi.
5. **Tạo Git Commit & Push:** Commit các thay đổi vào Git của `D:\codex xoay` và push lên `origin/main`.
6. **Deploy lên VPS (khi người dùng yêu cầu):** Chạy `deploy-code.ps1` để đóng gói `.next` và deploy sang VPS `/home/ubuntu/9router`.

---

## ⚡ 3. NGUYÊN TẮC LẬP TRÌNH BẮT BUỘC (KARPATHY GUIDELINES)

1. **Hiểu rõ trước khi code (Think Before Coding):**
   - Nêu rõ các giả định trước khi làm. Không tự tiện suy đoán ngầm.
   - Nếu yêu cầu có nhiều cách hiểu, phải hỏi rõ người dùng trước khi thực hiện.
2. **Tối giản là số 1 (Simplicity First):**
   - Chỉ viết lượng code tối thiểu cần thiết để giải quyết đúng bài toán.
   - Không tự ý thêm tính năng suy đoán ngoài yêu cầu, không tạo abstraction thừa thãi.
3. **Chỉnh sửa chính xác (Surgical Changes):**
   - Chỉ sửa đúng các dòng cần sửa để phục vụ yêu cầu.
   - Không tự ý "làm đẹp", format lại hay refactor những vùng code xung quanh đang chạy ổn định.
4. **Tiêu chí thành công kiểm chứng được (Goal-Driven Execution):**
   - Mọi thay đổi phải được kiểm tra bằng kết quả cụ thể (syntax check, `npm run build` pass, curl endpoint trả về 200).
   - Tự động kiểm tra và sửa lỗi đến khi đạt kết quả trước khi báo cáo hoàn thành.
5. **Dọn dẹp file tạm (Clean Up):**
   - Bất kỳ file script test, scratch, benchmark hay debug tạm thời nào tạo ra trong quá trình làm việc **PHẢI ĐƯỢC XÓA SẠCH NGAY** sau khi test xong. Tuyệt đối không để lại rác trong codebase.

---

## 🛡️ 4. QUY TẮC AN TOÀN MÁY CHỦ VPS & HIỆU NĂNG (SERVER STABILITY)

1. **Kiểm soát RAM & Tránh OOM:** VPS Oracle chỉ có 1GB RAM. PM2 đặt giới hạn bộ nhớ ~450MB. Tránh lưu trữ mảng lớn JSON hay buffer dữ liệu chat hàng trăm nghìn tokens trong RAM.
2. **Lệnh SSH trên Windows:** Luôn truyền cờ `-n` khi chạy lệnh SSH tự động (`ssh -n -i <key> ubuntu@...`) để tránh lệnh bị treo vô tận do đợi dữ liệu từ stdin.
3. **Tránh Restart dồn dập:** Đợi ít nhất 15-30 giây giữa các lần restart PM2 để TCP sockets và các kết nối SQLite giải phóng hoàn toàn.
4. **Observability:** Biến môi trường `OBSERVABILITY_ENABLED` phải luôn để mặc định là `false` trên production nhằm tránh tràn bộ đệm ghi log và suy giảm hiệu năng.

---

## 🚀 5. QUY TẮC AUTO GIT COMMIT & PUSH

- **Tự động Commit & Push:** Sau khi hoàn thành bất kỳ thay đổi nào và kiểm tra hoạt động ổn định (`npm run build` thành công), luôn thực hiện commit ngắn gọn bằng tiếng Việt và push thay đổi lên Git repository của dự án `D:\codex xoay`:
  ```bash
  git add .
  git commit -m "nội dung commit ngắn gọn bằng tiếng Việt"
  git push origin main
  ```
- **Tránh bị treo khi Push:** Đảm bảo remote URL đã được cấu hình SSH hoặc HTTPS có username (`https://<USERNAME>@github.com/...`) để Git tự động xác thực mà không mở hộp thoại đăng nhập UI ẩn.

---

## 💬 6. CÂU LỆNH CHUẨN ĐỂ YÊU CẦU AI CẬP NHẬT TỪ BẢN GỐC

Khi có bản cập nhật mới từ upstream 9router, người dùng chỉ cần nhắn câu lệnh mẫu:
> *"Tích hợp và nâng cấp bản mới nhất từ upstream D:\9router vào dự án chính D:\codex xoay cho các provider [tên provider, ví dụ: antigravity, codex, claude], nhớ đọc commit bên 9router và tuyệt đối bảo toàn các tính năng riêng của codex xoay."*

---

## 🎖️ 7. CHỮ KÝ XÁC NHẬN (VINH PRO)
- Luôn viết **"Vinh Pro"** ở cuối câu trả lời khi hoàn thành công việc để chứng minh AI đã đọc và tuân thủ đầy đủ bộ quy tắc này.
