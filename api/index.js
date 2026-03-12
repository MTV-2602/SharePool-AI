const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const mongoose = require("mongoose");

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// --- MONGODB CONNECTION ---
// Cache connection to avoid reconnecting on every request (Vercel specific)
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB Connected via Vercel");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
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
});
const Account =
  mongoose.models.Account || mongoose.model("Account", accountSchema);

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
});
const Netflix = mongoose.models.Netflix || mongoose.model("Netflix", singleUserSchema);
const Canva = mongoose.models.Canva || mongoose.model("Canva", singleUserSchema);
const Capcut = mongoose.models.Capcut || mongoose.model("Capcut", singleUserSchema);

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
  emailPassword: { type: String, default: "" }, // Mật khẩu email
  recoveryUrl: { type: String, default: "" },   // Link recovery
  note: { type: String, default: "" },
  slots: { type: [teamSlotSchema], default: () => Array(4).fill(null).map(() => ({ status: "empty" })) },
  createdAt: { type: String },
  expiredAt: { type: String },
});
const TeamAccount = mongoose.models.TeamAccount || mongoose.model("TeamAccount", teamAccountSchema);

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

// --- SSE CONNECTIONS FOR REAL-TIME SYNC ---
let sseClients = [];
const notifyClients = () => {
  sseClients.forEach(client => {
    try {
      client.res.write(`data: ${JSON.stringify({ type: 'DATA_UPDATED' })}\n\n`);
    } catch (err) {
      console.error("SSE Error:", err);
    }
  });
};

app.get('/api/events', (req, res) => {
  // We do not enforce verifyToken here strictly to allow easy connection, 
  // but it's safe since it only sends the string "DATA_UPDATED" and no actual data.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.push(client);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== client.id);
  });
});

// Interceptor to automatically notify clients on any data change
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
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
const DATAMMO_CHEAP_URL = "https://datammo.com/api/v1/products/746e1bbd-b625-41c5-8e62-2ef160bc0cf8/inventory";
const DATAMMO_TOKEN = "sk_1773222055913_er0acsx8dyj";
const DATAMMO_VARIANT_PKG1 = "3dbd0d98-5ed5-4044-9557-8d8a902da45f";
const DATAMMO_VARIANT_PKG2 = "98ed02c7-d28b-4287-945e-bdfb24a09397";
const DATAMMO_VARIANT_PKG2_CHEAP = "b5449604-4fce-4edf-89d3-d4400d0f34a6";
const DATAMMO_VARIANT_PKG3 = "5e3567bc-ada4-471d-b93b-725a0735b677";

const PACKAGE2_SHELF_MAIN = "main";
const PACKAGE2_SHELF_CHEAP = "cheap";
const PACKAGE2_SHELF_NONE = "none";
const VALID_PACKAGE2_SHELVES = [
  PACKAGE2_SHELF_MAIN,
  PACKAGE2_SHELF_CHEAP,
  PACKAGE2_SHELF_NONE,
];

const DATAMMO_PKG2_SHELVES = {
  [PACKAGE2_SHELF_MAIN]: {
    inventoryUrl: DATAMMO_URL,
    variantId: DATAMMO_VARIANT_PKG2,
  },
  [PACKAGE2_SHELF_CHEAP]: {
    inventoryUrl: DATAMMO_CHEAP_URL,
    variantId: DATAMMO_VARIANT_PKG2_CHEAP,
  },
};

const getDatammoInventoryUrl = (line) => line?.inventoryUrl || DATAMMO_URL;
const getDatammoLineKey = (line) =>
  `${getDatammoInventoryUrl(line)}||${line.variantId}||${line.content}`;
const getDatammoPrimaryKey = (line) => {
  const content = String(line?.content || "");
  const key = content.split("|")[0]?.trim();
  return key || "";
};
const isPackage2DatammoVariant = (variantId) =>
  variantId === DATAMMO_VARIANT_PKG2 ||
  variantId === DATAMMO_VARIANT_PKG2_CHEAP;

const normalizePackage2Shelf = (shelf, fallback = PACKAGE2_SHELF_MAIN) => {
  if (VALID_PACKAGE2_SHELVES.includes(shelf)) return shelf;
  return fallback;
};

const getPackage2ShelfTargets = (acc, includeAllPackage2Shelves = false) => {
  const allShelves = Object.values(DATAMMO_PKG2_SHELVES).filter(
    (item) => item?.inventoryUrl && item?.variantId,
  );
  if (includeAllPackage2Shelves) return allShelves;

  const selectedShelf = normalizePackage2Shelf(
    acc?.package2Shelf,
    PACKAGE2_SHELF_MAIN,
  );
  if (selectedShelf === PACKAGE2_SHELF_NONE) return [];

  const target = DATAMMO_PKG2_SHELVES[selectedShelf];
  if (!target?.inventoryUrl || !target?.variantId) return [];
  return [target];
};

const normalizeChatgptPayload = (payload = {}, existingAcc = null) => {
  const normalized = { ...payload };
  const targetType = normalized.type || existingAcc?.type || "unassigned";

  if (targetType === "package2") {
    const fallbackShelf =
      existingAcc?.type === "package2"
        ? normalizePackage2Shelf(
            existingAcc.package2Shelf,
            PACKAGE2_SHELF_MAIN,
          )
        : PACKAGE2_SHELF_MAIN;
    normalized.package2Shelf = normalizePackage2Shelf(
      normalized.package2Shelf,
      fallbackShelf,
    );
  } else {
    normalized.package2Shelf = PACKAGE2_SHELF_NONE;
  }

  return normalized;
};

const getDatammoLines = (acc, options = {}) => {
  if (!acc) return [];
  const lines = [];
  const includeAllPackage2Shelves = options.includeAllPackage2Shelves === true;
  const forcePackage2Sync = options.forcePackage2Sync === true;

  // 1) Logic cho GÓI 3 (Team Account - Business Slots)
  if (acc.slots !== undefined) {
    const formatTeamContent = (slotNum) => {
      // Key = "Slot N" đặt đầu để Datammo không dedup 4 dòng thành 1
      // Format: Slot 1|email|Bạn gửi gmail chính chủ để admin up
      return `Slot ${slotNum}|${acc.username}|Bạn gửi kèm gmail chính chủ để admin up`;
    };

    acc.slots.forEach((slot, index) => {
      // Slot trống được đẩy lên sàn MMO
      if (slot.status === "empty" || !slot.gmail) {
        lines.push({ variantId: DATAMMO_VARIANT_PKG3, content: formatTeamContent(index + 1) });
      }
    });
    return lines;
  }

  // 2) Logic cho Account thông thường (Gói 1: Shared, Gói 2: Private)
  const formatContent = (slotInfo) => {
    // Package2 (Private): content đơn giản là TK|MK|Link(nếu có)
    // Package1 (Shared): đặt Slot N lên đầu làm key để Datammo không dedup 3 dòng thành 1
    const includeLink = acc.type === "package2" && acc.link;
    const creds = `${acc.username}|${acc.password}${includeLink ? `|${acc.link}` : ""}`;
    // Với package1: format = "Slot N|TK|MK" (key khác nhau từng slot)
    return slotInfo ? `${slotInfo}|${creds}` : creds;
  };

  if (acc.type === "package2") {
    const daysLeft = acc.expiredAt
      ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000)
      : 999;
    const canSellPackage2 =
      (!acc.users || acc.users.length === 0) && daysLeft > 25;
    if (forcePackage2Sync || canSellPackage2) {
      // Chỉ đẩy lên Datammo nếu còn HƠN 25 ngày (tránh bán acc sắp hết hạn)
      const targetShelves = getPackage2ShelfTargets(
        acc,
        includeAllPackage2Shelves,
      );
      targetShelves.forEach((targetShelf) => {
        lines.push({
          inventoryUrl: targetShelf.inventoryUrl,
          variantId: targetShelf.variantId,
          content: formatContent(""),
        });
      });
    }
  } else if (acc.type === "package1") {
    const userCount = acc.users ? acc.users.length : 0;
    // Mỗi package 1 có 3 slot.
    for (let i = userCount + 1; i <= 3; i++) {
      lines.push({ variantId: DATAMMO_VARIANT_PKG1, content: formatContent(`Slot ${i}`) });
    }
  }
  return lines;
};

const syncDatammoUpdate = async (oldAcc, newAcc, options = {}) => {
  const forceOldPackage2Sync = options.forceOldPackage2Sync === true;
  const forceNewPackage2Sync = options.forceNewPackage2Sync === true;
  const isPackage2Context =
    oldAcc?.type === "package2" || newAcc?.type === "package2";
  const isManualPackage2ShelfSync = forceNewPackage2Sync && isPackage2Context;
  const rawOldLines = getDatammoLines(oldAcc, {
    includeAllPackage2Shelves: true,
    forcePackage2Sync: forceOldPackage2Sync,
  });
  const newLines = getDatammoLines(newAcc, {
    forcePackage2Sync: forceNewPackage2Sync,
  });

  let toDelete = [];
  let toAdd = [];

  if (isManualPackage2ShelfSync) {
    // Shelf switch must be delete-first-add-later to avoid duplicate key on Datammo.
    const deleteMap = new Map();
    [...rawOldLines, ...newLines].forEach((line) => {
      deleteMap.set(getDatammoLineKey(line), line);
    });
    toDelete = Array.from(deleteMap.values());
    toAdd = newLines;
  } else {
    const newLineKeys = new Set(newLines.map(getDatammoLineKey));
    // On forced shelf switch, treat selected new shelf as "must add" to heal missing stock.
    const shouldForceMustAdd = forceOldPackage2Sync || forceNewPackage2Sync;
    const oldLines = shouldForceMustAdd
      ? rawOldLines.filter((line) => !newLineKeys.has(getDatammoLineKey(line)))
      : rawOldLines;
    const oldLineKeys = new Set(oldLines.map(getDatammoLineKey));

    toDelete = oldLines.filter(
      (oldLine) => !newLineKeys.has(getDatammoLineKey(oldLine)),
    );
    toAdd = newLines.filter(
      (newLine) => !oldLineKeys.has(getDatammoLineKey(newLine)),
    );
  }

  for (const item of toDelete) {
    const inventoryUrl = getDatammoInventoryUrl(item);
    try {
      await axios.post(
        `${inventoryUrl}/delete`,
        { variantId: item.variantId, content: item.content },
        { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
      );
      console.log("Datammo DELETE synced:", item.content, "=>", inventoryUrl);

      // Package2 fallback cleanup by key only to clear stale lines with old value/link.
      if (isManualPackage2ShelfSync && isPackage2DatammoVariant(item.variantId)) {
        const primaryKey = getDatammoPrimaryKey(item);
        const keyOnlyContent = primaryKey ? `${primaryKey}|` : "";
        if (keyOnlyContent && keyOnlyContent !== item.content) {
          try {
            await axios.post(
              `${inventoryUrl}/delete`,
              { variantId: item.variantId, content: keyOnlyContent },
              { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
            );
            console.log(
              "Datammo DELETE by key synced:",
              keyOnlyContent,
              "=>",
              inventoryUrl,
            );
          } catch (keyDeleteErr) {
            console.error(
              "Datammo DELETE by key err:",
              keyDeleteErr?.response?.data || keyDeleteErr.message,
            );
          }
        }
      }
    } catch (err) {
      console.error("Datammo DELETE err:", err?.response?.data || err.message);
    }
  }

  // Ensure Datammo has processed DELETE before ADD when switching shelf.
  if (isManualPackage2ShelfSync && toDelete.length > 0 && toAdd.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  for (const item of toAdd) {
    const inventoryUrl = getDatammoInventoryUrl(item);
    try {
      await axios.post(
        inventoryUrl,
        { variantId: item.variantId, content: item.content },
        { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
      );
      console.log("Datammo ADD synced:", item.content, "=>", inventoryUrl);
    } catch (err) {
      const errData = err?.response?.data;
      const errText =
        typeof errData === "string"
          ? errData
          : JSON.stringify(errData || err.message || "");
      const isDuplicateErr = /duplicate/i.test(errText);

      // Retry once for duplicate race condition (delete not yet committed).
      if (isDuplicateErr && isManualPackage2ShelfSync) {
        try {
          const primaryKey = getDatammoPrimaryKey(item);
          const keyOnlyContent = primaryKey ? `${primaryKey}|` : "";
          await axios.post(
            `${inventoryUrl}/delete`,
            { variantId: item.variantId, content: item.content },
            { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
          );
          if (keyOnlyContent && keyOnlyContent !== item.content) {
            await axios.post(
              `${inventoryUrl}/delete`,
              { variantId: item.variantId, content: keyOnlyContent },
              { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          await axios.post(
            inventoryUrl,
            { variantId: item.variantId, content: item.content },
            { headers: { Authorization: `Bearer ${DATAMMO_TOKEN}` } },
          );
          console.log(
            "Datammo ADD retry synced:",
            item.content,
            "=>",
            inventoryUrl,
          );
          continue;
        } catch (retryErr) {
          console.error(
            "Datammo ADD retry err:",
            retryErr?.response?.data || retryErr.message,
          );
        }
      }

      console.error("Datammo ADD err:", errData || err.message);
    }
  }
};
// ---------------------------

app.get("/api/data", verifyToken, async (req, res) => {
  try {
    const [accounts, netflixAccs, canvaAccs, capcutAccs, teamAccs] = await Promise.all([
      Account.find({}),
      Netflix.find({}),
      Canva.find({}),
      Capcut.find({}),
      TeamAccount.find({}),
    ]);
    res.json({ chatgpt: accounts, netflix: netflixAccs, canva: canvaAccs, capcut: capcutAccs, team: teamAccs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1.5 GET ALL DATA (Public - for Telegram bot)
app.get("/api/data-public", async (req, res) => {
  try {
    const accounts = await Account.find({});
    res.json({ chatgpt: accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ADD ACCOUNT (Protected - requires token)
app.post("/api/chatgpt", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const expiredDate = new Date(now);
    expiredDate.setDate(expiredDate.getDate() + 30); // Add 30 days
    const normalizedBody = normalizeChatgptPayload(req.body);

    const newAcc = {
      id: Date.now().toString(),
      ...normalizedBody,
      createdAt: now.toISOString(),
      expiredAt: expiredDate.toISOString(),
    };
    await Account.create(newAcc);
    // Tự động đẩy lên Datammo
    await syncDatammoUpdate(null, newAcc);
    res.json({ message: "Added successfully", account: newAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2.5 ADD ACCOUNT (Public - for Telegram bot)
app.post("/api/chatgpt-public", async (req, res) => {
  try {
    const now = new Date();
    const expiredDate = new Date(now);
    expiredDate.setDate(expiredDate.getDate() + 30); // Add 30 days
    const normalizedBody = normalizeChatgptPayload(req.body);

    const newAcc = {
      id: Date.now().toString(),
      ...normalizedBody,
      createdAt: now.toISOString(),
      expiredAt: expiredDate.toISOString(),
    };
    await Account.create(newAcc);
    await syncDatammoUpdate(null, newAcc);
    res.json({ message: "Added successfully", account: newAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. UPDATE ACCOUNT
app.put("/api/chatgpt/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existingAcc = await Account.findOne({ id: id });
    if (!existingAcc) {
      return res.status(404).json({ error: "Không tìm thấy account" });
    }

    // Validate package2: chỉ được tối đa 1 khách hàng
    const normalizedPayload = normalizeChatgptPayload(req.body, existingAcc);

    if (normalizedPayload.users !== undefined) {
      const targetType = normalizedPayload.type || existingAcc.type;
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

    const updated = await Account.findOneAndUpdate({ id: id }, normalizedPayload, {
      new: true,
    });
    const existingShelf = normalizePackage2Shelf(
      existingAcc.package2Shelf,
      PACKAGE2_SHELF_NONE,
    );
    const updatedShelf = normalizePackage2Shelf(
      normalizedPayload.package2Shelf,
      PACKAGE2_SHELF_NONE,
    );
    const isPackage2ShelfChanged = existingShelf !== updatedShelf;
    const targetType = normalizedPayload.type || existingAcc.type;
    const isPackage2Context =
      existingAcc.type === "package2" || targetType === "package2";
    const isManualShelfUpdate =
      isPackage2Context && req.body.package2Shelf !== undefined;

    // Logic đồng bộ thông minh: so sánh 2 object để add/delete kho cho chuẩn
    await syncDatammoUpdate(existingAcc, updated, {
      // Shelf update always runs as delete-other-shelf then add-target-shelf.
      forceOldPackage2Sync: isPackage2ShelfChanged || isManualShelfUpdate,
      forceNewPackage2Sync: isManualShelfUpdate,
    });

    res.json({ message: "Updated", account: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. DELETE ACCOUNT
app.delete("/api/chatgpt/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Account.findOneAndDelete({ id: id });
    if (existing) {
      await syncDatammoUpdate(existing, null);
    }
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.4 TEAM MOVE SLOT
app.post("/api/team-move-slot", verifyToken, async (req, res) => {
  try {
    const { fromAccId, toAccId, slotIndex } = req.body;

    const fromAcc = await TeamAccount.findOne({ id: fromAccId });
    const toAcc = await TeamAccount.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both team accounts not found" });
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
      toAcc.slots = Array(4).fill({ status: "empty" });
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
    await TeamAccount.updateOne(
      { id: toAccId },
      { $set: { [`slots.${emptySlotIdx}`]: slotToMove } }
    );

    await TeamAccount.updateOne(
      { id: fromAccId },
      {
        $set: {
          [`slots.${slotIndex}`]: {
            status: "empty",
            gmail: "",
            customerName: "",
            addedAt: "",
            expiredAt: ""
          }
        }
      }
    );

    const updatedFrom = await TeamAccount.findOne({ id: fromAccId });
    const updatedTo = await TeamAccount.findOne({ id: toAccId });
    await Promise.all([
      syncDatammoUpdate(fromAcc, updatedFrom),
      syncDatammoUpdate(toAcc, updatedTo),
    ]);

    res.json({ message: "Team Slot moved successfully", from: updatedFrom, to: updatedTo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.5 MOVE USER (ATOMIC TRANSFER)
app.post("/api/move-user", verifyToken, async (req, res) => {
  try {
    const { fromAccId, toAccId, userIndex } = req.body;

    const fromAcc = await Account.findOne({ id: fromAccId });
    const toAcc = await Account.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both accounts not found" });
    }

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

    toAcc.markModified("users");
    fromAcc.markModified("users");

    await toAcc.save();
    await fromAcc.save();

    // Tự động tính toán DataMMO Add/Delete dựa trên biến động User Array
    await Promise.all([
      syncDatammoUpdate(originalFromAcc, fromAcc),
      syncDatammoUpdate(originalToAcc, toAcc),
    ]);

    res.json({ message: "Moved user successfully", from: fromAcc, to: toAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.5.1 MOVE USER FOR SINGLE PLATFORMS (Netflix, Capcut, Canva)
app.post("/api/simple-move-user", verifyToken, async (req, res) => {
  try {
    const { fromAccId, toAccId, platform } = req.body;

    const Model = platform === "netflix" ? Netflix : platform === "capcut" ? Capcut : platform === "canva" ? Canva : null;
    if (!Model) return res.status(400).json({ error: "Invalid platform" });

    const fromAcc = await Model.findOne({ id: fromAccId });
    const toAcc = await Model.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "Một trong hai tài khoản không tồn tại" });
    }

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

    // BẢO LƯU NGÀY HẾT HẠN CỦA KHÁCH NETFLIX/CAPCUT KHI CHUYỂN
    // Nếu khách chưa có expiredAt cá nhân, họ đang dùng hạn của account cũ (fromAcc)
    // -> Bứng hạn đó dán cố định vào cá nhân họ để qua account mới không bị tăng ngày =))
    if (!userToMove.expiredAt && fromAcc.expiredAt) {
      userToMove.expiredAt = fromAcc.expiredAt;
    }

    if (!toAcc.users) toAcc.users = [];
    toAcc.users.push(userToMove);
    fromAcc.users.splice(0, 1);

    toAcc.markModified("users");
    fromAcc.markModified("users");

    await toAcc.save();
    await fromAcc.save();

    res.json({ message: "Đã chuyển khách thành công", from: fromAcc, to: toAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.6 EXTEND USER (+ custom DAYS)
app.post("/api/extend-user", verifyToken, async (req, res) => {
  const { accId, userIndex, platform, extDays: bodyExtDays } = req.body;
  try {
    const Model = platform === "netflix" ? Netflix : platform === "capcut" ? Capcut : platform === "canva" ? Canva : Account;
    const acc = await Model.findOne({ id: accId });
    if (!acc || !acc.users[userIndex])
      return res.status(404).json({ error: "User/Account not found" });

    const user = acc.users[userIndex];
    const now = new Date();

    // Determine extension days
    let extDays = parseInt(bodyExtDays, 10);
    if (!extDays || isNaN(extDays) || extDays <= 0) {
      extDays = 30;
      if (platform && platform !== "chatgpt") {
        const m = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };
        extDays = m[acc.duration] || 30;
      }
    }

    // Determine current expiration. If missing, fallback to joinedAt + extDays
    let currentExpiredAtTime;
    if (user.expiredAt) {
      currentExpiredAtTime = new Date(user.expiredAt).getTime();
    } else {
      const joinedAt = user.joinedAt ? new Date(user.joinedAt) : now;
      currentExpiredAtTime = joinedAt.getTime() + extDays * 24 * 60 * 60 * 1000;
    }

    if (currentExpiredAtTime <= now.getTime()) {
      // Đã hết hạn: reset `expiredAt` tính từ hôm nay
      user.expiredAt = new Date(now.getTime() + extDays * 24 * 60 * 60 * 1000).toISOString();
      user.note = (user.note ? user.note + " " : "") + `[Renewed on ${now.toLocaleDateString()}]`;
    } else {
      // Chưa hết hạn: cộng dồn thêm extDays vào expiredAt hiện đại
      user.expiredAt = new Date(currentExpiredAtTime + extDays * 24 * 60 * 60 * 1000).toISOString();
      user.note = (user.note ? user.note + " " : "") + `[Extended +${extDays}d on ${now.toLocaleDateString()}]`;
    }

    // markModified để Mongoose detect thay đổi trong subdocument array
    acc.markModified("users");
    await acc.save();
    res.json({ message: "User extended successfully", updatedUser: user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// TEAM CHATGPT ROUTES
// ========================
// GET all team accounts
app.get("/api/team", verifyToken, async (req, res) => {
  try {
    const teams = await TeamAccount.find({});
    res.json(teams);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add team account
app.post("/api/team", verifyToken, async (req, res) => {
  try {
    const now = new Date();
    const expiredDate = new Date(now);
    expiredDate.setMonth(expiredDate.getMonth() + 1);
    const newAcc = {
      id: Date.now().toString(),
      ...req.body,
      slots: req.body.slots || Array(4).fill(null).map(() => ({ status: "empty" })),
      createdAt: now.toISOString(),
      expiredAt: req.body.expiredAt || expiredDate.toISOString(),
    };
    await TeamAccount.create(newAcc);
    await syncDatammoUpdate(null, newAcc);
    res.json({ message: "Added", account: newAcc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update team account (including slot management)
app.put("/api/team/:id", verifyToken, async (req, res) => {
  try {
    const existing = await TeamAccount.findOne({ id: req.params.id });
    const updated = await TeamAccount.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    await syncDatammoUpdate(existing, updated);
    res.json({ message: "Updated", account: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE team account
app.delete("/api/team/:id", verifyToken, async (req, res) => {
  try {
    const existing = await TeamAccount.findOneAndDelete({ id: req.params.id });
    if (existing) await syncDatammoUpdate(existing, null);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        createdAt: now.toISOString()
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
      const updated = await Model.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
      res.json({ message: "Updated successfully", account: updated });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.delete(`/api/${platformRoute}/:id`, verifyToken, async (req, res) => {
    try {
      await Model.findOneAndDelete({ id: req.params.id });
      res.json({ message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
