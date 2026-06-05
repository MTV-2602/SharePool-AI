# HƯỚNG DẪN TÍCH HỢP & KẾT NỐI ANTIGRAVITY (GEMINI CODE ASSIST) 100% CHUẨN CHỈ
================================================================================

Tài liệu này hướng dẫn chi tiết cách hoạt động của hệ thống, cách cài đặt máy chủ (Server Portal) và cách kết nối các máy khách (Client) khác để sử dụng chung **Antigravity Pool (Gemini Code Assist)** xoay vòng tài khoản Google của bạn, đảm bảo hoạt động chuẩn chỉ 100% tương thích với 9Router.

---

## 🧭 1. CƠ CHẾ HOẠT ĐỘNG CỦA 9ROUTER & ANTIGRAVITY

Extension **Google Gemini Code Assist (Cloud Code)** chính thức trên VS Code và JetBrains được lập trình cứng (hardcoded) để gọi trực tiếp đến máy chủ Google:
*   `https://cloudcode-pa.googleapis.com/v1internal:...`
*   `https://daily-cloudcode-pa.googleapis.com/v1internal:...`

Nó **không** hỗ trợ đổi địa chỉ API (Custom Base URL) trong phần Settings. Do đó, để chuyển hướng traffic này về hệ thống của bạn, bắt buộc máy khách phải có một cơ chế **chặn và giả lập kết nối (MITM - Man-In-The-Middle)**.

### Quy trình chặn và định tuyến của 9Router:
1.  **Trỏ DNS file `hosts` về Localhost:** Sửa file hosts trên máy khách để định tuyến tên miền của Google về IP `127.0.0.1`.
2.  **Khởi chạy HTTPS Local Server (Port 443):** Chạy máy chủ HTTPS trên máy khách lắng nghe cổng 443 (cổng HTTPS mặc định của Google API).
3.  **Cài đặt Chứng chỉ SSL Root CA tin cậy:** Tạo Root CA giả lập và import vào Trust Store của OS trên máy khách để tránh các lỗi SSL/TLS Handshake từ IDE.
4.  **Dịch định dạng (Translator):**
    *   *Chiều đi:* Dịch request Gemini (`contents`, `systemInstruction`, `tools`) thành định dạng OpenAI chuẩn qua bộ dịch `antigravity-to-openai.js`.
    *   *Chiều về:* Dịch phản hồi OpenAI thành định dạng Gemini chuẩn qua bộ dịch `openai-to-antigravity.js`.
5.  **Chuyển tiếp (Proxy):** Gửi request đã dịch lên remote Server thông qua endpoint `/v1/chat/completions`.

---

## 💻 2. CẤU HÌNH MÁY CHỦ (SERVER PORTAL SETTING)

Để máy chủ của bạn (ví dụ: `https://vinhcousera.vercel.app`) tiếp nhận và phân phối các kết nối một cách an toàn, hãy đảm bảo các cấu hình sau trên Server:

### Bước 2.1: Cấu hình biến môi trường (`.env`)
Đảm bảo các biến môi trường sau đã được khai báo chính xác trên Vercel hoặc VPS của bạn:
```env
# Yêu cầu bắt buộc phải kèm API Key của Portal khi gọi API
REQUIRE_API_KEY=true

# Token bí mật để mã hóa dữ liệu admin (để mặc định hoặc thay đổi)
ADMIN_KEY=your_admin_key_here

# Client ID & Client Secret dùng để Refresh Token Google OAuth (mặc định lấy theo Client của Cloud Code)
ANTIGRAVITY_CLIENT_ID=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com
ANTIGRAVITY_CLIENT_SECRET=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
```

### Bước 2.2: Tối ưu hóa Session ID chống quét / khóa tài khoản
Gemini Code Assist sử dụng cơ chế **Prompt Caching (Context Caching)** giúp ghi nhớ nội dung file đã đọc để tăng tốc độ phản hồi và tiết kiệm 20-40% token. Để Prompt Caching hoạt động và tránh bị Google phát hiện chia sẻ tài khoản:
*   Mã nguồn Portal của bạn đã được tối ưu hóa để tự động sinh `sessionId` dạng UUIDv4 chuẩn dựa trên mã Hash SHA256 của email tài khoản:
    `8c6976e5-b541-0415-bde9-08bd4dee15df`
*   Điều này giúp mỗi tài khoản Google trong Pool luôn giữ một Session ID duy nhất, ổn định và hợp lệ trên Google Cloud, tối ưu hóa bộ nhớ đệm cache mà không bị thay đổi liên tục.

### Bước 2.3: Hiển thị Quota thời gian thực
Trang Admin Portal đã được tích hợp bộ check live quota chuẩn 100% của 9Router. Hệ thống sẽ tự động gọi trực tiếp endpoint `fetchAvailableModels` của Google với `projectId` của từng tài khoản để lấy về thông số % hạn mức còn lại và hiển thị lên giao diện dạng thanh tiến trình trực quan (Xanh/Vàng/Đỏ).

---

## 📡 3. HƯỚNG DẪN KẾT NỐI MÁY KHÁCH (CLIENT SETUP)

Có **3 phương pháp** để cấu hình các máy khách kết nối và sử dụng tài nguyên từ Server của bạn.

---

### PHƯƠNG PHÁP A: Dành cho các công cụ hỗ trợ Custom Base URL (Cursor, Cline, RooCode, Continue...)
Nếu người dùng sử dụng các công cụ lập trình hỗ trợ đổi API Endpoint trực tiếp, việc cài đặt cực kỳ đơn giản và không cần quyền Admin hay chạy proxy local.

1.  **Chọn Provider:** `OpenAI Compatible` (hoặc Custom OpenAI).
2.  **Base URL (API Endpoint):**
    *   Để sử dụng Pool tài khoản Google Gemini: `https://vinhcousera.vercel.app/v1/antigravity`
    *   Để sử dụng Pool tài khoản ChatGPT: `https://vinhcousera.vercel.app/v1`
3.  **API Key:** Điền mã API Key được cấp trên Portal của bạn (dạng `sk-...`).
4.  **Model:** Điền model tương ứng muốn dùng:
    *   Dành cho Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`
    *   Dành cho ChatGPT: `gpt-4o`, `gpt-4o-mini`, `o1-mini`

---

### PHƯƠNG PHÁP B: Sử dụng Script Proxy Siêu Nhẹ (Khuyên Dùng - Tốc độ cao & Zero-overhead)
Đây là cách tối ưu nhất để kết nối trực tiếp extension **Google Gemini Code Assist** chính thức trên VS Code mà không cần cài đặt hay chạy phần mềm 9Router cồng kềnh. 

Chúng tôi đã viết sẵn file [client-proxy.js](file:///d:/codex%20xoay/client-proxy.js) trong thư mục dự án. Bạn chỉ cần gửi file này cho các máy khách khác và chạy theo hướng dẫn sau:

#### Các bước thực hiện trên máy khách:
1.  **Cài đặt Node.js:** Đảm bảo máy khách đã cài Node.js (phiên bản >= 18).
2.  **Tải file script:** Copy file `client-proxy.js` về máy khách.
3.  **Chạy script với quyền Administrator / Root:**
    *   **Trên Windows:** Mở PowerShell với quyền *Run as Administrator* rồi chạy:
        ```powershell
        node client-proxy.js --server https://vinhcousera.vercel.app --key YOUR_PORTAL_API_KEY
        ```
    *   **Trên macOS / Linux:** Mở Terminal và chạy:
        ```bash
        sudo node client-proxy.js --server https://vinhcousera.vercel.app --key YOUR_PORTAL_API_KEY
        ```
4.  **Khởi động lại VS Code:** Extension Gemini Code Assist sẽ tự động hoạt động thông qua pool tài khoản trên server của bạn. Khi tắt script bằng `Ctrl+C`, file `hosts` sẽ tự động được khôi phục về trạng thái sạch sẽ ban đầu.

---

### PHƯƠNG PHÁP C: Tích hợp thông qua phần mềm 9Router Client chính thức
Nếu máy khách đã cài đặt và muốn sử dụng giao diện Dashboard quản trị của 9Router để gộp chung với các combo AI khác, họ có thể cấu hình 9Router local trỏ về Server của bạn.

#### Bước C.1: Khởi chạy 9Router trên máy khách
Mở Terminal/PowerShell trên máy khách và cài đặt 9Router:
```bash
npm install -g 9router
9router
```
*Giao diện Dashboard local sẽ mở ra tại địa chỉ `http://localhost:20128`.*

#### Bước C.2: Cấu hình thêm Portal của bạn làm Provider trên 9Router Local
1.  Truy cập Dashboard local `http://localhost:20128/dashboard`.
2.  Mở menu **Providers** -> Chọn **Add Custom Provider** (hoặc Custom OpenAI).
3.  Điền các thông số:
    *   **Name:** `Codex Portal`
    *   **Base URL:** `https://vinhcousera.vercel.app/v1`
    *   **API Key:** `YOUR_PORTAL_API_KEY` (Mã key `sk-...` do bạn cấp).
4.  Bấm **Save**.

#### Bước C.3: Tạo Combo hoặc cấu hình map model cho Antigravity
1.  Vào phần **Combos** (hoặc Models). Tạo một combo hoặc chọn mapping cho model `gemini-pro-agent`, `gemini-3.5-flash-low`, `claude-sonnet-4-6`.
2.  Chọn nguồn dữ liệu chuyển tiếp đến Provider `Codex Portal` vừa tạo ở bước trên.

#### Bước C.4: Kích hoạt chặn kết nối (MITM) trên máy khách
1.  Trên Dashboard 9Router local, chọn **CLI Tools** -> **Antigravity**.
2.  Bấm vào nút **Start MITM**. 
3.  9Router local sẽ yêu cầu nhập mật khẩu sudo (macOS/Linux) hoặc tự động chạy quyền Admin (Windows) để ghi đè file `hosts` và cài đặt chứng chỉ Root CA vào máy khách.
4.  Mở VS Code và tận hưởng hạn mức Gemini Code Assist từ Server của bạn!

---

## 🛡️ 4. BẢNG SO SÁNH CÁC PHƯƠNG PHÁP KẾT NỐI

| Tiêu chí | Phương pháp A (Direct API) | Phương pháp B (Lightweight Script) | Phương pháp C (9Router Client) |
| :--- | :--- | :--- | :--- |
| **Dành cho công cụ** | Cursor, Cline, RooCode, Continue... | Extension Gemini Code Assist gốc | Extension Gemini Code Assist gốc |
| **Yêu cầu cài đặt** | Không cài gì thêm | Cần file `client-proxy.js` và Node.js | Cần cài đặt package `9router` qua npm |
| **Quyền Admin/Sudo** | Không cần | Bắt buộc (chạy lần đầu và lúc chạy server 443) | Bắt buộc (khi bấm Start MITM) |
| **Ưu điểm** | Đơn giản nhất, không lỗi SSL, cực kỳ nhẹ | Chạy trực tiếp extension gốc, không có overhead dịch định dạng kép | Tích hợp sâu, quản lý nhiều combo và provider cùng lúc |
| **Nhược điểm** | Không dùng được extension gốc của Google | Giao diện dòng lệnh console | Nặng hơn, phải chạy giao diện Next.js local |

---
*Bản quyền tài liệu thuộc về hệ thống Codex Portal v2.0.*
