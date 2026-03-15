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
  Globe,
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

const normalizePackage2Shelf = (value) => {
  if (value === "cheap" || value === "none" || value === "main") return value;
  return "main";
};

const getPackage2ShelfLabel = (value) => {
  const shelf = normalizePackage2Shelf(value);
  if (shelf === "cheap") return "Kệ rẻ";
  if (shelf === "none") return "Không lên kệ";
  return "Kệ tổng";
};
const normalizeTeamSaleMode = (value) =>
  value === "business" ? "business" : "slot";
const getTeamSaleModeLabel = (value) =>
  normalizeTeamSaleMode(value) === "business"
    ? "Business account (1 acc)"
    : "Slot team";
const DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY = "datammo_seen_order_keys";
const DATAMMO_RECENT_ORDER_WINDOW_MS = 15 * 60 * 1000;
const buildDatammoOrderKey = (order = {}) =>
  String(order._id || order.id || `${order.orderId || "order"}|${order.createdAt || ""}`);
const normalizeDatammoOrders = (orders = []) =>
  [...(Array.isArray(orders) ? orders : [])].sort(
    (a, b) =>
      new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime(),
  );
const loadSeenDatammoOrderKeys = () => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = JSON.parse(
      localStorage.getItem(DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.map((item) => String(item || "")).filter(Boolean));
  } catch (error) {
    return new Set();
  }
};
const persistSeenDatammoOrderKeys = (keys = []) => {
  if (typeof window === "undefined") return;
  try {
    const normalized = Array.from(
      new Set((Array.isArray(keys) ? keys : Array.from(keys || [])).map((item) => String(item || "")).filter(Boolean)),
    ).slice(-100);
    localStorage.setItem(
      DATAMMO_SEEN_ORDER_KEYS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch (error) {
    // Ignore localStorage write issues.
  }
};
const buildTeamFormState = (overrides = {}) => ({
  username: "",
  password: "",
  recoveryUrl: "",
  note: "",
  expiredAt: "",
  saleMode: "slot",
  ...overrides,
});
const buildTeamEditFormState = (overrides = {}) => ({
  id: "",
  ...buildTeamFormState(),
  ...overrides,
});
const buildChatgptCopyText = (account = {}) => {
  const lines = [
    `Tài khoản: ${account.username || ""}`,
    `Mật khẩu: ${account.password || ""}`,
  ];
  if (account.type === "package2" && account.link) {
    lines.push(`Link: ${account.link}`);
  }
  return lines.join("\n");
};
const normalizeTeamAccountForUi = (account = {}) => {
  const { emailPassword, ...rest } = account || {};
  return {
    ...rest,
    saleMode: normalizeTeamSaleMode(rest.saleMode),
  };
};
const DURATION_MONTHS_MAP = {
  "1M": 1,
  "2M": 2,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};
const EXTEND_DURATION_OPTIONS = [
  { value: "1M", label: "1 Tháng" },
  { value: "2M", label: "2 Tháng" },
  { value: "3M", label: "3 Tháng" },
  { value: "6M", label: "6 Tháng" },
  { value: "1Y", label: "1 Năm" },
];
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
  const normalizedDuration = String(duration || "1M").toUpperCase();
  const months = DURATION_MONTHS_MAP[normalizedDuration];
  if (!months) return new Date(dateInput);
  return addMonthsClamped(dateInput, months);
};
const getDurationLabel = (duration = "1M") =>
  EXTEND_DURATION_OPTIONS.find((option) => option.value === duration)?.label || duration;

function App() {
  // LOGIN STATE
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  const [accounts, setAccounts] = useState([]);
  const [netflixAccounts, setNetflixAccounts] = useState([]);
  const [canvaAccounts, setCanvaAccounts] = useState([]);
  const [capcutAccounts, setCapcutAccounts] = useState([]);
  const [teamAccounts, setTeamAccounts] = useState([]);
  const [showTeamAddModal, setShowTeamAddModal] = useState(false);
  const [showTeamEditModal, setShowTeamEditModal] = useState(false);
  const [teamAddForm, setTeamAddForm] = useState(buildTeamFormState());
  const [teamEditForm, setTeamEditForm] = useState(buildTeamEditFormState());
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotTarget, setSlotTarget] = useState({ accId: null, slotIdx: null, slot: null });
  const [slotFormGmail, setSlotFormGmail] = useState("");
  const [slotFormName, setSlotFormName] = useState("");
  const [slotFormExp, setSlotFormExp] = useState("");
  const [slotFormExpiredAt, setSlotFormExpiredAt] = useState("");
  const [teamImportText, setTeamImportText] = useState("");

  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendData, setExtendData] = useState(null);
  const [extendDaysOption, setExtendDaysOption] = useState("1M");

  const [showImportTeamModal, setShowImportTeamModal] = useState(false);
  const [showSimpleAddModal, setShowSimpleAddModal] = useState(false);
  const [simpleAddPlatform, setSimpleAddPlatform] = useState("netflix");
  const [simpleAddForm, setSimpleAddForm] = useState({ username: "", password: "", duration: "1M", note: "", customerName: "" });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chatgpt");
  const [gptSubTab, setGptSubTab] = useState("all");
  const [package2ShelfTab, setPackage2ShelfTab] = useState("all");
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
    bulkPush: false,
    teamMode: {},
    changeType: {},
    changeShelf: {},
  });

  // BroadcastChannel for real-time sync between tabs
  const channelRef = useRef(null);
  const dataVersionRef = useRef(0);
  const isFetchingDataRef = useRef(false);
  const seenDatammoOrderKeysRef = useRef(null);
  const hasInitializedDatammoOrdersRef = useRef(false);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImportGPTModal, setShowImportGPTModal] = useState(false);
  const [showBulkPushModal, setShowBulkPushModal] = useState(false);
  const [selectedChatgptIds, setSelectedChatgptIds] = useState([]);
  const [bulkPushForm, setBulkPushForm] = useState({
    scope: "selected",
    targetType: "package1",
    package2Shelf: "main",
  });
  const [bulkPushProgress, setBulkPushProgress] = useState({
    total: 0,
    completed: 0,
    percent: 0,
  });

  // CUSTOM ALERT & CONFIRM MODAL
  const [alertInfo, setAlertInfo] = useState({
    show: false,
    title: "",
    message: "",
    type: "info",
    onConfirm: null,
  });

  // TOAST MSG
  const [toastMessage, setToastMessage] = useState("");
  const [recentDatammoOrders, setRecentDatammoOrders] = useState([]);

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
  const [showMoveSlotModal, setShowMoveSlotModal] = useState(false);
  const [movingUser, setMovingUser] = useState(null);
  const [movingSlot, setMovingSlot] = useState(null); // { fromAccId, userIndex, name, joinedAt }
  const [destinationAccId, setDestinationAccId] = useState("");

  // Orphaned Users Modal (when deleting account with active users)
  const [showOrphanedUsersModal, setShowOrphanedUsersModal] = useState(false);
  const [orphanedUsers, setOrphanedUsers] = useState([]);

  // Orphaned Slots Modal (when deleting team account with active slots)
  const [showOrphanedSlotsModal, setShowOrphanedSlotsModal] = useState(false);
  const [orphanedSlots, setOrphanedSlots] = useState([]);

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
    package2Shelf: "none",
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

  // Serverless-friendly auto-sync:
  // poll lightweight data version endpoint instead of long-lived SSE connections.
  useEffect(() => {
    if (!isAuthenticated) return;

    let isMounted = true;

    const checkDataVersion = async () => {
      if (document.hidden) return;
      try {
        const response = await axios.get("/api/data-version", { timeout: 8000 });
        const nextVersion = Number(response?.data?.version || 0);
        if (!Number.isFinite(nextVersion) || nextVersion <= 0) return;

        if (!dataVersionRef.current) {
          dataVersionRef.current = nextVersion;
          return;
        }

        if (nextVersion > dataVersionRef.current && isMounted) {
          dataVersionRef.current = nextVersion;
          fetchData(false);
        }
      } catch (e) {
        // Ignore transient poll errors. Next cycle will retry.
      }
    };

    checkDataVersion();
    const interval = setInterval(checkDataVersion, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Backward-compatible helper for cases calling it manually.
  const broadcastDataChange = () => { };

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

  useEffect(() => {
    const validIds = new Set(accounts.map((acc) => acc.id));
    setSelectedChatgptIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [accounts]);

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
    setRecentDatammoOrders([]);
    seenDatammoOrderKeysRef.current = null;
    hasInitializedDatammoOrdersRef.current = false;
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
  const getDefaultOneMonthDateInput = () => {
    return addDurationToDate(new Date(), "1M").toISOString().split("T")[0];
  };

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
  const getDaysRemaining = (u, accDuration = "1M") => {
    if (typeof u === "object" && u !== null && u.expiredAt) {
      try {
        return Math.ceil((new Date(u.expiredAt) - new Date()) / 86400000);
      } catch (e) { }
    }
    if (typeof u === "object" && u !== null && u.joinedAt) {
      try {
        const expiryDate = addDurationToDate(u.joinedAt, accDuration);
        return Math.ceil((expiryDate - new Date()) / 86400000);
      } catch (e) { }
    }
    return null;
  };

  // Helper: tính ngày hết hạn của khách = expiredAt OR joinedAt + duration
  const getUserExpiryDate = (u, accDuration = "1M") => {
    if (typeof u === "object" && u !== null) {
      if (u.expiredAt) {
        return formatDate(u.expiredAt);
      }
      if (u.joinedAt) {
        try {
          const d = addDurationToDate(u.joinedAt, accDuration);
          return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        } catch (e) { return ""; }
      }
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
    if (!isoString) return { text: "", color: "text-slate-500", isExpired: false, dateStr: "" };
    const expDate = new Date(isoString);

    const now = new Date();
    const diffTime = expDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const dateStr = `${expDate.getDate()}/${expDate.getMonth() + 1}/${expDate.getFullYear()}`;

    if (diffDays <= 0)
      return {
        text: `Đã hết hạn ${Math.abs(diffDays)} ngày`,
        color: "text-red-500 font-bold",
        isExpired: true,
        dateStr,
      };
    if (diffDays <= 3)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-red-400 font-bold",
        isExpired: false,
        dateStr,
      };
    if (diffDays <= 7)
      return {
        text: `Còn ${diffDays} ngày`,
        color: "text-yellow-400 font-bold",
        isExpired: false,
        dateStr,
      };
    return {
      text: `Còn ${diffDays} ngày`,
      color: "text-emerald-500",
      isExpired: false,
      dateStr,
    };
  };

  const syncDatammoOrderBanner = (orders = []) => {
    const normalizedOrders = normalizeDatammoOrders(orders);
    if (!seenDatammoOrderKeysRef.current) {
      seenDatammoOrderKeysRef.current = loadSeenDatammoOrderKeys();
    }

    const seenKeys = seenDatammoOrderKeysRef.current;
    const allKeys = normalizedOrders.map((order) => buildDatammoOrderKey(order));
    const recentUnseenOrders = normalizedOrders.filter((order) => {
      const orderKey = buildDatammoOrderKey(order);
      const createdAtMs = new Date(order?.createdAt || 0).getTime();
      if (seenKeys.has(orderKey)) return false;
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return false;
      return Date.now() - createdAtMs <= DATAMMO_RECENT_ORDER_WINDOW_MS;
    });

    if (!hasInitializedDatammoOrdersRef.current) {
      if (recentUnseenOrders.length > 0) {
        setRecentDatammoOrders(recentUnseenOrders.slice(0, 5));
      }
      if (seenKeys.size === 0 && allKeys.length > 0) {
        allKeys.forEach((key) => seenKeys.add(key));
        persistSeenDatammoOrderKeys(seenKeys);
      } else if (recentUnseenOrders.length > 0) {
        recentUnseenOrders.forEach((order) =>
          seenKeys.add(buildDatammoOrderKey(order)),
        );
        persistSeenDatammoOrderKeys(seenKeys);
      }
      hasInitializedDatammoOrdersRef.current = true;
      return;
    }

    const freshOrders = normalizedOrders.filter(
      (order) => !seenKeys.has(buildDatammoOrderKey(order)),
    );

    if (freshOrders.length === 0) return;

    freshOrders.forEach((order) => seenKeys.add(buildDatammoOrderKey(order)));
    persistSeenDatammoOrderKeys(seenKeys);
    setRecentDatammoOrders((prev) => {
      const merged = new Map();
      [...freshOrders, ...prev].forEach((order) => {
        merged.set(buildDatammoOrderKey(order), order);
      });
      return normalizeDatammoOrders(Array.from(merged.values())).slice(0, 5);
    });
  };

  const fetchData = async (showLoader = true) => {
    if (isFetchingDataRef.current) return;
    isFetchingDataRef.current = true;
    if (showLoader) setLoading(true);
    try {
      const res = await axios.get("/api/data", {
        timeout: 10000,
        headers: { "Cache-Control": "no-cache" },
      });
      const nextVersion = Number(res.data?.version || 0);
      if (Number.isFinite(nextVersion) && nextVersion > 0) {
        dataVersionRef.current = nextVersion;
      }
      syncDatammoOrderBanner(res.data?.datammoOrders);
      if (res.data && res.data.chatgpt) {
        const typeOrder = { package1: 0, package2: 1, unassigned: 2 };
        const sortedGPT = [...res.data.chatgpt]
          .map((acc) => ({
            ...acc,
            package2Shelf:
              acc.type === "package2"
                ? normalizePackage2Shelf(acc.package2Shelf)
                : "none",
          }))
          .sort((a, b) => {
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
      setTeamAccounts(
        sortA(res.data?.team).map((acc) => normalizeTeamAccountForUi(acc)),
      );

    } catch (error) {
      if (showLoader) {
        showAlert("Lỗi", "Không thể tải dữ liệu. Vui lòng thử lại.", "error");
        setAccounts([]);
      }
    } finally {
      if (showLoader) setLoading(false);
      isFetchingDataRef.current = false;
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
        package2Shelf: "none",
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

  const openAddUserModal = (accId, prefillName = "") => {
    setUserModalMode("add");
    setCurrentUserData({ accId, index: null, name: prefillName, joinedAt: null, expiredAt: null });
    setShowUserModal(true);
  };

  const openEditUserModal = (accId, index, userData) => {
    setUserModalMode("edit");
    const name = getUserName(userData);
    const joinedAt =
      typeof userData === "object" && userData.joinedAt
        ? userData.joinedAt
        : null;
    const expiredAt =
      typeof userData === "object" && userData.expiredAt
        ? userData.expiredAt
        : null;
    setCurrentUserData({ accId, index, name, joinedAt, expiredAt });
    setShowUserModal(true);
  };

  const handleSubmitUser = async (e) => {
    e.preventDefault();
    const { accId, index, name, joinedAt, expiredAt } = currentUserData;
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
        joinedAt: joinedAt || new Date().toISOString(),
        expiredAt: expiredAt || addDurationToDate(joinedAt || new Date(), "1M").toISOString(),
      });
    } else {
      const oldJoinDate =
        joinedAt ||
        (typeof newUsers[index] === "object" ? newUsers[index].joinedAt : null);
      newUsers[index] = {
        name: name.trim(),
        joinedAt: oldJoinDate,
        expiredAt: expiredAt || (typeof newUsers[index] === "object" ? newUsers[index].expiredAt : null),
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

  // EXTEND USER / SLOT logic
  const handleExtendUser = (accId, userIndex, userObj, platform = "chatgpt") => {
    const userName = userObj?.name || userObj?.customerName || userObj || "khách này";
    let currentExpire = null;
    if (userObj?.expiredAt) {
      currentExpire = new Date(userObj.expiredAt).toLocaleDateString("vi-VN");
    }

    setExtendData({ accId, userIndex, platform, currentName: userName, currentExpire, userObj });
    setExtendDaysOption("1M");
    setShowExtendModal(true);
  };

  const handleSubmitExtend = async (e) => {
    e.preventDefault();
    if (!extendData) return;

    setLoadingStates((prev) => ({ ...prev, extendUser: true }));
    try {
      const extensionLabel = getDurationLabel(extendDaysOption);
      if (extendData.platform === "team") {
        // Team Account Slot Extension
        const teamAcc = teamAccounts.find(a => a.id === extendData.accId);
        if (!teamAcc) throw new Error("Team Account not found");
        const updSlots = [...teamAcc.slots];
        const slot = updSlots[extendData.userIndex];

        const now = new Date();
        const baseDate = slot.expiredAt && new Date(slot.expiredAt) > now ? new Date(slot.expiredAt) : now;
        const newExpiredAt = addDurationToDate(baseDate, extendDaysOption).toISOString();

        updSlots[extendData.userIndex] = { ...slot, expiredAt: newExpiredAt };
        await axios.put(`/api/team/${teamAcc.id}`, { slots: updSlots });
      } else {
        // General Account Extension
        await axios.post("/api/extend-user", {
          accId: extendData.accId,
          userIndex: extendData.userIndex,
          platform: extendData.platform,
          extDuration: extendDaysOption,
        });
      }

      setShowExtendModal(false);
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã gia hạn thêm ${extensionLabel}!`, "success");
    } catch (error) {
      showAlert("Lỗi", error.response?.data?.error || "Không thể gia hạn", "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, extendUser: false }));
    }
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
  const openMoveUserModal = (accId, index, userData, platform = "chatgpt") => {
    setMovingUser({ fromAccId: accId, userIndex: index, platform, ...userData });
    setDestinationAccId("");
    setShowMoveUserModal(true);
  };

  const handleSubmitMoveUser = async (e) => {
    e.preventDefault();
    if (!destinationAccId)
      return showAlert("Lỗi", "Chưa chọn tài khoản đích!", "warning");

    setLoadingStates((prev) => ({ ...prev, moveUser: true }));
    try {
      if (movingUser.platform === "chatgpt") {
        await axios.post("/api/move-user", {
          fromAccId: movingUser.fromAccId,
          toAccId: destinationAccId,
          userIndex: movingUser.userIndex,
        });
      } else {
        await axios.post("/api/simple-move-user", {
          fromAccId: movingUser.fromAccId,
          toAccId: destinationAccId,
          platform: movingUser.platform,
        });
      }
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

  // TEAM MOVE SLOT LOGIC
  const openMoveSlotModal = (accId, slIndex, sData) => {
    setMovingSlot({ fromAccId: accId, slotIndex: slIndex, ...sData });
    setDestinationAccId("");
    setShowMoveSlotModal(true);
  };

  const handleSubmitMoveSlot = async (e) => {
    e.preventDefault();
    if (!destinationAccId) return showAlert("Lỗi", "Chưa chọn tài khoản đích!", "warning");

    setLoadingStates((prev) => ({ ...prev, moveUser: true }));
    try {
      await axios.post("/api/team-move-slot", {
        fromAccId: movingSlot.fromAccId,
        toAccId: destinationAccId,
        slotIndex: movingSlot.slotIndex,
      });
      setShowMoveSlotModal(false);
      setMovingSlot(null);
      fetchData();
      broadcastDataChange();
      showAlert("Thành Công", `Đã chuyển khách sang tài khoản Team khác!`, "success");
    } catch (error) {
      showAlert("Lỗi", error.response?.data?.error || "Lỗi khi chuyển slot", "error");
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
          const daysRemaining = getDaysRemaining(u);

          // User còn hạn nếu:
          // - Có expiry còn thời hạn
          // - Hoặc không có joinedAt (mới thêm, chưa set ngày) -> coi như còn hạn
          const isActive =
            (daysRemaining !== null && daysRemaining > 0) ||
            u.joinedAt === null ||
            u.joinedAt === undefined;

          if (isActive) {
            activeUsers.push({
              ...u,
              fromAccId: accToDelete.id,
              userIndex: idx,
              accountUsername: accToDelete.username,
              daysUsed: days !== null ? days : 0,
              daysRemaining: daysRemaining !== null ? daysRemaining : null,
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

  const handleDeleteTeamAccount = (accId) => {
    const accToDelete = teamAccounts.find(a => a.id === accId);
    if (!accToDelete) return;

    const activeSlots = [];
    (accToDelete.slots || []).forEach((slot, idx) => {
      if (slot.status === "active") {
        const days = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
        if (days === null || days > 0) {
          activeSlots.push({
            ...slot,
            fromAccId: accId,
            originalIndex: idx,
            teamUsername: accToDelete.username
          });
        }
      }
    });

    if (activeSlots.length > 0) {
      setOrphanedSlots(activeSlots);
      setShowOrphanedSlotsModal(true);
      return;
    }

    showConfirm("Xóa Team Acc", `Bạn có chắc chắn muốn xóa tài khoản "${accToDelete.username}"?`, async () => {
      setLoadingStates((prev) => ({ ...prev, deleteAccount: true }));
      try {
        await axios.delete(`/api/team/${accId}`);
        fetchData();
        broadcastDataChange();
        showAlert("Đã xóa", "Team account đã bị xóa.", "info");
      } catch (err) {
        showAlert("Lỗi", "Lỗi xóa team account: " + err.message, "error");
      } finally {
        setLoadingStates((prev) => ({ ...prev, deleteAccount: false }));
      }
    });
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

    if (acc.type === "package2" && (acc.users?.length || 0) > 0) {
      if (newType !== "package2") {
        showAlert(
          "CHẶN THAO TÁC",
          "⚠️ Gói Private đang có khách. Vui lòng xóa khách trước khi đổi gói!",
          "error",
        );
        setAccounts((prev) => [...prev]);
        const selectElement = document.getElementById(`select-type-${acc.id}`);
        if (selectElement) selectElement.value = "package2";
        return;
      }
    }
    setLoadingStates((prev) => ({
      ...prev,
      changeType: { ...prev.changeType, [acc.id]: true },
    }));
    try {
      const nextShelf =
        newType === "package2"
          ? normalizePackage2Shelf(
            acc.type === "package2" ? acc.package2Shelf : "none",
          )
          : "none";
      await axios.put(`/api/chatgpt/${acc.id}`, {
        type: newType,
        package2Shelf: nextShelf,
      });
      fetchData();
      broadcastDataChange();
    } catch (error) {
      const msg = error?.response?.data?.error || "Lỗi đổi gói";
      showAlert("Chặn Thao Tác", msg, "error");
      // Reset dropdown về giá trị gói cũ
      const selectElement = document.getElementById(`select-type-${acc.id}`);
      if (selectElement) selectElement.value = acc.type;
    } finally {
      setLoadingStates((prev) => ({
        ...prev,
        changeType: { ...prev.changeType, [acc.id]: false },
      }));
    }
  };

  const handlePackage2ShelfChange = async (acc, shelfValue) => {
    if (acc.type !== "package2") return;
    if (loadingStates.changeShelf[acc.id] || loadingStates.changeType[acc.id]) {
      return;
    }
    const nextShelf = normalizePackage2Shelf(shelfValue);
    const currentShelf = normalizePackage2Shelf(acc.package2Shelf);
    if (currentShelf === nextShelf) return;

    setLoadingStates((prev) => ({
      ...prev,
      changeShelf: { ...prev.changeShelf, [acc.id]: true },
    }));
    try {
      const response = await axios.put(`/api/chatgpt/${acc.id}`, {
        package2Shelf: nextShelf,
      });
      const updatedAcc = response?.data?.account;
      if (updatedAcc?.id) {
        setAccounts((prev) =>
          prev.map((item) =>
            item.id === updatedAcc.id
              ? {
                ...item,
                ...updatedAcc,
                package2Shelf: normalizePackage2Shelf(updatedAcc.package2Shelf),
              }
              : item,
          ),
        );
      } else {
        await fetchData();
      }
      broadcastDataChange();
    } catch (error) {
      const msg = error?.response?.data?.error || "Lỗi đổi kệ gói 2";
      showAlert("Lỗi", msg, "error");
    } finally {
      setLoadingStates((prev) => ({
        ...prev,
        changeShelf: { ...prev.changeShelf, [acc.id]: false },
      }));
    }
  };

  const handleToggleChatgptSelection = (accId, checked) => {
    const id = String(accId || "");
    if (!id) return;
    setSelectedChatgptIds((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((item) => item !== id);
    });
  };

  const handleToggleSelectAllFilteredChatgpt = (
    checked,
    filteredAccountIds = [],
  ) => {
    const ids = Array.isArray(filteredAccountIds)
      ? filteredAccountIds
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      : [];
    setSelectedChatgptIds((prev) => {
      const selected = new Set(prev);
      if (checked) {
        ids.forEach((id) => selected.add(id));
      } else {
        ids.forEach((id) => selected.delete(id));
      }
      return Array.from(selected);
    });
  };

  const setBulkPushRealtimeProgress = (completed, total) => {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCompleted = Math.max(
      0,
      Math.min(safeTotal, Number(completed) || 0),
    );
    const percent =
      safeTotal > 0 ? Math.round((safeCompleted / safeTotal) * 100) : 0;
    setBulkPushProgress({
      total: safeTotal,
      completed: safeCompleted,
      percent,
    });
  };

  const resetBulkPushProgress = () => {
    setBulkPushRealtimeProgress(0, 0);
  };

  const mergeBulkPushResult = (aggregate, partial = {}) => {
    aggregate.updated += Number(partial.updated || 0);
    aggregate.unchanged += Number(partial.unchanged || 0);
    aggregate.skippedHasUsers += Number(partial.skippedHasUsers || 0);
    aggregate.missing += Number(partial.missing || 0);
    aggregate.failed += Number(partial.failed || 0);

    if (Array.isArray(partial.failedIds) && partial.failedIds.length > 0) {
      aggregate.failedIds.push(...partial.failedIds);
    }
    if (Array.isArray(partial.missingIds) && partial.missingIds.length > 0) {
      aggregate.missingIds.push(...partial.missingIds);
    }
    if (
      Array.isArray(partial.failedDetails) &&
      partial.failedDetails.length > 0
    ) {
      aggregate.failedDetails.push(...partial.failedDetails);
    }
    if (
      Array.isArray(partial.skippedAccounts) &&
      partial.skippedAccounts.length > 0
    ) {
      aggregate.skippedAccounts.push(...partial.skippedAccounts);
    }
  };

  const openBulkPushModal = (filteredAccounts = []) => {
    const filteredIds = filteredAccounts.map((acc) => String(acc.id || ""));
    const hasSelected = selectedChatgptIds.length > 0;
    const hasFiltered = filteredIds.length > 0;
    if (!hasSelected && !hasFiltered) {
      showAlert("Thiếu dữ liệu", "Không có tài khoản nào để đẩy kệ.", "warning");
      return;
    }
    setBulkPushForm((prev) => ({
      ...prev,
      scope: hasSelected ? "selected" : "filtered",
    }));
    resetBulkPushProgress();
    setShowBulkPushModal(true);
  };

  const handleBulkPushToShelf = async (filteredAccounts = []) => {
    const filteredIds = filteredAccounts.map((acc) => String(acc.id || ""));
    const sourceIds =
      bulkPushForm.scope === "filtered" ? filteredIds : selectedChatgptIds;
    const accountIds = Array.from(
      new Set(
        sourceIds
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );

    if (!accountIds.length) {
      showAlert("Thiếu dữ liệu", "Chưa có tài khoản nào được chọn.", "warning");
      return;
    }

    const targetShelf =
      bulkPushForm.targetType === "package2"
        ? normalizePackage2Shelf(bulkPushForm.package2Shelf)
        : undefined;
    const usernameById = new Map(
      accounts.map((acc) => [String(acc.id || ""), acc.username || ""]),
    );
    const aggregateResult = {
      requested: accountIds.length,
      updated: 0,
      unchanged: 0,
      skippedHasUsers: 0,
      missing: 0,
      failed: 0,
      failedIds: [],
      missingIds: [],
      failedDetails: [],
      skippedAccounts: [],
    };
    const clientWorkerCount = Math.max(1, Math.min(4, accountIds.length));
    let queueIndex = 0;
    let processedCount = 0;
    const markProcessed = () => {
      processedCount += 1;
      setBulkPushRealtimeProgress(processedCount, accountIds.length);
    };

    setBulkPushRealtimeProgress(0, accountIds.length);
    setLoadingStates((prev) => ({ ...prev, bulkPush: true }));
    try {
      const workers = Array.from({ length: clientWorkerCount }, () =>
        (async () => {
          while (true) {
            const currentIndex = queueIndex;
            queueIndex += 1;
            if (currentIndex >= accountIds.length) break;

            const accountId = accountIds[currentIndex];
            try {
              const response = await axios.post("/api/chatgpt/bulk-push-shelf", {
                accountIds: [accountId],
                targetType: bulkPushForm.targetType,
                package2Shelf: targetShelf,
              });
              mergeBulkPushResult(aggregateResult, response?.data?.result || {});
            } catch (error) {
              aggregateResult.failed += 1;
              aggregateResult.failedIds.push(accountId);
              aggregateResult.failedDetails.push({
                id: accountId,
                username: usernameById.get(accountId) || "",
                reason:
                  error?.response?.data?.error ||
                  error?.message ||
                  "Loi khong xac dinh",
              });
            } finally {
              markProcessed();
            }
          }
        })(),
      );
      await Promise.all(workers);
      setBulkPushRealtimeProgress(accountIds.length, accountIds.length);

      const requested = Number(
        aggregateResult.requested || accountIds.length || 0,
      );
      const updated = Number(aggregateResult.updated || 0);
      const unchanged = Number(aggregateResult.unchanged || 0);
      const skippedHasUsers = Number(aggregateResult.skippedHasUsers || 0);
      const missing = Number(aggregateResult.missing || 0);
      const failed = Number(aggregateResult.failed || 0);
      const unfinished = skippedHasUsers + missing + failed;
      const failedDetails = Array.isArray(aggregateResult.failedDetails)
        ? aggregateResult.failedDetails
        : [];
      const skippedAccounts = Array.isArray(aggregateResult.skippedAccounts)
        ? aggregateResult.skippedAccounts
        : [];
      const msg = [
        `Đã chọn: ${requested}`,
        `Đẩy Datammo thành công: ${updated}`,
        `Chưa hoàn tất: ${unfinished}`,
        `Luồng xử lý song song: ${clientWorkerCount}`,
        `Không đổi: ${unchanged}`,
        `Bỏ qua (đang có khách): ${skippedHasUsers}`,
        `Không tìm thấy: ${missing}`,
        `Lỗi đồng bộ Datammo: ${failed}`,
      ].join("\n");
      const detailLines = [];
      if (failedDetails.length > 0) {
        detailLines.push("\nChi tiết lỗi:");
        failedDetails.slice(0, 10).forEach((item) => {
          const label = item?.username ? `${item.username} (${item.id})` : item?.id;
          detailLines.push(`- ${label}: ${item?.reason || "Lỗi không xác định"}`);
        });
      }
      if (skippedAccounts.length > 0) {
        detailLines.push("\nBỏ qua do đang có khách:");
        skippedAccounts.slice(0, 10).forEach((item) => {
          const label = item?.username ? `${item.username} (${item.id})` : item?.id;
          detailLines.push(`- ${label}`);
        });
      }
      setShowBulkPushModal(false);
      setSelectedChatgptIds([]);
      await fetchData();
      broadcastDataChange();
      showAlert(
        unfinished > 0 ? "Đẩy kệ chưa hoàn tất" : "Đẩy kệ hoàn tất",
        `${msg}${detailLines.length ? `\n${detailLines.join("\n")}` : ""}`,
        unfinished > 0 ? "warning" : "success",
      );
    } catch (error) {
      const msg = error?.response?.data?.error || "Không thể đẩy kệ hàng loạt";
      showAlert("Lỗi", msg, "error");
    } finally {
      setLoadingStates((prev) => ({ ...prev, bulkPush: false }));
      resetBulkPushProgress();
    }
  };

  const handleQuickTeamSaleModeChange = async (acc, nextMode) => {
    const targetMode = normalizeTeamSaleMode(nextMode);
    const currentMode = normalizeTeamSaleMode(acc?.saleMode);
    if (!acc?.id || targetMode === currentMode) return;

    setLoadingStates((prev) => ({
      ...prev,
      teamMode: { ...(prev.teamMode || {}), [acc.id]: true },
    }));
    try {
      const response = await axios.put(`/api/team/${acc.id}`, {
        saleMode: targetMode,
      });
      const updatedAcc = response?.data?.account;
      if (updatedAcc?.id) {
        setTeamAccounts((prev) =>
          prev.map((item) =>
            item.id === updatedAcc.id
              ? { ...item, ...updatedAcc, saleMode: normalizeTeamSaleMode(updatedAcc.saleMode) }
              : item,
          ),
        );
      } else {
        await fetchData();
      }
      broadcastDataChange();
      showAlert(
        "Đã đổi loại Team",
        targetMode === "business"
          ? "Đã chuyển sang Business account."
          : "Đã chuyển sang Slot team.",
        "success",
      );
    } catch (error) {
      const msg = error?.response?.data?.error || "Không thể đổi loại Team";
      showAlert("Lỗi", msg, "error");
    } finally {
      setLoadingStates((prev) => {
        const next = { ...(prev.teamMode || {}) };
        delete next[acc.id];
        return { ...prev, teamMode: next };
      });
    }
  };

  const handleCopy = (text, message = "Đã copy nội dung!") => {
    navigator.clipboard.writeText(text);
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2000);
  };

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
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
        {/* TOP BANNER */}
        <div className="text-center py-3 px-4 text-sm font-semibold bg-blue-600 text-white">
          ✨ Liên hệ mua tài khoản qua Zalo: <a href="https://zalo.me/0345440153" target="_blank" rel="noreferrer" className="underline font-bold hover:text-yellow-300 transition-colors">0345440153</a>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
          {/* HEADER */}
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black mb-3 text-white">
              🛒 Dịch Vụ Tài Khoản Premium
            </h1>
            <p className="text-slate-400 text-lg">Cấp nhanh · Ổn định · Hỗ trợ 24/7</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-8 items-start">
            {/* LEFT — Service Cards */}
            <div className="flex-1 space-y-6">

              {/* ChatGPT */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-700 bg-slate-900">
                <div className="px-6 py-4 flex items-center gap-4 bg-blue-700">
                  <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow">
                    <img src="/chatgptlogo.png" alt="ChatGPT" className="w-11 h-11 object-cover object-center" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white">ChatGPT Plus</h2>
                    <p className="text-blue-100 text-sm">Trí tuệ nhân tạo mạnh nhất thế giới</p>
                  </div>
                </div>
                <div className="p-5 grid sm:grid-cols-2 gap-4">
                  <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-blue-300 font-bold">🔥 Gói 1 – Chia sẻ</span>
                      <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-bold">TIẾT KIỆM</span>
                    </div>
                    <ul className="mt-2 text-sm text-slate-300 space-y-1">
                      <li>• 👥 1 tài khoản / 3 người dùng chung</li>
                      <li>• ⚡ Cấp sẵn – vào dùng ngay</li>
                      <li>• 🔒 Không đổi mật khẩu</li>
                      <li>• 💬 Liên hệ để nhận báo giá</li>
                    </ul>
                  </div>
                  <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-purple-300 font-bold">🔥 Gói 2 – Riêng tư</span>
                      <span className="bg-purple-700 text-white text-xs px-2 py-0.5 rounded font-bold">PREMIUM</span>
                    </div>
                    <ul className="mt-2 text-sm text-slate-300 space-y-1">
                      <li>• 👤 Dùng 1 mình hoặc cùng bạn bè</li>
                      <li>• 🔑 Toàn quyền đăng nhập</li>
                      <li>• 🔄 Tự đổi mật khẩu</li>
                      <li>• 💬 Liên hệ để nhận báo giá</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Other Services */}
              <div className="rounded-2xl overflow-hidden shadow-xl border border-slate-700 bg-slate-900">
                <div className="px-6 py-4 flex items-center gap-3 bg-teal-700">
                  <span className="text-2xl">⭐</span>
                  <div>
                    <h2 className="text-xl font-black text-white">Tài Khoản Pro Khác</h2>
                    <p className="text-teal-100 text-sm">Nhiều dịch vụ, chất lượng đảm bảo</p>
                  </div>
                </div>
                <div className="p-5 grid sm:grid-cols-2 gap-3">
                  {[
                    { logo: "/canvalogo.jpg", name: "Canva Edu", desc: "Dùng như Pro", note: "Liên hệ để nhận báo giá", bg: "bg-purple-900/40 border-purple-800" },
                    { logo: "/netfflixlogo.png", name: "Netflix Premium", desc: "Full HD, 4K", note: "Liên hệ để nhận báo giá", bg: "bg-red-900/40 border-red-800" },
                    { logo: "/quizletlogo.png", name: "Quizlet", desc: "Học tập thông minh", note: "Liên hệ để nhận báo giá", bg: "bg-blue-900/40 border-blue-800" },
                    { logo: "/capcutlogo.png", name: "CapCut Pro", desc: "Chỉnh video chuyên nghiệp", note: "Liên hệ để nhận báo giá", bg: "bg-slate-800 border-slate-600" },
                    { logo: "/ytblogo.png", name: "YouTube Premium", desc: "Không quảng cáo", note: "Liên hệ để nhận báo giá", bg: "bg-rose-900/40 border-rose-800" },
                  ].map((s, i) => (
                    <div key={i} className={`${s.bg} border rounded-xl p-4 flex items-center gap-3`}>
                      <div className="shrink-0 w-12 h-12 rounded-xl bg-white flex items-center justify-center overflow-hidden shadow">
                        <img src={s.logo} alt={s.name} className="w-11 h-11 object-cover object-center" onError={(e) => { e.target.style.display = 'none'; }} />
                      </div>
                      <div>
                        <div className="font-bold text-white">{s.name}</div>
                        <div className="text-xs text-slate-400 mb-0.5">{s.desc}</div>
                        <div className="text-yellow-400 font-black text-sm">{s.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="rounded-2xl p-5 text-center border border-slate-700 bg-slate-800">
                <p className="text-lg font-bold text-white mb-3">📞 Liên Hệ Ngay Để Mua</p>
                <a href="https://zalo.me/0345440153" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 px-8 py-3 rounded-lg font-black text-white text-lg bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg">
                  💬 Zalo: 0345440153
                </a>
                <p className="text-slate-500 text-xs mt-3">Hỗ trợ 24/7 · Cấp ngay sau thanh toán</p>
              </div>
            </div>

            {/* RIGHT — Admin Login */}
            <div className="w-full lg:w-80 shrink-0">
              <div className="rounded-2xl p-6 border border-slate-700 shadow-xl bg-slate-900 sticky top-6">
                <div className="flex justify-center mb-4 text-blue-400">
                  <div className="w-14 h-14 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700">
                    <Lock size={28} />
                  </div>
                </div>
                <h2 className="text-lg font-bold text-center text-slate-400 mb-5">🔐 Đăng Nhập Admin</h2>
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Email</label>
                    <input
                      type="text"
                      className="form-input w-full text-sm"
                      placeholder="admin@example.com"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Mật khẩu</label>
                    <input
                      type="password"
                      className="form-input w-full text-sm"
                      placeholder="••••••••"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="w-full btn-primary justify-center flex items-center gap-2 py-2.5 text-sm">
                    <LogIn size={16} /> Đăng Nhập
                  </button>
                </form>
                {alertInfo.show && (
                  <div className={`mt-3 p-2 rounded text-center text-xs font-bold ${alertInfo.type === "error" ? "bg-red-900/50 text-red-400" : "bg-green-900/50 text-green-400"}`}>
                    {alertInfo.message}
                  </div>
                )}
                <p className="text-center text-slate-600 text-xs mt-4">Dành riêng cho Admin hệ thống</p>
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="text-center py-6 text-slate-600 text-xs border-t border-slate-800">
          © 2025 Dịch Vụ Tài Khoản Premium · Liên hệ: <a href="https://zalo.me/0345440153" className="hover:text-slate-400 underline">0345440153</a>
        </div>
      </div>
    );
  }

  const filteredChatgptAccounts = accounts
    .filter((acc) => {
      if (gptSubTab === "package1") return acc.type === "package1";
      if (gptSubTab === "package2") return acc.type === "package2";
      if (gptSubTab === "unassigned") return !acc.type || acc.type === "unassigned";
      return true;
    })
    .filter((acc) => {
      if (gptSubTab !== "package2") return true;
      if (package2ShelfTab === "all") return true;
      if (acc.type !== "package2") return false;
      return normalizePackage2Shelf(acc.package2Shelf) === package2ShelfTab;
    })
    .filter((acc) => {
      if (!searchQuery.trim()) return true;
      const queryNormalized = toNonAccentVietnamese(searchQuery);
      if (
        acc.username &&
        toNonAccentVietnamese(acc.username).includes(queryNormalized)
      ) {
        return true;
      }
      if (acc.users && acc.users.length > 0) {
        return acc.users.some((user) => {
          const name = typeof user === "object" ? user.name : user;
          return (
            name &&
            toNonAccentVietnamese(name).includes(queryNormalized)
          );
        });
      }
      return false;
    });
  const filteredChatgptIds = filteredChatgptAccounts.map((acc) =>
    String(acc.id || ""),
  );
  const selectedChatgptIdSet = new Set(selectedChatgptIds);
  const selectedInFilteredCount = filteredChatgptIds.filter((id) =>
    selectedChatgptIdSet.has(id),
  ).length;
  const allFilteredSelected =
    filteredChatgptIds.length > 0 &&
    selectedInFilteredCount === filteredChatgptIds.length;
  const teamSlotAccounts = teamAccounts.filter(
    (acc) => normalizeTeamSaleMode(acc.saleMode) === "slot",
  );
  const teamBusinessAccounts = teamAccounts.filter(
    (acc) => normalizeTeamSaleMode(acc.saleMode) === "business",
  );
  const teamSections = [
    {
      key: "slot",
      title: "Team Slot",
      subtitle: "Bán theo từng slot (tối đa 4 slot/account)",
      accounts: teamSlotAccounts,
      badgeClass: "bg-teal-900/40 text-teal-300 border-teal-700/60",
      panelClass: "border-teal-700/40 bg-teal-950/10",
    },
    {
      key: "business",
      title: "Team Business",
      subtitle: "Bán theo account gốc (1 account/item)",
      accounts: teamBusinessAccounts,
      badgeClass: "bg-cyan-900/40 text-cyan-300 border-cyan-700/60",
      panelClass: "border-cyan-700/40 bg-cyan-950/10",
    },
  ];

  // MAIN DASHBOARD
  return (
    <div
      className="min-h-screen text-slate-200 p-2 sm:p-4 md:p-8 font-sans overflow-x-hidden"
      style={{ backgroundColor: "#0f172a" }}
    >
      <div className="max-w-7xl mx-auto relative">
        {/* TOAST MSG */}
        {toastMessage && (
          <div className="fixed bottom-10 right-10 bg-emerald-600/95 backdrop-blur-sm text-white px-5 py-3 rounded-xl shadow-2xl z-[9999] flex items-center gap-2 animate-bounce min-w-[200px] border border-emerald-400 font-bold">
            <div className="bg-emerald-500 rounded-full p-1"><CheckCircle size={16} /></div> {toastMessage}
          </div>
        )}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-slate-800 p-4 md:p-6 rounded-xl shadow-lg border border-slate-700 max-w-full overflow-hidden">
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
          <div className="flex bg-slate-900 p-1 rounded-3xl border border-slate-700 items-center overflow-x-auto w-full max-w-full no-scrollbar">
            <button
              onClick={() => setActiveTab("chatgpt")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "chatgpt" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              ChatGPT
            </button>
            <button
              onClick={() => setActiveTab("netflix")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "netflix" ? "bg-red-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Netflix
            </button>
            <button
              onClick={() => setActiveTab("capcut")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "capcut" ? "bg-green-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              CapCut
            </button>
            <button
              onClick={() => setActiveTab("canva")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "canva" ? "bg-purple-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
            >
              Canva
            </button>

            <button
              onClick={() => setActiveTab("coursera")}
              className={`whitespace-nowrap shrink-0 px-4 md:px-6 py-2 rounded-3xl font-medium transition-all ${activeTab === "coursera" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}
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

        {recentDatammoOrders.length > 0 && (
          <div className="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-950/25 shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-4 md:p-5">
              <div className="min-w-0 flex items-start gap-3">
                <div className="shrink-0 rounded-full p-2 bg-emerald-500/20 text-emerald-300 border border-emerald-400/20">
                  <CheckCircle size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] font-black text-emerald-300">
                    Datammo Seller Alert
                  </div>
                  <div className="text-lg md:text-xl font-black text-white">
                    Vừa có đơn mới từ Datammo
                  </div>
                  <div className="mt-3 space-y-2">
                    {recentDatammoOrders.slice(0, 3).map((order) => {
                      const accountsInOrder =
                        Array.isArray(order.accounts) && order.accounts.length > 0
                          ? order.accounts
                          : [{ username: "Không rõ acc" }];
                      return (
                        <div
                          key={buildDatammoOrderKey(order)}
                          className="rounded-xl border border-emerald-400/15 bg-black/15 px-3 py-2"
                        >
                          <div className="space-y-1">
                            {accountsInOrder.map((account, index) => (
                              <div
                                key={`${buildDatammoOrderKey(order)}-${index}`}
                                className="font-semibold text-white break-all"
                              >
                                Vừa bán acc {account.username || account.accountId || "Không rõ"} cho order {order.orderId || "N/A"}
                              </div>
                            ))}
                          </div>
                          {order.createdAt && (
                            <div className="mt-1 text-xs text-emerald-100/75">
                              {new Date(order.createdAt).toLocaleString("vi-VN")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {recentDatammoOrders.length > 3 && (
                      <div className="text-xs text-emerald-100/80">
                        +{recentDatammoOrders.length - 3} đơn nữa đang chờ bạn xem.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecentDatammoOrders([])}
                className="shrink-0 rounded-full p-2 text-emerald-200 hover:bg-white/10 hover:text-white transition-colors"
                title="Ẩn banner đơn mới"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

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

              // Case D: Gói 2 còn <=25 ngày và không có khách → cảnh báo gỡ khỏi Datammo
              accounts.forEach((acc) => {
                if (acc.type !== "package2") return;
                if (normalizePackage2Shelf(acc.package2Shelf) === "none") return;
                if (acc.users && acc.users.length > 0) return; // đang có khách, bỏ qua
                const daysLeft = acc.expiredAt
                  ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000)
                  : null;
                if (daysLeft !== null && daysLeft <= 25 && daysLeft > 0) {
                  urgentList.push({
                    type: "pkg2_expiring_soon",
                    acc,
                    u: { name: `Gói 2 còn ${daysLeft} ngày` },
                    idx: -1,
                    days: daysLeft,
                    msg: `⚠️ Gói 2 sắp hết hạn (còn ${daysLeft} ngày). Hãy gỡ khỏi shop Datammo!`,
                  });
                }
              });

              teamAccounts.forEach((acc) => {
                const isAccExpired = acc.expiredAt && new Date(acc.expiredAt) < new Date();
                const activeSlots = (acc.slots || []).map((slot, idx) => ({ slot, idx })).filter(item => item.slot.status === "active");

                if (activeSlots.length > 0) {
                  activeSlots.forEach(({ slot, idx }) => {
                    const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                    const isSlotExpired = sExpDays !== null && sExpDays <= 0;

                    if (isSlotExpired) {
                      urgentList.push({
                        type: "team_slot_expired",
                        acc,
                        u: slot,
                        idx,
                        days: sExpDays,
                        msg: `Khách Team hết hạn (${Math.abs(sExpDays)} ngày quá hạn)`,
                      });
                    } else if (isAccExpired) {
                      urgentList.push({
                        type: "team_acc_expired",
                        acc,
                        u: slot,
                        idx,
                        days: sExpDays,
                        msg: "TEAM ĐÃ HẾT HẠN - CẦN CHUYỂN GẤP!",
                      });
                    }
                  });
                } else if (isAccExpired) {
                  urgentList.push({
                    type: "team_empty_expired",
                    acc,
                    u: { name: "TEAM TRỐNG" },
                    idx: -1,
                    days: 0,
                    msg: "Team Acc hết hạn & Trống -> Cần Xóa!",
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
                          className={`flex items-center justify-between p-3 rounded border ${
                            type === "pkg2_expiring_soon"
                              ? "bg-yellow-950/30 border-yellow-600/40"
                              : "bg-slate-900/50 border-red-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-full ${
                                type === "pkg2_expiring_soon"
                                  ? "bg-yellow-500/20 text-yellow-400"
                                  : type.includes("acc_expired")
                                  ? "bg-orange-500/20 text-orange-500"
                                  : "bg-red-500/20 text-red-500"
                              }`}
                            >
                              {type === "pkg2_expiring_soon" ? (
                                <Globe size={20} />
                              ) : type.includes("acc_expired") ? (
                                <Shield size={20} />
                              ) : (
                                <User size={20} />
                              )}
                            </div>
                            <div>
                              <div className={`font-bold text-lg ${
                                type === "pkg2_expiring_soon" ? "text-yellow-400" : "text-red-400"
                              }`}>
                                {type === "pkg2_expiring_soon" ? acc.username : type.includes("team") ? (u.customerName || u.gmail || u.name || "Khách Team") : (u.name || u.email)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {type === "pkg2_expiring_soon" ? (
                                  <span className="text-yellow-500 font-bold">{msg}</span>
                                ) : (
                                  <>{type.includes("team") ? "Team: " : "Thường: "}<span className="text-white">{acc.username}</span>{" "}•<span className="text-red-500 font-bold ml-1">{msg}</span></>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            {type === "user_expired" || type === "team_slot_expired" ? (
                              // Action for Expired User: EXTEND
                              <>
                                <button
                                  onClick={() =>
                                    handleExtendUser(acc.id, idx, u, type.includes("team") ? "team" : "chatgpt")
                                  }
                                  className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <RotateCw size={18} /> GIA HẠN
                                </button>
                                <button
                                  onClick={async () => {
                                    if (type === "team_slot_expired") {
                                      const updSlots = [...acc.slots];
                                      updSlots[idx] = { ...u, status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                                      await axios.put(`/api/team/${acc.id}`, { slots: updSlots });
                                      fetchData();
                                      showAlert("Thành công", "Đã xóa khách Team!", "success");
                                    } else {
                                      handleDeleteUser(acc.id, idx, u.name)
                                    }
                                  }}
                                  className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform"
                                >
                                  <Trash2 size={18} /> XÓA
                                </button>
                              </>
                            ) : type === "acc_expired" || type === "team_acc_expired" ? (
                              // Action for Expired Account (With Users): MOVE USER (Rescue)
                              <button
                                onClick={() =>
                                  type === "team_acc_expired" ? openMoveSlotModal(acc.id, idx, u) : openMoveUserModal(acc.id, idx, u)
                                }
                                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse"
                              >
                                <ArrowRightLeft size={18} /> CỨU USER (CHUYỂN
                                GẤP)
                              </button>
                            ) : type === "acc_empty_expired" || type === "team_empty_expired" ? (
                              // Action for Expired Account (Empty): DELETE ACCOUNT
                              <button
                                onClick={() => {
                                  if (type === "team_empty_expired") {
                                    handleDeleteTeamAccount(acc.id);
                                  } else {
                                    setDeletingId(acc.id);
                                    setShowDeleteModal(true);
                                  }
                                }}
                                className="flex items-center gap-2 bg-red-800 hover:bg-red-600 text-white px-4 py-2 rounded font-bold shadow-lg hover:scale-105 transition-transform animate-pulse border border-red-500"
                              >
                                <Trash2 size={18} /> XÓA {type.includes("team") ? "TEAM" : "CHATGPT"} RÁC
                              </button>
                            ) : type === "pkg2_expiring_soon" ? (
                              // Gói 2 sắp hết hạn: nhắc nhở admin gỡ khỏi Datammo
                              <div className="flex items-center gap-2">
                                <span className="text-yellow-400 text-xs font-bold px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/40 rounded">
                                  🛒 Đã tự gỡ khỏi Datammo (hệ thống tự động)
                                </span>
                              </div>
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
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-slate-300 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700">
                  Đã chọn: <span className="font-bold text-white">{selectedChatgptIds.length}</span>
                </div>
                {selectedChatgptIds.length > 0 && (
                  <button
                    onClick={() => setSelectedChatgptIds([])}
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-semibold text-sm"
                  >
                    Bỏ chọn
                  </button>
                )}
                <button
                  onClick={() => openBulkPushModal(filteredChatgptAccounts)}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-semibold shadow-lg hover:translate-y-[-2px] transition-transform justify-center"
                >
                  <Globe size={18} /> Đẩy nhanh lên kệ
                </button>
                <button
                  onClick={() => setShowImportGPTModal(true)}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-semibold shadow-lg hover:translate-y-[-2px] transition-transform justify-center"
                >
                  <Upload size={18} /> Import Nhanh Tài Khoản
                </button>
              </div>
            </div>

            {/* SUB-TABS: Gói 1 / Gói 2 / Chưa chọn */}
            {(() => {
              const pkg1Count = accounts.filter(a => a.type === "package1").length;
              const pkg2Count = accounts.filter(a => a.type === "package2").length;
              const unassignedCount = accounts.filter(a => !a.type || a.type === "unassigned").length;
              const tabs = [
                { key: "all", label: "📋 Tất cả", count: accounts.length, color: "bg-slate-600" },
                { key: "package1", label: "👥 Gói 1 – Chia sẻ", count: pkg1Count, color: "bg-blue-600" },
                { key: "package2", label: "🔒 Gói 2 – Riêng tư", count: pkg2Count, color: "bg-purple-600" },
                { key: "unassigned", label: "❓ Chưa chọn", count: unassignedCount, color: "bg-slate-700" },
              ];
              return (
                <div className="flex gap-2 flex-wrap mb-4">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setGptSubTab(t.key);
                        if (t.key !== "package2") setPackage2ShelfTab("all");
                      }}
                      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full font-bold text-sm transition-all shadow-sm border ${gptSubTab === t.key
                          ? `${t.color} text-white border-transparent`
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700"
                        }`}
                    >
                      {t.label}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${gptSubTab === t.key ? "bg-white/20" : "bg-slate-700 text-slate-300"
                        }`}>{t.count}</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {gptSubTab === "package2" && (() => {
              const package2Accs = accounts.filter((a) => a.type === "package2");
              const mainCount = package2Accs.filter(
                (a) => normalizePackage2Shelf(a.package2Shelf) === "main",
              ).length;
              const cheapCount = package2Accs.filter(
                (a) => normalizePackage2Shelf(a.package2Shelf) === "cheap",
              ).length;
              const noneCount = package2Accs.filter(
                (a) => normalizePackage2Shelf(a.package2Shelf) === "none",
              ).length;
              const shelfTabs = [
                { key: "all", label: "Kệ: Tất cả", count: package2Accs.length, color: "bg-slate-600" },
                { key: "main", label: "Kệ tổng", count: mainCount, color: "bg-teal-600" },
                { key: "cheap", label: "Kệ rẻ", count: cheapCount, color: "bg-emerald-600" },
                { key: "none", label: "Không kệ", count: noneCount, color: "bg-slate-700" },
              ];
              return (
                <div className="flex gap-2 flex-wrap mb-4">
                  {shelfTabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setPackage2ShelfTab(t.key)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs transition-all border ${package2ShelfTab === t.key
                          ? `${t.color} text-white border-transparent`
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700"
                        }`}
                    >
                      {t.label}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${package2ShelfTab === t.key ? "bg-white/20" : "bg-slate-700 text-slate-300"
                        }`}>{t.count}</span>
                    </button>
                  ))}
                </div>
              );
            })()}

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
                      <th className="w-12 text-center">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={(e) =>
                            handleToggleSelectAllFilteredChatgpt(
                              e.target.checked,
                              filteredChatgptIds,
                            )
                          }
                          title="Chọn tất cả tài khoản đang lọc"
                          className="w-4 h-4 accent-emerald-500 cursor-pointer"
                        />
                      </th>
                      <th className="w-40">Loại Gói</th>
                      <th>Thông Tin</th>
                      <th className="w-32">Link Mail</th>
                      <th className="w-64">Slot / Khách (Sửa/Xóa)</th>
                      <th className="text-center w-24">Hành Động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChatgptAccounts.map((acc) => (
                        <tr
                          key={acc.id}
                          className="hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="align-top text-center">
                            <input
                              type="checkbox"
                              checked={selectedChatgptIdSet.has(String(acc.id || ""))}
                              onChange={(e) =>
                                handleToggleChatgptSelection(acc.id, e.target.checked)
                              }
                              title="Chọn tài khoản"
                              className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer"
                            />
                          </td>
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
                            {acc.type === "package2" && (
                              <div className="mt-2">
                                <select
                                  value={normalizePackage2Shelf(acc.package2Shelf)}
                                  onChange={(e) =>
                                    handlePackage2ShelfChange(acc, e.target.value)
                                  }
                                  disabled={
                                    loadingStates.changeType[acc.id] ||
                                    loadingStates.changeShelf[acc.id]
                                  }
                                  className={`
                                    w-full text-[11px] rounded px-2 py-1.5 outline-none font-semibold border text-center
                                    ${normalizePackage2Shelf(acc.package2Shelf) === "none"
                                      ? "bg-slate-800 text-slate-300 border-slate-600"
                                      : "bg-teal-900/40 text-teal-300 border-teal-700/60"}
                                  `}
                                >
                                  <option value="main">1 - Kệ tổng</option>
                                  <option value="cheap">2 - Kệ rẻ</option>
                                  <option value="none">3 - Không lên kệ</option>
                                </select>
                                {loadingStates.changeShelf[acc.id] && (
                                  <div className="text-center mt-1 text-[10px] text-teal-300">
                                    đang đồng bộ kệ...
                                  </div>
                                )}
                              </div>
                            )}
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
                            <div className="font-bold text-white mb-2 flex items-center gap-2 text-base">
                              <User size={16} className="text-slate-400" />
                              <span className="font-mono text-lg">{acc.username}</span>
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2"
                                onClick={() => handleCopy(acc.username, "Đã copy Tên Tài Khoản")}
                                title="Copy Username"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            </div>
                            <div className="text-slate-400 flex items-center gap-2 font-mono text-sm mt-1">
                              <span className="w-20 text-slate-400 text-xs">Mật khẩu:</span>
                              <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                onClick={() => handleCopy(acc.password, "Đã copy Mật khẩu")}
                                title="Copy Password"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            </div>
                            <div className="mt-3">
                              <button
                                className="bg-indigo-600/80 hover:bg-indigo-400 px-3 py-1.5 rounded text-white text-xs font-bold flex items-center gap-2 transition-transform shadow-md hover:-translate-y-0.5"
                                onClick={() => handleCopy(buildChatgptCopyText(acc), acc.type === "package2" && acc.link ? "Đã copy Tài khoản, Mật khẩu & Link" : "Đã copy Tài khoản & Mật khẩu")}
                              >
                                <Copy size={14} /> Copy TK, MK{acc.type === "package2" && acc.link ? " & Link" : ""}
                              </button>
                            </div>
                            {acc.expiredAt && (
                              <div
                                className={`text-xs mt-3 ml-6 flex items-center gap-1 ${getExpiryStatus(acc.expiredAt).color}`}
                              >
                                <Calendar size={10} />
                                <span>{getExpiryStatus(acc.expiredAt).text}</span>
                                <span className="text-slate-600 italic">({formatDate(acc.expiredAt)})</span>
                              </div>
                            )}
                            {acc.note && (
                              <div className="text-xs text-yellow-500/80 italic mt-2 ml-6 bg-yellow-900/10 p-1.5 rounded inline-block">
                                📝 {acc.note}
                              </div>
                            )}
                          </td>
                          <td className="align-top pt-4">
                            {acc.link ? (
                              <div className="flex flex-col gap-2">
                                <a
                                  href={acc.link}
                                  target="_blank"
                                  className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-1.5 rounded-md font-bold no-underline inline-flex items-center gap-2 shadow-md transition-transform hover:scale-105 justify-center w-[100px]"
                                >
                                  <Mail size={14} /> Mở Mail
                                </a>
                                <button
                                  onClick={() => handleCopy(acc.link, "Đã copy Link Mail")}
                                  className="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded flex items-center gap-1 text-xs text-white transition-colors font-bold justify-center w-[100px]"
                                  title="Copy Link Mail"
                                >
                                  <Copy size={14} /> Copy Link
                                </button>
                              </div>
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
                                  {acc.users?.length < 3 ? (
                                    <div className="flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openAddUserModal(acc.id, "[Datammo] Khách mới")}
                                        className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-teal-600 hover:bg-teal-500 font-bold text-white whitespace-nowrap"
                                      >
                                        + Datammo
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openAddUserModal(acc.id)}
                                        className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white whitespace-nowrap"
                                      >
                                        + Khách
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-red-400 font-bold italic">Đã Đầy</span>
                                  )}
                                </div>
                                {acc.users?.length < 3 && (
                                  <div className="mb-2 w-full px-2 py-0.5 bg-teal-900/40 text-teal-400 font-bold rounded text-[10px] uppercase border border-teal-800/50 flex items-center justify-center gap-1 shadow-sm">
                                    <Globe size={10} /> Đang lên kệ Datammo: Còn {3 - (acc.users?.length || 0)} Slot
                                  </div>
                                )}
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
                                              title="Gia hạn"
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
                                const package2Shelf = normalizePackage2Shelf(acc.package2Shelf);
                                const package2ShelfLabel = getPackage2ShelfLabel(package2Shelf);
                                const isOnDatammoShelf = package2Shelf !== "none";
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
                                              title="Gia hạn"
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
                                            className="text-blue-400 hover:text-white ml-1"
                                            title="Sửa tên"
                                          >
                                            <Pencil size={14} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteUser(
                                                acc.id,
                                                0,
                                                getUserName(u),
                                              )
                                            }
                                            className="text-red-400 hover:text-white ml-1"
                                            title="Xóa khách"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-2">
                                        <div
                                          className={`text-center w-full px-2 py-1 font-bold rounded text-[10px] uppercase border flex flex-col gap-0.5 shadow-sm ${isOnDatammoShelf
                                            ? "bg-teal-900/30 text-teal-400 border-teal-800/50"
                                            : "bg-slate-800 text-slate-300 border-slate-700"
                                            }`}
                                        >
                                          <span className="flex items-center justify-center gap-1">
                                            <Globe size={10} />
                                            {isOnDatammoShelf
                                              ? `Đang lên kệ Datammo (${package2ShelfLabel})`
                                              : "Không lên kệ Datammo"}
                                          </span>
                                        </div>
                                        <div className="flex gap-1">
                                          {isOnDatammoShelf && (
                                          <button
                                            type="button"
                                            onClick={() => openAddUserModal(acc.id, "[Datammo] Khách mới")}
                                            className="w-1/2 text-center text-xs px-2 py-1.5 bg-teal-700 hover:bg-teal-600 font-bold rounded text-white transition-colors"
                                            title="Gán Khách và tự điền tên Datammo"
                                          >
                                            + Datammo
                                          </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => openAddUserModal(acc.id)}
                                            className={`${isOnDatammoShelf ? "w-1/2" : "w-full"} text-center text-xs px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded font-bold text-slate-300 transition-colors`}
                                            title="Gán Khách ngoài bình thường"
                                          >
                                            + Khách Thường
                                          </button>
                                        </div>
                                      </div>
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
                                  setEditingAcc({
                                    ...acc,
                                    package2Shelf:
                                      acc.type === "package2"
                                        ? normalizePackage2Shelf(acc.package2Shelf)
                                        : "none",
                                  });
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
                let sourceList = accounts;
                if (movingUser.platform === "netflix") sourceList = netflixAccounts;
                else if (movingUser.platform === "capcut") sourceList = capcutAccounts;
                else if (movingUser.platform === "canva") sourceList = canvaAccounts;

                const sourceAcc = sourceList.find((a) => a.id === movingUser.fromAccId);
                const sourceType = sourceAcc?.type || "unassigned";

                if (movingUser.platform !== "chatgpt") {
                  return (
                    <label className="text-orange-400 font-bold mb-1 block">
                      Chọn Tài Khoản Đích (Cùng loại: {movingUser.platform.toUpperCase()})
                    </label>
                  );
                }

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
                  let sourceList = accounts;
                  if (movingUser.platform === "netflix") sourceList = netflixAccounts;
                  else if (movingUser.platform === "capcut") sourceList = capcutAccounts;
                  else if (movingUser.platform === "canva") sourceList = canvaAccounts;

                  const sourceAcc = sourceList.find((a) => a.id === movingUser.fromAccId);
                  const sourceType = sourceAcc?.type || "unassigned";

                  return sourceList
                    .filter((a) => {
                      if (a.id === movingUser.fromAccId) return false; // bỏ nguồn
                      if (a.expiredAt && new Date(a.expiredAt) < new Date()) return false; // bỏ hết hạn (đếm sơ bộ)
                      const users = a.users?.length || 0;

                      if (movingUser.platform !== "chatgpt") {
                        // Cho single accounts (Netflix, Capcut, Canva), chỉ hiện acc chưa có khách
                        return users < 1;
                      }

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
                      let maxSlots = 1;
                      let typeLabel = movingUser.platform.toUpperCase();

                      if (movingUser.platform === "chatgpt") {
                        maxSlots = a.type === "package2" ? 1 : a.type === "package1" ? 3 : (sourceType === "package2" ? 1 : 3);
                        typeLabel =
                          a.type === "unassigned"
                            ? "⭐ Unassigned → sẽ thành " + (sourceType === "package1" ? "Shared" : "Private")
                            : a.type === "package2"
                              ? "🔒 Private"
                              : "👥 Shared";
                      }

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
              {movingUser.platform === "chatgpt" && (
                <p className="text-xs text-slate-500 mt-2 italic">
                  * Cùng loại gói hoặc tài khoản chưa phân loại (tự đổi loại sau khi nhận khách).
                </p>
              )}
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

      {/* MOVE SLOT MODAL */}
      {showMoveSlotModal && movingSlot && (
        <div className="modal-overlay">
          <form
            onSubmit={handleSubmitMoveSlot}
            className="modal-box"
            style={{ maxWidth: "450px" }}
          >
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <ArrowRightLeft className="text-orange-500" /> Chuyển Slot Khách
            </h2>

            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="text-sm text-slate-400">Đang chuyển Slot:</div>
              <div className="font-bold text-lg text-white">
                👤 {movingSlot.customerName || movingSlot.gmail}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Tham gia:{" "}
                {movingSlot.addedAt
                  ? new Date(movingSlot.addedAt).toLocaleDateString("vi-VN")
                  : "N/A"}
              </div>
            </div>

            <div className="form-group">
              <label className="text-orange-400 font-bold mb-1 block">
                Chọn Team Account Đích
              </label>
              <select
                className="form-input w-full"
                value={destinationAccId}
                onChange={(e) => setDestinationAccId(e.target.value)}
                size={5}
                required
              >
                <option value="" disabled>
                  -- Chọn tài khoản Team --
                </option>
                {(() => {
                  return teamAccounts
                    .filter((a) => {
                      if (a.id === movingSlot.fromAccId) return false;
                      const expDays = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : null;
                      if (expDays !== null && expDays <= 0) return false; // Không chuyển vào acc hết hạn

                      const emptySlots = (a.slots || []).filter(s => s.status === "empty" || !s.gmail);
                      return emptySlots.length > 0; // Chỉ chuyển vào những bên còn trống slot
                    })
                    .map((a) => {
                      const filledSlots = (a.slots || []).filter(s => s.status !== "empty" && s.gmail).length;
                      return (
                        <option
                          key={a.id}
                          value={a.id}
                          className="py-2"
                        >
                          [{filledSlots}/4 Slots] — {a.username}
                        </option>
                      );
                    });
                })()}
              </select>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowMoveSlotModal(false)}
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
                    <Loader2 size={18} className="animate-spin" /> Đang chuyển...
                  </>
                ) : (
                  "Xác Nhận Chuyển"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CUSTOM EXTEND MODAL */}
      {showExtendModal && extendData && (
        <div className="modal-overlay">
          <form className="modal-box" style={{ maxWidth: "400px" }} onSubmit={handleSubmitExtend}>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <RotateCw className="text-green-500" /> Gia Hạn Khách Hàng
            </h2>
            <div className="bg-slate-800 p-3 rounded mb-4 border border-slate-700">
              <div className="font-bold text-lg text-indigo-300">
                👤 {extendData.currentName}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Thuộc gói: <span className="uppercase text-slate-300">{extendData.platform}</span>
              </div>
              {extendData.currentExpire && (
                <div className="text-xs text-slate-400 mt-1">
                  Ngày Hết Hạn Gốc: <span className="font-mono text-yellow-400">{extendData.currentExpire}</span>
                </div>
              )}
            </div>

            <div className="form-group mb-4">
              <label className="text-green-400 font-bold mb-1 block">Chọn Thời Gian Gia Hạn</label>
              <select
                className="form-input w-full bg-slate-700"
                value={extendDaysOption}
                onChange={e => setExtendDaysOption(e.target.value)}
              >
                {EXTEND_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowExtendModal(false)} className="btn-secondary" disabled={loadingStates.extendUser}>Hủy</button>
              <button type="submit" className="btn-primary bg-green-600 hover:bg-green-500 flex items-center gap-2" disabled={loadingStates.extendUser}>
                {loadingStates.extendUser ? <Loader2 size={18} className="animate-spin" /> : "Gia Hạn Ngay"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* IMPORT TEAM MODAL */}
      {showImportTeamModal && (
        <div className="modal-overlay">
          <form className="modal-box" style={{ maxWidth: "500px" }} onSubmit={(e) => {
            e.preventDefault();
            const raw = teamImportText;
            if (!raw || !raw.trim()) return;
            const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            const sourceLine = lines.find((line) => line.includes("----")) || raw.trim();
            const normalized = sourceLine.replace(/^team\s+/i, "").trim();
            const parts = normalized.split(/-{4,}/).map((s) => s.trim()).filter(Boolean);
            const email = parts[0] || "";
            const gptPass = parts[1] || "";
            const thirdPart = parts[2] || "";
            const fourthPart = parts[3] || "";
            const fallbackRecoveryMatch = raw.match(/https?:\/\/\S+/i);
            const recoveryMatch = raw.match(/\[接收验证码的地址\](.*)/);
            const recoveryUrl = fourthPart || (/^https?:\/\//i.test(thirdPart) ? thirdPart : "") || (fallbackRecoveryMatch ? fallbackRecoveryMatch[0].trim() : "") || (recoveryMatch ? recoveryMatch[1].trim() : "");

            setTeamAddForm(buildTeamFormState({ username: email, password: gptPass, recoveryUrl: recoveryUrl, expiredAt: getDefaultOneMonthDateInput() }));
            setShowImportTeamModal(false);
            setTeamImportText("");
            setShowTeamAddModal(true);
          }}>
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              📋 Nhập Format Team
            </h2>
            <div className="form-group mb-4">
              <label className="text-slate-300 font-bold mb-1 block">Dán Raw Format tại đây:</label>
              <p className="text-xs text-slate-400 mb-2">Format mới: team email@domain.com----gptpass----https://generator.email/... (không cần pass email)</p>
              <textarea
                className="form-input w-full h-32 text-sm font-mono leading-tight bg-slate-800"
                placeholder="team email@domain.com----gptpass----https://generator.email/..."
                value={teamImportText}
                onChange={e => setTeamImportText(e.target.value)}
                autoFocus
              ></textarea>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowImportTeamModal(false)} className="btn-secondary">Hủy</button>
              <button type="submit" className="btn-primary bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2">
                Phân Tích Dữ Liệu
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
            <div className="form-group mt-3">
              <label className="block text-yellow-400 mb-2">Ngày Hết Hạn</label>
              <input
                type="date"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white"
                value={
                  currentUserData.expiredAt
                    ? new Date(currentUserData.expiredAt)
                      .toISOString()
                      .split("T")[0]
                    : ""
                }
                onChange={(e) => {
                  setCurrentUserData({
                    ...currentUserData,
                    expiredAt: e.target.value
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

      {showBulkPushModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: "520px" }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">Đẩy Nhanh Lên Kệ</h2>
              <span
                className="close cursor-pointer text-slate-400 hover:text-white"
                onClick={() => setShowBulkPushModal(false)}
              >
                &times;
              </span>
            </div>

            <div className="space-y-3">
              <div className="text-xs text-slate-300 bg-slate-800 border border-slate-700 rounded p-3">
                Đang lọc: <span className="font-bold text-white">{filteredChatgptAccounts.length}</span> acc
                {" • "}
                Đã chọn: <span className="font-bold text-white">{selectedChatgptIds.length}</span> acc
              </div>

              <div className="form-group">
                <label className="block text-xs text-slate-400 mb-1">Nguồn áp dụng</label>
                <select
                  className="form-input w-full"
                  value={bulkPushForm.scope}
                  onChange={(e) =>
                    setBulkPushForm((prev) => ({
                      ...prev,
                      scope: e.target.value,
                    }))
                  }
                >
                  <option
                    value="selected"
                    disabled={selectedChatgptIds.length === 0}
                  >
                    Chỉ các acc đã chọn ({selectedChatgptIds.length})
                  </option>
                  <option value="filtered">
                    Tất cả acc đang lọc ({filteredChatgptAccounts.length})
                  </option>
                </select>
              </div>

              <div className="form-group">
                <label className="block text-xs text-slate-400 mb-1">Đẩy theo gói</label>
                <select
                  className="form-input w-full"
                  value={bulkPushForm.targetType}
                  onChange={(e) =>
                    setBulkPushForm((prev) => ({
                      ...prev,
                      targetType: e.target.value,
                    }))
                  }
                >
                  <option value="package1">Gói 1 - Chia sẻ</option>
                  <option value="package2">Gói 2 - Linh hoạt</option>
                </select>
              </div>

              {bulkPushForm.targetType === "package2" && (
                <div className="form-group">
                  <label className="block text-xs text-slate-400 mb-1">Kệ Datammo</label>
                  <select
                    className="form-input w-full"
                    value={bulkPushForm.package2Shelf}
                    onChange={(e) =>
                      setBulkPushForm((prev) => ({
                        ...prev,
                        package2Shelf: normalizePackage2Shelf(e.target.value),
                      }))
                    }
                  >
                    <option value="main">1 - Kệ tổng</option>
                    <option value="cheap">2 - Kệ rẻ</option>
                    <option value="none">3 - Không lên kệ</option>
                  </select>
                </div>
              )}

              {loadingStates.bulkPush && (
                <div className="pt-1">
                  <div className="h-2 w-full bg-slate-800 border border-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                      style={{ width: `${Math.max(0, Math.min(100, bulkPushProgress.percent || 0))}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Đang đẩy đồng bộ Datammo... {bulkPushProgress.percent}%
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowBulkPushModal(false)}
                className="btn-secondary"
                disabled={loadingStates.bulkPush}
              >
                Hủy
              </button>
              <button
                onClick={() => handleBulkPushToShelf(filteredChatgptAccounts)}
                className="btn-primary bg-emerald-600 hover:bg-emerald-500 flex items-center gap-2"
                disabled={loadingStates.bulkPush}
              >
                {loadingStates.bulkPush ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Đang đẩy...
                  </>
                ) : (
                  "Đẩy ngay"
                )}
              </button>
            </div>
          </div>
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
                onChange={(e) => {
                  const nextType = e.target.value;
                  if (showAddModal) {
                    setNewAcc({
                      ...newAcc,
                      type: nextType,
                      package2Shelf:
                        nextType === "package2"
                          ? normalizePackage2Shelf(
                            newAcc.package2Shelf === "none"
                              ? "main"
                              : newAcc.package2Shelf,
                          )
                          : "none",
                    });
                  } else {
                    setEditingAcc({
                      ...editingAcc,
                      type: nextType,
                      package2Shelf:
                        nextType === "package2"
                          ? normalizePackage2Shelf(
                            editingAcc.package2Shelf === "none"
                              ? "main"
                              : editingAcc.package2Shelf,
                          )
                          : "none",
                    });
                  }
                }}
              >
                <option value="unassigned">❓ Chưa xác định</option>
                <option value="package1">👥 Gói 1: Chia sẻ</option>
                <option value="package2">🔒 Gói 2: Linh hoạt</option>
              </select>
            </div>
            {(showAddModal ? newAcc.type : editingAcc.type) === "package2" && (
              <div className="form-group">
                <label>Kệ Datammo cho Gói 2</label>
                <select
                  className="form-input"
                  value={normalizePackage2Shelf(showAddModal ? newAcc.package2Shelf : editingAcc.package2Shelf)}
                  onChange={(e) =>
                    showAddModal
                      ? setNewAcc({
                        ...newAcc,
                        package2Shelf: normalizePackage2Shelf(e.target.value),
                      })
                      : setEditingAcc({
                        ...editingAcc,
                        package2Shelf: normalizePackage2Shelf(e.target.value),
                      })
                  }
                >
                  <option value="main">1 - Kệ tổng</option>
                  <option value="cheap">2 - Kệ rẻ</option>
                  <option value="none">3 - Không lên kệ</option>
                </select>
              </div>
            )}
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
                          Còn {user.daysRemaining ?? 0} ngày
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

      {showOrphanedSlotsModal && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal-box" style={{ maxWidth: "600px" }}>
            <div className="bg-orange-900/30 p-4 rounded-t-xl border-b-2 border-orange-600 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-orange-600/30 rounded-full flex items-center justify-center">
                  <AlertTriangle size={28} className="text-orange-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">
                    ⚠️ KHÔNG THỂ XÓA TÀI KHOẢN TEAM
                  </h3>
                  <p className="text-sm text-orange-300">
                    Tài khoản đang có {orphanedSlots.length} slot khách còn hiệu lực
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 mb-4">
              <p className="text-slate-300 mb-3">
                <strong className="text-yellow-400">Yêu cầu bắt buộc:</strong> Chuyển hoặc xóa tất cả khách đang dùng (đang active) qua bên nhóm rác trước khi xóa tài khoản.
              </p>
              <div className="space-y-3">
                {orphanedSlots.map((slot, idx) => {
                  const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                  return (
                    <div
                      key={idx}
                      className="bg-slate-900 p-3 rounded border border-slate-700 flex justify-between items-center"
                    >
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <User size={16} className="text-blue-400" />
                          {slot.customerName || "—"} ({slot.gmail || "No Gmail"})
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Tham gia: {slot.addedAt ? new Date(slot.addedAt).toLocaleDateString("vi-VN") : "—"}{" "}
                          {sExpDays !== null && (
                            <span>
                              • Tình trạng:{" "}
                              <span className={`${sExpDays > 0 ? "text-green-400" : "text-red-400"} font-bold`}>
                                {sExpDays > 0 ? `Còn ${sExpDays} ngày` : `Hết Hạn`}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setShowOrphanedSlotsModal(false);
                            openMoveSlotModal(
                              slot.fromAccId,
                              slot.originalIndex,
                              slot
                            );
                          }}
                          className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded flex items-center gap-1 font-bold text-sm"
                        >
                          <ArrowRightLeft size={14} /> Chuyển
                        </button>
                        <button
                          onClick={async () => {
                            const fromAcc = teamAccounts.find(a => a.id === slot.fromAccId);
                            if (!fromAcc) return;
                            const updSlots = [...fromAcc.slots];
                            updSlots[slot.originalIndex] = { ...slot, status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                            await axios.put(`/api/team/${fromAcc.id}`, { slots: updSlots });
                            fetchData();
                            setShowOrphanedSlotsModal(false);
                            showAlert("Đã xóa Slot", "Slot khách đã được giải phóng.", "info");
                          }}
                          className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded flex items-center gap-1 font-bold text-sm"
                        >
                          <Trash2 size={14} /> Xóa
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowOrphanedSlotsModal(false)}
                className="btn-primary bg-blue-600 hover:bg-blue-500 font-bold text-sm px-4 rounded"
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

        const searchFiltered = accs.filter(a =>
          a.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.users?.[0]?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        );

        const filtered = searchFiltered.sort((a, b) => {
          const remA = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : 999;
          const remB = b.expiredAt ? Math.ceil((new Date(b.expiredAt) - new Date()) / 86400000) : 999;

          if (remA <= 0 && remB > 0) return -1;
          if (remA > 0 && remB <= 0) return 1;
          if (remA <= 3 && remB > 3) return -1;
          if (remA > 3 && remB <= 3) return 1;

          return remA - remB;
        });

        const urgentList = accs.filter(a => {
          const u = a.users?.[0];
          if (!u) return false;
          const rem = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : null;
          return rem !== null && rem <= 3;
        });

        return (
          <div>
            {urgentList.length > 0 && (
              <div className={`mb-6 bg-${accentColor}-900/20 border-2 border-${accentColor}-600 rounded-xl overflow-hidden shadow-2xl animate-fade-in`}>
                <div className={`bg-${accentColor}-800/80 p-3 flex items-center justify-between`}>
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <AlertTriangle className="text-yellow-300 animate-pulse" />
                    CẦN XỬ LÝ GẤP ({urgentList.length})
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  {urgentList.map((a, i) => {
                    const rem = a.expiredAt ? Math.ceil((new Date(a.expiredAt) - new Date()) / 86400000) : null;
                    return (
                      <div key={i} className={`flex items-center justify-between bg-slate-900/50 p-3 rounded border border-${accentColor}-500/30`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full bg-${accentColor}-500/20 text-${accentColor}-500`}>
                            <User size={20} />
                          </div>
                          <div>
                            <div className={`font-bold text-${accentColor}-400 text-lg`}>
                              {a.users[0].name}
                            </div>
                            <div className="text-xs text-slate-400">
                              Tài khoản: <span className="text-white">{a.username}</span> •
                              <span className="text-red-500 font-bold ml-1">
                                {rem <= 0 ? `Đã hết hạn ${Math.abs(rem)} ngày` : `Sắp hết hạn (Còn ${rem} ngày)`}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div>
                          <button onClick={() => handleEditSimpleAcc(a)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold shadow-lg flex items-center gap-2">
                            <Pencil size={18} /> SỬA ACC
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

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

            <div className="rounded-xl overflow-x-auto w-full border border-slate-700 shadow-xl">
              <table className="w-full text-sm min-w-[600px]">
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
                    const accExpiry = getExpiryStatus(acc.expiredAt);
                    const daysRemaining = acc.expiredAt ? Math.ceil((new Date(acc.expiredAt) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                    const isExpired = daysRemaining !== null && daysRemaining <= 0;
                    const isNearExpiry = daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 3;
                    const noteTitle = platform === "netflix" ? "Profile" : "Ghi chú";
                    return (
                      <tr key={acc.id} className={`border-t border-slate-700/50 transition-colors ${accExpiry.isExpired ? "bg-red-950/20" : "hover:bg-slate-800/50"}`}>
                        <td className="p-3 text-slate-500 font-mono text-xs">{idx + 1}</td>
                        <td className="p-4 align-top">
                          <div className="flex items-center gap-2 font-bold text-white text-base mb-2">
                            <span className="font-mono text-lg">{acc.username}</span>
                            <button
                              className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2"
                              onClick={() => handleCopy(acc.username, "Đã copy Tên Tài Khoản")}
                              title="Copy Username"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                          <div className="text-slate-400 flex items-center gap-2 font-mono text-sm mt-2 ml-1">
                            <span className="w-16 text-slate-400 text-xs text-right">Pass:</span>
                            {acc.password ? (
                              <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                            ) : (
                              <span className="opacity-50 min-w-[120px] px-2 py-1 bg-slate-800 rounded">Không mật khẩu</span>
                            )}
                            {acc.password && (
                              <button
                                className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors"
                                onClick={() => handleCopy(acc.password, "Đã copy Mật khẩu")}
                                title="Copy Password"
                              >
                                <Copy size={14} /> Copy
                              </button>
                            )}
                          </div>
                          <div className="mt-3 ml-1">
                            <button
                              className="bg-indigo-600/80 hover:bg-indigo-400 px-3 py-1.5 rounded text-white text-xs font-bold flex items-center gap-2 transition-transform shadow-md hover:-translate-y-0.5"
                              onClick={() => handleCopy(`Tài khoản: ${acc.username}${acc.password ? `\nMật khẩu: ${acc.password}` : ""}${acc.note ? `\n${noteTitle}: ${acc.note}` : ""}`, "Đã copy cả TK & MK & Ghi chú")}
                            >
                              <Copy size={14} /> Copy cả TK, MK & Note
                            </button>
                          </div>
                          {accExpiry.text && (
                            <div className={`text-xs mt-3 flex items-center gap-1 ${accExpiry.color}`}>
                              <Calendar size={10} />
                              <span>{accExpiry.text}</span>
                              <span className="text-slate-600 italic">({accExpiry.dateStr})</span>
                            </div>
                          )}
                          {acc.note && <div className="text-xs text-yellow-500/80 italic mt-2 bg-yellow-900/10 p-1.5 rounded inline-block">{noteTitle}: {acc.note}</div>}
                        </td>
                        <td className="p-3">
                          {u ? (() => {
                            const userDaysRemaining = u?.expiredAt ? Math.ceil((new Date(u.expiredAt) - new Date()) / 86400000) : daysRemaining;
                            const userIsExpired = userDaysRemaining !== null && userDaysRemaining <= 0;
                            const userIsNearExpiry = userDaysRemaining !== null && userDaysRemaining > 0 && userDaysRemaining <= 3;
                            return (
                              <div className={`p-2 rounded border text-xs ${userIsExpired ? "bg-red-900/20 border-red-700" : userIsNearExpiry ? "bg-yellow-900/20 border-yellow-700" : "bg-slate-800 border-slate-700"}`}>
                                <div className={`font-bold flex items-center gap-1 ${userIsExpired ? "text-red-400" : userIsNearExpiry ? "text-yellow-400" : "text-white"}`}>
                                  {userIsExpired && <AlertCircle size={12} />}
                                  {userIsNearExpiry && <AlertTriangle size={12} />}
                                  👤 {u.name}
                                </div>
                                <div className="text-slate-400 mt-1 flex items-center gap-1">
                                  <Calendar size={10} /> {u?.expiredAt ? formatDate(u.expiredAt) : getUserDate(u)}
                                </div>
                                {userDaysRemaining !== null && (
                                  <div className={`text-[10px] font-semibold mt-0.5 ${userIsExpired ? "text-red-400" : userIsNearExpiry ? "text-yellow-400" : userDaysRemaining > 30 ? "text-purple-400" : "text-blue-400"}`}>
                                    {userIsExpired ? `(HH ${Math.abs(userDaysRemaining)} ngày)` : `(Còn ${userDaysRemaining} ngày)`}
                                  </div>
                                )}
                              </div>
                            );
                          })() : (
                            <button onClick={() => handleAssignUser(acc)} className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold text-white bg-${accentColor}-700 hover:bg-${accentColor}-600`}>
                              👤 Gán Khách
                            </button>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1 items-center">
                            {u && (
                              <div className="flex w-full gap-1">
                                <button onClick={() => openMoveUserModal(acc.id, 0, u, activeTab)} className="bg-amber-600 hover:bg-amber-500 text-white p-1 rounded text-xs flex-1 flex justify-center items-center" title="Chuyển Khách"><ArrowRightLeft size={16} /></button>
                                <button onClick={() => handleRemoveUser(acc)} className="bg-orange-700 hover:bg-orange-600 text-white p-1 rounded text-xs flex-1 flex justify-center items-center" title="Xóa Khách"><Trash2 size={16} /></button>
                              </div>
                            )}
                            <button onClick={() => handleEditSimpleAcc(acc)} className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><Pencil size={12} /> Sửa Acc</button>
                            <button onClick={() => handleDeleteSimpleAcc(acc)} className="bg-red-800 hover:bg-red-700 text-white px-2 py-1 rounded text-xs flex items-center gap-1 w-full justify-center"><X size={12} /> Xóa Acc</button>
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

      {/* ====================================================== */}
      {/* TEAM CHATGPT ACCOUNTS                                  */}
      {/* ====================================================== */}
      {activeTab === "chatgpt" && (
        <div>
          {/* Header */}
          <div className="flex flex-wrap gap-3 mb-6 items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">🏢 ChatGPT Team Accounts</h2>
              <p className="text-slate-400 text-sm">Mỗi tài khoản có tối đa 4 slot Gmail khách</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTeamImportText("");
                  setShowImportTeamModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-slate-700 hover:bg-slate-600 text-sm"
              >
                📋 Nhập Format
              </button>
              <button
                onClick={() => { setTeamAddForm(buildTeamFormState({ expiredAt: getDefaultOneMonthDateInput() })); setShowTeamAddModal(true); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-500"
              >
                <UserPlus size={16} /> Thêm Team Acc
              </button>
            </div>
          </div>

          {teamAccounts.length === 0 ? (
            <div className="text-center py-16 text-slate-500 italic">Chưa có tài khoản Team nào.</div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <div className="px-3 py-1.5 rounded-full text-xs font-bold border bg-slate-800 text-slate-200 border-slate-700">
                  Tổng Team: {teamAccounts.length}
                </div>
                <div className="px-3 py-1.5 rounded-full text-xs font-bold border bg-teal-900/40 text-teal-300 border-teal-700/60">
                  Team Slot: {teamSlotAccounts.length}
                </div>
                <div className="px-3 py-1.5 rounded-full text-xs font-bold border bg-cyan-900/40 text-cyan-300 border-cyan-700/60">
                  Team Business: {teamBusinessAccounts.length}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-2 items-start">
                {teamSections.map((section) => (
                  <div
                    key={section.key}
                    className={`rounded-2xl border p-4 sm:p-5 space-y-4 shadow-lg ${section.panelClass}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-white">{section.title}</h3>
                        <p className="text-xs text-slate-400">{section.subtitle}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-full border text-xs font-bold ${section.badgeClass}`}>
                        {section.accounts.length} acc
                      </span>
                    </div>

                    {section.accounts.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 italic border border-slate-700/50 rounded-xl">
                        Chưa có tài khoản trong bảng này.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {section.accounts.map((acc) => {
                const expDays = acc.expiredAt ? Math.ceil((new Date(acc.expiredAt) - new Date()) / 86400000) : null;
                const isExpired = expDays !== null && expDays <= 0;
                const isNear = expDays !== null && expDays > 0 && expDays <= 7;
                const saleMode = normalizeTeamSaleMode(acc.saleMode);
                const isBusinessMode = saleMode === "business";
                const usedSlots = (acc.slots || []).filter((s) => s.status === "active" && !!s.gmail).length;
                const hasEmptySlot = (acc.slots || []).some((s) => s.status === "empty" || !s.gmail);
                return (
                  <div key={acc.id} className={`rounded-2xl border shadow-xl overflow-hidden ${isExpired ? "border-red-700 bg-red-950/20" : isNear ? "border-yellow-700 bg-yellow-950/10" : "border-slate-700 bg-slate-900"}`}>
                    {/* Account header */}
                    <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 bg-indigo-900/40 border-b border-slate-700">
                      <div>
                        <div className="flex items-center gap-2 font-bold text-white text-sm">
                          <span className="text-indigo-300">🏢</span>
                          <span className="font-mono text-xl">{acc.username}</span>
                          <button className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors ml-2" onClick={() => handleCopy(acc.username, "Đã copy Tên Team")} title="Copy Username"><Copy size={14} /> Copy</button>
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${isBusinessMode ? "bg-cyan-900/35 text-cyan-300 border-cyan-700/60" : "bg-teal-900/35 text-teal-300 border-teal-700/60"}`}>
                            {isBusinessMode ? "Bảng Business" : "Bảng Slot"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-300 mt-3 flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-20 text-slate-400">Pass GPT:</span>
                            <span className="font-mono font-bold bg-slate-800 px-2 py-1 rounded text-white min-w-[120px]">{acc.password}</span>
                            <button className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1 rounded text-white text-xs font-bold flex items-center gap-1 transition-colors" onClick={() => handleCopy(acc.password, "Đã copy Pass GPT")} title="Copy Pass GPT">
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                          {acc.recoveryUrl && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="w-20 text-slate-400">Recovery:</span>
                              <a href={acc.recoveryUrl} target="_blank" rel="noreferrer" className="bg-teal-600 hover:bg-teal-500 text-white text-xs px-3 py-1.5 rounded font-bold no-underline inline-flex items-center gap-2 shadow-md transition-transform hover:scale-105">
                                <Mail size={14} /> Mở Mail
                              </a>
                              <button onClick={() => handleCopy(acc.recoveryUrl, "Đã copy Recovery Link")} className="bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 rounded flex items-center gap-1 text-xs text-white transition-colors font-bold" title="Copy Link Mail">
                                <Copy size={14} /> Link
                              </button>
                            </div>
                          )}
                        </div>
                        {acc.note && <div className="text-xs text-yellow-500/80 mt-3 italic bg-yellow-900/10 p-2 rounded inline-block">📝 {acc.note}</div>}
                      </div>
                      <div className="flex flex-col items-end justify-between gap-1 shrink-0 h-full min-h-[140px] w-full sm:w-auto">
                        <div className="flex flex-col items-end gap-1 w-full">
                          <div className={`text-xs font-bold ${isExpired ? "text-red-400" : isNear ? "text-yellow-400" : "text-green-400"}`}>
                            {isExpired ? `❌ Hết hạn ${Math.abs(expDays)}d trước` : expDays !== null ? `✅ Còn ${expDays} ngày` : ""}
                          </div>
                          <div className="text-xs text-cyan-300 font-bold mb-1">{getTeamSaleModeLabel(saleMode)}</div>
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickTeamSaleModeChange(
                                acc,
                                isBusinessMode ? "slot" : "business",
                              )
                            }
                            disabled={!!loadingStates.teamMode?.[acc.id]}
                            className={`text-[11px] px-2 py-1 rounded border font-bold inline-flex items-center gap-1 transition-colors ${isBusinessMode ? "bg-teal-900/30 text-teal-300 border-teal-700/60 hover:bg-teal-800/40" : "bg-cyan-900/30 text-cyan-300 border-cyan-700/60 hover:bg-cyan-800/40"} ${loadingStates.teamMode?.[acc.id] ? "opacity-60 cursor-wait" : ""}`}
                            title="Đổi nhanh loại Team"
                          >
                            {loadingStates.teamMode?.[acc.id] ? (
                              <>
                                <Loader2 size={11} className="animate-spin" /> Đang đổi...
                              </>
                            ) : (
                              <>↔ {isBusinessMode ? "Qua Slot team" : "Qua Business"}</>
                            )}
                          </button>
                          <div className="text-xs text-indigo-300 font-bold mb-1">{usedSlots}/4 slot đã cấp</div>
                        </div>

                        <div className="w-full flex flex-col gap-2 mt-auto pt-2">
                          {hasEmptySlot ? (
                            <div className="flex flex-col gap-1 my-1 w-full">
                              {isBusinessMode ? (
                                usedSlots === 0 ? (
                                  <div className="w-full px-2 py-1 bg-teal-900/40 text-teal-400 font-bold rounded text-[10px] uppercase border border-teal-800/50 flex flex-col gap-0.5 shadow-sm items-center justify-center">
                                    <span className="flex items-center gap-1"><Globe size={10} /> Đang lên kệ Datammo: Business (1 acc)</span>
                                  </div>
                                ) : (
                                  <div className="w-full px-2 py-1 bg-amber-900/30 text-amber-300 font-bold rounded text-[10px] uppercase border border-amber-700/50 flex flex-col gap-0.5 shadow-sm items-center justify-center">
                                    <span className="flex items-center gap-1"><AlertTriangle size={10} /> Business tạm dừng lên kệ (đang có khách)</span>
                                  </div>
                                )
                              ) : (
                                <div className="w-full px-2 py-1 bg-teal-900/40 text-teal-400 font-bold rounded text-[10px] uppercase border border-teal-800/50 flex flex-col gap-0.5 shadow-sm items-center justify-center">
                                  <span className="flex items-center gap-1"><Globe size={10} /> Đang lên kệ Datammo: Còn {4 - usedSlots} Slot</span>
                                </div>
                              )}
                              <div className="flex gap-2">
                                {!isBusinessMode && (
                                  <button onClick={() => {
                                    const emptyIdx = (acc.slots || []).findIndex(s => s.status === "empty" || !s.gmail);
                                    if (emptyIdx !== -1) {
                                      setSlotTarget({ accId: acc.id, slotIdx: emptyIdx, slot: acc.slots[emptyIdx] });
                                      setSlotFormGmail("datammo@guest.com"); setSlotFormName("[Datammo] Khách mới");
                                      setSlotFormExp(new Date().toISOString().split("T")[0]);
                                      setSlotFormExpiredAt(addDurationToDate(new Date(), "1M").toISOString().split("T")[0]);
                                      setShowSlotModal(true);
                                    }
                                  }} className="bg-teal-700 hover:bg-teal-600 font-bold text-white px-2 py-1.5 rounded text-xs flex-1 transition-colors shadow flex items-center justify-center gap-1" title="Tự động điền Form với chữ Datammo">
                                    + Datammo
                                  </button>
                                )}
                                <button onClick={() => {
                                  const emptyIdx = (acc.slots || []).findIndex(s => s.status === "empty" || !s.gmail);
                                  if (emptyIdx !== -1) {
                                    setSlotTarget({ accId: acc.id, slotIdx: emptyIdx, slot: acc.slots[emptyIdx] });
                                    setSlotFormGmail(""); setSlotFormName("");
                                    setSlotFormExp(new Date().toISOString().split("T")[0]);
                                    setSlotFormExpiredAt(addDurationToDate(new Date(), "1M").toISOString().split("T")[0]);
                                    setShowSlotModal(true);
                                  }
                                }} className={`bg-emerald-600 hover:bg-emerald-500 font-bold text-white px-2 py-1.5 rounded text-xs transition-colors shadow flex items-center justify-center gap-1 ${isBusinessMode ? "w-full" : "flex-1"}`} title="Gán Khách ngoài">
                                  <UserPlus size={14} /> Khách
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full text-center text-xs text-red-400 font-bold italic my-1 shadow-sm p-1 border border-red-900/30 rounded bg-red-900/10">Đã Kín 4/4 Slot</div>
                          )}
                          <button onClick={() => {
                            const info = `✅ Tài khoản GPT Team\nEmail: ${acc.username}\nPass: ${acc.password}${acc.recoveryUrl ? `\nLink lấy mã: ${acc.recoveryUrl}` : ""}`;
                            handleCopy(info, "Đã copy toàn bộ form Team");
                          }} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-bold flex items-center gap-2 w-full justify-center shadow-lg transition-transform hover:scale-105 mb-1">
                            <Copy size={16} /> COPY CẢ CỤM
                          </button>

                          <div className="flex gap-2 w-full relative group">
                            <button onClick={() => { setTeamEditForm(buildTeamEditFormState({ id: acc.id, username: acc.username, password: acc.password, recoveryUrl: acc.recoveryUrl || "", note: acc.note || "", expiredAt: acc.expiredAt ? new Date(acc.expiredAt).toISOString().split("T")[0] : "", saleMode: normalizeTeamSaleMode(acc.saleMode) })); setShowTeamEditModal(true); }} className="bg-blue-700 hover:bg-blue-600 text-white px-2 py-1.5 rounded text-xs flex items-center gap-1 flex-1 justify-center"><Pencil size={11} /> Sửa</button>
                            <button onClick={() => handleDeleteTeamAccount(acc.id)} className="bg-red-800 hover:bg-red-700 text-white px-2 py-1.5 rounded text-xs flex items-center gap-1 flex-1 justify-center"><Trash2 size={11} /> Xóa</button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Slots */}
                    {usedSlots > 0 ? (
                      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {acc.slots?.map((slot, si) => {
                          const isEmpty = slot.status === "empty" || !slot.gmail;
                          if (isEmpty) return null; // Do not render empty slots

                          const sExpDays = slot.expiredAt ? Math.ceil((new Date(slot.expiredAt) - new Date()) / 86400000) : null;
                          const sExpired = sExpDays !== null && sExpDays <= 0;
                          const sNear = sExpDays !== null && sExpDays > 0 && sExpDays <= 3;

                          return (
                            <div key={si} className={`rounded-xl border p-3 flex flex-col gap-1 w-full ${sExpired ? "border-red-800 bg-red-950/30" : sNear ? "border-yellow-800 bg-yellow-950/20" : "border-indigo-700/50 bg-indigo-900/20"}`}>
                              <>
                                <div className="flex-1 space-y-0.5">
                                  <span className={`font-bold text-xs truncate max-w-full flex items-center gap-1 ${sExpired ? "text-red-500" : sNear ? "text-yellow-400" : "text-white"}`} title={slot.customerName}>
                                    {sExpired && <AlertCircle size={12} />}
                                    {sNear && <AlertTriangle size={12} />}
                                    👤 {slot.customerName || "—"}
                                  </span>
                                  <div className="text-[10px] text-blue-300 break-all">{slot.gmail}</div>
                                  <span className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                                    <Calendar size={10} /> {slot.addedAt ? new Date(slot.addedAt).toLocaleDateString("vi-VN") : "Chưa có ngày"}
                                    {sExpDays !== null && (
                                      <span className={sExpired ? "text-red-400 font-bold" : sNear ? "text-yellow-500 font-bold" : sExpDays > 30 ? "text-purple-400 font-bold" : "text-blue-400"}>
                                        {sExpired ? `(HH ${Math.abs(sExpDays)}ngày)` : `(Còn ${sExpDays}ngày)`}
                                      </span>
                                    )}
                                  </span>
                                  {slot.expiredAt && (
                                    <span className={`text-[10px] flex items-center gap-1 font-semibold ${sExpired ? "text-red-500" : sNear ? "text-yellow-500" : "text-emerald-500"}`}>
                                      🕑 HH: {new Date(slot.expiredAt).toLocaleDateString("vi-VN")}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1 mt-2">
                                  {(sExpired || sNear) && (
                                    <button
                                      type="button"
                                      onClick={() => handleExtendUser(acc.id, si, slot, "team")}
                                      className="bg-green-600 hover:bg-green-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                      title="Gia hạn"
                                    >
                                      <RotateCw size={14} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => openMoveSlotModal(acc.id, si, slot)}
                                    className="bg-orange-600 hover:bg-orange-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title="Chuyển Slot"
                                  >
                                    <ArrowRightLeft size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setSlotTarget({ accId: acc.id, slotIdx: si, slot }); setSlotFormGmail(slot.gmail || ""); setSlotFormName(slot.customerName || ""); setSlotFormExp(slot.addedAt ? new Date(slot.addedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]); setSlotFormExpiredAt(slot.expiredAt ? new Date(slot.expiredAt).toISOString().split("T")[0] : addDurationToDate(new Date(), "1M").toISOString().split("T")[0]); setShowSlotModal(true); }}
                                    className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title="Sửa Slot"
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      showConfirm("Xóa Slot", `Xóa khách ${slot.customerName}?`, async () => {
                                        const updSlots = [...acc.slots];
                                        updSlots[si] = { status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                                        await axios.put(`/api/team/${acc.id}`, { slots: updSlots });
                                        fetchData();
                                      });
                                    }}
                                    className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded shadow-sm transition-transform hover:scale-105 flex-1 flex justify-center items-center"
                                    title="Xóa khách"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 flex items-center justify-center text-slate-500 text-sm italic">
                        Chưa có khách nào trong tài khoản này.
                      </div>
                    )}
                  </div>
                );
              })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ADD TEAM MODAL */}
          {showTeamAddModal && (
            <div className="modal-overlay">
              <div className="modal-box" style={{ maxWidth: "520px" }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">➕ Thêm Team Account</h3>
                  <span className="close cursor-pointer text-slate-400 hover:text-white" onClick={() => setShowTeamAddModal(false)}>&times;</span>
                </div>

                <div className="space-y-3">
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📧 Email chính (Team)</label><input className="form-input w-full" placeholder="teamacc@outlook.com" value={teamAddForm.username} onChange={e => setTeamAddForm({ ...teamAddForm, username: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">🔑 GPT Password</label><input className="form-input w-full" value={teamAddForm.password} onChange={e => setTeamAddForm({ ...teamAddForm, password: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">🔗 Recovery URL</label><input className="form-input w-full" placeholder="http://..." value={teamAddForm.recoveryUrl} onChange={e => setTeamAddForm({ ...teamAddForm, recoveryUrl: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📅 Hạn của Team Acc</label><input type="date" className="form-input w-full" value={teamAddForm.expiredAt} onChange={e => setTeamAddForm({ ...teamAddForm, expiredAt: e.target.value })} /></div>
                  <div className="form-group">
                    <label className="block text-xs text-slate-400 mb-1">🛒 Loại bán Datammo</label>
                    <select className="form-input w-full" value={teamAddForm.saleMode} onChange={e => setTeamAddForm({ ...teamAddForm, saleMode: normalizeTeamSaleMode(e.target.value) })}>
                      <option value="slot">Slot team (4 slot)</option>
                      <option value="business">Business account (1 acc)</option>
                    </select>
                  </div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📝 Ghi chú</label><input className="form-input w-full" value={teamAddForm.note} onChange={e => setTeamAddForm({ ...teamAddForm, note: e.target.value })} /></div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setShowTeamAddModal(false)} className="btn-secondary">Hủy</button>
                  <button onClick={async () => {
                    try {
                      await axios.post("/api/team", { ...teamAddForm, expiredAt: teamAddForm.expiredAt ? new Date(teamAddForm.expiredAt).toISOString() : undefined });
                      setShowTeamAddModal(false); fetchData(); showAlert("Thành công", "Đã thêm Team Account!", "success");
                    } catch (e) { showAlert("Lỗi", e.message, "error"); }
                  }} className="btn-primary" style={{ background: "#4f46e5" }}>+ Thêm Team Acc</button>
                </div>
              </div>
            </div>
          )}

          {/* EDIT TEAM MODAL */}
          {showTeamEditModal && (
            <div className="modal-overlay">
              <div className="modal-box" style={{ maxWidth: "520px" }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-white">✏️ Sửa Team Account</h3>
                  <span className="close cursor-pointer text-slate-400 hover:text-white" onClick={() => setShowTeamEditModal(false)}>&times;</span>
                </div>

                <div className="space-y-3">
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📧 Email</label><input className="form-input w-full" value={teamEditForm.username} onChange={e => setTeamEditForm({ ...teamEditForm, username: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">🔑 GPT Password</label><input className="form-input w-full" value={teamEditForm.password} onChange={e => setTeamEditForm({ ...teamEditForm, password: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">🔗 Recovery URL</label><input className="form-input w-full" value={teamEditForm.recoveryUrl} onChange={e => setTeamEditForm({ ...teamEditForm, recoveryUrl: e.target.value })} /></div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📅 Hạn Team Acc</label><input type="date" className="form-input w-full" value={teamEditForm.expiredAt} onChange={e => setTeamEditForm({ ...teamEditForm, expiredAt: e.target.value })} /></div>
                  <div className="form-group">
                    <label className="block text-xs text-slate-400 mb-1">🛒 Loại bán Datammo</label>
                    <select className="form-input w-full" value={teamEditForm.saleMode} onChange={e => setTeamEditForm({ ...teamEditForm, saleMode: normalizeTeamSaleMode(e.target.value) })}>
                      <option value="slot">Slot team (4 slot)</option>
                      <option value="business">Business account (1 acc)</option>
                    </select>
                  </div>
                  <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📝 Ghi chú</label><input className="form-input w-full" value={teamEditForm.note} onChange={e => setTeamEditForm({ ...teamEditForm, note: e.target.value })} /></div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setShowTeamEditModal(false)} className="btn-secondary">Hủy</button>
                  <button onClick={async () => {
                    try {
                      await axios.put(`/api/team/${teamEditForm.id}`, { ...teamEditForm, expiredAt: teamEditForm.expiredAt ? new Date(teamEditForm.expiredAt).toISOString() : undefined });
                      setShowTeamEditModal(false); fetchData(); showAlert("Thành công", "Đã cập nhật!", "success");
                    } catch (e) { showAlert("Lỗi", e.message, "error"); }
                  }} className="btn-primary" style={{ background: "#2563eb" }}>Lưu</button>
                </div>
              </div>
            </div>
          )}

          {/* SLOT MODAL */}
          {showSlotModal && (() => {
            const slot = slotTarget.slot || {};
            const isEmpty = slot.status === "empty" || !slot.gmail;
            const parentAcc = teamAccounts.find(a => a.id === slotTarget.accId);

            let showWarning = false;
            let daysLeft = 0;
            if (isEmpty && parentAcc && parentAcc.expiredAt) {
              const exp = new Date(parentAcc.expiredAt);
              const now = new Date();
              daysLeft = Math.ceil((exp - now) / 86400000);
              if (daysLeft < 30) showWarning = true;
            }

            return (
              <div className="modal-overlay">
                <div className="modal-box" style={{ maxWidth: "450px" }}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-white mb-0">{isEmpty ? "➕ Gán Khách vào" : "✏️ Sửa"} Slot {(slotTarget.slotIdx ?? 0) + 1}</h3>
                    <span className="close cursor-pointer text-slate-400 hover:text-white text-2xl" onClick={() => setShowSlotModal(false)}>&times;</span>
                  </div>

                  {showWarning && (
                    <div className="mb-4 mt-2 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded flex gap-2 items-start">
                      <AlertTriangle className="text-yellow-500 shrink-0" size={20} />
                      <div className="text-xs text-yellow-200">
                        <span className="font-bold block text-sm text-yellow-500">CẢNH BÁO HẠN DÙNG</span>
                        Tài khoản Team này chỉ còn <b>{daysLeft} ngày</b> (&lt; 1 tháng).<br />Khách mua tháng có thể bị gián đoạn!
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📧 Gmail Khách</label><input className="form-input w-full" placeholder="customer@gmail.com" value={slotFormGmail} onChange={e => setSlotFormGmail(e.target.value)} /></div>
                    <div className="form-group"><label className="block text-xs text-slate-400 mb-1">👤 Tên Khách</label><input className="form-input w-full" placeholder="Nguyễn Văn A" value={slotFormName} onChange={e => setSlotFormName(e.target.value)} /></div>
                    <div className="form-group"><label className="block text-xs text-slate-400 mb-1">📅 Ngày Tham Gia</label><input type="date" className="form-input w-full" value={slotFormExp} onChange={e => setSlotFormExp(e.target.value)} /></div>
                    <div className="form-group"><label className="block text-xs text-yellow-400 mb-1">📅 Ngày Hết Hạn</label><input type="date" className="form-input w-full" value={slotFormExpiredAt} onChange={e => setSlotFormExpiredAt(e.target.value)} /></div>
                  </div>

                  <div className="flex justify-between mt-6">
                    {!isEmpty ? (
                      <button onClick={async () => {
                        if (!parentAcc) return;
                        const updSlots = Array(4).fill(null).map((_, i) => (parentAcc.slots || [])[i] || { status: "empty" });
                        updSlots[slotTarget.slotIdx] = { status: "empty", gmail: "", customerName: "", addedAt: "", expiredAt: "" };
                        await axios.put(`/api/team/${slotTarget.accId}`, { slots: updSlots });
                        setShowSlotModal(false); fetchData();
                      }} className="bg-red-800 hover:bg-red-700 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-2"><Trash2 size={16} /> Xóa Slot</button>
                    ) : (<div></div>)}
                    <div className="flex gap-2">
                      <button onClick={() => setShowSlotModal(false)} className="btn-secondary">Hủy</button>
                      <button onClick={async () => {
                        if (!parentAcc) return;
                        const updSlots = Array(4).fill(null).map((_, i) => (parentAcc.slots || [])[i] || { status: "empty" });
                        const joinDate = slotFormExp ? new Date(slotFormExp) : new Date();
                        const expireDate = slotFormExpiredAt ? new Date(slotFormExpiredAt) : addDurationToDate(joinDate, "1M");
                        updSlots[slotTarget.slotIdx] = { status: slotFormGmail ? "active" : "empty", gmail: slotFormGmail, customerName: slotFormName, addedAt: joinDate.toISOString(), expiredAt: expireDate.toISOString() };
                        await axios.put(`/api/team/${slotTarget.accId}`, { slots: updSlots });
                        setShowSlotModal(false); fetchData();
                      }} className="btn-primary" style={{ background: "#4f46e5" }}>💾 Lưu</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {showSimpleAddModal && (() => {
        const opts = {
          netflix: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
          capcut: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }],
          canva: [{ v: "1M", l: "1 tháng" }, { v: "3M", l: "3 tháng" }, { v: "6M", l: "6 tháng" }, { v: "1Y", l: "1 năm" }],
        };
        const platformLabel = { netflix: "Netflix", capcut: "CapCut", canva: "Canva" }[simpleAddPlatform] || simpleAddPlatform;
        const durOpts = opts[simpleAddPlatform] || opts.netflix;
        const isCanva = simpleAddPlatform === "canva";

        const calcExp = (dur) => addDurationToDate(new Date(), dur).toISOString();

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

        const handleDurationChange = (e) => {
          const newDur = e.target.value;
          const d = addDurationToDate(new Date(), newDur);
          setSimpleEditForm(p => ({ ...p, duration: newDur, expiredAt: d.toISOString().split('T')[0] }));
        };

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
                  <select className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white" value={simpleEditForm.duration} onChange={handleDurationChange}>
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

