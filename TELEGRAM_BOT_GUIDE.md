# TELEGRAM BOT - HƯỚNG DẪN SỬ DỤNG

## 📱 TÍNH NĂNG

Telegram Bot để quản lý ChatGPT accounts từ điện thoại/Telegram:
- ✅ Thêm account mới bằng format đặc biệt
- ✅ Xem danh sách accounts
- ✅ Thống kê tổng quan
- ✅ Cảnh báo accounts sắp hết hạn

---

## 🚀 SETUP BOT

### Bước 1: Tạo Bot trên Telegram
1. Mở Telegram → Tìm **@BotFather**
2. Gửi `/newbot`
3. Đặt tên bot (VD: "ChatGPT Manager Bot")
4. Đặt username (VD: "chatgpt_manager_bot")
5. Copy **Bot Token** (dạng: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Bước 2: Cấu hình Bot Token
Mở file `.env` và thêm:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
API_URL=http://localhost:3000
```

### Bước 3: Cài đặt dependencies
```bash
npm install
```

### Bước 4: Chạy Bot
```bash
npm run bot
```

Hoặc chạy cùng lúc server + bot (2 terminals):
```bash
# Terminal 1: Backend server
npm start

# Terminal 2: Telegram bot
npm run bot
```

---

## 📝 CÁC LỆNH BOT

### `/start`
Khởi động bot và xem hướng dẫn

### `/help`
Xem hướng dẫn chi tiết

### `/add email---password---recoveryUrl`
Thêm account ChatGPT mới

**Format:**
```
/add email@domain.com---password123---https://mail.example.com/email
```

**Ví dụ thực tế:**
```
/add UCanPlus1669@purinikiopiy.asia---zxcvbnm666..---https://mail.chatgpt.org.uk/UCanPlus1669@purinikiopiy.asia
```

**Lưu ý:**
- Ngăn cách bằng `---` (3 dấu gạch ngang)
- Account sẽ tự động có type: `unassigned`
- ExpiryDate mặc định: +30 ngày từ hôm nay
- Recovery URL được lưu vào field `recoveryMailUrl`

### `/list`
Xem tất cả accounts

### `/list package1`
Xem chỉ accounts Package1

### `/list package2`
Xem chỉ accounts Package2

### `/stats`
Xem thống kê tổng quan:
- Tổng số accounts (Package1/2/Unassigned)
- Tổng số users (Active/Expired)
- Số accounts sắp hết hạn

### `/expire`
Xem danh sách accounts hết hạn trong 7 ngày

---

## 🔒 BẢO MẬT

### Giới hạn người dùng
Mặc định bot cho phép tất cả người dùng. Để chỉ cho phép một số người:

1. **Lấy Telegram User ID:**
   - Mở Telegram → Tìm @userinfobot
   - Gửi `/start` → Nhận User ID (VD: 123456789)

2. **Cấu hình trong .env:**
```env
ALLOWED_USER_IDS=123456789,987654321
```

Chỉ những User ID này mới dùng được bot!

---

## 🌐 DEPLOY BOT

### Deploy cùng Backend trên VPS/Server

1. **Upload code lên server**
2. **Install dependencies:**
```bash
npm install
```

3. **Chạy bot dưới nền bằng PM2:**
```bash
# Install PM2
npm install -g pm2

# Start backend
pm2 start server.js --name "backend"

# Start bot
pm2 start telegram-bot.js --name "telegram-bot"

# Auto restart khi reboot
pm2 startup
pm2 save
```

4. **Kiểm tra logs:**
```bash
pm2 logs telegram-bot
```

### Deploy trên Vercel (Webhook mode)
Bot hiện tại dùng **polling mode** (phù hợp VPS/local).

Nếu muốn deploy trên Vercel, cần chuyển sang **webhook mode** (phức tạp hơn).

---

## 📊 TEST BOT

1. Mở Telegram → Tìm bot của bạn (theo username đã đặt)
2. Gửi `/start`
3. Thử thêm account:
```
/add test@gmail.com---pass123---https://mail.tm/test
```
4. Kiểm tra `/list` và `/stats`

---

## ⚠️ LƯU Ý

### Recovery Mail URL
Field mới `recoveryMailUrl` chưa có trong database schema hiện tại.

**Nếu muốn lưu Recovery URL:**
1. Cập nhật MongoDB schema (thêm field `recoveryMailUrl`)
2. Hoặc lưu vào field `note` (tạm thời)

### API URL
- **Local:** `http://localhost:3000`
- **Production:** Thay bằng URL Vercel của bạn

```env
API_URL=https://your-app.vercel.app
```

### Format Parse
Bot parse format: `email---password---url`

Nếu muốn thay đổi format, sửa trong `telegram-bot.js`:
```javascript
const parts = input.split('---').map(p => p.trim());
```

---

## 🐛 TROUBLESHOOTING

### Lỗi: "Polling error"
- Kiểm tra Bot Token đúng chưa
- Có internet không?
- Bot đã bị xóa trên @BotFather chưa?

### Lỗi: "❌ Lỗi khi thêm account"
- Kiểm tra backend server có chạy không (`npm start`)
- Kiểm tra API_URL trong .env
- Xem logs backend để debug

### Bot không phản hồi
- Restart bot: `pm2 restart telegram-bot`
- Kiểm tra logs: `pm2 logs telegram-bot`

---

## 📞 SUPPORT

Nếu cần thêm tính năng:
- Sửa/xóa account qua bot
- Thêm user vào account
- Gia hạn user
- Notification tự động

Hãy yêu cầu tôi implement thêm!

---

**Last Updated:** January 29, 2026
