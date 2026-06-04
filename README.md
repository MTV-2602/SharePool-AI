# 💻 Hướng Dẫn Cấu Hình Máy Khách Sử Dụng Codex API Portal

Tài liệu này hướng dẫn chi tiết cách cấu hình một máy tính bất kỳ (máy khách) để kết nối và sử dụng Codex qua hệ thống API Portal của bạn đã được triển khai (ví dụ: `https://vinhcousera.vercel.app`).

---

## 🛠️ Bước 1: Cài đặt ứng dụng Codex

Người dùng máy khách cần cài đặt một trong hai hình thức sau (hoặc cả hai):

### Cách 1: Sử dụng Codex Desktop App (Khuyên dùng)

Tải và cài đặt ứng dụng **Codex Desktop** chính thức do OpenAI phát hành trên máy tính.

### Cách 2: Sử dụng Codex CLI (Nếu dùng giao diện dòng lệnh)

Mở Terminal/PowerShell và cài đặt Codex CLI toàn cục qua npm:

```bash
npm install -g @openai/codex
```

---

## ⚙️ Bước 2: Thiết lập file cấu hình `config.toml`

Trên máy khách, cần tạo hoặc chỉnh sửa tệp cấu hình của Codex để chuyển tiếp cuộc gọi qua Server của bạn:

1. Tìm tệp cấu hình **`config.toml`** theo đường dẫn hệ điều hành:
   - **Windows**: `C:\Users\<Tên_Tài_Khoản_Máy_Tính>\.codex\config.toml`
   - **Mac / Linux**: `~/.codex/config.toml`
     _(Nếu chưa có thư mục `.codex` hoặc file `config.toml`, hãy tự tạo thư mục và file văn bản mới với tên tương ứng)._

2. Mở file `config.toml` bằng Notepad hoặc Text Editor và điền cấu hình sau:

   ```toml
   model_reasoning_effort = "low"
   model_provider = "openai-custom"
   model = "gpt-5.5"

   [model_providers.openai-custom]
   experimental_bearer_token = "KHOA_API_KEY_CUA_MAY_KHACH"
   name = "VinAi"
   base_url = "https://vinhcousera.vercel.app/v1"
   wire_api = "responses"
   requires_openai_auth = false
   supports_websockets = false
   ```

3. **Thay đổi các giá trị cấu hình phù hợp**:
   - Thay thế `"KHOA_API_KEY_CUA_MAY_KHACH"` bằng mã API Key bạn tạo riêng cho máy khách đó từ trang Admin Portal của bạn (có dạng `sk-d0203e7fc89...`).
   - Thay thế `"https://vinhcousera.vercel.app/v1"` nếu máy chủ Portal của bạn được triển khai ở địa chỉ khác.

---

## 🧪 Bước 3: Khởi động lại và Kiểm thử

1. Hãy **tắt hoàn toàn** ứng dụng Codex Desktop (hoặc đóng các cửa sổ Terminal đang mở) và khởi động lại để Codex nạp cấu hình mới.
2. Thử nghiệm gọi lệnh cơ bản qua CLI để kiểm tra kết nối:
   ```bash
   codex "say hello"
   ```
3. Thử nghiệm tính năng chạy công cụ hệ thống (Tool-calling) của Codex trên máy khách:
   ```bash
   codex "tạo cho tôi 1 file test_connection.txt trong thư mục hiện tại"
   ```

   - **Kết quả đúng**: Codex tự động gọi công cụ tạo file cục bộ và báo thành công mà không trả ra văn bản JSON thô. Lịch sử sử dụng sẽ hiển thị trên Dashboard Admin Portal của bạn.
