import { useState, useEffect, useRef } from "react";
import axios from "./axiosConfig";
import {
  Trash2,
  UserPlus,
  Pencil,
  Copy,
  ExternalLink,
  RefreshCw,
  X,
  Upload,
  Loader2,
  CheckCircle,
  Mail,
  User,
  Shield,
  AlertCircle,
  AlertTriangle,
  Info,
  Calendar,
  LogIn,
  Lock,
  FileSpreadsheet,
  ArrowRightLeft,
  RotateCw,
} from "lucide-react";

// Helper: Xóa dấu Tiếng Việt
const toNonAccentVietnamese = (str) => {
  if (!str) return "";
  str = str.toLowerCase();
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  // Some system encode vietnamese combining accent as individual utf-8 characters
  str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // Huyền, sắc, hỏi, ngã, nặng
  str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // Â, Ê, Ă, Ơ, Ư
  return str;
};

function App() {
  // LOGIN STATE
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  const [accounts, setAccounts] = useState([]);
  const [netflixAccounts, setNetflixAccounts] = useState([]);
  const [canvaAccounts, setCanvaAccounts] = useState([]);
  const [capcutAccounts, setCapcutAccounts] = useState([]);
  const [showSimpleAddModal, setShowSimpleAddModal] = useState(false);
  const [simpleAddPlatform, setSimpleAddPlatform] = useState("netflix");
  const [simpleAddForm, setSimpleAddForm] = useState({ username: "", password: "", duration: "1M", note: "", customerName: "" });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chatgpt");
  const [searchQuery, setSearchQuery] = useState("");

  // Loading states for buttons

  const [showAssignUserModal, setShowAssignUserModal] = useState(false);
  const [showSimpleEditModal, setShowSimpleEditModal] = useState(false);
  const [simpleEditForm, setSimpleEditForm] = useState({ id: "", username: "", password: "", duration: "1M", note: "", expiredAt: "" });
  const [assignUserAcc, setAssignUserAcc] = useState(null);
  const [assignUserName, setAssignUserName] = useState("");

  const [loadingStates, setLoadingStates] = useState({
    addUser: false,
    editUser: false,
    deleteUser: false,
    moveUser: false,
    extendUser: false,
    addAccount: false,
    editAccount: false,
    deleteAccount: false,
    changeType: {},
  });

  // BroadcastChannel for real-time sync between tabs
  const channelRef = useRef(null);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImportGPTModal, setShowImportGPTModal] = useState(false);

  // CUSTOM ALERT & CONFIRM MODAL
  const [alertInfo, setAlertInfo] = useState({
    show: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: null,
  });

  // User Input Modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalMode, setUserModalMode] = useState("add");
  const [currentUserData, setCurrentUserData] = useState({
    accId: null,
    index: null,
    name: "",
    joinedAt: null,
  });

  // Move User State
  const [showMoveUserModal, setShowMoveUserModal] = useState(false);
  const [movingUser, setMovingUser] = useState(null); // { fromAccId, userIndex, name, joinedAt }
  const [destinationAccId, setDestinationAccId] = useState("");

  // Orphaned Users Modal (when deleting account with active users)
  const [showOrphanedUsersModal, setShowOrphanedUsersModal] = useState(false);
  const [orphanedUsers, setOrphanedUsers] = useState([]);

  // Import State
  const [importingSheet, setImportingSheet] = useState(false);
  const [importStatus, setImportStatus] = useState(null);

  // Edit/Delete States
  const [editingAcc, setEditingAcc] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [newAcc, setNewAcc] = useState({
    username: "",
    password: "",
    link: "",
    type: "unassigned",
    note: "",
  });

  // CHECK LOGIN ON LOAD - Verify token from localStorage
  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    const expiresAt = localStorage.getItem("token_expires_at");

    if (token && expiresAt) {
      // Check if token is still valid
      const expiryTime = new Date(expiresAt).getTime();
      const now = Date.now();

      if (now < expiryTime) {
        // Token still valid
        setIsAuthenticated(true);
        setTimeout(() => fetchData(), 100);
      } else {
        // Token expired, clear storage
        localStorage.removeItem("admin_token");
        localStorage.removeItem("token_expires_at");
        showAlert(
          "Phiên hết hạn",
          "Token đã hết hạn. Vui lòng đăng nhập lại.",
          "error",
        );
      }
    }
  }, []);

  // BROADCAST CHANNEL for real-time sync between tabs/windows
  useEffect(() => {
    if (!isAuthenticated) return;

    // Create broadcast channel
    const channel = new BroadcastChannel("data-sync-channel");
    channelRef.current = channel;

    // Listen for updates from other tabs
    channel.onmessage = (event) => {
      if (event.data.type === "DATA_UPDATED") {
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
      channelRef.current.postMessage({
        type: "DATA_UPDATED",
        timestamp: Date.now(),
      });
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

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAuthenticated]);

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      // Backend authentication
      const response = await axios.post("/api/login", {
        email: loginForm.email.toLowerCase(),
        password: loginForm.password,
      });

      if (response.data.success) {
        localStorage.setItem("admin_token", response.data.token);
        localStorage.setItem("token_expires_at", response.data.expiresAt);
        setIsAuthenticated(true);
        fetchData();
        showAlert(
          "Xin chào",
          response.data.message || "Đăng nhập thành công! 👋",
          "success",
        );
      } else {
        showAlert("Lỗi", "Sai email hoặc mật khẩu!", "error");
      }
    } catch (error) {
      if (error.response?.status === 401) {
        showAlert(
          "Lỗi",
          error.response?.data?.message || "Sai email hoặc mật khẩu!",
          "error",
        );
      } else {
        showAlert("Lỗi", "Không thể kết nối đến server!", "error");
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    setIsAuthenticated(false);
    setLoginForm({ email: "", password: "" });
  };

  // HELPER SHOW ALERT / CONFIRM
  const showAlert = (title, message, type = "info") => {
    setAlertInfo({ show: true, title, message, type, onConfirm: null });
  };

  const showConfirm = (title, message, onConfirmAction) => {
    setAlertInfo({
      show: true,
      title,
      message,
      type: "confirm",
      onConfirm: onConfirmAction,
    });
  };

  const closeAlert = () => {
    setAlertInfo({ ...alertInfo, show: false, onConfirm: null });
  };

  const executeConfirm = () => {
    if (alertInfo.onConfirm) alertInfo.onConfirm();
    closeAlert();
  };

  // Helper to safely get user name
  const getUserName = (u) => (typeof u === "object" && u !== null ? u.name : u);

  // Helper to get joined date display
  const getUserDate = (u) => {
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const date = new Date(u.joinedAt);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
      } catch (e) {
        return "";
      }
    }
    return "";
  };

  // Helper to calculate days used
  const getDaysUsed = (u) => {
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const start = new Date(u.joinedAt);
        const now = new Date();
        const diffTime = now - start;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
      } catch (e) {
        return 0;
      }
    }
    return null;
  };

  // Helper to calculate days remaining (positive = còn hạn, âm = đã quá hạn)
  const getDaysRemaining = (u) => {
    const used = getDaysUsed(u);
    if (used === null) return null;
    return 30 - used; // Có thể > 30 sau khi gia hạn
  };

  // Helper: tính ngày hết hạn của khách = joinedAt + 30 ngày
  const getUserExpiryDate = (u) => {
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const d = new Date(new Date(u.joinedAt).getTime() + 30 * 24 * 60 * 60 * 1000);
        return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      } catch (e) { return ""; }
    }
    return "";
  };

  // Helper to format Date
  const formatDate = (isoString) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    } catch (e) {
      return "";
    }
  };

  // Helper to check expiry warning
  const getExpiryStatus = (isoString) => {
    if (!isoString)
      return { text: "", color: "text-slate-500", isExpired: false };
    const exp = new Date(isoString);
    const now = new Date();
    const diffTime = exp - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0)
      return {
        text: `Đã hết hạn ${Math.abs(diffDays)} ngày`,
        color: "text-red-500 font-bold",
        isExpired: true,
      };
    if (diffDays <= 3)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-red-400 font-bold",
        isExpired: false,
      };
    if (diffDays <= 7)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-yellow-400 font-bold",
        isExpired: false,
      };
    return {
      text: `Còn ${diffDays} ngày`,
      color: "text-emerald-500",
      isExpired: false,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/data", {
        timeout: 10000,
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.data && res.data.chatgpt) {
        const typeOrder = { package1: 0, package2: 1, unassigned: 2 };
        const sortedGPT = res.data.chatgpt.sort((a, b) => {
          const orderA = typeOrder[a.type] ?? 99;
          const orderB = typeOrder[b.type] ?? 99;
          if (orderA !== orderB) return orderA - orderB;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });
        setAccounts(sortedGPT);
      } else {
        setAccounts([]);
      }
      const sortA = (arr) => [...(arr || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setNetflixAccounts(sortA(res.data?.netflix));
      setCanvaAccounts(sortA(res.data?.canva));
      setCapcutAccounts(sortA(res.data?.capcut));

    } catch (error) {
      showAlert("Lỗi", "Không thể tải dữ liệu. Vui lòng thử lại.", "error");
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    setLoadingStates((prev) => ({ ...prev, addAccount: true }));
    try {
      await axios.post("/api/chatgpt", newAcc);
      setShowAddModal(false);
      setNewAcc({
        username: "",
        password: "",
        link: "",
        type: "unassigned",
        note: "",
      });
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Error", "Lỗi khi thêm tài khoản", "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, addAccount: false }));
    }
  };

  const openAddUserModal = (accId) => {
    setUserModalMode("add");
    setCurrentUserData({ accId, index: null, name: "", joinedAt: null });
    setShowUserModal(true);
  };

  const openEditUserModal = (accId, index, userData) => {
    setUserModalMode("edit");
    const name = getUserName(userData);
    const joinedAt =
      typeof userData === "object" && userData.joinedAt
        ? userData.joinedAt
        : null;
    setCurrentUserData({ accId, index, name, joinedAt });
    setShowUserModal(true);
  };

  const handleSubmitUser = async (e) => {
    e.preventDefault();
    const { accId, index, name, joinedAt } = currentUserData;
    if (!name.trim())
      return showAlert("Thông báo", "Tên không được để trống!", "warning");

    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return;

    let newUsers = [...(acc.users || [])];

    if (userModalMode === "add") {
      if (acc.type === "package1" && newUsers.length >= 3)
        return showAlert("Giới hạn", "Gói này đã đủ 3 Slot!", "warning");

      if (acc.type === "package2" && newUsers.length >= 1)
        return showAlert("Giới hạn", "Gói Private chỉ được 1 khách hàng!", "warning");

      newUsers.push({
        name: name.trim(),
        joinedAt: new Date().toISOString(),
      });
    } else {
      const oldJoinDate =
        joinedAt ||
        (typeof newUsers[index] === "object" ? newUsers[index].joinedAt : null);
      newUsers[index] = {
        name: name.trim(),
        joinedAt: oldJoinDate,
      };
    }

    const loadingKey = userModalMode === "add" ? "addUser" : "editUser";
    setLoadingStates((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      await axios.put(`/api/chatgpt/${accId}`, { users: newUsers });
      setShowUserModal(false);
      fetchData();
      broadcastDataChange();
    } catch (err) {
      showAlert("Lỗi", "Không lưu được khách hàng", "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleDeleteUser = (accId, userIndex, userName) => {
    showConfirm(
      "Xác Nhận Xóa",
      `Bạn có chắc muốn xóa khách hàng: ${userName}?`,
      async () => {
        const acc = accounts.find((a) => a.id === accId);
        if (!acc) return;
        const newUsers = acc.users.filter((_, i) => i !== userIndex);
        setLoadingStates((prev) => ({ ...prev, deleteUser: true }));
        try {
          await axios.put(`/api/chatgpt/${accId}`, { users: newUsers });
          fetchData();
          broadcastDataChange();
        } catch (err) {
          showAlert("Lỗi", "Lỗi xóa khách", "error");
        } finally {
          setLoadingStates((prev) => ({ ...prev, deleteUser: false }));
        }
      },
    );
  };

  // EXTEND USER logic
  const handleExtendUser = async (accId, userIndex, userObj) => {
    const userName = userObj?.name || userObj || "khách này";

    showConfirm(
      "Xác nhận gia hạn",
      `Bạn có chắc muốn gia hạn cho ${userName} thêm 30 ngày không?`,
      async () => {
        setLoadingStates((prev) => ({ ...prev, extendUser: true }));
        try {
          await axios.post("/api/extend-user", { accId, userIndex });
          fetchData();
          broadcastDataChange();
          showAlert(
            "Thành Công",
            "Đã gia hạn khách hàng (+30 ngày)!",
            "success",
          );
        } catch (error) {
          showAlert(
            "Lỗi",
            error.response?.data?.error || "Không thể gia hạn",
            "error",
          );
        } finally {
          setLoadingStates((prev) => ({ ...prev, extendUser: false }));
        }
      },
    );
  };

  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    const originalAcc = accounts.find((a) => a.id === editingAcc.id);
    if (!originalAcc) return;

    if (
      originalAcc.type === "package1" &&
      (originalAcc.users?.length || 0) > 0
    ) {
      if (editingAcc.type !== "package1") {
        showAlert(
          "CHẶN SỬA ĐỔI",
          "⚠️ Gói 1 đang có khách. Không thể đổi gói khi chưa xóa khách!",
          "error",
        );
        return;
      }
    }

    setLoadingStates((prev) => ({ ...prev, editAccount: true }));
    try {
      await axios.put(`/api/chatgpt/${editingAcc.id}`, editingAcc);
      setShowEditModal(false);
      setEditingAcc(null);
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Lỗi", "Lỗi cập nhật", "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, editAccount: false }));
    }
  };

  // MOVE USER LOGIC
  const openMoveUserModal = (accId, index, userData) => {
    setMovingUser({ fromAccId: accId, userIndex: index, ...userData });
    setDestinationAccId("");
    setShowMoveUserModal(true);
  };

  const handleSubmitMoveUser = async (e) => {
    e.preventDefault();
    if (!destinationAccId)
      return showAlert("Lỗi", "Chưa chọn tài khoản đích!", "warning");

    setLoadingStates((prev) => ({ ...prev, moveUser: true }));
    try {
      await axios.post("/api/move-user", {
        fromAccId: movingUser.fromAccId,
        toAccId: destinationAccId,
        userIndex: movingUser.userIndex,
      });
      setShowMoveUserModal(false);
      setMovingUser(null);
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã chuyển khách sang tài khoản mới!`, "success");
    } catch (error) {
      showAlert(
        "Lỗi",
        error.response?.data?.error || "Lỗi khi chuyển khách",
        "error",
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, moveUser: false }));
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingId) return;

    // Check if account has active users (not expired)
    const accToDelete = accounts.find((a) => a.id === deletingId);

    if (accToDelete && accToDelete.users && accToDelete.users.length > 0) {
      const activeUsers = [];

      accToDelete.users.forEach((u, idx) => {
        // Check if user object has name (valid user)
        if (typeof u === "object" && u !== null && u.name) {
          const days = getDaysUsed(u);

          // User còn hạn nếu:
          // - Có joinedAt và daysUsed < 30
          // - Hoặc không có joinedAt (mới thêm, chưa set ngày) -> coi như còn hạn
          const isActive =
            (days !== null && days < 30) ||
            u.joinedAt === null ||
            u.joinedAt === undefined;

          if (isActive) {
            activeUsers.push({
              ...u,
              fromAccId: accToDelete.id,
              userIndex: idx,
              accountUsername: accToDelete.username,
              daysUsed: days !== null ? days : 0,
            });
          }
        }
      });

      if (activeUsers.length > 0) {
        // Có user còn hạn - không cho xóa, hiện modal
        setShowDeleteModal(false);
        setOrphanedUsers(activeUsers);
        setShowOrphanedUsersModal(true);
        return;
      }

      // Chỉ có users hết hạn hoặc không có users - cho phép xóa
    }

    // Không có user còn hạn - cho phép xóa (tự động xóa luôn cả expired users)
    setLoadingStates((prev) => ({ ...prev, deleteAccount: true }));
    try {
      await axios.delete(`/api/chatgpt/${deletingId}`);
      setShowDeleteModal(false);
      setDeletingId(null);
      setShowEditModal(false);
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Lỗi", "Lỗi xóa: " + error.message, "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, deleteAccount: false }));
    }
  };

  const handleTypeChange = async (acc, newType) => {
    if (acc.type === "package1" && (acc.users?.length || 0) > 0) {
      if (newType !== "package1") {
        showAlert(
          "CHẶN THAO TÁC",
          "⚠️ Gói 1 đang có khách. Vui lòng xóa hết khách trước khi đổi gói!",
          "error",
        );
        setAccounts((prev) => [...prev]);
        const selectElement = document.getElementById(`select-type-${acc.id}`);
        if (selectElement) selectElement.value = "package1";
        return;
      }
    }
    setLoadingStates((prev) => ({
      ...prev,
      changeType: { ...prev.changeType, [acc.id]: true },
    }));
    try {
      await axios.put(`/api/chatgpt/${acc.id}`, { type: newType });
      fetchData();
      broadcastDataChange();
    } catch (error) {
      showAlert("Lỗi", "Lỗi đổi gói", "error");
    } finally {
      setLoadingStates((prev) => ({
        ...prev,
        changeType: { ...prev.changeType, [acc.id]: false },
      }));
    }
  };

  const handleCopy = (text) => navigator.clipboard.writeText(text);

  const handleBulkImportGPT = async () => {
    let raw = document.getElementById("bulkGPTData").value;
    if (!raw.trim())
      return showAlert(
        "Thiếu dữ liệu",
        "Vui lòng dán dữ liệu vào ô trống!",
        "warning",
      );
    raw = raw.replace(/\[.*?\]/g, "\n");
    const btn = document.getElementById("btnImportGPT");
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Đang xử lý...";
    let successCount = 0;
    let errorCount = 0;
    const regex =
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[-]{3,}(.*?)[-]{3,}(http[s]?:\/\/[^\s]+)/g;
    let match;
    const foundMatches = [];
    while ((match = regex.exec(raw)) !== null) {
      foundMatches.push({
        username: match[1].trim(),
        password: match[2].trim(),
        link: match[3].trim(),
      });
    }
    if (foundMatches.length === 0) {
      const lines = raw.split("\n");
      for (const line of lines) {
        if (!line.trim() || line.includes("邮箱")) continue;
        const parts = line.split(/-{3,}/);
        if (parts.length >= 3) {
          foundMatches.push({
            username: parts[0].trim(),
            password: parts[1].trim(),
            link: parts[2].trim(),
          });
        } else if (parts.length === 2) {
          foundMatches.push({
            username: parts[0].trim(),
            password: parts[1].trim(),
            link: "",
          });
        }
      }
    }
    for (const item of foundMatches) {
      if (item.username.length < 3 || item.password.length < 3) {
        errorCount++;
        continue;
      }
      // REMOVED 'note: Import Nhanh' as requested
      try {
        await axios.post("/api/chatgpt", {
          username: item.username,
          password: item.password,
          link: item.link,
          type: "unassigned",
          note: "",
        });
        successCount++;
      } catch (e) {
        errorCount++;
      }
    }
    showAlert(
      "Hoàn Thành",
      `✅ Đã thêm: ${successCount}\n⚠️ Bỏ qua/Lỗi: ${errorCount}`,
      "info",
    );
    setShowImportGPTModal(false);
    btn.disabled = false;
    btn.innerText = originalText;
    fetchData();
  };

  const handleImportCoursera = async () => {
    setImportStatus(null);
    const scriptUrl =
      localStorage.getItem("appsScriptUrl") ||
      "https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec";
    const sheetName = document.getElementById("sheetNameInput").value;
    const raw = document.getElementById("bulkCourseraData").value;
    if (!raw.trim())
      return showAlert("Thiếu dữ liệu", "Chưa nhập dữ liệu import!", "warning");
    const lines = raw.split("\n");
    const parsedData = [];
    lines.forEach((line) => {
      if (!line.trim()) return;
      let parts;
      if (line.includes(",")) parts = line.split(",");
      else if (line.includes("|")) parts = line.split("|");
      else parts = [line];
      const email = parts[0]?.trim();
      const pass = parts[1]?.trim() || "";
      const sub = parts[2]?.trim() || "";
      if (email) parsedData.push([email, pass, sub]);
    });

    if (parsedData.length === 0)
      return showAlert(
        "Lỗi Format",
        "Không đọc được dòng nào hợp lệ!",
        "error",
      );

    showConfirm(
      "Xác Nhận Gửi",
      `Bạn có chắc muốn gửi ${parsedData.length} dòng này vào Sheet không?`,
      async () => {
        setImportingSheet(true);
        try {
          await axios.post("/api/proxy-sheet", {
            scriptUrl: scriptUrl,
            sheetName,
            data: parsedData,
          });
          setImportStatus("success");
          document.getElementById("bulkCourseraData").value = "";
          showAlert(
            "Thành Công",
            `✅ Đã gửi xong ${parsedData.length} dòng lên Google Sheet!`,
            "success",
          );
          setTimeout(() => setImportStatus(null), 5000);
        } catch (e) {
          setImportStatus("error");
          showAlert(
            "Lỗi Gửi Sheet",
            e.response?.data?.error || e.message,
            "error",
          );
        } finally {
          setImportingSheet(false);
        }
      },
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
          <h1 className="text-2xl font-bold text-center mb-6 text-white">
            Đăng Nhập Quản Lý
          </h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input
                type="text"
                className="form-input w-full"
                placeholder="admin@example.com"
                value={loginForm.email}
                onChange={(e) =>
                  setLoginForm({ ...loginForm, email: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">
                Mật khẩu
              </label>
              <input
                type="password"
                className="form-input w-full"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={(e) =>
                  setLoginForm({ ...loginForm, password: e.target.value })
                }
              />
            </div>
            <button
              type="submit"
              className="w-full btn-primary justify-center flex items-center gap-2 mt-4 py-3 text-lg"
            >
              <LogIn size={20} /> Đăng Nhập
            </button>
          </form>
          {alertInfo.show && (
            <div
              className={`mt-4 p-3 rounded text-center text-sm font-bold ${alertInfo.type === "error" ? "bg-red-900/50 text-red-400" : "bg-green-900/50 text-green-400"}`}
            >
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
    <div
      className="min-h-screen text-slate-200 p-8 font-sans"
      style={{ backgroundColor: "#0f172a" }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-800 p-6 rounded-xl shadow-lg border border-slate-700">
          <div className="mb-4 md:mb-0">
            <h1
              className="text-3xl font-bold"
              style={{
                background: "linear-gradient(to right, #60a5fa, #c084fc)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                fontSize: "2.5rem",
              }}
            >
              Quản Lý Tài Khoản
            </h1>
          </div>
          <div className="flex bg-slate-900 p-1 rounded-3xl border border-slate-700 items-center">
            <button
              onClick={() => setActiveTab("chatgpt")}
              className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "chatgpt" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              ChatGPT / Claude
            </button>
            <button
              onClick={() => setActiveTab("netflix")}
              className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "netflix" ? "bg-red-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Netflix
            </button>
            <button
              onClick={() => setActiveTab("capcut")}
              className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "capcut" ? "bg-green-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              CapCut
            </button>
            <button
              onClick={() => setActiveTab("canva")}
              className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "canva" ? "bg-purple-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Canva
            </button>
            <button
              onClick={() => setActiveTab("coursera")}
              className={`px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "coursera" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Coursera Plus
            </button>
            <button
              onClick={handleLogout}
              className="ml-2 w-10 h-10 rounded-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white flex items-center justify-center transition-all"
              title="Đăng Xuất"
            >
              <LogIn size={18} className="transform rotate-180" />
            </button>
          </div>
        </div>

        {activeTab === "chatgpt" && (
          <div>
            {/* GLOBAL EXPIRY / RESCUE BANNER */}
            {(() => {
              const urgentList = [];

              accounts.forEach((acc) => {
                // 1. Check if ACCOUNT itself is expired
                const isAccExpired =
                  acc.expiredAt && new Date(acc.expiredAt) < new Date();
                const hasUsers = acc.users && acc.users.length > 0;

                if (hasUsers) {
                  acc.users.forEach((u, idx) => {
                    const days = getDaysUsed(u);
                    const daysRemaining = getDaysRemaining(u);
                    const isUserExpired = daysRemaining !== null && daysRemaining <= 0;

                    // Case A: User Expired -> Needs Extension
                    if (isUserExpired) {
                      urgentList.push({
                        type: "user_expired",
                        acc,
                        u,
                        idx,
                        days,
                        msg: `Khách hết hạn (${Math.abs(daysRemaining)} ngày quá hạn)`,
                      });
                    }
                    // Case B: Account Expired -> Needs Evacuation (Move)
                    else if (isAccExpired) {
                      urgentList.push({
                        type: "acc_expired",
                        acc,
                        u,
                        idx,
                        days,
                        msg: "CHATGPT ĐÃ HẾT HẠN - CẦN CHUYỂN GẤP!",
                      });
                    }
                  });
                } else if (isAccExpired) {
                  // Case C: Account Expired & EMPTY -> Needs Deletion
                  urgentList.push({
                    type: "acc_empty_expired",
                    acc,
                    u: { name: "CHATGPT TRỐNG" },
                    idx: -1,
                    days: 0,
                    msg: "ChatGpt hết hạn & Trống -> Cần Xóa!",
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
                        <div
                          key={i}
                          className="flex items-center justify-between bg-slate-900/50 p-3 rounded border border-red-500/30"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-full ${type === "acc_expired" ? "bg-orange-500/20 text-orange-500" : "bg-red-500/20 text-red-500"}`}
                            >
                              {type === "acc_expired" ? (
                                <Shield size={20} />
                              ) : (
                                <User size={20} />
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-red-400 text-lg">
                                {u.name || u.email}
                              </div>
                              <div className="text-xs text-slate-400">
                                Tài khoản:{" "}
                                <span className="text-white">
                                  {acc.username}
                                </span>{" "}
                                •
                                <span className="text-red-500 font-bold ml-1">
                                  {msg}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {type === "user_expired" ? (
                              // Action for Expired User: EXTEND
                              <>
                                <button
                                  onClick={() =>
                                    handleExtendUser(acc.id, idx, u)
                                  }
                                  className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <RotateCw size={18} /> GIA HẠN
                                </button>
                                <button
                                  onClick={() =>
                                    handleDeleteUser(acc.id, idx, u.name)
                                  }
                                  className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <Trash2 size={18} /> XÓA
                                </button>
                              </>
                            ) : type === "acc_expired" ? (
                              // Action for Expired Account (With Users): MOVE USER (Rescue)
                              <button
                                onClick={() =>
                                  openMoveUserModal(acc.id, idx, u)
                                }
                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse"
                              >
                                <ArrowRightLeft size={18} /> CỨU USER (CHUYỂN
                                GẤP)
                              </button>
                            ) : type === "acc_empty_expired" ? (
                              // Action for Expired Account (Empty): DELETE ACCOUNT
                              <button
                                onClick={() => {
                                  setDeletingId(acc.id);
                                  setShowDeleteModal(true);
                                }}
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
              <div
                style={{
                  background: "rgba(59, 130, 246, 0.1)",
                  borderLeft: "4px solid #3b82f6",
                }}
                className="p-6 rounded-lg border border-blue-900/30"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-blue-400 mb-1">
                      🔥 Gói 1 – Chia sẻ tiết kiệm
                    </h3>
                    <div className="text-2xl font-bold text-yellow-400 mb-3">
                      50.000đ
                      <span className="text-sm text-slate-400 font-normal">
                        /tháng
                      </span>
                    </div>
                  </div>
                  <div className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded text-xs font-bold">
                    POPULAR
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>• 👥 1 tài khoản / 3 người dùng chung</li>
                  <li>• ⚡ Cấp sẵn – vào dùng ngay</li>
                  <li>• 🔒 Không đổi mật khẩu</li>
                </ul>
              </div>

              <div
                style={{
                  background: "rgba(139, 92, 246, 0.1)",
                  borderLeft: "4px solid #8b5cf6",
                }}
                className="p-6 rounded-lg border border-purple-900/30"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-purple-400 mb-1">
                      🔥 Gói 2 – Tài khoản linh hoạt
                    </h3>
                    <div className="text-2xl font-bold text-yellow-400 mb-3">
                      100.000đ
                      <span className="text-sm text-slate-400 font-normal">
                        /tháng
                      </span>
                    </div>
                  </div>
                  <div className="bg-purple-600/20 text-purple-300 px-3 py-1 rounded text-xs font-bold">
                    PREMIUM
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>• 👤 Dùng 1 mình hoặc 👥 mua chung với bạn bè</li>
                  <li>• 🔑 Toàn quyền đăng nhập</li>
                  <li>• 🔄 Tự đổi mật khẩu</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4 justify-between mb-4">
              <div className="flex-1 max-w-md">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="🔍 Tìm kiếm theo email hoặc tên khách..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowImportGPTModal(true)}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-semibold shadow-lg hover:translate-y-[-2px] transition-transform justify-center"
              >
                <Upload size={18} /> Import Nhanh Tài Khoản
              </button>
            </div>

            <div
              style={{
                background: "#1e293b",
                borderRadius: "20px",
                padding: "0",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                border: "1px solid #334155",
                overflow: "hidden",
              }}
            >
              <div className="overflow-x-auto w-full">
                <table className="legacy-table w-full border-collapse min-w-[800px]">
                  <thead>
                    <tr style={{ background: "rgba(15, 23, 42, 0.6)" }}>
                      <th className="w-40">Loại Gói</th>
                      <th>Thông Tin</th>
                      <th className="w-32">Link Mail</th>
                      <th className="w-64">Slot / Khách (Sửa/Xóa)</th>
                      <th className="text-center w-24">Hành Động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts
                      .filter((acc) => {
                        if (!searchQuery.trim()) return true;
                        const queryNormalized =
                          toNonAccentVietnamese(searchQuery);

                        // Tìm theo email (normalized)
                        if (
                          acc.username &&
                          toNonAccentVietnamese(acc.username).includes(
                            queryNormalized,
                          )
                        ) {
                          return true;
                        }

                        // Tìm theo tên khách hàng (normalized)
                        if (acc.users && acc.users.length > 0) {
                          return acc.users.some((user) => {
                            const name =
                              typeof user === "object" ? user.name : user;
                            return (
                              name &&
                              toNonAccentVietnamese(name).includes(
                                queryNormalized,
                              )
                            );
                          });
                        }

                        return false;
                      })
                      .map((acc) => (
                        <tr
                          key={acc.id}
                          className="hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="align-top">
                            <select
                              id={`select-type-${acc.id}`}
                              value={acc.type}
                              onChange={(e) =>
                                handleTypeChange(acc, e.target.value)
                              }
                              disabled={loadingStates.changeType[acc.id]}
                              className={`
                                            w-full text-xs rounded px-2 py-2 outline-none font-bold border cursor-pointer appearance-none text-center
                                            ${loadingStates.changeType[acc.id] ? "opacity-50 cursor-wait" : ""}
                                            ${acc.type === "package1"
                                  ? "bg-blue-900/40 text-blue-400 border-blue-700/50"
                                  : acc.type === "package2"
                                    ? "bg-purple-900/40 text-purple-400 border-purple-700/50"
                                    : "bg-slate-800 text-slate-400 border-slate-700"
                                }
                                        `}
                            >
                              <option value="unassigned">❓ Chọn Gói...</option>
                              <option value="package1">
                                👥 Gói 1: Chia sẻ
                              </option>
                              <option value="package2">
                                🔒 Gói 2: Linh hoạt
                              </option>
                            </select>
                            {loadingStates.changeType[acc.id] && (
                              <div className="text-center mt-1">
                                <Loader2
                                  size={14}
                                  className="animate-spin inline text-blue-400"
                                />
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="font-bold text-white mb-1 flex items-center gap-2 text-base">
                              <User size={16} className="text-slate-400" />
                              {acc.username}
                              <Copy
                                size={16}
                                className="cursor-pointer text-slate-500 hover:text-white"
                                onClick={() => handleCopy(acc.username)}
                                title="Copy Username"
                              />
                            </div>
                            <div className="text-slate-400 flex items-center gap-2 font-mono text-sm">
                              <Shield size={14} className="text-slate-500" />
                              {acc.password}
                              <Copy
                                size={14}
                                className="cursor-pointer text-slate-500 hover:text-white"
                                onClick={() => handleCopy(acc.password)}
                                title="Copy Password"
                              />
                            </div>
                            {acc.expiredAt && (
                              <div
                                className={`text-xs mt-1 ml-6 flex items-center gap-1 ${getExpiryStatus(acc.expiredAt).color}`}
                              >
                                <Calendar size={10} />
                                <span>{getExpiryStatus(acc.expiredAt).text}</span>
                                <span className="text-slate-600 italic">({formatDate(acc.expiredAt)})</span>
                              </div>
                            )}
                            {acc.note && (
                              <div className="text-xs text-yellow-500/80 italic mt-1 ml-6">
                                {acc.note}
                              </div>
                            )}
                          </td>
                          <td>
                            {acc.link ? (
                              <a
                                href={acc.link}
                                target="_blank"
                                className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-2 rounded-md font-bold no-underline inline-flex items-center gap-2 shadow-md transition-all hover:translate-y-[-1px]"
                              >
                                <Mail size={14} /> Mở Mail
                              </a>
                            ) : (
                              <span className="text-slate-600 text-xs">--</span>
                            )}
                          </td>
                          <td>
                            {acc.type === "package1" ? (
                              <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                <div className="flex justify-between items-center text-xs mb-2 pb-1 border-b border-slate-700/50">
                                  <span
                                    style={{
                                      color:
                                        acc.users?.length >= 3
                                          ? "#ef4444"
                                          : "#10b981",
                                      fontWeight: "bold",
                                    }}
                                  >
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
                                    const daysRemaining = getDaysRemaining(u);

                                    // EXPIRY LOGIC (dựa trên ngày CÒN LẠI, không phải đã dùng)
                                    const isExpired =
                                      daysRemaining !== null && daysRemaining <= 0;
                                    const isNearExpiry =
                                      daysRemaining !== null &&
                                      daysRemaining > 0 &&
                                      daysRemaining <= 3;

                                    return (
                                      <div
                                        key={index}
                                        className={`flex justify-between items-center text-xs p-2 rounded border mb-1 ${isExpired ? "bg-red-900/20 border-red-700" : "bg-slate-800 border-slate-700/50"}`}
                                      >
                                        <div className="flex flex-col">
                                          <span
                                            className={`font-bold truncate max-w-[120px] flex items-center gap-1 ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-400" : "text-white"}`}
                                            title={name}
                                          >
                                            {isExpired && (
                                              <AlertCircle size={12} />
                                            )}
                                            {isNearExpiry && (
                                              <AlertTriangle size={12} />
                                            )}
                                            👤 {name}
                                          </span>
                                          {dateStr ? (
                                            <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                                              <Calendar size={10} /> {dateStr}
                                              {daysRemaining !== null && (
                                                <span
                                                  className={
                                                    isExpired
                                                      ? "text-red-400 font-bold"
                                                      : isNearExpiry
                                                        ? "text-yellow-500 font-bold"
                                                        : daysRemaining > 30
                                                          ? "text-purple-400 font-bold"
                                                          : "text-blue-400"
                                                  }
                                                >
                                                  {isExpired
                                                    ? `(HH ${Math.abs(daysRemaining)}ngày)`
                                                    : `(Còn ${daysRemaining}ngày)`}
                                                </span>
                                              )}
                                            </span>
                                          ) : (
                                            <span className="text-[10px] text-slate-600 italic">
                                              Chưa có ngày
                                            </span>
                                          )}
                                          {/* Ngày hết hạn khách */}
                                          {getUserExpiryDate(u) && (
                                            <span className={`text-[10px] flex items-center gap-1 font-semibold ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-500" : "text-emerald-500"
                                              }`}>
                                              🕑 HH: {getUserExpiryDate(u)}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex gap-1">
                                          {/* EXTEND BUTTON (Only for Expired/Near Expiry) */}
                                          {(isExpired || isNearExpiry) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleExtendUser(
                                                  acc.id,
                                                  index,
                                                  u,
                                                )
                                              }
                                              className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                              title="Gia hạn (+30 ngày)"
                                            >
                                              <RotateCw size={14} />
                                            </button>
                                          )}

                                          {/* MOVE BUTTON (Blocked if Expired) */}
                                          {!isExpired ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openMoveUserModal(
                                                  acc.id,
                                                  index,
                                                  u,
                                                )
                                              }
                                              className="bg-orange-600 hover:bg-orange-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                              title="Chuyển khách"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </button>
                                          ) : (
                                            <span
                                              className="text-gray-500 cursor-not-allowed bg-slate-700 p-1.5 rounded"
                                              title="Hết hạn: Không thể chuyển"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </span>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              openEditUserModal(
                                                acc.id,
                                                index,
                                                u,
                                              )
                                            }
                                            className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                            title="Sửa tên"
                                          >
                                            <Pencil size={14} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteUser(
                                                acc.id,
                                                index,
                                                name,
                                              )
                                            }
                                            className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105"
                                            title="Xóa người này"
                                          >
                                            <X size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : acc.type === "package2" ? (
                              (() => {
                                const u = acc.users?.[0];
                                const daysRemaining = u ? getDaysRemaining(u) : null;
                                const isExpired = daysRemaining !== null && daysRemaining <= 0;
                                const isNearExpiry =
                                  daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;

                                return (
                                  <div className="bg-slate-900/40 p-2 rounded border border-slate-700/50">
                                    {acc.users?.length > 0 ? (
                                      <div
                                        className={`flex justify-between items-center text-sm font-bold p-1 rounded ${isExpired ? "bg-red-900/20" : ""}`}
                                      >
                                        <div
                                          className={
                                            isExpired
                                              ? "text-red-400"
                                              : "text-white"
                                          }
                                        >
                                          <span className="flex items-center gap-2">
                                            {isExpired && (
                                              <AlertCircle
                                                size={14}
                                                className="text-red-500"
                                              />
                                            )}
                                            {isNearExpiry && (
                                              <AlertTriangle
                                                size={14}
                                                className="text-yellow-500"
                                              />
                                            )}
                                            👤 {getUserName(u)}
                                          </span>
                                          <span
                                            className={`text-[10px] block ml-6 ${isExpired
                                              ? "text-red-300"
                                              : isNearExpiry
                                                ? "text-yellow-400"
                                                : daysRemaining !== null && daysRemaining > 30
                                                  ? "text-purple-400"
                                                  : "text-slate-400"
                                              }`}
                                          >
                                            {getUserDate(u)}
                                            {daysRemaining !== null && (
                                              <span className="ml-1">
                                                {isExpired
                                                  ? `(HH ${Math.abs(daysRemaining)}ngày)`
                                                  : `(Còn ${daysRemaining}ngày)`}
                                              </span>
                                            )}
                                          </span>
                                          {/* Ngày hết hạn khách */}
                                          {getUserExpiryDate(u) && (
                                            <span className={`text-[10px] block ml-6 font-semibold ${isExpired ? "text-red-500" : isNearExpiry ? "text-yellow-500" : "text-emerald-500"
                                              }`}>
                                              🕑 HH: {getUserExpiryDate(u)}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex gap-2">
                                          {/* EXTEND BUTTON (Only for Expired/Near Expiry) */}
                                          {(isExpired || isNearExpiry) && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleExtendUser(acc.id, 0, u)
                                              }
                                              className="text-green-400 hover:text-white"
                                              title="Gia hạn (+30 ngày)"
                                            >
                                              <RotateCw size={14} />
                                            </button>
                                          )}

                                          {/* MOVE BUTTON (Blocked if Expired) */}
                                          {!isExpired ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                openMoveUserModal(acc.id, 0, u)
                                              }
                                              className="text-orange-400 hover:text-white"
                                              title="Chuyển khách"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </button>
                                          ) : (
                                            <span
                                              className="text-gray-600 cursor-not-allowed"
                                              title="Hết hạn: Không thể chuyển"
                                            >
                                              <ArrowRightLeft size={14} />
                                            </span>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              openEditUserModal(acc.id, 0, u)
                                            }
                                            className="text-blue-400 hover:text-white"
                                          >
                                            <Pencil size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => openAddUserModal(acc.id)}
                                        className="w-full text-center text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                                      >
                                        Gán Khách
                                      </button>
                                    )}
                                  </div>
                                );
                              })()
                            ) : (
                              <span className="text-yellow-600 text-xs italic">
                                Chọn gói trước
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            <div className="flex justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAcc(acc);
                                  setShowEditModal(true);
                                }}
                                className="bg-slate-700 hover:bg-blue-600 text-slate-300 hover:text-white p-2 rounded transition-colors"
                                title="Sửa Tài Khoản"
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeletingId(acc.id);
                                  setShowDeleteModal(true);
                                }}
                                className="bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white p-2 rounded transition-colors"
                                title="Xóa Tài Khoản"
                              >
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
        )}

        {activeTab === "coursera" && (
          <div className="space-y-6">
            <details className="mb-2 p-2 rounded-lg border border-slate-700/50 cursor-pointer">
              <summary className="text-xs text-slate-500">
                ⚙️ Cấu hình Script
              </summary>
              <div className="mt-2 text-xs">
                <input
                  className="form-input text-xs font-mono text-slate-500"
                  value={
                    localStorage.getItem("appsScriptUrl") ||
                    "https://script.google.com/macros/s/AKfycbwoKn2sauopOfF2fp6K4RFJD5cD2F4Jhr3Xz1vdhidPuz2BZHO63ZahKhJYNH5rjXsV/exec"
                  }
                  onChange={(e) =>
                    localStorage.setItem("appsScriptUrl", e.target.value)
                  }
                />
              </div>
            </details>

            <div
              style={{
                background: "#1e293b",
                padding: "20px",
                borderRadius: "15px",
                border: "1px solid #334155",
              }}
            >
              <h3 className="text-lg font-bold text-white mb-4 border-b border-slate-700 pb-2">
                📂 Import Coursera
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="form-group mb-4">
                    <label className="block text-slate-400 mb-1 text-sm">
                      Tên Sheet (VD: Sp26)
                    </label>
                    <input
                      id="sheetNameInput"
                      className="form-input"
                      placeholder="Ví dụ: Sp26"
                    />
                  </div>
                  <div className="p-4 bg-yellow-900/10 border border-yellow-700/30 rounded-lg">
                    <h4 className="text-yellow-500 text-sm font-bold mb-2 flex items-center gap-2">
                      <AlertCircle size={16} /> Lưu ý Format
                    </h4>
                    <p className="text-xs text-slate-400">
                      Nhập dữ liệu theo đúng định dạng:
                      <br />
                      <code className="text-white bg-slate-800 px-1 rounded">
                        email,pass,mã_môn
                      </code>
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-slate-400 mb-1 text-sm">
                      Dữ Liệu
                    </label>
                    <textarea
                      id="bulkCourseraData"
                      className="form-input h-32 font-mono text-xs"
                      placeholder="user1@gmail.com,pass123,MATH101&#10;user2@gmail.com,pass456,ENW492c"
                    ></textarea>
                  </div>
                  <div>
                    <button
                      onClick={handleImportCoursera}
                      disabled={importingSheet}
                      className={`w-full flex justify-center items-center gap-2 p-3 rounded-lg font-bold transition-all ${importingSheet
                        ? "bg-slate-600 cursor-not-allowed opacity-70"
                        : importStatus === "success"
                          ? "bg-green-600 hover:bg-green-500"
                          : "btn-primary"
                        }`}
                    >
                      {importingSheet ? (
                        <>
                          <Loader2 size={18} className="animate-spin" /> Đang
                          Gửi Dữ Liệu...
                        </>
                      ) : importStatus === "success" ? (
                        <>
                          <CheckCircle size={18} /> Đã Gửi Thành Công!
                        </>
                      ) : (
                        <>
                          <ExternalLink size={16} /> Gửi Vào Sheet
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                background: "#1e293b",
                padding: "10px",
                borderRadius: "15px",
                border: "1px solid #334155",
              }}
            >
              <div className="flex justify-between items-center mb-2 px-1">
                <label className="text-sm font-bold text-slate-400">
                  Xem Trước Sheet:
                </label>
                <a
                  href="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white px-2 py-1 rounded shadow-sm transition-transform hover:translate-y-[-1px]"
                >
                  <ExternalLink size={12} /> Mở Full Màn Hình (Sửa Dễ Hơn)
                </a>
              </div>
              <div className="aspect-video w-full rounded-lg overflow-hidden bg-white border border-slate-600">
                <iframe
                  src="https://docs.google.com/spreadsheets/d/1Z-dUFrSTxM-rGuHcDUzJs-_A-6VntMHrEc5Lwh6Tg3M/edit?gid=1338679857&rm=minimal"
                  className="w-full h-full"
                  title="Coursera Sheet"
                ></iframe>
              </div>
            </div>
          </div>
        )}
      </div>

      {alertInfo.show && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal-box text-center" style={{ maxWidth: "400px" }}>
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${alertInfo.type === "error"
                ? "bg-red-900/30 text-red-500"
                : alertInfo.type === "warning"
                  ? "bg-yellow-900/30 text-yellow-500"
                  : alertInfo.type === "confirm"
                    ? "bg-blue-900/30 text-blue-500"
                    : "bg-green-900/30 text-green-500" // Success color
                }`}
            >
              {alertInfo.type === "error" ? (
                <AlertCircle size={32} />
              ) : alertInfo.type === "warning" ? (
                <AlertTriangle size={32} />
              ) : alertInfo.type === "success" ? (
                <CheckCircle size={32} />
              ) : (
                <Info size={32} />
              )}
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {alertInfo.title}
            </h3>
            <p className="text-slate-300 mb-6 whitespace-pre-wrap">
              {alertInfo.message}
            </p>

            {alertInfo.type === "confirm" ? (
              <div className="flex justify-center gap-3">
                <button onClick={closeAlert} className="btn-secondary">
                  Hủy
                </button>
                <button
                  onClick={executeConfirm}
                  className="btn-primary bg-blue-600 hover:bg-blue-500"
                >
                  Đồng Ý
                </button>
              </div>
            ) : (
              <button
                onClick={closeAlert}
                className="btn-primary w-full justify-center"
              >
                Đã Hiểu
              </button>
            )}
          </div>
        </div>
      )}

      {showMoveUserModal && movingUser && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitMoveUser}
            className="modal-box"
            style={{ maxWidth: "450px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <ArrowRightLeft className="text-orange-500" /> Chuyển Khách Hàng
            </h2>

            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="text-sm text-slate-400">Đang chuyển:</div>
              <div className="font-bold text-lg text-white">
                👤 {getUserName(movingUser)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Tham gia:{" "}
                {movingUser.joinedAt
                  ? new Date(movingUser.joinedAt).toLocaleDateString("vi-VN")
                  : "N/A"}
              </div>
            </div>

            <div className="form-group">
              {(() => {
                const sourceAcc = accounts.find((a) => a.id === movingUser.fromAccId);
                const sourceType = sourceAcc?.type || "unassigned";
                const sourceLabel = sourceType === "package1" ? "👥 Gói Chia Sẻ" : sourceType === "package2" ? "🔒 Gói Private" : "?⃝ Chưa phân loại";
                return (
                  <label className="text-orange-400 font-bold mb-1 block">
                    Chọn Tài Khoản Đích — Cùng loại: {sourceLabel}
                  </label>
                );
              })()}
              <select
                className="form-input w-full"
                value={destinationAccId}
                onChange={(e) => setDestinationAccId(e.target.value)}
                size={5} // List box style
                required
              >
                <option value="" disabled>
                  -- Chọn tài khoản --
                </option>
                {(() => {
                  const sourceAcc = accounts.find((a) => a.id === movingUser.fromAccId);
                  const sourceType = sourceAcc?.type || "unassigned";

                  return accounts
                    .filter((a) => {
                      if (a.id === movingUser.fromAccId) return false; // bỏ nguồn
                      if (getExpiryStatus(a.expiredAt).isExpired) return false; // bỏ hết hạn
                      const users = a.users?.length || 0;

                      if (a.type === sourceType) {
                        // Cùng loại: kiểm tra slot
                        if (sourceType === "package1") return users < 3;
                        if (sourceType === "package2") return users < 1;
                      }
                      if (a.type === "unassigned") {
                        // Unassigned: có thể nhận bất kỳ loại
                        if (sourceType === "package2") return users < 1;
                        if (sourceType === "package1") return users < 3;
                        return true;
                      }
                      return false;
                    })
                    .map((a) => {
                      const slots = a.users?.length || 0;
                      const maxSlots = a.type === "package2" ? 1 : a.type === "package1" ? 3 : (sourceType === "package2" ? 1 : 3);
                      const typeLabel =
                        a.type === "unassigned"
                          ? "⭐ Unassigned → sẽ thành " + (sourceType === "package1" ? "Shared" : "Private")
                          : a.type === "package2"
                            ? "🔒 Private"
                            : "👥 Shared";
                      const displayUser =
                        a.username.length > 25 ? a.username.substring(0, 22) + "..." : a.username;
                      const dateStr = a.expiredAt
                        ? new Date(a.expiredAt).toLocaleDateString("vi-VN")
                        : "Vô hạn";

                      return (
                        <option
                          key={a.id}
                          value={a.id}
                          className="py-2"
                        >
                          [{slots}/{maxSlots}] {typeLabel} — {displayUser} (Hết: {dateStr})
                        </option>
                      );
                    });
                })()}
              </select>
              <p className="text-xs text-slate-500 mt-2 italic">
                * Cùng loại gói hoặc tài khoản chưa phân loại (tự đổi loại sau khi nhận khách).
              </p>
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowMoveUserModal(false)}
                className="btn-secondary"
                disabled={loadingStates.moveUser}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary bg-orange-600 hover:bg-orange-500 flex items-center gap-2"
                disabled={loadingStates.moveUser}
              >
                {loadingStates.moveUser ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang
                    chuyển...
                  </>
                ) : (
                  "Xác Nhận Chuyển"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {showUserModal && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitUser}
            className="modal-box"
            style={{ maxWidth: "400px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4">
              {userModalMode === "add" ? "Thêm Khách Mới" : "Sửa Tên Khách"}
            </h2>

            {/* EXPIRY WARNING */}
            {userModalMode === "add" &&
              currentUserData.accId &&
              (() => {
                const acc = accounts.find(
                  (a) => a.id === currentUserData.accId,
                );
                if (acc && acc.expiredAt) {
                  const daysLeft = getExpiryStatus(acc.expiredAt).text;
                  // Check simplistic days logic or re-calc
                  const exp = new Date(acc.expiredAt);
                  const now = new Date();
                  const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

                  if (diff < 30) {
                    return (
                      <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded flex gap-2 items-start">
                        <AlertTriangle
                          className="text-yellow-500 shrink-0"
                          size={20}
                        />
                        <div className="text-xs text-yellow-200">
                          <span className="font-bold block text-sm text-yellow-500">
                            CẢNH BÁO HẠN DÙNG
                          </span>
                          Tài khoản này chỉ còn <b>{diff} ngày</b> (&lt; 30
                          ngày).
                          <br />
                          Khách mua tháng có thể bị gián đoạn!
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
                onChange={(e) =>
                  setCurrentUserData({
                    ...currentUserData,
                    name: e.target.value,
                  })
                }
                placeholder="Nhập tên..."
              />
            </div>
            <div className="form-group mt-3">
              <label className="block text-slate-300 mb-2">Ngày Tham Gia</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  currentUserData.joinedAt
                    ? new Date(currentUserData.joinedAt)
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  setCurrentUserData({
                    ...currentUserData,
                    joinedAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  });
                }}
              />
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowUserModal(false)}
                className="btn-secondary"
                disabled={loadingStates.addUser || loadingStates.editUser}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={loadingStates.addUser || loadingStates.editUser}
              >
                {loadingStates.addUser || loadingStates.editUser ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang lưu...
                  </>
                ) : (
                  "Lưu Lại"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {(showAddModal || showEditModal) && (
        <div className="modal-overlay">
          <form
            onSubmit={showAddModal ? handleAddAccount : handleUpdateAccount}
            className="modal-box"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                {showAddModal ? "Thêm Tài Khoản" : "Sửa Tài Khoản"}
              </h2>
              <span
                className="close"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
              >
                &times;
              </span>
            </div>

            <div className="form-group">
              <label>Email / Username</label>
              <input
                required
                className="form-input"
                value={showAddModal ? newAcc.username : editingAcc.username}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, username: e.target.value })
                    : setEditingAcc({ ...editingAcc, username: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                required
                className="form-input"
                value={showAddModal ? newAcc.password : editingAcc.password}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, password: e.target.value })
                    : setEditingAcc({ ...editingAcc, password: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Loại Gói</label>
              <select
                className="form-input"
                value={showAddModal ? newAcc.type : editingAcc.type}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, type: e.target.value })
                    : setEditingAcc({ ...editingAcc, type: e.target.value })
                }
              >
                <option value="unassigned">❓ Chưa xác định</option>
                <option value="package1">👥 Gói 1: Chia sẻ</option>
                <option value="package2">🔒 Gói 2: Linh hoạt</option>
              </select>
            </div>
            <div className="form-group">
              <label>Link Mail</label>
              <input
                className="form-input"
                value={showAddModal ? newAcc.link : editingAcc.link}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, link: e.target.value })
                    : setEditingAcc({ ...editingAcc, link: e.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>Ghi chú</label>
              <input
                className="form-input"
                value={showAddModal ? newAcc.note : editingAcc.note}
                onChange={(e) =>
                  showAddModal
                    ? setNewAcc({ ...newAcc, note: e.target.value })
                    : setEditingAcc({ ...editingAcc, note: e.target.value })
                }
              />
            </div>

            <div className="form-group mt-3">
              <label className="block text-yellow-400 mb-2">Ngày Hết Hạn</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  (showAddModal ? newAcc.expiredAt : editingAcc.expiredAt)
                    ? new Date(
                      showAddModal ? newAcc.expiredAt : editingAcc.expiredAt,
                    )
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  const val = e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null;
                  if (showAddModal) setNewAcc({ ...newAcc, expiredAt: val });
                  else setEditingAcc({ ...editingAcc, expiredAt: val });
                }}
              />
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
                className="btn-secondary"
                disabled={loadingStates.addAccount || loadingStates.editAccount}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
                disabled={loadingStates.addAccount || loadingStates.editAccount}
              >
                {loadingStates.addAccount || loadingStates.editAccount ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang lưu...
                  </>
                ) : (
                  "Lưu"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-box text-center">
            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Xác nhận xóa?</h3>
            <div className="flex justify-center gap-3 mt-6">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary"
                disabled={loadingStates.deleteAccount}
              >
                Hủy
              </button>
              <button
                onClick={handleDeleteAccount}
                className="btn-primary flex items-center gap-2"
                style={{ backgroundColor: "#ef4444" }}
                disabled={loadingStates.deleteAccount}
              >
                {loadingStates.deleteAccount ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Đang xóa...
                  </>
                ) : (
                  "Xóa Luôn"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrphanedUsersModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="bg-orange-900/30 p-4 rounded-t-xl border-b-2 border-orange-600 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-600/30 rounded-full flex items-center justify-center">
                  <AlertTriangle size={28} className="text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    ⚠️ KHÔNG THỂ XÓA TÀI KHOẢN
                  </h3>
                  <p className="text-sm text-orange-300">
                    Tài khoản có {orphanedUsers.length} khách còn hạn sử dụng
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mb-4">
              <p className="text-slate-300 mb-3">
                <strong className="text-yellow-400">Yêu cầu:</strong> Chuyển
                hoặc xóa tất cả khách còn hạn trước khi xóa tài khoản.
              </p>
              <div className="space-y-3">
                {orphanedUsers.map((user, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900 p-3 rounded border border-slate-700 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-bold text-white flex items-center gap-2">
                        <User size={16} className="text-blue-400" />
                        {user.name}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Tham gia: {getUserDate(user)} • Đã dùng: {user.daysUsed}{" "}
                        ngày •
                        <span className="text-green-400 font-bold">
                          {" "}
                          Còn {30 - user.daysUsed} ngày
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowOrphanedUsersModal(false);
                          openMoveUserModal(
                            user.fromAccId,
                            user.userIndex,
                            user,
                          );
                        }}
                        className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded text-sm font-bold"
                      >
                        <ArrowRightLeft size={14} /> Chuyển
                      </button>
                      <button
                        onClick={() => {
                          setShowOrphanedUsersModal(false);
                          handleDeleteUser(
                            user.fromAccId,
                            user.userIndex,
                            user.name,
                          );
                        }}
                        className="flex items-center gap-1 bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm font-bold"
                      >
                        <Trash2 size={14} /> Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 mb-4">
              <div className="flex items-start gap-2">
                <Info
                  size={18}
                  className="text-blue-400 flex-shrink-0 mt-0.5"
                />
                <p className="text-xs text-blue-200">
                  <strong>Gợi ý:</strong> Chuyển khách sang tài khoản Shared còn
                  slot hoặc xóa khách nếu không còn sử dụng. Sau khi xử lý hết,
                  bạn có thể xóa tài khoản này.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowOrphanedUsersModal(false);
                  setDeletingId(null);
                }}
                className="btn-primary bg-blue-600 hover:bg-blue-500"
              >
                Đã Hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportGPTModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                Import ChatGPT Nhanh
              </h2>
              <span
                className="close"
                onClick={() => setShowImportGPTModal(false)}
              >
                &times;
              </span>
            </div>
            <p className="text-slate-400 text-sm mb-2">
              Dán dữ liệu:{" "}
              <code className="bg-slate-700 px-1 rounded">
                email----pass----link
              </code>
            </p>
            <textarea
              id="bulkGPTData"
              className="form-input h-64 font-mono text-xs"
              placeholder="...
UCanPlus1669@purinikiopiy.asia---zxcvbnm666..----https://mail.chatgpt.org.uk/..."
            ></textarea>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowImportGPTModal(false)}
                className="btn-secondary"
              >
                Hủy
              </button>
              <button
                id="btnImportGPT"
                onClick={handleBulkImportGPT}
                className="btn-primary bg-purple-600 hover:bg-purple-500"
              >
                Nhập Dữ Liệu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SINGLE USER PLATFORMS (NETFLIX, CAPCUT, CANVA)            */}
      {/* ========================================================= */}
      {(activeTab === "netflix" || activeTab === "capcut" || activeTab === "canva") && (() => {
        const platform = activeTab;
        const mapAccs = { netflix: netflixAccounts, capcut: capcutAccounts, canva: canvaAccounts };
        const accs = mapAccs[platform] || [];
        const accents = { netflix: "red", capcut: "green", canva: "purple" };
        const accentColor = accents[platform];
        const labels = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" };
        const label = labels[platform];
        const emojis = { netflix: "Màn hình", capcut: "Video", canva: "Design" };
        const emoji = emojis[platform];

        const handleAddSimpleAcc = () => {
          setSimpleAddPlatform(platform);
          setSimpleAddForm({ username: "", password: "", duration: "1M", note: "" });
          setShowSimpleAddModal(true);
        };

        const handleEditSimpleAcc = (acc) => {
          setSimpleEditForm({
            id: acc.id,
            username: acc.username || "",
            password: acc.password || "",
            duration: acc.duration || "1M",
            note: acc.note || "",
            expiredAt: acc.expiredAt ? new Date(acc.expiredAt).toISOString().split('T')[0] : "",
          });
          setShowSimpleEditModal(true);
        };

        const handleDeleteSimpleAcc = (acc) => {
          showConfirm("Xóa Tài Khoản", `Bạn có chắc muốn xóa tài khoản ${acc.username}?`, async () => {
            try {
              await axios.delete(`/api/${platform}/${acc.id}`);
              fetchData();
            } catch (e) { showAlert("Lỗi", "Xóa thất bại", "error"); }
          });
        };

        const handleAssignUser = async (acc) => {
          if (acc.users?.length >= 1) return alert(`Giới hạn: ${label} chỉ được 1 khách!`);
          setAssignUserAcc(acc);
          setAssignUserName("");
          setShowAssignUserModal(true);
        };

        const handleRemoveUser = (acc) => {
          showConfirm("Xóa Khách", `Bạn có chắc muốn xóa khách khỏi ${acc.username}?`, async () => {
            try {
              await axios.put(`/api/${platform}/${acc.id}`, { users: [] });
              fetchData();
            } catch (e) { showAlert("Lỗi", "Xóa thất bại", "error"); }
          });
        };

        const handleExtendSimpleUser = async (acc) => {
          try {
            await axios.post("/api/extend-user", { accId: acc.id, userIndex: 0, platform });
            fetchData();
            alert("Gia hạn thành công!");
          } catch (e) { alert("Lỗi gia hạn"); }
        };

        const filtered = accs.filter(a =>
          a.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.users?.[0]?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        );

        return (
          <div>
            <div className="flex flex-wrap gap-3 mb-6 items-center justify-between">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Tìm email/khách..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="form-input w-64"
                />
                <span className="text-slate-500 text-sm">
                  {filtered.length} tài khoản · {accs.filter(a => a.users?.length > 0).length} đang dùng
                </span>
              </div>
              <button onClick={handleAddSimpleAcc} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white transition-all bg-${accentColor}-600 hover:bg-${accentColor}-500`}>
                <UserPlus size={16} /> Thêm Tài Khoản {label}
              </button>
            </div>

            <div className="rounded-xl overflow-hidden border border-slate-700 shadow-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-xs uppercase tracking-wider bg-${accentColor}-900/30 text-${accentColor}-300`}>
                    <th className="p-3 text-left">#</th>
                    <th className="p-3 text-left">Tài Khoản</th>
                    <th className="p-3 text-left">Khách Hàng</th>
                    <th className="p-3 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500 italic">Chưa có dữ liệu</td></tr>}
                  {filtered.map((acc, idx) => {
                    const u = acc.users?.[0];
                    const daysRemaining = getDaysRemaining(u);
                    const isExpired = daysRemaining !== null && daysRemaining <= 0;
                    const isNearExpiry = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;
                    const accExpiry = getExpiryStatus(acc.expiredAt);
                    return (
                      <tr key={acc.id} className={`border-t border-slate-700/50 transition-colors ${accExpiry.isExpired ? "bg-red-950/20" : "hover:bg-slate-800/50"}`}>
                        <td className="p-3 text-slate-500 font-mono text-xs">{idx + 1}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2 font-bold text-white">
                            <span className="text-sm">{acc.username}</span>
                            <Copy size={13} className="cursor-pointer text-slate-500 hover:text-white" onClick={() => handleCopy(acc.username)} />
                          </div>
                          <div className="text-slate-400 flex items-center gap-2 font-mono text-xs mt-1 ml-6">
                            <Shield size={12} className="text-slate-500" />
                            {acc.password || <span className="opacity-50">Không mật khẩu</span>}
                            {acc.password && <Copy size={12} className="cursor-pointer text-slate-500 hover:text-white" onClick={() => handleCopy(acc.password)} />}
                          </div>
                          {acc.expiredAt && (
                            <div className={`text-xs mt-1 ml-6 flex items-center gap-1 ${accExpiry.color}`}>
                              <Calendar size={10} />
                              <span>{accExpiry.text}</span>
                              <span className="text-slate-600 italic">({formatDate(acc.expiredAt)})</span>
                            </div>
                          )}
                          {acc.note && <div className="text-xs text-yellow-500/80 italic mt-1 ml-6">{acc.note}</div>}
                        </td>
                        <td className="p-3">
                          {u ? (
                            <div className={`p-2 rounded border text-xs ${isExpired ? "bg-red-900/20 border-red-700" : isNearExpiry ? "bg-yellow-900/20 border-yellow-700" : "bg-slate-800 border-slate-700"}`}>
                              <div className={`font-bold flex items-center gap-1 ${isExpired ? "text-red-400" : isNearExpiry ? "text-yellow-400" : "text-white"}`}>
                                {isExpired && <AlertCircle size={12} />}
                                {isNearExpiry && <AlertTriangle size={12} />}
                                👤 {u.name}
                              </div>
                              <div className="text-slate-400 mt-1 flex items-center gap-1">
                                <Calendar size={10} /> {getUserDate(u)}
                              </div>
                              {daysRemaining !== null && (
                                <div className={`text-[10px] font-semibold mt-0.5 ${isExpired ? "text-red-400" : isNearExpiry ? "text-yellow-400" : daysRemaining > 30 ? "text-purple-400" : "text-blue-400"}`}>
                                  {isExpired ? `(HH ${Math.abs(daysRemaining)} ngày)` : `(Còn ${daysRemaining} ngày)`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <button onClick={() => handleAssignUser(acc)} className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold text-white bg-${accentColor}-700 hover:bg-${accentColor}-600`}>
                              👤 Gán Khách
                            </button>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1 items-center">
                            {u && (isExpired || isNearExpiry) && <button onClick={() => handleExtendSimpleUser(acc)} className="bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs w-full text-center">Gia Hạn</button>}
                            {u && <button onClick={() => handleRemoveUser(acc)} className="bg-orange-700 hover:bg-orange-600 text-white px-2 py-1 rounded text-xs flex items-center w-full justify-center">Xóa Khách</button>}
                            <button onClick={() => handleEditSimpleAcc(acc)} className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><Pencil size={12} /> Sửa Acc</button>
                            <button onClick={() => handleDeleteSimpleAcc(acc)} className="bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><Trash2 size={12} /> Xóa Acc</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {showSimpleAddModal && (() => {
        const opts = {
          netflix: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
          capcut: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }],
          canva: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
        };
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[simpleAddPlatform] || simpleAddPlatform;
        const durOpts = opts[simpleAddPlatform] || opts.netflix;
        const isCanva = simpleAddPlatform === "canva";

        const calcExp = (dur) => {
          const d = new Date();
          const m = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };
          d.setDate(d.getDate() + (m[dur] || 30));
          return d.toISOString();
        };

        const handleSubmit = async (e) => {
          e.preventDefault();
          try {
            await axios.post(`/api/${simpleAddPlatform}`, {
              username: simpleAddForm.username.trim(),
              password: simpleAddForm.password.trim(),
              note: simpleAddForm.note.trim(),
              duration: simpleAddForm.duration,
              expiredAt: calcExp(simpleAddForm.duration),
            });
            setShowSimpleAddModal(false);
            fetchData();
          } catch (err) { alert("Lỗi thêm tài khoản"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "480px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white">Thêm Tài Khoản {platformLabel}</h2>
                <button type="button" onClick={() => setShowSimpleAddModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Email / Username *</label>
                  <input required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.username} onChange={e => setSimpleAddForm(p => ({ ...p, username: e.target.value }))} placeholder="email@example.com" />
                </div>
                {!isCanva && (
                  <div>
                    <label className="text-slate-400 text-sm block mb-1">Mật khẩu</label>
                    <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono" value={simpleAddForm.password} onChange={e => setSimpleAddForm(p => ({ ...p, password: e.target.value }))} placeholder="Password..." />
                  </div>
                )}
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Thời hạn gói linh hoạt</label>
                  <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.duration} onChange={e => setSimpleAddForm(p => ({ ...p, duration: e.target.value }))}>
                    {durOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ghi chú (Tùy chọn)</label>
                  <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleAddForm.note} onChange={e => setSimpleAddForm(p => ({ ...p, note: e.target.value }))} placeholder="VD: Profile 2..." />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowSimpleAddModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold">Thêm</button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* EDIT MODAL */}
      {showSimpleEditModal && (() => {
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[activeTab] || activeTab;
        const opts = {
          netflix: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
          capcut: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }],
          canva: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
        };
        const durOpts = opts[activeTab] || opts.netflix;
        const isCanva = activeTab === "canva";

        const handleEditSubmit = async (e) => {
          e.preventDefault();
          try {
            const bodyData = {
              username: simpleEditForm.username.trim(),
              password: simpleEditForm.password.trim(),
              note: simpleEditForm.note.trim(),
              duration: simpleEditForm.duration,
            };
            if (simpleEditForm.expiredAt) {
              bodyData.expiredAt = new Date(simpleEditForm.expiredAt).toISOString();
            }
            await axios.put(`/api/${activeTab}/${simpleEditForm.id}`, bodyData);
            setShowSimpleEditModal(false);
            fetchData();
            showAlert("Thành công", "Đã cập nhật tài khoản", "success");
          } catch (err) { showAlert("Lỗi", "Cập nhật thất bại", "error"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={handleEditSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "480px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex gap-2 items-center"><Pencil size={20} className="text-blue-400" />Sửa Tài Khoản {platformLabel}</h2>
                <button type="button" onClick={() => setShowSimpleEditModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Email / Username *</label>
                  <input required className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.username} onChange={e => setSimpleEditForm(p => ({ ...p, username: e.target.value }))} />
                </div>
                {!isCanva && (
                  <div>
                    <label className="text-slate-400 text-sm block mb-1">Mật khẩu</label>
                    <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white font-mono" value={simpleEditForm.password} onChange={e => setSimpleEditForm(p => ({ ...p, password: e.target.value }))} />
                  </div>
                )}
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Gói linh hoạt (hiện tại)</label>
                  <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.duration} onChange={e => setSimpleEditForm(p => ({ ...p, duration: e.target.value }))}>
                    {durOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ngày Hết Hạn Tính Tiền Mới</label>
                  <input type="date" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.expiredAt} onChange={e => setSimpleEditForm(p => ({ ...p, expiredAt: e.target.value }))} />
                </div>
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Ghi chú</label>
                  <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.note} onChange={e => setSimpleEditForm(p => ({ ...p, note: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setShowSimpleEditModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-colors">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">Lưu Cập Nhật</button>
              </div>
            </form>
          </div>
        );
      })()}


      {/* ========================================================= */}
      {/* MODAL GÁN KHÁCH (NETFLIX, CAPCUT, CANVA)                    */}
      {/* ========================================================= */}
      {showAssignUserModal && assignUserAcc && (() => {
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[activeTab] || activeTab;

        const executeAssignUser = async (e) => {
          e.preventDefault();
          if (!assignUserName?.trim() || !assignUserAcc) return;
          try {
            const platform = activeTab;
            const newUsers = [{ name: assignUserName.trim(), joinedAt: new Date().toISOString() }];
            await axios.put(`/api/${platform}/${assignUserAcc.id}`, { users: newUsers });
            setShowAssignUserModal(false);
            setAssignUserAcc(null);
            fetchData();
          } catch (e) { alert("Lỗi gán khách"); }
        };

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <form onSubmit={executeAssignUser} className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full shadow-2xl" style={{ maxWidth: "400px" }}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <UserPlus size={20} className="text-blue-400" />
                  Gán Khách Hàng
                </h2>
                <button type="button" onClick={() => setShowAssignUserModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>

              <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 mb-4">
                <div className="text-sm text-slate-400">Tài khoản {platformLabel}:</div>
                <div className="font-mono text-white font-bold">{assignUserAcc.username}</div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 text-sm block mb-1">Tên khách hàng *</label>
                  <input
                    required
                    autoFocus
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    value={assignUserName}
                    onChange={e => setAssignUserName(e.target.value)}
                    placeholder="Nhập tên khách..."
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowAssignUserModal(false)} className="flex-1 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors">Hủy</button>
                <button type="submit" className="flex-1 p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">Xác Nhận</button>
              </div>
            </form>
          </div>
        );
      })()}

    </div>
  );
}

export default App;
