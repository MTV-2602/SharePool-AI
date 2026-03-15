require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Telegram Bot Token (lấy từ @BotFather)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// API URL (production hoặc localhost)
const API_URL = process.env.API_URL || 'http://localhost:3000';

// Telegram User ID được phép dùng bot (bảo mật)
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id))
  : []; // Để trống = cho phép tất cả users

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log('🤖 Telegram Bot đang chạy...');

// Middleware: Kiểm tra quyền
const checkPermission = (msg) => {
  if (ALLOWED_USER_IDS.length === 0) return true; // Không giới hạn
  return ALLOWED_USER_IDS.includes(msg.from.id);
};

const parseTeamAccountInput = (rawText) => {
  if (!rawText) return null;

  const cleanedText = rawText.replace(/^\[.*?\]/, '').trim();
  if (!/^team\b/i.test(cleanedText)) return null;

  const lines = cleanedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sourceLine = lines.find((line) => /-{3,}/.test(line)) || cleanedText;
  const normalized = sourceLine.replace(/^team\s+/i, '').trim();
  const parts = normalized.split(/-{3,}/).map((part) => part.trim()).filter(Boolean);

  if (parts.length < 3) return null;

  const [email, password, thirdPart = '', fourthPart = ''] = parts;
  const fallbackRecoveryMatch = rawText.match(/https?:\/\/\S+/i);
  const recoveryUrl = fourthPart || (/^https?:\/\//i.test(thirdPart) ? thirdPart : '') || (fallbackRecoveryMatch ? fallbackRecoveryMatch[0].trim() : '');

  if (!email || !password || !email.includes('@')) return null;

  return { email, password, recoveryUrl };
};

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  const welcomeMessage = `
🤖 *ChatGPT & Coursera Manager Bot*

📋 *LỆNH CÓ SẴN:*

/stats - Thống kê tổng quan
/help - Hướng dẫn

---

📝 *CÁCH THÊM ACCOUNT:*

*ChatGPT:* Paste format:
\`\`\`
email---password---recoveryUrl
\`\`\`

*Team:* Paste format:
\`\`\`
team email----gptpass----recoveryUrl
\`\`\`

*Coursera:* Paste format:
\`\`\`
email,password,courseCode
\`\`\`

💡 *Bot tự động nhận diện loại tài khoản!*
  `;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Command: /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  const helpMessage = `
🤖 *ChatGPT & Coursera Manager Bot*

📋 *LỆNH CÓ SẴN:*

/stats - Thống kê tổng quan
/help - Hướng dẫn

---
💡 *Mẹo:*
- Thêm acc chỉ cần paste đúng format vào bot.
- Bot tự động nhận diện cả ChatGPT và Coursera.
  `;

  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Command: /add REMOVED (Auto-detect only)

// Command: /list REMOVED

// Command: /stats
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;

  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  try {
    bot.sendMessage(chatId, '⏳ Đang tính toán...');

    const response = await axios.get(`${API_URL}/api/data`);
    const accounts = response.data;

    // Calculate stats
    const totalAccounts = accounts.length;
    const package1Count = accounts.filter(a => a.type === 'package1').length;
    const package2Count = accounts.filter(a => a.type === 'package2').length;
    const unassignedCount = accounts.filter(a => a.type === 'unassigned').length;

    let totalUsers = 0;
    let activeUsers = 0;
    let expiredUsers = 0;

    accounts.forEach(acc => {
      if (acc.users && acc.users.length > 0) {
        totalUsers += acc.users.length;
        acc.users.forEach(u => {
          if (u.joinedAt) {
            const today = new Date();
            const joined = new Date(u.joinedAt);
            const daysUsed = Math.floor((today - joined) / (1000 * 60 * 60 * 24));

            if (daysUsed < 30) {
              activeUsers++;
            } else {
              expiredUsers++;
            }
          } else {
            activeUsers++;
          }
        });
      }
    });

    // Accounts expiring soon
    const today = new Date();
    const urgentAccounts = accounts.filter(acc => {
      const expiry = new Date(acc.expiryDate);
      const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      return daysLeft <= 7 && daysLeft >= 0;
    }).length;

    const statsMessage = `
📊 *THỐNG KÊ HỆ THỐNG*

*📦 ACCOUNTS:*
├ Tổng: ${totalAccounts}
├ 🟢 Package1: ${package1Count}
├ 🔵 Package2: ${package2Count}
└ ⚪ Unassigned: ${unassignedCount}

*👥 USERS:*
├ Tổng: ${totalUsers}
├ ✅ Active: ${activeUsers}
└ ❌ Expired: ${expiredUsers}

*⚠️ CẢNH BÁO:*
└ ${urgentAccounts} accounts hết hạn trong 7 ngày

_Cập nhật: ${new Date().toLocaleString('vi-VN')}_
    `;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error calculating stats:', error.message);
    bot.sendMessage(chatId, '❌ Lỗi khi tính thống kê!');
  }
});

// Command: /expire REMOVED

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

// Auto-detect: Listen to all text messages (không cần /add)
bot.on('message', async (msg) => {
  // Bỏ qua nếu là command
  if (msg.text && msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text) return;
  if (!checkPermission(msg)) return;

  // COURSERA AUTO-DETECT: email,password,courseCode format
  if (text.includes(',') && text.includes('@') && !text.includes('---')) {
    const parts = text.split(',').map(p => p.trim());

    if (parts.length >= 2 && parts.length <= 3) {
      const [email, password, courseCode] = parts;

      if (email && password && email.includes('@')) {
        try {
          bot.sendMessage(chatId, '⏳ Đang thêm tài khoản Coursera vào Sheet...');

          const expiredAt = new Date();
          expiredAt.setDate(expiredAt.getDate() + 365); // Coursera: 1 năm

          // Format dữ liệu giống web: [email, password, courseCode]
          const sheetData = [[
            email,
            password,
            courseCode || ''
          ]];

          // Lấy script URL - dùng mặc định giống web
          const scriptUrl = process.env.GOOGLE_SHEET_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwoKnZsauopOfFZfp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZiQ63ZahKnJYNH5cJXsV/exec';

          // Gửi lên Google Sheet với sheetName mặc định
          await axios.post(`${API_URL}/api/proxy-sheet`, {
            scriptUrl: scriptUrl,
            sheetName: '', // Để trống sẽ dùng sheet mặc định
            data: sheetData
          });

          const successMessage = `
✅ *TỰ ĐỘNG THÊM COURSERA VÀO SHEET THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *Password:* \`${password}\`
${courseCode ? `📚 *Course:* \`${courseCode}\`\n` : ''}📅 *Hết hạn:* ${expiredAt.toLocaleDateString('vi-VN')}

💡 *Tip:* Paste format tiếp theo để thêm nhanh!
          `;

          bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
          return;
        } catch (error) {
          console.error('Auto-add Coursera error:', error.response?.data || error.message);
          bot.sendMessage(chatId, `❌ Lỗi khi thêm Coursera: ${error.response?.data?.error || error.message}`);
          return;
        }
      }
    }
  }

  const parsedTeamAccount = parseTeamAccountInput(text);
  if (parsedTeamAccount) {
    const { email, password, recoveryUrl } = parsedTeamAccount;

    try {
      bot.sendMessage(chatId, '⏳ Đang thêm team account...');

      const expiredAt = new Date();
      expiredAt.setDate(expiredAt.getDate() + 30);
      const expiredAtStr = expiredAt.toISOString();

      await axios.post(`${API_URL}/api/team-public`, {
        username: email,
        password,
        recoveryUrl,
        note: '',
        saleMode: 'slot',
        expiredAt: expiredAtStr
      });

      const successMessage = `
✅ *TỰ ĐỘNG THÊM TEAM THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *GPT Password:* \`${password}\`
🔗 *Recovery URL:* ${recoveryUrl || '_Không có_'}
📦 *Mode:* slot team
📅 *Hết hạn:* ${expiredAt.toLocaleDateString('vi-VN')}

💡 *Tip:* Paste tiếp format \`team email----pass----link\` để thêm nhanh!
      `;

      bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Auto-add team error:', error.response?.data || error.message);
      bot.sendMessage(chatId, `❌ Lỗi khi thêm team account: ${error.response?.data?.error || error.message}`);
    }
    return;
  }

  // CHATGPT AUTO-DETECT: email---password---url format
  const hasChinesePrefix = text.match(/^\[.*?\]/);
  const hasDelimiters = text.includes('---') || text.includes('----');
  const hasAtSign = text.includes('@');

  if (hasDelimiters && hasAtSign) {
    // Có vẻ là format account, parse luôn!
    let input = text;

    // Bỏ phần text tiếng Trung nếu có
    input = input.replace(/^\[.*?\]/, '').trim();

    // Normalize: Thay ---- thành ---
    input = input.replace(/----/g, '---');

    const parts = input.split('---').map(p => p.trim());

    if (parts.length === 3) {
      const [email, password, recoveryMailUrl] = parts;

      if (email && password) {
        // Auto add account!
        try {
          bot.sendMessage(chatId, '⏳ Đang thêm account...');

          // Tính expiredAt: +30 ngày
          const expiredAt = new Date();
          expiredAt.setDate(expiredAt.getDate() + 30);
          const expiredAtStr = expiredAt.toISOString();

          await axios.post(`${API_URL}/api/chatgpt`, {
            username: email,
            password,
            link: recoveryMailUrl,
            type: 'unassigned',
            expiredAt: expiredAtStr,
            note: ''
          });

          const successMessage = `
✅ *TỰ ĐỘNG THÊM THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *Password:* \`${password}\`
📬 *Recovery URL:* ${recoveryMailUrl}
📦 *Type:* unassigned
📅 *Hết hạn:* ${expiredAt.toLocaleDateString('vi-VN')}

💡 *Tip:* Paste format tiếp theo để thêm nhanh!
          `;

          bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });

        } catch (error) {
          console.error('Auto-add error:', error.response?.data || error.message);
          bot.sendMessage(chatId, `❌ Lỗi khi thêm account: ${error.response?.data?.message || error.message}`);
        }
      }
    }
  }
});

console.log('✅ Bot đã sẵn sàng! Gửi /start để bắt đầu.');
