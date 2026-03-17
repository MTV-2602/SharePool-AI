const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const mongoose = require("mongoose");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- MONGODB CONNECTION ---
// Cache connection to avoid reconnecting on every request (Vercel specific)
let isConnected = false;
let didCleanupLegacyTeamEmailPassword = false;
let didCleanupLegacyChatgptMarketKeys = false;
let didMigrateLegacyCollections = false;
let didNormalizeLegacyDatammoCustomers = false;
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
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI, MONGO_CONNECT_OPTIONS);
    isConnected = true;
    await migrateLegacyCollectionsIfNeeded();
    await normalizeLegacyDatammoCustomersIfNeeded();
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
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
};

// Define Schema
const accountSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  type: { type: String, default: "unassigned" },
  package2Shelf: { type: String, default: "none" },
  users: [{ name: String, joinedAt: String, expiredAt: String }],
  note: String,
  link: String,
  status: { type: String, default: "available" },
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
  recoveryUrl: { type: String, default: "" },   // Link recovery
  saleMode: { type: String, default: "slot" },  // "slot" | "business"
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
    accountId: { type: String, default: "" },
    username: { type: String, default: "" },
    delivery: { type: String, default: "" },
  },
  { _id: false },
);
const datammoOrderSchema = new mongoose.Schema({
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
    fromAccountId: { type: String, default: "" },
    fromUsername: { type: String, default: "" },
    toAccountId: { type: String, default: "" },
    toUsername: { type: String, default: "" },
    reason: { type: String, default: "" },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  { _id: false },
);
const datammoWarrantyCaseSchema = new mongoose.Schema({
  provider: { type: String, default: "datammo", index: true },
  orderId: { type: String, default: "", index: true },
  rootAccountId: { type: String, default: "" },
  rootUsername: { type: String, default: "" },
  currentAccountId: { type: String, default: "", index: true },
  currentUsername: { type: String, default: "" },
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

// Middleware to ensure DB is connected before processing
app.use(async (req, res, next) => {
  await connectDB();
  next();
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

// --- DATA VERSION + OPTIONAL SSE (serverless-friendly) ---
const ENABLE_SSE = process.env.ENABLE_SSE === "true";
let sseClients = [];
let latestDataVersion = Date.now();

const bumpDataVersion = () => {
  latestDataVersion = Date.now();
};

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
      }
    });
  }
  next();
});

// --- API ROUTES ---

// TEST ENDPOINT
app.get("/api/test", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    env: {
      hasMongoUri: !!process.env.MONGO_URI,
      hasAdminEmail: !!process.env.ADMIN_EMAIL,
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      adminEmail: process.env.ADMIN_EMAIL || "NOT SET",
    },
  });
});

// 1. GET ALL DATA (Protected - requires token)

// --- DATAMMO INTEGRATION ---
const DATAMMO_URL = "https://datammo.com/api/v1/products/748e605c-d400-4c44-a958-0525494c700b/inventory";
const DATAMMO_TOKEN = "sk_1773222055913_er0acsx8dyj";
const SHOPMINI_PRIVATE_API_TOKEN =
  process.env.SHOPMINI_PRIVATE_API_TOKEN || "537e6b485382ed5f7c71f3dfd0a6be23";
const DATAMMO_VARIANT_PKG2 = "98ed02c7-d28b-4287-945e-bdfb24a09397";
const DATAMMO_VARIANT_PKG2_CHEAP = "b5449604-4fce-4edf-89d3-d4400d0f34a6";
const DATAMMO_VARIANT_PKG3 = "5e3567bc-ada4-471d-b93b-725a0735b677";
const DATAMMO_VARIANT_TEAM_BUSINESS = "8851247b-72de-4c31-ac84-470cb97abb0e";

const TEAM_SALE_MODE_SLOT = "slot";
const TEAM_SALE_MODE_BUSINESS = "business";
const VALID_TEAM_SALE_MODES = [TEAM_SALE_MODE_SLOT, TEAM_SALE_MODE_BUSINESS];
const VALID_DURATION_CODES = ["1M", "2M", "3M", "6M", "1Y"];
const normalizeTeamSaleMode = (value, fallback = TEAM_SALE_MODE_SLOT) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (VALID_TEAM_SALE_MODES.includes(normalized)) return normalized;
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
const normalizeTeamPayload = (payload = {}, options = {}) => {
  const normalized = { ...(payload || {}) };
  delete normalized.emailPassword;
  delete normalized.expectedUpdatedAt;
  if (normalized.username !== undefined) {
    normalized.username = String(normalized.username || "").trim();
  }
  if (normalized.password !== undefined) {
    normalized.password = String(normalized.password || "").trim();
  }
  if (normalized.recoveryUrl !== undefined) {
    normalized.recoveryUrl = String(normalized.recoveryUrl || "").trim();
  }
  if (normalized.note !== undefined) {
    normalized.note = String(normalized.note || "");
  }
  if (normalized.saleMode !== undefined || options.defaultSaleMode) {
    normalized.saleMode = normalizeTeamSaleMode(normalized.saleMode);
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
  return normalized;
};
const sanitizeTeamAccount = (account = {}) => {
  if (!account) return account;
  const { emailPassword, ...rest } = account;
  return {
    ...rest,
    saleMode: normalizeTeamSaleMode(rest.saleMode),
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

const getDatammoInventoryUrl = (line) => line?.inventoryUrl || DATAMMO_URL;
const getDatammoLineKey = (line) =>
  `${getDatammoInventoryUrl(line)}||${line.variantId}||${line.content}`;
const DATAMMO_MIN_REQUEST_GAP_MS = toPositiveInt(
  process.env.DATAMMO_MIN_REQUEST_GAP_MS,
  1200,
);
const DATAMMO_RATE_LIMIT_RETRIES = toPositiveInt(
  process.env.DATAMMO_RATE_LIMIT_RETRIES,
  6,
);
const DATAMMO_RATE_LIMIT_BASE_DELAY_MS = toPositiveInt(
  process.env.DATAMMO_RATE_LIMIT_BASE_DELAY_MS,
  1200,
);
let datammoRequestQueue = Promise.resolve();
let datammoNextRequestAt = 0;
const waitMs = (ms) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
const getDatammoErrorText = (err) => {
  const responseData = err?.response?.data;
  if (typeof responseData === "string") return responseData;
  if (responseData) return JSON.stringify(responseData);
  return String(err?.message || "");
};
const isDatammoRateLimitError = (err) => {
  const status = Number(err?.response?.status || err?.status || 0);
  if (status === 429) return true;
  const text = getDatammoErrorText(err).toLowerCase();
  return (
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("try again later")
  );
};
const enqueueDatammoRequest = async (fn) => {
  const run = async () => {
    const now = Date.now();
    const waitFor = Math.max(0, datammoNextRequestAt - now);
    if (waitFor > 0) await waitMs(waitFor);
    datammoNextRequestAt = Date.now() + DATAMMO_MIN_REQUEST_GAP_MS;
    return fn();
  };
  const task = datammoRequestQueue.then(run, run);
  datammoRequestQueue = task.catch(() => undefined);
  return task;
};
const postDatammo = async (
  url,
  payload,
  options = {},
) => {
  const maxRetries = Math.max(
    0,
    Number.isFinite(Number(options.maxRetries))
      ? Number(options.maxRetries)
      : DATAMMO_RATE_LIMIT_RETRIES,
  );
  let attempt = 0;
  while (true) {
    try {
      return await enqueueDatammoRequest(() =>
        axios.post(url, payload, {
          headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` },
        }),
      );
    } catch (err) {
      if (!isDatammoRateLimitError(err) || attempt >= maxRetries) {
        throw err;
      }
      const backoff = Math.min(
        DATAMMO_RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
        20000,
      );
      const jitter = Math.floor(Math.random() * 250);
      await waitMs(backoff + jitter);
      attempt += 1;
    }
  }
};
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
const isChatgptMarketAccount = (acc = {}) =>
  supportsChatgptMarket(acc?.type) &&
  normalizePackage2Shelf(acc?.package2Shelf, CHATGPT_TOTAL_VALUE) ===
    CHATGPT_MARKET_VALUE;
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
  const currentValue = normalizePackage2Shelf(
    acc?.package2Shelf,
    CHATGPT_TOTAL_VALUE,
  );
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
  const updated = await Account.findOneAndUpdate(
    { id: acc.id },
    {
      $set: {
        package2Shelf: nextWarehouse,
        updatedAt: new Date().toISOString(),
      },
    },
    { new: true },
  );
  return updated || acc;
};
const reconcileChatgptMarketInventory = async () => {
  const minExpiredAt = new Date(
    Date.now() + PACKAGE2_MIN_DAYS_FOR_SALE * 24 * 60 * 60 * 1000,
  ).toISOString();
  await Account.updateMany(
    {
      type: { $in: CHATGPT_MARKET_SUPPORTED_TYPES },
      package2Shelf: CHATGPT_MARKET_VALUE,
      expiredAt: { $lte: minExpiredAt },
      "users.0": { $exists: false },
    },
    {
      $set: {
        package2Shelf: CHATGPT_TOTAL_VALUE,
        updatedAt: new Date().toISOString(),
      },
    },
  );
};
const normalizeMarketplaceProvider = (value, fallback = "datammo") => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "shopmini") return "shopmini";
  if (raw === "datammo") return "datammo";
  return fallback;
};
const getMarketplaceProviderLabel = (value) =>
  normalizeMarketplaceProvider(value) === "shopmini" ? "Shopmini" : "Datammo";
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
const findLatestMarketplaceOrderForAccount = async (accountId, provider = "") => {
  const normalizedId = String(accountId || "").trim();
  if (!normalizedId) return null;
  const filter = { "accounts.accountId": normalizedId };
  const normalizedProvider = normalizeMarketplaceProvider(provider, "");
  if (normalizedProvider) {
    filter.provider = normalizedProvider;
  }
  const latestOrder = await DatammoOrder.findOne(filter)
    .sort({ createdAt: -1 })
    .lean();
  return latestOrder || null;
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
const formatPackage2DeliveryLine = (acc) =>
  `${acc.username}|${acc.password}${acc.link ? `|${acc.link}` : ""}`;
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
const logMarketplaceOrder = async ({
  provider,
  orderId,
  shelf,
  quantity,
  claimed,
}) => {
  await DatammoOrder.create({
    provider: normalizeMarketplaceProvider(provider),
    orderId,
    shelf: shelf || "market",
    quantity,
    accounts: (Array.isArray(claimed) ? claimed : []).map((item) => ({
      accountId: String(item?.updatedAcc?.id || item?.oldAcc?.id || ""),
      username: String(item?.updatedAcc?.username || item?.oldAcc?.username || ""),
      delivery: String(item?.delivery || ""),
    })),
  });
};

const normalizeChatgptPayload = (payload = {}, existingAcc = null) => {
  const normalized = { ...payload };
  delete normalized.expectedUpdatedAt;
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

  return normalized;
};
const buildTeamBusinessDatammoContent = (acc = {}) =>
  `${String(acc.username || "").trim()}|${String(acc.password || "").trim()}|${String(
    acc.recoveryUrl || "",
  ).trim()}`;
const buildTeamSlotDatammoContent = (acc = {}, slotNum = 1) =>
  `Slot ${slotNum}|${String(acc.username || "").trim()}|Bạn gửi kèm gmail chính chủ để admin up`;
const buildTeamDatammoLines = (acc, options = {}) => {
  if (!acc || acc.slots === undefined) return [];
  const includeAllSlots = options.includeAllSlots === true;
  const includeBusiness = options.includeBusiness === true;
  const saleMode = normalizeTeamSaleMode(acc.saleMode);
  const teamSlots = normalizeTeamSlots(acc.slots);
  const lines = [];
  const datammoBusinessContent = buildTeamBusinessDatammoContent(acc);
  const businessContent = `${String(acc.username || "").trim()}|${String(
    acc.password || "",
  ).trim()}|${String(acc.recoveryUrl || "").trim()}`;
  const slotContent = (slotNum) =>
    `Slot ${slotNum}|${acc.username}|Báº¡n gá»­i kÃ¨m gmail chÃ­nh chá»§ Ä‘á»ƒ admin up`;

  if (includeBusiness || saleMode === TEAM_SALE_MODE_BUSINESS) {
    const activeSlots = teamSlots.filter(
      (slot) => slot.status !== "empty" && !!slot.gmail,
    ).length;
    if (includeBusiness || activeSlots === 0) {
      lines.push({
        variantId: DATAMMO_VARIANT_TEAM_BUSINESS,
        content: datammoBusinessContent,
      });
    }
  }

  if (!includeAllSlots && saleMode === TEAM_SALE_MODE_BUSINESS) {
    return lines;
  }

  for (let i = 1; i <= 4; i += 1) {
    const slot = teamSlots[i - 1];
    if (includeAllSlots || slot?.status === "empty" || !slot?.gmail) {
      lines.push({
        variantId: DATAMMO_VARIANT_PKG3,
        content: buildTeamSlotDatammoContent(acc, i),
      });
    }
  }

  return lines;
};
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

const getDatammoLines = (acc) => {
  if (!acc || acc.slots === undefined) return [];
  const lines = [];
  const teamSaleMode = normalizeTeamSaleMode(acc.saleMode);
  const teamSlots = normalizeTeamSlots(acc.slots);

  if (teamSaleMode === TEAM_SALE_MODE_BUSINESS) {
    const activeSlots = teamSlots.filter(
      (slot) => slot.status !== "empty" && !!slot.gmail,
    ).length;
    if (activeSlots === 0) {
      lines.push({
        variantId: DATAMMO_VARIANT_TEAM_BUSINESS,
        content: buildTeamBusinessDatammoContent(acc),
      });
    }
    return lines;
  }

  teamSlots.forEach((slot, index) => {
    if (slot.status === "empty" || !slot.gmail) {
      lines.push({
        variantId: DATAMMO_VARIANT_PKG3,
        content: buildTeamSlotDatammoContent(acc, index + 1),
      });
    }
  });

  return lines;
};

const syncDatammoUpdate = async (oldAcc, newAcc, options = {}) => {
  const forceTeamResync = options.forceTeamResync === true;
  const strictDatammoSync =
    options.strictDatammoSync === true || options.throwOnSyncError === true;
  const isTeamContext =
    oldAcc?.slots !== undefined || newAcc?.slots !== undefined;

  if (!isTeamContext) {
    return {
      toDelete: 0,
      toAdd: 0,
      failed: 0,
      syncErrors: [],
      skipped: true,
    };
  }

  const syncErrors = [];
  const recordSyncError = (stage, item, inventoryUrl, errorValue) => {
    const errorText =
      typeof errorValue === "string"
        ? errorValue
        : JSON.stringify(errorValue || "unknown error");
    syncErrors.push({
      stage,
      inventoryUrl: inventoryUrl || getDatammoInventoryUrl(item),
      variantId: item?.variantId || "",
      content: item?.content || "",
      error: errorText,
    });
  };

  const rawOldLines = getDatammoLines(oldAcc);
  const newLines = getDatammoLines(newAcc);

  let toDelete = [];
  let toAdd = [];

  if (forceTeamResync) {
    const deleteMap = new Map();
    [
      ...buildTeamDatammoLines(oldAcc, {
        includeAllSlots: true,
        includeBusiness: true,
      }),
      ...buildTeamDatammoLines(newAcc, {
        includeAllSlots: true,
        includeBusiness: true,
      }),
    ].forEach((line) => {
      deleteMap.set(getDatammoLineKey(line), line);
    });
    toDelete = Array.from(deleteMap.values());
    toAdd = newLines;
  } else {
    const newLineKeys = new Set(newLines.map(getDatammoLineKey));
    const oldLineKeys = new Set(rawOldLines.map(getDatammoLineKey));

    toDelete = rawOldLines.filter(
      (oldLine) => !newLineKeys.has(getDatammoLineKey(oldLine)),
    );
    toAdd = newLines.filter(
      (newLine) => !oldLineKeys.has(getDatammoLineKey(newLine)),
    );
  }

  for (const item of toDelete) {
    const inventoryUrl = getDatammoInventoryUrl(item);
    try {
      await postDatammo(
        `${inventoryUrl}/delete`,
        { variantId: item.variantId, content: item.content },
      );
      console.log("Datammo DELETE synced:", item.content, "=>", inventoryUrl);
    } catch (err) {
      const deleteErr = err?.response?.data || err.message;
      recordSyncError("delete", item, inventoryUrl, deleteErr);
      console.error("Datammo DELETE err:", deleteErr);
    }
  }

  for (const item of toAdd) {
    const inventoryUrl = getDatammoInventoryUrl(item);
    try {
      await postDatammo(
        inventoryUrl,
        { variantId: item.variantId, content: item.content },
      );
      console.log("Datammo ADD synced:", item.content, "=>", inventoryUrl);
    } catch (err) {
      const addErr = err?.response?.data || err.message;
      recordSyncError("add", item, inventoryUrl, addErr);
      console.error("Datammo ADD err:", addErr);
    }
  }

  if (strictDatammoSync && syncErrors.length > 0) {
    const syncError = new Error(
      `Datammo sync failed for ${syncErrors.length} item(s)`,
    );
    syncError.code = "DATAMMO_SYNC_FAILED";
    syncError.syncErrors = syncErrors;
    throw syncError;
  }

  return {
    toDelete: toDelete.length,
    toAdd: toAdd.length,
    failed: syncErrors.length,
    syncErrors,
  };
};
const datammoSyncLocks = new Map();
const getDatammoSyncLockKey = (oldAcc, newAcc) =>
  String(newAcc?.id || oldAcc?.id || "global");
const syncDatammoUpdateLocked = async (oldAcc, newAcc, options = {}) => {
  const lockKey = getDatammoSyncLockKey(oldAcc, newAcc);
  const previous = datammoSyncLocks.get(lockKey) || Promise.resolve();
  let releaseCurrent = null;
  const current = new Promise((resolve) => {
    releaseCurrent = resolve;
  });
  const chain = previous.then(() => current);
  datammoSyncLocks.set(lockKey, chain);

  await previous;
  try {
    return await syncDatammoUpdate(oldAcc, newAcc, options);
  } finally {
    if (releaseCurrent) releaseCurrent();
    if (datammoSyncLocks.get(lockKey) === chain) {
      datammoSyncLocks.delete(lockKey);
    }
  }
};
// ---------------------------

app.get("/api/data", verifyToken, async (req, res) => {
  try {
    await reconcileChatgptMarketInventory();
    const [
      accounts,
      netflixAccs,
      canvaAccs,
      capcutAccs,
      teamAccs,
      datammoOrders,
      datammoWarrantyCases,
    ] = await Promise.all([
      Account.find({}).lean(),
      Netflix.find({}).lean(),
      Canva.find({}).lean(),
      Capcut.find({}).lean(),
      TeamAccount.find({}).lean(),
      DatammoOrder.find({}).sort({ createdAt: -1 }).limit(100).lean(),
      DatammoWarrantyCase.find({}).sort({ updatedAt: -1 }).limit(100).lean(),
    ]);
    res.json({
      chatgpt: accounts.map((acc) => ({
        ...acc,
        package2Shelf: normalizePackage2Shelf(
          acc?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
      })),
      netflix: netflixAccs,
      canva: canvaAccs,
      capcut: capcutAccs,
      team: teamAccs.map((teamAcc) => sanitizeTeamAccount(teamAcc)),
      datammoOrders,
      datammoWarrantyCases,
      version: latestDataVersion,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// 1.5 GET ALL DATA (Public - for Telegram bot)
app.get("/api/data-public", async (req, res) => {
  try {
    await reconcileChatgptMarketInventory();
    const accounts = await Account.find({}).lean();
    res.json({
      chatgpt: accounts.map((acc) => ({
        ...acc,
        package2Shelf: normalizePackage2Shelf(
          acc?.package2Shelf,
          CHATGPT_TOTAL_VALUE,
        ),
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Datammo Partner Standard: GET stock
app.get(
  ["/api/datammo/stock", "/api/datammo/stock/:shelf"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    try {
      await reconcileChatgptMarketInventory();
      const stock = await Account.countDocuments(buildPackage2SaleFilter());
      const mainPrice = Number(process.env.DATAMMO_PACKAGE2_MAIN_PRICE || 0);
      const cheapPrice = Number(process.env.DATAMMO_PACKAGE2_CHEAP_PRICE || 0);
      const selectedPrice = cheapPrice > 0 ? cheapPrice : mainPrice;

      const payload = { stock };
      if (Number.isFinite(selectedPrice) && selectedPrice > 0) {
        payload.price = selectedPrice;
      }

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
    const quantity = getSafeBuyQuantity(req.query?.quantity);
    const orderId = String(
      req.query?.order_id || req.query?.orderId || `dm_${Date.now()}`,
    );

    let claimed = [];
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
        await reconcileChatgptMarketInventory();
        const stock = await Account.countDocuments(buildPackage2SaleFilter());
        const mainPrice = Number(process.env.DATAMMO_PACKAGE2_MAIN_PRICE || 0);
        const cheapPrice = Number(process.env.DATAMMO_PACKAGE2_CHEAP_PRICE || 0);
        const selectedPrice = cheapPrice > 0 ? cheapPrice : mainPrice;
        const payload = {
          success: true,
          status: true,
          result: true,
          stock,
          amount: stock,
          quantity: stock,
          sum: stock,
          price: Number.isFinite(selectedPrice) ? selectedPrice : 0,
          amount_money: Number.isFinite(selectedPrice) ? selectedPrice : 0,
        };
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
      return res.json({
        success: true,
        status: true,
        result: true,
        msg: "preview-success",
        data: ["preview_user|preview_pass|preview_link"],
        accounts: ["preview_user|preview_pass|preview_link"],
      });
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

      return res.json({
        success: true,
        status: true,
        result: true,
        msg: "success",
        data: claimed.map((item) => item.delivery),
        accounts: claimed.map((item) => item.delivery),
      });
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
app.post("/api/chatgpt-public", async (req, res) => {
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

// 3. UPDATE ACCOUNT
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
    ensureCurrentVersion(existingAcc, expectedUpdatedAt, "Tai khoan nay");

    // Validate package2: chỉ được tối đa 1 khách hàng
    const normalizedPayload = normalizeChatgptPayload(req.body, existingAcc);
    const targetType = normalizedPayload.type || existingAcc.type;

    if (normalizedPayload.users !== undefined) {
      if (targetType === "package2" && normalizedPayload.users.length > 1) {
        return res.status(400).json({ error: "Gói Private (Gói 2) chỉ được tối đa 1 khách hàng" });
      }
    }

    // ===== BACKEND GUARD: Chặn đổi gói khi đang có khách =====
    if (normalizedPayload.type && normalizedPayload.type !== existingAcc.type) {
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
    const updatedShelf = normalizePackage2Shelf(
      normalizedPayload.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    );
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
      return res.json({ message: "Updated", account: updated, syncSkipped: true });
    }

    res.json({ message: "Updated", account: updated });
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

    if (!sourceAcc || !replacementAcc) {
      return res.status(404).json({ error: "Không tìm thấy tài khoản bảo hành" });
    }
    ensureCurrentVersion(sourceAcc, sourceExpectedUpdatedAt, "Tài khoản lỗi");
    ensureCurrentVersion(
      replacementAcc,
      replacementExpectedUpdatedAt,
      "Tài khoản thay thế",
    );

    if (sourceAcc.id === replacementAcc.id) {
      return res.status(400).json({
        error: "Tài khoản thay thế phải khác tài khoản đang lỗi",
      });
    }
    if (sourceAcc.type !== "package2" || replacementAcc.type !== "package2") {
      return res.status(400).json({
        error: "Bảo hành hiện chỉ hỗ trợ tài khoản seller gói 2",
      });
    }

    const sourceUsers = Array.isArray(sourceAcc.users) ? sourceAcc.users : [];
    const sourceUser = sourceUsers[0];
    const sourceManagedInfo = getMarketplaceOrderInfoFromUser(sourceUser);
    if (sourceUsers.length !== 1 || !isDatammoManagedUser(sourceUser)) {
      return res.status(400).json({
        error: "Tài khoản này không phải acc seller đang giữ khách để bảo hành",
      });
    }

    const fallbackOrder = await findLatestMarketplaceOrderForAccount(
      sourceAcc.id,
      sourceManagedInfo.provider,
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

    if (
      normalizePackage2Shelf(
        replacementAcc.package2Shelf,
        CHATGPT_TOTAL_VALUE,
      ) === CHATGPT_MARKET_VALUE
    ) {
      return res.status(400).json({
        error: "Tai khoan thay the phai nam trong kho tong",
      });
    }

    const activeCaseConflict = await DatammoWarrantyCase.findOne({
      status: "active",
      $or: [
        { rootAccountId: replacementAcc.id },
        { currentAccountId: replacementAcc.id },
        { "rounds.fromAccountId": replacementAcc.id },
        { "rounds.toAccountId": replacementAcc.id },
      ],
    }).lean();
    if (activeCaseConflict) {
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
          users: sourceUsers,
          package2Shelf: CHATGPT_TOTAL_VALUE,
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

    const fromAcc = await TeamAccount.findOne({ id: fromAccId });
    const toAcc = await TeamAccount.findOne({ id: toAccId });
    const fromSnapshot = snapshotDocument(fromAcc);
    const toSnapshot = snapshotDocument(toAcc);

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both team accounts not found" });
    }
    ensureCurrentVersion(fromAcc, fromExpectedUpdatedAt, "Team nguồn");
    ensureCurrentVersion(toAcc, toExpectedUpdatedAt, "Team đích");

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
      buildConditionalUpdateFilter(toAccId, toAcc.updatedAt),
      {
        $set: {
          [`slots.${emptySlotIdx}`]: slotToMove,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    if (toMoveResult.modifiedCount !== 1) {
      return res.status(409).json({
        error:
          "Team đích vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const fromMoveResult = await TeamAccount.updateOne(
      buildConditionalUpdateFilter(fromAccId, fromAcc.updatedAt),
      {
        $set: {
          [`slots.${slotIndex}`]: buildEmptyTeamSlot(),
          updatedAt: new Date().toISOString(),
        }
      }
    );
    if (fromMoveResult.modifiedCount !== 1) {
      await restoreDocumentSnapshot(TeamAccount, toAccId, toSnapshot);
      return res.status(409).json({
        error:
          "Team nguồn vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const updatedFrom = await TeamAccount.findOne({ id: fromAccId });
    const updatedTo = await TeamAccount.findOne({ id: toAccId });
    const syncOptions = {
      strictDatammoSync: true,
      forceTeamResync: true,
    };
    try {
      await Promise.all([
        syncDatammoUpdateLocked(fromAcc, updatedFrom, syncOptions),
        syncDatammoUpdateLocked(toAcc, updatedTo, syncOptions),
      ]);
    } catch (syncError) {
      const [rolledBackFrom, rolledBackTo] = await Promise.all([
        restoreDocumentSnapshot(TeamAccount, fromAccId, fromSnapshot),
        restoreDocumentSnapshot(TeamAccount, toAccId, toSnapshot),
      ]);
      try {
        await Promise.all([
          rolledBackFrom
            ? syncDatammoUpdateLocked(updatedFrom, rolledBackFrom, syncOptions)
            : Promise.resolve(),
          rolledBackTo
            ? syncDatammoUpdateLocked(updatedTo, rolledBackTo, syncOptions)
            : Promise.resolve(),
        ]);
      } catch (rollbackSyncError) {
        console.error(
          "Datammo rollback sync error (team move slot):",
          rollbackSyncError?.syncErrors ||
            rollbackSyncError?.response?.data ||
            rollbackSyncError?.message ||
            rollbackSyncError,
        );
      }
      throw syncError;
    }

    res.json({ message: "Team Slot moved successfully", from: updatedFrom, to: updatedTo });
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

    // STRICT RULE: Cannot transfer to Expired Account
    if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
      return res.status(400).json({
        error: "Tài khoản đích ĐÃ HẾT HẠN. Không thể chuyển khách vào!",
      });
    }

    const sourceType = fromAcc.type; // Loại gói nguồn
    const currentUsers = toAcc.users?.length || 0;

    if (toAcc.type === sourceType) {
      // Cùng loại gói: kiểm tra slot
      if (sourceType === "package1" && currentUsers >= 3) {
        return res.status(400).json({ error: "Tài khoản Shared đích đã đầy (3/3)" });
      }
      if (sourceType === "package2" && currentUsers >= 1) {
        return res.status(400).json({ error: "Tài khoản Private đích đã có người dùng (1/1)" });
      }
    } else if (toAcc.type === "unassigned") {
      // Đích là unassigned: tự động đổi type sang loại của nguồn
      if (sourceType === "package2" && currentUsers >= 1) {
        return res.status(400).json({ error: "Tài khoản đích đã có người dùng" });
      }
      if (sourceType === "package1" && currentUsers >= 3) {
        return res.status(400).json({ error: "Tài khoản đích đã đầy slot" });
      }
      // Tự động đổi type của tài khoản đích theo loại nguồn
      toAcc.type = sourceType;
    } else {
      // Khác loại và không phải unassigned -> từ chối
      const typeLabel = sourceType === "package1" ? "Chia Sẻ" : "Private";
      return res.status(400).json({
        error: `Chỉ được chuyển vào gói cùng loại (${typeLabel}) hoặc tài khoản chưa phân loại`,
      });
    }

    const userToMove = fromAcc.users[userIndex];

    // Tạo bản sao trước khi Move để Datammo Check
    const originalFromAcc = JSON.parse(JSON.stringify(fromAcc));
    const originalToAcc = JSON.parse(JSON.stringify(toAcc));

    if (!toAcc.users) toAcc.users = [];
    toAcc.users.push(userToMove);
    fromAcc.users.splice(userIndex, 1);

    if (toAcc.type === "package2") {
      if (hasRegularPackage2Customer(toAcc.users)) {
        toAcc.package2Shelf = CHATGPT_TOTAL_VALUE;
      }
    }
    if (fromAcc.type === "package2" && (!fromAcc.users || fromAcc.users.length === 0)) {
      if (hasRegularPackage2Customer(originalFromAcc.users)) {
        fromAcc.package2Shelf = CHATGPT_TOTAL_VALUE;
      }
    }

    const toPersisted = await Account.updateOne(
      buildConditionalUpdateFilter(toAccId, originalToAcc.updatedAt),
      {
        $set: {
          users: toAcc.users || [],
          type: toAcc.type,
          package2Shelf: toAcc.package2Shelf,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    if (toPersisted.modifiedCount !== 1) {
      return res.status(409).json({
        error:
          "Tài khoản đích vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const fromPersisted = await Account.updateOne(
      buildConditionalUpdateFilter(fromAccId, originalFromAcc.updatedAt),
      {
        $set: {
          users: fromAcc.users || [],
          type: fromAcc.type,
          package2Shelf: fromAcc.package2Shelf,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    if (fromPersisted.modifiedCount !== 1) {
      await restoreDocumentSnapshot(Account, toAccId, originalToAcc);
      return res.status(409).json({
        error:
          "Tài khoản nguồn vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const persistedFrom = await Account.findOne({ id: fromAccId });
    const persistedTo = await Account.findOne({ id: toAccId });
    res.json({ message: "Moved user successfully", from: persistedFrom, to: persistedTo });
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
      buildConditionalUpdateFilter(toAccId, toSnapshot?.updatedAt),
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
      buildConditionalUpdateFilter(fromAccId, fromSnapshot?.updatedAt),
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

    const user = acc.users[userIndex];
    const now = new Date();

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
    acc.markModified("users");
    acc.updatedAt = now.toISOString();
    await acc.save();
    res.json({ message: "User extended successfully", updatedUser: user });
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
    await TeamAccount.create(newAcc);
    await syncDatammoUpdateLocked(null, newAcc);
    res.json({ message: "Added", account: sanitizeTeamAccount(newAcc) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST add team account (Public - for Telegram bot)
app.post("/api/team-public", async (req, res) => {
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
    await TeamAccount.create(newAcc);
    await syncDatammoUpdateLocked(null, newAcc);
    res.json({ message: "Added", account: sanitizeTeamAccount(newAcc) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
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
    ensureCurrentVersion(existing, expectedUpdatedAt, "Team account này");
    const existingSnapshot = snapshotDocument(existing);
    const updatePayload = normalizeTeamPayload(req.body);
    if (updatePayload.slots !== undefined) {
      updatePayload.slots = normalizeTeamSlots(updatePayload.slots);
    }
    const nextSaleMode =
      updatePayload.saleMode !== undefined
        ? updatePayload.saleMode
        : existing.saleMode;
    const nextSlots =
      updatePayload.slots !== undefined ? updatePayload.slots : existing.slots;
    if (updatePayload.saleMode !== undefined || updatePayload.slots !== undefined) {
      assertValidTeamSlotsForSaleMode(nextSaleMode, nextSlots);
    }
    const updated = await TeamAccount.findOneAndUpdate(
      buildConditionalUpdateFilter(req.params.id, expectedUpdatedAt),
      withFreshUpdatedAt(updatePayload),
      { new: true },
    );
    if (!updated) {
      return res.status(409).json({
        error:
          "Team account này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }
    const syncOptions = {
      strictDatammoSync: true,
      forceTeamResync:
        req.body?.slots !== undefined ||
        req.body?.saleMode !== undefined ||
        req.body?.username !== undefined ||
        req.body?.password !== undefined ||
        req.body?.recoveryUrl !== undefined,
    };
    try {
      await syncDatammoUpdateLocked(existing, updated, syncOptions);
    } catch (syncError) {
      const rolledBack = await restoreDocumentSnapshot(
        TeamAccount,
        req.params.id,
        existingSnapshot,
      );
      if (rolledBack) {
        try {
          await syncDatammoUpdateLocked(updated, rolledBack, syncOptions);
        } catch (rollbackSyncError) {
          console.error(
            "Datammo rollback sync error (team update):",
            rollbackSyncError?.syncErrors ||
              rollbackSyncError?.response?.data ||
              rollbackSyncError?.message ||
              rollbackSyncError,
          );
        }
      }
      throw syncError;
    }
    res.json({
      message: "Updated",
      account: sanitizeTeamAccount(updated?.toObject?.() || updated),
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
          "Team account này vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }
    if (existing) await syncDatammoUpdateLocked(existing, null);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/team/:id/resync-datammo", verifyToken, async (req, res) => {
  try {
    const expectedUpdatedAt = getExpectedUpdatedAtValue(
      req.body?.expectedUpdatedAt,
    );
    const existing = await TeamAccount.findOne({ id: req.params.id });
    if (!existing) {
      return res.status(404).json({ error: "Team account not found" });
    }
    ensureCurrentVersion(existing, expectedUpdatedAt, "Team account nay");

    await syncDatammoUpdateLocked(existing, existing, {
      forceTeamResync: true,
      strictDatammoSync: true,
    });

    res.json({
      message: "Resynced Datammo",
      account: sanitizeTeamAccount(existing?.toObject?.() || existing),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
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
app.post("/api/proxy-sheet", async (req, res) => {
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
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get credentials from environment variables
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

    console.log("Login attempt:", {
      email,
      hasPassword: !!password,
      envEmail: ADMIN_EMAIL,
    });

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      // Generate token with 7-day expiry
      const now = Date.now();
      const expiryTime = now + 7 * 24 * 60 * 60 * 1000; // 7 days
      const token = Buffer.from(`${now}_${expiryTime}_${email}`).toString(
        "base64",
      );

      res.json({
        success: true,
        token,
        expiresAt: new Date(expiryTime).toISOString(),
        message: "Login successful. Token expires in 7 days.",
      });
    } else {
      console.log("Login failed: Invalid credentials");
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res
      .status(500)
      .json({ success: false, message: "Login error", error: error.message });
  }
});

// 7. TELEGRAM WEBHOOK
const telegramWebhook = require("./telegram-webhook");
app.post("/api/telegram-webhook", telegramWebhook);

// Helper for Vercel
module.exports = app;




