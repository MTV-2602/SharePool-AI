const axios = require("axios");
const mongoose = require("mongoose");
require("dotenv").config();

// MongoDB connection (not needed anymore if using API)
// But keep for reading data via /api/data-public
let isConnected = false;
const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB Connected in Telegram Webhook");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
  }
};

// No need for Account model anymore - using API instead
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  "8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://vinhaccplus.vercel.app";

// Allowed user IDs (optional)
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(",").map((id) => parseInt(id))
  : [];

const checkPermission = (userId) => {
  if (ALLOWED_USER_IDS.length === 0) return true;
  return ALLOWED_USER_IDS.includes(userId);
};

const TELEGRAM_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const TELEGRAM_OTP_REGEX = /\b[A-Z2-7]{16,}\b/i;
const extractOtpFrom2faLiveUrl = (value = "") => {
  const match = String(value || "").match(/\/tok\/([^/?#]+)/i)?.[1];
  return match ? decodeURIComponent(match) : "";
};
const normalizeTelegramAccountText = (rawText, { requireTeamPrefix = false } = {}) => {
  if (!rawText) return "";
  let cleanedText = String(rawText).replace(/^\[.*?\]/, "").trim();
  if (requireTeamPrefix) {
    if (!/^team\b/i.test(cleanedText)) return "";
    cleanedText = cleanedText.replace(/^team\b[:\s-]*/i, "").trim();
  }
  return cleanedText.replace(/[｜¦┃]/g, "|").replace(/\t+/g, "|");
};
const parseTelegramCredentialInput = (
  rawText,
  { requireTeamPrefix = false } = {},
) => {
  const normalizedInput = normalizeTelegramAccountText(rawText, {
    requireTeamPrefix,
  });
  if (!normalizedInput) return null;

  if (normalizedInput.includes("---")) return null;

  const flatInput = normalizedInput.replace(/\r/g, "").replace(/\n+/g, "|");
  const parts = flatInput
    .split(/\s*\|\s*/)
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (parts.length !== 3) return null;

  const [email, password, otpSecret] = parts;
  if (!TELEGRAM_EMAIL_REGEX.test(email)) return null;
  if (!password || !otpSecret) return null;
  if (!TELEGRAM_OTP_REGEX.test(otpSecret)) return null;

  return {
    email: String(email || "").trim(),
    password: String(password || "").trim(),
    otpSecret: String(otpSecret || "").trim(),
    link: "",
  };
};
const parseTeamAccountInput = (rawText) =>
  parseTelegramCredentialInput(rawText, {
    requireTeamPrefix: true,
  });
const parseChatgptAccountInput = (rawText) =>
  parseTelegramCredentialInput(rawText, {
    requireTeamPrefix: false,
  });
const extractTelegramSearchEmail = (rawText) => {
  if (!rawText) return "";
  const cleanedText = String(rawText)
    .replace(/^\[.*?\]/, "")
    .replace(/^team\s+/i, "")
    .trim();
  const match = cleanedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? String(match[0] || "").trim().toLowerCase() : "";
};
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
const durationToMonths = (duration = "1M") => ({
  "1M": 1,
  "2M": 2,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
}[String(duration || "1M").toUpperCase()] || 1);
const getUserRemainingDays = (user, duration = "1M") => {
  if (!user) return null;
  const now = new Date();
  if (user.expiredAt) {
    return Math.ceil((new Date(user.expiredAt) - now) / (1000 * 60 * 60 * 24));
  }
  if (user.joinedAt) {
    const fallbackExpiry = addMonthsClamped(
      user.joinedAt,
      durationToMonths(duration),
    );
    return Math.ceil((fallbackExpiry - now) / (1000 * 60 * 60 * 24));
  }
  return null;
};
const formatCompactStatsMessage = (summary = {}) => {
  const shared = summary?.shared || {};
  const privateStats = summary?.private || {};
  const users = summary?.users || {};
  const expiry = summary?.expiry || {};
  const updatedAt = summary?.updatedAt
    ? new Date(summary.updatedAt)
    : new Date();
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? new Date().toLocaleString("vi-VN")
    : updatedAt.toLocaleString("vi-VN");

  return [
    "CHATGPT STATS",
    "",
    `Accounts: ${Number(summary?.totalAccounts || 0)}`,
    `Shared: ${Number(shared.total || 0)} (full ${Number(shared.full || 0)} / partial ${Number(shared.partial || 0)} / empty ${Number(shared.empty || 0)})`,
    `Private: ${Number(privateStats.total || 0)} (used ${Number(privateStats.used || 0)} / empty ${Number(privateStats.empty || 0)})`,
    `Unassigned: ${Number(summary?.unassigned || 0)}`,
    "",
    `Users: ${Number(users.total || 0)} (active ${Number(users.active || 0)} / expired ${Number(users.expired || 0)})`,
    `Expiry: expired ${Number(expiry.expired || 0)} / <=3d ${Number(expiry.within3Days || 0)} / <=7d ${Number(expiry.within7Days || 0)}`,
    "",
    `Updated: ${updatedLabel}`,
  ].join("\n");
};

// Normalize Vietnamese text for smart search (remove accents)
const normalizeVietnamese = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
};

// Send message helper
const sendMessage = async (chatId, text, options = {}) => {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || "Markdown",
        disable_web_page_preview: true, // Tắt preview link
        ...options,
      },
    );
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
};

module.exports = async (req, res) => {
  // No need to connect DB - using API endpoints instead

  // Only accept POST requests
  if (req.method !== "POST") {
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
      await sendMessage(chatId, "❌ Bạn không có quyền sử dụng bot này!");
      return res.status(200).json({ ok: true });
    }

    // Command: /start hoặc /help
    if (text === "/start" || text === "/help") {
      const welcomeMessage = `
🤖 *ChatGPT & Coursera Manager Bot*

📋 *LỆNH:*
/stats - Thống kê ChatGPT

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
      await sendMessage(chatId, welcomeMessage);
      return res.status(200).json({ ok: true });
    }

    // Command: /stats - Thống kê ChatGPT accounts
    if (text === "/stats") {
      try {
        await sendMessage(chatId, "Dang tai stats...");
        const summaryResponse = await axios.get(
          `${API_URL}/api/chatgpt/stats-public`,
        );
        const summary = summaryResponse?.data?.summary || {};
        await sendMessage(chatId, formatCompactStatsMessage(summary));
        return res.status(200).json({ ok: true });
        await sendMessage(chatId, "⏳ Đang tính toán...");

        const response = await axios.get(`${API_URL}/api/data-public`);
        const data = response.data;
        const accounts = data.chatgpt || data || [];

        const totalAccounts = accounts.length;
        const package1Accs = accounts.filter((a) => a.type === "package1");
        const package2Accs = accounts.filter((a) => a.type === "package2");
        const unassignedAccs = accounts.filter((a) => a.type === "unassigned");

        let totalUsers = 0;
        let activeUsers = 0;
        let expiredUsers = 0;
        let package1Full = 0;
        let package1Available = 0;
        let package2Used = 0;
        let package2Empty = 0;

        accounts.forEach((acc) => {
          const userCount = acc.users?.length || 0;

          if (acc.type === "package1") {
            if (userCount >= 3) package1Full++;
            else if (userCount > 0) package1Available++;
          }

          if (acc.type === "package2") {
            if (userCount > 0) package2Used++;
            else package2Empty++;
          }

          if (acc.users && acc.users.length > 0) {
            totalUsers += acc.users.length;
            acc.users.forEach((u) => {
              const daysRemaining = getUserRemainingDays(
                u,
                acc.duration || "1M",
              );
              if (daysRemaining === null || daysRemaining > 0) {
                activeUsers++;
              } else {
                expiredUsers++;
              }
            });
          }
        });

        const today = new Date();
        const expiredAccounts = accounts.filter((acc) => {
          if (!acc.expiredAt) return false;
          const expiry = new Date(acc.expiredAt);
          return expiry < today;
        }).length;

        const urgentAccounts3Days = accounts.filter((acc) => {
          if (!acc.expiredAt) return false;
          const expiry = new Date(acc.expiredAt);
          const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
          return daysLeft <= 3 && daysLeft >= 0;
        }).length;

        const urgentAccounts7Days = accounts.filter((acc) => {
          if (!acc.expiredAt) return false;
          const expiry = new Date(acc.expiredAt);
          const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
          return daysLeft <= 7 && daysLeft >= 0;
        }).length;

        // Build detailed message
        let statsMessage = `📊 *THỐNG KÊ CHATGPT CHI TIẾT*\n\n`;

        statsMessage += `*📌 TỔNG QUAN:*\n`;
        statsMessage += `├ Tổng TK: ${totalAccounts}\n`;
        statsMessage += `├ 👥 Khách: ${totalUsers} (✅${activeUsers}/❌${expiredUsers})\n`;
        statsMessage += `└ ⚠️ Hết hạn: 🔴${expiredAccounts} | 🟠${urgentAccounts3Days} | 🟡${urgentAccounts7Days}\n\n`;

        // Package1 Details
        if (package1Accs.length > 0) {
          statsMessage += `*🟢 PACKAGE1 - SHARED (${package1Accs.length}):\n*`;
          package1Accs.forEach((acc, idx) => {
            const userCount = acc.users?.length || 0;
            const emoji = userCount >= 3 ? "🔴" : userCount > 0 ? "🟡" : "🟢";
            const expiry = acc.expiredAt
              ? new Date(acc.expiredAt).toLocaleDateString("vi-VN")
              : "N/A";
            const daysLeft = acc.expiredAt
              ? Math.ceil(
                (new Date(acc.expiredAt) - today) / (1000 * 60 * 60 * 24),
              )
              : "N/A";

            statsMessage += `\n${idx + 1}. ${emoji} 👥 ${userCount}/3 | 📅 ${expiry} (${daysLeft}d)\n`;
            statsMessage += `\`\`\`\n${acc.username}\n\`\`\`\n`;
            statsMessage += `\`\`\`\n${acc.password}\n\`\`\`\n`;
            if (acc.link) statsMessage += `${acc.link}\n`;

            if (acc.users && acc.users.length > 0) {
              acc.users.forEach((user, i) => {
                const joined = user.joinedAt ? new Date(user.joinedAt) : null;
                const days = joined
                  ? Math.floor((today - joined) / (1000 * 60 * 60 * 24))
                  : 0;
                const status = days < 30 ? "✅" : "❌";
                statsMessage += `${status} ${user.name} (${days}d) `;
              });
              statsMessage += `\n`;
            }
          });
          statsMessage += `\n`;
        }

        // Package2 Details
        if (package2Accs.length > 0) {
          statsMessage += `*🔵 PACKAGE2 - PRIVATE (${package2Accs.length}):\n*`;
          package2Accs.forEach((acc, idx) => {
            const userCount = acc.users?.length || 0;
            const emoji = userCount > 0 ? "🔵" : "⚪";
            const expiry = acc.expiredAt
              ? new Date(acc.expiredAt).toLocaleDateString("vi-VN")
              : "N/A";
            const daysLeft = acc.expiredAt
              ? Math.ceil(
                (new Date(acc.expiredAt) - today) / (1000 * 60 * 60 * 24),
              )
              : "N/A";

            statsMessage += `\n${idx + 1}. ${emoji} 👥 ${userCount}/1 | 📅 ${expiry} (${daysLeft}d)\n`;
            statsMessage += `\`\`\`\n${acc.username}\n\`\`\`\n`;
            statsMessage += `\`\`\`\n${acc.password}\n\`\`\`\n`;
            if (acc.link) statsMessage += `${acc.link}\n`;

            if (acc.users && acc.users.length > 0) {
              const user = acc.users[0];
              const joined = user.joinedAt ? new Date(user.joinedAt) : null;
              const days = joined
                ? Math.floor((today - joined) / (1000 * 60 * 60 * 24))
                : 0;
              const status = days < 30 ? "✅" : "❌";
              statsMessage += `${status} ${user.name} (${days}d)\n`;
            }
          });
          statsMessage += `\n`;
        }

        // Unassigned Details
        if (unassignedAccs.length > 0) {
          statsMessage += `*⚪ UNASSIGNED (${unassignedAccs.length}):\n*`;
          unassignedAccs.forEach((acc, idx) => {
            const expiry = acc.expiredAt
              ? new Date(acc.expiredAt).toLocaleDateString("vi-VN")
              : "N/A";
            const daysLeft = acc.expiredAt
              ? Math.ceil(
                (new Date(acc.expiredAt) - today) / (1000 * 60 * 60 * 24),
              )
              : "N/A";

            statsMessage += `\n${idx + 1}. 📅 ${expiry} (${daysLeft}d)\n`;
            statsMessage += `\`\`\`\n${acc.username}\n\`\`\`\n`;
            statsMessage += `\`\`\`\n${acc.password}\n\`\`\`\n`;
            if (acc.link) statsMessage += `${acc.link}\n`;
          });
          statsMessage += `\n`;
        }

        statsMessage += `_Cập nhật: ${new Date().toLocaleString("vi-VN")}_`;

        await sendMessage(chatId, statsMessage);
      } catch (error) {
        await sendMessage(chatId, "❌ Lỗi khi tính thống kê!");
      }
      return res.status(200).json({ ok: true });
    }

    // AUTO-DETECT: Parse account format
    if (!text.startsWith("/")) {
      // SEARCH BY CUSTOMER NAME: Plain text without special characters
      // If no @, no ---, no comma -> search customer name
      if (!text.includes("@") && !text.includes("---") && !text.includes(",")) {
        const searchName = text.trim();

        try {
          await sendMessage(chatId, "🔍 Đang tìm khách hàng...");

          const response = await axios.get(
            `${API_URL}/api/chatgpt/customer-search-public`,
            {
              params: { q: searchName },
            },
          );
          let results = Array.isArray(response?.data?.results)
            ? response.data.results
            : [];

          if (results.length === 0) {
            await sendMessage(
              chatId,
              `❌ Không tìm thấy khách hàng với tên "${searchName}"`,
            );
          } else {
            let message = `🔍 *TÌM THẤY ${results.length} KẾT QUẢ*\n\nTừ khóa: "${searchName}"\n\n`;

            results.forEach((r, idx) => {
              const typeEmoji =
                r.accType === "package1"
                  ? "🟢"
                  : r.accType === "package2"
                    ? "🔵"
                    : "⚪";
              const joinedDate = r.joinedAt
                ? new Date(r.joinedAt).toLocaleDateString("vi-VN")
                : "N/A";
              const today = new Date();
              const joined = new Date(r.joinedAt);
              const daysUsed = Math.floor(
                (today - joined) / (1000 * 60 * 60 * 24),
              );
              const status =
                getUserRemainingDays(
                  { joinedAt: r.joinedAt, expiredAt: r.expiredAt },
                  r.accDuration,
                ) > 0
                  ? "✅"
                  : "❌";

              message += `${idx + 1}. ${status} 👤 *${r.userName}*\n`;
              message += `${typeEmoji} ${r.accType} | 📅 ${joinedDate} (${daysUsed}d)\n`;
              message += `\`\`\`\n${r.accEmail}\n\`\`\`\n`;
              message += `\`\`\`\n${r.accPassword}\n\`\`\`\n`;
              if (r.accOtpSecret)
                message += `\`\`\`\n${r.accOtpSecret}\n\`\`\`\n`;
              if (r.accLink) message += `${r.accLink}\n`;
              if (
                Number(r.accMarketplaceTraceSummary?.orderCount || 0) > 0 ||
                Number(r.accMarketplaceTraceSummary?.warrantyCount || 0) > 0
              ) {
                message += `Market: ${(r.accMarketplaceTraceSummary?.providers || []).join(", ") || "datammo"} | orders ${Number(r.accMarketplaceTraceSummary?.orderCount || 0)} | warranty ${Number(r.accMarketplaceTraceSummary?.warrantyCount || 0)}\n`;
                if (r.accMarketplaceTraceSummary?.latestOrderId) {
                  message += `Order: \`${r.accMarketplaceTraceSummary.latestOrderId}\`\n`;
                }
                if (r.accMarketplaceTraceSummary?.latestWarrantyOrderId) {
                  message += `Warranty: \`${r.accMarketplaceTraceSummary.latestWarrantyOrderId}\`\n`;
                }
              }
              message += `\n`;
            });

            await sendMessage(chatId, message);
          }
        } catch (error) {
          await sendMessage(chatId, "❌ Lỗi khi tìm kiếm!");
        }
        return res.status(200).json({ ok: true });
      }

      const parsedInlineTeamAccount = parseTeamAccountInput(text);
      const parsedInlineChatgptAccount = parseChatgptAccountInput(text);

      // SEARCH CHATGPT ACCOUNT: Just email input (no format)
      const extractedSearchEmail = extractTelegramSearchEmail(text);
      if (
        extractedSearchEmail &&
        !text.includes("---") &&
        !text.includes(",") &&
        !/[|｜¦┃]/.test(text) &&
        !parsedInlineTeamAccount &&
        !parsedInlineChatgptAccount
      ) {
        const searchEmail = extractedSearchEmail;

        try {
          await sendMessage(chatId, "🔍 Đang tìm tài khoản...");

          const response = await axios.get(
            `${API_URL}/api/chatgpt/account-public`,
            {
              params: { email: searchEmail },
            },
          );
          const found = response?.data?.account || null;

          if (!found) {
            await sendMessage(
              chatId,
              `❌ Không tìm thấy tài khoản: \`${searchEmail}\``,
            );
          } else {
            const typeEmoji =
              found.type === "package1"
                ? "🟢"
                : found.type === "package2"
                  ? "🔵"
                  : "⚪";
            const expiredAt = found.expiredAt
              ? new Date(found.expiredAt).toLocaleDateString("vi-VN")
              : "N/A";
            const today = new Date();
            const daysLeft = found.expiredAt
              ? Math.ceil(
                (new Date(found.expiredAt) - today) / (1000 * 60 * 60 * 24),
              )
              : "N/A";

            let message = `📋 *THÔNG TIN TÀI KHOẢN*\n\n`;
            message += `${typeEmoji} *Type:* ${found.type}\n`;
            message += `👥 ${found.users?.length || 0} khách | 📅 ${expiredAt} (${daysLeft}d)\n\n`;
            message += `\`\`\`\n${found.username}\n\`\`\`\n`;
            message += `\`\`\`\n${found.password}\n\`\`\`\n`;
            if (found.otpSecret) {
              message += `\`\`\`\n${found.otpSecret}\n\`\`\`\n`;
            }
            if (
              Number(found.marketplaceTraceSummary?.orderCount || 0) > 0 ||
              Number(found.marketplaceTraceSummary?.warrantyCount || 0) > 0
            ) {
              message += `Market: ${(found.marketplaceTraceSummary?.providers || []).join(", ") || "datammo"} | orders ${Number(found.marketplaceTraceSummary?.orderCount || 0)} | warranty ${Number(found.marketplaceTraceSummary?.warrantyCount || 0)}\n`;
              if (found.marketplaceTraceSummary?.latestOrderId) {
                message += `Order: \`${found.marketplaceTraceSummary.latestOrderId}\`\n`;
              }
              if (found.marketplaceTraceSummary?.latestWarrantyOrderId) {
                message += `Warranty: \`${found.marketplaceTraceSummary.latestWarrantyOrderId}\`\n`;
              }
            }
            if (found.link) message += `${found.link}\n\n`;
            else message += `\n`;

            if (found.users && found.users.length > 0) {
              message += `👥 *Khách hàng (${found.users.length}):*\n`;
              found.users.forEach((user, idx) => {
                const joinedDate = user.joinedAt
                  ? new Date(user.joinedAt).toLocaleDateString("vi-VN")
                  : "N/A";
                const today = new Date();
                const joined = new Date(user.joinedAt);
                const daysUsed = Math.floor(
                  (today - joined) / (1000 * 60 * 60 * 24),
                );
                const status = getUserRemainingDays(user, found.duration || "1M") > 0 ? "✅" : "❌";

                message += `${idx + 1}. ${status} *${user.name}*\n`;
                message += `   📅 Từ: ${joinedDate} (${daysUsed} ngày)\n`;
              });
            } else {
              message += `👥 *Khách hàng:* Chưa có`;
            }

            await sendMessage(chatId, message);
          }
        } catch (error) {
          await sendMessage(chatId, "❌ Lỗi khi tìm kiếm!");
        }
        return res.status(200).json({ ok: true });
      }

      // COURSERA AUTO-DETECT: email,password,courseCode format
      // Support both single line and multiple lines (batch add)
      if (text.includes(",") && text.includes("@") && !text.includes("---")) {
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        // Parse all lines
        const accounts = [];
        for (const line of lines) {
          const parts = line.split(",").map((p) => p.trim());
          if (parts.length >= 2 && parts.length <= 3) {
            const [email, password, courseCode] = parts;
            if (email && password && email.includes("@")) {
              accounts.push({ email, password, courseCode: courseCode || "" });
            }
          }
        }

        if (accounts.length > 0) {
          try {
            const totalAccounts = accounts.length;
            await sendMessage(
              chatId,
              `⏳ Đang thêm hàng loạt ${totalAccounts} tài khoản Coursera vào Sheet...`,
            );

            const expiredAt = addMonthsClamped(new Date(), 12);

            // Format dữ liệu giống web: [[email, password, courseCode], ...]
            const sheetData = accounts.map((acc) => [
              acc.email,
              acc.password,
              acc.courseCode,
            ]);

            // Script URL từ web
            const scriptUrl =
              "https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec";

            // POST qua proxy API (giống web)
            const response = await axios.post(
              `${API_URL}/api/proxy-sheet`,
              {
                scriptUrl: scriptUrl,
                sheetName: "",
                data: sheetData,
              },
              {
                timeout: 30000,
              },
            );

            if (totalAccounts === 1) {
              const acc = accounts[0];
              const successMessage = `
✅ *TỰ ĐỘNG THÊM COURSERA VÀO SHEET THÀNH CÔNG!*

📧 *Email:* \`${acc.email}\`
🔑 *Password:* \`${acc.password}\`
${acc.courseCode ? `📚 *Course:* \`${acc.courseCode}\`\n` : ""}
💡 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;
              await sendMessage(chatId, successMessage);
            } else {
              // Batch success message - show all
              const successMessage = `
✅ *THÊM HÀNG LOẠT ${totalAccounts} COURSERA THÀNH CÔNG!*

📊 Danh sách:
${accounts.map((acc, i) => `${i + 1}. \`${acc.email}\`,\`${acc.password}\`,\`${acc.courseCode}\``).join("\n")}

 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;
              await sendMessage(chatId, successMessage);
            }
          } catch (error) {
            console.error(
              "Auto-add Coursera error:",
              error.response?.data || error.message,
            );
            await sendMessage(
              chatId,
              `❌ Lỗi khi thêm Coursera: ${error.response?.data?.error || error.message}`,
            );
          }
          return res.status(200).json({ ok: true });
        }
      }

      const parsedTeamAccount = parsedInlineTeamAccount;
      if (parsedTeamAccount) {
        const { email, password, otpSecret, link: recoveryUrl } = parsedTeamAccount;

        try {
          await sendMessage(chatId, "⏳ Đang thêm team account...");

          await axios.post(`${API_URL}/api/team-public`, {
            username: email,
            password,
            otpSecret,
            recoveryUrl,
            note: "",
            saleMode: "business",
          });

          const successMessage = `
✅ *TỰ ĐỘNG THÊM TEAM THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *GPT Password:* \`${password}\`
🔗 *Recovery URL:* ${recoveryUrl || "_Không có_"}
📦 *Mode:* slot team

💡 *Tip:* Paste tiếp format \`team email----pass----link\` để thêm nhanh!
              `;

          const compactSuccessMessage = [
            "âœ… *Tá»° Äá»˜NG THÃŠM TEAM THÃ€NH CÃ”NG!*",
            "",
            `ðŸ“§ *Email:* \`${email}\``,
            `ðŸ”‘ *GPT Password:* \`${password}\``,
            `ðŸ” *2FA:* \`${otpSecret}\``,
          ].join("\n");
          const displayMessage = [
            "*THEM TEAM THANH CONG!*",
            "",
            `Email: \`${email}\``,
            `Password: \`${password}\``,
            `2FA: \`${otpSecret}\``,
            "Mode: `business`",
          ].join("\n");
          await sendMessage(chatId, displayMessage);
        } catch (error) {
          console.error(
            "Auto-add team error:",
            error.response?.data || error.message,
          );
          await sendMessage(
            chatId,
            `❌ Lỗi khi thêm team account: ${error.response?.data?.error || error.message}`,
          );
        }
        return res.status(200).json({ ok: true });
      }

      // CHATGPT AUTO-DETECT: email|password|2fa|link or legacy --- format
      const hasDelimiters =
        text.includes("---") || text.includes("----") || /[|｜¦┃]/.test(text);
      const hasAtSign = text.includes("@");

      if (hasDelimiters && hasAtSign) {
        const parsedChatgptAccount = parsedInlineChatgptAccount;
        if (parsedChatgptAccount) {
          const {
            email,
            password,
            otpSecret,
            link: recoveryMailUrl,
          } = parsedChatgptAccount;

          if (email && password) {
            try {
              await sendMessage(chatId, "⏳ Đang thêm account...");

              // Call public API endpoint
              await axios.post(`${API_URL}/api/chatgpt-public`, {
                username: email,
                password,
                otpSecret,
                link: recoveryMailUrl,
                type: "unassigned",
                note: "",
              });

              const successMessage = `
✅ *TỰ ĐỘNG THÊM THÀNH CÔNG!*

📧 *Email:* \`${email}\`
🔑 *Password:* \`${password}\`
📬 *Recovery URL:* ${recoveryMailUrl}
📦 *Type:* unassigned

💡 *Tip:* Paste format tiếp theo để thêm nhanh!
              `;

              const compactSuccessMessage = [
                "âœ… *Tá»° Äá»˜NG THÃŠM THÃ€NH CÃ”NG!*",
                "",
                `ðŸ“§ *Email:* \`${email}\``,
                `ðŸ”‘ *Password:* \`${password}\``,
                `ðŸ” *2FA:* \`${otpSecret}\``,
              ].join("\n");
              const displayMessage = [
                "*THEM ACCOUNT THANH CONG!*",
                "",
                `Email: \`${email}\``,
                `Password: \`${password}\``,
                `2FA: \`${otpSecret}\``,
              ].join("\n");
              await sendMessage(chatId, displayMessage);
            } catch (error) {
              console.error(
                "Auto-add error:",
                error.response?.data || error.message,
              );
              await sendMessage(
                chatId,
                `❌ Lỗi khi thêm account: ${error.response?.data?.error || error.message}`,
              );
            }
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(200).json({ ok: true });
  }
};
