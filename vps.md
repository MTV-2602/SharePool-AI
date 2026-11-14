# 📘 CẨM NANG TOÀN TẬP VẬN HÀNH VPS ORACLE & HỆ THỐNG 9ROUTER (BẢN CHUẨN 2026)

> **Dự án chính:** `D:\codex xoay` (Toàn bộ mã nguồn, tính năng SQLite, proxy pool, client portal, MITM router)  
> **Hạ tầng máy chủ:** Oracle Cloud Infrastructure (OCI) Free Tier + Cloudflare CDN / WAF  
> **Kiến trúc mạng:** Multi-IPv6 Local Proxy Relay chống trùng lặp IP / chống ban tài khoản AI  
> **Cập nhật lần cuối:** Tháng 11/2026 (Loại bỏ toàn bộ Supabase/Vercel cũ, đồng bộ hóa 100% SQLite & PM2)

---

## 📌 BẢNG THÔNG SỐ HỆ THỐNG (TRA CỨU NHANH)

| Thành phần | Thông số cấu hình thực tế | Ghi chú vận hành |
| :--- | :--- | :--- |
| **VPS Public IPv4** | `161.118.250.92` | Gán tĩnh trên card mạng OCI `ens3` |
| **VPS User / SSH Port** | `ubuntu` / Cổng `22` | Xác thực bằng SSH Key |
| **Đường dẫn SSH Key** | `C:\Users\vinhmt\Downloads\ssh-key-2026-07-27.key` | Khóa cá nhân (không chia sẻ) |
| **Cấu hình phần cứng** | 1 OCPU / 1GB RAM vật lý + 2GB SWAP đệm | Nghiêm cấm chạy build nặng trực tiếp |
| **Cổng dịch vụ 9Router** | `20127` (HTTP nội bộ) | Cloudflare proxy từ cổng 443 về 20127 |
| **Tên miền Production** | `https://ainoname.site` | SSL Full qua Cloudflare Origin Rules |
| **Đường dẫn ứng dụng** | `/home/ubuntu/9router` | Thư mục chạy Next.js Production |
| **Đường dẫn SQLite DB** | `/home/ubuntu/9router/data/db/data.sqlite` | Cơ sở dữ liệu duy nhất của hệ thống |
| **Thư mục Backup DB** | `/home/ubuntu/9router/data/db/backups` | Lưu lịch sử snapshot SQLite |
| **Tiến trình PM2 chính** | `9router` (App Next.js) | Chạy chế độ `next start -p 20127` |
| **Tiến trình PM2 Proxy** | `ipv6-relay` (Node.js relay đa IP) | Chạy 8 cổng `10001` - `10008` qua IPv6 riêng |
| **Telegram Bot Backup** | `ainoname9_bot` (Token: `8951459282:AAGkC1...`) | Tự động bắn file DB về ID: `6352706510`, `5690689202` |

### ⚡ Lệnh SSH kết nối nhanh (PowerShell Windows):
```powershell
ssh -i "C:\Users\vinhmt\Downloads\ssh-key-2026-07-27.key" -o StrictHostKeyChecking=no ubuntu@161.118.250.92
```

---

## ⚠️ NGUYÊN TẮC BẤT DI BẤT DỊCH (SAFETY RULES)

1. **TUYỆT ĐỐI KHÔNG chạy `npm run build` trên VPS:**
   - VPS Oracle Free Tier chỉ có 1GB RAM vật lý. Biên dịch Next.js (Turbopack/SWC) tiêu tốn 1.8GB - 2.5GB RAM. Nếu chạy trực tiếp trên VPS, Linux Kernel sẽ kích hoạt cơ chế `OOM-Killed` lập tức tắt đứng máy, làm sập toàn bộ dịch vụ.
   - **Quy trình chuẩn:** Build tại máy cá nhân (`D:\codex xoay`) $\rightarrow$ Dùng script `deploy-code.ps1` đẩy `.next` lên VPS $\rightarrow$ Khởi động lại PM2 trong 3 giây.
2. **TUYỆT ĐỐI KHÔNG chạy chế độ Dev (`npm run dev`) trên VPS:**
   - Chế độ Dev tiêu tốn RAM gấp 3 lần, làm thời gian phản hồi API từ 0.2s tăng vọt lên 20 - 40s và liên tục ngắt kết nối WebSocket `webpack-hmr`.
3. **Database hoàn toàn là SQLite nội bộ:**
   - Đã loại bỏ 100% Supabase PostgreSQL và Vercel. Mọi dữ liệu (tài khoản, key khách, lịch sử token, proxy pool) nằm trọn trong `/home/ubuntu/9router/data/db/data.sqlite`.

---

## PHẦN 1: THIẾT LẬP MÁY CHỦ ORACLE VPS TỪ ĐẦU (100% FRESH VPS)

Khi tạo mới một VPS Oracle Cloud (hoặc cài lại máy), thực hiện chuẩn theo 3 bước sau:

### Bước 1: Mở Firewall phần cứng trên Oracle Cloud Console
1. Đăng nhập **Oracle Cloud Console** $\rightarrow$ **Compute** $\rightarrow$ **Instances** $\rightarrow$ Chọn máy chủ của bạn.
2. Tại mục **Instance Details**, nhấp vào liên kết **Virtual cloud network** (VCN) $\rightarrow$ Nhấp vào **Subnet** $\rightarrow$ Chọn **Default Security List**.
3. Bấm **Add Ingress Rules**:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** `TCP`
   - **Destination Port Range:** `20127, 80, 443, 22`
   - **Description:** `Web, SSH & 9Router Ports`
4. Bấm **Add Ingress Rules**.

### Bước 2: Khởi tạo gói phần mềm & SWAP 2GB (Chống tràn RAM)
Đăng nhập SSH vào VPS và chạy chuỗi lệnh tối ưu:
```bash
# 1. Cập nhật hệ thống & cài đặt công cụ cần thiết
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential net-tools iptables-persistent

# 2. Cài đặt PM2 toàn cục
sudo npm install -g pm2
pm2 startup systemd -u ubuntu --hp /home/ubuntu

# 3. Tạo 2GB SWAP bộ nhớ ảo (bắt buộc cho VPS 1GB RAM)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Tối ưu Kernel Socket Linux (chống lỗi nghẽn cổng 502 khi chịu tải cao)
sudo sysctl -w net.core.somaxconn=4096
sudo sysctl -w net.ipv4.tcp_max_syn_backlog=4096
echo 'net.core.somaxconn=4096' | sudo tee -a /etc/sysctl.conf
echo 'net.ipv4.tcp_max_syn_backlog=4096' | sudo tee -a /etc/sysctl.conf

# 5. Mở Firewall nội bộ iptables
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 20127 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Bước 3: Cấu hình thư mục ứng dụng 9Router
```bash
# Tạo cấu trúc thư mục
mkdir -p /home/ubuntu/9router/data/db/backups

# Khởi tạo file .env cấu hình trên VPS
cat << 'EOF' > /home/ubuntu/9router/.env
PORT=20127
NODE_ENV=production
ADMIN_KEY=admin123
NEXT_PUBLIC_CLOUD_URL=https://ainoname.site
JWT_SECRET=fd5480c996152dc2dc6660efa83033f842f9a4df6cb48e6c5c1a7695bc1b2926
TELEGRAM_BOT_TOKEN=8951459282:AAGkC1wR3vh4oAKxzA4LoPO6ECMXke8u97c
ALLOWED_USER_IDS=6352706510,5690689202
EOF
```

---

## PHẦN 2: CẤU HÌNH CLOUDFLARE & TÊN MIỀN (REVERSE PROXY & ORIGIN RULES)

Cloudflare đóng vai trò là lớp bảo vệ WAF, tự động cấp phát SSL miễn phí và che giấu IP VPS gốc `161.118.250.92`.

### 1. Trỏ DNS Records
Truy cập **Cloudflare Dashboard** $\rightarrow$ Chọn tên miền `ainoname.site` $\rightarrow$ **DNS** $\rightarrow$ **Records**:

| Type | Name | Content / IPv4 | Proxy status | Mục đích |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `@` | `161.118.250.92` | 🟠 **Proxied** | Truy cập trang chủ & login |
| **A** | `api` | `161.118.250.92` | 🟠 **Proxied** | Endpoint API (`https://api.ainoname.site/v1`) |
| **A** | `www` | `161.118.250.92` | 🟠 **Proxied** | Tên miền phụ www |

### 2. Thiết lập SSL/TLS
1. Vào **SSL/TLS** $\rightarrow$ **Overview**: Chọn chế độ **Full** (hoặc **Flexible**).
2. Vào **SSL/TLS** $\rightarrow$ **Edge Certificates**: Bật **Always Use HTTPS** và **Minimum TLS Version: TLS 1.2**.

### 3. Cấu hình Origin Rules (Chuyển cổng 443 sang cổng 20127 của 9Router)
Người dùng và client bên ngoài sẽ gọi qua HTTPS chuẩn cổng 443; Cloudflare sẽ âm thầm chuyển tiếp về cổng nội bộ `20127` của VPS:
1. Vào mục **Rules** $\rightarrow$ **Origin Rules** $\rightarrow$ Bấm nút **Create rule**.
2. **Rule name:** `ForwardToPort20127`.
3. **If incoming requests match:** Chọn **All incoming requests** (hoặc Custom: `Hostname equals ainoname.site` or `Hostname equals api.ainoname.site`).
4. **Destination Port:** Chọn **Rewrite to...** $\rightarrow$ Điền số cổng: **`20127`**.
5. Bấm **Deploy**.

### 4. Lưu ý khi tạo Cloudflare API Token (Tránh lỗi Zone Permission)
Khi tạo Cloudflare API Token dùng cho scripts hoặc worker:
- Trong giao diện tạo Token, nếu bạn chọn quyền hạn thuộc nhóm **User** hoặc **Workers Scripts**, mục **Zone Resources** phải chọn **All zones** hoặc **Không gán Zone Resources** nếu quyền hạn là tài khoản.
- Không kết hợp quyền cấp User với điều kiện lọc Zone cụ thể, nếu không Cloudflare sẽ báo lỗi đỏ: *"The required information to complete authentication was not provided or was incorrect"*.

---

## PHẦN 3: KIẾN TRÚC XOAY MULTI-IPV6 RELAY CHỐNG BAN TÀI KHOẢN AI

### 🎯 Tại sao phải dùng Local IPv6 Relay?
- **Vấn đề của IPv4 duy nhất:** Nếu tất cả các tài khoản Google Antigravity / Claude cùng gửi request từ 1 địa chỉ IPv4 (`161.118.250.92`), upstream Google sẽ phát hiện lưu lượng bất thường từ cùng 1 IP $\rightarrow$ Dẫn đến lỗi `429 RESOURCE_EXHAUSTED` hoặc khóa tạm thời tài khoản trong 60 phút.
- **Vấn đề của Cloudflare Worker proxy:** Cloudflare Worker Free giới hạn thời gian CPU execution và socket timeout. Khi người dùng gửi ngữ cảnh dài (~200k tokens) hoặc model suy nghĩ lâu, Cloudflare Worker sẽ tự ngắt kết nối gây lỗi `[502]: fetch connect timeout`.
- **Giải pháp Multi-IPv6 Relay nội bộ:** Oracle cấp miễn phí dải IPv6 `/64` với hàng tỷ IP công cộng. Bằng cách gán 8 địa chỉ IPv6 GUA khác nhau lên card mạng VPS và chạy tiến trình trung chuyển `ipv6-relay.js` ngay trên VPS:
  1. Mỗi tài khoản AI được cấp 1 cổng proxy riêng (`127.0.0.1:10001` - `10008`).
  2. Khi gửi request, mỗi tài khoản ra Internet bằng một IPv6 công cộng hoàn toàn độc lập.
  3. Kết nối diễn ra nội bộ qua loopback (`127.0.0.1`) $\rightarrow$ Độ trễ siêu tốc (**chỉ 4-7 giây cho 240k tokens**), **triệt tiêu 100% lỗi 502 timeout!**

---

### Bước 1: Cấu hình IPv6 trên hạ tầng Oracle Cloud Console
1. **Bật IPv6 trên VCN:**
   - Vào **Networking** $\rightarrow$ **Virtual cloud networks** $\rightarrow$ Chọn VCN của bạn (vd: `vcn-20260727-1732`).
   - Vào mục **IPv6 Prefixes** $\rightarrow$ Bấm **Add IPv6 Prefix** $\rightarrow$ Chọn **Oracle-allocated IPv6 prefix (/56)** $\rightarrow$ Bấm **Add**.
2. **Gán dải IPv6 cho Subnet:**
   - Vào mục **Subnets** $\rightarrow$ Chọn Subnet của VPS.
   - Vào mục **IPv6 Prefixes** $\rightarrow$ Bấm **Add IPv6 Prefix** $\rightarrow$ Nhập tiền tố `/64` (vd: `2603:c024:4526:4c00::/64`) $\rightarrow$ Bấm **Add**.
3. **Cập nhật Route Table:**
   - Vào **Route Tables** của Subnet $\rightarrow$ Chọn **Default Route Table**.
   - Bấm **Add Route Rules**:
     - **Target Type:** `Internet Gateway`
     - **Destination CIDR Block:** `::/0` (Toàn bộ mạng Internet IPv6)
     - **Compartment:** Chọn compartment của bạn $\rightarrow$ Chọn Internet Gateway tương ứng.
4. **Cập nhật Security List:**
   - Vào **Security Lists** $\rightarrow$ Chọn **Default Security List** $\rightarrow$ Mục **Egress Rules**:
   - Thêm Egress Rule cho phép ra ngoài Internet:
     - **Destination CIDR:** `::/0`
     - **IP Protocol:** `All Protocols`

---

### Bước 2: Gán danh sách IPv6 công cộng (GUA) lên card mạng VNIC
1. Vào **Compute** $\rightarrow$ **Instances** $\rightarrow$ Chọn VPS $\rightarrow$ Chọn **Attached VNICs** $\rightarrow$ Bấm vào tên VNIC chính.
2. Chọn menu bên trái **IPv6 Addresses** $\rightarrow$ Bấm nút **Assign IPv6 address**:
   - Chọn tiền tố Subnet `/64`.
   - Chọn **Automatically assign IPv6 addresses from prefix**.
   - Bấm **Assign**.
3. Thực hiện lặp lại để gán đủ 8 địa chỉ IPv6 GUA công cộng (ví dụ 8 IP thực tế đã gán):
   - `2603:c024:4526:4c00:0:3c5c:c67c:ef99`
   - `2603:c024:4526:4c00:0:46bb:1740:759b`
   - `2603:c024:4526:4c00:0:5b72:73a8:43d3`
   - `2603:c024:4526:4c00:0:8ed:dc7d:79c9`
   - `2603:c024:4526:4c00:0:a6b8:f106:60e7`
   - `2603:c024:4526:4c00:0:bc0c:9310:fd52`
   - `2603:c024:4526:4c00:0:ceae:7de8:450b`
   - `2603:c024:4526:4c00:0:d013:5ad1:c907`

*Lưu ý: Hệ điều hành Ubuntu trên OCI sẽ tự động đồng bộ và gán các IP này vào card mạng `ens3` mà không cần chỉnh sửa file netplan thủ công.*

---

### Bước 3: Tạo mã nguồn và khởi chạy `ipv6-relay` qua PM2
Tạo file dịch vụ trung chuyển tại `/home/ubuntu/ipv6-relay.js` trên VPS:

```javascript
const http = require("http");
const net = require("net");

// Danh sách 8 địa chỉ IPv6 GUA được cấp từ Oracle Cloud
const IPS = [
  "2603:c024:4526:4c00:0:3c5c:c67c:ef99", // Port 10001
  "2603:c024:4526:4c00:0:46bb:1740:759b", // Port 10002
  "2603:c024:4526:4c00:0:5b72:73a8:43d3", // Port 10003
  "2603:c024:4526:4c00:0:8ed:dc7d:79c9",  // Port 10004
  "2603:c024:4526:4c00:0:a6b8:f106:60e7", // Port 10005
  "2603:c024:4526:4c00:0:bc0c:9310:fd52", // Port 10006
  "2603:c024:4526:4c00:0:ceae:7de8:450b", // Port 10007
  "2603:c024:4526:4c00:0:d013:5ad1:c907"  // Port 10008
];

IPS.forEach((ip, index) => {
  const port = 10001 + index;
  const server = http.createServer((req, res) => {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("Use CONNECT for HTTPS tunneling");
  });

  server.on("connect", (req, clientSocket, head) => {
    const [targetHost, targetPort] = req.url.split(":");
    // Bắt buộc gói tin ra ngoài phải đi từ localAddress là IPv6 tương ứng
    const serverSocket = net.connect({
      host: targetHost,
      port: parseInt(targetPort, 10) || 443,
      localAddress: ip
    }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length > 0) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("error", () => {
      try { clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch (_) {}
    });
    clientSocket.on("error", () => {
      serverSocket.destroy();
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[IPv6 Relay] Port ${port} -> bound to ${ip}`);
  });
});
```

Khởi động dịch vụ vĩnh viễn trên PM2:
```bash
pm2 start /home/ubuntu/ipv6-relay.js --name "ipv6-relay"
pm2 save
```

Kiểm tra trạng thái các cổng đang lắng nghe:
```bash
sudo netstat -tlpn | grep 1000
```
Kết quả hiển thị đủ 8 cổng từ `10001` đến `10008` trên `127.0.0.1` là hoàn tất!

---

### Bước 4: Khai báo Proxy Pool & Gán tài khoản trên Dashboard 9Router
1. Truy cập **Admin Dashboard** $\rightarrow$ **Proxy Pools** (`https://ainoname.site/dashboard/proxy-pools`).
2. Tạo 8 Proxy Pool tương ứng với 8 cổng:
   - Pool 1: `http://127.0.0.1:10001`
   - Pool 2: `http://127.0.0.1:10002`
   - Pool 3: `http://127.0.0.1:10003`
   - Pool 4: `http://127.0.0.1:10004`
   - Pool 5: `http://127.0.0.1:10005`
   - Pool 6: `http://127.0.0.1:10006`
   - Pool 7: `http://127.0.0.1:10007`
   - Pool 8: `http://127.0.0.1:10008`
3. Vào mục **Connections** (Tài khoản AI) $\rightarrow$ Chỉnh sửa từng tài khoản và gán vào một Proxy Pool riêng biệt:
   - `team89a6@gmail.com` $\rightarrow$ Gán Pool cổng `10004`
   - `gio26022004@gmail.com` $\rightarrow$ Gán Pool cổng `10005`
   - `hausieucapvippro13@gmail.com` $\rightarrow$ Gán Pool cổng `10001`
   - `vinhpromaidinh1234@gmail.com` $\rightarrow$ Gán Pool cổng `10002`
   - `vinhpromaidinh123@gmail.com` $\rightarrow$ Gán Pool cổng `10006`
   - `vinhpromaidinh321@gmail.com` $\rightarrow$ Gán Pool cổng `10007`
   *(Mỗi tài khoản một IP riêng biệt, không ai đụng chạm ai!)*

---

## PHẦN 4: QUY TRÌNH BUILD & DEPLOY PRODUCTION AN TOÀN (1-CLICK)

Khi bạn sửa đổi code giao diện, thêm tính năng, hoặc sửa backend tại `D:\codex xoay`:

### 🚀 Cách Deploy tự động bằng Script chuẩn:
Mở PowerShell tại máy tính cá nhân và chạy:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\vinhmt\.gemini\config\skills\vps\scripts\deploy-code.ps1"
```

**Quy trình 4 bước tự động mà script thực hiện:**
1. Chạy `npm run build` tại máy tính cá nhân (`D:\codex xoay`) bằng Turbopack siêu tốc.
2. Nén toàn bộ thư mục `.next` thành file nhỏ gọn `next_build.tar.gz` (~20MB).
3. Sử dụng `scp` đẩy file nén trực tiếp lên thư mục `/home/ubuntu/9router/` trên VPS.
4. SSH lên VPS giải nén đè vào `.next` và gọi `pm2 restart 9router`. Quá trình cập nhật chỉ mất 3 giây, hoàn toàn không làm gián đoạn người dùng!

---

## PHẦN 5: SAO LƯU & KHÔI PHỤC DATABASE SQLITE TỰ ĐỘNG

Dữ liệu hệ thống được lưu hoàn toàn trong file SQLite `/home/ubuntu/9router/data/db/data.sqlite`.

### 1. Sao lưu tức thời về máy & Gửi vào Telegram Bot
Chạy lệnh sau trên máy tính cá nhân bất cứ khi nào bạn muốn sao lưu:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\vinhmt\.gemini\config\skills\vps\scripts\backup-db.ps1"
```
**Cơ chế hoạt động:**
- Tạo bản sao lưu an toàn cục bộ trong `/home/ubuntu/9router/data/db/backups/`.
- Nén file bằng `gzip` giúp dung lượng giảm từ ~30MB xuống chỉ còn **7-8MB**.
- Tải trực tiếp file `.sqlite.gz` về thư mục `C:\Users\vinhmt\Downloads`.
- Bot Telegram `ainoname9_bot` tự động gửi file đính kèm vào tin nhắn riêng cho Telegram ID `6352706510` và `5690689202`.

---

### 2. Khôi phục / Nạp lại Database (Restore Database)
Khi muốn nạp lại một file backup bất kỳ lên VPS:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\vinhmt\.gemini\config\skills\vps\scripts\restore-db.ps1" -BackupFile "C:\Users\vinhmt\Downloads\9router-data-20261114_120000.sqlite.gz"
```
**Cơ chế bảo vệ dữ liệu 5 lớp:**
1. Tự động sao lưu database hiện tại trên VPS trước khi ghi đè để phòng ngừa nhầm lẫn.
2. Tạm ngưng tiến trình `pm2 stop 9router` để nhả hoàn toàn file lock SQLite.
3. Giải nén và ghi đè file mới an toàn.
4. Xóa sạch file transaction cache cũ (`data.sqlite-wal`, `data.sqlite-shm`) tránh lỗi lệch dữ liệu.
5. Cấp lại phân quyền chuẩn `chmod 664`, `chown ubuntu:ubuntu`, khởi động lại `pm2 start 9router` và tự động kiểm tra phản hồi HTTP 200.

---

## PHẦN 6: SỔ TAY CHẨN ĐOÁN & KHẮC PHỤC SỰ CỐ PRODUCTION

### 1. Sự cố: Cloudflare hiển thị lỗi "521 Web Server Is Down"
- **Nguyên nhân:** Ứng dụng Next.js trên VPS bị tắt, port 20127 không phản hồi hoặc PM2 gặp sự cố.
- **Cách khắc phục:**
  1. SSH vào VPS: `ssh -i "C:\Users\vinhmt\Downloads\ssh-key-2026-07-27.key" ubuntu@161.118.250.92`
  2. Kiểm tra trạng thái: `pm2 status`
  3. Nếu `9router` hiển thị `errored` hoặc `stopped`: Xem log lỗi bằng `pm2 logs 9router --lines 50`
  4. Khởi động lại: `pm2 restart 9router`

### 2. Sự cố: Lỗi "429 This request would exceed your account's rate limit"
- **Nguyên nhân:** Tài khoản AI Google Antigravity hoặc Claude đạt ngưỡng hạn ngạch của phiên làm việc (Session Quota) hoặc dính cooldown hạn mức 60 phút từ Google/Anthropic.
- **Cách khắc phục:**
  - Hệ thống 9Router sẽ tự động chuyển sang tài khoản kết nối dự phòng tiếp theo trong nhóm.
  - Kiểm tra xem tài khoản đó đã được gán Proxy Pool IPv6 riêng biệt chưa (xem lại **Phần 3, Bước 4**). Nếu nhiều tài khoản dùng chung 1 IP, Google sẽ cộng dồn hạn ngạch và bóp 429 nhanh gấp bội.

### 3. Sự cố: Lỗi "502 Bad Gateway / fetch connect timeout"
- **Nguyên nhân:** Request xử lý ngữ cảnh quá lớn (prompt 200k+ tokens) đi qua proxy trung gian Cloudflare Worker bị time-out quá 100 giây.
- **Cách khắc phục:**
  - Chuyển hẳn tài khoản đó sang sử dụng Proxy Pool IPv6 Local (`http://127.0.0.1:10001` - `10008`).
  - Kiểm tra xem tiến trình `ipv6-relay` có đang chạy bình thường không bằng lệnh: `pm2 status ipv6-relay`. Nếu dừng, chạy `pm2 restart ipv6-relay`.

### 4. Sự cố: VPS bị đơ, không phản hồi do tràn RAM (Memory Leak)
- **Cách khắc phục:**
  ```bash
  # Giải phóng bộ nhớ RAM đệm của Linux
  sudo sync && sudo sysctl -w vm.drop_caches=3
  
  # Kiểm tra tiến trình ngốn RAM
  top -o %MEM
  
  # Khởi động lại các tiến trình PM2
  pm2 restart all
  ```

---

## PHẦN 7: BỘ LỆNH BẢO TRÌ NHANH TRÊN VPS (CHEAT SHEET)

```bash
# 1. Kiểm tra tài nguyên VPS (RAM, SWAP, CPU Load, Uptime)
free -m && uptime

# 2. Xem trạng thái các dịch vụ đang chạy
pm2 status

# 3. Theo dõi luồng log trực tiếp của 9Router (theo dõi streaming, token, lỗi)
pm2 logs 9router --lines 100

# 4. Theo dõi log của hệ thống xoay IPv6
pm2 logs ipv6-relay --lines 50

# 5. Khởi động lại toàn bộ dịch vụ
pm2 restart all

# 6. Kiểm tra cổng mạng đang lắng nghe (20127 và 10001-10008)
sudo netstat -tlpn | grep -E '20127|1000'

# 7. Kiểm tra kết nối ra ngoài Internet bằng IPv6 bất kỳ
curl -6 -I https://www.google.com --interface 2603:c024:4526:4c00:0:3c5c:c67c:ef99
```

---

## 💼 PHẦN 8: QUY TRÌNH TẠO KEY & CẤU HÌNH CHO KHÁCH HÀNG

### Bước 1: Tạo Key trên Admin Dashboard
1. Truy cập `https://ainoname.site/dashboard/client-keys`.
2. Bấm **Tạo Key mới** $\rightarrow$ Điền tên khách hàng $\rightarrow$ Cài đặt hạn mức token hoặc không giới hạn $\rightarrow$ Bấm **Tạo Key**.
3. Sao chép chuỗi mã Key tạo ra (ví dụ: `sk-913895af49422e...`).

### Bước 2: Thông tin cấu hình gửi khách hàng
* **Base URL:** `https://api.ainoname.site/v1`
* **API Key:** `sk-913895af49422e...`
* **Web Kiểm tra Token Trực Tiếp (Client Portal):** `https://ainoname.site/login` *(Khách chỉ cần dán mã `sk-...` là xem được hạn ngạch, số token đã dùng theo từng nhà cung cấp).*

**File mẫu cấu hình `config.toml` (dành cho Codex Desktop / Cursor / Cline):**
```toml
[model_providers.openai-custom]
experimental_bearer_token = "sk-913895af49422e..."
name = "VinAi"
base_url = "https://api.ainoname.site/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
```
