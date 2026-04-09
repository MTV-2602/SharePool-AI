const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const {
  buildAdminRealtimeTopic,
  buildStoreRealtimeClientConfig,
  buildStoreSupportRealtimeTopic,
  buildStoreUserRealtimeTopic,
  emitRealtimeEvents,
} = require("./realtime");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- MONGODB CONNECTION ---
// Cache connection to avoid reconnecting on every request (Vercel specific)
let isConnected = false;
let connectPromise = null;
let lastDbConnectError = "";
let lastDbConnectErrorAt = "";
let didCleanupLegacyTeamEmailPassword = false;
let didCleanupLegacyChatgptMarketKeys = false;
let didMigrateLegacyCollections = false;
let didNormalizeLegacyDatammoCustomers = false;
let didDropLegacyCollections = false;
const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};
const MONGO_CONNECT_OPTIONS = {
  maxPoolSize: toPositiveInt(process.env.MONGO_MAX_POOL_SIZE, 5),
  minPoolSize: toPositiveInt(process.env.MONGO_MIN_POOL_SIZE, 0),
  maxIdleTimeMS: toPositiveInt(process.env.MONGO_MAX_IDLE_TIME_MS, 10000),
  serverSelectionTimeoutMS: toPositiveInt(
    process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    8000,
  ),
  socketTimeoutMS: toPositiveInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 20000),
};
const CHATGPT_MAIL_CHECK_PROVIDER = "tinyhost";
const TINYHOST_BASE_URL = String(
  process.env.TINYHOST_BASE_URL || "https://tinyhost.shop",
)
  .trim()
  .replace(/\/+$/, "");
const CHATGPT_MAIL_DIE_LIST_LIMIT = Math.max(
  1,
  Math.min(toPositiveInt(process.env.CHATGPT_MAIL_DIE_LIST_LIMIT, 10), 20),
);
const CHATGPT_MAIL_DIE_AUDIT_BATCH_LIMIT = Math.max(
  1,
  Math.min(toPositiveInt(process.env.CHATGPT_MAIL_DIE_AUDIT_BATCH_LIMIT, 25), 100),
);
const CHATGPT_MAIL_DIE_AUDIT_MIN_INTERVAL_MS = Math.max(
  60 * 60 * 1000,
  toPositiveInt(
    process.env.CHATGPT_MAIL_DIE_AUDIT_MIN_INTERVAL_MS,
    24 * 60 * 60 * 1000,
  ),
);
const CHATGPT_MAIL_DIE_SNIPPET_MAX_LENGTH = Math.max(
  80,
  Math.min(
    toPositiveInt(process.env.CHATGPT_MAIL_DIE_SNIPPET_MAX_LENGTH, 240),
    1000,
  ),
);
const OPENAI_SYSTEM_SENDER_DOMAINS = ["openai.com", "tm.openai.com"];
const OPENAI_DEACTIVATION_SUBJECT_PATTERNS = [
  "access deactivated",
  "account deactivated",
  "access disabled",
  "account disabled",
  "account restricted",
  "access restricted",
  "openai - access deactivated",
];
const OPENAI_DEACTIVATION_BODY_PATTERNS = [
  "we are deactivating your access",
  "we are disabling your access",
  "your access to our services immediately",
  "activity in chatgpt that is not permitted",
  "restrict the use of our services",
  "not permitted under our policies",
  "we have identified activity in chatgpt",
];

const getMongoReadyStateLabel = (readyState) => {
  switch (Number(readyState || 0)) {
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "disconnected";
  }
};

const getDbHealthSnapshot = () => ({
  connected: !!(isConnected && mongoose.connection?.readyState === 1),
  readyState: Number(mongoose.connection?.readyState || 0),
  readyStateLabel: getMongoReadyStateLabel(mongoose.connection?.readyState),
  hasMongoUri: !!process.env.MONGO_URI,
  lastErrorAt: lastDbConnectErrorAt,
  lastErrorMessage: lastDbConnectError,
});

const getLegacyMigrationUserName = (user) => {
  if (typeof user === "string") return user;
  if (user && typeof user === "object") return user.name || "";
  return "";
};

const isLegacyDatammoManagedUser = (user) => {
  const normalizedName = String(getLegacyMigrationUserName(user) || "")
    .trim()
    .toLowerCase();
  return (
    normalizedName.startsWith("datammo#") || normalizedName.startsWith("[datammo]")
  );
};

const buildLegacyDatammoCustomerNoteLine = (user) => {
  const name = String(getLegacyMigrationUserName(user) || "").trim();
  const joinedAt =
    user && typeof user === "object" ? String(user.joinedAt || "").trim() : "";
  const expiredAt =
    user && typeof user === "object" ? String(user.expiredAt || "").trim() : "";
  const details = [`[Legacy Datammo customer] ${name || "Khong ro ten"}`];
  if (joinedAt) details.push(`joined: ${joinedAt}`);
  if (expiredAt) details.push(`expired: ${expiredAt}`);
  return details.join(" | ");
};

const appendLegacyMigrationNote = (note, lines = []) => {
  const current = String(note || "").trim();
  const extras = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (extras.length === 0) return current;
  return [current, ...extras].filter(Boolean).join("\n");
};
const normalizeVietnameseForSearch = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();

function isValidEmailAddress(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeChatgptMailCheckStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "died") return "died";
  if (normalized === "clean") return "clean";
  return "unchecked";
}

function parseTinyhostInboxFromEmail(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!match) return null;
  return {
    email: normalized,
    user: String(match[1] || "").trim(),
    domain: String(match[2] || "").trim(),
  };
}

function stripHtmlTags(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMailCheckSnippet(...values) {
  const raw = values
    .map((value) => stripHtmlTags(value))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.slice(0, CHATGPT_MAIL_DIE_SNIPPET_MAX_LENGTH);
}

function extractEmailFromSenderText(value = "") {
  const match = String(value || "")
    .trim()
    .match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (match && match[1]) return String(match[1]).trim().toLowerCase();
  return String(value || "").trim().toLowerCase();
}

function isOpenAiSystemSender(value = "") {
  const senderEmail = extractEmailFromSenderText(value);
  if (!senderEmail) return false;
  const domain = String(senderEmail.split("@")[1] || "").trim().toLowerCase();
  return OPENAI_SYSTEM_SENDER_DOMAINS.includes(domain);
}

function matchesMailCheckPatterns(value = "", patterns = []) {
  const haystack = normalizeVietnameseForSearch(value).replace(/\s+/g, " ").trim();
  if (!haystack) return false;
  return (Array.isArray(patterns) ? patterns : []).some((pattern) =>
    haystack.includes(normalizeVietnameseForSearch(pattern)),
  );
}

function isPotentialOpenAiDeactivationMail(message = {}) {
  if (!isOpenAiSystemSender(message?.sender)) return false;
  const subject = String(message?.subject || "").trim();
  if (matchesMailCheckPatterns(subject, OPENAI_DEACTIVATION_SUBJECT_PATTERNS)) {
    return true;
  }
  const snippet = buildMailCheckSnippet(message?.body, message?.html_body);
  return matchesMailCheckPatterns(snippet, OPENAI_DEACTIVATION_BODY_PATTERNS);
}

function buildChatgptMailCheckStateForPayload(payload = {}, existingAcc = null) {
  const username = String(
    payload?.username ?? existingAcc?.username ?? "",
  ).trim();
  const hasExisting = !!(existingAcc && typeof existingAcc === "object");
  const existingEnabled = hasExisting ? !!existingAcc?.mailCheckEnabled : false;
  const usernameIsValidEmail = isValidEmailAddress(username);
  const mailCheckEnabled = hasExisting
    ? existingEnabled && usernameIsValidEmail
    : usernameIsValidEmail;
  const mailCheckProvider = mailCheckEnabled
    ? CHATGPT_MAIL_CHECK_PROVIDER
    : hasExisting
      ? String(existingAcc?.mailCheckProvider || "").trim()
      : "";
  return {
    mailCheckEnabled,
    mailCheckProvider,
    mailCheckStatus: normalizeChatgptMailCheckStatus(
      hasExisting ? existingAcc?.mailCheckStatus : "unchecked",
    ),
    mailCheckLastCheckedAt: hasExisting
      ? String(existingAcc?.mailCheckLastCheckedAt || "").trim()
      : "",
    mailCheckLastMatchedEmailId: hasExisting
      ? String(existingAcc?.mailCheckLastMatchedEmailId || "").trim()
      : "",
    mailCheckLastMatchedAt: hasExisting
      ? String(existingAcc?.mailCheckLastMatchedAt || "").trim()
      : "",
    mailCheckLastSubject: hasExisting
      ? String(existingAcc?.mailCheckLastSubject || "").trim()
      : "",
    mailCheckLastSender: hasExisting
      ? String(existingAcc?.mailCheckLastSender || "").trim()
      : "",
    mailCheckLastSnippet: hasExisting
      ? String(existingAcc?.mailCheckLastSnippet || "").trim()
      : "",
  };
}

function sanitizeChatgptMailCheckRecord(account = {}) {
  return {
    id: String(account?.id || "").trim(),
    username: String(account?.username || "").trim(),
    type: String(account?.type || "").trim(),
    package2Shelf: String(account?.package2Shelf || "").trim(),
    expiredAt: String(account?.expiredAt || "").trim(),
    mailCheckEnabled: !!account?.mailCheckEnabled,
    mailCheckProvider: String(account?.mailCheckProvider || "").trim(),
    mailCheckStatus: normalizeChatgptMailCheckStatus(account?.mailCheckStatus),
    mailCheckLastCheckedAt: String(account?.mailCheckLastCheckedAt || "").trim(),
    mailCheckLastMatchedEmailId: String(account?.mailCheckLastMatchedEmailId || "").trim(),
    mailCheckLastMatchedAt: String(account?.mailCheckLastMatchedAt || "").trim(),
    mailCheckLastSubject: String(account?.mailCheckLastSubject || "").trim(),
    mailCheckLastSender: String(account?.mailCheckLastSender || "").trim(),
    mailCheckLastSnippet: String(account?.mailCheckLastSnippet || "").trim(),
  };
}

async function fetchTinyhostInboxList(domain, user, options = {}) {
  const response = await axios.get(
    `${TINYHOST_BASE_URL}/api/email/${encodeURIComponent(domain)}/${encodeURIComponent(user)}/`,
    {
      params: {
        page: 1,
        limit: Math.max(
          1,
          Math.min(Number(options?.limit || CHATGPT_MAIL_DIE_LIST_LIMIT), 100),
        ),
      },
      timeout: Number(options?.timeout || 15000),
    },
  );
  return Array.isArray(response?.data?.emails) ? response.data.emails : [];
}

async function fetchTinyhostEmailDetail(domain, user, emailId, options = {}) {
  const response = await axios.get(
    `${TINYHOST_BASE_URL}/api/email/${encodeURIComponent(domain)}/${encodeURIComponent(user)}/${encodeURIComponent(emailId)}`,
    {
      timeout: Number(options?.timeout || 15000),
    },
  );
  return response?.data && typeof response.data === "object" ? response.data : null;
}

function buildChatgptMailCheckResult(account = {}, result = {}) {
  return {
    accountId: String(account?.id || "").trim(),
    username: String(account?.username || "").trim(),
    status: String(result?.status || "skipped").trim(),
    changed: !!result?.changed,
    source: String(result?.source || "").trim(),
    reason: String(result?.reason || "").trim(),
    mailCheckStatus: normalizeChatgptMailCheckStatus(
      result?.mailCheckStatus || account?.mailCheckStatus,
    ),
    mailCheckEnabled:
      result?.mailCheckEnabled !== undefined
        ? !!result.mailCheckEnabled
        : !!account?.mailCheckEnabled,
    mailCheckProvider: String(
      result?.mailCheckProvider || account?.mailCheckProvider || "",
    ).trim(),
    mailCheckLastCheckedAt: String(
      result?.mailCheckLastCheckedAt || account?.mailCheckLastCheckedAt || "",
    ).trim(),
    mailCheckLastMatchedEmailId: String(
      result?.mailCheckLastMatchedEmailId || account?.mailCheckLastMatchedEmailId || "",
    ).trim(),
    mailCheckLastMatchedAt: String(
      result?.mailCheckLastMatchedAt || account?.mailCheckLastMatchedAt || "",
    ).trim(),
    mailCheckLastSubject: String(
      result?.mailCheckLastSubject || account?.mailCheckLastSubject || "",
    ).trim(),
    mailCheckLastSender: String(
      result?.mailCheckLastSender || account?.mailCheckLastSender || "",
    ).trim(),
    mailCheckLastSnippet: String(
      result?.mailCheckLastSnippet || account?.mailCheckLastSnippet || "",
    ).trim(),
  };
}

async function runChatgptMailCheckForAccount(accountInput = {}, options = {}) {
  const source = String(options?.source || "manual").trim() || "manual";
  const account =
    accountInput &&
    typeof accountInput === "object" &&
    accountInput.id &&
    accountInput.username
      ? accountInput
      : await Account.findOne({
          id: String(accountInput?.id || accountInput || "").trim(),
        })
          .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
          .lean();
  if (!account) {
    return {
      accountId: String(accountInput?.id || accountInput || "").trim(),
      username: "",
      status: "error",
      changed: false,
      source,
      reason: "Khong tim thay account.",
    };
  }

  const mailbox = parseTinyhostInboxFromEmail(account?.username);
  if (!mailbox) {
    return buildChatgptMailCheckResult(account, {
      status: "skipped",
      changed: false,
      source,
      reason: "Username khong phai email hop le de doc Tinyhost.",
    });
  }

  let emails = [];
  try {
    emails = await fetchTinyhostInboxList(mailbox.domain, mailbox.user, {
      limit: CHATGPT_MAIL_DIE_LIST_LIMIT,
    });
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);
    if (statusCode === 404) {
      return buildChatgptMailCheckResult(account, {
        status: "skipped",
        changed: false,
        source,
        reason: "Khong tim thay inbox Tinyhost cho account nay.",
      });
    }
    return buildChatgptMailCheckResult(account, {
      status: "error",
      changed: false,
      source,
      reason:
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        "Khong the doc inbox Tinyhost.",
    });
  }

  const suspiciousEmail = emails.find((email) => {
    if (!isOpenAiSystemSender(email?.sender)) return false;
    const subject = String(email?.subject || "").trim();
    const snippet = buildMailCheckSnippet(email?.body, email?.html_body);
    return (
      matchesMailCheckPatterns(subject, OPENAI_DEACTIVATION_SUBJECT_PATTERNS) ||
      matchesMailCheckPatterns(snippet, OPENAI_DEACTIVATION_BODY_PATTERNS)
    );
  });

  let matchedEmail = null;
  if (suspiciousEmail?.id !== undefined && suspiciousEmail?.id !== null) {
    try {
      const emailDetail = await fetchTinyhostEmailDetail(
        mailbox.domain,
        mailbox.user,
        suspiciousEmail.id,
      );
      const detailCandidate = emailDetail || suspiciousEmail;
      if (isPotentialOpenAiDeactivationMail(detailCandidate)) {
        matchedEmail = detailCandidate;
      }
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode !== 404) {
        return buildChatgptMailCheckResult(account, {
          status: "error",
          changed: false,
          source,
          reason:
            error?.response?.data?.detail ||
            error?.response?.data?.error ||
            error?.message ||
            "Khong the doc chi tiet mail nghi van.",
        });
      }
    }
  }

  const checkedAt = new Date().toISOString();
  const currentStatus = normalizeChatgptMailCheckStatus(account?.mailCheckStatus);
  const updatePayload = {
    mailCheckProvider:
      String(account?.mailCheckProvider || "").trim() || CHATGPT_MAIL_CHECK_PROVIDER,
    mailCheckLastCheckedAt: checkedAt,
  };

  if (matchedEmail) {
    updatePayload.mailCheckStatus = "died";
    updatePayload.mailCheckLastMatchedEmailId = String(
      matchedEmail?.id ?? "",
    ).trim();
    updatePayload.mailCheckLastMatchedAt = String(
      matchedEmail?.date || checkedAt,
    ).trim();
    updatePayload.mailCheckLastSubject = String(
      matchedEmail?.subject || "",
    ).trim();
    updatePayload.mailCheckLastSender = String(
      matchedEmail?.sender || "",
    ).trim();
    updatePayload.mailCheckLastSnippet = buildMailCheckSnippet(
      matchedEmail?.body,
      matchedEmail?.html_body,
    );
  } else if (currentStatus === "died") {
    updatePayload.mailCheckStatus = "died";
  } else {
    updatePayload.mailCheckStatus = "clean";
    updatePayload.mailCheckLastMatchedEmailId = "";
    updatePayload.mailCheckLastMatchedAt = "";
    updatePayload.mailCheckLastSubject = "";
    updatePayload.mailCheckLastSender = "";
    updatePayload.mailCheckLastSnippet = "";
  }

  const normalizedBefore = sanitizeChatgptMailCheckRecord(account);
  const normalizedAfter = sanitizeChatgptMailCheckRecord({
    ...account,
    ...updatePayload,
  });
  const changed =
    JSON.stringify(normalizedBefore) !== JSON.stringify(normalizedAfter);

  if (changed) {
    await Account.updateOne({ id: String(account?.id || "").trim() }, { $set: updatePayload });
  }

  return buildChatgptMailCheckResult(account, {
    status: matchedEmail ? "died" : updatePayload.mailCheckStatus,
    changed,
    source,
    reason: matchedEmail
      ? "Phat hien mail OpenAI khoa acc."
      : updatePayload.mailCheckStatus === "clean"
        ? "Khong thay mail khoa OpenAI trong inbox ngan."
        : "Acc da duoc danh dau die tu truoc.",
    ...updatePayload,
  });
}

async function buildChatgptMailCheckSummary() {
  const accounts = await Account.find({})
    .select(
      "id username mailCheckEnabled mailCheckStatus mailCheckLastCheckedAt mailCheckLastMatchedAt",
    )
    .lean();
  let diedCount = 0;
  let checkedCleanCount = 0;
  let uncheckedCount = 0;
  let autoEnabledCount = 0;
  let latestDetectedAt = "";

  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    const status = normalizeChatgptMailCheckStatus(account?.mailCheckStatus);
    const lastCheckedAt = String(account?.mailCheckLastCheckedAt || "").trim();
    const lastMatchedAt = String(account?.mailCheckLastMatchedAt || "").trim();
    if (account?.mailCheckEnabled) autoEnabledCount += 1;
    if (status === "died") {
      diedCount += 1;
      if (!latestDetectedAt || lastMatchedAt > latestDetectedAt) {
        latestDetectedAt = lastMatchedAt;
      }
      return;
    }
    if (lastCheckedAt) {
      checkedCleanCount += 1;
      return;
    }
    uncheckedCount += 1;
  });

  return {
    totalCount: Array.isArray(accounts) ? accounts.length : 0,
    autoEnabledCount,
    diedCount,
    checkedCleanCount,
    uncheckedCount,
    latestDetectedAt,
    updatedAt: new Date().toISOString(),
  };
}

async function listChatgptMailCheckHistory(limit = 30) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 30), 100));
  const accounts = await Account.find({
    mailCheckStatus: "died",
  })
    .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
    .lean();
  return (Array.isArray(accounts) ? accounts : [])
    .map((account) => sanitizeChatgptMailCheckRecord(account))
    .sort((left, right) =>
      String(right?.mailCheckLastMatchedAt || "").localeCompare(
        String(left?.mailCheckLastMatchedAt || ""),
      ),
    )
    .slice(0, safeLimit);
}

async function runChatgptMailCheckForIds(accountIds = [], options = {}) {
  const normalizedIds = [...new Set((Array.isArray(accountIds) ? accountIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
  if (normalizedIds.length === 0) {
    return {
      items: [],
      summary: {
        total: 0,
        cleanCount: 0,
        diedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        changedCount: 0,
      },
    };
  }
  const accounts = await Account.find({ id: { $in: normalizedIds } })
    .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
    .lean();
  const accountMap = new Map(
    (Array.isArray(accounts) ? accounts : []).map((account) => [
      String(account?.id || "").trim(),
      account,
    ]),
  );
  const items = [];
  for (const accountId of normalizedIds) {
    const account = accountMap.get(accountId);
    if (!account) {
      items.push({
        accountId,
        username: "",
        status: "error",
        changed: false,
        source: String(options?.source || "manual").trim() || "manual",
        reason: "Khong tim thay account.",
      });
      continue;
    }
    // Keep sequential to stay gentle on Tinyhost and Vercel.
    // This route is admin-triggered, so correctness matters more than speed.
    // eslint-disable-next-line no-await-in-loop
    const result = await runChatgptMailCheckForAccount(account, options);
    items.push(result);
  }

  return {
    items,
    summary: {
      total: items.length,
      cleanCount: items.filter((item) => item.status === "clean").length,
      diedCount: items.filter((item) => item.status === "died").length,
      skippedCount: items.filter((item) => item.status === "skipped").length,
      errorCount: items.filter((item) => item.status === "error").length,
      changedCount: items.filter((item) => item.changed).length,
    },
  };
}

async function listEligibleChatgptMailCheckAccountsForAudit(limit = 25) {
  const safeLimit = Math.max(1, Math.min(Number(limit || 25), 100));
  const thresholdIso = new Date(
    Date.now() - CHATGPT_MAIL_DIE_AUDIT_MIN_INTERVAL_MS,
  ).toISOString();
  const accounts = await Account.find({
    mailCheckEnabled: true,
    mailCheckStatus: { $ne: "died" },
    $or: [
      { mailCheckLastCheckedAt: { $exists: false } },
      { mailCheckLastCheckedAt: "" },
      { mailCheckLastCheckedAt: { $lt: thresholdIso } },
    ],
  })
    .sort({ mailCheckLastCheckedAt: 1, createdAt: -1 })
    .limit(safeLimit)
    .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
    .lean();
  return Array.isArray(accounts) ? accounts : [];
}

async function runChatgptMailDieAuditBatch(options = {}) {
  const source = String(options?.source || "cron_daily").trim() || "cron_daily";
  const eligibleAccounts = await listEligibleChatgptMailCheckAccountsForAudit(
    options?.limit || CHATGPT_MAIL_DIE_AUDIT_BATCH_LIMIT,
  );
  const run = await runChatgptMailCheckForIds(
    eligibleAccounts.map((account) => String(account?.id || "").trim()),
    { source },
  );
  return {
    scannedCount: eligibleAccounts.length,
    ...run,
  };
}

const transformLegacyChatgptAccountForMigration = (doc = {}) => {
  const migrated = { ...doc };
  const users = Array.isArray(doc.users) ? doc.users : [];
  const regularUsers = [];
  const datammoCustomerNotes = [];

  users.forEach((user) => {
    if (isLegacyDatammoManagedUser(user)) {
      datammoCustomerNotes.push(buildLegacyDatammoCustomerNoteLine(user));
      return;
    }
    regularUsers.push(user);
  });

  migrated.users = regularUsers;
  migrated.note = appendLegacyMigrationNote(doc.note, datammoCustomerNotes);

  if (datammoCustomerNotes.length > 0) {
    migrated.package2Shelf = "none";
  }

  return migrated;
};

const migrateLegacyCollection = async ({
  legacyName,
  targetName,
  keyField = "_id",
  transformDoc = null,
}) => {
  if (!legacyName || !targetName || legacyName === targetName) return 0;
  const db = mongoose.connection?.db;
  if (!db) return 0;

  const legacyCollections = await db
    .listCollections({ name: legacyName })
    .toArray();
  if (legacyCollections.length === 0) return 0;

  const legacyDocs = await db.collection(legacyName).find({}).toArray();
  if (legacyDocs.length === 0) return 0;

  const operations = legacyDocs
    .map((doc) => {
      const nextDoc =
        typeof transformDoc === "function" ? transformDoc(doc) : doc;
      if (keyField === "_id") {
        return {
          updateOne: {
            filter: { _id: nextDoc._id },
            update: { $setOnInsert: nextDoc },
            upsert: true,
          },
        };
      }

      const keyValue = String(nextDoc?.[keyField] || "").trim();
      if (!keyValue) return null;

      return {
        updateOne: {
          filter: { [keyField]: keyValue },
          update: { $setOnInsert: nextDoc },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  if (operations.length === 0) return 0;

  await db.collection(targetName).bulkWrite(operations, { ordered: false });
  return operations.length;
};

const migrateLegacyCollectionsIfNeeded = async () => {
  if (didMigrateLegacyCollections) return;

  const mappings = [
    {
      legacyName: "accounts",
      targetName: "chatgpt_accounts",
      keyField: "id",
      transformDoc: transformLegacyChatgptAccountForMigration,
    },
    {
      legacyName: "teamaccounts",
      targetName: "chatgpt_team_accounts",
      keyField: "id",
    },
    {
      legacyName: "datammoorders",
      targetName: "marketplace_orders",
      keyField: "_id",
    },
    {
      legacyName: "datammowarrantycases",
      targetName: "marketplace_warranty_cases",
      keyField: "_id",
    },
    {
      legacyName: "netflixes",
      targetName: "netflix_accounts",
      keyField: "id",
    },
    { legacyName: "canvas", targetName: "canva_accounts", keyField: "id" },
    { legacyName: "capcuts", targetName: "capcut_accounts", keyField: "id" },
  ];

  const migrated = [];
  for (const mapping of mappings) {
    const count = await migrateLegacyCollection(mapping);
    if (count > 0) {
      migrated.push(`${mapping.legacyName} -> ${mapping.targetName} (${count})`);
    }
  }

  didMigrateLegacyCollections = true;
  if (migrated.length > 0) {
    console.log(`Migrated legacy collections: ${migrated.join(", ")}`);
  }
};

const dropLegacyCollectionsIfSafe = async () => {
  if (didDropLegacyCollections) return;
  const db = mongoose.connection?.db;
  if (!db) return;

  const legacyMappings = [
    { legacyName: "accounts", targetName: "chatgpt_accounts" },
    { legacyName: "teamaccounts", targetName: "chatgpt_team_accounts" },
    { legacyName: "datammoorders", targetName: "marketplace_orders" },
    {
      legacyName: "datammowarrantycases",
      targetName: "marketplace_warranty_cases",
    },
    { legacyName: "netflixes", targetName: "netflix_accounts" },
    { legacyName: "canvas", targetName: "canva_accounts" },
    { legacyName: "capcuts", targetName: "capcut_accounts" },
    { legacyName: "datammokeyregistries", targetName: null },
    { legacyName: "marketplace_key_registries", targetName: null },
  ];

  const dropped = [];
  for (const { legacyName, targetName } of legacyMappings) {
    const legacyCollections = await db
      .listCollections({ name: legacyName })
      .toArray();
    if (legacyCollections.length === 0) continue;

    if (!targetName) {
      await db.dropCollection(legacyName);
      dropped.push(legacyName);
      continue;
    }

    const targetCollections = await db
      .listCollections({ name: targetName })
      .toArray();
    if (targetCollections.length === 0) continue;

    const [legacyCount, targetCount] = await Promise.all([
      db.collection(legacyName).countDocuments({}),
      db.collection(targetName).countDocuments({}),
    ]);

    if (legacyCount > 0 && targetCount === 0) {
      console.warn(
        `Skip dropping legacy collection ${legacyName} because ${targetName} is empty.`,
      );
      continue;
    }

    await db.dropCollection(legacyName);
    dropped.push(legacyName);
  }

  didDropLegacyCollections = true;
  if (dropped.length > 0) {
    console.log(`Dropped legacy collections: ${dropped.join(", ")}`);
  }
};

const normalizeLegacyDatammoCustomersIfNeeded = async () => {
  if (didNormalizeLegacyDatammoCustomers) return;

  const accountsWithDatammoUsers = await Account.find({
    users: { $elemMatch: { name: /^(datammo#|\[datammo\])/i } },
  }).lean();

  let normalizedCount = 0;
  for (const account of accountsWithDatammoUsers) {
    const nextAccount = transformLegacyChatgptAccountForMigration(account);
    const currentUsers = JSON.stringify(Array.isArray(account.users) ? account.users : []);
    const nextUsers = JSON.stringify(Array.isArray(nextAccount.users) ? nextAccount.users : []);
    const currentNote = String(account.note || "");
    const nextNote = String(nextAccount.note || "");
    const currentShelf = String(account.package2Shelf || "");
    const nextShelf = String(nextAccount.package2Shelf || "");

    if (
      currentUsers === nextUsers &&
      currentNote === nextNote &&
      currentShelf === nextShelf
    ) {
      continue;
    }

    await Account.updateOne(
      { id: account.id },
      {
        $set: {
          users: nextAccount.users,
          note: nextAccount.note,
          package2Shelf: nextAccount.package2Shelf,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    normalizedCount += 1;
  }

  didNormalizeLegacyDatammoCustomers = true;
  if (normalizedCount > 0) {
    console.log(`Normalized legacy Datammo customers into notes: ${normalizedCount}`);
  }
};

const connectDB = async () => {
  if (isConnected && mongoose.connection?.readyState === 1) {
    return mongoose.connection;
  }
  if (connectPromise) {
    return connectPromise;
  }
  connectPromise = (async () => {
    try {
      const readyState = Number(mongoose.connection?.readyState || 0);
      if (readyState !== 0 && readyState !== 1) {
        try {
          await mongoose.disconnect();
        } catch (disconnectError) {
          console.error(
            "MongoDB Disconnect Before Reconnect Error:",
            disconnectError,
          );
        }
      }
      await mongoose.connect(process.env.MONGO_URI, MONGO_CONNECT_OPTIONS);
      isConnected = mongoose.connection?.readyState === 1;
      lastDbConnectError = "";
      lastDbConnectErrorAt = "";
      await migrateLegacyCollectionsIfNeeded();
      await normalizeLegacyDatammoCustomersIfNeeded();
      await dropLegacyCollectionsIfSafe();
      if (!didCleanupLegacyTeamEmailPassword) {
        await TeamAccount.updateMany(
          { emailPassword: { $exists: true } },
          { $unset: { emailPassword: "" } },
        );
        didCleanupLegacyTeamEmailPassword = true;
      }
      if (!didCleanupLegacyChatgptMarketKeys) {
        await Account.updateMany(
          {
            $or: [
              { package2DatammoKey: { $exists: true } },
              { package2DatammoKeysUsed: { $exists: true } },
            ],
          },
          {
            $unset: {
              package2DatammoKey: "",
              package2DatammoKeysUsed: "",
            },
          },
        );
        const legacyRegistryCollections = await mongoose.connection.db
          .listCollections({ name: "marketplace_key_registries" })
          .toArray();
        if (legacyRegistryCollections.length > 0) {
          await mongoose.connection.db.dropCollection("marketplace_key_registries");
        }
        didCleanupLegacyChatgptMarketKeys = true;
      }
      console.log("MongoDB Connected via Vercel");
      return mongoose.connection;
    } catch (error) {
      isConnected = false;
      lastDbConnectError = String(
        error?.reason?.message || error?.message || "Unknown MongoDB error",
      ).trim();
      lastDbConnectErrorAt = new Date().toISOString();
      console.error("MongoDB Connection Error:", error);
      throw error;
    } finally {
      connectPromise = null;
    }
  })();
  return connectPromise;
};

mongoose.connection.on("disconnected", () => {
  isConnected = false;
});

mongoose.connection.on("error", () => {
  isConnected = false;
});

// Define Schema
const accountSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  otpSecret: { type: String, default: "" },
  type: { type: String, default: "unassigned" },
  package2Shelf: { type: String, default: "none" },
  users: [{ name: String, joinedAt: String, expiredAt: String }],
  note: String,
  link: String,
  status: { type: String, default: "available" },
  mailCheckEnabled: { type: Boolean, default: false },
  mailCheckProvider: { type: String, default: "" },
  mailCheckStatus: { type: String, default: "unchecked" },
  mailCheckLastCheckedAt: { type: String, default: "" },
  mailCheckLastMatchedEmailId: { type: String, default: "" },
  mailCheckLastMatchedAt: { type: String, default: "" },
  mailCheckLastSubject: { type: String, default: "" },
  mailCheckLastSender: { type: String, default: "" },
  mailCheckLastSnippet: { type: String, default: "" },
  createdAt: { type: String },
  expiredAt: { type: String },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const Account =
  mongoose.models.Account ||
  mongoose.model("Account", accountSchema, "chatgpt_accounts");

const singleUserSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, required: true },
  password: { type: String, default: "" },
  users: [{ name: String, joinedAt: String, expiredAt: String }], // max 1
  note: String,
  duration: { type: String, default: "1M" }, // 1M, 3M, 6M, 1Y
  status: { type: String, default: "available" },
  createdAt: { type: String },
  expiredAt: { type: String },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const Netflix =
  mongoose.models.Netflix ||
  mongoose.model("Netflix", singleUserSchema, "netflix_accounts");
const Canva =
  mongoose.models.Canva ||
  mongoose.model("Canva", singleUserSchema, "canva_accounts");
const Capcut =
  mongoose.models.Capcut ||
  mongoose.model("Capcut", singleUserSchema, "capcut_accounts");

// Team Account Schema (ChatGPT Team - up to 4 Gmail slots)
const teamSlotSchema = new mongoose.Schema({
  gmail: { type: String, default: "" },         // Gmail của khách
  customerName: { type: String, default: "" },  // Tên khách
  addedAt: { type: String, default: "" },       // Ngày thêm
  expiredAt: { type: String, default: "" },     // Ngày hết hạn
  status: { type: String, default: "empty" },   // "empty" | "active"
});

const teamAccountSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, required: true },   // Email chính của team
  password: { type: String, default: "" },      // Mật khẩu GPT
  otpSecret: { type: String, default: "" },      // 2FA secret
  recoveryUrl: { type: String, default: "" },   // Link recovery
  saleMode: { type: String, default: "slot" },  // "slot" | "business"
  warehouse: { type: String, default: "total" }, // "total" | "market" | "short"
  note: { type: String, default: "" },
  slots: { type: [teamSlotSchema], default: () => Array(4).fill(null).map(() => ({ status: "empty" })) },
  createdAt: { type: String },
  expiredAt: { type: String },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const TeamAccount =
  mongoose.models.TeamAccount ||
  mongoose.model("TeamAccount", teamAccountSchema, "chatgpt_team_accounts");

const datammoOrderAccountSchema = new mongoose.Schema(
  {
    scope: { type: String, default: "chatgpt" },
    itemType: { type: String, default: "chatgpt_account" },
    resourceKey: { type: String, default: "" },
    accountId: { type: String, default: "" },
    username: { type: String, default: "" },
    slotIndex: { type: Number, default: -1 },
    delivery: { type: String, default: "" },
  },
  { _id: false },
);
const datammoOrderSchema = new mongoose.Schema({
  scope: { type: String, default: "chatgpt", index: true },
  provider: { type: String, default: "datammo", index: true },
  orderId: { type: String, default: "" },
  shelf: { type: String, default: "" },
  quantity: { type: Number, default: 0 },
  accounts: { type: [datammoOrderAccountSchema], default: [] },
  createdAt: { type: String, default: () => new Date().toISOString() },
});
const DatammoOrder =
  mongoose.models.DatammoOrder ||
  mongoose.model("DatammoOrder", datammoOrderSchema, "marketplace_orders");

const datammoWarrantyRoundSchema = new mongoose.Schema(
  {
    sequence: { type: Number, default: 1 },
    scope: { type: String, default: "chatgpt" },
    itemType: { type: String, default: "chatgpt_account" },
    fromResourceKey: { type: String, default: "" },
    fromAccountId: { type: String, default: "" },
    fromUsername: { type: String, default: "" },
    fromSlotIndex: { type: Number, default: -1 },
    toResourceKey: { type: String, default: "" },
    toAccountId: { type: String, default: "" },
    toUsername: { type: String, default: "" },
    toSlotIndex: { type: Number, default: -1 },
    reason: { type: String, default: "" },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { _id: false },
);
const datammoWarrantyCaseSchema = new mongoose.Schema({
  scope: { type: String, default: "chatgpt", index: true },
  itemType: { type: String, default: "chatgpt_account" },
  provider: { type: String, default: "datammo", index: true },
  orderId: { type: String, default: "", index: true },
  rootResourceKey: { type: String, default: "" },
  rootAccountId: { type: String, default: "" },
  rootUsername: { type: String, default: "" },
  rootSlotIndex: { type: Number, default: -1 },
  currentResourceKey: { type: String, default: "", index: true },
  currentAccountId: { type: String, default: "", index: true },
  currentUsername: { type: String, default: "" },
  currentSlotIndex: { type: Number, default: -1 },
  status: { type: String, default: "active" },
  rounds: { type: [datammoWarrantyRoundSchema], default: [] },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const DatammoWarrantyCase =
  mongoose.models.DatammoWarrantyCase ||
  mongoose.model(
    "DatammoWarrantyCase",
    datammoWarrantyCaseSchema,
    "marketplace_warranty_cases",
  );

const storeUserSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  fullName: { type: String, required: true },
  phone: { type: String, default: "" },
  phoneNormalized: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },
  email: { type: String, required: true },
  emailLower: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, default: "" },
  googleId: { type: String, unique: true, sparse: true, index: true },
  authProviders: { type: [String], default: ["password"] },
  resetTokenHash: { type: String, default: "" },
  resetTokenExpiresAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
storeUserSchema.index({ updatedAt: -1, createdAt: -1, id: -1 });
const StoreUser =
  mongoose.models.StoreUser ||
  mongoose.model("StoreUser", storeUserSchema, "store_users");

const storeWarrantyRoundSchema = new mongoose.Schema(
  {
    sequence: { type: Number, default: 1 },
    fromAccountId: { type: String, default: "" },
    fromUsername: { type: String, default: "" },
    fromType: { type: String, default: "" },
    toAccountId: { type: String, default: "" },
    toUsername: { type: String, default: "" },
    toType: { type: String, default: "" },
    reason: { type: String, default: "" },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { _id: false },
);

const storeOrderSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  userId: { type: String, required: true, index: true },
  packageCode: { type: String, required: true, index: true },
  packageName: { type: String, required: true },
  originalAmount: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  voucherId: { type: String, default: "", index: true },
  voucherCode: { type: String, default: "", index: true },
  voucherType: { type: String, default: "" },
  voucherValue: { type: Number, default: 0 },
  voucherDescription: { type: String, default: "" },
  status: { type: String, default: "pending", index: true },
  paymentMethod: { type: String, default: "momo" },
  momoOrderId: { type: String, default: "", index: true },
  momoRequestId: { type: String, default: "" },
  momoTransId: { type: String, default: "" },
  momoResultCode: { type: Number, default: null },
  momoMessage: { type: String, default: "" },
  momoPayUrl: { type: String, default: "" },
  momoDeepLink: { type: String, default: "" },
  momoQrCodeUrl: { type: String, default: "" },
  payosOrderCode: { type: Number, default: null, index: true },
  payosPaymentLinkId: { type: String, default: "", index: true },
  payosCheckoutUrl: { type: String, default: "" },
  payosQrCode: { type: String, default: "" },
  payosStatus: { type: String, default: "" },
  payosCode: { type: String, default: "" },
  payosDesc: { type: String, default: "" },
  expiresAt: { type: String, default: "" },
  reservedAccountId: { type: String, default: "" },
  reservedAccountUsername: { type: String, default: "" },
  reservationType: { type: String, default: "" },
  reservationState: { type: String, default: "" },
  reservedAccountSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  assignedAccountId: { type: String, default: "" },
  assignedUsername: { type: String, default: "" },
  assignedPassword: { type: String, default: "" },
  assignedOtpSecret: { type: String, default: "" },
  assignedLink: { type: String, default: "" },
  assignedType: { type: String, default: "" },
  assignedWarehouse: { type: String, default: "" },
  assignedCustomerName: { type: String, default: "" },
  assignedCustomerJoinedAt: { type: String, default: "" },
  assignedCustomerExpiredAt: { type: String, default: "" },
  rootAssignedAccountId: { type: String, default: "" },
  rootAssignedUsername: { type: String, default: "" },
  warrantyRounds: { type: [storeWarrantyRoundSchema], default: [] },
  package1AccessToken: { type: String, default: "" },
  package1MaxUsage: { type: Number, default: 3 },
  package1UsedCount: { type: Number, default: 0 },
  package1LastCodeAt: { type: String, default: "" },
  package1LastCode: { type: String, default: "" },
  fulfillmentState: { type: String, default: "" },
  fulfillmentReason: { type: String, default: "" },
  fulfillmentLockToken: { type: String, default: "" },
  fulfillmentLockedAt: { type: String, default: "" },
  fulfillmentSource: { type: String, default: "" },
  fulfilledAt: { type: String, default: "" },
  paidAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
storeOrderSchema.index({ userId: 1, createdAt: -1 });
storeOrderSchema.index({ status: 1, createdAt: -1 });
const StoreOrder =
  mongoose.models.StoreOrder ||
  mongoose.model("StoreOrder", storeOrderSchema, "store_orders");

const storeVoucherSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  code: { type: String, required: true, unique: true, index: true },
  type: { type: String, default: "percent" },
  value: { type: Number, default: 0 },
  description: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  maxUses: { type: Number, default: 0 },
  perUserLimit: { type: Number, default: 0 },
  minOrderAmount: { type: Number, default: 0 },
  startsAt: { type: String, default: "" },
  endsAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const StoreVoucher =
  mongoose.models.StoreVoucher ||
  mongoose.model("StoreVoucher", storeVoucherSchema, "store_vouchers");

const storeConfigSchema = new mongoose.Schema({
  id: { type: String, unique: true, default: "default" },
  packagePrices: {
    package1: { type: Number, default: null },
    package2: { type: Number, default: null },
    package3: { type: Number, default: null },
  },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const StoreConfig =
  mongoose.models.StoreConfig ||
  mongoose.model("StoreConfig", storeConfigSchema, "store_configs");

const storeSupportConversationSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  userId: { type: String, required: true, unique: true, index: true },
  userName: { type: String, default: "" },
  userEmail: { type: String, default: "" },
  userPhone: { type: String, default: "" },
  status: { type: String, default: "open", index: true },
  lastMessageAt: { type: String, default: "" },
  lastMessagePreview: { type: String, default: "" },
  lastSenderRole: { type: String, default: "" },
  adminUnreadCount: { type: Number, default: 0 },
  userUnreadCount: { type: Number, default: 0 },
  lastAdminReadAt: { type: String, default: "" },
  lastUserReadAt: { type: String, default: "" },
  lastUserMessageAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
storeSupportConversationSchema.index({ lastMessageAt: -1 });
storeSupportConversationSchema.index({ adminUnreadCount: 1 });
const StoreSupportConversation =
  mongoose.models.StoreSupportConversation ||
  mongoose.model(
    "StoreSupportConversation",
    storeSupportConversationSchema,
    "store_support_conversations",
  );

const storeSupportMessageSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  conversationId: { type: String, required: true, index: true },
  senderRole: { type: String, required: true, index: true },
  senderId: { type: String, default: "" },
  body: { type: String, required: true },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true },
  readAt: { type: String, default: "" },
});
storeSupportMessageSchema.index({ conversationId: 1, createdAt: 1 });
const StoreSupportMessage =
  mongoose.models.StoreSupportMessage ||
  mongoose.model(
    "StoreSupportMessage",
    storeSupportMessageSchema,
    "store_support_messages",
  );

const expiryCleanupBatchItemSchema = new mongoose.Schema(
  {
    scope: { type: String, default: "chatgpt" },
    itemId: { type: String, default: "" },
    username: { type: String, default: "" },
    accountType: { type: String, default: "" },
    saleMode: { type: String, default: "" },
    warehouse: { type: String, default: "" },
    expiredAt: { type: String, default: "" },
    reasonCode: { type: String, default: "" },
    reasonLabel: { type: String, default: "" },
    activeUserCount: { type: Number, default: 0 },
    expiredUserCount: { type: Number, default: 0 },
    activeSlotCount: { type: Number, default: 0 },
    expiredSlotCount: { type: Number, default: 0 },
    expectedUpdatedAt: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const expiryCleanupBatchSchema = new mongoose.Schema({
  batchId: { type: String, unique: true, index: true },
  signature: { type: String, default: "", index: true },
  status: {
    type: String,
    default: "pending_approval",
    index: true,
  },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  items: { type: [expiryCleanupBatchItemSchema], default: [] },
  telegramMessageMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  executionResult: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, default: "cron" },
  approvedBy: { type: String, default: "" },
  rejectedBy: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  approvedAt: { type: String, default: "" },
  rejectedAt: { type: String, default: "" },
  executedAt: { type: String, default: "" },
  expiresAt: { type: String, default: "" },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
expiryCleanupBatchSchema.index({ status: 1, createdAt: -1 });
const ExpiryCleanupBatch =
  mongoose.models.ExpiryCleanupBatch ||
  mongoose.model(
    "ExpiryCleanupBatch",
    expiryCleanupBatchSchema,
    "expiry_cleanup_batches",
  );

const expiryCleanupSnapshotSchema = new mongoose.Schema({
  id: { type: String, unique: true, default: "default" },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  latestPendingBatchId: { type: String, default: "" },
  latestExecutedBatchId: { type: String, default: "" },
  latestRejectedBatchId: { type: String, default: "" },
  latestExpiredBatchId: { type: String, default: "" },
  lastScanAt: { type: String, default: "" },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const ExpiryCleanupSnapshot =
  mongoose.models.ExpiryCleanupSnapshot ||
  mongoose.model(
    "ExpiryCleanupSnapshot",
    expiryCleanupSnapshotSchema,
    "expiry_cleanup_snapshots",
  );

// Middleware to ensure DB is connected before processing
app.use(async (req, res, next) => {
  const path = String(req.path || "").trim();
  if (path === "/api/test" || path === "/api/healthz") {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (error) {
    return res.status(503).json({
      code: "db_unavailable",
      error:
        "Khong the ket noi du lieu tam thoi. Vui long thu lai sau vai giay.",
    });
  }
});

// Middleware to verify token (MUST BE DEFINED BEFORE ROUTES)
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    // Decode token
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [createdAt, expiryTime, email] = decoded.split("_");

    // Check if token expired
    if (Date.now() > parseInt(expiryTime)) {
      return res
        .status(401)
        .json({ error: "Token expired. Please login again." });
    }

    req.user = { email };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const LEGACY_TELEGRAM_BOT_TOKEN =
  "8101230396:AAHlHj8HWI2bKpD2dWa60BUw_wbvvqs8DaA";
const buildLegacyBotSecret = (label = "") =>
  crypto
    .createHash("sha256")
    .update(`vinhaccplus:${label}:${LEGACY_TELEGRAM_BOT_TOKEN}`)
    .digest("hex");
const BOT_INTERNAL_TOKEN = String(
  process.env.BOT_INTERNAL_TOKEN || buildLegacyBotSecret("bot-internal"),
).trim();
const TELEGRAM_WEBHOOK_SECRET = String(
  process.env.TELEGRAM_WEBHOOK_SECRET ||
    buildLegacyBotSecret("telegram-webhook"),
).trim();
const TELEGRAM_BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || LEGACY_TELEGRAM_BOT_TOKEN,
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
const TELEGRAM_NOTIFICATION_USER_IDS = parseTelegramIdEnv(
  "ALLOWED_USER_IDS",
  "TELEGRAM_ALLOWED_USER_IDS",
);
const TELEGRAM_NOTIFICATION_CHAT_IDS = parseTelegramIdEnv(
  "ALLOWED_CHAT_IDS",
  "TELEGRAM_ALLOWED_CHAT_IDS",
);
const TELEGRAM_NOTIFICATION_RECIPIENT_IDS = Array.from(
  new Set([
    ...TELEGRAM_NOTIFICATION_USER_IDS,
    ...TELEGRAM_NOTIFICATION_CHAT_IDS,
  ]),
);

const safeCompareSecret = (left = "", right = "") => {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length === 0 || rightBuffer.length === 0) return false;
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getBotInternalTokenFromReq = (req) =>
  String(
    req.headers["x-bot-internal-token"] ||
      req.headers["x-internal-bot-token"] ||
      "",
  ).trim();

const verifyBotInternalToken = (req, res, next) => {
  if (!BOT_INTERNAL_TOKEN) {
    return res.status(503).json({
      error: "Bot internal token chua duoc cau hinh.",
    });
  }
  const token = getBotInternalTokenFromReq(req);
  if (!token) {
    return res.status(401).json({
      error: "Bot internal token required.",
    });
  }
  if (!safeCompareSecret(token, BOT_INTERNAL_TOKEN)) {
    return res.status(403).json({
      error: "Bot internal token invalid.",
    });
  }
  req.botInternal = { authorized: true };
  return next();
};

const verifyAdminOrBotInternalToken = (req, res, next) => {
  const adminToken = String(
    req.headers.authorization?.replace("Bearer ", "") || "",
  ).trim();
  if (adminToken) {
    return verifyToken(req, res, next);
  }
  return verifyBotInternalToken(req, res, next);
};
const verifyCronSecret = (req, res, next) => {
  const configuredCronSecret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.authorization || "").trim();
  if (
    configuredCronSecret &&
    safeCompareSecret(authorization, `Bearer ${configuredCronSecret}`)
  ) {
    req.cronAuthorized = true;
    return next();
  }
  return verifyBotInternalToken(req, res, next);
};

const verifyTelegramWebhookSecret = (req, res, next) => {
  if (!TELEGRAM_WEBHOOK_SECRET) {
    return res.status(503).json({
      error: "Telegram webhook secret chua duoc cau hinh.",
    });
  }
  const requestSecret = String(
    req.headers["x-telegram-bot-api-secret-token"] || "",
  ).trim();
  if (!safeCompareSecret(requestSecret, TELEGRAM_WEBHOOK_SECRET)) {
    return res.status(401).json({
      error: "Unauthorized telegram webhook.",
    });
  }
  return next();
};

const getRequestIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return (
    forwarded ||
    String(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "")
      .trim() ||
    "unknown"
  );
};

const pruneRateLimitBuckets = (buckets, now) => {
  if (buckets.size <= 5000) return;
  for (const [key, entry] of buckets.entries()) {
    if (!entry || Number(entry?.resetAt || 0) <= now) {
      buckets.delete(key);
    }
  }
};

const createInMemoryRateLimit = ({
  windowMs = 60000,
  max = 10,
  keyPrefix = "default",
  keySelector,
  message = "Ban thao tac qua nhanh. Vui long thu lai sau.",
} = {}) => {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    pruneRateLimitBuckets(buckets, now);
    const rawKey = String(
      typeof keySelector === "function" ? keySelector(req) : getRequestIp(req),
    ).trim();
    const bucketKey = `${keyPrefix}:${rawKey || "anonymous"}`;
    const current = buckets.get(bucketKey);
    if (!current || Number(current.resetAt || 0) <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (Number(current.count || 0) >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((Number(current.resetAt || now) - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: message });
    }
    current.count += 1;
    buckets.set(bucketKey, current);
    return next();
  };
};

const loginRateLimit = createInMemoryRateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyPrefix: "login",
  keySelector: (req) =>
    `${getRequestIp(req)}:${String(req.body?.identifier || req.body?.email || req.body?.phone || "")
      .trim()
      .toLowerCase()}`,
  message: "Ban dang thu dang nhap qua nhieu lan. Vui long doi it phut.",
});

const voucherValidateRateLimit = createInMemoryRateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "voucher-validate",
  keySelector: (req) =>
    `${String(req.storeUser?.id || "").trim() || getRequestIp(req)}:${String(req.body?.voucherCode || "")
      .trim()
      .toUpperCase()}`,
  message: "Ban kiem tra voucher qua nhanh. Vui long thu lai sau.",
});

const storeSupportSendRateLimit = createInMemoryRateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyPrefix: "support-send",
  keySelector: (req) => String(req.storeUser?.id || "").trim() || getRequestIp(req),
  message: "Ban gui tin nhan qua nhanh. Vui long cho mot chut.",
});

const storeSupportThreadRateLimit = createInMemoryRateLimit({
  windowMs: 10 * 1000,
  max: 20,
  keyPrefix: "support-thread",
  keySelector: (req) => String(req.storeUser?.id || "").trim() || getRequestIp(req),
  message: "Ban tai khung chat qua nhanh. Vui long cho mot chut.",
});

const storeOrderPaymentRateLimit = createInMemoryRateLimit({
  windowMs: 60 * 1000,
  max: 8,
  keyPrefix: "store-payment",
  keySelector: (req) => String(req.storeUser?.id || "").trim() || getRequestIp(req),
  message: "Ban tao lien ket thanh toan qua nhanh. Vui long thu lai sau.",
});

const apiSlowLogThresholdMs = toPositiveInt(
  process.env.API_SLOW_LOG_THRESHOLD_MS,
  1500,
);

// --- DATA VERSION + OPTIONAL SSE (serverless-friendly) ---
const ENABLE_SSE = process.env.ENABLE_SSE === "true";
let sseClients = [];
let latestDataVersion = Date.now();
const adminReadCacheTtlMs = toPositiveInt(
  process.env.ADMIN_READ_CACHE_TTL_MS,
  60000,
);
const partnerStockCacheTtlMs = toPositiveInt(
  process.env.PARTNER_STOCK_CACHE_TTL_MS,
  10000,
);
const adminReadCache = new Map();
const chatgptAdminSnapshotCacheTtlMs = toPositiveInt(
  process.env.CHATGPT_ADMIN_SNAPSHOT_CACHE_TTL_MS,
  Math.max(adminReadCacheTtlMs, 180000),
);
let chatgptAdminSnapshotCache = null;

const bumpDataVersion = () => {
  latestDataVersion = Date.now();
  adminReadCache.clear();
  chatgptAdminSnapshotCache = null;
};

const buildAdminReadCacheKey = (name = "", params = {}) => {
  const normalizedName = String(name || "").trim();
  const entries = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  if (entries.length === 0) return normalizedName;
  return `${normalizedName}:${JSON.stringify(entries)}`;
};

const getCachedAdminRead = async (
  name = "",
  params = {},
  loader = async () => null,
  ttlMs = adminReadCacheTtlMs,
) => {
  const cacheKey = buildAdminReadCacheKey(name, params);
  const cacheVersion = latestDataVersion;
  const now = Date.now();
  const existing = adminReadCache.get(cacheKey);
  if (
    existing &&
    existing.version === cacheVersion &&
    existing.expiresAt > now
  ) {
    if (Object.prototype.hasOwnProperty.call(existing, "value")) {
      return existing.value;
    }
    if (existing.promise) {
      return existing.promise;
    }
  }

  const loadPromise = (async () => {
    const value = await loader();
    const pendingEntry = adminReadCache.get(cacheKey);
    if (pendingEntry?.promise === loadPromise) {
      adminReadCache.set(cacheKey, {
        version: cacheVersion,
        expiresAt: Date.now() + ttlMs,
        value,
      });
    }
    return value;
  })().catch((error) => {
    const pendingEntry = adminReadCache.get(cacheKey);
    if (pendingEntry?.promise === loadPromise) {
      adminReadCache.delete(cacheKey);
    }
    throw error;
  });

  adminReadCache.set(cacheKey, {
    version: cacheVersion,
    expiresAt: now + ttlMs,
    promise: loadPromise,
  });
  return loadPromise;
};
const getCachedPartnerRead = async (
  name = "",
  params = {},
  loader = async () => null,
  ttlMs = partnerStockCacheTtlMs,
) =>
  getCachedAdminRead(`partner:${String(name || "").trim()}`, params, loader, ttlMs);

const notifyClients = () => {
  if (!ENABLE_SSE || sseClients.length === 0) return;
  sseClients.forEach((client) => {
    try {
      client.res.write(
        `data: ${JSON.stringify({
          type: "DATA_UPDATED",
          version: latestDataVersion,
        })}\n\n`,
      );
    } catch (err) {
      console.error("SSE Error:", err);
    }
  });
};

app.get("/api/data-version", verifyToken, (req, res) => {
  res.json({ version: latestDataVersion, sseEnabled: ENABLE_SSE });
});

app.get("/api/events", (req, res) => {
  if (!ENABLE_SSE) {
    return res.status(204).end();
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  req.on("close", () => {
    sseClients = sseClients.filter((c) => c.id !== client.id);
  });
});

// Interceptor to update version + optional notify on any data change
app.use((req, res, next) => {
  if (["POST", "PUT", "DELETE"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        bumpDataVersion();
        notifyClients();
        const inventoryRealtimeMeta = inferAdminInventoryRealtimeMeta(req);
        if (inventoryRealtimeMeta) {
          void emitAdminInventoryRealtimeUpdate(inventoryRealtimeMeta);
        }
      }
    });
  }
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    if (res.statusCode >= 500 || durationMs >= apiSlowLogThresholdMs) {
      console.log(
        `[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${durationMs}ms`,
      );
    }
  });
  next();
});

// --- API ROUTES ---

// TEST ENDPOINT
app.get("/api/test", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    env: {
      hasAdminEmail: !!process.env.ADMIN_EMAIL,
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      adminEmail: process.env.ADMIN_EMAIL || "NOT SET",
    },
    db: getDbHealthSnapshot(),
  });
});

app.get("/api/healthz", (req, res) => {
  const db = getDbHealthSnapshot();
  const statusCode = db.connected ? 200 : 503;
  return res.status(statusCode).json({
    ok: db.connected,
    timestamp: new Date().toISOString(),
    db,
  });
});

app.get(
  "/api/internal/cron/store-maintenance",
  verifyCronSecret,
  async (req, res) => {
    try {
      const startedAt = Date.now();
      const maintenanceResults = await Promise.all([
        expireStaleStoreOrders(),
        cleanupOldStoreFailedOrders(),
        cleanupOldStoreSupportMessages(),
      ]);
      const expiryCleanup = await refreshExpiryCleanupSnapshot({
        createBatch: true,
        notifyTelegram: true,
      });
      return res.json({
        ok: true,
        task: "store-maintenance",
        durationMs: Date.now() - startedAt,
        version: latestDataVersion,
        maintenanceResults,
        expiryCleanup: {
          pendingBatchId: String(
            expiryCleanup?.snapshot?.latestPendingBatchId || "",
          ).trim(),
          createdBatchId: String(
            expiryCleanup?.createdBatch?.batchId || "",
          ).trim(),
          candidateCount: Number(
            expiryCleanup?.scan?.summary?.candidateCount || 0,
          ),
          warningCount: Number(
            expiryCleanup?.scan?.summary?.warningCount || 0,
          ),
          notified: !!expiryCleanup?.telegramResult?.sent,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        task: "store-maintenance",
        error: error.message || "Store maintenance failed.",
      });
    }
  },
);

app.get(
  "/api/internal/cron/inventory-reconcile",
  verifyCronSecret,
  async (req, res) => {
    try {
      const startedAt = Date.now();
      const results = await Promise.all([
        reconcileChatgptMarketInventory(),
        reconcileTeamMarketInventory(),
      ]);
      const changed = results.some(Boolean);
      if (changed) {
        bumpDataVersion();
        notifyClients();
      }
      return res.json({
        ok: true,
        task: "inventory-reconcile",
        changed,
        durationMs: Date.now() - startedAt,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        task: "inventory-reconcile",
        error: error.message || "Inventory reconcile failed.",
      });
    }
  },
);

app.get(
  "/api/internal/cron/chatgpt-mail-die-audit",
  verifyCronSecret,
  async (req, res) => {
    try {
      const startedAt = Date.now();
      const audit = await runChatgptMailDieAuditBatch({
        source: "cron_daily",
        limit: CHATGPT_MAIL_DIE_AUDIT_BATCH_LIMIT,
      });
      if (Number(audit?.summary?.changedCount || 0) > 0) {
        bumpDataVersion();
        notifyClients();
      }
      return res.json({
        success: true,
        durationMs: Date.now() - startedAt,
        audit,
        version: latestDataVersion,
      });
    } catch (error) {
      console.error("Cron /api/internal/cron/chatgpt-mail-die-audit failed:", error);
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the audit mail die ChatGPT.",
      });
    }
  },
);

const DEFAULT_STORE_CONTACT_ZALO_URL = "https://zalo.me/0345440153";

app.get("/api/store/config", async (req, res) => {
  try {
    const packageMap = await getStorePackageMap();
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    res.json({
      packages: buildStorePackageList(packageMap).map((pkg) => ({
        ...pkg,
        available: pkg.automated ? null : null,
        purchasable: false,
      })),
      googleClientId: GOOGLE_OAUTH_CLIENT_ID,
      contact: {
        zaloUrl: String(
          process.env.STORE_CONTACT_ZALO_URL || DEFAULT_STORE_CONTACT_ZALO_URL,
        ).trim(),
        messengerUrl: String(
          process.env.STORE_CONTACT_MESSENGER_URL || "",
        ).trim(),
      },
      momoConfigured:
        !!MOMO_PARTNER_CODE && !!MOMO_ACCESS_KEY && !!MOMO_SECRET_KEY,
      payosConfigured:
        !!PAYOS_BASE_URL &&
        !!PAYOS_CLIENT_ID &&
        !!PAYOS_API_KEY &&
        !!PAYOS_CHECKSUM_KEY,
      realtime: buildStoreRealtimeClientConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/store/catalog", async (req, res) => {
  try {
    const packages = await getCachedStoreCatalog();
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=120",
    );
    res.json({ packages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/store/auth/register", async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const phoneNormalized = normalizePhoneValue(phone);
    const email = String(req.body?.email || "").trim();
    const emailLower = normalizeEmailLower(email);
    const password = String(req.body?.password || "");

    if (!fullName || !phoneNormalized || !emailLower || password.length < 6) {
      return res.status(400).json({
        error:
          "Vui lòng nhập đầy đủ họ tên, SĐT, email và mật khẩu tối thiểu 6 ký tự",
      });
    }

    const [existingPhone, existingEmail] = await Promise.all([
      StoreUser.findOne({ phoneNormalized }).lean(),
      StoreUser.findOne({ emailLower }).lean(),
    ]);
    if (existingPhone) {
      return res.status(409).json({ error: "Số điện thoại đã tồn tại" });
    }
    if (existingEmail) {
      return res.status(409).json({ error: "Email đã tồn tại" });
    }

    const nowIso = new Date().toISOString();
    const user = await StoreUser.create({
      id: createStoreId("usr"),
      fullName,
      phone,
      phoneNormalized,
      email,
      emailLower,
      passwordHash: await bcrypt.hash(password, 10),
      authProviders: ["password"],
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return res.json({
      success: true,
      token: issueStoreUserJwt(user),
      user: sanitizeStoreUser(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Đăng ký thất bại" });
  }
});

app.post("/api/store/auth/login", async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const password = String(req.body?.password || "");
    if (!identifier || !password) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập email hoặc SĐT và mật khẩu" });
    }
    const emailLower = normalizeEmailLower(identifier);
    const phoneNormalized = normalizePhoneValue(identifier);
    const user = await StoreUser.findOne({
      $or: [
        { emailLower },
        ...(phoneNormalized ? [{ phoneNormalized }] : []),
      ],
    });
    if (!user?.passwordHash) {
      return res.status(401).json({ error: "Thông tin đăng nhập không đúng" });
    }
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: "Thông tin đăng nhập không đúng" });
    }
    return res.json({
      success: true,
      token: issueStoreUserJwt(user),
      user: sanitizeStoreUser(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Đăng nhập thất bại" });
  }
});

app.post("/api/store/auth/google", async (req, res) => {
  try {
    const credential = String(req.body?.credential || "").trim();
    if (!credential) {
      return res.status(400).json({ error: "Thiếu token Google" });
    }
    if (!googleOAuthClient) {
      return res.status(400).json({ error: "Google OAuth chưa được cấu hình" });
    }
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const emailLower = normalizeEmailLower(payload?.email);
    if (!emailLower || !payload?.email_verified) {
      return res.status(400).json({ error: "Tài khoản Google không hợp lệ" });
    }
    const googleId = String(payload?.sub || "").trim();
    let user =
      (await StoreUser.findOne({ googleId })) ||
      (await StoreUser.findOne({ emailLower }));

    if (!user) {
      user = await StoreUser.create({
        id: createStoreId("usr"),
        fullName: String(payload?.name || payload?.email || "Google User").trim(),
        email: String(payload?.email || "").trim(),
        emailLower,
        googleId,
        authProviders: ["google"],
      });
    } else {
      user.googleId = googleId;
      user.authProviders = upsertStringIntoList(user.authProviders, "google");
      if (!String(user.fullName || "").trim()) {
        user.fullName = String(payload?.name || payload?.email || "").trim();
      }
      await user.save();
    }

    return res.json({
      success: true,
      token: issueStoreUserJwt(user),
      user: sanitizeStoreUser(user),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Đăng nhập Google thất bại" });
  }
});

app.post("/api/store/auth/forgot-password", async (req, res) => {
  try {
    const emailLower = normalizeEmailLower(req.body?.email);
    if (!emailLower) {
      return res.json({
        success: true,
        message:
          "Nếu email tồn tại, hệ thống đã gửi hướng dẫn đặt lại mật khẩu",
      });
    }
    const user = await StoreUser.findOne({ emailLower });
    if (user) {
      const resetToken = createRandomHexToken(20);
      user.resetTokenHash = hashSha256(resetToken);
      user.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      user.updatedAt = new Date().toISOString();
      await user.save();
      await sendStoreResetPasswordEmail({ req, user, resetToken });
    }
    return res.json({
      success: true,
      message:
        "Nếu email tồn tại, hệ thống đã gửi hướng dẫn đặt lại mật khẩu",
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không gửi được email" });
  }
});

app.post("/api/store/auth/reset-password", async (req, res) => {
  try {
    const resetToken = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    if (!resetToken || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Token hoặc mật khẩu mới không hợp lệ" });
    }
    const resetTokenHash = hashSha256(resetToken);
    const user = await StoreUser.findOne({
      resetTokenHash,
      resetTokenExpiresAt: { $gt: new Date().toISOString() },
    });
    if (!user) {
      return res
        .status(400)
        .json({ error: "Liên kết đặt lại mật khẩu đã hết hạn" });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetTokenHash = "";
    user.resetTokenExpiresAt = "";
    user.authProviders = upsertStringIntoList(user.authProviders, "password");
    user.updatedAt = new Date().toISOString();
    await user.save();
    return res.json({ success: true, message: "Đã đặt lại mật khẩu thành công" });
  } catch (error) {
    res
      .status(500)
      .json({ error: error.message || "Không đặt lại được mật khẩu" });
  }
});

app.get("/api/store/auth/me", verifyStoreUserToken, async (req, res) => {
  try {
    const orders = await loadVisibleStoreOrdersForUser(req.storeUser.id);
    res.json({
      user: sanitizeStoreUser(req.storeUser),
      orders: orders.map((order) => sanitizeStoreOrder(order)),
      realtime: {
        ...buildStoreRealtimeClientConfig(),
        userTopic: buildStoreUserRealtimeTopic(String(req.storeUser?.id || "").trim()),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được tài khoản" });
  }
});

app.get("/api/store/orders", verifyStoreUserToken, async (req, res) => {
  try {
    const orders = await loadVisibleStoreOrdersForUser(req.storeUser.id);
    res.json({ orders: orders.map((order) => sanitizeStoreOrder(order)) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được đơn hàng" });
  }
});

app.post("/api/store/vouchers/validate", verifyStoreUserToken, voucherValidateRateLimit, async (req, res) => {
  try {
    const pricing = await resolveStoreVoucherPricing({
      voucherCode: req.body?.voucherCode,
      packageCode: req.body?.packageCode,
      userId: req.storeUser.id,
    });
    return res.json({
      success: true,
      voucher: pricing?.voucher
        ? sanitizeStoreVoucherForCheckout(pricing)
        : null,
      originalAmount: Number(pricing?.originalAmount || 0),
      discountAmount: Number(pricing?.discountAmount || 0),
      finalAmount: Number(pricing?.finalAmount || 0),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong the kiem tra voucher.",
    });
  }
});

app.get(
  "/api/store/support/thread",
  verifyStoreUserToken,
  storeSupportThreadRateLimit,
  async (req, res) => {
  try {
    const conversation = await getOrCreateStoreSupportConversation(req.storeUser);
    const shouldMarkRead = String(req.query?.markRead || "0").trim() === "1";
    const shouldApplyMarkRead =
      shouldMarkRead && Number(conversation?.userUnreadCount || 0) > 0;
    const limit = parsePositiveLimit(
      req.query?.limit,
      STORE_SUPPORT_THREAD_PAGE_SIZE,
      100,
    );
    const cursor = String(req.query?.cursor || req.query?.before || "").trim();
    if (shouldApplyMarkRead) {
      await markStoreSupportConversationRead({
        conversationId: conversation.id,
        readerRole: "user",
      });
    }
    const [freshConversation, messagePage] = await Promise.all([
      StoreSupportConversation.findOne({
        id: String(conversation.id || "").trim(),
      }).lean(),
      listStoreSupportMessages(conversation.id, { limit, cursor }),
    ]);
    const normalizedConversation = freshConversation || conversation;
    if (
      shouldApplyMarkRead &&
      normalizedConversation
    ) {
      await emitStoreSupportReadRealtimeUpdate({
        conversation: normalizedConversation,
        readerRole: "user",
      });
    }
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForUser(
        normalizedConversation,
      ),
      messages: (messagePage?.messages || []).map((message) =>
        sanitizeStoreSupportMessage(message),
      ),
      pagination: {
        limit,
        cursor,
        nextCursor: String(messagePage?.nextCursor || "").trim(),
        hasMore: !!messagePage?.hasMore,
        retainedAfter: String(messagePage?.retainedAfter || "").trim(),
        retentionDays: STORE_SUPPORT_MESSAGE_RETENTION_DAYS,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc khung chat ho tro.",
    });
  }
});

app.post("/api/store/support/thread/messages", verifyStoreUserToken, storeSupportSendRateLimit, async (req, res) => {
  try {
    const conversation = await getOrCreateStoreSupportConversation(req.storeUser);
    const message = await appendStoreSupportMessage({
      conversationId: conversation.id,
      senderRole: "user",
      senderId: req.storeUser.id,
      body: req.body?.body,
    });
    const freshConversation = await StoreSupportConversation.findOne({
      id: String(conversation.id || "").trim(),
    }).lean();
    await emitStoreSupportMessageRealtimeUpdate({
      conversation: freshConversation || conversation,
      message,
    });
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForUser(
        freshConversation || conversation,
      ),
      message: sanitizeStoreSupportMessage(message),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong gui duoc tin nhan.",
    });
  }
});

app.post(
  "/api/store/support/thread/read",
  verifyStoreUserToken,
  storeSupportThreadRateLimit,
  async (req, res) => {
  try {
    const conversation = await getOrCreateStoreSupportConversation(req.storeUser);
    const shouldApplyMarkRead = Number(conversation?.userUnreadCount || 0) > 0;
    if (shouldApplyMarkRead) {
      await markStoreSupportConversationRead({
        conversationId: conversation.id,
        readerRole: "user",
      });
    }
    const freshConversation = await StoreSupportConversation.findOne({
      id: String(conversation.id || "").trim(),
    }).lean();
    if (shouldApplyMarkRead) {
      await emitStoreSupportReadRealtimeUpdate({
        conversation: freshConversation || conversation,
        readerRole: "user",
      });
    }
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForUser(
        freshConversation || conversation,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong cap nhat duoc trang thai da doc.",
    });
  }
});

app.get("/api/store/orders/:id", verifyStoreUserToken, async (req, res) => {
  try {
    await expireStaleStoreOrders({ userId: req.storeUser.id });
    let order = await StoreOrder.findOne({
      id: String(req.params?.id || "").trim(),
      userId: req.storeUser.id,
    });
    if (order && canRetryStoreFailedFulfillment(order)) {
      order = await retryFailedStoreOrderFulfillment(order, { emitRealtime: true });
    }
    order = order && typeof order.toObject === "function" ? order.toObject() : order;
    if (
      !order ||
      STORE_HIDDEN_ORDER_STATUSES.has(
        String(order?.status || "").trim().toLowerCase(),
      )
    ) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    res.json({ order: await sanitizeSingleStoreOrderWithOperationalState(order) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được đơn hàng" });
  }
});

app.post("/api/store/orders/:id/reconcile", verifyStoreUserToken, async (req, res) => {
  try {
    await expireStaleStoreOrders({ userId: req.storeUser.id });
    let order = await StoreOrder.findOne({
      id: String(req.params?.id || "").trim(),
      userId: req.storeUser.id,
    });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    if (canRetryStoreFailedFulfillment(order)) {
      order = await retryFailedStoreOrderFulfillment(order, { emitRealtime: true });
    }
    order = await reconcileStoreOrderPaymentStatus(order, {
      source: "user_reconcile",
    });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    const normalizedStatus = String(order?.status || "").trim().toLowerCase();
    if (STORE_HIDDEN_ORDER_STATUSES.has(normalizedStatus)) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    await emitStoreOrderRealtimeUpdate(order, {
      includeStock: normalizedStatus === "fulfilled",
    });
    res.json({
      order: await sanitizeSingleStoreOrderWithOperationalState(
        typeof order?.toObject === "function" ? order.toObject() : order,
      ),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || "Không thể kiểm tra trạng thái thanh toán",
    });
  }
});

app.post("/api/store/orders/payment", verifyStoreUserToken, storeOrderPaymentRateLimit, async (req, res) => {
  try {
    const packageCode = String(req.body?.packageCode || "").trim().toLowerCase();
    const packageMap = await getStorePackageMap();
    const packageConfig = packageMap[packageCode];
    const paymentMethod = normalizeStorePaymentMethod(req.body?.paymentMethod);
    if (!packageConfig || packageCode === "package3") {
      return res.status(400).json({ error: "Gói này chưa hỗ trợ mua tự động" });
    }

    if (
      paymentMethod === STORE_PAYMENT_METHOD_MOMO &&
      (!MOMO_PARTNER_CODE || !MOMO_ACCESS_KEY || !MOMO_SECRET_KEY)
    ) {
      return res.status(400).json({ error: "MoMo chưa được cấu hình đầy đủ" });
    }
    if (
      paymentMethod === STORE_PAYMENT_METHOD_PAYOS &&
      (!PAYOS_BASE_URL ||
        !PAYOS_CLIENT_ID ||
        !PAYOS_API_KEY ||
        !PAYOS_CHECKSUM_KEY)
    ) {
      return res.status(400).json({ error: "payOS chưa được cấu hình đầy đủ" });
    }

    await cleanupOldStoreFailedOrders({ userId: req.storeUser.id });

    const reusableOrder = await getStoreReusablePendingOrder({
      userId: req.storeUser.id,
      packageCode: packageConfig.code,
    });
    const pricing = await resolveStoreVoucherPricing({
      voucherCode: req.body?.voucherCode,
      packageCode: packageConfig.code,
      userId: req.storeUser.id,
      excludeOrderId: reusableOrder?.id,
    });
    if (reusableOrder?.id) {
      const sameMethod =
        normalizeStorePaymentMethod(reusableOrder.paymentMethod) === paymentMethod;
      const sameVoucher =
        normalizeStoreVoucherCode(reusableOrder?.voucherCode) ===
          normalizeStoreVoucherCode(pricing?.voucher?.code) &&
        Number(reusableOrder?.amount || 0) === Number(pricing?.finalAmount || 0) &&
        Number(reusableOrder?.discountAmount || 0) ===
          Number(pricing?.discountAmount || 0);
      let workingOrder = reusableOrder;
      if (!sameMethod || !sameVoucher) {
        workingOrder = await StoreOrder.findOneAndUpdate(
          { id: reusableOrder.id },
          {
            $set: {
              paymentMethod,
              originalAmount: Number(pricing?.originalAmount || packageConfig.price || 0),
              discountAmount: Number(pricing?.discountAmount || 0),
              amount: Number(pricing?.finalAmount || packageConfig.price || 0),
              voucherId: String(pricing?.voucher?.id || "").trim(),
              voucherCode: normalizeStoreVoucherCode(pricing?.voucher?.code),
              voucherType: pricing?.voucher
                ? normalizeStoreVoucherType(pricing?.voucher?.type)
                : "",
              voucherValue: Number(pricing?.voucher?.value || 0),
              voucherDescription: String(
                pricing?.voucher?.description || "",
              ).trim(),
              status: "pending_payment",
              reservationState: String(
                reusableOrder?.reservedAccountId
                  ? "reserved_for_pending_store_order"
                  : "",
              ).trim(),
              fulfillmentState: "awaiting_payment",
              fulfillmentReason: "",
              expiresAt: getStorePaymentExpiresAtIso(),
              ...(paymentMethod === STORE_PAYMENT_METHOD_MOMO
                ? {
                    ...clearStorePayosPaymentFields(),
                    ...clearStoreMomoPaymentFields(),
                    momoOrderId: createStoreId("momo_order"),
                  }
                : {
                    ...clearStoreMomoPaymentFields(),
                    ...clearStorePayosPaymentFields(),
                  }),
              updatedAt: new Date().toISOString(),
            },
          },
          { new: true },
        );
      }

      let payUrl = getStorePaymentUrl(workingOrder);
      if (!payUrl) {
        payUrl =
          paymentMethod === STORE_PAYMENT_METHOD_PAYOS
            ? await createPayosPaymentForStoreOrder(req, workingOrder)
            : await createMomoPaymentForStoreOrder(req, workingOrder);
      }
      const freshOrder = await StoreOrder.findOne({ id: reusableOrder.id }).lean();
      await emitStoreOrderRealtimeUpdate(freshOrder);
      return res.json({
        success: true,
        reused: true,
        payUrl,
        order: await sanitizeSingleStoreOrderWithOperationalState(freshOrder),
      });
    }

    const stockSummary = await buildStoreCatalog();
    const selectedStock = stockSummary.find((item) => item.code === packageCode);
    if (!selectedStock?.purchasable) {
      return res
        .status(409)
        .json({ error: "Hiện không đủ tài khoản phù hợp cho gói này." });
    }

    const reservation =
      packageConfig.code === "package1"
        ? await selectStorePackage1ReservationTarget()
        : await selectStorePackage2ReservationTarget();
    if (!reservation?.reservedAccountId) {
      return res
        .status(409)
        .json({ error: "Hiện không đủ tài khoản phù hợp cho gói này." });
    }

    const nowIso = new Date().toISOString();
    const order = await StoreOrder.create({
      id: createStoreId("ord"),
      userId: req.storeUser.id,
      packageCode: packageConfig.code,
      packageName: packageConfig.name,
      originalAmount: Number(pricing?.originalAmount || packageConfig.price || 0),
      discountAmount: Number(pricing?.discountAmount || 0),
      amount: Number(pricing?.finalAmount || packageConfig.price || 0),
      voucherId: String(pricing?.voucher?.id || "").trim(),
      voucherCode: normalizeStoreVoucherCode(pricing?.voucher?.code),
      voucherType: pricing?.voucher
        ? normalizeStoreVoucherType(pricing?.voucher?.type)
        : "",
      voucherValue: Number(pricing?.voucher?.value || 0),
      voucherDescription: String(pricing?.voucher?.description || "").trim(),
      paymentMethod,
      status: "pending_payment",
      momoOrderId:
        paymentMethod === STORE_PAYMENT_METHOD_MOMO
          ? createStoreId("momo_order")
          : "",
      expiresAt: getStorePaymentExpiresAtIso(),
      reservedAccountId: reservation.reservedAccountId,
      reservedAccountUsername: reservation.reservedAccountUsername,
      reservationType: reservation.reservationType,
      reservationState: "reserved_for_pending_store_order",
      reservedAccountSnapshot: {
        accountId: String(reservation.reservedAccountId || "").trim(),
        username: String(reservation.reservedAccountUsername || "").trim(),
        reservationType: String(reservation.reservationType || "").trim(),
        packageCode: packageConfig.code,
        warehouse: CHATGPT_TOTAL_VALUE,
        reservedAt: nowIso,
      },
      fulfillmentState: "awaiting_payment",
      fulfillmentReason: "",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    let payUrl = "";
    let freshOrder = null;
    try {
      payUrl =
        paymentMethod === STORE_PAYMENT_METHOD_PAYOS
          ? await createPayosPaymentForStoreOrder(req, order)
          : await createMomoPaymentForStoreOrder(req, order);
      freshOrder = await StoreOrder.findOneAndUpdate(
        { id: order.id },
        {
          $set: {
            status: "awaiting_payment",
            reservationState: "reserved_for_pending_store_order",
            fulfillmentState: "awaiting_payment",
            updatedAt: new Date().toISOString(),
          },
        },
        { new: true },
      ).lean();
    } catch (paymentError) {
      await StoreOrder.deleteOne({ id: order.id });
      throw paymentError;
      await StoreOrder.findOneAndUpdate(
        { id: order.id },
        {
          $set: {
            status: "payment_failed",
            momoMessage:
              paymentError.message || "Không tạo được liên kết thanh toán.",
            updatedAt: new Date().toISOString(),
          },
        },
      );
      throw paymentError;
    }

    await emitStoreOrderRealtimeUpdate(freshOrder, {
      kind: "created",
      adminOrder: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        freshOrder,
        req.storeUser,
      ),
    });
    return res.json({
      success: true,
      payUrl,
      order: await sanitizeSingleStoreOrderWithOperationalState(freshOrder),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không tạo được liên kết thanh toán.",
    });
  }
});

app.post("/api/store/orders/payment-legacy-disabled", verifyStoreUserToken, async (req, res) => {
  try {
    const packageCode = String(req.body?.packageCode || "").trim().toLowerCase();
    const packageMap = await getStorePackageMap();
    const packageConfig = packageMap[packageCode];
    if (!packageConfig || packageCode === "package3") {
      return res.status(400).json({ error: "Gói này chưa hỗ trợ mua tự động" });
    }
    const stockSummary = await buildStoreCatalog();
    const selectedStock = stockSummary.find((item) => item.code === packageCode);
    if (!selectedStock?.purchasable) {
      return res
        .status(409)
        .json({ error: "Hiện không đủ tài khoản phù hợp cho gói này" });
    }

    const order = await StoreOrder.create({
      id: createStoreId("ord"),
      userId: req.storeUser.id,
      packageCode: packageConfig.code,
      packageName: packageConfig.name,
      amount: packageConfig.price,
      status: "pending_payment",
      momoOrderId: createStoreId("momo_order"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const payUrl = await createMomoPaymentForStoreOrder(req, order);
    const freshOrder = await StoreOrder.findOneAndUpdate(
      { id: order.id },
      {
        $set: {
          status: "awaiting_payment",
          momoPayUrl: payUrl,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true },
    ).lean();
    res.json({
      success: true,
      payUrl,
      order: await sanitizeSingleStoreOrderWithOperationalState(freshOrder),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.message || "Không tạo được liên kết thanh toán",
    });
  }
});

app.post("/api/store/package1/code", async (req, res) => {
  try {
    const secretToken = String(req.body?.secretToken || "").trim();
    if (!secretToken) {
      return res.status(400).json({ error: "Thiếu mã bí mật" });
    }
    const order = await StoreOrder.findOne({
      packageCode: "package1",
      package1AccessToken: secretToken,
      status: "fulfilled",
    });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy mã bí mật hợp lệ" });
    }
    if (buildStorePackage1UsageLeft(order) <= 0) {
      return res.status(400).json({ error: "Đã hết lượt lấy mã" });
    }
    const account = await Account.findOne({ id: String(order.assignedAccountId || "").trim() }).lean();
    const otpSecret = String(account?.otpSecret || "").trim();
    if (!otpSecret) {
      return res.status(400).json({ error: "Tài khoản này chưa có mã 2FA" });
    }
    const otp = generateTotpCode(otpSecret);
    const updatedOrder = await StoreOrder.findOneAndUpdate(
      { id: order.id },
      {
        $set: {
          package1UsedCount: Number(order.package1UsedCount || 0) + 1,
          package1LastCode: otp.code,
          package1LastCodeAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true },
    );
    await emitStoreOrderRealtimeUpdate(updatedOrder);
    res.json({
      success: true,
      code: otp.code,
      expiresIn: otp.expiresIn,
      usageLeft: buildStorePackage1UsageLeft(updatedOrder),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không lấy được mã 2FA" });
  }
});

app.post("/api/store/totp/generate", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "").trim();
    if (!secret) {
      return res.status(400).json({ error: "Thiếu mã 2FA" });
    }
    const otp = generateTotpCode(secret);
    res.json({ success: true, code: otp.code, expiresIn: otp.expiresIn });
  } catch (error) {
    res.status(400).json({ error: error.message || "Không tạo được mã OTP" });
  }
});

app.post("/api/store/momo/ipn", async (req, res) => {
  try {
    if (!verifyMomoIpnSignature(req.body || {})) {
      return res.status(400).json({ resultCode: 1, message: "invalid signature" });
    }
    const momoOrderId = String(req.body?.orderId || "").trim();
    const order = await StoreOrder.findOne({ momoOrderId });
    if (!order) {
      return res.json({ resultCode: 0, message: "OK" });
    }
    const resultCode = Number(req.body?.resultCode ?? 1);
    if (String(order.status || "").trim().toLowerCase() === "fulfilled") {
      return res.json({ resultCode: 0, message: "OK" });
    }
    order.momoResultCode = resultCode;
    order.momoTransId = String(req.body?.transId || "").trim();
    order.momoMessage = String(req.body?.message || "").trim();
    order.updatedAt = new Date().toISOString();
    if (resultCode === 0) {
      const paidAt = new Date().toISOString();
      const prepared = await prepareStoreOrderForPaidFulfillment({
        orderId: String(order?.id || "").trim(),
        paidAt,
        paymentPatch: {
          momoResultCode: resultCode,
          momoTransId: String(req.body?.transId || "").trim(),
          momoMessage: String(req.body?.message || "").trim(),
        },
      });
      const fulfilledOrder =
        prepared?.shouldFulfill && prepared?.order
          ? await fulfillStoreOrder(prepared.order, { source: "momo_ipn" })
          : prepared?.order || (await StoreOrder.findOne({ id: order.id }));
      await emitStoreOrderRealtimeUpdate(fulfilledOrder || order, {
        includeStock: true,
      });
    } else {
      await StoreOrder.deleteOne({ id: order.id });
      await emitStoreOrderRealtimeUpdate(order);
    }
    return res.json({ resultCode: 0, message: "OK" });
  } catch (error) {
    console.error("Store MoMo IPN error:", error?.message || error);
    return res.status(500).json({ resultCode: 1, message: "server error" });
  }
});

app.post("/api/store/payos/webhook", async (req, res) => {
  try {
    const webhookData = req.body?.data || {};
    const paymentLinkId = String(
      webhookData?.paymentLinkId || webhookData?.id || "",
    ).trim();
    const orderCodeRaw = webhookData?.orderCode;
    const orderCode = Number(orderCodeRaw);

    let order = null;
    if (paymentLinkId) {
      order = await StoreOrder.findOne({ payosPaymentLinkId: paymentLinkId });
    }
    if (!order && Number.isFinite(orderCode) && orderCode > 0) {
      order = await StoreOrder.findOne({ payosOrderCode: orderCode });
    }
    if (!order) {
      return res.status(200).json({ code: "00", desc: "success" });
    }

    const nextOrder = await reconcileStoreOrderPaymentStatus(order, {
      source: "payos_webhook",
    });
    if (nextOrder) {
      await emitStoreOrderRealtimeUpdate(nextOrder, {
        includeStock: String(nextOrder?.status || "").trim().toLowerCase() === "fulfilled",
      });
    }
    return res.status(200).json({ code: "00", desc: "success" });
  } catch (error) {
    console.error("Store payOS webhook error:", error?.message || error);
    return res.status(500).json({ code: "99", desc: "server error" });
  }
});

// 1. GET ALL DATA (Protected - requires token)

// --- DATAMMO INTEGRATION ---
const DATAMMO_TOKEN = "sk_1773222055913_er0acsx8dyj";
const SHOPMINI_PRIVATE_API_TOKEN =
  process.env.SHOPMINI_PRIVATE_API_TOKEN || "b3ee1004bd46d46c38f101f769c596bbIAWFS";
const DATAMMO_VARIANT_PKG2 = "98ed02c7-d28b-4287-945e-bdfb24a09397";
const DATAMMO_VARIANT_PKG2_CHEAP = "b5449604-4fce-4edf-89d3-d4400d0f34a6";
const DATAMMO_VARIANT_PKG3 = "5e3567bc-ada4-471d-b93b-725a0735b677";
const DATAMMO_VARIANT_TEAM_BUSINESS = "8851247b-72de-4c31-ac84-470cb97abb0e";

const TEAM_SALE_MODE_SLOT = "slot";
const TEAM_SALE_MODE_BUSINESS = "business";
const VALID_TEAM_SALE_MODES = [TEAM_SALE_MODE_SLOT, TEAM_SALE_MODE_BUSINESS];
const TEAM_WAREHOUSE_TOTAL = "total";
const TEAM_WAREHOUSE_MARKET = "market";
const TEAM_WAREHOUSE_SHORT = "short";
const VALID_TEAM_WAREHOUSES = [
  TEAM_WAREHOUSE_TOTAL,
  TEAM_WAREHOUSE_MARKET,
  TEAM_WAREHOUSE_SHORT,
];
const VALID_DURATION_CODES = ["1M", "2M", "3M", "6M", "1Y"];
const normalizeTeamSaleMode = (value, fallback = TEAM_SALE_MODE_SLOT) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (VALID_TEAM_SALE_MODES.includes(normalized)) return normalized;
  return fallback;
};
const normalizeTeamWarehouse = (value, fallback = TEAM_WAREHOUSE_TOTAL) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (VALID_TEAM_WAREHOUSES.includes(normalized)) return normalized;
  return fallback;
};
const normalizeDurationCode = (value, fallback = "1M") => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (VALID_DURATION_CODES.includes(normalized)) return normalized;
  return fallback;
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
const addDurationToDate = (dateInput, duration = "1M") => {
  const normalizedDuration = normalizeDurationCode(duration);
  if (normalizedDuration === "1Y") {
    return addMonthsClamped(dateInput, 12);
  }
  return addMonthsClamped(
    dateInput,
    {
      "1M": 1,
      "2M": 2,
      "3M": 3,
      "6M": 6,
    }[normalizedDuration] || 1,
  );
};
const normalizeLegacyExtDays = (value, fallback = "1M") => {
  switch (parseInt(value, 10)) {
    case 30:
      return "1M";
    case 60:
      return "2M";
    case 90:
      return "3M";
    case 180:
      return "6M";
    case 365:
      return "1Y";
    default:
      return fallback;
  }
};
const STORE_USER_JWT_SECRET =
  process.env.JWT_SECRET || "change-me-store-user-jwt-secret";
const MOMO_PARTNER_CODE = String(
  process.env.MOMO_PARTNER_CODE || process.env.MOMO_PARTNER_CE || "",
).trim();
const MOMO_ACCESS_KEY = String(
  process.env.MOMO_ACCESS_KEY || process.env.MOMO_ACCESS_KE || "",
).trim();
const MOMO_SECRET_KEY = String(process.env.MOMO_SECRET_KEY || "").trim();
const STORE_PACKAGE1_PRICE = Math.max(
  0,
  Number(process.env.STORE_PACKAGE1_PRICE || 30000),
);
const STORE_PACKAGE2_PRICE = Math.max(
  0,
  Number(process.env.STORE_PACKAGE2_PRICE || 60000),
);
const STORE_PACKAGE3_PRICE = Math.max(
  0,
  Number(process.env.STORE_PACKAGE3_PRICE || 110000),
);
const STORE_TOTAL_MIN_DAYS = Math.max(
  1,
  Number(process.env.STORE_TOTAL_MIN_DAYS || 20),
);
const STORE_PACKAGE1_MAX_OTP_USES = 3;
const STORE_PAYMENT_HOLD_MINUTES = Math.max(
  1,
  Number(process.env.STORE_PAYMENT_HOLD_MINUTES || 10),
);
const STORE_PAYMENT_HOLD_MS = STORE_PAYMENT_HOLD_MINUTES * 60 * 1000;
const MOMO_ENDPOINT =
  process.env.MOMO_ENDPOINT || "https://test-payment.momo.vn/v2/gateway/api/create";
const MOMO_QUERY_ENDPOINT =
  process.env.MOMO_QUERY_ENDPOINT ||
  MOMO_ENDPOINT.replace(/\/create(?:\?.*)?$/i, "/query");
const MOMO_REQUEST_TYPE = process.env.MOMO_REQUEST_TYPE || "captureWallet";
const PAYOS_BASE_URL = String(
  process.env.PAYOS_BASE_URL || "https://api-merchant.payos.vn",
).trim();
const PAYOS_CLIENT_ID = String(process.env.PAYOS_CLIENT_ID || "").trim();
const PAYOS_API_KEY = String(process.env.PAYOS_API_KEY || "").trim();
const PAYOS_CHECKSUM_KEY = String(process.env.PAYOS_CHECKSUM_KEY || "").trim();
const PAYOS_PARTNER_CODE = String(process.env.PAYOS_PARTNER_CODE || "").trim();
const GOOGLE_OAUTH_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleOAuthClient = GOOGLE_OAUTH_CLIENT_ID
  ? new OAuth2Client(GOOGLE_OAUTH_CLIENT_ID)
  : null;
const STORE_PAYMENT_METHOD_MOMO = "momo";
const STORE_PAYMENT_METHOD_PAYOS = "payos";
const STORE_SUPPORT_MESSAGE_RETENTION_DAYS = 7;
const STORE_SUPPORT_MESSAGE_RETENTION_MS =
  STORE_SUPPORT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const STORE_SUPPORT_THREAD_PAGE_SIZE = 30;
const VALID_STORE_PAYMENT_METHODS = [
  STORE_PAYMENT_METHOD_MOMO,
  STORE_PAYMENT_METHOD_PAYOS,
];
const STORE_PACKAGE_MAP = {
  package1: {
    code: "package1",
    name: "Gói 1 - Chia sẻ tiết kiệm",
    price: STORE_PACKAGE1_PRICE,
    automated: true,
  },
  package2: {
    code: "package2",
    name: "Gói 2 - Tài khoản riêng tư",
    price: STORE_PACKAGE2_PRICE,
    automated: true,
  },
  package3: {
    code: "package3",
    name: "Gói 3 - Nâng chính chủ Gmail",
    price: STORE_PACKAGE3_PRICE,
    automated: false,
  },
};
const STORE_CONFIG_DOCUMENT_ID = "default";
const STORE_PACKAGE_CODES = Object.keys(STORE_PACKAGE_MAP);
const normalizeStorePackagePrice = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Number(fallback || 0));
  }
  return Math.round(parsed);
};
const buildStorePackageMap = (packagePrices = {}) => {
  const overrides =
    packagePrices && typeof packagePrices === "object" ? packagePrices : {};
  return STORE_PACKAGE_CODES.reduce((result, code) => {
    const basePackage = STORE_PACKAGE_MAP[code];
    result[code] = {
      ...basePackage,
      price: normalizeStorePackagePrice(overrides?.[code], basePackage?.price || 0),
    };
    return result;
  }, {});
};
const buildStorePackageList = (
  packageMap = STORE_PACKAGE_MAP,
  { includeDefaults = false } = {},
) =>
  STORE_PACKAGE_CODES.map((code) => {
    const currentPackage = packageMap?.[code] || STORE_PACKAGE_MAP[code];
    const fallbackPackage = STORE_PACKAGE_MAP[code];
    const item = {
      ...currentPackage,
      price: normalizeStorePackagePrice(
        currentPackage?.price,
        fallbackPackage?.price || 0,
      ),
    };
    if (includeDefaults) {
      item.defaultPrice = normalizeStorePackagePrice(fallbackPackage?.price, 0);
      item.isCustomPrice = Number(item.price || 0) !== Number(item.defaultPrice || 0);
    }
    return item;
  });
let storeConfigCacheData = null;
let storeConfigCacheExpiresAt = 0;
let storeConfigCachePromise = null;
const STORE_CONFIG_CACHE_TTL_MS = 30000;
const clearStoreConfigCache = () => {
  storeConfigCacheData = null;
  storeConfigCacheExpiresAt = 0;
  storeConfigCachePromise = null;
};
const getCachedStoreConfig = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && storeConfigCacheData && storeConfigCacheExpiresAt > now) {
    return storeConfigCacheData;
  }
  if (!force && storeConfigCachePromise) {
    return storeConfigCachePromise;
  }
  const runRequest = (async () => {
    const config =
      (await StoreConfig.findOne({ id: STORE_CONFIG_DOCUMENT_ID }).lean()) || null;
    storeConfigCacheData = config;
    storeConfigCacheExpiresAt = Date.now() + STORE_CONFIG_CACHE_TTL_MS;
    return config;
  })();
  storeConfigCachePromise = runRequest;
  try {
    return await runRequest;
  } finally {
    if (storeConfigCachePromise === runRequest) {
      storeConfigCachePromise = null;
    }
  }
};
const getStorePackageMap = async ({ force = false } = {}) => {
  const config = await getCachedStoreConfig({ force });
  return buildStorePackageMap(config?.packagePrices || {});
};
const sanitizeStoreConfigForAdmin = (
  config = null,
  packageMap = STORE_PACKAGE_MAP,
) => ({
  id: String(config?.id || STORE_CONFIG_DOCUMENT_ID).trim(),
  packages: buildStorePackageList(packageMap, { includeDefaults: true }),
  updatedAt: String(config?.updatedAt || "").trim(),
});
const buildStorePackagePriceUpdatePayload = (body = {}) => {
  const rawPrices =
    body?.packagePrices && typeof body.packagePrices === "object"
      ? body.packagePrices
      : body;
  const nextPrices = {};
  STORE_PACKAGE_CODES.forEach((code) => {
    const rawValue = rawPrices?.[code];
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      const error = new Error(`Gia ${code} khong hop le.`);
      error.statusCode = 400;
      throw error;
    }
    nextPrices[code] = Math.round(parsed);
  });
  return nextPrices;
};
const normalizeEmailLower = (value) => String(value || "").trim().toLowerCase();
const normalizePhoneValue = (value) => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("84")) return `0${digits.slice(2)}`;
  return digits;
};
const createStoreId = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createStoreNumericOrderCode = () =>
  Number(`${Date.now()}${Math.floor(Math.random() * 90 + 10)}`);
const createRandomHexToken = (size = 24) =>
  crypto.randomBytes(size).toString("hex");
const createStoreManualPassword = () =>
  `web${crypto.randomBytes(4).toString("hex")}`;
const hashSha256 = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");
const upsertStringIntoList = (list = [], value = "") => {
  const normalized = String(value || "").trim();
  const current = Array.isArray(list)
    ? list.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!normalized) return current;
  return Array.from(new Set([...current, normalized]));
};
const removeStringFromList = (list = [], value = "") => {
  const normalized = String(value || "").trim();
  const current = Array.isArray(list)
    ? list.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!normalized) return current;
  return current.filter((item) => item !== normalized);
};
const sanitizeStoreUser = (user) => {
  if (!user) return null;
  return {
    id: String(user.id || ""),
    fullName: String(user.fullName || ""),
    phone: String(user.phone || ""),
    email: String(user.email || ""),
    createdAt: String(user.createdAt || ""),
    realtimeTopic: buildStoreUserRealtimeTopic(String(user.id || "").trim()),
  };
};
const sanitizeStoreUserForAdmin = (user, stats = {}) => {
  if (!user) return null;
  const authProviders = Array.isArray(user?.authProviders)
    ? user.authProviders
        .map((provider) => String(provider || "").trim())
        .filter(Boolean)
    : [];
  return {
    id: String(user.id || "").trim(),
    fullName: String(user.fullName || "").trim(),
    phone: String(user.phone || "").trim(),
    email: String(user.email || "").trim(),
    googleId: String(user.googleId || "").trim(),
    hasPassword: !!String(user.passwordHash || "").trim(),
    authProviders,
    createdAt: String(user.createdAt || "").trim(),
    updatedAt: String(user.updatedAt || "").trim(),
    totalOrders: Number(stats?.totalOrders || 0),
    fulfilledOrders: Number(stats?.fulfilledOrders || 0),
    pendingOrders: Number(stats?.pendingOrders || 0),
    latestOrderAt: String(stats?.latestOrderAt || "").trim(),
  };
};
const normalizeStoreVoucherType = (value) =>
  String(value || "").trim().toLowerCase() === "fixed" ? "fixed" : "percent";
const normalizeStoreVoucherCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
const getStoreVoucherDisplayValue = (voucher = {}) => {
  const type = normalizeStoreVoucherType(voucher?.type);
  const value = Number(voucher?.value || 0);
  if (type === "fixed") {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(Math.max(0, value));
  }
  return `${Math.max(0, value)}%`;
};
const isStoreVoucherDateActive = (
  voucher = {},
  baseDate = new Date(),
) => {
  const nowMs = baseDate instanceof Date ? baseDate.getTime() : Date.now();
  const startsAtMs = parseStoreDateMs(voucher?.startsAt);
  const endsAtMs = parseStoreDateMs(voucher?.endsAt);
  if (startsAtMs > 0 && startsAtMs > nowMs) return false;
  if (endsAtMs > 0 && endsAtMs < nowMs) return false;
  return true;
};
const sanitizeStoreVoucherUsageOrder = (order = {}, user = null) => ({
  id: String(order?.id || "").trim(),
  userId: String(order?.userId || "").trim(),
  customerName: String(user?.fullName || "").trim(),
  customerEmail: String(user?.email || "").trim(),
  customerPhone: String(user?.phone || "").trim(),
  packageCode: String(order?.packageCode || "").trim(),
  packageName: String(
    order?.packageName || STORE_PACKAGE_MAP[String(order?.packageCode || "").trim()]?.name || "",
  ).trim(),
  status: String(order?.status || "").trim(),
  originalAmount: Number(order?.originalAmount || order?.amount || 0),
  discountAmount: Number(order?.discountAmount || 0),
  finalAmount: Number(order?.amount || 0),
  createdAt: String(order?.createdAt || "").trim(),
  paidAt: String(order?.paidAt || "").trim(),
  fulfilledAt: String(order?.fulfilledAt || "").trim(),
});
const sanitizeStoreVoucherForAdmin = (voucher, stats = {}) => {
  if (!voucher) return null;
  const maxUses = Math.max(0, Number(voucher?.maxUses || 0));
  const totalUses = Math.max(0, Number(stats?.totalUses || 0));
  return {
    id: String(voucher?.id || "").trim(),
    code: normalizeStoreVoucherCode(voucher?.code),
    type: normalizeStoreVoucherType(voucher?.type),
    value: Number(voucher?.value || 0),
    displayValue: getStoreVoucherDisplayValue(voucher),
    description: String(voucher?.description || "").trim(),
    isActive: !!voucher?.isActive,
    maxUses,
    perUserLimit: Math.max(0, Number(voucher?.perUserLimit || 0)),
    minOrderAmount: Math.max(0, Number(voucher?.minOrderAmount || 0)),
    startsAt: String(voucher?.startsAt || "").trim(),
    endsAt: String(voucher?.endsAt || "").trim(),
    createdAt: String(voucher?.createdAt || "").trim(),
    updatedAt: String(voucher?.updatedAt || "").trim(),
    totalUses,
    activeUses: Math.max(0, Number(stats?.activeUses || 0)),
    fulfilledUses: Math.max(0, Number(stats?.fulfilledUses || 0)),
    userCount: Math.max(0, Number(stats?.userCount || 0)),
    remainingUses: maxUses > 0 ? Math.max(0, maxUses - totalUses) : null,
    users: Array.isArray(stats?.users) ? stats.users : [],
    recentOrders: Array.isArray(stats?.recentOrders) ? stats.recentOrders : [],
  };
};
const sanitizeStoreVoucherForCheckout = ({
  voucher = null,
  originalAmount = 0,
  discountAmount = 0,
  finalAmount = 0,
} = {}) => {
  if (!voucher) return null;
  return {
    id: String(voucher?.id || "").trim(),
    code: normalizeStoreVoucherCode(voucher?.code),
    type: normalizeStoreVoucherType(voucher?.type),
    value: Number(voucher?.value || 0),
    displayValue: getStoreVoucherDisplayValue(voucher),
    description: String(voucher?.description || "").trim(),
    originalAmount: Number(originalAmount || 0),
    discountAmount: Number(discountAmount || 0),
    finalAmount: Number(finalAmount || 0),
  };
};
const getStoreSupportRetentionCutoffIso = () =>
  new Date(Date.now() - STORE_SUPPORT_MESSAGE_RETENTION_MS).toISOString();
const buildStoreSupportCursor = (message = null) => {
  const createdAt = String(message?.createdAt || "").trim();
  const id = String(message?.id || "").trim();
  if (!createdAt || !id) return "";
  return `${createdAt}__${id}`;
};
const parseStoreSupportCursor = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const separatorIndex = raw.lastIndexOf("__");
  if (separatorIndex <= 0) return null;
  const createdAt = raw.slice(0, separatorIndex).trim();
  const id = raw.slice(separatorIndex + 2).trim();
  if (!createdAt || !id) return null;
  return { createdAt, id };
};
const sanitizeStoreSupportMessage = (message = {}) => ({
  id: String(message?.id || "").trim(),
  conversationId: String(message?.conversationId || "").trim(),
  senderRole: String(message?.senderRole || "").trim(),
  senderId: String(message?.senderId || "").trim(),
  body: String(message?.body || "").trim(),
  createdAt: String(message?.createdAt || "").trim(),
  readAt: String(message?.readAt || "").trim(),
});
const sanitizeStoreSupportConversationForAdmin = (conversation = {}) => ({
  id: String(conversation?.id || "").trim(),
  userId: String(conversation?.userId || "").trim(),
  userName: String(conversation?.userName || "").trim(),
  userEmail: String(conversation?.userEmail || "").trim(),
  userPhone: String(conversation?.userPhone || "").trim(),
  status: String(conversation?.status || "open").trim(),
  lastMessageAt: String(conversation?.lastMessageAt || "").trim(),
  lastMessagePreview: String(conversation?.lastMessagePreview || "").trim(),
  lastSenderRole: String(conversation?.lastSenderRole || "").trim(),
  adminUnreadCount: Math.max(0, Number(conversation?.adminUnreadCount || 0)),
  userUnreadCount: Math.max(0, Number(conversation?.userUnreadCount || 0)),
  lastAdminReadAt: String(conversation?.lastAdminReadAt || "").trim(),
  lastUserReadAt: String(conversation?.lastUserReadAt || "").trim(),
  lastUserMessageAt: String(conversation?.lastUserMessageAt || "").trim(),
  createdAt: String(conversation?.createdAt || "").trim(),
  updatedAt: String(conversation?.updatedAt || "").trim(),
  realtimeTopic: buildStoreSupportRealtimeTopic(
    String(conversation?.id || "").trim(),
  ),
});
const sanitizeStoreSupportConversationForUser = (conversation = {}) => {
  const lastAdminReadAt = String(conversation?.lastAdminReadAt || "").trim();
  const lastUserMessageAt = String(conversation?.lastUserMessageAt || "").trim();
  const lastAdminReadMs = lastAdminReadAt ? new Date(lastAdminReadAt).getTime() : 0;
  const lastUserMessageMs = lastUserMessageAt
    ? new Date(lastUserMessageAt).getTime()
    : 0;
  const adminHasSeenLatest =
    !lastUserMessageAt ||
    (Number.isFinite(lastAdminReadMs) &&
      Number.isFinite(lastUserMessageMs) &&
      lastAdminReadMs >= lastUserMessageMs);
  return {
    id: String(conversation?.id || "").trim(),
    status: String(conversation?.status || "open").trim(),
    lastMessageAt: String(conversation?.lastMessageAt || "").trim(),
    lastMessagePreview: String(conversation?.lastMessagePreview || "").trim(),
    lastSenderRole: String(conversation?.lastSenderRole || "").trim(),
    unreadCount: Math.max(0, Number(conversation?.userUnreadCount || 0)),
    adminSeenAt: lastAdminReadAt,
    adminHasSeenLatest: !!adminHasSeenLatest,
    lastUserMessageAt,
    createdAt: String(conversation?.createdAt || "").trim(),
    updatedAt: String(conversation?.updatedAt || "").trim(),
    realtimeTopic: buildStoreSupportRealtimeTopic(
      String(conversation?.id || "").trim(),
    ),
  };
};

const buildAdminRealtimeConfig = () => ({
  ...buildStoreRealtimeClientConfig(),
  adminTopic: buildAdminRealtimeTopic(),
});

const buildRealtimePayload = (type, extra = {}) => ({
  type: String(type || "").trim(),
  version: Number(latestDataVersion || 0),
  changedAt: new Date().toISOString(),
  entityId: String(extra?.entityId || "").trim(),
  userId: String(extra?.userId || "").trim(),
  conversationId: String(extra?.conversationId || "").trim(),
  status: String(extra?.status || "").trim(),
  packageCode: String(extra?.packageCode || "").trim(),
  senderRole: String(extra?.senderRole || "").trim(),
});

const normalizeAdminInventoryRealtimeScope = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    ["chatgpt", "team", "netflix", "capcut", "canva", "coursera"].includes(
      normalized,
    )
  ) {
    return normalized;
  }
  return "all";
};

const inferAdminInventoryRealtimeMeta = (req = {}) => {
  const path = String(req.path || req.originalUrl || "")
    .split("?")[0]
    .trim();
  if (!path) return null;

  const directScopeMatch = path.match(/^\/api\/(netflix|capcut|canva)(?:\/|$)/i);
  if (directScopeMatch) {
    return {
      scope: normalizeAdminInventoryRealtimeScope(directScopeMatch[1]),
      entityId: String(req.params?.id || req.body?.id || "").trim(),
      action: String(req.method || "").trim().toLowerCase(),
      path,
    };
  }

  if (
    path === "/api/chatgpt" ||
    path === "/api/chatgpt-public" ||
    /^\/api\/chatgpt\/[^/]+(?:\/warranty)?$/i.test(path) ||
    path === "/api/move-user"
  ) {
    return {
      scope: "chatgpt",
      entityId: String(
        req.params?.id || req.body?.accId || req.body?.fromAccId || "",
      ).trim(),
      action: String(req.method || "").trim().toLowerCase(),
      path,
    };
  }

  if (
    path === "/api/team" ||
    path === "/api/team-public" ||
    /^\/api\/team\/[^/]+(?:\/warranty)?$/i.test(path) ||
    path === "/api/team-move-slot"
  ) {
    return {
      scope: "team",
      entityId: String(
        req.params?.id || req.body?.accId || req.body?.fromAccId || "",
      ).trim(),
      action: String(req.method || "").trim().toLowerCase(),
      path,
    };
  }

  if (path === "/api/simple-move-user" || path === "/api/extend-user") {
    return {
      scope: normalizeAdminInventoryRealtimeScope(
        req.body?.platform || "chatgpt",
      ),
      entityId: String(
        req.body?.accId || req.body?.fromAccId || req.body?.toAccId || "",
      ).trim(),
      action: String(req.method || "").trim().toLowerCase(),
      path,
    };
  }

  return null;
};

const emitAdminInventoryRealtimeUpdate = async ({
  scope = "all",
  entityId = "",
  action = "",
  path = "",
} = {}) => {
  await safeEmitRealtimeEvents([
    {
      topic: buildAdminRealtimeTopic(),
      event: "inventory.updated",
      payload: {
        ...buildRealtimePayload("inventory.updated", { entityId }),
        scope: normalizeAdminInventoryRealtimeScope(scope),
        action: String(action || "").trim().toLowerCase(),
        path: String(path || "").trim(),
      },
    },
  ]);
};

const safeEmitRealtimeEvents = async (events = []) => {
  const messages = (Array.isArray(events) ? events : []).filter(
    (event) => String(event?.topic || "").trim() && String(event?.event || "").trim(),
  );
  if (messages.length === 0) return;
  try {
    await emitRealtimeEvents(messages);
  } catch (error) {
    console.error("Realtime broadcast failed:", error?.message || error);
  }
};

const emitStoreOrderRealtimeUpdate = async (
  orderInput = null,
  { includeStock = false, kind = "updated", adminOrder = null } = {},
) => {
  const order =
    orderInput && typeof orderInput.toObject === "function"
      ? orderInput.toObject()
      : { ...(orderInput || {}) };
  const entityId = String(order?.id || "").trim();
  const userId = String(order?.userId || "").trim();
  if (!entityId) return;
  const payload = buildRealtimePayload("order.updated", {
    entityId,
    userId,
    status: String(order?.status || "").trim(),
    packageCode: String(order?.packageCode || "").trim(),
  });
  const resolvedAdminOrder =
    adminOrder && typeof adminOrder === "object"
      ? adminOrder
      : sanitizeStoreOrderForAdmin(order);
  const events = [
    {
      topic: buildAdminRealtimeTopic(),
      event: "order.updated",
      payload: {
        ...payload,
        kind: String(kind || "updated").trim().toLowerCase() || "updated",
        adminOrder: resolvedAdminOrder,
      },
    },
  ];
  if (userId) {
    events.push({
      topic: buildStoreUserRealtimeTopic(userId),
      event: "order.updated",
      payload,
    });
  }
  if (includeStock) {
    const stockPayload = buildRealtimePayload("stock.updated", {
      entityId,
      userId,
      status: String(order?.status || "").trim(),
      packageCode: String(order?.packageCode || "").trim(),
    });
    events.push({
      topic: buildAdminRealtimeTopic(),
      event: "stock.updated",
      payload: stockPayload,
    });
  }
  await safeEmitRealtimeEvents(events);
};

const emitMarketplaceOrderRealtimeUpdate = async (orderInput = null) => {
  const order =
    orderInput && typeof orderInput.toObject === "function"
      ? orderInput.toObject()
      : { ...(orderInput || {}) };
  const entityId = String(order?._id || order?.id || order?.orderId || "").trim();
  if (!entityId) return;
  const scope = normalizeMarketplaceScope(order?.scope, "chatgpt");
  await safeEmitRealtimeEvents([
    {
      topic: buildAdminRealtimeTopic(),
      event: "marketplace.order.created",
      payload: {
        ...buildRealtimePayload("marketplace.order.created", {
          entityId,
          status: "created",
        }),
        scope,
        marketplaceOrder: order,
      },
    },
    {
      topic: buildAdminRealtimeTopic(),
      event: "inventory.updated",
      payload: {
        ...buildRealtimePayload("inventory.updated", {
          entityId,
          status: "created",
        }),
        scope: normalizeAdminInventoryRealtimeScope(scope),
        action: "marketplace_order_created",
        path: "/api/marketplace-order",
      },
    },
  ]);
};

const emitStoreVoucherRealtimeUpdate = async (voucherInput = null) => {
  const voucher =
    voucherInput && typeof voucherInput.toObject === "function"
      ? voucherInput.toObject()
      : { ...(voucherInput || {}) };
  const entityId = String(voucher?.id || "").trim();
  if (!entityId) return;
  await safeEmitRealtimeEvents([
    {
      topic: buildAdminRealtimeTopic(),
      event: "voucher.updated",
      payload: buildRealtimePayload("voucher.updated", {
        entityId,
      }),
    },
  ]);
};

const emitStoreSupportMessageRealtimeUpdate = async ({
  conversation = null,
  message = null,
} = {}) => {
  const safeConversation =
    conversation && typeof conversation.toObject === "function"
      ? conversation.toObject()
      : { ...(conversation || {}) };
  const safeMessage =
    message && typeof message.toObject === "function"
      ? message.toObject()
      : { ...(message || {}) };
  const conversationId = String(
    safeConversation?.id || safeMessage?.conversationId || "",
  ).trim();
  if (!conversationId) return;
  const userId = String(safeConversation?.userId || "").trim();
  const payload = {
    ...buildRealtimePayload("support.message.created", {
      entityId: String(safeMessage?.id || "").trim(),
      userId,
      conversationId,
      senderRole: String(safeMessage?.senderRole || "").trim(),
    }),
    message: sanitizeStoreSupportMessage(safeMessage),
    adminConversation: sanitizeStoreSupportConversationForAdmin(
      safeConversation,
    ),
    userConversation: sanitizeStoreSupportConversationForUser(safeConversation),
  };
  const events = [
    {
      topic: buildAdminRealtimeTopic(),
      event: "support.message.created",
      payload,
    },
    {
      topic: buildStoreSupportRealtimeTopic(conversationId),
      event: "support.message.created",
      payload,
    },
  ];
  if (userId) {
    events.push({
      topic: buildStoreUserRealtimeTopic(userId),
      event: "support.message.created",
      payload,
    });
  }
  await safeEmitRealtimeEvents(events);
};

const emitStoreSupportReadRealtimeUpdate = async ({
  conversation = null,
  readerRole = "",
} = {}) => {
  const safeConversation =
    conversation && typeof conversation.toObject === "function"
      ? conversation.toObject()
      : { ...(conversation || {}) };
  const conversationId = String(safeConversation?.id || "").trim();
  if (!conversationId) return;
  const userId = String(safeConversation?.userId || "").trim();
  const payload = {
    ...buildRealtimePayload("support.thread.read", {
      entityId: conversationId,
      userId,
      conversationId,
      senderRole: String(readerRole || "").trim(),
    }),
    adminConversation: sanitizeStoreSupportConversationForAdmin(
      safeConversation,
    ),
    userConversation: sanitizeStoreSupportConversationForUser(safeConversation),
  };
  const events = [
    {
      topic: buildAdminRealtimeTopic(),
      event: "support.thread.read",
      payload,
    },
    {
      topic: buildStoreSupportRealtimeTopic(conversationId),
      event: "support.thread.read",
      payload,
    },
  ];
  if (userId) {
    events.push({
      topic: buildStoreUserRealtimeTopic(userId),
      event: "support.thread.read",
      payload,
    });
  }
  await safeEmitRealtimeEvents(events);
};

const buildStoreVoucherWritePayload = (body = {}, existingVoucher = null) => {
  const code = normalizeStoreVoucherCode(body?.code || existingVoucher?.code);
  const type = normalizeStoreVoucherType(body?.type || existingVoucher?.type);
  const value = Number(body?.value ?? existingVoucher?.value ?? 0);
  const description = String(
    body?.description ?? existingVoucher?.description ?? "",
  ).trim();
  const isActive =
    body?.isActive === undefined
      ? !!existingVoucher?.isActive
      : !!body?.isActive;
  const maxUses = Math.max(
    0,
    Math.floor(Number(body?.maxUses ?? existingVoucher?.maxUses ?? 0) || 0),
  );
  const perUserLimit = Math.max(
    0,
    Math.floor(
      Number(body?.perUserLimit ?? existingVoucher?.perUserLimit ?? 0) || 0,
    ),
  );
  const minOrderAmount = Math.max(
    0,
    Math.round(
      Number(body?.minOrderAmount ?? existingVoucher?.minOrderAmount ?? 0) || 0,
    ),
  );
  const startsAtRaw = String(
    body?.startsAt ?? existingVoucher?.startsAt ?? "",
  ).trim();
  const endsAtRaw = String(body?.endsAt ?? existingVoucher?.endsAt ?? "").trim();
  const startsAt =
    startsAtRaw && parseStoreDateMs(startsAtRaw)
      ? new Date(startsAtRaw).toISOString()
      : "";
  const endsAt =
    endsAtRaw && parseStoreDateMs(endsAtRaw)
      ? new Date(endsAtRaw).toISOString()
      : "";

  if (!code) {
    const error = new Error("Ma voucher khong duoc de trong.");
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(value) || value <= 0) {
    const error = new Error("Gia tri voucher phai lon hon 0.");
    error.statusCode = 400;
    throw error;
  }
  if (type === "percent" && value > 99) {
    const error = new Error("Voucher phan tram nen nho hon 100%.");
    error.statusCode = 400;
    throw error;
  }
  if (type === "fixed" && value < 1000) {
    const error = new Error("Voucher so tien toi thieu la 1.000đ.");
    error.statusCode = 400;
    throw error;
  }
  if (startsAt && endsAt && parseStoreDateMs(startsAt) > parseStoreDateMs(endsAt)) {
    const error = new Error("Thoi gian bat dau khong duoc lon hon thoi gian ket thuc.");
    error.statusCode = 400;
    throw error;
  }

  return {
    code,
    type,
    value: type === "fixed" ? Math.round(value) : Math.round(value * 100) / 100,
    description,
    isActive,
    maxUses,
    perUserLimit,
    minOrderAmount,
    startsAt,
    endsAt,
    updatedAt: new Date().toISOString(),
  };
};
const buildStorePackage1UsageLeft = (order = {}) =>
  Math.max(
    0,
    Number(order?.package1MaxUsage || STORE_PACKAGE1_MAX_OTP_USES) -
      Number(order?.package1UsedCount || 0),
  );
const normalizeStorePaymentMethod = (
  value,
  fallback = STORE_PAYMENT_METHOD_MOMO,
) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (VALID_STORE_PAYMENT_METHODS.includes(normalized)) return normalized;
  return fallback;
};
const getStorePaymentMethodLabel = (value) => {
  const normalized = normalizeStorePaymentMethod(value);
  if (normalized === STORE_PAYMENT_METHOD_PAYOS) return "Chuyển khoản payOS";
  return "MoMo";
};
const getStorePaymentUrl = (order = {}) => {
  const paymentMethod = normalizeStorePaymentMethod(order?.paymentMethod);
  if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
    return String(order?.payosCheckoutUrl || "").trim();
  }
  return String(order?.momoPayUrl || "").trim();
};
const getStorePaymentOrderId = (order = {}) => {
  const paymentMethod = normalizeStorePaymentMethod(order?.paymentMethod);
  if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
    return (
      String(order?.payosPaymentLinkId || "").trim() ||
      (Number.isFinite(Number(order?.payosOrderCode))
        ? String(Number(order?.payosOrderCode))
        : "")
    );
  }
  return String(order?.momoOrderId || "").trim();
};
const getStorePaymentStatusText = (order = {}) => {
  const paymentMethod = normalizeStorePaymentMethod(order?.paymentMethod);
  if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
    const normalizedStatus = String(order?.payosStatus || "")
      .trim()
      .toUpperCase();
    if (normalizedStatus === "PAID" || normalizedStatus === "SUCCEEDED") {
      return "Đã thanh toán";
    }
    if (normalizedStatus === "PENDING") {
      return "Chờ thanh toán";
    }
    if (normalizedStatus === "CANCELLED") {
      return "Đã hủy thanh toán";
    }
    if (normalizedStatus === "EXPIRED") {
      return "Hết hạn thanh toán";
    }
    if (normalizedStatus === "FAILED") {
      return "Thanh toán thất bại";
    }
    const desc = String(order?.payosDesc || "").trim();
    if (desc && desc.toLowerCase() !== "success") return desc;
    return String(order?.momoMessage || "").trim();
  }
  return String(order?.momoMessage || "").trim();
};
const getStorePayosAuthHeaders = () => {
  const headers = {
    "x-client-id": PAYOS_CLIENT_ID,
    "x-api-key": PAYOS_API_KEY,
  };
  if (PAYOS_PARTNER_CODE) {
    headers["x-partner-code"] = PAYOS_PARTNER_CODE;
  }
  return headers;
};
const buildPayosCreateSignature = ({
  amount,
  cancelUrl,
  description,
  orderCode,
  returnUrl,
} = {}) => {
  const raw = [
    `amount=${Math.round(Number(amount || 0))}`,
    `cancelUrl=${String(cancelUrl || "").trim()}`,
    `description=${String(description || "").trim()}`,
    `orderCode=${Math.round(Number(orderCode || 0))}`,
    `returnUrl=${String(returnUrl || "").trim()}`,
  ].join("&");
  return crypto
    .createHmac("sha256", PAYOS_CHECKSUM_KEY)
    .update(raw)
    .digest("hex");
};
const buildStorePaymentReturnUrl = (req, order = {}) =>
  `${getAppBaseUrl(req)}/store?view=payment-result&orderId=${encodeURIComponent(
    String(order?.id || "").trim(),
  )}`;
const buildStorePaymentCancelUrl = (req, order = {}) =>
  buildStorePaymentReturnUrl(req, order);
const buildStorePayosDescription = (order = {}) => {
  const tail = String(order?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  return `WD${tail || String(Date.now()).slice(-6)}`;
};
const clearStoreMomoPaymentFields = () => ({
  momoOrderId: "",
  momoRequestId: "",
  momoTransId: "",
  momoResultCode: null,
  momoMessage: "",
  momoPayUrl: "",
  momoDeepLink: "",
  momoQrCodeUrl: "",
});
const clearStorePayosPaymentFields = () => ({
  payosOrderCode: null,
  payosPaymentLinkId: "",
  payosCheckoutUrl: "",
  payosQrCode: "",
  payosStatus: "",
  payosCode: "",
  payosDesc: "",
});
const parseFiniteStoreAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};
const isStorePayosSuccess = (data = {}) => {
  const normalizedStatus = String(data?.status || "")
    .trim()
    .toUpperCase();
  if (normalizedStatus === "PAID" || normalizedStatus === "SUCCEEDED") {
    return true;
  }

  const totalAmount = parseFiniteStoreAmount(data?.amount);
  const paidAmount = parseFiniteStoreAmount(data?.amountPaid);
  const remainingAmount = parseFiniteStoreAmount(data?.amountRemaining);

  if (
    Number.isFinite(totalAmount) &&
    totalAmount > 0 &&
    Number.isFinite(paidAmount) &&
    paidAmount >= Math.round(totalAmount)
  ) {
    return true;
  }

  if (
    Number.isFinite(totalAmount) &&
    totalAmount > 0 &&
    Number.isFinite(paidAmount) &&
    paidAmount > 0 &&
    Number.isFinite(remainingAmount) &&
    remainingAmount === 0
  ) {
    return true;
  }

  return false;
};
const isStorePayosFinalFailure = (data = {}) => {
  const normalizedStatus = String(data?.status || "")
    .trim()
    .toUpperCase();
  return ["CANCELLED", "EXPIRED", "FAILED"].includes(normalizedStatus);
};
const resolveStoreOrderOtpSecret = async (order = {}) => {
  const packageCode = String(order?.packageCode || "").trim().toLowerCase();
  const assignedAccountId = String(
    order?.assignedAccountId || order?.rootAssignedAccountId || "",
  ).trim();
  let otpSecret =
    packageCode === "package2"
      ? String(order?.assignedOtpSecret || "").trim()
      : "";
  if (!otpSecret && assignedAccountId) {
    const account = await Account.findOne({ id: assignedAccountId })
      .select("otpSecret")
      .lean();
    otpSecret = String(account?.otpSecret || "").trim();
  }
  return otpSecret;
};
const STORE_PENDING_PAYMENT_STATUSES = ["pending_payment", "awaiting_payment"];
const STORE_ACTIVE_RESERVATION_STATUSES = [
  ...STORE_PENDING_PAYMENT_STATUSES,
  "paid",
];
const STORE_HIDDEN_ORDER_STATUSES = new Set(["payment_failed", "payment_expired"]);
const STORE_IMMEDIATE_DELETE_ORDER_STATUSES = [
  "payment_failed",
  "payment_expired",
];
const STORE_PRUNABLE_ORDER_STATUSES = ["fulfillment_failed"];
const STORE_FAILED_ORDER_RETENTION_MS = 24 * 60 * 60 * 1000;
const STORE_WARRANTY_HOLD_NOTE_PREFIX = "[StoreWarrantyHold";
const STORE_WARRANTY_HOLD_NOTE_REGEX = /\[StoreWarrantyHold\b/i;
const EXPIRY_CLEANUP_SNAPSHOT_ID = "default";
const EXPIRY_CLEANUP_PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRY_CLEANUP_REJECT_SUPPRESS_MS = 24 * 60 * 60 * 1000;
const EXPIRY_CLEANUP_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const EXPIRY_CLEANUP_TELEGRAM_PREVIEW_LIMIT = 12;
const EXPIRY_CLEANUP_BATCH_PREVIEW_LIMIT = 100;
const normalizeStoreOrderStatusValue = (value = "") =>
  String(value || "").trim().toLowerCase();
const normalizeStoreFulfillmentStateValue = (value = "") =>
  String(value || "").trim().toLowerCase();
const isStoreOrderFulfillmentInProgress = (order = {}) =>
  normalizeStoreFulfillmentStateValue(order?.fulfillmentState) === "fulfilling";
const isStoreOrderReadyForFulfillment = (order = {}) =>
  normalizeStoreOrderStatusValue(order?.status) === "paid" &&
  !["fulfilled", "fulfilling"].includes(
    normalizeStoreFulfillmentStateValue(order?.fulfillmentState),
  );
const isStoreFailedLikeStatus = (status = "") => {
  const normalized = normalizeStoreOrderStatusValue(status);
  return (
    STORE_IMMEDIATE_DELETE_ORDER_STATUSES.includes(normalized) ||
    STORE_PRUNABLE_ORDER_STATUSES.includes(normalized)
  );
};
const getStorePaymentExpiresAtIso = (baseDate = new Date()) =>
  new Date(baseDate.getTime() + STORE_PAYMENT_HOLD_MS).toISOString();
const getStorePendingCutoffIso = (baseDate = new Date()) =>
  new Date(baseDate.getTime() - STORE_PAYMENT_HOLD_MS).toISOString();
const getStoreFailedOrderCleanupCutoffIso = (baseDate = new Date()) =>
  new Date(baseDate.getTime() - STORE_FAILED_ORDER_RETENTION_MS).toISOString();
const hasStoreWarrantyHoldNote = (note = "") =>
  STORE_WARRANTY_HOLD_NOTE_REGEX.test(String(note || "").trim());
const appendStoreWarrantyHoldNote = (
  note = "",
  orderId = "",
  createdAt = new Date().toISOString(),
) => {
  const currentNote = String(note || "").trim();
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) return currentNote;
  if (
    currentNote.includes(STORE_WARRANTY_HOLD_NOTE_PREFIX) &&
    currentNote.includes(`order=${normalizedOrderId}`)
  ) {
    return currentNote;
  }
  const marker = `${STORE_WARRANTY_HOLD_NOTE_PREFIX} order=${normalizedOrderId} at=${String(
    createdAt || new Date().toISOString(),
  ).trim()}]`;
  return currentNote ? `${currentNote}\n${marker}` : marker;
};
const removeStoreWarrantyHoldNote = (note = "", orderId = "") => {
  const currentNote = String(note || "").trim();
  if (!currentNote) return "";
  const normalizedOrderId = String(orderId || "").trim();
  return currentNote
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (!STORE_WARRANTY_HOLD_NOTE_REGEX.test(line)) return true;
      if (!normalizedOrderId) return false;
      return !line.includes(`order=${normalizedOrderId}`);
    })
    .join("\n")
    .trim();
};
const extractStoreWarrantyHoldOrderIds = (note = "") =>
  String(note || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter((line) => STORE_WARRANTY_HOLD_NOTE_REGEX.test(line))
    .map((line) => {
      const match = line.match(/\border=([^\]\s]+)/i);
      return String(match?.[1] || "").trim();
    })
    .filter(Boolean);
const parseStoreDateMs = (value) => {
  const ts = new Date(String(value || "").trim()).getTime();
  return Number.isFinite(ts) ? ts : 0;
};
const isStorePendingPaymentStatus = (status = "") =>
  STORE_PENDING_PAYMENT_STATUSES.includes(
    String(status || "").trim().toLowerCase(),
  );
const getStorePendingStatusFromExistingPayment = (order = {}) => {
  const paymentMethod = normalizeStorePaymentMethod(order?.paymentMethod);
  if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
    return (
      String(order?.payosCheckoutUrl || "").trim() ||
      String(order?.payosPaymentLinkId || "").trim() ||
      (Number.isFinite(Number(order?.payosOrderCode)) &&
        Number(order?.payosOrderCode) > 0)
    )
      ? "awaiting_payment"
      : "pending_payment";
  }
  return (
    String(order?.momoPayUrl || "").trim() ||
    String(order?.momoOrderId || "").trim()
  )
    ? "awaiting_payment"
    : "pending_payment";
};
const isStoreOrderHoldActive = (order = {}, nowMs = Date.now()) => {
  if (!isStorePendingPaymentStatus(order?.status)) return false;
  const expiresAtMs = parseStoreDateMs(order?.expiresAt);
  if (expiresAtMs > 0) {
    return expiresAtMs > nowMs;
  }
  const createdAtMs = parseStoreDateMs(order?.createdAt);
  return createdAtMs > 0 && createdAtMs > nowMs - STORE_PAYMENT_HOLD_MS;
};
const buildStoreExpiredPendingOrderQuery = (extra = {}) => {
  const nowIso = new Date().toISOString();
  const cutoffIso = getStorePendingCutoffIso();
  return {
    ...extra,
    status: { $in: STORE_PENDING_PAYMENT_STATUSES },
    $or: [
      { expiresAt: { $lte: nowIso, $ne: "" } },
      {
        $and: [
          {
            $or: [
              { expiresAt: "" },
              { expiresAt: null },
              { expiresAt: { $exists: false } },
            ],
          },
          { createdAt: { $lte: cutoffIso } },
        ],
      },
    ],
  };
};
const buildStoreActivePendingOrderQuery = (extra = {}) => {
  const nowIso = new Date().toISOString();
  const cutoffIso = getStorePendingCutoffIso();
  return {
    ...extra,
    $or: [
      { status: "paid" },
      {
        status: { $in: STORE_PENDING_PAYMENT_STATUSES },
        $or: [
          { expiresAt: { $gt: nowIso } },
          {
            $and: [
              {
                $or: [
                  { expiresAt: "" },
                  { expiresAt: null },
                  { expiresAt: { $exists: false } },
                ],
              },
              { createdAt: { $gt: cutoffIso } },
            ],
          },
        ],
      },
    ],
  };
};
const expireStaleStoreOrders = async (extra = {}) => {
  await StoreOrder.deleteMany(buildStoreExpiredPendingOrderQuery(extra));
  return;
  const nowIso = new Date().toISOString();
  await StoreOrder.updateMany(buildStoreExpiredPendingOrderQuery(extra), {
    $set: {
      status: "payment_expired",
      momoMessage: `Đã hết hạn thanh toán sau ${STORE_PAYMENT_HOLD_MINUTES} phút`,
      momoPayUrl: "",
      updatedAt: nowIso,
    },
  });
};
const cleanupOldStoreFailedOrders = async (extra = {}) => {
  await StoreOrder.deleteMany({
    ...extra,
    status: { $in: STORE_IMMEDIATE_DELETE_ORDER_STATUSES },
  });
  return;
  const cutoffIso = getStoreFailedOrderCleanupCutoffIso();
  await StoreOrder.deleteMany({
    ...extra,
    status: { $in: STORE_PRUNABLE_ORDER_STATUSES },
    $or: [
      { updatedAt: { $lte: cutoffIso, $ne: "" } },
      {
        $and: [
          {
            $or: [
              { updatedAt: "" },
              { updatedAt: null },
              { updatedAt: { $exists: false } },
            ],
          },
          { createdAt: { $lte: cutoffIso } },
        ],
      },
    ],
  });
};
const buildStoreVoucherUsageQuery = ({
  voucherId = "",
  voucherCode = "",
  userId = "",
  excludeOrderId = "",
} = {}) => {
  const conditions = [];
  const normalizedVoucherId = String(voucherId || "").trim();
  const normalizedVoucherCode = normalizeStoreVoucherCode(voucherCode);
  if (normalizedVoucherId) conditions.push({ voucherId: normalizedVoucherId });
  if (normalizedVoucherCode) conditions.push({ voucherCode: normalizedVoucherCode });
  if (conditions.length === 0) {
    return { id: "__no_store_voucher__" };
  }
  return {
    ...(conditions.length === 1 ? conditions[0] : { $or: conditions }),
    ...(userId ? { userId: String(userId || "").trim() } : {}),
    ...(excludeOrderId ? { id: { $ne: String(excludeOrderId || "").trim() } } : {}),
    status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
  };
};
const buildStoreVoucherStatsMap = async (
  vouchers = [],
  preloadedUsers = [],
) => {
  const safeVouchers = Array.isArray(vouchers) ? vouchers : [];
  if (safeVouchers.length === 0) return new Map();

  const voucherIds = safeVouchers
    .map((voucher) => String(voucher?.id || "").trim())
    .filter(Boolean);
  const voucherCodes = safeVouchers
    .map((voucher) => normalizeStoreVoucherCode(voucher?.code))
    .filter(Boolean);
  const orders = await StoreOrder.find({
    status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
    $or: [
      voucherIds.length > 0 ? { voucherId: { $in: voucherIds } } : null,
      voucherCodes.length > 0 ? { voucherCode: { $in: voucherCodes } } : null,
    ].filter(Boolean),
  })
    .sort({ createdAt: -1, id: -1 })
    .lean();

  const userIds = Array.from(
    new Set(
      (orders || [])
        .map((order) => String(order?.userId || "").trim())
        .filter(Boolean),
    ),
  );
  const knownUsers = Array.isArray(preloadedUsers) ? preloadedUsers : [];
  const missingUserIds = userIds.filter(
    (userId) =>
      !knownUsers.some((user) => String(user?.id || "").trim() === userId),
  );
  const fetchedUsers =
    missingUserIds.length > 0
      ? await StoreUser.find({ id: { $in: missingUserIds } })
          .select("id fullName email phone")
          .lean()
      : [];
  const userMap = new Map(
    [...knownUsers, ...(fetchedUsers || [])].map((user) => [
      String(user?.id || "").trim(),
      user,
    ]),
  );

  const statsMap = new Map();
  safeVouchers.forEach((voucher) => {
    statsMap.set(String(voucher?.id || "").trim(), {
      totalUses: 0,
      activeUses: 0,
      fulfilledUses: 0,
      userCount: 0,
      users: [],
      recentOrders: [],
      _usersMap: new Map(),
    });
  });

  (orders || []).forEach((order) => {
    const matchedVoucher = safeVouchers.find((voucher) => {
      const voucherId = String(voucher?.id || "").trim();
      const voucherCode = normalizeStoreVoucherCode(voucher?.code);
      return (
        (!!voucherId && voucherId === String(order?.voucherId || "").trim()) ||
        (!!voucherCode &&
          voucherCode === normalizeStoreVoucherCode(order?.voucherCode))
      );
    });
    if (!matchedVoucher) return;

    const voucherKey = String(matchedVoucher?.id || "").trim();
    const stats = statsMap.get(voucherKey);
    if (!stats) return;

    const normalizedStatus = normalizeStoreOrderStatusValue(order?.status);
    const userId = String(order?.userId || "").trim();
    const user = userMap.get(userId) || null;

    stats.totalUses += 1;
    if (["pending_payment", "awaiting_payment", "paid", "fulfilled"].includes(normalizedStatus)) {
      stats.activeUses += 1;
    }
    if (normalizedStatus === "fulfilled") {
      stats.fulfilledUses += 1;
    }
    if (stats.recentOrders.length < 10) {
      stats.recentOrders.push(sanitizeStoreVoucherUsageOrder(order, user));
    }

    if (userId) {
      if (!stats._usersMap.has(userId)) {
        stats._usersMap.set(userId, {
          userId,
          fullName: String(user?.fullName || "").trim(),
          email: String(user?.email || "").trim(),
          phone: String(user?.phone || "").trim(),
          totalUses: 0,
          latestOrderAt: "",
          totalDiscountAmount: 0,
        });
      }
      const userStats = stats._usersMap.get(userId);
      userStats.totalUses += 1;
      userStats.totalDiscountAmount += Number(order?.discountAmount || 0);
      const createdAt = String(order?.createdAt || "").trim();
      if (
        createdAt &&
        (!userStats.latestOrderAt ||
          parseStoreDateMs(createdAt) > parseStoreDateMs(userStats.latestOrderAt))
      ) {
        userStats.latestOrderAt = createdAt;
      }
    }
  });

  statsMap.forEach((stats) => {
    stats.users = [...stats._usersMap.values()]
      .sort(
        (left, right) =>
          parseStoreDateMs(right?.latestOrderAt) -
          parseStoreDateMs(left?.latestOrderAt),
      )
      .slice(0, 15);
    stats.userCount = stats._usersMap.size;
    delete stats._usersMap;
  });
  return statsMap;
};
const resolveStoreVoucherPricing = async ({
  voucherCode = "",
  packageCode = "",
  userId = "",
  excludeOrderId = "",
} = {}) => {
  const normalizedPackageCode = String(packageCode || "").trim().toLowerCase();
  const packageMap = await getStorePackageMap();
  const packageConfig = packageMap[normalizedPackageCode];
  if (!packageConfig) {
    const error = new Error("Goi khong hop le de ap voucher.");
    error.statusCode = 400;
    throw error;
  }

  const originalAmount = Math.max(0, Number(packageConfig.price || 0));
  const normalizedVoucherCode = normalizeStoreVoucherCode(voucherCode);
  if (!normalizedVoucherCode) {
    return {
      voucher: null,
      originalAmount,
      discountAmount: 0,
      finalAmount: originalAmount,
    };
  }

  const voucher = await StoreVoucher.findOne({ code: normalizedVoucherCode }).lean();
  if (!voucher) {
    const error = new Error("Voucher khong ton tai.");
    error.statusCode = 404;
    throw error;
  }
  if (!voucher.isActive) {
    const error = new Error("Voucher da bi tat.");
    error.statusCode = 400;
    throw error;
  }
  if (!isStoreVoucherDateActive(voucher)) {
    const error = new Error("Voucher dang ngoai thoi gian su dung.");
    error.statusCode = 400;
    throw error;
  }

  const minOrderAmount = Math.max(0, Number(voucher?.minOrderAmount || 0));
  if (minOrderAmount > 0 && originalAmount < minOrderAmount) {
    const error = new Error(
      `Voucher chi ap dung cho don tu ${minOrderAmount.toLocaleString("vi-VN")}đ.`,
    );
    error.statusCode = 400;
    throw error;
  }

  const usageQuery = buildStoreVoucherUsageQuery({
    voucherId: voucher?.id,
    voucherCode: voucher?.code,
    excludeOrderId,
  });
  const userUsageQuery = buildStoreVoucherUsageQuery({
    voucherId: voucher?.id,
    voucherCode: voucher?.code,
    userId,
    excludeOrderId,
  });
  const [totalUses, userUses] = await Promise.all([
    StoreOrder.countDocuments(usageQuery),
    userId ? StoreOrder.countDocuments(userUsageQuery) : 0,
  ]);

  const maxUses = Math.max(0, Number(voucher?.maxUses || 0));
  if (maxUses > 0 && totalUses >= maxUses) {
    const error = new Error("Voucher da het luot su dung.");
    error.statusCode = 400;
    throw error;
  }
  const perUserLimit = Math.max(0, Number(voucher?.perUserLimit || 0));
  if (userId && perUserLimit > 0 && userUses >= perUserLimit) {
    const error = new Error("Tai khoan cua ban da dung het luot voucher nay.");
    error.statusCode = 400;
    throw error;
  }

  const voucherType = normalizeStoreVoucherType(voucher?.type);
  const voucherValue = Math.max(0, Number(voucher?.value || 0));
  if (voucherValue <= 0) {
    const error = new Error("Voucher chua co gia tri giam hop le.");
    error.statusCode = 400;
    throw error;
  }

  const rawDiscount =
    voucherType === "fixed"
      ? voucherValue
      : Math.round((originalAmount * voucherValue) / 100);
  const discountAmount = Math.min(originalAmount, Math.max(0, rawDiscount));
  const finalAmount = Math.max(0, originalAmount - discountAmount);
  if (discountAmount <= 0) {
    const error = new Error("Voucher nay khong giam duoc gia tri don hang.");
    error.statusCode = 400;
    throw error;
  }
  if (finalAmount <= 0) {
    const error = new Error(
      "Voucher dang giam ve 0đ. Hay giam gia tri voucher hoac tao don thu cong.",
    );
    error.statusCode = 400;
    throw error;
  }

  return {
    voucher,
    originalAmount,
    discountAmount,
    finalAmount,
    totalUses,
    userUses,
  };
};
const getOrCreateStoreSupportConversation = async (storeUserInput = null) => {
  const storeUser =
    storeUserInput && typeof storeUserInput.toObject === "function"
      ? storeUserInput.toObject()
      : { ...(storeUserInput || {}) };
  const userId = String(storeUser?.id || "").trim();
  if (!userId) {
    const error = new Error("Khong tim thay user chat.");
    error.statusCode = 400;
    throw error;
  }
  let conversation = await StoreSupportConversation.findOne({ userId });
  if (!conversation) {
    conversation = await StoreSupportConversation.create({
      id: createStoreId("support"),
      userId,
      userName: String(storeUser?.fullName || "").trim(),
      userEmail: String(storeUser?.email || "").trim(),
      userPhone: String(storeUser?.phone || "").trim(),
      status: "open",
    });
    return conversation;
  }

  const nextUserName = String(storeUser?.fullName || "").trim();
  const nextUserEmail = String(storeUser?.email || "").trim();
  const nextUserPhone = String(storeUser?.phone || "").trim();
  let didChange = false;
  if (conversation.userName !== nextUserName) {
    conversation.userName = nextUserName;
    didChange = true;
  }
  if (conversation.userEmail !== nextUserEmail) {
    conversation.userEmail = nextUserEmail;
    didChange = true;
  }
  if (conversation.userPhone !== nextUserPhone) {
    conversation.userPhone = nextUserPhone;
    didChange = true;
  }
  if (didChange) {
    conversation.updatedAt = new Date().toISOString();
    await conversation.save();
  }
  return conversation;
};
const listStoreSupportMessages = async (
  conversationId = "",
  { limit = STORE_SUPPORT_THREAD_PAGE_SIZE, before = "", cursor = "" } = {},
) => {
  const normalizedConversationId = String(conversationId || "").trim();
  if (!normalizedConversationId) {
    return {
      messages: [],
      hasMore: false,
      nextCursor: "",
      retainedAfter: getStoreSupportRetentionCutoffIso(),
    };
  }
  const safeLimit = Math.max(1, Math.min(100, Number(limit || STORE_SUPPORT_THREAD_PAGE_SIZE)));
  const normalizedCursor = parseStoreSupportCursor(cursor || before);
  const retentionCutoffIso = getStoreSupportRetentionCutoffIso();
  const query = {
    conversationId: normalizedConversationId,
    createdAt: { $gte: retentionCutoffIso },
  };
  if (normalizedCursor) {
    query.$or = [
      { createdAt: { $lt: normalizedCursor.createdAt } },
      {
        createdAt: normalizedCursor.createdAt,
        id: { $lt: normalizedCursor.id },
      },
    ];
  }
  const rawMessages = await StoreSupportMessage.find(query)
    .sort({ createdAt: -1, id: -1 })
    .limit(safeLimit + 1)
    .lean();
  const hasMore = rawMessages.length > safeLimit;
  const slicedMessages = hasMore ? rawMessages.slice(0, safeLimit) : rawMessages;
  const nextCursor = hasMore
    ? buildStoreSupportCursor(
        slicedMessages.length > 0
          ? slicedMessages[slicedMessages.length - 1]
          : null,
      )
    : "";
  return {
    messages: slicedMessages.reverse(),
    hasMore,
    nextCursor,
    retainedAfter: retentionCutoffIso,
  };
};
const cleanupOldStoreSupportMessages = async () => {
  const cutoffIso = getStoreSupportRetentionCutoffIso();
  const affectedConversationIds = await StoreSupportMessage.distinct("conversationId", {
    createdAt: { $lt: cutoffIso },
  });
  if (!Array.isArray(affectedConversationIds) || affectedConversationIds.length === 0) {
    return 0;
  }

  const deleteResult = await StoreSupportMessage.deleteMany({
    createdAt: { $lt: cutoffIso },
  });
  const nowIso = new Date().toISOString();

  await Promise.all(
    affectedConversationIds
      .map((conversationId) => String(conversationId || "").trim())
      .filter(Boolean)
      .map(async (conversationId) => {
        const [latestMessage, adminUnreadCount, userUnreadCount] = await Promise.all([
          StoreSupportMessage.findOne({ conversationId })
            .sort({ createdAt: -1, id: -1 })
            .lean(),
          StoreSupportMessage.countDocuments({
            conversationId,
            senderRole: "user",
            $or: [{ readAt: "" }, { readAt: null }, { readAt: { $exists: false } }],
          }),
          StoreSupportMessage.countDocuments({
            conversationId,
            senderRole: "admin",
            $or: [{ readAt: "" }, { readAt: null }, { readAt: { $exists: false } }],
          }),
        ]);

        await StoreSupportConversation.findOneAndUpdate(
          { id: conversationId },
          {
            $set: {
              lastMessageAt: String(latestMessage?.createdAt || "").trim(),
              lastMessagePreview: String(latestMessage?.body || "").trim().slice(0, 160),
              lastSenderRole: String(latestMessage?.senderRole || "").trim(),
              adminUnreadCount: Math.max(0, Number(adminUnreadCount || 0)),
              userUnreadCount: Math.max(0, Number(userUnreadCount || 0)),
              updatedAt: nowIso,
            },
          },
        );
      }),
  );

  return Number(deleteResult?.deletedCount || 0);
};
const markStoreSupportConversationRead = async ({
  conversationId = "",
  readerRole = "",
} = {}) => {
  const normalizedConversationId = String(conversationId || "").trim();
  const normalizedReaderRole = String(readerRole || "").trim().toLowerCase();
  if (!normalizedConversationId || !["user", "admin"].includes(normalizedReaderRole)) {
    return;
  }
  const targetSenderRole = normalizedReaderRole === "user" ? "admin" : "user";
  const nowIso = new Date().toISOString();
  await StoreSupportMessage.updateMany(
    {
      conversationId: normalizedConversationId,
      senderRole: targetSenderRole,
      $or: [{ readAt: "" }, { readAt: null }, { readAt: { $exists: false } }],
    },
    {
      $set: {
        readAt: nowIso,
      },
    },
  );
  await StoreSupportConversation.findOneAndUpdate(
    { id: normalizedConversationId },
    {
      $set: {
        ...(normalizedReaderRole === "user"
          ? { userUnreadCount: 0, lastUserReadAt: nowIso }
          : { adminUnreadCount: 0, lastAdminReadAt: nowIso }),
        updatedAt: nowIso,
      },
    },
  );
};
const appendStoreSupportMessage = async ({
  conversationId = "",
  senderRole = "",
  senderId = "",
  body = "",
} = {}) => {
  const normalizedConversationId = String(conversationId || "").trim();
  const normalizedSenderRole = String(senderRole || "").trim().toLowerCase();
  const messageBody = String(body || "").trim();
  if (!normalizedConversationId || !["user", "admin"].includes(normalizedSenderRole)) {
    const error = new Error("Du lieu tin nhan khong hop le.");
    error.statusCode = 400;
    throw error;
  }
  if (!messageBody) {
    const error = new Error("Tin nhan khong duoc de trong.");
    error.statusCode = 400;
    throw error;
  }
  if (messageBody.length > 2000) {
    const error = new Error("Tin nhan qua dai, vui long rut gon duoi 2000 ky tu.");
    error.statusCode = 400;
    throw error;
  }

  const nowIso = new Date().toISOString();
  const message = await StoreSupportMessage.create({
    id: createStoreId("support_msg"),
    conversationId: normalizedConversationId,
    senderRole: normalizedSenderRole,
    senderId: String(senderId || "").trim(),
    body: messageBody,
    createdAt: nowIso,
    readAt: normalizedSenderRole === "admin" ? "" : "",
  });
  await StoreSupportConversation.findOneAndUpdate(
    { id: normalizedConversationId },
    {
      $set: {
        lastMessageAt: nowIso,
        lastMessagePreview: messageBody.slice(0, 160),
        lastSenderRole: normalizedSenderRole,
        status: "open",
        ...(normalizedSenderRole === "user"
          ? { lastUserMessageAt: nowIso }
          : {}),
        updatedAt: nowIso,
      },
      $inc:
        normalizedSenderRole === "user"
          ? { adminUnreadCount: 1 }
          : { userUnreadCount: 1 },
    },
  );
  if (normalizedSenderRole === "admin") {
    await StoreSupportConversation.findOneAndUpdate(
      { id: normalizedConversationId },
      { $set: { adminUnreadCount: 0 } },
    );
  }
  return message;
};
const loadVisibleStoreOrdersForUser = async (userId) => {
  await expireStaleStoreOrders({ userId });
  await cleanupOldStoreFailedOrders({ userId });
  let orders = await StoreOrder.find({
    userId,
    status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
  })
    .sort({ createdAt: -1 })
    .lean();
  const failedAutoOrders = (orders || []).filter((order) =>
    canRetryStoreFailedFulfillment(order),
  );
  if (failedAutoOrders.length > 0) {
    await Promise.all(
      failedAutoOrders.map((order) =>
        retryFailedStoreOrderFulfillment(order, { emitRealtime: true }),
      ),
    );
    orders = await StoreOrder.find({
      userId,
      status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
    })
      .sort({ createdAt: -1 })
      .lean();
  }
  const assignedAccountIds = Array.from(
    new Set(
      (orders || [])
        .map((order) => String(order?.assignedAccountId || "").trim())
        .filter(Boolean),
    ),
  );
  if (assignedAccountIds.length === 0) {
    return orders;
  }
  const accounts = await Account.find({ id: { $in: assignedAccountIds } })
    .select("id username password otpSecret link")
    .lean();
  const accountMap = new Map(
    (accounts || []).map((acc) => [String(acc?.id || "").trim(), acc]),
  );
  const hydratedOrders = (orders || []).map((order) => {
    const linkedAcc = accountMap.get(String(order?.assignedAccountId || "").trim());
    if (!linkedAcc) return order;
    return {
      ...order,
      assignedUsername: String(order?.assignedUsername || linkedAcc?.username || "").trim(),
      assignedPassword: String(order?.assignedPassword || linkedAcc?.password || "").trim(),
      assignedOtpSecret: String(order?.assignedOtpSecret || linkedAcc?.otpSecret || "").trim(),
      assignedLink: String(order?.assignedLink || linkedAcc?.link || "").trim(),
    };
  });
  return attachStoreOrdersOperationalState(hydratedOrders);
};

const parsePositivePage = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const parsePositiveLimit = (value, fallback = 50, max = 200) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const buildStoreUserStatsMapForIds = async (userIds = []) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return new Map();
  const stats = await StoreOrder.aggregate([
    {
      $match: {
        userId: { $in: normalizedIds },
      },
    },
    {
      $group: {
        _id: "$userId",
        totalOrders: { $sum: 1 },
        fulfilledOrders: {
          $sum: {
            $cond: [{ $eq: ["$status", "fulfilled"] }, 1, 0],
          },
        },
        pendingOrders: {
          $sum: {
            $cond: [
              {
                $in: ["$status", ["pending_payment", "awaiting_payment", "paid"]],
              },
              1,
              0,
            ],
          },
        },
        latestOrderAt: { $max: "$createdAt" },
      },
    },
  ]);
  return new Map(
    (Array.isArray(stats) ? stats : []).map((item) => [
      String(item?._id || "").trim(),
      {
        totalOrders: Number(item?.totalOrders || 0),
        fulfilledOrders: Number(item?.fulfilledOrders || 0),
        pendingOrders: Number(item?.pendingOrders || 0),
        latestOrderAt: String(item?.latestOrderAt || "").trim(),
      },
    ]),
  );
};

const listAdminStoreOrders = async ({ page = 1, limit = 100 } = {}) => {
  const safePage = parsePositivePage(page, 1);
  const safeLimit = parsePositiveLimit(limit, 100, 200);
  const skip = (safePage - 1) * safeLimit;
  const filter = {
    status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
  };
  const [total, initialOrders] = await Promise.all([
    StoreOrder.countDocuments(filter),
    StoreOrder.find(filter)
      .sort({ createdAt: -1, id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);
  let rawOrders = initialOrders;
  const failedAutoOrders = (rawOrders || []).filter((order) =>
    canRetryStoreFailedFulfillment(order),
  );
  if (failedAutoOrders.length > 0) {
    await Promise.all(
      failedAutoOrders.map((order) =>
        retryFailedStoreOrderFulfillment(order, { emitRealtime: true }),
      ),
    );
    rawOrders = await StoreOrder.find(filter)
      .sort({ createdAt: -1, id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean();
  }
  const userIds = Array.from(
    new Set(
      (rawOrders || [])
        .map((order) => String(order?.userId || "").trim())
        .filter(Boolean),
    ),
  );
  const users = userIds.length
    ? await StoreUser.find({ id: { $in: userIds } })
        .select("id fullName email phone createdAt updatedAt")
        .lean()
    : [];
  const userMap = new Map(
    (users || []).map((user) => [String(user?.id || "").trim(), user]),
  );
  const operationalOrders = await attachStoreOrdersOperationalState(rawOrders);
  return {
    orders: (operationalOrders || [])
      .map((order) =>
        sanitizeStoreOrderForAdmin(
          order,
          userMap.get(String(order?.userId || "").trim()) || null,
        ),
      )
      .filter(Boolean),
    page: safePage,
    limit: safeLimit,
    total: Number(total || 0),
    hasMore: skip + safeLimit < Number(total || 0),
  };
};

const listAdminStoreUsers = async ({ page = 1, limit = 100 } = {}) => {
  const safePage = parsePositivePage(page, 1);
  const safeLimit = parsePositiveLimit(limit, 100, 200);
  const skip = (safePage - 1) * safeLimit;
  const [total, users] = await Promise.all([
    StoreUser.countDocuments({}),
    StoreUser.find({})
      .select("id fullName email phone authProviders googleId passwordHash createdAt updatedAt")
      .sort({ updatedAt: -1, createdAt: -1, id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);
  const statsMap = await buildStoreUserStatsMapForIds(
    (users || []).map((user) => String(user?.id || "").trim()),
  );
  return {
    users: (users || [])
      .map((user) =>
        sanitizeStoreUserForAdmin(
          user,
          statsMap.get(String(user?.id || "").trim()) || null,
        ),
      )
      .filter(Boolean),
    page: safePage,
    limit: safeLimit,
    total: Number(total || 0),
    hasMore: skip + safeLimit < Number(total || 0),
  };
};

const listAdminStoreVouchers = async ({ page = 1, limit = 100 } = {}) => {
  const safePage = parsePositivePage(page, 1);
  const safeLimit = parsePositiveLimit(limit, 100, 200);
  const skip = (safePage - 1) * safeLimit;
  const [total, vouchers] = await Promise.all([
    StoreVoucher.countDocuments({}),
    StoreVoucher.find({})
      .sort({ createdAt: -1, id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);
  const statsMap = await buildStoreVoucherStatsMap(vouchers);
  return {
    vouchers: (vouchers || [])
      .map((voucher) =>
        sanitizeStoreVoucherForAdmin(
          voucher,
          statsMap.get(String(voucher?.id || "").trim()) || null,
        ),
      )
      .filter(Boolean),
    page: safePage,
    limit: safeLimit,
    total: Number(total || 0),
    hasMore: skip + safeLimit < Number(total || 0),
  };
};

const listAdminStoreSupportConversations = async ({
  page = 1,
  limit = 50,
} = {}) => {
  const safePage = parsePositivePage(page, 1);
  const safeLimit = parsePositiveLimit(limit, 50, 200);
  const skip = (safePage - 1) * safeLimit;
  const [total, conversations] = await Promise.all([
    StoreSupportConversation.countDocuments({}),
    StoreSupportConversation.find({})
      .sort({ lastMessageAt: -1, createdAt: -1, id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);
  return {
    conversations: (conversations || [])
      .map((conversation) =>
        sanitizeStoreSupportConversationForAdmin(conversation),
      )
      .filter(Boolean),
    page: safePage,
    limit: safeLimit,
    total: Number(total || 0),
    hasMore: skip + safeLimit < Number(total || 0),
  };
};

const normalizeAdminChatgptSubTab = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["all", "total", "market", "short"].includes(normalized)) {
    return normalized;
  }
  return "all";
};
const normalizeAdminChatgptTotalType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["all", "package1", "package2", "unassigned"].includes(normalized)) {
    return normalized;
  }
  return "all";
};
const normalizeAdminCustomerFilter = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["all", "with", "without"].includes(normalized)) {
    return normalized;
  }
  return "all";
};
const normalizeAdminSearchText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();
const hasAssignedCustomerForAdminChatgpt = (account = {}) =>
  Array.isArray(account?.users) &&
  account.users.some((user) => String(user?.name || "").trim());
const getAdminChatgptAccountDaysRemaining = (account = {}) => {
  const expiresAt = String(account?.expiredAt || "").trim();
  if (!expiresAt) return null;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return null;
  return Math.ceil((expiresMs - Date.now()) / 86400000);
};
const matchesAdminChatgptCustomerFilter = (
  hasCustomer = false,
  filterValue = "all",
) => {
  if (filterValue === "with") return !!hasCustomer;
  if (filterValue === "without") return !hasCustomer;
  return true;
};
const matchesAdminChatgptExpiryFilter = (
  daysRemaining = null,
  filterValue = "all",
) => {
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
const normalizeAdminExpiryRangeInput = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
};
const matchesAdminChatgptExpiryRange = (
  daysRemaining = null,
  minValue = "",
  maxValue = "",
) => {
  const min = normalizeAdminExpiryRangeInput(minValue);
  const max = normalizeAdminExpiryRangeInput(maxValue);
  if (min === null && max === null) return true;
  if (daysRemaining === null) return false;
  if (min !== null && daysRemaining < min) return false;
  if (max !== null && daysRemaining > max) return false;
  return true;
};
const CHATGPT_ADMIN_ACCOUNT_SELECT =
  "id username password otpSecret type package2Shelf users note link status createdAt expiredAt updatedAt mailCheckEnabled mailCheckProvider mailCheckStatus mailCheckLastCheckedAt mailCheckLastMatchedEmailId mailCheckLastMatchedAt mailCheckLastSubject mailCheckLastSender mailCheckLastSnippet";
const CHATGPT_ADMIN_MARKETPLACE_ORDER_TRACE_SELECT =
  "provider orderId accounts.accountId";
const CHATGPT_ADMIN_MARKETPLACE_WARRANTY_TRACE_SELECT =
  "provider orderId rootAccountId currentAccountId rounds.fromAccountId rounds.toAccountId";
const CHATGPT_ADMIN_STORE_ORDER_TRACE_SELECT = [
  "id",
  "userId",
  "status",
  "packageCode",
  "packageName",
  "momoOrderId",
  "createdAt",
  "paidAt",
  "fulfilledAt",
  "expiresAt",
  "updatedAt",
  "assignedAccountId",
  "reservedAccountId",
  "rootAssignedAccountId",
  "warrantyRounds.fromAccountId",
  "warrantyRounds.toAccountId",
].join(" ");
const CHATGPT_ADMIN_STORE_USER_TRACE_SELECT =
  "id fullName email phone createdAt updatedAt";
const STORE_ORDER_USER_SELECT = "id fullName email phone createdAt updatedAt";
const loadStoreUsersForTraceOrders = async (
  orders = [],
  select = CHATGPT_ADMIN_STORE_USER_TRACE_SELECT,
) => {
  const userIds = Array.from(
    new Set(
      (Array.isArray(orders) ? orders : [])
        .map((order) => String(order?.userId || "").trim())
        .filter(Boolean),
    ),
  );
  if (userIds.length === 0) return [];
  return StoreUser.find({ id: { $in: userIds } }).select(select).lean();
};
const buildAdminChatgptSearchText = (account = {}) =>
  normalizeAdminSearchText(
    [
      account?.username,
      account?.password,
      account?.note,
      ...(Array.isArray(account?.users)
        ? account.users.flatMap((user) => [user?.name, user?.joinedAt, user?.expiredAt])
        : []),
      account?.storeTraceSummary?.latestOrderId,
      account?.storeTraceSummary?.latestCustomerName,
      account?.storeTraceSummary?.latestCustomerEmail,
      account?.marketplaceTraceSummary?.latestOrderId,
      account?.marketplaceTraceSummary?.latestWarrantyOrderId,
      account?.marketplaceTraceSummary?.latestProvider,
      account?.mailCheckLastSubject,
      account?.mailCheckLastSender,
      account?.mailCheckLastSnippet,
    ]
      .filter(Boolean)
      .join(" "),
  );
const sortAdminChatgptAccounts = (items = []) => {
  const typeOrder = { package1: 0, package2: 1, unassigned: 2 };
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftOrder = typeOrder[String(left?.type || "unassigned").trim()] ?? 99;
    const rightOrder = typeOrder[String(right?.type || "unassigned").trim()] ?? 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return (
      new Date(String(right?.createdAt || 0)).getTime() -
      new Date(String(left?.createdAt || 0)).getTime()
    );
  });
};
const buildEmptyStoreChatgptWarehouseSummary = () => ({
  package1: {
    sharedAccounts: 0,
    sharedSlots: 0,
    convertibleAccounts: 0,
    availableNow: 0,
  },
  package2: {
    existingAccounts: 0,
    convertibleAccounts: 0,
    availableNow: 0,
  },
});
const getCachedChatgptAdminSnapshot = async (
  ttlMs = chatgptAdminSnapshotCacheTtlMs,
) => {
  const cacheVersion = latestDataVersion;
  const now = Date.now();
  const existing = chatgptAdminSnapshotCache;
  if (
    existing &&
    existing.version === cacheVersion &&
    existing.expiresAt > now
  ) {
    if (existing.value) {
      return existing.value;
    }
    if (existing.promise) {
      return existing.promise;
    }
  }

  const loadPromise = (async () => {
    const [accounts, datammoOrders, datammoWarrantyCases, rawStoreOrders] =
      await Promise.all([
        Account.find({}).select(CHATGPT_ADMIN_ACCOUNT_SELECT).lean(),
        DatammoOrder.find({})
          .sort({ createdAt: -1 })
          .select(CHATGPT_ADMIN_MARKETPLACE_ORDER_TRACE_SELECT)
          .lean(),
        DatammoWarrantyCase.find({})
          .sort({ updatedAt: -1 })
          .select(CHATGPT_ADMIN_MARKETPLACE_WARRANTY_TRACE_SELECT)
          .lean(),
        StoreOrder.find({
          status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
        })
          .sort({ createdAt: -1 })
          .select(CHATGPT_ADMIN_STORE_ORDER_TRACE_SELECT)
          .lean(),
      ]);

    const storeUsers = await loadStoreUsersForTraceOrders(rawStoreOrders);
    const storeUserMap = new Map(
      (storeUsers || []).map((user) => [String(user?.id || "").trim(), user]),
    );
    let storeAccountTraceMap = new Map();
    try {
      storeAccountTraceMap = buildStoreAccountTraceMap(
        rawStoreOrders,
        storeUserMap,
      );
    } catch (traceError) {
      console.error(
        "Admin ChatGPT store trace snapshot failed:",
        traceError,
      );
    }
    let marketplaceAccountTraceMap = new Map();
    try {
      marketplaceAccountTraceMap = buildMarketplaceAccountTraceMap(
        datammoOrders,
        datammoWarrantyCases,
      );
    } catch (traceError) {
      console.error(
        "Admin ChatGPT marketplace trace snapshot failed:",
        traceError,
      );
    }
    const enrichedAccounts = sortAdminChatgptAccounts(
      (accounts || []).map((account) => {
        const normalizedAccount = {
          ...account,
          package2Shelf: normalizePackage2Shelf(
            account?.package2Shelf,
            CHATGPT_TOTAL_VALUE,
          ),
          storeTraceSummary:
            storeAccountTraceMap.get(String(account?.id || "").trim()) || null,
          marketplaceTraceSummary:
            marketplaceAccountTraceMap.get(String(account?.id || "").trim()) ||
            null,
        };
        return {
          ...enrichChatgptAccountWithOperationalState({
            ...normalizedAccount,
            package2Shelf: normalizeChatgptMarketAccountState(normalizedAccount),
          }),
        };
      }),
    );
    const isTrackedMarketplaceAccount = (account = {}) =>
      hasMarketplaceTraceSummary(account?.marketplaceTraceSummary);
    const isMarketAccount = (account = {}) =>
      supportsChatgptMarket(account?.type) &&
      normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
        CHATGPT_MARKET_VALUE;
    const isShortAccount = (account = {}) =>
      supportsChatgptMarket(account?.type) &&
      normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
        CHATGPT_MANUAL_MARKET_VALUE;

    const totalPoolAccounts = enrichedAccounts.filter((account) => {
      if (!supportsChatgptMarket(account?.type)) return false;
      if (isTrackedMarketplaceAccount(account)) return false;
      if (isMarketAccount(account)) return false;
      if (isShortAccount(account)) return false;
      return true;
    });
    const marketUnsoldAccounts = enrichedAccounts.filter(
      (account) => !isTrackedMarketplaceAccount(account) && isMarketAccount(account),
    );
    const marketSoldAccounts = enrichedAccounts.filter(
      (account) => isTrackedMarketplaceAccount(account),
    );
    const shortAccounts = enrichedAccounts.filter(
      (account) => !isTrackedMarketplaceAccount(account) && isShortAccount(account),
    );
    let storeWarehouseSummary = buildEmptyStoreChatgptWarehouseSummary();
    try {
      storeWarehouseSummary = await buildStoreChatgptWarehouseSummary();
    } catch (summaryError) {
      console.error(
        "Admin ChatGPT warehouse summary snapshot failed:",
        summaryError,
      );
    }

    return {
      enrichedAccounts,
      totalPoolAccounts,
      marketUnsoldAccounts,
      marketSoldAccounts,
      shortAccounts,
      storeWarehouseSummary,
    };
  })()
    .then((value) => {
      if (chatgptAdminSnapshotCache?.promise === loadPromise) {
        chatgptAdminSnapshotCache = {
          version: cacheVersion,
          expiresAt: Date.now() + ttlMs,
          value,
        };
      }
      return value;
    })
    .catch((error) => {
      if (chatgptAdminSnapshotCache?.promise === loadPromise) {
        chatgptAdminSnapshotCache = null;
      }
      throw error;
    });

  chatgptAdminSnapshotCache = {
    version: cacheVersion,
    expiresAt: now + ttlMs,
    promise: loadPromise,
  };
  return loadPromise;
};
const listAdminChatgptAccounts = async ({
  page = 1,
  limit = 10,
  subTab = "all",
  totalType = "all",
  mailCheckFilter = "all",
  customerFilter = "all",
  expiryFilter = "all",
  expiryMin = "",
  expiryMax = "",
  search = "",
  package2ShelfTab = "all",
  soldProviderFilter = "all",
} = {}) => {
  const safePage = parsePositivePage(page, 1);
  const safeLimit = parsePositiveLimit(limit, 10, 50);
  const normalizedSubTab = normalizeAdminChatgptSubTab(subTab);
  const normalizedTotalType = normalizeAdminChatgptTotalType(totalType);
  const normalizedMailCheckFilter = ["died", "checked", "unchecked"].includes(
    String(mailCheckFilter || "").trim().toLowerCase(),
  )
    ? String(mailCheckFilter || "").trim().toLowerCase()
    : "all";
  const normalizedCustomerFilter = normalizeAdminCustomerFilter(customerFilter);
  const normalizedSearch = normalizeAdminSearchText(search);
  const normalizedPackage2ShelfTab =
    String(package2ShelfTab || "").trim().toLowerCase() === "sold"
      ? "sold"
      : "all";
  const normalizedSoldProvider =
    String(soldProviderFilter || "").trim().toLowerCase() === "shopmini"
      ? "shopmini"
      : String(soldProviderFilter || "").trim().toLowerCase() === "datammo"
        ? "datammo"
        : "all";
  const {
    enrichedAccounts,
    totalPoolAccounts,
    marketUnsoldAccounts,
    marketSoldAccounts,
    shortAccounts,
    storeWarehouseSummary,
  } = await getCachedChatgptAdminSnapshot();
  const isTrackedMarketplaceAccount = (account = {}) =>
    hasMarketplaceTraceSummary(account?.marketplaceTraceSummary);
  const isMarketAccount = (account = {}) =>
    supportsChatgptMarket(account?.type) &&
    normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
      CHATGPT_MARKET_VALUE;
  const isShortAccount = (account = {}) =>
    supportsChatgptMarket(account?.type) &&
    normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
      CHATGPT_MANUAL_MARKET_VALUE;
  const accountMatchesSoldProvider = (account = {}, provider = "all") => {
    if (provider === "all") return true;
    return (account?.marketplaceTraceSummary?.providers || []).includes(provider);
  };
  const accountMatchesMailCheckFilter = (account = {}, filterValue = "all") => {
    if (filterValue === "all") return true;
    const status = normalizeChatgptMailCheckStatus(account?.mailCheckStatus);
    const lastCheckedAt = String(account?.mailCheckLastCheckedAt || "").trim();
    if (filterValue === "died") return status === "died";
    if (filterValue === "checked") return !!lastCheckedAt && status !== "died";
    if (filterValue === "unchecked") return !lastCheckedAt;
    return true;
  };
  const isMarketUnsoldAccount = (account = {}) =>
    !isTrackedMarketplaceAccount(account) && isMarketAccount(account);
  const isMarketSoldAccount = (account = {}, provider = "all") =>
    isTrackedMarketplaceAccount(account) &&
    accountMatchesSoldProvider(account, provider);
  const filteredAccounts = enrichedAccounts
    .filter((account) => {
      if (normalizedSubTab === "market") {
        if (normalizedPackage2ShelfTab === "sold") {
          return isMarketSoldAccount(account, normalizedSoldProvider);
        }
        return isMarketUnsoldAccount(account);
      }
      if (normalizedSubTab === "short") {
        return !isTrackedMarketplaceAccount(account) && isShortAccount(account);
      }
      if (normalizedSubTab === "total") {
        if (isTrackedMarketplaceAccount(account)) return false;
        if (isMarketAccount(account) || isShortAccount(account)) return false;
        return supportsChatgptMarket(account?.type);
      }
      return true;
    })
    .filter((account) => {
      if (normalizedSubTab !== "total" || normalizedTotalType === "all") return true;
      if (normalizedTotalType === "unassigned") {
        return !account?.type || String(account.type).trim() === "unassigned";
      }
      return String(account?.type || "").trim() === normalizedTotalType;
    })
    .filter((account) =>
      accountMatchesMailCheckFilter(account, normalizedMailCheckFilter),
    )
    .filter((account) =>
      matchesAdminChatgptCustomerFilter(
        hasAssignedCustomerForAdminChatgpt(account),
        normalizedCustomerFilter,
      ),
    )
    .filter((account) =>
      matchesAdminChatgptExpiryFilter(
        getAdminChatgptAccountDaysRemaining(account),
        expiryFilter,
      ),
    )
    .filter((account) =>
      matchesAdminChatgptExpiryRange(
        getAdminChatgptAccountDaysRemaining(account),
        expiryMin,
        expiryMax,
      ),
    )
    .filter((account) => {
      if (!normalizedSearch) return true;
      return buildAdminChatgptSearchText(account).includes(normalizedSearch);
    });

  const total = filteredAccounts.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const normalizedPage = Math.min(safePage, totalPages);
  const skip = (normalizedPage - 1) * safeLimit;
  const pageItems = filteredAccounts.slice(skip, skip + safeLimit);

  return {
    accounts: pageItems,
    pagination: {
      page: normalizedPage,
      limit: safeLimit,
      total,
      totalPages,
      hasMore: skip + safeLimit < total,
    },
    summary: {
      tabs: {
        all: enrichedAccounts.length,
        total: totalPoolAccounts.length,
        market: marketUnsoldAccounts.length + marketSoldAccounts.length,
        short: shortAccounts.length,
      },
      totalTypeTabs: {
        all: totalPoolAccounts.length,
        package1: totalPoolAccounts.filter(
          (account) => String(account?.type || "").trim() === "package1",
        ).length,
        package2: totalPoolAccounts.filter(
          (account) => String(account?.type || "").trim() === "package2",
        ).length,
        unassigned: totalPoolAccounts.filter(
          (account) =>
            !account?.type || String(account?.type || "").trim() === "unassigned",
        ).length,
      },
      mailCheckTabs: {
        all: enrichedAccounts.length,
        died: enrichedAccounts.filter(
          (account) => normalizeChatgptMailCheckStatus(account?.mailCheckStatus) === "died",
        ).length,
        checked: enrichedAccounts.filter((account) => {
          const status = normalizeChatgptMailCheckStatus(account?.mailCheckStatus);
          const lastCheckedAt = String(account?.mailCheckLastCheckedAt || "").trim();
          return !!lastCheckedAt && status !== "died";
        }).length,
        unchecked: enrichedAccounts.filter(
          (account) => !String(account?.mailCheckLastCheckedAt || "").trim(),
        ).length,
      },
      marketShelfTabs: {
        all: marketUnsoldAccounts.length,
        sold: marketSoldAccounts.length,
        soldDatammo: marketSoldAccounts.filter((account) =>
          accountMatchesSoldProvider(account, "datammo"),
        ).length,
        soldShopmini: marketSoldAccounts.filter((account) =>
          accountMatchesSoldProvider(account, "shopmini"),
        ).length,
      },
      storeWarehouse: storeWarehouseSummary,
    },
  };
};

const buildAdminDashboardSummary = async () => {
  const [
    totalStoreUsers,
    totalStoreOrders,
    fulfilledStoreOrders,
    pendingStoreOrders,
    unreadSupportConversations,
    openSupportConversations,
    totalVouchers,
  ] = await Promise.all([
    StoreUser.countDocuments({}),
    StoreOrder.countDocuments({
      status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
    }),
    StoreOrder.countDocuments({ status: "fulfilled" }),
    StoreOrder.countDocuments({
      status: { $in: ["pending_payment", "awaiting_payment", "paid"] },
    }),
    StoreSupportConversation.countDocuments({ adminUnreadCount: { $gt: 0 } }),
    StoreSupportConversation.countDocuments({ status: "open" }),
    StoreVoucher.countDocuments({}),
  ]);
  return {
    totalStoreUsers: Number(totalStoreUsers || 0),
    totalStoreOrders: Number(totalStoreOrders || 0),
    fulfilledStoreOrders: Number(fulfilledStoreOrders || 0),
    pendingStoreOrders: Number(pendingStoreOrders || 0),
    unreadSupportConversations: Number(unreadSupportConversations || 0),
    openSupportConversations: Number(openSupportConversations || 0),
    totalVouchers: Number(totalVouchers || 0),
  };
};
const getChatgptUserRemainingDays = (user, duration = "1M") => {
  if (!user) return null;
  const now = new Date();
  if (user.expiredAt) {
    return Math.ceil(
      (new Date(user.expiredAt) - now) / (1000 * 60 * 60 * 24),
    );
  }
  if (user.joinedAt) {
    const fallbackExpiry = addDurationToDate(user.joinedAt, duration);
    return Math.ceil((fallbackExpiry - now) / (1000 * 60 * 60 * 24));
  }
  return null;
};
const buildChatgptPublicStatsSummary = async () => {
  const [
    accounts,
    teamAccounts,
    marketplaceOrders,
    marketplaceWarrantyCases,
    webSummary,
    chatgptSnapshot,
  ] =
    await Promise.all([
      Account.find({}).select("type users expiredAt duration").lean(),
      TeamAccount.find({})
        .select("saleMode warehouse slots expiredAt")
        .lean(),
      DatammoOrder.find({})
        .select("scope provider")
        .lean(),
      DatammoWarrantyCase.find({})
        .select("scope provider")
        .lean(),
      buildAdminDashboardSummary(),
      getCachedChatgptAdminSnapshot(),
    ]);
  const now = new Date();
  const safeChatgptSnapshot = chatgptSnapshot || {};
  const chatgptEnrichedAccounts = Array.isArray(safeChatgptSnapshot.enrichedAccounts)
    ? safeChatgptSnapshot.enrichedAccounts
    : [];
  const chatgptTotalPoolAccounts = Array.isArray(safeChatgptSnapshot.totalPoolAccounts)
    ? safeChatgptSnapshot.totalPoolAccounts
    : [];
  const chatgptMarketUnsoldAccounts = Array.isArray(
    safeChatgptSnapshot.marketUnsoldAccounts,
  )
    ? safeChatgptSnapshot.marketUnsoldAccounts
    : [];
  const chatgptMarketSoldAccounts = Array.isArray(
    safeChatgptSnapshot.marketSoldAccounts,
  )
    ? safeChatgptSnapshot.marketSoldAccounts
    : [];
  const chatgptShortAccounts = Array.isArray(safeChatgptSnapshot.shortAccounts)
    ? safeChatgptSnapshot.shortAccounts
    : [];
  const accountMatchesSoldProvider = (account = {}, provider = "all") => {
    if (provider === "all") return true;
    return (account?.marketplaceTraceSummary?.providers || []).includes(provider);
  };
  const summary = {
    totalAccounts: 0,
    shared: { total: 0, full: 0, partial: 0, empty: 0 },
    private: { total: 0, used: 0, empty: 0 },
    unassigned: 0,
    users: { total: 0, active: 0, expired: 0 },
    expiry: { expired: 0, within3Days: 0, within7Days: 0 },
    chatgpt: {
      warehouseTabs: {
        all: chatgptEnrichedAccounts.length,
        total: chatgptTotalPoolAccounts.length,
        market: chatgptMarketUnsoldAccounts.length + chatgptMarketSoldAccounts.length,
        short: chatgptShortAccounts.length,
      },
      totalTypeTabs: {
        all: chatgptTotalPoolAccounts.length,
        package1: 0,
        package2: 0,
        unassigned: 0,
      },
      marketShelfTabs: {
        all: chatgptMarketUnsoldAccounts.length,
        sold: chatgptMarketSoldAccounts.length,
        soldDatammo: chatgptMarketSoldAccounts.filter((account) =>
          accountMatchesSoldProvider(account, "datammo"),
        ).length,
        soldShopmini: chatgptMarketSoldAccounts.filter((account) =>
          accountMatchesSoldProvider(account, "shopmini"),
        ).length,
      },
    },
    team: {
      totalAccounts: 0,
      slotAccounts: 0,
      businessAccounts: 0,
      activeCustomers: 0,
      usedAccounts: 0,
      emptyAccounts: 0,
      marketReady: 0,
      warehouses: { total: 0, market: 0, short: 0 },
      totalWarehouseModes: { slot: 0, business: 0 },
      expiry: { expired: 0, within3Days: 0, within7Days: 0 },
    },
    marketplace: {
      chatgptOrders: 0,
      teamOrders: 0,
      chatgptWarranty: 0,
      teamWarranty: 0,
      providers: {
        datammoOrders: 0,
        shopminiOrders: 0,
        datammoWarranty: 0,
        shopminiWarranty: 0,
      },
    },
    web: {
      totalUsers: Number(webSummary?.totalStoreUsers || 0),
      totalOrders: Number(webSummary?.totalStoreOrders || 0),
      fulfilledOrders: Number(webSummary?.fulfilledStoreOrders || 0),
      pendingOrders: Number(webSummary?.pendingStoreOrders || 0),
    },
  };

  (Array.isArray(accounts) ? accounts : []).forEach((account) => {
    const type = String(account?.type || "unassigned").trim() || "unassigned";
    const users = Array.isArray(account?.users) ? account.users : [];
    const userCount = users.length;
    summary.totalAccounts += 1;

    if (type === "package1") {
      summary.shared.total += 1;
      if (userCount >= 3) summary.shared.full += 1;
      else if (userCount > 0) summary.shared.partial += 1;
      else summary.shared.empty += 1;
    } else if (type === "package2") {
      summary.private.total += 1;
      if (userCount > 0) summary.private.used += 1;
      else summary.private.empty += 1;
    } else {
      summary.unassigned += 1;
    }

    summary.users.total += userCount;
    users.forEach((user) => {
      const remaining = getChatgptUserRemainingDays(
        user,
        account?.duration || "1M",
      );
      if (remaining === null || remaining > 0) summary.users.active += 1;
      else summary.users.expired += 1;
    });

    const expiredAt = String(account?.expiredAt || "").trim();
    if (!expiredAt) return;
    const daysLeft = Math.ceil(
      (new Date(expiredAt) - now) / (1000 * 60 * 60 * 24),
    );
    if (daysLeft < 0) summary.expiry.expired += 1;
    if (daysLeft >= 0 && daysLeft <= 3) summary.expiry.within3Days += 1;
    if (daysLeft >= 0 && daysLeft <= 7) summary.expiry.within7Days += 1;
  });

  chatgptTotalPoolAccounts.forEach((account) => {
    const type = String(account?.type || "unassigned").trim() || "unassigned";
    if (type === "package1") summary.chatgpt.totalTypeTabs.package1 += 1;
    else if (type === "package2") summary.chatgpt.totalTypeTabs.package2 += 1;
    else summary.chatgpt.totalTypeTabs.unassigned += 1;
  });

  (Array.isArray(teamAccounts) ? teamAccounts : []).forEach((account) => {
    summary.team.totalAccounts += 1;
    const saleMode = normalizeTeamSaleMode(account?.saleMode);
    const warehouse = normalizeTeamWarehouse(
      account?.warehouse,
      TEAM_WAREHOUSE_TOTAL,
    );
    const activeCustomers = countActiveTeamCustomers(account?.slots);
    if (saleMode === TEAM_SALE_MODE_BUSINESS) summary.team.businessAccounts += 1;
    else summary.team.slotAccounts += 1;
    if (warehouse === TEAM_WAREHOUSE_MARKET) summary.team.warehouses.market += 1;
    else if (warehouse === TEAM_WAREHOUSE_SHORT) summary.team.warehouses.short += 1;
    else {
      summary.team.warehouses.total += 1;
      if (saleMode === TEAM_SALE_MODE_BUSINESS) {
        summary.team.totalWarehouseModes.business += 1;
      } else {
        summary.team.totalWarehouseModes.slot += 1;
      }
    }
    summary.team.activeCustomers += activeCustomers;
    if (activeCustomers > 0) summary.team.usedAccounts += 1;
    else summary.team.emptyAccounts += 1;
    if (isEligibleForTeamMarketSale(account)) summary.team.marketReady += 1;
    const daysLeft = getTeamDaysLeft(account);
    if (!Number.isFinite(daysLeft)) return;
    if (daysLeft < 0) summary.team.expiry.expired += 1;
    if (daysLeft >= 0 && daysLeft <= 3) summary.team.expiry.within3Days += 1;
    if (daysLeft >= 0 && daysLeft <= 7) summary.team.expiry.within7Days += 1;
  });

  (Array.isArray(marketplaceOrders) ? marketplaceOrders : []).forEach((order) => {
    const scope = normalizeMarketplaceScope(order?.scope, "chatgpt");
    const provider = normalizeMarketplaceProvider(order?.provider, "datammo");
    if (scope === "team") summary.marketplace.teamOrders += 1;
    else summary.marketplace.chatgptOrders += 1;
    if (provider === "shopmini") summary.marketplace.providers.shopminiOrders += 1;
    else summary.marketplace.providers.datammoOrders += 1;
  });

  (Array.isArray(marketplaceWarrantyCases) ? marketplaceWarrantyCases : []).forEach(
    (item) => {
      const scope = normalizeMarketplaceScope(item?.scope, "chatgpt");
      const provider = normalizeMarketplaceProvider(item?.provider, "datammo");
      if (scope === "team") summary.marketplace.teamWarranty += 1;
      else summary.marketplace.chatgptWarranty += 1;
      if (provider === "shopmini")
        summary.marketplace.providers.shopminiWarranty += 1;
      else summary.marketplace.providers.datammoWarranty += 1;
    },
  );

  return {
    ...summary,
    updatedAt: new Date().toISOString(),
  };
};
const buildMarketplaceTraceMapForAccountIds = async (accountIds = []) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return new Map();
  const [orders, warrantyCases] = await Promise.all([
    DatammoOrder.find({
      scope: "chatgpt",
      "accounts.accountId": { $in: normalizedIds },
    }).lean(),
    DatammoWarrantyCase.find({
      scope: "chatgpt",
      $or: [
        { rootAccountId: { $in: normalizedIds } },
        { currentAccountId: { $in: normalizedIds } },
        { "rounds.fromAccountId": { $in: normalizedIds } },
        { "rounds.toAccountId": { $in: normalizedIds } },
      ],
    }).lean(),
  ]);
  return buildMarketplaceAccountTraceMap(orders, warrantyCases);
};
const buildStoreReservationSnapshot = async ({ excludeOrderId = "" } = {}) => {
  const activeOrders = await StoreOrder.find(
    buildStoreActivePendingOrderQuery({
      reservedAccountId: { $ne: "" },
    }),
  )
    .select("id reservedAccountId reservationType")
    .lean();
  const reservedAccountIds = new Set();
  const package1ExistingCounts = new Map();
  activeOrders.forEach((order) => {
    if (excludeOrderId && String(order?.id || "").trim() === excludeOrderId) return;
    const reservedId = String(order?.reservedAccountId || "").trim();
    if (!reservedId) return;
    reservedAccountIds.add(reservedId);
    if (String(order?.reservationType || "").trim() === "package1_existing") {
      package1ExistingCounts.set(
        reservedId,
        Number(package1ExistingCounts.get(reservedId) || 0) + 1,
      );
    }
  });
  return {
    reservedAccountIds,
    package1ExistingCounts,
  };
};
const findActivePendingStoreReservationByAccountId = async (
  accountId = "",
  { excludeOrderId = "" } = {},
) => {
  const normalizedAccountId = String(accountId || "").trim();
  if (!normalizedAccountId) return null;
  const extra = { reservedAccountId: normalizedAccountId };
  if (excludeOrderId) {
    extra.id = { $ne: String(excludeOrderId || "").trim() };
  }
  return StoreOrder.findOne(buildStoreActivePendingOrderQuery(extra))
    .select("id packageCode packageName userId createdAt expiresAt")
    .lean();
};
const listActivePendingStoreReservedAccountIds = async ({
  excludeOrderId = "",
} = {}) => {
  const extra = {};
  if (excludeOrderId) {
    extra.id = { $ne: String(excludeOrderId || "").trim() };
  }
  const orders = await StoreOrder.find(buildStoreActivePendingOrderQuery(extra))
    .select("reservedAccountId")
    .lean();
  return Array.from(
    new Set(
      (Array.isArray(orders) ? orders : [])
        .map((order) => String(order?.reservedAccountId || "").trim())
        .filter(Boolean),
    ),
  );
};
const sanitizeStoreOrder = (order) => {
  if (!order) return null;
  const packageCode = String(order.packageCode || "");
  const isFulfilled =
    normalizeStoreOrderStatusValue(order?.status) === "fulfilled";
  const operationalState = buildStoreOrderOperationalState(order);
  const warrantyRounds = Array.isArray(order?.warrantyRounds)
    ? order.warrantyRounds
        .map((round) => ({
          sequence: Number(round?.sequence || 0),
          fromUsername: String(round?.fromUsername || "").trim(),
          toUsername: String(round?.toUsername || "").trim(),
          reason: String(round?.reason || "").trim(),
          createdAt: String(round?.createdAt || "").trim(),
        }))
        .filter((round) => round.sequence > 0)
    : [];
  const base = {
    id: String(order.id || ""),
    packageCode,
    packageName:
      String(order.packageName || STORE_PACKAGE_MAP[packageCode]?.name || ""),
    originalAmount: Number(order.originalAmount || order.amount || 0),
    discountAmount: Number(order.discountAmount || 0),
    amount: Number(order.amount || 0),
    voucherId: String(order.voucherId || "").trim(),
    voucherCode: normalizeStoreVoucherCode(order.voucherCode),
    voucherType: String(order.voucherCode || "").trim()
      ? normalizeStoreVoucherType(order.voucherType)
      : "",
    voucherValue: Number(order.voucherValue || 0),
    voucherDescription: String(order.voucherDescription || "").trim(),
    status: String(order.status || "pending"),
    paymentMethod: normalizeStorePaymentMethod(order.paymentMethod),
    paymentMethodLabel: getStorePaymentMethodLabel(order.paymentMethod),
    paymentOrderId: getStorePaymentOrderId(order),
    paymentStatusText: getStorePaymentStatusText(order),
    paymentUrl: getStorePaymentUrl(order),
    paymentQrCode: String(order.payosQrCode || "").trim(),
    momoOrderId: String(order.momoOrderId || ""),
    momoTransId: String(order.momoTransId || ""),
    momoResultCode:
      order.momoResultCode === null || order.momoResultCode === undefined
        ? null
        : Number(order.momoResultCode),
    momoMessage: String(order.momoMessage || ""),
    momoPayUrl: String(order.momoPayUrl || ""),
    momoDeepLink: String(order.momoDeepLink || "").trim(),
    momoQrCodeUrl: String(order.momoQrCodeUrl || "").trim(),
    payosOrderCode:
      order.payosOrderCode === null || order.payosOrderCode === undefined
        ? null
        : Number(order.payosOrderCode),
    payosPaymentLinkId: String(order.payosPaymentLinkId || "").trim(),
    payosStatus: String(order.payosStatus || "").trim(),
    payosCode: String(order.payosCode || "").trim(),
    payosDesc: String(order.payosDesc || "").trim(),
    payosCheckoutUrl: String(order.payosCheckoutUrl || "").trim(),
    expiresAt: String(order.expiresAt || ""),
    createdAt: String(order.createdAt || ""),
    updatedAt: String(order.updatedAt || ""),
    paidAt: String(order.paidAt || ""),
    fulfilledAt: String(order.fulfilledAt || ""),
    reservationState: String(operationalState?.reservationState || "").trim(),
    fulfillmentState: String(operationalState?.fulfillmentState || "").trim(),
    fulfillmentReason: String(operationalState?.fulfillmentReason || "").trim(),
    currentAccountState:
      operationalState?.currentAccountState &&
      typeof operationalState.currentAccountState === "object"
        ? operationalState.currentAccountState
        : null,
    warrantyCount: warrantyRounds.length,
    warrantyRounds,
  };
  if (packageCode === "package1") {
    return {
      ...base,
      package1AccessToken: isFulfilled
        ? String(order.package1AccessToken || "")
        : "",
      package1UsedCount: Number(order.package1UsedCount || 0),
      package1UsageLeft: buildStorePackage1UsageLeft(order),
      assignedUsername: isFulfilled ? String(order.assignedUsername || "") : "",
      assignedPassword: isFulfilled ? String(order.assignedPassword || "") : "",
      assignedLink: isFulfilled ? String(order.assignedLink || "") : "",
      assignedCustomerName: isFulfilled
        ? String(order.assignedCustomerName || "")
        : "",
      assignedCustomerJoinedAt: isFulfilled
        ? String(order.assignedCustomerJoinedAt || "")
        : "",
      assignedCustomerExpiredAt: isFulfilled
        ? String(order.assignedCustomerExpiredAt || "")
        : "",
    };
  }
  if (packageCode === "package2") {
    return {
      ...base,
      assignedUsername: isFulfilled ? String(order.assignedUsername || "") : "",
      assignedPassword: isFulfilled ? String(order.assignedPassword || "") : "",
      assignedOtpSecret: isFulfilled
        ? String(order.assignedOtpSecret || "")
        : "",
      assignedLink: isFulfilled ? String(order.assignedLink || "") : "",
      assignedType: isFulfilled ? String(order.assignedType || "") : "",
      assignedCustomerName: isFulfilled
        ? String(order.assignedCustomerName || "")
        : "",
      assignedCustomerJoinedAt: isFulfilled
        ? String(order.assignedCustomerJoinedAt || "")
        : "",
      assignedCustomerExpiredAt: isFulfilled
        ? String(order.assignedCustomerExpiredAt || "")
        : "",
    };
  }
  return base;
};
const completeStoreOrderManualFulfillment = async (order = {}) => {
  const normalizedOrderId = String(order?.id || "").trim();
  if (!normalizedOrderId) {
    const error = new Error("Thiếu ID đơn web.");
    error.statusCode = 400;
    throw error;
  }
  const normalizedStatus = normalizeStoreOrderStatusValue(order?.status);
  if (normalizedStatus === "fulfilled") {
    return StoreOrder.findOne({ id: normalizedOrderId });
  }
  const paymentMethod = normalizeStorePaymentMethod(order?.paymentMethod);
  const hasPaidTimestamp = !!String(order?.paidAt || "").trim();
  const isPaymentConfirmed =
    paymentMethod === "admin_manual" ||
    (hasPaidTimestamp &&
      (normalizedStatus === "paid" || normalizedStatus === "fulfillment_failed"));
  if (!isPaymentConfirmed) {
    const error = new Error(
      paymentMethod === "admin_manual"
        ? "Đơn tay này chưa được xác nhận thanh toán nên chưa thể chốt đã giao."
        : "Đơn web chưa thanh toán thành công nên không được giao nick.",
    );
    error.statusCode = 409;
    throw error;
  }
  const assignedAccountId = String(
    order?.assignedAccountId || order?.rootAssignedAccountId || "",
  ).trim();
  if (!assignedAccountId) {
    const error = new Error("Đơn này chưa có nick hiện tại để xác nhận giao tay.");
    error.statusCode = 409;
    throw error;
  }

  const account = await Account.findOne({ id: assignedAccountId }).lean();
  if (!account) {
    const error = new Error("Không tìm thấy acc hiện tại của đơn để xác nhận giao tay.");
    error.statusCode = 404;
    throw error;
  }

  const currentUser = Array.isArray(account?.users) ? account.users[0] || null : null;
  const nowIso = new Date().toISOString();

  await StoreOrder.findOneAndUpdate(
    { id: normalizedOrderId },
    {
      $set: {
        status: "fulfilled",
        assignedAccountId,
        assignedUsername: String(
          order?.assignedUsername || account?.username || "",
        ).trim(),
        assignedPassword: String(
          order?.assignedPassword || account?.password || "",
        ).trim(),
        assignedOtpSecret: String(
          order?.assignedOtpSecret || account?.otpSecret || "",
        ).trim(),
        assignedLink: String(order?.assignedLink || account?.link || "").trim(),
        assignedType: String(order?.assignedType || account?.type || "").trim(),
        assignedWarehouse: normalizePackage2Shelf(
          order?.assignedWarehouse || account?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
        assignedCustomerName: String(
          order?.assignedCustomerName || currentUser?.name || "",
        ).trim(),
        assignedCustomerJoinedAt: String(
          order?.assignedCustomerJoinedAt || currentUser?.joinedAt || "",
        ).trim(),
        assignedCustomerExpiredAt: String(
          order?.assignedCustomerExpiredAt || currentUser?.expiredAt || "",
        ).trim(),
        rootAssignedAccountId: String(
          order?.rootAssignedAccountId || assignedAccountId,
        ).trim(),
        rootAssignedUsername: String(
          order?.rootAssignedUsername ||
            order?.assignedUsername ||
            account?.username ||
            "",
        ).trim(),
        reservationState: String(order?.reservedAccountId || "").trim()
          ? "consumed"
          : "none",
        fulfillmentState: "fulfilled",
        fulfillmentReason: "",
        fulfilledAt: String(order?.fulfilledAt || "").trim() || nowIso,
        updatedAt: nowIso,
      },
    },
    { new: false },
  );
  return StoreOrder.findOne({ id: normalizedOrderId });
};
const sanitizeStoreOrderForAdmin = (order, user = null) => {
  if (!order) return null;
  const packageCode = String(order.packageCode || "").trim();
  const operationalState = buildStoreOrderOperationalState(order);
  const warrantyRounds = Array.isArray(order?.warrantyRounds)
    ? order.warrantyRounds
        .map((round) => ({
          sequence: Number(round?.sequence || 0),
          fromAccountId: String(round?.fromAccountId || "").trim(),
          fromUsername: String(round?.fromUsername || "").trim(),
          fromType: String(round?.fromType || "").trim(),
          toAccountId: String(round?.toAccountId || "").trim(),
          toUsername: String(round?.toUsername || "").trim(),
          toType: String(round?.toType || "").trim(),
          reason: String(round?.reason || "").trim(),
          createdAt: String(round?.createdAt || "").trim(),
        }))
        .filter((round) => round.sequence > 0)
    : [];
  return {
    id: String(order.id || "").trim(),
    userId: String(order.userId || "").trim(),
    packageCode,
    packageName: String(
      order.packageName || STORE_PACKAGE_MAP[packageCode]?.name || "",
    ).trim(),
    originalAmount: Number(order.originalAmount || order.amount || 0),
    discountAmount: Number(order.discountAmount || 0),
    amount: Number(order.amount || 0),
    voucherId: String(order.voucherId || "").trim(),
    voucherCode: normalizeStoreVoucherCode(order.voucherCode),
    voucherType: String(order.voucherCode || "").trim()
      ? normalizeStoreVoucherType(order.voucherType)
      : "",
    voucherValue: Number(order.voucherValue || 0),
    voucherDescription: String(order.voucherDescription || "").trim(),
    status: String(order.status || "").trim(),
    paymentMethod: normalizeStorePaymentMethod(order.paymentMethod),
    paymentMethodLabel: getStorePaymentMethodLabel(order.paymentMethod),
    paymentOrderId: getStorePaymentOrderId(order),
    paymentStatusText: getStorePaymentStatusText(order),
    paymentUrl: getStorePaymentUrl(order),
    paymentQrCode: String(order.payosQrCode || "").trim(),
    momoOrderId: String(order.momoOrderId || "").trim(),
    momoDeepLink: String(order.momoDeepLink || "").trim(),
    momoQrCodeUrl: String(order.momoQrCodeUrl || "").trim(),
    payosOrderCode:
      order.payosOrderCode === null || order.payosOrderCode === undefined
        ? null
        : Number(order.payosOrderCode),
    payosPaymentLinkId: String(order.payosPaymentLinkId || "").trim(),
    payosStatus: String(order.payosStatus || "").trim(),
    payosCode: String(order.payosCode || "").trim(),
    payosDesc: String(order.payosDesc || "").trim(),
    createdAt: String(order.createdAt || "").trim(),
    updatedAt: String(order.updatedAt || "").trim(),
    paidAt: String(order.paidAt || "").trim(),
    fulfilledAt: String(order.fulfilledAt || "").trim(),
    expiresAt: String(order.expiresAt || "").trim(),
    reservationType: String(order.reservationType || "").trim(),
    reservationState: String(operationalState?.reservationState || "").trim(),
    reservedAccountId: String(order.reservedAccountId || "").trim(),
    reservedAccountUsername: String(order.reservedAccountUsername || "").trim(),
    reservedAccountSnapshot:
      operationalState?.reservedAccountSnapshot &&
      typeof operationalState.reservedAccountSnapshot === "object"
        ? operationalState.reservedAccountSnapshot
        : null,
    fulfillmentState: String(operationalState?.fulfillmentState || "").trim(),
    fulfillmentReason: String(operationalState?.fulfillmentReason || "").trim(),
    assignedAccountId: String(order.assignedAccountId || "").trim(),
    assignedUsername: String(order.assignedUsername || "").trim(),
    assignedPassword: String(order.assignedPassword || "").trim(),
    assignedOtpSecret: String(order.assignedOtpSecret || "").trim(),
    assignedLink: String(order.assignedLink || "").trim(),
    assignedType: String(order.assignedType || "").trim(),
    assignedCustomerName: String(order.assignedCustomerName || "").trim(),
    assignedCustomerJoinedAt: String(order.assignedCustomerJoinedAt || "").trim(),
    assignedCustomerExpiredAt: String(order.assignedCustomerExpiredAt || "").trim(),
    rootAssignedAccountId: String(order.rootAssignedAccountId || "").trim(),
    rootAssignedUsername: String(order.rootAssignedUsername || "").trim(),
    warrantyRounds,
    warrantyCount: warrantyRounds.length,
    package1AccessToken: String(order.package1AccessToken || "").trim(),
    package1MaxUsage: Number(order.package1MaxUsage || STORE_PACKAGE1_MAX_OTP_USES),
    package1UsedCount: Number(order.package1UsedCount || 0),
    package1UsageLeft: buildStorePackage1UsageLeft(order),
    currentAccountState:
      operationalState?.currentAccountState &&
      typeof operationalState.currentAccountState === "object"
        ? operationalState.currentAccountState
        : null,
    customerName: String(user?.fullName || "").trim(),
    customerEmail: String(user?.email || "").trim(),
    customerPhone: String(user?.phone || "").trim(),
  };
};
const buildStoreAccountTraceMap = (orders = [], userMap = new Map()) => {
  const map = new Map();
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeUserMap = userMap instanceof Map ? userMap : new Map();
  const sortedOrders = [...safeOrders].sort((a, b) => {
    const leftTs = parseStoreDateMs(
      a?.updatedAt || a?.fulfilledAt || a?.paidAt || a?.createdAt,
    );
    const rightTs = parseStoreDateMs(
      b?.updatedAt || b?.fulfilledAt || b?.paidAt || b?.createdAt,
    );
    return rightTs - leftTs;
  });

  const touchSummary = (accountId) => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return null;
    if (!map.has(normalizedId)) {
      map.set(normalizedId, {
        totalOrders: 0,
        assignedOrders: 0,
        reservedOrders: 0,
        activeReservedOrders: 0,
        warrantyOrders: 0,
        pendingOrders: 0,
        fulfilledOrders: 0,
        failedOrders: 0,
        hiddenOrders: 0,
        latestOrderId: "",
        latestStatus: "",
        latestPackageName: "",
        latestCustomerName: "",
        latestCustomerEmail: "",
        latestActiveReservation: null,
        activeReservationTraces: [],
        traces: [],
      });
    }
    return map.get(normalizedId);
  };

  sortedOrders.forEach((order) => {
    const user = safeUserMap.get(String(order?.userId || "").trim()) || null;
    const status = normalizeStoreOrderStatusValue(order?.status);
    const packageCode = String(order?.packageCode || "").trim();
    const packageName = String(
      order?.packageName || STORE_PACKAGE_MAP[packageCode]?.name || packageCode,
    ).trim();
    const traceBase = {
      orderId: String(order?.id || "").trim(),
      status,
      packageCode,
      packageName,
      customerName: String(user?.fullName || "").trim(),
      customerEmail: String(user?.email || "").trim(),
      momoOrderId: String(order?.momoOrderId || "").trim(),
      createdAt: String(order?.createdAt || "").trim(),
      paidAt: String(order?.paidAt || "").trim(),
      fulfilledAt: String(order?.fulfilledAt || "").trim(),
      expiresAt: String(order?.expiresAt || "").trim(),
    };
    const assignedAccountId = String(order?.assignedAccountId || "").trim();
    const reservedAccountId = String(order?.reservedAccountId || "").trim();
    const rootAccountId = String(order?.rootAssignedAccountId || "").trim();
    const targets = [];
    if (assignedAccountId) {
      targets.push({ accountId: assignedAccountId, role: "assigned" });
    }
    if (reservedAccountId && reservedAccountId !== assignedAccountId) {
      targets.push({ accountId: reservedAccountId, role: "reserved" });
    }
    if (
      rootAccountId &&
      rootAccountId !== assignedAccountId &&
      rootAccountId !== reservedAccountId
    ) {
      targets.push({ accountId: rootAccountId, role: "root" });
    }
    (Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : []).forEach((round) => {
      const fromId = String(round?.fromAccountId || "").trim();
      const toId = String(round?.toAccountId || "").trim();
      if (
        fromId &&
        !targets.some((target) => target.accountId === fromId && target.role === "warranty_from")
      ) {
        targets.push({ accountId: fromId, role: "warranty_from" });
      }
      if (
        toId &&
        !targets.some((target) => target.accountId === toId && target.role === "warranty_to")
      ) {
        targets.push({ accountId: toId, role: "warranty_to" });
      }
    });

    targets.forEach((target) => {
      const summary = touchSummary(target.accountId);
      if (!summary) return;
      const isActiveReservation =
        target.role === "reserved" &&
        (isStorePendingPaymentStatus(status) || status === "paid");
      summary.totalOrders += 1;
      if (target.role === "assigned") {
        summary.assignedOrders += 1;
      } else if (target.role === "reserved") {
        summary.reservedOrders += 1;
      } else {
        summary.warrantyOrders += 1;
      }
      if (status === "fulfilled") {
        summary.fulfilledOrders += 1;
      }
      if (isStorePendingPaymentStatus(status) || status === "paid") {
        summary.pendingOrders += 1;
      }
      if (isActiveReservation) {
        summary.activeReservedOrders += 1;
      }
      if (STORE_HIDDEN_ORDER_STATUSES.has(status)) {
        summary.hiddenOrders += 1;
      }
      if (isStoreFailedLikeStatus(status)) {
        summary.failedOrders += 1;
      }
      if (!summary.latestOrderId) {
        summary.latestOrderId = traceBase.orderId;
        summary.latestStatus = traceBase.status;
        summary.latestPackageName = traceBase.packageName;
        summary.latestCustomerName = traceBase.customerName;
        summary.latestCustomerEmail = traceBase.customerEmail;
      }
      if (isActiveReservation && !summary.latestActiveReservation) {
        summary.latestActiveReservation = {
          ...traceBase,
          role: target.role,
        };
      }
      if (isActiveReservation && summary.activeReservationTraces.length < 5) {
        summary.activeReservationTraces.push({
          ...traceBase,
          role: target.role,
        });
      }
      if (summary.traces.length < 5) {
        summary.traces.push({
          ...traceBase,
          role: target.role,
        });
      }
    });
  });

  return map;
};
const buildMarketplaceAccountTraceMap = (
  orders = [],
  warrantyCases = [],
) => {
  const map = new Map();
  const normalizeProvider = (value = "") =>
    String(value || "").trim().toLowerCase() === "shopmini"
      ? "shopmini"
      : "datammo";
  const touchSummary = (accountId) => {
    const normalizedId = String(accountId || "").trim();
    if (!normalizedId) return null;
    if (!map.has(normalizedId)) {
      map.set(normalizedId, {
        orderCount: 0,
        warrantyCount: 0,
        providers: [],
        latestOrderId: "",
        latestProvider: "",
        latestWarrantyOrderId: "",
      });
    }
    return map.get(normalizedId);
  };
  const pushProvider = (summary, provider) => {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) return;
    if (!summary.providers.includes(normalizedProvider)) {
      summary.providers.push(normalizedProvider);
    }
  };

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const provider = normalizeProvider(order?.provider);
    const orderId = String(order?.orderId || "").trim();
    (Array.isArray(order?.accounts) ? order.accounts : []).forEach((item) => {
      const summary = touchSummary(item?.accountId);
      if (!summary) return;
      summary.orderCount += 1;
      pushProvider(summary, provider);
      if (!summary.latestOrderId) {
        summary.latestOrderId = orderId;
        summary.latestProvider = provider;
      }
    });
  });

  (Array.isArray(warrantyCases) ? warrantyCases : []).forEach((item) => {
    const provider = normalizeProvider(item?.provider);
    const orderId = String(item?.orderId || "").trim();
    const relatedIds = new Set();
    relatedIds.add(String(item?.rootAccountId || "").trim());
    relatedIds.add(String(item?.currentAccountId || "").trim());
    (Array.isArray(item?.rounds) ? item.rounds : []).forEach((round) => {
      relatedIds.add(String(round?.fromAccountId || "").trim());
      relatedIds.add(String(round?.toAccountId || "").trim());
    });
    relatedIds.forEach((accountId) => {
      const summary = touchSummary(accountId);
      if (!summary) return;
      summary.warrantyCount += 1;
      pushProvider(summary, provider);
      if (!summary.latestWarrantyOrderId) {
        summary.latestWarrantyOrderId = orderId;
      }
    });
  });

  return map;
};
const hasMarketplaceTraceSummary = (summary = {}) =>
  Number(summary?.orderCount || 0) > 0 ||
  Number(summary?.warrantyCount || 0) > 0;
const buildStoreWarrantyHoldTraceInfo = (account = {}) => {
  if (!hasStoreWarrantyHoldNote(account?.note)) return null;
  const summary =
    account?.storeTraceSummary && typeof account.storeTraceSummary === "object"
      ? account.storeTraceSummary
      : null;
  const traces = Array.isArray(summary?.traces) ? summary.traces : [];
  const holdTrace =
    traces.find((trace) => String(trace?.role || "").trim() === "warranty_from") ||
    traces.find((trace) => {
      const role = String(trace?.role || "").trim();
      return role === "assigned" || role === "root";
    }) ||
    traces[0] ||
    null;
  const orderId = String(holdTrace?.orderId || summary?.latestOrderId || "").trim();
  const packageName = String(
    holdTrace?.packageName || summary?.latestPackageName || "",
  ).trim();
  const customerName = String(
    holdTrace?.customerName || summary?.latestCustomerName || "",
  ).trim();
  const customerEmail = String(
    holdTrace?.customerEmail || summary?.latestCustomerEmail || "",
  ).trim();
  const createdAt = String(
    holdTrace?.createdAt || holdTrace?.fulfilledAt || holdTrace?.paidAt || "",
  ).trim();
  return {
    orderId,
    packageName,
    customerName,
    customerEmail,
    createdAt,
  };
};
const buildChatgptAccountCurrentState = (account = {}) => {
  const users = Array.isArray(account?.users) ? account.users : [];
  const userCount = users.length;
  const expiredAt = String(account?.expiredAt || "").trim();
  const expiredAtMs = new Date(expiredAt).getTime();
  const isExpired = !!expiredAt && Number.isFinite(expiredAtMs) && expiredAtMs <= Date.now();
  const storeTraceSummary = account?.storeTraceSummary || null;
  const marketplaceTraceSummary = account?.marketplaceTraceSummary || null;
  const traces = Array.isArray(storeTraceSummary?.traces)
    ? storeTraceSummary.traces
    : [];
  const latestAssignedTrace =
    traces.find((trace) => String(trace?.role || "").trim() === "assigned") ||
    traces.find((trace) => String(trace?.role || "").trim() === "root") ||
    null;
  const latestWarrantyToTrace =
    traces.find((trace) => String(trace?.role || "").trim() === "warranty_to") ||
    null;
  const latestActiveReservation =
    storeTraceSummary?.latestActiveReservation ||
    (Array.isArray(storeTraceSummary?.activeReservationTraces)
      ? storeTraceSummary.activeReservationTraces[0]
      : null) ||
    null;
  const warrantyHoldInfo = buildStoreWarrantyHoldTraceInfo(account);
  const hasManagedMarketplaceUser = users.some((user) =>
    isActiveMarketplaceManagedUser(user),
  );
  const hasMarketplaceBusy =
    hasMarketplaceTraceSummary(marketplaceTraceSummary) || hasManagedMarketplaceUser;

  let availabilityState = "sellable";
  let busyReason = "";
  let busyOrderId = "";
  let busySource = "";
  let busySince = "";

  if (isExpired) {
    availabilityState = "expired_unusable";
    busyReason = "Tài khoản đã hết hạn nên không thể bán, giữ chỗ hay bảo hành.";
    busySource = "expiry";
    busySince = expiredAt;
  } else if (latestActiveReservation) {
    availabilityState = "reserved_for_pending_store_order";
    busyOrderId = String(latestActiveReservation?.orderId || "").trim();
    busySource = "store_order";
    busySince = String(
      latestActiveReservation?.createdAt ||
        latestActiveReservation?.paidAt ||
        latestActiveReservation?.fulfilledAt ||
        "",
    ).trim();
    busyReason = busyOrderId
      ? `Đang giữ cho đơn web ${busyOrderId}.`
      : "Đang giữ cho đơn web chờ thanh toán.";
  } else if (warrantyHoldInfo) {
    availabilityState = "warranty_hold_source";
    busyOrderId = String(warrantyHoldInfo?.orderId || "").trim();
    busySource = "store_warranty";
    busySince = String(warrantyHoldInfo?.createdAt || "").trim();
    busyReason = busyOrderId
      ? `Nick lỗi đang được giữ cho bảo hành của đơn ${busyOrderId}.`
      : "Nick lỗi đang được giữ cho luồng bảo hành web.";
  } else if (hasMarketplaceBusy) {
    availabilityState = "busy_in_marketplace";
    busyOrderId =
      String(marketplaceTraceSummary?.latestWarrantyOrderId || "").trim() ||
      String(marketplaceTraceSummary?.latestOrderId || "").trim();
    busySource = Number(marketplaceTraceSummary?.warrantyCount || 0) > 0
      ? "marketplace_warranty"
      : "marketplace_order";
    busyReason =
      Number(marketplaceTraceSummary?.warrantyCount || 0) > 0
        ? `Nick đang dính bảo hành sàn ${busyOrderId || ""}.`.trim()
        : `Nick đã từng bán qua ${getMarketplaceProviderLabel(
            marketplaceTraceSummary?.latestProvider,
          )} ${busyOrderId || ""}.`.trim();
  } else if (latestWarrantyToTrace) {
    availabilityState = "busy_in_warranty_replacement";
    busyOrderId = String(latestWarrantyToTrace?.orderId || "").trim();
    busySource = "store_warranty";
    busySince = String(
      latestWarrantyToTrace?.createdAt ||
        latestWarrantyToTrace?.fulfilledAt ||
        latestWarrantyToTrace?.paidAt ||
        "",
    ).trim();
    busyReason = busyOrderId
      ? `Nick đang là acc thay thế của đơn web ${busyOrderId}.`
      : "Nick đang là acc thay thế của một đơn web.";
  } else if (userCount > 0 || latestAssignedTrace) {
    availabilityState = "assigned_to_store_order";
    busyOrderId = String(latestAssignedTrace?.orderId || "").trim();
    busySource = "account_users";
    busySince = String(
      latestAssignedTrace?.fulfilledAt ||
        latestAssignedTrace?.paidAt ||
        latestAssignedTrace?.createdAt ||
        users?.[0]?.joinedAt ||
        "",
    ).trim();
    const visibleNames = users
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean)
      .slice(0, 3);
    busyReason = visibleNames.length
      ? `Khách còn trên nick: ${visibleNames.join(", ")}.`
      : busyOrderId
        ? `Nick đang gắn với đơn web ${busyOrderId}.`
        : "Nick đang có khách trên tài khoản.";
  }

  return {
    availabilityState,
    busyReason,
    busyOrderId,
    busySource,
    busySince,
    isSellable:
      availabilityState === "sellable" &&
      userCount === 0 &&
      !hasMarketplaceBusy &&
      !latestActiveReservation &&
      !warrantyHoldInfo &&
      !latestWarrantyToTrace &&
      !isExpired,
    isWarrantyHold: availabilityState === "warranty_hold_source",
    isReservedForWeb: availabilityState === "reserved_for_pending_store_order",
    isBusyInMarketplace: availabilityState === "busy_in_marketplace",
    isBusyInWarrantyReplacement:
      availabilityState === "busy_in_warranty_replacement",
    hasAssignedUsers: userCount > 0,
    userCount,
    activeReservationOrderId: String(latestActiveReservation?.orderId || "").trim(),
    holdOrderId: String(warrantyHoldInfo?.orderId || "").trim(),
    warehouse: normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE),
  };
};
const pickChatgptCurrentStatePayload = (account = {}) => {
  const currentState =
    account?.currentAccountState && typeof account.currentAccountState === "object"
      ? account.currentAccountState
      : buildChatgptAccountCurrentState(account);
  return {
    availabilityState: String(currentState?.availabilityState || "").trim(),
    busyReason: String(currentState?.busyReason || "").trim(),
    busyOrderId: String(currentState?.busyOrderId || "").trim(),
    busySource: String(currentState?.busySource || "").trim(),
    busySince: String(currentState?.busySince || "").trim(),
    isSellable: !!currentState?.isSellable,
    isWarrantyHold: !!currentState?.isWarrantyHold,
    isReservedForWeb: !!currentState?.isReservedForWeb,
    isBusyInMarketplace: !!currentState?.isBusyInMarketplace,
    isBusyInWarrantyReplacement: !!currentState?.isBusyInWarrantyReplacement,
    hasAssignedUsers: !!currentState?.hasAssignedUsers,
    userCount: Number(currentState?.userCount || 0),
    activeReservationOrderId: String(
      currentState?.activeReservationOrderId || "",
    ).trim(),
    holdOrderId: String(currentState?.holdOrderId || "").trim(),
    warehouse: normalizePackage2Shelf(
      currentState?.warehouse,
      normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE),
    ),
  };
};
const enrichChatgptAccountWithOperationalState = (account = {}) => {
  const currentAccountState = pickChatgptCurrentStatePayload(account);
  return {
    ...account,
    currentAccountState,
    availabilityState: currentAccountState.availabilityState,
    busyReason: currentAccountState.busyReason,
    busyOrderId: currentAccountState.busyOrderId,
    busySource: currentAccountState.busySource,
    busySince: currentAccountState.busySince,
    isSellable: currentAccountState.isSellable,
    isWarrantyHold: currentAccountState.isWarrantyHold,
    isReservedForWeb: currentAccountState.isReservedForWeb,
    activeReservationOrderId: currentAccountState.activeReservationOrderId,
    holdOrderId: currentAccountState.holdOrderId,
  };
};
const buildStoreOrderReservedSnapshot = (order = {}) => {
  const raw =
    order?.reservedAccountSnapshot &&
    typeof order.reservedAccountSnapshot === "object"
      ? order.reservedAccountSnapshot
      : null;
  return {
    accountId: String(
      raw?.accountId || raw?.id || order?.reservedAccountId || "",
    ).trim(),
    username: String(
      raw?.username || order?.reservedAccountUsername || "",
    ).trim(),
    reservationType: String(
      raw?.reservationType || order?.reservationType || "",
    ).trim(),
    packageCode: String(raw?.packageCode || order?.packageCode || "").trim(),
    warehouse: normalizePackage2Shelf(
      raw?.warehouse || order?.assignedWarehouse || CHATGPT_TOTAL_VALUE,
      CHATGPT_TOTAL_VALUE,
    ),
    reservedAt: String(raw?.reservedAt || order?.createdAt || "").trim(),
  };
};
const buildStoreOrderOperationalState = (
  order = {},
  { accountStateMap = new Map() } = {},
) => {
  const normalizedStatus = normalizeStoreOrderStatusValue(order?.status);
  const reservedSnapshot = buildStoreOrderReservedSnapshot(order);
  const currentAccountId = String(
    order?.assignedAccountId || order?.rootAssignedAccountId || "",
  ).trim();
  const currentAccount =
    accountStateMap instanceof Map ? accountStateMap.get(currentAccountId) : null;
  const embeddedCurrentAccountState =
    order?.currentAccountState &&
    typeof order.currentAccountState === "object"
      ? order.currentAccountState
      : null;
  const currentAccountState = currentAccount
    ? pickChatgptCurrentStatePayload(currentAccount)
    : embeddedCurrentAccountState
      ? pickChatgptCurrentStatePayload({
          id: currentAccountId,
          currentAccountState: embeddedCurrentAccountState,
        })
      : null;

  let reservationState = String(order?.reservationState || "").trim();
  if (!reservationState) {
    if (!reservedSnapshot.accountId) {
      reservationState = "none";
    } else if (isStorePendingPaymentStatus(normalizedStatus)) {
      reservationState = "reserved_for_pending_store_order";
    } else if (normalizedStatus === "paid") {
      reservationState = "reserved_ready_for_fulfillment";
    } else if (normalizedStatus === "fulfilled") {
      reservationState = "consumed";
    } else if (normalizedStatus === "fulfillment_failed") {
      reservationState = "blocked";
    } else if (STORE_HIDDEN_ORDER_STATUSES.has(normalizedStatus)) {
      reservationState = "released";
    } else {
      reservationState = "reserved";
    }
  }

  let fulfillmentState = String(order?.fulfillmentState || "").trim();
  if (!fulfillmentState) {
    if (normalizedStatus === "fulfilled") {
      fulfillmentState = "fulfilled";
    } else if (normalizedStatus === "fulfillment_failed") {
      fulfillmentState = "failed";
    } else if (normalizedStatus === "paid") {
      fulfillmentState = "ready_for_fulfillment";
    } else if (isStorePendingPaymentStatus(normalizedStatus)) {
      fulfillmentState = "awaiting_payment";
    } else if (STORE_HIDDEN_ORDER_STATUSES.has(normalizedStatus)) {
      fulfillmentState = "cancelled";
    } else {
      fulfillmentState = normalizedStatus || "unknown";
    }
  }

  const fulfillmentReason = String(
    order?.fulfillmentReason ||
      (normalizedStatus === "fulfillment_failed" ? order?.momoMessage : "") ||
      "",
  ).trim();

  return {
    reservationState,
    reservedAccountSnapshot: reservedSnapshot.accountId ? reservedSnapshot : null,
    fulfillmentState,
    fulfillmentReason,
    currentAccountState,
  };
};
const resolveStoreWarrantyReplacementAction = ({
  packageCode = "",
  destinationType = "",
} = {}) => {
  const normalizedPackageCode = String(packageCode || "").trim();
  const normalizedDestinationType =
    String(destinationType || "unassigned").trim() || "unassigned";
  if (normalizedPackageCode === "package1") {
    return normalizedDestinationType === "package1"
      ? "store_package1_existing_replacement"
      : "store_package1_convertible_replacement";
  }
  if (normalizedPackageCode === "package2") {
    return normalizedDestinationType === "package2"
      ? "store_package2_existing_replacement"
      : "store_package2_convertible_replacement";
  }
  return "";
};
const attachStoreOrdersOperationalState = async (orders = []) => {
  const safeOrders = Array.isArray(orders) ? orders : [];
  if (safeOrders.length === 0) return [];
  const accountIds = Array.from(
    new Set(
      safeOrders
        .flatMap((order) => [
          order?.reservedAccountId,
          order?.assignedAccountId,
          order?.rootAssignedAccountId,
        ])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const accountStateMap = await loadChatgptAccountOperationalStateMap(accountIds);
  return safeOrders.map((order) => ({
    ...(order || {}),
    ...buildStoreOrderOperationalState(order, { accountStateMap }),
  }));
};
const sanitizeSingleStoreOrderWithOperationalState = async (order = null) => {
  const [operationalOrder] = await attachStoreOrdersOperationalState(order ? [order] : []);
  return sanitizeStoreOrder(operationalOrder || order);
};
const sanitizeSingleStoreOrderForAdminWithOperationalState = async (
  order = null,
  user = null,
) => {
  const [operationalOrder] = await attachStoreOrdersOperationalState(order ? [order] : []);
  return sanitizeStoreOrderForAdmin(operationalOrder || order, user);
};
const buildStoreOrderTraceAccountQuery = (accountIds = [], { excludeOrderId = "" } = {}) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [accountIds])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return { id: "__missing_chatgpt_trace_account__" };
  return {
    ...(excludeOrderId ? { id: { $ne: String(excludeOrderId || "").trim() } } : {}),
    status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
    $or: [
      { reservedAccountId: { $in: normalizedIds } },
      { assignedAccountId: { $in: normalizedIds } },
      { rootAssignedAccountId: { $in: normalizedIds } },
      { "warrantyRounds.fromAccountId": { $in: normalizedIds } },
      { "warrantyRounds.toAccountId": { $in: normalizedIds } },
    ],
  };
};
const decorateChatgptAccountsWithOperationalState = async (
  accounts = [],
  { excludeStoreOrderId = "" } = {},
) => {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  if (safeAccounts.length === 0) return [];
  const accountIds = safeAccounts
    .map((account) => String(account?.id || "").trim())
    .filter(Boolean);
  if (accountIds.length === 0) return safeAccounts;
  const [storeOrders, marketplaceOrders, marketplaceWarrantyCases] =
    await Promise.all([
      StoreOrder.find(
        buildStoreOrderTraceAccountQuery(accountIds, {
          excludeOrderId: excludeStoreOrderId,
        }),
      )
        .select(CHATGPT_ADMIN_STORE_ORDER_TRACE_SELECT)
        .lean(),
      DatammoOrder.find({
        scope: "chatgpt",
        "accounts.accountId": { $in: accountIds },
      })
        .select(CHATGPT_ADMIN_MARKETPLACE_ORDER_TRACE_SELECT)
        .lean(),
      DatammoWarrantyCase.find({
        scope: "chatgpt",
        $or: [
          { rootAccountId: { $in: accountIds } },
          { currentAccountId: { $in: accountIds } },
          { "rounds.fromAccountId": { $in: accountIds } },
          { "rounds.toAccountId": { $in: accountIds } },
        ],
      })
        .select(CHATGPT_ADMIN_MARKETPLACE_WARRANTY_TRACE_SELECT)
        .lean(),
    ]);
  const storeUsers = await loadStoreUsersForTraceOrders(storeOrders);
  const storeUserMap = new Map(
    (Array.isArray(storeUsers) ? storeUsers : []).map((user) => [
      String(user?.id || "").trim(),
      user,
    ]),
  );
  const storeTraceMap = buildStoreAccountTraceMap(storeOrders, storeUserMap);
  const marketplaceTraceMap = buildMarketplaceAccountTraceMap(
    marketplaceOrders,
    marketplaceWarrantyCases,
  );
  return safeAccounts.map((account) => {
    const normalizedAccount = {
      ...account,
      package2Shelf: normalizePackage2Shelf(
        account?.package2Shelf,
        CHATGPT_TOTAL_VALUE,
      ),
      storeTraceSummary:
        storeTraceMap.get(String(account?.id || "").trim()) || null,
      marketplaceTraceSummary:
        marketplaceTraceMap.get(String(account?.id || "").trim()) || null,
    };
    const reconciledAccount = {
      ...normalizedAccount,
      package2Shelf: normalizeChatgptMarketAccountState(normalizedAccount),
    };
    return enrichChatgptAccountWithOperationalState(reconciledAccount);
  });
};
const loadChatgptAccountOperationalStateMap = async (
  accountIds = [],
  options = {},
) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [accountIds])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return new Map();
  const accounts = await Account.find({ id: { $in: normalizedIds } })
    .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
    .lean();
  const decorated = await decorateChatgptAccountsWithOperationalState(
    accounts,
    options,
  );
  return new Map(
    decorated.map((account) => [String(account?.id || "").trim(), account]),
  );
};
const normalizeExpiryCleanupBatchStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    [
      "pending_approval",
      "approved",
      "rejected",
      "executed",
      "expired",
    ].includes(normalized)
  ) {
    return normalized;
  }
  return "pending_approval";
};
const getExpiryCleanupReasonLabel = (reasonCode = "") => {
  switch (String(reasonCode || "").trim()) {
    case "chatgpt_empty_expired":
      return "acc trong, da het han";
    case "chatgpt_with_expired_users_only":
      return "khach da het han";
    case "team_empty_expired":
      return "team trong, da het han";
    case "team_with_expired_slots_only":
      return "slot da het han";
    case "pkg2_market_expiring_soon":
      return "goi 2 market sap het han";
    default:
      return String(reasonCode || "").trim() || "khong ro";
  }
};
const getExpiryCleanupItemScopeLabel = (scope = "") =>
  String(scope || "").trim().toLowerCase() === "team" ? "Team" : "ChatGPT";
const sanitizeExpiryCleanupItem = (item = {}) => ({
  scope:
    String(item?.scope || "chatgpt").trim().toLowerCase() === "team"
      ? "team"
      : "chatgpt",
  itemId: String(item?.itemId || "").trim(),
  username: String(item?.username || "").trim(),
  accountType: String(item?.accountType || "").trim(),
  saleMode: String(item?.saleMode || "").trim(),
  warehouse: String(item?.warehouse || "").trim(),
  expiredAt: String(item?.expiredAt || "").trim(),
  reasonCode: String(item?.reasonCode || "").trim(),
  reasonLabel:
    String(item?.reasonLabel || "").trim() ||
    getExpiryCleanupReasonLabel(item?.reasonCode),
  activeUserCount: Math.max(0, Number(item?.activeUserCount || 0)),
  expiredUserCount: Math.max(0, Number(item?.expiredUserCount || 0)),
  activeSlotCount: Math.max(0, Number(item?.activeSlotCount || 0)),
  expiredSlotCount: Math.max(0, Number(item?.expiredSlotCount || 0)),
  expectedUpdatedAt: String(item?.expectedUpdatedAt || "").trim(),
  note: String(item?.note || "").trim(),
});
const sanitizeExpiryCleanupBatch = (
  batch = {},
  { includeItems = false, itemLimit = EXPIRY_CLEANUP_TELEGRAM_PREVIEW_LIMIT } = {},
) => {
  if (!batch || typeof batch !== "object") return null;
  const items = Array.isArray(batch?.items) ? batch.items : [];
  return {
    batchId: String(batch?.batchId || "").trim(),
    signature: String(batch?.signature || "").trim(),
    status: normalizeExpiryCleanupBatchStatus(batch?.status),
    summary:
      batch?.summary && typeof batch.summary === "object" ? batch.summary : {},
    items: includeItems
      ? items.slice(0, Math.max(1, Number(itemLimit || items.length))).map((item) =>
          sanitizeExpiryCleanupItem(item),
        )
      : [],
    itemCount: items.length,
    telegramMessageMeta:
      batch?.telegramMessageMeta && typeof batch.telegramMessageMeta === "object"
        ? batch.telegramMessageMeta
        : null,
    executionResult:
      batch?.executionResult && typeof batch.executionResult === "object"
        ? batch.executionResult
        : null,
    createdBy: String(batch?.createdBy || "").trim(),
    approvedBy: String(batch?.approvedBy || "").trim(),
    rejectedBy: String(batch?.rejectedBy || "").trim(),
    createdAt: String(batch?.createdAt || "").trim(),
    approvedAt: String(batch?.approvedAt || "").trim(),
    rejectedAt: String(batch?.rejectedAt || "").trim(),
    executedAt: String(batch?.executedAt || "").trim(),
    expiresAt: String(batch?.expiresAt || "").trim(),
    updatedAt: String(batch?.updatedAt || "").trim(),
  };
};
const buildExpiryCleanupSignature = (items = []) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        (Array.isArray(items) ? items : [])
          .map((item) => ({
            scope: String(item?.scope || "").trim(),
            itemId: String(item?.itemId || "").trim(),
            reasonCode: String(item?.reasonCode || "").trim(),
            expectedUpdatedAt: String(item?.expectedUpdatedAt || "").trim(),
          }))
          .sort((left, right) =>
            `${left.scope}:${left.itemId}:${left.reasonCode}`.localeCompare(
              `${right.scope}:${right.itemId}:${right.reasonCode}`,
            ),
          ),
      ),
    )
    .digest("hex");
const buildExpiryCleanupBatchSummary = (scan = {}) => {
  const summary = scan?.summary && typeof scan.summary === "object" ? scan.summary : {};
  const candidates = Array.isArray(scan?.candidates) ? scan.candidates : [];
  const warnings = Array.isArray(scan?.warnings) ? scan.warnings : [];
  return {
    scannedAt: String(summary?.scannedAt || new Date().toISOString()).trim(),
    chatgptEmptyExpired: Math.max(0, Number(summary?.chatgptEmptyExpired || 0)),
    chatgptExpiredUsersOnly: Math.max(
      0,
      Number(summary?.chatgptExpiredUsersOnly || 0),
    ),
    chatgptExpiredWithUsers: Math.max(
      0,
      Number(summary?.chatgptExpiredWithUsers || 0),
    ),
    teamEmptyExpired: Math.max(0, Number(summary?.teamEmptyExpired || 0)),
    teamExpiredSlotsOnly: Math.max(
      0,
      Number(summary?.teamExpiredSlotsOnly || 0),
    ),
    teamExpiredWithSlots: Math.max(
      0,
      Number(summary?.teamExpiredWithSlots || 0),
    ),
    pkg2MarketExpiringSoon: Math.max(
      0,
      Number(summary?.pkg2MarketExpiringSoon || 0),
    ),
    candidateCount: candidates.length,
    warningCount: warnings.length,
  };
};
const getTelegramNotificationRecipients = () =>
  [...TELEGRAM_NOTIFICATION_RECIPIENT_IDS];
const sendTelegramNotificationMessage = async (chatId, text, options = {}) => {
  const normalizedChatId = Number.parseInt(chatId, 10);
  if (!Number.isInteger(normalizedChatId) || !text || !TELEGRAM_BOT_TOKEN) {
    return null;
  }
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: normalizedChatId,
        text: String(text || ""),
        disable_web_page_preview: true,
        ...options,
      },
      { timeout: 15000 },
    );
    return response?.data?.result || null;
  } catch (error) {
    console.error(
      "Expiry cleanup telegram notify failed:",
      error?.response?.data || error?.message || error,
    );
    return null;
  }
};
const buildExpiryCleanupBatchTelegramText = (batch = {}) => {
  const safeBatch = sanitizeExpiryCleanupBatch(batch, {
    includeItems: true,
    itemLimit: EXPIRY_CLEANUP_TELEGRAM_PREVIEW_LIMIT,
  });
  if (!safeBatch) return "";
  const summary = safeBatch.summary || {};
  const lines = [
    "[CLEANUP PENDING]",
    `Batch: ${safeBatch.batchId}`,
    `Created: ${safeBatch.createdAt || "--"}`,
    `Candidates: ${safeBatch.itemCount}`,
    `ChatGPT empty expired: ${Number(summary.chatgptEmptyExpired || 0)}`,
    `ChatGPT customers expired: ${Number(summary.chatgptExpiredUsersOnly || 0)}`,
    `Team empty expired: ${Number(summary.teamEmptyExpired || 0)}`,
    `Team slots expired: ${Number(summary.teamExpiredSlotsOnly || 0)}`,
    `Pkg2 market <=25d: ${Number(summary.pkg2MarketExpiringSoon || 0)}`,
    "",
    "Preview:",
  ];
  safeBatch.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${getExpiryCleanupItemScopeLabel(item.scope)} | ${item.username || item.itemId} | ${item.reasonLabel} | ${item.expiredAt || "--"}`,
    );
  });
  if (safeBatch.itemCount > safeBatch.items.length) {
    lines.push(`+${safeBatch.itemCount - safeBatch.items.length} item nua`);
  }
  lines.push(
    "",
    `Lenh: /cleanup show ${safeBatch.batchId}`,
    `Lenh: /cleanup approve ${safeBatch.batchId}`,
    `Lenh: /cleanup reject ${safeBatch.batchId}`,
  );
  return lines.join("\n");
};
const notifyAdminsAboutExpiryCleanupBatch = async (batch = {}) => {
  const recipients = getTelegramNotificationRecipients();
  if (!TELEGRAM_BOT_TOKEN || recipients.length === 0) {
    return { sent: false, recipients: 0, messages: [] };
  }
  const text = buildExpiryCleanupBatchTelegramText(batch);
  if (!text) return { sent: false, recipients: recipients.length, messages: [] };
  const messages = [];
  for (const recipient of recipients) {
    const result = await sendTelegramNotificationMessage(recipient, text);
    if (result) {
      messages.push({
        chatId: Number(recipient),
        messageId: Number(result?.message_id || 0) || null,
        date: Number(result?.date || 0) || null,
      });
    }
  }
  return {
    sent: messages.length > 0,
    recipients: recipients.length,
    messages,
  };
};
const isDateExpiredNow = (value = "", nowMs = Date.now()) => {
  const time = parseStoreDateMs(value);
  return time > 0 && time <= nowMs;
};
const getChatgptExpiryUserStats = (account = {}) => {
  const users = Array.isArray(account?.users) ? account.users : [];
  let activeUserCount = 0;
  let expiredUserCount = 0;
  users.forEach((user) => {
    const remainingDays = getChatgptUserRemainingDays(user);
    if (remainingDays !== null && remainingDays <= 0) {
      expiredUserCount += 1;
    } else {
      activeUserCount += 1;
    }
  });
  return {
    totalUserCount: users.length,
    activeUserCount,
    expiredUserCount,
  };
};
const getTeamExpirySlotStats = (account = {}) => {
  const slots = normalizeTeamSlots(account?.slots);
  let activeSlotCount = 0;
  let expiredSlotCount = 0;
  slots.forEach((slot) => {
    if (!isFilledTeamSlot(slot)) return;
    if (isDateExpiredNow(slot?.expiredAt)) {
      expiredSlotCount += 1;
    } else {
      activeSlotCount += 1;
    }
  });
  return {
    filledSlotCount: slots.filter((slot) => isFilledTeamSlot(slot)).length,
    activeSlotCount,
    expiredSlotCount,
  };
};
const buildTeamMarketplaceTraceMap = async (accountIds = []) => {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [accountIds])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (normalizedIds.length === 0) return new Map();
  const [orders, warrantyCases] = await Promise.all([
    DatammoOrder.find({
      scope: "team",
      "accounts.accountId": { $in: normalizedIds },
    })
      .select(CHATGPT_ADMIN_MARKETPLACE_ORDER_TRACE_SELECT)
      .lean(),
    DatammoWarrantyCase.find({
      scope: "team",
      $or: [
        { rootAccountId: { $in: normalizedIds } },
        { currentAccountId: { $in: normalizedIds } },
        { "rounds.fromAccountId": { $in: normalizedIds } },
        { "rounds.toAccountId": { $in: normalizedIds } },
      ],
    })
      .select(CHATGPT_ADMIN_MARKETPLACE_WARRANTY_TRACE_SELECT)
      .lean(),
  ]);
  return buildMarketplaceAccountTraceMap(orders, warrantyCases);
};
const scanChatgptExpiryCleanupState = async () => {
  const nowMs = Date.now();
  const rawAccounts = await Account.find({})
    .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
    .lean();
  const expiredAccountIds = rawAccounts
    .filter((account) => isDateExpiredNow(account?.expiredAt, nowMs))
    .map((account) => String(account?.id || "").trim())
    .filter(Boolean);
  const decoratedMap = await loadChatgptAccountOperationalStateMap(expiredAccountIds);
  const summary = {
    chatgptEmptyExpired: 0,
    chatgptExpiredUsersOnly: 0,
    chatgptExpiredWithUsers: 0,
  };
  const candidates = [];
  const warnings = [];

  decoratedMap.forEach((account) => {
    const userStats = getChatgptExpiryUserStats(account);
    const isEmpty = userStats.totalUserCount === 0;
    const hasExpiredUsersOnly =
      userStats.totalUserCount > 0 && userStats.activeUserCount === 0;
    const hasActiveUsers = userStats.activeUserCount > 0;
    const hasActiveReservation =
      Number(account?.storeTraceSummary?.activeReservedOrders || 0) > 0 ||
      (Array.isArray(account?.storeTraceSummary?.activeReservationTraces) &&
        account.storeTraceSummary.activeReservationTraces.length > 0);
    const hasWarrantyHold = hasStoreWarrantyHoldNote(account?.note);
    const hasMarketplaceBusy = hasMarketplaceTraceSummary(
      account?.marketplaceTraceSummary,
    );
    const hasWarrantyReplacement = Array.isArray(account?.storeTraceSummary?.traces)
      ? account.storeTraceSummary.traces.some(
          (trace) => String(trace?.role || "").trim() === "warranty_to",
        )
      : false;
    if (isEmpty) {
      summary.chatgptEmptyExpired += 1;
    } else {
      summary.chatgptExpiredWithUsers += 1;
      if (hasExpiredUsersOnly) {
        summary.chatgptExpiredUsersOnly += 1;
      }
    }
    const baseItem = sanitizeExpiryCleanupItem({
      scope: "chatgpt",
      itemId: account?.id,
      username: account?.username,
      accountType: account?.type,
      warehouse: normalizePackage2Shelf(
        account?.package2Shelf,
        CHATGPT_TOTAL_VALUE,
      ),
      expiredAt: String(account?.expiredAt || "").trim(),
      activeUserCount: userStats.activeUserCount,
      expiredUserCount: userStats.expiredUserCount,
      expectedUpdatedAt: String(account?.updatedAt || "").trim(),
      note: String(account?.note || "").trim(),
    });
    if (
      (isEmpty || hasExpiredUsersOnly) &&
      !hasActiveUsers &&
      !hasActiveReservation &&
      !hasWarrantyHold &&
      !hasMarketplaceBusy &&
      !hasWarrantyReplacement
    ) {
      const reasonCode = isEmpty
        ? "chatgpt_empty_expired"
        : "chatgpt_with_expired_users_only";
      candidates.push({
        ...baseItem,
        reasonCode,
        reasonLabel: getExpiryCleanupReasonLabel(reasonCode),
      });
      return;
    }
    const warningReasons = [];
    if (hasActiveUsers) warningReasons.push("khach con han");
    if (hasActiveReservation) warningReasons.push("dang reserve");
    if (hasWarrantyHold) warningReasons.push("giu warranty");
    if (hasMarketplaceBusy) warningReasons.push("dang ban san");
    if (hasWarrantyReplacement) warningReasons.push("acc thay the");
    warnings.push({
      ...baseItem,
      reasonCode: "chatgpt_blocked_expired",
      reasonLabel: warningReasons.join(", ") || "khong du dieu kien xoa",
    });
  });

  const pkg2MarketExpiringSoon = rawAccounts
    .filter((account) => String(account?.type || "").trim() === "package2")
    .filter(
      (account) =>
        normalizePackage2Shelf(account?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
        CHATGPT_MARKET_VALUE,
    )
    .filter(
      (account) => (Array.isArray(account?.users) ? account.users.length : 0) === 0,
    )
    .filter((account) => {
      const expiredAtMs = parseStoreDateMs(account?.expiredAt);
      if (!expiredAtMs || expiredAtMs <= nowMs) return false;
      const daysLeft = Math.ceil((expiredAtMs - nowMs) / 86400000);
      return daysLeft > 0 && daysLeft <= PACKAGE2_MIN_DAYS_FOR_SALE;
    })
    .map((account) =>
      sanitizeExpiryCleanupItem({
        scope: "chatgpt",
        itemId: account?.id,
        username: account?.username,
        accountType: account?.type,
        warehouse: normalizePackage2Shelf(
          account?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
        expiredAt: String(account?.expiredAt || "").trim(),
        reasonCode: "pkg2_market_expiring_soon",
        reasonLabel: getExpiryCleanupReasonLabel("pkg2_market_expiring_soon"),
        expectedUpdatedAt: String(account?.updatedAt || "").trim(),
      }),
    );

  return {
    summary,
    candidates,
    warnings,
    pkg2MarketExpiringSoon,
  };
};
const scanTeamExpiryCleanupState = async () => {
  const nowMs = Date.now();
  const rawTeamAccounts = await TeamAccount.find({})
    .select("id username saleMode warehouse note slots expiredAt updatedAt")
    .lean();
  const expiredTeamAccounts = rawTeamAccounts.filter((account) =>
    isDateExpiredNow(account?.expiredAt, nowMs),
  );
  const traceMap = await buildTeamMarketplaceTraceMap(
    expiredTeamAccounts.map((account) => String(account?.id || "").trim()),
  );
  const summary = {
    teamEmptyExpired: 0,
    teamExpiredSlotsOnly: 0,
    teamExpiredWithSlots: 0,
  };
  const candidates = [];
  const warnings = [];

  expiredTeamAccounts.forEach((account) => {
    const slotStats = getTeamExpirySlotStats(account);
    const isEmpty = slotStats.filledSlotCount === 0;
    const hasExpiredSlotsOnly =
      slotStats.filledSlotCount > 0 && slotStats.activeSlotCount === 0;
    const hasActiveSlots = slotStats.activeSlotCount > 0;
    const hasMarketplaceBusy = hasMarketplaceTraceSummary(
      traceMap.get(String(account?.id || "").trim()) || null,
    );
    if (isEmpty) {
      summary.teamEmptyExpired += 1;
    } else {
      summary.teamExpiredWithSlots += 1;
      if (hasExpiredSlotsOnly) {
        summary.teamExpiredSlotsOnly += 1;
      }
    }
    const baseItem = sanitizeExpiryCleanupItem({
      scope: "team",
      itemId: account?.id,
      username: account?.username,
      saleMode: normalizeTeamSaleMode(account?.saleMode),
      warehouse: normalizeTeamWarehouse(account?.warehouse, TEAM_WAREHOUSE_TOTAL),
      expiredAt: String(account?.expiredAt || "").trim(),
      activeSlotCount: slotStats.activeSlotCount,
      expiredSlotCount: slotStats.expiredSlotCount,
      expectedUpdatedAt: String(account?.updatedAt || "").trim(),
      note: String(account?.note || "").trim(),
    });
    if ((isEmpty || hasExpiredSlotsOnly) && !hasActiveSlots && !hasMarketplaceBusy) {
      const reasonCode = isEmpty
        ? "team_empty_expired"
        : "team_with_expired_slots_only";
      candidates.push({
        ...baseItem,
        reasonCode,
        reasonLabel: getExpiryCleanupReasonLabel(reasonCode),
      });
      return;
    }
    const warningReasons = [];
    if (hasActiveSlots) warningReasons.push("slot con han");
    if (hasMarketplaceBusy) warningReasons.push("dang ban san");
    warnings.push({
      ...baseItem,
      reasonCode: "team_blocked_expired",
      reasonLabel: warningReasons.join(", ") || "khong du dieu kien xoa",
    });
  });

  return {
    summary,
    candidates,
    warnings,
  };
};
const scanExpiryCleanupState = async () => {
  const scannedAt = new Date().toISOString();
  const [chatgptScan, teamScan] = await Promise.all([
    scanChatgptExpiryCleanupState(),
    scanTeamExpiryCleanupState(),
  ]);
  const candidates = [
    ...(Array.isArray(chatgptScan?.candidates) ? chatgptScan.candidates : []),
    ...(Array.isArray(teamScan?.candidates) ? teamScan.candidates : []),
  ];
  const warnings = [
    ...(Array.isArray(chatgptScan?.warnings) ? chatgptScan.warnings : []),
    ...(Array.isArray(teamScan?.warnings) ? teamScan.warnings : []),
  ];
  const summary = buildExpiryCleanupBatchSummary({
    summary: {
      scannedAt,
      ...(chatgptScan?.summary || {}),
      ...(teamScan?.summary || {}),
      pkg2MarketExpiringSoon: Array.isArray(chatgptScan?.pkg2MarketExpiringSoon)
        ? chatgptScan.pkg2MarketExpiringSoon.length
        : 0,
    },
    candidates,
    warnings,
  });
  return {
    scannedAt,
    summary,
    candidates,
    warnings,
    pkg2MarketExpiringSoon: Array.isArray(chatgptScan?.pkg2MarketExpiringSoon)
      ? chatgptScan.pkg2MarketExpiringSoon
      : [],
  };
};
const buildDefaultExpiryCleanupSnapshot = () => ({
  id: EXPIRY_CLEANUP_SNAPSHOT_ID,
  summary: buildExpiryCleanupBatchSummary({
    summary: { scannedAt: "" },
    candidates: [],
    warnings: [],
  }),
  latestPendingBatchId: "",
  latestExecutedBatchId: "",
  latestRejectedBatchId: "",
  latestExpiredBatchId: "",
  lastScanAt: "",
  updatedAt: "",
});
const getExpiryCleanupSnapshot = async () => {
  const snapshot = await ExpiryCleanupSnapshot.findOne({
    id: EXPIRY_CLEANUP_SNAPSHOT_ID,
  })
    .lean()
    .catch(() => null);
  return snapshot ? { ...buildDefaultExpiryCleanupSnapshot(), ...snapshot } : null;
};
const listRecentExpiryCleanupBatches = async ({
  status = "",
  limit = 10,
} = {}) => {
  const normalizedStatus = normalizeExpiryCleanupBatchStatus(status);
  const query =
    normalizedStatus && normalizedStatus !== "all"
      ? { status: normalizedStatus }
      : {};
  const safeLimit = Math.min(Math.max(Number(limit || 10), 1), 50);
  const items = await ExpiryCleanupBatch.find(query)
    .sort({ createdAt: -1, updatedAt: -1 })
    .limit(safeLimit)
    .lean();
  return Array.isArray(items)
    ? items.map((item) => sanitizeExpiryCleanupBatch(item))
    : [];
};
const findExpiryCleanupBatchById = async (batchId = "") => {
  const normalizedId = String(batchId || "").trim();
  if (!normalizedId) return null;
  const batch = await ExpiryCleanupBatch.findOne({ batchId: normalizedId }).lean();
  return batch ? sanitizeExpiryCleanupBatch(batch, { includeItems: true }) : null;
};
const shouldSuppressRejectedExpiryCleanupBatch = (batch = {}, signature = "") => {
  const normalizedSignature = String(signature || "").trim();
  if (!normalizedSignature) return false;
  if (String(batch?.signature || "").trim() !== normalizedSignature) return false;
  const rejectedAtMs = parseStoreDateMs(batch?.rejectedAt || batch?.updatedAt);
  if (!rejectedAtMs) return false;
  return Date.now() - rejectedAtMs <= EXPIRY_CLEANUP_REJECT_SUPPRESS_MS;
};
const expirePendingExpiryCleanupBatchesIfNeeded = async () => {
  const nowIso = new Date().toISOString();
  const pendingBatches = await ExpiryCleanupBatch.find({
    status: "pending_approval",
    expiresAt: { $lte: nowIso, $ne: "" },
  }).lean();
  if (!Array.isArray(pendingBatches) || pendingBatches.length === 0) {
    return [];
  }
  const expiredIds = pendingBatches
    .map((item) => String(item?.batchId || "").trim())
    .filter(Boolean);
  if (expiredIds.length === 0) return [];
  await ExpiryCleanupBatch.updateMany(
    { batchId: { $in: expiredIds }, status: "pending_approval" },
    {
      $set: {
        status: "expired",
        updatedAt: nowIso,
      },
    },
  );
  return expiredIds;
};
const refreshExpiryCleanupSnapshot = async ({
  createBatch = false,
  notifyTelegram = false,
} = {}) => {
  await expirePendingExpiryCleanupBatchesIfNeeded();
  const scan = await scanExpiryCleanupState();
  const pendingBatch = await ExpiryCleanupBatch.findOne({
    status: "pending_approval",
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();
  const latestExecutedBatch = await ExpiryCleanupBatch.findOne({
    status: "executed",
  })
    .sort({ executedAt: -1, updatedAt: -1 })
    .lean();
  const latestRejectedBatch = await ExpiryCleanupBatch.findOne({
    status: "rejected",
  })
    .sort({ rejectedAt: -1, updatedAt: -1 })
    .lean();
  const latestExpiredBatch = await ExpiryCleanupBatch.findOne({
    status: "expired",
  })
    .sort({ updatedAt: -1 })
    .lean();

  const candidateSignature = buildExpiryCleanupSignature(scan?.candidates || []);
  let createdBatch = null;
  let telegramResult = null;
  const canCreateBatch =
    createBatch &&
    !pendingBatch &&
    Array.isArray(scan?.candidates) &&
    scan.candidates.length > 0 &&
    !shouldSuppressRejectedExpiryCleanupBatch(
      latestRejectedBatch,
      candidateSignature,
    );

  if (canCreateBatch) {
    const nowIso = new Date().toISOString();
    const createdDoc = await ExpiryCleanupBatch.create({
      batchId: createStoreId("cleanup"),
      signature: candidateSignature,
      status: "pending_approval",
      summary: buildExpiryCleanupBatchSummary(scan),
      items: (scan.candidates || []).slice(0, EXPIRY_CLEANUP_BATCH_PREVIEW_LIMIT),
      createdBy: "cron",
      approvedBy: "",
      rejectedBy: "",
      executionResult: null,
      telegramMessageMeta: null,
      createdAt: nowIso,
      approvedAt: "",
      rejectedAt: "",
      executedAt: "",
      expiresAt: new Date(
        Date.now() + EXPIRY_CLEANUP_PENDING_TTL_MS,
      ).toISOString(),
      updatedAt: nowIso,
    });
    createdBatch =
      createdDoc && typeof createdDoc.toObject === "function"
        ? createdDoc.toObject()
        : snapshotDocument(createdDoc);
    if (notifyTelegram) {
      telegramResult = await notifyAdminsAboutExpiryCleanupBatch(createdBatch);
      if (telegramResult?.sent) {
        await ExpiryCleanupBatch.updateOne(
          { batchId: String(createdBatch?.batchId || "").trim() },
          {
            $set: {
              telegramMessageMeta: {
                sent: true,
                sentAt: new Date().toISOString(),
                recipients: Array.isArray(telegramResult?.recipients)
                  ? telegramResult.recipients
                  : [],
                results: Array.isArray(telegramResult?.results)
                  ? telegramResult.results
                  : [],
              },
              updatedAt: new Date().toISOString(),
            },
          },
        );
        createdBatch.telegramMessageMeta = {
          sent: true,
          sentAt: new Date().toISOString(),
          recipients: Array.isArray(telegramResult?.recipients)
            ? telegramResult.recipients
            : [],
          results: Array.isArray(telegramResult?.results)
            ? telegramResult.results
            : [],
        };
      }
    }
  }

  const snapshotPayload = {
    id: EXPIRY_CLEANUP_SNAPSHOT_ID,
    summary: buildExpiryCleanupBatchSummary(scan),
    latestPendingBatchId: String(
      createdBatch?.batchId || pendingBatch?.batchId || "",
    ).trim(),
    latestExecutedBatchId: String(latestExecutedBatch?.batchId || "").trim(),
    latestRejectedBatchId: String(latestRejectedBatch?.batchId || "").trim(),
    latestExpiredBatchId: String(latestExpiredBatch?.batchId || "").trim(),
    lastScanAt: String(scan?.scannedAt || new Date().toISOString()).trim(),
    updatedAt: new Date().toISOString(),
  };
  await ExpiryCleanupSnapshot.findOneAndUpdate(
    { id: EXPIRY_CLEANUP_SNAPSHOT_ID },
    { $set: snapshotPayload },
    { upsert: true, new: true },
  );

  return {
    scan,
    snapshot: { ...buildDefaultExpiryCleanupSnapshot(), ...snapshotPayload },
    pendingBatch: pendingBatch ? sanitizeExpiryCleanupBatch(pendingBatch) : null,
    createdBatch: createdBatch
      ? sanitizeExpiryCleanupBatch(createdBatch, { includeItems: true })
      : null,
    telegramResult,
  };
};
const getFreshExpiryCleanupSnapshot = async ({ allowStale = true } = {}) => {
  const snapshot = await getExpiryCleanupSnapshot();
  const lastScanAtMs = parseStoreDateMs(snapshot?.lastScanAt);
  if (
    allowStale &&
    snapshot &&
    lastScanAtMs &&
    Date.now() - lastScanAtMs <= EXPIRY_CLEANUP_SNAPSHOT_TTL_MS
  ) {
    return snapshot;
  }
  const refreshed = await refreshExpiryCleanupSnapshot({
    createBatch: false,
    notifyTelegram: false,
  });
  return refreshed?.snapshot || buildDefaultExpiryCleanupSnapshot();
};
const buildExpiryCleanupExecutionSkipReason = (item = {}, reason = "") => ({
  itemId: String(item?.itemId || "").trim(),
  username: String(item?.username || "").trim(),
  scope: String(item?.scope || "").trim(),
  reason: String(reason || "skip").trim(),
});
const executeExpiryCleanupBatch = async (
  batchId = "",
  { actor = "", actorSource = "" } = {},
) => {
  const normalizedBatchId = String(batchId || "").trim();
  if (!normalizedBatchId) {
    const error = new Error("Thieu batchId cleanup.");
    error.statusCode = 400;
    throw error;
  }
  const lockToken = createStoreId("cleanup_lock");
  const nowIso = new Date().toISOString();
  let lockedBatch = await ExpiryCleanupBatch.findOneAndUpdate(
    {
      batchId: normalizedBatchId,
      status: "pending_approval",
    },
    {
      $set: {
        status: "approved",
        approvedAt: nowIso,
        approvedBy: String(actor || "").trim(),
        updatedAt: nowIso,
        executionResult: {
          state: "executing",
          actorSource: String(actorSource || "").trim(),
          actor: String(actor || "").trim(),
          startedAt: nowIso,
          lockToken,
        },
      },
    },
    { new: true },
  );
  if (!lockedBatch) {
    const existingBatch = await ExpiryCleanupBatch.findOne({
      batchId: normalizedBatchId,
    }).lean();
    if (!existingBatch) {
      const error = new Error("Khong tim thay batch cleanup.");
      error.statusCode = 404;
      throw error;
    }
    return {
      batch: sanitizeExpiryCleanupBatch(existingBatch, { includeItems: true }),
      result:
        existingBatch?.executionResult && typeof existingBatch.executionResult === "object"
          ? existingBatch.executionResult
          : null,
      skippedExecution: true,
    };
  }

  const rawBatch =
    lockedBatch && typeof lockedBatch.toObject === "function"
      ? lockedBatch.toObject()
      : snapshotDocument(lockedBatch);
  const items = Array.isArray(rawBatch?.items) ? rawBatch.items : [];
  const deleted = [];
  const skipped = [];
  const errors = [];

  for (const item of items) {
    try {
      const itemId = String(item?.itemId || "").trim();
      const expectedUpdatedAt = getExpectedUpdatedAtValue(item?.expectedUpdatedAt);
      if (!itemId || !expectedUpdatedAt) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(
            item,
            "thieu itemId hoac expectedUpdatedAt",
          ),
        );
        continue;
      }
      if (String(item?.scope || "").trim() === "team") {
        const teamAccount = await TeamAccount.findOne({ id: itemId }).lean();
        if (!teamAccount) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(item, "team da bi xoa truoc do"),
          );
          continue;
        }
        if (getExpectedUpdatedAtValue(teamAccount?.updatedAt) !== expectedUpdatedAt) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(
              item,
              "team vua bi cap nhat boi thao tac khac",
            ),
          );
          continue;
        }
        if (!isDateExpiredNow(teamAccount?.expiredAt)) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(item, "team khong con het han"),
          );
          continue;
        }
        const slotStats = getTeamExpirySlotStats(teamAccount);
        if (slotStats.activeSlotCount > 0) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(item, "team con slot con han"),
          );
          continue;
        }
        const teamTraceMap = await buildTeamMarketplaceTraceMap([itemId]);
        if (hasMarketplaceTraceSummary(teamTraceMap.get(itemId) || null)) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(item, "team dang ban san"),
          );
          continue;
        }
        const deletedDoc = await TeamAccount.findOneAndDelete(
          buildConditionalUpdateFilter(itemId, expectedUpdatedAt),
        ).lean();
        if (!deletedDoc) {
          skipped.push(
            buildExpiryCleanupExecutionSkipReason(
              item,
              "team khong con khop version khi xoa",
            ),
          );
          continue;
        }
        deleted.push({
          scope: "team",
          itemId,
          username: String(deletedDoc?.username || "").trim(),
        });
        continue;
      }

      const decoratedMap = await loadChatgptAccountOperationalStateMap([itemId]);
      const account = decoratedMap.get(itemId) || null;
      if (!account) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc da bi xoa truoc do"),
        );
        continue;
      }
      if (getExpectedUpdatedAtValue(account?.updatedAt) !== expectedUpdatedAt) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(
            item,
            "acc vua bi cap nhat boi thao tac khac",
          ),
        );
        continue;
      }
      if (!isDateExpiredNow(account?.expiredAt)) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc khong con het han"),
        );
        continue;
      }
      const userStats = getChatgptExpiryUserStats(account);
      const hasActiveReservation =
        Number(account?.storeTraceSummary?.activeReservedOrders || 0) > 0 ||
        (Array.isArray(account?.storeTraceSummary?.activeReservationTraces) &&
          account.storeTraceSummary.activeReservationTraces.length > 0);
      const hasWarrantyHold = hasStoreWarrantyHoldNote(account?.note);
      const hasMarketplaceBusy = hasMarketplaceTraceSummary(
        account?.marketplaceTraceSummary,
      );
      const hasWarrantyReplacement = Array.isArray(account?.storeTraceSummary?.traces)
        ? account.storeTraceSummary.traces.some(
            (trace) => String(trace?.role || "").trim() === "warranty_to",
          )
        : false;
      if (userStats.activeUserCount > 0) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc con khach con han"),
        );
        continue;
      }
      if (hasActiveReservation) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc dang duoc reserve"),
        );
        continue;
      }
      if (hasWarrantyHold) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc dang giu warranty"),
        );
        continue;
      }
      if (hasMarketplaceBusy) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc dang ban san"),
        );
        continue;
      }
      if (hasWarrantyReplacement) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(item, "acc dang la acc thay the"),
        );
        continue;
      }
      const deletedDoc = await Account.findOneAndDelete(
        buildConditionalUpdateFilter(itemId, expectedUpdatedAt),
      ).lean();
      if (!deletedDoc) {
        skipped.push(
          buildExpiryCleanupExecutionSkipReason(
            item,
            "acc khong con khop version khi xoa",
          ),
        );
        continue;
      }
      deleted.push({
        scope: "chatgpt",
        itemId,
        username: String(deletedDoc?.username || "").trim(),
      });
    } catch (error) {
      errors.push({
        itemId: String(item?.itemId || "").trim(),
        username: String(item?.username || "").trim(),
        scope: String(item?.scope || "").trim(),
        error: String(error?.message || error || "cleanup_error").trim(),
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const executionResult = {
    state: "executed",
    actorSource: String(actorSource || "").trim(),
    actor: String(actor || "").trim(),
    startedAt: String(rawBatch?.executionResult?.startedAt || nowIso).trim(),
    finishedAt,
    deletedCount: deleted.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    deleted,
    skipped,
    errors,
    lockToken,
  };
  await ExpiryCleanupBatch.updateOne(
    {
      batchId: normalizedBatchId,
      "executionResult.lockToken": lockToken,
    },
    {
      $set: {
        status: "executed",
        executedAt: finishedAt,
        updatedAt: finishedAt,
        executionResult,
      },
    },
  );
  if (deleted.length > 0) {
    bumpDataVersion();
    notifyClients();
  }
  await refreshExpiryCleanupSnapshot({ createBatch: false, notifyTelegram: false });
  const finalBatch = await ExpiryCleanupBatch.findOne({
    batchId: normalizedBatchId,
  }).lean();
  return {
    batch: finalBatch
      ? sanitizeExpiryCleanupBatch(finalBatch, { includeItems: true })
      : sanitizeExpiryCleanupBatch(rawBatch, { includeItems: true }),
    result: executionResult,
    skippedExecution: false,
  };
};
const rejectExpiryCleanupBatch = async (
  batchId = "",
  { actor = "", actorSource = "" } = {},
) => {
  const normalizedBatchId = String(batchId || "").trim();
  if (!normalizedBatchId) {
    const error = new Error("Thieu batchId cleanup.");
    error.statusCode = 400;
    throw error;
  }
  const rejectedAt = new Date().toISOString();
  const batch = await ExpiryCleanupBatch.findOneAndUpdate(
    {
      batchId: normalizedBatchId,
      status: "pending_approval",
    },
    {
      $set: {
        status: "rejected",
        rejectedAt,
        rejectedBy: String(actor || "").trim(),
        updatedAt: rejectedAt,
        executionResult: {
          state: "rejected",
          actorSource: String(actorSource || "").trim(),
          actor: String(actor || "").trim(),
          finishedAt: rejectedAt,
        },
      },
    },
    { new: true },
  );
  if (!batch) {
    const existingBatch = await ExpiryCleanupBatch.findOne({
      batchId: normalizedBatchId,
    }).lean();
    if (!existingBatch) {
      const error = new Error("Khong tim thay batch cleanup.");
      error.statusCode = 404;
      throw error;
    }
    return sanitizeExpiryCleanupBatch(existingBatch, { includeItems: true });
  }
  await refreshExpiryCleanupSnapshot({ createBatch: false, notifyTelegram: false });
  const safeBatch =
    batch && typeof batch.toObject === "function" ? batch.toObject() : snapshotDocument(batch);
  return sanitizeExpiryCleanupBatch(safeBatch, { includeItems: true });
};
const buildChatgptActionDecision = (account = {}, action = "", options = {}) => {
  const currentState = pickChatgptCurrentStatePayload(account);
  const reasons = [];
  const sourceType = String(options?.sourceType || "").trim();
  const destinationType = String(account?.type || "unassigned").trim() || "unassigned";
  const userCount = Number(currentState?.userCount || 0);
  const warehouse = normalizePackage2Shelf(
    account?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  );
  const minExpiryMs = new Date(buildStoreTotalMinExpiredAtIso()).getTime();
  const expiryMs = new Date(String(account?.expiredAt || "").trim()).getTime();

  const pushReason = (code, message, statusCode = 409) => {
    reasons.push({ code, message, statusCode });
  };

  if (String(options?.sourceId || "").trim() === String(account?.id || "").trim()) {
    pushReason("same_source_account", "Không thể chọn chính tài khoản nguồn.", 400);
  }
  if (currentState.isReservedForWeb) {
    pushReason(
      "reserved_for_pending_store_order",
      currentState.busyReason || "Nick đang được giữ cho đơn web chờ thanh toán.",
    );
  }
  if (currentState.isWarrantyHold) {
    pushReason(
      "warranty_hold_source",
      currentState.busyReason || "Nick lỗi đang được giữ cho luồng bảo hành.",
    );
  }
  if (currentState.isBusyInWarrantyReplacement) {
    pushReason(
      "busy_in_warranty_replacement",
      currentState.busyReason || "Nick đang là acc thay thế của đơn/web warranty khác.",
    );
  }
  if (currentState.isBusyInMarketplace) {
    pushReason(
      "busy_in_marketplace",
      currentState.busyReason || "Nick đang dính order/bảo hành sàn.",
      400,
    );
  }
  if (currentState.availabilityState === "expired_unusable") {
    pushReason(
      "expired_unusable",
      currentState.busyReason || "Tài khoản đã hết hạn.",
      400,
    );
  }

  const requireTotalWarehouse = [
    "store_package1_existing_sale",
    "store_package1_convertible_sale",
    "store_package2_existing_sale",
    "store_package2_convertible_sale",
    "store_package1_existing_replacement",
    "store_package1_convertible_replacement",
    "store_package2_existing_replacement",
    "store_package2_convertible_replacement",
    "move_destination",
  ].includes(action);
  if (requireTotalWarehouse && warehouse !== CHATGPT_TOTAL_VALUE) {
    pushReason("not_in_total_pool", "Tài khoản này không nằm trong kho tổng.", 400);
  }

  const requireLongEnoughExpiry = action.startsWith("store_");
  if (
    requireLongEnoughExpiry &&
    Number.isFinite(expiryMs) &&
    expiryMs <= minExpiryMs
  ) {
    pushReason(
      "near_expiry_unusable",
      "Tài khoản không đủ số ngày tối thiểu để dùng cho bán/bảo hành web.",
      400,
    );
  }

  if (action === "move_destination") {
    if (destinationType === sourceType) {
      if (sourceType === "package1" && userCount >= 3) {
        pushReason("destination_full", "Tài khoản Shared đích đã đầy (3/3).", 400);
      }
      if (sourceType === "package2" && userCount >= 1) {
        pushReason("destination_full", "Tài khoản Private đích đã đầy (1/1).", 400);
      }
    } else if (destinationType === "unassigned") {
      if (sourceType === "package1" && userCount >= 3) {
        pushReason("destination_full", "Tài khoản đích đã đầy slot.", 400);
      }
      if (sourceType === "package2" && userCount >= 1) {
        pushReason("destination_full", "Tài khoản đích đã có người dùng.", 400);
      }
    } else {
      pushReason(
        "type_mismatch",
        "Chỉ được chuyển vào gói cùng loại hoặc tài khoản chưa phân loại.",
        400,
      );
    }
  }

  if (action === "chatgpt_warranty_replacement") {
    if (!supportsChatgptWarrantyReplacement(destinationType)) {
      pushReason(
        "type_mismatch",
        "Bảo hành seller chỉ nhận acc Private hoặc acc chưa chọn.",
        400,
      );
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Tài khoản thay thế đang có khách.", 400);
    }
  }

  if (action === "store_package1_existing_sale") {
    if (destinationType !== "package1") {
      pushReason("type_mismatch", "Acc này không phải Gói 1 đang bán.", 400);
    }
    if (userCount >= 3) {
      pushReason("destination_full", "Acc Shared này đã đầy slot.", 400);
    }
  }
  if (action === "store_package1_convertible_sale") {
    if (destinationType !== "unassigned") {
      pushReason("type_mismatch", "Acc này không phải acc chưa chọn.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc chưa chọn này đang có khách.", 400);
    }
  }
  if (action === "store_package2_existing_sale") {
    if (destinationType !== "package2") {
      pushReason("type_mismatch", "Acc này không phải Gói 2 đang bán.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc Gói 2 này đang có khách.", 400);
    }
  }
  if (action === "store_package2_convertible_sale") {
    if (destinationType !== "unassigned") {
      pushReason("type_mismatch", "Acc này không phải acc chưa chọn.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc chưa chọn này đang có khách.", 400);
    }
  }
  if (action === "store_package1_existing_replacement") {
    if (destinationType !== "package1") {
      pushReason("type_mismatch", "Acc thay thế này không phải Gói 1.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc thay thế đang có khách.", 400);
    }
  }
  if (action === "store_package1_convertible_replacement") {
    if (destinationType !== "unassigned") {
      pushReason("type_mismatch", "Acc thay thế này không phải acc chưa chọn.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc thay thế đang có khách.", 400);
    }
  }
  if (action === "store_package2_existing_replacement") {
    if (destinationType !== "package2") {
      pushReason("type_mismatch", "Acc thay thế này không phải Gói 2.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc thay thế đang có khách.", 400);
    }
  }
  if (action === "store_package2_convertible_replacement") {
    if (destinationType !== "unassigned") {
      pushReason("type_mismatch", "Acc thay thế này không phải acc chưa chọn.", 400);
    }
    if (userCount > 0) {
      pushReason("has_existing_customer", "Acc thay thế đang có khách.", 400);
    }
  }

  return {
    allowed: reasons.length === 0,
    primaryReason: reasons[0] || null,
    reasons,
  };
};
const buildChatgptAccountAdminDiagnostics = async (accountId = "") => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return null;
  const normalizeProvider = (value = "") =>
    String(value || "").trim().toLowerCase() === "shopmini"
      ? "shopmini"
      : "datammo";
  const [account, storeOrders, marketplaceOrders, warrantyCases] =
    await Promise.all([
      Account.findOne({ id: normalizedId }).lean(),
      StoreOrder.find({
        $or: [
          { assignedAccountId: normalizedId },
          { reservedAccountId: normalizedId },
          { rootAssignedAccountId: normalizedId },
          { "warrantyRounds.fromAccountId": normalizedId },
          { "warrantyRounds.toAccountId": normalizedId },
        ],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
      DatammoOrder.find({
        scope: "chatgpt",
        "accounts.accountId": normalizedId,
      })
        .sort({ createdAt: -1 })
        .lean(),
      DatammoWarrantyCase.find({
        scope: "chatgpt",
        $or: [
          { rootAccountId: normalizedId },
          { currentAccountId: normalizedId },
          { "rounds.fromAccountId": normalizedId },
          { "rounds.toAccountId": normalizedId },
        ],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
    ]);

  return {
    accountId: normalizedId,
    username: String(account?.username || "").trim(),
    type: String(account?.type || "").trim(),
    package2Shelf: normalizePackage2Shelf(
      account?.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    ),
    users: (Array.isArray(account?.users) ? account.users : []).map((user) => ({
      name: String(user?.name || "").trim(),
      joinedAt: String(user?.joinedAt || "").trim(),
      expiredAt: String(user?.expiredAt || "").trim(),
    })),
    storeOrders: (Array.isArray(storeOrders) ? storeOrders : []).map((order) => ({
      id: String(order?.id || "").trim(),
      status: normalizeStoreOrderStatusValue(order?.status),
      packageCode: String(order?.packageCode || "").trim(),
      reservationType: String(order?.reservationType || "").trim(),
      reservedAccountId: String(order?.reservedAccountId || "").trim(),
      assignedAccountId: String(order?.assignedAccountId || "").trim(),
      rootAssignedAccountId: String(order?.rootAssignedAccountId || "").trim(),
      warrantyCount: Array.isArray(order?.warrantyRounds)
        ? order.warrantyRounds.length
        : 0,
    })),
    marketplaceOrders: (Array.isArray(marketplaceOrders) ? marketplaceOrders : []).map(
      (order) => ({
        orderId: String(order?.orderId || "").trim(),
        provider: normalizeProvider(order?.provider),
      }),
    ),
    marketplaceWarrantyCases: (
      Array.isArray(warrantyCases) ? warrantyCases : []
    ).map((item) => ({
      orderId: String(item?.orderId || "").trim(),
      provider: normalizeProvider(item?.provider),
      status: String(item?.status || "").trim(),
    })),
  };
};
const buildChatgptTraceBlockedResponse = async (
  accountId = "",
  errorMessage = "",
) => ({
  error: String(errorMessage || "").trim() || "Tai khoan nay dang bi khoa thao tac.",
  diagnostics: await buildChatgptAccountAdminDiagnostics(accountId),
});
const buildChatgptActionBlockedResponse = async ({
  sourceAccount = null,
  candidateAccount = null,
  action = "",
  options = {},
  fallbackMessage = "",
} = {}) => {
  const decision = buildChatgptActionDecision(
    candidateAccount || {},
    action,
    options,
  );
  if (decision.allowed) return null;
  const primaryReason = decision.primaryReason || null;
  return {
    statusCode: Number(primaryReason?.statusCode || 409),
    payload: {
      error: String(
        primaryReason?.message ||
          fallbackMessage ||
          "Tai khoan nay dang khong san sang cho thao tac nay.",
      ).trim(),
      excludedReason:
        primaryReason && typeof primaryReason === "object"
          ? primaryReason
          : null,
      sourceState:
        sourceAccount && typeof sourceAccount === "object"
          ? pickChatgptCurrentStatePayload(sourceAccount)
          : null,
      candidateState:
        candidateAccount && typeof candidateAccount === "object"
          ? pickChatgptCurrentStatePayload(candidateAccount)
          : null,
      diagnostics: candidateAccount?.id
        ? await buildChatgptAccountAdminDiagnostics(candidateAccount.id)
        : null,
    },
  };
};
const isStoreOrderRelatedToChatgptAccount = (order = {}, accountId = "") => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return false;
  if (String(order?.reservedAccountId || "").trim() === normalizedId) return true;
  if (String(order?.assignedAccountId || "").trim() === normalizedId) return true;
  if (String(order?.rootAssignedAccountId || "").trim() === normalizedId) return true;
  return (Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : []).some(
    (round) =>
      String(round?.fromAccountId || "").trim() === normalizedId ||
      String(round?.toAccountId || "").trim() === normalizedId,
  );
};
const auditStoreOrderAccountConsistency = async ({ repair = false } = {}) => {
  const checkedAt = new Date().toISOString();
  const [orders, accounts] = await Promise.all([
    StoreOrder.find({}).lean(),
    Account.find({}).select(CHATGPT_ADMIN_ACCOUNT_SELECT).lean(),
  ]);
  const decoratedAccounts = await decorateChatgptAccountsWithOperationalState(accounts);
  const accountMap = new Map(
    decoratedAccounts.map((account) => [String(account?.id || "").trim(), account]),
  );
  const orderMap = new Map(
    (Array.isArray(orders) ? orders : []).map((order) => [
      String(order?.id || "").trim(),
      order,
    ]),
  );
  const findings = {
    orphanReservedAccounts: [],
    orphanAssignedAccounts: [],
    orphanWarrantyHoldNotes: [],
    warrantyHoldOutsideTotal: [],
    busyAccountsStillInMarket: [],
    fulfilledWithoutPaidAt: [],
    fulfilledBeforePaidAt: [],
    ordersMissingOperationalFields: [],
  };
  const repairs = [];

  for (const order of Array.isArray(orders) ? orders : []) {
    const orderId = String(order?.id || "").trim();
    const normalizedStatus = normalizeStoreOrderStatusValue(order?.status);
    const reservedAccountId = String(order?.reservedAccountId || "").trim();
    const assignedAccountId = String(order?.assignedAccountId || "").trim();
    const rootAssignedAccountId = String(order?.rootAssignedAccountId || "").trim();
    const operationalState = buildStoreOrderOperationalState(order, {
      accountStateMap: accountMap,
    });
    const missingFields = [];
    if (
      String(order?.reservationState || "").trim() !==
      String(operationalState?.reservationState || "").trim()
    ) {
      missingFields.push("reservationState");
    }
    if (
      String(order?.fulfillmentState || "").trim() !==
      String(operationalState?.fulfillmentState || "").trim()
    ) {
      missingFields.push("fulfillmentState");
    }
    if (
      String(order?.fulfillmentReason || "").trim() !==
      String(operationalState?.fulfillmentReason || "").trim()
    ) {
      missingFields.push("fulfillmentReason");
    }
    if (
      operationalState?.reservedAccountSnapshot?.accountId &&
      !String(order?.reservedAccountSnapshot?.accountId || "").trim()
    ) {
      missingFields.push("reservedAccountSnapshot");
    }
    if (missingFields.length > 0) {
      findings.ordersMissingOperationalFields.push({
        orderId,
        status: normalizedStatus,
        missingFields,
      });
      if (repair) {
        const nextSet = {
          reservationState: String(
            operationalState?.reservationState || "none",
          ).trim(),
          fulfillmentState: String(
            operationalState?.fulfillmentState || "unknown",
          ).trim(),
          fulfillmentReason: String(
            operationalState?.fulfillmentReason || "",
          ).trim(),
          updatedAt: new Date().toISOString(),
        };
        if (operationalState?.reservedAccountSnapshot?.accountId) {
          nextSet.reservedAccountSnapshot = operationalState.reservedAccountSnapshot;
        }
        await StoreOrder.updateOne({ id: orderId }, { $set: nextSet });
        repairs.push({
          type: "backfill_order_operational_fields",
          orderId,
          fields: missingFields,
        });
      }
    }
    if (reservedAccountId && !accountMap.has(reservedAccountId)) {
      findings.orphanReservedAccounts.push({
        orderId,
        reservedAccountId,
        status: normalizedStatus,
      });
    }
    const missingAssignedIds = [assignedAccountId, rootAssignedAccountId]
      .filter(Boolean)
      .filter((accountId) => !accountMap.has(accountId));
    if (missingAssignedIds.length > 0) {
      findings.orphanAssignedAccounts.push({
        orderId,
        accountIds: Array.from(new Set(missingAssignedIds)),
        status: normalizedStatus,
      });
    }
    if (
      normalizedStatus === "fulfilled" &&
      normalizeStorePaymentMethod(order?.paymentMethod) !== "admin_manual" &&
      !String(order?.paidAt || "").trim()
    ) {
      findings.fulfilledWithoutPaidAt.push({ orderId, paymentMethod: order?.paymentMethod });
    }
    const fulfilledAtMs = parseStoreDateMs(order?.fulfilledAt);
    const paidAtMs = parseStoreDateMs(order?.paidAt);
    if (
      normalizedStatus === "fulfilled" &&
      normalizeStorePaymentMethod(order?.paymentMethod) !== "admin_manual" &&
      fulfilledAtMs > 0 &&
      paidAtMs > 0 &&
      fulfilledAtMs < paidAtMs
    ) {
      findings.fulfilledBeforePaidAt.push({
        orderId,
        fulfilledAt: String(order?.fulfilledAt || "").trim(),
        paidAt: String(order?.paidAt || "").trim(),
      });
    }
  }

  for (const account of decoratedAccounts) {
    const accountId = String(account?.id || "").trim();
    const warehouse = normalizePackage2Shelf(
      account?.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    );
    const holdOrderIds = extractStoreWarrantyHoldOrderIds(account?.note);
    const orphanHoldOrderIds = holdOrderIds.filter((orderId) => {
      const relatedOrder = orderMap.get(String(orderId || "").trim());
      return !relatedOrder || !isStoreOrderRelatedToChatgptAccount(relatedOrder, accountId);
    });
    if (orphanHoldOrderIds.length > 0) {
      findings.orphanWarrantyHoldNotes.push({
        accountId,
        username: String(account?.username || "").trim(),
        orderIds: orphanHoldOrderIds,
      });
      if (repair) {
        let nextNote = String(account?.note || "").trim();
        orphanHoldOrderIds.forEach((orderId) => {
          nextNote = removeStoreWarrantyHoldNote(nextNote, orderId);
        });
        await Account.updateOne(
          { id: accountId },
          {
            $set: {
              note: nextNote,
              updatedAt: new Date().toISOString(),
            },
          },
        );
        repairs.push({
          type: "remove_orphan_warranty_hold_note",
          accountId,
          orderIds: orphanHoldOrderIds,
        });
      }
    }

    if (account?.isWarrantyHold && warehouse !== CHATGPT_TOTAL_VALUE) {
      findings.warrantyHoldOutsideTotal.push({
        accountId,
        username: String(account?.username || "").trim(),
        warehouse,
        holdOrderId: String(account?.holdOrderId || "").trim(),
      });
      if (repair) {
        await Account.updateOne(
          { id: accountId },
          {
            $set: {
              package2Shelf: CHATGPT_TOTAL_VALUE,
              updatedAt: new Date().toISOString(),
            },
          },
        );
        repairs.push({
          type: "move_warranty_hold_back_to_total",
          accountId,
        });
      }
    }

    if (
      warehouse === CHATGPT_MARKET_VALUE &&
      [
        "reserved_for_pending_store_order",
        "assigned_to_store_order",
        "warranty_hold_source",
        "busy_in_warranty_replacement",
      ].includes(String(account?.availabilityState || "").trim())
    ) {
      findings.busyAccountsStillInMarket.push({
        accountId,
        username: String(account?.username || "").trim(),
        availabilityState: String(account?.availabilityState || "").trim(),
        busyOrderId: String(account?.busyOrderId || "").trim(),
      });
      if (repair) {
        await Account.updateOne(
          { id: accountId },
          {
            $set: {
              package2Shelf: CHATGPT_TOTAL_VALUE,
              updatedAt: new Date().toISOString(),
            },
          },
        );
        repairs.push({
          type: "move_busy_account_back_to_total",
          accountId,
        });
      }
    }
  }

  return {
    checkedAt,
    summary: {
      orphanReservedAccounts: findings.orphanReservedAccounts.length,
      orphanAssignedAccounts: findings.orphanAssignedAccounts.length,
      orphanWarrantyHoldNotes: findings.orphanWarrantyHoldNotes.length,
      warrantyHoldOutsideTotal: findings.warrantyHoldOutsideTotal.length,
      busyAccountsStillInMarket: findings.busyAccountsStillInMarket.length,
      fulfilledWithoutPaidAt: findings.fulfilledWithoutPaidAt.length,
      fulfilledBeforePaidAt: findings.fulfilledBeforePaidAt.length,
      ordersMissingOperationalFields: findings.ordersMissingOperationalFields.length,
      repairsApplied: repairs.length,
    },
    findings,
    repairs,
  };
};
const issueStoreUserJwt = (user) =>
  jwt.sign(
    {
      sub: String(user?.id || ""),
      email: String(user?.emailLower || user?.email || "").trim().toLowerCase(),
      type: "store-user",
    },
    STORE_USER_JWT_SECRET,
    { expiresIn: "30d" },
  );
const getBearerToken = (req) => {
  const header = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
};
async function verifyStoreUserToken(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Chua dang nhap" });
    }
    const decoded = jwt.verify(token, STORE_USER_JWT_SECRET);
    const user = await StoreUser.findOne({ id: String(decoded?.sub || "").trim() });
    if (!user) {
      return res.status(401).json({ error: "Nguoi dung khong ton tai" });
    }
    req.storeUser = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Phien dang nhap khong hop le" });
  }
}
const getAppBaseUrl = (req) => {
  const envBase = String(
    process.env.APP_BASE_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "",
  ).trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = String(
    req.headers["x-forwarded-proto"] || req.protocol || "https",
  ).trim();
  const host = String(
    req.headers["x-forwarded-host"] || req.get("host") || "",
  ).trim();
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
};
const buildStoreResetPasswordLink = (req, token) => {
  const baseUrl = getAppBaseUrl(req);
  const url = new URL(`${baseUrl || ""}/store`);
  url.searchParams.set("view", "reset-password");
  url.searchParams.set("token", token);
  return url.toString();
};
let gmailTransporter;
const getGmailTransporter = () => {
  if (gmailTransporter) return gmailTransporter;
  const gmailUser = String(process.env.GMAIL_USER || "").trim();
  const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || "").trim();
  if (!gmailUser || !gmailPassword) {
    throw new Error("Gmail SMTP chưa được cấu hình");
  }
  gmailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPassword,
    },
  });
  return gmailTransporter;
};
const sendStoreResetPasswordEmail = async ({ req, user, resetToken }) => {
  const transporter = getGmailTransporter();
  const gmailUser = String(process.env.GMAIL_USER || "").trim();
  const resetLink = buildStoreResetPasswordLink(req, resetToken);
  await transporter.sendMail({
    from: gmailUser,
    to: String(user.email || "").trim(),
    subject: "Đặt lại mật khẩu tài khoản",
    text: [
      `Xin chào ${String(user.fullName || "").trim() || "bạn"},`,
      "",
      "Bạn vừa yêu cầu đặt lại mật khẩu.",
      `Mở link sau để đặt lại mật khẩu: ${resetLink}`,
      "",
      "Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.",
    ].join("\n"),
  });
};
const safeCompareHex = (left, right) => {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};
const buildMomoSignature = (fields = {}) => {
  const raw = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .join("&");
  return crypto
    .createHmac("sha256", MOMO_SECRET_KEY)
    .update(raw)
    .digest("hex");
};
const verifyMomoIpnSignature = (payload = {}) => {
  const signature = String(payload.signature || "").trim();
  if (!signature) return false;
  const expected = buildMomoSignature({
    accessKey: MOMO_ACCESS_KEY,
    amount: payload.amount ?? "",
    extraData: payload.extraData ?? "",
    message: payload.message ?? "",
    orderId: payload.orderId ?? "",
    orderInfo: payload.orderInfo ?? "",
    orderType: payload.orderType ?? "",
    partnerCode: payload.partnerCode ?? "",
    payType: payload.payType ?? "",
    requestId: payload.requestId ?? "",
    responseTime: payload.responseTime ?? "",
    resultCode: payload.resultCode ?? "",
    transId: payload.transId ?? "",
  });
  return safeCompareHex(expected, signature);
};
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const decodeBase32 = (input = "") => {
  const normalized = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};
const generateTotpCode = (secret, timeMs = Date.now()) => {
  const key = decodeBase32(secret);
  if (!key.length) {
    throw new Error("Mã 2FA không hợp lệ");
  }
  const counter = Math.floor(timeMs / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter & 0xffffffff, 4);
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return {
    code: String(binary % 1000000).padStart(6, "0"),
    expiresIn: 30 - Math.floor((timeMs / 1000) % 30),
  };
};
const buildEmptyTeamSlot = () => ({
  status: "empty",
  gmail: "",
  customerName: "",
  addedAt: "",
  expiredAt: "",
});
const buildEmptyTeamSlots = () =>
  Array(4).fill(null).map(() => buildEmptyTeamSlot());
const isFilledTeamSlot = (slot = {}) =>
  String(slot?.status || "").toLowerCase() !== "empty" &&
  String(slot?.gmail || "").trim().length > 0;
const normalizeTeamSlots = (slots = []) =>
  Array.from({ length: 4 }, (_, index) => {
    const slot = Array.isArray(slots) ? slots[index] || {} : {};
    if (!isFilledTeamSlot(slot)) {
      return buildEmptyTeamSlot();
    }
    return {
      status: "active",
      gmail: String(slot.gmail || "").trim(),
      customerName: String(slot.customerName || "").trim(),
      addedAt: String(slot.addedAt || ""),
      expiredAt: String(slot.expiredAt || ""),
    };
  });
const countActiveTeamCustomers = (slots = []) =>
  normalizeTeamSlots(slots).filter((slot) => isFilledTeamSlot(slot)).length;
const findFirstActiveTeamSlotEntry = (slots = []) =>
  normalizeTeamSlots(slots)
    .map((slot, index) => ({ slot, index }))
    .find(({ slot }) => isFilledTeamSlot(slot)) || null;
const buildTeamBusinessLimitError = (activeCount = 0) => {
  const error = new Error(
    activeCount > 1
      ? `Team Business chỉ được có 1 khách. Hiện đang có ${activeCount} khách, hãy chuyển hoặc xóa bớt trước.`
      : "Team Business chỉ được có tối đa 1 khách.",
  );
  error.statusCode = 400;
  return error;
};
const assertValidTeamSlotsForSaleMode = (saleMode, slots = []) => {
  const activeCount = countActiveTeamCustomers(slots);
  if (
    normalizeTeamSaleMode(saleMode) === TEAM_SALE_MODE_BUSINESS &&
    activeCount > 1
  ) {
    throw buildTeamBusinessLimitError(activeCount);
  }
};
const getTeamDaysLeft = (account = {}) => {
  if (!account?.expiredAt) return null;
  const daysLeft = Math.ceil(
    (new Date(account.expiredAt).getTime() - Date.now()) / 86400000,
  );
  return Number.isFinite(daysLeft) ? daysLeft : null;
};
const getAvailableTeamSlotIndices = (slots = []) =>
  normalizeTeamSlots(slots)
    .map((slot, index) => ({ slot, index }))
    .filter(
      ({ slot }) =>
        String(slot?.status || "").toLowerCase() === "empty" ||
        !String(slot?.gmail || "").trim(),
    )
    .map(({ index }) => index);
const isEligibleForTeamMarketSale = (account = {}) => {
  const warehouse = normalizeTeamWarehouse(
    account?.warehouse,
    TEAM_WAREHOUSE_TOTAL,
  );
  if (warehouse !== TEAM_WAREHOUSE_MARKET) return false;
  const saleMode = normalizeTeamSaleMode(account?.saleMode);
  if (saleMode !== TEAM_SALE_MODE_BUSINESS) return false;
  const daysLeft = getTeamDaysLeft(account);
  if (daysLeft !== null && daysLeft <= PACKAGE2_MIN_DAYS_FOR_SALE) return false;
  return countActiveTeamCustomers(account?.slots) === 0;
};
const shouldKeepTeamInMarketWarehouse = (account = {}) => {
  const warehouse = normalizeTeamWarehouse(
    account?.warehouse,
    TEAM_WAREHOUSE_TOTAL,
  );
  if (warehouse !== TEAM_WAREHOUSE_MARKET) return false;
  const saleMode = normalizeTeamSaleMode(account?.saleMode);
  if (saleMode !== TEAM_SALE_MODE_BUSINESS) return false;
  const daysLeft = getTeamDaysLeft(account);
  return !(daysLeft !== null && daysLeft <= PACKAGE2_MIN_DAYS_FOR_SALE);
};
const hasManagedTeamBusinessCustomer = (account = {}) => {
  if (normalizeTeamSaleMode(account?.saleMode) !== TEAM_SALE_MODE_BUSINESS) {
    return false;
  }
  const activeSlotEntry = findFirstActiveTeamSlotEntry(account?.slots);
  if (!activeSlotEntry?.slot) return false;
  return isDatammoManagedUser({
    name: String(activeSlotEntry.slot.customerName || "").trim(),
  });
};
const normalizeTeamWarehouseState = (account = {}) => {
  const saleMode = normalizeTeamSaleMode(account?.saleMode);
  const currentWarehouse = normalizeTeamWarehouse(
    account?.warehouse,
    TEAM_WAREHOUSE_TOTAL,
  );

  if (currentWarehouse === TEAM_WAREHOUSE_SHORT) {
    return saleMode === TEAM_SALE_MODE_BUSINESS
      ? TEAM_WAREHOUSE_SHORT
      : TEAM_WAREHOUSE_TOTAL;
  }

  if (
    currentWarehouse === TEAM_WAREHOUSE_TOTAL &&
    hasManagedTeamBusinessCustomer(account)
  ) {
    return shouldKeepTeamInMarketWarehouse({
      ...account,
      warehouse: TEAM_WAREHOUSE_MARKET,
    })
      ? TEAM_WAREHOUSE_MARKET
      : TEAM_WAREHOUSE_TOTAL;
  }

  if (currentWarehouse !== TEAM_WAREHOUSE_MARKET) {
    return TEAM_WAREHOUSE_TOTAL;
  }

  return shouldKeepTeamInMarketWarehouse(account)
    ? TEAM_WAREHOUSE_MARKET
    : TEAM_WAREHOUSE_TOTAL;
};
const syncTeamWarehouseStateIfNeeded = async (account) => {
  if (!account?.id) return account;
  const currentWarehouse = normalizeTeamWarehouse(
    account?.warehouse,
    TEAM_WAREHOUSE_TOTAL,
  );
  const nextWarehouse = normalizeTeamWarehouseState(account);
  if (currentWarehouse === nextWarehouse) return account;
  // Derived warehouse reconciliation should not trip optimistic-concurrency checks.
  const updated = await TeamAccount.findOneAndUpdate(
    { id: account.id },
    {
      $set: {
        warehouse: nextWarehouse,
      },
    },
    { new: true },
  );
  return updated || account;
};
const reconcileTeamMarketInventory = async () => {
  const minExpiredAt = new Date(
    Date.now() + PACKAGE2_MIN_DAYS_FOR_SALE * 24 * 60 * 60 * 1000,
  ).toISOString();
  const moveManagedBusinessIntoMarket = await TeamAccount.updateMany(
    {
      warehouse: TEAM_WAREHOUSE_TOTAL,
      saleMode: TEAM_SALE_MODE_BUSINESS,
      expiredAt: { $gt: minExpiredAt },
      slots: {
        $elemMatch: {
          status: "active",
          customerName: /^(datammo#|\[datammo\]|shopmini#|\[shopmini\])/i,
        },
      },
    },
    {
      $set: {
        warehouse: TEAM_WAREHOUSE_MARKET,
      },
    },
  );
  const moveNearExpiryOutOfMarket = await TeamAccount.updateMany(
    {
      warehouse: TEAM_WAREHOUSE_MARKET,
      expiredAt: { $lte: minExpiredAt },
    },
    {
      $set: {
        warehouse: TEAM_WAREHOUSE_TOTAL,
      },
    },
  );
  const resetInvalidShortWarehouse = await TeamAccount.updateMany(
    {
      warehouse: TEAM_WAREHOUSE_SHORT,
      saleMode: { $ne: TEAM_SALE_MODE_BUSINESS },
    },
    {
      $set: {
        warehouse: TEAM_WAREHOUSE_TOTAL,
      },
    },
  );
};
const normalizeTeamPayload = (payload = {}, options = {}) => {
  const normalized = { ...(payload || {}) };
  const defaultSaleMode =
    options.defaultSaleMode === true
      ? TEAM_SALE_MODE_SLOT
      : normalizeTeamSaleMode(options.defaultSaleMode, TEAM_SALE_MODE_SLOT);
  const defaultWarehouse =
    options.defaultWarehouse === true
      ? TEAM_WAREHOUSE_TOTAL
      : normalizeTeamWarehouse(
          options.defaultWarehouse,
          TEAM_WAREHOUSE_TOTAL,
        );
  delete normalized.emailPassword;
  delete normalized.expectedUpdatedAt;
  if (normalized.username !== undefined) {
    normalized.username = String(normalized.username || "").trim();
  }
  if (normalized.password !== undefined) {
    normalized.password = String(normalized.password || "").trim();
  }
  if (normalized.otpSecret !== undefined) {
    normalized.otpSecret = String(normalized.otpSecret || "").trim();
  }
  if (normalized.recoveryUrl !== undefined) {
    normalized.recoveryUrl = String(normalized.recoveryUrl || "").trim();
  }
  if (normalized.note !== undefined) {
    normalized.note = String(normalized.note || "");
  }
  if (
    normalized.saleMode !== undefined ||
    options.defaultSaleMode !== undefined
  ) {
    normalized.saleMode = normalizeTeamSaleMode(
      normalized.saleMode,
      defaultSaleMode,
    );
  }
  if (
    normalized.warehouse !== undefined ||
    options.defaultWarehouse !== undefined
  ) {
    normalized.warehouse = normalizeTeamWarehouse(
      normalized.warehouse,
      defaultWarehouse,
    );
  }
  if (normalized.slots !== undefined && !Array.isArray(normalized.slots)) {
    normalized.slots = buildEmptyTeamSlots();
  }
  if (normalized.slots !== undefined) {
    normalized.slots = normalizeTeamSlots(normalized.slots);
  }
  if (options.defaultSlots && normalized.slots === undefined) {
    normalized.slots = buildEmptyTeamSlots();
  }
  if (
    [TEAM_WAREHOUSE_MARKET, TEAM_WAREHOUSE_SHORT].includes(
      normalizeTeamWarehouse(normalized.warehouse, defaultWarehouse),
    ) &&
    normalizeTeamSaleMode(
      normalized.saleMode,
      defaultSaleMode,
    ) !== TEAM_SALE_MODE_BUSINESS
  ) {
    normalized.warehouse = TEAM_WAREHOUSE_TOTAL;
  }
  return normalized;
};
const sanitizeTeamAccount = (account = {}) => {
  if (!account) return account;
  const { emailPassword, ...rest } = account;
  return {
    ...rest,
    saleMode: normalizeTeamSaleMode(rest.saleMode),
    warehouse: normalizeTeamWarehouse(rest.warehouse),
    slots: normalizeTeamSlots(rest.slots),
  };
};

const PACKAGE2_SHELF_MAIN = "main";
const PACKAGE2_SHELF_CHEAP = "cheap";
const PACKAGE2_SHELF_NONE = "none";
const PACKAGE2_MIN_DAYS_FOR_SALE = 25;
const CHATGPT_MANUAL_MARKET_VALUE = PACKAGE2_SHELF_MAIN;
const CHATGPT_MARKET_VALUE = PACKAGE2_SHELF_CHEAP;
const CHATGPT_TOTAL_VALUE = PACKAGE2_SHELF_NONE;
const CHATGPT_MARKET_SUPPORTED_TYPES = ["package1", "package2", "unassigned"];
const VALID_PACKAGE2_SHELVES = [
  PACKAGE2_SHELF_MAIN,
  PACKAGE2_SHELF_CHEAP,
  PACKAGE2_SHELF_NONE,
];
const DATAMMO_PARTNER_API_TOKEN =
  process.env.DATAMMO_PARTNER_API_TOKEN || DATAMMO_TOKEN;
const DATAMMO_TEST_PARTNER_API_TOKEN =
  process.env.DATAMMO_TEST_PARTNER_API_TOKEN || DATAMMO_PARTNER_API_TOKEN;
const SHOPMINI_TEST_PRIVATE_API_TOKEN =
  process.env.SHOPMINI_TEST_PRIVATE_API_TOKEN || SHOPMINI_PRIVATE_API_TOKEN;
const TEST_MARKETPLACE_STOCK = Math.max(
  1,
  Number(process.env.TEST_MARKETPLACE_STOCK || 9999),
);
const TEST_MARKETPLACE_PRICE = Math.max(
  1,
  Number(process.env.TEST_MARKETPLACE_PRICE || 100000),
);

const normalizePackage2Shelf = (shelf, fallback = CHATGPT_TOTAL_VALUE) => {
  if (shelf === PACKAGE2_SHELF_CHEAP) return PACKAGE2_SHELF_CHEAP;
  if (shelf === PACKAGE2_SHELF_MAIN) return CHATGPT_MANUAL_MARKET_VALUE;
  if (shelf === PACKAGE2_SHELF_NONE) return CHATGPT_TOTAL_VALUE;
  return fallback;
};
const supportsChatgptMarket = (type) =>
  CHATGPT_MARKET_SUPPORTED_TYPES.includes(
    String(type || "unassigned").trim() || "unassigned",
  );
const supportsChatgptWarrantyReplacement = (type) =>
  ["package2", "unassigned"].includes(
    String(type || "unassigned").trim() || "unassigned",
  );
const isChatgptMarketAccount = (acc = {}) =>
  supportsChatgptMarket(acc?.type) &&
  normalizePackage2Shelf(acc?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
    CHATGPT_MARKET_VALUE;
const hasManagedChatgptMarketplaceCustomer = (acc = {}) => {
  const users = Array.isArray(acc?.users) ? acc.users : [];
  if (users.length !== 1) return false;
  return isDatammoManagedUser(users[0]);
};
const hasAnyAssignedUsers = (users = []) =>
  Array.isArray(users) && users.length > 0;
const isEligibleForChatgptMarketSale = (acc = {}) => {
  if (!supportsChatgptMarket(acc?.type)) return false;
  if (!isChatgptMarketAccount(acc)) return false;
  if (hasAnyAssignedUsers(acc?.users)) return false;
  if (!acc?.expiredAt) return true;
  const daysLeft = Math.ceil(
    (new Date(acc.expiredAt).getTime() - Date.now()) / 86400000,
  );
  return Number.isFinite(daysLeft) ? daysLeft > PACKAGE2_MIN_DAYS_FOR_SALE : true;
};
const normalizeChatgptMarketAccountState = (acc = {}) => {
  if (!acc || !supportsChatgptMarket(acc?.type)) {
    return CHATGPT_TOTAL_VALUE;
  }
  const currentState = pickChatgptCurrentStatePayload(acc);
  if (
    currentState.isReservedForWeb ||
    currentState.isWarrantyHold ||
    currentState.isBusyInWarrantyReplacement ||
    currentState.isBusyInMarketplace ||
    currentState.hasAssignedUsers ||
    currentState.availabilityState === "expired_unusable"
  ) {
    return CHATGPT_TOTAL_VALUE;
  }
  const currentValue = normalizePackage2Shelf(
    acc?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  );
  if (hasManagedChatgptMarketplaceCustomer(acc)) {
    return CHATGPT_MARKET_VALUE;
  }
  if (currentValue === CHATGPT_MANUAL_MARKET_VALUE) {
    return CHATGPT_MANUAL_MARKET_VALUE;
  }
  if (currentValue !== CHATGPT_MARKET_VALUE) {
    return CHATGPT_TOTAL_VALUE;
  }
  return isEligibleForChatgptMarketSale(acc)
    ? CHATGPT_MARKET_VALUE
    : CHATGPT_TOTAL_VALUE;
};
const syncChatgptMarketStateIfNeeded = async (acc) => {
  if (!acc?.id || !supportsChatgptMarket(acc?.type)) return acc;
  const nextWarehouse = normalizeChatgptMarketAccountState(acc);
  const currentWarehouse = normalizePackage2Shelf(
    acc?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  );
  if (nextWarehouse === currentWarehouse) return acc;
  // Derived market shelf reconciliation should not look like a manual admin edit.
  const updated = await Account.findOneAndUpdate(
    { id: acc.id },
    {
      $set: {
        package2Shelf: nextWarehouse,
      },
    },
    { new: true },
  );
  return updated || acc;
};
const reconcileChatgptMarketInventory = async () => {
  const marketAccounts = await Account.find({
    type: { $in: CHATGPT_MARKET_SUPPORTED_TYPES },
    package2Shelf: CHATGPT_MARKET_VALUE,
  }).lean();
  const dirtyAccountIds = (Array.isArray(marketAccounts) ? marketAccounts : [])
    .filter(
      (account) =>
        normalizeChatgptMarketAccountState(account) !== CHATGPT_MARKET_VALUE,
    )
    .map((account) => String(account?.id || "").trim())
    .filter(Boolean);
  if (dirtyAccountIds.length === 0) return false;
  const result = await Account.updateMany(
    { id: { $in: dirtyAccountIds } },
    {
      $set: {
        package2Shelf: CHATGPT_TOTAL_VALUE,
      },
    },
  );
  return Number(result?.modifiedCount || 0) > 0;
};
const normalizeMarketplaceProvider = (value, fallback = "datammo") => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "shopmini") return "shopmini";
  if (raw === "datammo") return "datammo";
  return fallback;
};
const normalizeMarketplaceScope = (value, fallback = "chatgpt") => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "team") return "team";
  if (raw === "chatgpt") return "chatgpt";
  return fallback;
};
const getMarketplaceProviderLabel = (value) =>
  normalizeMarketplaceProvider(value) === "shopmini" ? "Shopmini" : "Datammo";
const escapeRegex = (value = "") =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getUserNameValue = (user) => {
  if (typeof user === "string") return user;
  if (user && typeof user === "object") return user.name || "";
  return "";
};
const isDatammoManagedUser = (user) => {
  const normalizedName = String(getUserNameValue(user) || "")
    .trim()
    .toLowerCase();
  return (
    normalizedName.startsWith("datammo#") ||
    normalizedName.startsWith("[datammo]") ||
    normalizedName.startsWith("shopmini#") ||
    normalizedName.startsWith("[shopmini]")
  );
};
const getMarketplaceOrderInfoFromUser = (user) => {
  const rawName = String(getUserNameValue(user) || "").trim();
  const hashMatch = /^datammo#(.+)$/i.exec(rawName);
  if (hashMatch?.[1]) {
    return { provider: "datammo", orderId: String(hashMatch[1]).trim() };
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
const extractDatammoOrderIdFromUser = (user) => {
  const info = getMarketplaceOrderInfoFromUser(user);
  return String(info.orderId || "").trim();
};
const buildMarketplaceResourceKey = ({
  scope = "chatgpt",
  itemType = "chatgpt_account",
  accountId = "",
  slotIndex = -1,
} = {}) => {
  const normalizedScope = String(scope || "chatgpt").trim().toLowerCase();
  const normalizedType = String(itemType || "chatgpt_account")
    .trim()
    .toLowerCase();
  const normalizedAccountId = String(accountId || "").trim();
  if (normalizedScope === "team" && normalizedType === "team_slot") {
    return `team_slot:${normalizedAccountId}:${Number(slotIndex)}`;
  }
  if (normalizedScope === "team" && normalizedType === "team_business") {
    return `team_business:${normalizedAccountId}`;
  }
  return normalizedAccountId;
};
const getMarketplaceOrderInfoFromTeamSlot = (slot = {}) =>
  getMarketplaceOrderInfoFromUser({
    name: String(slot?.customerName || "").trim(),
  });
const isMatchingMarketplaceTrace = (provider, orderId, info = {}) =>
  normalizeMarketplaceProvider(info?.provider, "") ===
    normalizeMarketplaceProvider(provider, "") &&
  String(info?.orderId || "").trim() === String(orderId || "").trim();
const clearMarketplaceManagedUsersByOrder = (users = [], provider, orderId) =>
  (Array.isArray(users) ? users : []).filter((user) => {
    if (!isDatammoManagedUser(user)) return true;
    return !isMatchingMarketplaceTrace(
      provider,
      orderId,
      getMarketplaceOrderInfoFromUser(user),
    );
  });
const clearMarketplaceManagedTeamSlotsByOrder = (slots = [], provider, orderId) =>
  normalizeTeamSlots(slots).map((slot) => {
    const customerName = String(slot?.customerName || "").trim();
    if (!customerName) return slot;
    return isMatchingMarketplaceTrace(
      provider,
      orderId,
      getMarketplaceOrderInfoFromTeamSlot(slot),
    )
      ? buildEmptyTeamSlot()
      : slot;
  });
const findLatestMarketplaceOrderForAccount = async (
  accountId,
  provider = "",
  scope = "",
) => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return null;
  const filter = { "accounts.accountId": normalizedId };
  const normalizedProvider = normalizeMarketplaceProvider(provider, "");
  if (normalizedProvider) {
    filter.provider = normalizedProvider;
  }
  if (scope) {
    filter.scope = String(scope || "").trim().toLowerCase();
  }
  const candidateOrders = await DatammoOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return (
    candidateOrders.find((order) => !isPlaceholderMarketplaceOrder(order)) || null
  );
};
const findActiveMarketplaceWarrantyCaseForAccount = async (
  accountId,
  scope = "chatgpt",
) => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return null;
  const normalizedScope =
    String(scope || "chatgpt").trim().toLowerCase() === "team"
      ? "team"
      : "chatgpt";
  return (
    (await DatammoWarrantyCase.findOne({
      scope: normalizedScope,
      status: "active",
      $or: [
        { rootAccountId: normalizedId },
        { currentAccountId: normalizedId },
        { "rounds.fromAccountId": normalizedId },
        { "rounds.toAccountId": normalizedId },
      ],
    }).lean()) || null
  );
};
const hasRegularPackage2Customer = (users = []) =>
  Array.isArray(users) &&
  users.some((user) => {
    const name = String(getUserNameValue(user) || "").trim();
    return name && !isDatammoManagedUser(user);
  });
const appendAuditNoteLine = (note, nextLine) => {
  const current = String(note || "").trim();
  const extra = String(nextLine || "").trim();
  if (!extra) return current;
  return current ? `${current}\n${extra}` : extra;
};
const normalizeDatammoRouteShelf = (rawShelf) => {
  const raw = String(rawShelf || "")
    .trim()
    .toLowerCase();
  if (
    raw === PACKAGE2_SHELF_MAIN ||
    raw === "tong" ||
    raw === "total" ||
    raw === "1"
  ) {
    return PACKAGE2_SHELF_MAIN;
  }
  if (
    raw === PACKAGE2_SHELF_CHEAP ||
    raw === "re" ||
    raw === "cheap" ||
    raw === "2"
  ) {
    return PACKAGE2_SHELF_CHEAP;
  }
  return null;
};
const getDatammoPartnerTokenFromReq = (req) => {
  const headerToken =
    req.headers["x-api-token"] ||
    req.headers["X-API-Token"] ||
    req.headers["x_api_token"];
  const authToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const queryToken = req.query?.api_token || req.query?.token || req.query?.key;
  const bodyToken =
    req.body?.api_token ||
    req.body?.token ||
    req.body?.key ||
    req.body?.password;
  return String(headerToken || authToken || queryToken || bodyToken || "").trim();
};
const verifyDatammoPartnerToken = (req, res, next) => {
  const token = getDatammoPartnerTokenFromReq(req);
  if (!token || token !== DATAMMO_PARTNER_API_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};
const verifyShopminiPrivateToken = (req, res, next) => {
  const token = getDatammoPartnerTokenFromReq(req);
  if (!token || token !== SHOPMINI_PRIVATE_API_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};
const verifyDatammoTestPartnerToken = (req, res, next) => {
  const token = getDatammoPartnerTokenFromReq(req);
  if (!token || token !== DATAMMO_TEST_PARTNER_API_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};
const verifyShopminiTestPrivateToken = (req, res, next) => {
  const token = getDatammoPartnerTokenFromReq(req);
  if (!token || token !== SHOPMINI_TEST_PRIVATE_API_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
};
const resolveShopminiShelfFromReq = (req) =>
  normalizeDatammoRouteShelf(
    req.params?.shelf ||
      req.query?.shelf ||
      req.body?.shelf ||
      req.query?.group ||
      req.query?.variant,
  ) || PACKAGE2_SHELF_CHEAP;
const resolveShopminiActionFromReq = (req) => {
  const action = String(
    req.query?.action ||
      req.query?.type ||
      req.query?.method ||
      req.query?.cmd ||
      req.body?.action ||
      "",
  )
    .trim()
    .toLowerCase();
  if (
    ["buy", "order", "purchase", "payment", "thanhtoan", "mua"].includes(action)
  ) {
    return "buy";
  }
  if (
    req.query?.quantity != null ||
    req.query?.soluong != null ||
    req.query?.so_luong != null ||
    req.query?.amount != null ||
    req.query?.order_id != null ||
    req.query?.madon != null ||
    req.body?.quantity != null ||
    req.body?.soluong != null ||
    req.body?.so_luong != null ||
    req.body?.amount != null ||
    req.body?.order_id != null ||
    req.body?.madon != null
  ) {
    return "buy";
  }
  return "stock";
};
const buildMarketplaceTestLines = ({
  orderId,
  quantity,
  provider = "datammo",
}) => {
  const normalizedProvider = normalizeMarketplaceProvider(provider);
  const baseOrderId = String(orderId || `order${Date.now()}`)
    .trim()
    .replace(/\s+/g, "-");
  const uniqueSeed = Date.now().toString(36);
  return Array.from({ length: quantity }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0");
    return `TEST-${normalizedProvider}-${baseOrderId}-${uniqueSeed}-${sequence}|nhan tin shop`;
  });
};
const buildShopminiDeliveryPayload = (lines = [], overrides = {}) => {
  const safeLines = Array.isArray(lines) ? lines : [];
  const message = String(
    overrides.msg || overrides.message || "Tao don hang thanh cong!",
  );
  const textContent = safeLines.join("\n");
  const transactionId = String(
    overrides.trans_id ||
      overrides.transId ||
      overrides.orderId ||
      `SM${Date.now().toString(36)}`,
  ).trim();
  return {
    success: true,
    ok: true,
    code: 200,
    status: "success",
    result: true,
    msg: message,
    message,
    trans_id: transactionId,
    data: safeLines,
    data_lines: safeLines,
    accounts: safeLines,
    products: safeLines,
    items: safeLines,
    list: safeLines,
    product: safeLines,
    product_list: safeLines,
    content: textContent,
    ...overrides,
  };
};
const build2faLiveUrl = (otpSecret = "") => {
  const normalized = String(otpSecret || "").trim();
  return normalized
    ? `https://2fa.live/tok/${encodeURIComponent(normalized)}`
    : "";
};
const buildLabeledAccountDeliveryLine = ({
  username = "",
  password = "",
  otpSecret = "",
  link = "",
  note = "",
} = {}) => {
  const normalizedUsername = String(username || "").trim();
  const normalizedPassword = String(password || "").trim();
  const normalizedOtpSecret = String(otpSecret || "").trim();
  const normalizedLink = String(link || "").trim();
  const normalizedNote = String(note || "").trim();
  if (!normalizedUsername || !normalizedPassword) return "";
  const parts = [`TK: ${normalizedUsername}`, `MK: ${normalizedPassword}`];
  if (normalizedOtpSecret) {
    parts.push(`2FA: ${normalizedOtpSecret}`);
    const liveUrl = build2faLiveUrl(normalizedOtpSecret);
    if (liveUrl) {
      parts.push(`2FA.live: ${liveUrl}`);
    }
  }
  if (normalizedLink) {
    parts.push(`LINK: ${normalizedLink}`);
  } else if (normalizedNote) {
    parts.push(`NOTE: ${normalizedNote}`);
  }
  return parts.join(" | ");
};
const buildRawAccountDeliveryLine = ({
  username = "",
  password = "",
  otpSecret = "",
  link = "",
  note = "",
} = {}) => {
  const normalizedUsername = String(username || "").trim();
  const normalizedPassword = String(password || "").trim();
  const normalizedOtpSecret = String(otpSecret || "").trim();
  const normalizedLink = String(link || "").trim();
  const normalizedNote = String(note || "").trim();
  if (!normalizedUsername || !normalizedPassword) return "";
  const parts = [normalizedUsername, normalizedPassword];
  if (normalizedOtpSecret) {
    parts.push(normalizedOtpSecret);
  }
  if (normalizedLink) {
    parts.push(normalizedLink);
  } else if (normalizedNote) {
    parts.push(normalizedNote);
  }
  return parts.join("|");
};
const formatShopminiDeliveryLineForDisplay = (line = "") => {
  const raw = String(line || "").trim();
  if (!raw) return raw;
  if (/^(TK:|SLOT:|NOTE:)/i.test(raw)) return raw;
  const parts = raw.split("|").map((part) => String(part || "").trim());
  if (parts.length === 0) return raw;
  const [username, password, ...rest] = parts;
  const segments = [];
  if (username) segments.push(`TK: ${username}`);
  if (password) segments.push(`MK: ${password}`);
  const extra = rest.join(" | ").trim();
  if (extra) {
    segments.push(/^https?:\/\//i.test(extra) ? `LINK: ${extra}` : `NOTE: ${extra}`);
  }
  return segments.join(" | ") || raw;
};
const buildShopminiStrictSamplePayload = (lines = []) => {
  const safeLines = Array.isArray(lines) ? lines : [];
  return {
    status: "success",
    data: safeLines.join("\n"),
  };
};
const getShopminiBuyQuantity = (req) =>
  getSafeBuyQuantity(
    req.query?.quantity ||
      req.query?.soluong ||
      req.query?.so_luong ||
      req.query?.amount ||
      req.body?.quantity ||
      req.body?.soluong ||
      req.body?.so_luong ||
      req.body?.amount,
  );
const getShopminiOrderId = (req) =>
  String(
    req.query?.order_id ||
      req.query?.orderId ||
      req.query?.madon ||
      req.query?.order_code ||
      req.query?.id ||
      req.body?.order_id ||
      req.body?.orderId ||
      req.body?.madon ||
      req.body?.order_code ||
      `shopmini_${Date.now()}`,
  ).trim();
const isPlaceholderLikeValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return raw.includes("{") || raw.includes("}") || /^(test|preview)$/i.test(raw);
};
const isPlaceholderMarketplaceOrder = (order = {}) =>
  isPlaceholderLikeValue(order?.orderId);
const isPlaceholderMarketplaceManagedUser = (user) => {
  const info = getMarketplaceOrderInfoFromUser(user);
  return !!String(info?.orderId || "").trim() && isPlaceholderLikeValue(info.orderId);
};
const isActiveMarketplaceManagedUser = (user) =>
  isDatammoManagedUser(user) && !isPlaceholderMarketplaceManagedUser(user);
const buildPackage2SaleFilter = () => {
  const minExpiredAt = new Date(
    Date.now() + PACKAGE2_MIN_DAYS_FOR_SALE * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    type: { $in: CHATGPT_MARKET_SUPPORTED_TYPES },
    package2Shelf: CHATGPT_MARKET_VALUE,
    expiredAt: { $gt: minExpiredAt },
    $expr: {
      $eq: [{ $size: { $ifNull: ["$users", []] } }, 0],
    },
  };
};
const formatPackage2DeliveryLine = (acc = {}) =>
  buildRawAccountDeliveryLine({
    username: acc.username,
    password: acc.password,
    otpSecret: acc.otpSecret,
    link: acc.link,
  });
const getSafeBuyQuantity = (value) => {
  const q = Number.parseInt(value, 10);
  if (!Number.isFinite(q) || q <= 0) return 1;
  return Math.min(q, 50);
};
const resolveDatammoShelfFromReq = (req) => {
  const variantId = String(
    req.query?.variant_id || req.query?.variantId || "",
  ).trim();
  if (variantId === DATAMMO_VARIANT_PKG2) return PACKAGE2_SHELF_MAIN;
  if (variantId === DATAMMO_VARIANT_PKG2_CHEAP) return PACKAGE2_SHELF_CHEAP;
  return normalizeDatammoRouteShelf(req.params?.shelf || req.query?.shelf);
};
const claimPackage2AccountsForOrder = async ({
  quantity,
  orderId,
  managedUserName,
}) => {
  const claimed = [];
  for (let i = 0; i < quantity; i += 1) {
    const nowIso = new Date().toISOString();
    const assignedUserName = String(
      managedUserName || `Datammo#${orderId || Date.now()}`,
    ).trim();
    const oldAcc = await Account.findOneAndUpdate(
      buildPackage2SaleFilter(),
      {
        $set: {
          users: [
            {
              name: assignedUserName,
              joinedAt: nowIso,
              expiredAt: "",
            },
          ],
        },
      },
      {
        sort: { createdAt: 1, id: 1 },
        new: false,
      },
    );

    if (!oldAcc) break;

    const updatedAcc = await Account.findOne({ id: oldAcc.id });
    if (!updatedAcc) break;

    claimed.push({
      oldAcc,
      updatedAcc,
      delivery: formatPackage2DeliveryLine(updatedAcc),
    });
  }
  return claimed;
};
const rollbackClaimedPackage2Accounts = async (claimed = []) => {
  for (const item of claimed) {
    if (!item?.oldAcc?.id || !item?.updatedAcc) continue;
    await Account.findOneAndUpdate(
      { id: item.oldAcc.id },
      {
        $set: {
          users: item.oldAcc.users || [],
          note: item.oldAcc.note || "",
          status: item.oldAcc.status || "available",
          package2Shelf: normalizePackage2Shelf(
            item.oldAcc.package2Shelf,
            CHATGPT_TOTAL_VALUE,
          ),
          updatedAt: item.oldAcc.updatedAt || new Date().toISOString(),
        },
      },
    );
  }
};
const buildStoreCustomerRecord = (user, joinedAt = new Date()) => {
  const joinedDate = new Date(joinedAt);
  const expiredAt = addDurationToDate(joinedDate, "1M");
  return {
    name: String(user?.fullName || user?.email || "Khách").trim(),
    joinedAt: joinedDate.toISOString(),
    expiredAt: expiredAt.toISOString(),
  };
};
const buildStoreCustomerRecordFromOrder = (order = {}, storeUser = null) => {
  const joinedAtRaw = String(
    order?.assignedCustomerJoinedAt ||
      order?.fulfilledAt ||
      order?.paidAt ||
      order?.createdAt ||
      new Date().toISOString(),
  ).trim();
  const joinedDate = new Date(joinedAtRaw || new Date());
  const expiredAtRaw = String(order?.assignedCustomerExpiredAt || "").trim();
  const expiredDate = expiredAtRaw
    ? new Date(expiredAtRaw)
    : addDurationToDate(joinedDate, "1M");
  return {
    name: String(
      order?.assignedCustomerName ||
        storeUser?.fullName ||
        storeUser?.email ||
        "Khách",
    ).trim(),
    joinedAt: joinedDate.toISOString(),
    expiredAt: expiredDate.toISOString(),
  };
};
const getStoreWarrantyRelatedAccountIds = (order = {}) => {
  const ids = new Set();
  ids.add(String(order?.reservedAccountId || "").trim());
  ids.add(String(order?.assignedAccountId || "").trim());
  ids.add(String(order?.rootAssignedAccountId || "").trim());
  (Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : []).forEach((round) => {
    ids.add(String(round?.fromAccountId || "").trim());
    ids.add(String(round?.toAccountId || "").trim());
  });
  return Array.from(ids).filter(Boolean);
};
const buildStoreTotalMinExpiredAtIso = () =>
  new Date(Date.now() + STORE_TOTAL_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString();
const buildMongoSafeUsersArrayExpr = () => ({
  $cond: [{ $isArray: "$users" }, "$users", []],
});
const buildStorePackage1ExistingFilter = (excludeIds = []) => ({
  type: "package1",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $lt: [{ $size: buildMongoSafeUsersArrayExpr() }, 3],
  },
});
const buildStorePackage1ExistingReplacementFilter = (excludeIds = []) => ({
  type: "package1",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: buildMongoSafeUsersArrayExpr() }, 0],
  },
});
const buildStorePackage1ConvertibleFilter = (excludeIds = []) => ({
  type: "unassigned",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: buildMongoSafeUsersArrayExpr() }, 0],
  },
});
const buildStorePackage2ConvertibleFilter = (excludeIds = []) => ({
  type: "unassigned",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: buildMongoSafeUsersArrayExpr() }, 0],
  },
});
const buildStorePackage2ExistingReplacementFilter = (excludeIds = []) => ({
  type: "package2",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: buildMongoSafeUsersArrayExpr() }, 0],
  },
});
const buildStoreReservedFulfillmentFilter = ({
  accountId = "",
  maxUsers = 0,
  allowUnderCapacity = false,
} = {}) => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) {
    return { id: "__missing_reserved_store_account__" };
  }
  return {
    id: normalizedId,
    note: { $not: STORE_WARRANTY_HOLD_NOTE_REGEX },
    expiredAt: { $gt: new Date().toISOString() },
    $expr: allowUnderCapacity
      ? {
          $lt: [{ $size: buildMongoSafeUsersArrayExpr() }, Math.max(1, Number(maxUsers || 0))],
        }
      : {
          $eq: [{ $size: buildMongoSafeUsersArrayExpr() }, Math.max(0, Number(maxUsers || 0))],
        },
  };
};
const sanitizeStoreWarrantyCandidate = (account = {}) => ({
  id: String(account?.id || "").trim(),
  username: String(account?.username || "").trim(),
  type: String(account?.type || "").trim(),
  package2Shelf: normalizePackage2Shelf(
    account?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  ),
  expiredAt: String(account?.expiredAt || "").trim(),
  createdAt: String(account?.createdAt || "").trim(),
  candidateState: pickChatgptCurrentStatePayload(account),
  excludedReason:
    account?.excludedReason && typeof account.excludedReason === "object"
      ? account.excludedReason
      : null,
});
const sanitizeChatgptMoveCandidate = (account = {}) => ({
  id: String(account?.id || "").trim(),
  username: String(account?.username || "").trim(),
  type: String(account?.type || "").trim(),
  package2Shelf: normalizePackage2Shelf(
    account?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  ),
  users: Array.isArray(account?.users)
    ? account.users.map((user) => ({
        name: String(user?.name || "").trim(),
        joinedAt: String(user?.joinedAt || "").trim(),
        expiredAt: String(user?.expiredAt || "").trim(),
      }))
    : [],
  expiredAt: String(account?.expiredAt || "").trim(),
  createdAt: String(account?.createdAt || "").trim(),
  updatedAt: String(account?.updatedAt || "").trim(),
  candidateState: pickChatgptCurrentStatePayload(account),
  excludedReason:
    account?.excludedReason && typeof account.excludedReason === "object"
      ? account.excludedReason
      : null,
});
const getTrackedMarketplaceChatgptAccountIds = async () => {
  const [orders, warrantyCases] = await Promise.all([
    DatammoOrder.find({ scope: "chatgpt" })
      .select("accounts.accountId")
      .lean(),
    DatammoWarrantyCase.find({ scope: "chatgpt" })
      .select("rootAccountId currentAccountId rounds.fromAccountId rounds.toAccountId")
      .lean(),
  ]);
  const ids = new Set();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    (Array.isArray(order?.accounts) ? order.accounts : []).forEach((item) => {
      const accountId = String(item?.accountId || "").trim();
      if (accountId) ids.add(accountId);
    });
  });
  (Array.isArray(warrantyCases) ? warrantyCases : []).forEach((item) => {
    const rootId = String(item?.rootAccountId || "").trim();
    const currentId = String(item?.currentAccountId || "").trim();
    if (rootId) ids.add(rootId);
    if (currentId) ids.add(currentId);
    (Array.isArray(item?.rounds) ? item.rounds : []).forEach((round) => {
      const fromId = String(round?.fromAccountId || "").trim();
      const toId = String(round?.toAccountId || "").trim();
      if (fromId) ids.add(fromId);
      if (toId) ids.add(toId);
    });
  });
  return Array.from(ids);
};
const hasTrackedMarketplaceChatgptAccount = async (accountId = "") => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return false;
  const [order, warrantyCase] = await Promise.all([
    DatammoOrder.findOne({
      scope: "chatgpt",
      "accounts.accountId": normalizedId,
    })
      .select("_id")
      .lean(),
    DatammoWarrantyCase.findOne({
      scope: "chatgpt",
      $or: [
        { rootAccountId: normalizedId },
        { currentAccountId: normalizedId },
        { "rounds.fromAccountId": normalizedId },
        { "rounds.toAccountId": normalizedId },
      ],
    })
      .select("_id")
      .lean(),
  ]);
  return !!(order || warrantyCase);
};
const canChatgptAccountReceiveMovedUser = (account = {}, sourceType = "") => {
  const destinationType = String(account?.type || "").trim();
  const currentUsers = Array.isArray(account?.users) ? account.users.length : 0;

  if (destinationType === sourceType) {
    if (sourceType === "package1") return currentUsers < 3;
    if (sourceType === "package2") return currentUsers < 1;
  }

  if (destinationType === "unassigned") {
    if (sourceType === "package1") return currentUsers < 3;
    if (sourceType === "package2") return currentUsers < 1;
    return currentUsers < 1;
  }

  return false;
};
const listChatgptMoveCandidates = async (sourceAccount = {}) => {
  const sourceId = String(sourceAccount?.id || "").trim();
  const sourceType = String(sourceAccount?.type || "").trim();
  const allowedTypes =
    sourceType === "package1" || sourceType === "package2"
      ? [sourceType, "unassigned"]
      : sourceType
        ? [sourceType, "unassigned"]
        : ["unassigned"];
  const [trackedIdsRaw, pendingReservedIdsRaw] = await Promise.all([
    getTrackedMarketplaceChatgptAccountIds(),
    listActivePendingStoreReservedAccountIds(),
  ]);
  const trackedIds = new Set(trackedIdsRaw);
  const pendingReservedIds = new Set(pendingReservedIdsRaw);
  const candidates = await Account.find({
    id: { $ne: sourceId },
    type: { $in: allowedTypes },
    package2Shelf: CHATGPT_TOTAL_VALUE,
  })
    .sort({ createdAt: 1, id: 1 })
    .select("id username type package2Shelf users expiredAt createdAt updatedAt")
    .lean();
  const decoratedCandidates = await decorateChatgptAccountsWithOperationalState(
    candidates,
  );
  return (Array.isArray(decoratedCandidates) ? decoratedCandidates : [])
    .filter((account) => {
      const accountId = String(account?.id || "").trim();
      if (!accountId) return false;
      if (trackedIds.has(accountId)) return false;
      if (pendingReservedIds.has(accountId)) return false;
      if (!canChatgptAccountReceiveMovedUser(account, sourceType)) {
        return false;
      }
      return buildChatgptActionDecision(account, "move_destination", {
        sourceId,
        sourceType,
      }).allowed;
    })
    .map(sanitizeChatgptMoveCandidate);
};
const listChatgptWarrantyCandidates = async (sourceAccount = {}) => {
  const sourceId = String(sourceAccount?.id || "").trim();
  const busyIds = new Set(await getBusyChatgptAccountIdsForStoreWarranty());
  const candidates = await Account.find({
    id: { $ne: sourceId },
    type: { $in: ["package2", "unassigned"] },
  })
    .sort({ createdAt: 1, id: 1 })
    .select("id username type package2Shelf users expiredAt createdAt updatedAt")
    .lean();
  const decoratedCandidates = await decorateChatgptAccountsWithOperationalState(
    candidates,
  );
  return (Array.isArray(decoratedCandidates) ? decoratedCandidates : [])
    .filter((account) => {
      const accountId = String(account?.id || "").trim();
      if (!accountId) return false;
      if (busyIds.has(accountId)) return false;
      return buildChatgptActionDecision(
        account,
        "chatgpt_warranty_replacement",
        { sourceId },
      ).allowed;
    })
    .map(sanitizeChatgptMoveCandidate);
};
const getBusyChatgptAccountIdsForStoreOrders = async () => {
  const [marketplaceOrders, activeCases] = await Promise.all([
    DatammoOrder.find({ scope: "chatgpt" })
      .select("accounts.accountId")
      .lean(),
    DatammoWarrantyCase.find({
      scope: "chatgpt",
      status: "active",
    })
      .select("rootAccountId currentAccountId rounds.fromAccountId rounds.toAccountId")
      .lean(),
  ]);
  const ids = new Set();
  (Array.isArray(marketplaceOrders) ? marketplaceOrders : []).forEach((order) => {
    (Array.isArray(order?.accounts) ? order.accounts : []).forEach((item) => {
      const accountId = String(item?.accountId || "").trim();
      if (accountId) ids.add(accountId);
    });
  });
  (Array.isArray(activeCases) ? activeCases : []).forEach((item) => {
    const rootId = String(item?.rootAccountId || "").trim();
    const currentId = String(item?.currentAccountId || "").trim();
    if (rootId) ids.add(rootId);
    if (currentId) ids.add(currentId);
    (Array.isArray(item?.rounds) ? item.rounds : []).forEach((round) => {
      const fromId = String(round?.fromAccountId || "").trim();
      const toId = String(round?.toAccountId || "").trim();
      if (fromId) ids.add(fromId);
      if (toId) ids.add(toId);
    });
  });
  return Array.from(ids);
};
const getBusyChatgptAccountIdsForStoreWarranty = async ({
  excludeOrderId = "",
} = {}) => {
  const [marketplaceBusyIds, storeOrders] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    StoreOrder.find({
      ...(excludeOrderId ? { id: { $ne: excludeOrderId } } : {}),
      status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
    })
      .select(
        "reservedAccountId assignedAccountId rootAssignedAccountId warrantyRounds.fromAccountId warrantyRounds.toAccountId",
      )
      .lean(),
  ]);
  const ids = new Set(Array.isArray(marketplaceBusyIds) ? marketplaceBusyIds : []);
  (Array.isArray(storeOrders) ? storeOrders : []).forEach((order) => {
    ids.add(String(order?.reservedAccountId || "").trim());
    ids.add(String(order?.assignedAccountId || "").trim());
    ids.add(String(order?.rootAssignedAccountId || "").trim());
    (Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : []).forEach(
      (round) => {
        ids.add(String(round?.fromAccountId || "").trim());
        ids.add(String(round?.toAccountId || "").trim());
      },
    );
  });
  return Array.from(ids).filter(Boolean);
};
const getStoreWarrantyCandidateExcludeIds = async (order = {}) => {
  const orderId = String(order?.id || "").trim();
  const [busyIds] = await Promise.all([
    getBusyChatgptAccountIdsForStoreWarranty({ excludeOrderId: orderId }),
  ]);
  return Array.from(
    new Set([
      ...(Array.isArray(busyIds) ? busyIds : []),
      ...getStoreWarrantyRelatedAccountIds(order),
    ]),
  ).filter(Boolean);
};
const listStoreWarrantyCandidates = async (order = {}) => {
  const packageCode = String(order?.packageCode || "").trim();
  if (!["package1", "package2"].includes(packageCode)) return [];
  const excludeIds = await getStoreWarrantyCandidateExcludeIds(order);
  if (packageCode === "package1") {
    const [existingAccounts, convertibleAccounts] = await Promise.all([
      Account.find(buildStorePackage1ExistingReplacementFilter(excludeIds))
        .sort({ createdAt: 1, id: 1 })
        .select("id username type package2Shelf expiredAt createdAt")
        .lean(),
      Account.find(buildStorePackage1ConvertibleFilter(excludeIds))
        .sort({ createdAt: 1, id: 1 })
        .select("id username type package2Shelf expiredAt createdAt")
        .lean(),
    ]);
    const decoratedCandidates = await decorateChatgptAccountsWithOperationalState([
      ...existingAccounts,
      ...convertibleAccounts,
    ]);
    return decoratedCandidates
      .filter((account) =>
        buildChatgptActionDecision(
          account,
          String(account?.type || "").trim() === "package1"
            ? "store_package1_existing_replacement"
            : "store_package1_convertible_replacement",
        ).allowed,
      )
      .map(sanitizeStoreWarrantyCandidate);
  }
  const [existingAccounts, convertibleAccounts] = await Promise.all([
    Account.find(buildStorePackage2ExistingReplacementFilter(excludeIds))
      .sort({ createdAt: 1, id: 1 })
      .select("id username type package2Shelf expiredAt createdAt")
      .lean(),
    Account.find(buildStorePackage2ConvertibleFilter(excludeIds))
      .sort({ createdAt: 1, id: 1 })
      .select("id username type package2Shelf expiredAt createdAt")
      .lean(),
  ]);
  const decoratedCandidates = await decorateChatgptAccountsWithOperationalState([
    ...existingAccounts,
    ...convertibleAccounts,
  ]);
  return decoratedCandidates
    .filter((account) =>
      buildChatgptActionDecision(
        account,
        String(account?.type || "").trim() === "package2"
          ? "store_package2_existing_replacement"
          : "store_package2_convertible_replacement",
      ).allowed,
    )
    .map(sanitizeStoreWarrantyCandidate);
};
const getStoreReusablePendingOrder = async ({ userId, packageCode }) => {
  await expireStaleStoreOrders({ userId });
  return StoreOrder.findOne(
    buildStoreActivePendingOrderQuery({
      userId,
      packageCode,
    }),
  )
    .sort({ createdAt: -1, id: -1 })
    .lean();
};
const findStorePackage1ExistingTarget = async ({
  excludeAccountIds = [],
  reservationSnapshot = null,
} = {}) => {
  const rawAccounts = await Account.find(
    buildStorePackage1ExistingFilter(excludeAccountIds),
  )
    .sort({ createdAt: 1, id: 1 })
    .select("id username type package2Shelf users expiredAt note createdAt updatedAt")
    .lean();
  const accounts = await decorateChatgptAccountsWithOperationalState(rawAccounts);
  const reservedCounts = reservationSnapshot?.package1ExistingCounts || new Map();
  for (const account of accounts) {
    const decision = buildChatgptActionDecision(
      account,
      "store_package1_existing_sale",
    );
    if (!decision.allowed) continue;
    const usedSlots = Array.isArray(account?.users) ? account.users.length : 0;
    const reservedSlots = Number(reservedCounts.get(String(account?.id || "").trim()) || 0);
    if (Math.max(0, 3 - usedSlots - reservedSlots) > 0) {
      return account;
    }
  }
  return null;
};
const findStorePackage2ExistingTarget = async ({ excludeAccountIds = [] } = {}) =>
  (async () => {
    const rawAccounts = await Account.find(
      buildStorePackage2ExistingReplacementFilter(excludeAccountIds),
    )
      .sort({ createdAt: 1, id: 1 })
      .select("id username type package2Shelf users expiredAt note createdAt updatedAt")
      .lean();
    const accounts = await decorateChatgptAccountsWithOperationalState(rawAccounts);
    return (
      accounts.find((account) =>
        buildChatgptActionDecision(account, "store_package2_existing_sale").allowed,
      ) || null
    );
  })();
const findStoreConvertibleTarget = async ({
  excludeAccountIds = [],
  action = "store_package2_convertible_sale",
} = {}) =>
  (async () => {
    const rawAccounts = await Account.find(
      buildStorePackage2ConvertibleFilter(excludeAccountIds),
    )
      .sort({ createdAt: 1, id: 1 })
      .select("id username type package2Shelf users expiredAt note createdAt updatedAt")
      .lean();
    const accounts = await decorateChatgptAccountsWithOperationalState(rawAccounts);
    return (
      accounts.find((account) =>
        buildChatgptActionDecision(account, action).allowed,
      ) || null
    );
  })();
const selectStorePackage1ReservationTarget = async ({ excludeOrderId = "" } = {}) => {
  const [busyIds, reservationSnapshot] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    buildStoreReservationSnapshot({ excludeOrderId }),
  ]);
  const existingTarget = await findStorePackage1ExistingTarget({
    excludeAccountIds: busyIds,
    reservationSnapshot,
  });
  if (existingTarget?.id) {
    return {
      reservationType: "package1_existing",
      reservedAccountId: String(existingTarget.id || "").trim(),
      reservedAccountUsername: String(existingTarget.username || "").trim(),
    };
  }
  const convertibleTarget = await findStoreConvertibleTarget({
    excludeAccountIds: [...new Set([...busyIds, ...Array.from(reservationSnapshot.reservedAccountIds)])],
    action: "store_package1_convertible_sale",
  });
  if (convertibleTarget?.id) {
    return {
      reservationType: "package1_convertible",
      reservedAccountId: String(convertibleTarget.id || "").trim(),
      reservedAccountUsername: String(convertibleTarget.username || "").trim(),
    };
  }
  return null;
};
const selectStorePackage2ReservationTarget = async ({ excludeOrderId = "" } = {}) => {
  const [busyIds, reservationSnapshot] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    buildStoreReservationSnapshot({ excludeOrderId }),
  ]);
  const excludeAccountIds = [
    ...new Set([...busyIds, ...Array.from(reservationSnapshot.reservedAccountIds)]),
  ];
  const existingTarget = await findStorePackage2ExistingTarget({
    excludeAccountIds,
  });
  if (existingTarget?.id) {
    return {
      reservationType: "package2_existing",
      reservedAccountId: String(existingTarget.id || "").trim(),
      reservedAccountUsername: String(existingTarget.username || "").trim(),
    };
  }
  const convertibleTarget = await findStoreConvertibleTarget({
    excludeAccountIds,
    action: "store_package2_convertible_sale",
  });
  if (!convertibleTarget?.id) return null;
  return {
    reservationType: "package2_convertible",
    reservedAccountId: String(convertibleTarget.id || "").trim(),
    reservedAccountUsername: String(convertibleTarget.username || "").trim(),
  };
};
const buildStoreChatgptWarehouseSummary = async () => {
  const [excludeIds, reservationSnapshot] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    buildStoreReservationSnapshot(),
  ]);
  const reservedAccountIds = Array.from(
    reservationSnapshot?.reservedAccountIds || [],
  );
  const convertibleExcludeIds = [
    ...new Set([...excludeIds, ...reservedAccountIds]),
  ];
  const [sharedAccounts, convertibleCount, package2ExistingCount] =
    await Promise.all([
      Account.find(buildStorePackage1ExistingFilter(excludeIds))
        .select("id users")
        .lean(),
      Account.countDocuments(
        buildStorePackage2ConvertibleFilter(convertibleExcludeIds),
      ),
      Account.countDocuments(
        buildStorePackage2ExistingReplacementFilter(convertibleExcludeIds),
      ),
    ]);

  const sharedSlots = sharedAccounts.reduce((sum, acc) => {
    const used = Array.isArray(acc?.users) ? acc.users.length : 0;
    const reserved = Number(
      reservationSnapshot?.package1ExistingCounts?.get(
        String(acc?.id || "").trim(),
      ) || 0,
    );
    return sum + Math.max(0, 3 - used - reserved);
  }, 0);

  return {
    package1: {
      sharedAccounts: sharedAccounts.length,
      sharedSlots,
      convertibleAccounts: Number(convertibleCount || 0),
      availableNow: sharedSlots + Number(convertibleCount || 0) * 3,
    },
    package2: {
      existingAccounts: Number(package2ExistingCount || 0),
      convertibleAccounts: Number(convertibleCount || 0),
      availableNow:
        Number(package2ExistingCount || 0) + Number(convertibleCount || 0),
    },
  };
};
const countStorePackage1Stock = async () => {
  const [excludeIds, reservationSnapshot] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    buildStoreReservationSnapshot(),
  ]);
  const [sharedAccounts, convertibleCount] = await Promise.all([
    Account.find(buildStorePackage1ExistingFilter(excludeIds))
      .select("id users")
      .lean(),
    Account.countDocuments(
      buildStorePackage1ConvertibleFilter([
        ...new Set([...excludeIds, ...Array.from(reservationSnapshot.reservedAccountIds)]),
      ]),
    ),
  ]);
  const freeSharedSlots = sharedAccounts.reduce((sum, acc) => {
    const used = Array.isArray(acc?.users) ? acc.users.length : 0;
    const reserved = Number(
      reservationSnapshot.package1ExistingCounts.get(
        String(acc?.id || "").trim(),
      ) || 0,
    );
    return sum + Math.max(0, 3 - used - reserved);
  }, 0);
  return freeSharedSlots + convertibleCount * 3;
};
const countStorePackage2Stock = async () => {
  const [excludeIds, reservationSnapshot] = await Promise.all([
    getBusyChatgptAccountIdsForStoreOrders(),
    buildStoreReservationSnapshot(),
  ]);
  const excludeAccountIds = [
    ...new Set([...excludeIds, ...Array.from(reservationSnapshot.reservedAccountIds)]),
  ];
  const [existingCount, convertibleCount] = await Promise.all([
    Account.countDocuments(
      buildStorePackage2ExistingReplacementFilter(excludeAccountIds),
    ),
    Account.countDocuments(buildStorePackage2ConvertibleFilter(excludeAccountIds)),
  ]);
  return Number(existingCount || 0) + Number(convertibleCount || 0);
};
const buildStoreCatalog = async () => {
  const packageMap = await getStorePackageMap();
  const [package1Stock, package2Stock] = await Promise.all([
    countStorePackage1Stock(),
    countStorePackage2Stock(),
  ]);
  return [
    {
      ...packageMap.package1,
      available: package1Stock,
      purchasable: package1Stock > 0,
    },
    {
      ...packageMap.package2,
      available: package2Stock,
      purchasable: package2Stock > 0,
    },
    {
      ...packageMap.package3,
      available: null,
      purchasable: false,
    },
  ];
};
const STORE_CATALOG_CACHE_TTL_MS = 10000;
let storeCatalogCacheData = null;
let storeCatalogCacheExpiresAt = 0;
let storeCatalogCachePromise = null;
const clearStoreCatalogCache = () => {
  storeCatalogCacheData = null;
  storeCatalogCacheExpiresAt = 0;
  storeCatalogCachePromise = null;
};
const getCachedStoreCatalog = async ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && storeCatalogCacheData && storeCatalogCacheExpiresAt > now) {
    return storeCatalogCacheData;
  }
  if (!force && storeCatalogCachePromise) {
    return storeCatalogCachePromise;
  }
  storeCatalogCachePromise = buildStoreCatalog()
    .then((packages) => {
      storeCatalogCacheData = packages;
      storeCatalogCacheExpiresAt = Date.now() + STORE_CATALOG_CACHE_TTL_MS;
      return packages;
    })
    .finally(() => {
      storeCatalogCachePromise = null;
    });
  return storeCatalogCachePromise;
};
const claimStorePackage1AccountForOrder = async ({ order, user }) => {
  const customer = buildStoreCustomerRecord(user);
  const reservedAccountId = String(order?.reservedAccountId || "").trim();
  const reservationType = String(order?.reservationType || "").trim();
  let oldAcc = null;
  let convertedFromUnassigned = false;
  if (reservedAccountId && reservationType === "package1_existing") {
    oldAcc = await Account.findOneAndUpdate(
      buildStoreReservedFulfillmentFilter({
        accountId: reservedAccountId,
        maxUsers: 3,
        allowUnderCapacity: true,
      }),
      {
        $push: { users: customer },
        $set: {
          type: "package1",
          package2Shelf: CHATGPT_TOTAL_VALUE,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: false },
    );
  }
  if (reservedAccountId && reservationType === "package1_convertible" && !oldAcc) {
    oldAcc = await Account.findOneAndUpdate(
      buildStoreReservedFulfillmentFilter({
        accountId: reservedAccountId,
        maxUsers: 0,
      }),
      {
        $set: {
          type: "package1",
          package2Shelf: CHATGPT_TOTAL_VALUE,
          users: [customer],
          updatedAt: new Date().toISOString(),
        },
      },
      { new: false },
    );
    convertedFromUnassigned = !!oldAcc;
  }
  if (reservedAccountId && !oldAcc) {
    const error = new Error(
      "Nick da giu cho don nay khong con hop le de giao tu dong. Khong doi sang nick khac de tranh giao nham.",
    );
    error.statusCode = 409;
    throw error;
  }
  if (!oldAcc) {
    const fallbackTarget = await selectStorePackage1ReservationTarget({
      excludeOrderId: String(order?.id || "").trim(),
    });
    if (
      fallbackTarget?.reservedAccountId &&
      fallbackTarget.reservationType === "package1_existing"
    ) {
      oldAcc = await Account.findOneAndUpdate(
        { id: fallbackTarget.reservedAccountId, ...buildStorePackage1ExistingFilter() },
        {
          $push: { users: customer },
          $set: {
            type: "package1",
            package2Shelf: CHATGPT_TOTAL_VALUE,
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
    }
    if (
      fallbackTarget?.reservedAccountId &&
      fallbackTarget.reservationType === "package1_convertible" &&
      !oldAcc
    ) {
      oldAcc = await Account.findOneAndUpdate(
        { id: fallbackTarget.reservedAccountId, ...buildStorePackage1ConvertibleFilter() },
        {
          $set: {
            type: "package1",
            package2Shelf: CHATGPT_TOTAL_VALUE,
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
      convertedFromUnassigned = !!oldAcc;
    }
  }
  if (!oldAcc) {
    const error = new Error(
      "Kho tổng Gói 1 hiện không còn tài khoản hoặc slot phù hợp",
    );
    error.statusCode = 409;
    throw error;
  }
  const updatedAcc = await Account.findOne({ id: oldAcc.id }).lean();
  return {
    oldAcc,
    updatedAcc,
    delivery: "",
    package1AccessToken: `PK1-${createRandomHexToken(10).toUpperCase()}`,
    convertedFromUnassigned,
    customer,
  };
};
const claimStorePackage2AccountForOrder = async ({ order, user }) => {
  const customer = buildStoreCustomerRecord(user);
  const reservedAccountId = String(order?.reservedAccountId || "").trim();
  const reservationType = String(order?.reservationType || "").trim();
  let oldAcc = null;
  if (reservedAccountId && reservationType === "package2_existing") {
    oldAcc = await Account.findOneAndUpdate(
      buildStoreReservedFulfillmentFilter({
        accountId: reservedAccountId,
        maxUsers: 0,
      }),
      {
        $set: {
          type: "package2",
          package2Shelf: CHATGPT_TOTAL_VALUE,
          users: [customer],
          updatedAt: new Date().toISOString(),
        },
      },
      { new: false },
    );
  }
  if (
    reservedAccountId &&
    (!reservationType || reservationType === "package2_convertible") &&
    !oldAcc
  ) {
    oldAcc = await Account.findOneAndUpdate(
      buildStoreReservedFulfillmentFilter({
        accountId: reservedAccountId,
        maxUsers: 0,
      }),
      {
        $set: {
          type: "package2",
          package2Shelf: CHATGPT_TOTAL_VALUE,
          users: [customer],
          updatedAt: new Date().toISOString(),
        },
      },
      { new: false },
    );
  }
  if (reservedAccountId && !oldAcc) {
    const error = new Error(
      "Nick da giu cho don nay khong con hop le de giao tu dong. Khong doi sang nick khac de tranh giao nham.",
    );
    error.statusCode = 409;
    throw error;
  }
  if (!oldAcc) {
    const fallbackTarget = await selectStorePackage2ReservationTarget({
      excludeOrderId: String(order?.id || "").trim(),
    });
    if (
      fallbackTarget?.reservedAccountId &&
      fallbackTarget.reservationType === "package2_existing"
    ) {
      oldAcc = await Account.findOneAndUpdate(
        {
          id: fallbackTarget.reservedAccountId,
          ...buildStorePackage2ExistingReplacementFilter(),
        },
        {
          $set: {
            type: "package2",
            package2Shelf: CHATGPT_TOTAL_VALUE,
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
    }
    if (
      fallbackTarget?.reservedAccountId &&
      (!fallbackTarget.reservationType ||
        fallbackTarget.reservationType === "package2_convertible") &&
      !oldAcc
    ) {
      oldAcc = await Account.findOneAndUpdate(
        { id: fallbackTarget.reservedAccountId, ...buildStorePackage2ConvertibleFilter() },
        {
          $set: {
            type: "package2",
            package2Shelf: CHATGPT_TOTAL_VALUE,
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
    }
  }
  if (!oldAcc) {
    const error = new Error("Kho tổng Gói 2 hiện không còn nick mới phù hợp");
    error.statusCode = 409;
    throw error;
  }
  const updatedAcc = await Account.findOne({ id: oldAcc.id }).lean();
  return {
    oldAcc,
    updatedAcc,
    delivery: formatPackage2DeliveryLine(updatedAcc),
    customer,
  };
};
const claimStorePackage1WarrantyReplacement = async ({
  order,
  storeUser,
  replacementAccountId = "",
}) => {
  const customer = buildStoreCustomerRecordFromOrder(order, storeUser);
  const targetId = String(replacementAccountId || "").trim();
  const excludeIds = await getStoreWarrantyCandidateExcludeIds(order);
  let oldAcc = null;
  if (targetId) {
    if (excludeIds.includes(targetId)) {
      const error = new Error("Acc thay thế này không còn hợp lệ để bảo hành.");
      error.statusCode = 409;
      throw error;
    }
    const targetStateMap = await loadChatgptAccountOperationalStateMap(
      [targetId],
      { excludeStoreOrderId: String(order?.id || "").trim() },
    );
    const decoratedTarget = targetStateMap.get(targetId) || null;
    const replacementAction = resolveStoreWarrantyReplacementAction({
      packageCode: "package1",
      destinationType: String(decoratedTarget?.type || "unassigned").trim(),
    });
    const replacementDecision = buildChatgptActionDecision(
      decoratedTarget || { id: targetId },
      replacementAction,
    );
    if (!replacementDecision.allowed) {
      const error = new Error(
        String(
          replacementDecision.primaryReason?.message ||
            "Acc thay the nay khong con hop le de bao hanh.",
        ).trim(),
      );
      error.statusCode = Number(
        replacementDecision.primaryReason?.statusCode || 409,
      );
      throw error;
    }
    oldAcc = await Account.findOneAndUpdate(
      { id: targetId, ...buildStorePackage1ExistingReplacementFilter() },
      {
        $push: { users: customer },
        $set: { updatedAt: new Date().toISOString() },
      },
      { new: false },
    );
    if (!oldAcc) {
      oldAcc = await Account.findOneAndUpdate(
        { id: targetId, ...buildStorePackage1ConvertibleFilter() },
        {
          $set: {
            type: "package1",
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
    }
  } else {
    oldAcc = await Account.findOneAndUpdate(
      buildStorePackage1ExistingReplacementFilter(excludeIds),
      {
        $push: { users: customer },
        $set: { updatedAt: new Date().toISOString() },
      },
      { sort: { createdAt: 1, id: 1 }, new: false },
    );
    if (!oldAcc) {
      oldAcc = await Account.findOneAndUpdate(
        buildStorePackage1ConvertibleFilter(excludeIds),
        {
          $set: {
            type: "package1",
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { sort: { createdAt: 1, id: 1 }, new: false },
      );
    }
  }
  if (!oldAcc) {
    const error = new Error("Kho tổng hiện không còn acc sạch phù hợp để bảo hành Gói 1.");
    error.statusCode = 409;
    throw error;
  }
  const updatedAcc = await Account.findOne({ id: oldAcc.id }).lean();
  return { oldAcc, updatedAcc, customer };
};
const claimStorePackage2WarrantyReplacement = async ({
  order,
  storeUser,
  replacementAccountId = "",
}) => {
  const customer = buildStoreCustomerRecordFromOrder(order, storeUser);
  const targetId = String(replacementAccountId || "").trim();
  const excludeIds = await getStoreWarrantyCandidateExcludeIds(order);
  let oldAcc = null;
  if (targetId) {
    if (excludeIds.includes(targetId)) {
      const error = new Error("Acc thay thế này không còn hợp lệ để bảo hành.");
      error.statusCode = 409;
      throw error;
    }
    const targetStateMap = await loadChatgptAccountOperationalStateMap(
      [targetId],
      { excludeStoreOrderId: String(order?.id || "").trim() },
    );
    const decoratedTarget = targetStateMap.get(targetId) || null;
    const replacementAction = resolveStoreWarrantyReplacementAction({
      packageCode: "package2",
      destinationType: String(decoratedTarget?.type || "unassigned").trim(),
    });
    const replacementDecision = buildChatgptActionDecision(
      decoratedTarget || { id: targetId },
      replacementAction,
    );
    if (!replacementDecision.allowed) {
      const error = new Error(
        String(
          replacementDecision.primaryReason?.message ||
            "Acc thay the nay khong con hop le de bao hanh.",
        ).trim(),
      );
      error.statusCode = Number(
        replacementDecision.primaryReason?.statusCode || 409,
      );
      throw error;
    }
    oldAcc = await Account.findOneAndUpdate(
      { id: targetId, ...buildStorePackage2ExistingReplacementFilter() },
      {
        $set: {
          users: [customer],
          updatedAt: new Date().toISOString(),
        },
      },
      { new: false },
    );
    if (!oldAcc) {
      oldAcc = await Account.findOneAndUpdate(
        { id: targetId, ...buildStorePackage2ConvertibleFilter() },
        {
          $set: {
            type: "package2",
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { new: false },
      );
    }
  } else {
    oldAcc = await Account.findOneAndUpdate(
      buildStorePackage2ExistingReplacementFilter(excludeIds),
      {
        $set: {
          users: [customer],
          updatedAt: new Date().toISOString(),
        },
      },
      { sort: { createdAt: 1, id: 1 }, new: false },
    );
    if (!oldAcc) {
      oldAcc = await Account.findOneAndUpdate(
        buildStorePackage2ConvertibleFilter(excludeIds),
        {
          $set: {
            type: "package2",
            users: [customer],
            updatedAt: new Date().toISOString(),
          },
        },
        { sort: { createdAt: 1, id: 1 }, new: false },
      );
    }
  }
  if (!oldAcc) {
    const error = new Error("Kho tổng hiện không còn acc sạch phù hợp để bảo hành Gói 2.");
    error.statusCode = 409;
    throw error;
  }
  const updatedAcc = await Account.findOne({ id: oldAcc.id }).lean();
  return { oldAcc, updatedAcc, customer };
};
const rollbackStoreClaimedAccount = async (claim = null) => {
  if (!claim?.oldAcc?.id) return;
  await Account.findOneAndUpdate(
    { id: claim.oldAcc.id },
    {
      $set: {
        type: String(claim.oldAcc.type || "unassigned"),
        users: Array.isArray(claim.oldAcc.users) ? claim.oldAcc.users : [],
        updatedAt: claim.oldAcc.updatedAt || new Date().toISOString(),
      },
    },
  );
  return (
    Number(moveManagedBusinessIntoMarket?.modifiedCount || 0) > 0 ||
    Number(moveNearExpiryOutOfMarket?.modifiedCount || 0) > 0 ||
    Number(resetInvalidShortWarehouse?.modifiedCount || 0) > 0
  );
};
const prepareStoreOrderForPaidFulfillment = async ({
  orderId = "",
  paidAt = "",
  paymentPatch = {},
  allowedStatuses = STORE_ACTIVE_RESERVATION_STATUSES,
} = {}) => {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) return { order: null, shouldFulfill: false };
  const nowIso = new Date().toISOString();
  const nextPaidAt = String(paidAt || "").trim() || nowIso;
  const allowedStatusList =
    Array.isArray(allowedStatuses) && allowedStatuses.length > 0
      ? allowedStatuses
      : STORE_ACTIVE_RESERVATION_STATUSES;
  const preparedOrder = await StoreOrder.findOneAndUpdate(
    {
      id: normalizedOrderId,
      status: { $in: allowedStatusList },
      fulfillmentState: { $nin: ["fulfilling", "fulfilled"] },
    },
    {
      $set: {
        ...paymentPatch,
        status: "paid",
        paidAt: nextPaidAt,
        fulfillmentState: "ready_for_fulfillment",
        fulfillmentReason: "",
        fulfillmentLockToken: "",
        fulfillmentLockedAt: "",
        fulfillmentSource: "",
        updatedAt: nowIso,
      },
    },
    { new: true },
  );
  if (preparedOrder) {
    return { order: preparedOrder, shouldFulfill: true };
  }
  if (Object.keys(paymentPatch || {}).length > 0) {
    await StoreOrder.findOneAndUpdate(
      { id: normalizedOrderId },
      {
        $set: {
          ...paymentPatch,
          updatedAt: nowIso,
        },
      },
    );
  }
  const currentOrder = await StoreOrder.findOne({ id: normalizedOrderId });
  return {
    order: currentOrder,
    shouldFulfill: isStoreOrderReadyForFulfillment(currentOrder),
  };
};
const acquireStoreOrderFulfillmentLock = async ({
  orderId = "",
  source = "",
} = {}) => {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    const error = new Error("Thieu ID don web de giao hang.");
    error.statusCode = 400;
    throw error;
  }
  const nowIso = new Date().toISOString();
  const lockToken = `store_fulfill_${createRandomHexToken(12)}`;
  const lockedOrder = await StoreOrder.findOneAndUpdate(
    {
      id: normalizedOrderId,
      status: "paid",
      fulfillmentState: { $nin: ["fulfilling", "fulfilled"] },
    },
    {
      $set: {
        fulfillmentState: "fulfilling",
        fulfillmentReason: "",
        fulfillmentLockToken: lockToken,
        fulfillmentLockedAt: nowIso,
        fulfillmentSource: String(source || "").trim(),
        updatedAt: nowIso,
      },
    },
    { new: true },
  );
  if (lockedOrder) {
    return {
      kind: "locked",
      order: lockedOrder,
      lockToken,
      source: String(source || "").trim(),
    };
  }
  const currentOrder = await StoreOrder.findOne({ id: normalizedOrderId });
  if (!currentOrder) {
    const error = new Error("Khong tim thay don web de giao hang.");
    error.statusCode = 404;
    throw error;
  }
  const currentStatus = normalizeStoreOrderStatusValue(currentOrder?.status);
  if (currentStatus === "fulfilled") {
    return { kind: "fulfilled", order: currentOrder, lockToken: "" };
  }
  if (currentStatus === "paid" && isStoreOrderFulfillmentInProgress(currentOrder)) {
    return { kind: "in_progress", order: currentOrder, lockToken: "" };
  }
  if (currentStatus !== "paid") {
    const error = new Error(
      "Don hang chua duoc xac nhan thanh toan, khong duoc giao nick.",
    );
    error.statusCode = 409;
    throw error;
  }
  return { kind: "stale", order: currentOrder, lockToken: "" };
};
const restoreStoreAccountSnapshot = async (account = null) => {
  if (!account?.id) return;
  await Account.findOneAndUpdate(
    { id: String(account.id || "").trim() },
    {
      $set: {
        type: String(account.type || "unassigned").trim() || "unassigned",
        users: Array.isArray(account.users) ? account.users : [],
        note: String(account.note || "").trim(),
        package2Shelf: normalizePackage2Shelf(
          account.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
        updatedAt: account.updatedAt || new Date().toISOString(),
      },
    },
  );
};
const normalizeStoreCleanupNames = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
const findStoreAssignedUserRemovalIndex = ({
  users = [],
  order = {},
  storeUser = null,
  account = null,
} = {}) => {
  if (!Array.isArray(users) || users.length === 0) return -1;
  const candidateNames = normalizeStoreCleanupNames([
    order?.assignedCustomerName,
    storeUser?.fullName,
    storeUser?.email,
    order?.customerName,
  ]);
  const candidateJoinedAt = String(
    order?.assignedCustomerJoinedAt || order?.fulfilledAt || order?.createdAt || "",
  ).trim();

  let matchedIndex = users.findIndex((slot) => {
    const slotName = String(slot?.name || "").trim();
    const slotJoinedAt = String(slot?.joinedAt || "").trim();
    return (
      !!slotName &&
      !!slotJoinedAt &&
      candidateNames.includes(slotName) &&
      candidateJoinedAt &&
      slotJoinedAt === candidateJoinedAt
    );
  });
  if (matchedIndex >= 0) return matchedIndex;

  matchedIndex = users.findIndex((slot) => {
    const slotJoinedAt = String(slot?.joinedAt || "").trim();
    return !!slotJoinedAt && !!candidateJoinedAt && slotJoinedAt === candidateJoinedAt;
  });
  if (matchedIndex >= 0) return matchedIndex;

  matchedIndex = users.findIndex((slot) => {
    const slotName = String(slot?.name || "").trim();
    return !!slotName && candidateNames.includes(slotName);
  });
  if (matchedIndex >= 0) return matchedIndex;

  if (
    users.length === 1 &&
    String(order?.assignedUsername || "").trim() &&
    String(account?.username || "").trim() === String(order?.assignedUsername || "").trim()
  ) {
    return 0;
  }
  if (users.length === 1 && String(order?.packageCode || "").trim() === "package2") {
    return 0;
  }
  return -1;
};
const cleanupStoreAssignedAccountForOrder = async (
  order = {},
  {
    forceClearIfNoRemainingStoreTrace = false,
    preserveExistingTypeOnClear = false,
  } = {},
) => {
  const accountId = String(order?.assignedAccountId || "").trim();
  if (!accountId) return;

  const [account, storeUser, remainingStoreOrders] = await Promise.all([
    Account.findOne({ id: accountId }).lean(),
    order?.userId ? StoreUser.findOne({ id: String(order.userId || "").trim() }).lean() : null,
    StoreOrder.find({
      id: { $ne: String(order?.id || "").trim() },
      $or: [{ assignedAccountId: accountId }, { reservedAccountId: accountId }],
    }).lean(),
  ]);
  if (!account) return;

  const currentUsers = Array.isArray(account?.users) ? account.users : [];
  const removalIndex = findStoreAssignedUserRemovalIndex({
    users: currentUsers,
    order,
    storeUser,
    account,
  });
  const nextUsers =
    removalIndex >= 0
      ? currentUsers.filter((_, index) => index !== removalIndex)
      : currentUsers;
  const hasRemainingStoreTrace =
    Array.isArray(remainingStoreOrders) && remainingStoreOrders.length > 0;
  const canForceClearResidualUser =
    forceClearIfNoRemainingStoreTrace &&
    !hasRemainingStoreTrace &&
    currentUsers.length <= 1;
  const finalUsers = canForceClearResidualUser ? [] : nextUsers;

  const nextType = (() => {
    if (preserveExistingTypeOnClear && finalUsers.length === 0) {
      return String(account?.type || "unassigned").trim() || "unassigned";
    }
    const packageCode = String(order?.packageCode || "").trim();
    const reservationType = String(order?.reservationType || "").trim();
    if (
      finalUsers.length === 0 &&
      (
        reservationType === "package1_convertible" ||
        reservationType === "package2_convertible" ||
        (packageCode === "package2" && !reservationType)
      )
    ) {
      return "unassigned";
    }
    return String(account?.type || "unassigned").trim() || "unassigned";
  })();

  await Account.findOneAndUpdate(
    { id: accountId },
    {
      $set: {
        type: nextType,
        users: finalUsers,
        package2Shelf: normalizePackage2Shelf(
          account?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
        updatedAt: new Date().toISOString(),
      },
    },
  );
};
const deleteStoreOrderForAdmin = async (orderInput = null) => {
  const order =
    typeof orderInput?.toObject === "function"
      ? orderInput.toObject()
      : { ...(orderInput || {}) };
  const orderId = String(order?.id || "").trim();
  if (!orderId) return false;

  const relatedAccountIds = getStoreWarrantyRelatedAccountIds(order);
  await cleanupStoreAssignedAccountForOrder(order, {
    forceClearIfNoRemainingStoreTrace: true,
  });
  await Promise.all(
    relatedAccountIds.map(async (accountId) => {
      const normalizedAccountId = String(accountId || "").trim();
      if (!normalizedAccountId) return;
      const account = await Account.findOne({ id: normalizedAccountId }).lean();
      if (!account) return;
      const nextNote = removeStoreWarrantyHoldNote(account?.note, orderId);
      if (nextNote === String(account?.note || "").trim()) return;
      await Account.findOneAndUpdate(
        { id: normalizedAccountId },
        {
          $set: {
            note: nextNote,
            updatedAt: new Date().toISOString(),
          },
        },
      );
    }),
  );
  await StoreOrder.deleteOne({ id: orderId });
  return true;
};
const warrantyStoreOrderForAdmin = async (
  orderInput = null,
  { replacementAccountId = "", reason = "" } = {},
) => {
  const order =
    typeof orderInput?.toObject === "function"
      ? orderInput.toObject()
      : { ...(orderInput || {}) };
  const orderId = String(order?.id || "").trim();
  const packageCode = String(order?.packageCode || "").trim();
  if (!orderId) {
    const error = new Error("Thiếu ID đơn web.");
    error.statusCode = 400;
    throw error;
  }
  if (!["package1", "package2"].includes(packageCode)) {
    const error = new Error("Chỉ hỗ trợ bảo hành đơn web Gói 1 hoặc Gói 2.");
    error.statusCode = 400;
    throw error;
  }
  if (normalizeStoreOrderStatusValue(order?.status) !== "fulfilled") {
    const error = new Error("Đơn web này chưa ở trạng thái đã giao nick.");
    error.statusCode = 400;
    throw error;
  }
  const currentAssignedId = String(order?.assignedAccountId || "").trim();
  if (!currentAssignedId) {
    const error = new Error("Đơn web này chưa có acc hiện tại để bảo hành.");
    error.statusCode = 400;
    throw error;
  }

  const [storeUser, currentAssignedSnapshot] = await Promise.all([
    order?.userId
      ? StoreUser.findOne({ id: String(order.userId || "").trim() }).lean()
      : null,
    Account.findOne({ id: currentAssignedId }).lean(),
  ]);
  if (!currentAssignedSnapshot) {
    const error = new Error("Không tìm thấy acc hiện tại của đơn web.");
    error.statusCode = 404;
    throw error;
  }

  let claim = null;
  try {
    if (packageCode === "package1") {
      claim = await claimStorePackage1WarrantyReplacement({
        order,
        storeUser,
        replacementAccountId,
      });
    } else {
      claim = await claimStorePackage2WarrantyReplacement({
        order,
        storeUser,
        replacementAccountId,
      });
    }
    const nextAssignedId = String(claim?.updatedAcc?.id || "").trim();
    if (!nextAssignedId || nextAssignedId === currentAssignedId) {
      const error = new Error("Acc thay thế không hợp lệ.");
      error.statusCode = 409;
      throw error;
    }

    await cleanupStoreAssignedAccountForOrder(order, {
      forceClearIfNoRemainingStoreTrace: true,
      preserveExistingTypeOnClear: true,
    });
    await Account.findOneAndUpdate(
      { id: currentAssignedId },
      {
        $set: {
          note: appendStoreWarrantyHoldNote(
            currentAssignedSnapshot?.note,
            orderId,
            new Date().toISOString(),
          ),
          package2Shelf: CHATGPT_TOTAL_VALUE,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    const nextRounds = [
      ...(Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : []),
      {
        sequence:
          (Array.isArray(order?.warrantyRounds) ? order.warrantyRounds.length : 0) +
          1,
        fromAccountId: currentAssignedId,
        fromUsername: String(
          order?.assignedUsername || currentAssignedSnapshot?.username || "",
        ).trim(),
        fromType: String(
          order?.assignedType || currentAssignedSnapshot?.type || "",
        ).trim(),
        toAccountId: nextAssignedId,
        toUsername: String(claim?.updatedAcc?.username || "").trim(),
        toType: String(claim?.updatedAcc?.type || "").trim(),
        reason: String(reason || "").trim(),
        createdAt: new Date().toISOString(),
      },
    ];

    await StoreOrder.findOneAndUpdate(
      { id: orderId },
      {
        $set: {
          assignedAccountId: nextAssignedId,
          assignedUsername: String(claim?.updatedAcc?.username || "").trim(),
          assignedPassword: String(claim?.updatedAcc?.password || "").trim(),
          assignedOtpSecret:
            packageCode === "package2"
              ? String(claim?.updatedAcc?.otpSecret || "").trim()
              : "",
          assignedLink: String(claim?.updatedAcc?.link || "").trim(),
          assignedType: String(claim?.updatedAcc?.type || "").trim(),
          assignedWarehouse: normalizePackage2Shelf(
            claim?.updatedAcc?.package2Shelf,
            CHATGPT_TOTAL_VALUE,
          ),
          assignedCustomerName: String(claim?.customer?.name || "").trim(),
          assignedCustomerJoinedAt: String(claim?.customer?.joinedAt || "").trim(),
          assignedCustomerExpiredAt: String(
            claim?.customer?.expiredAt || "",
          ).trim(),
          rootAssignedAccountId: String(
            order?.rootAssignedAccountId || currentAssignedId,
          ).trim(),
          rootAssignedUsername: String(
            order?.rootAssignedUsername ||
              order?.assignedUsername ||
              currentAssignedSnapshot?.username ||
              "",
          ).trim(),
          warrantyRounds: nextRounds,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    return StoreOrder.findOne({ id: orderId });
  } catch (error) {
    if (claim) {
      await rollbackStoreClaimedAccount(claim);
    }
    await restoreStoreAccountSnapshot(currentAssignedSnapshot);
    throw error;
  }
};

const fulfillStoreOrderLegacy = async (order) => {
  const safeOrder =
    typeof order?.toObject === "function" ? order.toObject() : { ...(order || {}) };
  if (!safeOrder?.id) {
    throw new Error("Đơn hàng không hợp lệ");
  }
  const normalizedStatus = String(safeOrder.status || "").trim().toLowerCase();
  if (normalizedStatus === "fulfilled") {
    return StoreOrder.findOne({ id: safeOrder.id });
  }
  if (normalizedStatus !== "paid") {
    const error = new Error(
      "Don hang chua duoc xac nhan thanh toan, khong duoc giao nick.",
    );
    error.statusCode = 409;
    throw error;
  }
  let claim = null;
  try {
    if (safeOrder.packageCode === "package1") {
      claim = await claimStorePackage1AccountForOrder({
        order: safeOrder,
        user: await StoreUser.findOne({ id: safeOrder.userId }).lean(),
      });
      await StoreOrder.findOneAndUpdate(
        { id: safeOrder.id },
        {
          $set: {
            status: "fulfilled",
            assignedAccountId: String(claim?.updatedAcc?.id || ""),
            assignedUsername: String(claim?.updatedAcc?.username || ""),
            rootAssignedAccountId: String(claim?.updatedAcc?.id || ""),
            rootAssignedUsername: String(claim?.updatedAcc?.username || ""),
            assignedPassword: String(claim?.updatedAcc?.password || ""),
            assignedLink: String(claim?.updatedAcc?.link || ""),
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
            assignedCustomerName: String(claim?.customer?.name || ""),
            assignedCustomerJoinedAt: String(claim?.customer?.joinedAt || ""),
          assignedCustomerExpiredAt: String(claim?.customer?.expiredAt || ""),
            reservationState: String(safeOrder?.reservedAccountId || "").trim()
              ? "consumed"
              : "none",
            fulfillmentState: "fulfilled",
            fulfillmentReason: "",
            package1AccessToken: String(claim?.package1AccessToken || ""),
            package1MaxUsage: STORE_PACKAGE1_MAX_OTP_USES,
            package1UsedCount: 0,
            fulfilledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        { new: true },
      );
    }
    if (safeOrder.packageCode === "package2") {
      claim = await claimStorePackage2AccountForOrder({
        order: safeOrder,
        user: await StoreUser.findOne({ id: safeOrder.userId }).lean(),
      });
      await StoreOrder.findOneAndUpdate(
        { id: safeOrder.id },
        {
          $set: {
            status: "fulfilled",
            assignedAccountId: String(claim?.updatedAcc?.id || ""),
            assignedUsername: String(claim?.updatedAcc?.username || ""),
            rootAssignedAccountId: String(claim?.updatedAcc?.id || ""),
            rootAssignedUsername: String(claim?.updatedAcc?.username || ""),
            assignedPassword: String(claim?.updatedAcc?.password || ""),
            assignedOtpSecret: String(claim?.updatedAcc?.otpSecret || ""),
            assignedLink: String(claim?.updatedAcc?.link || ""),
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
            assignedCustomerName: String(claim?.customer?.name || ""),
            assignedCustomerJoinedAt: String(claim?.customer?.joinedAt || ""),
            assignedCustomerExpiredAt: String(claim?.customer?.expiredAt || ""),
            reservationState: String(safeOrder?.reservedAccountId || "").trim()
              ? "consumed"
              : "none",
            fulfillmentState: "fulfilled",
            fulfillmentReason: "",
            fulfilledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        { new: true },
      );
    }
    return StoreOrder.findOne({ id: safeOrder.id });
  } catch (error) {
    if (claim) {
      await rollbackStoreClaimedAccount(claim);
    }
    await StoreOrder.findOneAndUpdate(
      { id: safeOrder.id },
      {
        $set: {
          status: "fulfillment_failed",
          reservationState: String(safeOrder?.reservedAccountId || "").trim()
            ? "blocked"
            : "none",
          fulfillmentState: "failed",
          fulfillmentReason: String(error?.message || "Fulfillment error").trim(),
          momoMessage: error.message || "Fulfillment error",
          updatedAt: new Date().toISOString(),
        },
      },
    );
    throw error;
  }
};
const fulfillStoreOrder = async (order, { source = "" } = {}) => {
  const inputOrder =
    typeof order?.toObject === "function" ? order.toObject() : { ...(order || {}) };
  const orderId = String(inputOrder?.id || "").trim();
  if (!orderId) {
    throw new Error("ÄÆ¡n hÃ ng khÃ´ng há»£p lá»‡");
  }

  const lock = await acquireStoreOrderFulfillmentLock({ orderId, source });
  if (lock.kind === "fulfilled") return lock.order;
  if (lock.kind === "in_progress") return lock.order;

  const lockedOrder =
    lock.kind === "locked" && lock.order ? lock.order : await StoreOrder.findOne({ id: orderId });
  if (!lockedOrder) {
    const error = new Error("Khong tim thay don web de giao hang.");
    error.statusCode = 404;
    throw error;
  }

  const normalizedStatus = normalizeStoreOrderStatusValue(lockedOrder?.status);
  if (normalizedStatus === "fulfilled") {
    return lockedOrder;
  }
  if (normalizedStatus !== "paid") {
    const error = new Error(
      "Don hang chua duoc xac nhan thanh toan, khong duoc giao nick.",
    );
    error.statusCode = 409;
    throw error;
  }

  const lockToken = String(lock?.lockToken || "").trim();
  const normalizedSource = String(source || lock?.source || "").trim();
  const nowIso = new Date().toISOString();
  const storeUser = lockedOrder?.userId
    ? await StoreUser.findOne({ id: String(lockedOrder.userId || "").trim() }).lean()
    : null;
  let claim = null;

  try {
    if (lockedOrder.packageCode === "package1") {
      claim = await claimStorePackage1AccountForOrder({
        order: lockedOrder,
        user: storeUser,
      });
      const savedOrder = await StoreOrder.findOneAndUpdate(
        {
          id: orderId,
          status: "paid",
          fulfillmentState: "fulfilling",
          fulfillmentLockToken: lockToken,
        },
        {
          $set: {
            status: "fulfilled",
            assignedAccountId: String(claim?.updatedAcc?.id || ""),
            assignedUsername: String(claim?.updatedAcc?.username || ""),
            rootAssignedAccountId: String(claim?.updatedAcc?.id || ""),
            rootAssignedUsername: String(claim?.updatedAcc?.username || ""),
            assignedPassword: String(claim?.updatedAcc?.password || ""),
            assignedLink: String(claim?.updatedAcc?.link || ""),
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
            assignedCustomerName: String(claim?.customer?.name || ""),
            assignedCustomerJoinedAt: String(claim?.customer?.joinedAt || ""),
            assignedCustomerExpiredAt: String(claim?.customer?.expiredAt || ""),
            reservationState: String(lockedOrder?.reservedAccountId || "").trim()
              ? "consumed"
              : "none",
            fulfillmentState: "fulfilled",
            fulfillmentReason: "",
            fulfillmentLockToken: "",
            fulfillmentLockedAt: "",
            fulfillmentSource: normalizedSource,
            package1AccessToken: String(claim?.package1AccessToken || ""),
            package1MaxUsage: STORE_PACKAGE1_MAX_OTP_USES,
            package1UsedCount: 0,
            fulfilledAt: nowIso,
            updatedAt: nowIso,
          },
        },
        { new: true },
      );
      if (savedOrder) return savedOrder;
    }
    if (lockedOrder.packageCode === "package2") {
      claim = await claimStorePackage2AccountForOrder({
        order: lockedOrder,
        user: storeUser,
      });
      const savedOrder = await StoreOrder.findOneAndUpdate(
        {
          id: orderId,
          status: "paid",
          fulfillmentState: "fulfilling",
          fulfillmentLockToken: lockToken,
        },
        {
          $set: {
            status: "fulfilled",
            assignedAccountId: String(claim?.updatedAcc?.id || ""),
            assignedUsername: String(claim?.updatedAcc?.username || ""),
            rootAssignedAccountId: String(claim?.updatedAcc?.id || ""),
            rootAssignedUsername: String(claim?.updatedAcc?.username || ""),
            assignedPassword: String(claim?.updatedAcc?.password || ""),
            assignedOtpSecret: String(claim?.updatedAcc?.otpSecret || ""),
            assignedLink: String(claim?.updatedAcc?.link || ""),
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
            assignedCustomerName: String(claim?.customer?.name || ""),
            assignedCustomerJoinedAt: String(claim?.customer?.joinedAt || ""),
            assignedCustomerExpiredAt: String(claim?.customer?.expiredAt || ""),
            reservationState: String(lockedOrder?.reservedAccountId || "").trim()
              ? "consumed"
              : "none",
            fulfillmentState: "fulfilled",
            fulfillmentReason: "",
            fulfillmentLockToken: "",
            fulfillmentLockedAt: "",
            fulfillmentSource: normalizedSource,
            fulfilledAt: nowIso,
            updatedAt: nowIso,
          },
        },
        { new: true },
      );
      if (savedOrder) return savedOrder;
    }

    const latestOrder = await StoreOrder.findOne({ id: orderId });
    if (normalizeStoreOrderStatusValue(latestOrder?.status) === "fulfilled") {
      return latestOrder;
    }
    return latestOrder || lockedOrder;
  } catch (error) {
    if (claim) {
      await rollbackStoreClaimedAccount(claim);
    }
    const failureReason = String(error?.message || "Fulfillment error").trim();
    const failedOrder = await StoreOrder.findOneAndUpdate(
      {
        id: orderId,
        status: "paid",
        fulfillmentState: "fulfilling",
        fulfillmentLockToken: lockToken,
      },
      {
        $set: {
          status: "fulfillment_failed",
          reservationState: String(lockedOrder?.reservedAccountId || "").trim()
            ? "blocked"
            : "none",
          fulfillmentState: "failed",
          fulfillmentReason: failureReason,
          fulfillmentLockToken: "",
          fulfillmentLockedAt: "",
          fulfillmentSource: normalizedSource,
          momoMessage: failureReason || "Fulfillment error",
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true },
    );
    if (failedOrder) {
      console.warn("Store fulfillment failed:", {
        orderId,
        source: normalizedSource,
        reservedAccountId: String(lockedOrder?.reservedAccountId || "").trim(),
        reservationState: String(failedOrder?.reservationState || "").trim(),
        fulfillmentState: String(failedOrder?.fulfillmentState || "").trim(),
        fulfillmentReason: String(failedOrder?.fulfillmentReason || "").trim(),
      });
    }
    const latestOrder = failedOrder || (await StoreOrder.findOne({ id: orderId }));
    if (normalizeStoreOrderStatusValue(latestOrder?.status) === "fulfilled") {
      return latestOrder;
    }
    throw error;
  }
};
const STORE_FULFILLMENT_RETRY_COOLDOWN_MS = 15000;
const canRetryStoreFailedFulfillment = (order = {}) => {
  const packageCode = String(order?.packageCode || "").trim().toLowerCase();
  const status = normalizeStoreOrderStatusValue(order?.status);
  if (status !== "fulfillment_failed") return false;
  if (!["package1", "package2"].includes(packageCode)) return false;
  if (!String(order?.paidAt || "").trim()) return false;
  const updatedAtMs = new Date(
    String(order?.updatedAt || order?.createdAt || "").trim(),
  ).getTime();
  if (!Number.isFinite(updatedAtMs)) return true;
  return Date.now() - updatedAtMs >= STORE_FULFILLMENT_RETRY_COOLDOWN_MS;
};
const retryFailedStoreOrderFulfillment = async (
  orderInput = null,
  { emitRealtime = false, source = "auto_retry" } = {},
) => {
  const order =
    orderInput && typeof orderInput.save === "function"
      ? orderInput
      : await StoreOrder.findOne({
          id: String(orderInput?.id || orderInput || "").trim(),
        });
  if (!order) return null;
  if (!canRetryStoreFailedFulfillment(order)) return order;

  let updatedOrder = null;
  try {
    const assignedAccountId = String(
      order?.assignedAccountId || order?.rootAssignedAccountId || "",
    ).trim();
    if (assignedAccountId) {
      updatedOrder = await completeStoreOrderManualFulfillment(order);
    } else {
      const prepared = await prepareStoreOrderForPaidFulfillment({
        orderId: String(order?.id || "").trim(),
        paidAt: String(order?.paidAt || "").trim(),
        allowedStatuses: [...STORE_ACTIVE_RESERVATION_STATUSES, "fulfillment_failed"],
      });
      updatedOrder =
        prepared?.shouldFulfill && prepared?.order
          ? await fulfillStoreOrder(prepared.order, { source })
          : prepared?.order || order;
    }
  } catch (error) {
    updatedOrder = await StoreOrder.findOne({ id: String(order?.id || "").trim() });
  }

  if (emitRealtime && String(updatedOrder?.status || "").trim().toLowerCase() === "fulfilled") {
    await emitStoreOrderRealtimeUpdate(updatedOrder, { includeStock: true });
  }
  return updatedOrder || order;
};
const createMomoPaymentForStoreOrder = async (req, order) => {
  const partnerCode = MOMO_PARTNER_CODE;
  const accessKey = MOMO_ACCESS_KEY;
  const secretKey = MOMO_SECRET_KEY;
  if (!partnerCode || !accessKey || !secretKey) {
    throw new Error("MoMo chưa được cấu hình đầy đủ");
  }
  const requestId = createStoreId("momo");
  const amount = String(Math.round(Number(order?.amount || 0)));
  const orderId = String(order?.momoOrderId || order?.id || "").trim();
  const orderInfo = `${String(order?.packageName || "").trim()} - ${String(
    order?.id || "",
  ).trim()}`;
  const extraData = "";
  const baseUrl = getAppBaseUrl(req);
  const redirectUrl = `${baseUrl}/store?view=payment-result&orderId=${encodeURIComponent(String(order?.id || "").trim())}`;
  const ipnUrl = `${baseUrl}/api/store/momo/ipn`;
  const signature = buildMomoSignature({
    accessKey,
    amount,
    extraData,
    ipnUrl,
    orderId,
    orderInfo,
    partnerCode,
    redirectUrl,
    requestId,
    requestType: MOMO_REQUEST_TYPE,
  });
  const payload = {
    partnerCode,
    accessKey,
    requestId,
    amount,
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    requestType: MOMO_REQUEST_TYPE,
    extraData,
    lang: "vi",
    autoCapture: true,
    signature,
  };
  const response = await axios.post(MOMO_ENDPOINT, payload, {
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
    },
  });
  const data = response?.data || {};
  if (Number(data?.resultCode || 0) !== 0 || !String(data?.payUrl || "").trim()) {
    throw new Error(
      String(data?.message || "Không tạo được liên kết thanh toán MoMo"),
    );
  }
  await StoreOrder.findOneAndUpdate(
    { id: String(order?.id || "").trim() },
    {
      $set: {
        paymentMethod: STORE_PAYMENT_METHOD_MOMO,
        momoRequestId: requestId,
        momoPayUrl: String(data.payUrl || "").trim(),
        momoDeepLink: String(
          data.deeplink ||
            data.deepLink ||
            data.appLink ||
            data.deeplinkMiniApp ||
            data.universalLink ||
            "",
        ).trim(),
        momoQrCodeUrl: String(data.qrCodeUrl || data.qrCode || "").trim(),
        ...clearStorePayosPaymentFields(),
        updatedAt: new Date().toISOString(),
      },
    },
  );
  return String(data.payUrl || "").trim();
};
const createPayosPaymentForStoreOrder = async (req, order) => {
  if (!PAYOS_BASE_URL || !PAYOS_CLIENT_ID || !PAYOS_API_KEY || !PAYOS_CHECKSUM_KEY) {
    throw new Error("payOS chưa được cấu hình đầy đủ");
  }
  const orderCode =
    Number.isFinite(Number(order?.payosOrderCode)) && Number(order?.payosOrderCode) > 0
      ? Number(order.payosOrderCode)
      : createStoreNumericOrderCode();
  const returnUrl = buildStorePaymentReturnUrl(req, order);
  const cancelUrl = buildStorePaymentCancelUrl(req, order);
  const description = buildStorePayosDescription(order);
  const expiredAtMs =
    new Date(String(order?.expiresAt || "").trim()).getTime() || Date.now() + STORE_PAYMENT_HOLD_MS;
  const expiredAt = Math.floor(expiredAtMs / 1000);
  const payload = {
    orderCode,
    amount: Math.round(Number(order?.amount || 0)),
    description,
    buyerName: String(req?.storeUser?.fullName || "").trim(),
    buyerEmail: String(req?.storeUser?.email || "").trim(),
    buyerPhone: String(req?.storeUser?.phone || "").trim(),
    items: [
      {
        name: String(order?.packageName || order?.packageCode || "Đơn web").trim(),
        quantity: 1,
        price: Math.round(Number(order?.amount || 0)),
      },
    ],
    cancelUrl,
    returnUrl,
    expiredAt,
    signature: buildPayosCreateSignature({
      amount: Math.round(Number(order?.amount || 0)),
      cancelUrl,
      description,
      orderCode,
      returnUrl,
    }),
  };
  const response = await axios.post(
    `${PAYOS_BASE_URL.replace(/\/+$/, "")}/v2/payment-requests`,
    payload,
    {
      timeout: 20000,
      headers: {
        "Content-Type": "application/json",
        ...getStorePayosAuthHeaders(),
      },
    },
  );
  const responseData = response?.data || {};
  const paymentData = responseData?.data || {};
  if (
    String(responseData?.code || "").trim() !== "00" ||
    !String(paymentData?.checkoutUrl || "").trim()
  ) {
    throw new Error(
      String(responseData?.desc || paymentData?.desc || "Không tạo được liên kết thanh toán payOS"),
    );
  }
  await StoreOrder.findOneAndUpdate(
    { id: String(order?.id || "").trim() },
    {
      $set: {
        paymentMethod: STORE_PAYMENT_METHOD_PAYOS,
        payosOrderCode: orderCode,
        payosPaymentLinkId: String(paymentData?.paymentLinkId || "").trim(),
        payosCheckoutUrl: String(paymentData?.checkoutUrl || "").trim(),
        payosQrCode: String(paymentData?.qrCode || "").trim(),
        payosStatus: String(paymentData?.status || "").trim(),
        payosCode: String(responseData?.code || "").trim(),
        payosDesc: String(responseData?.desc || "").trim(),
        ...clearStoreMomoPaymentFields(),
        updatedAt: new Date().toISOString(),
      },
    },
  );
  return String(paymentData?.checkoutUrl || "").trim();
};
const queryMomoPaymentStatusForStoreOrder = async (order = {}) => {
  const partnerCode = MOMO_PARTNER_CODE;
  const accessKey = MOMO_ACCESS_KEY;
  const secretKey = MOMO_SECRET_KEY;
  if (!partnerCode || !accessKey || !secretKey) {
    throw new Error("MoMo chưa được cấu hình đầy đủ");
  }
  const orderId = String(order?.momoOrderId || order?.id || "").trim();
  if (!orderId) {
    throw new Error("Đơn hàng chưa có mã MoMo để đối soát");
  }
  const requestId = createStoreId("momo_query");
  const signature = buildMomoSignature({
    accessKey,
    orderId,
    partnerCode,
    requestId,
  });
  const payload = {
    partnerCode,
    accessKey,
    requestId,
    orderId,
    lang: "vi",
    signature,
  };
  const response = await axios.post(MOMO_QUERY_ENDPOINT, payload, {
    timeout: 20000,
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response?.data || {};
};
const queryPayosPaymentStatusForStoreOrder = async (order = {}) => {
  if (!PAYOS_BASE_URL || !PAYOS_CLIENT_ID || !PAYOS_API_KEY) {
    throw new Error("payOS chưa được cấu hình đầy đủ");
  }
  const lookupId =
    String(order?.payosPaymentLinkId || "").trim() ||
    (Number.isFinite(Number(order?.payosOrderCode))
      ? String(Number(order?.payosOrderCode))
      : "");
  if (!lookupId) {
    throw new Error("Đơn hàng chưa có mã payOS để đối soát");
  }
  const response = await axios.get(
    `${PAYOS_BASE_URL.replace(/\/+$/, "")}/v2/payment-requests/${encodeURIComponent(lookupId)}`,
    {
      timeout: 20000,
      headers: getStorePayosAuthHeaders(),
    },
  );
  return response?.data || {};
};
const reconcileStoreOrderPaymentStatus = async (
  orderInput = null,
  { source = "" } = {},
) => {
  const order =
    orderInput && typeof orderInput.save === "function"
      ? orderInput
      : await StoreOrder.findOne({ id: String(orderInput?.id || orderInput || "").trim() });
  if (!order) return null;
  const normalizedStatus = String(order.status || "").trim().toLowerCase();
  if (!isStorePendingPaymentStatus(normalizedStatus) && normalizedStatus !== "paid") {
    return order;
  }
  const paymentMethod = normalizeStorePaymentMethod(order.paymentMethod);
  const nowIso = new Date().toISOString();
  if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
    const responseData = await queryPayosPaymentStatusForStoreOrder(order);
    const data = responseData?.data || {};
    const payosResponseCode = String(responseData?.code || "").trim();
    const payosPatch = {
      payosCode: String(responseData?.code || "").trim(),
      payosDesc: String(responseData?.desc || "").trim(),
      payosStatus: String(data?.status || "").trim(),
    };
    if (!String(order.payosPaymentLinkId || "").trim()) {
      payosPatch.payosPaymentLinkId = String(data?.id || data?.paymentLinkId || "").trim();
    }
    if (!String(order.payosCheckoutUrl || "").trim()) {
      payosPatch.payosCheckoutUrl = String(data?.checkoutUrl || "").trim();
    }
    if (!String(order.payosQrCode || "").trim()) {
      payosPatch.payosQrCode = String(data?.qrCode || "").trim();
    }
    if (payosResponseCode === "00" && isStorePayosSuccess(data)) {
      const prepared = await prepareStoreOrderForPaidFulfillment({
        orderId: String(order?.id || "").trim(),
        paidAt: String(order?.paidAt || "").trim() || nowIso,
        paymentPatch: payosPatch,
      });
      if (prepared?.shouldFulfill && prepared?.order) {
        try {
          return await fulfillStoreOrder(prepared.order, {
            source: String(source || "payos_reconcile").trim(),
          });
        } catch (error) {
          return StoreOrder.findOne({ id: order.id });
        }
      }
      return StoreOrder.findOne({ id: order.id });
    }
    if (payosResponseCode === "00" && isStorePayosFinalFailure(data)) {
      await StoreOrder.deleteOne({ id: order.id });
      return null;
    }
    order.payosCode = String(payosPatch.payosCode || "").trim();
    order.payosDesc = String(payosPatch.payosDesc || "").trim();
    order.payosStatus = String(payosPatch.payosStatus || "").trim();
    if (Object.prototype.hasOwnProperty.call(payosPatch, "payosPaymentLinkId")) {
      order.payosPaymentLinkId = String(payosPatch.payosPaymentLinkId || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(payosPatch, "payosCheckoutUrl")) {
      order.payosCheckoutUrl = String(payosPatch.payosCheckoutUrl || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(payosPatch, "payosQrCode")) {
      order.payosQrCode = String(payosPatch.payosQrCode || "").trim();
    }
    order.updatedAt = nowIso;
    if (payosResponseCode === "00" && normalizedStatus === "paid") {
      order.status = getStorePendingStatusFromExistingPayment(order);
      order.paidAt = "";
      order.fulfillmentState = "awaiting_payment";
      order.fulfillmentReason = "";
    }
    await order.save();
    return order;
  }
  const data = await queryMomoPaymentStatusForStoreOrder(order);
  const resultCode = Number(data?.resultCode ?? Number.NaN);
  const message = String(data?.message || "").trim();
  const transId = String(data?.transId || "").trim();
  if (!Number.isNaN(resultCode)) {
    order.momoResultCode = resultCode;
  }
  if (message) {
    order.momoMessage = message;
  }
  if (transId) {
    order.momoTransId = transId;
  }
  order.updatedAt = nowIso;
  if (resultCode === 0) {
    const prepared = await prepareStoreOrderForPaidFulfillment({
      orderId: String(order?.id || "").trim(),
      paidAt: String(order?.paidAt || "").trim() || nowIso,
      paymentPatch: {
        momoResultCode: Number.isNaN(resultCode) ? order?.momoResultCode : resultCode,
        momoMessage: message,
        momoTransId: transId,
      },
    });
    if (prepared?.shouldFulfill && prepared?.order) {
      try {
        return await fulfillStoreOrder(prepared.order, {
          source: String(source || "momo_reconcile").trim(),
        });
      } catch (error) {
        return StoreOrder.findOne({ id: order.id });
      }
    }
    return StoreOrder.findOne({ id: order.id });
  }
  if (!Number.isNaN(resultCode) && normalizedStatus === "paid") {
    order.status = getStorePendingStatusFromExistingPayment(order);
    order.paidAt = "";
    order.fulfillmentState = "awaiting_payment";
    order.fulfillmentReason = "";
  }
  await order.save();
  return order;
};
const getWarrantyRequiredExpiryTime = (source = {}, customer = null) => {
  const customerExpiry = String(customer?.expiredAt || "").trim();
  const sourceExpiry = String(source?.expiredAt || "").trim();
  const targetIso = customerExpiry || sourceExpiry;
  if (!targetIso) return null;
  const ts = new Date(targetIso).getTime();
  return Number.isFinite(ts) ? ts : null;
};
const logMarketplaceOrder = async ({
  scope = "chatgpt",
  provider,
  orderId,
  shelf,
  quantity,
  claimed,
}) => {
  const createdOrder = await DatammoOrder.create({
    scope: String(scope || "chatgpt").trim().toLowerCase(),
    provider: normalizeMarketplaceProvider(provider),
    orderId,
    shelf: shelf || "market",
    quantity,
    accounts: (Array.isArray(claimed) ? claimed : []).map((item) => ({
      scope: String(item?.scope || scope || "chatgpt").trim().toLowerCase(),
      itemType: String(item?.itemType || "chatgpt_account").trim(),
      resourceKey: String(
        item?.resourceKey ||
          buildMarketplaceResourceKey({
            scope: item?.scope || scope || "chatgpt",
            itemType: item?.itemType || "chatgpt_account",
            accountId: item?.updatedAcc?.id || item?.oldAcc?.id || "",
            slotIndex: item?.slotIndex,
          }),
      ).trim(),
      accountId: String(item?.updatedAcc?.id || item?.oldAcc?.id || ""),
      username: String(item?.updatedAcc?.username || item?.oldAcc?.username || ""),
      slotIndex: Number.isInteger(item?.slotIndex) ? item.slotIndex : -1,
      delivery: String(item?.delivery || ""),
    })),
  });
  await emitMarketplaceOrderRealtimeUpdate(createdOrder);
  return createdOrder;
};

const normalizeChatgptPayload = (payload = {}, existingAcc = null) => {
  const normalized = { ...payload };
  delete normalized.expectedUpdatedAt;
  normalized.otpSecret = String(
    normalized.otpSecret ?? existingAcc?.otpSecret ?? "",
  ).trim();
  const targetType = normalized.type || existingAcc?.type || "unassigned";

  if (supportsChatgptMarket(targetType)) {
    const fallbackShelf = supportsChatgptMarket(existingAcc?.type)
      ? normalizePackage2Shelf(
          existingAcc?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        )
      : CHATGPT_TOTAL_VALUE;
    normalized.package2Shelf = normalizePackage2Shelf(
      normalized.package2Shelf,
      fallbackShelf,
    );
  } else {
    normalized.package2Shelf = CHATGPT_TOTAL_VALUE;
  }

  delete normalized.mailCheckEnabled;
  delete normalized.mailCheckProvider;
  delete normalized.mailCheckStatus;
  delete normalized.mailCheckLastCheckedAt;
  delete normalized.mailCheckLastMatchedEmailId;
  delete normalized.mailCheckLastMatchedAt;
  delete normalized.mailCheckLastSubject;
  delete normalized.mailCheckLastSender;
  delete normalized.mailCheckLastSnippet;
  Object.assign(
    normalized,
    buildChatgptMailCheckStateForPayload(normalized, existingAcc),
  );

  return normalized;
};
const buildTeamBusinessDeliveryLine = (acc = {}) =>
  buildRawAccountDeliveryLine({
    username: acc.username,
    password: acc.password,
    otpSecret: acc.otpSecret,
    link: acc.recoveryUrl,
  });
const buildTeamSlotDeliveryLine = (acc = {}, slotNum = 1) =>
  `Slot ${slotNum}|${String(acc.username || "").trim()}|Ban gui kem gmail chinh chu de admin up`;
const snapshotDocument = (doc) => {
  if (!doc) return null;
  if (typeof doc.toObject === "function") {
    return doc.toObject({ depopulate: true });
  }
  return JSON.parse(JSON.stringify(doc));
};
const restoreDocumentSnapshot = async (Model, id, snapshot) => {
  if (!snapshot || !id) return null;
  await Model.replaceOne({ id }, snapshot, { upsert: true });
  return Model.findOne({ id });
};
const restoreMarketplaceOrderSnapshots = async (orders = [], warrantyCases = []) => {
  if (Array.isArray(orders) && orders.length > 0) {
    await DatammoOrder.insertMany(
      orders.map((item) =>
        typeof item?.toObject === "function" ? item.toObject() : item,
      ),
      { ordered: false },
    );
  }
  if (Array.isArray(warrantyCases) && warrantyCases.length > 0) {
    await DatammoWarrantyCase.insertMany(
      warrantyCases.map((item) =>
        typeof item?.toObject === "function" ? item.toObject() : item,
      ),
      { ordered: false },
    );
  }
};
const getExpectedUpdatedAtValue = (value) => String(value || "").trim();
const buildConcurrencyError = (label = "Dữ liệu") => {
  const error = new Error(
    `${label} vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.`,
  );
  error.statusCode = 409;
  return error;
};
const buildConditionalUpdateFilter = (id, expectedUpdatedAt) => {
  const filter = { id };
  const expected = getExpectedUpdatedAtValue(expectedUpdatedAt);
  if (expected) {
    filter.updatedAt = expected;
  }
  return filter;
};
const ensureCurrentVersion = (doc, expectedUpdatedAt, label = "Dữ liệu") => {
  const expected = getExpectedUpdatedAtValue(expectedUpdatedAt);
  if (!expected) return;
  if (getExpectedUpdatedAtValue(doc?.updatedAt) !== expected) {
    throw buildConcurrencyError(label);
  }
};
const withFreshUpdatedAt = (payload = {}) => ({
  ...(payload || {}),
  updatedAt: new Date().toISOString(),
});

const resolveTeamMarketplaceMode = (value, fallback = TEAM_SALE_MODE_SLOT) => {
  const normalized = normalizeTeamSaleMode(value, fallback);
  return normalized;
};
const resolveTeamMarketplaceModeFromReq = (req) => {
  const variantId = String(req.query?.variant_id || req.query?.variantId || "").trim();
  if (variantId === DATAMMO_VARIANT_TEAM_BUSINESS) return TEAM_SALE_MODE_BUSINESS;
  if (variantId === DATAMMO_VARIANT_PKG3) return TEAM_SALE_MODE_SLOT;
  const rawMode = String(req.params?.mode || req.query?.mode || req.body?.mode || "").trim().toLowerCase();
  if (rawMode === TEAM_SALE_MODE_BUSINESS) return TEAM_SALE_MODE_BUSINESS;
  if (rawMode === TEAM_SALE_MODE_SLOT) return TEAM_SALE_MODE_SLOT;
  return "";
};
const buildTeamMarketplaceSellableAccounts = async (mode) => {
  const saleMode = resolveTeamMarketplaceMode(mode);
  if (saleMode !== TEAM_SALE_MODE_BUSINESS) return [];
  const accounts = await TeamAccount.find({
    saleMode,
    warehouse: TEAM_WAREHOUSE_MARKET,
  }).sort({ createdAt: 1, id: 1 }).lean();
  return accounts.filter((account) => isEligibleForTeamMarketSale(account));
};
const countTeamMarketplaceStock = async (mode) => {
  const saleMode = resolveTeamMarketplaceMode(mode);
  if (saleMode !== TEAM_SALE_MODE_BUSINESS) return 0;
  const accounts = await buildTeamMarketplaceSellableAccounts(saleMode);
  return accounts.length;
};
const buildManagedTeamCustomer = (provider, orderId, joinDate) => {
  const normalizedProvider = normalizeMarketplaceProvider(provider);
  const orderCode = String(orderId || Date.now()).trim();
  const joinedAt = new Date(joinDate || new Date());
  const expiresAt = addDurationToDate(joinedAt, "1M");
  return {
    status: "active",
    gmail:
      normalizedProvider === "shopmini"
        ? "shopmini@guest.local"
        : "datammo@guest.local",
    customerName:
      normalizedProvider === "shopmini"
        ? `Shopmini#${orderCode}`
        : `Datammo#${orderCode}`,
    addedAt: joinedAt.toISOString(),
    expiredAt: expiresAt.toISOString(),
  };
};
const buildManagedMarketplaceUser = ({
  provider,
  orderId,
  joinedAt,
  expiredAt,
} = {}) => {
  const normalizedProvider = normalizeMarketplaceProvider(provider);
  const orderCode = String(orderId || Date.now()).trim();
  return {
    name:
      normalizedProvider === "shopmini"
        ? `Shopmini#${orderCode}`
        : `Datammo#${orderCode}`,
    joinedAt: String(joinedAt || new Date().toISOString()).trim(),
    expiredAt: String(expiredAt || "").trim(),
  };
};
const claimTeamBusinessAccountsForOrder = async ({ quantity, orderId, provider }) => {
  const claimed = [];
  for (let i = 0; i < quantity; i += 1) {
    let reserved = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const [oldAcc] = await buildTeamMarketplaceSellableAccounts(
        TEAM_SALE_MODE_BUSINESS,
      );
      if (!oldAcc) break;
      const teamSlots = normalizeTeamSlots(oldAcc.slots);
      const emptySlotIndex = getAvailableTeamSlotIndices(teamSlots)[0];
      if (!Number.isInteger(emptySlotIndex) || emptySlotIndex < 0) {
        await syncTeamWarehouseStateIfNeeded(oldAcc);
        continue;
      }
      teamSlots[emptySlotIndex] = buildManagedTeamCustomer(provider, orderId, new Date());
      const updatedAcc = await TeamAccount.findOneAndUpdate(
        buildConditionalUpdateFilter(oldAcc.id, oldAcc.updatedAt),
        withFreshUpdatedAt({ slots: teamSlots }),
        { new: true },
      );
      if (!updatedAcc) continue;
      reserved = {
        oldAcc,
        updatedAcc,
        saleMode: TEAM_SALE_MODE_BUSINESS,
        scope: "team",
        itemType: "team_business",
        slotIndex: emptySlotIndex,
        resourceKey: buildMarketplaceResourceKey({
          scope: "team",
          itemType: "team_business",
          accountId: updatedAcc.id,
          slotIndex: emptySlotIndex,
        }),
        delivery: buildTeamBusinessDeliveryLine(updatedAcc),
      };
      break;
    }
    if (!reserved) break;
    claimed.push(reserved);
  }
  return claimed;
};
const claimTeamSlotAccountsForOrder = async ({ quantity, orderId, provider }) => {
  const claimed = [];
  for (let i = 0; i < quantity; i += 1) {
    let reserved = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const oldAcc = await TeamAccount.findOne({
        saleMode: TEAM_SALE_MODE_SLOT,
        warehouse: TEAM_WAREHOUSE_MARKET,
      }).sort({ createdAt: 1, id: 1 }).lean();
      if (!oldAcc) break;
      if (!isEligibleForTeamMarketSale(oldAcc)) {
        await syncTeamWarehouseStateIfNeeded(oldAcc);
        continue;
      }
      const teamSlots = normalizeTeamSlots(oldAcc.slots);
      const emptySlotIndex = getAvailableTeamSlotIndices(teamSlots)[0];
      if (!Number.isInteger(emptySlotIndex) || emptySlotIndex < 0) {
        await syncTeamWarehouseStateIfNeeded(oldAcc);
        continue;
      }
      teamSlots[emptySlotIndex] = buildManagedTeamCustomer(provider, orderId, new Date());
      const updatedAcc = await TeamAccount.findOneAndUpdate(
        buildConditionalUpdateFilter(oldAcc.id, oldAcc.updatedAt),
        withFreshUpdatedAt({ slots: teamSlots }),
        { new: true },
      );
      if (!updatedAcc) continue;
      reserved = {
        oldAcc,
        updatedAcc,
        saleMode: TEAM_SALE_MODE_SLOT,
        scope: "team",
        itemType: "team_slot",
        slotIndex: emptySlotIndex,
        resourceKey: buildMarketplaceResourceKey({
          scope: "team",
          itemType: "team_slot",
          accountId: updatedAcc.id,
          slotIndex: emptySlotIndex,
        }),
        delivery: buildTeamSlotDeliveryLine(updatedAcc, emptySlotIndex + 1),
      };
      break;
    }
    if (!reserved) break;
    claimed.push(reserved);
  }
  return claimed;
};
const claimTeamAccountsForOrder = async ({ quantity, orderId, provider, saleMode }) => {
  if (resolveTeamMarketplaceMode(saleMode) === TEAM_SALE_MODE_BUSINESS) {
    return claimTeamBusinessAccountsForOrder({ quantity, orderId, provider });
  }
  return [];
};
const rollbackClaimedTeamAccounts = async (claimed = []) => {
  for (const item of claimed) {
    if (!item?.oldAcc?.id) continue;
    await TeamAccount.findOneAndUpdate(
      { id: item.oldAcc.id },
      {
        $set: {
          slots: normalizeTeamSlots(item.oldAcc.slots),
          saleMode: normalizeTeamSaleMode(item.oldAcc.saleMode),
          warehouse: normalizeTeamWarehouse(item.oldAcc.warehouse, TEAM_WAREHOUSE_TOTAL),
          note: item.oldAcc.note || "",
          updatedAt: item.oldAcc.updatedAt || new Date().toISOString(),
        },
      },
    );
  }
};
const buildTeamMarketplaceStockPayload = async (mode) => {
  const stock = await countTeamMarketplaceStock(mode);
  return { stock };
};

// TEST-ONLY marketplace endpoints: no DB writes, no stock reservation, no order log.
app.get(
  "/api/datammo/test/stock",
  verifyDatammoTestPartnerToken,
  async (req, res) => {
    return res.json({
      stock: TEST_MARKETPLACE_STOCK,
      price: TEST_MARKETPLACE_PRICE,
      test: true,
      provider: "datammo",
    });
  },
);

app.get(
  "/api/datammo/test/buy",
  verifyDatammoTestPartnerToken,
  async (req, res) => {
    const quantity = getSafeBuyQuantity(req.query?.quantity);
    const orderId = String(
      req.query?.order_id || req.query?.orderId || `order${Date.now()}`,
    ).trim();
    return res.json({
      success: true,
      test: true,
      provider: "datammo",
      data: buildMarketplaceTestLines({
        orderId,
        quantity,
        provider: "datammo",
      }),
    });
  },
);

app.all(
  "/api/shopmini/test/input.php",
  verifyShopminiTestPrivateToken,
  async (req, res) => {
    const action = resolveShopminiActionFromReq(req);
    if (action !== "buy") {
      return res.json({ sum: TEST_MARKETPLACE_STOCK });
    }

    const quantity = getShopminiBuyQuantity(req);
    const orderId = String(getShopminiOrderId(req) || `order${Date.now()}`).trim();
    const lines = buildMarketplaceTestLines({
      orderId,
      quantity,
      provider: "shopmini",
    });
    return res.json(buildShopminiStrictSamplePayload(lines));
  },
);
// ---------------------------

const ADMIN_DATA_SECTION_NAMES = new Set([
  "summary",
  "chatgpt",
  "netflix",
  "canva",
  "capcut",
  "team",
  "datammo",
  "storeOrders",
  "storeUsers",
  "storeVouchers",
  "supportConversations",
]);

const normalizeAdminDataSections = (value = "") => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean);
  return Array.from(
    new Set(
      rawItems.filter((item) => ADMIN_DATA_SECTION_NAMES.has(item)),
    ),
  ).sort();
};

const buildDefaultAdminDataSections = ({ omitChatgpt = false } = {}) => {
  const sections = [
    "summary",
    "netflix",
    "canva",
    "capcut",
    "team",
    "datammo",
    "storeOrders",
    "storeUsers",
    "storeVouchers",
    "supportConversations",
  ];
  if (!omitChatgpt) {
    sections.unshift("chatgpt");
  }
  return sections;
};

app.get("/api/data", verifyToken, async (req, res) => {
  try {
    const omitChatgpt = String(req.query?.omitChatgpt || "0").trim() === "1";
    const requestedSections = normalizeAdminDataSections(req.query?.sections);
    const sections =
      requestedSections.length > 0
        ? requestedSections
        : buildDefaultAdminDataSections({ omitChatgpt });
    const sectionSet = new Set(sections);
    const payload = await getCachedAdminRead(
      "admin:data",
      {
        omitChatgpt: omitChatgpt ? 1 : 0,
        sections: sections.join(","),
      },
      async () => {
        const shouldLoadChatgpt = !omitChatgpt && sectionSet.has("chatgpt");
        const shouldLoadNetflix = sectionSet.has("netflix");
        const shouldLoadCanva = sectionSet.has("canva");
        const shouldLoadCapcut = sectionSet.has("capcut");
        const shouldLoadTeam = sectionSet.has("team");
        const shouldLoadDatammo = sectionSet.has("datammo");
        const shouldLoadStoreOrders = sectionSet.has("storeOrders");
        const shouldBuildChatgptTrace = shouldLoadChatgpt;
        const shouldLoadStoreUsers = sectionSet.has("storeUsers");
        const shouldLoadStoreUserStats = sectionSet.has("storeUsers");
        const shouldLoadStoreOrderUsers =
          shouldLoadStoreOrders || shouldBuildChatgptTrace;
        const shouldLoadStoreVouchers = sectionSet.has("storeVouchers");
        const shouldLoadSupportConversations = sectionSet.has(
          "supportConversations",
        );
        const shouldLoadSummary = sectionSet.has("summary");
        const [
          accounts,
          netflixAccs,
          canvaAccs,
          capcutAccs,
          teamAccs,
          datammoOrders,
          datammoWarrantyCases,
          rawStoreOrders,
          storeUsers,
          storeUserOrderStats,
          storeVouchers,
          storeSupportConversations,
          dashboardSummary,
        ] = await Promise.all([
          shouldLoadChatgpt ? Account.find({}).lean() : Promise.resolve([]),
          shouldLoadNetflix ? Netflix.find({}).lean() : Promise.resolve([]),
          shouldLoadCanva ? Canva.find({}).lean() : Promise.resolve([]),
          shouldLoadCapcut ? Capcut.find({}).lean() : Promise.resolve([]),
          shouldLoadTeam ? TeamAccount.find({}).lean() : Promise.resolve([]),
          shouldLoadDatammo || shouldBuildChatgptTrace
            ? DatammoOrder.find({}).sort({ createdAt: -1 }).limit(100).lean()
            : Promise.resolve([]),
          shouldLoadDatammo || shouldBuildChatgptTrace
            ? DatammoWarrantyCase.find({})
                .sort({ updatedAt: -1 })
                .limit(100)
                .lean()
            : Promise.resolve([]),
          shouldLoadStoreOrders || shouldBuildChatgptTrace
            ? StoreOrder.find({
                status: { $nin: Array.from(STORE_HIDDEN_ORDER_STATUSES) },
              })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean()
            : Promise.resolve([]),
          shouldLoadStoreUsers
            ? StoreUser.find({})
                .select(
                  "id fullName email phone authProviders googleId passwordHash createdAt updatedAt",
                )
                .lean()
            : Promise.resolve([]),
          shouldLoadStoreUserStats
            ? StoreOrder.aggregate([
                {
                  $group: {
                    _id: "$userId",
                    totalOrders: { $sum: 1 },
                    fulfilledOrders: {
                      $sum: {
                        $cond: [{ $eq: ["$status", "fulfilled"] }, 1, 0],
                      },
                    },
                    pendingOrders: {
                      $sum: {
                        $cond: [
                          {
                            $in: [
                              "$status",
                              ["pending_payment", "awaiting_payment", "paid"],
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                    latestOrderAt: { $max: "$createdAt" },
                  },
                },
              ])
            : Promise.resolve([]),
          shouldLoadStoreVouchers
            ? StoreVoucher.find({}).sort({ createdAt: -1, id: -1 }).lean()
            : Promise.resolve([]),
          shouldLoadSupportConversations
            ? StoreSupportConversation.find({})
                .sort({ lastMessageAt: -1, createdAt: -1, id: -1 })
                .lean()
            : Promise.resolve([]),
          shouldLoadSummary
            ? buildAdminDashboardSummary().catch((summaryError) => {
                console.error(
                  "Admin summary section build failed:",
                  summaryError,
                );
                return null;
              })
            : Promise.resolve(null),
        ]);
        const traceStoreUsers =
          !shouldLoadStoreUsers && shouldBuildChatgptTrace
            ? await loadStoreUsersForTraceOrders(
                rawStoreOrders,
                CHATGPT_ADMIN_STORE_USER_TRACE_SELECT,
              )
            : [];
        const storeOrderUsers =
          !shouldLoadStoreUsers && shouldLoadStoreOrderUsers
            ? await loadStoreUsersForTraceOrders(
                rawStoreOrders,
                STORE_ORDER_USER_SELECT,
              )
            : [];
        const storeUserMap = new Map(
          [
            ...(storeUsers || []),
            ...(storeOrderUsers || []),
            ...(traceStoreUsers || []),
          ].map((user) => [String(user?.id || "").trim(), user]),
        );
        const storeUserStatsMap = new Map(
          (storeUserOrderStats || []).map((item) => [
            String(item?._id || "").trim(),
            {
              totalOrders: Number(item?.totalOrders || 0),
              fulfilledOrders: Number(item?.fulfilledOrders || 0),
              pendingOrders: Number(item?.pendingOrders || 0),
              latestOrderAt: String(item?.latestOrderAt || "").trim(),
            },
          ]),
        );
        let marketplaceAccountTraceMap = new Map();
        let storeAccountTraceMap = new Map();
        if (shouldBuildChatgptTrace) {
          try {
            marketplaceAccountTraceMap = buildMarketplaceAccountTraceMap(
              datammoOrders,
              datammoWarrantyCases,
            );
          } catch (traceError) {
            console.error("Trace diagnostic build failed:", traceError);
          }
          try {
            storeAccountTraceMap = buildStoreAccountTraceMap(
              rawStoreOrders,
              storeUserMap,
            );
          } catch (traceError) {
            console.error("Store trace diagnostic build failed:", traceError);
          }
        }
        const response = {
          chatgptOmitted: omitChatgpt,
          realtime: buildAdminRealtimeConfig(),
          version: latestDataVersion,
        };
        if (shouldLoadChatgpt) {
          response.chatgpt = accounts.map((acc) => {
            const normalizedAccount = {
              ...acc,
              package2Shelf: normalizePackage2Shelf(
                acc?.package2Shelf,
                CHATGPT_TOTAL_VALUE,
              ),
              storeTraceSummary:
                storeAccountTraceMap.get(String(acc?.id || "").trim()) || null,
              marketplaceTraceSummary:
                marketplaceAccountTraceMap.get(String(acc?.id || "").trim()) ||
                null,
            };
            return {
              ...enrichChatgptAccountWithOperationalState({
                ...normalizedAccount,
                package2Shelf: normalizeChatgptMarketAccountState(normalizedAccount),
              }),
            };
          });
        }
        if (shouldLoadNetflix) {
          response.netflix = netflixAccs;
        }
        if (shouldLoadCanva) {
          response.canva = canvaAccs;
        }
        if (shouldLoadCapcut) {
          response.capcut = capcutAccs;
        }
        if (shouldLoadTeam) {
          response.team = teamAccs.map((teamAcc) => sanitizeTeamAccount(teamAcc));
        }
        if (shouldLoadDatammo) {
          response.datammoOrders = datammoOrders;
          response.datammoWarrantyCases = datammoWarrantyCases;
        }
        if (shouldLoadStoreOrders) {
          const operationalStoreOrders =
            await attachStoreOrdersOperationalState(rawStoreOrders);
          const operationalStoreOrderMap = new Map(
            (operationalStoreOrders || []).map((item) => [
              String(item?.id || "").trim(),
              item,
            ]),
          );
          response.storeOrders = rawStoreOrders
            .map(
              (order) =>
                operationalStoreOrderMap.get(String(order?.id || "").trim()) || order,
            )
            .map((order) =>
              sanitizeStoreOrderForAdmin(
                order,
                storeUserMap.get(String(order?.userId || "").trim()) || null,
              ),
            )
            .filter(Boolean);
        }
        if (shouldLoadStoreUsers) {
          response.storeUsers = (storeUsers || [])
            .map((user) =>
              sanitizeStoreUserForAdmin(
                user,
                storeUserStatsMap.get(String(user?.id || "").trim()) || null,
              ),
            )
            .filter(Boolean);
        }
        if (shouldLoadStoreVouchers) {
          const voucherStatsMap = await buildStoreVoucherStatsMap(
            storeVouchers,
            shouldLoadStoreUsers ? storeUsers : [],
          );
          response.storeVouchers = (storeVouchers || [])
            .map((voucher) =>
              sanitizeStoreVoucherForAdmin(
                voucher,
                voucherStatsMap.get(String(voucher?.id || "").trim()) || null,
              ),
            )
            .filter(Boolean);
        }
        if (shouldLoadSupportConversations) {
          response.supportConversations = (storeSupportConversations || [])
            .map((conversation) =>
              sanitizeStoreSupportConversationForAdmin(conversation),
            )
            .filter(Boolean);
        }
        if (shouldLoadSummary) {
          response.summary =
            dashboardSummary || {
              totalStoreUsers: 0,
              totalStoreOrders: 0,
              fulfilledStoreOrders: 0,
              pendingStoreOrders: 0,
              unreadSupportConversations: 0,
              openSupportConversations: 0,
              totalVouchers: 0,
            };
        }
        return response;
      },
    );
    res.json(payload);
  } catch (error) {
    console.error("Admin /api/data failed:", error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get("/api/admin/chatgpt-accounts", verifyToken, async (req, res) => {
  try {
    const payload = await getCachedAdminRead(
      "admin:chatgpt-accounts",
      {
        page: req.query?.page,
        limit: req.query?.limit,
        subTab: req.query?.subTab,
        totalType: req.query?.totalType,
        mailCheckFilter: req.query?.mailCheckFilter,
        customerFilter: req.query?.customerFilter,
        expiryFilter: req.query?.expiryFilter,
        expiryMin: req.query?.expiryMin,
        expiryMax: req.query?.expiryMax,
        search: req.query?.search,
        package2ShelfTab: req.query?.package2ShelfTab,
        soldProviderFilter: req.query?.soldProviderFilter,
      },
      async () => {
        const data = await listAdminChatgptAccounts({
          page: req.query?.page,
          limit: req.query?.limit,
          subTab: req.query?.subTab,
          totalType: req.query?.totalType,
          mailCheckFilter: req.query?.mailCheckFilter,
          customerFilter: req.query?.customerFilter,
          expiryFilter: req.query?.expiryFilter,
          expiryMin: req.query?.expiryMin,
          expiryMax: req.query?.expiryMax,
          search: req.query?.search,
          package2ShelfTab: req.query?.package2ShelfTab,
          soldProviderFilter: req.query?.soldProviderFilter,
        });
        return {
          success: true,
          accounts: data.accounts,
          pagination: data.pagination,
          summary: data.summary,
          version: latestDataVersion,
        };
      },
    );
    return res.json(payload);
  } catch (error) {
    console.error("Admin /api/admin/chatgpt-accounts failed:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc danh sach ChatGPT admin.",
    });
  }
});

app.get("/api/admin/chatgpt-mail-check/summary", verifyToken, async (req, res) => {
  try {
    const payload = await getCachedAdminRead(
      "admin:chatgpt-mail-check-summary",
      {},
      async () => ({
        success: true,
        summary: await buildChatgptMailCheckSummary(),
        version: latestDataVersion,
      }),
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc tong hop mail check.",
    });
  }
});

app.get("/api/admin/chatgpt-mail-check/history", verifyToken, async (req, res) => {
  try {
    const safeLimit = parsePositiveLimit(req.query?.limit, 20, 100);
    const payload = await getCachedAdminRead(
      "admin:chatgpt-mail-check-history",
      { limit: safeLimit },
      async () => ({
        success: true,
        items: await listChatgptMailCheckHistory(safeLimit),
        version: latestDataVersion,
      }),
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc lich su mail die.",
    });
  }
});

app.post(
  "/api/admin/chatgpt-mail-check/run-selected",
  verifyToken,
  async (req, res) => {
    try {
      const accountIds = Array.isArray(req.body?.accountIds)
        ? req.body.accountIds
        : [];
      const run = await runChatgptMailCheckForIds(accountIds, {
        source: "admin_selected",
      });
      if (Number(run?.summary?.changedCount || 0) > 0) {
        bumpDataVersion();
        notifyClients();
      }
      return res.json({
        success: true,
        ...run,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the chay mail check cho danh sach da chon.",
      });
    }
  },
);

app.post(
  "/api/admin/chatgpt-mail-check/run-one/:id",
  verifyToken,
  async (req, res) => {
    try {
      const result = await runChatgptMailCheckForAccount(
        { id: String(req.params?.id || "").trim() },
        { source: "admin_one" },
      );
      if (result?.changed) {
        bumpDataVersion();
        notifyClients();
      }
      return res.json({
        success: true,
        item: result,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the doc mail cho account nay.",
      });
    }
  },
);

app.get("/api/admin/dashboard/summary", verifyToken, async (req, res) => {
  try {
    const payload = await getCachedAdminRead(
      "admin:dashboard-summary",
      {},
      async () => ({
        success: true,
        summary: await buildAdminDashboardSummary(),
        realtime: buildAdminRealtimeConfig(),
        version: latestDataVersion,
      }),
    );
    return res.json(payload);
  } catch (error) {
    console.error("Admin /api/admin/dashboard/summary failed:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc tong quan admin.",
    });
  }
});

app.get("/api/admin/store-orders", verifyToken, async (req, res) => {
  try {
    const safePage = parsePositivePage(req.query?.page, 1);
    const safeLimit = parsePositiveLimit(req.query?.limit, 100, 200);
    const payload = await getCachedAdminRead(
      "admin:store-orders",
      { page: safePage, limit: safeLimit },
      async () => {
        const data = await listAdminStoreOrders({
          page: safePage,
          limit: safeLimit,
        });
        return {
          success: true,
          orders: data.orders,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: data.total,
            hasMore: data.hasMore,
          },
          version: latestDataVersion,
        };
      },
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc danh sach don web.",
    });
  }
});

app.get("/api/admin/store-users", verifyToken, async (req, res) => {
  try {
    const safePage = parsePositivePage(req.query?.page, 1);
    const safeLimit = parsePositiveLimit(req.query?.limit, 100, 200);
    const payload = await getCachedAdminRead(
      "admin:store-users",
      { page: safePage, limit: safeLimit },
      async () => {
        const data = await listAdminStoreUsers({
          page: safePage,
          limit: safeLimit,
        });
        return {
          success: true,
          users: data.users,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: data.total,
            hasMore: data.hasMore,
          },
          version: latestDataVersion,
        };
      },
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc danh sach user web.",
    });
  }
});

app.get("/api/admin/store-vouchers", verifyToken, async (req, res) => {
  try {
    const safePage = parsePositivePage(req.query?.page, 1);
    const safeLimit = parsePositiveLimit(req.query?.limit, 100, 200);
    const payload = await getCachedAdminRead(
      "admin:store-vouchers",
      { page: safePage, limit: safeLimit },
      async () => {
        const data = await listAdminStoreVouchers({
          page: safePage,
          limit: safeLimit,
        });
        return {
          success: true,
          vouchers: data.vouchers,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: data.total,
            hasMore: data.hasMore,
          },
          version: latestDataVersion,
        };
      },
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc danh sach voucher.",
    });
  }
});

app.get("/api/admin/store-config", verifyToken, async (req, res) => {
  try {
    const [config, packageMap] = await Promise.all([
      getCachedStoreConfig(),
      getStorePackageMap(),
    ]);
    return res.json({
      success: true,
      config: sanitizeStoreConfigForAdmin(config, packageMap),
      version: latestDataVersion,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc cau hinh gia goi web.",
    });
  }
});

app.put("/api/admin/store-config", verifyToken, async (req, res) => {
  try {
    const packagePrices = buildStorePackagePriceUpdatePayload(req.body);
    const nowIso = new Date().toISOString();
    const config = await StoreConfig.findOneAndUpdate(
      { id: STORE_CONFIG_DOCUMENT_ID },
      {
        $set: {
          packagePrices,
          updatedAt: nowIso,
        },
        $setOnInsert: {
          id: STORE_CONFIG_DOCUMENT_ID,
          createdAt: nowIso,
        },
      },
      { upsert: true, new: true },
    ).lean();
    clearStoreConfigCache();
    clearStoreCatalogCache();
    bumpDataVersion();
    const packageMap = await getStorePackageMap({ force: true });
    return res.json({
      success: true,
      config: sanitizeStoreConfigForAdmin(config, packageMap),
      version: latestDataVersion,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong luu duoc cau hinh gia goi web.",
    });
  }
});

app.post("/api/store-vouchers", verifyToken, async (req, res) => {
  try {
    const payload = buildStoreVoucherWritePayload(req.body);
    const existingCode = await StoreVoucher.findOne({ code: payload.code }).lean();
    if (existingCode) {
      return res.status(409).json({ error: "Ma voucher da ton tai." });
    }
    const voucher = await StoreVoucher.create({
      id: createStoreId("voucher"),
      ...payload,
      createdAt: new Date().toISOString(),
    });
    const statsMap = await buildStoreVoucherStatsMap([voucher]);
    await emitStoreVoucherRealtimeUpdate(voucher);
    return res.json({
      success: true,
      voucher: sanitizeStoreVoucherForAdmin(
        voucher,
        statsMap.get(String(voucher?.id || "").trim()) || null,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tao duoc voucher.",
    });
  }
});

app.put("/api/store-vouchers/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thieu ID voucher." });
    }
    const currentVoucher = await StoreVoucher.findOne({ id });
    if (!currentVoucher) {
      return res.status(404).json({ error: "Khong tim thay voucher." });
    }
    const payload = buildStoreVoucherWritePayload(req.body, currentVoucher);
    const conflictVoucher = await StoreVoucher.findOne({
      id: { $ne: id },
      code: payload.code,
    }).lean();
    if (conflictVoucher) {
      return res.status(409).json({ error: "Ma voucher da ton tai." });
    }
    Object.assign(currentVoucher, payload);
    await currentVoucher.save();
    const statsMap = await buildStoreVoucherStatsMap([currentVoucher]);
    await emitStoreVoucherRealtimeUpdate(currentVoucher);
    return res.json({
      success: true,
      voucher: sanitizeStoreVoucherForAdmin(
        currentVoucher,
        statsMap.get(String(currentVoucher?.id || "").trim()) || null,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong cap nhat duoc voucher.",
    });
  }
});

app.delete("/api/store-vouchers/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thieu ID voucher." });
    }
    const deleted = await StoreVoucher.findOneAndDelete({ id }).lean();
    if (!deleted) {
      return res.status(404).json({ error: "Khong tim thay voucher." });
    }
    await emitStoreVoucherRealtimeUpdate(deleted);
    return res.json({ success: true, id });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong xoa duoc voucher.",
    });
  }
});

app.get("/api/store-support/conversations", verifyToken, async (req, res) => {
  try {
    const safePage = parsePositivePage(req.query?.page, 1);
    const safeLimit = parsePositiveLimit(
      req.query?.limit,
      20,
      100,
    );
    const payload = await getCachedAdminRead(
      "admin:store-support-conversations",
      { page: safePage, limit: safeLimit },
      async () => {
        const data = await listAdminStoreSupportConversations({
          page: safePage,
          limit: safeLimit,
        });
        return {
          success: true,
          conversations: data.conversations,
          pagination: {
            page: data.page,
            limit: data.limit,
            total: data.total,
            hasMore: data.hasMore,
          },
          version: latestDataVersion,
        };
      },
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc danh sach hoi thoai.",
    });
  }
});

app.get("/api/store-support/conversations/:id/messages", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    const limit = parsePositiveLimit(
      req.query?.limit,
      STORE_SUPPORT_THREAD_PAGE_SIZE,
      100,
    );
    const cursor = String(req.query?.cursor || req.query?.before || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thieu ID hoi thoai." });
    }
    const conversation = await StoreSupportConversation.findOne({ id }).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Khong tim thay hoi thoai." });
    }
    await markStoreSupportConversationRead({
      conversationId: id,
      readerRole: "admin",
    });
    const [freshConversation, messagePage] = await Promise.all([
      StoreSupportConversation.findOne({ id }).lean(),
      listStoreSupportMessages(id, { limit, cursor }),
    ]);
    const normalizedConversation = freshConversation || conversation;
    if (Number(conversation?.adminUnreadCount || 0) > 0) {
      await emitStoreSupportReadRealtimeUpdate({
        conversation: normalizedConversation,
        readerRole: "admin",
      });
    }
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForAdmin(
        normalizedConversation,
      ),
      messages: (messagePage?.messages || []).map((message) =>
        sanitizeStoreSupportMessage(message),
      ),
      pagination: {
        limit,
        cursor,
        nextCursor: String(messagePage?.nextCursor || "").trim(),
        hasMore: !!messagePage?.hasMore,
        retainedAfter: String(messagePage?.retainedAfter || "").trim(),
        retentionDays: STORE_SUPPORT_MESSAGE_RETENTION_DAYS,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc tin nhan hoi thoai.",
    });
  }
});

app.post("/api/store-support/conversations/:id/messages", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thieu ID hoi thoai." });
    }
    const conversation = await StoreSupportConversation.findOne({ id }).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Khong tim thay hoi thoai." });
    }
    const message = await appendStoreSupportMessage({
      conversationId: id,
      senderRole: "admin",
      senderId: String(req.user?.email || "").trim(),
      body: req.body?.body,
    });
    await markStoreSupportConversationRead({
      conversationId: id,
      readerRole: "admin",
    });
    const freshConversation = await StoreSupportConversation.findOne({ id }).lean();
    await emitStoreSupportMessageRealtimeUpdate({
      conversation: freshConversation || conversation,
      message,
    });
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForAdmin(
        freshConversation || conversation,
      ),
      message: sanitizeStoreSupportMessage(message),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong gui duoc tin nhan admin.",
    });
  }
});

app.post("/api/store-support/conversations/:id/read", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thieu ID hoi thoai." });
    }
    const conversation = await StoreSupportConversation.findOne({ id }).lean();
    if (!conversation) {
      return res.status(404).json({ error: "Khong tim thay hoi thoai." });
    }
    await markStoreSupportConversationRead({
      conversationId: id,
      readerRole: "admin",
    });
    const freshConversation = await StoreSupportConversation.findOne({ id }).lean();
    if (Number(conversation?.adminUnreadCount || 0) > 0) {
      await emitStoreSupportReadRealtimeUpdate({
        conversation: freshConversation || conversation,
        readerRole: "admin",
      });
    }
    return res.json({
      success: true,
      conversation: sanitizeStoreSupportConversationForAdmin(
        freshConversation || conversation,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong cap nhat duoc trang thai hoi thoai.",
    });
  }
});

app.delete("/api/store-orders/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const accountId = String(
      order?.assignedAccountId || order?.reservedAccountId || "",
    ).trim();
    const deletedSnapshot =
      typeof order?.toObject === "function" ? order.toObject() : { ...(order || {}) };
    await deleteStoreOrderForAdmin(order);
    await emitStoreOrderRealtimeUpdate(deletedSnapshot, { includeStock: true });
    const diagnostics = accountId
      ? await buildChatgptAccountAdminDiagnostics(accountId)
      : null;
    return res.json({ success: true, diagnostics });
  } catch (error) {
    return res.status(500).json({ error: "Không thể xóa đơn web." });
  }
});

app.put("/api/store-orders/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const packageCode = String(order?.packageCode || "").trim().toLowerCase();
    if (packageCode !== "package1") {
      return res.status(400).json({
        error: "Hiện admin chỉ được sửa số lượt OTP của đơn Gói 1.",
      });
    }

    const rawMaxUsage = Number(req.body?.package1MaxUsage);
    const rawUsedCount = Number(req.body?.package1UsedCount);
    if (!Number.isFinite(rawMaxUsage) || rawMaxUsage < 0) {
      return res.status(400).json({
        error: "Số lượt tối đa phải là số không âm.",
      });
    }
    if (!Number.isFinite(rawUsedCount) || rawUsedCount < 0) {
      return res.status(400).json({
        error: "Số lượt đã dùng phải là số không âm.",
      });
    }

    const package1MaxUsage = Math.max(0, Math.floor(rawMaxUsage));
    const package1UsedCount = Math.max(0, Math.floor(rawUsedCount));

    order.package1MaxUsage = package1MaxUsage;
    order.package1UsedCount = package1UsedCount;
    order.updatedAt = new Date().toISOString();
    await order.save();
    await emitStoreOrderRealtimeUpdate(order);

    const storeUser = order?.userId
      ? await StoreUser.findOne({ id: String(order.userId || "").trim() }).lean()
      : null;

    return res.json({
      success: true,
      order: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        order,
        storeUser,
      ),
    });
  } catch (error) {
    return res.status(500).json({ error: "Không thể cập nhật đơn web." });
  }
});

app.post("/api/store-orders/:id/mark-fulfilled", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const updatedOrder = await completeStoreOrderManualFulfillment(order);
    await emitStoreOrderRealtimeUpdate(updatedOrder, { includeStock: true });

    const storeUser = updatedOrder?.userId
      ? await StoreUser.findOne({ id: String(updatedOrder.userId || "").trim() }).lean()
      : null;

    return res.json({
      success: true,
      order: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        updatedOrder,
        storeUser,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thể xác nhận đơn đã giao tay.",
    });
  }
});

app.post("/api/store-orders/:id/otp", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const assignedAccountId = String(
      order?.assignedAccountId || order?.rootAssignedAccountId || "",
    ).trim();
    if (!assignedAccountId) {
      return res.status(400).json({
        error: "Đơn này chưa có nick để lấy mã 2FA.",
      });
    }

    const otpSecret = await resolveStoreOrderOtpSecret(order);
    if (!otpSecret) {
      return res.status(400).json({
        error: "Nick của đơn này chưa có mã 2FA để lấy nhanh.",
      });
    }

    const otp = generateTotpCode(otpSecret);
    return res.json({
      success: true,
      packageCode: String(order?.packageCode || "").trim(),
      code: otp.code,
      expiresIn: otp.expiresIn,
    });
  } catch (error) {
    return res.status(500).json({ error: "Không thể lấy mã 2FA nhanh." });
  }
});

app.get("/api/store-orders/:id/warranty-candidates", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id }).lean();
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const storeUser = order?.userId
      ? await StoreUser.findOne({ id: String(order.userId || "").trim() }).lean()
      : null;
    const candidates = await listStoreWarrantyCandidates(order);

    return res.json({
      success: true,
      order: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        order,
        storeUser,
      ),
      sourceState: pickChatgptCurrentStatePayload({
        id: String(order?.assignedAccountId || order?.rootAssignedAccountId || "").trim(),
        currentAccountState:
          (
            await loadChatgptAccountOperationalStateMap([
              String(
                order?.assignedAccountId || order?.rootAssignedAccountId || "",
              ).trim(),
            ])
          ).get(
            String(order?.assignedAccountId || order?.rootAssignedAccountId || "").trim(),
          )?.currentAccountState || null,
      }),
      candidates,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thể tải acc thay thế để bảo hành đơn web.",
    });
  }
});

app.post("/api/store-orders/:id/warranty", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID đơn web." });
    }

    const order = await StoreOrder.findOne({ id });
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn web." });
    }

    const updatedOrder = await warrantyStoreOrderForAdmin(order, {
      replacementAccountId: req.body?.replacementAccountId,
      reason: req.body?.reason,
    });
    await emitStoreOrderRealtimeUpdate(updatedOrder, { includeStock: true });
    const storeUser = updatedOrder?.userId
      ? await StoreUser.findOne({
          id: String(updatedOrder.userId || "").trim(),
        }).lean()
      : null;

    return res.json({
      success: true,
      order: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        updatedOrder,
        storeUser,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thể bảo hành đơn web.",
    });
  }
});

app.get("/api/admin/store-order-state-audit", verifyToken, async (req, res) => {
  try {
    const audit = await auditStoreOrderAccountConsistency({ repair: false });
    return res.json({ success: true, audit });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong the audit state don web/account.",
    });
  }
});

app.post(
  "/api/admin/store-order-state-audit/repair",
  verifyToken,
  async (req, res) => {
    try {
      const audit = await auditStoreOrderAccountConsistency({ repair: true });
      if (Number(audit?.summary?.repairsApplied || 0) > 0) {
        bumpDataVersion();
        notifyClients();
      }
      return res.json({ success: true, audit });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the repair state don web/account.",
      });
    }
  },
);

app.get("/api/admin/chatgpt-expiry-summary", verifyToken, async (req, res) => {
  try {
    const snapshot = await getFreshExpiryCleanupSnapshot({ allowStale: true });
    return res.json({
      success: true,
      summary: snapshot?.summary || buildDefaultExpiryCleanupSnapshot().summary,
      latestPendingBatchId: String(snapshot?.latestPendingBatchId || "").trim(),
      latestExecutedBatchId: String(snapshot?.latestExecutedBatchId || "").trim(),
      latestRejectedBatchId: String(snapshot?.latestRejectedBatchId || "").trim(),
      latestExpiredBatchId: String(snapshot?.latestExpiredBatchId || "").trim(),
      lastScanAt: String(snapshot?.lastScanAt || "").trim(),
      updatedAt: String(snapshot?.updatedAt || "").trim(),
      version: latestDataVersion,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc tong hop het han ChatGPT.",
    });
  }
});

app.get(
  "/api/admin/chatgpt-expiry-cleanup-preview",
  verifyToken,
  async (req, res) => {
    try {
      const scan = await scanExpiryCleanupState();
      return res.json({
        success: true,
        summary: scan?.summary || buildDefaultExpiryCleanupSnapshot().summary,
        candidates: Array.isArray(scan?.candidates) ? scan.candidates : [],
        warnings: Array.isArray(scan?.warnings) ? scan.warnings : [],
        pkg2MarketExpiringSoon: Array.isArray(scan?.pkg2MarketExpiringSoon)
          ? scan.pkg2MarketExpiringSoon
          : [],
        scannedAt: String(scan?.scannedAt || "").trim(),
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong tai duoc preview don cleanup het han.",
      });
    }
  },
);

app.get(
  "/api/admin/chatgpt-expiry-cleanup-batches",
  verifyAdminOrBotInternalToken,
  async (req, res) => {
    try {
      const status = String(req.query?.status || "").trim();
      const limit = Math.min(Math.max(Number(req.query?.limit || 10), 1), 50);
      const batches = await listRecentExpiryCleanupBatches({ status, limit });
      return res.json({
        success: true,
        batches,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong tai duoc danh sach batch cleanup.",
      });
    }
  },
);

app.get(
  "/api/admin/chatgpt-expiry-cleanup-batches/:batchId",
  verifyAdminOrBotInternalToken,
  async (req, res) => {
    try {
      const batchId = String(req.params?.batchId || "").trim();
      if (!batchId) {
        return res.status(400).json({ error: "Thieu batchId cleanup." });
      }
      const batch = await findExpiryCleanupBatchById(batchId);
      if (!batch) {
        return res.status(404).json({ error: "Khong tim thay batch cleanup." });
      }
      return res.json({ success: true, batch, version: latestDataVersion });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong tai duoc chi tiet batch cleanup.",
      });
    }
  },
);

app.post(
  "/api/admin/chatgpt-expiry-cleanup-batches/:batchId/execute",
  verifyAdminOrBotInternalToken,
  async (req, res) => {
    try {
      const batchId = String(req.params?.batchId || "").trim();
      const actor = String(
        req.user?.email || req.body?.actor || "telegram_admin",
      ).trim();
      const actorSource = String(
        req.body?.actorSource ||
          (req.user?.email ? "admin_panel" : "telegram_cleanup_approve"),
      ).trim();
      const execution = await executeExpiryCleanupBatch(batchId, {
        actor,
        actorSource,
      });
      return res.json({
        success: true,
        batch: execution?.batch || null,
        result: execution?.result || null,
        skippedExecution: !!execution?.skippedExecution,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the chay batch cleanup.",
      });
    }
  },
);

app.post(
  "/api/admin/chatgpt-expiry-cleanup-batches/:batchId/reject",
  verifyAdminOrBotInternalToken,
  async (req, res) => {
    try {
      const batchId = String(req.params?.batchId || "").trim();
      const actor = String(
        req.user?.email || req.body?.actor || "telegram_admin",
      ).trim();
      const actorSource = String(
        req.body?.actorSource ||
          (req.user?.email ? "admin_panel" : "telegram_cleanup_reject"),
      ).trim();
      const batch = await rejectExpiryCleanupBatch(batchId, {
        actor,
        actorSource,
      });
      return res.json({
        success: true,
        batch,
        version: latestDataVersion,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Khong the tu choi batch cleanup.",
      });
    }
  },
);

app.post("/api/store-orders/admin", verifyToken, async (req, res) => {
  try {
    const packageCode = String(req.body?.packageCode || "").trim();
    const fullName = String(req.body?.fullName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    let password = String(req.body?.password || "").trim();
    const phoneNormalized = normalizePhoneValue(phone);
    const emailLower = normalizeEmailLower(email);
    const packageMap = await getStorePackageMap();
    const packageConfig = packageMap[packageCode];

    if (!["package1", "package2"].includes(packageCode) || !packageConfig?.automated) {
      return res.status(400).json({ error: "Chỉ hỗ trợ tạo đơn tay cho Gói 1 hoặc Gói 2." });
    }
    if (!fullName) {
      return res.status(400).json({ error: "Họ tên không được để trống." });
    }
    if (!phoneNormalized) {
      return res.status(400).json({ error: "Số điện thoại không hợp lệ." });
    }
    if (!emailLower) {
      return res.status(400).json({ error: "Email không hợp lệ." });
    }

    const [phoneUser, emailUser] = await Promise.all([
      StoreUser.findOne({ phoneNormalized }),
      StoreUser.findOne({ emailLower }),
    ]);

    if (
      phoneUser &&
      emailUser &&
      String(phoneUser?.id || "").trim() !== String(emailUser?.id || "").trim()
    ) {
      return res.status(409).json({
        error:
          "SĐT và email đang thuộc về hai user web khác nhau. Hãy sửa dữ liệu trước khi tạo đơn.",
      });
    }

    let user = phoneUser || emailUser || null;
    let generatedPassword = "";
    if (!user) {
      if (!password) {
        generatedPassword = createStoreManualPassword();
        password = generatedPassword;
      }
      if (password.length < 6) {
        return res.status(400).json({
          error: "Mật khẩu user mới phải có ít nhất 6 ký tự.",
        });
      }
      user = await StoreUser.create({
        id: createStoreId("store_user"),
        fullName,
        phone,
        phoneNormalized,
        email,
        emailLower,
        passwordHash: await bcrypt.hash(password, 10),
        authProviders: ["password"],
      });
    } else {
      user.fullName = fullName;
      user.phone = phone;
      user.phoneNormalized = phoneNormalized;
      user.email = email;
      user.emailLower = emailLower;
      if (password) {
        if (password.length < 6) {
          return res.status(400).json({
            error: "Mật khẩu mới phải có ít nhất 6 ký tự.",
          });
        }
        user.passwordHash = await bcrypt.hash(password, 10);
        user.authProviders = upsertStringIntoList(user.authProviders, "password");
      }
      user.updatedAt = new Date().toISOString();
      await user.save();
    }

    const nowIso = new Date().toISOString();
    const order = await StoreOrder.create({
      id: createStoreId("ord"),
      userId: String(user.id || "").trim(),
      packageCode,
      packageName: packageConfig.name,
      amount: Number(packageConfig.price || 0),
      status: "paid",
      paymentMethod: "admin_manual",
      momoOrderId: "",
      reservationState: "none",
      fulfillmentState: "ready_for_fulfillment",
      fulfillmentReason: "",
      momoMessage: "Admin tạo đơn thủ công",
      paidAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    let fulfilledOrder = null;
    try {
      fulfilledOrder = await fulfillStoreOrder(order, {
        source: "admin_manual_order",
      });
    } catch (error) {
      await StoreOrder.deleteOne({ id: String(order.id || "").trim() });
      throw error;
    }
    await emitStoreOrderRealtimeUpdate(fulfilledOrder, { includeStock: true });

    return res.json({
      success: true,
      generatedPassword,
      user: sanitizeStoreUserForAdmin(user),
      order: await sanitizeSingleStoreOrderForAdminWithOperationalState(
        fulfilledOrder,
        user,
      ),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thể tạo đơn web thủ công.",
    });
  }
});

app.put("/api/store-users/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID user." });
    }
    const fullName = String(req.body?.fullName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "").trim();
    const unlinkGoogle = !!req.body?.unlinkGoogle;
    const phoneNormalized = normalizePhoneValue(phone);
    const emailLower = normalizeEmailLower(email);

    if (!fullName) {
      return res.status(400).json({ error: "Họ tên không được để trống." });
    }
    if (!phoneNormalized) {
      return res.status(400).json({ error: "Số điện thoại không hợp lệ." });
    }
    if (!emailLower) {
      return res.status(400).json({ error: "Email không hợp lệ." });
    }

    if (password && password.length < 6) {
      return res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự." });
    }

    const user = await StoreUser.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user web." });
    }
    const hadPassword = !!String(user.passwordHash || "").trim();
    const hadGoogle = !!String(user.googleId || "").trim();

    const [existingPhone, existingEmail] = await Promise.all([
      StoreUser.findOne({ phoneNormalized, id: { $ne: id } }).lean(),
      StoreUser.findOne({ emailLower, id: { $ne: id } }).lean(),
    ]);

    if (existingPhone) {
      return res
        .status(409)
        .json({ error: "Số điện thoại này đã được user khác sử dụng." });
    }
    if (existingEmail) {
      return res
        .status(409)
        .json({ error: "Email này đã được user khác sử dụng." });
    }
    if (unlinkGoogle && hadGoogle && !hadPassword && !password) {
      return res.status(400).json({
        error:
          "User này hiện chỉ đăng nhập bằng Google. Hãy đặt mật khẩu mới trước khi gỡ Google.",
      });
    }

    user.fullName = fullName;
    user.phone = phone;
    user.phoneNormalized = phoneNormalized;
    user.email = email;
    user.emailLower = emailLower;
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
      user.authProviders = upsertStringIntoList(user.authProviders, "password");
    }
    if (unlinkGoogle && hadGoogle) {
      user.googleId = "";
      user.authProviders = removeStringFromList(user.authProviders, "google");
    }
    user.updatedAt = new Date().toISOString();
    await user.save();

    return res.json({
      success: true,
      user: sanitizeStoreUserForAdmin(user),
    });
  } catch (error) {
    return res.status(500).json({ error: "Không thể cập nhật user web." });
  }
});

app.post("/api/store-users/:id/reset-password", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    const password = String(req.body?.password || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID user." });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự." });
    }

    const user = await StoreUser.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user web." });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.authProviders = upsertStringIntoList(user.authProviders, "password");
    user.resetTokenHash = "";
    user.resetTokenExpiresAt = "";
    user.updatedAt = new Date().toISOString();
    await user.save();

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Không thể đặt lại mật khẩu user." });
  }
});

app.delete("/api/store-users/:id", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID user." });
    }

    const user = await StoreUser.findOne({ id });
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy user web." });
    }

    await expireStaleStoreOrders({ userId: id });
    await cleanupOldStoreFailedOrders({ userId: id });

    const remainingOrdersCount = await StoreOrder.countDocuments({ userId: id });
    if (remainingOrdersCount > 0) {
      return res.status(409).json({
        error: `User web nÃ y váº«n cÃ²n ${remainingOrdersCount} Ä‘Æ¡n. HÃ£y xem hoáº·c xá»­ lÃ½ Ä‘Æ¡n trÆ°á»›c khi xÃ³a user.`,
      });
    }

    await StoreUser.deleteOne({ id });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Không thể xóa user web." });
  }
});

app.delete("/api/marketplace-order", verifyToken, async (req, res) => {
  const scope = normalizeMarketplaceScope(
    req.body?.scope || req.query?.scope,
    "chatgpt",
  );
  const provider = normalizeMarketplaceProvider(
    req.body?.provider || req.query?.provider,
    "",
  );
  const orderId = String(req.body?.orderId || req.query?.orderId || "").trim();

  if (!provider) {
    return res.status(400).json({ error: "Thieu provider don san" });
  }
  if (!orderId) {
    return res.status(400).json({ error: "Thieu orderId don san" });
  }

  const traceRegex = new RegExp(
    `^${escapeRegex(provider)}#${escapeRegex(orderId)}$`,
    "i",
  );
  const nowIso = new Date().toISOString();

  try {
    const [orders, warrantyCases] = await Promise.all([
      DatammoOrder.find({ scope, provider, orderId }).lean(),
      DatammoWarrantyCase.find({ scope, provider, orderId }).lean(),
    ]);

    const accountIds = new Set();
    (Array.isArray(orders) ? orders : []).forEach((order) => {
      (Array.isArray(order?.accounts) ? order.accounts : []).forEach((item) => {
        const accountId = String(item?.accountId || "").trim();
        if (accountId) {
          accountIds.add(accountId);
        }
      });
    });
    (Array.isArray(warrantyCases) ? warrantyCases : []).forEach((item) => {
      [
        item?.rootAccountId,
        item?.currentAccountId,
        ...(Array.isArray(item?.rounds)
          ? item.rounds.flatMap((round) => [round?.fromAccountId, round?.toAccountId])
          : []),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .forEach((value) => accountIds.add(value));
    });

    const touchedSnapshots = [];
    if (scope === "team") {
      const relatedAccounts = await TeamAccount.find({
        $or: [
          { id: { $in: Array.from(accountIds) } },
          { "slots.customerName": traceRegex },
        ],
      });

      for (const account of relatedAccounts) {
        const nextSlots = clearMarketplaceManagedTeamSlotsByOrder(
          account.slots,
          provider,
          orderId,
        );
        const currentSlotsJson = JSON.stringify(normalizeTeamSlots(account.slots));
        const nextSlotsJson = JSON.stringify(nextSlots);
        const nextWarehouse = normalizeTeamWarehouseState({
          ...snapshotDocument(account),
          slots: nextSlots,
        });
        const currentWarehouse = normalizeTeamWarehouse(
          account.warehouse,
          TEAM_WAREHOUSE_TOTAL,
        );

        if (
          currentSlotsJson === nextSlotsJson &&
          currentWarehouse === nextWarehouse
        ) {
          continue;
        }

        touchedSnapshots.push({
          model: TeamAccount,
          id: account.id,
          snapshot: snapshotDocument(account),
        });
        await TeamAccount.findOneAndUpdate(
          { id: account.id },
          {
            $set: {
              slots: nextSlots,
              warehouse: nextWarehouse,
              updatedAt: nowIso,
            },
          },
        );
      }
    } else {
      const relatedAccounts = await Account.find({
        $or: [
          { id: { $in: Array.from(accountIds) } },
          { "users.name": traceRegex },
        ],
      });

      for (const account of relatedAccounts) {
        const nextUsers = clearMarketplaceManagedUsersByOrder(
          account.users,
          provider,
          orderId,
        );
        const currentUsersJson = JSON.stringify(
          Array.isArray(account.users) ? account.users : [],
        );
        const nextUsersJson = JSON.stringify(nextUsers);
        const nextShelf = normalizeChatgptMarketAccountState({
          ...snapshotDocument(account),
          users: nextUsers,
        });
        const currentShelf = normalizePackage2Shelf(
          account.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        );

        if (currentUsersJson === nextUsersJson && currentShelf === nextShelf) {
          continue;
        }

        touchedSnapshots.push({
          model: Account,
          id: account.id,
          snapshot: snapshotDocument(account),
        });
        await Account.findOneAndUpdate(
          { id: account.id },
          {
            $set: {
              users: nextUsers,
              package2Shelf: nextShelf,
              updatedAt: nowIso,
            },
          },
        );
      }
    }

    if (
      touchedSnapshots.length === 0 &&
      orders.length === 0 &&
      warrantyCases.length === 0
    ) {
      return res.status(404).json({
        error: "Khong tim thay don san hoac seller trace de xoa",
      });
    }

    try {
      await Promise.all([
        DatammoOrder.deleteMany({ scope, provider, orderId }),
        DatammoWarrantyCase.deleteMany({ scope, provider, orderId }),
      ]);
    } catch (error) {
      for (const item of touchedSnapshots.slice().reverse()) {
        await restoreDocumentSnapshot(item.model, item.id, item.snapshot);
      }
      await restoreMarketplaceOrderSnapshots(orders, warrantyCases);
      throw error;
    }

    res.json({
      message: `Da xoa don ${getMarketplaceProviderLabel(provider)} ${orderId}`,
      removedOrders: orders.length,
      removedWarrantyCases: warrantyCases.length,
      restoredAccounts: touchedSnapshots.length,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 1.5 GET ALL DATA (Public - for Telegram bot)
app.get("/api/data-public", verifyBotInternalToken, async (req, res) => {
  try {
    const payload = await getCachedAdminRead(
      "public:data",
      {},
      async () => {
        const [accounts, datammoOrders, datammoWarrantyCases] = await Promise.all([
          Account.find({}).lean(),
          DatammoOrder.find({ scope: "chatgpt" }).lean(),
          DatammoWarrantyCase.find({ scope: "chatgpt" }).lean(),
        ]);
        let marketplaceAccountTraceMap = new Map();
        try {
          marketplaceAccountTraceMap = buildMarketplaceAccountTraceMap(
            datammoOrders,
            datammoWarrantyCases,
          );
        } catch (traceError) {
          console.error("Public ChatGPT marketplace trace snapshot failed:", traceError);
        }
        return {
          chatgpt: accounts.map((acc) => ({
            ...acc,
            package2Shelf: normalizePackage2Shelf(
              acc?.package2Shelf,
              CHATGPT_TOTAL_VALUE,
            ),
            marketplaceTraceSummary:
              marketplaceAccountTraceMap.get(String(acc?.id || "").trim()) || null,
          })),
          version: latestDataVersion,
        };
      },
      15000,
    );
    res.json(payload);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get("/api/chatgpt/stats-public", verifyBotInternalToken, async (req, res) => {
  try {
    const payload = await getCachedAdminRead(
      "public:chatgpt-stats",
      {},
      async () => ({
        success: true,
        summary: await buildChatgptPublicStatsSummary(),
        version: latestDataVersion,
      }),
      30000,
    );
    return res.json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tai duoc thong ke ChatGPT.",
    });
  }
});

app.get("/api/chatgpt/account-public", verifyBotInternalToken, async (req, res) => {
  try {
    const email = String(req.query?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Thieu email." });
    }
    const account = await Account.findOne({
      username: new RegExp(`^${escapeRegex(email)}$`, "i"),
    }).lean();
    if (!account) {
      return res.json({ success: true, account: null });
    }
    const traceMap = await buildMarketplaceTraceMapForAccountIds([account.id]);
    return res.json({
      success: true,
      account: {
        ...account,
        package2Shelf: normalizePackage2Shelf(
          account?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
        marketplaceTraceSummary:
          traceMap.get(String(account?.id || "").trim()) || null,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tim duoc tai khoan.",
    });
  }
});

app.get(
  "/api/chatgpt/customer-search-public",
  verifyBotInternalToken,
  async (req, res) => {
  try {
    const keyword = String(req.query?.q || "").trim();
    if (!keyword) {
      return res.status(400).json({ error: "Thieu tu khoa." });
    }
    const normalizedKeyword = normalizeVietnameseForSearch(keyword);
    const directRegex = new RegExp(escapeRegex(keyword), "i");
    let accounts = await Account.find({
      "users.0": { $exists: true },
      "users.name": directRegex,
    })
      .select("id username password otpSecret type link users duration")
      .lean();

    let results = [];
    const collectResults = (items = []) => {
      const next = [];
      (Array.isArray(items) ? items : []).forEach((acc) => {
        const users = Array.isArray(acc?.users) ? acc.users : [];
        users.forEach((user, idx) => {
          const normalizedUserName = normalizeVietnameseForSearch(user?.name);
          if (!normalizedUserName.includes(normalizedKeyword)) return;
          next.push({
            accountId: String(acc?.id || "").trim(),
            userName: String(user?.name || "").trim(),
            accEmail: String(acc?.username || "").trim(),
            accPassword: String(acc?.password || "").trim(),
            accOtpSecret: String(acc?.otpSecret || "").trim(),
            accType: String(acc?.type || "").trim(),
            accLink: String(acc?.link || "").trim(),
            joinedAt: String(user?.joinedAt || "").trim(),
            expiredAt: String(user?.expiredAt || "").trim(),
            accDuration: String(acc?.duration || "1M").trim() || "1M",
            userIndex: idx,
          });
        });
      });
      return next;
    };

    results = collectResults(accounts);
    if (results.length === 0) {
      accounts = await Account.find({
        "users.0": { $exists: true },
      })
        .select("id username password otpSecret type link users duration")
        .lean();
      results = collectResults(accounts);
    }

    const traceMap = await buildMarketplaceTraceMapForAccountIds(
      results.map((item) => item.accountId),
    );
    return res.json({
      success: true,
      results: results.slice(0, 20).map((item) => ({
        ...item,
        accMarketplaceTraceSummary: traceMap.get(item.accountId) || null,
      })),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong tim duoc khach hang.",
    });
  }
  },
);

// Datammo Partner Standard: GET stock
app.get(
  ["/api/datammo/stock", "/api/datammo/stock/:shelf"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    try {
      const payload = await getCachedPartnerRead(
        "chatgpt-stock",
        {},
        async () => {
          const stock = await Account.countDocuments(buildPackage2SaleFilter());
          const mainPrice = Number(process.env.DATAMMO_PACKAGE2_MAIN_PRICE || 0);
          const cheapPrice = Number(process.env.DATAMMO_PACKAGE2_CHEAP_PRICE || 0);
          const selectedPrice = cheapPrice > 0 ? cheapPrice : mainPrice;
          const nextPayload = { stock };
          if (Number.isFinite(selectedPrice) && selectedPrice > 0) {
            nextPayload.price = selectedPrice;
          }
          return nextPayload;
        },
      );
      res.json(payload);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

// Datammo Partner Standard: GET buy
app.get(
  ["/api/datammo/buy", "/api/datammo/buy/:shelf"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    const rawQuantity = req.query?.quantity;
    const quantity = getSafeBuyQuantity(rawQuantity);
    const orderId = String(
      req.query?.order_id || req.query?.orderId || `dm_${Date.now()}`,
    );

    let claimed = [];
    try {
      if (isPlaceholderLikeValue(orderId) || isPlaceholderLikeValue(rawQuantity)) {
        return res.json({
          success: true,
          data: ["preview_user|preview_pass|preview_link"],
          preview: true,
        });
      }
      await reconcileChatgptMarketInventory();
      const available = await Account.countDocuments(buildPackage2SaleFilter());
      if (available < quantity) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock (${available}/${quantity})`,
          available,
        });
      }

      claimed = await claimPackage2AccountsForOrder({
        quantity,
        orderId,
      });

      if (claimed.length < quantity) {
        await rollbackClaimedPackage2Accounts(claimed);
        return res.status(409).json({
          success: false,
          message: "Stock changed during processing. Please retry.",
          available: claimed.length,
        });
      }

      try {
        await logMarketplaceOrder({
          provider: "datammo",
          orderId,
          shelf: "market",
          quantity,
          claimed,
        });
      } catch (orderLogError) {
        console.error(
          "Datammo order log error:",
          orderLogError?.message || orderLogError,
        );
      }

      bumpDataVersion();
      notifyClients();

      return res.json({
        success: true,
        data: claimed.map((item) => item.delivery),
      });
    } catch (error) {
      if (claimed.length > 0) {
        await rollbackClaimedPackage2Accounts(claimed);
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

app.all(
  [
    "/api/shopmini/input.php",
    "/api/shopmini/input.php/:shelf",
    "/api/shopmini/:shelf/input.php",
  ],
  verifyShopminiPrivateToken,
  async (req, res) => {
    const action = resolveShopminiActionFromReq(req);

    if (action !== "buy") {
      try {
        const payload = await getCachedPartnerRead(
          "shopmini-chatgpt-stock",
          {},
          async () => ({ sum: await Account.countDocuments(buildPackage2SaleFilter()) }),
        );
        return res.json(payload);
      } catch (error) {
        return res
          .status(500)
          .json({ success: false, message: error.message || "Stock error" });
      }
    }

    const quantity = getShopminiBuyQuantity(req);
    const orderId = getShopminiOrderId(req);
    const rawQuantity =
      req.query?.quantity ||
      req.query?.soluong ||
      req.query?.so_luong ||
      req.query?.amount ||
      req.body?.quantity ||
      req.body?.soluong ||
      req.body?.so_luong ||
      req.body?.amount;
    let claimed = [];

    if (isPlaceholderLikeValue(orderId) || isPlaceholderLikeValue(rawQuantity)) {
      return res.json(
        buildShopminiStrictSamplePayload(["preview_user|preview_pass|preview_link"]),
      );
    }

    try {
      await reconcileChatgptMarketInventory();
      const available = await Account.countDocuments(buildPackage2SaleFilter());
      if (available < quantity) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock (${available}/${quantity})`,
          available,
        });
      }

      claimed = await claimPackage2AccountsForOrder({
        quantity,
        orderId,
        managedUserName: `Shopmini#${orderId || Date.now()}`,
      });

      if (claimed.length < quantity) {
        await rollbackClaimedPackage2Accounts(claimed);
        return res.status(409).json({
          success: false,
          message: "Stock changed during processing. Please retry.",
          available: claimed.length,
        });
      }

      try {
        await logMarketplaceOrder({
          provider: "shopmini",
          orderId,
          shelf: "market",
          quantity,
          claimed,
        });
      } catch (orderLogError) {
        console.error(
          "Shopmini order log error:",
          orderLogError?.message || orderLogError,
        );
      }

      bumpDataVersion();
      notifyClients();

      return res.json(buildShopminiStrictSamplePayload(claimed.map((item) => item.delivery)));
    } catch (error) {
      if (claimed.length > 0) {
        await rollbackClaimedPackage2Accounts(claimed);
      }
      return res
        .status(500)
        .json({ success: false, message: error.message || "Buy error" });
    }
  },
);

app.get(
  ["/api/datammo/team/stock", "/api/datammo/team/stock/:mode"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    try {
      const saleMode = resolveTeamMarketplaceModeFromReq(req);
      if (!saleMode) {
        return res.status(400).json({
          success: false,
          message: "Missing team mode",
        });
      }
      const payload = await getCachedPartnerRead(
        "team-stock",
        { saleMode },
        async () => buildTeamMarketplaceStockPayload(saleMode),
      );
      return res.json(payload);
    } catch (error) {
      return res
        .status(error.statusCode || 500)
        .json({ success: false, message: error.message || "Stock error" });
    }
  },
);

app.get(
  ["/api/datammo/team/buy", "/api/datammo/team/buy/:mode"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    const rawQuantity = req.query?.quantity;
    const quantity = getSafeBuyQuantity(rawQuantity);
    const orderId = String(
      req.query?.order_id || req.query?.orderId || `dm_team_${Date.now()}`,
    ).trim();
    let claimed = [];
    try {
      if (isPlaceholderLikeValue(orderId) || isPlaceholderLikeValue(rawQuantity)) {
        return res.json({
          success: true,
          data: ["preview_team|preview_pass|preview_link"],
          preview: true,
        });
      }
      await reconcileTeamMarketInventory();
      const saleMode = resolveTeamMarketplaceModeFromReq(req);
      if (!saleMode) {
        return res.status(400).json({
          success: false,
          message: "Missing team mode",
        });
      }
      if (saleMode !== TEAM_SALE_MODE_BUSINESS) {
        return res.status(400).json({
          success: false,
          message: "Team slot khong ban qua API",
        });
      }
      const available = await countTeamMarketplaceStock(saleMode);
      if (available < quantity) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock (${available}/${quantity})`,
          available,
        });
      }

      claimed = await claimTeamAccountsForOrder({
        quantity,
        orderId,
        provider: "datammo",
        saleMode,
      });

      if (claimed.length < quantity) {
        await rollbackClaimedTeamAccounts(claimed);
        return res.status(409).json({
          success: false,
          message: "Stock changed during processing. Please retry.",
          available: claimed.length,
        });
      }

      await logMarketplaceOrder({
        scope: "team",
        provider: "datammo",
        orderId,
        shelf: "market",
        quantity,
        claimed,
      });

      bumpDataVersion();
      notifyClients();

      return res.json({
        success: true,
        data: claimed.map((item) => item.delivery),
      });
    } catch (error) {
      if (claimed.length > 0) {
        await rollbackClaimedTeamAccounts(claimed);
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

app.all(
  [
    "/api/shopmini/team/input.php",
    "/api/shopmini/team/input.php/:mode",
    "/api/shopmini/team/:mode/input.php",
  ],
  verifyShopminiPrivateToken,
  async (req, res) => {
    const action = resolveShopminiActionFromReq(req);

    if (action !== "buy") {
      try {
        const saleMode = resolveTeamMarketplaceModeFromReq(req);
        if (!saleMode) {
          return res.status(400).json({
            success: false,
            message: "Missing team mode",
          });
        }
        const payload = await getCachedPartnerRead(
          "shopmini-team-stock",
          { saleMode },
          async () => buildTeamMarketplaceStockPayload(saleMode),
        );
        return res.json({ sum: payload.stock });
      } catch (error) {
        return res
          .status(500)
          .json({ success: false, message: error.message || "Stock error" });
      }
    }

    const quantity = getShopminiBuyQuantity(req);
    const orderId = getShopminiOrderId(req);
    const rawQuantity =
      req.query?.quantity ||
      req.query?.soluong ||
      req.query?.so_luong ||
      req.query?.amount ||
      req.body?.quantity ||
      req.body?.soluong ||
      req.body?.so_luong ||
      req.body?.amount;
    let claimed = [];

    if (isPlaceholderLikeValue(orderId) || isPlaceholderLikeValue(rawQuantity)) {
      return res.json(
        buildShopminiStrictSamplePayload(["preview_team|preview_pass|preview_link"]),
      );
    }

    try {
      await reconcileTeamMarketInventory();
      const saleMode = resolveTeamMarketplaceModeFromReq(req);
      if (!saleMode) {
        return res.status(400).json({
          success: false,
          message: "Missing team mode",
        });
      }
      if (saleMode !== TEAM_SALE_MODE_BUSINESS) {
        return res.status(400).json({
          success: false,
          message: "Team slot khong ban qua API",
        });
      }
      const available = await countTeamMarketplaceStock(saleMode);
      if (available < quantity) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock (${available}/${quantity})`,
          available,
        });
      }

      claimed = await claimTeamAccountsForOrder({
        quantity,
        orderId,
        provider: "shopmini",
        saleMode,
      });

      if (claimed.length < quantity) {
        await rollbackClaimedTeamAccounts(claimed);
        return res.status(409).json({
          success: false,
          message: "Stock changed during processing. Please retry.",
          available: claimed.length,
        });
      }

      await logMarketplaceOrder({
        scope: "team",
        provider: "shopmini",
        orderId,
        shelf: "market",
        quantity,
        claimed,
      });

      bumpDataVersion();
      notifyClients();

      return res.json(buildShopminiStrictSamplePayload(claimed.map((item) => item.delivery)));
    } catch (error) {
      if (claimed.length > 0) {
        await rollbackClaimedTeamAccounts(claimed);
      }
      return res
        .status(500)
        .json({ success: false, message: error.message || "Buy error" });
    }
  },
);

// 2. ADD ACCOUNT (Protected - requires token)
app.post("/api/chatgpt", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const expiredDate = new Date(now);
    expiredDate.setMonth(expiredDate.getMonth() + 1); // Add 1 month
    const normalizedBody = normalizeChatgptPayload(req.body);

    const newAcc = {
      id: Date.now().toString(),
      ...normalizedBody,
      createdAt: now.toISOString(),
      expiredAt: expiredDate.toISOString(),
      updatedAt: now.toISOString(),
    };
    await Account.create(newAcc);
    res.json({ message: "Added successfully", account: newAcc });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 2.5 ADD ACCOUNT (Public - for Telegram bot)
const buildPublicChatgptAccountPayload = (payload = {}) => {
  const now = new Date();
  const expiredDate = new Date(now);
  expiredDate.setMonth(expiredDate.getMonth() + 1);
  const normalizedBody = normalizeChatgptPayload(payload);
  return {
    id: createStoreId("gpt"),
    ...normalizedBody,
    createdAt: now.toISOString(),
    expiredAt: expiredDate.toISOString(),
    updatedAt: now.toISOString(),
  };
};
const createPublicChatgptAccount = async (payload = {}) => {
  const newAcc = buildPublicChatgptAccountPayload(payload);
  const created = await Account.create(newAcc);
  return created?.toObject?.() || newAcc;
};
app.post("/api/chatgpt-public", verifyBotInternalToken, async (req, res) => {
  try {
    const account = await createPublicChatgptAccount(req.body);
    res.json({ message: "Added successfully", account });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post("/api/chatgpt-public/bulk", verifyBotInternalToken, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ error: "Thieu danh sach account." });
    }

    const successes = [];
    const errors = [];
    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index] || {};
      const lineNumber = Number(item?.lineNumber || index + 1);
      try {
        const account = await createPublicChatgptAccount({
          username: item.username || item.email || "",
          password: item.password || "",
          otpSecret: item.otpSecret || "",
          link: item.link || "",
          type: "unassigned",
          note: item.note || "",
        });
        successes.push({
          lineNumber,
          kind: "plus",
          username: String(account?.username || item?.username || item?.email || "").trim(),
        });
      } catch (error) {
        errors.push({
          lineNumber,
          kind: "plus",
          username: String(item?.username || item?.email || "").trim(),
          reason: error.message || "Khong the them account",
        });
      }
    }

    return res.json({
      success: true,
      summary: {
        total: rawItems.length,
        successCount: successes.length,
        errorCount: errors.length,
      },
      successes,
      errors,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong the import hang loat Plus.",
    });
  }
});

// 3. UPDATE ACCOUNT
app.get("/api/chatgpt/:id/move-candidates", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiếu ID tài khoản nguồn." });
    }

    const source = await Account.findOne({ id })
      .select("id username type package2Shelf users expiredAt createdAt updatedAt")
      .lean();
    if (!source) {
      return res.status(404).json({ error: "Không tìm thấy tài khoản nguồn." });
    }

    const [decoratedSource] = await decorateChatgptAccountsWithOperationalState([
      source,
    ]);
    const candidates = await listChatgptMoveCandidates(source);
    return res.json({
      success: true,
      source: sanitizeChatgptMoveCandidate(decoratedSource || source),
      sourceState: pickChatgptCurrentStatePayload(decoratedSource || source),
      candidates,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Không thể tải tài khoản đích để chuyển khách.",
    });
  }
});

app.get("/api/chatgpt/:id/warranty-candidates", verifyToken, async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "Thiáº¿u ID tÃ i khoáº£n lá»—i." });
    }

    const source = await Account.findOne({ id })
      .select("id username type package2Shelf users expiredAt createdAt updatedAt")
      .lean();
    if (!source) {
      return res.status(404).json({ error: "KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n lá»—i." });
    }

    const [decoratedSource] = await decorateChatgptAccountsWithOperationalState([
      source,
    ]);
    const candidates = await listChatgptWarrantyCandidates(source);
    return res.json({
      success: true,
      source: sanitizeChatgptMoveCandidate(decoratedSource || source),
      sourceState: pickChatgptCurrentStatePayload(decoratedSource || source),
      candidates,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "KhÃ´ng thá»ƒ táº£i tÃ i khoáº£n thay tháº¿ Ä‘á»ƒ báº£o hÃ nh.",
    });
  }
});

app.put("/api/chatgpt/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const expectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.expectedUpdatedAt,
    );

    const existingAcc = await Account.findOne({ id: id });
    const existingSnapshot = snapshotDocument(existingAcc);
    if (!existingAcc) {
      return res.status(404).json({ error: "Khong tim thay account" });
    }
    const activePendingReservation =
      await findActivePendingStoreReservationByAccountId(id);
    if (activePendingReservation) {
      return res.status(409).json({
        error: `Acc nay dang duoc giu cho don web ${String(activePendingReservation?.id || "").trim()}. Khong duoc sua tay trong luc cho thanh toan.`,
      });
    }
    ensureCurrentVersion(existingAcc, expectedUpdatedAt, "Tai khoan nay");
    const [decoratedExistingAcc] =
      await decorateChatgptAccountsWithOperationalState([existingSnapshot]);
    const safeExistingAcc = decoratedExistingAcc || existingSnapshot;

    // Validate package2: chỉ được tối đa 1 khách hàng
    const normalizedPayload = normalizeChatgptPayload(req.body, existingAcc);
    const targetType = normalizedPayload.type || existingAcc.type;
    const trackedMarketplaceOrder = await findLatestMarketplaceOrderForAccount(
      id,
      "",
      "chatgpt",
    );

    if (normalizedPayload.users !== undefined) {
      if (targetType === "package2" && normalizedPayload.users.length > 1) {
        return res.status(400).json({ error: "Gói Private (Gói 2) chỉ được tối đa 1 khách hàng" });
      }
    }

    const isChangingType =
      normalizedPayload.type !== undefined &&
      String(normalizedPayload.type || "").trim() !== String(existingAcc.type || "").trim();
    const isChangingShelf =
      req.body.package2Shelf !== undefined &&
      normalizePackage2Shelf(req.body.package2Shelf, existingAcc.package2Shelf) !==
        normalizePackage2Shelf(existingAcc.package2Shelf, CHATGPT_TOTAL_VALUE);
    if (
      (isChangingType || isChangingShelf) &&
      (safeExistingAcc?.isWarrantyHold ||
        safeExistingAcc?.isBusyInWarrantyReplacement)
    ) {
      return res.status(409).json({
        error:
          String(safeExistingAcc?.busyReason || "").trim() ||
          "Tai khoan nay dang trong luong bao hanh nen khong duoc doi goi/doi kho tay.",
        sourceState: pickChatgptCurrentStatePayload(safeExistingAcc),
        diagnostics: await buildChatgptAccountAdminDiagnostics(id),
      });
    }

    // ===== BACKEND GUARD: Chặn đổi gói khi đang có khách =====
    if (normalizedPayload.type && normalizedPayload.type !== existingAcc.type) {
      if (trackedMarketplaceOrder) {
        return res.status(400).json(
          await buildChatgptTraceBlockedResponse(
            id,
            "Acc da ban qua san khong duoc doi goi tay. Neu can doi acc, hay dung Bao hanh.",
          ),
        );
      }
      const currentUsers = existingAcc.users || [];
      if (currentUsers.length > 0) {
        return res.status(400).json({
          error: `Không thể đổi gói khi đang có ${currentUsers.length} khách hàng. Vui lòng xóa hết khách trước!`,
        });
      }
    }
    // ==========================================================

    const existingUsers = Array.isArray(existingAcc.users) ? existingAcc.users : [];
    const nextUsers =
      normalizedPayload.users !== undefined
        ? normalizedPayload.users
        : existingUsers;
    const existingShelf = normalizePackage2Shelf(
      existingAcc.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    );
    const requestedShelf = req.body.package2Shelf !== undefined
      ? normalizePackage2Shelf(req.body.package2Shelf, existingShelf)
      : existingShelf;
    const isManualShelfUpdate =
      supportsChatgptMarket(targetType) && req.body.package2Shelf !== undefined;
    const isPackage2ShelfChanged = existingShelf !== requestedShelf;
    if (
      isManualShelfUpdate &&
      isPackage2ShelfChanged &&
      trackedMarketplaceOrder
    ) {
      return res.status(400).json(
        await buildChatgptTraceBlockedResponse(
          id,
          "Acc da ban qua san khong duoc doi kho tay. Neu can doi acc, hay dung Bao hanh.",
        ),
      );
    }
    if (
      isManualShelfUpdate &&
      isPackage2ShelfChanged &&
      hasAnyAssignedUsers(nextUsers)
    ) {
      return res.status(400).json({
        error: "Khong the chuyen kho khi tai khoan dang co khach. Vui long xoa hoac chuyen khach truoc.",
      });
    }
    const nextDaysLeft = existingAcc?.expiredAt
      ? Math.ceil(
          (new Date(existingAcc.expiredAt).getTime() - Date.now()) / 86400000,
        )
      : null;
    if (
      isManualShelfUpdate &&
      requestedShelf === CHATGPT_MARKET_VALUE &&
      nextDaysLeft !== null &&
      Number.isFinite(nextDaysLeft) &&
      nextDaysLeft <= PACKAGE2_MIN_DAYS_FOR_SALE
    ) {
      return res.status(400).json({
        error:
          "Tai khoan duoi 25 ngay khong duoc dua vao kho market tu dong. Hay day sang kho duoi 25 ngay.",
      });
    }
    const hadRegularPackage2Customer = hasRegularPackage2Customer(existingUsers);
    const shouldAutoUnsetPackage2Shelf =
      supportsChatgptMarket(targetType) &&
      (hasRegularPackage2Customer(nextUsers) ||
        (normalizedPayload.users !== undefined &&
          Array.isArray(nextUsers) &&
          nextUsers.length === 0 &&
          hadRegularPackage2Customer));
    if (targetType === "package2" && shouldAutoUnsetPackage2Shelf) {
      normalizedPayload.package2Shelf = CHATGPT_TOTAL_VALUE;
    }
    const updated = await Account.findOneAndUpdate(
      buildConditionalUpdateFilter(id, expectedUpdatedAt),
      withFreshUpdatedAt(normalizedPayload),
      {
        new: true,
      },
    );
    if (!updated) {
      return res.status(409).json({
        error:
          "Tài khoản này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }
    const reconciled = await syncChatgptMarketStateIfNeeded(updated);
    const isPackage2Context =
      supportsChatgptMarket(existingAcc.type) || supportsChatgptMarket(targetType);
    const isManualShelfUpdateForResponse =
      isPackage2Context && req.body.package2Shelf !== undefined;
    const requestKeys = Object.keys(req.body || {});
    const isShelfOnlyUpdate =
      isManualShelfUpdateForResponse &&
      requestKeys.length > 0 &&
      requestKeys.every((key) => key === "package2Shelf");
    if (isShelfOnlyUpdate && !isPackage2ShelfChanged) {
      return res.json({
        message: "Updated",
        account: reconciled,
        syncSkipped: true,
      });
    }

    res.json({ message: "Updated", account: reconciled });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 4. DELETE ACCOUNT
app.delete("/api/chatgpt/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const expectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.expectedUpdatedAt || req.query?.expectedUpdatedAt,
    );
    const activePendingReservation =
      await findActivePendingStoreReservationByAccountId(id);
    if (activePendingReservation) {
      return res.status(409).json({
        error: `Acc nay dang duoc giu cho don web ${String(activePendingReservation?.id || "").trim()}. Khong duoc xoa trong luc cho thanh toan.`,
      });
    }
    const existingForGuard = await Account.findOne({ id })
      .select(CHATGPT_ADMIN_ACCOUNT_SELECT)
      .lean();
    const [decoratedExisting] = await decorateChatgptAccountsWithOperationalState(
      existingForGuard ? [existingForGuard] : [],
    );
    const currentState = decoratedExisting
      ? pickChatgptCurrentStatePayload(decoratedExisting)
      : null;
    if (
      currentState &&
      (currentState.hasAssignedUsers ||
        currentState.isWarrantyHold ||
        currentState.isBusyInWarrantyReplacement ||
        currentState.isBusyInMarketplace)
    ) {
      return res.status(409).json({
        error:
          String(currentState?.busyReason || "").trim() ||
          "Tai khoan nay dang ban hoac dang bi giu nen khong duoc xoa.",
        sourceState: currentState,
        diagnostics: await buildChatgptAccountAdminDiagnostics(id),
      });
    }
    const existing = await Account.findOneAndDelete(
      buildConditionalUpdateFilter(id, expectedUpdatedAt),
    );
    if (!existing && expectedUpdatedAt) {
      return res.status(409).json({
        error:
          "Tài khoản này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post("/api/chatgpt/:id/warranty", verifyToken, async (req, res) => {
  try {
    const sourceExpectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.sourceExpectedUpdatedAt || req.body?.expectedUpdatedAt,
    );
    const replacementExpectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.replacementExpectedUpdatedAt,
    );
    const replacementAccountId = String(
      req.body?.replacementAccountId || "",
    ).trim();
    const reason = String(req.body?.reason || "").trim();

    if (!replacementAccountId) {
      return res.status(400).json({ error: "Thiếu tài khoản thay thế" });
    }

    const sourceAcc = await Account.findOne({ id: req.params.id });
    const replacementAcc = await Account.findOne({ id: replacementAccountId });
    const replacementPendingReservation =
      await findActivePendingStoreReservationByAccountId(replacementAccountId);
    if (replacementPendingReservation) {
      return res.status(409).json({
        error: `Tai khoan thay the dang duoc giu cho don web ${String(replacementPendingReservation?.id || "").trim()}. Khong duoc dung de bao hanh trong luc cho thanh toan.`,
      });
    }

    if (!sourceAcc || !replacementAcc) {
      return res.status(404).json({ error: "Không tìm thấy tài khoản bảo hành" });
    }
    ensureCurrentVersion(sourceAcc, sourceExpectedUpdatedAt, "Tài khoản lỗi");
    ensureCurrentVersion(
      replacementAcc,
      replacementExpectedUpdatedAt,
      "Tài khoản thay thế",
    );

    const [decoratedSourceAcc, decoratedReplacementAcc] =
      await decorateChatgptAccountsWithOperationalState([
        snapshotDocument(sourceAcc),
        snapshotDocument(replacementAcc),
      ]);
    const safeSourceAcc = decoratedSourceAcc || snapshotDocument(sourceAcc);
    const safeReplacementAcc =
      decoratedReplacementAcc || snapshotDocument(replacementAcc);
    const replacementDecision = await buildChatgptActionBlockedResponse({
      sourceAccount: safeSourceAcc,
      candidateAccount: safeReplacementAcc,
      action: "chatgpt_warranty_replacement",
      options: { sourceId: String(sourceAcc?.id || "").trim() },
      fallbackMessage: "Tai khoan thay the khong con hop le de bao hanh seller.",
    });
    if (replacementDecision) {
      return res
        .status(replacementDecision.statusCode)
        .json(replacementDecision.payload);
    }

    if (sourceAcc.id === replacementAcc.id) {
      return res.status(400).json({
        error: "Tài khoản thay thế phải khác tài khoản đang lỗi",
      });
    }
    if (false) {
      return res.status(400).json({
        error: "Bảo hành hiện chỉ hỗ trợ tài khoản seller gói 2",
      });
    }

    const replacementOriginalType =
      String(replacementAcc?.type || "unassigned").trim() || "unassigned";
    if (
      !supportsChatgptWarrantyReplacement(sourceAcc.type) ||
      !supportsChatgptWarrantyReplacement(replacementOriginalType)
    ) {
      return res.status(400).json({
        error: "Bao hanh seller chi nhan acc Private trong hoac acc chua chon",
      });
    }
    if (replacementOriginalType === "unassigned") {
      replacementAcc.type = "package2";
    }

    const sourceUsers = Array.isArray(sourceAcc.users) ? sourceAcc.users : [];
    const sourceUser = sourceUsers[0] || null;
    const hasManagedSourceUser =
      sourceUsers.length === 1 && isDatammoManagedUser(sourceUser);
    if (sourceUsers.length > 1) {
      return res.status(400).json({
        error: "Tài khoản này đang có nhiều khách, không thể bảo hành seller tự động",
      });
    }
    if (sourceUsers.length === 1 && !hasManagedSourceUser) {
      return res.status(400).json({
        error: "Tài khoản này đang giữ khách thường, không phải khách seller để bảo hành",
      });
    }
    const sourceManagedInfo = getMarketplaceOrderInfoFromUser(sourceUser);
    const fallbackOrder = await findLatestMarketplaceOrderForAccount(
      sourceAcc.id,
      sourceManagedInfo.provider,
      "chatgpt",
    );
    const orderId = String(
      sourceManagedInfo.orderId || fallbackOrder?.orderId || "",
    ).trim();
    const provider = normalizeMarketplaceProvider(
      sourceManagedInfo.provider || fallbackOrder?.provider,
    );
    if (!orderId) {
      return res.status(400).json({
        error: "Không xác định được order seller từ tài khoản lỗi",
      });
    }
    const sourceUsersForWarranty = hasManagedSourceUser
      ? sourceUsers
      : [
          buildManagedMarketplaceUser({
            provider,
            orderId,
            joinedAt: sourceUser?.joinedAt || fallbackOrder?.createdAt,
            expiredAt: sourceUser?.expiredAt || sourceAcc?.expiredAt,
          }),
        ];

    if (Array.isArray(replacementAcc.users) && replacementAcc.users.length > 0) {
      return res.status(400).json({
        error: "Tài khoản thay thế đang có khách, không thể dùng để bảo hành",
      });
    }
    if (
      replacementAcc.expiredAt &&
      new Date(replacementAcc.expiredAt).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        error: "Tài khoản thay thế đã hết hạn",
      });
    }

    const replacementMarketplaceOrder = await findLatestMarketplaceOrderForAccount(
      replacementAcc.id,
      "",
      "chatgpt",
    );
    if (replacementMarketplaceOrder) {
      return res.status(400).json({
        error:
          "Tai khoan thay the da tung ban tren san, khong the dung de bao hanh",
      });
    }
    const replacementWarrantyCase =
      await findActiveMarketplaceWarrantyCaseForAccount(
        replacementAcc.id,
        "chatgpt",
      );
    if (replacementWarrantyCase) {
      return res.status(400).json({
        error:
          "Tai khoan thay the nay dang nam trong mot luong bao hanh khac",
      });
    }
    const replacementBusyIds = new Set(
      await getBusyChatgptAccountIdsForStoreWarranty(),
    );
    if (replacementBusyIds.has(String(replacementAcc?.id || "").trim())) {
      return res.status(400).json({
        error:
          "Tai khoan thay the nay dang nam trong don web/bao hanh khac, khong the dung de bao hanh",
      });
    }

    if (false) {
      return res.status(400).json({
        error: "Tài khoản thay thế này đang nằm trong một luồng bảo hành khác",
      });
    }

    const sourceSnapshot = snapshotDocument(sourceAcc);
    const replacementSnapshot = snapshotDocument(replacementAcc);
    const nowIso = new Date().toISOString();
    const persistedReplacement = await Account.findOneAndUpdate(
      buildConditionalUpdateFilter(replacementAcc.id, replacementExpectedUpdatedAt),
      {
        $set: {
          type:
            replacementOriginalType === "unassigned"
              ? "package2"
              : replacementAcc.type,
          users: sourceUsersForWarranty,
          package2Shelf: CHATGPT_MARKET_VALUE,
          updatedAt: nowIso,
        },
      },
      { new: true },
    );
    if (!persistedReplacement) {
      throw buildConcurrencyError("Tài khoản thay thế");
    }

    const persistedSource = await Account.findOneAndUpdate(
      buildConditionalUpdateFilter(sourceAcc.id, sourceExpectedUpdatedAt),
      {
        $set: {
          users: [],
          package2Shelf: CHATGPT_TOTAL_VALUE,
          updatedAt: nowIso,
        },
      },
      { new: true },
    );
    if (!persistedSource) {
      await restoreDocumentSnapshot(Account, replacementAcc.id, replacementSnapshot);
      throw buildConcurrencyError("Tài khoản lỗi");
    }

    let warrantyCase = await DatammoWarrantyCase.findOne({
      provider,
      status: "active",
      currentAccountId: sourceAcc.id,
      orderId,
    });
    const nextRound = {
      sequence: (warrantyCase?.rounds?.length || 0) + 1,
      fromAccountId: sourceAcc.id,
      fromUsername: sourceAcc.username,
      toAccountId: persistedReplacement.id,
      toUsername: persistedReplacement.username,
      reason,
      createdAt: nowIso,
    };

    if (!warrantyCase) {
      warrantyCase = await DatammoWarrantyCase.create({
        provider,
        orderId,
        rootAccountId: sourceAcc.id,
        rootUsername: sourceAcc.username,
        currentAccountId: persistedReplacement.id,
        currentUsername: persistedReplacement.username,
        rounds: [nextRound],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      warrantyCase.rounds = [...(warrantyCase.rounds || []), nextRound];
      warrantyCase.currentAccountId = persistedReplacement.id;
      warrantyCase.currentUsername = persistedReplacement.username;
      warrantyCase.updatedAt = nowIso;
      await warrantyCase.save();
    }

    res.json({
      message: `Đã tạo bảo hành ${getMarketplaceProviderLabel(provider)}`,
      source: persistedSource,
      replacement: persistedReplacement,
      warrantyCase,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post("/api/team/:id/warranty", verifyToken, async (req, res) => {
  try {
    const sourceExpectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.sourceExpectedUpdatedAt || req.body?.expectedUpdatedAt,
    );
    const replacementExpectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.replacementExpectedUpdatedAt,
    );
    const replacementAccountId = String(
      req.body?.replacementAccountId || "",
    ).trim();
    const reason = String(req.body?.reason || "").trim();

    if (!replacementAccountId) {
      return res.status(400).json({ error: "Thieu tai khoan thay the" });
    }

    const sourceAcc = await TeamAccount.findOne({ id: req.params.id });
    const replacementAcc = await TeamAccount.findOne({ id: replacementAccountId });

    if (!sourceAcc || !replacementAcc) {
      return res.status(404).json({ error: "Khong tim thay Team de bao hanh" });
    }
    ensureCurrentVersion(sourceAcc, sourceExpectedUpdatedAt, "Team loi");
    ensureCurrentVersion(
      replacementAcc,
      replacementExpectedUpdatedAt,
      "Team thay the",
    );

    if (sourceAcc.id === replacementAcc.id) {
      return res.status(400).json({
        error: "Tai khoan thay the phai khac tai khoan dang loi",
      });
    }
    if (
      normalizeTeamSaleMode(sourceAcc.saleMode) !== TEAM_SALE_MODE_BUSINESS ||
      normalizeTeamSaleMode(replacementAcc.saleMode) !== TEAM_SALE_MODE_BUSINESS
    ) {
      return res.status(400).json({
        error: "Bao hanh Team chi ap dung cho Business",
      });
    }

    const sourceEntry = findFirstActiveTeamSlotEntry(sourceAcc.slots);
    const sourceSlot = sourceEntry?.slot || null;
    const activeSourceCustomerCount = countActiveTeamCustomers(sourceAcc.slots);
    const hasManagedSourceSlot =
      !!sourceSlot && isDatammoManagedUser({ name: sourceSlot.customerName });
    if (activeSourceCustomerCount > 1) {
      return res.status(400).json({
        error: "Team nay dang co nhieu khach, khong the bao hanh seller tu dong",
      });
    }
    if (activeSourceCustomerCount === 1 && !hasManagedSourceSlot) {
      return res.status(400).json({
        error: "Team nay dang giu khach thuong, khong phai khach seller de bao hanh",
      });
    }
    const sourceManagedInfo = getMarketplaceOrderInfoFromTeamSlot(sourceSlot);
    const fallbackOrder = await findLatestMarketplaceOrderForAccount(
      sourceAcc.id,
      sourceManagedInfo.provider,
      "team",
    );
    const orderId = String(
      sourceManagedInfo.orderId || fallbackOrder?.orderId || "",
    ).trim();
    const provider = normalizeMarketplaceProvider(
      sourceManagedInfo.provider || fallbackOrder?.provider,
    );
    if (!orderId) {
      return res.status(400).json({
        error: "Khong xac dinh duoc order seller cua Team loi",
      });
    }
    const sourceSlotForWarranty = hasManagedSourceSlot
      ? sourceSlot
      : buildManagedTeamCustomer(
          provider,
          orderId,
          sourceSlot?.addedAt || fallbackOrder?.createdAt || new Date(),
        );
    const sourceSlotIndex = Number.isInteger(sourceEntry?.index)
      ? sourceEntry.index
      : -1;

    if (countActiveTeamCustomers(replacementAcc.slots) > 0) {
      return res.status(400).json({
        error: "Team thay the dang co khach, khong the dung de bao hanh",
      });
    }
    if (
      replacementAcc.expiredAt &&
      new Date(replacementAcc.expiredAt).getTime() <= Date.now()
    ) {
      return res.status(400).json({
        error: "Team thay the da het han",
      });
    }

    const replacementMarketplaceOrder = await findLatestMarketplaceOrderForAccount(
      replacementAcc.id,
      "",
      "team",
    );
    if (replacementMarketplaceOrder) {
      return res.status(400).json({
        error: "Team thay the da tung ban tren san, khong the dung de bao hanh",
      });
    }
    const replacementWarrantyCase =
      await findActiveMarketplaceWarrantyCaseForAccount(
        replacementAcc.id,
        "team",
      );
    if (replacementWarrantyCase) {
      return res.status(400).json({
        error: "Team thay the nay dang nam trong mot luong bao hanh khac",
      });
    }

    const replacementSlots = normalizeTeamSlots(replacementAcc.slots);
    const replacementSlotIndex = getAvailableTeamSlotIndices(replacementSlots)[0];
    if (!Number.isInteger(replacementSlotIndex) || replacementSlotIndex < 0) {
      return res.status(400).json({
        error: "Team thay the khong con cho trong de nhan khach",
      });
    }

    const sourceSnapshot = snapshotDocument(sourceAcc);
    const replacementSnapshot = snapshotDocument(replacementAcc);
    const sourceSlots = normalizeTeamSlots(sourceAcc.slots);
    if (sourceSlotIndex >= 0) {
      sourceSlots[sourceSlotIndex] = buildEmptyTeamSlot();
    }
    replacementSlots[replacementSlotIndex] = {
      ...sourceSlotForWarranty,
      status: "active",
      gmail: String(sourceSlotForWarranty.gmail || "").trim(),
      customerName: String(sourceSlotForWarranty.customerName || "").trim(),
      addedAt: String(sourceSlotForWarranty.addedAt || new Date().toISOString()),
      expiredAt: String(sourceSlotForWarranty.expiredAt || ""),
    };
    const nowIso = new Date().toISOString();

    const persistedReplacement = await TeamAccount.findOneAndUpdate(
      buildConditionalUpdateFilter(replacementAcc.id, replacementExpectedUpdatedAt),
      {
        $set: {
          slots: replacementSlots,
          warehouse: TEAM_WAREHOUSE_MARKET,
          updatedAt: nowIso,
        },
      },
      { new: true },
    );
    if (!persistedReplacement) {
      throw buildConcurrencyError("Team thay the");
    }

    const persistedSource = await TeamAccount.findOneAndUpdate(
      buildConditionalUpdateFilter(sourceAcc.id, sourceExpectedUpdatedAt),
      {
        $set: {
          slots: sourceSlots,
          warehouse: TEAM_WAREHOUSE_TOTAL,
          updatedAt: nowIso,
        },
      },
      { new: true },
    );
    if (!persistedSource) {
      await restoreDocumentSnapshot(
        TeamAccount,
        replacementAcc.id,
        replacementSnapshot,
      );
      throw buildConcurrencyError("Team loi");
    }

    let warrantyCase = await DatammoWarrantyCase.findOne({
      scope: "team",
      provider,
      status: "active",
      currentAccountId: sourceAcc.id,
      orderId,
    });
    const nextRound = {
      sequence: (warrantyCase?.rounds?.length || 0) + 1,
      scope: "team",
      itemType: "team_business",
        fromResourceKey: buildMarketplaceResourceKey({
          scope: "team",
          itemType: "team_business",
          accountId: sourceAcc.id,
          slotIndex: sourceSlotIndex,
        }),
        fromAccountId: sourceAcc.id,
        fromUsername: sourceAcc.username,
        fromSlotIndex: sourceSlotIndex,
      toResourceKey: buildMarketplaceResourceKey({
        scope: "team",
        itemType: "team_business",
        accountId: persistedReplacement.id,
        slotIndex: replacementSlotIndex,
      }),
      toAccountId: persistedReplacement.id,
      toUsername: persistedReplacement.username,
      toSlotIndex: replacementSlotIndex,
      reason,
      createdAt: nowIso,
    };

    if (!warrantyCase) {
      warrantyCase = await DatammoWarrantyCase.create({
        scope: "team",
        itemType: "team_business",
        provider,
        orderId,
        rootResourceKey: buildMarketplaceResourceKey({
          scope: "team",
          itemType: "team_business",
          accountId: sourceAcc.id,
          slotIndex: sourceSlotIndex,
        }),
        rootAccountId: sourceAcc.id,
        rootUsername: sourceAcc.username,
        rootSlotIndex: sourceSlotIndex,
        currentResourceKey: buildMarketplaceResourceKey({
          scope: "team",
          itemType: "team_business",
          accountId: persistedReplacement.id,
          slotIndex: replacementSlotIndex,
        }),
        currentAccountId: persistedReplacement.id,
        currentUsername: persistedReplacement.username,
        currentSlotIndex: replacementSlotIndex,
        rounds: [nextRound],
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else {
      warrantyCase.rounds = [...(warrantyCase.rounds || []), nextRound];
      warrantyCase.currentResourceKey = buildMarketplaceResourceKey({
        scope: "team",
        itemType: "team_business",
        accountId: persistedReplacement.id,
        slotIndex: replacementSlotIndex,
      });
      warrantyCase.currentAccountId = persistedReplacement.id;
      warrantyCase.currentUsername = persistedReplacement.username;
      warrantyCase.currentSlotIndex = replacementSlotIndex;
      warrantyCase.updatedAt = nowIso;
      await warrantyCase.save();
    }

    res.json({
      message: `Da tao bao hanh ${getMarketplaceProviderLabel(provider)} cho Team`,
      source: sanitizeTeamAccount(persistedSource?.toObject?.() || persistedSource),
      replacement: sanitizeTeamAccount(
        persistedReplacement?.toObject?.() || persistedReplacement,
      ),
      warrantyCase,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 4.4 TEAM MOVE SLOT
app.post("/api/team-move-slot", verifyToken, async (req, res) => {
  try {
    const {
      fromAccId,
      toAccId,
      slotIndex,
      fromExpectedUpdatedAt,
      toExpectedUpdatedAt,
    } = req.body;

    if (String(fromAccId || "").trim() === String(toAccId || "").trim()) {
      return res.status(400).json({
        error: "Khong the chuyen slot vao chinh Team nguon.",
      });
    }
    const fromAcc = await TeamAccount.findOne({ id: fromAccId });
    const toAcc = await TeamAccount.findOne({ id: toAccId });
    const fromSnapshot = snapshotDocument(fromAcc);
    const toSnapshot = snapshotDocument(toAcc);

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both team accounts not found" });
    }
    ensureCurrentVersion(fromAcc, fromExpectedUpdatedAt, "Team nguồn");
    ensureCurrentVersion(toAcc, toExpectedUpdatedAt, "Team đích");

    if (
      normalizeTeamSaleMode(fromAcc.saleMode) !== TEAM_SALE_MODE_SLOT ||
      normalizeTeamSaleMode(toAcc.saleMode) !== TEAM_SALE_MODE_SLOT
    ) {
      return res.status(400).json({
        error: "Chuyen slot chi ap dung giua cac Team Slot.",
      });
    }

    if (
      normalizeTeamWarehouse(fromAcc.warehouse, TEAM_WAREHOUSE_TOTAL) !==
        TEAM_WAREHOUSE_TOTAL ||
      normalizeTeamWarehouse(toAcc.warehouse, TEAM_WAREHOUSE_TOTAL) !==
        TEAM_WAREHOUSE_TOTAL
    ) {
      return res.status(400).json({
        error: "Chi duoc chuyen slot giua cac Team trong kho tong.",
      });
    }

    if (!fromAcc.slots || !fromAcc.slots[slotIndex] || fromAcc.slots[slotIndex].status === "empty") {
      return res.status(400).json({ error: "Slot not found or is empty in source team account" });
    }

    // STRICT RULE: Cannot transfer to Expired Account
    if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
      return res.status(400).json({
        error: "Team Account đích ĐÃ HẾT HẠN. Không thể chuyển slot vào!",
      });
    }

    if (!toAcc.slots) {
      toAcc.slots = buildEmptyTeamSlots();
    }

    if (
      normalizeTeamSaleMode(toAcc.saleMode) === TEAM_SALE_MODE_BUSINESS &&
      countActiveTeamCustomers(toAcc.slots) >= 1
    ) {
      return res.status(400).json({
        error: "Team Business đích đã có khách rồi (1/1).",
      });
    }

    // Find first empty slot in destination
    const emptySlotIdx = toAcc.slots.findIndex(s => s.status === "empty" || !s.gmail);

    if (emptySlotIdx === -1) {
      return res.status(400).json({ error: "Team Account đích đã đầy (hết 4 slot trống)" });
    }

    // Move slot data stripping mongoose internals
    let slotToMove = fromAcc.slots[slotIndex].toObject ? fromAcc.slots[slotIndex].toObject() : JSON.parse(JSON.stringify(fromAcc.slots[slotIndex]));
    delete slotToMove._id; // prevent duplicate id errors in subdocuments

    // Use atomic $set updates to guarantee Database correctly writes the arrays
    const toMoveResult = await TeamAccount.updateOne(
      buildConditionalUpdateFilter(toAccId, toExpectedUpdatedAt),
      {
        $set: {
          [`slots.${emptySlotIdx}`]: slotToMove,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    if ((toMoveResult.matchedCount || 0) !== 1) {
      return res.status(409).json({
        error:
          "Team đích vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const fromMoveResult = await TeamAccount.updateOne(
      buildConditionalUpdateFilter(fromAccId, fromExpectedUpdatedAt),
      {
        $set: {
          [`slots.${slotIndex}`]: buildEmptyTeamSlot(),
          updatedAt: new Date().toISOString(),
        }
      }
    );
    if ((fromMoveResult.matchedCount || 0) !== 1) {
      await restoreDocumentSnapshot(TeamAccount, toAccId, toSnapshot);
      return res.status(409).json({
        error:
          "Team nguồn vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const updatedFrom = await TeamAccount.findOne({ id: fromAccId });
    const updatedTo = await TeamAccount.findOne({ id: toAccId });
    const [reconciledFrom, reconciledTo] = await Promise.all([
      syncTeamWarehouseStateIfNeeded(updatedFrom),
      syncTeamWarehouseStateIfNeeded(updatedTo),
    ]);

    res.json({
      message: "Team Slot moved successfully",
      from: sanitizeTeamAccount(reconciledFrom?.toObject?.() || reconciledFrom),
      to: sanitizeTeamAccount(reconciledTo?.toObject?.() || reconciledTo),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 4.5 MOVE USER (ATOMIC TRANSFER)
app.post("/api/move-user", verifyToken, async (req, res) => {
  try {
    const {
      fromAccId,
      toAccId,
      userIndex,
      fromExpectedUpdatedAt,
      toExpectedUpdatedAt,
    } = req.body;

    if (String(fromAccId || "").trim() === String(toAccId || "").trim()) {
      return res.status(400).json({
        error: "Khong the chuyen khach vao chinh tai khoan nguon.",
      });
    }

    const fromAcc = await Account.findOne({ id: fromAccId });
    const toAcc = await Account.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both accounts not found" });
    }
    ensureCurrentVersion(fromAcc, fromExpectedUpdatedAt, "Tài khoản nguồn");
    ensureCurrentVersion(toAcc, toExpectedUpdatedAt, "Tài khoản đích");

    if (!fromAcc.users || !fromAcc.users[userIndex]) {
      return res.status(400).json({ error: "User not found in source account" });
    }
    const [decoratedFromAcc, decoratedToAcc] =
      await decorateChatgptAccountsWithOperationalState([
        snapshotDocument(fromAcc),
        snapshotDocument(toAcc),
      ]);
    const safeFromAcc = decoratedFromAcc || snapshotDocument(fromAcc);
    const safeToAcc = decoratedToAcc || snapshotDocument(toAcc);
    const sourceUserToMove = fromAcc.users[userIndex];
    if (
      isDatammoManagedUser(sourceUserToMove) &&
      !isPlaceholderMarketplaceManagedUser(sourceUserToMove)
    ) {
      return res.status(400).json(
        await buildChatgptTraceBlockedResponse(
          fromAccId,
          "Acc da ban qua san khong duoc chuyen khach tay. Neu can doi acc, hay dung Bao hanh.",
        ),
      );
    }
    {
      const resolvedSourceType = String(fromAcc.type || "").trim();
      const destinationDecision = await buildChatgptActionBlockedResponse({
        sourceAccount: safeFromAcc,
        candidateAccount: safeToAcc,
        action: "move_destination",
        options: {
          sourceId: String(fromAccId || "").trim(),
          sourceType: resolvedSourceType,
        },
        fallbackMessage: "Tai khoan dich khong con hop le de chuyen khach vao.",
      });
      if (destinationDecision) {
        return res
          .status(destinationDecision.statusCode)
          .json(destinationDecision.payload);
      }

      const destinationType =
        String(safeToAcc?.type || "unassigned").trim() || "unassigned";
      if (destinationType === "unassigned") {
        toAcc.type = resolvedSourceType;
      }

      const moveUser = fromAcc.users[userIndex];
      const originalFromAcc = JSON.parse(JSON.stringify(fromAcc));
      const originalToAcc = JSON.parse(JSON.stringify(toAcc));

      if (!toAcc.users) toAcc.users = [];
      toAcc.users.push(moveUser);
      fromAcc.users.splice(userIndex, 1);

      if (toAcc.type === "package2" && hasRegularPackage2Customer(toAcc.users)) {
        toAcc.package2Shelf = CHATGPT_TOTAL_VALUE;
      }
      if (
        fromAcc.type === "package2" &&
        (!fromAcc.users || fromAcc.users.length === 0) &&
        hasRegularPackage2Customer(originalFromAcc.users)
      ) {
        fromAcc.package2Shelf = CHATGPT_TOTAL_VALUE;
      }

      const toPersisted = await Account.updateOne(
        buildConditionalUpdateFilter(toAccId, toExpectedUpdatedAt),
        {
          $set: {
            users: toAcc.users || [],
            type: toAcc.type,
            package2Shelf: toAcc.package2Shelf,
            updatedAt: new Date().toISOString(),
          },
        },
      );
      if ((toPersisted.matchedCount || 0) !== 1) {
        return res.status(409).json({
          error:
            "Tai khoan dich vua duoc admin khac cap nhat. Vui long tai lai du lieu roi thu lai.",
        });
      }

      const fromPersisted = await Account.updateOne(
        buildConditionalUpdateFilter(fromAccId, fromExpectedUpdatedAt),
        {
          $set: {
            users: fromAcc.users || [],
            type: fromAcc.type,
            package2Shelf: fromAcc.package2Shelf,
            updatedAt: new Date().toISOString(),
          },
        },
      );
      if ((fromPersisted.matchedCount || 0) !== 1) {
        await restoreDocumentSnapshot(Account, toAccId, originalToAcc);
        return res.status(409).json({
          error:
            "Tai khoan nguon vua duoc admin khac cap nhat. Vui long tai lai du lieu roi thu lai.",
        });
      }

      const persistedFrom = await Account.findOne({ id: fromAccId });
      const persistedTo = await Account.findOne({ id: toAccId });
      return res.json({
        message: "Moved user successfully",
        from: persistedFrom,
        to: persistedTo,
      });
    }
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 4.5.1 MOVE USER FOR SINGLE PLATFORMS (Netflix, Capcut, Canva)
app.post("/api/simple-move-user", verifyToken, async (req, res) => {
  try {
    const {
      fromAccId,
      toAccId,
      platform,
      fromExpectedUpdatedAt,
      toExpectedUpdatedAt,
    } = req.body;

    if (String(fromAccId || "").trim() === String(toAccId || "").trim()) {
      return res.status(400).json({ error: "Khong the chuyen khach vao chinh tai khoan nguon." });
    }

    const Model = platform === "netflix" ? Netflix : platform === "capcut" ? Capcut : platform === "canva" ? Canva : null;
    if (!Model) return res.status(400).json({ error: "Invalid platform" });

    const fromAcc = await Model.findOne({ id: fromAccId });
    const toAcc = await Model.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "Một trong hai tài khoản không tồn tại" });
    }
    ensureCurrentVersion(fromAcc, fromExpectedUpdatedAt, "Tai khoan nguon");
    ensureCurrentVersion(toAcc, toExpectedUpdatedAt, "Tai khoan dich");

    if (!fromAcc.users || fromAcc.users.length === 0) {
      return res.status(400).json({ error: "Không tìm thấy khách trong tài khoản nguồn" });
    }

    // STRICT RULE: Cannot transfer to Expired Account
    if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
      return res.status(400).json({
        error: "Tài khoản đích ĐÃ HẾT HẠN. Không thể chuyển khách vào!",
      });
    }

    if (toAcc.users && toAcc.users.length > 0) {
      return res.status(400).json({ error: "Tài khoản đích ĐÃ CÓ KHÁCH. Không thể chuyển vào!" });
    }

    const userToMove = fromAcc.users[0];
    const fromSnapshot = snapshotDocument(fromAcc);
    const toSnapshot = snapshotDocument(toAcc);

    // BẢO LƯU NGÀY HẾT HẠN CỦA KHÁCH NETFLIX/CAPCUT KHI CHUYỂN
    // Nếu khách chưa có expiredAt cá nhân, họ đang dùng hạn của account cũ (fromAcc)
    // -> Bứng hạn đó dán cố định vào cá nhân họ để qua account mới không bị tăng ngày =))
    if (!userToMove.expiredAt && fromAcc.expiredAt) {
      userToMove.expiredAt = fromAcc.expiredAt;
    }

    const nextToUsers = Array.isArray(toAcc.users)
      ? [...toAcc.users, userToMove]
      : [userToMove];
    const nextFromUsers = (fromAcc.users || []).slice(1);

    const persistedTo = await Model.findOneAndUpdate(
      buildConditionalUpdateFilter(toAccId, toExpectedUpdatedAt),
      {
        $set: {
          users: nextToUsers,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true },
    );
    if (!persistedTo) {
      throw buildConcurrencyError("Tai khoan dich");
    }

    const persistedFrom = await Model.findOneAndUpdate(
      buildConditionalUpdateFilter(fromAccId, fromExpectedUpdatedAt),
      {
        $set: {
          users: nextFromUsers,
          updatedAt: new Date().toISOString(),
        },
      },
      { new: true },
    );
    if (!persistedFrom) {
      await restoreDocumentSnapshot(Model, toAccId, toSnapshot);
      throw buildConcurrencyError("Tai khoan nguon");
    }

    res.json({
      message: "Da chuyen khach thanh cong",
      from: persistedFrom,
      to: persistedTo,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 4.6 EXTEND USER (+ custom DAYS)
app.post("/api/extend-user", verifyToken, async (req, res) => {
  const {
    accId,
    userIndex,
    platform,
    extDays: bodyExtDays,
    extDuration: bodyExtDuration,
    expectedUpdatedAt,
  } = req.body;
  try {
    const Model = platform === "netflix" ? Netflix : platform === "capcut" ? Capcut : platform === "canva" ? Canva : Account;
    const acc = await Model.findOne({ id: accId });
    if (!acc || !acc.users[userIndex])
      return res.status(404).json({ error: "User/Account not found" });
    ensureCurrentVersion(acc, expectedUpdatedAt, "Tai khoan nay");

    const now = new Date();
    const nextUsers = Array.isArray(acc.users)
      ? acc.users.map((item) =>
          item && typeof item.toObject === "function"
            ? item.toObject()
            : JSON.parse(JSON.stringify(item || {})),
        )
      : [];
    const user = nextUsers[userIndex];
    if (!user) {
      return res.status(404).json({ error: "User/Account not found" });
    }

    const defaultDuration =
      platform && platform !== "chatgpt"
        ? normalizeDurationCode(acc.duration)
        : "1M";
    const extDuration = bodyExtDuration
      ? normalizeDurationCode(bodyExtDuration, defaultDuration)
      : normalizeLegacyExtDays(bodyExtDays, defaultDuration);

    // Determine current expiration. If missing, fallback to joinedAt + current duration
    let currentExpiredAt = null;
    if (user.expiredAt) {
      currentExpiredAt = new Date(user.expiredAt);
    } else {
      const joinedAt = user.joinedAt ? new Date(user.joinedAt) : now;
      currentExpiredAt = addDurationToDate(joinedAt, defaultDuration);
    }

    const baseDate =
      currentExpiredAt && currentExpiredAt.getTime() > now.getTime()
        ? currentExpiredAt
        : now;
    user.expiredAt = addDurationToDate(baseDate, extDuration).toISOString();
    user.note =
      (user.note ? user.note + " " : "") +
      `[Extended +${extDuration} on ${now.toLocaleDateString()}]`;

    // markModified để Mongoose detect thay đổi trong subdocument array
    const updated = await Model.findOneAndUpdate(
      buildConditionalUpdateFilter(accId, expectedUpdatedAt),
      {
        $set: {
          users: nextUsers,
          updatedAt: now.toISOString(),
        },
      },
      { new: true },
    );
    if (!updated) {
      throw buildConcurrencyError("Tai khoan nay");
    }
    res.json({
      message: "User extended successfully",
      updatedUser: updated?.users?.[userIndex] || user,
      account: updated,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// ========================
// TEAM CHATGPT ROUTES
// ========================
// GET all team accounts
app.get("/api/team", verifyToken, async (req, res) => {
  try {
    const teams = await TeamAccount.find({}).lean();
    res.json(teams.map((teamAcc) => sanitizeTeamAccount(teamAcc)));
  } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
});

// POST add team account
app.post("/api/team", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const expiredDate = new Date(now);
    expiredDate.setMonth(expiredDate.getMonth() + 1);
    const normalizedBody = normalizeTeamPayload(req.body, {
      defaultSaleMode: true,
      defaultSlots: true,
    });
    const newAcc = {
      id: Date.now().toString(),
      ...normalizedBody,
      createdAt: now.toISOString(),
      expiredAt: normalizedBody.expiredAt || expiredDate.toISOString(),
      updatedAt: now.toISOString(),
    };
    newAcc.slots = normalizeTeamSlots(newAcc.slots);
    assertValidTeamSlotsForSaleMode(newAcc.saleMode, newAcc.slots);
    const created = await TeamAccount.create(newAcc);
    const synced = await syncTeamWarehouseStateIfNeeded(created);
    res.json({
      message: "Added",
      account: sanitizeTeamAccount(synced?.toObject?.() || synced),
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST add team account (Public - for Telegram bot)
const buildPublicTeamAccountPayload = (payload = {}) => {
  const now = new Date();
  const expiredDate = new Date(now);
  expiredDate.setMonth(expiredDate.getMonth() + 1);
  const normalizedBody = normalizeTeamPayload(payload, {
    defaultSaleMode: true,
    defaultSlots: true,
  });
  const newAcc = {
    id: createStoreId("team"),
    ...normalizedBody,
    createdAt: now.toISOString(),
    expiredAt: normalizedBody.expiredAt || expiredDate.toISOString(),
    updatedAt: now.toISOString(),
  };
  newAcc.slots = normalizeTeamSlots(newAcc.slots);
  assertValidTeamSlotsForSaleMode(newAcc.saleMode, newAcc.slots);
  return newAcc;
};
const createPublicTeamAccount = async (payload = {}) => {
  const newAcc = buildPublicTeamAccountPayload(payload);
  const created = await TeamAccount.create(newAcc);
  const synced = await syncTeamWarehouseStateIfNeeded(created);
  return sanitizeTeamAccount(synced?.toObject?.() || synced);
};
app.post("/api/team-public", verifyBotInternalToken, async (req, res) => {
  try {
    const synced = await createPublicTeamAccount(req.body);
    res.json({
      message: "Added",
      account: synced,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

app.post("/api/team-public/bulk", verifyBotInternalToken, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      return res.status(400).json({ error: "Thieu danh sach Team account." });
    }

    const successes = [];
    const errors = [];
    for (let index = 0; index < rawItems.length; index += 1) {
      const item = rawItems[index] || {};
      const lineNumber = Number(item?.lineNumber || index + 1);
      try {
        const account = await createPublicTeamAccount({
          username: item.username || item.email || "",
          password: item.password || "",
          otpSecret: item.otpSecret || "",
          recoveryUrl: item.recoveryUrl || "",
          note: item.note || "",
          saleMode: "business",
          expiredAt: item.expiredAt || undefined,
        });
        successes.push({
          lineNumber,
          kind: "team",
          username: String(account?.username || item?.username || item?.email || "").trim(),
        });
      } catch (error) {
        errors.push({
          lineNumber,
          kind: "team",
          username: String(item?.username || item?.email || "").trim(),
          reason: error.message || "Khong the them team account",
        });
      }
    }

    return res.json({
      success: true,
      summary: {
        total: rawItems.length,
        successCount: successes.length,
        errorCount: errors.length,
      },
      successes,
      errors,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || "Khong the import hang loat Team.",
    });
  }
});

// PUT update team account (including slot management)
app.put("/api/team/:id", verifyToken, async (req, res) => {
  try {
    const existing = await TeamAccount.findOne({ id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Team account not found" });
    }
    const expectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.expectedUpdatedAt,
    );
    ensureCurrentVersion(existing, expectedUpdatedAt, "Team account nay");
    const updatePayload = normalizeTeamPayload(req.body, {
      defaultSaleMode: existing.saleMode,
      defaultWarehouse: existing.warehouse,
    });
    if (updatePayload.slots !== undefined) {
      updatePayload.slots = normalizeTeamSlots(updatePayload.slots);
    }
    const nextSaleMode =
      updatePayload.saleMode !== undefined
        ? updatePayload.saleMode
        : existing.saleMode;
    const nextSlots =
      updatePayload.slots !== undefined ? updatePayload.slots : existing.slots;
    if (
      updatePayload.saleMode !== undefined ||
      updatePayload.slots !== undefined
    ) {
      assertValidTeamSlotsForSaleMode(nextSaleMode, nextSlots);
    }

    const currentWarehouse = normalizeTeamWarehouse(
      existing.warehouse,
      TEAM_WAREHOUSE_TOTAL,
    );
    const nextWarehouse =
      updatePayload.warehouse !== undefined
        ? normalizeTeamWarehouse(updatePayload.warehouse, currentWarehouse)
        : currentWarehouse;
    if (
      nextWarehouse !== currentWarehouse &&
      countActiveTeamCustomers(existing.slots) > 0
    ) {
      return res.status(400).json({
        error:
          "Team dang co khach. Vui long xoa hoac chuyen khach truoc khi doi kho.",
      });
    }
    if (
      [TEAM_WAREHOUSE_MARKET, TEAM_WAREHOUSE_SHORT].includes(nextWarehouse) &&
      normalizeTeamSaleMode(nextSaleMode) !== TEAM_SALE_MODE_BUSINESS
    ) {
      return res.status(400).json({
        error:
          nextWarehouse === TEAM_WAREHOUSE_MARKET
            ? "Kho market Team chi dung cho Business. Slot Team admin tu them theo don."
            : "Kho duoi 25 ngay chi dung cho Team Business.",
      });
    }
    if (
      updatePayload.saleMode !== undefined &&
      normalizeTeamSaleMode(updatePayload.saleMode) !==
        normalizeTeamSaleMode(existing.saleMode) &&
      currentWarehouse !== TEAM_WAREHOUSE_TOTAL
    ) {
      return res.status(400).json({
        error:
          "Team ngoai kho tong khong duoc doi qua Slot/Business. Hay dua ve kho tong truoc.",
      });
    }
    if (
      updatePayload.saleMode !== undefined &&
      normalizeTeamSaleMode(updatePayload.saleMode) !==
        normalizeTeamSaleMode(existing.saleMode) &&
      countActiveTeamCustomers(existing.slots) > 0
    ) {
      return res.status(400).json({
        error:
          "Team dang co khach. Vui long xoa hoac chuyen het khach truoc khi doi giua Business va Slot.",
      });
    }

    const updated = await TeamAccount.findOneAndUpdate(
      buildConditionalUpdateFilter(req.params.id, expectedUpdatedAt),
      withFreshUpdatedAt(updatePayload),
      { new: true },
    );
    if (!updated) {
      return res.status(409).json({
        error:
          "Team account nay vua duoc admin khac cap nhat. Vui long tai lai du lieu roi thu lai.",
      });
    }
    const reconciled = await syncTeamWarehouseStateIfNeeded(updated);
    res.json({
      message: "Updated",
      account: sanitizeTeamAccount(reconciled?.toObject?.() || reconciled),
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// DELETE team account
app.delete("/api/team/:id", verifyToken, async (req, res) => {
  try {
    const expectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.expectedUpdatedAt || req.query?.expectedUpdatedAt,
    );
    const existing = await TeamAccount.findOneAndDelete(
      buildConditionalUpdateFilter(req.params.id, expectedUpdatedAt),
    );
    if (!existing && expectedUpdatedAt) {
      return res.status(409).json({
        error:
          "Team account nay vua duoc admin khac cap nhat. Vui long tai lai du lieu roi thu lai.",
      });
    }
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SINGLE USER ROUTES (Netflix, Canva, Capcut)
const makeSingleUserRoutes = (router, Model, platformRoute) => {
  router.post(`/api/${platformRoute}`, verifyToken, async (req, res) => {
    try {
      const now = new Date();
      const newAcc = {
        id: Date.now().toString(),
        ...req.body,
        users: req.body.users || [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      await Model.create(newAcc);
      res.json({ message: "Added successfully", account: newAcc });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.put(`/api/${platformRoute}/:id`, verifyToken, async (req, res) => {
    try {
      if (req.body.users !== undefined && req.body.users.length > 1) {
        return res.status(400).json({ error: `${platformRoute} chỉ được 1 khách hàng` });
      }
      const expectedUpdatedAt = getExpectedUpdatedAtValue(
        req.body?.expectedUpdatedAt,
      );
      const payload = { ...(req.body || {}) };
      delete payload.expectedUpdatedAt;
      const updated = await Model.findOneAndUpdate(
        buildConditionalUpdateFilter(req.params.id, expectedUpdatedAt),
        withFreshUpdatedAt(payload),
        { new: true },
      );
      if (!updated && expectedUpdatedAt) {
        return res.status(409).json({
          error:
            "Tài khoản này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
        });
      }
      res.json({ message: "Updated successfully", account: updated });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
  });

  router.delete(`/api/${platformRoute}/:id`, verifyToken, async (req, res) => {
    try {
      const expectedUpdatedAt = getExpectedUpdatedAtValue(
        req.body?.expectedUpdatedAt || req.query?.expectedUpdatedAt,
      );
      const deleted = await Model.findOneAndDelete(
        buildConditionalUpdateFilter(req.params.id, expectedUpdatedAt),
      );
      if (!deleted && expectedUpdatedAt) {
        return res.status(409).json({
          error:
            "Tài khoản này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
        });
      }
      res.json({ message: "Deleted successfully" });
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
  });
};

makeSingleUserRoutes(app, Netflix, "netflix");
makeSingleUserRoutes(app, Canva, "canva");
makeSingleUserRoutes(app, Capcut, "capcut");

// 5. PROXY GOOGLE SHEET
app.post("/api/proxy-sheet", verifyAdminOrBotInternalToken, async (req, res) => {
  try {
    const { scriptUrl, sheetName, data } = req.body;
    const response = await axios.post(
      scriptUrl,
      { sheetName, data },
      { headers: { "Content-Type": "application/json" }, maxRedirects: 5 },
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: "Lỗi khi gửi dữ liệu sang Google Sheet" });
  }
});

// 6. LOGIN ENDPOINT (Secure authentication with 7-day expiry)
app.post("/api/login", loginRateLimit, async (req, res) => {
  try {
    const identifier = String(
      req.body?.identifier || req.body?.email || req.body?.phone || "",
    ).trim();
    const password = String(req.body?.password || "");

    // Get credentials from environment variables
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

    console.log("Login attempt:", {
      identifier,
      hasPassword: !!password,
      envEmail: ADMIN_EMAIL,
    });

    if (identifier === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      // Generate token with 7-day expiry
      const now = Date.now();
      const expiryTime = now + 7 * 24 * 60 * 60 * 1000; // 7 days
      const token = Buffer.from(`${now}_${expiryTime}_${identifier}`).toString(
        "base64",
      );

      res.json({
        success: true,
        role: "admin",
        token,
        expiresAt: new Date(expiryTime).toISOString(),
        message: "Login successful. Token expires in 7 days.",
      });
      return;
    }

    const emailLower = normalizeEmailLower(identifier);
    const phoneNormalized = normalizePhoneValue(identifier);
    const storeUser = await StoreUser.findOne({
      $or: [{ emailLower }, ...(phoneNormalized ? [{ phoneNormalized }] : [])],
    });

    if (storeUser?.passwordHash) {
      const isMatch = await bcrypt.compare(password, storeUser.passwordHash);
      if (isMatch) {
        return res.json({
          success: true,
          role: "user",
          token: issueStoreUserJwt(storeUser),
          user: sanitizeStoreUser(storeUser),
          redirectTo: "/store",
          message: "Đăng nhập user thành công",
        });
      }
    }

    console.log("Login failed: Invalid credentials");
    res.status(401).json({
      success: false,
      message: "Email/SĐT hoặc mật khẩu không đúng",
    });
  } catch (error) {
    console.error("Login error:", error);
    res
      .status(500)
      .json({ success: false, message: "Login error", error: error.message });
  }
});

// 7. TELEGRAM WEBHOOK
const telegramWebhook = require("./telegram-webhook");
app.post("/api/telegram-webhook", verifyTelegramWebhookSecret, telegramWebhook);

// Helper for Vercel
module.exports = app;




