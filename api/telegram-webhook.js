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
      disable_web_page_preview: true, // Tắt preview link
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
🤖 *ChatGPT & Coursera Manager Bot*

📋 *LỆNH CÓ SẴN:*

/add - Thêm account ChatGPT
/list - Xem danh sách accounts
/stats - Thống kê tổng quan
/expire - Accounts sắp hết hạn
/finduser <tên> - Tìm khách hàng
/findacc <email> - Tìm tài khoản
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

*Ví dụ Coursera:*
\`\`\`
duyh28421@gmail.com,Duyh27092006,wed201c
\`\`\`

💡 *Bot tự động nhận diện loại tài khoản!*
      `;
      await sendMessage(chatId, welcomeMessage);
      return res.status(200).json({ ok: true });
    }

    // Command: /help
    if (text === '/help') {
      const helpMessage = `
📖 *HƯỚNG DẪN SỬ DỤNG*

*1️⃣ THÊM ACCOUNT:*

📦 *ChatGPT:*
\`\`\`
email---password---recoveryUrl
\`\`\`

📚 *Coursera:*
\`\`\`
email,password,courseCode
\`\`\`
*Ví dụ:* \`duyh28421@gmail.com,Duyh27092006,wed201c\`

*2️⃣ TÌM KIẾM:*
\`/finduser <tên>\` - Tìm khách hàng
\`/findacc <email>\` - Tìm tài khoản

*3️⃣ XEM DANH SÁCH:*
\`/list\` - Xem tất cả accounts

*4️⃣ THỐNG KÊ:*
\`/stats\` - Tổng quan hệ thống

*5️⃣ CẢNH BÁO:*
\`/expire\` - Accounts hết hạn trong 7 ngày

---

⚠️ *LƯU Ý:*
- ChatGPT: hết hạn +30 ngày
- Coursera: hết hạn +365 ngày
- Bot tự động nhận diện loại tài khoản
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
        const data = response.data;
        const accounts = data.chatgpt || data || [];
        const coursera = data.coursera || [];
        
        if (accounts.length === 0 && coursera.length === 0) {
          await sendMessage(chatId, '📭 Không có account nào!');
          return res.status(200).json({ ok: true });
        }
        
        let message = `📋 *DANH SÁCH ACCOUNTS*\n\n`;
        
        if (accounts.length > 0) {
          message += `🤖 *ChatGPT* (${accounts.length}):\n\n`;
          accounts.slice(0, 15).forEach((acc, idx) => {
            const typeEmoji = acc.type === 'package1' ? '🟢' : acc.type === 'package2' ? '🔵' : '⚪';
            const userCount = acc.users?.length || 0;
            
            message += `${idx + 1}. ${typeEmoji} *${acc.type}*\n`;
            message += `   📧 \`${acc.username}\`\n`;
            message += `   👥 ${userCount} users\n\n`;
          });
          
          if (accounts.length > 15) {
            message += `_... và ${accounts.length - 15} ChatGPT accounts khác_\n\n`;
          }
        }
        
        if (coursera.length > 0) {
          message += `\n📚 *Coursera* (${coursera.length}):\n\n`;
          coursera.slice(0, 10).forEach((acc, idx) => {
            const userCount = acc.users?.length || 0;
            
            message += `${idx + 1}. 📘 *Coursera*\n`;
            message += `   📧 \`${acc.username}\`\n`;
            message += `   👥 ${userCount} users\n\n`;
          });
          
          if (coursera.length > 10) {
            message += `_... và ${coursera.length - 10} Coursera accounts khác_`;
          }
        }
        
        await sendMessage(chatId, message);
      } catch (error) {
        await sendMessage(chatId, '❌ Lỗi khi tải dữ liệu!');
      }
      return res.status(200).json({ ok: true });
    }

    // Command: /finduser <name>
    if (text.startsWith('/finduser ')) {
      const searchName = text.replace('/finduser ', '').trim().toLowerCase();
      
      if (!searchName) {
        await sendMessage(chatId, '❌ Vui lòng nhập tên khách cần tìm!\n\n*Cú pháp:* `/finduser <tên>`');
        return res.status(200).json({ ok: true });
      }
      
      try {
        await sendMessage(chatId, '🔍 Đang tìm kiếm...');
        
        const response = await axios.get(`${API_URL}/api/data`);
        const accounts = response.data;
        
        let results = [];
        accounts.forEach(acc => {
          if (acc.users && acc.users.length > 0) {
            acc.users.forEach((user, idx) => {
              if (user.name && user.name.toLowerCase().includes(searchName)) {
                results.push({
                  userName: user.name,
                  accEmail: acc.username,
                  accType: acc.type,
                  joinedAt: user.joinedAt,
                  userIndex: idx
                });
              }
            });
          }
        });
        
        if (results.length === 0) {
          await sendMessage(chatId, `❌ Không tìm thấy khách hàng với tên "${searchName}"`);
        } else {
          let message = `🔍 *TÌM THẤY ${results.length} KẾT QUẢ*\n\nTừ khóa: "${searchName}"\n\n`;
          
          results.forEach((r, idx) => {
            const typeEmoji = r.accType === 'package1' ? '🟢' : r.accType === 'package2' ? '🔵' : '⚪';
            const joinedDate = r.joinedAt ? new Date(r.joinedAt).toLocaleDateString('vi-VN') : 'N/A';
            
            message += `${idx + 1}. 👤 *${r.userName}*\n`;
            message += `   📧 \`${r.accEmail}\`\n`;
            message += `   ${typeEmoji} ${r.accType}\n`;
            message += `   📅 Từ: ${joinedDate}\n\n`;
          });
          
          await sendMessage(chatId, message);
        }
      } catch (error) {
        await sendMessage(chatId, '❌ Lỗi khi tìm kiếm!');
      }
      return res.status(200).json({ ok: true });
    }

    // Command: /findacc <email>
    if (text.startsWith('/findacc ')) {
      const searchEmail = text.replace('/findacc ', '').trim().toLowerCase();
      
      if (!searchEmail) {
        await sendMessage(chatId, '❌ Vui lòng nhập email cần tìm!\n\n*Cú pháp:* `/findacc <email>`');
        return res.status(200).json({ ok: true });
      }
      
      try {
        await sendMessage(chatId, '🔍 Đang tìm kiếm...');
        
        const response = await axios.get(`${API_URL}/api/data`);
        const accounts = response.data;
        
        const results = accounts.filter(acc => 
          acc.username && acc.username.toLowerCase().includes(searchEmail)
        );
        
        if (results.length === 0) {
          await sendMessage(chatId, `❌ Không tìm thấy tài khoản với email "${searchEmail}"`);
        } else {
          let message = `🔍 *TÌM THẤY ${results.length} TÀI KHOẢN*\n\nTừ khóa: "${searchEmail}"\n\n`;
          
          results.forEach((acc, idx) => {
            const typeEmoji = acc.type === 'package1' ? '🟢' : acc.type === 'package2' ? '🔵' : '⚪';
            const userCount = acc.users?.length || 0;
            const expiredAt = acc.expiredAt ? new Date(acc.expiredAt).toLocaleDateString('vi-VN') : 'N/A';
            
            message += `${idx + 1}. ${typeEmoji} *${acc.type}*\n`;
            message += `   📧 \`${acc.username}\`\n`;
            message += `   🔑 \`${acc.password}\`\n`;
            message += `   👥 ${userCount} users\n`;
            message += `   📅 Hết hạn: ${expiredAt}\n`;
            if (acc.link) message += `   🔗 ${acc.link}\n`;
            message += `\n`;
          });
          
          await sendMessage(chatId, message);
        }
      } catch (error) {
        await sendMessage(chatId, '❌ Lỗi khi tìm kiếm!');
      }
      return res.status(200).json({ ok: true });
    }

    // AUTO-DETECT: Parse account format
    if (!text.startsWith('/')) {
      // COURSERA AUTO-DETECT: email,password,courseCode format
      if (text.includes(',') && text.includes('@') && !text.includes('---')) {
        const parts = text.split(',').map(p => p.trim());
        
        if (parts.length >= 2 && parts.length <= 3) {
          const [email, password, courseCode] = parts;
          
          if (email && password && email.includes('@')) {
            try {
              await sendMessage(chatId, '⏳ Đang thêm tài khoản Coursera vào Sheet...');
              
              const expiredAt = new Date();
              expiredAt.setDate(expiredAt.getDate() + 365);
              
              // Format dữ liệu giống web: [email, password, courseCode]
              const sheetData = [[
                email,
                password,
                courseCode || ''
              ]];
              
              // Script URL từ web (chính xác từ ảnh)
              const scriptUrl = 'https://script.google.com/macros/s/AKfycbwoKnZsauopOfFZfp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZiQ63ZahKnJYNH5cJXsV/exec';
              
              // Gửi data giống web - qua proxy với rawJSON format
              const response = await axios.post(scriptUrl, JSON.stringify({
                sheetName: '',
                data: sheetData
              }), {
                headers: { 
                  'Content-Type': 'text/plain;charset=utf-8'
                }
              });
              
              const successMessage = `
✅ *TỰ ĐỘNG THÊM COURSERA VÀO SHEET THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *Password:* \`${password}\`
${courseCode ? `📚 *Course:* \`${courseCode}\`\n` : ''}📅 *Hết hạn:* ${expiredAt.toLocaleDateString('vi-VN')}

💡 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;
              
              await sendMessage(chatId, successMessage);
            } catch (error) {
              console.error('Auto-add Coursera error:', error.response?.data || error.message);
              await sendMessage(chatId, `❌ Lỗi khi thêm Coursera: ${error.response?.data?.error || error.message}`);
            }
            return res.status(200).json({ ok: true });
          }
        }
      }
      
      // CHATGPT AUTO-DETECT: email---password---recoveryUrl format
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
