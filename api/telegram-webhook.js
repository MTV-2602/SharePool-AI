const crypto = require("crypto");
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
const LEGACY_TELEGRAM_BOT_TOKEN =
  "8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA";
const LEGACY_ALLOWED_TELEGRAM_USER_IDS = Object.freeze([6352706510]);
const buildLegacyBotSecret = (label = "") =>
  crypto
    .createHash("sha256")
    .update(`vinhaccplus:${label}:${LEGACY_TELEGRAM_BOT_TOKEN}`)
    .digest("hex");
const TELEGRAM_BOT_TOKEN =
  String(process.env.TELEGRAM_BOT_TOKEN || LEGACY_TELEGRAM_BOT_TOKEN).trim();
const API_URL =
  String(process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "").trim() ||
  "https://vinhaccplus.vercel.app";
const BOT_INTERNAL_TOKEN = String(
  process.env.BOT_INTERNAL_TOKEN || buildLegacyBotSecret("bot-internal"),
).trim();

const parseTelegramIdEnv = (...keys) =>
  Array.from(
    new Set(
      keys
        .flatMap((key) =>
          String(process.env[key] || "")
            .split(",")
            .map((item) => Number.parseInt(String(item || "").trim(), 10))
            .filter((value) => Number.isInteger(value) && value > 0),
        ),
    ),
  );

const ALLOWED_USER_IDS = (() => {
  const parsedIds = parseTelegramIdEnv(
    "ALLOWED_USER_IDS",
    "TELEGRAM_ALLOWED_USER_IDS",
  );
  return parsedIds.length > 0 ? parsedIds : [...LEGACY_ALLOWED_TELEGRAM_USER_IDS];
})();
const ALLOWED_CHAT_IDS = (() => {
  const parsedIds = parseTelegramIdEnv(
    "ALLOWED_CHAT_IDS",
    "TELEGRAM_ALLOWED_CHAT_IDS",
  );
  return parsedIds.length > 0 ? parsedIds : [...LEGACY_ALLOWED_TELEGRAM_USER_IDS];
})();
const hasTelegramAcl = ALLOWED_USER_IDS.length > 0 || ALLOWED_CHAT_IDS.length > 0;

const getBotSecurityConfigError = () => {
  if (!TELEGRAM_BOT_TOKEN) return "TELEGRAM_BOT_TOKEN chua duoc cau hinh.";
  if (!BOT_INTERNAL_TOKEN) return "BOT_INTERNAL_TOKEN chua duoc cau hinh.";
  if (!hasTelegramAcl)
    return "ALLOWED_USER_IDS hoac ALLOWED_CHAT_IDS chua duoc cau hinh.";
  return "";
};

const checkPermission = ({ userId, chatId }) => {
  if (!hasTelegramAcl) return false;
  const normalizedUserId = Number.parseInt(userId, 10);
  const normalizedChatId = Number.parseInt(chatId, 10);
  if (
    Number.isInteger(normalizedUserId) &&
    ALLOWED_USER_IDS.includes(normalizedUserId)
  ) {
    return true;
  }
  if (
    Number.isInteger(normalizedChatId) &&
    ALLOWED_CHAT_IDS.includes(normalizedChatId)
  ) {
    return true;
  }
  return false;
};

const buildInternalApiConfig = (config = {}) => {
  const nextConfig = { ...(config || {}) };
  nextConfig.headers = {
    ...(config?.headers || {}),
    "x-bot-internal-token": BOT_INTERNAL_TOKEN,
  };
  return nextConfig;
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
const splitTelegramBatchLines = (rawText) =>
  String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
const isPotentialTelegramCredentialLine = (line = "") => {
  const normalizedLine = String(line || "").trim();
  if (!normalizedLine) return false;
  if (/^team\b/i.test(normalizedLine)) return true;
  return (
    /[|ï½œÂ¦â”ƒ]/.test(normalizedLine) &&
    !normalizedLine.includes(",") &&
    !normalizedLine.includes("---")
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
    const kind = /^team\b/i.test(line) ? "team" : "plus";
    const parsed =
      kind === "team"
        ? parseTeamAccountInput(line)
        : parseChatgptAccountInput(line);

    if (!parsed) {
      errors.push({
        lineNumber,
        rawLine: line,
        kind,
        reason:
          kind === "team"
            ? "Sai format. Dung: team email|password|2fa"
            : "Sai format. Dung: email|password|2fa",
      });
      return;
    }

    const dedupeKey = [
      kind,
      String(parsed.email || "").trim().toLowerCase(),
      String(parsed.password || "").trim(),
      String(parsed.otpSecret || "").trim(),
    ].join("|");
    if (seenKeys.has(dedupeKey)) {
      errors.push({
        lineNumber,
        rawLine: line,
        kind,
        reason: "Trung voi dong truoc trong cung message",
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
  const plusSuccesses = successes.filter((item) => item.kind === "plus");
  const teamSuccesses = successes.filter((item) => item.kind === "team");
  const hotmailLinkedCount = plusSuccesses.filter(
    (item) => item?.hotmailLink?.status === "linked",
  ).length;
  const hotmailMissingCount = plusSuccesses.filter(
    (item) => item?.hotmailLink?.status === "missing",
  ).length;
  const successPreview = successes.slice(0, 8);
  const errorPreview = errors.slice(0, 8);
  const lines = [
    "*KET QUA NHAP NHANH TELEGRAM*",
    "",
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
    lines.push("", "*Thanh cong:*");
    successPreview.forEach((item) => {
      lines.push(
        `${item.lineNumber}. [${item.kind === "team" ? "Team" : "Plus"}] \`${item.email}\`${formatTelegramHotmailLinkSuffix(item.hotmailLink)}`,
      );
    });
    if (successes.length > successPreview.length) {
      lines.push(`+${successes.length - successPreview.length} dong thanh cong nua`);
    }
  }

  if (errorPreview.length > 0) {
    lines.push("", "*Dong loi:*");
    errorPreview.forEach((item) => {
      lines.push(`${item.lineNumber}. ${item.reason}`);
    });
    if (errors.length > errorPreview.length) {
      lines.push(`+${errors.length - errorPreview.length} dong loi nua`);
    }
  }

  return lines.join("\n");
};
const formatTelegramHotmailLinkText = (hotmailLink = null) => {
  const status = String(hotmailLink?.status || "").trim();
  if (status === "linked") {
    return hotmailLink?.lockApplied
      ? "da noi va khoa kho extension"
      : "da noi ChatGPT";
  }
  if (status === "missing") return "Chua co acc trong Hotmail";
  if (status === "hotmail_only") return "co trong kho Hotmail, chua co ChatGPT";
  if (status === "error") return hotmailLink?.message || "loi khi noi Hotmail";
  return "";
};
const formatTelegramHotmailLinkSuffix = (hotmailLink = null) => {
  const text = formatTelegramHotmailLinkText(hotmailLink);
  return text ? ` | Hotmail: ${text}` : "";
};
const parseCleanupCommand = (rawText = "") => {
  const normalized = String(rawText || "").trim();
  const match = normalized.match(
    /^\/cleanup\s+(show|approve|reject)\s+([a-z0-9_-]+)$/i,
  );
  if (!match) return null;
  return {
    action: String(match[1] || "").trim().toLowerCase(),
    batchId: String(match[2] || "").trim(),
  };
};
const escapeTelegramHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const formatCleanupBatchTelegramMessage = (batch = {}) => {
  const items = Array.isArray(batch?.items) ? batch.items : [];
  const summary =
    batch?.summary && typeof batch.summary === "object" ? batch.summary : {};
  const previewItems = items.slice(0, 12);
  const safeBatchId = escapeTelegramHtml(batch?.batchId || "--");
  const lines = [
    "<b>BATCH DON HET HAN</b>",
    "",
    `Batch: <code>${safeBatchId}</code>`,
    `Trang thai: ${escapeTelegramHtml(batch?.status || "--")}`,
    `Candidate: ${Number(summary?.candidateCount || items.length || 0)}`,
    `Warning: ${Number(summary?.warningCount || 0)}`,
    `Scan: ${escapeTelegramHtml(summary?.scannedAt || batch?.createdAt || "--")}`,
  ];
  if (previewItems.length > 0) {
    lines.push("", "<b>Preview:</b>");
    previewItems.forEach((item, index) => {
      const usageText =
        item?.scope === "team"
          ? `slot ${Number(item?.activeSlotCount || 0)}/${Number(item?.expiredSlotCount || 0)}`
          : `khach ${Number(item?.activeUserCount || 0)}/${Number(item?.expiredUserCount || 0)}`;
      const sourceText = String(item?.sourceLabel || "").trim();
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.scope === "team" ? "Team" : "ChatGPT")} | ${escapeTelegramHtml(item?.username || item?.itemId || "--")} | ${escapeTelegramHtml(item?.reasonLabel || item?.reasonCode || "--")} | HH ${escapeTelegramHtml(item?.expiredAt || "--")} | ${escapeTelegramHtml(usageText)}${sourceText ? ` | nguon ${escapeTelegramHtml(sourceText)}` : ""}`,
      );
    });
    if (items.length > previewItems.length) {
      lines.push(`+${items.length - previewItems.length} item nua`);
    }
  }
  lines.push(
    "",
    `<code>/cleanup show ${safeBatchId}</code>`,
    `<code>/cleanup approve ${safeBatchId}</code>`,
    `<code>/cleanup reject ${safeBatchId}</code>`,
  );
  return lines.join("\n");
};
const formatCleanupExecutionResultMessage = ({
  batch = null,
  result = null,
  action = "approve",
} = {}) => {
  const safeBatchId = escapeTelegramHtml(batch?.batchId || "--");
  if (action === "reject") {
    return [
      "<b>DA TU CHOI BATCH CLEANUP</b>",
      "",
      `Batch: <code>${safeBatchId}</code>`,
      `Trang thai: ${escapeTelegramHtml(batch?.status || "rejected")}`,
    ].join("\n");
  }
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const lines = [
    "<b>KET QUA CLEANUP</b>",
    "",
    `Batch: <code>${safeBatchId}</code>`,
    `Da xoa: ${Number(result?.deletedCount || 0)}`,
    `Bo qua: ${Number(result?.skippedCount || 0)}`,
    `Loi: ${Number(result?.errorCount || 0)}`,
  ];
  if (skipped.length > 0) {
    lines.push("", "<b>Bo qua:</b>");
    skipped.slice(0, 5).forEach((item, index) => {
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.username || item?.itemId || "--")} | ${escapeTelegramHtml(item?.reason || "--")}`,
      );
    });
    if (skipped.length > 5) {
      lines.push(`+${skipped.length - 5} item skip nua`);
    }
  }
  if (errors.length > 0) {
    lines.push("", "<b>Loi:</b>");
    errors.slice(0, 3).forEach((item, index) => {
      lines.push(
        `${index + 1}. ${escapeTelegramHtml(item?.username || item?.itemId || "--")} | ${escapeTelegramHtml(item?.error || "--")}`,
      );
    });
  }
  return lines.join("\n");
};
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
    ? new Date().toLocaleString("vi-VN")
    : updatedAt.toLocaleString("vi-VN");

  return [
    "📊 SYSTEM STATS",
    "",
    "🤖 ChatGPT",
    `- Kho: Tat ca ${Number(chatgptWarehouses.all || summary?.totalAccounts || 0)} | Kho tong ${Number(chatgptWarehouses.total || 0)} | Kho market ${Number(chatgptWarehouses.market || 0)} | Kho duoi 25 ${Number(chatgptWarehouses.short || 0)}`,
    `- Kho tong: Goi 1 ${Number(chatgptTypes.package1 || shared.total || 0)} | Goi 2 ${Number(chatgptTypes.package2 || privateStats.total || 0)} | Chua chon ${Number(chatgptTypes.unassigned || 0)}`,
    `- Kho market: Chua ban ${Number(chatgptMarket.all || 0)} | Da ban ${Number(chatgptMarket.sold || 0)}`,
    `- User: Active ${Number(users.active || 0)} | Expired ${Number(users.expired || 0)}`,
    `- Han acc: Exp ${Number(expiry.expired || 0)} | <=3d ${Number(expiry.within3Days || 0)} | <=7d ${Number(expiry.within7Days || 0)}`,
    "",
    "👥 Team",
    `- Kho: Tat ca ${Number(team.totalAccounts || 0)} | Kho tong ${Number(teamWarehouses.total || 0)} | Kho market ${Number(teamWarehouses.market || 0)} | Kho duoi 25 ${Number(teamWarehouses.short || 0)}`,
    `- Kho tong: Goi chia se ${Number(teamTotalWarehouseModes.slot || 0)} | Nguyen acc ${Number(teamTotalWarehouseModes.business || 0)}`,
    `- Su dung: Khach ${Number(team.activeCustomers || 0)} | Dang dung ${Number(team.usedAccounts || 0)} | Rong ${Number(team.emptyAccounts || 0)} | San sang ${Number(team.marketReady || 0)}`,
    `- Han acc: Exp ${Number(teamExpiry.expired || 0)} | <=3d ${Number(teamExpiry.within3Days || 0)} | <=7d ${Number(teamExpiry.within7Days || 0)}`,
    "",
    "🛒 Don san",
    `- ChatGPT: Don ${Number(market.chatgptOrders || 0)} | Bao hanh ${Number(market.chatgptWarranty || 0)}`,
    `- Team: Don ${Number(market.teamOrders || 0)} | Bao hanh ${Number(market.teamWarranty || 0)}`,
    `- Provider: Datammo ${Number(providers.datammoOrders || 0)}/${Number(providers.datammoWarranty || 0)} | Shopmini ${Number(providers.shopminiOrders || 0)}/${Number(providers.shopminiWarranty || 0)}`,
    "",
    "🌐 Web",
    `- User ${Number(web.totalUsers || 0)} | Don ${Number(web.totalOrders || 0)} | Pending ${Number(web.pendingOrders || 0)} | Fulfilled ${Number(web.fulfilledOrders || 0)}`,
    "",
    `🕒 Updated: ${updatedLabel}`,
  ].join("\n");
};

const sanitizeTelegramStatsText = (value = "") =>
  String(value || "")
    .trim()
    .replace(/[_*`[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 90);

const formatExtensionWorkerStatsMessage = (summary = {}) => {
  const extensionWorkers = summary?.extensionWorkers || summary?.stats || summary || {};
  const extensionWorkerItems = Array.isArray(extensionWorkers?.items)
    ? extensionWorkers.items
    : [];
  const updatedAt = extensionWorkers?.generatedAt || summary?.updatedAt
    ? new Date(extensionWorkers?.generatedAt || summary.updatedAt)
    : new Date();
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? new Date().toLocaleString("vi-VN")
    : updatedAt.toLocaleString("vi-VN");
  const activeItems = extensionWorkerItems.filter(
    (item) =>
      Number(item?.today || 0) > 0 ||
      Number(item?.total7Days || 0) > 0 ||
      Number(item?.total || 0) > 0,
  );
  const formatDayText = (item) => {
    if (!Array.isArray(item?.days)) return "";
    return item.days
      .slice(0, 7)
      .map((day) => {
        const label = String(day?.dateKey || "").slice(5).replace("-", "/");
        const count = Number(day?.count || 0);
        return count > 0 ? `${label}: ${count}` : "";
      })
      .filter(Boolean)
      .join(" | ");
  };
  const lines = [
    "THONG KE WORKER EXTENSION",
    "",
    `Hom nay (${extensionWorkers.todayKey || "Asia/Bangkok"}): ${Number(extensionWorkers.today || 0)} nick`,
    `7 ngay gan nhat: ${Number(extensionWorkers.total7Days || 0)} nick`,
    `Tong da push: ${Number(extensionWorkers.total || 0)} nick`,
    "",
  ];
  if (activeItems.length === 0) {
    lines.push("Chua co du lieu push theo nguoi lam.");
  } else {
    lines.push("Theo nguoi lam:");
    activeItems.slice(0, 20).forEach((item, index) => {
      const dayText = formatDayText(item);
      lines.push(
        `${index + 1}. ${sanitizeTelegramStatsText(item?.name || "Chua gan")}: ${Number(item?.today || 0)} hom nay | ${Number(item?.total7Days || 0)} trong 7 ngay | tong ${Number(item?.total || 0)}`,
      );
      if (dayText) lines.push(`   Ngay co push: ${dayText}`);
    });
    if (activeItems.length > 20) {
      lines.push(`+${activeItems.length - 20} nguoi nua`);
    }
    const zeroCount = extensionWorkerItems.length - activeItems.length;
    if (zeroCount > 0) {
      lines.push(`An ${zeroCount} worker chua co push de tin nhan gon hon.`);
    }
  }
  lines.push("", `Updated: ${updatedLabel}`);
  return lines.join("\n");
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
const TELEGRAM_BOT_COMMANDS = Object.freeze([
  { command: "stats", description: "Thong ke tong quan" },
  { command: "workers", description: "Thong ke nhanh nguoi lam extension" },
  { command: "workerstats", description: "Thong ke chi tiet nguoi lam extension" },
  { command: "help", description: "Huong dan su dung bot" },
  { command: "cleanup", description: "Quan ly batch don het han" },
]);
const TELEGRAM_BOT_COMMAND_SCOPES = Object.freeze([
  { type: "default" },
  { type: "all_private_chats" },
  ...ALLOWED_CHAT_IDS.map((chatId) => ({
    type: "chat",
    chat_id: chatId,
  })),
]);
let telegramCommandMenuSyncPromise = null;
const syncTelegramCommandMenu = () => {
  if (telegramCommandMenuSyncPromise) return telegramCommandMenuSyncPromise;
  telegramCommandMenuSyncPromise = Promise.all(
    TELEGRAM_BOT_COMMAND_SCOPES.map((scope) =>
      axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
        commands: TELEGRAM_BOT_COMMANDS,
        scope,
      }),
    ),
  )
    .catch((error) => {
      telegramCommandMenuSyncPromise = null;
      console.error("Khong the cap nhat menu lenh Telegram:", error.message);
    });
  return telegramCommandMenuSyncPromise;
};
const TELEGRAM_WELCOME_MESSAGE = [
  "*CHATGPT & COURSERA MANAGER BOT*",
  "",
  "*Lenh:*",
  "/stats - thong ke tong quan",
  "/workerstats - thong ke nguoi lam extension",
  "/help - huong dan",
  "/cleanup show <batchId> - xem batch don het han",
  "/cleanup approve <batchId> - duyet xoa batch",
  "/cleanup reject <batchId> - tu choi batch",
  "",
  "*Nhap Plus:*",
  "```",
  "email|password|2FA_SECRET",
  "```",
  "",
  "*Nhap Team:*",
  "```",
  "team email|password|2FA_SECRET",
  "```",
  "",
  "*Nhap nhanh hang loat:*",
  "```",
  "email1|password1|2FA1",
  "email2|password2|2FA2",
  "team team1@domain.com|password3|2FA3",
  "```",
  "",
  "*Coursera:*",
  "```",
  "email,password,courseCode",
  "```",
].join("\n");

const TELEGRAM_COMMAND_KEYBOARD_OPTIONS = {
  reply_markup: {
    keyboard: [
      [{ text: "/stats" }, { text: "/workerstats" }],
      [{ text: "/help" }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

module.exports = async (req, res) => {
  // No need to connect DB - using API endpoints instead

  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const configError = getBotSecurityConfigError();
    if (configError) {
      console.error("Telegram webhook config error:", configError);
      return res.status(503).json({ error: configError });
    }
    void syncTelegramCommandMenu();
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
    if (!checkPermission({ userId, chatId })) {
      await sendMessage(chatId, "❌ Bạn không có quyền sử dụng bot này!");
      return res.status(200).json({ ok: true });
    }

    // Command: /start hoặc /help
    if (text === "/start" || text === "/help") {
      await sendMessage(chatId, TELEGRAM_WELCOME_MESSAGE, TELEGRAM_COMMAND_KEYBOARD_OPTIONS);
      return res.status(200).json({ ok: true });
    }
    if (false && (text === "/start" || text === "/help")) {
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
          buildInternalApiConfig(),
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

    if (text === "/workerstats" || text === "/workers") {
      try {
        await sendMessage(chatId, "Dang tai thong ke nguoi lam...");
        const summaryResponse = await axios.get(
          `${API_URL}/api/admin/extension-worker-stats`,
          buildInternalApiConfig(),
        );
        const summary = summaryResponse?.data?.stats || {};
        await sendMessage(chatId, formatExtensionWorkerStatsMessage(summary));
      } catch (error) {
        console.error("Worker stats error:", error.message);
        await sendMessage(chatId, "Khong the tai thong ke nguoi lam.");
      }
      return res.status(200).json({ ok: true });
    }

    const cleanupCommand = parseCleanupCommand(text);
    if (cleanupCommand) {
      try {
        if (cleanupCommand.action === "show") {
          await sendMessage(chatId, "Dang tai batch cleanup...", {
            parse_mode: "HTML",
          });
          const response = await axios.get(
            `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${cleanupCommand.batchId}`,
            buildInternalApiConfig(),
          );
          const batch = response?.data?.batch || null;
          if (!batch) {
            await sendMessage(chatId, "Khong tim thay batch cleanup.", {
              parse_mode: "HTML",
            });
          } else {
            await sendMessage(
              chatId,
              formatCleanupBatchTelegramMessage(batch),
              { parse_mode: "HTML" },
            );
          }
        } else if (cleanupCommand.action === "approve") {
          await sendMessage(chatId, "Dang duyet batch cleanup...", {
            parse_mode: "HTML",
          });
          const response = await axios.post(
            `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${cleanupCommand.batchId}/execute`,
            {
              actorSource: "telegram_cleanup_approve",
              actor: String(userId || chatId || "telegram_admin"),
            },
            buildInternalApiConfig(),
          );
          await sendMessage(
            chatId,
            formatCleanupExecutionResultMessage({
              batch: response?.data?.batch || null,
              result: response?.data?.result || null,
              action: "approve",
            }),
            { parse_mode: "HTML" },
          );
        } else if (cleanupCommand.action === "reject") {
          await sendMessage(chatId, "Dang tu choi batch cleanup...", {
            parse_mode: "HTML",
          });
          const response = await axios.post(
            `${API_URL}/api/admin/chatgpt-expiry-cleanup-batches/${cleanupCommand.batchId}/reject`,
            {
              actorSource: "telegram_cleanup_reject",
              actor: String(userId || chatId || "telegram_admin"),
            },
            buildInternalApiConfig(),
          );
          await sendMessage(
            chatId,
            formatCleanupExecutionResultMessage({
              batch: response?.data?.batch || null,
              action: "reject",
            }),
            { parse_mode: "HTML" },
          );
        }
      } catch (error) {
        await sendMessage(
          chatId,
          escapeTelegramHtml(
            error?.response?.data?.error ||
              error?.message ||
              "Khong the xu ly lenh cleanup.",
          ),
          { parse_mode: "HTML" },
        );
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
            buildInternalApiConfig({
              params: { q: searchName },
            }),
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
            buildInternalApiConfig({
              params: { email: searchEmail },
            }),
          );
          const found = response?.data?.account || null;
          const hotmailText = formatTelegramHotmailLinkText(
            response?.data?.hotmailLink,
          );
          if (!found && hotmailText) {
            await sendMessage(chatId, `Hotmail: ${hotmailText}`);
          }

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
            if (hotmailText) {
              message += `Hotmail: ${hotmailText}\n\n`;
            }

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
              buildInternalApiConfig({
                timeout: 30000,
              }),
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

      const parsedBatchCredentials = parseTelegramCredentialBatch(text);
      if (parsedBatchCredentials) {
        const { totalLines, items, errors: initialErrors } =
          parsedBatchCredentials;
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
              reason: String(entry?.reason || "Khong the them acc").trim(),
            });
          });
        };
        const plusItems = items.filter((item) => item.kind === "plus");
        const teamItems = items.filter((item) => item.kind === "team");

        try {
          if (totalAccounts > 0) {
            await sendMessage(
              chatId,
              totalAccounts > 1
                ? `Dang them hang loat ${totalAccounts} acc...`
                : items[0]?.kind === "team"
                  ? "Dang them team account..."
                  : "Dang them account...",
            );
          }

          if (teamItems.length > 0) {
            try {
              const response = await axios.post(
                `${API_URL}/api/team-public/bulk`,
                {
                  items: teamItems.map((item) => ({
                    lineNumber: item.lineNumber,
                    username: item.email,
                    password: item.password,
                    otpSecret: item.otpSecret,
                    recoveryUrl: "",
                    note: "",
                    saleMode: "business",
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
                    "Khong the them Team account",
                });
              });
            }
          }

          if (plusItems.length > 0) {
            try {
              const response = await axios.post(
                `${API_URL}/api/chatgpt-public/bulk`,
                {
                  items: plusItems.map((item) => ({
                    lineNumber: item.lineNumber,
                    username: item.email,
                    password: item.password,
                    otpSecret: item.otpSecret,
                    link: "",
                    type: "unassigned",
                    note: "",
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
                    "Khong the them Plus account",
                });
              });
            }
          }

          await sendMessage(
            chatId,
            buildTelegramBatchSummaryMessage({
              totalLines,
              successes: batchSuccesses,
              errors: batchErrors,
            }),
          );
        } catch (error) {
          console.error(
            "Telegram batch add error:",
            error.response?.data || error.message,
          );
          await sendMessage(
            chatId,
            `❌ Loi khi them hang loat: ${error.response?.data?.error || error.message}`,
          );
        }
        return res.status(200).json({ ok: true });
      }

      const parsedTeamAccount = parsedInlineTeamAccount;
      if (parsedTeamAccount) {
        const { email, password, otpSecret, link: recoveryUrl } = parsedTeamAccount;

        try {
          await sendMessage(chatId, "⏳ Đang thêm team account...");

          await axios.post(
            `${API_URL}/api/team-public`,
            {
              username: email,
              password,
              otpSecret,
              recoveryUrl,
              note: "",
              saleMode: "business",
            },
            buildInternalApiConfig(),
          );

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
              const response = await axios.post(
                `${API_URL}/api/chatgpt-public`,
                {
                  username: email,
                  password,
                  otpSecret,
                  link: recoveryMailUrl,
                  type: "unassigned",
                  note: "",
                },
                buildInternalApiConfig(),
              );
              const hotmailText = formatTelegramHotmailLinkText(
                response?.data?.hotmailLink,
              );

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
                ...(hotmailText ? [`Hotmail: ${hotmailText}`] : []),
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
