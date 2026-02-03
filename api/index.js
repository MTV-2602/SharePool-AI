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
  users: [{ name: String, joinedAt: String }],
  note: String,
  link: String,
  status: { type: String, default: "available" },
  createdAt: { type: String },
  expiredAt: { type: String },
});
const Account =
  mongoose.models.Account || mongoose.model("Account", accountSchema);

// Middleware to ensure DB is connected before processing
app.use(async (req, res, next) => {
  await connectDB();
  next();
});

// --- API ROUTES ---

// 1. GET ALL DATA
app.get("/api/data", async (req, res) => {
  try {
    const accounts = await Account.find({});
    res.json({ chatgpt: accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ADD ACCOUNT
app.post("/api/chatgpt", async (req, res) => {
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
app.put("/api/chatgpt/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Account.findOneAndUpdate({ id: id }, req.body, {
      new: true,
    });
    res.json({ message: "Updated", account: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. DELETE ACCOUNT
app.delete("/api/chatgpt/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await Account.findOneAndDelete({ id: id });
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.5 MOVE USER (ATOMIC TRANSFER)
app.post("/api/move-user", async (req, res) => {
  try {
    const { fromAccId, toAccId, userIndex } = req.body;

    // Find both accounts
    const fromAcc = await Account.findOne({ id: fromAccId });
    const toAcc = await Account.findOne({ id: toAccId });

    if (!fromAcc || !toAcc) {
      return res.status(404).json({ error: "One or both accounts not found" });
    }

    // Validate user index
    if (!fromAcc.users || !fromAcc.users[userIndex]) {
      return res
        .status(400)
        .json({ error: "User not found in source account" });
    }

    // Only allow transfer to Shared package (package1)
    if (toAcc.type !== "package1") {
      return res
        .status(400)
        .json({ error: "Chỉ được chuyển vào gói Chia Sẻ (Shared)" });
    }

    // Check if Shared package has available slots
    const currentUsers = toAcc.users?.length || 0;
    if (currentUsers >= 3) {
      return res.status(400).json({ error: "Tài khoản Shared đã đầy (3/3)" });
    }

    // STRICT RULE: Cannot transfer to Expired Account
    if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
      return res
        .status(400)
        .json({
          error: "Tài khoản đích ĐÃ HẾT HẠN. Không thể chuyển khách vào!",
        });
    }

    // Get user data
    const userToMove = fromAcc.users[userIndex];

    // 1. Add to destination
    if (!toAcc.users) toAcc.users = [];
    toAcc.users.push(userToMove);

    // 2. Remove from source
    fromAcc.users.splice(userIndex, 1);

    // Save (Atomic simulation)
    await toAcc.save();
    await fromAcc.save();

    res.json({ message: "Moved user successfully", from: fromAcc, to: toAcc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.6 EXTEND USER (+30 DAYS)
app.post("/api/extend-user", async (req, res) => {
  const { accId, userIndex } = req.body;
  try {
    const acc = await Account.findOne({ id: accId });
    if (!acc || !acc.users[userIndex])
      return res.status(404).json({ error: "User/Account not found" });

    const user = acc.users[userIndex];
    const now = new Date();
    const joinedAt = new Date(user.joinedAt || now);

    // Calculate days used
    const diffTime = now.getTime() - joinedAt.getTime();
    const daysUsed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysUsed >= 30) {
      // If expired, reset to NOW
      user.joinedAt = now.toISOString();
      user.note =
        (user.note ? user.note + " " : "") +
        `[Renewed on ${now.toLocaleDateString()}]`;
    } else {
      // If not expired, add 30 days to the CURRENT start date
      const newJoinedAt = new Date(
        joinedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      user.joinedAt = newJoinedAt.toISOString();
      user.note =
        (user.note ? user.note + " " : "") +
        `[Extended +30d on ${now.toLocaleDateString()}]`;
    }

    await acc.save();
    res.json({ message: "User extended successfully", updatedUser: user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// 6. TELEGRAM WEBHOOK
const telegramWebhook = require("./telegram-webhook");
app.post("/api/telegram-webhook", telegramWebhook);

// Helper for Vercel
module.exports = app;
