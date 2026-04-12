import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Gift,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  Phone,
  Search,
  SendHorizontal,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import {
  canUseRealtimeRuntime,
  getRealtimeSafetySyncMs,
  subscribeToBroadcastTopic,
} from "./realtime";

const STORE_TOKEN_KEY = "store_user_token";
const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_TOKEN_EXPIRES_AT_KEY = "token_expires_at";
const SESSION_ROLE_KEY = "active_session_role";
const STORE_PAYMENT_METHOD_MOMO = "momo";
const STORE_PAYMENT_METHOD_PAYOS = "payos";
const DEFAULT_SUPPORT_PAGE_SIZE = 6;
const DEFAULT_SUPPORT_RETENTION_DAYS = 7;
const STORE_ORDERS_PER_PAGE = 5;
const STORE_ORDER_REFRESH_GRACE_MS = 5000;
const STORE_SUPPORT_THREAD_REFRESH_GRACE_MS = 5000;
const STORE_CATALOG_REFRESH_GRACE_MS = 8000;

const getPaymentMethodLabel = (method) =>
  String(method || "").trim().toLowerCase() === STORE_PAYMENT_METHOD_PAYOS
    ? "Ngân hàng"
    : "MoMo";

const getStoreCheckoutMethodLabel = (method) =>
  String(method || "").trim().toLowerCase() === STORE_PAYMENT_METHOD_PAYOS
    ? "Ngân hàng"
    : "MoMo";

const buildQrImageUrl = (value, size = 280) => {
  const payload = String(value || "").trim();
  if (!payload) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
    payload,
  )}`;
};

const clearStoredAdminSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_EXPIRES_AT_KEY);
};

const clearStoredStoreSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORE_TOKEN_KEY);
};

const readStoredSessionRole = () => {
  if (typeof window === "undefined") return "";
  return String(localStorage.getItem(SESSION_ROLE_KEY) || "").trim();
};

const writeStoredSessionRole = (role = "") => {
  if (typeof window === "undefined") return;
  const normalizedRole = String(role || "").trim();
  if (normalizedRole) {
    localStorage.setItem(SESSION_ROLE_KEY, normalizedRole);
  } else {
    localStorage.removeItem(SESSION_ROLE_KEY);
  }
};

const hasValidStoredAdminSession = () => {
  if (typeof window === "undefined") return false;
  const token = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
  const expiresAt = String(
    localStorage.getItem(ADMIN_TOKEN_EXPIRES_AT_KEY) || "",
  ).trim();
  if (!token || !expiresAt) return false;
  const expiryTime = new Date(expiresAt).getTime();
  return Number.isFinite(expiryTime) && expiryTime > Date.now();
};

const readStoreRoute = () => {
  if (typeof window === "undefined") {
    return { view: "home", orderId: "", token: "" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get("view") || "home",
    orderId: params.get("orderId") || "",
    token: params.get("token") || "",
  };
};

const setStoreRoute = (next = {}) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const view = String(next.view || "home").trim();
  if (view && view !== "home") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  if (next.orderId) url.searchParams.set("orderId", String(next.orderId).trim());
  else url.searchParams.delete("orderId");
  if (next.token) url.searchParams.set("token", String(next.token).trim());
  else url.searchParams.delete("token");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
};

const buildOtpDisplayState = ({ code = "", expiresIn = 0, extra = {} } = {}) => {
  const normalizedExpiresIn = Number(expiresIn || 0);
  return {
    code: String(code || ""),
    expiresAtMs:
      normalizedExpiresIn > 0 ? Date.now() + normalizedExpiresIn * 1000 : 0,
    ...extra,
  };
};

const getOtpSecondsRemaining = (otp = {}, nowMs = Date.now()) => {
  const expiresAtMs = Number(otp?.expiresAtMs || 0);
  if (!expiresAtMs) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
};

const apiRequest = async (path, { method = "GET", token = "", body } = {}) => {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Request failed");
  }
  return data;
};

const formatMoney = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDateTime = (value) => {
  const time = new Date(value || "");
  if (Number.isNaN(time.getTime())) return "--";
  return time.toLocaleString("vi-VN");
};
const formatCompactDateTime = (value) => {
  const time = new Date(value || "");
  if (Number.isNaN(time.getTime())) return "--";
  return time.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
};
const formatChatTime = (value) => {
  const time = new Date(value || "");
  if (Number.isNaN(time.getTime())) return "--";
  return time.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
};
const formatSupportMessageTime = (value) => {
  const time = new Date(value || "");
  if (Number.isNaN(time.getTime())) return "--";
  return time.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};
const formatSupportDayLabel = (value) => {
  const time = new Date(value || "");
  if (Number.isNaN(time.getTime())) return "--";
  return time.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
};
const isSameSupportDay = (leftValue, rightValue) => {
  const leftTime = new Date(leftValue || "");
  const rightTime = new Date(rightValue || "");
  if (Number.isNaN(leftTime.getTime()) || Number.isNaN(rightTime.getTime())) {
    return false;
  }
  return (
    leftTime.getFullYear() === rightTime.getFullYear() &&
    leftTime.getMonth() === rightTime.getMonth() &&
    leftTime.getDate() === rightTime.getDate()
  );
};
const mergeRealtimeSupportConversation = (currentConversation = null, incoming = null) => {
  const safeIncoming =
    incoming && typeof incoming === "object" ? incoming : null;
  const incomingId = String(safeIncoming?.id || "").trim();
  if (!incomingId) return currentConversation;
  if (!currentConversation) return safeIncoming;
  const currentId = String(currentConversation?.id || "").trim();
  if (currentId && currentId !== incomingId) return currentConversation;
  return {
    ...(currentConversation || {}),
    ...safeIncoming,
  };
};
const mergeRealtimeSupportMessages = (items = [], incoming = null) => {
  const safeIncoming =
    incoming && typeof incoming === "object" ? incoming : null;
  const messageId = String(safeIncoming?.id || "").trim();
  if (!messageId) return [...(Array.isArray(items) ? items : [])];
  const nextItems = [...(Array.isArray(items) ? items : [])];
  const existingIndex = nextItems.findIndex(
    (item) => String(item?.id || "").trim() === messageId,
  );
  if (existingIndex >= 0) {
    nextItems[existingIndex] = {
      ...nextItems[existingIndex],
      ...safeIncoming,
    };
  } else {
    nextItems.push(safeIncoming);
  }
  return nextItems.sort((a, b) => {
    const aTime = new Date(a?.createdAt || 0).getTime();
    const bTime = new Date(b?.createdAt || 0).getTime();
    return aTime - bTime;
  });
};
const mergeRealtimeSupportMessageBatch = (items = [], incomingItems = []) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeIncomingItems = Array.isArray(incomingItems) ? incomingItems : [];
  return safeIncomingItems.reduce(
    (nextItems, item) => mergeRealtimeSupportMessages(nextItems, item),
    [...safeItems],
  );
};
const buildDefaultSupportPaginationState = () => ({
  nextCursor: "",
  hasMore: false,
  loadingOlder: false,
  retainedAfter: "",
  retentionDays: DEFAULT_SUPPORT_RETENTION_DAYS,
});
const getVoucherTypeLabel = (type, value) =>
  String(type || "").trim().toLowerCase() === "fixed"
    ? `${formatMoney(value)}`
    : `${Number(value || 0)}%`;
const buildVoucherPreviewFromOrder = (order = null) => {
  if (!order || !String(order?.voucherCode || "").trim()) return null;
  return {
    id: String(order?.voucherId || "").trim(),
    code: String(order?.voucherCode || "").trim(),
    type: String(order?.voucherType || "").trim(),
    value: Number(order?.voucherValue || 0),
    description: String(order?.voucherDescription || "").trim(),
    originalAmount: Number(order?.originalAmount || order?.amount || 0),
    discountAmount: Number(order?.discountAmount || 0),
    finalAmount: Number(order?.amount || 0),
  };
};

const formatStatusLabel = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "fulfilled") return "Đã giao";
  if (normalized === "paid") return "Đã thanh toán";
  if (normalized === "awaiting_payment") return "Chờ thanh toán";
  if (normalized === "payment_failed") return "Thanh toán thất bại";
  if (normalized === "payment_expired") return "Hết hạn thanh toán";
  if (normalized === "fulfillment_failed") return "Cần xử lý thủ công";
  if (normalized === "pending_payment") return "Đang tạo thanh toán";
  return normalized || "Mới";
};

const buildQuickCopyPayload = ({
  username = "",
  password = "",
  otpSecret = "",
  otpCode = "",
  link = "",
  isPackage1 = false,
} = {}) => {
  const lines = [];
  if (username) lines.push(`Tài khoản: ${username}`);
  if (password) lines.push(`Mật khẩu: ${password}`);
  if (otpCode) {
    lines.push(
      isPackage1 ? `Mã đăng nhập: ${otpCode}` : `Mã 2FA hiện tại: ${otpCode}`,
    );
  }
  if (!isPackage1 && otpSecret) {
    lines.push(`Mã 2FA: ${otpSecret}`);
  }
  if (link) {
    lines.push(`Link: ${link}`);
  }
  return lines.join("\n");
};

const isPendingStorePayment = (status) =>
  ["pending_payment", "awaiting_payment"].includes(
    String(status || "").trim().toLowerCase(),
  );
const getOrderSortTimestamp = (order = {}) => {
  const candidates = [order?.createdAt, order?.updatedAt, order?.expiresAt];
  for (const candidate of candidates) {
    const parsed = new Date(candidate || "").getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};
const getOrderStatusClass = (status = "") => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "fulfilled") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
  }
  if (normalized === "paid") {
    return "border-cyan-400/20 bg-cyan-500/10 text-cyan-200";
  }
  if (isPendingStorePayment(normalized)) {
    return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  }
  if (["payment_failed", "payment_expired", "fulfillment_failed"].includes(normalized)) {
    return "border-rose-400/20 bg-rose-500/10 text-rose-200";
  }
  return "border-slate-700 bg-slate-900/85 text-slate-200";
};
const getLatestWarrantyRound = (order = {}) => {
  const rounds = Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : [];
  if (rounds.length === 0) return null;
  return rounds[rounds.length - 1] || null;
};
const getWarrantySearchTerms = (order = {}) => {
  const rounds = Array.isArray(order?.warrantyRounds) ? order.warrantyRounds : [];
  return rounds.flatMap((round) => [
    round?.fromUsername,
    round?.toUsername,
    round?.fromAccountId,
    round?.toAccountId,
  ]);
};

const packageFeatureMap = {
  package1: [
    "1 tài khoản dùng chung 3 người",
    "Giá rẻ nhất - tối ưu chi phí",
    "Đáp ứng tốt nhu cầu học tập, cơ bản",
  ],
  package2: [
    "Dùng riêng hoặc share bạn bè",
    "Toàn quyền đăng nhập",
    "Ổn định - mượt hơn khi sử dụng",
  ],
  package3: [
    "Nâng trực tiếp tài khoản của bạn",
    "Giữ nguyên dữ liệu, lịch sử chat",
    "Bảo mật cao - full quyền kiểm soát",
  ],
};

function PublicStorefront() {
  const initialStoreToken =
    typeof window !== "undefined" ? localStorage.getItem(STORE_TOKEN_KEY) || "" : "";
  const [route, setRouteState] = useState(readStoreRoute());
  const [config, setConfig] = useState({
    packages: [],
    googleClientId: "",
    contact: { zaloUrl: "", messengerUrl: "" },
    momoConfigured: false,
    payosConfigured: false,
    realtime: {
      enabled: false,
      url: "",
      anonKey: "",
      safetySyncMs: 90000,
    },
  });
  const [token, setToken] = useState(initialStoreToken);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(Boolean(initialStoreToken));
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [purchaseLoadingCode, setPurchaseLoadingCode] = useState("");
  const [reconcileLoadingOrderId, setReconcileLoadingOrderId] = useState("");
  const [paymentPickerPackageCode, setPaymentPickerPackageCode] = useState("");
  const [paymentPreviewOrderId, setPaymentPreviewOrderId] = useState("");
  const [paymentPreviewOrderDraft, setPaymentPreviewOrderDraft] = useState(null);
  const [voucherCodeInput, setVoucherCodeInput] = useState("");
  const [voucherPreview, setVoucherPreview] = useState(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportConversation, setSupportConversation] = useState(null);
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportPagination, setSupportPagination] = useState(
    buildDefaultSupportPaginationState(),
  );
  const [supportDraft, setSupportDraft] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
  });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [otpResults, setOtpResults] = useState({});
  const [package2OtpLoadingOrderId, setPackage2OtpLoadingOrderId] = useState("");
  const [otpNowMs, setOtpNowMs] = useState(() => Date.now());
  const [ordersPage, setOrdersPage] = useState(1);
  const [orderSearchInput, setOrderSearchInput] = useState("");
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const googleButtonRef = useRef(null);
  const authCardRef = useRef(null);
  const ordersSectionRef = useRef(null);
  const supportMessagesViewportRef = useRef(null);
  const pendingReconcileRef = useRef(false);
  const purchaseLockRef = useRef(false);
  const storeOrdersSyncRef = useRef(false);
  const supportThreadSyncRef = useRef(false);
  const storeOrdersLastLoadedAtRef = useRef(0);
  const storeOrdersLoadPromiseRef = useRef(null);
  const storeOrdersReloadQueuedRef = useRef(false);
  const catalogLastLoadedAtRef = useRef(0);
  const catalogLoadPromiseRef = useRef(null);
  const catalogReloadQueuedRef = useRef(false);
  const supportThreadLastLoadedAtRef = useRef(0);
  const supportThreadReloadQueuedRef = useRef(false);
  const supportThreadQueuedMarkReadRef = useRef(false);
  const supportThreadQueuedForceRef = useRef(false);
  const supportConversationRef = useRef(null);
  const supportThreadLoadSeqRef = useRef(0);
  const supportThreadAppliedSeqRef = useRef(0);
  const supportLastReadSignatureRef = useRef("");
  const supportLastReadAtRef = useRef(0);
  const supportDraftInputRef = useRef(null);
  const supportScrollModeRef = useRef("");
  const supportPreviousScrollHeightRef = useRef(0);
  const supportPreviousScrollTopRef = useRef(0);

  const refreshRouteState = () => setRouteState(readStoreRoute());

  const focusAuthCard = (mode = "login") => {
    setAuthMode(mode);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      authCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const setSessionToken = (nextToken) => {
    setToken(nextToken || "");
    if (typeof window === "undefined") return;
    if (nextToken) localStorage.setItem(STORE_TOKEN_KEY, nextToken);
    else localStorage.removeItem(STORE_TOKEN_KEY);
  };

  const isSupportViewportNearBottom = () => {
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return true;
    return (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 140
    );
  };

  const queueSupportScrollToBottom = () => {
    supportScrollModeRef.current = "bottom";
  };

  const flushSupportScrollToBottom = () => {
    if (typeof window === "undefined") return;
    const scrollToLatest = () => {
      const viewport = supportMessagesViewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = Number(viewport.scrollHeight || 0);
    };
    scrollToLatest();
    window.requestAnimationFrame(() => {
      scrollToLatest();
      window.requestAnimationFrame(scrollToLatest);
    });
    window.setTimeout(scrollToLatest, 40);
    window.setTimeout(scrollToLatest, 160);
  };

  const queueSupportScrollPreserve = () => {
    const viewport = supportMessagesViewportRef.current;
    supportPreviousScrollHeightRef.current = Number(viewport?.scrollHeight || 0);
    supportPreviousScrollTopRef.current = Number(viewport?.scrollTop || 0);
    supportScrollModeRef.current = "preserve";
  };

  const getSupportUnreadCount = (conversation = supportConversationRef.current) =>
    Math.max(
      0,
      Number(
        conversation?.unreadCount ?? conversation?.userUnreadCount ?? 0,
      ),
    );

  const shouldMarkSupportThreadRead = ({
    force = false,
    conversation = supportConversationRef.current,
  } = {}) => {
    if (!supportOpen || !token || !user) return false;
    if (!force && typeof document !== "undefined" && document.hidden) {
      return false;
    }
    const unreadCount = getSupportUnreadCount(conversation);
    if (!force && unreadCount <= 0) return false;
    const signature = [
      String(conversation?.id || "").trim(),
      String(conversation?.lastMessageAt || "").trim(),
      unreadCount,
    ].join(":");
    const now = Date.now();
    if (
      !force &&
      supportLastReadSignatureRef.current === signature &&
      now - Number(supportLastReadAtRef.current || 0) < 15000
    ) {
      return false;
    }
    supportLastReadSignatureRef.current = signature;
    supportLastReadAtRef.current = now;
    return true;
  };

  const loadConfig = async () => {
    const data = await apiRequest("/api/store/config");
    const normalizedConfig = {
      packages: Array.isArray(data?.packages) ? data.packages : [],
      googleClientId: String(data?.googleClientId || ""),
      contact: data?.contact || { zaloUrl: "", messengerUrl: "" },
      momoConfigured: !!data?.momoConfigured,
      payosConfigured: !!data?.payosConfigured,
      realtime: {
        enabled: !!data?.realtime?.enabled,
        url: String(data?.realtime?.url || "").trim(),
        anonKey: String(data?.realtime?.anonKey || "").trim(),
        safetySyncMs: getRealtimeSafetySyncMs(data?.realtime, 90000),
      },
    };
    setConfig(normalizedConfig);
    return normalizedConfig;
  };

  const loadCatalog = async ({ force = false } = {}) => {
    if (catalogLoadPromiseRef.current) {
      if (force) {
        catalogReloadQueuedRef.current = true;
      }
      return catalogLoadPromiseRef.current;
    }
    if (
      !force &&
      Number(catalogLastLoadedAtRef.current || 0) > 0 &&
      Date.now() - Number(catalogLastLoadedAtRef.current || 0) <=
        STORE_CATALOG_REFRESH_GRACE_MS
    ) {
      return Array.isArray(config?.packages) ? config.packages : [];
    }
    const runRequest = (async () => {
      setCatalogLoading(true);
      try {
        const data = await apiRequest("/api/store/catalog");
        const nextPackages = Array.isArray(data?.packages) ? data.packages : [];
        setConfig((prev) => ({
          ...prev,
          packages: nextPackages.length ? nextPackages : prev.packages,
        }));
        catalogLastLoadedAtRef.current = Date.now();
        return nextPackages;
      } finally {
        setCatalogLoading(false);
      }
    })();
    catalogLoadPromiseRef.current = runRequest;
    try {
      return await runRequest;
    } finally {
      if (catalogLoadPromiseRef.current === runRequest) {
        catalogLoadPromiseRef.current = null;
      }
      if (catalogReloadQueuedRef.current) {
        catalogReloadQueuedRef.current = false;
        queueMicrotask(() => {
          loadCatalog({ force: true }).catch(() => {});
        });
      }
    }
  };

  const loadSession = async (currentToken = token) => {
    if (!currentToken) {
      setUser(null);
      setOrders([]);
      storeOrdersLastLoadedAtRef.current = 0;
      return { user: null, orders: [] };
    }
    const data = await apiRequest("/api/store/auth/me", { token: currentToken });
    setUser(data?.user || null);
    setOrders(Array.isArray(data?.orders) ? data.orders : []);
    storeOrdersLastLoadedAtRef.current = Date.now();
    return data;
  };

  const loadOrders = async (currentToken = token, { force = false } = {}) => {
    if (!currentToken) {
      setOrders([]);
      storeOrdersLastLoadedAtRef.current = 0;
      return { orders: [] };
    }
    if (storeOrdersLoadPromiseRef.current) {
      if (force) {
        storeOrdersReloadQueuedRef.current = true;
      }
      return storeOrdersLoadPromiseRef.current;
    }
    if (
      !force &&
      Number(storeOrdersLastLoadedAtRef.current || 0) > 0 &&
      Date.now() - Number(storeOrdersLastLoadedAtRef.current || 0) <=
        STORE_ORDER_REFRESH_GRACE_MS
    ) {
      return { orders };
    }
    storeOrdersSyncRef.current = true;
    const runRequest = (async () => {
      const data = await apiRequest("/api/store/orders", { token: currentToken });
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
      storeOrdersLastLoadedAtRef.current = Date.now();
      return data;
    })();
    storeOrdersLoadPromiseRef.current = runRequest;
    try {
      return await runRequest;
    } finally {
      storeOrdersSyncRef.current = false;
      if (storeOrdersLoadPromiseRef.current === runRequest) {
        storeOrdersLoadPromiseRef.current = null;
      }
      if (storeOrdersReloadQueuedRef.current) {
        storeOrdersReloadQueuedRef.current = false;
        queueMicrotask(() => {
          loadOrders(currentToken, { force: true }).catch(() => {});
        });
      }
    }
  };

  const handleValidateVoucher = async ({
    code = voucherCodeInput,
    packageCode = paymentPickerPackageCode,
    silent = false,
  } = {}) => {
    const normalizedCode = String(code || "").trim();
    const normalizedPackageCode = String(packageCode || "").trim();
    if (!normalizedPackageCode || !token) {
      setVoucherPreview(null);
      return null;
    }
    if (!normalizedCode) {
      setVoucherPreview(null);
      return null;
    }
    try {
      setVoucherLoading(true);
      const data = await apiRequest("/api/store/vouchers/validate", {
        method: "POST",
        token,
        body: {
          packageCode: normalizedPackageCode,
          voucherCode: normalizedCode,
        },
      });
      const preview = data?.voucher || null;
      setVoucherPreview(preview);
      if (!silent) {
        setMessage("Voucher hợp lệ, hệ thống đã áp giá mới.");
        setError("");
      }
      return preview;
    } catch (voucherError) {
      setVoucherPreview(null);
      if (!silent) {
        setMessage("");
        setError(voucherError.message || "Voucher không hợp lệ.");
      }
      return null;
    } finally {
      setVoucherLoading(false);
    }
  };

  const loadSupportThread = async ({
    markRead = true,
    silent = false,
    cursor = "",
    append = false,
    reset = false,
  } = {}) => {
    if (!token || !user) {
      supportThreadLoadSeqRef.current = 0;
      supportThreadAppliedSeqRef.current = 0;
      setSupportConversation(null);
      setSupportMessages([]);
      setSupportPagination(buildDefaultSupportPaginationState());
      return null;
    }
    const normalizedCursor = String(cursor || "").trim();
    const isLoadingOlder = append || !!normalizedCursor;
    const requestSeq = isLoadingOlder
      ? supportThreadLoadSeqRef.current
      : supportThreadLoadSeqRef.current + 1;
    if (!isLoadingOlder) {
      supportThreadLoadSeqRef.current = requestSeq;
    }
    const effectiveMarkRead =
      !isLoadingOlder &&
      markRead &&
      shouldMarkSupportThreadRead({ force: reset && !supportConversationRef.current });
    try {
      if (!silent && !isLoadingOlder) setSupportLoading(true);
      if (isLoadingOlder) {
        setSupportPagination((prev) => ({ ...prev, loadingOlder: true }));
        queueSupportScrollPreserve();
      }
      const data = await apiRequest(
        `/api/store/support/thread?markRead=${effectiveMarkRead ? "1" : "0"}${
          normalizedCursor
            ? `&cursor=${encodeURIComponent(normalizedCursor)}`
            : ""
        }&limit=${DEFAULT_SUPPORT_PAGE_SIZE}`,
        {
          token,
        },
      );
      const nextConversation =
        data?.conversation && typeof data.conversation === "object"
          ? data.conversation
          : null;
      const nextMessages = Array.isArray(data?.messages) ? data.messages : [];
      if (effectiveMarkRead && nextConversation) {
        supportLastReadSignatureRef.current = [
          String(nextConversation?.id || "").trim(),
          String(nextConversation?.lastMessageAt || "").trim(),
          0,
        ].join(":");
        supportLastReadAtRef.current = Date.now();
      }
      if (!isLoadingOlder && requestSeq < supportThreadAppliedSeqRef.current) {
        return data;
      }
      if (!isLoadingOlder) {
        supportThreadAppliedSeqRef.current = requestSeq;
      }
      const nextPagination = data?.pagination || {};
      setSupportConversation((prev) =>
        mergeRealtimeSupportConversation(prev, nextConversation),
      );
      setSupportPagination((prev) => ({
        ...prev,
        nextCursor: String(nextPagination?.nextCursor || "").trim(),
        hasMore: !!nextPagination?.hasMore,
        retainedAfter: String(nextPagination?.retainedAfter || "").trim(),
        retentionDays:
          Number(nextPagination?.retentionDays || 0) ||
          prev.retentionDays ||
          DEFAULT_SUPPORT_RETENTION_DAYS,
        loadingOlder: false,
      }));
      setSupportMessages((prev) => {
        if (reset && !isLoadingOlder) {
          return mergeRealtimeSupportMessageBatch([], nextMessages);
        }
        return mergeRealtimeSupportMessageBatch(prev, nextMessages);
      });
      if (!isLoadingOlder) {
        supportThreadLastLoadedAtRef.current = Date.now();
      }
      return data;
    } catch (supportError) {
      if (isLoadingOlder) {
        setSupportPagination((prev) => ({ ...prev, loadingOlder: false }));
      }
      if (!silent) {
        setError(supportError.message || "Không tải được chat hỗ trợ.");
      }
      return null;
    } finally {
      if (!silent && !isLoadingOlder) setSupportLoading(false);
    }
  };

  const loadOlderSupportMessages = async () => {
    if (
      supportPagination.loadingOlder ||
      !supportPagination.hasMore ||
      !supportPagination.nextCursor
    ) {
      return;
    }
    await loadSupportThread({
      markRead: false,
      silent: true,
      cursor: supportPagination.nextCursor,
      append: true,
    });
  };

  const syncOrdersSilently = async ({ force = false } = {}) => {
    if (!token || !user) return;
    if (typeof document !== "undefined" && document.hidden) return;
    await loadOrders(token, { force });
  };

  const syncSupportThreadSilently = async ({
    markRead = false,
    force = false,
  } = {}) => {
    if (!token || !user) return;
    if (
      !force &&
      !markRead &&
      Number(supportThreadLastLoadedAtRef.current || 0) > 0 &&
      Date.now() - Number(supportThreadLastLoadedAtRef.current || 0) <=
        STORE_SUPPORT_THREAD_REFRESH_GRACE_MS
    ) {
      return;
    }
    if (supportThreadSyncRef.current) {
      supportThreadReloadQueuedRef.current = true;
      supportThreadQueuedMarkReadRef.current =
        supportThreadQueuedMarkReadRef.current || markRead;
      supportThreadQueuedForceRef.current =
        supportThreadQueuedForceRef.current || force;
      return;
    }
    supportThreadSyncRef.current = true;
    try {
      await loadSupportThread({ markRead, silent: true });
    } finally {
      supportThreadSyncRef.current = false;
      if (supportThreadReloadQueuedRef.current) {
        const nextMarkRead = supportThreadQueuedMarkReadRef.current;
        const nextForce = supportThreadQueuedForceRef.current;
        supportThreadReloadQueuedRef.current = false;
        supportThreadQueuedMarkReadRef.current = false;
        supportThreadQueuedForceRef.current = false;
        queueMicrotask(() => {
          syncSupportThreadSilently({
            markRead: nextMarkRead,
            force: nextForce,
          }).catch(() => {});
        });
      }
    }
  };

  const applyRealtimeSupportPayload = ({ event = "", payload = {} } = {}) => {
    const nextConversation =
      payload?.userConversation && typeof payload.userConversation === "object"
        ? payload.userConversation
        : null;
    const nextMessage =
      payload?.message && typeof payload.message === "object"
        ? payload.message
        : null;
    const nextConversationId = String(
      nextConversation?.id || payload?.conversationId || "",
    ).trim();
    if (nextConversation) {
      setSupportConversation((prev) =>
        mergeRealtimeSupportConversation(prev, nextConversation),
      );
    }
    if (event !== "support.message.created" || !nextMessage) {
      return {
        handled: !!nextConversation,
        conversationId: nextConversationId,
      };
    }
    const currentConversationId = String(
      nextConversationId || supportConversation?.id || "",
    ).trim();
    const messageConversationId = String(
      nextMessage?.conversationId || nextConversationId || "",
    ).trim();
    if (currentConversationId && currentConversationId === messageConversationId) {
      queueSupportScrollToBottom();
      setSupportMessages((prev) => mergeRealtimeSupportMessages(prev, nextMessage));
      flushSupportScrollToBottom();
      return {
        handled: true,
        conversationId: messageConversationId,
      };
    }
    return {
      handled: !!nextConversation,
      conversationId: messageConversationId || nextConversationId,
    };
  };

  const openSupportPanel = async () => {
    if (!user) {
      setMessage("");
      setError("Đăng nhập user để chat trực tiếp với admin trên web.");
      focusAuthCard("login");
      return;
    }
    setSupportOpen(true);
    supportLastReadSignatureRef.current = "";
    supportLastReadAtRef.current = 0;
    supportThreadLastLoadedAtRef.current = 0;
    setSupportMessages([]);
    setSupportPagination(buildDefaultSupportPaginationState());
    queueSupportScrollToBottom();
    await loadSupportThread({ markRead: true, reset: true });
    queueSupportScrollToBottom();
    flushSupportScrollToBottom();
  };

  useEffect(() => {
    supportConversationRef.current = supportConversation;
  }, [supportConversation]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const isMobileOverlay =
      supportOpen && typeof window !== "undefined" && window.innerWidth < 768;
    if (!isMobileOverlay) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [supportOpen]);

  useEffect(() => {
    if (!supportOpen) return;
    if (typeof window === "undefined") return;
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    window.requestAnimationFrame(() => {
      const activeViewport = supportMessagesViewportRef.current;
      if (!activeViewport) return;
      if (supportScrollModeRef.current === "preserve") {
        const deltaHeight =
          Number(activeViewport.scrollHeight || 0) -
          Number(supportPreviousScrollHeightRef.current || 0);
        activeViewport.scrollTop =
          Number(supportPreviousScrollTopRef.current || 0) + deltaHeight;
      } else if (supportScrollModeRef.current === "bottom") {
        activeViewport.scrollTop = activeViewport.scrollHeight;
      }
      supportScrollModeRef.current = "";
    });
  }, [supportMessages, supportOpen]);

  useEffect(() => {
    resizeSupportDraftInput();
  }, [supportDraft, supportOpen]);

  useEffect(() => {
    if (!supportOpen) return;
    focusSupportDraftToEnd();
  }, [supportOpen]);

  useEffect(() => {
    const onPopState = () => refreshRouteState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const interval = window.setInterval(() => {
      setOtpNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrapStore = async () => {
      try {
        const sessionRole = readStoredSessionRole();
        const adminSessionActive = hasValidStoredAdminSession();
        if (initialStoreToken) {
          clearStoredAdminSession();
          writeStoredSessionRole("user");
        } else if (adminSessionActive && sessionRole !== "user") {
          clearStoredStoreSession();
          writeStoredSessionRole("admin");
          window.location.replace("/");
          return;
        } else if (!adminSessionActive && sessionRole === "admin") {
          writeStoredSessionRole("");
        }
        await loadConfig();
        loadCatalog().catch((catalogError) => {
          console.error("Failed to load store catalog", catalogError);
          setCatalogLoading(false);
        });
        if (initialStoreToken) {
          await loadSession(initialStoreToken);
        } else if (sessionRole === "user") {
          writeStoredSessionRole("");
        }
      } catch (bootstrapError) {
        if (initialStoreToken) {
          setSessionToken("");
          writeStoredSessionRole("");
        }
        if (!cancelled) {
          setError(bootstrapError.message || "Không tải được dữ liệu cửa hàng");
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    bootstrapStore();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleStorageSync = (event) => {
      if (
        event?.key &&
        ![
          STORE_TOKEN_KEY,
          ADMIN_TOKEN_KEY,
          ADMIN_TOKEN_EXPIRES_AT_KEY,
          SESSION_ROLE_KEY,
        ].includes(event.key)
      ) {
        return;
      }

      const nextStoreToken = String(
        localStorage.getItem(STORE_TOKEN_KEY) || "",
      ).trim();
      const sessionRole = readStoredSessionRole();
      const adminSessionActive = hasValidStoredAdminSession();

      if (sessionRole === "admin" && adminSessionActive) {
        clearStoredStoreSession();
        setSessionToken("");
        setUser(null);
        setOrders([]);
        window.location.replace("/");
        return;
      }

      if (!nextStoreToken) {
        setSessionToken("");
        setUser(null);
        setOrders([]);
      }
    };

    window.addEventListener("storage", handleStorageSync);
    return () => window.removeEventListener("storage", handleStorageSync);
  }, []);

  useEffect(() => {
    if (route.view !== "payment-result" || !route.orderId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        await apiRequest(`/api/store/orders/${encodeURIComponent(route.orderId)}/reconcile`, {
          method: "POST",
          token,
        });
      } catch {}
      if (!cancelled) {
        loadOrders(token, { force: true }).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.view, route.orderId, token]);

  useEffect(() => {
    if (!token || !user) return undefined;
    if (route.view !== "payment-result") return undefined;
    const pendingOrders = orders.filter(
      (order) =>
        isPendingStorePayment(order.status) &&
        String(order.paymentOrderId || order.momoOrderId || "").trim(),
    );
    if (pendingOrders.length === 0) return undefined;

    let cancelled = false;
    const runReconcile = async () => {
      if (pendingReconcileRef.current) return;
      pendingReconcileRef.current = true;
      try {
        let shouldReload = false;
        for (const order of pendingOrders) {
          try {
            await apiRequest(
              `/api/store/orders/${encodeURIComponent(order.id)}/reconcile`,
              {
                method: "POST",
                token,
              },
            );
            shouldReload = true;
          } catch {}
        }
        if (!cancelled && shouldReload) {
          await loadOrders(token, { force: true });
        }
      } finally {
        pendingReconcileRef.current = false;
      }
    };
    const initialDelayMs = 1500;
    const intervalMs = 10000;
    const timeoutId = window.setTimeout(() => {
      runReconcile().catch(() => {});
    }, initialDelayMs);
    const intervalId = window.setInterval(() => {
      runReconcile().catch(() => {});
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [orders, route.view, token, user]);

  useEffect(() => {
    if (!token || !user) return undefined;
    const handleVisibilityOrFocus = () => {
      syncOrdersSilently().catch(() => {});
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("online", handleVisibilityOrFocus);

    return () => {
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("online", handleVisibilityOrFocus);
    };
  }, [token, user, supportOpen]);

  useEffect(() => {
    if (!supportOpen || !token || !user) return undefined;

    const handleSupportVisibility = () => {
      const shouldMarkRead = shouldMarkSupportThreadRead();
      syncSupportThreadSilently({ markRead: shouldMarkRead }).catch(() => {});
    };

    window.addEventListener("focus", handleSupportVisibility);
    document.addEventListener("visibilitychange", handleSupportVisibility);
    window.addEventListener("online", handleSupportVisibility);

    return () => {
      window.removeEventListener("focus", handleSupportVisibility);
      document.removeEventListener("visibilitychange", handleSupportVisibility);
      window.removeEventListener("online", handleSupportVisibility);
    };
  }, [supportOpen, token, user]);

  useEffect(() => {
    if (!token || !user) return undefined;
    const intervalId = window.setInterval(() => {
      syncOrdersSilently().catch(() => {});
    }, Math.max(getRealtimeSafetySyncMs(config?.realtime, 90000), 180000));
    return () => window.clearInterval(intervalId);
  }, [config?.realtime, token, user]);

  useEffect(() => {
    if (!supportOpen || !token || !user) return undefined;
    const intervalId = window.setInterval(() => {
      const shouldMarkRead = shouldMarkSupportThreadRead();
      syncSupportThreadSilently({ markRead: shouldMarkRead }).catch(() => {});
    }, Math.max(getRealtimeSafetySyncMs(config?.realtime, 90000), 60000));
    return () => window.clearInterval(intervalId);
  }, [config?.realtime, supportOpen, token, user]);

  useEffect(() => {
    if (!user?.realtimeTopic || !canUseRealtimeRuntime(config?.realtime)) {
      return undefined;
    }

    return subscribeToBroadcastTopic({
      config: config.realtime,
      topic: user.realtimeTopic,
      onMessage: ({ event, payload }) => {
        if (event === "order.updated") {
          syncOrdersSilently({ force: true }).catch(() => {});
          return;
        }
        if (event === "stock.updated") {
          loadCatalog({ force: true }).catch(() => {});
          return;
        }
        if (event === "support.message.created" || event === "support.thread.read") {
          const { handled } = applyRealtimeSupportPayload({ event, payload });
          if (!handled) {
            syncSupportThreadSilently({ markRead: false, force: true }).catch(() => {});
          }
        }
      },
    });
  }, [config?.realtime, supportConversation?.id, supportOpen, user?.realtimeTopic]);

  useEffect(() => {
    if (
      !supportOpen ||
      !supportConversation?.realtimeTopic ||
      !canUseRealtimeRuntime(config?.realtime)
    ) {
      return undefined;
    }

    return subscribeToBroadcastTopic({
      config: config.realtime,
      topic: supportConversation.realtimeTopic,
      onMessage: ({ event, payload }) => {
        if (event !== "support.message.created" && event !== "support.thread.read") {
          return;
        }
        const { handled } = applyRealtimeSupportPayload({ event, payload });
        if (!handled) {
          const shouldMarkRead = shouldMarkSupportThreadRead();
          syncSupportThreadSilently({
            markRead: shouldMarkRead,
            force: true,
          }).catch(() => {});
        }
      },
    });
  }, [config?.realtime, supportConversation?.id, supportConversation?.realtimeTopic, supportOpen]);

  useEffect(() => {
    if (user) return;
    supportConversationRef.current = null;
    supportLastReadSignatureRef.current = "";
    supportLastReadAtRef.current = 0;
    supportThreadSyncRef.current = false;
    storeOrdersSyncRef.current = false;
    storeOrdersLoadPromiseRef.current = null;
    catalogLoadPromiseRef.current = null;
    storeOrdersLastLoadedAtRef.current = 0;
    supportThreadLastLoadedAtRef.current = 0;
    supportThreadLoadSeqRef.current = 0;
    supportThreadAppliedSeqRef.current = 0;
    storeOrdersReloadQueuedRef.current = false;
    catalogReloadQueuedRef.current = false;
    supportThreadReloadQueuedRef.current = false;
    supportThreadQueuedMarkReadRef.current = false;
    supportThreadQueuedForceRef.current = false;
    setSupportPagination(buildDefaultSupportPaginationState());
    setSupportOpen(false);
    setSupportConversation(null);
    setSupportMessages([]);
    setSupportDraft("");
  }, [user]);

  useEffect(() => {
    if (!config.googleClientId || !googleButtonRef.current) return;
    let cancelled = false;
    const renderGoogleButton = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (response) => {
          try {
            setError("");
            setMessage("");
            const data = await apiRequest("/api/store/auth/google", {
              method: "POST",
              body: { credential: response.credential },
            });
            clearStoredAdminSession();
            writeStoredSessionRole("user");
            setSessionToken(data?.token || "");
            setUser(data?.user || null);
            setOrders([]);
            setMessage("Đăng nhập Google thành công");
            await loadSession(data?.token || "");
          } catch (googleError) {
            setError(googleError.message || "Đăng nhập Google thất bại");
          }
        },
      });
      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "signin_with",
      });
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.body.appendChild(script);
    return () => {
      cancelled = true;
      script.remove();
    };
  }, [config.googleClientId]);

  useEffect(() => {
    const validPackage2OrderIds = new Set(
      orders
        .filter(
          (order) =>
            order.packageCode === "package2" &&
            order.status === "fulfilled" &&
            String(order.assignedOtpSecret || "").trim(),
        )
        .map((order) => String(order.id || "").trim())
        .filter(Boolean),
    );
    setOtpResults((prev) =>
      Object.fromEntries(
        Object.entries(prev || {}).filter(([orderId, value]) => {
          const kind = String(value?.kind || "").trim();
          if (kind !== "package2") return true;
          return validPackage2OrderIds.has(String(orderId || "").trim());
        }),
      ),
    );
  }, [orders]);

  const currentPaymentOrder = useMemo(
    () => orders.find((order) => order.id === route.orderId) || null,
    [orders, route.orderId],
  );

  const handleLogin = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      setMessage("");
      const data = await apiRequest("/api/store/auth/login", {
        method: "POST",
        body: loginForm,
      });
      clearStoredAdminSession();
      writeStoredSessionRole("user");
      setSessionToken(data?.token || "");
      setUser(data?.user || null);
      setLoginForm({ identifier: "", password: "" });
      setMessage("Đăng nhập thành công");
      await loadSession(data?.token || "");
    } catch (loginError) {
      setError(loginError.message || "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      setMessage("");
      const data = await apiRequest("/api/store/auth/register", {
        method: "POST",
        body: registerForm,
      });
      clearStoredAdminSession();
      writeStoredSessionRole("user");
      setSessionToken(data?.token || "");
      setUser(data?.user || null);
      setRegisterForm({ fullName: "", phone: "", email: "", password: "" });
      setMessage("Đăng ký thành công");
      await loadSession(data?.token || "");
    } catch (registerError) {
      setError(registerError.message || "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/store/auth/forgot-password", {
        method: "POST",
        body: { email: forgotEmail },
      });
      setForgotEmail("");
      setMessage(
        data?.message || "Nếu email tồn tại, hệ thống đã gửi hướng dẫn",
      );
      setShowForgotPassword(false);
    } catch (forgotError) {
      setError(forgotError.message || "Không gửi được email");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/store/auth/reset-password", {
        method: "POST",
        body: { token: route.token, newPassword: resetPassword },
      });
      setMessage(data?.message || "Đã đặt lại mật khẩu");
      setResetPassword("");
      setStoreRoute({ view: "home" });
      refreshRouteState();
    } catch (resetError) {
      setError(resetError.message || "Không đặt lại được mật khẩu");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePayment = async (
    packageCode,
    paymentMethod,
    voucherCode = voucherCodeInput,
  ) => {
    if (!user) {
      setError("Vui lòng đăng nhập trước khi mua.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/store/orders/payment", {
        method: "POST",
        token,
        body: {
          packageCode,
          paymentMethod,
          voucherCode: String(voucherCode || "").trim(),
        },
      });
      const payUrl = String(data?.payUrl || "").trim();
      if (!payUrl) {
        throw new Error("Hệ thống không trả về liên kết thanh toán.");
      }
      const previewOrderId = String(data?.order?.id || "").trim();
      const previewOrder = data?.order || null;
      setPaymentPreviewOrderId(String(previewOrder?.id || previewOrderId || "").trim());
      setPaymentPreviewOrderDraft(previewOrder);
      setVoucherCodeInput(String(previewOrder?.voucherCode || voucherCode || "").trim());
      setVoucherPreview(buildVoucherPreviewFromOrder(previewOrder));
      setMessage(
        paymentMethod === STORE_PAYMENT_METHOD_PAYOS
          ? "Đã tạo mã QR ngân hàng. Quét mã ngay trong popup để thanh toán."
          : "Đã tạo thanh toán MoMo. Hoàn tất ngay trong popup này.",
      );
      setOrdersPage(1);
      loadOrders(token, { force: true }).catch(() => {});
      const hasInlineMomoAction =
        paymentMethod === STORE_PAYMENT_METHOD_MOMO &&
        !!(
          String(previewOrder?.momoQrCodeUrl || "").trim() ||
          String(previewOrder?.momoDeepLink || "").trim()
        );
      if (
        paymentMethod === STORE_PAYMENT_METHOD_MOMO &&
        !hasInlineMomoAction &&
        payUrl &&
        typeof window !== "undefined"
      ) {
        setMessage("MoMo chưa trả mã QR, đang chuyển tới trang thanh toán...");
        window.location.assign(payUrl);
        return data;
      }
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          ordersSectionRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      }
      return data;
    } catch (paymentError) {
      try {
        await loadConfig();
        await loadOrders(token, { force: true });
      } catch {}
      setError(paymentError.message || "Không tạo được đơn thanh toán.");
    } finally {
      setLoading(false);
    }
  };

  const isPaymentMethodConfigured = (paymentMethod, currentConfig = config) => {
    if (paymentMethod === STORE_PAYMENT_METHOD_PAYOS) {
      return !!currentConfig?.payosConfigured;
    }
    return !!currentConfig?.momoConfigured;
  };

  const getPurchaseBlockedReason = (pkg, paymentMethod) => {
    if (sessionLoading) {
      return "Hệ thống đang kiểm tra phiên đăng nhập của bạn.";
    }
    if (catalogLoading || pkg?.available === null || pkg?.available === undefined) {
      return "Hệ thống đang tải số lượng nick còn lại.";
    }
    if (!user) {
      return "Bạn cần đăng nhập hoặc đăng ký tài khoản user trước khi thanh toán.";
    }
    if (!isPaymentMethodConfigured(paymentMethod)) {
      return `${getStoreCheckoutMethodLabel(paymentMethod)} chưa được cấu hình hoàn chỉnh. Vui lòng liên hệ admin.`;
    }
    if (!pkg?.purchasable || Number(pkg?.available || 0) <= 0) {
      return "Kho hiện tại của gói này đã hết. Khi có nick mới trong kho, bạn sẽ mua được.";
    }
    return `Thanh toán ${getStoreCheckoutMethodLabel(paymentMethod)} xong, hệ thống sẽ tự cấp tài khoản ngay trên web.`;
  };

  const getUnifiedPurchaseHint = (pkg) => {
    if (sessionLoading) {
      return "Hệ thống đang kiểm tra phiên đăng nhập của bạn.";
    }
    if (catalogLoading || pkg?.available === null || pkg?.available === undefined) {
      return "Hệ thống đang tải kho còn lại.";
    }
    if (!user) {
      return "Bạn cần đăng nhập hoặc đăng ký tài khoản user trước khi thanh toán.";
    }
    if (!pkg?.purchasable || Number(pkg?.available || 0) <= 0) {
      return "Kho hiện tại của gói này đã hết. Khi có nick mới trong kho, bạn sẽ mua được.";
    }
    return "Chọn MoMo hoặc Ngân hàng để thanh toán.";
  };

  const openPaymentPicker = (pkg) => {
    if (
      sessionLoading ||
      catalogLoading ||
      loading ||
      purchaseLockRef.current ||
      purchaseLoadingCode
    ) {
      return;
    }
    if (!user) {
      setMessage("");
      setError("Bạn chưa đăng nhập tài khoản user. Vui lòng đăng nhập hoặc đăng ký rồi thử lại.");
      focusAuthCard("login");
      return;
    }
    if (pkg?.available === null || pkg?.available === undefined) {
      setMessage("");
      setError("Hệ thống đang tải số lượng nick còn lại. Vui lòng thử lại sau vài giây.");
      return;
    }
    if (!pkg?.purchasable || Number(pkg?.available || 0) <= 0) {
      setMessage("");
      setError("Kho hiện tại của gói này đã hết, nên hệ thống đã chặn không cho tạo thanh toán.");
      return;
    }
    setPaymentPickerPackageCode(String(pkg?.code || "").trim());
    const existingPendingOrder = orders.find(
      (item) =>
        String(item?.packageCode || "").trim() === String(pkg?.code || "").trim() &&
        isPendingStorePayment(item?.status),
    );
    setPaymentPreviewOrderId(String(existingPendingOrder?.id || "").trim());
    setPaymentPreviewOrderDraft(existingPendingOrder || null);
    setVoucherCodeInput(String(existingPendingOrder?.voucherCode || "").trim());
    setVoucherPreview(buildVoucherPreviewFromOrder(existingPendingOrder));
  };

  const closePaymentPicker = () => {
    setPaymentPickerPackageCode("");
    setPaymentPreviewOrderId("");
    setPaymentPreviewOrderDraft(null);
    setVoucherCodeInput("");
    setVoucherPreview(null);
  };

  const paymentPickerPackage = useMemo(
    () =>
      config.packages.find(
        (item) => String(item?.code || "").trim() === paymentPickerPackageCode,
      ) || null,
    [config.packages, paymentPickerPackageCode],
  );

  const paymentPreviewOrder = useMemo(() => {
    const previewOrderId = String(paymentPreviewOrderId || "").trim();
    if (previewOrderId) {
      return (
        orders.find((item) => String(item?.id || "").trim() === previewOrderId) ||
        (String(paymentPreviewOrderDraft?.id || "").trim() === previewOrderId
          ? paymentPreviewOrderDraft
          : null) ||
        null
      );
    }
    return paymentPreviewOrderDraft || null;
  }, [orders, paymentPreviewOrderDraft, paymentPreviewOrderId]);

  const handlePurchaseButtonClick = async (pkg, paymentMethod) => {
    if (
      sessionLoading ||
      catalogLoading ||
      loading ||
      purchaseLockRef.current ||
      purchaseLoadingCode
    )
      return;
    if (!user) {
      setMessage("");
      setError("Bạn chưa đăng nhập tài khoản user. Vui lòng đăng nhập hoặc đăng ký rồi thử lại.");
      focusAuthCard("login");
      return;
    }
    purchaseLockRef.current = true;
    const purchaseKey = `${String(pkg?.code || "")}:${String(paymentMethod || STORE_PAYMENT_METHOD_MOMO)}`;
    setPurchaseLoadingCode(purchaseKey);
    try {
      if (!isPaymentMethodConfigured(paymentMethod, config)) {
        setMessage("");
        setError(
          `${getPaymentMethodLabel(paymentMethod)} chưa được cấu hình hoàn chỉnh. Vui lòng liên hệ admin.`,
        );
        return;
      }
      if (!pkg?.purchasable || Number(pkg?.available || 0) <= 0) {
        setMessage("");
        setError("Kho hiện tại của gói này đã hết, nên hệ thống đã chặn không cho tạo thanh toán.");
        return;
      }
      await handleCreatePayment(pkg.code, paymentMethod, voucherCodeInput);
    } finally {
      purchaseLockRef.current = false;
      setPurchaseLoadingCode("");
    }
  };

  const handleGeneratePackage1Code = async (order) => {
    try {
      setError("");
      const data = await apiRequest("/api/store/package1/code", {
        method: "POST",
        body: { secretToken: order.package1AccessToken },
      });
      setOtpResults((prev) => ({
        ...prev,
        [order.id]: {
          ...buildOtpDisplayState({
            code: data?.code,
            expiresIn: Number(data?.expiresIn || 0),
            extra: { kind: "package1" },
          }),
          usageLeft: Number(data?.usageLeft || 0),
        },
      }));
      await loadOrders(token, { force: true });
    } catch (otpError) {
      setError(otpError.message || "Không lấy được mã đăng nhập");
    }
  };

  const handleReconcileOrderPayment = async (orderId) => {
    try {
      setLoading(true);
      setReconcileLoadingOrderId(String(orderId || ""));
      setError("");
      setMessage("");
      await apiRequest(`/api/store/orders/${encodeURIComponent(orderId)}/reconcile`, {
        method: "POST",
        token,
      });
      await loadOrders(token, { force: true });
      setMessage("Đã kiểm tra lại trạng thái thanh toán.");
    } catch (reconcileError) {
      setError(reconcileError.message || "Không thể kiểm tra trạng thái thanh toán.");
    } finally {
      setReconcileLoadingOrderId("");
      setLoading(false);
    }
  };

  const handleGeneratePackage2Code = async (order) => {
    const orderId = String(order?.id || "").trim();
    const otpSecret = String(order?.assignedOtpSecret || "").trim();
    if (!orderId || !otpSecret) {
      setError("Đơn này chưa có mã 2FA để lấy nhanh.");
      return;
    }
    try {
      setError("");
      setPackage2OtpLoadingOrderId(orderId);
      const data = await apiRequest("/api/store/totp/generate", {
        method: "POST",
        body: { secret: otpSecret },
      });
      setOtpResults((prev) => ({
        ...prev,
        [orderId]: buildOtpDisplayState({
          code: data?.code,
          expiresIn: Number(data?.expiresIn || 0),
          extra: { kind: "package2" },
        }),
      }));
    } catch (otpError) {
      setError(otpError.message || "Không lấy được mã 2FA");
    } finally {
      setPackage2OtpLoadingOrderId("");
    }
  };

  const handleSendSupportMessage = async (event) => {
    event.preventDefault();
    const body = String(supportDraft || "").trim();
    if (!body) return;
    try {
      setSupportSending(true);
      setError("");
      const data = await apiRequest("/api/store/support/thread/messages", {
        method: "POST",
        token,
        body: { body },
      });
      const nextMessage = data?.message || null;
      queueSupportScrollToBottom();
      setSupportConversation((prev) =>
        mergeRealtimeSupportConversation(prev, data?.conversation || supportConversation),
      );
      setSupportMessages((prev) =>
        nextMessage ? mergeRealtimeSupportMessages(prev, nextMessage) : prev,
      );
      supportThreadLastLoadedAtRef.current = Date.now();
      flushSupportScrollToBottom();
      setSupportDraft("");
      focusSupportDraftToEnd();
      setMessage("Đã gửi tin nhắn cho admin.");
    } catch (supportError) {
      setError(supportError.message || "Không gửi được tin nhắn.");
    } finally {
      setSupportSending(false);
    }
  };

  const focusSupportDraftToEnd = () => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const input = supportDraftInputRef.current;
      if (!input) return;
      input.focus();
      const textLength = String(input.value || "").length;
      input.setSelectionRange(textLength, textLength);
    });
  };

  const resizeSupportDraftInput = () => {
    const input = supportDraftInputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(input.scrollHeight, 88)}px`;
  };

  const copyText = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setMessage(successMessage || "Đã sao chép");
    } catch {
      setError("Không sao chép được");
    }
  };

  const renderOrderLoginGuide = (steps = [], note = "") => (
    <details className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">
          <ShieldCheck size={14} className="text-cyan-300" />
          Hướng dẫn đăng nhập
        </span>
        <span className="text-[11px] text-slate-400">Bấm để xem</span>
      </summary>
      <ol className="mt-3 space-y-2 text-xs leading-5 text-slate-200">
        {steps.map((step, index) => (
          <li key={`${index}-${step}`} className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-[10px] font-semibold text-cyan-200">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {note ? (
        <p className="mt-3 rounded-2xl border border-cyan-400/15 bg-slate-950/60 px-3 py-2 text-[11px] leading-5 text-cyan-100/90">
          {note}
        </p>
      ) : null}
    </details>
  );

  const renderOrderCredentialRows = (rows = []) => (
    <div className="mt-3 space-y-2 rounded-2xl border border-slate-800 bg-slate-950/75 p-3">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-2 sm:grid-cols-[72px,1fr,auto] sm:items-center">
          <span className="text-xs text-slate-500">{label}</span>
          <code className="min-w-0 break-all rounded-xl bg-slate-900 px-3 py-2 text-[13px] text-white">
            {value || "--"}
          </code>
          {value ? (
            <button
              onClick={() => copyText(value, `Đã sao chép ${label}`)}
              className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-slate-700"
            >
              Sao chép
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  const handleLogout = () => {
    setSessionToken("");
    writeStoredSessionRole("");
    setUser(null);
    setOrders([]);
    setOrdersPage(1);
    setOrderSearchInput("");
    setOrderSearchQuery("");
    storeOrdersSyncRef.current = false;
    supportThreadSyncRef.current = false;
    storeOrdersLoadPromiseRef.current = null;
    catalogLoadPromiseRef.current = null;
    storeOrdersLastLoadedAtRef.current = 0;
    catalogLastLoadedAtRef.current = 0;
    supportThreadLastLoadedAtRef.current = 0;
    storeOrdersReloadQueuedRef.current = false;
    catalogReloadQueuedRef.current = false;
    supportThreadReloadQueuedRef.current = false;
    supportThreadQueuedMarkReadRef.current = false;
    supportThreadQueuedForceRef.current = false;
    setSupportOpen(false);
    setSupportConversation(null);
    setSupportMessages([]);
    setSupportPagination(buildDefaultSupportPaginationState());
    setSupportDraft("");
    setVoucherCodeInput("");
    setVoucherPreview(null);
    setMessage("Đã đăng xuất");
  };

  const authPanel = (
    <div ref={authCardRef} className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))] p-6">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">
            {authMode === "login" ? "Đăng nhập" : "Đăng ký"}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">
            {authMode === "login"
              ? "Tiếp tục để thanh toán và nhận nick"
              : "Tạo tài khoản user để mua tự động"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {authMode === "login"
              ? "Đăng nhập bằng email hoặc số điện thoại để tiếp tục thanh toán trực tuyến."
              : "Điền thông tin một lần để theo dõi đơn hàng và nhận tài khoản ngay trên web."}
          </p>
        </div>

        <div className="mb-5 flex gap-2">
          <button
            onClick={() => {
              setAuthMode("login");
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "login" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Đăng nhập
          </button>
          <button
            onClick={() => {
              setAuthMode("register");
              setShowForgotPassword(false);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "register" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Đăng ký
          </button>
        </div>

        {authMode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Email hoặc SĐT</span>
              <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.identifier} onChange={(event) => setLoginForm((prev) => ({ ...prev, identifier: event.target.value }))} placeholder="Email hoặc SĐT" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Mật khẩu</span>
              <input type="password" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.password} onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mật khẩu" />
            </label>
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60">
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => setShowForgotPassword((prev) => !prev)}
              className="inline-flex items-center gap-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
            >
              {showForgotPassword ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showForgotPassword ? "Ẩn quên mật khẩu" : "Quên mật khẩu?"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {[
              ["fullName", "Họ tên"],
              ["phone", "Số điện thoại (Zalo)"],
              ["email", "Email"],
              ["password", "Mật khẩu"],
            ].map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-sm text-slate-300">{label}</span>
                <input type={key === "password" ? "password" : "text"} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500" value={registerForm[key]} onChange={(event) => setRegisterForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={label} />
              </label>
            ))}
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
              Đăng ký
            </button>
          </form>
        )}

        {authMode === "login" && showForgotPassword ? (
          <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-white">Khôi phục mật khẩu</p>
              <p className="mt-1 text-sm text-slate-400">
                Nhập email để nhận liên kết đặt lại mật khẩu. Phần này chỉ hiện khi bạn cần dùng.
              </p>
            </div>
            <form onSubmit={handleForgotPassword} className="flex flex-col gap-3 sm:flex-row">
              <input
                className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="Nhập email để nhận link đặt lại mật khẩu"
              />
              <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                Gửi email
              </button>
            </form>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck size={18} />
          <h2 className="text-lg font-semibold">Bảo mật & OTP</h2>
        </div>
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>Gói 1: chỉ hiển thị mã đăng nhập 6 số khi cần, không lộ 2FA gốc.</li>
          <li>Gói 2: nhận đầy đủ tài khoản, mật khẩu, 2FA và mã hiện tại tự làm mới.</li>
          <li>Thanh toán xong là có thể xem thông tin tài khoản ngay trên web.</li>
          <li>Nếu cần hỗ trợ thêm, bạn có thể liên hệ admin qua Zalo.</li>
        </ul>
        <div className="mt-6">
          <p className="mb-3 text-sm text-slate-400">Đăng nhập nhanh bằng Google</p>
          <div ref={googleButtonRef} />
          {!config.googleClientId ? (
            <p className="mt-2 text-xs text-slate-500">Chưa cấu hình GOOGLE_CLIENT_ID.</p>
          ) : null}
        </div>
      </div>
    </div>
  );

  const sessionLoadingPanel = (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">
            Đang kiểm tra phiên đăng nhập
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Vui lòng chờ một chút, hệ thống đang khôi phục tài khoản của bạn.
          </p>
        </div>
      </div>
    </div>
  );

  const guestOrdersPanel = (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-slate-400">
      Đăng nhập để xem đơn hàng và nhận thông tin tài khoản.
    </div>
  );

  const packageCards = (
    <div className="grid gap-6 lg:grid-cols-3">
      {config.packages.map((pkg) => (
        <div key={pkg.code} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">{pkg.code.toUpperCase()}</p>
              <h3 className="mt-2 text-xl font-semibold text-white">{pkg.name}</h3>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
              {pkg.code === "package3"
                ? "Liên hệ"
                : pkg.available === null || pkg.available === undefined
                  ? "Đang tải"
                  : `Còn ${pkg.available}`}
            </span>
          </div>
          <p className="mb-4 text-3xl font-bold text-white">{formatMoney(pkg.price)}</p>
          <ul className="mb-6 space-y-2 text-sm text-slate-300">
            {(packageFeatureMap[pkg.code] || []).map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 text-emerald-400" size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {pkg.code === "package3" ? (
            <a href={config.contact?.zaloUrl || "#"} target="_blank" rel="noreferrer" className="block rounded-2xl bg-amber-500 px-4 py-3 text-center font-semibold text-slate-950">
              Liên hệ admin
            </a>
          ) : (
            <>
              <button
                onClick={() => openPaymentPicker(pkg)}
                disabled={
                  sessionLoading ||
                  catalogLoading ||
                  loading ||
                  !!purchaseLoadingCode ||
                  pkg?.available === null ||
                  pkg?.available === undefined ||
                  !pkg?.purchasable
                }
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-semibold text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {String(purchaseLoadingCode || "").startsWith(`${pkg.code}:`) ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Đang tạo...
                  </span>
                ) : sessionLoading ? (
                  "Đang kiểm tra..."
                ) : catalogLoading || pkg?.available === null || pkg?.available === undefined ? (
                  "Đang tải kho..."
                ) : !user ? (
                  "Thanh toán"
                ) : pkg.purchasable ? (
                  "Thanh toán"
                ) : (
                  "Tạm hết hàng"
                )}
              </button>
              <div className="mt-3 space-y-2 text-sm leading-5 text-slate-400">
                <p>{getUnifiedPurchaseHint(pkg)}</p>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const renderPackage1Order = (order) => {
    const latestWarrantyRound = getLatestWarrantyRound(order);
    const otp = otpResults[order.id] || {};
    const otpSecondsLeft = getOtpSecondsRemaining(otp, otpNowMs);
    const package1OtpExpired = Boolean(otp.code) && otpSecondsLeft <= 0;
    const package1OtpDisplay = otpSecondsLeft > 0 ? otp.code || "------" : "------";
    const package1OtpStatusText = otpSecondsLeft > 0
      ? `Mã hết hạn sau ${otpSecondsLeft}s`
      : package1OtpExpired
        ? "Mã đã hết hạn"
        : "Bấm Lấy mã để hiện mã đăng nhập";
    const package1LoginSteps = [
      "Vào ChatGPT và chọn Đăng nhập bằng Email.",
      "Nhập tài khoản và mật khẩu ở trên.",
      "Khi ChatGPT yêu cầu mã xác minh, bấm Lấy mã đăng nhập trên web này.",
      "Nhập 6 số vừa hiện trong vòng 30 giây để hoàn tất đăng nhập.",
    ];
    const package1Note = `Tài khoản share không cấp 2FA gốc. Đơn này còn ${Math.max(0, Number(order.package1UsageLeft || 0))} lượt lấy mã trên web.`;
    return (
      <div className="mt-3">
        {latestWarrantyRound ? (
          <div className="mb-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
            <p className="font-semibold text-amber-200">
              Tài khoản này đã được bảo hành sang acc mới.
            </p>
            <p className="mt-1 leading-5 text-amber-100/90">
              Đổi từ <span className="font-semibold">{latestWarrantyRound.fromUsername || "--"}</span> sang{" "}
              <span className="font-semibold">{latestWarrantyRound.toUsername || order.assignedUsername || "--"}</span>
              {latestWarrantyRound.createdAt ? ` lúc ${formatDateTime(latestWarrantyRound.createdAt)}` : ""}.
            </p>
            <p className="mt-1 leading-5 text-amber-100/80">
              Hạn sử dụng vẫn giữ đến{" "}
              <span className="font-semibold">{formatDateTime(order.assignedCustomerExpiredAt)}</span>, không reset lại như đơn mua mới.
            </p>
          </div>
        ) : null}
        {renderOrderCredentialRows([
          ["Tài khoản", order.assignedUsername],
          ["Mật khẩu", order.assignedPassword],
        ])}
        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/75 p-3">
          <div className="flex flex-wrap items-center gap-2">
          {otpSecondsLeft > 0 ? (
            <button
              onClick={() => copyText(package1OtpDisplay, "Đã sao chép mã đăng nhập")}
              className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              Sao chép mã
            </button>
          ) : (
            <button onClick={() => handleGeneratePackage1Code(order)} disabled={loading || order.package1UsageLeft <= 0} className="rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">
              {order.package1UsageLeft > 0 ? "Lấy mã đăng nhập" : "Đã hết lượt"}
            </button>
          )}
            <div className={`rounded-xl px-3 py-2 text-lg font-bold tracking-[0.28em] ${otpSecondsLeft > 0 ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border border-slate-700 bg-slate-900 text-slate-500"}`}>
              {package1OtpDisplay}
            </div>
            <span className={`text-xs ${package1OtpExpired ? "text-amber-300" : "text-slate-400"}`}>
              {package1OtpStatusText}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Còn {Math.max(0, Number(order.package1UsageLeft || 0))} lượt lấy mã đăng nhập.
          </p>
        </div>
        {renderOrderLoginGuide(package1LoginSteps, package1Note)}
      </div>
    );
  };

  const renderPackage2Order = (order) => {
    const latestWarrantyRound = getLatestWarrantyRound(order);
    const otp = otpResults[order.id] || { code: "------", expiresIn: 0 };
    const otpSecondsLeft = getOtpSecondsRemaining(otp, otpNowMs);
    const package2OtpExpired = Boolean(otp.code) && otpSecondsLeft <= 0;
    const package2OtpDisplay = otpSecondsLeft > 0 ? otp.code || "------" : "------";
    const package2OtpStatusText = otpSecondsLeft > 0
      ? `Mã hết hạn sau ${otpSecondsLeft}s`
      : package2OtpExpired
        ? "Mã đã hết hạn, bấm lấy mã mới"
        : "Bấm Lấy mã 2FA để hiện mã xác minh";
    const package2LoginSteps = [
      "Vào ChatGPT và chọn Đăng nhập bằng Email.",
      "Nhập tài khoản và mật khẩu ở trên.",
      "Khi hệ thống yêu cầu xác minh, bấm Lấy mã 2FA trên web này hoặc dùng mã 2FA ở trên.",
      "Nhập mã 6 số vừa lấy để hoàn tất đăng nhập. Nếu mã hết hạn, bấm lấy mã mới.",
    ];
    const package2Note =
      "Gói 2 chỉ lấy mã khi bạn bấm, không còn tự làm mới liên tục để tiết kiệm tài nguyên.";
    return (
      <div className="mt-3">
        {latestWarrantyRound ? (
          <div className="mb-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
            <p className="font-semibold text-amber-200">
              Tài khoản này đã được bảo hành sang acc mới.
            </p>
            <p className="mt-1 leading-5 text-amber-100/90">
              Đổi từ <span className="font-semibold">{latestWarrantyRound.fromUsername || "--"}</span> sang{" "}
              <span className="font-semibold">{latestWarrantyRound.toUsername || order.assignedUsername || "--"}</span>
              {latestWarrantyRound.createdAt ? ` lúc ${formatDateTime(latestWarrantyRound.createdAt)}` : ""}.
            </p>
            <p className="mt-1 leading-5 text-amber-100/80">
              Hạn sử dụng vẫn giữ đến{" "}
              <span className="font-semibold">{formatDateTime(order.assignedCustomerExpiredAt)}</span>, không reset lại như đơn mua mới.
            </p>
          </div>
        ) : null}
        {renderOrderCredentialRows([
          ["Tài khoản", order.assignedUsername],
          ["Mật khẩu", order.assignedPassword],
          ["Mã 2FA", order.assignedOtpSecret],
        ])}
        <div className="mt-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                copyText(
                  buildQuickCopyPayload({
                    username: order.assignedUsername,
                    password: order.assignedPassword,
                    otpSecret: order.assignedOtpSecret,
                    otpCode: package2OtpDisplay !== "------" ? package2OtpDisplay : "",
                  }),
                  "Đã sao chép nhanh thông tin tài khoản",
                )
              }
              className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              Copy nhanh
            </button>
            {otpSecondsLeft > 0 ? (
              <button
                onClick={() => copyText(package2OtpDisplay, "Đã sao chép mã 2FA")}
                className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
              >
                Sao chép mã
              </button>
            ) : (
              <button
                onClick={() => handleGeneratePackage2Code(order)}
                disabled={package2OtpLoadingOrderId === order.id}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-60"
              >
                {package2OtpLoadingOrderId === order.id ? <Loader2 size={14} className="animate-spin" /> : null}
                {package2OtpLoadingOrderId === order.id ? "Đang lấy mã..." : "Lấy mã 2FA"}
              </button>
            )}
            <div className={`rounded-xl px-3 py-2 text-lg font-bold tracking-[0.28em] ${otpSecondsLeft > 0 ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border border-slate-700 bg-slate-900 text-slate-500"}`}>
              {package2OtpDisplay}
            </div>
            <span className="text-xs text-slate-400">
              {package2OtpStatusText}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Khi cần mã đăng nhập 6 số, bấm Lấy mã 2FA. Secret 2FA gốc vẫn nằm ở trên để bạn dùng thủ công nếu muốn.
          </p>
        </div>
        {renderOrderLoginGuide(package2LoginSteps, package2Note)}
      </div>
    );
  };

  const sortedOrders = useMemo(() => {
    const nextOrders = Array.isArray(orders) ? [...orders] : [];
    return nextOrders.sort((left, right) => {
      const timeDiff = getOrderSortTimestamp(right) - getOrderSortTimestamp(left);
      if (timeDiff !== 0) return timeDiff;
      return String(right?.id || "").localeCompare(String(left?.id || ""), "vi");
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = String(orderSearchQuery || "").trim().toLowerCase();
    if (!normalizedQuery) return sortedOrders;
    return sortedOrders.filter((order) => {
      const haystack = [
        order?.id,
        order?.packageName,
        order?.packageCode,
        order?.assignedUsername,
        ...getWarrantySearchTerms(order),
        order?.paymentOrderId,
        order?.momoOrderId,
        order?.voucherCode,
        order?.paymentStatusText,
        order?.momoMessage,
        order?.fulfillmentReason,
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .join(" ");
      return haystack.includes(normalizedQuery);
    });
  }, [orderSearchQuery, sortedOrders]);

  const totalOrderPages = Math.max(
    1,
    Math.ceil(filteredOrders.length / STORE_ORDERS_PER_PAGE),
  );
  const orderPageStart = filteredOrders.length
    ? (ordersPage - 1) * STORE_ORDERS_PER_PAGE + 1
    : 0;
  const orderPageEnd = filteredOrders.length
    ? Math.min(filteredOrders.length, ordersPage * STORE_ORDERS_PER_PAGE)
    : 0;
  const visibleOrders = useMemo(() => {
    const pageStartIndex = Math.max(0, (ordersPage - 1) * STORE_ORDERS_PER_PAGE);
    return filteredOrders.slice(
      pageStartIndex,
      pageStartIndex + STORE_ORDERS_PER_PAGE,
    );
  }, [filteredOrders, ordersPage]);

  useEffect(() => {
    setOrdersPage((currentPage) => Math.min(Math.max(currentPage, 1), totalOrderPages));
  }, [totalOrderPages]);

  useEffect(() => {
    setOrdersPage(1);
  }, [user?.id]);

  useEffect(() => {
    setOrdersPage(1);
  }, [orderSearchQuery]);

  const handleOrderPageChange = (nextPage) => {
    const normalizedNextPage = Math.min(
      totalOrderPages,
      Math.max(1, Number(nextPage || 1)),
    );
    if (normalizedNextPage === ordersPage) return;
    setOrdersPage(normalizedNextPage);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        ordersSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  };

  const handleOrderSearchSubmit = (event) => {
    event.preventDefault();
    setOrderSearchQuery(String(orderSearchInput || "").trim());
  };

  const orderCards = (
    <div className="space-y-4">
      {filteredOrders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-slate-400">
          {orderSearchQuery
            ? `Không tìm thấy đơn nào với từ khóa "${orderSearchQuery}".`
            : "Chưa có đơn hàng nào."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-200">
              Tổng {filteredOrders.length} đơn
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-200">
              {orderPageStart}-{orderPageEnd}/{filteredOrders.length}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-slate-200">
              Trang {ordersPage}/{totalOrderPages}
            </span>
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-200">
              5 đơn gần nhất / trang
            </span>
            {orderSearchQuery ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                Tìm: {orderSearchQuery}
              </span>
            ) : null}
          </div>

          {visibleOrders.map((order) => {
            const paymentLabel =
              order.paymentMethodLabel || getPaymentMethodLabel(order.paymentMethod);
            const pendingPayment = isPendingStorePayment(order.status);
            const isFulfilled =
              String(order.status || "").trim().toLowerCase() === "fulfilled";
            const paymentStatusText =
              String(order.paymentStatusText || order.momoMessage || "").trim() ||
              formatStatusLabel(order.status);
            const fulfillmentReason = String(order.fulfillmentReason || "").trim();
            const latestWarrantyRound = getLatestWarrantyRound(order);

            return (
              <div key={order.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{order.packageName}</h3>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getOrderStatusClass(order.status)}`}
                      >
                        {formatStatusLabel(order.status)}
                      </span>
                      {Number(order.warrantyCount || 0) > 0 ? (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                          Đã bảo hành {Number(order.warrantyCount || 0)} lần
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-slate-500">Đơn #{order.id}</p>
                    {latestWarrantyRound ? (
                      <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                        <div className="font-semibold text-amber-200">
                          Acc hiện tại sau bảo hành:
                          {" "}
                          <span className="text-white">
                            {latestWarrantyRound.toUsername || order.assignedUsername || "--"}
                          </span>
                        </div>
                        <div className="mt-1 text-amber-100/90">
                          Đổi từ{" "}
                          <span className="font-semibold text-white">
                            {latestWarrantyRound.fromUsername || "--"}
                          </span>
                          {" "}sang{" "}
                          <span className="font-semibold text-white">
                            {latestWarrantyRound.toUsername || order.assignedUsername || "--"}
                          </span>
                          {latestWarrantyRound.createdAt
                            ? ` lúc ${formatCompactDateTime(latestWarrantyRound.createdAt)}`
                            : ""}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-100">
                        {formatMoney(order.amount)}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                        {paymentLabel}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2.5 py-1 text-slate-300">
                        {formatCompactDateTime(order.createdAt)}
                      </span>
                      {order.voucherCode ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                          <Gift size={11} />
                          {order.voucherCode}
                          {order.discountAmount > 0
                            ? ` • -${formatMoney(order.discountAmount)}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {pendingPayment ? (
                  <div className="mt-3 rounded-2xl border border-amber-500/15 bg-amber-500/5 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-amber-100">
                          Nick đang được giữ riêng đến{" "}
                          {order.expiresAt ? formatCompactDateTime(order.expiresAt) : "--"}.
                        </p>
                        <p className="mt-1 break-all text-xs text-slate-400">
                          {order.paymentOrderId || order.momoOrderId || "--"} • {paymentStatusText}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleReconcileOrderPayment(order.id)}
                          disabled={loading}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {reconcileLoadingOrderId === order.id ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2 size={12} className="animate-spin" />
                              Đang kiểm tra
                            </span>
                          ) : (
                            "Kiểm tra"
                          )}
                        </button>
                        {order.paymentUrl ? (
                          <a
                            href={order.paymentUrl}
                            className="inline-flex items-center justify-center rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500"
                          >
                            Tiếp tục thanh toán
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {String(order.paymentMethod || "").trim().toLowerCase() ===
                    STORE_PAYMENT_METHOD_PAYOS &&
                    String(order.paymentQrCode || "").trim() ? (
                      <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
                          <div className="rounded-2xl bg-white p-2.5 shadow-lg shadow-slate-950/20">
                            <img
                              src={buildQrImageUrl(order.paymentQrCode, 220)}
                              alt={`QR thanh toán ${order.id}`}
                              className="h-24 w-24 rounded-xl object-contain sm:h-28 sm:w-28"
                            />
                          </div>
                          <div className="min-w-0 flex-1 text-center sm:text-left">
                            <p className="text-sm font-semibold text-cyan-300">
                              Quét QR để thanh toán
                            </p>
                            <p className="mt-1 text-xs text-slate-300">
                              Dùng app ngân hàng để quét mã và hoàn tất đơn.
                            </p>
                            {order.paymentUrl ? (
                              <a
                                href={order.paymentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex items-center justify-center rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-700"
                              >
                                Mở ngân hàng
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!pendingPayment && !isFulfilled ? (
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/75 p-3 text-xs text-slate-300">
                    <p>{paymentStatusText}</p>
                    {fulfillmentReason ? (
                      <p className="mt-1 leading-5 text-rose-200">
                        Lý do: {fulfillmentReason}
                      </p>
                    ) : null}
                    {(order.paymentOrderId || order.momoOrderId) ? (
                      <p className="mt-1 break-all text-slate-500">
                        Mã thanh toán: {order.paymentOrderId || order.momoOrderId}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {order.packageCode === "package1" && isFulfilled ? renderPackage1Order(order) : null}
                {order.packageCode === "package2" && isFulfilled ? renderPackage2Order(order) : null}
              </div>
            );
          })}

          {totalOrderPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2.5">
              <p className="text-xs text-slate-400">
                Đang hiện {orderPageStart}-{orderPageEnd} / {filteredOrders.length} đơn
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOrderPageChange(ordersPage - 1)}
                  disabled={ordersPage <= 1}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Trang trước
                </button>
                <button
                  type="button"
                  onClick={() => handleOrderPageChange(ordersPage + 1)}
                  disabled={ordersPage >= totalOrderPages}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Trang sau
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const supportRetentionDays = Math.max(
    1,
    Number(
      supportPagination?.retentionDays || DEFAULT_SUPPORT_RETENTION_DAYS,
    ),
  );
  const supportAdminSeenClass =
    !supportConversation?.id
      ? "border-slate-700 bg-slate-900/85 text-slate-300"
      : supportConversation?.adminHasSeenLatest
        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
        : "border-amber-400/25 bg-amber-500/10 text-amber-100";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(6,182,212,0.18),_transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))] p-6 shadow-2xl shadow-slate-950/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.4em] text-cyan-400">ChatGPT Store</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Mua ChatGPT tự động</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Đăng ký hoặc đăng nhập để thanh toán và nhận tài khoản ngay trên web.
              </p>
            </div>
            <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <a
                href="/hotmail-reader"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 sm:w-auto"
              >
                <Mail size={16} />
                Đọc mail nhanh
              </a>
              {user ? (
                <button onClick={handleLogout} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-800 px-4 py-2.5 text-sm text-slate-100 sm:w-auto">
                  <LogOut size={16} />
                  Đăng xuất
                </button>
              ) : null}
            </div>
          </div>
          {user ? (
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-200">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5">
                <User className="text-cyan-400" size={14} />
                <span className="max-w-[180px] truncate font-semibold">{user.fullName}</span>
              </div>
              {user.phone ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5">
                  <Phone className="text-cyan-400" size={14} />
                  <span className="font-medium">{user.phone}</span>
                </div>
              ) : null}
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5">
                <Mail className="text-cyan-400" size={14} />
                <span className="max-w-[220px] truncate font-medium">{user.email}</span>
              </div>
            </div>
          ) : null}
        </header>

        {message ? <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
        {error ? <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        {route.view === "reset-password" ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="text-2xl font-semibold text-white">Đặt lại mật khẩu</h2>
            <p className="mt-2 text-sm text-slate-400">Nhập mật khẩu mới cho tài khoản của bạn.</p>
            <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
              <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Mật khẩu mới" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" />
              <div className="flex gap-3">
                <button type="button" onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="flex-1 rounded-2xl bg-slate-800 px-4 py-3 text-slate-200">Quay lại</button>
                <button type="submit" disabled={loading} className="flex-1 rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white disabled:opacity-60">Đặt lại mật khẩu</button>
              </div>
            </form>
          </section>
        ) : (
          <>
            {sessionLoading ? sessionLoadingPanel : !user ? authPanel : null}
            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Gói dịch vụ</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Gói 1 / Gói 2 mua tự động, Gói 3 liên hệ admin</h2>
                </div>
                {route.view === "payment-result" ? (
                  <button onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="rounded-2xl bg-slate-800 px-4 py-3 text-sm text-slate-100">Về trang mua hàng</button>
                ) : null}
              </div>
              {packageCards}
              <p className="mt-4 text-sm font-medium text-slate-300">
                Cam kết: Giá tốt - Hỗ trợ nhanh - Uy tín lâu dài
              </p>
            </section>

            <section ref={ordersSectionRef} className="mt-10 grid gap-8 xl:grid-cols-[1.4fr,0.8fr]">
              <div>
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Đơn hàng</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Tài khoản đã mua</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Đơn mới nhất hiển thị trước, 5 đơn mỗi trang.
                  </p>
                </div>
                {user ? (
                  <form
                    onSubmit={handleOrderSearchSubmit}
                    className="mb-4 flex flex-col gap-2 sm:flex-row"
                  >
                    <label className="relative flex-1">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                      <input
                        type="text"
                        value={orderSearchInput}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setOrderSearchInput(nextValue);
                          if (!String(nextValue || "").trim()) {
                            setOrderSearchQuery("");
                          }
                        }}
                        placeholder="Tìm theo mã đơn, tài khoản, mã thanh toán..."
                        className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 py-2.5 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-500"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
                      >
                        <Search size={15} />
                        Tìm
                      </button>
                      {orderSearchQuery ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOrderSearchInput("");
                            setOrderSearchQuery("");
                          }}
                          className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                        >
                          Xóa
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
                {user ? orderCards : sessionLoading ? sessionLoadingPanel : guestOrdersPanel}
                {route.view === "payment-result" ? (
                  <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                    <h3 className="text-lg font-semibold text-white">Kết quả thanh toán</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {currentPaymentOrder ? `Đơn #${currentPaymentOrder.id} đang ở trạng thái: ${formatStatusLabel(currentPaymentOrder.status)}` : "Đang tải thông tin đơn hàng..."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                  <h3 className="text-lg font-semibold text-white">Hướng dẫn nhanh</h3>
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <li>1. Chọn gói phù hợp và bấm Thanh toán.</li>
                    <li>2. Chọn MoMo hoặc Ngân hàng.</li>
                    <li>3. Thanh toán xong, tài khoản sẽ hiện ngay tại đây.</li>
                    <li>4. Gói 1 dùng nút Lấy mã để nhận mã đăng nhập.</li>
                  </ol>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4">
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-white sm:text-base">
                      Liên hệ admin
                    </h3>
                    <div className="grid gap-2 sm:min-w-[19rem] sm:grid-cols-2">
                      <a
                        href={config.contact?.zaloUrl || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-sky-500"
                      >
                        <Phone size={15} />
                        Zalo admin
                      </a>
                      <button
                        type="button"
                        onClick={openSupportPanel}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-500"
                      >
                        <MessageCircle size={15} />
                        Chat web
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      {route.view !== "reset-password" ? (
        <div className="pointer-events-none fixed bottom-3 right-3 z-40 flex max-w-[calc(100vw-0.75rem)] flex-col items-end gap-2">
          {supportOpen ? (
            <>
              <button
                type="button"
                aria-label="Đóng chat web"
                onClick={() => setSupportOpen(false)}
                className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm sm:hidden"
              />
              <div className="pointer-events-auto fixed inset-x-2 bottom-2 top-20 flex flex-col overflow-hidden rounded-[22px] border border-slate-800 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.1),_transparent_34%),linear-gradient(180deg,rgba(2,6,23,0.98),rgba(2,6,23,0.95))] shadow-[0_24px_60px_rgba(2,6,23,0.58)] sm:inset-auto sm:bottom-16 sm:right-3 sm:top-auto sm:h-[min(56vh,28rem)] sm:w-[min(17rem,calc(100vw-1rem))]">
                <div className="shrink-0 border-b border-slate-800/80 bg-[linear-gradient(135deg,#0891b2,#2563eb)] px-2.5 py-2 text-white sm:px-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black">
                        Hỗ trợ nhanh
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSupportOpen(false)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-cyan-50/85">
                    <span className={`rounded-full border px-2 py-0.5 ${supportAdminSeenClass}`}>
                      {supportConversation?.id
                        ? supportConversation?.adminHasSeenLatest
                          ? "Đã xem"
                          : "Chưa xem"
                        : "Chưa có chat"}
                    </span>
                    <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
                      Lưu {supportRetentionDays} ngày
                    </span>
                  </div>
                </div>

                <div
                  ref={supportMessagesViewportRef}
                  onScroll={(event) => {
                    if (event.currentTarget.scrollTop > 56) return;
                    if (
                      supportPagination.loadingOlder ||
                      !supportPagination.hasMore ||
                      !supportPagination.nextCursor
                    ) {
                      return;
                    }
                    loadOlderSupportMessages().catch(() => {});
                  }}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-2.5"
                >
                  <div className="flex min-h-full flex-col gap-1.5">
                    {supportPagination.hasMore ? (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={() => loadOlderSupportMessages()}
                          disabled={supportPagination.loadingOlder}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-[10px] font-medium text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-60"
                        >
                          {supportPagination.loadingOlder ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <ChevronUp size={13} />
                          )}
                          {supportPagination.loadingOlder
                            ? "Đang tải..."
                            : "Xem cũ hơn"}
                        </button>
                      </div>
                    ) : null}

                    {supportPagination?.retainedAfter ? (
                      <div className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-100">
                        Chỉ lưu {Math.max(1, Number(supportPagination?.retentionDays || DEFAULT_SUPPORT_RETENTION_DAYS))} ngày.
                      </div>
                    ) : null}

                    {supportLoading ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-4 text-sm text-slate-400">
                        <Loader2 size={16} className="animate-spin" />
                        Đang tải hội thoại...
                      </div>
                    ) : supportMessages.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-10 text-sm text-slate-400">
                        Chưa có tin nhắn nào. Bạn có thể nhắn nội dung cần hỗ trợ ở ô bên dưới.
                      </div>
                    ) : (
                      <div className="mt-auto space-y-1.5">
                        {supportMessages.map((chatMessage, index) => {
                          const previousMessage = supportMessages[index - 1] || null;
                          const fromAdmin =
                            String(chatMessage.senderRole || "").trim() === "admin";
                          const shouldRenderDayDivider =
                            !previousMessage ||
                            !isSameSupportDay(
                              previousMessage?.createdAt,
                              chatMessage?.createdAt,
                            );
                          return (
                            <div key={chatMessage.id}>
                              {shouldRenderDayDivider ? (
                                <div className="mb-3 flex justify-center">
                                  <div className="rounded-full border border-slate-700 bg-slate-900/85 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-slate-400">
                                    {formatSupportDayLabel(chatMessage.createdAt)}
                                  </div>
                                </div>
                              ) : null}
                              <div
                                className={`flex ${
                                  fromAdmin ? "justify-start" : "justify-end"
                                }`}
                              >
                                <div
                                  className={`max-w-[84%] rounded-[16px] px-2.5 py-2 text-[12px] leading-5 shadow-[0_10px_18px_rgba(2,6,23,0.16)] sm:max-w-[76%] ${
                                    fromAdmin
                                      ? "border border-slate-700 bg-slate-900 text-slate-100"
                                      : "bg-cyan-600 text-white"
                                  }`}
                                >
                                  <div
                                    className={`mb-1 text-[9px] font-medium uppercase tracking-[0.08em] ${
                                      fromAdmin ? "text-slate-400" : "text-cyan-100"
                                    }`}
                                  >
                                    {fromAdmin ? "Admin" : "Bạn"} • {formatSupportMessageTime(chatMessage.createdAt)}
                                  </div>
                                  <div className="whitespace-pre-wrap break-words">
                                    {chatMessage.body}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={handleSendSupportMessage}
                  className="shrink-0 border-t border-slate-800/80 bg-slate-950/92 px-2 pb-2 pt-2 sm:px-2.5"
                >
                  <div className="relative rounded-[18px] border border-slate-700/80 bg-white/[0.035] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <textarea
                      ref={supportDraftInputRef}
                      value={supportDraft}
                      onChange={(event) => setSupportDraft(event.target.value)}
                      rows={1}
                      placeholder="Nhập tin nhắn..."
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          supportDraft.trim() &&
                          !supportSending
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className="min-h-[36px] max-h-[88px] w-full resize-none bg-transparent py-1 pl-1 pr-11 text-[12px] leading-5 text-white outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="submit"
                      disabled={supportSending || !supportDraft.trim()}
                      className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0891b2,#2563eb)] text-white shadow-[0_12px_24px_rgba(37,99,235,0.28)] transition-all hover:translate-y-[-1px] hover:shadow-[0_16px_28px_rgba(37,99,235,0.34)] disabled:cursor-not-allowed disabled:opacity-60"
                      title="Gửi tin nhắn"
                    >
                      {supportSending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <SendHorizontal size={14} />
                      )}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 px-1 text-[9px] text-slate-500">
                    <span className="rounded-full border border-slate-700 bg-slate-900/85 px-1.5 py-0.5">
                      {supportDraft.trim().length} ký tự
                    </span>
                    <span className="hidden sm:inline">Enter để gửi, Shift+Enter xuống dòng</span>
                  </div>
                </form>
              </div>
            </>
          ) : null}

          {!supportOpen ? (
            <button
              type="button"
              onClick={() => {
                openSupportPanel().catch(() => {});
              }}
              className="pointer-events-auto relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4f46e5,#2563eb)] text-white shadow-[0_18px_36px_rgba(37,99,235,0.32)] transition hover:translate-y-[-1px] hover:shadow-[0_22px_44px_rgba(37,99,235,0.4)]"
            >
              {Math.max(0, Number(supportConversation?.unreadCount || 0)) > 0 ? (
                <span className="absolute -left-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white ring-4 ring-slate-950">
                  {Math.min(99, Math.max(0, Number(supportConversation?.unreadCount || 0)))}
                </span>
              ) : null}
              <MessageCircle size={20} />
            </button>
          ) : null}
        </div>
      ) : null}
      {paymentPickerPackage ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 px-2 py-3 backdrop-blur-sm sm:px-4">
          <div className="flex min-h-full items-start justify-center sm:items-center">
          <div className="w-full max-w-xl rounded-[2rem] border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">
                  Chọn thanh toán
                </p>
                <h3 className="mt-2 text-2xl font-bold text-white">
                  {paymentPickerPackage.name}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">Chọn MoMo hoặc Ngân hàng.</p>
              </div>
              <button
                type="button"
                onClick={closePaymentPicker}
                className="rounded-full bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                Đóng
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[STORE_PAYMENT_METHOD_MOMO, STORE_PAYMENT_METHOD_PAYOS].map(
                (paymentMethod) => {
                  const methodKey = `${paymentPickerPackage.code}:${paymentMethod}`;
                  const configured = isPaymentMethodConfigured(paymentMethod);
                  const blockedReason = getPurchaseBlockedReason(
                    paymentPickerPackage,
                    paymentMethod,
                  );
                  return (
                    <div
                      key={paymentMethod}
                      className={`rounded-3xl border p-4 ${
                        configured
                          ? "border-slate-700 bg-slate-950/70"
                          : "border-amber-500/20 bg-amber-500/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="mt-2 text-xl font-semibold text-white">
                            {getStoreCheckoutMethodLabel(paymentMethod)}
                          </h4>
                        </div>
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                          {configured ? "Sẵn sàng" : "Chưa bật"}
                        </span>
                      </div>
                      <p className="mt-3 min-h-10 text-sm leading-6 text-slate-300">
                        {paymentMethod === STORE_PAYMENT_METHOD_PAYOS
                          ? "Quét mã hoặc mở app ngân hàng."
                          : "Mở MoMo để thanh toán."}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handlePurchaseButtonClick(
                            paymentPickerPackage,
                            paymentMethod,
                          )
                        }
                        disabled={
                          sessionLoading ||
                          catalogLoading ||
                          loading ||
                          !!purchaseLoadingCode ||
                          !configured ||
                          paymentPickerPackage?.available === null ||
                          paymentPickerPackage?.available === undefined ||
                          !paymentPickerPackage?.purchasable
                        }
                        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-semibold text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {purchaseLoadingCode === methodKey ? (
                          <span className="inline-flex items-center justify-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            Đang tạo...
                          </span>
                        ) : (
                          `Chọn ${getStoreCheckoutMethodLabel(
                            paymentMethod,
                          )}`
                        )}
                      </button>
                      {!configured ? (
                        <p className="mt-3 text-xs leading-5 text-slate-400">{blockedReason}</p>
                      ) : null}
                    </div>
                  );
                },
              )}
            </div>

            <div className="mt-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">
                    Voucher
                  </p>
                  <h4 className="mt-2 text-lg font-semibold text-white">
                    Giảm giá trước khi thanh toán
                  </h4>
                  <p className="mt-1 text-sm text-slate-300">
                    Nhập mã giảm giá nếu bạn có voucher từ admin.
                  </p>
                </div>
                {voucherPreview?.code ? (
                  <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                    {voucherPreview.code} • {getVoucherTypeLabel(voucherPreview.type, voucherPreview.value)}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={voucherCodeInput}
                  onChange={(event) => {
                    const nextCode = event.target.value;
                    setVoucherCodeInput(nextCode);
                    if (
                      !nextCode.trim() ||
                      String(voucherPreview?.code || "").trim().toUpperCase() !==
                        nextCode.trim().toUpperCase()
                    ) {
                      setVoucherPreview(null);
                    }
                  }}
                  placeholder="VD: GIAM50K"
                  className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleValidateVoucher({
                      code: voucherCodeInput,
                      packageCode: paymentPickerPackage.code,
                    })
                  }
                  disabled={voucherLoading || !voucherCodeInput.trim()}
                  className="rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {voucherLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Đang kiểm tra
                    </span>
                  ) : (
                    "Áp voucher"
                  )}
                </button>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-950/70 p-3">
                  <p className="text-slate-500">Giá gốc</p>
                  <p className="mt-1 font-semibold text-white">
                    {formatMoney(voucherPreview?.originalAmount ?? paymentPickerPackage.price)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950/70 p-3">
                  <p className="text-slate-500">Giảm giá</p>
                  <p className="mt-1 font-semibold text-emerald-300">
                    {formatMoney(voucherPreview?.discountAmount || 0)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-950/70 p-3">
                  <p className="text-slate-500">Cần thanh toán</p>
                  <p className="mt-1 font-semibold text-white">
                    {formatMoney(voucherPreview?.finalAmount ?? paymentPickerPackage.price)}
                  </p>
                </div>
              </div>
              {voucherCodeInput.trim() && !voucherPreview ? (
                <p className="mt-3 text-xs text-slate-400">
                  Nếu mã hợp lệ, hệ thống sẽ tự áp lúc bấm thanh toán.
                </p>
              ) : null}
            </div>

            {paymentPreviewOrder ? (
              <div className="mt-4 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">
                      Thanh toán hiện tại
                    </p>
                    <h4 className="mt-2 text-lg font-semibold text-white sm:text-xl">
                      {paymentPreviewOrder.packageName}
                    </h4>
                    <p className="mt-2 text-sm text-slate-300">
                      {paymentPreviewOrder.paymentMethodLabel || getPaymentMethodLabel(paymentPreviewOrder.paymentMethod)} • {formatStatusLabel(paymentPreviewOrder.status)}
                    </p>
                    {paymentPreviewOrder.voucherCode ? (
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                        <Gift size={14} />
                        {paymentPreviewOrder.voucherCode} • giảm {formatMoney(paymentPreviewOrder.discountAmount)}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReconcileOrderPayment(paymentPreviewOrder.id)}
                    disabled={loading}
                    className="rounded-2xl bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {reconcileLoadingOrderId === paymentPreviewOrder.id ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        Đang kiểm tra...
                      </span>
                    ) : (
                      "Kiểm tra thanh toán"
                    )}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                  <div className="min-w-0 rounded-2xl bg-slate-950/70 p-3">
                    <p className="text-slate-500">Mã thanh toán</p>
                    <p className="mt-1 break-all font-semibold leading-6 text-white">
                      {paymentPreviewOrder.paymentOrderId || "--"}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-2xl bg-slate-950/70 p-3">
                    <p className="text-slate-500">Giá tiền</p>
                    <p className="mt-1 font-semibold text-white">
                      {formatMoney(paymentPreviewOrder.amount)}
                    </p>
                    {paymentPreviewOrder.discountAmount > 0 ? (
                      <p className="mt-1 text-xs text-emerald-300">
                        Gốc {formatMoney(paymentPreviewOrder.originalAmount)} • giảm {formatMoney(paymentPreviewOrder.discountAmount)}
                      </p>
                    ) : null}
                  </div>
                  <div className="min-w-0 rounded-2xl bg-slate-950/70 p-3">
                    <p className="text-slate-500">Hạn thanh toán</p>
                    <p className="mt-1 break-words font-semibold leading-6 text-white">
                      {paymentPreviewOrder.expiresAt
                        ? formatDateTime(paymentPreviewOrder.expiresAt)
                        : "--"}
                    </p>
                  </div>
                </div>

                {isPendingStorePayment(paymentPreviewOrder.status) &&
                String(paymentPreviewOrder.paymentMethod || "").trim().toLowerCase() ===
                  STORE_PAYMENT_METHOD_PAYOS ? (
                  <div className="mt-4 rounded-2xl border border-cyan-500/10 bg-slate-950/30 p-3">
                    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-4">
                    {String(paymentPreviewOrder.paymentQrCode || "").trim() ? (
                      <div className="rounded-2xl bg-white p-3 shadow-lg shadow-slate-950/20">
                        <img
                          src={buildQrImageUrl(paymentPreviewOrder.paymentQrCode, 240)}
                          alt={`QR thanh toán ${paymentPreviewOrder.id}`}
                          className="h-28 w-28 rounded-xl object-contain sm:h-36 sm:w-36"
                        />
                      </div>
                    ) : null}
                    <div className="w-full min-w-0 flex-1 space-y-3 text-center sm:min-w-[220px] sm:text-left">
                      <div>
                        <p className="text-sm font-semibold text-cyan-300">Quét QR thanh toán</p>
                        <p className="mt-1 text-sm text-slate-300">
                          Quét mã bằng app ngân hàng.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-1">
                        {paymentPreviewOrder.paymentUrl ? (
                          <a
                            href={paymentPreviewOrder.paymentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-2xl bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-slate-100 hover:bg-slate-700"
                          >
                            Mở ngân hàng
                          </a>
                        ) : null}
                      </div>
                    </div>
                    </div>
                  </div>
                ) : isPendingStorePayment(paymentPreviewOrder.status) ? (
                  <div className="mt-4 rounded-2xl border border-cyan-500/10 bg-slate-950/30 p-3">
                    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-4">
                    {String(paymentPreviewOrder.momoQrCodeUrl || "").trim() ? (
                      <div className="rounded-2xl bg-white p-3 shadow-lg shadow-slate-950/20">
                        <img
                          src={paymentPreviewOrder.momoQrCodeUrl}
                          alt={`QR MoMo ${paymentPreviewOrder.id}`}
                          className="h-28 w-28 rounded-xl object-contain sm:h-36 sm:w-36"
                        />
                      </div>
                    ) : null}
                    <div className="w-full min-w-0 flex-1 space-y-3 text-center sm:min-w-[220px] sm:text-left">
                      <div>
                        <p className="text-sm font-semibold text-cyan-300">Thanh toán MoMo</p>
                        <p className="mt-1 text-sm text-slate-300">
                          {String(paymentPreviewOrder.momoQrCodeUrl || "").trim()
                            ? "Quét mã hoặc mở app MoMo để thanh toán."
                            : "Bấm mở MoMo để hoàn tất thanh toán."}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-1">
                        {paymentPreviewOrder.momoDeepLink ? (
                          <a
                            href={paymentPreviewOrder.momoDeepLink}
                            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-center text-sm font-semibold text-white"
                          >
                            Mở MoMo
                          </a>
                        ) : null}
                        {paymentPreviewOrder.paymentUrl ? (
                          <a
                            href={paymentPreviewOrder.paymentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-2xl bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-slate-100 hover:bg-slate-700"
                          >
                            Mở trang thanh toán
                          </a>
                        ) : null}
                      </div>
                    </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {String(paymentPreviewOrder.status || "").trim().toLowerCase() ===
                    "fulfilled"
                      ? "Thanh toán đã xác nhận và tài khoản đã được giao. Bạn có thể đóng popup hoặc xem lại ở danh sách đơn hàng."
                      : "Hệ thống đã xác nhận thanh toán. Nếu tài khoản chưa hiện ngay, hãy bấm kiểm tra lại trạng thái để nhận giao nick."}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PublicStorefront;
