# 🚀 AiNoName Antigravity Client Gateway

Bộ công cụ kết nối 1-Click dành riêng cho khách hàng sử dụng **Client Key (`ck-...`)** để chuyển toàn bộ câu lệnh từ **Google Antigravity IDE** về hệ thống Gateway **AiNoName (`https://ainoname.site`)**.

---

## 📌 Dành cho Quản trị viên (Admin): Cách cấp cho Khách

1. **Tạo Client Key mới:**
   - Đăng nhập vào trang quản trị: `https://ainoname.site/dashboard/client-keys`
   - Tạo mã Client Key cho khách (ví dụ: `ck-xxxxxxxx...`) và thiết lập hạn mức (số request, số kết nối).

2. **Gắn Key vào thư mục Client:**
   - Mở file `config.json` trong thư mục này:
     ```json
     {
       "gatewayUrl": "https://ainoname.site",
       "clientKey": "ck-DÁN_MÃ_KEY_CỦA_KHÁCH_VÀO_ĐÂY",
       "webPort": 20129,
       "mitmPort": 443,
       "modelMapping": {
         "gemini-3.8-flash-high": "gemini-3.8-flash-high",
         "claude-sonnet-4-6": "claude-sonnet-4-6",
         "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
         "gpt-oss-120b-medium": "gpt-oss-120b-medium"
       }
     }
     ```
3. **Nén thư mục thành file zip:**
   - Nén toàn bộ thư mục `ainoname-client` thành `AiNoName-Client.zip` và gửi cho khách hàng.
   - *Lưu ý: Khách hàng không cần phải nhập key hay cấu hình bất cứ thứ gì nữa!*

---

## 💻 Dành cho Khách hàng: Hướng dẫn sử dụng

1. **Khởi chạy:**
   - Giải nén file zip nhận được.
   - Nhấp đúp chuột vào file: **`AiNoName-Antigravity.bat`**
   - Chọn **Yes** khi Windows hỏi quyền Administrator (để công cụ tự động cài đặt chứng chỉ bảo mật và chuyển hướng kết nối).

2. **Kích hoạt kết nối:**
   - Trình duyệt sẽ tự động mở trang quản lý tại: `http://localhost:20129`
   - Nhấn nút: **▶ BẬT KẾT NỐI ANTIGRAVITY**
   - Đèn trạng thái chuyển sang **DNS Active** (Màu xanh).

3. **Mở Antigravity IDE và sử dụng:**
   - Mở phần mềm **Antigravity IDE** trên máy tính.
   - Chọn bất kỳ model nào (`Claude Sonnet 4.6`, `Claude Opus 4.6`, `Gemini 3.8 Flash High`...) và bắt đầu chat hoặc viết code.
   - Mọi câu hỏi sẽ được định tuyến thông qua AiNoName Gateway với tốc độ cao nhất!

4. **Tắt kết nối:**
   - Bấm nút **⏹ TẮT KẾT NỐI (DNS OFF)** trên giao diện web hoặc chỉ cần đóng cửa sổ màu đen lại.
   - Máy tính sẽ tự động khôi phục về trạng thái ban đầu.
