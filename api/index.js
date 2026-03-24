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
  otpSecret: { type: String, default: "" },
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
const StoreUser =
  mongoose.models.StoreUser ||
  mongoose.model("StoreUser", storeUserSchema, "store_users");

const storeOrderSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  userId: { type: String, required: true, index: true },
  packageCode: { type: String, required: true, index: true },
  packageName: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "pending", index: true },
  paymentMethod: { type: String, default: "momo" },
  momoOrderId: { type: String, default: "", index: true },
  momoRequestId: { type: String, default: "" },
  momoTransId: { type: String, default: "" },
  momoResultCode: { type: Number, default: null },
  momoMessage: { type: String, default: "" },
  momoPayUrl: { type: String, default: "" },
  assignedAccountId: { type: String, default: "" },
  assignedUsername: { type: String, default: "" },
  assignedPassword: { type: String, default: "" },
  assignedOtpSecret: { type: String, default: "" },
  assignedLink: { type: String, default: "" },
  assignedType: { type: String, default: "" },
  assignedWarehouse: { type: String, default: "" },
  package1AccessToken: { type: String, default: "" },
  package1MaxUsage: { type: Number, default: 3 },
  package1UsedCount: { type: Number, default: 0 },
  package1LastCodeAt: { type: String, default: "" },
  package1LastCode: { type: String, default: "" },
  fulfilledAt: { type: String, default: "" },
  paidAt: { type: String, default: "" },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() },
});
const StoreOrder =
  mongoose.models.StoreOrder ||
  mongoose.model("StoreOrder", storeOrderSchema, "store_orders");

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

const DEFAULT_STORE_CONTACT_ZALO_URL = "https://zalo.me/0345440153";

app.get("/api/store/config", async (req, res) => {
  try {
    const packages = await buildStoreCatalog();
    res.json({
      packages,
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
    });
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
    const orders = await StoreOrder.find({ userId: req.storeUser.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      user: sanitizeStoreUser(req.storeUser),
      orders: orders.map((order) => sanitizeStoreOrder(order)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được tài khoản" });
  }
});

app.get("/api/store/orders", verifyStoreUserToken, async (req, res) => {
  try {
    const orders = await StoreOrder.find({ userId: req.storeUser.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ orders: orders.map((order) => sanitizeStoreOrder(order)) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được đơn hàng" });
  }
});

app.get("/api/store/orders/:id", verifyStoreUserToken, async (req, res) => {
  try {
    const order = await StoreOrder.findOne({
      id: String(req.params?.id || "").trim(),
      userId: req.storeUser.id,
    }).lean();
    if (!order) {
      return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
    }
    res.json({ order: sanitizeStoreOrder(order) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Không tải được đơn hàng" });
  }
});

app.post("/api/store/orders/payment", verifyStoreUserToken, async (req, res) => {
  try {
    const packageCode = String(req.body?.packageCode || "").trim().toLowerCase();
    const packageConfig = STORE_PACKAGE_MAP[packageCode];
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
      order: sanitizeStoreOrder(freshOrder),
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
      order.status = "paid";
      order.paidAt = new Date().toISOString();
      await order.save();
      await fulfillStoreOrder(order);
    } else {
      order.status = "payment_failed";
      await order.save();
    }
    return res.json({ resultCode: 0, message: "OK" });
  } catch (error) {
    console.error("Store MoMo IPN error:", error?.message || error);
    return res.status(500).json({ resultCode: 1, message: "server error" });
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
const MOMO_ENDPOINT =
  process.env.MOMO_ENDPOINT || "https://test-payment.momo.vn/v2/gateway/api/create";
const MOMO_REQUEST_TYPE = process.env.MOMO_REQUEST_TYPE || "captureWallet";
const GOOGLE_OAUTH_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const googleOAuthClient = GOOGLE_OAUTH_CLIENT_ID
  ? new OAuth2Client(GOOGLE_OAUTH_CLIENT_ID)
  : null;
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
const createRandomHexToken = (size = 24) =>
  crypto.randomBytes(size).toString("hex");
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
const sanitizeStoreUser = (user) => {
  if (!user) return null;
  return {
    id: String(user.id || ""),
    fullName: String(user.fullName || ""),
    phone: String(user.phone || ""),
    email: String(user.email || ""),
    createdAt: String(user.createdAt || ""),
  };
};
const buildStorePackage1UsageLeft = (order = {}) =>
  Math.max(
    0,
    Number(order?.package1MaxUsage || STORE_PACKAGE1_MAX_OTP_USES) -
      Number(order?.package1UsedCount || 0),
  );
const sanitizeStoreOrder = (order) => {
  if (!order) return null;
  const packageCode = String(order.packageCode || "");
  const base = {
    id: String(order.id || ""),
    packageCode,
    packageName:
      String(order.packageName || STORE_PACKAGE_MAP[packageCode]?.name || ""),
    amount: Number(order.amount || 0),
    status: String(order.status || "pending"),
    paymentMethod: String(order.paymentMethod || "momo"),
    momoOrderId: String(order.momoOrderId || ""),
    momoTransId: String(order.momoTransId || ""),
    momoResultCode:
      order.momoResultCode === null || order.momoResultCode === undefined
        ? null
        : Number(order.momoResultCode),
    momoMessage: String(order.momoMessage || ""),
    createdAt: String(order.createdAt || ""),
    updatedAt: String(order.updatedAt || ""),
    paidAt: String(order.paidAt || ""),
    fulfilledAt: String(order.fulfilledAt || ""),
  };
  if (packageCode === "package1") {
    return {
      ...base,
      package1AccessToken: String(order.package1AccessToken || ""),
      package1UsedCount: Number(order.package1UsedCount || 0),
      package1UsageLeft: buildStorePackage1UsageLeft(order),
      assignedUsername: String(order.assignedUsername || ""),
    };
  }
  if (packageCode === "package2") {
    return {
      ...base,
      assignedUsername: String(order.assignedUsername || ""),
      assignedPassword: String(order.assignedPassword || ""),
      assignedOtpSecret: String(order.assignedOtpSecret || ""),
      assignedLink: String(order.assignedLink || ""),
      assignedType: String(order.assignedType || ""),
    };
  }
  return base;
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
const buildStoreTotalMinExpiredAtIso = () =>
  new Date(Date.now() + STORE_TOTAL_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString();
const buildStorePackage1ExistingFilter = (excludeIds = []) => ({
  type: "package1",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $lt: [{ $size: { $ifNull: ["$users", []] } }, 3],
  },
});
const buildStorePackage1ConvertibleFilter = (excludeIds = []) => ({
  type: "unassigned",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: { $ifNull: ["$users", []] } }, 0],
  },
});
const buildStorePackage2ConvertibleFilter = (excludeIds = []) => ({
  type: "unassigned",
  package2Shelf: CHATGPT_TOTAL_VALUE,
  expiredAt: { $gt: buildStoreTotalMinExpiredAtIso() },
  ...(Array.isArray(excludeIds) && excludeIds.length > 0
    ? { id: { $nin: excludeIds } }
    : {}),
  $expr: {
    $eq: [{ $size: { $ifNull: ["$users", []] } }, 0],
  },
});
const getBusyChatgptAccountIdsForStoreOrders = async () => {
  const activeCases = await DatammoWarrantyCase.find({
    scope: "chatgpt",
    status: "active",
  })
    .select("rootAccountId currentAccountId")
    .lean();
  const ids = new Set();
  activeCases.forEach((item) => {
    const rootId = String(item?.rootAccountId || "").trim();
    const currentId = String(item?.currentAccountId || "").trim();
    if (rootId) ids.add(rootId);
    if (currentId) ids.add(currentId);
  });
  return Array.from(ids);
};
const countStorePackage1Stock = async () => {
  const excludeIds = await getBusyChatgptAccountIdsForStoreOrders();
  const [sharedAccounts, convertibleCount] = await Promise.all([
    Account.find(buildStorePackage1ExistingFilter(excludeIds))
      .select("users")
      .lean(),
    Account.countDocuments(buildStorePackage1ConvertibleFilter(excludeIds)),
  ]);
  const freeSharedSlots = sharedAccounts.reduce((sum, acc) => {
    const used = Array.isArray(acc?.users) ? acc.users.length : 0;
    return sum + Math.max(0, 3 - used);
  }, 0);
  return freeSharedSlots + convertibleCount * 3;
};
const countStorePackage2Stock = async () => {
  const excludeIds = await getBusyChatgptAccountIdsForStoreOrders();
  return Account.countDocuments(buildStorePackage2ConvertibleFilter(excludeIds));
};
const buildStoreCatalog = async () => {
  const [package1Stock, package2Stock] = await Promise.all([
    countStorePackage1Stock(),
    countStorePackage2Stock(),
  ]);
  return [
    {
      ...STORE_PACKAGE_MAP.package1,
      available: package1Stock,
      purchasable: package1Stock > 0,
    },
    {
      ...STORE_PACKAGE_MAP.package2,
      available: package2Stock,
      purchasable: package2Stock > 0,
    },
    {
      ...STORE_PACKAGE_MAP.package3,
      available: null,
      purchasable: false,
    },
  ];
};
const claimStorePackage1AccountForOrder = async ({ order, user }) => {
  const excludeIds = await getBusyChatgptAccountIdsForStoreOrders();
  const customer = buildStoreCustomerRecord(user);
  let oldAcc = await Account.findOneAndUpdate(
    buildStorePackage1ExistingFilter(excludeIds),
    {
      $push: { users: customer },
      $set: { updatedAt: new Date().toISOString() },
    },
    {
      sort: { createdAt: 1, id: 1 },
      new: false,
    },
  );
  let convertedFromUnassigned = false;
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
      {
        sort: { createdAt: 1, id: 1 },
        new: false,
      },
    );
    convertedFromUnassigned = !!oldAcc;
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
  };
};
const claimStorePackage2AccountForOrder = async ({ order, user }) => {
  const excludeIds = await getBusyChatgptAccountIdsForStoreOrders();
  const customer = buildStoreCustomerRecord(user);
  const oldAcc = await Account.findOneAndUpdate(
    buildStorePackage2ConvertibleFilter(excludeIds),
    {
      $set: {
        type: "package2",
        users: [customer],
        updatedAt: new Date().toISOString(),
      },
    },
    {
      sort: { createdAt: 1, id: 1 },
      new: false,
    },
  );
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
  };
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
};
const fulfillStoreOrder = async (order) => {
  const safeOrder =
    typeof order?.toObject === "function" ? order.toObject() : { ...(order || {}) };
  if (!safeOrder?.id) {
    throw new Error("Đơn hàng không hợp lệ");
  }
  if (String(safeOrder.status || "").trim().toLowerCase() === "fulfilled") {
    return StoreOrder.findOne({ id: safeOrder.id });
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
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
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
            assignedPassword: String(claim?.updatedAcc?.password || ""),
            assignedOtpSecret: String(claim?.updatedAcc?.otpSecret || ""),
            assignedLink: String(claim?.updatedAcc?.link || ""),
            assignedType: String(claim?.updatedAcc?.type || ""),
            assignedWarehouse: CHATGPT_TOTAL_VALUE,
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
          momoMessage: error.message || "Fulfillment error",
          updatedAt: new Date().toISOString(),
        },
      },
    );
    throw error;
  }
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
        momoRequestId: requestId,
        momoPayUrl: String(data.payUrl || "").trim(),
        updatedAt: new Date().toISOString(),
      },
    },
  );
  return String(data.payUrl || "").trim();
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
        await reconcileChatgptMarketInventory();
        const stock = await Account.countDocuments(buildPackage2SaleFilter());
        return res.json({ sum: stock });
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
        await reconcileTeamMarketInventory();
        const saleMode = resolveTeamMarketplaceModeFromReq(req);
        if (!saleMode) {
          return res.status(400).json({
            success: false,
            message: "Missing team mode",
          });
        }
        const payload = await buildTeamMarketplaceStockPayload(saleMode);
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

    // ===== BACKEND GUARD: Chặn đổi gói khi đang có khách =====
    if (normalizedPayload.type && normalizedPayload.type !== existingAcc.type) {
      if (trackedMarketplaceOrder) {
        return res.status(400).json({
          error:
            "Acc da ban qua san khong duoc doi goi tay. Neu can doi acc, hay dung Bao hanh.",
        });
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
      return res.status(400).json({
        error:
          "Acc da ban qua san khong duoc doi kho tay. Neu can doi acc, hay dung Bao hanh.",
      });
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
    } = req.body;

    if (String(fromAccId || "").trim() === String(toAccId || "").trim()) {
      return res.status(400).json({
        error: "Khong the chuyen slot vao chinh Team nguon.",
      });
    }
    const fromExpectedUpdatedAt = "";
    const toExpectedUpdatedAt = "";

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
      { id: toAccId },
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
      { id: fromAccId },
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
    const destinationMarketplaceOrder =
      await findLatestMarketplaceOrderForAccount(toAccId, "", "chatgpt");
    const sourceUserToMove = fromAcc.users[userIndex];
    if (
      (isDatammoManagedUser(sourceUserToMove) &&
        !isPlaceholderMarketplaceManagedUser(sourceUserToMove)) ||
      destinationMarketplaceOrder
    ) {
      return res.status(400).json({
        error:
          "Acc da ban qua san khong duoc chuyen khach tay. Neu can doi acc, hay dung Bao hanh.",
      });
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
      { id: toAccId },
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
          "Tài khoản đích vừa được admin khác cập nhật. Vui lòng tải lại dữ liệu rồi thử lại.",
      });
    }

    const fromPersisted = await Account.updateOne(
      { id: fromAccId },
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
      { id: toAccId },
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
      { id: fromAccId },
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
app.post("/api/telegram-webhook", telegramWebhook);

// Helper for Vercel
module.exports = app;




