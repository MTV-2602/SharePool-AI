import { useState, useEffect, useRef } from "react";
import axios, { subscribeToApiActivity } from "./axiosConfig";
import {
  Trash2,
  UserPlus,
  Pencil,
  Copy,
  ExternalLink,
  RefreshCw,
  X,
  Upload,
  Loader2,
  CheckCircle,
  Mail,
  User,
  Shield,
  AlertCircle,
  AlertTriangle,
  Info,
  Calendar,
  LogIn,
  Lock,
  FileSpreadsheet,
  ArrowRightLeft,
  RotateCw,
  Globe,
} from "lucide-react";

// Helper: Xóa dấu Tiếng Việt
const toNonAccentVietnamese = (str) => {
  if (!str) return "";
  str = str.toLowerCase();
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  // Some system encode vietnamese combining accent as individual utf-8 characters
  str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // Huyền, sắc, hỏi, ngã, nặng
  str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // Â, Ê, Ă, Ơ, Ư
  return str;
};

const normalizePackage2Shelf = (value) => {
  if (value === "cheap") return "cheap";
  if (value === "main") return "main";
  if (value === "none") return "none";
  return "none";
};

const supportsChatgptMarketType = (value) =>
  ["package1", "package2", "unassigned", ""].includes(
    String(value || "").trim(),
  );

const getPackage2ShelfLabel = (value) =>
  normalizePackage2Shelf(value) === "cheap"
    ? "Kho market"
    : normalizePackage2Shelf(value) === "main"
      ? "Kho duoi 25 ngay"
      : "Kho tong";
const getChatgptWarehouseLabel = (value) => getPackage2ShelfLabel(value);
const isChatgptMarketWarehouse = (acc = {}) =>
  supportsChatgptMarketType(acc?.type) &&
  normalizePackage2Shelf(acc?.package2Shelf) === "cheap";
const isChatgptShortDateWarehouse = (acc = {}) =>
  supportsChatgptMarketType(acc?.type) &&
  normalizePackage2Shelf(acc?.package2Shelf) === "main";
const normalizeTeamSaleMode = (value) =>
  value === "business" ? "business" : "slot";
const normalizeTeamWarehouse = (value) => {
  if (value === "market") return "market";
  if (value === "short") return "short";
  return "total";
};
const getTeamWarehouseLabel = (value) =>
  normalizeTeamWarehouse(value) === "market"
    ? "Kho market"
    : normalizeTeamWarehouse(value) === "short"
      ? "Kho duoi 25 ngay"
      : "Kho tong";
const isTeamMarketWarehouse = (account = {}) =>
  normalizeTeamWarehouse(account?.warehouse) === "market";
const isTeamShortWarehouse = (account = {}) =>
  normalizeTeamWarehouse(account?.warehouse) === "short";
const isTeamTotalWarehouse = (account = {}) =>
  normalizeTeamWarehouse(account?.warehouse) === "total";
const buildEmptyTeamSlot = () => ({
  status: "empty",
  gmail: "",
  customerName: "",
  addedAt: "",
  expiredAt: "",
});
const normalizeTeamSlotsForUi = (slots = []) =>
  Array.from({ length: 4 }, (_, index) => {
    const slot = Array.isArray(slots) ? slots[index] || {} : {};
    const gmail = String(slot?.gmail || "").trim();
    const customerName = String(slot?.customerName || "").trim();
    const hasCustomerIdentity = !!(gmail || customerName);
    const isActive =
      String(slot?.status || "").toLowerCase() === "active" &&
      hasCustomerIdentity;
    if (!isActive) return buildEmptyTeamSlot();
    return {
      status: "active",
      gmail,
      customerName,
      addedAt: String(slot?.addedAt || ""),
      expiredAt: String(slot?.expiredAt || ""),
    };
  });
const getTeamCustomerCapacity = (value) =>
  normalizeTeamSaleMode(
    typeof value === "string" ? value : value?.saleMode,
  ) === "business"
    ? 1
    : 4;
const getActiveTeamCustomers = (account = {}) =>
  normalizeTeamSlotsForUi(account?.slots).filter(
    (slot) => slot.status === "active" && String(slot.gmail || "").trim(),
  );
const getTeamSaleModeLabel = (value) =>
  normalizeTeamSaleMode(value) === "business"
    ? "Business account (1 acc)"
    : "Slot team";
const DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY = "datammo_seen_order_keys";
const DATAMMO_RECENT_ORDER_WINDOW_MS = 15 * 60 * 1000;
const buildDatammoOrderKey = (order = {}) =>
  String(
    order._id ||
      order.id ||
      `${order.provider || "datammo"}|${order.orderId || "order"}|${order.createdAt || ""}`,
  );
const normalizeMarketplaceProvider = (value, fallback = "datammo") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "shopmini") return "shopmini";
  if (raw === "datammo") return "datammo";
  return fallback;
};
const getMarketplaceProviderLabel = (value) =>
  normalizeMarketplaceProvider(value) === "shopmini" ? "Shopmini" : "Datammo";
const getDatammoUserName = (user) =>
  typeof user === "string" ? user : String(user?.name || "");
const isDatammoManagedUser = (user) => {
  const normalized = getDatammoUserName(user).trim().toLowerCase();
  return (
    normalized.startsWith("datammo#") ||
    normalized.startsWith("[datammo]") ||
    normalized.startsWith("shopmini#") ||
    normalized.startsWith("[shopmini]")
  );
};
const getMarketplaceOrderInfoFromUser = (user) => {
  const rawName = getDatammoUserName(user).trim();
  const datammoMatch = /^datammo#(.+)$/i.exec(rawName);
  if (datammoMatch?.[1]) {
    return { provider: "datammo", orderId: String(datammoMatch[1]).trim() };
  }
  const shopminiMatch = /^shopmini#(.+)$/i.exec(rawName);
  if (shopminiMatch?.[1]) {
    return { provider: "shopmini", orderId: String(shopminiMatch[1]).trim() };
  }
  if (/^\[datammo\]/i.test(rawName)) {
    return { provider: "datammo", orderId: "" };
  }
  if (/^\[shopmini\]/i.test(rawName)) {
    return { provider: "shopmini", orderId: "" };
  }
  return { provider: "", orderId: "" };
};
const getLegacyMarketplaceInfoFromNote = (note) => {
  const lines = String(note || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!/^\[Legacy Datammo customer\]/i.test(line)) continue;
    const body = line.replace(/^\[Legacy Datammo customer\]\s*/i, "");
    const parts = body
      .split("|")
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    const name = String(parts.shift() || "").trim();
    const orderInfo = getMarketplaceOrderInfoFromUser({ name });
    const joinedAt = String(
      parts.find((part) => /^joined:/i.test(part)) || "",
    )
      .replace(/^joined:\s*/i, "")
      .trim();
    const expiredAt = String(
      parts.find((part) => /^expired:/i.test(part)) || "",
    )
      .replace(/^expired:\s*/i, "")
      .trim();
    return {
      name,
      provider: orderInfo.provider || "",
      orderId: orderInfo.orderId || "",
      joinedAt,
      expiredAt,
    };
  }
  return null;
};
const extractDatammoOrderIdFromUser = (user) => {
  return String(getMarketplaceOrderInfoFromUser(user).orderId || "").trim();
};
const findMarketplaceOrderForAccount = (
  accountId,
  orders = [],
  provider = "",
  scope = "",
) => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return "";
  const normalizedProvider = normalizeMarketplaceProvider(provider, "");
  const normalizedScope = scope
    ? normalizeMarketplaceScope(scope)
    : "";
  for (const order of Array.isArray(orders) ? orders : []) {
    if (
      normalizedProvider &&
      normalizeMarketplaceProvider(order?.provider, "") !== normalizedProvider
    ) {
      continue;
    }
    if (
      normalizedScope &&
      normalizeMarketplaceScope(order?.scope) !== normalizedScope
    ) {
      continue;
    }
    const accounts = Array.isArray(order?.accounts) ? order.accounts : [];
    const matched = accounts.some(
      (item) => String(item?.accountId || "").trim() === normalizedId,
    );
    if (matched) {
      return order;
    }
  }
  return null;
};
const normalizeDatammoWarrantyCases = (cases = []) =>
  [...(Array.isArray(cases) ? cases : [])].sort(
    (a, b) =>
      new Date(b?.updatedAt || b?.createdAt || 0).getTime() -
      new Date(a?.updatedAt || a?.createdAt || 0).getTime(),
  );
const normalizeMarketplaceScope = (scope) =>
  String(scope || "").trim().toLowerCase() === "team" ? "team" : "chatgpt";
const getDatammoWarrantyInfoForAccount = (
  accountId,
  cases = [],
  scope = "chatgpt",
) => {
  const normalizedId = String(accountId || "");
  if (!normalizedId) return null;
  const normalizedScope = normalizeMarketplaceScope(scope);
  for (const warrantyCase of Array.isArray(cases) ? cases : []) {
    if (normalizeMarketplaceScope(warrantyCase?.scope) !== normalizedScope) {
      continue;
    }
    const rounds = Array.isArray(warrantyCase?.rounds) ? warrantyCase.rounds : [];
    if (String(warrantyCase?.currentAccountId || "") === normalizedId) {
      return { role: "current", warrantyCase };
    }
    if (String(warrantyCase?.rootAccountId || "") === normalizedId) {
      return { role: "root", warrantyCase };
    }
    const participates = rounds.some(
      (round) =>
        String(round?.fromAccountId || "") === normalizedId ||
        String(round?.toAccountId || "") === normalizedId,
    );
    if (participates) {
      return { role: "history", warrantyCase };
    }
  }
  return null;
};
const isAccountBusyInDatammoWarranty = (
  accountId,
  cases = [],
  scope = "chatgpt",
) => !!getDatammoWarrantyInfoForAccount(accountId, cases, scope);
const normalizeDatammoOrders = (orders = []) =>
  [...(Array.isArray(orders) ? orders : [])].sort(
    (a, b) =>
      new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime(),
  );
const buildMarketplaceOrderSummaries = (orders = [], warrantyCases = []) =>
  normalizeDatammoOrders(orders).map((order) => {
    const provider = normalizeMarketplaceProvider(order?.provider);
    const providerLabel = getMarketplaceProviderLabel(provider);
    const scope = normalizeMarketplaceScope(order?.scope);
    const orderId = String(order?.orderId || "").trim();
    const accountItems = Array.isArray(order?.accounts) ? order.accounts : [];
    const accountSummaries = accountItems.map((account) => {
      const accountScope = normalizeMarketplaceScope(account?.scope || scope);
      const soldAccountId = String(account?.accountId || "").trim();
      const soldUsername = String(
        account?.username || soldAccountId || "Không rõ acc",
      ).trim();
      const warrantyCase = (Array.isArray(warrantyCases) ? warrantyCases : []).find(
        (item) =>
          normalizeMarketplaceScope(item?.scope) === accountScope &&
          normalizeMarketplaceProvider(item?.provider) === provider &&
          String(item?.orderId || "").trim() === orderId &&
          String(item?.rootAccountId || "").trim() === soldAccountId,
      );
      const warrantyRounds = Array.isArray(warrantyCase?.rounds)
        ? warrantyCase.rounds
        : [];
      const currentUsername = String(
        warrantyCase?.currentUsername || soldUsername || "Không rõ acc",
      ).trim();
      return {
        scope: accountScope,
        itemType: String(account?.itemType || "").trim(),
        soldAccountId,
        soldUsername,
        currentAccountId: String(
          warrantyCase?.currentAccountId || soldAccountId || "",
        ).trim(),
        currentUsername,
        warrantyRounds: warrantyRounds.length,
        warrantyCase,
      };
    });
    const totalWarrantyRounds = accountSummaries.reduce(
      (sum, item) => sum + Number(item?.warrantyRounds || 0),
      0,
    );
    const searchIndex = toNonAccentVietnamese(
      [
        providerLabel,
        provider,
        orderId,
        scope,
        ...(accountSummaries || []).flatMap((item) => [
          item?.scope,
          item?.soldUsername,
          item?.currentUsername,
          item?.soldAccountId,
          item?.currentAccountId,
        ]),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return {
      ...order,
      provider,
      providerLabel,
      orderId,
      accountSummaries,
      totalWarrantyRounds,
      hasWarranty: accountSummaries.some((item) => item.warrantyRounds > 0),
      searchIndex,
    };
  });
const loadSeenDatammoOrderKeys = () => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(
      localStorage.getItem(DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((item) => String(item || "")).filter(Boolean));
  } catch (error) {
    return new Set();
  }
};
const persistSeenDatammoOrderKeys = (keys = []) => {
  if (typeof window === "undefined") return;
  try {
    const normalized = Array.from(
      new Set((Array.isArray(keys) ? keys : Array.from(keys || [])).map((item) => String(item || "")).filter(Boolean)),
    ).slice(-100);
    localStorage.setItem(
      DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch (error) {
    // Ignore localStorage write issues.
  }
};
const buildTeamFormState = (overrides = {}) => ({
  username: "",
  password: "",
  otpSecret: "",
  recoveryUrl: "",
  note: "",
  expiredAt: "",
  saleMode: "slot",
  warehouse: "total",
  ...overrides,
});
const buildTeamEditFormState = (overrides = {}) => ({
  id: "",
  ...buildTeamFormState(),
  ...overrides,
});
const buildChatgpt2faLiveUrl = (otpSecret = "") => {
  const normalized = String(otpSecret || "").trim();
  return normalized
    ? `https://2fa.live/tok/${encodeURIComponent(normalized)}`
    : "https://2fa.live/";
};
const buildChatgpt2faCopyText = (otpSecret = "") => {
  const normalized = String(otpSecret || "").trim();
  if (!normalized) return "";
  return [
    `Mã 2FA: ${normalized}`,
    "vào 2FA.live nhập mã 2FA vào để lấy code đăng nhập hoặc link dưới này",
    `2FA.live: ${buildChatgpt2faLiveUrl(normalized)}`,
  ].join("\n");
};
const shouldIncludeChatgptLinkInCopy = (account = {}) =>
  !!(
    account.link &&
    (account.type === "package2" ||
      normalizePackage2Shelf(account?.package2Shelf) !== "none")
  );
const getChatgptCopyButtonText = (account = {}) => {
  let label = "Copy TK, MK";
  if (String(account?.otpSecret || "").trim()) label += " & 2FA";
  if (shouldIncludeChatgptLinkInCopy(account)) label += " & Link";
  return label;
};
const getChatgptCopySuccessText = (account = {}) => {
  let label = "Đã copy Tài khoản & Mật khẩu";
  if (String(account?.otpSecret || "").trim()) label += " & 2FA";
  if (shouldIncludeChatgptLinkInCopy(account)) label += " & Link";
  return label;
};
const buildChatgptCopyText = (account = {}) => {
  const lines = [
    `Tài khoản: ${account.username || ""}`,
    `Mật khẩu: ${account.password || ""}`,
  ];
  if (String(account?.otpSecret || "").trim()) {
    lines.push(buildChatgpt2faCopyText(account.otpSecret));
  }
  if (shouldIncludeChatgptLinkInCopy(account)) {
    lines.push(`Link: ${account.link}`);
  }
  return lines.join("\n");
};
const addParsedChatgptImportRecord = (records, seenKeys, candidate = {}) => {
  const normalized = {
    username: String(candidate?.username || "").trim(),
    password: String(candidate?.password || "").trim(),
    link: String(candidate?.link || "").trim(),
    otpSecret: String(candidate?.otpSecret || "").trim(),
  };
  if (normalized.username.length < 3 || normalized.password.length < 3) return;
  const dedupeKey = [
    normalized.username,
    normalized.password,
    normalized.link,
    normalized.otpSecret,
  ].join("|");
  if (seenKeys.has(dedupeKey)) return;
  seenKeys.add(dedupeKey);
  records.push(normalized);
};
const parseChatgptQuickImportRows = (raw = "") => {
  const cleanedRaw = String(raw || "").replace(/\r/g, "").replace(/\[.*?\]/g, "\n");
  const records = [];
  const seenKeys = new Set();

  cleanedRaw.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.includes("邮箱")) return;

    if (line.includes("---")) {
      const parts = line.split(/-{3,}/).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        addParsedChatgptImportRecord(records, seenKeys, {
          username: parts[0],
          password: parts[1],
          link: parts.find((part, index) => index >= 2 && /^https?:\/\//i.test(part)) || "",
          otpSecret:
            parts.find((part, index) => index >= 2 && !/^https?:\/\//i.test(part)) || "",
        });
      }
      return;
    }

    if (!line.includes("|")) return;
    const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;

    const [username, password, ...rest] = parts;
    let link = "";
    let otpSecret = "";
    rest.forEach((part) => {
      if (!link && /^https?:\/\//i.test(part)) {
        link = part;
      } else if (!otpSecret) {
        otpSecret = part;
      } else if (!link) {
        link = part;
      }
    });
    addParsedChatgptImportRecord(records, seenKeys, {
      username,
      password,
      link,
      otpSecret,
    });
  });

  cleanedRaw.split(/\n\s*\n+/).forEach((rawBlock) => {
    const candidate = {};
    rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) return;
        const key = toNonAccentVietnamese(line.slice(0, separatorIndex))
          .replace(/\s+/g, " ")
          .trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!value) return;

        if (
          /^(tai khoan|tai khoan dang nhap|username|email)$/.test(key)
        ) {
          candidate.username = value;
        } else if (/^(mat khau|password|mk)$/.test(key)) {
          candidate.password = value;
        } else if (/^(ma 2fa|2fa|otp|ma otp)$/.test(key)) {
          candidate.otpSecret = value;
        } else if (/^(link|link mail|mail link|recovery|recovery link)$/.test(key)) {
          candidate.link = value;
        }
      });
    addParsedChatgptImportRecord(records, seenKeys, candidate);
  });

  return records;
};
const buildChatgptMarketplaceExportLine = (account = {}) => {
  const username = String(account?.username || "").trim();
  const password = String(account?.password || "").trim();
  const otpSecret = String(account?.otpSecret || "").trim();
  const link = String(account?.link || "").trim();
  if (!username || !password) return "";
  const parts = [`TK: ${username}`, `MK: ${password}`];
  if (otpSecret) {
    parts.push(`2FA: ${otpSecret}`);
    parts.push(`2FA.live: ${buildChatgpt2faLiveUrl(otpSecret)}`);
  }
  if (link) parts.push(`LINK: ${link}`);
  return parts.join(" | ");
};
const buildTeamMarketplaceExportLines = (account = {}) => {
  const username = String(account?.username || "").trim();
  const password = String(account?.password || "").trim();
  const otpSecret = String(account?.otpSecret || "").trim();
  const recoveryUrl = String(account?.recoveryUrl || "").trim();
  if (!username || !password) return [];

  const saleMode = normalizeTeamSaleMode(account?.saleMode);
  if (saleMode === "business") {
    const activeCustomers = getActiveTeamCustomers(account).length;
    if (activeCustomers > 0) return [];
    const parts = [`TK: ${username}`, `MK: ${password}`];
    if (otpSecret) {
      parts.push(`2FA: ${otpSecret}`);
      parts.push(`2FA.live: ${buildChatgpt2faLiveUrl(otpSecret)}`);
    }
    if (recoveryUrl) parts.push(`LINK: ${recoveryUrl}`);
    return [parts.join(" | ")];
  }

  const slots = normalizeTeamSlotsForUi(account?.slots);
  return slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => !slot?.gmail && slot?.status !== "active")
    .map(
      ({ index }) =>
        `Slot ${index + 1}|${username}|Ban gui kem gmail chinh chu de admin up`,
    );
};
const buildTeamBusinessCopyText = (account = {}) => {
  const lines = [
    "✅ Tài khoản GPT Team",
    `Email: ${account?.username || ""}`,
    `Pass: ${account?.password || ""}`,
  ];
  if (String(account?.otpSecret || "").trim()) {
    lines.push(buildChatgpt2faCopyText(account.otpSecret));
  }
  if (String(account?.recoveryUrl || "").trim()) {
    lines.push(`Link lấy mã: ${account.recoveryUrl}`);
  }
  return lines.join("\n");
};
const parseTeamImportTextToForm = (raw = "") => {
  const input = String(raw || "").trim();
  if (!input) return null;
  const lines = input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const sourceLine =
    lines.find((line) => line.includes("----")) ||
    lines.find((line) => line.includes("|")) ||
    input;
  const normalized = sourceLine.replace(/^team\s+/i, "").trim();
  let parts = [];
  if (normalized.includes("----")) {
    parts = normalized.split(/-{4,}/).map((s) => s.trim()).filter(Boolean);
  } else if (normalized.includes("|")) {
    parts = normalized.split("|").map((s) => s.trim()).filter(Boolean);
  } else {
    parts = normalized.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  }
  const email = parts[0] || "";
  const gptPass = parts[1] || "";
  const thirdPart = parts[2] || "";
  const fourthPart = parts[3] || "";
  const fifthPart = parts[4] || "";
  const fallbackRecoveryMatch = input.match(/https?:\/\/\S+/i);
  const recoveryMatch = input.match(/\[接收验证码的地址\](.*)/);
  const otpSecret = !/^https?:\/\//i.test(thirdPart) && thirdPart ? thirdPart : "";
  const recoveryUrl =
    fifthPart ||
    fourthPart ||
    (/^https?:\/\//i.test(thirdPart) ? thirdPart : "") ||
    (fallbackRecoveryMatch ? fallbackRecoveryMatch[0].trim() : "") ||
    (recoveryMatch ? recoveryMatch[1].trim() : "");

  if (!email || !gptPass) return null;
  return buildTeamFormState({
    username: email,
    password: gptPass,
    otpSecret,
    recoveryUrl,
    expiredAt: getDefaultOneMonthDateInput(),
  });
};
const normalizeTeamAccountForUi = (account = {}) => {
  const { emailPassword, ...rest } = account || {};
  return {
    ...rest,
    saleMode: normalizeTeamSaleMode(rest.saleMode),
    warehouse: normalizeTeamWarehouse(rest.warehouse),
    slots: normalizeTeamSlotsForUi(rest.slots),
  };
};
const DURATION_MONTHS_MAP = {
  "1M": 1,
  "2M": 2,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};
const EXTEND_DURATION_OPTIONS = [
  { value: "1M", label: "1 Tháng" },
  { value: "2M", label: "2 Tháng" },
  { value: "3M", label: "3 Tháng" },
  { value: "6M", label: "6 Tháng" },
  { value: "1Y", label: "1 Năm" },
];
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
const addDurationToDate = (dateInput, duration = "1M") => {
  const normalizedDuration = String(duration || "1M").toUpperCase();
  const months = DURATION_MONTHS_MAP[normalizedDuration];
  if (!months) return new Date(dateInput);
  return addMonthsClamped(dateInput, months);
};
const getDurationLabel = (duration = "1M") =>
  EXTEND_DURATION_OPTIONS.find((option) => option.value === duration)?.label || duration;
const CUSTOMER_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả" },
  { value: "with", label: "Có khách" },
  { value: "without", label: "Không khách" },
];
const EXPIRY_FILTER_OPTIONS = [
  { value: "all", label: "Tat ca han" },
  { value: "expired", label: "Da het han" },
  { value: "under_15", label: "Duoi 15" },
  { value: "15_20", label: "15-20" },
  { value: "20_25", label: "20-25" },
  { value: "25_31", label: "25-31" },
  { value: "no_expiry", label: "Khong co han" },
];
const getAccountUsers = (account = {}) =>
  Array.isArray(account?.users) ? account.users : [];
const hasAssignedCustomer = (account = {}) =>
  getAccountUsers(account).some((user) => {
    if (typeof user === "string") return String(user).trim().length > 0;
    if (user && typeof user === "object") {
      return String(user.name || "").trim().length > 0;
    }
    return false;
  });
const hasAssignedTeamCustomer = (account = {}) =>
  getActiveTeamCustomers(account).length > 0;
const matchesCustomerFilter = (hasCustomer, filterValue = "all") => {
  if (filterValue === "with") return hasCustomer;
  if (filterValue === "without") return !hasCustomer;
  return true;
};
const getAccountDaysRemaining = (account = {}) => {
  if (!account?.expiredAt) return null;
  const expiresAt = new Date(account.expiredAt);
  if (Number.isNaN(expiresAt.getTime())) return null;
  return Math.ceil((expiresAt - new Date()) / 86400000);
};
const matchesExpiryFilter = (daysRemaining, filterValue = "all") => {
  if (filterValue === "all") return true;
  if (filterValue === "no_expiry") return daysRemaining === null;
  if (daysRemaining === null) return false;
  if (filterValue === "expired") return daysRemaining <= 0;
  if (filterValue === "under_15") return daysRemaining >= 1 && daysRemaining < 15;
  if (filterValue === "15_20") return daysRemaining >= 15 && daysRemaining <= 20;
  if (filterValue === "20_25") return daysRemaining >= 20 && daysRemaining <= 25;
  if (filterValue === "25_31") return daysRemaining >= 25 && daysRemaining <= 31;
  return true;
};
const normalizeExpiryRangeInput = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};
const matchesExpiryRange = (daysRemaining, minValue = "", maxValue = "") => {
  const min = normalizeExpiryRangeInput(minValue);
  const max = normalizeExpiryRangeInput(maxValue);
  if (min === null && max === null) return true;
  if (daysRemaining === null) return false;
  if (min !== null && daysRemaining < min) return false;
  if (max !== null && daysRemaining > max) return false;
  return true;
};
const getExpiryRemainingLabel = (dateInput) => {
  if (!dateInput) return null;
  const daysRemaining = getAccountDaysRemaining({ expiredAt: dateInput });
  if (daysRemaining === null) return null;
  if (daysRemaining <= 0) return { text: `Da het han ${Math.abs(daysRemaining)} ngay`, className: "text-red-400" };
  if (daysRemaining <= 7) return { text: `Con ${daysRemaining} ngay`, className: "text-yellow-400" };
  return { text: `Con ${daysRemaining} ngay`, className: "text-emerald-400" };
};
const createApiRequestLabel = (detail = {}) => {
  const customLabel = String(detail?.label || "").trim();
  if (customLabel) return customLabel;
  const url = String(detail?.url || "").toLowerCase();
  const method = String(detail?.method || "GET").toUpperCase();
  if (url.includes("/api/data")) return "Đang tải lại dữ liệu";
  if (url.includes("/api/login")) return "Đang đăng nhập";
  if (url.includes("/team-move-slot")) return "Đang chuyển khách Team";
  if (url.includes("/move-user")) return "Đang chuyển khách";
  if (url.includes("/extend-user")) return "Đang gia hạn";
  if (url.includes("/proxy-sheet")) return "Đang đồng bộ Google Sheet";
  if (url.includes("/datammo")) return "Đang xử lý Datammo";
  if (method === "POST") return "Đang tạo dữ liệu";
  if (method === "PUT") return "Đang cập nhật dữ liệu";
  if (method === "DELETE") return "Đang xóa dữ liệu";
  return "Đang xử lý API";
};
const getRequestProgressFromState = (request = {}) => {
  const explicitPercent = Number(request.percent);
  if (Number.isFinite(explicitPercent) && explicitPercent >= 0) {
    return Math.max(0, Math.min(100, explicitPercent));
  }
  if (request.completedAt) {
    return 100;
  }
  return null;
};
const buildApiOverlayState = (requestsMap) => {
  const requests = Array.from(requestsMap.values());
  const activeRequests = requests.filter((item) => !item.completedAt);
  const currentRequests = activeRequests.length > 0 ? activeRequests : requests;
  if (currentRequests.length === 0) {
    return {
      visible: false,
      progress: 0,
      indeterminate: false,
      title: "",
      detail: "",
      requestCount: 0,
    };
  }
  const progressValues = currentRequests
    .map((request) => getRequestProgressFromState(request))
    .filter((value) => Number.isFinite(value));
  const hasIndeterminateActiveRequest = activeRequests.some(
    (request) => !Number.isFinite(getRequestProgressFromState(request)),
  );
  const progress =
    progressValues.length > 0
      ? progressValues.reduce((sum, value) => sum + value, 0) /
        progressValues.length
      : null;
  const primaryRequest = currentRequests[currentRequests.length - 1];
  const detail =
    currentRequests.length > 1
      ? `Đang chạy ${currentRequests.length} tác vụ API`
      : primaryRequest.phase === "download"
        ? "Đang nhận dữ liệu từ server"
        : primaryRequest.phase === "upload"
          ? "Đang gửi dữ liệu lên server"
          : "Vui lòng chờ hoàn tất rồi thao tác tiếp";
  return {
    visible: true,
    progress:
      progress === null
        ? null
        : Math.max(1, Math.min(100, Math.round(progress))),
    indeterminate: hasIndeterminateActiveRequest || progress === null,
    title: createApiRequestLabel(primaryRequest),
    detail,
    requestCount: currentRequests.length,
  };
};
const getRecordUpdatedAt = (record = {}) => String(record?.updatedAt || "").trim();
const withExpectedUpdatedAt = (payload = {}, record = {}) => {
  const expectedUpdatedAt = getRecordUpdatedAt(record);
  if (!expectedUpdatedAt) return { ...(payload || {}) };
  return {
    ...(payload || {}),
    expectedUpdatedAt,
  };
};
const buildMoveExpectedPayload = (payload = {}, fromRecord = {}, toRecord = {}) => {
  return { ...(payload || {}) };
};
const getApiErrorMessage = (error, fallback) =>
  error?.response?.data?.error || error?.message || fallback;

function App() {
  // LOGIN STATE
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  const [accounts, setAccounts] = useState([]);
  const [netflixAccounts, setNetflixAccounts] = useState([]);
  const [canvaAccounts, setCanvaAccounts] = useState([]);
  const [capcutAccounts, setCapcutAccounts] = useState([]);
  const [teamAccounts, setTeamAccounts] = useState([]);
  const [datammoWarrantyCases, setDatammoWarrantyCases] = useState([]);
  const [datammoOrderHistory, setDatammoOrderHistory] = useState([]);
  const [showTeamAddModal, setShowTeamAddModal] = useState(false);
  const [showTeamEditModal, setShowTeamEditModal] = useState(false);
  const [teamAddForm, setTeamAddForm] = useState(buildTeamFormState());
  const [teamEditForm, setTeamEditForm] = useState(buildTeamEditFormState());
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotTarget, setSlotTarget] = useState({ accId: null, slotIdx: null, slot: null });
  const [slotFormGmail, setSlotFormGmail] = useState("");
  const [slotFormName, setSlotFormName] = useState("");
  const [slotFormExp, setSlotFormExp] = useState("");
  const [slotFormExpiredAt, setSlotFormExpiredAt] = useState("");
  const [teamImportText, setTeamImportText] = useState("");

  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendData, setExtendData] = useState(null);
  const [extendDaysOption, setExtendDaysOption] = useState("1M");

  const [showImportTeamModal, setShowImportTeamModal] = useState(false);
  const [showSimpleAddModal, setShowSimpleAddModal] = useState(false);
  const [simpleAddPlatform, setSimpleAddPlatform] = useState("netflix");
  const [simpleAddForm, setSimpleAddForm] = useState({ username: "", password: "", duration: "1M", note: "", customerName: "" });
  const [loading, setLoading] = useState(false);
  const [apiOverlay, setApiOverlay] = useState({
    visible: false,
    progress: 0,
    indeterminate: false,
    title: "",
    detail: "",
    requestCount: 0,
  });
  const [activeTab, setActiveTab] = useState("chatgpt");
  const [gptSubTab, setGptSubTab] = useState("all");
  const [chatgptTotalTypeTab, setChatgptTotalTypeTab] = useState("all");
  const [package2ShelfTab, setPackage2ShelfTab] = useState("all");
  const [soldPackage2ProviderFilter, setSoldPackage2ProviderFilter] =
    useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedChatgptAccountId, setHighlightedChatgptAccountId] =
    useState("");
  const [highlightedTeamAccountId, setHighlightedTeamAccountId] = useState("");
  const [chatgptCustomerFilter, setChatgptCustomerFilter] = useState("all");
  const [chatgptExpiryFilter, setChatgptExpiryFilter] = useState("all");
  const [chatgptExpiryMin, setChatgptExpiryMin] = useState("");
  const [chatgptExpiryMax, setChatgptExpiryMax] = useState("");
  const [marketplaceOrderQuery, setMarketplaceOrderQuery] = useState("");
  const [marketplaceOrderProviderFilter, setMarketplaceOrderProviderFilter] =
    useState("all");
  const [teamMarketplaceOrderQuery, setTeamMarketplaceOrderQuery] =
    useState("");
  const [teamMarketplaceOrderProviderFilter, setTeamMarketplaceOrderProviderFilter] =
    useState("all");
  const [teamCustomerFilter, setTeamCustomerFilter] = useState("all");
  const [teamExpiryFilter, setTeamExpiryFilter] = useState("all");
  const [teamExpiryMin, setTeamExpiryMin] = useState("");
  const [teamExpiryMax, setTeamExpiryMax] = useState("");
  const [teamWarehouseTab, setTeamWarehouseTab] = useState("all");
  const [teamTotalTypeTab, setTeamTotalTypeTab] = useState("all");
  const [simpleCustomerFilter, setSimpleCustomerFilter] = useState("all");
  const [simpleExpiryFilter, setSimpleExpiryFilter] = useState("all");
  const [simpleExpiryMin, setSimpleExpiryMin] = useState("");
  const [simpleExpiryMax, setSimpleExpiryMax] = useState("");

  // Loading states for buttons

  const [showAssignUserModal, setShowAssignUserModal] = useState(false);
  const [showSimpleEditModal, setShowSimpleEditModal] = useState(false);
  const [simpleEditForm, setSimpleEditForm] = useState({ id: "", username: "", password: "", duration: "1M", note: "", expiredAt: "", updatedAt: "" });
  const [assignUserAcc, setAssignUserAcc] = useState(null);
  const [assignUserName, setAssignUserName] = useState("");
  const [loadingStates, setLoadingStates] = useState({
    addUser: false,
    editUser: false,
    deleteUser: false,
    moveUser: false,
    extendUser: false,
    bulkWarehouseMove: false,
    addAccount: false,
    editAccount: false,
    deleteAccount: false,
    warranty: false,
    teamMode: {},
    changeTeamWarehouse: {},
    changeType: {},
    changeShelf: {},
  });

  // BroadcastChannel for real-time sync between tabs
  const channelRef = useRef(null);
  const dataVersionRef = useRef(0);
  const isFetchingDataRef = useRef(false);
  const fetchDataPromiseRef = useRef(null);
  const seenDatammoOrderKeysRef = useRef(null);
  const hasInitializedDatammoOrdersRef = useRef(false);
  const apiRequestsRef = useRef(new Map());

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImportGPTModal, setShowImportGPTModal] = useState(false);
  const [showWarrantyModal, setShowWarrantyModal] = useState(false);
  const [warrantySourceAcc, setWarrantySourceAcc] = useState(null);
  const [warrantySourceScope, setWarrantySourceScope] = useState("chatgpt");
  const [warrantyReplacementId, setWarrantyReplacementId] = useState("");
  const [warrantyReason, setWarrantyReason] = useState("");
  const [warrantyReplacementSearch, setWarrantyReplacementSearch] = useState("");
  const [warrantyWarehouseFilter, setWarrantyWarehouseFilter] = useState("all");
  const [selectedChatgptIds, setSelectedChatgptIds] = useState([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  // CUSTOM ALERT & CONFIRM MODAL
  const [alertInfo, setAlertInfo] = useState({
    show: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: null,
  });

  // TOAST MSG
  const [toastMessage, setToastMessage] = useState("");
  const [recentDatammoOrders, setRecentDatammoOrders] = useState([]);

  // User Input Modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalMode, setUserModalMode] = useState("add");
  const [currentUserData, setCurrentUserData] = useState({
    accId: null,
    index: null,
    name: "",
    joinedAt: null,
    expiredAt: null,
  });
  const userExpiryPreview = getExpiryRemainingLabel(currentUserData.expiredAt);

  // Move User State
  const [showMoveUserModal, setShowMoveUserModal] = useState(false);
  const [showMoveSlotModal, setShowMoveSlotModal] = useState(false);
  const [movingUser, setMovingUser] = useState(null);
  const [movingSlot, setMovingSlot] = useState(null); // { fromAccId, userIndex, name, joinedAt }
  const [destinationAccId, setDestinationAccId] = useState("");
  const [moveDestinationSearch, setMoveDestinationSearch] = useState("");
  const [moveSlotDestinationSearch, setMoveSlotDestinationSearch] = useState("");

  // Orphaned Users Modal (when deleting account with active users)
  const [showOrphanedUsersModal, setShowOrphanedUsersModal] = useState(false);
  const [orphanedUsers, setOrphanedUsers] = useState([]);

  // Orphaned Slots Modal (when deleting team account with active slots)
  const [showOrphanedSlotsModal, setShowOrphanedSlotsModal] = useState(false);
  const [orphanedSlots, setOrphanedSlots] = useState([]);

  // Import State
  const [importingSheet, setImportingSheet] = useState(false);
  const [importStatus, setImportStatus] = useState(null);

  // Edit/Delete States
  const [editingAcc, setEditingAcc] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [newAcc, setNewAcc] = useState({
    username: "",
    password: "",
    otpSecret: "",
    link: "",
    type: "unassigned",
    package2Shelf: "none",
    note: "",
  });

  const refreshApiOverlay = () => {
    setApiOverlay(buildApiOverlayState(apiRequestsRef.current));
  };

  useEffect(() => {
    const updateOverlayFromActivity = (event) => {
      const detail = event?.detail || {};
      const requestId = String(detail.requestId || "");
      if (!requestId) return;

      if (detail.type === "start") {
        apiRequestsRef.current.set(requestId, {
          requestId,
          method: detail.method,
          url: detail.url,
          label: detail.label,
          phase: "start",
          startedAt: Date.now(),
        });
      } else if (detail.type === "progress") {
        const existing = apiRequestsRef.current.get(requestId);
        if (!existing) return;
        const loaded = Number(detail.loaded || 0);
        const total = Number(detail.total || 0);
        const rawPercent =
          total > 0 ? Math.round((loaded / total) * 100) : Number.NaN;
        const progressPercent = Number.isFinite(rawPercent)
          ? Math.max(existing.percent || 0, Math.min(99, rawPercent))
          : existing.percent;
        apiRequestsRef.current.set(requestId, {
          ...existing,
          phase: detail.phase || existing.phase,
          percent: progressPercent,
        });
      } else if (detail.type === "finish") {
        const existing = apiRequestsRef.current.get(requestId);
        if (!existing) return;
        apiRequestsRef.current.set(requestId, {
          ...existing,
          phase: detail.ok === false ? "error" : "complete",
          percent: 100,
          completedAt: Date.now(),
        });
        setTimeout(() => {
          apiRequestsRef.current.delete(requestId);
          refreshApiOverlay();
        }, 260);
      }

      refreshApiOverlay();
    };

    const unsubscribe = subscribeToApiActivity(updateOverlayFromActivity);

    return () => {
      unsubscribe();
      apiRequestsRef.current.clear();
    };
  }, []);

  // CHECK LOGIN ON LOAD - Verify token from localStorage
  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    const expiresAt = localStorage.getItem("token_expires_at");

    if (token && expiresAt) {
      // Check if token is still valid
      const expiryTime = new Date(expiresAt).getTime();
      const now = Date.now();

      if (now < expiryTime) {
        // Token still valid
        setIsAuthenticated(true);
        setTimeout(() => fetchData(true), 100);
      } else {
        // Token expired, clear storage
        localStorage.removeItem("admin_token");
        localStorage.removeItem("token_expires_at");
        showAlert(
          "Phiên hết hạn",
          "Token đã hết hạn. Vui lòng đăng nhập lại.",
          "error",
        );
      }
    }
  }, []);

  // Serverless-friendly auto-sync:
  // poll lightweight data version endpoint instead of long-lived SSE connections.
  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;

    const checkDataVersion = async () => {
      if (document.hidden) return;
      try {
        const response = await axios.get("/api/data-version", {
          timeout: 8000,
          skipGlobalLoading: true,
        });
        const nextVersion = Number(response?.data?.version || 0);
        if (!Number.isFinite(nextVersion) || nextVersion <= 0) return;

        if (!dataVersionRef.current) {
          dataVersionRef.current = nextVersion;
          return;
        }

        if (nextVersion > dataVersionRef.current && isMounted) {
          dataVersionRef.current = nextVersion;
          fetchData(false);
        }
      } catch (e) {
        // Ignore transient poll errors. Next cycle will retry.
      }
    };

    checkDataVersion();
    const interval = setInterval(checkDataVersion, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Backward-compatible helper for cases calling it manually.
  const broadcastDataChange = () => { };

  // REFRESH when tab becomes visible
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAuthenticated]);

  useEffect(() => {
    const validIds = new Set(accounts.map((acc) => acc.id));
    setSelectedChatgptIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [accounts]);

  useEffect(() => {
    const validIds = new Set(teamAccounts.map((acc) => String(acc?.id || "")));
    setSelectedTeamIds((prev) =>
      prev.filter((id) => validIds.has(String(id || ""))),
    );
  }, [teamAccounts]);

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      // Backend authentication
      const response = await axios.post(
        "/api/login",
        {
          email: loginForm.email.toLowerCase(),
          password: loginForm.password,
        },
        { requestLabel: "Đang đăng nhập" },
      );

      if (response.data.success) {
        localStorage.setItem("admin_token", response.data.token);
        localStorage.setItem("token_expires_at", response.data.expiresAt);
        setIsAuthenticated(true);
        fetchData(true);
        showAlert(
          "Xin chào",
          response.data.message || "Đăng nhập thành công! 👋",
          "success",
        );
      } else {
        showAlert("Lỗi", "Sai email hoặc mật khẩu!", "error");
      }
    } catch (error) {
      if (error.response?.status === 401) {
        showAlert(
          "Lỗi",
          error.response?.data?.message || "Sai email hoặc mật khẩu!",
          "error",
        );
      } else {
        showAlert("Lỗi", "Không thể kết nối đến server!", "error");
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    setIsAuthenticated(false);
    setLoginForm({ email: "", password: "" });
    setRecentDatammoOrders([]);
    seenDatammoOrderKeysRef.current = null;
    hasInitializedDatammoOrdersRef.current = false;
  };

  // HELPER SHOW ALERT / CONFIRM
  const showAlert = (title, message, type = "info") => {
    setAlertInfo({ show: true, title, message, type, onConfirm: null });
  };

  const showConfirm = (title, message, onConfirmAction) => {
    setAlertInfo({
      show: true,
      title,
      message,
      type: "confirm",
      onConfirm: onConfirmAction,
    });
  };

  const closeAlert = () => {
    setAlertInfo({ ...alertInfo, show: false, onConfirm: null });
  };

  const executeConfirm = () => {
    if (alertInfo.onConfirm) alertInfo.onConfirm();
    closeAlert();
  };

  // Helper to safely get user name
  const getUserName = (u) => (typeof u === "object" && u !== null ? u.name : u);
  const getDefaultOneMonthDateInput = () => {
    return addDurationToDate(new Date(), "1M").toISOString().split("T")[0];
  };
  const renderCustomerFilterButtons = (value, onChange) => (
    <div className="flex flex-wrap gap-2">
      {CUSTOMER_FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
            value === option.value
              ? "bg-blue-600 text-white border-blue-500"
              : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const renderExpiryFilterSelect = (value, onChange) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[128px] bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
    >
      {EXPIRY_FILTER_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const renderExpiryRangeInputs = (minValue, onMinChange, maxValue, onMaxChange) => (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min="0"
        inputMode="numeric"
        value={minValue}
        onChange={(e) => onMinChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="Tu ngay"
        className="w-24 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
      />
      <span className="text-slate-500 text-xs font-bold uppercase tracking-wide">den</span>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        value={maxValue}
        onChange={(e) => onMaxChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="Den ngay"
        className="w-24 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
      />
      {(minValue || maxValue) && (
        <button
          type="button"
          onClick={() => { onMinChange(""); onMaxChange(""); }}
          className="text-xs px-2.5 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white font-bold"
        >
          Xoa
        </button>
      )}
    </div>
  );
  const handleExpiryPresetChange = (nextValue, setFilter, setMin, setMax) => {
    setFilter(nextValue);
    setMin("");
    setMax("");
  };
  const handleExpiryRangeChange = (nextValue, setter, setFilter) => {
    setFilter("all");
    setter(nextValue);
  };
  // Helper to get joined date display
  const getUserDate = (u) => {
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const date = new Date(u.joinedAt);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
      } catch (e) {
        return "";
      }
    }
    return "";
  };

  // Helper to calculate days used
  const getDaysUsed = (u) => {
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const start = new Date(u.joinedAt);
        const now = new Date();
        const diffTime = now - start;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
      } catch (e) {
        return 0;
      }
    }
    return null;
  };

  // Helper to calculate days remaining (positive = còn hạn, âm = đã quá hạn)
  const getDaysRemaining = (u, accDuration = "1M") => {
    if (typeof u === "object" && u !== null && u.expiredAt) {
      try {
        return Math.ceil((new Date(u.expiredAt) - new Date()) / 86400000);
      } catch (e) { }
    }
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const expiryDate = addDurationToDate(u.joinedAt, accDuration);
        return Math.ceil((expiryDate - new Date()) / 86400000);
      } catch (e) { }
    }
    return null;
  };

  // Helper: tính ngày hết hạn của khách = expiredAt OR joinedAt + duration
  const getUserExpiryDate = (u, accDuration = "1M") => {
    if (typeof u === "object" && u !== null) {
      if (u.expiredAt) {
        return formatDate(u.expiredAt);
      }
      if (u.joinedAt) {
        try {
          const d = addDurationToDate(u.joinedAt, accDuration);
          return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        } catch (e) { return ""; }
      }
    }
    return "";
  };

  // Helper to format Date
  const formatDate = (isoString) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    } catch (e) {
      return "";
    }
  };

  // Helper to check expiry warning
  const getExpiryStatus = (isoString) => {
    if (!isoString) return { text: "", color: "text-slate-500", isExpired: false, dateStr: "" };
    const expDate = new Date(isoString);

    const now = new Date();
    const diffTime = expDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const dateStr = `${expDate.getDate()}/${expDate.getMonth() + 1}/${expDate.getFullYear()}`;

    if (diffDays <= 0)
      return {
        text: `Đã hết hạn ${Math.abs(diffDays)} ngày`,
        color: "text-red-500 font-bold",
        isExpired: true,
        dateStr,
      };
    if (diffDays <= 3)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-red-400 font-bold",
        isExpired: false,
        dateStr,
      };
    if (diffDays <= 7)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-yellow-400 font-bold",
        isExpired: false,
        dateStr,
      };
    return {
      text: `Còn ${diffDays} ngày`,
      color: "text-emerald-500",
      isExpired: false,
      dateStr,
    };
  };

  const syncDatammoOrderBanner = (orders = []) => {
    const normalizedOrders = normalizeDatammoOrders(orders);
    if (!seenDatammoOrderKeysRef.current) {
      seenDatammoOrderKeysRef.current = loadSeenDatammoOrderKeys();
    }

    const seenKeys = seenDatammoOrderKeysRef.current;
    const allKeys = normalizedOrders.map((order) => buildDatammoOrderKey(order));
    const recentUnseenOrders = normalizedOrders.filter((order) => {
      const orderKey = buildDatammoOrderKey(order);
      const createdAtMs = new Date(order?.createdAt || 0).getTime();
      if (seenKeys.has(orderKey)) return false;
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return false;
      return Date.now() - createdAtMs <= DATAMMO_RECENT_ORDER_WINDOW_MS;
    });

    if (!hasInitializedDatammoOrdersRef.current) {
      if (recentUnseenOrders.length > 0) {
        setRecentDatammoOrders(recentUnseenOrders.slice(0, 5));
      }
      if (seenKeys.size === 0 && allKeys.length > 0) {
        allKeys.forEach((key) => seenKeys.add(key));
        persistSeenDatammoOrderKeys(seenKeys);
      } else if (recentUnseenOrders.length > 0) {
        recentUnseenOrders.forEach((order) =>
          seenKeys.add(buildDatammoOrderKey(order)),
        );
        persistSeenDatammoOrderKeys(seenKeys);
      }
      hasInitializedDatammoOrdersRef.current = true;
      return;
    }

    const freshOrders = normalizedOrders.filter(
      (order) => !seenKeys.has(buildDatammoOrderKey(order)),
    );

    if (freshOrders.length === 0) return;

    freshOrders.forEach((order) => seenKeys.add(buildDatammoOrderKey(order)));
    persistSeenDatammoOrderKeys(seenKeys);
    setRecentDatammoOrders((prev) => {
      const merged = new Map();
      [...freshOrders, ...prev].forEach((order) => {
        merged.set(buildDatammoOrderKey(order), order);
      });
      return normalizeDatammoOrders(Array.from(merged.values())).slice(0, 5);
    });
  };

  const fetchData = async (showLoader = false) => {
    if (isFetchingDataRef.current && fetchDataPromiseRef.current) {
      return fetchDataPromiseRef.current;
    }
    isFetchingDataRef.current = true;
    const runFetch = (async () => {
      if (showLoader) setLoading(true);
      try {
        const res = await axios.get("/api/data", {
          timeout: 10000,
          headers: { "Cache-Control": "no-cache" },
          requestLabel: "Đang tải lại dữ liệu",
          skipGlobalLoading: !showLoader,
        });
        const nextVersion = Number(res.data?.version || 0);
        if (Number.isFinite(nextVersion) && nextVersion > 0) {
          dataVersionRef.current = nextVersion;
        }
        syncDatammoOrderBanner(res.data?.datammoOrders);
        if (res.data && res.data.chatgpt) {
          const typeOrder = { package1: 0, package2: 1, unassigned: 2 };
          const sortedGPT = [...res.data.chatgpt]
            .map((acc) => ({
              ...acc,
              package2Shelf: supportsChatgptMarketType(acc.type)
                ? normalizePackage2Shelf(acc.package2Shelf)
                : "none",
            }))
            .sort((a, b) => {
            const orderA = typeOrder[a.type] ?? 99;
            const orderB = typeOrder[b.type] ?? 99;
            if (orderA !== orderB) return orderA - orderB;
            return new Date(b.createdAt) - new Date(a.createdAt);
          });
          setAccounts(sortedGPT);
        } else {
          setAccounts([]);
        }
        const sortA = (arr) => [...(arr || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setNetflixAccounts(sortA(res.data?.netflix));
        setCanvaAccounts(sortA(res.data?.canva));
        setCapcutAccounts(sortA(res.data?.capcut));
        setTeamAccounts(
          sortA(res.data?.team).map((acc) => normalizeTeamAccountForUi(acc)),
        );
        setDatammoOrderHistory(
          normalizeDatammoOrders(res.data?.datammoOrders),
        );
        setDatammoWarrantyCases(
          normalizeDatammoWarrantyCases(res.data?.datammoWarrantyCases),
        );
      } catch (error) {
        if (showLoader) {
          showAlert("Lỗi", "Không thể tải dữ liệu. Vui lòng thử lại.", "error");
          setAccounts([]);
        }
      } finally {
        if (showLoader) setLoading(false);
        isFetchingDataRef.current = false;
        fetchDataPromiseRef.current = null;
      }
    })();
    fetchDataPromiseRef.current = runFetch;
    return runFetch;
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    setLoadingStates((prev) => ({ ...prev, addAccount: true }));
    try {
      await axios.post("/api/chatgpt", newAcc);
      setShowAddModal(false);
      setNewAcc({
        username: "",
        password: "",
        otpSecret: "",
        link: "",
        type: "unassigned",
        package2Shelf: "none",
        note: "",
      });
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Error", "Lỗi khi thêm tài khoản", "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, addAccount: false }));
    }
  };

  const openAddUserModal = (accId, prefillName = "") => {
    setUserModalMode("add");
    setCurrentUserData({ accId, index: null, name: prefillName, joinedAt: null, expiredAt: null });
    setShowUserModal(true);
  };

  const openEditUserModal = (accId, index, userData) => {
    setUserModalMode("edit");
    const name = getUserName(userData);
    const joinedAt =
      typeof userData === "object" && userData.joinedAt
        ? userData.joinedAt
        : null;
    const expiredAt =
      typeof userData === "object" && userData.expiredAt
        ? userData.expiredAt
        : null;
    setCurrentUserData({ accId, index, name, joinedAt, expiredAt });
    setShowUserModal(true);
  };

  const handleSubmitUser = async (e) => {
    e.preventDefault();
    const { accId, index, name, joinedAt, expiredAt } = currentUserData;
    if (!name.trim())
      return showAlert("Thông báo", "Tên không được để trống!", "warning");

    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return;

    let newUsers = [...(acc.users || [])];

    if (userModalMode === "add") {
      if (acc.type === "package1" && newUsers.length >= 3)
        return showAlert("Giới hạn", "Gói này đã đủ 3 Slot!", "warning");

      if (acc.type === "package2" && newUsers.length >= 1)
        return showAlert("Giới hạn", "Gói Private chỉ được 1 khách hàng!", "warning");

      newUsers.push({
        name: name.trim(),
        joinedAt: joinedAt || new Date().toISOString(),
        expiredAt: expiredAt || addDurationToDate(joinedAt || new Date(), "1M").toISOString(),
      });
    } else {
      const oldJoinDate =
        joinedAt ||
        (typeof newUsers[index] === "object" ? newUsers[index].joinedAt : null);
      newUsers[index] = {
        name: name.trim(),
        joinedAt: oldJoinDate,
        expiredAt: expiredAt || (typeof newUsers[index] === "object" ? newUsers[index].expiredAt : null),
      };
    }

    const loadingKey = userModalMode === "add" ? "addUser" : "editUser";
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      await axios.put(
        `/api/chatgpt/${accId}`,
        withExpectedUpdatedAt({ users: newUsers }, acc),
      );
      setShowUserModal(false);
      fetchData();
      broadcastDataChange();
    } catch (err) {
      showAlert("Lỗi", getApiErrorMessage(err, "Không lưu được khách hàng"), "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleDeleteUser = (accId, userIndex, userName) => {
    showConfirm(
      "Xác Nhận Xóa",
      `Bạn có chắc muốn xóa khách hàng: ${userName}?`,
      async () => {
        const acc = accounts.find((a) => a.id === accId);
        if (!acc) return;
        const newUsers = acc.users.filter((_, i) => i !== userIndex);
        setLoadingStates((prev) => ({ ...prev, deleteUser: true }));
        try {
          await axios.put(
            `/api/chatgpt/${accId}`,
            withExpectedUpdatedAt({ users: newUsers }, acc),
          );
          fetchData();
          broadcastDataChange();
        } catch (err) {
          showAlert("Lỗi", getApiErrorMessage(err, "Lỗi xóa khách"), "error");
        } finally {
          setLoadingStates((prev) => ({ ...prev, deleteUser: false }));
        }
      },
    );
  };

  // EXTEND USER / SLOT logic
  const handleExtendUser = (accId, userIndex, userObj, platform = "chatgpt") => {
    const userName = userObj?.name || userObj?.customerName || userObj || "khách này";
    let currentExpire = null;
    if (userObj?.expiredAt) {
      currentExpire = new Date(userObj.expiredAt).toLocaleDateString("vi-VN");
    }

    setExtendData({ accId, userIndex, platform, currentName: userName, currentExpire, userObj });
    setExtendDaysOption("1M");
    setShowExtendModal(true);
  };

  const handleSubmitExtend = async (e) => {
    e.preventDefault();
    if (!extendData) return;

    setLoadingStates((prev) => ({ ...prev, extendUser: true }));
    try {
      const extensionLabel = getDurationLabel(extendDaysOption);
      if (extendData.platform === "team") {
        // Team Account Slot Extension
        const teamAcc = teamAccounts.find(a => a.id === extendData.accId);
        if (!teamAcc) throw new Error("Team Account not found");
        const updSlots = [...teamAcc.slots];
        const slot = updSlots[extendData.userIndex];

        const now = new Date();
        const baseDate = slot.expiredAt && new Date(slot.expiredAt) > now ? new Date(slot.expiredAt) : now;
        const newExpiredAt = addDurationToDate(baseDate, extendDaysOption).toISOString();

        updSlots[extendData.userIndex] = { ...slot, expiredAt: newExpiredAt };
        await axios.put(
          `/api/team/${teamAcc.id}`,
          withExpectedUpdatedAt({ slots: updSlots }, teamAcc),
        );
      } else {
        // General Account Extension
        const extendAcc =
          extendData.platform === "chatgpt"
            ? accounts.find((acc) => acc.id === extendData.accId)
            : (
                {
                  netflix: netflixAccounts,
                  capcut: capcutAccounts,
                  canva: canvaAccounts,
                }[extendData.platform] || []
              ).find((acc) => acc.id === extendData.accId);
        await axios.post("/api/extend-user", {
          accId: extendData.accId,
          userIndex: extendData.userIndex,
          platform: extendData.platform,
          extDuration: extendDaysOption,
          expectedUpdatedAt: getRecordUpdatedAt(extendAcc),
        });
      }

      setShowExtendModal(false);
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã gia hạn thêm ${extensionLabel}!`, "success");
    } catch (error) {
      showAlert("Lỗi", getApiErrorMessage(error, "Không thể gia hạn"), "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, extendUser: false }));
    }
  };

  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    const originalAcc = accounts.find((a) => a.id === editingAcc.id);
    if (!originalAcc) return;

    if (
      originalAcc.type === "package1" &&
      (originalAcc.users?.length || 0) > 0
    ) {
      if (editingAcc.type !== "package1") {
        showAlert(
          "CHẶN SỬA ĐỔI",
          "⚠️ Gói 1 đang có khách. Không thể đổi gói khi chưa xóa khách!",
          "error",
        );
        return;
      }
    }

    setLoadingStates((prev) => ({ ...prev, editAccount: true }));
    try {
      await axios.put(
        `/api/chatgpt/${editingAcc.id}`,
        withExpectedUpdatedAt(editingAcc, originalAcc),
      );
      setShowEditModal(false);
      setEditingAcc(null);
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Lỗi", getApiErrorMessage(error, "Lỗi cập nhật"), "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, editAccount: false }));
    }
  };

  // MOVE USER LOGIC
  const openMoveUserModal = (accId, index, userData, platform = "chatgpt") => {
    if (platform === "chatgpt") {
      if (isDatammoManagedUser(userData)) {
        showAlert(
          "Khong the chuyen tay",
          "Acc da ban qua san khong duoc chuyen khach tay. Neu can doi acc, hay dung Bao hanh.",
          "warning",
        );
        return;
      }
    }
    setMovingUser({ fromAccId: accId, userIndex: index, platform, ...userData });
    setDestinationAccId("");
    setMoveDestinationSearch("");
    setShowMoveUserModal(true);
  };

  const handleSubmitMoveUser = async (e) => {
    e.preventDefault();
    if (!destinationAccId)
      return showAlert("Lỗi", "Chưa chọn tài khoản đích!", "warning");

    setLoadingStates((prev) => ({ ...prev, moveUser: true }));
    try {
      const fromRecord =
        movingUser.platform === "chatgpt"
          ? accounts.find((acc) => acc.id === movingUser.fromAccId)
          : (
              {
                netflix: netflixAccounts,
                capcut: capcutAccounts,
                canva: canvaAccounts,
              }[movingUser.platform] || []
            ).find((acc) => acc.id === movingUser.fromAccId);
      const toRecord =
        movingUser.platform === "chatgpt"
          ? accounts.find((acc) => acc.id === destinationAccId)
          : (
              {
                netflix: netflixAccounts,
                capcut: capcutAccounts,
                canva: canvaAccounts,
              }[movingUser.platform] || []
            ).find((acc) => acc.id === destinationAccId);
      if (movingUser.platform === "chatgpt") {
        await axios.post(
          "/api/move-user",
          buildMoveExpectedPayload(
            {
              fromAccId: movingUser.fromAccId,
              toAccId: destinationAccId,
              userIndex: movingUser.userIndex,
            },
            fromRecord,
            toRecord,
          ),
        );
      } else {
        await axios.post(
          "/api/simple-move-user",
          buildMoveExpectedPayload(
            {
              fromAccId: movingUser.fromAccId,
              toAccId: destinationAccId,
              platform: movingUser.platform,
            },
            fromRecord,
            toRecord,
          ),
        );
      }
      setShowMoveUserModal(false);
      setMovingUser(null);
      setMoveDestinationSearch("");
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã chuyển khách sang tài khoản mới!`, "success");
    } catch (error) {
      showAlert(
        "Lỗi",
        getApiErrorMessage(error, "Lỗi khi chuyển khách"),
        "error",
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, moveUser: false }));
    }
  };

  // TEAM MOVE SLOT LOGIC
  const openMoveSlotModal = (accId, slIndex, sData) => {
    setMovingSlot({ fromAccId: accId, slotIndex: slIndex, ...sData });
    setDestinationAccId("");
    setMoveSlotDestinationSearch("");
    setShowMoveSlotModal(true);
  };

  const handleSubmitMoveSlot = async (e) => {
    e.preventDefault();
    if (!destinationAccId) return showAlert("Lỗi", "Chưa chọn tài khoản đích!", "warning");

    setLoadingStates((prev) => ({ ...prev, moveUser: true }));
    try {
      const fromTeam = teamAccounts.find((acc) => acc.id === movingSlot.fromAccId);
      const toTeam = teamAccounts.find((acc) => acc.id === destinationAccId);
      await axios.post(
        "/api/team-move-slot",
        buildMoveExpectedPayload(
          {
            fromAccId: movingSlot.fromAccId,
            toAccId: destinationAccId,
            slotIndex: movingSlot.slotIndex,
          },
          fromTeam,
          toTeam,
        ),
      );
      setShowMoveSlotModal(false);
      setMovingSlot(null);
      setMoveSlotDestinationSearch("");
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã chuyển khách sang tài khoản Team khác!`, "success");
    } catch (error) {
      showAlert("Lỗi", getApiErrorMessage(error, "Lỗi khi chuyển slot"), "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, moveUser: false }));
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingId) return;

    // Check if account has active users (not expired)
    const accToDelete = accounts.find((a) => a.id === deletingId);

    if (accToDelete && accToDelete.users && accToDelete.users.length > 0) {
      const activeUsers = [];

      accToDelete.users.forEach((u, idx) => {
        // Check if user object has name (valid user)
        if (typeof u === "object" && u !== null && u.name) {
          const days = getDaysUsed(u);
          const daysRemaining = getDaysRemaining(u);

          // User còn hạn nếu:
          // - Có expiry còn thời hạn
          // - Hoặc không có joinedAt (mới thêm, chưa set ngày) -> coi như còn hạn
          const isActive =
            (daysRemaining !== null && daysRemaining > 0) ||
            u.joinedAt === null ||
            u.joinedAt === undefined;

          if (isActive) {
            activeUsers.push({
              ...u,
              fromAccId: accToDelete.id,
              userIndex: idx,
              accountUsername: accToDelete.username,
              daysUsed: days !== null ? days : 0,
              daysRemaining: daysRemaining !== null ? daysRemaining : null,
            });
          }
        }
      });

      if (activeUsers.length > 0) {
        // Có user còn hạn - không cho xóa, hiện modal
        setShowDeleteModal(false);
        setOrphanedUsers(activeUsers);
        setShowOrphanedUsersModal(true);
        return;
      }

      // Chỉ có users hết hạn hoặc không có users - cho phép xóa
    }

    // Không có user còn hạn - cho phép xóa (tự động xóa luôn cả expired users)
    setLoadingStates((prev) => ({ ...prev, deleteAccount: true }));
    try {
      await axios.delete(`/api/chatgpt/${deletingId}`, {
        data: withExpectedUpdatedAt({}, accToDelete),
      });
      setShowDeleteModal(false);
      setDeletingId(null);
      setShowEditModal(false);
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Lỗi", getApiErrorMessage(error, "Lỗi xóa tài khoản"), "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, deleteAccount: false }));
    }
  };

  const handleDeleteTeamAccount = (accId) => {
    const accToDelete = teamAccounts.find(a => a.id === accId);
    if (!accToDelete) return;

    const activeSlots = [];
    (accToDelete.slots || []).forEach((slot, idx) => {
      if (slot.status === "active") {
        const days = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
        if (days === null || days > 0) {
          activeSlots.push({
            ...slot,
            fromAccId: accId,
            originalIndex: idx,
            teamUsername: accToDelete.username
          });
        }
      }
    });

    if (activeSlots.length > 0) {
      setOrphanedSlots(activeSlots);
      setShowOrphanedSlotsModal(true);
      return;
    }

    showConfirm("Xóa Team Acc", `Bạn có chắc chắn muốn xóa tài khoản "${accToDelete.username}"?`, async () => {
      setLoadingStates((prev) => ({ ...prev, deleteAccount: true }));
      try {
        await axios.delete(`/api/team/${accId}`, {
          data: withExpectedUpdatedAt({}, accToDelete),
        });
        fetchData();
        broadcastDataChange();
        showAlert("Đã xóa", "Team account đã bị xóa.", "info");
      } catch (err) {
        showAlert("Lỗi", getApiErrorMessage(err, "Lỗi xóa team account"), "error");
      } finally {
        setLoadingStates((prev) => ({ ...prev, deleteAccount: false }));
      }
    });
  };

  const handleTypeChange = async (acc, newType) => {
    if (acc.type === "package1" && (acc.users?.length || 0) > 0) {
      if (newType !== "package1") {
        showAlert(
          "CHẶN THAO TÁC",
          "⚠️ Gói 1 đang có khách. Vui lòng xóa hết khách trước khi đổi gói!",
          "error",
        );
        setAccounts((prev) => [...prev]);
        const selectElement = document.getElementById(`select-type-${acc.id}`);
        if (selectElement) selectElement.value = "package1";
        return;
      }
    }

    if (acc.type === "package2" && (acc.users?.length || 0) > 0) {
      if (newType !== "package2") {
        showAlert(
          "CHẶN THAO TÁC",
          "⚠️ Gói Private đang có khách. Vui lòng xóa khách trước khi đổi gói!",
          "error",
        );
        setAccounts((prev) => [...prev]);
        const selectElement = document.getElementById(`select-type-${acc.id}`);
        if (selectElement) selectElement.value = "package2";
        return;
      }
    }
    setLoadingStates((prev) => ({
      ...prev,
      changeType: { ...prev.changeType, [acc.id]: true },
    }));
    try {
      const nextShelf = supportsChatgptMarketType(newType)
        ? normalizePackage2Shelf(acc.package2Shelf)
        : "none";
      await axios.put(
        `/api/chatgpt/${acc.id}`,
        withExpectedUpdatedAt(
          {
            type: newType,
            package2Shelf: nextShelf,
          },
          acc,
        ),
      );
      fetchData();
      broadcastDataChange();
    } catch (error) {
      const msg = error?.response?.data?.error || "Lỗi đổi gói";
      showAlert("Chặn Thao Tác", msg, "error");
      // Reset dropdown về giá trị gói cũ
      const selectElement = document.getElementById(`select-type-${acc.id}`);
      if (selectElement) selectElement.value = acc.type;
    } finally {
      setLoadingStates((prev) => ({
        ...prev,
        changeType: { ...prev.changeType, [acc.id]: false },
      }));
    }
  };

  const handlePackage2ShelfChange = async (acc, shelfValue) => {
    if (!supportsChatgptMarketType(acc.type)) return;
    if (loadingStates.changeShelf[acc.id] || loadingStates.changeType[acc.id]) {
      return;
    }
    if (marketplaceTrackedAccountIds.has(String(acc?.id || ""))) {
      showAlert(
        "Khong the chuyen kho",
        "Acc da ban qua san khong duoc doi kho tay. Neu can doi acc, hay dung Bao hanh.",
        "warning",
      );
      return;
    }
    const nextShelf = normalizePackage2Shelf(shelfValue);
    const currentShelf = normalizePackage2Shelf(acc.package2Shelf);
    if (currentShelf === nextShelf) return;
    if (hasAssignedCustomer(acc)) {
      showAlert(
        "Khong the chuyen kho",
        "Tai khoan dang co khach. Vui long xoa hoac chuyen khach truoc khi doi kho.",
        "warning",
      );
      return;
    }
    const daysLeft = acc?.expiredAt
      ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000)
      : null;
    if (
      nextShelf === "cheap" &&
      daysLeft !== null &&
      Number.isFinite(daysLeft) &&
      daysLeft <= 25
    ) {
      showAlert(
        "Khong the dua vao kho market",
        "Tai khoan duoi 25 ngay chi nen day sang kho duoi 25 ngay.",
        "warning",
      );
      return;
    }

    setLoadingStates((prev) => ({
      ...prev,
      changeShelf: { ...prev.changeShelf, [acc.id]: true },
    }));
    try {
      const response = await axios.put(
        `/api/chatgpt/${acc.id}`,
        withExpectedUpdatedAt(
          {
            package2Shelf: nextShelf,
          },
          acc,
        ),
      );
      const updatedAcc = response?.data?.account;
      if (updatedAcc?.id) {
        setAccounts((prev) =>
          prev.map((item) =>
            item.id === updatedAcc.id
              ? {
                ...item,
                ...updatedAcc,
                package2Shelf: normalizePackage2Shelf(updatedAcc.package2Shelf),
              }
              : item,
          ),
        );
      } else {
        await fetchData();
      }
      broadcastDataChange();
    } catch (error) {
      const msg = error?.response?.data?.error || "Lỗi đổi kệ gói 2";
      showAlert("Lỗi", msg, "error");
    } finally {
      setLoadingStates((prev) => ({
        ...prev,
        changeShelf: { ...prev.changeShelf, [acc.id]: false },
      }));
    }
  };

  const handleBulkWarehouseMove = (targetShelf) => {
    const nextShelf = normalizePackage2Shelf(targetShelf);
    if (loadingStates.bulkWarehouseMove) return;

    const selectedAccounts = accounts.filter((acc) =>
      selectedChatgptIds.includes(String(acc?.id || "")),
    );

    const unsupported = [];
    const soldAccounts = [];
    const occupiedAccounts = [];
    const nearExpiryAccounts = [];
    const unchangedAccounts = [];
    const targets = [];

    selectedAccounts.forEach((acc) => {
      const id = String(acc?.id || "");
      const label = acc?.username || id || "Khong ro acc";
      if (!supportsChatgptMarketType(acc?.type)) {
        unsupported.push(label);
        return;
      }
      if (marketplaceTrackedAccountIds.has(id)) {
        soldAccounts.push(label);
        return;
      }

      const currentShelf = normalizePackage2Shelf(acc?.package2Shelf);
      if (currentShelf === nextShelf) {
        unchangedAccounts.push(label);
        return;
      }

      const hasUsers = Array.isArray(acc?.users) && acc.users.length > 0;
      if (hasUsers) {
        occupiedAccounts.push(label);
        return;
      }

      const daysLeft = acc?.expiredAt
        ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000)
        : null;
      if (
        nextShelf === "cheap" &&
        daysLeft !== null &&
        Number.isFinite(daysLeft) &&
        daysLeft <= 25
      ) {
        nearExpiryAccounts.push(label);
        return;
      }

      targets.push(acc);
    });

      const targetLabel =
        nextShelf === "cheap"
          ? "Kho market"
          : nextShelf === "main"
            ? "Kho duoi 25 ngay"
            : "Kho tong";
    if (targets.length === 0) {
      const reasons = [];
      if (unsupported.length) reasons.push(`Khong dung loai: ${unsupported.length}`);
      if (soldAccounts.length) reasons.push(`Da ban: ${soldAccounts.length}`);
      if (occupiedAccounts.length) reasons.push(`Dang co khach: ${occupiedAccounts.length}`);
      if (nearExpiryAccounts.length) reasons.push(`Duoi 25 ngay: ${nearExpiryAccounts.length}`);
      if (unchangedAccounts.length) reasons.push(`Da o ${targetLabel}: ${unchangedAccounts.length}`);
      showAlert(
        "Khong co acc hop le",
        reasons.length > 0
          ? reasons.join("\n")
          : "Hay chon tai khoan hop le de chuyen kho.",
        "warning",
      );
      return;
    }

    showConfirm(
      "Chuyen kho nhanh",
      `Se chuyen ${targets.length} tai khoan da chon sang ${targetLabel}.`,
      async () => {
        setLoadingStates((prev) => ({ ...prev, bulkWarehouseMove: true }));
        const updatedMap = new Map();
        const failedLabels = [];
        let success = 0;
        let failed = 0;

        try {
          for (const acc of targets) {
            try {
              const response = await axios.put(
                `/api/chatgpt/${acc.id}`,
                withExpectedUpdatedAt(
                  {
                    package2Shelf: nextShelf,
                  },
                  acc,
                ),
                {
                  requestLabel: `Dang chuyen sang ${targetLabel}`,
                  skipGlobalLoading: true,
                },
              );
              const updatedAcc = response?.data?.account;
              if (updatedAcc?.id) {
                updatedMap.set(String(updatedAcc.id), {
                  ...acc,
                  ...updatedAcc,
                  package2Shelf: normalizePackage2Shelf(updatedAcc.package2Shelf),
                });
              }
              success += 1;
            } catch (error) {
              failed += 1;
              failedLabels.push(
                `${acc.username || acc.id}: ${getApiErrorMessage(
                  error,
                  "Khong the cap nhat kho",
                )}`,
              );
            }
          }

          if (updatedMap.size > 0) {
            setAccounts((prev) =>
              prev.map((acc) => updatedMap.get(String(acc.id || "")) || acc),
            );
          } else {
            await fetchData();
          }

          if (updatedMap.size !== targets.length) {
            await fetchData();
          }

          setSelectedChatgptIds((prev) =>
            prev.filter((id) => !updatedMap.has(String(id || ""))),
          );
          broadcastDataChange();

          const skippedLines = [];
          if (soldAccounts.length) skippedLines.push(`Da bo qua acc da ban: ${soldAccounts.length}`);
          if (occupiedAccounts.length) skippedLines.push(`Da bo qua acc dang co khach: ${occupiedAccounts.length}`);
          if (nearExpiryAccounts.length) skippedLines.push(`Da bo qua acc duoi 25 ngay: ${nearExpiryAccounts.length}`);
          if (unsupported.length) skippedLines.push(`Da bo qua acc sai loai: ${unsupported.length}`);
          if (unchangedAccounts.length) skippedLines.push(`Da bo qua acc da o ${targetLabel}: ${unchangedAccounts.length}`);
          const failedPreview = failedLabels.slice(0, 5);
          const hiddenFailed = Math.max(0, failedLabels.length - failedPreview.length);
          if (hiddenFailed > 0) {
            failedPreview.push(`... va ${hiddenFailed} loi khac`);
          }

          showAlert(
            failed === 0 ? "Chuyen kho xong" : "Chuyen kho xong nhung co loi",
            [
              `Thanh cong: ${success}`,
              `That bai: ${failed}`,
              ...skippedLines,
              ...failedPreview,
            ].join("\n"),
            failed === 0 ? "success" : "warning",
          );
        } finally {
          setLoadingStates((prev) => ({ ...prev, bulkWarehouseMove: false }));
        }
      },
    );
  };

  const handleToggleChatgptSelection = (accId, checked) => {
    const id = String(accId || "");
    if (!id) return;
    setSelectedChatgptIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const handleToggleSelectAllFilteredChatgpt = (
    checked,
    filteredAccountIds = [],
  ) => {
    const ids = Array.isArray(filteredAccountIds)
      ? filteredAccountIds
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      : [];
    setSelectedChatgptIds((prev) => {
      const selected = new Set(prev);
      if (checked) {
        ids.forEach((id) => selected.add(id));
      } else {
        ids.forEach((id) => selected.delete(id));
      }
      return Array.from(selected);
    });
  };

  const handleToggleTeamSelection = (accId, checked) => {
    const id = String(accId || "");
    if (!id) return;
    setSelectedTeamIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const handleToggleSelectAllFilteredTeam = (checked, filteredAccountIds = []) => {
    const ids = Array.isArray(filteredAccountIds)
      ? filteredAccountIds
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      : [];
    setSelectedTeamIds((prev) => {
      const selected = new Set(prev);
      if (checked) {
        ids.forEach((id) => selected.add(id));
      } else {
        ids.forEach((id) => selected.delete(id));
      }
      return Array.from(selected);
    });
  };

  const handleCopySelectedChatgptMarketplaceFormat = () => {
    const lines = accounts
      .filter((acc) => selectedChatgptIds.includes(String(acc?.id || "")))
      .map((acc) => buildChatgptMarketplaceExportLine(acc))
      .filter(Boolean);

    if (lines.length === 0) {
      showAlert("Khong co du lieu", "Khong co acc hop le de copy format web.", "warning");
      return;
    }

    handleCopy(lines.join("\n"), `Da copy ${lines.length} dong format web`);
  };

  const handleCopySelectedTeamMarketplaceFormat = () => {
    const lines = teamAccounts
      .filter((acc) => selectedTeamIds.includes(String(acc?.id || "")))
      .flatMap((acc) => buildTeamMarketplaceExportLines(acc))
      .filter(Boolean);

    if (lines.length === 0) {
      showAlert(
        "Khong co du lieu",
        "Khong co Team hop le de copy format web. Business dang co khach se duoc bo qua.",
        "warning",
      );
      return;
    }

    handleCopy(lines.join("\n"), `Da copy ${lines.length} dong Team format web`);
  };

  const handleQuickTeamSaleModeChange = async (acc, nextMode) => {
    const targetMode = normalizeTeamSaleMode(nextMode);
    const currentMode = normalizeTeamSaleMode(acc?.saleMode);
    if (!acc?.id || targetMode === currentMode) return;
    if (!isTeamTotalWarehouse(acc)) {
      showAlert(
        "Khong the doi loai",
        "Team ngoai kho tong khong duoc doi qua Slot/Business o day.",
        "warning",
      );
      return;
    }

    setLoadingStates((prev) => ({
      ...prev,
      teamMode: { ...(prev.teamMode || {}), [acc.id]: true },
    }));
    try {
      const response = await axios.put(
        `/api/team/${acc.id}`,
        withExpectedUpdatedAt(
          {
            saleMode: targetMode,
          },
          acc,
        ),
      );
      const updatedAcc = response?.data?.account;
      if (updatedAcc?.id) {
        const normalizedTeamAcc = normalizeTeamAccountForUi(updatedAcc);
        setTeamAccounts((prev) =>
          prev.map((item) =>
            item.id === normalizedTeamAcc.id
              ? { ...item, ...normalizedTeamAcc }
              : item,
          ),
        );
      } else {
        await fetchData();
      }
      broadcastDataChange();
      showAlert(
        "Đã đổi loại Team",
        targetMode === "business"
          ? "Đã chuyển sang Business account."
          : "Đã chuyển sang Slot team.",
        "success",
      );
    } catch (error) {
      const msg = getApiErrorMessage(error, "Không thể đổi loại Team");
      showAlert("Lỗi", msg, "error");
    } finally {
      setLoadingStates((prev) => {
        const next = { ...(prev.teamMode || {}) };
        delete next[acc.id];
        return { ...prev, teamMode: next };
      });
    }
  };

  const handleTeamWarehouseChange = async (acc, nextWarehouse) => {
    const targetWarehouse = normalizeTeamWarehouse(nextWarehouse);
    const currentWarehouse = normalizeTeamWarehouse(acc?.warehouse);
    if (!acc?.id || targetWarehouse === currentWarehouse) return;

    const activeCustomers = getActiveTeamCustomers(acc);
    if (activeCustomers.length > 0) {
      showAlert(
        "Khong the chuyen kho",
        "Team dang co khach nen khong the doi kho.",
        "warning",
      );
      return;
    }

    const isBusinessMode = normalizeTeamSaleMode(acc?.saleMode) === "business";
    const daysLeft = getAccountDaysRemaining(acc);

    if (targetWarehouse === "short" && !isBusinessMode) {
      showAlert(
        "Khong hop le",
        "Kho duoi 25 ngay chi dung cho Team Business.",
        "warning",
      );
      return;
    }

    if (targetWarehouse === "market" && !isBusinessMode) {
      showAlert(
        "Khong hop le",
        "Kho market Team chi dung cho Business. Slot Team admin tu them theo don.",
        "warning",
      );
      return;
    }

    if (targetWarehouse === "market" && daysLeft !== null && daysLeft <= 25) {
      showAlert(
        "Khong the day vao kho market",
        "Team con 25 ngay tro xuong phai de o kho tong hoac kho duoi 25 ngay.",
        "warning",
      );
      return;
    }

    setLoadingStates((prev) => ({
      ...prev,
      changeTeamWarehouse: {
        ...(prev.changeTeamWarehouse || {}),
        [acc.id]: true,
      },
    }));

    try {
      const response = await axios.put(
        `/api/team/${acc.id}`,
        withExpectedUpdatedAt({ warehouse: targetWarehouse }, acc),
      );
      const updatedAcc = response?.data?.account;
      if (updatedAcc?.id) {
        const normalizedTeamAcc = normalizeTeamAccountForUi(updatedAcc);
        setTeamAccounts((prev) =>
          prev.map((item) =>
            item.id === normalizedTeamAcc.id
              ? { ...item, ...normalizedTeamAcc }
              : item,
          ),
        );
      } else {
        await fetchData(false);
      }
      broadcastDataChange();
      showAlert(
        "Da chuyen kho",
        `Team da duoc chuyen sang ${getTeamWarehouseLabel(targetWarehouse)}.`,
        "success",
      );
    } catch (error) {
      showAlert(
        "Loi",
        getApiErrorMessage(error, "Khong the doi kho Team"),
        "error",
      );
    } finally {
      setLoadingStates((prev) => {
        const next = { ...(prev.changeTeamWarehouse || {}) };
        delete next[acc.id];
        return { ...prev, changeTeamWarehouse: next };
      });
    }
  };

  const handleBulkTeamWarehouseMove = async (targetWarehouse) => {
    const target = normalizeTeamWarehouse(targetWarehouse);
    const selectedAccounts = teamAccounts.filter((acc) =>
      selectedTeamIds.includes(String(acc?.id || "")),
    );

    if (selectedAccounts.length === 0) {
      showAlert(
        "Khong co du lieu",
        "Hay chon Team truoc khi chuyen kho.",
        "warning",
      );
      return;
    }

    const targetLabel = getTeamWarehouseLabel(target);
    let success = 0;
    let failed = 0;
    let occupied = 0;
    let unsupported = 0;
    let nearExpiry = 0;
    let unchanged = 0;
    const failedLabels = [];

    setLoadingStates((prev) => ({ ...prev, bulkWarehouseMove: true }));
    try {
      for (const acc of selectedAccounts) {
        const currentWarehouse = normalizeTeamWarehouse(acc?.warehouse);
        const activeCustomers = getActiveTeamCustomers(acc);
        const isBusinessMode = normalizeTeamSaleMode(acc?.saleMode) === "business";
        const daysLeft = getAccountDaysRemaining(acc);

        if (activeCustomers.length > 0) {
          occupied += 1;
          continue;
        }
        if (currentWarehouse === target) {
          unchanged += 1;
          continue;
        }
        if (target === "short" && !isBusinessMode) {
          unsupported += 1;
          continue;
        }
        if (target === "market" && !isBusinessMode) {
          unsupported += 1;
          continue;
        }
        if (target === "market" && daysLeft !== null && daysLeft <= 25) {
          nearExpiry += 1;
          continue;
        }

        try {
          await axios.put(
            `/api/team/${acc.id}`,
            withExpectedUpdatedAt({ warehouse: target }, acc),
          );
          success += 1;
        } catch (error) {
          failed += 1;
          failedLabels.push(
            `${acc.username}: ${getApiErrorMessage(
              error,
              "Khong the chuyen kho",
            )}`,
          );
        }
      }

      await fetchData(false);
      broadcastDataChange();
      setSelectedTeamIds([]);

      const summaryLines = [
        `Thanh cong: ${success}`,
        `That bai: ${failed}`,
      ];
      if (occupied > 0) {
        summaryLines.push(`Bo qua Team dang co khach: ${occupied}`);
      }
      if (unsupported > 0) {
        summaryLines.push(`Bo qua Team khong hop le voi kho dich: ${unsupported}`);
      }
      if (nearExpiry > 0) {
        summaryLines.push(`Bo qua Team duoi 25 ngay cho kho market: ${nearExpiry}`);
      }
      if (unchanged > 0) {
        summaryLines.push(`Bo qua Team da o ${targetLabel}: ${unchanged}`);
      }
      failedLabels.slice(0, 5).forEach((line) => summaryLines.push(line));
      if (failedLabels.length > 5) {
        summaryLines.push(`... va ${failedLabels.length - 5} loi khac`);
      }

      showAlert(
        failed === 0 ? "Chuyen kho xong" : "Chuyen kho xong nhung co loi",
        summaryLines.join("\n"),
        failed === 0 ? "success" : "warning",
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, bulkWarehouseMove: false }));
    }
  };

  const getVisibleAccountNote = (note) =>
    String(note || "")
      .replace(
        /\[Warranty (?:replacement|source)[^\]]+\](?:\s*(?!\[Warranty\b)[^\[]*)?/gi,
        " ",
      )
      .replace(/^\s*\[Legacy Datammo customer\][^\n]*(?:\r?\n|$)/gim, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

  const openWarrantyModal = (acc, scope = "chatgpt") => {
    setWarrantySourceAcc(acc);
    setWarrantySourceScope(normalizeMarketplaceScope(scope));
    setWarrantyReplacementId("");
    setWarrantyReason("");
    setWarrantyReplacementSearch("");
    setWarrantyWarehouseFilter("all");
    setShowWarrantyModal(true);
  };

  const focusChatgptAccountFromMarketplace = (accountId, label = "") => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return;
    setActiveTab("chatgpt");
    setGptSubTab("market");
    setPackage2ShelfTab(
      marketplaceTrackedAccountIds?.has(normalizedId) ? "sold" : "all",
    );
    setSoldPackage2ProviderFilter("all");
    setChatgptCustomerFilter("all");
    if (label) {
      setSearchQuery(String(label || "").trim());
    }
    setHighlightedChatgptAccountId(normalizedId);
    setTimeout(() => {
      const row = document.getElementById(`chatgpt-account-row-${normalizedId}`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 120);
    setTimeout(() => {
      setHighlightedChatgptAccountId((prev) =>
        prev === normalizedId ? "" : prev,
      );
    }, 4000);
  };

  const focusTeamAccountFromMarketplace = (accountId, label = "") => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return;
    const targetAcc = teamAccounts.find(
      (acc) => String(acc?.id || "").trim() === normalizedId,
    );
    setActiveTab("chatgpt");
    if (targetAcc) {
      const warehouse = normalizeTeamWarehouse(targetAcc.warehouse);
      setTeamWarehouseTab(warehouse === "market" ? "market" : warehouse === "short" ? "short" : "total");
      setTeamTotalTypeTab(
        warehouse === "total"
          ? normalizeTeamSaleMode(targetAcc.saleMode)
          : "all",
      );
    } else {
      setTeamWarehouseTab("all");
      setTeamTotalTypeTab("all");
    }
    setTeamCustomerFilter("all");
    if (label) {
      setSearchQuery(String(label || "").trim());
    }
    setHighlightedTeamAccountId(normalizedId);
    setTimeout(() => {
      const row = document.getElementById(`team-account-row-${normalizedId}`);
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 120);
    setTimeout(() => {
      setHighlightedTeamAccountId((prev) =>
        prev === normalizedId ? "" : prev,
      );
    }, 4000);
  };

  const focusMarketplaceAccountFromSummary = (item = {}) => {
    if (normalizeMarketplaceScope(item?.scope) === "team") {
      return focusTeamAccountFromMarketplace(
        item.currentAccountId,
        item.currentUsername || item.currentAccountId,
      );
    }
    return focusChatgptAccountFromMarketplace(
      item.currentAccountId,
      item.currentUsername || item.currentAccountId,
    );
  };

  const openWarrantyFromMarketplaceOrder = (item = {}) => {
    const normalizedId = String(item?.currentAccountId || "").trim();
    const scope = normalizeMarketplaceScope(item?.scope);
    const targetAcc =
      scope === "team"
        ? teamAccounts.find((acc) => String(acc?.id || "").trim() === normalizedId)
        : accounts.find((acc) => String(acc?.id || "").trim() === normalizedId);
    if (!targetAcc) {
      showAlert(
        "Không tìm thấy acc",
        "Không tìm thấy acc hiện tại của order này trong danh sách.",
        "warning",
      );
      return;
    }
    openWarrantyModal(targetAcc, scope);
  };

  const handleCreateDatammoWarranty = async (event) => {
    event.preventDefault();
    if (!warrantySourceAcc?.id || !warrantyReplacementId) {
      showAlert("Thiếu dữ liệu", "Vui lòng chọn tài khoản thay thế.", "warning");
      return;
    }

    const sourceScope = normalizeMarketplaceScope(warrantySourceScope);
    const replacementAcc =
      sourceScope === "team"
        ? teamAccounts.find(
            (acc) => String(acc.id || "") === String(warrantyReplacementId || ""),
          )
        : accounts.find(
            (acc) => String(acc.id || "") === String(warrantyReplacementId || ""),
          );
    if (!replacementAcc) {
      showAlert("Lỗi", "Không tìm thấy tài khoản thay thế.", "error");
      return;
    }

    const sourceManagedInfo =
      sourceScope === "team"
        ? getMarketplaceOrderInfoFromUser({
            name:
              getActiveTeamCustomers(warrantySourceAcc)[0]?.customerName || "",
          })
        : getMarketplaceOrderInfoFromUser(
            Array.isArray(warrantySourceAcc?.users)
              ? warrantySourceAcc.users[0]
              : null,
          );
    const sourceProviderLabel = getMarketplaceProviderLabel(
      sourceManagedInfo.provider || "datammo",
    );
    const warrantyUrl =
      sourceScope === "team"
        ? `/api/team/${warrantySourceAcc.id}/warranty`
        : `/api/chatgpt/${warrantySourceAcc.id}/warranty`;

    setLoadingStates((prev) => ({ ...prev, warranty: true }));
    try {
      await axios.post(
        warrantyUrl,
        {
          replacementAccountId: warrantyReplacementId,
          reason: warrantyReason,
          sourceExpectedUpdatedAt: getRecordUpdatedAt(warrantySourceAcc),
          replacementExpectedUpdatedAt: getRecordUpdatedAt(replacementAcc),
        },
        { requestLabel: `Đang tạo bảo hành ${sourceProviderLabel}` },
      );
      setShowWarrantyModal(false);
      setWarrantySourceAcc(null);
      setWarrantyReplacementId("");
      setWarrantyReason("");
      setWarrantyReplacementSearch("");
      setWarrantyWarehouseFilter("all");
      await fetchData();
      broadcastDataChange();
      showAlert(
        "Thành công",
        `Đã tạo bảo hành và chuyển khách ${sourceProviderLabel} sang acc thay thế.`,
        "success",
      );
    } catch (error) {
      showAlert(
        "Lỗi",
        getApiErrorMessage(error, `Không thể tạo bảo hành ${sourceProviderLabel}`),
        "error",
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, warranty: false }));
    }
  };

  const handleCopy = (text, message = "Đã copy nội dung!") => {
    navigator.clipboard.writeText(text);
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2000);
  };

  const handleBulkImportGPT = async () => {
    let raw = document.getElementById("bulkGPTData").value;
    if (!raw.trim())
      return showAlert(
        "Thiếu dữ liệu",
        "Vui lòng dán dữ liệu vào ô trống!",
        "warning",
      );
    raw = raw.replace(/\[.*?\]/g, "\n");
    const btn = document.getElementById("btnImportGPT");
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Đang xử lý...";
    let successCount = 0;
    let errorCount = 0;
    const foundMatches = parseChatgptQuickImportRows(raw);
    if (foundMatches.length === 0) {
      btn.disabled = false;
      btn.innerText = originalText;
      return showAlert(
        "Không đọc được dữ liệu",
        "Không tìm thấy dòng hợp lệ. Kiểm tra lại format import.",
        "warning",
      );
    }
    for (const item of foundMatches) {
      try {
        await axios.post("/api/chatgpt", {
          username: item.username,
          password: item.password,
          otpSecret: item.otpSecret,
          link: item.link,
          type: "unassigned",
          note: "",
        });
        successCount++;
      } catch (e) {
        errorCount++;
      }
    }
    showAlert(
      "Hoàn Thành",
      `✅ Đã thêm: ${successCount}\n⚠️ Bỏ qua/Lỗi: ${errorCount}`,
      "info",
    );
    setShowImportGPTModal(false);
    btn.disabled = false;
    btn.innerText = originalText;
    fetchData();
  };

  const handleImportCoursera = async () => {
    setImportStatus(null);
    const scriptUrl =
      localStorage.getItem("appsScriptUrl") ||
      "https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec";
    const sheetName = document.getElementById("sheetNameInput").value;
    const raw = document.getElementById("bulkCourseraData").value;
    if (!raw.trim())
      return showAlert("Thiếu dữ liệu", "Chưa nhập dữ liệu import!", "warning");
    const lines = raw.split("\n");
    const parsedData = [];
    lines.forEach((line) => {
      if (!line.trim()) return;
      let parts;
      if (line.includes(",")) parts = line.split(",");
      else if (line.includes("|")) parts = line.split("|");
      else parts = [line];
      const email = parts[0]?.trim();
      const pass = parts[1]?.trim() || "";
      const sub = parts[2]?.trim() || "";
      if (email) parsedData.push([email, pass, sub]);
    });

    if (parsedData.length === 0)
      return showAlert(
        "Lỗi Format",
        "Không đọc được dòng nào hợp lệ!",
        "error",
      );

    showConfirm(
      "Xác Nhận Gửi",
      `Bạn có chắc muốn gửi ${parsedData.length} dòng này vào Sheet không?`,
      async () => {
        setImportingSheet(true);
        try {
          await axios.post("/api/proxy-sheet", {
            scriptUrl: scriptUrl,
            sheetName,
            data: parsedData,
          });
          setImportStatus("success");
          document.getElementById("bulkCourseraData").value = "";
          showAlert(
            "Thành Công",
            `✅ Đã gửi xong ${parsedData.length} dòng lên Google Sheet!`,
            "success",
          );
          setTimeout(() => setImportStatus(null), 5000);
        } catch (e) {
          setImportStatus("error");
          showAlert(
            "Lỗi Gửi Sheet",
            e.response?.data?.error || e.message,
            "error",
          );
        } finally {
          setImportingSheet(false);
        }
      },
    );
  };

  const renderApiOverlay = () => {
    if (!apiOverlay.visible) return null;
    return (
      <div className="fixed top-4 right-4 z-[10000] w-[min(92vw,420px)] pointer-events-none">
        <div className="rounded-2xl border border-cyan-700/60 bg-slate-900/95 shadow-2xl overflow-hidden">
          <div className="h-1.5 bg-slate-800 overflow-hidden">
            {apiOverlay.indeterminate ? (
              <div className="h-full w-full bg-gradient-to-r from-cyan-400/70 via-blue-500 to-emerald-400/70 animate-pulse" />
            ) : (
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-emerald-400 transition-all duration-200"
                style={{ width: `${apiOverlay.progress || 0}%` }}
              />
            )}
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-cyan-900/40 border border-cyan-700/50 flex items-center justify-center">
                <Loader2 size={20} className="text-cyan-300 animate-spin" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white">{apiOverlay.title || "Đang xử lý API"}</div>
                <div className="text-xs text-slate-400">{apiOverlay.detail}</div>
              </div>
              {apiOverlay.indeterminate ? (
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                  Live
                </div>
              ) : (
                <div className="text-2xl font-black text-cyan-300 tabular-nums">
                  {apiOverlay.progress}%
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
              {apiOverlay.indeterminate
                ? "Request này không có progress byte-thật từ browser, nên app chỉ hiện trạng thái đang xử lý."
                : "App vẫn dùng được, nhưng nên chờ request này xong để tránh lệch dữ liệu."}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- RENDER ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
        {renderApiOverlay()}
        {/* TOP BANNER */}
        <div className="text-center py-3 px-4 text-sm font-semibold bg-blue-600 text-white">
          ✨ Liên hệ mua tài khoản qua Zalo: <a href="https://zalo.me/0345440153" target="_blank" rel="noreferrer" className="underline font-bold hover:text-yellow-300 transition-colors">0345440153</a>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
          {/* HEADER */}
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black mb-3 text-white">
              🛒 Dịch Vụ Tài Khoản Premium
            </h1>
            <p className="text-slate-400 text-lg">Cấp nhanh · Ổn định · Hỗ trợ 24/7</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* LEFT — Service Cards */}
            <div className="flex-1 space-y-6">

              {/* ChatGPT */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-700 bg-slate-900">
                <div className="px-6 py-4 flex items-center gap-4 bg-blue-700">
                  <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow">
                    <img src="/chatgptlogo.png" alt="ChatGPT" className="w-11 h-11 object-cover object-center" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white">ChatGPT Plus</h2>
                    <p className="text-blue-100 text-sm">Trí tuệ nhân tạo mạnh nhất thế giới</p>
                  </div>
                </div>
                <div className="p-5 grid sm:grid-cols-2 gap-4">
                  <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-blue-300 font-bold">🔥 Gói 1 – Chia sẻ</span>
                      <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-bold">TIẾT KIỆM</span>
                    </div>
                    <ul className="mt-2 text-sm text-slate-300 space-y-1">
                      <li>• 👥 1 tài khoản / 3 người dùng chung</li>
                      <li>• ⚡ Cấp sẵn – vào dùng ngay</li>
                      <li>• 🔒 Không đổi mật khẩu</li>
                      <li>• 💬 Liên hệ để nhận báo giá</li>
                    </ul>
                  </div>
                  <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-purple-300 font-bold">🔥 Gói 2 – Riêng tư</span>
                      <span className="bg-purple-700 text-white text-xs px-2 py-0.5 rounded font-bold">PREMIUM</span>
                    </div>
                    <ul className="mt-2 text-sm text-slate-300 space-y-1">
                      <li>• 👤 Dùng 1 mình hoặc cùng bạn bè</li>
                      <li>• 🔑 Toàn quyền đăng nhập</li>
                      <li>• 🔄 Tự đổi mật khẩu</li>
                      <li>• 💬 Liên hệ để nhận báo giá</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Other Services */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-700 bg-slate-900">
                <div className="px-6 py-4 flex items-center gap-3 bg-teal-700">
                  <span className="text-2xl">⭐</span>
                  <div>
                    <h2 className="text-xl font-black text-white">Tài Khoản Pro Khác</h2>
                    <p className="text-teal-100 text-sm">Nhiều dịch vụ, chất lượng đảm bảo</p>
                  </div>
                </div>
                <div className="p-5 grid sm:grid-cols-2 gap-3">
                  {[
                    { logo: "/canvalogo.jpg", name: "Canva Edu", desc: "Dùng như Pro", note: "Liên hệ để nhận báo giá", bg: "bg-purple-900/40 border-purple-800" },
                    { logo: "/netfflixlogo.png", name: "Netflix Premium", desc: "Full HD, 4K", note: "Liên hệ để nhận báo giá", bg: "bg-red-900/40 border-red-800" },
                    { logo: "/quizletlogo.png", name: "Quizlet", desc: "Học tập thông minh", note: "Liên hệ để nhận báo giá", bg: "bg-blue-900/40 border-blue-800" },
                    { logo: "/capcutlogo.png", name: "CapCut Pro", desc: "Chỉnh video chuyên nghiệp", note: "Liên hệ để nhận báo giá", bg: "bg-slate-800 border-slate-600" },
                    { logo: "/ytblogo.png", name: "YouTube Premium", desc: "Không quảng cáo", note: "Liên hệ để nhận báo giá", bg: "bg-rose-900/40 border-rose-800" },
                  ].map((s, i) => (
                    <div key={i} className={`${s.bg} border rounded-xl p-4 flex items-center gap-3`}>
                      <div className="shrink-0 w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden shadow">
                        <img src={s.logo} alt={s.name} className="w-11 h-11 object-cover object-center" onError={(e) => { e.target.style.display = 'none'; }} />
                      </div>
                      <div>
                        <div className="font-bold text-white">{s.name}</div>
                        <div className="text-xs text-slate-400 mb-0.5">{s.desc}</div>
                        <div className="text-yellow-400 font-black text-sm">{s.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="rounded-2xl p-5 text-center border border-slate-700 bg-slate-800">
                <p className="text-lg font-bold text-white mb-3">📞 Liên Hệ Ngay Để Mua</p>
                <a href="https://zalo.me/0345440153" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 px-8 py-3 rounded-lg font-black text-white text-lg bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg">
                  💬 Zalo: 0345440153
                </a>
                <p className="text-slate-500 text-xs mt-3">Hỗ trợ 24/7 · Cấp ngay sau thanh toán</p>
              </div>
            </div>

            {/* RIGHT — Admin Login */}
            <div className="w-full lg:w-80 shrink-0">
              <div className="rounded-2xl p-6 border border-slate-700 shadow-xl bg-slate-900 sticky top-6">
                <div className="flex justify-center mb-4 text-blue-400">
                  <div className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                    <Lock size={28} />
                  </div>
                </div>
                <h2 className="text-lg font-bold text-center text-slate-400 mb-5">🔐 Đăng Nhập Admin</h2>
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Email</label>
                    <input
                      type="text"
                      className="form-input w-full text-sm"
                      placeholder="admin@example.com"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Mật khẩu</label>
                    <input
                      type="password"
                      className="form-input w-full text-sm"
                      placeholder="••••••••"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="w-full btn-primary justify-center flex items-center gap-2 py-2.5 text-sm">
                    <LogIn size={16} /> Đăng Nhập
                  </button>
                </form>
                {alertInfo.show && (
                  <div className={`mt-3 p-2 rounded text-center text-xs font-bold ${alertInfo.type === "error" ? "bg-red-900/50 text-red-400" : "bg-green-900/50 text-green-400"}`}>
                    {alertInfo.message}
                  </div>
                )}
                <p className="text-center text-slate-600 text-xs mt-4">Dành riêng cho Admin hệ thống</p>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="text-center py-6 text-slate-600 text-xs border-t border-slate-800">
          © 2025 Dịch Vụ Tài Khoản Premium · Liên hệ: <a href="https://zalo.me/0345440153" className="hover:text-slate-400 underline">0345440153</a>
        </div>
      </div>
    );
  }

  const marketplaceOrderSummaries = buildMarketplaceOrderSummaries(
    datammoOrderHistory,
    datammoWarrantyCases,
  );
  const marketplaceTrackedAccountMap = new Map();
  const registerMarketplaceTrackedAccount = (
    accountId,
    payload = {},
    overwrite = false,
  ) => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return;
    if (!overwrite && marketplaceTrackedAccountMap.has(normalizedId)) return;
    marketplaceTrackedAccountMap.set(normalizedId, {
      accountId: normalizedId,
      provider: normalizeMarketplaceProvider(payload?.provider),
      providerLabel: getMarketplaceProviderLabel(payload?.provider),
      orderId: String(payload?.orderId || "").trim(),
      role: String(payload?.role || ""),
      label: String(payload?.label || "").trim(),
      order: payload?.order || null,
      summary: payload?.summary || null,
    });
  };
  marketplaceOrderSummaries.forEach((order) => {
    order.accountSummaries.forEach((item) => {
      if (normalizeMarketplaceScope(item?.scope) !== "chatgpt") {
        return;
      }
      const provider = normalizeMarketplaceProvider(order?.provider);
      const commonPayload = {
        provider,
        orderId: String(order?.orderId || "").trim(),
        order,
        summary: item,
      };
      registerMarketplaceTrackedAccount(item?.soldAccountId, {
        ...commonPayload,
        role: item?.warrantyRounds > 0 ? "source" : "sold",
        label: item?.soldUsername,
      });
      registerMarketplaceTrackedAccount(item?.currentAccountId, {
        ...commonPayload,
        role:
          String(item?.currentAccountId || "") === String(item?.soldAccountId || "")
            ? "sold"
            : "current",
        label: item?.currentUsername,
      }, true);
      const rounds = Array.isArray(item?.warrantyCase?.rounds)
        ? item.warrantyCase.rounds
        : [];
      rounds.forEach((round) => {
        registerMarketplaceTrackedAccount(round?.fromAccountId, {
          ...commonPayload,
          role:
            String(round?.fromAccountId || "") ===
            String(item?.soldAccountId || "")
              ? "source"
              : "history",
          label: round?.fromUsername,
        });
        registerMarketplaceTrackedAccount(round?.toAccountId, {
          ...commonPayload,
          role:
            String(round?.toAccountId || "") ===
            String(item?.currentAccountId || "")
              ? "current"
              : "history",
          label: round?.toUsername,
        }, true);
      });
    });
  });
  const marketplaceTrackedAccountIds = new Set(
    marketplaceTrackedAccountMap.keys(),
  );
  const isMarketplaceSoldAccountForScope = (
    accountId,
    scope = "chatgpt",
  ) => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return false;
    const normalizedScope = normalizeMarketplaceScope(scope);
    return marketplaceOrderSummaries.some((order) =>
      (Array.isArray(order?.accountSummaries) ? order.accountSummaries : []).some(
        (item) =>
          normalizeMarketplaceScope(item?.scope) === normalizedScope &&
          (String(item?.soldAccountId || "").trim() === normalizedId ||
            String(item?.currentAccountId || "").trim() === normalizedId),
      ),
    );
  };
  const getMarketplaceSearchTextForAccount = (
    accountId,
    scope = "chatgpt",
  ) => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return "";
    const normalizedScope = normalizeMarketplaceScope(scope);
    return (marketplaceOrderSummaries || [])
      .flatMap((order) => {
        const providerLabel = getMarketplaceProviderLabel(order?.provider);
        const orderId = String(order?.orderId || "").trim();
        return (Array.isArray(order?.accountSummaries) ? order.accountSummaries : [])
          .filter((item) => {
            if (normalizeMarketplaceScope(item?.scope) !== normalizedScope) {
              return false;
            }
            const relatedIds = [
              item?.soldAccountId,
              item?.currentAccountId,
              ...(Array.isArray(item?.warrantyCase?.rounds)
                ? item.warrantyCase.rounds.flatMap((round) => [
                    round?.fromAccountId,
                    round?.toAccountId,
                  ])
                : []),
            ]
              .map((value) => String(value || "").trim())
              .filter(Boolean);
            return relatedIds.includes(normalizedId);
          })
          .map((item) =>
            [
              providerLabel,
              order?.provider,
              orderId,
              item?.soldUsername,
              item?.currentUsername,
              item?.soldAccountId,
              item?.currentAccountId,
            ]
              .filter(Boolean)
              .join(" "),
          );
      })
      .join(" ");
  };
  const filteredChatgptAccounts = accounts
    .filter((acc) => {
      if (gptSubTab === "total") {
        return supportsChatgptMarketType(acc?.type);
      }
      if (gptSubTab === "market") {
        return supportsChatgptMarketType(acc?.type);
      }
      if (gptSubTab === "short") {
        return supportsChatgptMarketType(acc?.type);
      }
      return true;
    })
    .filter((acc) => {
      const isSoldMarketplaceAccount = marketplaceTrackedAccountIds.has(
        String(acc?.id || ""),
      );
      const isInMarketWarehouse = isChatgptMarketWarehouse(acc);
      const isInShortDateWarehouse = isChatgptShortDateWarehouse(acc);
      if (gptSubTab === "market") {
        if (package2ShelfTab === "sold") {
          if (!isSoldMarketplaceAccount) return false;
          if (soldPackage2ProviderFilter === "all") return true;
          return (
            normalizeMarketplaceProvider(
              marketplaceTrackedAccountMap.get(String(acc?.id || ""))?.provider,
            ) === normalizeMarketplaceProvider(soldPackage2ProviderFilter)
          );
        }
        return !isSoldMarketplaceAccount && isInMarketWarehouse;
      }
      if (gptSubTab === "short") {
        if (isSoldMarketplaceAccount) return false;
        return isInShortDateWarehouse;
      }
      if (gptSubTab === "total") {
        if (isSoldMarketplaceAccount) return false;
        return !isInMarketWarehouse && !isInShortDateWarehouse;
      }
      return true;
    })
    .filter((acc) => {
      if (gptSubTab !== "total" || chatgptTotalTypeTab === "all") return true;
      if (chatgptTotalTypeTab === "unassigned") {
        return !acc?.type || acc?.type === "unassigned";
      }
      return acc.type === chatgptTotalTypeTab;
    })
    .filter((acc) =>
      matchesCustomerFilter(hasAssignedCustomer(acc), chatgptCustomerFilter),
    )
    .filter((acc) =>
      matchesExpiryFilter(getAccountDaysRemaining(acc), chatgptExpiryFilter),
    )
    .filter((acc) =>
      matchesExpiryRange(
        getAccountDaysRemaining(acc),
        chatgptExpiryMin,
        chatgptExpiryMax,
      ),
    )
    .filter((acc) => {
      if (!searchQuery.trim()) return true;
      const queryNormalized = toNonAccentVietnamese(searchQuery);
      if (
        acc.username &&
        toNonAccentVietnamese(acc.username).includes(queryNormalized)
      ) {
        return true;
      }
      if (acc.users && acc.users.length > 0) {
        return acc.users.some((user) => {
          const name = typeof user === "object" ? user.name : user;
          return (
            name &&
            toNonAccentVietnamese(name).includes(queryNormalized)
          );
        });
      }
      const marketplaceSearchText = getMarketplaceSearchTextForAccount(
        acc?.id,
        "chatgpt",
      );
      if (
        marketplaceSearchText &&
        toNonAccentVietnamese(marketplaceSearchText).includes(queryNormalized)
      ) {
        return true;
      }
      return false;
    });
  const filteredChatgptIds = filteredChatgptAccounts.map((acc) =>
    String(acc.id || ""),
  );
  const chatgptMarketplaceOrderSummaries = marketplaceOrderSummaries.filter(
    (order) => normalizeMarketplaceScope(order?.scope) === "chatgpt",
  );
  const teamMarketplaceOrderSummaries = marketplaceOrderSummaries.filter(
    (order) => normalizeMarketplaceScope(order?.scope) === "team",
  );
  const filteredChatgptMarketplaceOrders = chatgptMarketplaceOrderSummaries.filter((order) => {
    if (
      marketplaceOrderProviderFilter !== "all" &&
      normalizeMarketplaceProvider(order?.provider) !==
        normalizeMarketplaceProvider(marketplaceOrderProviderFilter)
    ) {
      return false;
    }
    if (!marketplaceOrderQuery.trim()) return true;
    return String(order?.searchIndex || "").includes(
      toNonAccentVietnamese(marketplaceOrderQuery),
    );
  });
  const filteredTeamMarketplaceOrders = teamMarketplaceOrderSummaries.filter((order) => {
    if (
      teamMarketplaceOrderProviderFilter !== "all" &&
      normalizeMarketplaceProvider(order?.provider) !==
        normalizeMarketplaceProvider(teamMarketplaceOrderProviderFilter)
    ) {
      return false;
    }
    if (!teamMarketplaceOrderQuery.trim()) return true;
    return String(order?.searchIndex || "").includes(
      toNonAccentVietnamese(teamMarketplaceOrderQuery),
    );
  });
  const selectedChatgptIdSet = new Set(
    selectedChatgptIds.map((id) => String(id || "")),
  );
  const selectedInFilteredCount = filteredChatgptIds.filter((id) =>
    selectedChatgptIdSet.has(id),
  ).length;
  const allFilteredSelected =
    filteredChatgptIds.length > 0 &&
    selectedInFilteredCount === filteredChatgptIds.length;
  const filteredTeamAccounts = teamAccounts
    .filter((acc) => {
      if (!searchQuery.trim()) return true;
      const queryNormalized = toNonAccentVietnamese(searchQuery);
      if (
        acc.username &&
        toNonAccentVietnamese(acc.username).includes(queryNormalized)
      ) {
        return true;
      }
      const matchedTeamSlot = normalizeTeamSlotsForUi(acc?.slots).some((slot) => {
        const customerName = String(slot?.customerName || "").trim();
        const gmail = String(slot?.gmail || "").trim();
        return (
          (customerName &&
            toNonAccentVietnamese(customerName).includes(queryNormalized)) ||
          (gmail && toNonAccentVietnamese(gmail).includes(queryNormalized))
        );
      });
      if (matchedTeamSlot) return true;
      const marketplaceSearchText = getMarketplaceSearchTextForAccount(
        acc?.id,
        "team",
      );
      return (
        marketplaceSearchText &&
        toNonAccentVietnamese(marketplaceSearchText).includes(queryNormalized)
      );
    })
    .filter((acc) =>
      matchesCustomerFilter(
        hasAssignedTeamCustomer(acc),
        teamCustomerFilter,
      ),
    )
    .filter((acc) =>
      matchesExpiryFilter(getAccountDaysRemaining(acc), teamExpiryFilter),
    )
    .filter((acc) =>
      matchesExpiryRange(
        getAccountDaysRemaining(acc),
        teamExpiryMin,
        teamExpiryMax,
      ),
    );
  const teamTotalAccounts = filteredTeamAccounts.filter((acc) => {
    if (!isTeamTotalWarehouse(acc)) return false;
    if (teamTotalTypeTab === "all") return true;
    return normalizeTeamSaleMode(acc.saleMode) === teamTotalTypeTab;
  });
  const teamMarketAccounts = filteredTeamAccounts.filter((acc) =>
    isTeamMarketWarehouse(acc),
  );
  const teamShortAccounts = filteredTeamAccounts.filter((acc) =>
    isTeamShortWarehouse(acc),
  );
  const teamVisibleAccounts =
    teamWarehouseTab === "total"
      ? teamTotalAccounts
      : teamWarehouseTab === "market"
        ? teamMarketAccounts
        : teamWarehouseTab === "short"
          ? teamShortAccounts
          : filteredTeamAccounts;
  const filteredTeamIds = teamVisibleAccounts.map((acc) => String(acc?.id || ""));
  const selectedTeamIdSet = new Set(
    selectedTeamIds.map((id) => String(id || "")),
  );
  const selectedFilteredTeamCount = filteredTeamIds.filter((id) =>
    selectedTeamIdSet.has(id),
  ).length;
  const allFilteredTeamSelected =
    filteredTeamIds.length > 0 &&
    selectedFilteredTeamCount === filteredTeamIds.length;
  const teamSlotAccounts = teamVisibleAccounts.filter(
    (acc) => normalizeTeamSaleMode(acc.saleMode) === "slot",
  );
  const teamBusinessAccounts = teamVisibleAccounts.filter(
    (acc) => normalizeTeamSaleMode(acc.saleMode) === "business",
  );
  const teamSections = [
    teamWarehouseTab === "market" || teamWarehouseTab === "short"
      ? null
      : {
          key: "slot",
          title: "Goi chia se 4 slot",
          subtitle: "1 account Team cho toi da 4 khach",
          accounts: teamSlotAccounts,
          badgeClass: "bg-emerald-900/40 text-emerald-300 border-emerald-700/60",
          panelClass: "border-teal-700/40 bg-teal-950/10",
        },
    {
      key: "business",
      title: "Nguyen acc Business",
      subtitle:
        teamWarehouseTab === "market"
          ? "Business dang ban qua API"
          : teamWarehouseTab === "short"
            ? "Business duoi 25 ngay, day tay"
            : "1 account = 1 khach Business",
      accounts: teamBusinessAccounts,
      badgeClass: "bg-cyan-900/40 text-cyan-300 border-cyan-700/60",
      panelClass: "border-cyan-700/40 bg-cyan-950/10",
    },
  ].filter(Boolean);

  // MAIN DASHBOARD
  return (
    <div
      className="min-h-screen text-slate-200 p-2 sm:p-4 md:p-8 font-sans overflow-x-hidden"
      style={{ backgroundColor: "#0f172a" }}
    >
      {renderApiOverlay()}
      <div className="max-w-7xl mx-auto relative">
        {/* TOAST MSG */}
        {toastMessage && (
          <div className="fixed bottom-10 right-10 bg-emerald-600/95 backdrop-blur-sm text-white px-5 py-3 rounded-xl shadow-2xl z-[9999] flex items-center gap-2 animate-bounce min-w-[200px] border border-emerald-400 font-bold">
            <div className="bg-emerald-500 rounded-full p-1"><CheckCircle size={16} /></div> {toastMessage}
          </div>
        )}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-800 p-4 md:p-6 rounded-xl shadow-lg border border-slate-700 max-w-full overflow-hidden">
          <div className="mb-4 md:mb-0">
            <h1
              className="text-3xl font-bold"
              style={{
                background: "linear-gradient(to right, #60a5fa, #c084fc)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                fontSize: "2.5rem",
              }}
            >
              Quản Lý Tài Khoản
            </h1>
          </div>
          <div className="flex bg-slate-900 p-1 rounded-3xl border border-slate-700 items-center overflow-x-auto w-full max-w-full no-scrollbar">
            <button
              onClick={() => setActiveTab("chatgpt")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "chatgpt" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              ChatGPT
            </button>
            <button
              onClick={() => setActiveTab("netflix")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "netflix" ? "bg-red-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Netflix
            </button>
            <button
              onClick={() => setActiveTab("capcut")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "capcut" ? "bg-green-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              CapCut
            </button>
            <button
              onClick={() => setActiveTab("canva")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "canva" ? "bg-purple-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Canva
            </button>

            <button
              onClick={() => setActiveTab("coursera")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "coursera" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Coursera Plus
            </button>
            <button
              onClick={handleLogout}
              className="ml-2 w-10 h-10 rounded-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white flex items-center justify-center transition-all"
              title="Đăng Xuất"
            >
              <LogIn size={18} className="transform rotate-180" />
            </button>
          </div>
        </div>

        {recentDatammoOrders.length > 0 && (
          <div className="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-950/25 shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-4 md:p-5">
              <div className="min-w-0 flex items-start gap-3">
                <div className="shrink-0 rounded-full p-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/20">
                  <CheckCircle size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] font-black text-emerald-300">
                    Seller Order Alert
                  </div>
                  <div className="text-lg md:text-xl font-black text-white">
                    Vừa có đơn mới từ sàn
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentDatammoOrders.slice(0, 3).map((order) => {
                      const providerLabel = getMarketplaceProviderLabel(order?.provider);
                      const accountsInOrder =
                        Array.isArray(order.accounts) && order.accounts.length > 0
                          ? order.accounts
                          : [{ username: "Không rõ acc" }];
                      return (
                        <div
                          key={buildDatammoOrderKey(order)}
                          className="rounded-xl border border-emerald-400/15 bg-black/15 px-3 py-2"
                        >
                          <div className="space-y-1">
                            <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-200">
                              {providerLabel}
                            </div>
                            {accountsInOrder.map((account, index) => (
                              <div
                                key={`${buildDatammoOrderKey(order)}-${index}`}
                                className="font-semibold text-white break-all"
                              >
                                {providerLabel} vừa bán acc {account.username || account.accountId || "Không rõ"} cho order {order.orderId || "N/A"}
                              </div>
                            ))}
                          </div>
                          {order.createdAt && (
                            <div className="mt-1 text-xs text-emerald-100/75">
                              {new Date(order.createdAt).toLocaleString("vi-VN")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {recentDatammoOrders.length > 3 && (
                      <div className="text-xs text-emerald-100/80">
                        +{recentDatammoOrders.length - 3} đơn nữa đang chờ bạn xem.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecentDatammoOrders([])}
                className="shrink-0 rounded-full p-2 text-emerald-200 hover:bg-white/10 hover:text-white transition-colors"
                title="Ẩn banner đơn mới"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {activeTab === "chatgpt" && (
          <div>
            {/* GLOBAL EXPIRY / RESCUE BANNER */}
            {(() => {
              const urgentList = [];

              accounts.forEach((acc) => {
                // 1. Check if ACCOUNT itself is expired
                const isAccExpired =
                  acc.expiredAt && new Date(acc.expiredAt) < new Date();
                const hasUsers = acc.users && acc.users.length > 0;

                if (hasUsers) {
                  acc.users.forEach((u, idx) => {
                    const days = getDaysUsed(u);
                    const daysRemaining = getDaysRemaining(u);
                    const isUserExpired = daysRemaining !== null && daysRemaining <= 0;

                    // Case A: User Expired -> Needs Extension
                    if (isUserExpired) {
                      urgentList.push({
                        type: "user_expired",
                        acc,
                        u,
                        idx,
                        days,
                        msg: `Khách hết hạn (${Math.abs(daysRemaining)} ngày quá hạn)`,
                      });
                    }
                    // Case B: Account Expired -> Needs Evacuation (Move)
                    else if (isAccExpired) {
                      urgentList.push({
                        type: "acc_expired",
                        acc,
                        u,
                        idx,
                        days,
                        msg: "CHATGPT ĐÃ HẾT HẠN - CẦN CHUYỂN GẤP!",
                      });
                    }
                  });
                } else if (isAccExpired) {
                  // Case C: Account Expired & EMPTY -> Needs Deletion
                  urgentList.push({
                    type: "acc_empty_expired",
                    acc,
                    u: { name: "CHATGPT TRỐNG" },
                    idx: -1,
                    days: 0,
                    msg: "ChatGpt hết hạn & Trống -> Cần Xóa!",
                  });
                }
              });

              // Case D: Gói 2 còn <=25 ngày và không có khách → cảnh báo gỡ khỏi Datammo
              accounts.forEach((acc) => {
                if (acc.type !== "package2") return;
                if (normalizePackage2Shelf(acc.package2Shelf) !== "cheap") return;
                if (acc.users && acc.users.length > 0) return; // đang có khách, bỏ qua
                const daysLeft = acc.expiredAt
                  ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000)
                  : null;
                if (daysLeft !== null && daysLeft <= 25 && daysLeft > 0) {
                  urgentList.push({
                    type: "pkg2_expiring_soon",
                    acc,
                    u: { name: `Gói 2 còn ${daysLeft} ngày` },
                    idx: -1,
                    days: daysLeft,
                    msg: `Tai khoan trong kho market con ${daysLeft} ngay. Hay dua ve kho duoi 25 ngay hoac kho tong!`,
                  });
                }
              });

              teamAccounts.forEach((acc) => {
                const isAccExpired = acc.expiredAt && new Date(acc.expiredAt) < new Date();
                const activeSlots = (acc.slots || []).map((slot, idx) => ({ slot, idx })).filter(item => item.slot.status === "active");

                if (activeSlots.length > 0) {
                  activeSlots.forEach(({ slot, idx }) => {
                    const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                    const isSlotExpired = sExpDays !== null && sExpDays <= 0;

                    if (isSlotExpired) {
                      urgentList.push({
                        type: "team_slot_expired",
                        acc,
                        u: slot,
                        idx,
                        days: sExpDays,
                        msg: `Khách Team hết hạn (${Math.abs(sExpDays)} ngày quá hạn)`,
                      });
                    } else if (isAccExpired) {
                      urgentList.push({
                        type: "team_acc_expired",
                        acc,
                        u: slot,
                        idx,
                        days: sExpDays,
                        msg: "TEAM ĐÃ HẾT HẠN - CẦN CHUYỂN GẤP!",
                      });
                    }
                  });
                } else if (isAccExpired) {
                  urgentList.push({
                    type: "team_empty_expired",
                    acc,
                    u: { name: "TEAM TRỐNG" },
                    idx: -1,
                    days: 0,
                    msg: "Team Acc hết hạn & Trống -> Cần Xóa!",
                  });
                }
              });

              if (urgentList.length > 0) {
                return (
                  <div className="mb-8 bg-red-900/20 border-2 border-red-600 rounded-xl overflow-hidden shadow-2xl animate-fade-in">
                    <div className="bg-red-800/80 p-3 flex items-center justify-between">
                      <h3 className="text-white font-bold text-lg flex items-center gap-2">
                        <AlertTriangle className="text-yellow-300 animate-pulse" />
                        DANH SÁCH CẦN XỬ LÝ GẤP ({urgentList.length})
                      </h3>
                    </div>
                    <div className="p-4 space-y-3">
                      {urgentList.map(({ type, acc, u, idx, days, msg }, i) => (
                        <div
                          key={i}
                          className={`flex items-center justify-between p-3 rounded border ${
                            type === "pkg2_expiring_soon"
                              ? "bg-yellow-950/30 border-yellow-600/40"
                              : "bg-slate-900/50 border-red-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-full ${
                                type === "pkg2_expiring_soon"
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : type.includes("acc_expired")
                                  ? "bg-orange-500/20 text-orange-500"
                                  : "bg-red-500/20 text-red-500"
                              }`}
                            >
                              {type === "pkg2_expiring_soon" ? (
                                <Globe size={20} />
                              ) : type.includes("acc_expired") ? (
                                <Shield size={20} />
                              ) : (
                                <User size={20} />
                              )}
                            </div>
                            <div>
                              <div className={`font-bold text-lg ${
                                type === "pkg2_expiring_soon" ? "text-yellow-400" : "text-red-400"
                              }`}>
                                {type === "pkg2_expiring_soon" ? acc.username : type.includes("team") ? (u.customerName || u.gmail || u.name || "Khách Team") : (u.name || u.email)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {type === "pkg2_expiring_soon" ? (
                                  <span className="text-yellow-500 font-bold">{msg}</span>
                                ) : (
                                  <>{type.includes("team") ? "Team: " : "Thường: "}<span className="text-white">{acc.username}</span>{" "}•<span className="text-red-500 font-bold ml-1">{msg}</span></>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {type === "user_expired" || type === "team_slot_expired" ? (
                              // Action for Expired User: EXTEND
                              <>
                                <button
                                  onClick={() =>
                                    handleExtendUser(acc.id, idx, u, type.includes("team") ? "team" : "chatgpt")
                                  }
                                  className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <RotateCw size={18} /> GIA HẠN
                                </button>
                                <button
                                  onClick={async () => {
                                    if (type === "team_slot_expired") {
                                      const updSlots = [...acc.slots];
                                      updSlots[idx] = { ...u, status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                                      await axios.put(
                                        `/api/team/${acc.id}`,
                                        withExpectedUpdatedAt({ slots: updSlots }, acc),
                                      );
                                      fetchData();
                                      showAlert("Thành công", "Đã xóa khách Team!", "success");
                                    } else {
                                      handleDeleteUser(acc.id, idx, u.name)
                                    }
                                  }}
                                  className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <Trash2 size={18} /> XÓA
                                </button>
                              </>
                            ) : type === "acc_expired" || type === "team_acc_expired" ? (
                              // Action for Expired Account (With Users): MOVE USER (Rescue)
                              <button
                                onClick={() =>
                                  type === "team_acc_expired" ? openMoveSlotModal(acc.id, idx, u) : openMoveUserModal(acc.id, idx, u)
                                }
                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse"
                              >
                                <ArrowRightLeft size={18} /> CỨU USER (CHUYỂN
                                GẤP)
                              </button>
                            ) : type === "acc_empty_expired" || type === "team_empty_expired" ? (
                              // Action for Expired Account (Empty): DELETE ACCOUNT
                              <button
                                onClick={() => {
                                  if (type === "team_empty_expired") {
                                    handleDeleteTeamAccount(acc.id);
                                  } else {
                                    setDeletingId(acc.id);
                                    setShowDeleteModal(true);
                                  }
                                }}
                                className="flex items-center gap-2 bg-red-800 hover:bg-red-600 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse border border-red-500"
                              >
                                <Trash2 size={18} /> XÓA {type.includes("team") ? "TEAM" : "CHATGPT"} RÁC
                              </button>
                            ) : type === "pkg2_expiring_soon" ? (
                              // Gói 2 sắp hết hạn: nhắc nhở admin gỡ khỏi Datammo
                              <div className="flex items-center gap-2">
                                <span className="text-yellow-400 text-xs font-bold px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/40 rounded">Kho market tu dong - can chuyen kho</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div
                style={{
                  background: "rgba(59, 130, 246, 0.1)",
                  borderLeft: "4px solid #3b82f6",
                }}
                className="p-6 rounded-lg border border-blue-900/30"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-blue-400 mb-1">
                      🔥 Gói 1 – Chia sẻ tiết kiệm
                    </h3>
                    <div className="text-2xl font-bold text-yellow-400 mb-3">
                      50.000đ
                      <span className="text-sm text-slate-400 font-normal">
                        /tháng
                      </span>
                    </div>
                  </div>
                  <div className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded text-xs font-bold">
                    POPULAR
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>• 👥 1 tài khoản / 3 người dùng chung</li>
                  <li>• ⚡ Cấp sẵn – vào dùng ngay</li>
                  <li>• 🔒 Không đổi mật khẩu</li>
                </ul>
              </div>

              <div
                style={{
                  background: "rgba(139, 92, 246, 0.1)",
                  borderLeft: "4px solid #8b5cf6",
                }}
                className="p-6 rounded-lg border border-purple-900/30"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-purple-400 mb-1">
                      🔥 Gói 2 – Tài khoản linh hoạt
                    </h3>
                    <div className="text-2xl font-bold text-yellow-400 mb-3">
                      100.000đ
                      <span className="text-sm text-slate-400 font-normal">
                        /tháng
                      </span>
                    </div>
                  </div>
                  <div className="bg-purple-600/20 text-purple-300 px-3 py-1 rounded text-xs font-bold">
                    PREMIUM
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>• 👤 Dùng 1 mình hoặc 👥 mua chung với bạn bè</li>
                  <li>• 🔑 Toàn quyền đăng nhập</li>
                  <li>• 🔄 Tự đổi mật khẩu</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 justify-between mb-4">
              <div className="flex-1 max-w-xl space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="🔍 Tìm kiếm theo email hoặc tên khách..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Lọc khách
                  </span>
                  {renderCustomerFilterButtons(
                    chatgptCustomerFilter,
                    setChatgptCustomerFilter,
                  )}
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Loc han
                  </span>
                  {renderExpiryRangeInputs(
                    chatgptExpiryMin,
                    (value) =>
                      handleExpiryRangeChange(
                        value,
                        setChatgptExpiryMin,
                        setChatgptExpiryFilter,
                      ),
                    chatgptExpiryMax,
                    (value) =>
                      handleExpiryRangeChange(
                        value,
                        setChatgptExpiryMax,
                        setChatgptExpiryFilter,
                      ),
                  )}
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Moc nhanh
                  </span>
                  {renderExpiryFilterSelect(
                    chatgptExpiryFilter,
                    (value) =>
                      handleExpiryPresetChange(
                        value,
                        setChatgptExpiryFilter,
                        setChatgptExpiryMin,
                        setChatgptExpiryMax,
                      ),
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-slate-300 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700">
                  Đã chọn: <span className="font-bold text-white">{selectedChatgptIds.length}</span>
                </div>
                {selectedChatgptIds.length > 0 && (
                  <button
                    onClick={() => setSelectedChatgptIds([])}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-semibold text-sm"
                  >
                    Bỏ chọn
                  </button>
                )}
                <button
                  onClick={() => handleBulkWarehouseMove("none")}
                  disabled={selectedChatgptIds.length === 0 || loadingStates.bulkWarehouseMove}
                  className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold shadow-lg transition-transform justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <ArrowRightLeft size={18} /> Về kho tổng
                </button>
                <button
                  onClick={() => handleBulkWarehouseMove("cheap")}
                  disabled={selectedChatgptIds.length === 0 || loadingStates.bulkWarehouseMove}
                  className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold shadow-lg transition-transform justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Globe size={18} /> Đẩy sang kho market
                </button>
                <button
                  onClick={() => handleBulkWarehouseMove("main")}
                  disabled={selectedChatgptIds.length === 0 || loadingStates.bulkWarehouseMove}
                  className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-semibold shadow-lg transition-transform justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Globe size={18} /> Day sang kho duoi 25
                </button>
                <button
                  onClick={handleCopySelectedChatgptMarketplaceFormat}
                  disabled={selectedChatgptIds.length === 0}
                  className="flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg font-semibold shadow-lg transition-transform justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Copy size={18} /> Copy format web
                </button>
                <button
                  onClick={() => setShowImportGPTModal(true)}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-semibold shadow-lg hover:translate-y-[-2px] transition-transform justify-center"
                >
                  <Upload size={18} /> Import Nhanh Tài Khoản
                </button>
              </div>
            </div>

            {/* SUB-TABS: Tat ca / Kho tong / Kho market */}
            {(() => {
              const totalPoolAccounts = accounts.filter(
                (a) =>
                  supportsChatgptMarketType(a?.type) &&
                  !marketplaceTrackedAccountIds.has(String(a?.id || "")) &&
                  !isChatgptMarketWarehouse(a) &&
                  !isChatgptShortDateWarehouse(a),
              );
              const totalCount = totalPoolAccounts.length;
              const marketCount = accounts.filter(
                (a) =>
                  (supportsChatgptMarketType(a?.type) &&
                    isChatgptMarketWarehouse(a)) ||
                  marketplaceTrackedAccountIds.has(String(a?.id || "")),
              ).length;
              const shortDateCount = accounts.filter(
                (a) =>
                  supportsChatgptMarketType(a?.type) &&
                  !marketplaceTrackedAccountIds.has(String(a?.id || "")) &&
                  isChatgptShortDateWarehouse(a),
              ).length;
              const tabs = [
                { key: "all", label: "Tat ca", count: accounts.length, color: "bg-slate-600" },
                { key: "total", label: "Kho tong", count: totalCount, color: "bg-blue-600" },
                { key: "market", label: "Kho market", count: marketCount, color: "bg-emerald-600" },
                { key: "short", label: "Kho duoi 25", count: shortDateCount, color: "bg-amber-600" },
              ];
              return (
                <div className="flex gap-2 flex-wrap mb-4">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setGptSubTab(t.key);
                        if (t.key !== "market") setPackage2ShelfTab("all");
                        if (t.key !== "total") setChatgptTotalTypeTab("all");
                      }}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-bold text-sm transition-all shadow-sm border ${gptSubTab === t.key
                          ? `${t.color} text-white border-transparent`
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700"
                        }`}
                    >
                      {t.label}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${gptSubTab === t.key ? "bg-white/20" : "bg-slate-700 text-slate-300"
                        }`}>{t.count}</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {gptSubTab === "total" && (() => {
              const totalPoolAccounts = accounts.filter(
                (a) =>
                  supportsChatgptMarketType(a?.type) &&
                  !marketplaceTrackedAccountIds.has(String(a?.id || "")) &&
                  !isChatgptMarketWarehouse(a) &&
                  !isChatgptShortDateWarehouse(a),
              );
              const totalTypeTabs = [
                { key: "all", label: "Tat ca", count: totalPoolAccounts.length, color: "bg-slate-600" },
                { key: "package1", label: "Goi 1", count: totalPoolAccounts.filter((a) => a.type === "package1").length, color: "bg-blue-600" },
                { key: "package2", label: "Goi 2", count: totalPoolAccounts.filter((a) => a.type === "package2").length, color: "bg-purple-600" },
                { key: "unassigned", label: "Chua chon", count: totalPoolAccounts.filter((a) => !a?.type || a?.type === "unassigned").length, color: "bg-slate-700" },
              ];
              return (
                <div className="mb-4">
                  <div className="flex gap-2 flex-wrap">
                    {totalTypeTabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setChatgptTotalTypeTab(t.key)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs transition-all border ${
                          chatgptTotalTypeTab === t.key
                            ? `${t.color} text-white border-transparent`
                            : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700"
                        }`}
                      >
                        {t.label}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                          chatgptTotalTypeTab === t.key ? "bg-white/20" : "bg-slate-700 text-slate-300"
                        }`}>
                          {t.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {gptSubTab === "market" && (() => {
              const package2Accs = accounts.filter((a) =>
                supportsChatgptMarketType(a?.type),
              );
              const soldPackage2Accs = package2Accs.filter((acc) =>
                marketplaceTrackedAccountIds.has(String(acc?.id || "")),
              );
              const regularPackage2Accs = package2Accs.filter(
                (acc) =>
                  !marketplaceTrackedAccountIds.has(String(acc?.id || "")) &&
                  isChatgptMarketWarehouse(acc),
              );
              const soldDatammoCount = soldPackage2Accs.filter(
                (acc) =>
                  normalizeMarketplaceProvider(
                    marketplaceTrackedAccountMap.get(String(acc?.id || ""))?.provider,
                  ) === "datammo",
              ).length;
              const soldShopminiCount = soldPackage2Accs.filter(
                (acc) =>
                  normalizeMarketplaceProvider(
                    marketplaceTrackedAccountMap.get(String(acc?.id || ""))?.provider,
                  ) === "shopmini",
              ).length;
              const shelfTabs = [
                { key: "all", label: "Chua ban", count: regularPackage2Accs.length, color: "bg-emerald-600" },
                { key: "sold", label: "Da ban", count: soldPackage2Accs.length, color: "bg-amber-600" },
              ];
              return (
                <div className="mb-4 space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {shelfTabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setPackage2ShelfTab(t.key)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs transition-all border ${package2ShelfTab === t.key
                            ? `${t.color} text-white border-transparent`
                            : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700"
                          }`}
                      >
                        {t.label}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${package2ShelfTab === t.key ? "bg-white/20" : "bg-slate-700 text-slate-300"
                          }`}>{t.count}</span>
                      </button>
                    ))}
                  </div>
                  {package2ShelfTab === "sold" && (
                    <div className="flex gap-2 flex-wrap">
                      {[
                        {
                          key: "all",
                          label: "Tất cả nguồn",
                          count: soldPackage2Accs.length,
                        },
                        {
                          key: "datammo",
                          label: "Datammo",
                          count: soldDatammoCount,
                        },
                        {
                          key: "shopmini",
                          label: "Shopmini",
                          count: soldShopminiCount,
                        },
                      ].map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setSoldPackage2ProviderFilter(option.key)}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs transition-all border ${
                            soldPackage2ProviderFilter === option.key
                              ? "bg-amber-600 text-white border-transparent"
                              : "bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700"
                          }`}
                        >
                          {option.label}
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                              soldPackage2ProviderFilter === option.key
                                ? "bg-white/20"
                                : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {option.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {gptSubTab === "market" && (
              <div className="mb-5 rounded-2xl border border-slate-700 bg-slate-900/60 shadow-lg overflow-hidden">
                <div className="border-b border-slate-700/80 px-4 py-3 md:px-5 md:py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] font-black text-cyan-300">
                        Don san
                      </div>
                      <div className="text-lg font-black text-white">
                        Datammo + Shopmini
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Kho market la kho chung cua Datammo va Shopmini. Ban ben nao cung tu tru kho ben con lai.
                      </div>
                      <div className="mt-1 text-xs text-amber-300">
                        Kho duoi 25 ngay la kho day tay, khong di vao API stock/buy tu dong.
                      </div>
                    </div>
                    <div className="text-xs text-slate-400">
                      Dang hien{" "}
                      <span className="font-bold text-white">
                        {filteredChatgptMarketplaceOrders.length}
                      </span>{" "}
                      / {chatgptMarketplaceOrderSummaries.length} don gan nhat
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex-1 max-w-xl">
                      <input
                        type="text"
                        placeholder="Tim theo order, acc goc, acc bao hanh..."
                        value={marketplaceOrderQuery}
                        onChange={(e) => setMarketplaceOrderQuery(e.target.value)}
                        className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "all", label: "Tat ca" },
                        { value: "datammo", label: "Datammo" },
                        { value: "shopmini", label: "Shopmini" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setMarketplaceOrderProviderFilter(option.value)
                          }
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                            marketplaceOrderProviderFilter === option.value
                              ? "bg-cyan-600 text-white border-cyan-500"
                              : "bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-slate-950/60 text-slate-300 uppercase text-[11px] tracking-[0.12em]">
                      <tr>
                        <th className="px-4 py-3 text-left">Nguon</th>
                        <th className="px-4 py-3 text-left">Order</th>
                        <th className="px-4 py-3 text-left">Acc da ban</th>
                        <th className="px-4 py-3 text-left">Acc hien tai</th>
                        <th className="px-4 py-3 text-left">Bao hanh</th>
                        <th className="px-4 py-3 text-left">Thoi gian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredChatgptMarketplaceOrders.length > 0 ? (
                        filteredChatgptMarketplaceOrders.map((order) => (
                          <tr
                            key={buildDatammoOrderKey(order)}
                            className="border-t border-slate-800/80 align-top"
                          >
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] border ${
                                  order.provider === "shopmini"
                                    ? "bg-orange-500/10 text-orange-200 border-orange-500/30"
                                    : "bg-emerald-500/10 text-emerald-200 border-emerald-500/30"
                                }`}
                              >
                                {order.providerLabel}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-mono text-white font-semibold break-all">
                                {order.orderId || "Khong ro"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                So luong: {order.quantity || order.accountSummaries.length || 0}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-2">
                                {order.accountSummaries.map((item, index) => (
                                  <div
                                    key={`${buildDatammoOrderKey(order)}-sold-${index}`}
                                    className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
                                  >
                                    <div className="font-semibold text-white break-all">
                                      {item.soldUsername || item.soldAccountId || "Khong ro acc"}
                                    </div>
                                    {item.soldAccountId && (
                                      <div className="mt-1 text-[11px] text-slate-500 break-all">
                                        ID: {item.soldAccountId}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-2">
                                {order.accountSummaries.map((item, index) => {
                                  const isReplaced =
                                    String(item.currentAccountId || "") !==
                                    String(item.soldAccountId || "");
                                  return (
                                    <div
                                      key={`${buildDatammoOrderKey(order)}-current-${index}`}
                                      className={`rounded-lg border px-3 py-2 ${
                                        isReplaced
                                          ? "border-cyan-700/40 bg-cyan-950/20"
                                          : "border-slate-800 bg-slate-900/50"
                                      }`}
                                    >
                                      <div className="font-semibold text-white break-all">
                                        {item.currentUsername ||
                                          item.currentAccountId ||
                                          "Khong ro acc"}
                                      </div>
                                      <div
                                        className={`mt-1 text-[11px] font-semibold ${
                                          isReplaced
                                            ? "text-cyan-300"
                                            : "text-slate-500"
                                        }`}
                                      >
                                        {isReplaced
                                          ? "Dang thay bao hanh"
                                          : "Dang dung acc goc"}
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openWarrantyFromMarketplaceOrder(item)
                                          }
                                          className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors"
                                        >
                                          {item.warrantyRounds > 0
                                            ? "Bao hanh tiep"
                                            : "Bao hanh"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            focusMarketplaceAccountFromSummary(item)
                                          }
                                          className="rounded-lg bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors"
                                        >
                                          Toi acc
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-2">
                                {order.accountSummaries.map((item, index) => (
                                  <div
                                    key={`${buildDatammoOrderKey(order)}-warranty-${index}`}
                                    className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
                                  >
                                    <div className="font-semibold text-white">
                                      {item.warrantyRounds > 0
                                        ? `${item.warrantyRounds} lan`
                                        : "Chua bao hanh"}
                                    </div>
                                    {item.warrantyRounds > 0 && item.warrantyCase && (
                                      <div className="mt-1 space-y-1 text-[11px] text-slate-400 break-all">
                                        {item.warrantyCase.rounds.map((round, roundIndex) => (
                                          <div
                                            key={`${buildDatammoOrderKey(order)}-warranty-${index}-round-${round?.sequence || round?.createdAt || roundIndex}`}
                                          >
                                            <span className="font-medium text-amber-200">
                                              Lan {round?.sequence || roundIndex + 1}:
                                            </span>{" "}
                                            {round?.fromUsername ||
                                              round?.fromAccountId ||
                                              "Khong ro acc"}{" "}
                                            {"->"}{" "}
                                            {round?.toUsername ||
                                              round?.toAccountId ||
                                              "Khong ro acc"}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                              {order.createdAt
                                ? new Date(order.createdAt).toLocaleString("vi-VN")
                                : "--"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t border-slate-800/80">
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-sm text-slate-500"
                          >
                            Khong co don nao khop bo loc hien tai.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div
              style={{
                background: "#1e293b",
                borderRadius: "20px",
                padding: "0",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                border: "1px solid #334155",
                overflow: "hidden",
              }}
            >
              <div className="overflow-x-auto w-full">
                <table className="legacy-table w-full border-collapse min-w-[800px]">
                  <thead>
                    <tr style={{ background: "rgba(15, 23, 42, 0.6)" }}>
                      <th className="w-12 text-center">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={(e) =>
                            handleToggleSelectAllFilteredChatgpt(
                              e.target.checked,
                              filteredChatgptIds,
                            )
                          }
                          title="Chọn tất cả tài khoản đang lọc"
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                      </th>
                      <th className="w-40">
                        {gptSubTab === "market" ? "Kho / Trạng thái" : "Loại Gói"}
                      </th>
                      <th>Thông Tin</th>
                      <th className="w-32">Link Mail</th>
                      <th className="w-64">Slot / Khách (Sửa/Xóa)</th>
                      <th className="text-center w-24">Hành Động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChatgptAccounts.map((acc) => (
                        <tr
                          id={`chatgpt-account-row-${acc.id}`}
                          key={acc.id}
                          className={`hover:bg-slate-800/50 transition-colors ${
                            String(highlightedChatgptAccountId || "") ===
                            String(acc.id || "")
                              ? "bg-cyan-900/20 ring-1 ring-cyan-500/50"
                              : ""
                          }`}
                        >
                          <td className="align-top text-center">
                            <input
                              type="checkbox"
                              checked={selectedChatgptIdSet.has(String(acc.id || ""))}
                              onChange={(e) =>
                                handleToggleChatgptSelection(acc.id, e.target.checked)
                              }
                              title="Chọn tài khoản"
                              className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer"
                            />
                          </td>
                          <td className="align-top">
                            {gptSubTab === "market" && (
                              <div
                                className={`w-full text-xs rounded px-2 py-2 outline-none font-bold border text-center ${
                                  marketplaceTrackedAccountIds.has(String(acc.id || ""))
                                    ? "bg-amber-900/40 text-amber-300 border-amber-700/50"
                                    : "bg-emerald-900/40 text-emerald-300 border-emerald-700/60"
                                }`}
                              >
                                {marketplaceTrackedAccountIds.has(String(acc.id || ""))
                                  ? "Acc da ban"
                                  : "Acc market"}
                              </div>
                            )}
                            <select
                              id={`select-type-${acc.id}`}
                              value={acc.type}
                              onChange={(e) =>
                                handleTypeChange(acc, e.target.value)
                              }
                              disabled={loadingStates.changeType[acc.id]}
                              className={`
                                            ${gptSubTab === "market" ? "hidden" : "w-full"} text-xs rounded px-2 py-2 outline-none font-bold border cursor-pointer appearance-none text-center
                                            ${loadingStates.changeType[acc.id] ? "opacity-50 cursor-wait" : ""}
                                            ${acc.type === "package1"
                                  ? "bg-blue-900/40 text-blue-400 border-blue-700/50"
                                  : acc.type === "package2"
                                    ? "bg-purple-900/40 text-purple-400 border-purple-700/50"
                                    : "bg-slate-800 text-slate-400 border-slate-700"
                                }
                                        `}
                            >
                              <option value="unassigned">❓ Chọn Gói...</option>
                              <option value="package1">
                                👥 Gói 1: Chia sẻ
                              </option>
                              <option value="package2">
                                🔒 Gói 2: Linh hoạt
                              </option>
                            </select>
                            {supportsChatgptMarketType(acc.type) && (
                              <div className="mt-2">
                                {marketplaceTrackedAccountIds.has(String(acc?.id || "")) ? (
                                  <div className="w-full rounded px-2 py-1.5 text-center text-[11px] font-semibold border bg-amber-900/40 text-amber-200 border-amber-700/60">
                                    Khoa don san
                                  </div>
                                ) : (
                                  <select
                                    value={normalizePackage2Shelf(acc.package2Shelf)}
                                    onChange={(e) =>
                                      handlePackage2ShelfChange(acc, e.target.value)
                                    }
                                    title={
                                      hasAssignedCustomer(acc)
                                        ? "Tai khoan dang co khach nen khong the doi kho"
                                        : "Doi kho tai khoan"
                                    }
                                    disabled={
                                      loadingStates.changeType[acc.id] ||
                                      loadingStates.changeShelf[acc.id] ||
                                      hasAssignedCustomer(acc)
                                    }
                                    className={`
                                      w-full text-[11px] rounded px-2 py-1.5 outline-none font-semibold border text-center
                                      ${normalizePackage2Shelf(acc.package2Shelf) === "none"
                                        ? "bg-slate-800 text-slate-300 border-slate-600"
                                        : normalizePackage2Shelf(acc.package2Shelf) === "main"
                                          ? "bg-amber-900/40 text-amber-300 border-amber-700/60"
                                          : "bg-emerald-900/40 text-emerald-300 border-emerald-700/60"}
                                    `}
                                  >
                                    <option value="none">Kho tong</option>
                                    <option value="cheap">Kho market</option>
                                    <option value="main">Kho duoi 25 ngay</option>
                                  </select>
                                )}
                                {loadingStates.changeShelf[acc.id] && (
                                  <div className="text-center mt-1 text-[10px] text-emerald-300">Dang cap nhat kho...</div>
                                )}
                              </div>
                            )}
                            {loadingStates.changeType[acc.id] && (
                              <div className="text-center mt-1">
                                <Loader2
                                  size={14}
                                  className="animate-spin inline text-blue-400"
                                />
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="font-bold text-white mb-2 flex items-center gap-2 text-base">
                              <User size={16} className="text-slate-400" />
                              <span className="font-mono text-lg">{acc.username}</span>
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2"
                                onClick={() => handleCopy(acc.username, "Đã copy Tên Tài Khoản")}
                                title="Copy Username"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            </div>
                          <div className="text-slate-400 flex items-center gap-2 font-mono text-sm mt-1">
                              <span className="w-20 text-slate-400 text-xs">Mật khẩu:</span>
                              <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                onClick={() => handleCopy(acc.password, "Đã copy Mật khẩu")}
                                title="Copy Password"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            </div>
                            {acc.otpSecret && (
                              <div className="text-slate-400 flex items-start gap-2 font-mono text-sm mt-2">
                                <span className="w-20 text-slate-400 text-xs pt-1">2FA:</span>
                                <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-cyan-200 min-w-[120px] break-all">
                                  {acc.otpSecret}
                                </span>
                                <button
                                  className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                  onClick={() =>
                                    handleCopy(
                                      buildChatgpt2faCopyText(acc.otpSecret),
                                      "Đã copy mã 2FA & hướng dẫn lấy mã đăng nhập",
                                    )
                                  }
                                  title="Copy 2FA Secret"
                                >
                                  <Copy size={14} /> Copy
                                </button>
                                <a
                                  href={buildChatgpt2faLiveUrl(acc.otpSecret)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bg-cyan-700 hover:bg-cyan-600 px-2.5 py-1 rounded text-white text-xs font-bold inline-flex items-center gap-1 transition-colors"
                                  title="Mở 2fa.live"
                                >
                                  <ExternalLink size={14} /> 2fa.live
                                </a>
                              </div>
                            )}
                            {acc.otpSecret && (
                              <div className="text-[11px] text-cyan-300/80 mt-1 ml-[88px]">
                                Dùng mã 2FA này trên 2fa.live để lấy mã đăng nhập.
                              </div>
                            )}
                            <div className="mt-3">
                              <button
                                className="bg-indigo-600/80 hover:bg-indigo-400 px-3 py-1.5 rounded text-white text-xs font-bold flex items-center gap-2 transition-transform shadow-md hover:-translate-y-0.5"
                                onClick={() => handleCopy(buildChatgptCopyText(acc), getChatgptCopySuccessText(acc))}
                              >
                                <Copy size={14} /> {getChatgptCopyButtonText(acc)}
                              </button>
                            </div>
                            {acc.expiredAt && (
                              <div
                                className={`text-xs mt-3 ml-6 flex items-center gap-1 ${getExpiryStatus(acc.expiredAt).color}`}
                              >
                                <Calendar size={10} />
                                <span>{getExpiryStatus(acc.expiredAt).text}</span>
                                <span className="text-slate-600 italic">({formatDate(acc.expiredAt)})</span>
                              </div>
                            )}
                            {getVisibleAccountNote(acc.note) && (
                              <div className="text-xs text-yellow-500/80 italic mt-2 ml-6 bg-yellow-900/10 p-1.5 rounded inline-block">
                                📝 {getVisibleAccountNote(acc.note)}
                              </div>
                            )}
                          </td>
                          <td className="align-top pt-4">
                            {acc.link ? (
                              <div className="flex flex-col gap-2">
                                <a
                                  href={acc.link}
                                  target="_blank"
                                  className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-1.5 rounded-md font-bold no-underline inline-flex items-center gap-2 shadow-md transition-transform hover:scale-105 justify-center w-[100px]"
                                >
                                  <Mail size={14} /> Mở Mail
                                </a>
                                <button
                                  onClick={() => handleCopy(acc.link, "Đã copy Link Mail")}
                                  className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded flex items-center gap-1 text-xs text-white transition-colors font-bold justify-center w-[100px]"
                                  title="Copy Link Mail"
                                >
                                  <Copy size={14} /> Copy Link
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-xs">--</span>
                            )}
                          </td>
                          <td>
                            {acc.type === "package1" ? (
                              <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                <div className="flex justify-between items-center text-xs mb-2 pb-1 border-b border-slate-700/50">
                                  <span
                                    style={{
                                      color:
                                        acc.users?.length >= 3
                                          ? "#ef4444"
                                          : "#10b981",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    {acc.users?.length || 0}/3 Slot
                                  </span>
                                  {acc.users?.length < 3 ? (
                                    <button
                                      type="button"
                                      onClick={() => openAddUserModal(acc.id)}
                                      className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white whitespace-nowrap"
                                    >
                                      + Khach
                                    </button>
                                  ) : (
                                    <span className="text-xs text-red-400 font-bold italic">Đã Đầy</span>
                                  )}
                                </div>
                                {isChatgptMarketWarehouse(acc) && !marketplaceTrackedAccountIds.has(String(acc?.id || "")) && (
                                  <div className="mb-2 w-full px-2 py-0.5 bg-emerald-900/40 text-emerald-300 font-bold rounded text-[10px] uppercase border border-emerald-800/50 flex items-center justify-center gap-1 shadow-sm">
                                    <Globe size={10} /> Kho market - chua ban
                                  </div>
                                )}
                                {isChatgptShortDateWarehouse(acc) && !marketplaceTrackedAccountIds.has(String(acc?.id || "")) && (
                                  <div className="mb-2 w-full px-2 py-0.5 bg-amber-900/40 text-amber-300 font-bold rounded text-[10px] uppercase border border-amber-800/50 flex items-center justify-center gap-1 shadow-sm">
                                    <Globe size={10} /> Kho duoi 25 ngay - day tay
                                  </div>
                                )}
                                <div className="space-y-1">
                                  {acc.users?.map((u, index) => {
                                    const name = getUserName(u);
                                    const dateStr = getUserDate(u);
                                    const daysUsed = getDaysUsed(u);
                                    const daysRemaining = getDaysRemaining(u);

                                    // EXPIRY LOGIC (dựa trên ngày CÒN LẠI, không phải đã dùng)
                                    const isExpired =
                                      daysRemaining !== null && daysRemaining <= 0;
                                    const isNearExpiry =
                                      daysRemaining !== null &&
                                      daysRemaining > 0 &&
                                      daysRemaining <= 3;

                                    return (
                                      <div
                                        key={index}
                                        className={`flex justify-between items-center text-xs p-2 rounded border mb-1 ${isExpired ? "bg-red-900/20 border-red-700" : "bg-slate-800 border-slate-700/50"}`}
                                      >
                                        <div className="flex flex-col">
                                          <span
                                            className={`font-bold truncate max-w-[120px] flex items-center gap-1 ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-400" : "text-white"}`}
                                            title={name}
                                          >
                                            {isExpired && (
                                              <AlertCircle size={12} />
                                            )}
                                            {isNearExpiry && (
                                              <AlertTriangle size={12} />
                                            )}
                                            👤 {name}
                                          </span>
                                          {dateStr ? (
                                            <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                                              <Calendar size={10} /> {dateStr}
                                              {daysRemaining !== null && (
                                                <span
                                                  className={
                                                    isExpired
                                                      ? "text-red-400 font-bold"
                                                      : isNearExpiry
                                                        ? "text-yellow-500 font-bold"
                                                        : daysRemaining > 30
                                                          ? "text-purple-400 font-bold"
                                                          : "text-blue-400"
                                                  }
                                                >
                                                  {isExpired
                                                    ? `(HH ${Math.abs(daysRemaining)}ngày)`
                                                    : `(Còn ${daysRemaining}ngày)`}
                                                </span>
                                              )}
                                            </span>
                                          ) : (
                                            <span className="text-[10px] text-slate-600 italic">
                                              Chưa có ngày
                                            </span>
                                          )}
                                          {/* Ngày hết hạn khách */}
                                          {getUserExpiryDate(u) && (
                                            <span className={`text-[10px] flex items-center gap-1 font-semibold ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-500" : "text-emerald-500"
                                              }`}>
                                              🕑 HH: {getUserExpiryDate(u)}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex gap-1">
                                          {/* EXTEND BUTTON (Only for Expired/Near Expiry) */}
                                          {(isExpired || isNearExpiry) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleExtendUser(
                                                  acc.id,
                                                  index,
                                                  u,
                                                )
                                              }
                                              className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                              title="Gia hạn"
                                            >
                                              <RotateCw size={14} />
                                            </button>
                                          )}

                                          {/* MOVE BUTTON (Blocked if Expired) */}
                                          {!isExpired ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openMoveUserModal(
                                                  acc.id,
                                                  index,
                                                  u,
                                                )
                                              }
                                              className="bg-orange-600 hover:bg-orange-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                              title="Chuyển khách"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </button>
                                          ) : (
                                            <span
                                              className="text-gray-500 cursor-not-allowed bg-slate-700 p-1.5 rounded"
                                              title="Hết hạn: Không thể chuyển"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </span>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              openEditUserModal(
                                                acc.id,
                                                index,
                                                u,
                                              )
                                            }
                                            className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                            title="Sửa tên"
                                          >
                                            <Pencil size={14} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteUser(
                                                acc.id,
                                                index,
                                                name,
                                              )
                                            }
                                            className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                            title="Xóa người này"
                                          >
                                            <X size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : acc.type === "package2" ||
                              isChatgptMarketWarehouse(acc) ||
                              isChatgptShortDateWarehouse(acc) ||
                              marketplaceTrackedAccountIds.has(String(acc?.id || "")) ? (
                              (() => {
                                const u = acc.users?.[0];
                                const package2Shelf = normalizePackage2Shelf(acc.package2Shelf);
                                const package2ShelfLabel = getChatgptWarehouseLabel(package2Shelf);
                                const isTrackedMarketplaceAccount =
                                  marketplaceTrackedAccountIds.has(String(acc?.id || ""));
                                const trackedMarketplaceEntry =
                                  marketplaceTrackedAccountMap.get(String(acc?.id || ""));
                                const trackedMarketplaceSummary =
                                  trackedMarketplaceEntry?.summary || null;
                                const isInMarketWarehouse = package2Shelf === "cheap";
                                const isOnDatammoShelf = isInMarketWarehouse;
                                const legacyMarketplaceInfo =
                                  getLegacyMarketplaceInfoFromNote(acc.note);
                                const managedOrderInfo = getMarketplaceOrderInfoFromUser(u);
                                const latestMarketplaceOrder = findMarketplaceOrderForAccount(
                                  acc.id,
                                  datammoOrderHistory,
                                  managedOrderInfo.provider,
                                );
                                const datammoOrderId = String(
                                  managedOrderInfo.orderId ||
                                    legacyMarketplaceInfo?.orderId ||
                                    trackedMarketplaceEntry?.orderId ||
                                    latestMarketplaceOrder?.orderId ||
                                    "",
                                ).trim();
                                const managedProvider = normalizeMarketplaceProvider(
                                  managedOrderInfo.provider ||
                                    legacyMarketplaceInfo?.provider ||
                                    trackedMarketplaceEntry?.provider ||
                                    latestMarketplaceOrder?.provider,
                                );
                                const providerLabel = getMarketplaceProviderLabel(
                                  managedProvider,
                                );
                                const hasActualManagedMarketplaceUser =
                                  !!u && isDatammoManagedUser(u);
                                const hasRegularVisibleUser =
                                  !!u && !isDatammoManagedUser(u);
                                const warrantyInfo = getDatammoWarrantyInfoForAccount(
                                  acc.id,
                                  datammoWarrantyCases,
                                );
                                const trackedMarketplaceRole = String(
                                  trackedMarketplaceEntry?.role || "",
                                ).trim();
                                const hasActiveMarketplaceTracking =
                                  trackedMarketplaceRole === "sold" ||
                                  trackedMarketplaceRole === "current";
                                const warrantyCase = warrantyInfo?.warrantyCase;
                                const warrantyProviderLabel = getMarketplaceProviderLabel(
                                  warrantyCase?.provider || managedProvider,
                                );
                                const warrantyRounds = Array.isArray(warrantyCase?.rounds)
                                  ? warrantyCase.rounds
                                  : [];
                                const warrantyRoleLabel =
                                  warrantyInfo?.role === "current"
                                    ? "Acc dang thay"
                                    : warrantyInfo?.role === "history"
                                      ? "Acc da thay"
                                      : "Acc loi goc";
                                const latestWarrantyTarget =
                                  warrantyCase?.currentUsername ||
                                  warrantyRounds[warrantyRounds.length - 1]?.toUsername ||
                                  warrantyCase?.currentAccountId ||
                                  "";
                                const showMarketplaceManagementCard =
                                  hasActualManagedMarketplaceUser ||
                                  isTrackedMarketplaceAccount ||
                                  !!warrantyCase;
                                const displayMarketplaceUser = hasRegularVisibleUser
                                  ? u
                                  : hasActualManagedMarketplaceUser
                                    ? u
                                    : showMarketplaceManagementCard
                                      ? {
                                          name:
                                            legacyMarketplaceInfo?.name ||
                                            trackedMarketplaceEntry?.label ||
                                            trackedMarketplaceSummary?.currentUsername ||
                                            trackedMarketplaceSummary?.soldUsername ||
                                            `${providerLabel}#${datammoOrderId || "order"}`,
                                          joinedAt:
                                            legacyMarketplaceInfo?.joinedAt ||
                                            trackedMarketplaceEntry?.order?.createdAt ||
                                            latestMarketplaceOrder?.createdAt ||
                                            "",
                                          expiredAt:
                                            legacyMarketplaceInfo?.expiredAt ||
                                            "",
                                        }
                                      : null;
                                const displayMarketplaceName = String(
                                  getUserName(displayMarketplaceUser) ||
                                    trackedMarketplaceEntry?.label ||
                                    trackedMarketplaceSummary?.currentUsername ||
                                    trackedMarketplaceSummary?.soldUsername ||
                                    "",
                                ).trim();
                                const soldMarketplaceUsername = String(
                                  trackedMarketplaceSummary?.soldUsername ||
                                    acc?.username ||
                                    "",
                                ).trim();
                                const currentMarketplaceUsername = String(
                                  warrantyCase?.currentUsername ||
                                    trackedMarketplaceSummary?.currentUsername ||
                                    soldMarketplaceUsername ||
                                    acc?.username ||
                                    "",
                                ).trim();
                                const displayMarketplaceJoinedDate =
                                  getUserDate(displayMarketplaceUser) ||
                                  formatDate(
                                    trackedMarketplaceEntry?.order?.createdAt ||
                                      latestMarketplaceOrder?.createdAt,
                                  ) ||
                                  "--";
                                const displayMarketplaceExpiryDate =
                                  getUserExpiryDate(displayMarketplaceUser) ||
                                  formatDate(acc?.expiredAt) ||
                                  "";
                                const canOpenDatammoWarranty =
                                  showMarketplaceManagementCard && !!datammoOrderId;
                                const renderWarrantySummary = (extraClasses = "") => {
                                  if (!warrantyCase || warrantyRounds.length === 0) {
                                    return null;
                                  }
                                  return (
                                    <div
                                      className={`${extraClasses} rounded-md border px-2.5 py-2 text-[10px] shadow-sm ${
                                        warrantyInfo?.role === "current"
                                          ? "border-cyan-700/50 bg-cyan-950/20 text-cyan-100"
                                          : "border-amber-700/50 bg-amber-950/20 text-amber-100"
                                      }`}
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-full border border-white/10 bg-slate-900/70 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-white">
                                          {warrantyProviderLabel}
                                        </span>
                                        <span className="text-[10px] font-bold text-white">
                                          Bao hanh lan {warrantyRounds.length}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-[10px] text-slate-300">
                                        Don {warrantyCase.orderId || datammoOrderId || "?"}
                                      </div>
                                      <div className="mt-0.5 text-[10px]">
                                        <span
                                          className={
                                            warrantyInfo?.role === "current"
                                              ? "text-cyan-200"
                                              : "text-amber-200"
                                          }
                                        >
                                          {warrantyRoleLabel}
                                        </span>
                                        {warrantyInfo?.role === "current" ? (
                                          <span className="text-slate-300">
                                            {" "}
                                            • Acc hien tai cua don
                                          </span>
                                        ) : latestWarrantyTarget ? (
                                          <span className="text-slate-300">
                                            {" "}
                                            • Hien tai:{" "}
                                            <span className="font-semibold text-white">
                                              {latestWarrantyTarget}
                                            </span>
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="hidden mt-2 space-y-1.5">
                                        {warrantyRounds.map((round, roundIndex) => {
                                          const isRoundSource =
                                            String(round?.fromAccountId || "") ===
                                            String(acc.id || "");
                                          const isRoundTarget =
                                            String(round?.toAccountId || "") ===
                                            String(acc.id || "");
                                          return (
                                            <div
                                              key={`${acc.id}-warranty-round-${round?.sequence || round?.createdAt || roundIndex}`}
                                              className={`rounded-md border px-2 py-1.5 ${
                                                isRoundTarget
                                                  ? "border-cyan-400/30 bg-cyan-500/10"
                                                  : isRoundSource
                                                    ? "border-amber-400/30 bg-amber-500/10"
                                                    : "border-slate-700/60 bg-slate-950/40"
                                              }`}
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <span className="text-[9px] font-black uppercase tracking-[0.08em] text-white/90">
                                                  Lan {round?.sequence || roundIndex + 1}
                                                </span>
                                                {isRoundTarget && (
                                                  <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                                                    Acc nay
                                                  </span>
                                                )}
                                                {isRoundSource && !isRoundTarget && (
                                                  <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-amber-200">
                                                    Da doi ra
                                                  </span>
                                                )}
                                              </div>
                                              <div className="mt-1 break-all leading-relaxed text-slate-200">
                                                <span className="text-slate-400">
                                                  {round?.fromUsername ||
                                                    round?.fromAccountId ||
                                                    "Khong ro acc"}
                                                </span>
                                                <span className="mx-1 text-slate-500">→</span>
                                                <span className="font-semibold text-white">
                                                  {round?.toUsername ||
                                                    round?.toAccountId ||
                                                    "Khong ro acc"}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                };
                                const daysRemaining = displayMarketplaceUser
                                  ? getDaysRemaining(displayMarketplaceUser)
                                  : null;
                                const isExpired = daysRemaining !== null && daysRemaining <= 0;
                                const isNearExpiry =
                                  daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;
                                const marketplaceCardClasses =
                                  warrantyInfo?.role === "current"
                                    ? "border-cyan-700/50 bg-cyan-950/20 text-cyan-100"
                                    : warrantyCase
                                      ? "border-amber-700/50 bg-amber-950/20 text-amber-100"
                                      : "border-indigo-700/40 bg-indigo-950/20 text-indigo-100";
                                const marketplaceChipClasses =
                                  warrantyInfo?.role === "current"
                                    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-200"
                                    : warrantyCase
                                      ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                                      : "border-indigo-500/30 bg-indigo-500/15 text-indigo-200";
                                const marketplaceStatusLabel = warrantyCase
                                  ? warrantyInfo?.role === "current"
                                    ? "Dang bao hanh"
                                    : "Lich su bao hanh"
                                  : "Da ban";

                                return (
                                  <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                    {displayMarketplaceUser ? (
                                      showMarketplaceManagementCard ? (
                                        <div
                                          className={`rounded-xl border px-3 py-3 shadow-sm ${marketplaceCardClasses}`}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/40">
                                                  <Shield size={12} />
                                                </span>
                                                <div>
                                                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white">
                                                    Don san
                                                  </div>
                                                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-300">
                                                    {providerLabel} · {displayMarketplaceName || "Khach san"}
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                            <span
                                              className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${marketplaceChipClasses}`}
                                            >
                                              {marketplaceStatusLabel}
                                            </span>
                                          </div>

                                          <div className="mt-3 space-y-1.5 text-[10px]">
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-slate-400">Order</span>
                                              <span className="font-semibold text-white">
                                                {datammoOrderId || "Khong ro"}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-slate-400">Khach san</span>
                                              <span className="font-semibold text-white">
                                                {displayMarketplaceName || "--"}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-slate-400">Acc da ban</span>
                                              <span className="font-semibold text-white">
                                                {soldMarketplaceUsername || "--"}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-slate-400">Acc hien tai</span>
                                              <span className="font-semibold text-white">
                                                {currentMarketplaceUsername || "--"}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-slate-400">Ngay vao</span>
                                              <span className="font-semibold text-white">
                                                {displayMarketplaceJoinedDate}
                                              </span>
                                            </div>
                                            {displayMarketplaceExpiryDate && (
                                              <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-400">Het han</span>
                                                <span
                                                  className={`font-semibold ${
                                                    isExpired
                                                      ? "text-red-300"
                                                      : isNearExpiry
                                                        ? "text-yellow-300"
                                                        : "text-emerald-300"
                                                  }`}
                                                >
                                                  {displayMarketplaceExpiryDate}
                                                </span>
                                              </div>
                                            )}
                                            {daysRemaining !== null && (
                                              <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-400">Tinh trang</span>
                                                <span
                                                  className={`font-semibold ${
                                                    isExpired
                                                      ? "text-red-300"
                                                      : isNearExpiry
                                                        ? "text-yellow-300"
                                                        : "text-cyan-200"
                                                  }`}
                                                >
                                                  {isExpired
                                                    ? `Het han ${Math.abs(daysRemaining)} ngay`
                                                    : `Con ${daysRemaining} ngay`}
                                                </span>
                                              </div>
                                            )}
                                          </div>

                                          <div className="mt-3 flex flex-wrap gap-1.5">
                                            <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                                              {providerLabel}
                                            </span>
                                            <span className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/80">
                                              Da ban
                                            </span>
                                            {warrantyCase && (
                                              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-200">
                                                Bao hanh lan {warrantyRounds.length}
                                              </span>
                                            )}
                                          </div>

                                          {warrantyCase && (
                                            <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 px-2.5 py-2 text-[10px] text-slate-200">
                                              <div className="font-semibold text-white">
                                                {warrantyRoleLabel}
                                              </div>
                                              {warrantyInfo?.role === "current" ? (
                                                <div className="mt-1 text-slate-300">
                                                  Acc nay dang la acc hien tai cua don.
                                                </div>
                                              ) : latestWarrantyTarget ? (
                                                <div className="mt-1 text-slate-300">
                                                  Hien tai dang thay boi{" "}
                                                  <span className="font-semibold text-white">
                                                    {latestWarrantyTarget}
                                                  </span>
                                                </div>
                                              ) : null}
                                            </div>
                                          )}

                                          <div
                                            className={`mt-3 grid gap-2 ${
                                              hasActualManagedMarketplaceUser &&
                                              (isExpired || isNearExpiry)
                                                ? "grid-cols-2"
                                                : "grid-cols-1"
                                            }`}
                                          >
                                            {canOpenDatammoWarranty && (
                                              <button
                                                type="button"
                                                onClick={() => openWarrantyModal(acc)}
                                                className="rounded-lg bg-cyan-700 hover:bg-cyan-600 px-2.5 py-2 text-[11px] font-bold text-white transition-colors"
                                                title={`Bảo hành ${providerLabel}`}
                                              >
                                                Bao hanh
                                              </button>
                                            )}
                                            {(isExpired || isNearExpiry) && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleExtendUser(acc.id, 0, u)
                                                }
                                                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-2.5 py-2 text-[11px] font-bold text-white transition-colors"
                                                title="Gia hạn"
                                              >
                                                Gia han
                                              </button>
                                            )}
                                            <div
                                              className={`rounded-lg border border-slate-700 bg-slate-950/50 px-2.5 py-2 text-center text-[11px] font-bold text-slate-300 ${
                                                canOpenDatammoWarranty ||
                                                (hasActualManagedMarketplaceUser &&
                                                  (isExpired || isNearExpiry))
                                                  ? "col-span-2"
                                                  : ""
                                              }`}
                                            >
                                              Acc da ban qua san - khong chuyen tay. Neu can doi acc, hay dung Bao hanh.
                                            </div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div
                                          className={`flex justify-between items-center text-sm font-bold p-1 rounded ${isExpired ? "bg-red-900/20" : ""}`}
                                        >
                                          <div
                                            className={
                                              isExpired
                                                ? "text-red-400"
                                                : "text-white"
                                            }
                                          >
                                            <span className="flex items-center gap-2">
                                              {isExpired && (
                                                <AlertCircle
                                                  size={14}
                                                  className="text-red-500"
                                                />
                                              )}
                                              {isNearExpiry && (
                                                <AlertTriangle
                                                  size={14}
                                                  className="text-yellow-500"
                                                />
                                              )}
                                              👤 {getUserName(displayMarketplaceUser)}
                                            </span>
                                            <span
                                              className={`text-[10px] block ml-6 ${isExpired
                                                ? "text-red-300"
                                                : isNearExpiry
                                                  ? "text-yellow-400"
                                                  : daysRemaining !== null && daysRemaining > 30
                                                    ? "text-purple-400"
                                                    : "text-slate-400"
                                                }`}
                                            >
                                              {displayMarketplaceJoinedDate}
                                              {daysRemaining !== null && (
                                                <span className="ml-1">
                                                  {isExpired
                                                    ? `(HH ${Math.abs(daysRemaining)}ngày)`
                                                    : `(Còn ${daysRemaining}ngày)`}
                                                </span>
                                              )}
                                            </span>
                                            {displayMarketplaceExpiryDate && (
                                              <span className={`text-[10px] block ml-6 font-semibold ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-500" : "text-emerald-500"
                                                }`}>
                                                🕑 HH: {displayMarketplaceExpiryDate}
                                              </span>
                                            )}
                                            {renderWarrantySummary("mt-2 ml-6")}
                                          </div>
                                          <div className="flex gap-2">
                                            {hasActualManagedMarketplaceUser &&
                                              (isExpired || isNearExpiry) && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleExtendUser(acc.id, 0, u)
                                                }
                                                className="text-green-400 hover:text-white"
                                                title="Gia hạn"
                                              >
                                                <RotateCw size={14} />
                                              </button>
                                            )}
                                            {!showMarketplaceManagementCard ? (
                                              !isExpired ? (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openMoveUserModal(
                                                      acc.id,
                                                      0,
                                                      displayMarketplaceUser,
                                                    )
                                                  }
                                                  className="text-orange-400 hover:text-white"
                                                  title="Chuyen khach"
                                                >
                                                  <ArrowRightLeft size={14} />
                                                </button>
                                              ) : (
                                                <span
                                                  className="text-slate-500 cursor-not-allowed"
                                                  title="Het han: Khong the chuyen"
                                                >
                                                  <ArrowRightLeft size={14} />
                                                </span>
                                              )
                                            ) : (
                                              <span
                                                className="text-slate-500 cursor-not-allowed"
                                                title="Acc da ban qua san khong duoc chuyen tay"
                                              >
                                                <ArrowRightLeft size={14} />
                                              </span>
                                            )}
                                            {!showMarketplaceManagementCard && (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openEditUserModal(
                                                      acc.id,
                                                      0,
                                                      displayMarketplaceUser,
                                                    )
                                                  }
                                                  className="text-blue-400 hover:text-white"
                                                  title="Sua khach"
                                                >
                                                  <Pencil size={14} />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleDeleteUser(
                                                      acc.id,
                                                      0,
                                                      getUserName(displayMarketplaceUser),
                                                    )
                                                  }
                                                  className="text-red-400 hover:text-white"
                                                  title="Xoa khach"
                                                >
                                                  <X size={14} />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    ) : (
                                      <div className="flex flex-col gap-2">
                                        {renderWarrantySummary()}
                                        {(() => {
                                          const warehouseCardClasses = isOnDatammoShelf
                                            ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-100"
                                            : package2Shelf === "main"
                                              ? "border-amber-700/50 bg-amber-950/20 text-amber-100"
                                              : "border-slate-700/60 bg-slate-900/80 text-slate-100";
                                          const warehouseChipClasses = isOnDatammoShelf
                                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                                            : package2Shelf === "main"
                                              ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                                              : "border-slate-600/60 bg-slate-800 text-slate-200";
                                          const warehouseTitle = isOnDatammoShelf
                                            ? "Kho market"
                                            : package2Shelf === "main"
                                              ? "Kho duoi 25 ngay"
                                              : "Kho tong";
                                          const warehouseStatus = isOnDatammoShelf
                                            ? "Chua ban"
                                            : package2Shelf === "main"
                                              ? "Day tay"
                                              : "San sang";
                                          const warehouseDescription = isOnDatammoShelf
                                            ? "Acc dang nam trong kho market va se duoc ban tu dong qua Datammo + Shopmini."
                                            : package2Shelf === "main"
                                              ? "Acc duoi 25 ngay, chi de day tay va khong di vao API stock/buy."
                                              : "Acc dang nam o kho tong, co the them khach tay hoac chuyen sang kho khac.";
                                          return (
                                            <div
                                              className={`rounded-xl border px-3 py-3 shadow-sm ${warehouseCardClasses}`}
                                            >
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                  <div className="flex items-center gap-2">
                                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/40">
                                                      <Globe size={12} />
                                                    </span>
                                                    <div>
                                                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white">
                                                        {warehouseTitle}
                                                      </div>
                                                      <div className="mt-0.5 text-[10px] leading-relaxed text-slate-300">
                                                        {warehouseDescription}
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                                <span
                                                  className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${warehouseChipClasses}`}
                                                >
                                                  {warehouseStatus}
                                                </span>
                                              </div>
                                              {isOnDatammoShelf && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                  <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-200">
                                                    Datammo
                                                  </span>
                                                  <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                                                    Shopmini
                                                  </span>
                                                  <span className="rounded-full border border-white/10 bg-slate-950/50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/80">
                                                    1 acc / 1 thang
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {isOnDatammoShelf ? (
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() => openAddUserModal(acc.id, "[Datammo] Khach moi")}
                                              className="w-full text-center text-xs px-2 py-1.5 bg-teal-700 hover:bg-teal-600 font-bold rounded text-white transition-colors"
                                              title="Gan Khach va tu dien ten Datammo"
                                            >
                                              + Datammo
                                            </button>
                                          </div>
                                        ) : !marketplaceTrackedAccountIds.has(String(acc?.id || "")) ? (
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() => openAddUserModal(acc.id)}
                                              className="w-full text-center text-xs px-2 py-1.5 bg-blue-700 hover:bg-blue-600 font-bold rounded text-white transition-colors"
                                              title="Them khach thuong"
                                            >
                                              + Khach
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-yellow-600 text-xs italic">
                                Chọn gói trước
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            <div className="flex justify-center gap-2">
                              {(() => {
                                const primaryUser = Array.isArray(acc.users)
                                  ? acc.users[0]
                                  : null;
                                const trackedMarketplaceEntry =
                                  marketplaceTrackedAccountMap.get(String(acc?.id || ""));
                                const trackedMarketplaceRole = String(
                                  trackedMarketplaceEntry?.role || "",
                                ).trim();
                                const hasActiveMarketplaceTracking =
                                  trackedMarketplaceRole === "sold" ||
                                  trackedMarketplaceRole === "current";
                                const hasActualManagedMarketplaceUser =
                                  !!primaryUser && isDatammoManagedUser(primaryUser);
                                const managedOrderInfo =
                                  getMarketplaceOrderInfoFromUser(primaryUser);
                                const latestMarketplaceOrder =
                                  findMarketplaceOrderForAccount(
                                    acc.id,
                                    datammoOrderHistory,
                                    managedOrderInfo.provider,
                                  );
                                const marketplaceOrderId = String(
                                  managedOrderInfo.orderId ||
                                    trackedMarketplaceEntry?.orderId ||
                                    latestMarketplaceOrder?.orderId ||
                                    "",
                                ).trim();
                                const warrantyInfo = getDatammoWarrantyInfoForAccount(
                                  acc.id,
                                  datammoWarrantyCases,
                                );
                                const canOpenWarranty =
                                  (!!marketplaceOrderId &&
                                    (hasActualManagedMarketplaceUser ||
                                      hasActiveMarketplaceTracking)) ||
                                  warrantyInfo?.role === "current";
                                if (!canOpenWarranty) return null;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => openWarrantyModal(acc)}
                                    className="bg-slate-700 hover:bg-cyan-600 text-slate-300 hover:text-white p-2 rounded transition-colors"
                                    title="Bao hanh don san"
                                  >
                                    <Shield size={16} />
                                  </button>
                                );
                              })()}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAcc({
                                    ...acc,
                                    note: getVisibleAccountNote(acc.note),
                                    package2Shelf:
                                      supportsChatgptMarketType(acc.type) ? normalizePackage2Shelf(acc.package2Shelf) : "none",
                                  });
                                  setShowEditModal(true);
                                }}
                                className="bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white p-2 rounded transition-colors"
                                title="Sửa Tài Khoản"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeletingId(acc.id);
                                  setShowDeleteModal(true);
                                }}
                                className="bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white p-2 rounded transition-colors"
                                title="Xóa Tài Khoản"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "coursera" && (
          <div className="space-y-6">
            <details className="mb-2 p-2 rounded-lg border border-slate-700/50 cursor-pointer">
              <summary className="text-xs text-slate-500">
                ⚙️ Cấu hình Script
              </summary>
              <div className="mt-2 text-xs">
                <input
                  className="form-input text-xs font-mono text-slate-500"
                  value={
                    localStorage.getItem("appsScriptUrl") ||
                    "https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec"
                  }
                  onChange={(e) =>
                    localStorage.setItem("appsScriptUrl", e.target.value)
                  }
                />
              </div>
            </details>

            <div
              style={{
                background: "#1e293b",
                padding: "20px",
                borderRadius: "15px",
                border: "1px solid #334155",
              }}
            >
              <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">
                📂 Import Coursera
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="form-group mb-4">
                    <label className="block text-slate-400 mb-1 text-sm">
                      Tên Sheet (VD: Sp26)
                    </label>
                    <input
                      id="sheetNameInput"
                      className="form-input"
                      placeholder="Ví dụ: Sp26"
                    />
                  </div>
                  <div className="p-4 bg-yellow-900/10 border border-yellow-700/30 rounded-lg">
                    <h4 className="text-yellow-500 text-sm font-bold mb-2 flex items-center gap-2">
                      <AlertCircle size={16} /> Lưu ý Format
                    </h4>
                    <p className="text-xs text-slate-400">
                      Nhập dữ liệu theo đúng định dạng:
                      <br />
                      <code className="text-white bg-slate-800 px-1 rounded">
                        email,pass,mã_môn
                      </code>
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-400 mb-1 text-sm">
                      Dữ Liệu
                    </label>
                    <textarea
                      id="bulkCourseraData"
                      className="form-input h-32 font-mono text-xs"
                      placeholder="user1@gmail.com,pass123,MATH101&#10;user2@gmail.com,pass456,ENW492c"
                    ></textarea>
                  </div>
                  <div>
                    <button
                      onClick={handleImportCoursera}
                      disabled={importingSheet}
                      className={`w-full flex justify-center items-center gap-2 p-3 rounded-lg font-bold transition-all ${importingSheet
                        ? "bg-slate-600 cursor-not-allowed opacity-70"
                        : importStatus === "success"
                          ? "bg-green-600 hover:bg-green-500"
                          : "btn-primary"
                        }`}
                    >
                      {importingSheet ? (
                        <>
                          <Loader2 size={18} className="animate-spin" /> Đang
                          Gửi Dữ Liệu...
                        </>
                      ) : importStatus === "success" ? (
                        <>
                          <CheckCircle size={18} /> Đã Gửi Thành Công!
                        </>
                      ) : (
                        <>
                          <ExternalLink size={16} /> Gửi Vào Sheet
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                background: "#1e293b",
                padding: "10px",
                borderRadius: "15px",
                border: "1px solid #334155",
              }}
            >
              <div className="flex justify-between items-center mb-2 px-1">
                <label className="text-sm font-bold text-slate-400">
                  Xem Trước Sheet:
                </label>
                <a
                  href="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded shadow-sm transition-transform hover:translate-y-[-1px]"
                >
                  <ExternalLink size={12} /> Mở Full Màn Hình (Sửa Dễ Hơn)
                </a>
              </div>
              <div className="aspect-video w-full rounded-lg overflow-hidden bg-white border border-slate-600">
                <iframe
                  src="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit?gid=1338679857&rm=minimal"
                  className="w-full h-full"
                  title="Coursera Sheet"
                ></iframe>
              </div>
            </div>
          </div>
        )}
      </div>

      {alertInfo.show && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-box text-center" style={{ maxWidth: "400px" }}>
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${alertInfo.type === "error"
                ? "bg-red-900/30 text-red-500"
                : alertInfo.type === "warning"
                  ? "bg-yellow-900/30 text-yellow-500"
                  : alertInfo.type === "confirm"
                    ? "bg-blue-900/30 text-blue-500"
                    : "bg-green-900/30 text-green-500" // Success color
                }`}
            >
              {alertInfo.type === "error" ? (
                <AlertCircle size={32} />
              ) : alertInfo.type === "warning" ? (
                <AlertTriangle size={32} />
              ) : alertInfo.type === "success" ? (
                <CheckCircle size={32} />
              ) : (
                <Info size={32} />
              )}
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {alertInfo.title}
            </h3>
            <p className="text-slate-300 mb-6 whitespace-pre-wrap">
              {alertInfo.message}
            </p>

            {alertInfo.type === "confirm" ? (
              <div className="flex justify-center gap-3">
                <button onClick={closeAlert} className="btn-secondary">
                  Hủy
                </button>
                <button
                  onClick={executeConfirm}
                  className="btn-primary bg-blue-600 hover:bg-blue-500"
                >
                  Đồng Ý
                </button>
              </div>
            ) : (
              <button
                onClick={closeAlert}
                className="btn-primary w-full justify-center"
              >
                Đã Hiểu
              </button>
            )}
          </div>
        </div>
      )}

      {showMoveUserModal && movingUser && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitMoveUser}
            className="modal-box"
            style={{ maxWidth: "640px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <ArrowRightLeft className="text-orange-500" /> Chuyển Khách Hàng
            </h2>

            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="text-sm text-slate-400">Đang chuyển:</div>
              <div className="font-bold text-lg text-white">
                👤 {getUserName(movingUser)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Tham gia:{" "}
                {movingUser.joinedAt
                  ? new Date(movingUser.joinedAt).toLocaleDateString("vi-VN")
                  : "N/A"}
              </div>
              {movingUser.expiredAt && (() => {
                const movingExpiry = getExpiryStatus(movingUser.expiredAt);
                return (
                  <div className={`text-xs mt-1 font-bold ${movingExpiry.color}`}>
                    Hết hạn: {movingExpiry.dateStr || "N/A"} • {movingExpiry.text}
                  </div>
                );
              })()}
            </div>

            <div className="form-group">
              {(() => {
                let sourceList = accounts;
                if (movingUser.platform === "netflix") sourceList = netflixAccounts;
                else if (movingUser.platform === "capcut") sourceList = capcutAccounts;
                else if (movingUser.platform === "canva") sourceList = canvaAccounts;

                const sourceAcc = sourceList.find((a) => a.id === movingUser.fromAccId);
                const sourceType = sourceAcc?.type || "unassigned";

                if (movingUser.platform !== "chatgpt") {
                  return (
                    <label className="text-orange-400 font-bold mb-1 block">
                      Chọn Tài Khoản Đích (Cùng loại: {movingUser.platform.toUpperCase()})
                    </label>
                  );
                }

                const sourceLabel = sourceType === "package1" ? "👥 Gói Chia Sẻ" : sourceType === "package2" ? "🔒 Gói Private" : "?⃝ Chưa phân loại";
                return (
                  <label className="text-orange-400 font-bold mb-1 block">
                    Chọn Tài Khoản Đích — Cùng loại: {sourceLabel}
                  </label>
                );
              })()}
              {(() => {
                let sourceList = accounts;
                if (movingUser.platform === "netflix") sourceList = netflixAccounts;
                else if (movingUser.platform === "capcut") sourceList = capcutAccounts;
                else if (movingUser.platform === "canva") sourceList = canvaAccounts;

                const sourceAcc = sourceList.find((a) => a.id === movingUser.fromAccId);
                const sourceType = sourceAcc?.type || "unassigned";
                const sourceWarehouse =
                  movingUser.platform === "chatgpt"
                    ? normalizePackage2Shelf(sourceAcc?.package2Shelf)
                    : "none";

                const destinationOptions = sourceList
                  .filter((a) => {
                    if (a.id === movingUser.fromAccId) return false;
                    if (a.expiredAt && new Date(a.expiredAt) < new Date()) return false;
                    const users = a.users?.length || 0;

                    if (movingUser.platform !== "chatgpt") {
                      return users < 1;
                    }

                    const destinationWarehouse = normalizePackage2Shelf(
                      a?.package2Shelf,
                    );
                    if (marketplaceTrackedAccountIds.has(String(a?.id || ""))) {
                      return false;
                    }
                    if (
                      destinationWarehouse !== sourceWarehouse &&
                      destinationWarehouse !== "none"
                    ) {
                      return false;
                    }

                    if (a.type === sourceType) {
                      if (sourceType === "package1") return users < 3;
                      if (sourceType === "package2") return users < 1;
                    }
                    if (a.type === "unassigned") {
                      if (sourceType === "package2") return users < 1;
                      if (sourceType === "package1") return users < 3;
                      return true;
                    }
                    return false;
                  })
                  .map((a) => {
                    const usedSlots = a.users?.length || 0;
                    let maxSlots = 1;
                    let typeLabel = movingUser.platform.toUpperCase();

                    if (movingUser.platform === "chatgpt") {
                      maxSlots =
                        a.type === "package2"
                          ? 1
                          : a.type === "package1"
                            ? 3
                            : sourceType === "package2"
                              ? 1
                              : 3;
                      typeLabel =
                        a.type === "unassigned"
                          ? `Unassigned → sẽ thành ${sourceType === "package1" ? "Shared" : "Private"}`
                          : a.type === "package2"
                            ? "Private"
                            : "Shared";
                    }

                    return {
                      id: a.id,
                      username: a.username,
                      usedSlots,
                      maxSlots,
                      typeLabel,
                      warehouseLabel:
                        movingUser.platform === "chatgpt"
                          ? getPackage2ShelfLabel(a.package2Shelf)
                          : movingUser.platform.toUpperCase(),
                      expiry: getExpiryStatus(a.expiredAt),
                    };
                  })
                  .filter((option) => {
                    const query = toNonAccentVietnamese(moveDestinationSearch);
                    if (!query) return true;
                    return toNonAccentVietnamese(
                      [
                        option.username,
                        option.typeLabel,
                        option.warehouseLabel,
                        option.expiry?.dateStr,
                        option.expiry?.text,
                      ]
                        .filter(Boolean)
                        .join(" "),
                    ).includes(query);
                  });

                return (
                  <>
                    <input type="hidden" value={destinationAccId} readOnly required />
                    <div className="mb-2">
                      <input
                        type="text"
                        value={moveDestinationSearch}
                        onChange={(e) => setMoveDestinationSearch(e.target.value)}
                        placeholder="Tìm nhanh theo email, loại acc, kho..."
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-orange-500"
                      />
                      <div className="mt-1 text-[11px] text-slate-400">
                        Đang hiện {destinationOptions.length} tài khoản đích hợp lệ
                      </div>
                    </div>
                    <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/60 p-2">
                      {destinationOptions.length > 0 ? (
                        destinationOptions.map((option) => {
                          const selected = destinationAccId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setDestinationAccId(option.id)}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                selected
                                  ? "border-orange-500 bg-orange-500/10 shadow-[0_0_0_1px_rgba(249,115,22,0.35)]"
                                  : "border-slate-700 bg-slate-800/70 hover:border-slate-500 hover:bg-slate-800"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-white">
                                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-cyan-200">
                                      [{option.usedSlots}/{option.maxSlots}]
                                    </span>
                                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-amber-200">
                                      {option.typeLabel}
                                    </span>
                                    {movingUser.platform === "chatgpt" && (
                                      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-emerald-200">
                                        {option.warehouseLabel}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-100">
                                    {option.username}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    Hết hạn: {option.expiry.dateStr || "Không có hạn"}
                                  </div>
                                  <div className={`mt-1 text-xs font-bold ${option.expiry.color}`}>
                                    {option.expiry.text || "Không có hạn"}
                                  </div>
                                </div>
                                {selected && (
                                  <div className="shrink-0 rounded-full bg-orange-500 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                                    Đã chọn
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 px-3 py-4 text-sm text-slate-400">
                          Không có tài khoản đích hợp lệ trong bộ lọc hiện tại.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
              {movingUser.platform === "chatgpt" && (
                <p className="text-xs text-slate-500 mt-2 italic">
                  * Cùng loại gói hoặc tài khoản chưa phân loại (tự đổi loại sau khi nhận khách).
                </p>
              )}
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowMoveUserModal(false);
                  setMoveDestinationSearch("");
                }}
                className="btn-secondary"
                disabled={loadingStates.moveUser}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary bg-orange-600 hover:bg-orange-500 flex items-center gap-2"
                disabled={loadingStates.moveUser}
              >
                {loadingStates.moveUser ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang
                    chuyển...
                  </>
                ) : (
                  "Xác Nhận Chuyển"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MOVE SLOT MODAL */}
      {showMoveSlotModal && movingSlot && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitMoveSlot}
            className="modal-box"
            style={{ maxWidth: "560px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <ArrowRightLeft className="text-orange-500" /> Chuyển Slot Khách
            </h2>

            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="text-sm text-slate-400">Đang chuyển Slot:</div>
              <div className="font-bold text-lg text-white">
                {movingSlot.customerName || movingSlot.gmail}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Tham gia:{" "}
                {movingSlot.addedAt
                  ? new Date(movingSlot.addedAt).toLocaleDateString("vi-VN")
                  : "N/A"}
              </div>
              {movingSlot.expiredAt && (() => {
                const movingExpiry = getExpiryStatus(movingSlot.expiredAt);
                return (
                  <>
                    <div className="text-xs text-slate-400 mt-1">
                      Hết hạn: {movingExpiry.dateStr || "Không có hạn"}
                    </div>
                    <div className={`text-xs font-bold mt-1 ${movingExpiry.color}`}>
                      {movingExpiry.text || "Không có hạn"}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="form-group">
              <label className="text-orange-400 font-bold mb-1 block">
                Chọn Team Account Đích
              </label>
              <div className="text-xs text-slate-500 mb-2 italic">
                Chỉ hiện Team Slot còn ở Kho tổng và còn chỗ trống.
              </div>
              {(() => {
                const destinationOptions = teamAccounts
                  .filter((a) => {
                    if (a.id === movingSlot.fromAccId) return false;
                    if (normalizeTeamSaleMode(a.saleMode) !== "slot") return false;
                    if (normalizeTeamWarehouse(a.warehouse) !== "total") return false;
                    const expDays = a.expiredAt
                      ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000)
                      : null;
                    if (expDays !== null && expDays <= 0) return false;
                    const activeCustomers = getActiveTeamCustomers(a).length;
                    return activeCustomers < getTeamCustomerCapacity(a);
                  })
                  .map((a) => ({
                    id: a.id,
                    username: a.username,
                    usedSlots: getActiveTeamCustomers(a).length,
                    maxSlots: getTeamCustomerCapacity(a),
                    warehouseLabel: getTeamWarehouseLabel(a.warehouse),
                    expiry: getExpiryStatus(a.expiredAt),
                  }))
                  .filter((option) => {
                    const query = toNonAccentVietnamese(
                      moveSlotDestinationSearch,
                    );
                    if (!query) return true;
                    return toNonAccentVietnamese(
                      [
                        option.username,
                        option.warehouseLabel,
                        option.expiry?.dateStr,
                        option.expiry?.text,
                        "Team Slot",
                      ]
                        .filter(Boolean)
                        .join(" "),
                    ).includes(query);
                  });

                return (
                  <>
                    <input type="hidden" value={destinationAccId} readOnly required />
                    <div className="mb-2">
                      <input
                        type="text"
                        value={moveSlotDestinationSearch}
                        onChange={(e) =>
                          setMoveSlotDestinationSearch(e.target.value)
                        }
                        placeholder="Tìm nhanh theo email hoặc kho..."
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-orange-500"
                      />
                      <div className="mt-1 text-[11px] text-slate-400">
                        Đang hiện {destinationOptions.length} Team Slot hợp lệ
                      </div>
                    </div>
                    <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/60 p-2">
                      {destinationOptions.length > 0 ? (
                        destinationOptions.map((option) => {
                          const selected = destinationAccId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setDestinationAccId(option.id)}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                selected
                                  ? "border-orange-500 bg-orange-500/10 shadow-[0_0_0_1px_rgba(249,115,22,0.35)]"
                                  : "border-slate-700 bg-slate-800/70 hover:border-slate-500 hover:bg-slate-800"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-white">
                                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-cyan-200">
                                      [{option.usedSlots}/{option.maxSlots}] Slot
                                    </span>
                                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-amber-200">
                                      Team Slot
                                    </span>
                                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-emerald-200">
                                      {option.warehouseLabel}
                                    </span>
                                  </div>
                                  <div className="mt-2 break-all text-sm font-semibold text-slate-100">
                                    {option.username}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    Hết hạn: {option.expiry.dateStr || "Không có hạn"}
                                  </div>
                                  <div className={`mt-1 text-xs font-bold ${option.expiry.color}`}>
                                    {option.expiry.text || "Không có hạn"}
                                  </div>
                                </div>
                                {selected && (
                                  <div className="shrink-0 rounded-full bg-orange-500 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                                    Đã chọn
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 px-3 py-4 text-sm text-slate-400">
                          Không có Team Slot hợp lệ trong Kho tổng để nhận khách.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowMoveSlotModal(false);
                  setMoveSlotDestinationSearch("");
                }}
                className="btn-secondary"
                disabled={loadingStates.moveUser}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary bg-orange-600 hover:bg-orange-500 flex items-center gap-2"
                disabled={loadingStates.moveUser}
              >
                {loadingStates.moveUser ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang chuyển...
                  </>
                ) : (
                  "Xác Nhận Chuyển"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CUSTOM EXTEND MODAL */}
      {showExtendModal && extendData && (
        <div className="modal-overlay">
          <form className="modal-box" style={{ maxWidth: "400px" }} onSubmit={handleSubmitExtend}>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <RotateCw className="text-green-500" /> Gia Hạn Khách Hàng
            </h2>
            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="font-bold text-lg text-indigo-300">
                👤 {extendData.currentName}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Thuộc gói: <span className="uppercase text-slate-300">{extendData.platform}</span>
              </div>
              {extendData.currentExpire && (
                <div className="text-xs text-slate-400 mt-1">
                  Ngày Hết Hạn Gốc: <span className="font-mono text-yellow-400">{extendData.currentExpire}</span>
                </div>
              )}
            </div>

            <div className="form-group mb-4">
              <label className="text-green-400 font-bold mb-1 block">Chọn Thời Gian Gia Hạn</label>
              <select
                className="form-input w-full bg-slate-700"
                value={extendDaysOption}
                onChange={e => setExtendDaysOption(e.target.value)}
              >
                {EXTEND_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowExtendModal(false)} className="btn-secondary" disabled={loadingStates.extendUser}>Hủy</button>
              <button type="submit" className="btn-primary bg-green-600 hover:bg-green-500 flex items-center gap-2" disabled={loadingStates.extendUser}>
                {loadingStates.extendUser ? <Loader2 size={18} className="animate-spin" /> : "Gia Hạn Ngay"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* IMPORT TEAM MODAL */}
      {showImportTeamModal && (
        <div className="modal-overlay">
          <form className="modal-box" style={{ maxWidth: "500px" }} onSubmit={(e) => {
            e.preventDefault();
            const parsedForm = parseTeamImportTextToForm(teamImportText);
            if (!parsedForm) {
              showAlert("Thiếu dữ liệu", "Không đọc được format Team hợp lệ.", "warning");
              return;
            }
            setTeamAddForm(parsedForm);
            setShowImportTeamModal(false);
            setTeamImportText("");
            setShowTeamAddModal(true);
          }}>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              📋 Nhập Format Team
            </h2>
            <div className="form-group mb-4">
              <label className="text-slate-300 font-bold mb-1 block">Dán Raw Format tại đây:</label>
              <p className="text-xs text-slate-400 mb-2">Format mới: team email@domain.com----gptpass----2FA_SECRET----https://generator.email/... hoặc team email@domain.com | gptpass | 2FA_SECRET | https://generator.email/...</p>
              <p className="text-[11px] text-cyan-300/80 mb-2">Chỉ cần thêm chữ <code className="bg-slate-700 px-1 rounded">team</code> ở đầu dòng là có thể parse hoặc thêm nhanh.</p>
              <textarea
                className="form-input w-full h-32 text-sm font-mono leading-tight bg-slate-800"
                placeholder="team email@domain.com | gptpass | 2FA_SECRET | https://generator.email/..."
                value={teamImportText}
                onChange={e => setTeamImportText(e.target.value)}
                autoFocus
              ></textarea>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowImportTeamModal(false)} className="btn-secondary">Hủy</button>
              <button
                type="button"
                onClick={async () => {
                  const parsedForm = parseTeamImportTextToForm(teamImportText);
                  if (!parsedForm) {
                    showAlert("Thiếu dữ liệu", "Không đọc được format Team hợp lệ.", "warning");
                    return;
                  }
                  try {
                    await axios.post("/api/team", {
                      ...parsedForm,
                      expiredAt: parsedForm.expiredAt ? new Date(parsedForm.expiredAt).toISOString() : undefined,
                    });
                    setShowImportTeamModal(false);
                    setTeamImportText("");
                    await fetchData();
                    broadcastDataChange();
                    showAlert("Thành công", "Đã thêm nhanh Team Account từ raw format.", "success");
                  } catch (error) {
                    showAlert("Lỗi", getApiErrorMessage(error, "Không thể thêm nhanh Team Account"), "error");
                  }
                }}
                className="btn-primary bg-emerald-600 hover:bg-emerald-500"
              >
                Thêm nhanh
              </button>
              <button type="submit" className="btn-primary bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                Phân Tích Dữ Liệu
              </button>
            </div>
          </form>
        </div>
      )}

      {showUserModal && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitUser}
            className="modal-box"
            style={{ maxWidth: "400px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4">
              {userModalMode === "add" ? "Thêm Khách Mới" : "Sửa Tên Khách"}
            </h2>

            {/* EXPIRY WARNING */}
            {userModalMode === "add" &&
              currentUserData.accId &&
              (() => {
                const acc = accounts.find(
                  (a) => a.id === currentUserData.accId,
                );
                if (acc && acc.expiredAt) {
                  const daysLeft = getExpiryStatus(acc.expiredAt).text;
                  // Check simplistic days logic or re-calc
                  const exp = new Date(acc.expiredAt);
                  const now = new Date();
                  const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

                  if (diff < 30) {
                    return (
                      <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded flex gap-2 items-start">
                        <AlertTriangle
                          className="text-yellow-500 shrink-0"
                          size={20}
                        />
                        <div className="text-xs text-yellow-200">
                          <span className="font-bold block text-sm text-yellow-500">
                            CẢNH BÁO HẠN DÙNG
                          </span>
                          Tài khoản này chỉ còn <b>{diff} ngày</b> (&lt; 30
                          ngày).
                          <br />
                          Khách mua tháng có thể bị gián đoạn!
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })()}

            <div className="form-group">
              <label>Tên Khách Hàng</label>
              <input
                autoFocus
                className="form-input text-lg"
                value={currentUserData.name}
                onChange={(e) =>
                  setCurrentUserData({
                    ...currentUserData,
                    name: e.target.value,
                  })
                }
                placeholder="Nhập tên..."
              />
            </div>
            <div className="form-group mt-3">
              <label className="block text-slate-300 mb-2">Ngày Tham Gia</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  currentUserData.joinedAt
                    ? new Date(currentUserData.joinedAt)
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  setCurrentUserData({
                    ...currentUserData,
                    joinedAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  });
                }}
              />
            </div>
            <div className="form-group mt-3">
              <label className="block text-yellow-400 mb-2">Ngày Hết Hạn</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  currentUserData.expiredAt
                    ? new Date(currentUserData.expiredAt)
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  setCurrentUserData({
                    ...currentUserData,
                    expiredAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  });
                }}
              />
              {userExpiryPreview && (
                <div className={`mt-2 text-xs font-bold ${userExpiryPreview.className}`}>
                  {userExpiryPreview.text}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="btn-secondary"
                disabled={loadingStates.addUser || loadingStates.editUser}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={loadingStates.addUser || loadingStates.editUser}
              >
                {loadingStates.addUser || loadingStates.editUser ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang lưu...
                  </>
                ) : (
                  "Lưu Lại"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      


      {(showAddModal || showEditModal) && (
        <div className="modal-overlay">
          <form
            onSubmit={showAddModal ? handleAddAccount : handleUpdateAccount}
            className="modal-box"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                {showAddModal ? "Thêm Tài Khoản" : "Sửa Tài Khoản"}
              </h2>
              <span
                className="close"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
              >
                &times;
              </span>
            </div>

            <div className="form-group">
              <label>Email / Username</label>
              <input
                required
                className="form-input"
                value={showAddModal ? newAcc.username : editingAcc.username}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, username: e.target.value })
                    : setEditingAcc({ ...editingAcc, username: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                required
                className="form-input"
                value={showAddModal ? newAcc.password : editingAcc.password}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, password: e.target.value })
                    : setEditingAcc({ ...editingAcc, password: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Mã 2FA Secret</label>
              <input
                className="form-input"
                placeholder="Ví dụ: N6U2JOXGY6M4Z33UXY5NKYSXUL3JCAOO"
                value={showAddModal ? newAcc.otpSecret : editingAcc.otpSecret || ""}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, otpSecret: e.target.value })
                    : setEditingAcc({ ...editingAcc, otpSecret: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Loại Gói</label>
              <select
                className="form-input"
                value={showAddModal ? newAcc.type : editingAcc.type}
                onChange={(e) => {
                  const nextType = e.target.value;
                  if (showAddModal) {
                    setNewAcc({
                      ...newAcc,
                      type: nextType,
                      package2Shelf: supportsChatgptMarketType(nextType) ? normalizePackage2Shelf(newAcc.package2Shelf) : "none",
                    });
                  } else {
                    setEditingAcc({
                      ...editingAcc,
                      type: nextType,
                      package2Shelf: supportsChatgptMarketType(nextType) ? normalizePackage2Shelf(editingAcc.package2Shelf) : "none",
                    });
                  }
                }}
              >
                <option value="unassigned">❓ Chưa xác định</option>
                <option value="package1">👥 Gói 1: Chia sẻ</option>
                <option value="package2">🔒 Gói 2: Linh hoạt</option>
              </select>
            </div>
            {supportsChatgptMarketType(showAddModal ? newAcc.type : editingAcc.type) && (
              <div className="form-group">
                <label>Kho ban ChatGPT</label>
                <select
                  className="form-input"
                  value={normalizePackage2Shelf(showAddModal ? newAcc.package2Shelf : editingAcc.package2Shelf)}
                  onChange={(e) =>
                    showAddModal
                      ? setNewAcc({
                        ...newAcc,
                        package2Shelf: normalizePackage2Shelf(e.target.value),
                      })
                      : setEditingAcc({
                        ...editingAcc,
                        package2Shelf: normalizePackage2Shelf(e.target.value),
                      })
                  }
                >
                  <option value="none">Kho tong</option>
                  <option value="cheap">Kho market</option>
                  <option value="main">Kho duoi 25 ngay</option>
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Link Mail</label>
              <input
                className="form-input"
                value={showAddModal ? newAcc.link : editingAcc.link}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, link: e.target.value })
                    : setEditingAcc({ ...editingAcc, link: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Ghi chú</label>
              <input
                className="form-input"
                value={showAddModal ? newAcc.note : editingAcc.note}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, note: e.target.value })
                    : setEditingAcc({ ...editingAcc, note: e.target.value })
                }
              />
            </div>

            <div className="form-group mt-3">
              <label className="block text-yellow-400 mb-2">Ngày Hết Hạn</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  (showAddModal ? newAcc.expiredAt : editingAcc.expiredAt)
                    ? new Date(
                      showAddModal ? newAcc.expiredAt : editingAcc.expiredAt,
                    )
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  const val = e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null;
                  if (showAddModal) setNewAcc({ ...newAcc, expiredAt: val });
                  else setEditingAcc({ ...editingAcc, expiredAt: val });
                }}
              />
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
                className="btn-secondary"
                disabled={loadingStates.addAccount || loadingStates.editAccount}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={loadingStates.addAccount || loadingStates.editAccount}
              >
                {loadingStates.addAccount || loadingStates.editAccount ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang lưu...
                  </>
                ) : (
                  "Lưu"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-box text-center">
            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Xác nhận xóa?</h3>
            <div className="flex justify-center gap-3 mt-6">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary"
                disabled={loadingStates.deleteAccount}
              >
                Hủy
              </button>
              <button
                onClick={handleDeleteAccount}
                className="btn-primary flex items-center gap-2"
                style={{ backgroundColor: "#ef4444" }}
                disabled={loadingStates.deleteAccount}
              >
                {loadingStates.deleteAccount ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang xóa...
                  </>
                ) : (
                  "Xóa Luôn"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrphanedUsersModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="bg-orange-900/30 p-4 rounded-t-xl border-b-2 border-orange-600 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-600/30 rounded-full flex items-center justify-center">
                  <AlertTriangle size={28} className="text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    ⚠️ KHÔNG THỂ XÓA TÀI KHOẢN
                  </h3>
                  <p className="text-sm text-orange-300">
                    Tài khoản có {orphanedUsers.length} khách còn hạn sử dụng
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mb-4">
              <p className="text-slate-300 mb-3">
                <strong className="text-yellow-400">Yêu cầu:</strong> Chuyển
                hoặc xóa tất cả khách còn hạn trước khi xóa tài khoản.
              </p>
              <div className="space-y-3">
                {orphanedUsers.map((user, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900 p-3 rounded border border-slate-700 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        <User size={16} className="text-blue-400" />
                        {user.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Tham gia: {getUserDate(user)} • Đã dùng: {user.daysUsed}{" "}
                        ngày •
                        <span className="text-green-400 font-bold">
                          {" "}
                          Còn {user.daysRemaining ?? 0} ngày
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowOrphanedUsersModal(false);
                          openMoveUserModal(
                            user.fromAccId,
                            user.userIndex,
                            user,
                          );
                        }}
                        className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded text-sm font-bold"
                      >
                        <ArrowRightLeft size={14} /> Chuyển
                      </button>
                      <button
                        onClick={() => {
                          setShowOrphanedUsersModal(false);
                          handleDeleteUser(
                            user.fromAccId,
                            user.userIndex,
                            user.name,
                          );
                        }}
                        className="flex items-center gap-1 bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm font-bold"
                      >
                        <Trash2 size={14} /> Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <Info
                  size={18}
                  className="text-blue-400 flex-shrink-0 mt-0.5"
                />
                <p className="text-xs text-blue-200">
                  <strong>Gợi ý:</strong> Chuyển khách sang tài khoản Shared còn
                  slot hoặc xóa khách nếu không còn sử dụng. Sau khi xử lý hết,
                  bạn có thể xóa tài khoản này.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowOrphanedUsersModal(false);
                  setDeletingId(null);
                }}
                className="btn-primary bg-blue-600 hover:bg-blue-500"
              >
                Đã Hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrphanedSlotsModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="bg-orange-900/30 p-4 rounded-t-xl border-b-2 border-orange-600 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-600/30 rounded-full flex items-center justify-center">
                  <AlertTriangle size={28} className="text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    ⚠️ KHÔNG THỂ XÓA TÀI KHOẢN TEAM
                  </h3>
                  <p className="text-sm text-orange-300">
                    Tài khoản đang có {orphanedSlots.length} slot khách còn hiệu lực
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mb-4">
              <p className="text-slate-300 mb-3">
                <strong className="text-yellow-400">Yêu cầu bắt buộc:</strong> Chuyển hoặc xóa tất cả khách đang dùng (đang active) qua bên nhóm rác trước khi xóa tài khoản.
              </p>
              <div className="space-y-3">
                {orphanedSlots.map((slot, idx) => {
                  const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                  return (
                    <div
                      key={idx}
                      className="bg-slate-900 p-3 rounded border border-slate-700 flex justify-between items-center"
                    >
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <User size={16} className="text-blue-400" />
                          {slot.customerName || "—"} ({slot.gmail || "No Gmail"})
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Tham gia: {slot.addedAt ? new Date(slot.addedAt).toLocaleDateString("vi-VN") : "—"}{" "}
                          {sExpDays !== null && (
                            <span>
                              • Tình trạng:{" "}
                              <span className={`${sExpDays > 0 ? "text-green-400" : "text-red-400"} font-bold`}>
                                {sExpDays > 0 ? `Còn ${sExpDays} ngày` : `Hết Hạn`}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowOrphanedSlotsModal(false);
                            openMoveSlotModal(
                              slot.fromAccId,
                              slot.originalIndex,
                              slot
                            );
                          }}
                          className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded flex items-center gap-1 font-bold text-sm"
                        >
                          <ArrowRightLeft size={14} /> Chuyển
                        </button>
                        <button
                          onClick={async () => {
                            const fromAcc = teamAccounts.find(a => a.id === slot.fromAccId);
                            if (!fromAcc) return;
                            const updSlots = [...fromAcc.slots];
                            updSlots[slot.originalIndex] = { ...slot, status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                            try {
                              await axios.put(
                                `/api/team/${fromAcc.id}`,
                                withExpectedUpdatedAt({ slots: updSlots }, fromAcc),
                              );
                              fetchData();
                              broadcastDataChange();
                              setShowOrphanedSlotsModal(false);
                              showAlert("Đã xóa Slot", "Slot khách đã được giải phóng.", "info");
                            } catch (error) {
                              showAlert("Lỗi", getApiErrorMessage(error, "Không thể xóa slot"), "error");
                            }
                          }}
                          className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded flex items-center gap-1 font-bold text-sm"
                        >
                          <Trash2 size={14} /> Xóa
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowOrphanedSlotsModal(false)}
                className="btn-primary bg-blue-600 hover:bg-blue-500 font-bold text-sm px-4 rounded"
              >
                Đã Hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportGPTModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                Import ChatGPT Nhanh
              </h2>
              <span
                className="close"
                onClick={() => setShowImportGPTModal(false)}
              >
                &times;
              </span>
            </div>
            <p className="text-slate-400 text-sm mb-2">
              Hỗ trợ các dạng:
            </p>
            <div className="text-xs text-slate-300 bg-slate-800/60 border border-slate-700 rounded-lg p-3 mb-3 space-y-2">
              <div>
                <code className="bg-slate-700 px-1 rounded">
                  email----pass----link
                </code>
              </div>
              <div>
                <code className="bg-slate-700 px-1 rounded">
                  email | pass | 2FA_SECRET
                </code>
              </div>
              <div>
                <code className="bg-slate-700 px-1 rounded">
                  Tài khoản: ... / Mật khẩu: ... / Mã 2FA: ...
                </code>
              </div>
            </div>
            <textarea
              id="bulkGPTData"
              className="form-input h-64 font-mono text-xs"
              placeholder="...
UCanPlus1669@purinikiopiy.asia---zxcvbnm666..----https://mail.chatgpt.org.uk/...

owenbertyoung1482@outlook.com | hanzoleged1102@@ | N6U2JOXGY6M4Z33UXY5NKYSXUL3JCAOO

Tài khoản: owenbertyoung1482@outlook.com
Mật khẩu: hanzoleged1102@@
Mã 2FA: N6U2JOXGY6M4Z33UXY5NKYSXUL3JCAOO"
            ></textarea>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowImportGPTModal(false)}
                className="btn-secondary"
              >
                Hủy
              </button>
              <button
                id="btnImportGPT"
                onClick={handleBulkImportGPT}
                className="btn-primary bg-purple-600 hover:bg-purple-500"
              >
                Nhập Dữ Liệu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SINGLE USER PLATFORMS (NETFLIX, CAPCUT, CANVA)            */}
      {/* ========================================================= */}
      {(activeTab === "netflix" || activeTab === "capcut" || activeTab === "canva") && (() => {
        const platform = activeTab;
        const mapAccs = { netflix: netflixAccounts, capcut: capcutAccounts, canva: canvaAccounts };
        const accs = mapAccs[platform] || [];
        const accents = { netflix: "red", capcut: "green", canva: "purple" };
        const accentColor = accents[platform];
        const labels = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" };
        const label = labels[platform];
        const emojis = { netflix: "Màn hình", capcut: "Video", canva: "Design" };
        const emoji = emojis[platform];

        const handleAddSimpleAcc = () => {
          setSimpleAddPlatform(platform);
          setSimpleAddForm({ username: "", password: "", duration: "1M", note: "" });
          setShowSimpleAddModal(true);
        };

        const handleEditSimpleAcc = (acc) => {
          setSimpleEditForm({
            id: acc.id,
            username: acc.username || "",
            password: acc.password || "",
            duration: acc.duration || "1M",
            note: acc.note || "",
            expiredAt: acc.expiredAt ? new Date(acc.expiredAt).toISOString().split('T')[0] : "",
            updatedAt: getRecordUpdatedAt(acc),
          });
          setShowSimpleEditModal(true);
        };

        const handleDeleteSimpleAcc = (acc) => {
          showConfirm("Xóa Tài Khoản", `Bạn có chắc muốn xóa tài khoản ${acc.username}?`, async () => {
            try {
              await axios.delete(`/api/${platform}/${acc.id}`, {
                data: {
                  expectedUpdatedAt: getRecordUpdatedAt(acc),
                },
              });
              fetchData();
              broadcastDataChange();
            } catch (e) { showAlert("Lỗi", getApiErrorMessage(e, "Xóa thất bại"), "error"); }
          });
        };

        const handleAssignUser = async (acc) => {
          if (acc.users?.length >= 1) return alert(`Giới hạn: ${label} chỉ được 1 khách!`);
          setAssignUserAcc(acc);
          setAssignUserName("");
          setShowAssignUserModal(true);
        };

        const handleRemoveUser = (acc) => {
          showConfirm("Xóa Khách", `Bạn có chắc muốn xóa khách khỏi ${acc.username}?`, async () => {
            try {
              await axios.put(
                `/api/${platform}/${acc.id}`,
                withExpectedUpdatedAt({ users: [] }, acc),
              );
              fetchData();
              broadcastDataChange();
            } catch (e) { showAlert("Lỗi", getApiErrorMessage(e, "Xóa thất bại"), "error"); }
          });
        };

        const presenceFiltered = accs
          .filter((a) =>
            matchesCustomerFilter(
              hasAssignedCustomer(a),
              simpleCustomerFilter,
            ),
          )
          .filter((a) =>
            matchesExpiryFilter(getAccountDaysRemaining(a), simpleExpiryFilter),
          )
          .filter((a) =>
            matchesExpiryRange(
              getAccountDaysRemaining(a),
              simpleExpiryMin,
              simpleExpiryMax,
            ),
          );

        const searchFiltered = presenceFiltered.filter(a =>
          a.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.users?.[0]?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        );

        const filtered = searchFiltered.sort((a, b) => {
          const remA = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : 999;
          const remB = b.expiredAt ? Math.ceil((new Date(b.expiredAt) - new Date()) / 86400000) : 999;

          if (remA <= 0 && remB > 0) return -1;
          if (remA > 0 && remB <= 0) return 1;
          if (remA <= 3 && remB > 3) return -1;
          if (remA > 3 && remB <= 3) return 1;

          return remA - remB;
        });

        const urgentList = accs.filter(a => {
          const u = a.users?.[0];
          if (!u) return false;
          const rem = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : null;
          return rem !== null && rem <= 3;
        });

        return (
          <div>
            {urgentList.length > 0 && (
              <div className={`mb-6 bg-${accentColor}-900/20 border-2 border-${accentColor}-600 rounded-xl overflow-hidden shadow-2xl animate-fade-in`}>
                <div className={`bg-${accentColor}-800/80 p-3 flex items-center justify-between`}>
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <AlertTriangle className="text-yellow-300 animate-pulse" />
                    CẦN XỬ LÝ GẤP ({urgentList.length})
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  {urgentList.map((a, i) => {
                    const rem = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : null;
                    return (
                      <div key={i} className={`flex items-center justify-between bg-slate-900/50 p-3 rounded border border-${accentColor}-500/30`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full bg-${accentColor}-500/20 text-${accentColor}-500`}>
                            <User size={20} />
                          </div>
                          <div>
                            <div className={`font-bold text-${accentColor}-400 text-lg`}>
                              {a.users[0].name}
                            </div>
                            <div className="text-xs text-slate-400">
                              Tài khoản: <span className="text-white">{a.username}</span> •
                              <span className="text-red-500 font-bold ml-1">
                                {rem <= 0 ? `Đã hết hạn ${Math.abs(rem)} ngày` : `Sắp hết hạn (Còn ${rem} ngày)`}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <button onClick={() => handleEditSimpleAcc(a)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold shadow-lg flex items-center gap-2">
                            <Pencil size={18} /> SỬA ACC
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mb-6 items-center justify-between">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    placeholder="Tìm email/khách..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="form-input w-64"
                  />
                  <span className="text-slate-500 text-sm">
                    {filtered.length} tài khoản · {presenceFiltered.filter((a) => hasAssignedCustomer(a)).length} đang dùng
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Lọc khách
                  </span>
                  {renderCustomerFilterButtons(
                    simpleCustomerFilter,
                    setSimpleCustomerFilter,
                  )}
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Loc han
                  </span>
                  {renderExpiryRangeInputs(
                    simpleExpiryMin,
                    (value) =>
                      handleExpiryRangeChange(
                        value,
                        setSimpleExpiryMin,
                        setSimpleExpiryFilter,
                      ),
                    simpleExpiryMax,
                    (value) =>
                      handleExpiryRangeChange(
                        value,
                        setSimpleExpiryMax,
                        setSimpleExpiryFilter,
                      ),
                  )}
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Moc nhanh
                  </span>
                  {renderExpiryFilterSelect(
                    simpleExpiryFilter,
                    (value) =>
                      handleExpiryPresetChange(
                        value,
                        setSimpleExpiryFilter,
                        setSimpleExpiryMin,
                        setSimpleExpiryMax,
                      ),
                  )}
                </div>
              </div>
              <button onClick={handleAddSimpleAcc} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white transition-all bg-${accentColor}-600 hover:bg-${accentColor}-500`}>
                <UserPlus size={16} /> Thêm Tài Khoản {label}
              </button>
            </div>

            <div className="rounded-xl overflow-x-auto w-full border border-slate-700 shadow-xl">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className={`text-xs uppercase tracking-wider bg-${accentColor}-900/30 text-${accentColor}-300`}>
                    <th className="p-3 text-left">#</th>
                    <th className="p-3 text-left">Tài Khoản</th>
                    <th className="p-3 text-left">Khách Hàng</th>
                    <th className="p-3 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500 italic">Chưa có dữ liệu</td></tr>}
                  {filtered.map((acc, idx) => {
                    const u = acc.users?.[0];
                    const accExpiry = getExpiryStatus(acc.expiredAt);
                    const daysRemaining = acc.expiredAt ? Math.ceil((new Date(acc.expiredAt) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                    const isExpired = daysRemaining !== null && daysRemaining <= 0;
                    const isNearExpiry = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;
                    const noteTitle = platform === "netflix" ? "Profile" : "Ghi chú";
                    return (
                      <tr key={acc.id} className={`border-t border-slate-700/50 transition-colors ${accExpiry.isExpired ? "bg-red-950/20" : "hover:bg-slate-800/50"}`}>
                        <td className="p-3 text-slate-500 font-mono text-xs">{idx + 1}</td>
                        <td className="p-4 align-top">
                          <div className="flex items-center gap-2 font-bold text-white text-base mb-2">
                            <span className="font-mono text-lg">{acc.username}</span>
                            <button
                              className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2"
                              onClick={() => handleCopy(acc.username, "Đã copy Tên Tài Khoản")}
                              title="Copy Username"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                          <div className="text-slate-400 flex items-center gap-2 font-mono text-sm mt-2 ml-1">
                            <span className="w-16 text-slate-400 text-xs text-right">Pass:</span>
                            {acc.password ? (
                              <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                            ) : (
                              <span className="opacity-50 min-w-[120px] px-2 py-1 bg-slate-800 rounded">Không mật khẩu</span>
                            )}
                            {acc.password && (
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                onClick={() => handleCopy(acc.password, "Đã copy Mật khẩu")}
                                title="Copy Password"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            )}
                          </div>
                          <div className="mt-3 ml-1">
                            <button
                              className="bg-indigo-600/80 hover:bg-indigo-400 px-3 py-1.5 rounded text-white text-xs font-bold flex items-center gap-2 transition-transform shadow-md hover:-translate-y-0.5"
                              onClick={() => handleCopy(`Tài khoản: ${acc.username}${acc.password ? `\nMật khẩu: ${acc.password}` : ""}${acc.note ? `\n${noteTitle}: ${acc.note}` : ""}`, "Đã copy cả TK & MK & Ghi chú")}
                            >
                              <Copy size={14} /> Copy cả TK, MK & Note
                            </button>
                          </div>
                          {accExpiry.text && (
                            <div className={`text-xs mt-3 flex items-center gap-1 ${accExpiry.color}`}>
                              <Calendar size={10} />
                              <span>{accExpiry.text}</span>
                              <span className="text-slate-600 italic">({accExpiry.dateStr})</span>
                            </div>
                          )}
                          {acc.note && <div className="text-xs text-yellow-500/80 italic mt-2 bg-yellow-900/10 p-1.5 rounded inline-block">{noteTitle}: {acc.note}</div>}
                        </td>
                        <td className="p-3">
                          {u ? (() => {
                            const userDaysRemaining = u?.expiredAt ? Math.ceil((new Date(u.expiredAt) - new Date()) / 86400000) : daysRemaining;
                            const userIsExpired = userDaysRemaining !== null && userDaysRemaining <= 0;
                            const userIsNearExpiry = userDaysRemaining !== null && userDaysRemaining > 0 && userDaysRemaining <= 3;
                            return (
                              <div className={`p-2 rounded border text-xs ${userIsExpired ? "bg-red-900/20 border-red-700" : userIsNearExpiry ? "bg-yellow-900/20 border-yellow-700" : "bg-slate-800 border-slate-700"}`}>
                                <div className={`font-bold flex items-center gap-1 ${userIsExpired ? "text-red-400" : userIsNearExpiry ? "text-yellow-400" : "text-white"}`}>
                                  {userIsExpired && <AlertCircle size={12} />}
                                  {userIsNearExpiry && <AlertTriangle size={12} />}
                                  👤 {u.name}
                                </div>
                                <div className="text-slate-400 mt-1 flex items-center gap-1">
                                  <Calendar size={10} /> {u?.expiredAt ? formatDate(u.expiredAt) : getUserDate(u)}
                                </div>
                                {userDaysRemaining !== null && (
                                  <div className={`text-[10px] font-semibold mt-0.5 ${userIsExpired ? "text-red-400" : userIsNearExpiry ? "text-yellow-400" : userDaysRemaining > 30 ? "text-purple-400" : "text-blue-400"}`}>
                                    {userIsExpired ? `(HH ${Math.abs(userDaysRemaining)} ngày)` : `(Còn ${userDaysRemaining} ngày)`}
                                  </div>
                                )}
                              </div>
                            );
                          })() : (
                            <button onClick={() => handleAssignUser(acc)} className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold text-white bg-${accentColor}-700 hover:bg-${accentColor}-600`}>
                              👤 Gán Khách
                            </button>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1 items-center">
                            {u && (
                              <div className="flex w-full gap-1">
                                <button onClick={() => openMoveUserModal(acc.id, 0, u, activeTab)} className="bg-amber-600 hover:bg-amber-500 text-white p-1 rounded text-xs flex-1 flex justify-center items-center" title="Chuyển Khách"><ArrowRightLeft size={16} /></button>
                                <button onClick={() => handleRemoveUser(acc)} className="bg-orange-700 hover:bg-orange-600 text-white p-1 rounded text-xs flex-1 flex justify-center items-center" title="Xóa Khách"><Trash2 size={16} /></button>
                              </div>
                            )}
                            <button onClick={() => handleEditSimpleAcc(acc)} className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><Pencil size={12} /> Sửa Acc</button>
                            <button onClick={() => handleDeleteSimpleAcc(acc)} className="bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><X size={12} /> Xóa Acc</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ====================================================== */}
      {/* TEAM CHATGPT ACCOUNTS                                  */}
      {/* ====================================================== */}
      {activeTab === "chatgpt" && (
        <div>
          {/* Header */}
          <div className="flex flex-wrap gap-3 mb-6 items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Kho Team ChatGPT</h2>
              <p className="text-slate-400 text-sm">Quan ly theo kho tong / kho market / kho duoi 25 ngay</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-200">
                Da chon <span className="text-white font-bold">{selectedTeamIds.length}</span>
              </div>
              <button
                onClick={() =>
                  handleToggleSelectAllFilteredTeam(
                    !allFilteredTeamSelected,
                    filteredTeamIds,
                  )
                }
                disabled={filteredTeamIds.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-emerald-700 hover:bg-emerald-600 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {allFilteredTeamSelected ? "Bo chon Team" : "Chon het Team"}
              </button>
              {selectedTeamIds.length > 0 && (
                <button
                  onClick={() => setSelectedTeamIds([])}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-slate-700 hover:bg-slate-600 text-sm"
                >
                  Bo chon
                </button>
              )}
              <button
                onClick={() => {
                  setTeamImportText("");
                  setShowImportTeamModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-slate-700 hover:bg-slate-600 text-sm"
              >
                📋 Nhập Format
              </button>
              <button
                onClick={() => { setTeamAddForm(buildTeamFormState({ expiredAt: getDefaultOneMonthDateInput() })); setShowTeamAddModal(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500"
              >
                <UserPlus size={16} /> Thêm Team Acc
              </button>
            </div>
          </div>

          {teamAccounts.length === 0 ? (
            <div className="text-center py-16 text-slate-500 italic">Chưa có tài khoản Team nào.</div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "all", label: "Tat ca", count: filteredTeamAccounts.length, color: "bg-slate-800" },
                  { key: "total", label: "Kho tong", count: teamTotalAccounts.length, color: "bg-blue-600" },
                  { key: "market", label: "Kho market", count: teamMarketAccounts.length, color: "bg-emerald-600" },
                  { key: "short", label: "Kho duoi 25", count: teamShortAccounts.length, color: "bg-amber-600" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setTeamWarehouseTab(tab.key)}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-colors ${
                      teamWarehouseTab === tab.key
                        ? `${tab.color} text-white`
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {tab.label} {tab.count}
                  </button>
                ))}
              </div>

              {teamWarehouseTab === "total" && (
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "all", label: "Tat ca", count: teamTotalAccounts.length },
                    {
                      key: "slot",
                      label: "Goi chia se",
                      count: teamTotalAccounts.filter(
                        (acc) => normalizeTeamSaleMode(acc.saleMode) === "slot",
                      ).length,
                    },
                    {
                      key: "business",
                      label: "Nguyen acc",
                      count: teamTotalAccounts.filter(
                        (acc) => normalizeTeamSaleMode(acc.saleMode) === "business",
                      ).length,
                    },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setTeamTotalTypeTab(tab.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                        teamTotalTypeTab === tab.key
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {tab.label} {tab.count}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Lọc khách
                </span>
                {renderCustomerFilterButtons(
                  teamCustomerFilter,
                  setTeamCustomerFilter,
                )}
                <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  Loc han
                </span>
                {renderExpiryRangeInputs(
                  teamExpiryMin,
                  (value) =>
                    handleExpiryRangeChange(
                      value,
                      setTeamExpiryMin,
                      setTeamExpiryFilter,
                    ),
                  teamExpiryMax,
                  (value) =>
                    handleExpiryRangeChange(
                      value,
                      setTeamExpiryMax,
                      setTeamExpiryFilter,
                    ),
                )}
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Moc nhanh
                </span>
                {renderExpiryFilterSelect(
                  teamExpiryFilter,
                  (value) =>
                    handleExpiryPresetChange(
                      value,
                      setTeamExpiryFilter,
                      setTeamExpiryMin,
                      setTeamExpiryMax,
                    ),
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-slate-300 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700">
                  Da chon: <span className="font-bold text-white">{selectedTeamIds.length}</span>
                </div>
                <button
                  onClick={() =>
                    handleToggleSelectAllFilteredTeam(
                      !allFilteredTeamSelected,
                      filteredTeamIds,
                    )
                  }
                  disabled={filteredTeamIds.length === 0}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {allFilteredTeamSelected ? "Bo chon tat ca dang loc" : "Chon tat ca dang loc"}
                </button>
                {selectedTeamIds.length > 0 && (
                  <button
                    onClick={() => setSelectedTeamIds([])}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-semibold text-sm"
                  >
                    Bo chon
                  </button>
                )}
                <button
                  onClick={handleCopySelectedTeamMarketplaceFormat}
                  disabled={selectedTeamIds.length === 0}
                  className="flex items-center gap-2 bg-cyan-700 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg font-semibold shadow-lg transition-transform justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Copy size={18} /> Copy format web
                </button>
                <button
                  onClick={() => handleBulkTeamWarehouseMove("total")}
                  disabled={selectedTeamIds.length === 0}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Ve kho tong
                </button>
                <button
                  onClick={() => handleBulkTeamWarehouseMove("market")}
                  disabled={selectedTeamIds.length === 0}
                  className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Day sang kho market
                </button>
                <button
                  onClick={() => handleBulkTeamWarehouseMove("short")}
                  disabled={selectedTeamIds.length === 0}
                  className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Day sang kho duoi 25
                </button>
              </div>
              {teamWarehouseTab === "market" && (
                <div className="mb-1 rounded-2xl border border-slate-700 bg-slate-900/60 shadow-lg overflow-hidden">
                  <div className="border-b border-slate-700/80 px-4 py-3 md:px-5 md:py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] font-black text-cyan-300">
                          Don san Team
                        </div>
                        <div className="text-lg font-black text-white">
                          Datammo + Shopmini
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Team market chi ban Business qua API. Don seller va bao hanh duoc theo doi rieng tai day.
                        </div>
                        <div className="mt-1 text-xs text-amber-300">
                          Slot Team khong ban qua API va admin tu them theo don.
                        </div>
                      </div>
                      <div className="text-xs text-slate-400">
                        Dang hien{" "}
                        <span className="font-bold text-white">
                          {filteredTeamMarketplaceOrders.length}
                        </span>{" "}
                        / {teamMarketplaceOrderSummaries.length} don gan nhat
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex-1 max-w-xl">
                        <input
                          type="text"
                          placeholder="Tim theo order, team goc, team bao hanh..."
                          value={teamMarketplaceOrderQuery}
                          onChange={(e) => setTeamMarketplaceOrderQuery(e.target.value)}
                          className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "all", label: "Tat ca" },
                          { value: "datammo", label: "Datammo" },
                          { value: "shopmini", label: "Shopmini" },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setTeamMarketplaceOrderProviderFilter(option.value)
                            }
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              teamMarketplaceOrderProviderFilter === option.value
                                ? "bg-cyan-600 text-white border-cyan-500"
                                : "bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700"
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead className="bg-slate-950/60 text-slate-300 uppercase text-[11px] tracking-[0.12em]">
                        <tr>
                          <th className="px-4 py-3 text-left">Nguon</th>
                          <th className="px-4 py-3 text-left">Order</th>
                          <th className="px-4 py-3 text-left">Team da ban</th>
                          <th className="px-4 py-3 text-left">Team hien tai</th>
                          <th className="px-4 py-3 text-left">Bao hanh</th>
                          <th className="px-4 py-3 text-left">Thoi gian</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTeamMarketplaceOrders.length > 0 ? (
                          filteredTeamMarketplaceOrders.map((order) => (
                            <tr
                              key={`${buildDatammoOrderKey(order)}-team`}
                              className="border-t border-slate-800/80 align-top"
                            >
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em] border ${
                                    order.provider === "shopmini"
                                      ? "bg-orange-500/10 text-orange-200 border-orange-500/30"
                                      : "bg-emerald-500/10 text-emerald-200 border-emerald-500/30"
                                  }`}
                                >
                                  {order.providerLabel}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-mono text-white font-semibold break-all">
                                  {order.orderId || "Khong ro"}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  So luong: {order.quantity || order.accountSummaries.length || 0}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-2">
                                  {order.accountSummaries.map((item, index) => (
                                    <div
                                      key={`${buildDatammoOrderKey(order)}-team-sold-${index}`}
                                      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
                                    >
                                      <div className="font-semibold text-white break-all">
                                        {item.soldUsername || item.soldAccountId || "Khong ro team"}
                                      </div>
                                      {item.soldAccountId && (
                                        <div className="mt-1 text-[11px] text-slate-500 break-all">
                                          ID: {item.soldAccountId}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-2">
                                  {order.accountSummaries.map((item, index) => {
                                    const isReplaced =
                                      String(item.currentAccountId || "") !==
                                      String(item.soldAccountId || "");
                                    return (
                                      <div
                                        key={`${buildDatammoOrderKey(order)}-team-current-${index}`}
                                        className={`rounded-lg border px-3 py-2 ${
                                          isReplaced
                                            ? "border-cyan-700/40 bg-cyan-950/20"
                                            : "border-slate-800 bg-slate-900/50"
                                        }`}
                                      >
                                        <div className="font-semibold text-white break-all">
                                          {item.currentUsername ||
                                            item.currentAccountId ||
                                            "Khong ro team"}
                                        </div>
                                        <div
                                          className={`mt-1 text-[11px] font-semibold ${
                                            isReplaced
                                              ? "text-cyan-300"
                                              : "text-slate-500"
                                          }`}
                                        >
                                          {isReplaced
                                            ? "Dang thay bao hanh"
                                            : "Dang dung team goc"}
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openWarrantyFromMarketplaceOrder(item)
                                            }
                                            className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors"
                                          >
                                            {item.warrantyRounds > 0
                                              ? "Bao hanh tiep"
                                              : "Bao hanh"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              focusMarketplaceAccountFromSummary(item)
                                            }
                                            className="rounded-lg bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors"
                                          >
                                            Toi team
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="space-y-2">
                                  {order.accountSummaries.map((item, index) => (
                                    <div
                                      key={`${buildDatammoOrderKey(order)}-team-warranty-${index}`}
                                      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
                                    >
                                      <div className="font-semibold text-white">
                                        {item.warrantyRounds > 0
                                          ? `${item.warrantyRounds} lan`
                                          : "Chua bao hanh"}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-400 break-all">
                                        {item.warrantyRounds > 0
                                          ? item.warrantySummary
                                          : "Dang dung team goc"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                                {order.timeLabel || "-"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-4 py-10 text-center text-slate-500"
                            >
                              Khong co don Team nao khop bo loc hien tai.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="grid gap-6 xl:grid-cols-2 items-start">
                {teamSections.map((section) => (
                  <div
                    key={section.key}
                    className={`rounded-2xl border p-4 sm:p-5 space-y-4 shadow-lg ${section.panelClass}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-white">{section.title}</h3>
                        <p className="text-xs text-slate-400">{section.subtitle}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full border text-xs font-bold ${section.badgeClass}`}>
                        {section.accounts.length} acc
                      </span>
                    </div>

                    {section.accounts.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 italic border border-slate-700/50 rounded-xl">
                        Chưa có tài khoản trong bảng này.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {section.accounts.map((acc) => {
                const expDays = acc.expiredAt ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000) : null;
                const isExpired = expDays !== null && expDays <= 0;
                const isNear = expDays !== null && expDays > 0 && expDays <= 7;
                const saleMode = normalizeTeamSaleMode(acc.saleMode);
                const isBusinessMode = saleMode === "business";
                const customerEntries = normalizeTeamSlotsForUi(acc.slots)
                  .map((slot, si) => ({ slot, si }))
                  .filter(({ slot }) => slot.status === "active" && !!slot.gmail);
                const usedSlots = customerEntries.length;
                const customerCapacity = getTeamCustomerCapacity(saleMode);
                const hasCapacityAvailable = usedSlots < customerCapacity;
                const isOverCapacity = usedSlots > customerCapacity;
                const activeBusinessSlot = isBusinessMode
                  ? customerEntries[0]?.slot || null
                  : null;
                const activeBusinessManagedInfo = getMarketplaceOrderInfoFromUser({
                  name: activeBusinessSlot?.customerName || "",
                });
                const latestTeamMarketplaceOrder = findMarketplaceOrderForAccount(
                  acc.id,
                  datammoOrderHistory,
                  activeBusinessManagedInfo.provider,
                  "team",
                );
                const teamMarketplaceOrderId = String(
                  activeBusinessManagedInfo.orderId ||
                    latestTeamMarketplaceOrder?.orderId ||
                    "",
                ).trim();
                const teamManagedProvider = normalizeMarketplaceProvider(
                  activeBusinessManagedInfo.provider ||
                    latestTeamMarketplaceOrder?.provider,
                );
                const teamWarrantyInfo = getDatammoWarrantyInfoForAccount(
                  acc.id,
                  datammoWarrantyCases,
                  "team",
                );
                const trackedTeamMarketplaceEntry = marketplaceTrackedAccountMap.get(
                  String(acc?.id || ""),
                );
                const trackedTeamMarketplaceRole = String(
                  trackedTeamMarketplaceEntry?.role || "",
                ).trim();
                const hasActiveTeamMarketplaceTracking =
                  trackedTeamMarketplaceRole === "sold" ||
                  trackedTeamMarketplaceRole === "current";
                const teamWarrantyCase = teamWarrantyInfo?.warrantyCase;
                const teamWarrantyRounds = Array.isArray(teamWarrantyCase?.rounds)
                  ? teamWarrantyCase.rounds
                  : [];
                const teamLatestWarrantyTarget =
                  teamWarrantyCase?.currentUsername ||
                  teamWarrantyRounds[teamWarrantyRounds.length - 1]?.toUsername ||
                  teamWarrantyCase?.currentAccountId ||
                  "";
                const canOpenTeamWarranty =
                  isBusinessMode &&
                  ((!!activeBusinessSlot &&
                    isDatammoManagedUser({
                      name: activeBusinessSlot?.customerName || "",
                    }) &&
                    !!teamMarketplaceOrderId) ||
                    (!!teamMarketplaceOrderId &&
                      hasActiveTeamMarketplaceTracking) ||
                    teamWarrantyInfo?.role === "current");
                const showTeamMarketplaceManagementCard =
                  isBusinessMode &&
                  (isTeamMarketWarehouse(acc) ||
                    (!!activeBusinessSlot &&
                      isDatammoManagedUser({
                        name: activeBusinessSlot?.customerName || "",
                      })) ||
                    !!teamWarrantyCase);
                const teamMarketplaceCardClasses =
                  teamWarrantyInfo?.role === "current"
                    ? "border-cyan-700/50 bg-cyan-950/20 text-cyan-100"
                    : teamWarrantyCase
                      ? "border-amber-700/50 bg-amber-950/20 text-amber-100"
                      : "border-emerald-700/50 bg-emerald-950/20 text-emerald-100";
                const teamMarketplaceChipClasses =
                  teamWarrantyInfo?.role === "current"
                    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-200"
                    : teamWarrantyCase
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                      : "border-emerald-500/30 bg-emerald-500/15 text-emerald-200";
                const teamMarketplaceStatusLabel = teamWarrantyCase
                  ? teamWarrantyInfo?.role === "current"
                    ? "Dang bao hanh"
                    : "Lich su bao hanh"
                  : !!activeBusinessSlot &&
                      isDatammoManagedUser({
                        name: activeBusinessSlot?.customerName || "",
                      })
                    ? "Da ban"
                    : "Chua ban";
                const teamMarketplaceCustomerName = String(
                  activeBusinessSlot?.customerName || "",
                ).trim();
                const teamSellerProviderLabel =
                  teamWarrantyCase?.provider || teamManagedProvider
                    ? getMarketplaceProviderLabel(
                        teamWarrantyCase?.provider || teamManagedProvider,
                      )
                    : "Datammo + Shopmini";
                return (
                  <div id={`team-account-row-${acc.id}`} key={acc.id} className={`rounded-2xl border shadow-xl overflow-hidden ${String(highlightedTeamAccountId || "") === String(acc.id || "") ? "ring-1 ring-cyan-500/50 bg-cyan-900/10" : ""} ${isExpired ? "border-red-700 bg-red-950/20" : isNear ? "border-yellow-700 bg-yellow-950/10" : "border-slate-700 bg-slate-900"}`}>
                    {/* Account header */}
                    <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 bg-indigo-900/40 border-b border-slate-700">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedTeamIdSet.has(String(acc?.id || ""))}
                          onChange={(e) => handleToggleTeamSelection(acc.id, e.target.checked)}
                          className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer shrink-0"
                          title="Chon Team"
                        />
                        <div>
                          <div className="flex items-center gap-2 font-bold text-white text-sm">
                          <span className="text-indigo-300">🏢</span>
                          <span className="font-mono text-xl">{acc.username}</span>
                          <button className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2" onClick={() => handleCopy(acc.username, "Đã copy Tên Team")} title="Copy Username"><Copy size={14} /> Copy</button>
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${isBusinessMode ? "bg-cyan-900/35 text-cyan-300 border-cyan-700/60" : "bg-teal-900/35 text-teal-300 border-teal-700/60"}`}>
                            {isBusinessMode ? "Bảng Business" : "Bảng Slot"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 mt-3 flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-20 text-slate-400">Pass GPT:</span>
                            <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                            <button className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors" onClick={() => handleCopy(acc.password, "Đã copy Pass GPT")} title="Copy Pass GPT">
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                          {acc.otpSecret && (
                            <div className="flex items-start gap-2 mt-1">
                              <span className="w-20 text-slate-400 pt-1">2FA:</span>
                              <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-cyan-200 min-w-[120px] break-all">
                                {acc.otpSecret}
                              </span>
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                onClick={() =>
                                  handleCopy(
                                    buildChatgpt2faCopyText(acc.otpSecret),
                                    "Đã copy mã 2FA Team & hướng dẫn lấy mã đăng nhập",
                                  )
                                }
                                title="Copy 2FA Secret"
                              >
                                <Copy size={14} /> Copy
                              </button>
                              <a
                                href={buildChatgpt2faLiveUrl(acc.otpSecret)}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-cyan-700 hover:bg-cyan-600 px-2.5 py-1 rounded text-white text-xs font-bold inline-flex items-center gap-1 transition-colors"
                                title="Mở 2fa.live"
                              >
                                <ExternalLink size={14} /> 2fa.live
                              </a>
                            </div>
                          )}
                          {acc.recoveryUrl && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="w-20 text-slate-400">Recovery:</span>
                              <a href={acc.recoveryUrl} target="_blank" rel="noreferrer" className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-1.5 rounded font-bold no-underline inline-flex items-center gap-2 shadow-md transition-transform hover:scale-105">
                                <Mail size={14} /> Mở Mail
                              </a>
                              <button onClick={() => handleCopy(acc.recoveryUrl, "Đã copy Recovery Link")} className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded flex items-center gap-1 text-xs text-white transition-colors font-bold" title="Copy Link Mail">
                                <Copy size={14} /> Link
                              </button>
                            </div>
                          )}
                        </div>
                        {acc.note && <div className="text-xs text-yellow-500/80 mt-3 italic bg-yellow-900/10 p-2 rounded inline-block">📝 {acc.note}</div>}
                      </div>
                      </div>
                      <div className="flex flex-col items-end justify-between gap-1 shrink-0 h-full min-h-[140px] w-full sm:w-auto">
                        <div className="flex flex-col items-end gap-1 w-full">
                          <div className={`text-xs font-bold ${isExpired ? "text-red-400" : isNear ? "text-yellow-400" : "text-green-400"}`}>
                            {isExpired ? `❌ Hết hạn ${Math.abs(expDays)}d trước` : expDays !== null ? `✅ Còn ${expDays} ngày` : ""}
                          </div>
                          <div className="text-xs text-cyan-300 font-bold mb-1">{getTeamSaleModeLabel(saleMode)}</div>
                          <select
                            value={normalizeTeamWarehouse(acc.warehouse)}
                            onChange={(e) =>
                              handleTeamWarehouseChange(acc, e.target.value)
                            }
                            disabled={
                              !!loadingStates.teamMode?.[acc.id] ||
                              !!loadingStates.changeTeamWarehouse?.[acc.id] ||
                              usedSlots > 0
                            }
                            className={`w-full text-[11px] rounded px-2 py-1.5 outline-none font-semibold border text-center ${
                              normalizeTeamWarehouse(acc.warehouse) === "market"
                                ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/60"
                                : normalizeTeamWarehouse(acc.warehouse) === "short"
                                  ? "bg-amber-900/40 text-amber-300 border-amber-700/60"
                                  : "bg-slate-800 text-slate-300 border-slate-600"
                            }`}
                          >
                            <option value="total">Kho tong</option>
                            {isBusinessMode && (
                              <option value="market">Kho market</option>
                            )}
                            {isBusinessMode && (
                              <option value="short">Kho duoi 25 ngay</option>
                            )}
                          </select>
                          {loadingStates.changeTeamWarehouse?.[acc.id] && (
                            <div className="text-center mt-1 text-[10px] text-emerald-300">
                              Dang cap nhat kho...
                            </div>
                          )}
                          {showTeamMarketplaceManagementCard && (
                            <div
                              className={`w-full rounded-xl border px-3 py-3 shadow-sm ${teamMarketplaceCardClasses}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/40">
                                      <Shield size={12} />
                                    </span>
                                    <div>
                                      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-white">
                                        Team market
                                      </div>
                                      <div className="mt-0.5 text-[10px] leading-relaxed text-slate-300">
                                        {teamSellerProviderLabel} ·{" "}
                                        {teamMarketplaceCustomerName || "Business chua ban"}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${teamMarketplaceChipClasses}`}
                                >
                                  {teamMarketplaceStatusLabel}
                                </span>
                              </div>
                              <div className="mt-3 space-y-1.5 text-[10px]">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-400">Order</span>
                                  <span className="font-semibold text-white">
                                    {teamMarketplaceOrderId || "Chua co"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-slate-400">Kho</span>
                                  <span className="font-semibold text-white">
                                    {getTeamWarehouseLabel(acc.warehouse)}
                                  </span>
                                </div>
                                {teamWarrantyCase && (
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-400">Bao hanh</span>
                                    <span className="font-semibold text-white">
                                      Lan {teamWarrantyRounds.length}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-200">
                                  {teamSellerProviderLabel}
                                </span>
                                {teamWarrantyCase && (
                                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-amber-200">
                                    {teamWarrantyInfo?.role === "current"
                                      ? "Acc dang thay"
                                      : teamWarrantyInfo?.role === "history"
                                        ? "Acc da thay"
                                        : "Acc loi goc"}
                                  </span>
                                )}
                              </div>
                              {teamWarrantyCase && (
                                <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 px-2.5 py-2 text-[10px] text-slate-200">
                                  {teamWarrantyInfo?.role === "current" ? (
                                    <div>Team nay dang la team hien tai cua don.</div>
                                  ) : teamLatestWarrantyTarget ? (
                                    <div>
                                      Hien tai dang thay boi{" "}
                                      <span className="font-semibold text-white">
                                        {teamLatestWarrantyTarget}
                                      </span>
                                    </div>
                                  ) : (
                                    <div>Dang luu lich su bao hanh cua don seller.</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {isTeamTotalWarehouse(acc) && (
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickTeamSaleModeChange(
                                  acc,
                                  isBusinessMode ? "slot" : "business",
                                )
                              }
                              disabled={!!loadingStates.teamMode?.[acc.id]}
                              className={`text-[11px] px-2 py-1 rounded border font-bold inline-flex items-center gap-1 transition-colors ${isBusinessMode ? "bg-teal-900/30 text-teal-300 border-teal-700/60 hover:bg-teal-800/40" : "bg-cyan-900/30 text-cyan-300 border-cyan-700/60 hover:bg-cyan-800/40"} ${loadingStates.teamMode?.[acc.id] ? "opacity-60 cursor-wait" : ""}`}
                              title="Đổi nhanh loại Team"
                            >
                              {loadingStates.teamMode?.[acc.id] ? (
                                <>
                                  <Loader2 size={11} className="animate-spin" /> Đang đổi...
                                </>
                              ) : (
                                <>↔ {isBusinessMode ? "Qua Slot team" : "Qua Business"}</>
                              )}
                            </button>
                          )}
                          <div className="text-xs text-indigo-300 font-bold mb-1">
                            {usedSlots}/{customerCapacity} {isBusinessMode ? "khách" : "slot đã cấp"}
                          </div>
                        </div>

                        <div className="w-full flex flex-col gap-2 mt-auto pt-2">
                          {hasCapacityAvailable ? (
                            <div className="flex flex-col gap-1 my-1 w-full">
                              {isTeamTotalWarehouse(acc) ? (
                                <div className="flex flex-col gap-2">
                                  <div className="w-full px-2 py-1 font-bold rounded text-[10px] uppercase border flex flex-col gap-0.5 shadow-sm items-center justify-center bg-slate-800 text-slate-300 border-slate-700">
                                    <span className="flex items-center gap-1">
                                      <Globe size={10} />
                                      Kho tong
                                    </span>
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => {
                                      const emptyIdx = (acc.slots || []).findIndex(s => s.status === "empty" || !s.gmail);
                                      if (emptyIdx !== -1) {
                                        setSlotTarget({ accId: acc.id, slotIdx: emptyIdx, slot: acc.slots[emptyIdx] });
                                        setSlotFormGmail(""); setSlotFormName("");
                                        setSlotFormExp(new Date().toISOString().split("T")[0]);
                                        setSlotFormExpiredAt(addDurationToDate(new Date(), "1M").toISOString().split("T")[0]);
                                        setShowSlotModal(true);
                                      }
                                    }} className="bg-emerald-600 hover:bg-emerald-500 font-bold text-white px-2 py-1.5 rounded text-xs transition-colors shadow flex items-center justify-center gap-1 w-full" title="Gan khach thuong">
                                      <UserPlus size={14} /> Khach
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="w-full text-center text-xs text-slate-400 font-bold italic my-1 shadow-sm p-2 border border-slate-700 rounded bg-slate-900/30">
                                  {isTeamMarketWarehouse(acc)
                                    ? "Team Business trong kho market se duoc ban tu dong qua Datammo + Shopmini."
                                    : "Team Business trong kho duoi 25 chi de day tay, khong di vao API stock/buy."}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-full text-center text-xs text-red-400 font-bold italic my-1 shadow-sm p-1 border border-red-900/30 rounded bg-red-900/10">
                              {isBusinessMode
                                ? isOverCapacity
                                  ? `Business đang dư ${usedSlots - customerCapacity} khách, cần chuyển hoặc xóa bớt`
                                  : "Business đã có khách (1/1)"
                                : `Đã kín ${customerCapacity}/${customerCapacity} Slot`}
                            </div>
                          )}
                          <button onClick={() => {
                            handleCopy(buildTeamBusinessCopyText(acc), "Đã copy toàn bộ form Team");
                          }} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 w-full justify-center shadow-lg transition-transform hover:scale-105 mb-1">
                            <Copy size={16} /> COPY CẢ CỤM
                          </button>

                          <div className="flex gap-2 w-full relative group">
                            {canOpenTeamWarranty && (
                              <button
                                type="button"
                                onClick={() => openWarrantyModal(acc, "team")}
                                className="bg-slate-700 hover:bg-cyan-600 text-slate-300 hover:text-white px-2 py-1.5 rounded text-xs flex items-center gap-1 justify-center transition-colors"
                                title="Bao hanh don san Team"
                              >
                                <Shield size={11} />
                              </button>
                            )}
                            <button onClick={() => { setTeamEditForm(buildTeamEditFormState({ id: acc.id, username: acc.username, password: acc.password, otpSecret: acc.otpSecret || "", recoveryUrl: acc.recoveryUrl || "", note: acc.note || "", expiredAt: acc.expiredAt ? new Date(acc.expiredAt).toISOString().split("T")[0] : "", saleMode: normalizeTeamSaleMode(acc.saleMode), warehouse: normalizeTeamWarehouse(acc.warehouse) })); setShowTeamEditModal(true); }} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-1.5 rounded text-xs flex items-center gap-1 flex-1 justify-center"><Pencil size={11} /> Sửa</button>
                            <button onClick={() => handleDeleteTeamAccount(acc.id)} className="bg-red-800 hover:bg-red-700 text-white px-2 py-1.5 rounded text-xs flex items-center gap-1 flex-1 justify-center"><Trash2 size={11} /> Xóa</button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Slots */}
                    {usedSlots > 0 ? (
                      <div className={`p-4 grid gap-3 ${isBusinessMode ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"}`}>
                        {customerEntries.map(({ slot, si }) => {
                          const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                          const sExpired = sExpDays !== null && sExpDays <= 0;
                          const sNear = sExpDays !== null && sExpDays > 0 && sExpDays <= 3;

                          return (
                            <div key={si} className={`rounded-xl border p-3 flex flex-col gap-1 w-full ${sExpired ? "border-red-800 bg-red-950/30" : sNear ? "border-yellow-800 bg-yellow-950/20" : "border-indigo-700/50 bg-indigo-900/20"}`}>
                              <>
                                <div className="flex-1 space-y-0.5">
                                  <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">
                                    {isBusinessMode ? "Khách Business" : `Slot ${si + 1}`}
                                  </div>
                                  <span className={`font-bold text-xs truncate max-w-full flex items-center gap-1 ${sExpired ? "text-red-500" : sNear ? "text-yellow-400" : "text-white"}`} title={slot.customerName}>
                                    {sExpired && <AlertCircle size={12} />}
                                    {sNear && <AlertTriangle size={12} />}
                                    👤 {slot.customerName || "—"}
                                  </span>
                                  <div className="text-[10px] text-blue-300 break-all">{slot.gmail}</div>
                                  <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                                    <Calendar size={10} /> {slot.addedAt ? new Date(slot.addedAt).toLocaleDateString("vi-VN") : "Chưa có ngày"}
                                    {sExpDays !== null && (
                                      <span className={sExpired ? "text-red-400 font-bold" : sNear ? "text-yellow-500 font-bold" : sExpDays > 30 ? "text-purple-400 font-bold" : "text-blue-400"}>
                                        {sExpired ? `(HH ${Math.abs(sExpDays)}ngày)` : `(Còn ${sExpDays}ngày)`}
                                      </span>
                                    )}
                                  </span>
                                  {slot.expiredAt && (
                                    <span className={`text-[10px] flex items-center gap-1 font-semibold ${sExpired ? "text-red-500" : sNear ? "text-yellow-500" : "text-emerald-500"}`}>
                                      🕑 HH: {new Date(slot.expiredAt).toLocaleDateString("vi-VN")}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1 mt-2">
                                  {(sExpired || sNear) && (
                                    <button
                                      type="button"
                                      onClick={() => handleExtendUser(acc.id, si, slot, "team")}
                                      className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                      title="Gia hạn"
                                    >
                                      <RotateCw size={14} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openMoveSlotModal(acc.id, si, slot)}
                                    className="bg-orange-600 hover:bg-orange-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title={isBusinessMode ? "Chuyển khách" : "Chuyển Slot"}
                                  >
                                    <ArrowRightLeft size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setSlotTarget({ accId: acc.id, slotIdx: si, slot }); setSlotFormGmail(slot.gmail || ""); setSlotFormName(slot.customerName || ""); setSlotFormExp(slot.addedAt ? new Date(slot.addedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]); setSlotFormExpiredAt(slot.expiredAt ? new Date(slot.expiredAt).toISOString().split("T")[0] : addDurationToDate(new Date(), "1M").toISOString().split("T")[0]); setShowSlotModal(true); }}
                                    className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title={isBusinessMode ? "Sửa khách" : "Sửa Slot"}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      showConfirm(isBusinessMode ? "Xóa khách Business" : "Xóa Slot", `Xóa khách ${slot.customerName}?`, async () => {
                                        try {
                                          const updSlots = [...acc.slots];
                                          updSlots[si] = buildEmptyTeamSlot();
                                          await axios.put(
                                            `/api/team/${acc.id}`,
                                            withExpectedUpdatedAt({ slots: updSlots }, acc),
                                          );
                                          fetchData();
                                          broadcastDataChange();
                                        } catch (error) {
                                          showAlert("Lỗi", getApiErrorMessage(error, "Không thể xóa khách"), "error");
                                        }
                                      });
                                    }}
                                    className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title="Xóa khách"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 flex items-center justify-center text-slate-500 text-sm italic">
                        Chưa có khách nào trong tài khoản này.
                      </div>
                    )}
                  </div>
                );
              })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ADD TEAM MODAL */}
          {showTeamAddModal && (
            <div className="modal-overlay">
              <div className="modal-box" style={{ maxWidth: "520px" }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">Them Team Account</h3>
                  <span className="close cursor-pointer text-slate-400 hover:text-white" onClick={() => setShowTeamAddModal(false)}>&times;</span>
                </div>

                <div className="space-y-3">
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Email chinh (Team)</label><input className="form-input w-full" placeholder="teamacc@outlook.com" value={teamAddForm.username} onChange={e => setTeamAddForm({ ...teamAddForm, username: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">GPT Password</label><input className="form-input w-full" value={teamAddForm.password} onChange={e => setTeamAddForm({ ...teamAddForm, password: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Mã 2FA Secret</label><input className="form-input w-full" placeholder="Ví dụ: UCFWSM5RHRAKCETR66A5MTOVQX6BBUP7" value={teamAddForm.otpSecret} onChange={e => setTeamAddForm({ ...teamAddForm, otpSecret: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Recovery URL</label><input className="form-input w-full" placeholder="http://..." value={teamAddForm.recoveryUrl} onChange={e => setTeamAddForm({ ...teamAddForm, recoveryUrl: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Han cua Team Acc</label><input type="date" className="form-input w-full" value={teamAddForm.expiredAt} onChange={e => setTeamAddForm({ ...teamAddForm, expiredAt: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Loai Team</label><select className="form-input w-full" value={teamAddForm.saleMode} onChange={e => { const nextSaleMode = normalizeTeamSaleMode(e.target.value); setTeamAddForm({ ...teamAddForm, saleMode: nextSaleMode, warehouse: nextSaleMode === "business" ? normalizeTeamWarehouse(teamAddForm.warehouse) : "total" }); }}><option value="slot">Slot team (4 slot)</option><option value="business">Business account (1 acc)</option></select></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Kho Team</label><select className="form-input w-full" value={normalizeTeamWarehouse(teamAddForm.warehouse)} onChange={e => setTeamAddForm({ ...teamAddForm, warehouse: normalizeTeamWarehouse(e.target.value) })}><option value="total">Kho tong</option>{normalizeTeamSaleMode(teamAddForm.saleMode) === "business" && (<option value="market">Kho market</option>)}{normalizeTeamSaleMode(teamAddForm.saleMode) === "business" && (<option value="short">Kho duoi 25 ngay</option>)}</select></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Ghi chu</label><input className="form-input w-full" value={teamAddForm.note} onChange={e => setTeamAddForm({ ...teamAddForm, note: e.target.value })} /></div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setShowTeamAddModal(false)} className="btn-secondary">Huy</button>
                  <button onClick={async () => {
                    try {
                      await axios.post("/api/team", { ...teamAddForm, expiredAt: teamAddForm.expiredAt ? new Date(teamAddForm.expiredAt).toISOString() : undefined });
                      setShowTeamAddModal(false);
                      fetchData();
                      showAlert("Thanh cong", "Da them Team Account!", "success");
                    } catch (e) { showAlert("Loi", getApiErrorMessage(e, "Khong the them Team Account"), "error"); }
                  }} className="btn-primary" style={{ background: "#4f46e5" }}>Them Team Acc</button>
                </div>
              </div>
            </div>
          )}

          {/* EDIT TEAM MODAL */}
          {showTeamEditModal && (
            <div className="modal-overlay">
              <div className="modal-box" style={{ maxWidth: "520px" }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">Sua Team Account</h3>
                  <span className="close cursor-pointer text-slate-400 hover:text-white" onClick={() => setShowTeamEditModal(false)}>&times;</span>
                </div>

                <div className="space-y-3">
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Email</label><input className="form-input w-full" value={teamEditForm.username} onChange={e => setTeamEditForm({ ...teamEditForm, username: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">GPT Password</label><input className="form-input w-full" value={teamEditForm.password} onChange={e => setTeamEditForm({ ...teamEditForm, password: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Mã 2FA Secret</label><input className="form-input w-full" placeholder="Ví dụ: UCFWSM5RHRAKCETR66A5MTOVQX6BBUP7" value={teamEditForm.otpSecret} onChange={e => setTeamEditForm({ ...teamEditForm, otpSecret: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Recovery URL</label><input className="form-input w-full" value={teamEditForm.recoveryUrl} onChange={e => setTeamEditForm({ ...teamEditForm, recoveryUrl: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Han Team Acc</label><input type="date" className="form-input w-full" value={teamEditForm.expiredAt} onChange={e => setTeamEditForm({ ...teamEditForm, expiredAt: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Loai Team</label><select className="form-input w-full" value={teamEditForm.saleMode} onChange={e => { const nextSaleMode = normalizeTeamSaleMode(e.target.value); setTeamEditForm({ ...teamEditForm, saleMode: nextSaleMode, warehouse: nextSaleMode === "business" ? normalizeTeamWarehouse(teamEditForm.warehouse) : "total" }); }}><option value="slot">Slot team (4 slot)</option><option value="business">Business account (1 acc)</option></select></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Kho Team</label><select className="form-input w-full" value={normalizeTeamWarehouse(teamEditForm.warehouse)} onChange={e => setTeamEditForm({ ...teamEditForm, warehouse: normalizeTeamWarehouse(e.target.value) })}><option value="total">Kho tong</option>{normalizeTeamSaleMode(teamEditForm.saleMode) === "business" && (<option value="market">Kho market</option>)}{normalizeTeamSaleMode(teamEditForm.saleMode) === "business" && (<option value="short">Kho duoi 25 ngay</option>)}</select></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">Ghi chu</label><input className="form-input w-full" value={teamEditForm.note} onChange={e => setTeamEditForm({ ...teamEditForm, note: e.target.value })} /></div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setShowTeamEditModal(false)} className="btn-secondary">Huy</button>
                  <button onClick={async () => {
                    try {
                      const currentTeamAcc = teamAccounts.find((item) => item.id === teamEditForm.id);
                      await axios.put(
                        "/api/team/" + teamEditForm.id,
                        withExpectedUpdatedAt(
                          {
                            ...teamEditForm,
                            expiredAt: teamEditForm.expiredAt ? new Date(teamEditForm.expiredAt).toISOString() : undefined,
                          },
                          currentTeamAcc,
                        ),
                      );
                      setShowTeamEditModal(false);
                      fetchData();
                      showAlert("Thanh cong", "Da cap nhat!", "success");
                    } catch (e) { showAlert("Loi", getApiErrorMessage(e, "Khong the cap nhat Team Account"), "error"); }
                  }} className="btn-primary" style={{ background: "#2563eb" }}>Luu</button>
                </div>
              </div>
            </div>
          )}

          {/* SLOT MODAL */}
          {showSlotModal && (() => {
            const slot = slotTarget.slot || {};
            const isEmpty = slot.status === "empty" || !slot.gmail;
            const parentAcc = teamAccounts.find(a => a.id === slotTarget.accId);
            const isBusinessMode = normalizeTeamSaleMode(parentAcc?.saleMode) === "business";

            let showWarning = false;
            let daysLeft = 0;
            if (isEmpty && parentAcc && parentAcc.expiredAt) {
              const exp = new Date(parentAcc.expiredAt);
              const now = new Date();
              daysLeft = Math.ceil((exp - now) / 86400000);
              if (daysLeft < 30) showWarning = true;
            }

            return (
              <div className="modal-overlay">
                <div className="modal-box" style={{ maxWidth: "450px" }}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white mb-0">
                      {isEmpty ? "➕ Gán Khách vào" : "✏️ Sửa"} {isBusinessMode ? "Business" : `Slot ${(slotTarget.slotIdx ?? 0) + 1}`}
                    </h3>
                    <span className="close cursor-pointer text-slate-400 hover:text-white text-2xl" onClick={() => setShowSlotModal(false)}>&times;</span>
                  </div>

                  {showWarning && (
                    <div className="mb-4 mt-2 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded flex gap-2 items-start">
                      <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
                      <div className="text-xs text-yellow-200">
                        <span className="font-bold block text-sm text-yellow-500">CẢNH BÁO HẠN DÙNG</span>
                        Tài khoản Team này chỉ còn <b>{daysLeft} ngày</b> (&lt; 1 tháng).<br />Khách mua tháng có thể bị gián đoạn!
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
              <div className="form-group">
                <label className="block text-xs text-slate-400 mb-1">
                  {isBusinessMode ? "🏷️ Mã / Tên Khách" : "📧 Gmail Khách"}
                </label>
                <input
                  className="form-input w-full"
                  placeholder={isBusinessMode ? "VD: 260316LFTJDJXQ" : "customer@gmail.com"}
                  value={slotFormGmail}
                  onChange={e => setSlotFormGmail(e.target.value)}
                />
              </div>
              {!isBusinessMode && (
                <div className="form-group">
                  <label className="block text-xs text-slate-400 mb-1">👤 Tên Khách</label>
                  <input
                    className="form-input w-full"
                    placeholder="Nguyễn Văn A"
                    value={slotFormName}
                    onChange={e => setSlotFormName(e.target.value)}
                  />
                </div>
              )}
                    <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📅 Ngày Tham Gia</label><input type="date" className="form-input w-full" value={slotFormExp} onChange={e => setSlotFormExp(e.target.value)} /></div>
                    <div className="form-group"><label className="block text-xs text-yellow-400 mb-1">📅 Ngày Hết Hạn</label><input type="date" className="form-input w-full" value={slotFormExpiredAt} onChange={e => setSlotFormExpiredAt(e.target.value)} /></div>
                  </div>

                  <div className="flex justify-between mt-6">
                    {!isEmpty ? (
                      <button onClick={async () => {
                        if (!parentAcc) return;
                        const updSlots = Array(4).fill(null).map((_, i) => (parentAcc.slots || [])[i] || buildEmptyTeamSlot());
                        updSlots[slotTarget.slotIdx] = buildEmptyTeamSlot();
                        await axios.put(
                          `/api/team/${slotTarget.accId}`,
                          withExpectedUpdatedAt({ slots: updSlots }, parentAcc),
                        );
                        setShowSlotModal(false); fetchData();
                      }} className="bg-red-800 hover:bg-red-700 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-2"><Trash2 size={16} /> {isBusinessMode ? "Xóa khách" : "Xóa Slot"}</button>
                    ) : (<div></div>)}
                    <div className="flex gap-2">
                      <button onClick={() => setShowSlotModal(false)} className="btn-secondary">Hủy</button>
                      <button onClick={async () => {
                        if (!parentAcc) return;
                        const updSlots = Array(4).fill(null).map((_, i) => (parentAcc.slots || [])[i] || buildEmptyTeamSlot());
                        const joinDate = slotFormExp ? new Date(slotFormExp) : new Date();
                        const expireDate = slotFormExpiredAt ? new Date(slotFormExpiredAt) : addDurationToDate(joinDate, "1M");
                        updSlots[slotTarget.slotIdx] = { status: slotFormGmail ? "active" : "empty", gmail: slotFormGmail, customerName: slotFormName, addedAt: joinDate.toISOString(), expiredAt: expireDate.toISOString() };
                        await axios.put(
                          `/api/team/${slotTarget.accId}`,
                          withExpectedUpdatedAt({ slots: updSlots }, parentAcc),
                        );
                        setShowSlotModal(false); fetchData();
                      }} className="btn-primary" style={{ background: "#4f46e5" }}>💾 Lưu</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {showSimpleAddModal && (() => {
        const opts = {
          netflix: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
          capcut: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }],
          canva: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
        };
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[simpleAddPlatform] || simpleAddPlatform;
        const durOpts = opts[simpleAddPlatform] || opts.netflix;
        const isCanva = simpleAddPlatform === "canva";

        const calcExp = (dur) => addDurationToDate(new Date(), dur).toISOString();

        const handleSubmit = async (e) => {
          e.preventDefault();
          try {
            await axios.post(`/api/${simpleAddPlatform}`, {
              username: simpleAddForm.username.trim(),
              password: simpleAddForm.password.trim(),
              note: simpleAddForm.note.trim(),
              duration: simpleAddForm.duration,
              expiredAt: calcExp(simpleAddForm.duration),
            });
            setShowSimpleAddModal(false);
            fetchData();
          } catch (err) { alert("Lỗi thêm tài khoản"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "480px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">Thêm Tài Khoản {platformLabel}</h2>
                <button type="button" onClick={() => setShowSimpleAddModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Email / Username *</label>
                  <input required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.username} onChange={e => setSimpleAddForm(p => ({ ...p, username: e.target.value }))} placeholder="email@example.com" />
                </div>
                {!isCanva && (
                  <div>
                    <label className="text-slate-400 text-sm block mb-1">Mật khẩu</label>
                    <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono" value={simpleAddForm.password} onChange={e => setSimpleAddForm(p => ({ ...p, password: e.target.value }))} placeholder="Password..." />
                  </div>
                )}
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Thời hạn gói linh hoạt</label>
                  <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.duration} onChange={e => setSimpleAddForm(p => ({ ...p, duration: e.target.value }))}>
                    {durOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ghi chú (Tùy chọn)</label>
                  <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.note} onChange={e => setSimpleAddForm(p => ({ ...p, note: e.target.value }))} placeholder="VD: Profile 2..." />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowSimpleAddModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold">Thêm</button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* EDIT MODAL */}
      {showSimpleEditModal && (() => {
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[activeTab] || activeTab;
        const opts = {
          netflix: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
          capcut: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }],
          canva: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
        };
        const durOpts = opts[activeTab] || opts.netflix;
        const isCanva = activeTab === "canva";

        const handleDurationChange = (e) => {
          const newDur = e.target.value;
          const d = addDurationToDate(new Date(), newDur);
          setSimpleEditForm(p => ({ ...p, duration: newDur, expiredAt: d.toISOString().split('T')[0] }));
        };

        const handleEditSubmit = async (e) => {
          e.preventDefault();
          try {
            const currentSimpleAcc =
              ({
                netflix: netflixAccounts,
                capcut: capcutAccounts,
                canva: canvaAccounts,
              }[activeTab] || []
              ).find((acc) => acc.id === simpleEditForm.id);
            const bodyData = {
              username: simpleEditForm.username.trim(),
              password: simpleEditForm.password.trim(),
              note: simpleEditForm.note.trim(),
              duration: simpleEditForm.duration,
            };
            if (simpleEditForm.expiredAt) {
              bodyData.expiredAt = new Date(simpleEditForm.expiredAt).toISOString();
            }
            await axios.put(
              `/api/${activeTab}/${simpleEditForm.id}`,
              withExpectedUpdatedAt(bodyData, currentSimpleAcc || simpleEditForm),
            );
            setShowSimpleEditModal(false);
            fetchData();
            broadcastDataChange();
            showAlert("Thành công", "Đã cập nhật tài khoản", "success");
          } catch (err) { showAlert("Lỗi", getApiErrorMessage(err, "Cập nhật thất bại"), "error"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={handleEditSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "480px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex gap-2 items-center"><Pencil size={20} className="text-blue-400" />Sửa Tài Khoản {platformLabel}</h2>
                <button type="button" onClick={() => setShowSimpleEditModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Email / Username *</label>
                  <input required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.username} onChange={e => setSimpleEditForm(p => ({ ...p, username: e.target.value }))} />
                </div>
                {!isCanva && (
                  <div>
                    <label className="text-slate-400 text-sm block mb-1">Mật khẩu</label>
                    <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono" value={simpleEditForm.password} onChange={e => setSimpleEditForm(p => ({ ...p, password: e.target.value }))} />
                  </div>
                )}
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Gói linh hoạt (hiện tại)</label>
                  <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.duration} onChange={handleDurationChange}>
                    {durOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ngày Hết Hạn Tính Tiền Mới</label>
                  <input type="date" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.expiredAt} onChange={e => setSimpleEditForm(p => ({ ...p, expiredAt: e.target.value }))} />
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ghi chú</label>
                  <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.note} onChange={e => setSimpleEditForm(p => ({ ...p, note: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowSimpleEditModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">Lưu Cập Nhật</button>
              </div>
            </form>
          </div>
        );
      })()}


      {/* ========================================================= */}
      {showWarrantyModal && warrantySourceAcc && (() => {
        const sourceScope = normalizeMarketplaceScope(warrantySourceScope);
        const isTeamWarranty = sourceScope === "team";
        const getWarrantyRemainingDaysLabel = (isoString) => {
          const status = getExpiryStatus(isoString);
          return status?.text || "Khong co han";
        };
        const sourceUser = Array.isArray(warrantySourceAcc?.users)
          ? warrantySourceAcc.users[0]
          : null;
        const sourceTeamCustomer = isTeamWarranty
          ? getActiveTeamCustomers(warrantySourceAcc)[0] || null
          : null;
        const requiredWarrantyExpiryIso = String(
          (isTeamWarranty
            ? sourceTeamCustomer?.expiredAt
            : sourceUser?.expiredAt) ||
            warrantySourceAcc?.expiredAt ||
            "",
        ).trim();
        const eligibleReplacementAccounts = (
          isTeamWarranty ? teamAccounts : accounts
        ).filter((acc) => {
          if (String(acc?.id || "") === String(warrantySourceAcc?.id || "")) {
            return false;
          }
          if (isTeamWarranty) {
            if (normalizeTeamSaleMode(acc?.saleMode) !== "business") return false;
            if (getActiveTeamCustomers(acc).length > 0) return false;
            if (isMarketplaceSoldAccountForScope(acc?.id, "team")) return false;
            if (isAccountBusyInDatammoWarranty(acc?.id, datammoWarrantyCases, "team")) {
              return false;
            }
            if (
              acc?.expiredAt &&
              new Date(acc.expiredAt).getTime() <= Date.now()
            ) {
              return false;
            }
            return true;
          }
          if (!["package2", "unassigned"].includes(String(acc?.type || "").trim())) {
            return false;
          }
          if (Array.isArray(acc?.users) && acc.users.length > 0) return false;
          if (isMarketplaceSoldAccountForScope(acc?.id, "chatgpt")) return false;
          if (
            isAccountBusyInDatammoWarranty(acc?.id, datammoWarrantyCases, "chatgpt")
          ) {
            return false;
          }
          if (
            acc?.expiredAt &&
            new Date(acc.expiredAt).getTime() <= Date.now()
          ) {
            return false;
          }
          return true;
        });
        const filteredReplacementAccounts = eligibleReplacementAccounts.filter((acc) => {
          const normalizedWarehouse = isTeamWarranty
            ? normalizeTeamWarehouse(acc?.warehouse)
            : normalizePackage2Shelf(acc?.package2Shelf);
          if (
            warrantyWarehouseFilter !== "all" &&
            normalizedWarehouse !== warrantyWarehouseFilter
          ) {
            return false;
          }
          const searchIndex = toNonAccentVietnamese(
            [
              acc?.username,
              isTeamWarranty
                ? getTeamWarehouseLabel(acc?.warehouse)
                : getPackage2ShelfLabel(acc?.package2Shelf),
              formatDate(acc?.expiredAt),
              getWarrantyRemainingDaysLabel(acc?.expiredAt),
            ]
              .filter(Boolean)
              .join(" "),
          );
          return searchIndex.includes(
            toNonAccentVietnamese(warrantyReplacementSearch),
          );
        });
        const hasVisibleReplacementSelected = filteredReplacementAccounts.some(
          (acc) => String(acc?.id || "") === String(warrantyReplacementId || ""),
        );
        const sourceManagedInfo = isTeamWarranty
          ? getMarketplaceOrderInfoFromUser({
              name: sourceTeamCustomer?.customerName || "",
            })
          : getMarketplaceOrderInfoFromUser(sourceUser);
        const latestMarketplaceOrder = findMarketplaceOrderForAccount(
          warrantySourceAcc?.id,
          datammoOrderHistory,
          sourceManagedInfo.provider,
          sourceScope,
        );
        const orderId = String(
          sourceManagedInfo.orderId || latestMarketplaceOrder?.orderId || "",
        ).trim();
        const providerLabel = getMarketplaceProviderLabel(
          sourceManagedInfo.provider || latestMarketplaceOrder?.provider,
        );

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form
              onSubmit={handleCreateDatammoWarranty}
              className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl"
              style={{ maxWidth: "560px" }}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Shield size={20} className="text-cyan-400" />
                  Tạo bảo hành {providerLabel}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowWarrantyModal(false);
                    setWarrantyReplacementSearch("");
                    setWarrantyWarehouseFilter("all");
                    setWarrantyReplacementId("");
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 mb-4 space-y-1">
                <div className="text-sm text-slate-400">
                  Order: <span className="font-semibold text-white">{orderId || "Không rõ"}</span>
                </div>
                <div className="text-sm text-slate-400">
                  {isTeamWarranty ? "Team lỗi hiện tại:" : "Acc lỗi hiện tại:"}
                  <span className="ml-2 font-mono text-white">{warrantySourceAcc.username}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {isTeamWarranty
                    ? `Khách ${providerLabel} của Team Business sẽ được chuyển sang Team thay thế, và lịch sử bảo hành sẽ được ghi lại theo từng lần.`
                    : `Khách ${providerLabel} sẽ được chuyển sang acc thay thế, acc lỗi sẽ bị gỡ khỏi kho và ghi vào lịch sử bảo hành.`}
                </div>
                {requiredWarrantyExpiryIso && (
                  <div className="text-xs text-cyan-300">
                    Hạn khách hiện tại: {formatDate(requiredWarrantyExpiryIso)} ·{" "}
                    {getWarrantyRemainingDaysLabel(requiredWarrantyExpiryIso)}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">
                    Tài khoản thay thế *
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2 mb-2">
                    <input
                      value={warrantyReplacementSearch}
                      onChange={(e) => {
                        setWarrantyReplacementSearch(e.target.value);
                        setWarrantyReplacementId("");
                      }}
                      placeholder={
                        isTeamWarranty
                          ? "Tim Team thay the..."
                          : "Tim acc thay the..."
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                    />
                    <select
                      value={warrantyWarehouseFilter}
                      onChange={(e) => {
                        setWarrantyWarehouseFilter(e.target.value);
                        setWarrantyReplacementId("");
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                    >
                      <option value="all">Tat ca kho</option>
                      <option value={isTeamWarranty ? "total" : "none"}>Kho tong</option>
                      <option value={isTeamWarranty ? "market" : "cheap"}>Kho market</option>
                      <option value={isTeamWarranty ? "short" : "main"}>Kho duoi 25 ngay</option>
                    </select>
                  </div>
                  <select
                    required
                    value={hasVisibleReplacementSelected ? warrantyReplacementId : ""}
                    onChange={(e) => setWarrantyReplacementId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
                  >
                    <option value="">
                      {isTeamWarranty
                        ? "Chọn Team Business trống..."
                        : "Chọn acc trống..."}
                    </option>
                    {filteredReplacementAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {isTeamWarranty
                          ? `${acc.username} · ${getTeamWarehouseLabel(acc.warehouse)} · ${formatDate(acc.expiredAt)} · ${getWarrantyRemainingDaysLabel(acc.expiredAt)}`
                          : `${acc.username} · ${getPackage2ShelfLabel(acc.package2Shelf)} · ${formatDate(acc.expiredAt)} · ${getWarrantyRemainingDaysLabel(acc.expiredAt)}`}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 text-[11px] text-cyan-300">
                    Hien {filteredReplacementAccounts.length}/{eligibleReplacementAccounts.length} acc sach
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                    {isTeamWarranty
                      ? "Chi hien Team Business trong 100%: khong co khach, chua ban, khong nam trong bao hanh va chua het han."
                      : "Chi hien acc trong 100%: khong co khach, chua ban, khong nam trong bao hanh va chua het han."}
                  </div>
                  {filteredReplacementAccounts.length === 0 && (
                    <div className="mt-2 text-xs text-yellow-400">
                      {isTeamWarranty
                        ? "Khong co Team Business trong 100% phu hop de bao hanh."
                        : "Khong co acc trong 100% phu hop de bao hanh."}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-slate-400 text-sm block mb-1">
                    Lý do bảo hành
                  </label>
                  <textarea
                    value={warrantyReason}
                    onChange={(e) => setWarrantyReason(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all resize-none"
                    placeholder="Ví dụ: acc die, login lỗi, mất quyền truy cập..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setShowWarrantyModal(false);
                    setWarrantyReplacementSearch("");
                    setWarrantyWarehouseFilter("all");
                    setWarrantyReplacementId("");
                  }}
                  className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={
                    loadingStates.warranty ||
                    filteredReplacementAccounts.length === 0 ||
                    !hasVisibleReplacementSelected
                  }
                  className="flex-1 p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  {loadingStates.warranty ? "Đang bảo hành..." : "Xác nhận bảo hành"}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* MODAL GÁN KHÁCH (NETFLIX, CAPCUT, CANVA)                    */}
      {/* ========================================================= */}
      {showAssignUserModal && assignUserAcc && (() => {
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[activeTab] || activeTab;

        const executeAssignUser = async (e) => {
          e.preventDefault();
          if (!assignUserName?.trim() || !assignUserAcc) return;
          try {
            const platform = activeTab;
            const newUsers = [{ name: assignUserName.trim(), joinedAt: new Date().toISOString() }];
            await axios.put(
              `/api/${platform}/${assignUserAcc.id}`,
              withExpectedUpdatedAt({ users: newUsers }, assignUserAcc),
            );
            setShowAssignUserModal(false);
            setAssignUserAcc(null);
            fetchData();
            broadcastDataChange();
          } catch (e) { showAlert("Lỗi", getApiErrorMessage(e, "Lỗi gán khách"), "error"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={executeAssignUser} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "400px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <UserPlus size={20} className="text-blue-400" />
                  Gán Khách Hàng
                </h2>
                <button type="button" onClick={() => setShowAssignUserModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>

              <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 mb-4">
                <div className="text-sm text-slate-400">Tài khoản {platformLabel}:</div>
                <div className="font-mono text-white font-bold">{assignUserAcc.username}</div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Tên khách hàng *</label>
                  <input
                    required
                    autoFocus
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    value={assignUserName}
                    onChange={e => setAssignUserName(e.target.value)}
                    placeholder="Nhập tên khách..."
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowAssignUserModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">Xác Nhận</button>
              </div>
            </form>
          </div>
        );
      })()}

    </div>
  );
}

export default App;
