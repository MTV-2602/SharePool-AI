# 🔄 OpenAI Codex Proxy & API Key Management Portal

Hệ thống quản lý API Key, xoay vòng tài khoản ChatGPT (OAuth PKCE / Cookie JWE) và cấu hình chuyển tiếp **Codex Responses API** hỗ trợ đầy đủ Tool-calling ( MCP, chạy lệnh Terminal, đọc/ghi tập tin).

---

## 🛠️ Yêu cầu chuẩn bị (Prerequisites)
Trước khi bắt đầu cài đặt trên máy mới, hãy chắc chắn máy của bạn đã cài đặt các công cụ sau:
1. **Node.js** (Phiên bản `>= 18.0.0`)
2. **Git** (Để quản lý mã nguồn)
3. **Google Chrome** (Để chạy Extension lấy Session/OAuth Token)
4. **Cơ sở dữ liệu PostgreSQL** (Khuyên dùng **Supabase** để tạo nhanh database miễn phí trực tuyến)
5. **Codex Desktop App / Codex CLI** (Ứng dụng khách của OpenAI)

---

## 📂 Hướng dẫn cài đặt từng bước (Step-by-Step Setup)

### 1️⃣ Bước 1: Thiết lập Cơ sở dữ liệu (Database Setup)
1. Truy cập [Supabase](https://supabase.com) và tạo một Project mới.
2. Vào phần **SQL Editor** trong bảng điều khiển Supabase.
3. Mở và copy nội dung tệp [supabase_migration_v2.sql](file:///d:/codex%20xoay/supabase_migration_v2.sql) trong thư mục dự án này, dán vào SQL Editor của Supabase và nhấn **Run** để khởi tạo các bảng dữ liệu (`api_keys`, `upstream_accounts`, `usage_logs`).
4. Truy cập **Project Settings** → **Database** → Sao chép chuỗi kết nối **URI** (ConnectionString) của bạn. Nó sẽ có định dạng:
   `postgresql://postgres.[username]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

---

### 2️⃣ Bước 2: Cài đặt và Khởi động Backend Portal
1. Giải nén hoặc di chuyển mã nguồn dự án vào thư mục làm việc của bạn (Ví dụ: `D:\codex-xoay`).
2. Mở Terminal tại thư mục dự án và chạy lệnh cài đặt thư viện:
   ```bash
   npm install
   ```
3. Tạo tệp cấu hình môi trường `.env` bằng cách sao chép tệp mẫu:
   ```bash
   copy .env.example .env
   ```
4. Mở tệp `.env` vừa tạo và điền các thông số thích hợp:
   ```env
   PORT=3040
   DATABASE_URL= chuỗi_kết_nối_postgresql_supabase_đã_lấy_ở_bước_1
   ADMIN_KEY=khoá_admin_tuỳ_chọn_để_quản_lý_portal (Ví dụ: admin123)
   ```
5. **Khởi động server cục bộ**:
   - **Bằng File BAT**: Nhấp đúp vào [start.bat](file:///d:/codex%20xoay/start.bat).
   - **Bằng Terminal**:
     ```bash
     npm run dev
     ```
   - Server sẽ chạy tại địa chỉ: `http://localhost:3040`.
6. *(Tùy chọn)* **Deploy lên Vercel**:
   - Nếu muốn chạy proxy trực tuyến 24/7 không cần treo máy, bạn chỉ cần liên kết Repository GitHub này với Vercel. Vercel sẽ tự động deploy mỗi khi bạn push code mới lên nhánh `main`. Hãy cấu hình các biến môi trường tương tự tệp `.env` trên Vercel.

---

### 3️⃣ Bước 3: Cài đặt Extension & Liên kết tài khoản ChatGPT
Mục đích là sử dụng Extension để thực hiện luồng đăng nhập OAuth an toàn của OpenAI nhằm lấy Access Token và Refresh Token cho hệ thống Portal xoay vòng tài khoản.

1. Mở **Google Chrome** và truy cập vào đường dẫn: `chrome://extensions/`.
2. Bật chế độ nhà phát triển **Developer mode** ở góc trên cùng bên phải.
3. Chọn **Load unpacked** (Tải tiện ích đã giải nén) và trỏ tới thư mục [extension/](file:///d:/codex%20xoay/extension) trong mã nguồn dự án.
4. Nhấp vào biểu tượng Extension vừa cài đặt trên thanh công cụ:
   - Nhập URL Server của bạn: `http://localhost:3040` (hoặc link Vercel của bạn như `https://vinhcousera.vercel.app`).
   - Nhấp nút **🔗 Kết nối OAuth OpenAI**.
5. Một tab mới sẽ mở ra trang đăng nhập chính thức của OpenAI. Đăng nhập bằng tài khoản ChatGPT Free của bạn. Sau khi đăng nhập thành công, tab sẽ tự động đóng và tài khoản mới sẽ tự động được đồng bộ vào database portal.

---

### 4️⃣ Bước 4: Tạo API Key sử dụng trên Portal Dashboard
1. Truy cập giao diện quản trị Portal tại địa chỉ: `http://localhost:3040/admin` (hoặc link Vercel `/admin`).
2. Điền mã **Admin Key** bạn đã cấu hình trong tệp `.env` để đăng nhập.
3. Tại tab **API Keys**, nhấn **Create Key** để tạo một API key sử dụng cho ứng dụng Codex (ví dụ: `sk-d0203e7fc89...`). Sao chép Key này.

---

### 5️⃣ Bước 5: Cấu hình ứng dụng Codex trên máy khách
Để phần mềm Codex của OpenAI trỏ cuộc gọi qua Proxy Portal của bạn thay vì máy chủ mặc định của OpenAI:

1. Trên máy tính mới, tìm file cấu hình của Codex. Thông thường nó nằm tại:
   - **Windows**: `C:\Users\<Tên_User>\.codex\config.toml`
   - **Mac/Linux**: `~/.codex/config.toml`
   *(Nếu chưa có thư mục `.codex` hoặc file `config.toml`, hãy tự tạo mới)*.
2. Mở file `config.toml` bằng Text Editor và ghi đè/thêm cấu hình sau:
   ```toml
   model_reasoning_effort = "low"
   model_provider = "openai-custom"
   model = "gpt-5.5"

   [model_providers.openai-custom]
   experimental_bearer_token = "sk-d0203e7fc89aef13980a4a27f4a5e6b5bf1feb59a03f1efd" # Điền API Key của bạn lấy từ Bước 4
   name = "OpenAI Custom"
   base_url = "https://vinhcousera.vercel.app/v1" # Điền link Vercel của bạn hoặc http://localhost:3040/v1
   wire_api = "responses"
   requires_openai_auth = false
   supports_websockets = false
   ```
3. Khởi động lại ứng dụng **Codex Desktop** hoặc tắt/mở lại Terminal chạy **Codex CLI** để áp dụng cấu hình mới.

---

## 🧪 Cách kiểm tra hệ thống hoạt động (Verification)
1. Mở Terminal mới và chạy thử lệnh gọi Codex CLI:
   ```bash
   codex "say hello world"
   ```
2. Hãy thử yêu cầu Codex thực hiện các tác vụ đòi hỏi công cụ cục bộ, ví dụ:
   ```bash
   codex "quét thư mục hiện tại và tạo cho tôi 1 file test.txt"
   ```
   - **Kết quả đúng**: Codex sẽ tự động thực thi các công cụ chạy lệnh terminal và tạo tệp ngay trên máy của bạn thay vì trả ra các đoạn mã JSON dạng text thô.
3. Bạn có thể kiểm tra trạng thái và lịch sử cuộc gọi bằng cách truy cập trang dashboard: `http://localhost:3040/status` hoặc `http://localhost:3040/dashboard`.
