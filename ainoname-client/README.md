# 🚀 AiNoName Antigravity Client Gateway (1-Click)

Bộ công cụ kết nối **1-Click** tự động dành riêng cho khách hàng sử dụng **Client Key (`ck-...`)** để chuyển toàn bộ câu lệnh từ **Google Antigravity IDE** về hệ thống Gateway **AiNoName**.

---

## ⚡ Hướng dẫn sử dụng 1-Click cho Khách hàng:

1. **Khởi chạy:**
   - Giải nén file zip nhận được vào bất kỳ thư mục nào trên máy.
   - Nhấp đúp chuột vào file: **`AiNoName-Antigravity.bat`**
   - Chọn **Yes** khi Windows hỏi quyền Administrator (UAC).

2. **Tự động kích hoạt:**
   - Tool sẽ tự động cài chứng chỉ SSL an toàn và kích hoạt chuyển hướng DNS cho Antigravity IDE.
   - Trình duyệt sẽ tự động mở trang trạng thái: `http://localhost:20129` (Báo xanh: **ĐÃ KẾT NỐI SẴN SÀNG**).
   - **LƯU Ý:** Giữ nguyên cửa sổ đen trong suốt quá trình làm việc với Antigravity IDE.

3. **Mở Antigravity IDE & Chat:**
   - Nếu IDE đã mở từ trước, dùng nút **Mở / Reset Antigravity IDE** trong dashboard để IDE nạp chứng chỉ.
   - Chọn **Gemini 4 Hydrogen** trong IDE. Mức **Extra High** được gửi tới `ag/gemini-4-hydrogen-xhigh`.
   - Không cần nhập bất kỳ API key nào trong IDE.

4. **Tắt kết nối:**
   - Khi không muốn dùng nữa, chỉ cần đóng cửa sổ lệnh đen lại (hoặc bấm **Tắt kết nối** trên web).
   - File hosts của máy sẽ tự động được dọn dẹp sạch sẽ, khôi phục cài đặt gốc của máy tính.

---

## Cập nhật từ bản client cũ

Đóng cửa sổ gateway cũ. Giải nén gói mới và chép `config.json` từ thư mục cũ sang để giữ Client Key và cấu hình. Mở `AiNoName-Antigravity.bat` trong thư mục mới.

Ở các lần sau, dashboard hiện nút **Cập nhật** khi có bản mới. Đợi IDE trả lời xong rồi bấm nút. Gateway sẽ xác minh bản tải về, thay bộ chạy và tự mở lại. Client Key, Gateway URL và ánh xạ model nằm trong `config.json`.

## ⚙️ Dành cho Quản trị viên (Admin):
- File `config.json` đã được tạo sẵn Client Key tương ứng với người dùng khi tải về từ Dashboard.
- Nếu muốn đổi server chuyển tiếp sang máy chủ Local (khi test), mở giao diện `http://localhost:20129` -> Mở phần **Cài đặt nâng cao** -> Bấm chọn **Local Test (:20128)** -> Bấm **Lưu URL**.

### Phát hành bản cập nhật client

1. Tăng số trong `ainoname-client/src/release-version.json`.
2. Chạy `npm run client:release` tại dự án chính. Lệnh ký dùng khóa riêng ở `%LOCALAPPDATA%\AiNoName\release-signing\client-ed25519.pem` hoặc đường dẫn `AINONAME_RELEASE_KEY`. Khóa riêng chỉ cần trên máy ký.
3. Sau khi kiểm thử, cập nhật `ainoname-agent.bundle.js` và `update-manifest.json` trong thư mục `ainoname-client` của VPS. Đưa manifest lên sau bundle. Cập nhật thêm các tệp launcher trong cùng thư mục nếu chúng thay đổi để ZIP tải mới có launcher mới.
