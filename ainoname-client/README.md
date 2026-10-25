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
   - Mở ứng dụng **Antigravity IDE** trên máy tính.
   - Chọn model bạn muốn (`Gemini 3.8 Flash High`, `Claude Sonnet 4.6`, `Claude Opus 4.6 Thinking`, `GPT-OSS 120B`...) và chat ngay!
   - Không cần nhập bất kỳ API key nào trong IDE.

4. **Tắt kết nối:**
   - Khi không muốn dùng nữa, chỉ cần đóng cửa sổ lệnh đen lại (hoặc bấm **Tắt kết nối** trên web).
   - File hosts của máy sẽ tự động được dọn dẹp sạch sẽ, khôi phục cài đặt gốc của máy tính.

---

## ⚙️ Dành cho Quản trị viên (Admin):
- File `config.json` đã được tạo sẵn Client Key tương ứng với người dùng khi tải về từ Dashboard.
- Nếu muốn đổi server chuyển tiếp sang máy chủ Local (khi test), mở giao diện `http://localhost:20129` -> Mở phần **Cài đặt nâng cao** -> Bấm chọn **Local Test (:20128)** -> Bấm **Lưu URL**.
