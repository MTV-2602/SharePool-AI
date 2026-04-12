const crypto = require('crypto');
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Telegram Bot Token (lấy từ @BotFather)
const LEGACY_TELEGRAM_BOT_TOKEN =
  '8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA';
const LEGACY_ALLOWED_TELEGRAM_USER_IDS = Object.freeze([6352706510]);
const buildLegacyBotSecret = (label = '') =>
  crypto
    .createHash('sha256')
    .update(`vinhaccplus:${label}:${LEGACY_TELEGRAM_BOT_TOKEN}`)
    .digest('hex');
const TELEGRAM_BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || LEGACY_TELEGRAM_BOT_TOKEN,
).trim();

// API URL (production hoặc localhost)
const API_URL =
  String(process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '').trim() ||
  'http://localhost:3000';

// Telegram User ID được phép dùng bot (bảo mật)
const ALLOWED_USER_IDS = process.env.ALLOWED_USER_IDS
  ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id))
  : []; // Để trống = cho phép tất cả users

const BOT_INTERNAL_TOKEN = String(process.env.BOT_INTERNAL_TOKEN || '').trim();
const parseTelegramIdEnv = (...keys) =>
  Array.from(
    new Set(
      keys.flatMap((key) =>
        String(process.env[key] || '')
          .split(',')
          .map((item) => Number.parseInt(String(item || '').trim(), 10))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ),
  );
const TELEGRAM_ALLOWED_USER_IDS = parseTelegramIdEnv(
  'ALLOWED_USER_IDS',
  'TELEGRAM_ALLOWED_USER_IDS',
);
const TELEGRAM_ALLOWED_CHAT_IDS = parseTelegramIdEnv(
  'ALLOWED_CHAT_IDS',
  'TELEGRAM_ALLOWED_CHAT_IDS',
);
if (TELEGRAM_ALLOWED_USER_IDS.length === 0) {
  TELEGRAM_ALLOWED_USER_IDS.push(...LEGACY_ALLOWED_TELEGRAM_USER_IDS);
}
if (TELEGRAM_ALLOWED_CHAT_IDS.length === 0) {
  TELEGRAM_ALLOWED_CHAT_IDS.push(...LEGACY_ALLOWED_TELEGRAM_USER_IDS);
}
const EFFECTIVE_BOT_INTERNAL_TOKEN =
  BOT_INTERNAL_TOKEN || buildLegacyBotSecret('bot-internal');
const hasTelegramAcl =
  TELEGRAM_ALLOWED_USER_IDS.length > 0 || TELEGRAM_ALLOWED_CHAT_IDS.length > 0;
const getBotSecurityConfigError = () => {
  if (!TELEGRAM_BOT_TOKEN) return 'TELEGRAM_BOT_TOKEN chua duoc cau hinh.';
  if (!EFFECTIVE_BOT_INTERNAL_TOKEN)
    return 'BOT_INTERNAL_TOKEN chua duoc cau hinh.';
  if (!hasTelegramAcl)
    return 'ALLOWED_USER_IDS hoac ALLOWED_CHAT_IDS chua duoc cau hinh.';
  return '';
};
const botSecurityConfigError = getBotSecurityConfigError();
if (botSecurityConfigError) {
  throw new Error(`Telegram bot security config error: ${botSecurityConfigError}`);
}
const buildInternalApiConfig = (config = {}) => ({
  ...(config || {}),
  headers: {
    ...(config?.headers || {}),
    'x-bot-internal-token': EFFECTIVE_BOT_INTERNAL_TOKEN,
  },
});
const isAuthorizedTelegramMessage = (msg) => {
  if (!hasTelegramAcl) return false;
  const userId = Number.parseInt(msg?.from?.id, 10);
  const chatId = Number.parseInt(msg?.chat?.id, 10);
  if (Number.isInteger(userId) && TELEGRAM_ALLOWED_USER_IDS.includes(userId)) {
    return true;
  }
  if (Number.isInteger(chatId) && TELEGRAM_ALLOWED_CHAT_IDS.includes(chatId)) {
    return true;
  }
  return false;
};

axios.defaults.headers.common['x-bot-internal-token'] =
  EFFECTIVE_BOT_INTERNAL_TOKEN;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const TELEGRAM_WELCOME_MESSAGE = [
  '*CHATGPT & COURSERA MANAGER BOT*',
  '',
  '*Lenh:*',
  '/stats - thong ke tong quan',
  '/help - huong dan',
  '/cleanup show <batchId> - xem batch don het han',
  '/cleanup approve <batchId> - duyet xoa batch',
  '/cleanup reject <batchId> - tu choi batch',
  '',
  '*Nhap Plus:*',
  '```',
  'email|password|2FA_SECRET',
  '```',
  '',
  '*Nhap Team:*',
  '```',
  'team email|password|2FA_SECRET',
  '```',
  '',
  '*Nhap nhanh hang loat:*',
  '```',
  'email1|password1|2FA1',
  'email2|password2|2FA2',
  'team team1@domain.com|password3|2FA3',
  '```',
  '',
  '*Coursera:*',
  '```',
  'email,password,courseCode',
  '```',
].join('\n');

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
const splitTelegramBatchLines = (rawText) =>
  String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
const isPotentialTelegramCredentialLine = (line = '') => {
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine) return false;
  if (/^team\b/i.test(normalizedLine)) return true;
  return (
    /[|ï½œÂ¦â”ƒ]/.test(normalizedLine) &&
    !normalizedLine.includes(',') &&
    !normalizedLine.includes('---')
  );
};
const parseTelegramCredentialBatch = (rawText) => {
  const lines = splitTelegramBatchLines(rawText);
  if (
    lines.length < 2 ||
    !lines.some((line) => isPotentialTelegramCredentialLine(line)) ||
    !lines.every((line) => isPotentialTelegramCredentialLine(line))
  ) {
    return null;
  }

  const items = [];
  const errors = [];
  const seenKeys = new Set();

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const kind = /^team\b/i.test(line) ? 'team' : 'plus';
    const parsed =
      kind === 'team'
        ? parseTeamAccountInput(line)
        : parseChatgptAccountInput(line);

    if (!parsed) {
      errors.push({
        lineNumber,
        rawLine: line,
        kind,
        reason:
          kind === 'team'
            ? 'Sai format. Dung: team email|password|2fa'
            : 'Sai format. Dung: email|password|2fa',
      });
      return;
    }

    const dedupeKey = [
      kind,
      String(parsed.email || '').trim().toLowerCase(),
      String(parsed.password || '').trim(),
      String(parsed.otpSecret || '').trim(),
    ].join('|');
    if (seenKeys.has(dedupeKey)) {
      errors.push({
        lineNumber,
        rawLine: line,
        kind,
        reason: 'Trung voi dong truoc trong cung message',
      });
      return;
    }

    seenKeys.add(dedupeKey);
    items.push({
      ...parsed,
      kind,
      rawLine: line,
      lineNumber,
    });
  });

  return {
    totalLines: lines.length,
    items,
    errors,
  };
};
const buildTelegramBatchSummaryMessage = ({
  totalLines = 0,
  successes = [],
  errors = [],
}) => {
  const plusSuccesses = successes.filter((item) => item.kind === 'plus');
  const teamSuccesses = successes.filter((item) => item.kind === 'team');
  const hotmailLinkedCount = plusSuccesses.filter(
    (item) => item?.hotmailLink?.status === 'linked',
  ).length;
  const hotmailMissingCount = plusSuccesses.filter(
    (item) => item?.hotmailLink?.status === 'missing',
  ).length;
  const successPreview = successes.slice(0, 8);
  const errorPreview = errors.slice(0, 8);
  const lines = [
    '*KET QUA NHAP NHANH TELEGRAM*',
    '',
    `Tong dong: ${totalLines}`,
    `Plus thanh cong: ${plusSuccesses.length}`,
    `Team thanh cong: ${teamSuccesses.length}`,
    `Dong loi: ${errors.length}`,
  ];
  if (hotmailLinkedCount > 0 || hotmailMissingCount > 0) {
    lines.push(
      `Hotmail da noi: ${hotmailLinkedCount}`,
      `Hotmail chua co trong kho: ${hotmailMissingCount}`,
    );
  }

  if (successPreview.length > 0) {
    lines.push('', '*Thanh cong:*');
    successPreview.forEach((item) => {
      lines.push(
        `${item.lineNumber}. [${item.kind === 'team' ? 'Team' : 'Plus'}] \`${item.email}\`${formatTelegramHotmailLinkSuffix(item.hotmailLink)}`,
      );
    });
    if (successes.length > successPreview.length) {
      lines.push(`+${successes.length - successPreview.length} dong thanh cong nua`);
    }
  }

  if (errorPreview.length > 0) {
    lines.push('', '*Dong loi:*');
    errorPreview.forEach((item) => {
      lines.push(`${item.lineNumber}. ${item.reason}`);
    });
    if (errors.length > errorPreview.length) {
      lines.push(`+${errors.length - errorPreview.length} dong loi nua`);
    }
  }

  return lines.join('\n');
};
const formatTelegramHotmailLinkText = (hotmailLink = null) => {
  const status = String(hotmailLink?.status || '').trim();
  if (status === 'linked') {
    return hotmailLink?.lockApplied
      ? 'da noi va khoa kho extension'
      : 'da noi ChatGPT';
  }
  if (status === 'missing') return 'Chua co acc trong Hotmail';
  if (status === 'hotmail_only') return 'co trong kho Hotmail, chua co ChatGPT';
  if (status === 'error') return hotmailLink?.message || 'loi khi noi Hotmail';
  return '';
};
const formatTelegramHotmailLinkSuffix = (hotmailLink = null) => {
  const text = formatTelegramHotmailLinkText(hotmailLink);
  return text ? ` | Hotmail: ${text}` : '';
};
const extractTelegramSearchEmail = (rawText = '') => {
  const cleanedText = String(rawText || '')
    .replace(/^\[.*?\]/, '')
    .replace(/^team\s+/i, '')
    .trim();
  const match = cleanedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? String(match[0] || '').trim().toLowerCase() : '';
};
const parseCleanupCommand = (rawText = '') => {
  const normalized = String(rawText || '').trim();
  const match = normalized.match(/^\/cleanup\s+(show|approve|reject)\s+([a-z0-9_-]+)$/i);
  if (!match) return null;
  return {
    action: String(match[1] || '').trim().toLowerCase(),
    batchId: String(match[2] || '').trim(),
  };
};
const escapeTelegramHtml = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const formatCleanupBatchTelegramMessage = (batch = {}) => {
  const items = Array.isArray(batch?.items) ? batch.items : [];
  const summary = batch?.summary && typeof batch.summary === 'object' ? batch.summary : {};
  const previewItems = items.slice(0, 12);
  const safeBatchId = escapeTelegramHtml(batch?.batchId || '--');
  const lines = [
    '<b>BATCH DON HET HAN</b>',
    '',
    `Batch: <code>${safeBatchId}</code>`,
    `Trang thai: ${escapeTelegramHtml(batch?.status || '--')}`,
    `Candidate: ${Number(summary?.candidateCount || items.length || 0)}`,
    `Warning: ${Number(summary?.warningCount || 0)}`,
    `Scan: ${escapeTelegramHtml(summary?.scannedAt || batch?.createdAt || '--')}`,
  ];
  if (previewItems.length > 0) {
    lines.push('', '<b>Preview:</b>');
    previewItems.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.scope === 'team' ? 'Team' : 'ChatGPT')} | ${escapeTelegramHtml(item?.username || item?.itemId || '--')} | ${escapeTelegramHtml(item?.reasonLabel || item?.reasonCode || '--')} | ${escapeTelegramHtml(item?.expiredAt || '--')}`,
      );
    });
    if (items.length > previewItems.length) {
      lines.push(`+${items.length - previewItems.length} item nua`);
    }
  }
  lines.push(
    '',
    `<code>/cleanup show ${safeBatchId}</code>`,
    `<code>/cleanup approve ${safeBatchId}</code>`,
    `<code>/cleanup reject ${safeBatchId}</code>`,
  );
  return lines.join('\n');
};
const formatCleanupExecutionResultMessage = ({
  batch = null,
  result = null,
  action = 'approve',
} = {}) => {
  const safeBatchId = escapeTelegramHtml(batch?.batchId || '--');
  if (action === 'reject') {
    return [
      '<b>DA TU CHOI BATCH CLEANUP</b>',
      '',
      `Batch: <code>${safeBatchId}</code>`,
      `Trang thai: ${escapeTelegramHtml(batch?.status || 'rejected')}`,
    ].join('\n');
  }
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const lines = [
    '<b>KET QUA CLEANUP</b>',
    '',
    `Batch: <code>${safeBatchId}</code>`,
    `Da xoa: ${Number(result?.deletedCount || 0)}`,
    `Bo qua: ${Number(result?.skippedCount || 0)}`,
    `Loi: ${Number(result?.errorCount || 0)}`,
  ];
  if (skipped.length > 0) {
    lines.push('', '<b>Bo qua:</b>');
    skipped.slice(0, 5).forEach((item, index) => {
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.username || item?.itemId || '--')} | ${escapeTelegramHtml(item?.reason || '--')}`,
      );
    });
    if (skipped.length > 5) {
      lines.push(`+${skipped.length - 5} item skip nua`);
    }
  }
  if (errors.length > 0) {
    lines.push('', '<b>Loi:</b>');
    errors.slice(0, 3).forEach((item, index) => {
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.username || item?.itemId || '--')} | ${escapeTelegramHtml(item?.error || '--')}`,
      );
    });
  }
  return lines.join('\n');
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

  if (!isAuthorizedTelegramMessage(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  bot.sendMessage(chatId, TELEGRAM_WELCOME_MESSAGE, { parse_mode: 'Markdown' });
  return;

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

  if (!isAuthorizedTelegramMessage(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  bot.sendMessage(chatId, TELEGRAM_WELCOME_MESSAGE, { parse_mode: 'Markdown' });
  return;

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

  if (!isAuthorizedTelegramMessage(msg)) {
    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng bot này!');
    return;
  }

  try {
    bot.sendMessage(chatId, 'Dang tai stats...');
    const summaryResponse = await axios.get(
      `${API_URL}/api/chatgpt/stats-public`,
      buildInternalApiConfig(),
    );
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

bot.onText(/\/cleanup\s+(show|approve|reject)\s+([a-z0-9_-]+)/i, async (msg) => {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const command = parseCleanupCommand(text);

  if (!isAuthorizedTelegramMessage(msg)) {
    bot.sendMessage(chatId, 'Ban khong co quyen su dung bot nay!');
    return;
  }
  if (!command) {
    bot.sendMessage(chatId, 'Sai lenh cleanup. Dung: /cleanup show|approve|reject <batchId>');
    return;
  }

  try {
    if (command.action === 'show') {
      bot.sendMessage(chatId, 'Dang tai batch cleanup...', { parse_mode: 'HTML' });
      const response = await axios.get(
        `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${command.batchId}`,
        buildInternalApiConfig(),
      );
      const batch = response?.data?.batch || null;
      if (!batch) {
        bot.sendMessage(chatId, 'Khong tim thay batch cleanup.', { parse_mode: 'HTML' });
        return;
      }
      bot.sendMessage(chatId, formatCleanupBatchTelegramMessage(batch), {
        parse_mode: 'HTML',
      });
      return;
    }

    if (command.action === 'approve') {
      bot.sendMessage(chatId, 'Dang duyet batch cleanup...', {
        parse_mode: 'HTML',
      });
      const response = await axios.post(
        `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${command.batchId}/execute`,
        {
          actorSource: 'telegram_cleanup_approve',
          actor: String(msg.from?.id || msg.chat?.id || 'telegram_admin'),
        },
        buildInternalApiConfig(),
      );
      bot.sendMessage(
        chatId,
        formatCleanupExecutionResultMessage({
          batch: response?.data?.batch || null,
          result: response?.data?.result || null,
          action: 'approve',
        }),
        { parse_mode: 'HTML' },
      );
      return;
    }

    bot.sendMessage(chatId, 'Dang tu choi batch cleanup...', {
      parse_mode: 'HTML',
    });
    const response = await axios.post(
      `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${command.batchId}/reject`,
      {
        actorSource: 'telegram_cleanup_reject',
        actor: String(msg.from?.id || msg.chat?.id || 'telegram_admin'),
      },
      buildInternalApiConfig(),
    );
    bot.sendMessage(
      chatId,
      formatCleanupExecutionResultMessage({
        batch: response?.data?.batch || null,
        action: 'reject',
      }),
      { parse_mode: 'HTML' },
    );
  } catch (error) {
    bot.sendMessage(
      chatId,
      error?.response?.data?.error || error?.message || 'Khong the xu ly lenh cleanup.',
      { parse_mode: 'HTML' },
    );
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
  if (!isAuthorizedTelegramMessage(msg)) return;

  const extractedSearchEmail = extractTelegramSearchEmail(text);
  if (
    extractedSearchEmail &&
    !text.includes('---') &&
    !text.includes(',') &&
    !/[|ï½œÂ¦â”ƒ]/.test(text)
  ) {
    try {
      bot.sendMessage(chatId, 'Dang tim tai khoan...');
      const response = await axios.get(
        `${API_URL}/api/chatgpt/account-public`,
        buildInternalApiConfig({
          params: { email: extractedSearchEmail },
        }),
      );
      const found = response?.data?.account || null;
      const hotmailText = formatTelegramHotmailLinkText(
        response?.data?.hotmailLink,
      );
      if (!found) {
        bot.sendMessage(
          chatId,
          [
            `Khong tim thay tai khoan: \`${extractedSearchEmail}\``,
            hotmailText ? `Hotmail: ${hotmailText}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          { parse_mode: 'Markdown' },
        );
        return;
      }
      const lines = [
        '*THONG TIN TAI KHOAN*',
        '',
        `Type: ${found.type || 'unassigned'}`,
        `Email: \`${found.username || extractedSearchEmail}\``,
        `Password: \`${found.password || ''}\``,
      ];
      if (found.otpSecret) lines.push(`2FA: \`${found.otpSecret}\``);
      if (found.link) lines.push(found.link);
      if (hotmailText) lines.push(`Hotmail: ${hotmailText}`);
      lines.push(`Khach: ${Array.isArray(found.users) ? found.users.length : 0}`);
      bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (error) {
      bot.sendMessage(
        chatId,
        `Loi khi tim kiem: ${error.response?.data?.error || error.message}`,
      );
    }
    return;
  }

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

  const parsedBatchCredentials = parseTelegramCredentialBatch(text);
  if (parsedBatchCredentials) {
    const { totalLines, items, errors: initialErrors } = parsedBatchCredentials;
    const batchErrors = [...initialErrors];
    const batchSuccesses = [];
    const totalAccounts = items.length;
    const originalItemsByLine = new Map(
      items.map((item) => [Number(item?.lineNumber || 0), item]),
    );
    const mergeBulkBatchResponse = (responseData = {}, fallbackItems = []) => {
      const responseSuccesses = Array.isArray(responseData?.successes)
        ? responseData.successes
        : [];
      const responseErrors = Array.isArray(responseData?.errors)
        ? responseData.errors
        : [];

      if (responseSuccesses.length > 0) {
        responseSuccesses.forEach((entry) => {
          const original =
            originalItemsByLine.get(Number(entry?.lineNumber || 0)) || null;
          if (original) {
            batchSuccesses.push({
              ...original,
              hotmailLink: entry?.hotmailLink || null,
            });
          }
        });
      } else {
        fallbackItems.forEach((item) => {
          batchSuccesses.push(item);
        });
      }

      responseErrors.forEach((entry) => {
        const original =
          originalItemsByLine.get(Number(entry?.lineNumber || 0)) || null;
        batchErrors.push({
          ...(original || {}),
          ...entry,
          lineNumber: Number(entry?.lineNumber || original?.lineNumber || 0),
          reason: String(entry?.reason || 'Khong the them acc').trim(),
        });
      });
    };
    const plusItems = items.filter((item) => item.kind === 'plus');
    const teamItems = items.filter((item) => item.kind === 'team');

    try {
      if (totalAccounts > 0) {
        bot.sendMessage(
          chatId,
          totalAccounts > 1
            ? `Dang them hang loat ${totalAccounts} acc...`
            : items[0]?.kind === 'team'
            ? 'Dang them team account...'
            : 'Dang them account...',
        );
      }

      if (teamItems.length > 0) {
        try {
          const expiredAt = addMonthsClamped(new Date(), 1).toISOString();
          const response = await axios.post(
            `${API_URL}/api/team-public/bulk`,
            {
              items: teamItems.map((item) => ({
                lineNumber: item.lineNumber,
                username: item.email,
                password: item.password,
                otpSecret: item.otpSecret,
                recoveryUrl: '',
                note: '',
                saleMode: 'business',
                expiredAt,
              })),
            },
            buildInternalApiConfig({ timeout: 60000 }),
          );
          mergeBulkBatchResponse(response?.data, teamItems);
        } catch (error) {
          teamItems.forEach((item) => {
            batchErrors.push({
              ...item,
              reason:
                error.response?.data?.error ||
                error.response?.data?.message ||
                error.message ||
                'Khong the them Team account',
            });
          });
        }
      }

      if (plusItems.length > 0) {
        try {
          const expiredAt = addMonthsClamped(new Date(), 1).toISOString();
          const response = await axios.post(
            `${API_URL}/api/chatgpt-public/bulk`,
            {
              items: plusItems.map((item) => ({
                lineNumber: item.lineNumber,
                username: item.email,
                password: item.password,
                otpSecret: item.otpSecret,
                link: '',
                type: 'unassigned',
                expiredAt,
                note: '',
              })),
            },
            buildInternalApiConfig({ timeout: 60000 }),
          );
          mergeBulkBatchResponse(response?.data, plusItems);
        } catch (error) {
          plusItems.forEach((item) => {
            batchErrors.push({
              ...item,
              reason:
                error.response?.data?.error ||
                error.response?.data?.message ||
                error.message ||
                'Khong the them Plus account',
            });
          });
        }
      }

      bot.sendMessage(
        chatId,
        buildTelegramBatchSummaryMessage({
          totalLines,
          successes: batchSuccesses,
          errors: batchErrors,
        }),
        { parse_mode: 'Markdown' },
      );
    } catch (error) {
      console.error('Telegram batch add error:', error.response?.data || error.message);
      bot.sendMessage(
        chatId,
        `❌ Loi khi them hang loat: ${error.response?.data?.error || error.message}`,
      );
    }
    return;
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

          const response = await axios.post(`${API_URL}/api/chatgpt-public`, {
            username: email,
            password,
            otpSecret,
            link: recoveryMailUrl,
            type: 'unassigned',
            expiredAt: expiredAtStr,
            note: ''
          });
          const hotmailText = formatTelegramHotmailLinkText(response?.data?.hotmailLink);

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
            ...(hotmailText ? [`Hotmail: ${hotmailText}`] : []),
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
