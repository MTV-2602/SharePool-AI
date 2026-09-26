# CẨM NANG TOÀN TẬP: CẤU HÌNH, TỐI ƯU VÀ TRIỂN KHAI BẢN CHUẨN (PRODUCTION) TRÊN ORACLE VPS + CLOUDFLARE

> **Hệ thống:** 9Router (SharePool-AI) Gateway  
> **Nhà cung cấp trọng tâm:** Google Antigravity (Gemini 3.x Flash, Claude Sonnet/Opus qua Antigravity)  
> **Hạ tầng:** Oracle Cloud Free Tier (1 OCPU, 1GB RAM) + Cloudflare Proxy

---

## ⚠️ NGUYÊN TẮC VÀNG VỀ HIỆU NĂNG CHO VPS 1GB RAM

1. **Tuyệt đối KHÔNG chạy chế độ Development (`npm run dev`) trên VPS:**
   - Chế độ Dev bắt CPU VPS phải biên dịch (compile) mã nguồn React/Turbopack trực tiếp mỗi khi có người mở trang web, làm web tải mất **20 - 40 giây**, ngốn sạch RAM và ổ đĩa.
   - Chế độ Dev liên tục phát lỗi kết nối WebSocket Hot-Reload (`webpack-hmr`) làm đơ trình duyệt của người dùng.
2. **Tuyệt đối KHÔNG chạy lệnh `npm run build` trực tiếp trên VPS 1GB RAM:**
   - Quá trình biên dịch Production của Next.js đòi hỏi ~2GB RAM. Trên VPS 1GB, lệnh này sẽ bị hệ điều hành Linux buộc tắt (OOM-Killed) hoặc làm treo toàn bộ VPS.
3. **Quy trình chuẩn doanh nghiệp (Production Standard):**
   - **Biên dịch (Build) tại máy tính cá nhân (Local)** $\rightarrow$ **Nén thư mục `.next` (chỉ ~22MB)** $\rightarrow$ **Tải lên VPS và chạy chế độ `next start` (Production) qua PM2**.
   - Kết quả: Web tải tức thì (**~0.23 giây - nhanh gấp 140 lần**), RAM chỉ dùng ~255MB (dư hơn 500MB), CPU êm ái 0.5%.

---

## PHẦN 1: QUY TRÌNH BUILD & DEPLOY BẢN CHUẨN (PRODUCTION)

Mỗi khi bạn muốn cập nhật code mới hoặc sửa giao diện:

### Bước 1: Build tại máy tính của bạn (Local)
Mở PowerShell tại thư mục dự án `9router` trên máy tính:
```powershell
# 1. Cài đặt thư viện (nếu có thay đổi)
npm install

# 2. Biên dịch bản chuẩn Production (chỉ mất ~30 giây trên máy tính)
npm run build

# 3. Nén thư mục .next thành file nén gọn nhẹ (~22MB)
tar -czf next_build.tar.gz .next
```

### Bước 2: Đẩy bản build lên VPS
```powershell
scp -i "duong_dan_den_file_ssh_key.key" next_build.tar.gz ubuntu@IP_VPS:/home/ubuntu/9router/next_build.tar.gz
```

### Bước 3: Kích hoạt Production trên VPS qua SSH
SSH vào VPS:
```bash
ssh -i "duong_dan_den_file_ssh_key.key" ubuntu@IP_VPS
```
Chạy các lệnh cập nhật:
```bash
cd /home/ubuntu/9router

# Giải nén bản build mới
rm -rf .next
tar -xzf next_build.tar.gz
rm -f next_build.tar.gz

# Đảm bảo package.json chạy đúng lệnh next start
python3 -c "import json; p='package.json'; d=json.load(open(p)); d['scripts']['start']='next start --port 20127'; json.dump(d,open(p,'w'),indent=2)"

# Khởi động lại PM2 ở chế độ Production chuẩn
pm2 delete 9router || true
pm2 start "npm run start" --name "9router"
pm2 save
```

---

## PHẦN 2: CẤU HÌNH ORACLE CLOUD VPS (TỪ ĐẦU ĐẾN CUỐI)

Nếu bạn tạo một VPS Oracle mới, làm đúng theo các bước sau:

### 1. Mở Firewall phần cứng trên Oracle Cloud Console (Bắt buộc)
1. Đăng nhập **Oracle Cloud Console** $\rightarrow$ **Compute** $\rightarrow$ **Instances** $\rightarrow$ Chọn VPS của bạn.
2. Tại mục **Instance details**, bấm vào liên kết **Virtual cloud network** $\rightarrow$ Bấm vào **Subnet** $\rightarrow$ Chọn **Default Security List**.
3. Bấm **Add Ingress Rules**:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `20127, 80, 443`
   - **Description**: `9Router & Web Ports`
4. Bấm **Add Ingress Rules**.

### 2. Mở Firewall nội bộ trên Ubuntu (iptables)
SSH vào VPS và chạy:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 20127 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 3. Tạo bộ nhớ ảo SWAP 2GB (Cực kỳ quan trọng)
Giúp đệm bộ nhớ, ngăn ngừa VPS bị tràn RAM (OOM) khi chịu tải lớn:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. Cài đặt Node.js 20 LTS và PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
pm2 startup
```

---

## PHẦN 3: CẤU HÌNH CLOUDFLARE (SSL & FORWARD CỔNG 20127)

Cloudflare đóng vai trò là Reverse Proxy chịu tải, cấp chứng chỉ SSL miễn phí và che giấu IP VPS thật:

### 1. Trỏ DNS
Vào **Cloudflare Dashboard** $\rightarrow$ Chọn domain (vd `ainoname.site`) $\rightarrow$ **DNS** $\rightarrow$ **Records**:
- **Record 1**:
  - Type: `A` | Name: `@` | IPv4 address: `IP_VPS` | Proxy status: **Proxied (Đám mây cam 🟠)**
- **Record 2**:
  - Type: `A` | Name: `api` | IPv4 address: `IP_VPS` | Proxy status: **Proxied (Đám mây cam 🟠)**
- **Record 3**:
  - Type: `A` | Name: `www` | IPv4 address: `IP_VPS` | Proxy status: **Proxied (Đám mây cam 🟠)**

### 2. Cài đặt SSL/TLS
Vào mục **SSL/TLS** $\rightarrow$ **Overview**:
- Chọn chế độ: **Flexible** (hoặc **Full** nếu VPS có SSL tự ký).

### 3. Cấu hình Origin Rules (Đẩy cổng 443 về 20127)
Giúp người dùng gọi API qua đường dẫn chuẩn `https://ainoname.site/v1/...` mà không cần lộ cổng 20127:
1. Vào **Rules** $\rightarrow$ **Origin Rules** $\rightarrow$ Bấm **Create rule**.
2. **Rule name**: `ForwardToPort20127`
3. **If incoming requests match**: Chọn **All incoming requests**
4. **Destination Port**: Chọn **Rewrite to...** $\rightarrow$ Nhập số cổng: `20127`
5. Bấm **Deploy**.

---

## PHẦN 4: CẤU HÌNH VÀ TỐI ƯU DÀNH RIÊNG CHO ANTIGRAVITY

Hệ thống được tinh chỉnh để phục vụ tốt nhất cho nhà cung cấp **Google Antigravity**:

1. **Định tuyến tự động thông minh (`open-sse/services/model.js`):**
   - Mọi model bắt đầu bằng `gemini-` (như `gemini-3.8-flash-high`, `gemini-3-flash`, `gemini-2.5-pro`,...) và các model Claude trên Antigravity (`claude-sonnet-4-6`, `claude-opus-4-6-thinking`) đều được tự động đưa thẳng vào **Antigravity**. Người dùng không cần gõ prefix nhà cung cấp.
2. **Khắc phục lỗi Google 404 Not Found:**
   - Model `gemini-3.8-flash-high` được tự động ánh xạ chính xác sang model id upstream của Google là `gemini-3-flash`.
3. **Tránh bị Google bóp hạn mức vô cớ (429 RESOURCE_EXHAUSTED):**
   - Đã loại bỏ trường `requestType: "agent"` trên luồng chat thường (vì Google official IDE client không gửi trường này).
   - Đặt cố định `projectId: "aicode-consumers"` chuẩn mực.
4. **Hỗ trợ Thinking Tokens:**
   - Tích hợp bộ xử lý `thoughtSignature` cho phép các model suy nghĩ của Gemini 3 hoạt động đầy đủ trên Cursor, Cline, RooCode.
5. **Xem chuẩn hạn mức Antigravity ("Quota Tracker"):**
   - Truy cập trang `/dashboard/quota` để xem chi tiết hạn mức phiên 5h và hạn mức tuần của từng tài khoản Google kết nối.
6. **Bộ công cụ đăng nhập tự động (OAuth Listener):**
   - Sử dụng script `public/antigravity_listener.bat` trên Windows để bắt mã OAuth từ trình duyệt và tự động lưu thẳng vào Supabase.

---

## PHẦN 5: CÁC LỆNH BẢO TRÌ NHANH TRÊN VPS

```bash
# Xem tình trạng tài nguyên (RAM, Swap, CPU)
free -m && uptime

# Xem trạng thái tiến trình 9router
pm2 status

# Xem log trực tiếp của server
pm2 logs 9router --lines 50

# Khởi động lại server
pm2 restart 9router
```
