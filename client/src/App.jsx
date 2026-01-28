import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Trash2, UserPlus, Pencil, Copy, ExternalLink, RefreshCw, X, Upload, Loader2, CheckCircle, Mail, User, Shield, AlertCircle, AlertTriangle, Info, Calendar, LogIn, Lock, FileSpreadsheet, ArrowRightLeft, RotateCw } from 'lucide-react';

function App() {
    // LOGIN STATE
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });

    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('chatgpt');

    // BroadcastChannel for real-time sync between tabs
    const channelRef = useRef(null);

    // Modal States
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showImportGPTModal, setShowImportGPTModal] = useState(false);

    // CUSTOM ALERT & CONFIRM MODAL
    const [alertInfo, setAlertInfo] = useState({ show: false, title: '', message: '', type: 'info', onConfirm: null });

    // User Input Modal
    const [showUserModal, setShowUserModal] = useState(false);
    const [userModalMode, setUserModalMode] = useState('add');
    const [currentUserData, setCurrentUserData] = useState({ accId: null, index: null, name: '', joinedAt: null });

    // Move User State
    const [showMoveUserModal, setShowMoveUserModal] = useState(false);
    const [movingUser, setMovingUser] = useState(null); // { fromAccId, userIndex, name, joinedAt }
    const [destinationAccId, setDestinationAccId] = useState('');

    // Import State
    const [importingSheet, setImportingSheet] = useState(false);
    const [importStatus, setImportStatus] = useState(null);

    // Edit/Delete States
    const [editingAcc, setEditingAcc] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    const [newAcc, setNewAcc] = useState({
        username: '', password: '', link: '', type: 'unassigned', note: ''
    });

    // CHECK LOGIN ON LOAD
    useEffect(() => {
        const token = localStorage.getItem('admin_token');
        if (token === 'valid_session_team89a6') {
            setIsAuthenticated(true);
            // Delay to ensure DOM is ready
            setTimeout(() => fetchData(), 100);
        }
    }, []);

    // BROADCAST CHANNEL for real-time sync between tabs/windows
    useEffect(() => {
        if (!isAuthenticated) return;

        // Create broadcast channel
        const channel = new BroadcastChannel('data-sync-channel');
        channelRef.current = channel;

        // Listen for updates from other tabs
        channel.onmessage = (event) => {
            if (event.data.type === 'DATA_UPDATED') {
                console.log('Received update from another tab');
                fetchData();
            }
        };

        return () => {
            channel.close();
        };
    }, [isAuthenticated]);

    // Helper function to broadcast data changes
    const broadcastDataChange = () => {
        if (channelRef.current) {
            channelRef.current.postMessage({ type: 'DATA_UPDATED', timestamp: Date.now() });
        }
    };

    // AUTO REFRESH DATA every 10 seconds (fallback)
    useEffect(() => {
        if (!isAuthenticated) return;
        
        const interval = setInterval(() => {
            fetchData();
        }, 10000); // 10 seconds

        return () => clearInterval(interval);
    }, [isAuthenticated]);

    // REFRESH when tab becomes visible
    useEffect(() => {
        if (!isAuthenticated) return;

        const handleVisibilityChange = () => {
            if (!document.hidden) {
                fetchData();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [isAuthenticated]);

    const handleLogin = (e) => {
        e.preventDefault();
        // HARDCODED CREDENTIALS
        if (loginForm.email.toLowerCase() === 'team89a6@gmail.com' && loginForm.password === 'helloem1') {
            localStorage.setItem('admin_token', 'valid_session_team89a6');
            setIsAuthenticated(true);
            fetchData();
            showAlert('Xin chào', 'Đăng nhập thành công! 👋', 'success');
        } else {
            showAlert('Lỗi', 'Sai email hoặc mật khẩu!', 'error');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('admin_token');
        setIsAuthenticated(false);
        setLoginForm({ email: '', password: '' });
    };

    // HELPER SHOW ALERT / CONFIRM
    const showAlert = (title, message, type = 'info') => {
        setAlertInfo({ show: true, title, message, type, onConfirm: null });
    };

    const showConfirm = (title, message, onConfirmAction) => {
        setAlertInfo({ show: true, title, message, type: 'confirm', onConfirm: onConfirmAction });
    };

    const closeAlert = () => {
        setAlertInfo({ ...alertInfo, show: false, onConfirm: null });
    };

    const executeConfirm = () => {
        if (alertInfo.onConfirm) alertInfo.onConfirm();
        closeAlert();
    };

    // Helper to safely get user name
    const getUserName = (u) => typeof u === 'object' && u !== null ? u.name : u;

    // Helper to get joined date display
    const getUserDate = (u) => {
        if (typeof u === 'object' && u !== null && u.joinedAt) {
            try {
                const date = new Date(u.joinedAt);
                return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
            } catch (e) { return ''; }
        }
        return '';
    };

    // Helper to calculate days used
    const getDaysUsed = (u) => {
        if (typeof u === 'object' && u !== null && u.joinedAt) {
            try {
                const start = new Date(u.joinedAt);
                const now = new Date();
                const diffTime = now - start;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays;
            } catch (e) { return 0; }
        }
        return null;
    };

    // Helper to format Date
    const formatDate = (isoString) => {
        if (!isoString) return '';
        try {
            const d = new Date(isoString);
            return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        } catch (e) { return ''; }
    };

    // Helper to check expiry warning
    const getExpiryStatus = (isoString) => {
        if (!isoString) return { text: '', color: 'text-slate-500', isExpired: false };
        const exp = new Date(isoString);
        const now = new Date();
        const diffTime = exp - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return { text: `(Đã hết hạn ${Math.abs(diffDays)} ngày)`, color: 'text-red-500 font-bold', isExpired: true };
        if (diffDays <= 3) return { text: `(Còn ${diffDays} ngày)`, color: 'text-red-400 font-bold', isExpired: false };
        return { text: `(Hết hạn: ${formatDate(isoString)})`, color: 'text-slate-500 italic', isExpired: false };
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/data', { 
                timeout: 10000,
                headers: { 'Cache-Control': 'no-cache' }
            });
            if (res.data && res.data.chatgpt) {
                const sortedGPT = res.data.chatgpt.sort((a, b) => {
                    if (a.type === 'unassigned' && b.type !== 'unassigned') return -1;
                    if (a.type !== 'unassigned' && b.type === 'unassigned') return 1;
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });
                setAccounts(sortedGPT);
            } else {
                console.error('Invalid data format:', res.data);
                setAccounts([]);
            }
        } catch (error) { 
            console.error('Error fetching data:', error);
            showAlert('Lỗi', 'Không thể tải dữ liệu. Vui lòng thử lại.', 'error');
            setAccounts([]);
        }
        finally { setLoading(false); }
    };

    const handleAddAccount = async (e) => {
        e.preventDefault();
        try {
            await axios.post('/api/chatgpt', newAcc);
            setShowAddModal(false);
            setNewAcc({ username: '', password: '', link: '', type: 'unassigned', note: '' });
            fetchData();
            broadcastDataChange();
        } catch (error) { showAlert('Error', 'Lỗi khi thêm tài khoản', 'error'); }
    };

    const openAddUserModal = (accId) => {
        setUserModalMode('add');
        setCurrentUserData({ accId, index: null, name: '', joinedAt: null });
        setShowUserModal(true);
    };

    const openEditUserModal = (accId, index, userData) => {
        setUserModalMode('edit');
        const name = getUserName(userData);
        const joinedAt = (typeof userData === 'object' && userData.joinedAt) ? userData.joinedAt : null;
        setCurrentUserData({ accId, index, name, joinedAt });
        setShowUserModal(true);
    };

    const handleSubmitUser = async (e) => {
        e.preventDefault();
        const { accId, index, name, joinedAt } = currentUserData;
        if (!name.trim()) return showAlert('Thông báo', "Tên không được để trống!", 'warning');

        const acc = accounts.find(a => a.id === accId);
        if (!acc) return;

        let newUsers = [...(acc.users || [])];

        if (userModalMode === 'add') {
            if (acc.type === 'package1' && newUsers.length >= 3) return showAlert('Giới hạn', 'Gói này đã đủ 3 Slot!', 'warning');

            newUsers.push({
                name: name.trim(),
                joinedAt: new Date().toISOString()
            });
        } else {
            const oldJoinDate = joinedAt || (typeof newUsers[index] === 'object' ? newUsers[index].joinedAt : null);
            newUsers[index] = {
                name: name.trim(),
                joinedAt: oldJoinDate
            };
        }

        try {
            await axios.put(`/api/chatgpt/${accId}`, { users: newUsers });
            setShowUserModal(false);
            fetchData();
            broadcastDataChange();
        } catch (err) { showAlert('Lỗi', 'Không lưu được khách hàng', 'error'); }
    };

    const handleDeleteUser = (accId, userIndex, userName) => {
        showConfirm(
            "Xác Nhận Xóa",
            `Bạn có chắc muốn xóa khách hàng: ${userName}?`,
            async () => {
                const acc = accounts.find(a => a.id === accId);
                if (!acc) return;
                const newUsers = acc.users.filter((_, i) => i !== userIndex);
                try {
                    await axios.put(`/api/chatgpt/${accId}`, { users: newUsers });
                    fetchData();
                    broadcastDataChange();
                } catch (err) { showAlert('Lỗi', 'Lỗi xóa khách', 'error'); }
            }
        );
    };

    // EXTEND USER logic
    const handleExtendUser = async (accId, userIndex, userObj) => {
        const userName = userObj?.name || userObj || 'khách này';

        showConfirm(
            'Xác nhận gia hạn',
            `Bạn có chắc muốn gia hạn cho ${userName} thêm 30 ngày không?`,
            async () => {
                try {
                    await axios.post('/api/extend-user', { accId, userIndex });
                    fetchData();
                    broadcastDataChange();
                    showAlert('Thành Công', 'Đã gia hạn khách hàng (+30 ngày)!', 'success');
                } catch (error) {
                    showAlert('Lỗi', error.response?.data?.error || 'Không thể gia hạn', 'error');
                }
            }
        );
    };

    const handleUpdateAccount = async (e) => {
        e.preventDefault();
        const originalAcc = accounts.find(a => a.id === editingAcc.id);
        if (!originalAcc) return;

        if (originalAcc.type === 'package1' && (originalAcc.users?.length || 0) > 0) {
            if (editingAcc.type !== 'package1') {
                showAlert("CHẶN SỬA ĐỔI", "⚠️ Gói 1 đang có khách. Không thể đổi gói khi chưa xóa khách!", "error");
                return;
            }
        }

        try {
            await axios.put(`/api/chatgpt/${editingAcc.id}`, editingAcc);
            setShowEditModal(false);
            setEditingAcc(null);
            fetchData();
            broadcastDataChange();
        } catch (error) { showAlert('Lỗi', 'Lỗi cập nhật', 'error'); }
    };

    // MOVE USER LOGIC
    const openMoveUserModal = (accId, index, userData) => {
        setMovingUser({ fromAccId: accId, userIndex: index, ...userData });
        setDestinationAccId('');
        setShowMoveUserModal(true);
    };

    const handleSubmitMoveUser = async (e) => {
        e.preventDefault();
        if (!destinationAccId) return showAlert('Lỗi', 'Chưa chọn tài khoản đích!', 'warning');

        try {
            await axios.post('/api/move-user', {
                fromAccId: movingUser.fromAccId,
                toAccId: destinationAccId,
                userIndex: movingUser.userIndex
            });
            setShowMoveUserModal(false);
            setMovingUser(null);
            fetchData();
            broadcastDataChange();
            showAlert('Thành Công', `Đã chuyển khách sang tài khoản mới!`, 'success');
        } catch (error) {
            showAlert('Lỗi', error.response?.data?.error || 'Lỗi khi chuyển khách', 'error');
        }
    };

    const handleDeleteAccount = async () => {
        if (!deletingId) return;
        try {
            await axios.delete(`/api/chatgpt/${deletingId}`);
            setShowDeleteModal(false);
            setDeletingId(null);
            setShowEditModal(false);
            fetchData();
        } catch (error) { showAlert('Lỗi', 'Lỗi xóa: ' + error.message, 'error'); }
    };

    const handleTypeChange = async (acc, newType) => {
        if (acc.type === 'package1' && (acc.users?.length || 0) > 0) {
            if (newType !== 'package1') {
                showAlert("CHẶN THAO TÁC", "⚠️ Gói 1 đang có khách. Vui lòng xóa hết khách trước khi đổi gói!", "error");
                setAccounts(prev => [...prev]);
                const selectElement = document.getElementById(`select-type-${acc.id}`);
                if (selectElement) selectElement.value = 'package1';
                return;
            }
        }
        try {
            await axios.put(`/api/chatgpt/${acc.id}`, { type: newType });
            fetchData();
            broadcastDataChange();
        } catch (error) { showAlert('Lỗi', 'Lỗi đổi gói', 'error'); }
    };

    const handleCopy = (text) => navigator.clipboard.writeText(text);

    const handleBulkImportGPT = async () => {
        let raw = document.getElementById('bulkGPTData').value;
        if (!raw.trim()) return showAlert('Thiếu dữ liệu', 'Vui lòng dán dữ liệu vào ô trống!', 'warning');
        raw = raw.replace(/\[.*?\]/g, '\n');
        const btn = document.getElementById('btnImportGPT');
        const originalText = btn.innerText;
        btn.disabled = true; btn.innerText = 'Đang xử lý...';
        let successCount = 0; let errorCount = 0;
        const regex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[-]{3,}(.*?)[-]{3,}(http[s]?:\/\/[^\s]+)/g;
        let match; const foundMatches = [];
        while ((match = regex.exec(raw)) !== null) {
            foundMatches.push({ username: match[1].trim(), password: match[2].trim(), link: match[3].trim() });
        }
        if (foundMatches.length === 0) {
            const lines = raw.split('\n');
            for (const line of lines) {
                if (!line.trim() || line.includes('邮箱')) continue;
                const parts = line.split(/-{3,}/);
                if (parts.length >= 3) { foundMatches.push({ username: parts[0].trim(), password: parts[1].trim(), link: parts[2].trim() }); }
                else if (parts.length === 2) { foundMatches.push({ username: parts[0].trim(), password: parts[1].trim(), link: '' }); }
            }
        }
        for (const item of foundMatches) {
            if (item.username.length < 3 || item.password.length < 3) { errorCount++; continue; }
            // REMOVED 'note: Import Nhanh' as requested
            try { await axios.post('/api/chatgpt', { username: item.username, password: item.password, link: item.link, type: 'unassigned', note: '' }); successCount++; } catch (e) { errorCount++; }
        }
        showAlert('Hoàn Thành', `✅ Đã thêm: ${successCount}\n⚠️ Bỏ qua/Lỗi: ${errorCount}`, 'info');
        setShowImportGPTModal(false); btn.disabled = false; btn.innerText = originalText; fetchData();
    };

    const handleImportCoursera = async () => {
        setImportStatus(null);
        const scriptUrl = localStorage.getItem('appsScriptUrl') || 'https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec';
        const sheetName = document.getElementById('sheetNameInput').value;
        const raw = document.getElementById('bulkCourseraData').value;
        if (!raw.trim()) return showAlert('Thiếu dữ liệu', 'Chưa nhập dữ liệu import!', 'warning');
        const lines = raw.split('\n'); const parsedData = [];
        lines.forEach(line => {
            if (!line.trim()) return;
            let parts; if (line.includes(',')) parts = line.split(','); else if (line.includes('|')) parts = line.split('|'); else parts = [line];
            const email = parts[0]?.trim(); const pass = parts[1]?.trim() || ''; const sub = parts[2]?.trim() || '';
            if (email) parsedData.push([email, pass, sub]);
        });

        if (parsedData.length === 0) return showAlert('Lỗi Format', 'Không đọc được dòng nào hợp lệ!', 'error');

        showConfirm(
            "Xác Nhận Gửi",
            `Bạn có chắc muốn gửi ${parsedData.length} dòng này vào Sheet không?`,
            async () => {
                setImportingSheet(true);
                try {
                    await axios.post('/api/proxy-sheet', { scriptUrl: scriptUrl, sheetName, data: parsedData });
                    setImportStatus('success');
                    document.getElementById('bulkCourseraData').value = '';
                    showAlert('Thành Công', `✅ Đã gửi xong ${parsedData.length} dòng lên Google Sheet!`, 'success');
                    setTimeout(() => setImportStatus(null), 5000);
                } catch (e) {
                    console.error(e);
                    setImportStatus('error');
                    showAlert('Lỗi Gửi Sheet', (e.response?.data?.error || e.message), 'error');
                } finally {
                    setImportingSheet(false);
                }
            }
        );
    };

    // --- RENDER ---
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-200">
                <div className="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700 w-full max-w-md">
                    <div className="flex justify-center mb-6 text-blue-500">
                        <div className="w-20 h-20 bg-blue-900/30 rounded-full flex items-center justify-center">
                            <Lock size={40} />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold text-center mb-6 text-white">Đăng Nhập Quản Lý</h1>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Email</label>
                            <input
                                type="text"
                                className="form-input w-full"
                                placeholder="admin@example.com"
                                value={loginForm.email}
                                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-slate-400 mb-1">Mật khẩu</label>
                            <input
                                type="password"
                                className="form-input w-full"
                                placeholder="••••••••"
                                value={loginForm.password}
                                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                            />
                        </div>
                        <button type="submit" className="w-full btn-primary justify-center flex items-center gap-2 mt-4 py-3 text-lg">
                            <LogIn size={20} /> Đăng Nhập
                        </button>
                    </form>
                    {alertInfo.show && (
                        <div className={`mt-4 p-3 rounded text-center text-sm font-bold ${alertInfo.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
                            {alertInfo.message}
                        </div>
                    )}
                </div>

                {/* GLOBAL EXPIRY ALERT BANNER */}

            </div>
        );
    }

    // MAIN DASHBOARD
    return (
        <div className="min-h-screen text-slate-200 p-8 font-sans" style={{ backgroundColor: '#0f172a' }}>
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
                    <div className="mb-4 md:mb-0">
                        <h1 className="text-3xl font-bold" style={{
                            background: 'linear-gradient(to right, #60a5fa, #c084fc)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            fontSize: '2.5rem'
                        }}>
                            Quản Lý Tài Khoản
                        </h1>
                    </div>
                    <div className="flex bg-slate-900 p-1 rounded-3xl border border-slate-700 items-center">
                        <button onClick={() => setActiveTab('chatgpt')} className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === 'chatgpt' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
                            ChatGPT / Claude
                        </button>
                        <button onClick={() => setActiveTab('coursera')} className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === 'coursera' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>
                            Coursera Plus
                        </button>
                        <button onClick={handleLogout} className="ml-2 w-10 h-10 rounded-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white flex items-center justify-center transition-all" title="Đăng Xuất">
                            <LogIn size={18} className="transform rotate-180" />
                        </button>
                    </div>
                </div>

                {activeTab === 'chatgpt' && (
                    <div>
                        {/* GLOBAL EXPIRY / RESCUE BANNER */}
                        {(() => {
                            const urgentList = [];

                            accounts.forEach(acc => {
                                // 1. Check if ACCOUNT itself is expired
                                const isAccExpired = acc.expiredAt && new Date(acc.expiredAt) < new Date();
                                const hasUsers = acc.users && acc.users.length > 0;

                                if (hasUsers) {
                                    acc.users.forEach((u, idx) => {
                                        const days = getDaysUsed(u);
                                        const isUserExpired = days !== null && days >= 30;

                                        // Case A: User Expired -> Needs Extension
                                        if (isUserExpired) {
                                            urgentList.push({
                                                type: 'user_expired',
                                                acc, u, idx, days,
                                                msg: `Khách hết hạn (${days} ngày)`
                                            });
                                        }
                                        // Case B: Account Expired -> Needs Evacuation (Move)
                                        else if (isAccExpired) {
                                            urgentList.push({
                                                type: 'acc_expired',
                                                acc, u, idx, days,
                                                msg: 'CHATGPT ĐÃ HẾT HẠN - CẦN CHUYỂN GẤP!'
                                            });
                                        }
                                    });
                                } else if (isAccExpired) {
                                    // Case C: Account Expired & EMPTY -> Needs Deletion
                                    urgentList.push({
                                        type: 'acc_empty_expired',
                                        acc, u: { name: 'CHATGPT TRỐNG' }, idx: -1, days: 0,
                                        msg: 'ChatGpt hết hạn & Trống -> Cần Xóa!'
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
                                                <div key={i} className="flex items-center justify-between bg-slate-900/50 p-3 rounded border border-red-500/30">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-full ${type === 'acc_expired' ? 'bg-orange-500/20 text-orange-500' : 'bg-red-500/20 text-red-500'}`}>
                                                            {type === 'acc_expired' ? <Shield size={20} /> : <User size={20} />}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-red-400 text-lg">{u.name || u.email}</div>
                                                            <div className="text-xs text-slate-400">
                                                                Tài khoản: <span className="text-white">{acc.username}</span> •
                                                                <span className="text-red-500 font-bold ml-1">{msg}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-3">
                                                        {type === 'user_expired' ? (
                                                            // Action for Expired User: EXTEND
                                                            <>
                                                                <button
                                                                    onClick={() => handleExtendUser(acc.id, idx, u)}
                                                                    className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                                                >
                                                                    <RotateCw size={18} /> GIA HẠN
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteUser(acc.id, idx, u.name)}
                                                                    className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                                                >
                                                                    <Trash2 size={18} /> XÓA
                                                                </button>
                                                            </>
                                                        ) : type === 'acc_expired' ? (
                                                            // Action for Expired Account (With Users): MOVE USER (Rescue)
                                                            <button
                                                                onClick={() => openMoveUserModal(acc.id, idx, u)}
                                                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse"
                                                            >
                                                                <ArrowRightLeft size={18} /> CỨU USER (CHUYỂN GẤP)
                                                            </button>
                                                        ) : type === 'acc_empty_expired' ? (
                                                            // Action for Expired Account (Empty): DELETE ACCOUNT
                                                            <button
                                                                onClick={() => { setDeletingId(acc.id); setShowDeleteModal(true); }}
                                                                className="flex items-center gap-2 bg-red-800 hover:bg-red-600 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse border border-red-500"
                                                            >
                                                                <Trash2 size={18} /> XÓA CHATGPT RÁC NÀY
                                                            </button>
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
                            <div style={{ background: 'rgba(59, 130, 246, 0.1)', borderLeft: '4px solid #3b82f6' }} className="p-6 rounded-lg border border-blue-900/30">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="text-xl font-bold text-blue-400 mb-1">🔥 Gói 1 – Chia sẻ tiết kiệm</h3>
                                        <div className="text-2xl font-bold text-yellow-400 mb-3">50.000đ<span className="text-sm text-slate-400 font-normal">/tháng</span></div>
                                    </div>
                                    <div className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded text-xs font-bold">POPULAR</div>
                                </div>
                                <ul className="space-y-2 text-sm text-slate-300">
                                    <li>• 👥 1 tài khoản / 3 người dùng chung</li>
                                    <li>• ⚡ Cấp sẵn – vào dùng ngay</li>
                                    <li>• 🔒 Không đổi mật khẩu</li>
                                </ul>
                            </div>

                            <div style={{ background: 'rgba(139, 92, 246, 0.1)', borderLeft: '4px solid #8b5cf6' }} className="p-6 rounded-lg border border-purple-900/30">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="text-xl font-bold text-purple-400 mb-1">🔥 Gói 2 – Tài khoản linh hoạt</h3>
                                        <div className="text-2xl font-bold text-yellow-400 mb-3">100.000đ<span className="text-sm text-slate-400 font-normal">/tháng</span></div>
                                    </div>
                                    <div className="bg-purple-600/20 text-purple-300 px-3 py-1 rounded text-xs font-bold">PREMIUM</div>
                                </div>
                                <ul className="space-y-2 text-sm text-slate-300">
                                    <li>• 👤 Dùng 1 mình hoặc 👥 mua chung với bạn bè</li>
                                    <li>• 🔑 Toàn quyền đăng nhập</li>
                                    <li>• 🔄 Tự đổi mật khẩu</li>
                                </ul>
                            </div>
                        </div>

                        <div className="flex justify-end mb-4">
                            <button onClick={() => setShowImportGPTModal(true)} className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-semibold shadow-lg hover:translate-y-[-2px] transition-transform w-full md:w-auto justify-center">
                                <Upload size={18} /> Import Nhanh Tài Khoản
                            </button>
                        </div>

                        <div style={{
                            background: '#1e293b',
                            borderRadius: '20px',
                            padding: '0',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            border: '1px solid #334155',
                            overflow: 'hidden'
                        }}>
                            <div className="overflow-x-auto w-full">
                                <table className="legacy-table w-full border-collapse min-w-[800px]">
                                    <thead>
                                        <tr style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
                                            <th className="w-40">Loại Gói</th>
                                            <th>Thông Tin</th>
                                            <th className="w-32">Link Mail</th>
                                            <th className="w-64">Slot / Khách (Sửa/Xóa)</th>
                                            <th className="text-center w-24">Hành Động</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accounts.map(acc => (
                                            <tr key={acc.id} className="hover:bg-slate-800/50 transition-colors">
                                                <td className="align-top">
                                                    <select
                                                        id={`select-type-${acc.id}`}
                                                        value={acc.type}
                                                        onChange={(e) => handleTypeChange(acc, e.target.value)}
                                                        className={`
                                            w-full text-xs rounded px-2 py-2 outline-none font-bold border cursor-pointer appearance-none text-center
                                            ${acc.type === 'package1' ? 'bg-blue-900/40 text-blue-400 border-blue-700/50' :
                                                                acc.type === 'package2' ? 'bg-purple-900/40 text-purple-400 border-purple-700/50' :
                                                                    'bg-slate-800 text-slate-400 border-slate-700'}
                                        `}
                                                    >
                                                        <option value="unassigned">❓ Chọn Gói...</option>
                                                        <option value="package1">👥 Gói 1: Chia sẻ</option>
                                                        <option value="package2">🔒 Gói 2: Linh hoạt</option>
                                                    </select>
                                                </td>
                                                <td>
                                                    <div className="font-bold text-white mb-1 flex items-center gap-2 text-base">
                                                        <User size={16} className="text-slate-400" />
                                                        {acc.username}
                                                        <Copy size={16} className="cursor-pointer text-slate-500 hover:text-white" onClick={() => handleCopy(acc.username)} title="Copy Username" />
                                                    </div>
                                                    <div className="text-slate-400 flex items-center gap-2 font-mono text-sm">
                                                        <Shield size={14} className="text-slate-500" />
                                                        {acc.password}
                                                        <Copy size={14} className="cursor-pointer text-slate-500 hover:text-white" onClick={() => handleCopy(acc.password)} title="Copy Password" />
                                                    </div>
                                                    {acc.expiredAt && (
                                                        <div className={`text-xs mt-1 ml-6 ${getExpiryStatus(acc.expiredAt).color}`}>
                                                            <Calendar size={10} className="inline mr-1" />
                                                            {formatDate(acc.expiredAt)} {getExpiryStatus(acc.expiredAt).text}
                                                        </div>
                                                    )}
                                                    {acc.note && <div className="text-xs text-yellow-500/80 italic mt-1 ml-6">{acc.note}</div>}
                                                </td>
                                                <td>
                                                    {acc.link ? (
                                                        <a href={acc.link} target="_blank" className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-2 rounded-md font-bold no-underline inline-flex items-center gap-2 shadow-md transition-all hover:translate-y-[-1px]">
                                                            <Mail size={14} /> Mở Mail
                                                        </a>
                                                    ) : <span className="text-slate-600 text-xs">--</span>}
                                                </td>
                                                <td>
                                                    {acc.type === 'package1' ? (
                                                        <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                                            <div className="flex justify-between items-center text-xs mb-2 pb-1 border-b border-slate-700/50">
                                                                <span style={{ color: acc.users?.length >= 3 ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                                                                    {acc.users?.length || 0}/3 Slot
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openAddUserModal(acc.id)}
                                                                    disabled={acc.users?.length >= 3}
                                                                    className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    + Khách
                                                                </button>
                                                            </div>
                                                            <div className="space-y-1">
                                                                {acc.users?.map((u, index) => {
                                                                    const name = getUserName(u);
                                                                    const dateStr = getUserDate(u);
                                                                    const daysUsed = getDaysUsed(u);

                                                                    // EXPIRY LOGIC
                                                                    const isExpired = daysUsed !== null && daysUsed >= 30;
                                                                    const isNearExpiry = daysUsed !== null && daysUsed >= 27 && daysUsed < 30;

                                                                    return (
                                                                        <div key={index} className={`flex justify-between items-center text-xs p-2 rounded border mb-1 ${isExpired ? 'bg-red-900/20 border-red-700' : 'bg-slate-800 border-slate-700/50'}`}>
                                                                            <div className="flex flex-col">
                                                                                <span className={`font-bold truncate max-w-[120px] flex items-center gap-1 ${isExpired ? 'text-red-500' : isNearExpiry ? 'text-yellow-400' : 'text-white'}`} title={name}>
                                                                                    {isExpired && <AlertCircle size={12} />}
                                                                                    {isNearExpiry && <AlertTriangle size={12} />}
                                                                                    👤 {name}
                                                                                </span>
                                                                                {dateStr ? (
                                                                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                                                        <Calendar size={10} /> {dateStr}
                                                                                        {daysUsed !== null && daysUsed > 0 && (
                                                                                            <span className={isExpired ? 'text-red-400 font-bold' : isNearExpiry ? 'text-yellow-500 font-bold' : 'text-blue-400'}>
                                                                                                ({daysUsed}d)
                                                                                            </span>
                                                                                        )}
                                                                                    </span>
                                                                                ) : <span className="text-[10px] text-slate-600 italic">Chưa có ngày</span>}
                                                                            </div>
                                                                            <div className="flex gap-1">
                                                                                {/* EXTEND BUTTON (Only for Expired/Near Expiry) */}
                                                                                {(isExpired || isNearExpiry) && (
                                                                                    <button type="button" onClick={() => handleExtendUser(acc.id, index, u)} className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105" title="Gia hạn (+30 ngày)">
                                                                                        <RotateCw size={14} />
                                                                                    </button>
                                                                                )}

                                                                                {/* MOVE BUTTON (Blocked if Expired) */}
                                                                                {!isExpired ? (
                                                                                    <button type="button" onClick={() => openMoveUserModal(acc.id, index, u)} className="bg-orange-600 hover:bg-orange-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105" title="Chuyển khách">
                                                                                        <ArrowRightLeft size={14} />
                                                                                    </button>
                                                                                ) : (
                                                                                    <span className="text-gray-500 cursor-not-allowed bg-slate-700 p-1.5 rounded" title="Hết hạn: Không thể chuyển"><ArrowRightLeft size={14} /></span>
                                                                                )}

                                                                                <button type="button" onClick={() => openEditUserModal(acc.id, index, u)} className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105" title="Sửa tên">
                                                                                    <Pencil size={14} />
                                                                                </button>
                                                                                <button type="button" onClick={() => handleDeleteUser(acc.id, index, name)} className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105" title="Xóa người này">
                                                                                    <X size={14} />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    ) : acc.type === 'package2' ? (() => {
                                                        const u = acc.users?.[0];
                                                        const days = u ? getDaysUsed(u) : null;
                                                        const isExpired = days !== null && days >= 30;
                                                        const isNearExpiry = days !== null && days >= 27 && days < 30;

                                                        return (
                                                            <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                                                {acc.users?.length > 0 ? (
                                                                    <div className={`flex justify-between items-center text-sm font-bold p-1 rounded ${isExpired ? 'bg-red-900/20' : ''}`}>
                                                                        <div className={isExpired ? 'text-red-400' : 'text-white'}>
                                                                            <span className="flex items-center gap-2">
                                                                                {isExpired && <AlertCircle size={14} className="text-red-500" />}
                                                                                👤 {getUserName(u)}
                                                                            </span>
                                                                            <span className={`text-[10px] block ml-6 ${isExpired ? 'text-red-300' : 'text-slate-400'}`}>{getUserDate(u)}</span>
                                                                        </div>
                                                                        <div className="flex gap-2">
                                                                            {/* EXTEND BUTTON (Only for Expired/Near Expiry) */}
                                                                            {(isExpired || isNearExpiry) && (
                                                                                <button type="button" onClick={() => handleExtendUser(acc.id, 0, u)} className="text-green-400 hover:text-white" title="Gia hạn (+30 ngày)">
                                                                                    <RotateCw size={14} />
                                                                                </button>
                                                                            )}

                                                                            {/* MOVE BUTTON (Blocked if Expired) */}
                                                                            {!isExpired ? (
                                                                                <button type="button" onClick={() => openMoveUserModal(acc.id, 0, u)} className="text-orange-400 hover:text-white" title="Chuyển khách">
                                                                                    <ArrowRightLeft size={14} />
                                                                                </button>
                                                                            ) : (
                                                                                <span className="text-gray-600 cursor-not-allowed" title="Hết hạn: Không thể chuyển"><ArrowRightLeft size={14} /></span>
                                                                            )}

                                                                            <button type="button" onClick={() => openEditUserModal(acc.id, 0, u)} className="text-blue-400 hover:text-white"><Pencil size={14} /></button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <button type="button" onClick={() => openAddUserModal(acc.id)} className="w-full text-center text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300">Gán Khách</button>
                                                                )}
                                                            </div>
                                                        );
                                                    })() : <span className="text-yellow-600 text-xs italic">Chọn gói trước</span>}
                                                </td>
                                                <td className="text-center">
                                                    <div className="flex justify-center gap-2">
                                                        <button type="button" onClick={() => { setEditingAcc(acc); setShowEditModal(true); }} className="bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white p-2 rounded transition-colors" title="Sửa Tài Khoản">
                                                            <Pencil size={16} />
                                                        </button>
                                                        <button type="button" onClick={() => { setDeletingId(acc.id); setShowDeleteModal(true); }} className="bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white p-2 rounded transition-colors" title="Xóa Tài Khoản">
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
                )
                }

                {
                    activeTab === 'coursera' && (
                        <div className="space-y-6">
                            <details className="mb-2 p-2 rounded-lg border border-slate-700/50 cursor-pointer">
                                <summary className="text-xs text-slate-500">⚙️ Cấu hình Script</summary>
                                <div className="mt-2 text-xs">
                                    <input className="form-input text-xs font-mono text-slate-500"
                                        value={localStorage.getItem('appsScriptUrl') || 'https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec'}
                                        onChange={(e) => localStorage.setItem('appsScriptUrl', e.target.value)}
                                    />
                                </div>
                            </details>

                            <div style={{ background: '#1e293b', padding: '20px', borderRadius: '15px', border: '1px solid #334155' }}>
                                <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">📂 Import Coursera</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <div className="form-group mb-4">
                                            <label className="block text-slate-400 mb-1 text-sm">Tên Sheet (VD: Sp26)</label>
                                            <input id="sheetNameInput" className="form-input" placeholder="Ví dụ: Sp26" />
                                        </div>
                                        <div className="p-4 bg-yellow-900/10 border border-yellow-700/30 rounded-lg">
                                            <h4 className="text-yellow-500 text-sm font-bold mb-2 flex items-center gap-2"><AlertCircle size={16} /> Lưu ý Format</h4>
                                            <p className="text-xs text-slate-400">
                                                Nhập dữ liệu theo đúng định dạng:<br />
                                                <code className="text-white bg-slate-800 px-1 rounded">email,pass,mã_môn</code>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-slate-400 mb-1 text-sm">Dữ Liệu</label>
                                            <textarea id="bulkCourseraData" className="form-input h-32 font-mono text-xs"
                                                placeholder="user1@gmail.com,pass123,MATH101&#10;user2@gmail.com,pass456,ENW492c"></textarea>
                                        </div>
                                        <div>
                                            <button
                                                onClick={handleImportCoursera}
                                                disabled={importingSheet}
                                                className={`w-full flex justify-center items-center gap-2 p-3 rounded-lg font-bold transition-all ${importingSheet
                                                    ? 'bg-slate-600 cursor-not-allowed opacity-70'
                                                    : importStatus === 'success'
                                                        ? 'bg-green-600 hover:bg-green-500'
                                                        : 'btn-primary'
                                                    }`}
                                            >
                                                {importingSheet ? <><Loader2 size={18} className="animate-spin" /> Đang Gửi Dữ Liệu...</> : importStatus === 'success' ? <><CheckCircle size={18} /> Đã Gửi Thành Công!</> : <><ExternalLink size={16} /> Gửi Vào Sheet</>}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div style={{ background: '#1e293b', padding: '10px', borderRadius: '15px', border: '1px solid #334155' }}>
                                <div className="flex justify-between items-center mb-2 px-1">
                                    <label className="text-sm font-bold text-slate-400">Xem Trước Sheet:</label>
                                    <a href="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit" target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded shadow-sm transition-transform hover:translate-y-[-1px]">
                                        <ExternalLink size={12} /> Mở Full Màn Hình (Sửa Dễ Hơn)
                                    </a>
                                </div>
                                <div className="aspect-video w-full rounded-lg overflow-hidden bg-white border border-slate-600">
                                    <iframe src="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit?gid=1338679857&rm=minimal" className="w-full h-full" title="Coursera Sheet"></iframe>
                                </div>
                            </div>
                        </div>
                    )
                }

            </div >

            {
                alertInfo.show && (
                    <div className="modal-overlay" style={{ zIndex: 9999 }}>
                        <div className="modal-box text-center" style={{ maxWidth: '400px' }}>
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${alertInfo.type === 'error' ? 'bg-red-900/30 text-red-500' :
                                alertInfo.type === 'warning' ? 'bg-yellow-900/30 text-yellow-500' :
                                    alertInfo.type === 'confirm' ? 'bg-blue-900/30 text-blue-500' :
                                        'bg-green-900/30 text-green-500' // Success color
                                }`}>
                                {alertInfo.type === 'error' ? <AlertCircle size={32} /> :
                                    alertInfo.type === 'warning' ? <AlertTriangle size={32} /> :
                                        alertInfo.type === 'success' ? <CheckCircle size={32} /> :
                                            <Info size={32} />}
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">{alertInfo.title}</h3>
                            <p className="text-slate-300 mb-6 whitespace-pre-wrap">{alertInfo.message}</p>

                            {alertInfo.type === 'confirm' ? (
                                <div className="flex justify-center gap-3">
                                    <button onClick={closeAlert} className="btn-secondary">Hủy</button>
                                    <button onClick={executeConfirm} className="btn-primary bg-blue-600 hover:bg-blue-500">Đồng Ý</button>
                                </div>
                            ) : (
                                <button onClick={closeAlert} className="btn-primary w-full justify-center">Đã Hiểu</button>
                            )}
                        </div>
                    </div>
                )
            }



            {
                showMoveUserModal && movingUser && (
                    <div className="modal-overlay">
                        <form onSubmit={handleSubmitMoveUser} className="modal-box" style={{ maxWidth: '450px' }}>
                            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                <ArrowRightLeft className="text-orange-500" /> Chuyển Khách Hàng
                            </h2>

                            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
                                <div className="text-sm text-slate-400">Đang chuyển:</div>
                                <div className="font-bold text-lg text-white">👤 {getUserName(movingUser)}</div>
                                <div className="text-xs text-slate-500 mt-1">Tham gia: {movingUser.joinedAt ? new Date(movingUser.joinedAt).toLocaleDateString('vi-VN') : 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="text-orange-400 font-bold mb-1 block">Chọn Tài Khoản Đích (Còn trống)</label>
                                <select
                                    className="form-input w-full"
                                    value={destinationAccId}
                                    onChange={(e) => setDestinationAccId(e.target.value)}
                                    size={5} // List box style
                                    required
                                >
                                    <option value="" disabled>-- Chọn tài khoản --</option>
                                    {accounts
                                        .filter(a => a.id !== movingUser.fromAccId && // Not source
                                            a.type === 'package1' && // Only Shared Pkg
                                            (a.users?.length || 0) < 3 && // Has slots
                                            !getExpiryStatus(a.expiredAt).isExpired // STRICT: Must NOT be expired
                                        )
                                        .map(a => {
                                            const slots = a.users?.length || 0;
                                            const expiry = getExpiryStatus(a.expiredAt);
                                            // Truncate username if too long
                                            const displayUser = a.username.length > 25 ? a.username.substring(0, 22) + '...' : a.username;
                                            // Short Date
                                            const dateStr = a.expiredAt ? new Date(a.expiredAt).toLocaleDateString('vi-VN') : 'Vô hạn';

                                            return (
                                                <option key={a.id} value={a.id} className="py-2 border-b border-slate-700/50">
                                                    [{slots}/3] {displayUser} (Hết: {dateStr})
                                                </option>
                                            );
                                        })
                                    }
                                </select>
                                <p className="text-xs text-slate-500 mt-2 italic">* Chỉ hiện các tài khoản còn slot trống.</p>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button type="button" onClick={() => setShowMoveUserModal(false)} className="btn-secondary">Hủy</button>
                                <button type="submit" className="btn-primary bg-orange-600 hover:bg-orange-500">Xác Nhận Chuyển</button>
                            </div>
                        </form>
                    </div>
                )
            }

            {
                showUserModal && (
                    <div className="modal-overlay">
                        <form onSubmit={handleSubmitUser} className="modal-box" style={{ maxWidth: '400px' }}>
                            <h2 className="text-xl font-bold text-white mb-4">
                                {userModalMode === 'add' ? 'Thêm Khách Mới' : 'Sửa Tên Khách'}
                            </h2>

                            {/* EXPIRY WARNING */}
                            {userModalMode === 'add' && currentUserData.accId && (() => {
                                const acc = accounts.find(a => a.id === currentUserData.accId);
                                if (acc && acc.expiredAt) {
                                    const daysLeft = getExpiryStatus(acc.expiredAt).text;
                                    // Check simplistic days logic or re-calc
                                    const exp = new Date(acc.expiredAt);
                                    const now = new Date();
                                    const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

                                    if (diff < 30) {
                                        return (
                                            <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded flex gap-2 items-start">
                                                <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
                                                <div className="text-xs text-yellow-200">
                                                    <span className="font-bold block text-sm text-yellow-500">CẢNH BÁO HẠN DÙNG</span>
                                                    Tài khoản này chỉ còn <b>{diff} ngày</b> (&lt; 30 ngày).
                                                    <br />Khách mua tháng có thể bị gián đoạn!
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
                                    onChange={(e) => setCurrentUserData({ ...currentUserData, name: e.target.value })}
                                    placeholder="Nhập tên..."
                                />
                            </div>
                            <div className="form-group mt-3">
                                <label className="block text-slate-300 mb-2">
                                    Ngày Tham Gia
                                </label>
                                <input
                                    type="date"
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                                    value={currentUserData.joinedAt ? new Date(currentUserData.joinedAt).toISOString().split('T')[0] : ''}
                                    onChange={(e) => {
                                        setCurrentUserData({
                                            ...currentUserData,
                                            joinedAt: e.target.value ? new Date(e.target.value).toISOString() : null
                                        });
                                    }}
                                />
                            </div>


                            <div className="flex justify-end gap-3 mt-6">
                                <button type="button" onClick={() => setShowUserModal(false)} className="btn-secondary">Hủy</button>
                                <button type="submit" className="btn-primary">Lưu Lại</button>
                            </div>
                        </form>
                    </div>
                )
            }

            {
                (showAddModal || showEditModal) && (
                    <div className="modal-overlay">
                        <form onSubmit={showAddModal ? handleAddAccount : handleUpdateAccount} className="modal-box">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-white">{showAddModal ? 'Thêm Tài Khoản' : 'Sửa Tài Khoản'}</h2>
                                <span className="close" onClick={() => { setShowAddModal(false); setShowEditModal(false) }}>&times;</span>
                            </div>

                            <div className="form-group">
                                <label>Email / Username</label>
                                <input required className="form-input" value={showAddModal ? newAcc.username : editingAcc.username}
                                    onChange={e => showAddModal ? setNewAcc({ ...newAcc, username: e.target.value }) : setEditingAcc({ ...editingAcc, username: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Password</label>
                                <input required className="form-input" value={showAddModal ? newAcc.password : editingAcc.password}
                                    onChange={e => showAddModal ? setNewAcc({ ...newAcc, password: e.target.value }) : setEditingAcc({ ...editingAcc, password: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Loại Gói</label>
                                <select className="form-input" value={showAddModal ? newAcc.type : editingAcc.type}
                                    onChange={e => showAddModal ? setNewAcc({ ...newAcc, type: e.target.value }) : setEditingAcc({ ...editingAcc, type: e.target.value })}>
                                    <option value="unassigned">❓ Chưa xác định</option>
                                    <option value="package1">👥 Gói 1: Chia sẻ</option>
                                    <option value="package2">🔒 Gói 2: Linh hoạt</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Link Mail</label>
                                <input className="form-input" value={showAddModal ? newAcc.link : editingAcc.link}
                                    onChange={e => showAddModal ? setNewAcc({ ...newAcc, link: e.target.value }) : setEditingAcc({ ...editingAcc, link: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label>Ghi chú</label>
                                <input className="form-input" value={showAddModal ? newAcc.note : editingAcc.note}
                                    onChange={e => showAddModal ? setNewAcc({ ...newAcc, note: e.target.value }) : setEditingAcc({ ...editingAcc, note: e.target.value })} />
                            </div>

                            <div className="form-group mt-3">
                                <label className="block text-yellow-400 mb-2">
                                    Ngày Hết Hạn
                                </label>
                                <input
                                    type="date"
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                                    value={
                                        (showAddModal ? newAcc.expiredAt : editingAcc.expiredAt)
                                            ? new Date(showAddModal ? newAcc.expiredAt : editingAcc.expiredAt).toISOString().split('T')[0]
                                            : ''
                                    }
                                    onChange={e => {
                                        const val = e.target.value ? new Date(e.target.value).toISOString() : null;
                                        if (showAddModal) setNewAcc({ ...newAcc, expiredAt: val });
                                        else setEditingAcc({ ...editingAcc, expiredAt: val });
                                    }}
                                />
                            </div>

                            <div className="flex justify-end gap-3 mt-4">
                                <button type="button" onClick={() => { setShowAddModal(false); setShowEditModal(false) }} className="btn-secondary">Hủy</button>
                                <button type="submit" className="btn-primary">Lưu</button>
                            </div>
                        </form>
                    </div>
                )
            }

            {
                showDeleteModal && (
                    <div className="modal-overlay">
                        <div className="modal-box text-center">
                            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                                <Trash2 size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Xác nhận xóa?</h3>
                            <div className="flex justify-center gap-3 mt-6">
                                <button onClick={() => setShowDeleteModal(false)} className="btn-secondary">Hủy</button>
                                <button onClick={handleDeleteAccount} className="btn-primary" style={{ backgroundColor: '#ef4444' }}>Xóa Luôn</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                showImportGPTModal && (
                    <div className="modal-overlay">
                        <div className="modal-box" style={{ maxWidth: '600px' }}>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-white">Import ChatGPT Nhanh</h2>
                                <span className="close" onClick={() => setShowImportGPTModal(false)}>&times;</span>
                            </div>
                            <p className="text-slate-400 text-sm mb-2">
                                Dán dữ liệu: <code className="bg-slate-700 px-1 rounded">email----pass----link</code>
                            </p>
                            <textarea id="bulkGPTData" className="form-input h-64 font-mono text-xs"
                                placeholder="...
UCanPlus1669@purinikiopiy.asia---zxcvbnm666..----https://mail.chatgpt.org.uk/..."
                            ></textarea>
                            <div className="flex justify-end gap-3 mt-4">
                                <button onClick={() => setShowImportGPTModal(false)} className="btn-secondary">Hủy</button>
                                <button id="btnImportGPT" onClick={handleBulkImportGPT} className="btn-primary bg-purple-600 hover:bg-purple-500">Nhập Dữ Liệu</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
}

export default App;
