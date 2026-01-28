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

// Define Schema for Accounts
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

const Account = mongoose.model('Account', accountSchema);

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

// 1. GET ALL DATA
app.get('/api/data', async (req, res) => {
    try {
        const accounts = await Account.find({});
        // Format response to match old structure for Frontend compatibility
        res.json({ chatgpt: accounts });
    } catch (error) {
        res.status(500).json({ error: 'Database Error' });
    }
});

// 2. ADD ACCOUNT
app.post('/api/chatgpt', async (req, res) => {
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
app.put('/api/chatgpt/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await Account.findOneAndUpdate({ id: id }, req.body, { new: true });
        if (!updated) return res.status(404).json({ error: 'Account not found' });
        res.json({ message: 'Updated', account: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. DELETE ACCOUNT
app.delete('/api/chatgpt/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Account.findOneAndDelete({ id: id });
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4.5 MOVE USER (ATOMIC TRANSFER)
app.post('/api/move-user', async (req, res) => {
    try {
        const { fromAccId, toAccId, userIndex } = req.body;

        // Find both accounts
        const fromAcc = await Account.findOne({ id: fromAccId });
        const toAcc = await Account.findOne({ id: toAccId });

        if (!fromAcc || !toAcc) {
            return res.status(404).json({ error: 'One or both accounts not found' });
        }

        // Validate user index
        if (!fromAcc.users || !fromAcc.users[userIndex]) {
            return res.status(400).json({ error: 'User not found in source account' });
        }

        // Only allow transfer to Shared package (package1)
        if (toAcc.type !== 'package1') {
            return res.status(400).json({ error: 'Chỉ được chuyển vào gói Chia Sẻ (Shared)' });
        }
        
        // Check if Shared package has available slots
        const currentUsers = toAcc.users?.length || 0;
        if (currentUsers >= 3) {
            return res.status(400).json({ error: 'Tài khoản Shared đã đầy (3/3)' });
        }

        // STRICT RULE: Cannot transfer to Expired Account
        if (toAcc.expiredAt && new Date(toAcc.expiredAt) < new Date()) {
            return res.status(400).json({ error: 'Tài khoản đích ĐÃ HẾT HẠN. Không thể chuyển khách vào!' });
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
        // Calculate new Expiry Date based on CURRENT status
        // Logic: Always add +30 days to the JOINED DATE.
        // Because "Days Used" is calculated from Joined Date.
        // So bumping Joined Date forward by 30 days effectively resets "Days Used" to 0 (or reduces it by 30).

        // Wait! Bumping JOINED DATE means "resetting usage".
        // Example: Joined 1/1. Today 1/2. Used 30 days. Expired.
        // Action: Extend +30 days.
        // New Joined Date should be: Today (1/2)? Or Joined Date + 30 days (1/31)?
        // User requested: "Gia han +30 days". Usually means adding time.
        const now = new Date();
        const joinedAt = new Date(user.joinedAt || now); // Use 'now' if joinedAt is missing

        // Calculate days used
        const diffTime = now.getTime() - joinedAt.getTime();
        const daysUsed = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysUsed >= 30) {
            // If expired (or nearly expired, assuming 30 days is the cycle), reset to NOW
            user.joinedAt = now.toISOString();
            user.note = (user.note ? user.note + ' ' : '') + `[Renewed on ${now.toLocaleDateString()}]`;
        } else {
            // If not expired, add 30 days to the CURRENT start date (pushing it into future)
            // This preserves the remaining days.
            // New JoinedAt = Old JoinedAt + 30 days
            const newJoinedAt = new Date(joinedAt.getTime() + (30 * 24 * 60 * 60 * 1000));
            user.joinedAt = newJoinedAt.toISOString();
            user.note = (user.note ? user.note + ' ' : '') + `[Extended +30d on ${now.toLocaleDateString()}]`;
        }

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
