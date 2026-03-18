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
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI, MONGO_CONNECT_OPTIONS);
    isConnected = true;
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
  const updated = await TeamAccount.findOneAndUpdate(
    { id: account.id },
    {
      $set: {
        warehouse: nextWarehouse,
        updatedAt: new Date().toISOString(),
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
  await TeamAccount.updateMany(
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
        updatedAt: new Date().toISOString(),
      },
    },
  );
  await TeamAccount.updateMany(
    {
      warehouse: TEAM_WAREHOUSE_MARKET,
      expiredAt: { $lte: minExpiredAt },
    },
    {
      $set: {
        warehouse: TEAM_WAREHOUSE_TOTAL,
        updatedAt: new Date().toISOString(),
      },
    },
  );
  await TeamAccount.updateMany(
    {
      warehouse: TEAM_WAREHOUSE_SHORT,
      saleMode: { $ne: TEAM_SALE_MODE_BUSINESS },
    },
    {
      $set: {
        warehouse: TEAM_WAREHOUSE_TOTAL,
        updatedAt: new Date().toISOString(),
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
  scope = "chatgpt",
  provider,
  orderId,
  shelf,
  quantity,
  claimed,
}) => {
  await DatammoOrder.create({
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
const buildTeamBusinessDeliveryLine = (acc = {}) =>
  `${String(acc.username || "").trim()}|${String(acc.password || "").trim()}|${String(
    acc.recoveryUrl || "",
  ).trim()}`;
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
const claimTeamBusinessAccountsForOrder = async ({ quantity, orderId, provider }) => {
  const claimed = [];
  for (let i = 0; i < quantity; i += 1) {
    let reserved = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const oldAcc = await TeamAccount.findOne({
        saleMode: TEAM_SALE_MODE_BUSINESS,
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
// ---------------------------

app.get("/api/data", verifyToken, async (req, res) => {
  try {
    await reconcileChatgptMarketInventory();
    await reconcileTeamMarketInventory();
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
    await reconcileTeamMarketInventory();
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

app.get(
  ["/api/datammo/team/stock", "/api/datammo/team/stock/:mode"],
  verifyDatammoPartnerToken,
  async (req, res) => {
    try {
      await reconcileTeamMarketInventory();
      const saleMode = resolveTeamMarketplaceModeFromReq(req);
      if (!saleMode) {
        return res.status(400).json({
          success: false,
          message: "Missing team mode",
        });
      }
      const payload = await buildTeamMarketplaceStockPayload(saleMode);
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
    const quantity = getSafeBuyQuantity(req.query?.quantity);
    const orderId = String(
      req.query?.order_id || req.query?.orderId || `dm_team_${Date.now()}`,
    ).trim();
    let claimed = [];
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
        await reconcileTeamMarketInventory();
        const saleMode = resolveTeamMarketplaceModeFromReq(req);
        if (!saleMode) {
          return res.status(400).json({
            success: false,
            message: "Missing team mode",
          });
        }
        const payload = await buildTeamMarketplaceStockPayload(saleMode);
        return res.json({
          success: true,
          status: true,
          result: true,
          stock: payload.stock,
          amount: payload.stock,
          quantity: payload.stock,
          sum: payload.stock,
          price: 0,
          amount_money: 0,
        });
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
        data: ["preview_team|preview_pass|preview_link"],
        accounts: ["preview_team|preview_pass|preview_link"],
      });
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
    const sourceManagedInfo = getMarketplaceOrderInfoFromTeamSlot(sourceSlot);
    if (!sourceSlot || !isDatammoManagedUser({ name: sourceSlot.customerName })) {
      return res.status(400).json({
        error: "Team nay khong phai acc seller dang giu khach de bao hanh",
      });
    }

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

    const replacementWarehouse = normalizeTeamWarehouse(
      replacementAcc.warehouse,
      TEAM_WAREHOUSE_TOTAL,
    );
    if (
      ![TEAM_WAREHOUSE_TOTAL, TEAM_WAREHOUSE_MARKET].includes(
        replacementWarehouse,
      )
    ) {
      return res.status(400).json({
        error: "Team thay the phai nam trong kho tong hoac kho market",
      });
    }

    const activeCaseConflict = await DatammoWarrantyCase.findOne({
      scope: "team",
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
    sourceSlots[sourceEntry.index] = buildEmptyTeamSlot();
    replacementSlots[replacementSlotIndex] = {
      ...sourceSlot,
      status: "active",
      gmail: String(sourceSlot.gmail || "").trim(),
      customerName: String(sourceSlot.customerName || "").trim(),
      addedAt: String(sourceSlot.addedAt || new Date().toISOString()),
      expiredAt: String(sourceSlot.expiredAt || ""),
    };
    const nowIso = new Date().toISOString();

    const persistedReplacement = await TeamAccount.findOneAndUpdate(
      buildConditionalUpdateFilter(replacementAcc.id, replacementExpectedUpdatedAt),
      {
        $set: {
          slots: replacementSlots,
          warehouse: TEAM_WAREHOUSE_TOTAL,
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
        slotIndex: sourceEntry.index,
      }),
      fromAccountId: sourceAcc.id,
      fromUsername: sourceAcc.username,
      fromSlotIndex: sourceEntry.index,
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
          slotIndex: sourceEntry.index,
        }),
        rootAccountId: sourceAcc.id,
        rootUsername: sourceAcc.username,
        rootSlotIndex: sourceEntry.index,
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
    const sourceWarehouse = normalizePackage2Shelf(
      fromAcc.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    );
    const destinationWarehouse = normalizePackage2Shelf(
      toAcc.package2Shelf,
      CHATGPT_TOTAL_VALUE,
    );

    if (
      destinationWarehouse !== CHATGPT_TOTAL_VALUE &&
      destinationWarehouse !== sourceWarehouse
    ) {
      return res.status(400).json({
        error:
          "Chi duoc chuyen khach sang tai khoan cung kho voi tai khoan nguon hoac ve kho tong.",
      });
    }

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




