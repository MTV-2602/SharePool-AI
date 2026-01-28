const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA';
const API_URL = 'https://web-ban-acc.vercel.app';

// Allowed user IDs (optional)
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS 
  ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id))
  : [];

const checkPermission = (userId) => {
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
};

// Send message helper
const sendMessage = async (chatId, text, options = {}) => {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || 'Markdown',
      ...options
    });
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
};

module.exports = async (req, res) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text?.trim();
    const userId = message.from.id;

    if (!text) {
      return res.status(200).json({ ok: true });
    }

    // Check permission
    if (!checkPermission(userId)) {
      await sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
      return res.status(200).json({ ok: true });
    }

    // Command: /start
    if (text === '/start') {
      const welcomeMessage = `
🤖 *ChatGPT Manager Bot*

📋 *LỆNH CÓ SẴN:*

/add - Thêm account ChatGPT
/list - Xem danh sách accounts
/stats - Thống kê tổng quan
/expire - Accounts sắp hết hạn
/help - Hướng dẫn

---

📝 *CÁCH THÊM ACCOUNT:*

Chỉ cần paste format này:

\`\`\`
email---password---recoveryUrl
\`\`\`

*Ví dụ:*
\`\`\`
UCanPlus1669@purinikiopiy.asia---zxcvbnm666..---https://mail.chatgpt.org.uk/UCanPlus1669
\`\`\`

💡 *Bot tự động nhận cả* \`---\` *và* \`----\`
      `;
      await sendMessage(chatId, welcomeMessage);
      return res.status(200).json({ ok: true });
    }

    // Command: /help
    if (text === '/help') {
      const helpMessage = `
📖 *HƯỚNG DẪN SỬ DỤNG*

*1️⃣ THÊM ACCOUNT:*
Paste format:
\`\`\`
email---password---recoveryUrl
\`\`\`

*Ví dụ:*
\`\`\`
UCanPlus1669@purinikiopiy.asia---zxcvbnm666..---https://mail.chatgpt.org.uk/UCanPlus1669
\`\`\`

💡 *Bot tự động nhận cả* \`---\` *và* \`----\`

*2️⃣ XEM DANH SÁCH:*
\`/list\` - Xem tất cả accounts

*3️⃣ THỐNG KÊ:*
\`/stats\` - Tổng quan hệ thống

*4️⃣ CẢNH BÁO:*
\`/expire\` - Accounts hết hạn trong 7 ngày

---

⚠️ *LƯU Ý:*
- Account mặc định là *unassigned*
- Hết hạn: +30 ngày từ hôm nay
      `;
      await sendMessage(chatId, helpMessage);
      return res.status(200).json({ ok: true });
    }

    // Command: /stats
    if (text === '/stats') {
      try {
        await sendMessage(chatId, '⏳ Đang tính toán...');
        
        const response = await axios.get(`${API_URL}/api/data`);
        const accounts = response.data;
        
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
        
        const today = new Date();
        const urgentAccounts = accounts.filter(acc => {
          if (!acc.expiredAt) return false;
          const expiry = new Date(acc.expiredAt);
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
        
        await sendMessage(chatId, statsMessage);
      } catch (error) {
        await sendMessage(chatId, '❌ Lỗi khi tính thống kê!');
      }
      return res.status(200).json({ ok: true });
    }

    // Command: /list
    if (text.startsWith('/list')) {
      try {
        await sendMessage(chatId, '⏳ Đang tải dữ liệu...');
        
        const response = await axios.get(`${API_URL}/api/data`);
        let accounts = response.data;
        
        if (accounts.length === 0) {
          await sendMessage(chatId, '📭 Không có account nào!');
          return res.status(200).json({ ok: true });
        }
        
        let message = `📋 *DANH SÁCH ACCOUNTS* (${accounts.length})\n\n`;
        
        accounts.slice(0, 20).forEach((acc, idx) => {
          const typeEmoji = acc.type === 'package1' ? '🟢' : acc.type === 'package2' ? '🔵' : '⚪';
          const userCount = acc.users?.length || 0;
          
          message += `${idx + 1}. ${typeEmoji} *${acc.type}*\n`;
          message += `   📧 \`${acc.username}\`\n`;
          message += `   👥 ${userCount} users\n\n`;
        });
        
        if (accounts.length > 20) {
          message += `_... và ${accounts.length - 20} accounts khác_`;
        }
        
        await sendMessage(chatId, message);
      } catch (error) {
        await sendMessage(chatId, '❌ Lỗi khi tải dữ liệu!');
      }
      return res.status(200).json({ ok: true });
    }

    // AUTO-DETECT: Parse account format
    if (!text.startsWith('/')) {
      const hasChinesePrefix = text.match(/^\[.*?\]/);
      const hasDelimiters = text.includes('---') || text.includes('----');
      const hasAtSign = text.includes('@');
      
      if (hasDelimiters && hasAtSign) {
        let input = text;
        
        // Remove Chinese prefix
        input = input.replace(/^\[.*?\]/, '').trim();
        
        // Normalize: convert ---- to ---
        input = input.replace(/----/g, '---');
        
        const parts = input.split('---').map(p => p.trim());
        
        if (parts.length === 3) {
          const [email, password, recoveryMailUrl] = parts;
          
          if (email && password) {
            try {
              await sendMessage(chatId, '⏳ Đang thêm account...');
              
              // Calculate expiredAt: +30 days
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
              
              await sendMessage(chatId, successMessage);
            } catch (error) {
              console.error('Auto-add error:', error.response?.data || error.message);
              await sendMessage(chatId, `❌ Lỗi khi thêm account: ${error.response?.data?.error || error.message}`);
            }
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true });
  }
};
