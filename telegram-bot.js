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

const TELEGRAM_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const TELEGRAM_OTP_REGEX = /\b[A-Z2-7]{16,}\b/i;
const normalizeTelegramAccountText = (rawText, { requireTeamPrefix = false } = {}) => {
  if (!rawText) return '';
  let cleanedText = String(rawText).replace(/^\[.*?\]/, '').trim();
  if (requireTeamPrefix) {
    if (!/^team\b/i.test(cleanedText)) return '';
    cleanedText = cleanedText.replace(/^team\b[:\s-]*/i, '').trim();
  }
  return cleanedText.replace(/[｜¦┃]/g, '|').replace(/\t+/g, '|');
};
const parseTelegramCredentialInput = (rawText, { requireTeamPrefix = false } = {}) => {
  const normalizedInput = normalizeTelegramAccountText(rawText, { requireTeamPrefix });
  if (!normalizedInput) return null;

  if (normalizedInput.includes('---')) return null;

  const flatInput = normalizedInput.replace(/\r/g, '').replace(/\n+/g, '|');
  const parts = flatInput.split(/\s*\|\s*/).map((part) => String(part || '').trim()).filter(Boolean);
  if (parts.length !== 3) return null;

  const [email, password, otpSecret] = parts;
  if (!TELEGRAM_EMAIL_REGEX.test(email)) return null;
  if (!password || !otpSecret) return null;
  if (!TELEGRAM_OTP_REGEX.test(otpSecret)) return null;

  return {
    email: String(email || '').trim(),
    password: String(password || '').trim(),
    otpSecret: String(otpSecret || '').trim(),
    link: '',
  };
};
const parseTeamAccountInput = (rawText) =>
  parseTelegramCredentialInput(rawText, { requireTeamPrefix: true });
const parseChatgptAccountInput = (rawText) =>
  parseTelegramCredentialInput(rawText, {
    requireTeamPrefix: false,
  });
const clampMonthDay = (year, monthIndex, dayOfMonth) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(dayOfMonth, lastDay);
};
const addMonthsClamped = (dateInput, months) => {
  const baseDate = new Date(dateInput);
  if (Number.isNaN(baseDate.getTime())) return new Date();
  const result = new Date(baseDate);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(clampMonthDay(result.getFullYear(), result.getMonth(), originalDay));
  return result;
};
const durationToMonths = (duration = '1M') => ({
  '1M': 1,
  '2M': 2,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
}[String(duration || '1M').toUpperCase()] || 1);
const getUserRemainingDays = (user, duration = '1M') => {
  if (!user) return null;
  const now = new Date();
  if (user.expiredAt) {
    return Math.ceil((new Date(user.expiredAt) - now) / (1000 * 60 * 60 * 24));
  }
  if (user.joinedAt) {
    const fallbackExpiry = addMonthsClamped(user.joinedAt, durationToMonths(duration));
    return Math.ceil((fallbackExpiry - now) / (1000 * 60 * 60 * 24));
  }
  return null;
};
const formatCompactStatsMessage = (summary = {}) => {
  const chatgpt = summary?.chatgpt || {};
  const chatgptWarehouses = chatgpt?.warehouseTabs || {};
  const chatgptTypes = chatgpt?.totalTypeTabs || {};
  const chatgptMarket = chatgpt?.marketShelfTabs || {};
  const shared = summary?.shared || {};
  const privateStats = summary?.private || {};
  const users = summary?.users || {};
  const expiry = summary?.expiry || {};
  const team = summary?.team || {};
  const teamWarehouses = team?.warehouses || {};
  const teamTotalWarehouseModes = team?.totalWarehouseModes || {};
  const teamExpiry = team?.expiry || {};
  const market = summary?.marketplace || {};
  const providers = market?.providers || {};
  const web = summary?.web || {};
  const updatedAt = summary?.updatedAt
    ? new Date(summary.updatedAt)
    : new Date();
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? new Date().toLocaleString('vi-VN')
    : updatedAt.toLocaleString('vi-VN');

  return [
    '📊 SYSTEM STATS',
    '',
    '🤖 ChatGPT',
    `- Kho: Tat ca ${Number(chatgptWarehouses.all || summary?.totalAccounts || 0)} | Kho tong ${Number(chatgptWarehouses.total || 0)} | Kho market ${Number(chatgptWarehouses.market || 0)} | Kho duoi 25 ${Number(chatgptWarehouses.short || 0)}`,
    `- Kho tong: Goi 1 ${Number(chatgptTypes.package1 || shared.total || 0)} | Goi 2 ${Number(chatgptTypes.package2 || privateStats.total || 0)} | Chua chon ${Number(chatgptTypes.unassigned || 0)}`,
    `- Kho market: Chua ban ${Number(chatgptMarket.all || 0)} | Da ban ${Number(chatgptMarket.sold || 0)}`,
    `- User: Active ${Number(users.active || 0)} | Expired ${Number(users.expired || 0)}`,
    `- Han acc: Exp ${Number(expiry.expired || 0)} | <=3d ${Number(expiry.within3Days || 0)} | <=7d ${Number(expiry.within7Days || 0)}`,
    '',
    '👥 Team',
    `- Kho: Tat ca ${Number(team.totalAccounts || 0)} | Kho tong ${Number(teamWarehouses.total || 0)} | Kho market ${Number(teamWarehouses.market || 0)} | Kho duoi 25 ${Number(teamWarehouses.short || 0)}`,
    `- Kho tong: Goi chia se ${Number(teamTotalWarehouseModes.slot || 0)} | Nguyen acc ${Number(teamTotalWarehouseModes.business || 0)}`,
    `- Su dung: Khach ${Number(team.activeCustomers || 0)} | Dang dung ${Number(team.usedAccounts || 0)} | Rong ${Number(team.emptyAccounts || 0)} | San sang ${Number(team.marketReady || 0)}`,
    `- Han acc: Exp ${Number(teamExpiry.expired || 0)} | <=3d ${Number(teamExpiry.within3Days || 0)} | <=7d ${Number(teamExpiry.within7Days || 0)}`,
    '',
    '🛒 Don san',
    `- ChatGPT: Don ${Number(market.chatgptOrders || 0)} | Bao hanh ${Number(market.chatgptWarranty || 0)}`,
    `- Team: Don ${Number(market.teamOrders || 0)} | Bao hanh ${Number(market.teamWarranty || 0)}`,
    `- Provider: Datammo ${Number(providers.datammoOrders || 0)}/${Number(providers.datammoWarranty || 0)} | Shopmini ${Number(providers.shopminiOrders || 0)}/${Number(providers.shopminiWarranty || 0)}`,
    '',
    '🌐 Web',
    `- User ${Number(web.totalUsers || 0)} | Don ${Number(web.totalOrders || 0)} | Pending ${Number(web.pendingOrders || 0)} | Fulfilled ${Number(web.fulfilledOrders || 0)}`,
    '',
    `🕒 Updated: ${updatedLabel}`,
  ].join('\n');
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
email|password|2FA_SECRET
\`\`\`

*Team:* Paste format:
\`\`\`
team email|password|2FA_SECRET
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
    bot.sendMessage(chatId, 'Dang tai stats...');
    const summaryResponse = await axios.get(`${API_URL}/api/chatgpt/stats-public`);
    const summary = summaryResponse?.data?.summary || {};
    bot.sendMessage(chatId, formatCompactStatsMessage(summary));
    return;
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
          const daysRemaining = getUserRemainingDays(u, acc.duration || '1M');
          if (daysRemaining === null || daysRemaining > 0) {
            activeUsers++;
          } else {
            expiredUsers++;
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

          const expiredAt = addMonthsClamped(new Date(), 12); // Coursera: 1 năm

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
    const { email, password, otpSecret, link: recoveryUrl } = parsedTeamAccount;

    try {
      bot.sendMessage(chatId, '⏳ Đang thêm team account...');

      const expiredAt = addMonthsClamped(new Date(), 1);
      const expiredAtStr = expiredAt.toISOString();

      await axios.post(`${API_URL}/api/team-public`, {
        username: email,
        password,
        otpSecret,
        recoveryUrl,
        note: '',
        saleMode: 'business',
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

      const compactSuccessMessage = [
        'âœ… *Tá»° Äá»˜NG THÃŠM TEAM THÃ€NH CÃ”NG!*',
        '',
        `ðŸ“§ *Email:* \`${email}\``,
        `ðŸ”‘ *GPT Password:* \`${password}\``,
        `ðŸ” *2FA:* \`${otpSecret}\``,
      ].join('\n');
      const displayMessage = [
        '*THEM TEAM THANH CONG!*',
        '',
        `Email: \`${email}\``,
        `Password: \`${password}\``,
        `2FA: \`${otpSecret}\``,
        'Mode: `business`',
      ].join('\n');
      bot.sendMessage(chatId, displayMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Auto-add team error:', error.response?.data || error.message);
      bot.sendMessage(chatId, `❌ Lỗi khi thêm team account: ${error.response?.data?.error || error.message}`);
    }
    return;
  }

  // CHATGPT AUTO-DETECT: email|password|2fa|link or legacy --- format
  const hasDelimiters =
    text.includes('---') || text.includes('----') || /[|｜¦┃]/.test(text);
  const hasAtSign = text.includes('@');

  if (hasDelimiters && hasAtSign) {
    // Có vẻ là format account, parse luôn!
    const parsedChatgptAccount = parseChatgptAccountInput(text);

    // Bỏ phần text tiếng Trung nếu có
    if (parsedChatgptAccount) {

    // Normalize: Thay ---- thành ---
      const { email, password, otpSecret, link: recoveryMailUrl } = parsedChatgptAccount;






      if (email && password) {
        // Auto add account!
        try {
          bot.sendMessage(chatId, '⏳ Đang thêm account...');

          const expiredAt = addMonthsClamped(new Date(), 1);
          const expiredAtStr = expiredAt.toISOString();

          await axios.post(`${API_URL}/api/chatgpt`, {
            username: email,
            password,
            otpSecret,
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

          const compactSuccessMessage = [
            'âœ… *Tá»° Äá»˜NG THÃŠM THÃ€NH CÃ”NG!*',
            '',
            `ðŸ“§ *Email:* \`${email}\``,
            `ðŸ”‘ *Password:* \`${password}\``,
            `ðŸ” *2FA:* \`${otpSecret}\``,
          ].join('\n');
          const displayMessage = [
            '*THEM ACCOUNT THANH CONG!*',
            '',
            `Email: \`${email}\``,
            `Password: \`${password}\``,
            `2FA: \`${otpSecret}\``,
          ].join('\n');
          bot.sendMessage(chatId, displayMessage, { parse_mode: 'Markdown' });

        } catch (error) {
          console.error('Auto-add error:', error.response?.data || error.message);
          bot.sendMessage(chatId, `❌ Lỗi khi thêm account: ${error.response?.data?.message || error.message}`);
        }
      }
    }
  }
});

console.log('✅ Bot đã sẵn sàng! Gửi /start để bắt đầu.');
