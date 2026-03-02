const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'client/dist'))); // Serve React Build

// --- MONGODB CONNECTION & SCHEMA ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ Connected to MongoDB Atlas successfully!");
        await migrateDataIfNeeded();
    })
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// Define Schema for Accounts (ChatGPT)
const accountSchema = new mongoose.Schema({
    id: { type: String, unique: true }, // Keep string ID compatibility
    username: { type: String, required: true },
    password: { type: String, required: true },
    type: { type: String, default: 'unassigned' },
    users: [{
        name: String,
        joinedAt: String // ISO String
    }],
    note: String,
    link: String,
    status: { type: String, default: 'available' },
    createdAt: { type: String }, // ISO String
    expiredAt: { type: String } // New Field
});

// Define Schema for Coursera Accounts
const courseraSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    type: { type: String, default: 'coursera' },
    users: [{
        name: String,
        joinedAt: String
    }],
    note: String,
    status: { type: String, default: 'available' },
    createdAt: { type: String },
    expiredAt: { type: String }
});

const Account = mongoose.model('Account', accountSchema);
const Coursera = mongoose.model('Coursera', courseraSchema);

// --- MIGRATION LOGIC (Tự động chuyển dữ liệu cũ lên Cloud) ---
async function migrateDataIfNeeded() {
    try {
        const count = await Account.countDocuments();
        if (count === 0) {
            const dbPath = path.join(__dirname, 'database.json');
            if (fs.existsSync(dbPath)) {
                console.log("📂 Database is empty. Migrating data from database.json...");
                const oldData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

                if (oldData.chatgpt && oldData.chatgpt.length > 0) {
                    await Account.insertMany(oldData.chatgpt);
                    console.log(`✅ Successfully migrated ${oldData.chatgpt.length} accounts to MongoDB!`);
                }
            }
        }
    } catch (error) {
        console.error("⚠️ Migration Warning:", error.message);
    }
}

// --- API ROUTES (REWRITTEN FOR MONGODB) ---

// Middleware xác thực token (Base64, 7 ngày)
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf-8');
        const [createdAt, expiryTime, email] = decoded.split('_');
        if (Date.now() > parseInt(expiryTime)) {
            return res.status(401).json({ error: 'Token expired. Please login again.' });
        }
        req.user = { email };
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            const now = Date.now();
            const expiryTime = now + 7 * 24 * 60 * 60 * 1000; // 7 ngày
            const token = Buffer.from(`${now}_${expiryTime}_${email}`).toString('base64');
            res.json({
                success: true,
                token,
                expiresAt: new Date(expiryTime).toISOString(),
                message: 'Login successful. Token expires in 7 days.',
            });
        } else {
            res.status(401).json({ success: false, message: 'Sai email hoặc mật khẩu!' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Login error', error: error.message });
    }
});

// 1. GET ALL DATA
app.get('/api/data', verifyToken, async (req, res) => {
    try {
        const accounts = await Account.find({});
        const coursera = await Coursera.find({});
        res.json({ chatgpt: accounts, coursera: coursera });
    } catch (error) {
        res.status(500).json({ error: 'Database Error' });
    }
});


// 2. ADD ACCOUNT
app.post('/api/chatgpt', verifyToken, async (req, res) => {
    try {
        const newAcc = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        await Account.create(newAcc);
        res.json({ message: 'Added successfully', account: newAcc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. UPDATE ACCOUNT (PUT)
app.put('/api/chatgpt/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Validate package2: chỉ được tối đa 1 khách hàng
        if (req.body.users !== undefined) {
            const existingAcc = await Account.findOne({ id: id });
            const targetType = req.body.type || existingAcc?.type;
            if (targetType === 'package2' && req.body.users.length > 1) {
                return res.status(400).json({ error: 'Gói Private (Gói 2) chỉ được tối đa 1 khách hàng' });
            }
        }

        const updated = await Account.findOneAndUpdate({ id: id }, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Account not found' });
        res.json({ message: 'Updated', account: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. DELETE ACCOUNT
app.delete('/api/chatgpt/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        await Account.findOneAndDelete({ id: id });
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === COURSERA API ROUTES ===

// ADD COURSERA ACCOUNT
app.post('/api/coursera', async (req, res) => {
    try {
        const newCourseraAcc = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        await Coursera.create(newCourseraAcc);
        res.json({ message: 'Added Coursera successfully', account: newCourseraAcc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATE COURSERA ACCOUNT
app.put('/api/coursera/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await Coursera.findOneAndUpdate({ id: id }, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Coursera account not found' });
        res.json({ message: 'Updated Coursera', account: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE COURSERA ACCOUNT
app.delete('/api/coursera/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Coursera.findOneAndDelete({ id: id });
        res.json({ message: 'Deleted Coursera' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === END COURSERA ROUTES ===

// 4.5 MOVE USER (ATOMIC TRANSFER)
app.post('/api/move-user', async (req, res) => {
    try {
        const { fromAccId, toAccId, userIndex } = req.body;

        const fromAcc = await Account.findOne({ id: fromAccId });
        const toAcc = await Account.findOne({ id: toAccId });

        if (!fromAcc || !toAcc) {
            return res.status(404).json({ error: 'One or both accounts not found' });
        }

        if (!fromAcc.users || !fromAcc.users[userIndex]) {
            return res.status(400).json({ error: 'User not found in source account' });
        }

        // STRICT RULE: Cannot transfer to Expired Account
        if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
            return res.status(400).json({ error: 'Tài khoản đích ĐÃ HẾT HẠN. Không thể chuyển khách vào!' });
        }

        const sourceType = fromAcc.type; // Loại gói nguồn
        const currentUsers = toAcc.users?.length || 0;

        if (toAcc.type === sourceType) {
            // Cùng loại gói: kiểm tra slot
            if (sourceType === 'package1' && currentUsers >= 3) {
                return res.status(400).json({ error: 'Tài khoản Shared đích đã đầy (3/3)' });
            }
            if (sourceType === 'package2' && currentUsers >= 1) {
                return res.status(400).json({ error: 'Tài khoản Private đích đã có người dùng (1/1)' });
            }
        } else if (toAcc.type === 'unassigned') {
            // Đích là unassigned: tự động đổi type sang loại của nguồn
            if (sourceType === 'package2' && currentUsers >= 1) {
                return res.status(400).json({ error: 'Tài khoản đích đã có người dùng' });
            }
            if (sourceType === 'package1' && currentUsers >= 3) {
                return res.status(400).json({ error: 'Tài khoản đích đã đầy slot' });
            }
            // Tự động đổi type của tài khoản đích theo loại nguồn
            toAcc.type = sourceType;
        } else {
            // Khác loại và không phải unassigned -> từ chối
            const typeLabel = sourceType === 'package1' ? 'Chia Sẻ' : 'Private';
            return res.status(400).json({
                error: `Chỉ được chuyển vào gói cùng loại (${typeLabel}) hoặc tài khoản chưa phân loại`,
            });
        }

        const userToMove = fromAcc.users[userIndex];
        if (!toAcc.users) toAcc.users = [];
        toAcc.users.push(userToMove);
        fromAcc.users.splice(userIndex, 1);

        toAcc.markModified('users');
        fromAcc.markModified('users');

        await toAcc.save();
        await fromAcc.save();

        res.json({ message: 'Moved user successfully', from: fromAcc, to: toAcc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// EXTEND USER (+30 DAYS)
app.post('/api/extend-user', async (req, res) => {
    const { accId, userIndex } = req.body;
    try {
        const acc = await Account.findOne({ id: accId });
        if (!acc || !acc.users[userIndex]) return res.status(404).json({ error: 'User/Account not found' });

        const user = acc.users[userIndex];
        const now = new Date();
        const joinedAt = new Date(user.joinedAt || now);

        const diffTime = now.getTime() - joinedAt.getTime();
        const daysUsed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysUsed >= 30) {
            // Đã hết hạn: reset về hôm nay → thêm đúng 30 ngày mới
            user.joinedAt = now.toISOString();
            user.note = (user.note ? user.note + ' ' : '') + `[Renewed on ${now.toLocaleDateString()}]`;
        } else {
            // Chưa hết hạn: thêm 30 ngày vào ngày hết hạn hiện tại
            // Expiry hiện tại = joinedAt + 30, Expiry mới = joinedAt + 60 (còn lại + 30 ngày)
            const newJoinedAt = new Date(joinedAt.getTime() + (30 * 24 * 60 * 60 * 1000));
            user.joinedAt = newJoinedAt.toISOString();
            user.note = (user.note ? user.note + ' ' : '') + `[Extended +30d on ${now.toLocaleDateString()}]`;
        }

        // markModified để Mongoose detect thay đổi trong subdocument array
        acc.markModified('users');
        await acc.save();
        res.json({ message: 'User extended successfully', updatedUser: user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. PROXY GOOGLE SHEET (Giữ nguyên)
app.post('/api/proxy-sheet', async (req, res) => {
    try {
        const { scriptUrl, sheetName, data } = req.body;
        console.log(`Proxying to Sheet: ${sheetName}, Rows: ${data.length}`);

        // Google Apps Script expects POST request (usually) to handle doPost
        // We send payload as JSON string if your script expects it, or form data
        // Assuming your script handles JSON payload via postData.contents or parameter
        // Standard fetch to Apps Script often requires following redirects

        // Simple Forwarding
        const response = await axios.post(scriptUrl, {
            sheetName,
            data // [[col1, col2, ...], ...]
        }, {
            headers: { 'Content-Type': 'application/json' },
            maxRedirects: 5
        });

        res.json(response.data);
    } catch (error) {
        console.error("Proxy Error:", error.response?.data || error.message);
        res.status(500).json({ error: 'Lỗi khi gửi dữ liệu sang Google Sheet' });
    }
});

// --- SERVE REACT APP FOR ANY OTHER ROUTE (DEPLOYMENT SUPPORT) ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📦 MongoDB Mode: ACTIVE`);
});
