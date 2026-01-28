# TELEGRAM BOT WEBHOOK - HƯỚNG DẪN DEPLOY VERCEL

## ✅ ĐÃ HOÀN THÀNH

Đã tạo webhook endpoint: `/api/telegram-webhook.js`

Bot bây giờ chạy serverless trên Vercel, không cần chạy local 24/7!

---

## 🚀 CÁCH DEPLOY

### Bước 1: Push code lên GitHub

```bash
git add .
git commit -m "Add Telegram webhook bot"
git push
```

### Bước 2: Vercel tự động deploy

Vercel sẽ tự build và deploy. Lấy URL production (VD: `https://your-app.vercel.app`)

### Bước 3: Setup Telegram Webhook

Mở trình duyệt và truy cập URL này (thay `YOUR_VERCEL_URL`):

```
https://api.telegram.org/bot8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA/setWebhook?url=https://YOUR_VERCEL_URL/api/telegram-webhook
```

**Ví dụ:**
```
https://api.telegram.org/bot8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA/setWebhook?url=https://webbanacc.vercel.app/api/telegram-webhook
```

**Kết quả thành công:**
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

---

## 🧪 KIỂM TRA WEBHOOK

Mở trình duyệt:
```
https://api.telegram.org/bot8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA/getWebhookInfo
```

Sẽ hiển thị:
```json
{
  "ok": true,
  "result": {
    "url": "https://your-app.vercel.app/api/telegram-webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

---

## 📱 SỬ DỤNG BOT

Mở Telegram → Tìm bot → Paste format:

```
[邮箱账号----密码----网页取件]UCanPlus1669@purinikiopiy.asia---zxcvbnm666..----https://mail.chatgpt.org.uk/UCanPlus1669
```

Bot sẽ tự động thêm account!

---

## ⚠️ LƯU Ý

1. **Bot polling (telegram-bot.js) KHÔNG CẦN CHẠY NỮA**
   - Webhook đã thay thế polling
   - Không cần `npm run bot`

2. **Environment Variables trên Vercel:**
   - `TELEGRAM_BOT_TOKEN=8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA`
   - `MONGO_URI=...`
   - (Đã có sẵn)

3. **Xóa Webhook (nếu cần):**
```
https://api.telegram.org/bot8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA/deleteWebhook
```

---

## 🎉 HOÀN TẤT

✅ Bot chạy 24/7 trên Vercel
✅ Không cần máy tính chạy local
✅ Miễn phí hoàn toàn
✅ Tự động scale

**Chỉ cần push code là xong!** 🚀
