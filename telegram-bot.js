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

/add - Thêm account ChatGPT
/list - Xem danh sách accounts
/stats - Thống kê tổng quan
/expire - Accounts sắp hết hạn
/help - Hướng dẫn

---

📝 *CÁCH THÊM ACCOUNT:*

*ChatGPT:* Paste format:
\`\`\`
email---password---recoveryUrl
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
📖 *HƯỚNG DẪN SỬ DỤNG*

*1️⃣ THÊM ACCOUNT:*
\`\`\`
/add email---password---recoveryMailUrl
\`\`\`

*Ví dụ:*
\`\`\`
/add UCanPlus1669@purinikiopiy.asia---zxcvbnm666..---https://mail.chatgpt.org.uk/UCanPlus1669
\`\`\`

*Format đầy đủ (copy nguyên từ nguồn):*
\`\`\`
/add [邮箱账号----密码----网页取件]email---pass---url
\`\`\`

💡 *Bot tự động nhận cả* \`---\` *và* \`----\`

*2️⃣ XEM DANH SÁCH:*
\`/list\` - Xem tất cả accounts
\`/list package1\` - Chỉ xem Package1
\`/list package2\` - Chỉ xem Package2

*3️⃣ THỐNG KÊ:*
\`/stats\` - Tổng quan hệ thống

*4️⃣ CẢNH BÁO:*
\`/expire\` - Accounts hết hạn trong 7 ngày

---

⚠️ *LƯU Ý:*
- Account mặc định là *unassigned*
- ExpiryDate mặc định: +30 ngày từ hôm nay
- Có thể dùng 3 hoặc 4 dấu gạch đều được
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Command: /add email----password----recoveryUrl
bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }
  
  let input = match[1].trim();
  
  // Bỏ phần text tiếng Trung nếu có: [邮箱账号----密码----网页取件,接收验证码的地址]
  input = input.replace(/^\[.*?\]/, '').trim();
  
  // Normalize: Thay tất cả ---- thành --- để parse dễ hơn
  input = input.replace(/----/g, '---');
  
  // Parse format: email---password---recoveryUrl
  const parts = input.split('---').map(p => p.trim());
  
  if (parts.length !== 3) {
    bot.sendMessage(chatId, `
❌ *FORMAT SAI!*

Đúng phải là:
\`\`\`
/add email---password---recoveryUrl
\`\`\`

(Có thể dùng 3 hoặc 4 dấu gạch đều được)

*Ví dụ:*
\`\`\`
/add UCanPlus1669@purinikiopiy.asia---zxcvbnm666..---https://mail.chatgpt.org.uk/UCanPlus1669
\`\`\`

*Hoặc format đầy đủ:*
\`\`\`
/add [邮箱账号----密码----网页取件,接收验证码的地址]email---pass---url
\`\`\`

Bạn đã nhập: ${parts.length} phần (cần 3 phần)
Các phần: ${parts.map((p, i) => `\n${i+1}. ${p}`).join('')}
    `, { parse_mode: 'Markdown' });
    return;
  }
  
  const [email, password, recoveryMailUrl] = parts;
  
  // Validation
  if (!email || !password) {
    bot.sendMessage(chatId, '❌ Email và Password không được trống!');
    return;
  }
  
  // Tính expiredAt: +30 ngày
  const expiredAt = new Date();
  expiredAt.setDate(expiredAt.getDate() + 30);
  const expiredAtStr = expiredAt.toISOString();
  
  try {
    bot.sendMessage(chatId, '⏳ Đang thêm account...');
    
    // Call API
    const response = await axios.post(`${API_URL}/api/chatgpt`, {
      username: email,
      password,
      link: recoveryMailUrl,
      type: 'unassigned',
      expiredAt: expiredAtStr,
      note: ''
    });
    
    const successMessage = `
✅ *THÊM THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *Password:* \`${password}\`
📬 *Recovery URL:* ${recoveryMailUrl}
📦 *Type:* unassigned
📅 *Hết hạn:* ${expiredAt.toLocaleDateString('vi-VN')}

_Account đã được thêm vào hệ thống!_
    `;
    
    bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error adding account:', error.response?.data || error.message);
    bot.sendMessage(chatId, `❌ Lỗi khi thêm account: ${error.response?.data?.message || error.message}`);
  }
});

// Command: /list [type]
bot.onText(/\/list\s*(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  
  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }
  
  const filterType = match[1]?.trim().toLowerCase();
  
  try {
    bot.sendMessage(chatId, '⏳ Đang tải dữ liệu...');
    
    const response = await axios.get(`${API_URL}/api/data`);
    let accounts = response.data;
    
    // Filter by type if specified
    if (filterType && ['package1', 'package2', 'unassigned'].includes(filterType)) {
      accounts = accounts.filter(acc => acc.type === filterType);
    }
    
    if (accounts.length === 0) {
      bot.sendMessage(chatId, '📭 Không có account nào!');
      return;
    }
    
    // Format message
    let message = `📋 *DANH SÁCH ACCOUNTS* (${accounts.length})\n\n`;
    
    accounts.slice(0, 20).forEach((acc, idx) => {
      const typeEmoji = acc.type === 'package1' ? '🟢' : acc.type === 'package2' ? '🔵' : '⚪';
      const userCount = acc.users?.length || 0;
      
      message += `${idx + 1}. ${typeEmoji} *${acc.type}*\n`;
      message += `   📧 \`${acc.email}\`\n`;
      message += `   👥 ${userCount} users\n`;
      message += `   📅 ${acc.expiryDate}\n\n`;
    });
    
    if (accounts.length > 20) {
      message += `_... và ${accounts.length - 20} accounts khác_`;
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error fetching accounts:', error.message);
    bot.sendMessage(chatId, '❌ Lỗi khi tải dữ liệu!');
  }
});

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

// Command: /expire
bot.onText(/\/expire/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!checkPermission(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }
  
  try {
    bot.sendMessage(chatId, '⏳ Đang kiểm tra...');
    
    const response = await axios.get(`${API_URL}/api/data`);
    const accounts = response.data;
    
    const today = new Date();
    const urgentAccounts = accounts.filter(acc => {
      const expiry = new Date(acc.expiryDate);
      const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      return daysLeft <= 7 && daysLeft >= 0;
    });
    
    if (urgentAccounts.length === 0) {
      bot.sendMessage(chatId, '✅ Không có account nào sắp hết hạn trong 7 ngày!');
      return;
    }
    
    let message = `⚠️ *CÓ ${urgentAccounts.length} ACCOUNTS SẮP HẾT HẠN!*\n\n`;
    
    urgentAccounts.forEach((acc, idx) => {
      const expiry = new Date(acc.expiryDate);
      const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      const typeEmoji = acc.type === 'package1' ? '🟢' : acc.type === 'package2' ? '🔵' : '⚪';
      
      message += `${idx + 1}. ${typeEmoji} \`${acc.email}\`\n`;
      message += `   🔥 Còn *${daysLeft} ngày*\n`;
      message += `   📅 ${acc.expiryDate}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Error checking expiry:', error.message);
    bot.sendMessage(chatId, '❌ Lỗi khi kiểm tra hết hạn!');
  }
});

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
