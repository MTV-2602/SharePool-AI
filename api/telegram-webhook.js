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

// Normalize Vietnamese text for smart search (remove accents)
const normalizeVietnamese = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
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

    // Command: /start hoặc /help
    if (text === '/start' || text === '/help') {
      const welcomeMessage = `
🤖 *ChatGPT & Coursera Manager Bot*

📋 *LỆNH:*
/stats - Thống kê ChatGPT

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
      await sendMessage(chatId, welcomeMessage);
      return res.status(200).json({ ok: true });
    }

    // Command: /stats - Thống kê ChatGPT accounts
    if (text === '/stats') {
      try {
        await sendMessage(chatId, '⏳ Đang tính toán...');

        const response = await axios.get(`${API_URL}/api/data`);
        const data = response.data;
        const accounts = data.chatgpt || data || [];

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
📊 *THỐNG KÊ CHATGPT*

*📦 TÀI KHOẢN:*
├ 📌 Tổng: ${totalAccounts}
├ 🟢 Package1 (Shared): ${package1Count}
├ 🔵 Package2 (Private): ${package2Count}
└ ⚪ Unassigned: ${unassignedCount}

*👥 KHÁCH HÀNG:*
├ 📌 Tổng: ${totalUsers}
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







    // AUTO-DETECT: Parse account format
    if (!text.startsWith('/')) {
      // SEARCH BY CUSTOMER NAME: Plain text without special characters
      // If no @, no ---, no comma -> search customer name
      if (!text.includes('@') && !text.includes('---') && !text.includes(',')) {
        const searchName = text.trim();
        const normalizedSearch = normalizeVietnamese(searchName);
        
        try {
          await sendMessage(chatId, '🔍 Đang tìm khách hàng...');

          const response = await axios.get(`${API_URL}/api/data`);
          const data = response.data;
          const accounts = data.chatgpt || data || [];

          let results = [];
          accounts.forEach(acc => {
            if (acc.users && acc.users.length > 0) {
              acc.users.forEach((user, idx) => {
                if (user.name) {
                  const normalizedUserName = normalizeVietnamese(user.name);
                  if (normalizedUserName.includes(normalizedSearch)) {
                    results.push({
                      userName: user.name,
                      accEmail: acc.username,
                      accPassword: acc.password,
                      accType: acc.type,
                      accLink: acc.link,
                      joinedAt: user.joinedAt,
                      userIndex: idx
                    });
                  }
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
              const today = new Date();
              const joined = new Date(r.joinedAt);
              const daysUsed = Math.floor((today - joined) / (1000 * 60 * 60 * 24));
              const status = daysUsed < 30 ? '✅' : '❌';

              message += `${idx + 1}. ${status} 👤 *${r.userName}*\n`;
              message += `   📧 \`${r.accEmail}\`\n`;
              message += `   🔑 \`${r.accPassword}\`\n`;
              if (r.accLink) message += `   🔗 ${r.accLink}\n`;
              message += `   ${typeEmoji} ${r.accType}\n`;
              message += `   📅 Từ: ${joinedDate} (${daysUsed} ngày)\n\n`;
            });

            await sendMessage(chatId, message);
          }
        } catch (error) {
          await sendMessage(chatId, '❌ Lỗi khi tìm kiếm!');
        }
        return res.status(200).json({ ok: true });
      }

      // SEARCH CHATGPT ACCOUNT: Just email input (no format)
      // Check if it's a simple email search (contains @ but no special format)
      if (text.includes('@') && !text.includes('---') && !text.includes(',')) {
        const searchEmail = text.trim().toLowerCase();
        
        try {
          await sendMessage(chatId, '🔍 Đang tìm tài khoản...');

          const response = await axios.get(`${API_URL}/api/data`);
          const data = response.data;
          const accounts = data.chatgpt || data || [];

          const found = accounts.find(acc => 
            acc.username && acc.username.toLowerCase() === searchEmail
          );

          if (!found) {
            await sendMessage(chatId, `❌ Không tìm thấy tài khoản: \`${searchEmail}\``);
          } else {
            const typeEmoji = found.type === 'package1' ? '🟢' : found.type === 'package2' ? '🔵' : '⚪';
            const expiredAt = found.expiredAt ? new Date(found.expiredAt).toLocaleDateString('vi-VN') : 'N/A';
            
            let message = `📋 *THÔNG TIN TÀI KHOẢN*\n\n`;
            message += `${typeEmoji} *Type:* ${found.type}\n`;
            message += `📧 *Email:* \`${found.username}\`\n`;
            message += `🔑 *Password:* \`${found.password}\`\n`;
            if (found.link) message += `🔗 *Recovery URL:* ${found.link}\n`;
            message += `📅 *Hết hạn:* ${expiredAt}\n\n`;

            if (found.users && found.users.length > 0) {
              message += `👥 *Khách hàng (${found.users.length}):\n\n*`;
              found.users.forEach((user, idx) => {
                const joinedDate = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString('vi-VN') : 'N/A';
                const today = new Date();
                const joined = new Date(user.joinedAt);
                const daysUsed = Math.floor((today - joined) / (1000 * 60 * 60 * 24));
                const status = daysUsed < 30 ? '✅' : '❌';
                
                message += `${idx + 1}. ${status} *${user.name}*\n`;
                message += `   📅 Từ: ${joinedDate} (${daysUsed} ngày)\n`;
              });
            } else {
              message += `👥 *Khách hàng:* Chưa có`;
            }

            await sendMessage(chatId, message);
          }
        } catch (error) {
          await sendMessage(chatId, '❌ Lỗi khi tìm kiếm!');
        }
        return res.status(200).json({ ok: true });
      }

      // COURSERA AUTO-DETECT: email,password,courseCode format
      // Support both single line and multiple lines (batch add)
      if (text.includes(',') && text.includes('@') && !text.includes('---')) {
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Parse all lines
        const accounts = [];
        for (const line of lines) {
          const parts = line.split(',').map(p => p.trim());
          if (parts.length >= 2 && parts.length <= 3) {
            const [email, password, courseCode] = parts;
            if (email && password && email.includes('@')) {
              accounts.push({ email, password, courseCode: courseCode || '' });
            }
          }
        }

        if (accounts.length > 0) {
          try {
            const totalAccounts = accounts.length;
            await sendMessage(chatId, `⏳ Đang thêm hàng loạt ${totalAccounts} tài khoản Coursera vào Sheet...`);

            const expiredAt = new Date();
            expiredAt.setDate(expiredAt.getDate() + 365);

            // Format dữ liệu giống web: [[email, password, courseCode], ...]
            const sheetData = accounts.map(acc => [
              acc.email,
              acc.password,
              acc.courseCode
            ]);

            // Script URL từ web
            const scriptUrl = 'https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec';

            // POST qua proxy API (giống web)
            const response = await axios.post(`${API_URL}/api/proxy-sheet`, {
              scriptUrl: scriptUrl,
              sheetName: '',
              data: sheetData
            }, {
              timeout: 30000
            });

            if (totalAccounts === 1) {
              const acc = accounts[0];
              const successMessage = `
✅ *TỰ ĐỘNG THÊM COURSERA VÀO SHEET THÀNH CÔNG!*

📧 *Email:* \`${acc.email}\`
🔑 *Password:* \`${acc.password}\`
${acc.courseCode ? `📚 *Course:* \`${acc.courseCode}\`\n` : ''}
💡 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;
              await sendMessage(chatId, successMessage);
            } else {
              // Batch success message - show all
              const successMessage = `
✅ *THÊM HÀNG LOẠT ${totalAccounts} COURSERA THÀNH CÔNG!*

📊 Danh sách:
${accounts.map((acc, i) => `${i + 1}. \`${acc.email}\`,\`${acc.password}\`,\`${acc.courseCode}\``).join('\n')}

 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;
              await sendMessage(chatId, successMessage);
            }
          } catch (error) {
            console.error('Auto-add Coursera error:', error.response?.data || error.message);
            await sendMessage(chatId, `❌ Lỗi khi thêm Coursera: ${error.response?.data?.error || error.message}`);
          }
          return res.status(200).json({ ok: true });
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
