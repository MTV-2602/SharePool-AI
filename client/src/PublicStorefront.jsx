import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
  User,
} from "lucide-react";

const STORE_TOKEN_KEY = "store_user_token";
const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_TOKEN_EXPIRES_AT_KEY = "token_expires_at";
const SESSION_ROLE_KEY = "active_session_role";

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

const formatStatusLabel = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "fulfilled") return "ÄÃ£ giao";
  if (normalized === "paid") return "ÄÃ£ thanh toÃ¡n";
  if (normalized === "awaiting_payment") return "Chá» thanh toÃ¡n";
  if (normalized === "payment_failed") return "Thanh toÃ¡n tháº¥t báº¡i";
  if (normalized === "payment_expired") return "Háº¿t háº¡n thanh toÃ¡n";
  if (normalized === "fulfillment_failed") return "Cáº§n xá»­ lÃ½ thá»§ cÃ´ng";
  if (normalized === "pending_payment") return "Äang táº¡o thanh toÃ¡n";
  return normalized || "Má»›i";
};
const isPendingStorePayment = (status) =>
  ["pending_payment", "awaiting_payment"].includes(
    String(status || "").trim().toLowerCase(),
  );

const packageFeatureMap = {
  package1: [
    "Nháº¥n nÃºt Ä‘á»ƒ láº¥y OTP Ä‘Äƒng nháº­p",
    "Láº¥y OTP tá»‘i Ä‘a 3 láº§n",
    "KhÃ´ng hiá»ƒn thá»‹ TOTP secret gá»‘c",
    "Nháº­n mÃ£ ngay sau thanh toÃ¡n",
  ],
  package2: [
    "Nháº­n Ä‘áº§y Ä‘á»§ TK / MK / 2FA",
    "CÃ³ cÃ´ng cá»¥ láº¥y OTP trÃªn web",
    "Nháº­n tÃ i khoáº£n ngay sau thanh toÃ¡n",
    "HÆ°á»›ng dáº«n Ä‘Äƒng nháº­p chi tiáº¿t",
  ],
  package3: [
    "ChÆ°a mua tá»± Ä‘á»™ng",
    "Chuyá»ƒn sang liÃªn há»‡ admin",
    "LiÃªn há»‡ qua Zalo",
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
  });
  const [token, setToken] = useState(initialStoreToken);
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(Boolean(initialStoreToken));
  const [purchaseLoadingCode, setPurchaseLoadingCode] = useState("");
  const [reconcileLoadingOrderId, setReconcileLoadingOrderId] = useState("");
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
  const [otpNowMs, setOtpNowMs] = useState(() => Date.now());
  const googleButtonRef = useRef(null);
  const authCardRef = useRef(null);
  const pendingReconcileRef = useRef(false);
  const purchaseLockRef = useRef(false);
  const storeOrdersSyncRef = useRef(false);

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

  const loadConfig = async () => {
    const data = await apiRequest("/api/store/config");
    const normalizedConfig = {
      packages: Array.isArray(data?.packages) ? data.packages : [],
      googleClientId: String(data?.googleClientId || ""),
      contact: data?.contact || { zaloUrl: "", messengerUrl: "" },
      momoConfigured: !!data?.momoConfigured,
    };
    setConfig(normalizedConfig);
    return normalizedConfig;
  };

  const loadSession = async (currentToken = token) => {
    if (!currentToken) {
      setUser(null);
      setOrders([]);
      return;
    }
    const data = await apiRequest("/api/store/auth/me", { token: currentToken });
    setUser(data?.user || null);
    setOrders(Array.isArray(data?.orders) ? data.orders : []);
  };

  const loadOrders = async (currentToken = token) => {
    if (!currentToken) {
      setOrders([]);
      return;
    }
    const data = await apiRequest("/api/store/orders", { token: currentToken });
    setOrders(Array.isArray(data?.orders) ? data.orders : []);
  };

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
          setError(bootstrapError.message || "KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u cá»­a hÃ ng");
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
        loadSession(token).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.view, route.orderId, token]);

  useEffect(() => {
    if (!token || !user) return undefined;
    const pendingOrders = orders.filter(
      (order) =>
        isPendingStorePayment(order.status) &&
        String(order.momoOrderId || "").trim(),
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
          await loadSession(token);
        }
      } finally {
        pendingReconcileRef.current = false;
      }
    };

    const initialDelayMs = route.view === "payment-result" ? 1500 : 5000;
    const intervalMs = route.view === "payment-result" ? 8000 : 15000;
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
    let cancelled = false;

    const syncOrders = async () => {
      if (cancelled || storeOrdersSyncRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      storeOrdersSyncRef.current = true;
      try {
        await loadOrders(token);
      } catch {
        // Bỏ qua lỗi poll nhẹ. Lần kế tiếp sẽ tự thử lại.
      } finally {
        storeOrdersSyncRef.current = false;
      }
    };

    const handleVisibilityOrFocus = () => {
      syncOrders().catch(() => {});
    };

    const intervalId = window.setInterval(() => {
      syncOrders().catch(() => {});
    }, 8000);

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [token, user]);

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
            setMessage("ÄÄƒng nháº­p Google thÃ nh cÃ´ng");
            await loadSession(data?.token || "");
          } catch (googleError) {
            setError(googleError.message || "ÄÄƒng nháº­p Google tháº¥t báº¡i");
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
    const package2Orders = orders.filter(
      (order) =>
        order.packageCode === "package2" &&
        order.status === "fulfilled" &&
        String(order.assignedOtpSecret || "").trim(),
    );
    if (package2Orders.length === 0) {
      setOtpResults({});
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;
    const refreshCodes = async () => {
      const entries = {};
      let nextRefreshIn = 30;
      for (const order of package2Orders) {
        try {
          const data = await apiRequest("/api/store/totp/generate", {
            method: "POST",
            body: { secret: order.assignedOtpSecret },
          });
          const expiresIn = Number(data?.expiresIn || 0);
          if (expiresIn > 0) {
            nextRefreshIn = Math.min(nextRefreshIn, expiresIn);
          }
          entries[order.id] = buildOtpDisplayState({
            code: data?.code,
            expiresIn,
          });
        } catch {
          entries[order.id] = buildOtpDisplayState({ code: "------", expiresIn: 0 });
        }
      }
      if (!cancelled) {
        setOtpResults((prev) => ({ ...prev, ...entries }));
      }
      if (!cancelled) {
        timeoutId = window.setTimeout(
          refreshCodes,
          Math.max(1000, Math.min(nextRefreshIn, 30) * 1000 + 250),
        );
      }
    };

    refreshCodes();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
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
      setMessage("ÄÄƒng nháº­p thÃ nh cÃ´ng");
      await loadSession(data?.token || "");
    } catch (loginError) {
      setError(loginError.message || "ÄÄƒng nháº­p tháº¥t báº¡i");
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
      setMessage("ÄÄƒng kÃ½ thÃ nh cÃ´ng");
      await loadSession(data?.token || "");
    } catch (registerError) {
      setError(registerError.message || "ÄÄƒng kÃ½ tháº¥t báº¡i");
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
        data?.message || "Náº¿u email tá»“n táº¡i, há»‡ thá»‘ng Ä‘Ã£ gá»­i hÆ°á»›ng dáº«n",
      );
      setShowForgotPassword(false);
    } catch (forgotError) {
      setError(forgotError.message || "KhÃ´ng gá»­i Ä‘Æ°á»£c email");
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
      setMessage(data?.message || "ÄÃ£ Ä‘áº·t láº¡i máº­t kháº©u");
      setResetPassword("");
      setStoreRoute({ view: "home" });
      refreshRouteState();
    } catch (resetError) {
      setError(resetError.message || "KhÃ´ng Ä‘áº·t láº¡i Ä‘Æ°á»£c máº­t kháº©u");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePayment = async (packageCode) => {
    if (!user) {
      setError("Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi mua.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/store/orders/payment", {
        method: "POST",
        token,
        body: { packageCode },
      });
      const payUrl = String(data?.payUrl || "").trim();
      if (!payUrl) {
        throw new Error("Há»‡ thá»‘ng khÃ´ng tráº£ vá» liÃªn káº¿t thanh toÃ¡n.");
      }
      window.location.href = payUrl;
    } catch (paymentError) {
      try {
        await loadConfig();
        await loadSession(token);
      } catch {}
      setError(paymentError.message || "KhÃ´ng táº¡o Ä‘Æ°á»£c Ä‘Æ¡n thanh toÃ¡n.");
    } finally {
      setLoading(false);
    }
  };

  const getPurchaseBlockedReason = (pkg) => {
    if (sessionLoading) {
      return "Há»‡ thá»‘ng Ä‘ang kiá»ƒm tra phiÃªn Ä‘Äƒng nháº­p cá»§a báº¡n.";
    }
    if (!user) {
      return "Báº¡n cáº§n Ä‘Äƒng nháº­p hoáº·c Ä‘Äƒng kÃ½ tÃ i khoáº£n user trÆ°á»›c khi thanh toÃ¡n.";
    }
    if (!config.momoConfigured) {
      return "Thanh toÃ¡n MoMo chÆ°a Ä‘Æ°á»£c cáº¥u hÃ¬nh hoÃ n chá»‰nh. Vui lÃ²ng liÃªn há»‡ admin.";
    }
    if (!pkg?.purchasable || Number(pkg?.available || 0) <= 0) {
      return "Kho hiá»‡n táº¡i cá»§a gÃ³i nÃ y Ä‘Ã£ háº¿t. Khi cÃ³ nick má»›i trong kho, báº¡n sáº½ mua Ä‘Æ°á»£c.";
    }
    return "Thanh toÃ¡n MoMo xong, há»‡ thá»‘ng sáº½ tá»± cáº¥p tÃ i khoáº£n ngay trÃªn web.";
  };

  const handlePurchaseButtonClick = async (pkg) => {
    if (sessionLoading || loading || purchaseLockRef.current || purchaseLoadingCode) return;
    if (!user) {
      setMessage("");
      setError("Báº¡n chÆ°a Ä‘Äƒng nháº­p tÃ i khoáº£n user. Vui lÃ²ng Ä‘Äƒng nháº­p hoáº·c Ä‘Äƒng kÃ½ rá»“i thá»­ láº¡i.");
      focusAuthCard("login");
      return;
    }
    purchaseLockRef.current = true;
    setPurchaseLoadingCode(String(pkg?.code || ""));
    try {
    const latestConfig = await loadConfig();
    const latestPackage = Array.isArray(latestConfig?.packages)
      ? latestConfig.packages.find((item) => item.code === pkg?.code)
      : null;
    if (!latestConfig?.momoConfigured) {
      setMessage("");
      setError("Thanh toÃ¡n MoMo chÆ°a Ä‘Æ°á»£c cáº¥u hÃ¬nh hoÃ n chá»‰nh. Vui lÃ²ng liÃªn há»‡ admin.");
      return;
    }
    if (!latestPackage?.purchasable || Number(latestPackage?.available || 0) <= 0) {
      setMessage("");
      setError("Kho hiá»‡n táº¡i cá»§a gÃ³i nÃ y Ä‘Ã£ háº¿t, nÃªn há»‡ thá»‘ng Ä‘Ã£ cháº·n khÃ´ng cho táº¡o thanh toÃ¡n.");
      return;
    }
      await handleCreatePayment(latestPackage.code);
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
          }),
          usageLeft: Number(data?.usageLeft || 0),
        },
      }));
      await loadSession(token);
    } catch (otpError) {
      setError(otpError.message || "KhÃ´ng láº¥y Ä‘Æ°á»£c mÃ£ 2FA");
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
      await loadSession(token);
      setMessage("ÄÃ£ kiá»ƒm tra láº¡i tráº¡ng thÃ¡i thanh toÃ¡n MoMo.");
    } catch (reconcileError) {
      setError(reconcileError.message || "KhÃ´ng thá»ƒ kiá»ƒm tra tráº¡ng thÃ¡i thanh toÃ¡n.");
    } finally {
      setReconcileLoadingOrderId("");
      setLoading(false);
    }
  };

  const copyText = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setMessage(successMessage || "ÄÃ£ sao chÃ©p");
    } catch {
      setError("KhÃ´ng sao chÃ©p Ä‘Æ°á»£c");
    }
  };

  const handleLogout = () => {
    setSessionToken("");
    writeStoredSessionRole("");
    setUser(null);
    setOrders([]);
    setMessage("ÄÃ£ Ä‘Äƒng xuáº¥t");
  };

  const authPanel = (
    <div ref={authCardRef} className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))] p-6">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">
            {authMode === "login" ? "ÄÄƒng nháº­p" : "ÄÄƒng kÃ½"}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-white">
            {authMode === "login"
              ? "Tiáº¿p tá»¥c Ä‘á»ƒ thanh toÃ¡n vÃ  nháº­n nick"
              : "Táº¡o tÃ i khoáº£n user Ä‘á»ƒ mua tá»± Ä‘á»™ng"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {authMode === "login"
              ? "ÄÄƒng nháº­p báº±ng email hoáº·c sá»‘ Ä‘iá»‡n thoáº¡i Ä‘á»ƒ tiáº¿p tá»¥c thanh toÃ¡n MoMo."
              : "Äiá»n thÃ´ng tin má»™t láº§n Ä‘á»ƒ theo dÃµi Ä‘Æ¡n hÃ ng vÃ  nháº­n tÃ i khoáº£n ngay trÃªn web."}
          </p>
        </div>

        <div className="mb-5 flex gap-2">
          <button
            onClick={() => {
              setAuthMode("login");
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "login" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            ÄÄƒng nháº­p
          </button>
          <button
            onClick={() => {
              setAuthMode("register");
              setShowForgotPassword(false);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "register" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            ÄÄƒng kÃ½
          </button>
        </div>

        {authMode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Email hoáº·c SÄT</span>
              <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.identifier} onChange={(event) => setLoginForm((prev) => ({ ...prev, identifier: event.target.value }))} placeholder="Email hoáº·c SÄT" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Máº­t kháº©u</span>
              <input type="password" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.password} onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Máº­t kháº©u" />
            </label>
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60">
              ÄÄƒng nháº­p
            </button>
            <button
              type="button"
              onClick={() => setShowForgotPassword((prev) => !prev)}
              className="inline-flex items-center gap-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
            >
              {showForgotPassword ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showForgotPassword ? "áº¨n quÃªn máº­t kháº©u" : "QuÃªn máº­t kháº©u?"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {[
              ["fullName", "Há» tÃªn"],
              ["phone", "Sá»‘ Ä‘iá»‡n thoáº¡i (Zalo)"],
              ["email", "Email"],
              ["password", "Máº­t kháº©u"],
            ].map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-sm text-slate-300">{label}</span>
                <input type={key === "password" ? "password" : "text"} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500" value={registerForm[key]} onChange={(event) => setRegisterForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={label} />
              </label>
            ))}
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
              ÄÄƒng kÃ½
            </button>
          </form>
        )}

        {authMode === "login" && showForgotPassword ? (
          <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-white">KhÃ´i phá»¥c máº­t kháº©u</p>
              <p className="mt-1 text-sm text-slate-400">
                Nháº­p email Ä‘á»ƒ nháº­n liÃªn káº¿t Ä‘áº·t láº¡i máº­t kháº©u. Pháº§n nÃ y chá»‰ hiá»‡n khi báº¡n cáº§n dÃ¹ng.
              </p>
            </div>
            <form onSubmit={handleForgotPassword} className="flex flex-col gap-3 sm:flex-row">
              <input
                className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500"
                value={forgotEmail}
                onChange={(event) => setForgotEmail(event.target.value)}
                placeholder="Nháº­p email Ä‘á»ƒ nháº­n link Ä‘áº·t láº¡i máº­t kháº©u"
              />
              <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
                Gá»­i email
              </button>
            </form>
          </div>
        ) : null}
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck size={18} />
          <h2 className="text-lg font-semibold">Báº£o máº­t & OTP</h2>
        </div>
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>GÃ³i 1: nháº­n mÃ£ bÃ­ máº­t riÃªng vÃ  chá»‰ hiá»ƒn thá»‹ OTP 6 sá»‘ khi cáº§n Ä‘Äƒng nháº­p.</li>
          <li>GÃ³i 2: nháº­n Ä‘áº§y Ä‘á»§ tÃ i khoáº£n, máº­t kháº©u, 2FA vÃ  cÃ´ng cá»¥ láº¥y mÃ£ 30 giÃ¢y.</li>
          <li>Thanh toÃ¡n xong lÃ  cÃ³ thá»ƒ xem thÃ´ng tin tÃ i khoáº£n ngay trÃªn web.</li>
          <li>Náº¿u cáº§n há»— trá»£ thÃªm, báº¡n cÃ³ thá»ƒ liÃªn há»‡ admin qua Zalo.</li>
        </ul>
        <div className="mt-6">
          <p className="mb-3 text-sm text-slate-400">ÄÄƒng nháº­p nhanh báº±ng Google</p>
          <div ref={googleButtonRef} />
          {!config.googleClientId ? (
            <p className="mt-2 text-xs text-slate-500">ChÆ°a cáº¥u hÃ¬nh GOOGLE_CLIENT_ID.</p>
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
            Äang kiá»ƒm tra phiÃªn Ä‘Äƒng nháº­p
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Vui lÃ²ng chá» má»™t chÃºt, há»‡ thá»‘ng Ä‘ang khÃ´i phá»¥c tÃ i khoáº£n cá»§a báº¡n.
          </p>
        </div>
      </div>
    </div>
  );

  const guestOrdersPanel = (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-slate-400">
      ÄÄƒng nháº­p Ä‘á»ƒ xem Ä‘Æ¡n hÃ ng vÃ  nháº­n thÃ´ng tin tÃ i khoáº£n.
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
              {pkg.available === null ? "LiÃªn há»‡" : `CÃ²n ${pkg.available}`}
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
              LiÃªn há»‡ admin
            </a>
          ) : (
            <>
            <button onClick={() => handlePurchaseButtonClick(pkg)} disabled={sessionLoading || loading || !!purchaseLoadingCode} className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-semibold text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              {purchaseLoadingCode === pkg.code ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Äang táº¡o thanh toÃ¡n...
                </span>
              ) : sessionLoading
                ? "Äang kiá»ƒm tra..."
                : !user
                  ? "ÄÄƒng nháº­p Ä‘á»ƒ mua"
                  : !config.momoConfigured
                    ? "ChÆ°a cáº¥u hÃ¬nh MoMo"
                    : pkg.purchasable
                      ? "Mua ngay"
                      : "Táº¡m háº¿t hÃ ng"}
            </button>
            <p className="mt-3 min-h-[40px] text-sm leading-5 text-slate-400">
              {getPurchaseBlockedReason(pkg)}
            </p>
            </>
          )}
        </div>
      ))}
    </div>
  );

  const renderPackage1Order = (order) => {
    const otp = otpResults[order.id] || {};
    const otpSecondsLeft = getOtpSecondsRemaining(otp, otpNowMs);
    const package1OtpExpired = Boolean(otp.code) && otpSecondsLeft <= 0;
    const package1OtpDisplay = otpSecondsLeft > 0 ? otp.code || "------" : "------";
    const package1OtpStatusText = otpSecondsLeft > 0
      ? `Mã hết hạn sau ${otpSecondsLeft}s`
      : package1OtpExpired
        ? "Mã đã hết hạn"
        : "Bấm Lấy mã để hiện mã đăng nhập";
    return (
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <div className="space-y-3">
          {[
            ["TÃ i khoáº£n", order.assignedUsername],
            ["Máº­t kháº©u", order.assignedPassword],
            ["Link", order.assignedLink],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-center gap-3">
              <span className="min-w-24 text-sm text-slate-400">{label}</span>
              <code className="flex-1 break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{value || "--"}</code>
              {value ? (
                <button
                  onClick={() => copyText(value, `ÄÃ£ sao chÃ©p ${label}`)}
                  className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200"
                >
                  Sao chÃ©p
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-400">Mã để đăng nhập. Còn {Math.max(0, Number(order.package1UsageLeft || 0))} lần sử dụng.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {otpSecondsLeft > 0 ? (
            <button
              onClick={() => copyText(package1OtpDisplay, "Đã sao chép mã đăng nhập")}
              className="rounded-2xl bg-slate-800 px-4 py-3 font-semibold text-slate-100 hover:bg-slate-700"
            >
              Sao chép mã
            </button>
          ) : (
            <button onClick={() => handleGeneratePackage1Code(order)} disabled={loading || order.package1UsageLeft <= 0} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
              {order.package1UsageLeft > 0 ? "Lấy mã đăng nhập" : "Đã hết lượt"}
            </button>
          )}
          <div className={`rounded-2xl px-4 py-3 text-2xl font-bold tracking-[0.3em] ${otpSecondsLeft > 0 ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border border-slate-700 bg-slate-900 text-slate-500"}`}>{package1OtpDisplay}</div>
          <span className={`text-sm ${package1OtpExpired ? "text-amber-300" : "text-slate-400"}`}>{package1OtpStatusText}</span>
        </div>
      </div>
    );
  };

  const renderPackage2Order = (order) => {
    const otp = otpResults[order.id] || { code: "------", expiresIn: 0 };
    const otpSecondsLeft = getOtpSecondsRemaining(otp, otpNowMs);
    return (
      <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        {[
          ["TÃ i khoáº£n", order.assignedUsername],
          ["Máº­t kháº©u", order.assignedPassword],
          ["MÃ£ 2FA", order.assignedOtpSecret],
          ["Link", order.assignedLink],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-center gap-3">
            <span className="min-w-24 text-sm text-slate-400">{label}</span>
            <code className="flex-1 break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{value || "--"}</code>
            {value ? (
              <button onClick={() => copyText(value, `ÄÃ£ sao chÃ©p ${label}`)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200">
                Sao chÃ©p
              </button>
            ) : null}
          </div>
        ))}
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-sm text-slate-300">CÃ´ng cá»¥ láº¥y mÃ£ 2FA tá»« secret nÃ y, tá»± Ä‘á»™ng lÃ m má»›i má»—i 30 giÃ¢y.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-slate-900 px-4 py-3 text-2xl font-bold tracking-[0.3em] text-cyan-300">{otp.code || "------"}</div>
            <span className="text-sm text-slate-400">{otpSecondsLeft > 0 ? `Háº¿t háº¡n sau ${otpSecondsLeft}s` : "Äang Ä‘á»£i mÃ£"}</span>
          </div>
        </div>
      </div>
    );
  };

  const orderCards = (
    <div className="space-y-5">
      {orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-slate-400">ChÆ°a cÃ³ Ä‘Æ¡n hÃ ng nÃ o.</div>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{order.packageName}</h3>
                <p className="mt-1 text-sm text-slate-400">ÄÆ¡n #{order.id} â€¢ {formatDateTime(order.createdAt)}</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-100">{formatStatusLabel(order.status)}</span>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">GiÃ¡ tiá»n</p><p className="mt-1 font-semibold text-white">{formatMoney(order.amount)}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">MoMo order</p><p className="mt-1 font-semibold text-white">{order.momoOrderId || "--"}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Tráº¡ng thÃ¡i MoMo</p><p className="mt-1 font-semibold text-white">{order.momoMessage || "--"}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Háº¡n thanh toÃ¡n</p><p className="mt-1 font-semibold text-white">{order.expiresAt ? formatDateTime(order.expiresAt) : "--"}</p></div>
            </div>
            {isPendingStorePayment(order.status) ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-amber-200">
                  Nick Ä‘ang Ä‘Æ°á»£c giá»¯ riÃªng cho Ä‘Æ¡n nÃ y Ä‘áº¿n {order.expiresAt ? formatDateTime(order.expiresAt) : "--"}.
                </p>
                <button
                  onClick={() => handleReconcileOrderPayment(order.id)}
                  disabled={loading}
                  className="inline-flex items-center rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reconcileLoadingOrderId === order.id ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Äang kiá»ƒm tra...
                    </span>
                  ) : (
                    "Kiá»ƒm tra thanh toÃ¡n"
                  )}
                </button>
                {order.momoPayUrl ? (
                  <a
                    href={order.momoPayUrl}
                    className="inline-flex items-center rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Tiáº¿p tá»¥c thanh toÃ¡n
                  </a>
                ) : null}
              </div>
            ) : null}
            {order.packageCode === "package1" && order.status === "fulfilled" ? renderPackage1Order(order) : null}
            {order.packageCode === "package2" && order.status === "fulfilled" ? renderPackage2Order(order) : null}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(6,182,212,0.18),_transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))] p-6 shadow-2xl shadow-slate-950/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.4em] text-cyan-400">ChatGPT Store</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Mua ChatGPT tá»± Ä‘á»™ng</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                ÄÄƒng kÃ½ hoáº·c Ä‘Äƒng nháº­p Ä‘á»ƒ thanh toÃ¡n MoMo vÃ  nháº­n tÃ i khoáº£n ngay trÃªn web.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {user ? (
                <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100">
                  <LogOut size={16} />
                  ÄÄƒng xuáº¥t
                </button>
              ) : null}
            </div>
          </div>
          {user ? (
            <div className="mt-6 grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 sm:grid-cols-3">
              <div className="flex items-center gap-3"><User className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">NgÆ°á»i dÃ¹ng</p><p className="font-semibold text-white">{user.fullName}</p></div></div>
              <div className="flex items-center gap-3"><Phone className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Zalo / SDT</p><p className="font-semibold text-white">{user.phone || "--"}</p></div></div>
              <div className="flex items-center gap-3"><Mail className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Email</p><p className="font-semibold text-white">{user.email}</p></div></div>
            </div>
          ) : null}
        </header>

        {message ? <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
        {error ? <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        {route.view === "reset-password" ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="text-2xl font-semibold text-white">Äáº·t láº¡i máº­t kháº©u</h2>
            <p className="mt-2 text-sm text-slate-400">Nháº­p máº­t kháº©u má»›i cho tÃ i khoáº£n cá»§a báº¡n.</p>
            <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
              <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Máº­t kháº©u má»›i" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" />
              <div className="flex gap-3">
                <button type="button" onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="flex-1 rounded-2xl bg-slate-800 px-4 py-3 text-slate-200">Quay láº¡i</button>
                <button type="submit" disabled={loading} className="flex-1 rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white disabled:opacity-60">Äáº·t láº¡i máº­t kháº©u</button>
              </div>
            </form>
          </section>
        ) : (
          <>
            {sessionLoading ? sessionLoadingPanel : !user ? authPanel : null}
            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">GÃ³i dá»‹ch vá»¥</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">GÃ³i 1 / GÃ³i 2 mua tá»± Ä‘á»™ng, GÃ³i 3 liÃªn há»‡ admin</h2>
                </div>
                {route.view === "payment-result" ? (
                  <button onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="rounded-2xl bg-slate-800 px-4 py-3 text-sm text-slate-100">Vá» trang mua hÃ ng</button>
                ) : null}
              </div>
              {packageCards}
            </section>

            <section className="mt-10 grid gap-8 xl:grid-cols-[1.4fr,0.8fr]">
              <div>
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">ÄÆ¡n hÃ ng</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">TÃ i khoáº£n Ä‘Ã£ mua</h2>
                </div>
                {user ? orderCards : sessionLoading ? sessionLoadingPanel : guestOrdersPanel}
                {route.view === "payment-result" ? (
                  <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                    <h3 className="text-lg font-semibold text-white">Káº¿t quáº£ thanh toÃ¡n</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {currentPaymentOrder ? `ÄÆ¡n #${currentPaymentOrder.id} Ä‘ang á»Ÿ tráº¡ng thÃ¡i: ${formatStatusLabel(currentPaymentOrder.status)}` : "Äang táº£i thÃ´ng tin Ä‘Æ¡n hÃ ng..."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                  <h3 className="text-lg font-semibold text-white">Quy trÃ¬nh nháº­n nick sau khi thanh toÃ¡n</h3>
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <li>1. ÄÄƒng kÃ½ hoáº·c Ä‘Äƒng nháº­p tÃ i khoáº£n user báº±ng email hoáº·c sá»‘ Ä‘iá»‡n thoáº¡i.</li>
                    <li>2. Chá»n gÃ³i phÃ¹ há»£p rá»“i thanh toÃ¡n qua MoMo.</li>
                    <li>3. Sau khi thanh toÃ¡n thÃ nh cÃ´ng, há»‡ thá»‘ng tá»± cáº¥p tÃ i khoáº£n tÆ°Æ¡ng á»©ng.</li>
                    <li>4. GÃ³i 1 báº¥m nÃºt Láº¥y mÃ£ Ä‘á»ƒ nháº­n OTP 6 sá»‘, tá»‘i Ä‘a 3 lÆ°á»£t.</li>
                    <li>5. GÃ³i 2 nháº­n Ä‘áº§y Ä‘á»§ tÃ i khoáº£n, máº­t kháº©u, mÃ£ 2FA vÃ  cÃ´ng cá»¥ láº¥y mÃ£ trÃªn web.</li>
                  </ol>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default PublicStorefront;
