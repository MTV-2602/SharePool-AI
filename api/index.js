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

    const newAcc = {
      id: Date.now().toString(),
      ...req.body,
      createdAt: now.toISOString(),
      expiredAt: expiredDate.toISOString(),
    };
    await Account.create(newAcc);
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

    const newAcc = {
      id: Date.now().toString(),
      ...req.body,
      createdAt: now.toISOString(),
      expiredAt: expiredDate.toISOString(),
    };
    await Account.create(newAcc);
    res.json({ message: "Added successfully", account: newAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. UPDATE ACCOUNT
app.put("/api/chatgpt/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate package2: chỉ được tối đa 1 khách hàng
    if (req.body.users !== undefined) {
      const existingAcc = await Account.findOne({ id: id });
      const targetType = req.body.type || existingAcc?.type;
      if (targetType === "package2" && req.body.users.length > 1) {
        return res.status(400).json({ error: "Gói Private (Gói 2) chỉ được tối đa 1 khách hàng" });
      }
    }

    const updated = await Account.findOneAndUpdate({ id: id }, req.body, {
      new: true,
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
    await Account.findOneAndDelete({ id: id });
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

    res.json({ message: "Moved slot successfully" });
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

    if (!toAcc.users) toAcc.users = [];
    toAcc.users.push(userToMove);
    fromAcc.users.splice(userIndex, 1);

    toAcc.markModified("users");
    fromAcc.markModified("users");

    await toAcc.save();
    await fromAcc.save();

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
      slots: req.body.slots || Array(5).fill(null).map(() => ({ status: "empty" })),
      createdAt: now.toISOString(),
      expiredAt: req.body.expiredAt || expiredDate.toISOString(),
    };
    await TeamAccount.create(newAcc);
    res.json({ message: "Added", account: newAcc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update team account (including slot management)
app.put("/api/team/:id", verifyToken, async (req, res) => {
  try {
    const updated = await TeamAccount.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    res.json({ message: "Updated", account: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE team account
app.delete("/api/team/:id", verifyToken, async (req, res) => {
  try {
    await TeamAccount.findOneAndDelete({ id: req.params.id });
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
