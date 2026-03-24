import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";

const STORE_TOKEN_KEY = "store_user_token";

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
  if (normalized === "fulfilled") return "Đã giao";
  if (normalized === "paid") return "Đã thanh toán";
  if (normalized === "awaiting_payment") return "Chờ thanh toán";
  if (normalized === "payment_failed") return "Thanh toán thất bại";
  if (normalized === "payment_expired") return "Hết hạn thanh toán";
  if (normalized === "fulfillment_failed") return "Cần xử lý thủ công";
  if (normalized === "pending_payment") return "Đang tạo thanh toán";
  return normalized || "Mới";
};
const isPendingStorePayment = (status) =>
  ["pending_payment", "awaiting_payment"].includes(
    String(status || "").trim().toLowerCase(),
  );

const packageFeatureMap = {
  package1: [
    "Nhận mã bí mật riêng",
    "Lấy OTP tối đa 3 lần",
    "Không hiển thị TOTP secret gốc",
    "Nhận mã ngay sau thanh toán",
  ],
  package2: [
    "Nhận đầy đủ TK / MK / 2FA",
    "Có công cụ lấy OTP trên web",
    "Nhận tài khoản ngay sau thanh toán",
    "Hướng dẫn đăng nhập chi tiết",
  ],
  package3: [
    "Chưa mua tự động",
    "Chuyển sang liên hệ admin",
    "Liên hệ qua Zalo",
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
  });
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [otpResults, setOtpResults] = useState({});
  const [manualSecret, setManualSecret] = useState("");
  const [manualOtp, setManualOtp] = useState({ code: "", expiresIn: 0 });
  const googleButtonRef = useRef(null);
  const authCardRef = useRef(null);

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
    setConfig({
      packages: Array.isArray(data?.packages) ? data.packages : [],
      googleClientId: String(data?.googleClientId || ""),
      contact: data?.contact || { zaloUrl: "", messengerUrl: "" },
      momoConfigured: !!data?.momoConfigured,
    });
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

  useEffect(() => {
    const onPopState = () => refreshRouteState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bootstrapStore = async () => {
      try {
        await loadConfig();
        if (initialStoreToken) {
          await loadSession(initialStoreToken);
        }
      } catch (bootstrapError) {
        if (initialStoreToken) {
          setSessionToken("");
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
    if (route.view !== "payment-result" || !route.orderId || !token) return;
    loadSession(token).catch(() => {});
  }, [route.view, route.orderId, token]);

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
    const package2Orders = orders.filter(
      (order) =>
        order.packageCode === "package2" &&
        order.status === "fulfilled" &&
        String(order.assignedOtpSecret || "").trim(),
    );
    if (package2Orders.length === 0 && !manualSecret.trim()) {
      setOtpResults({});
      return undefined;
    }

    let cancelled = false;
    const refreshCodes = async () => {
      const entries = {};
      for (const order of package2Orders) {
        try {
          const data = await apiRequest("/api/store/totp/generate", {
            method: "POST",
            body: { secret: order.assignedOtpSecret },
          });
          entries[order.id] = {
            code: String(data?.code || ""),
            expiresIn: Number(data?.expiresIn || 0),
          };
        } catch {
          entries[order.id] = { code: "------", expiresIn: 0 };
        }
      }
      if (!cancelled) {
        setOtpResults((prev) => ({ ...prev, ...entries }));
      }
      if (manualSecret.trim()) {
        try {
          const data = await apiRequest("/api/store/totp/generate", {
            method: "POST",
            body: { secret: manualSecret.trim() },
          });
          if (!cancelled) {
            setManualOtp({
              code: String(data?.code || ""),
              expiresIn: Number(data?.expiresIn || 0),
            });
          }
        } catch {
          if (!cancelled) {
            setManualOtp({ code: "------", expiresIn: 0 });
          }
        }
      }
    };

    refreshCodes();
    const interval = window.setInterval(refreshCodes, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [orders, manualSecret]);

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

  const handleCreatePayment = async (packageCode) => {
    if (!user) {
      setError("Vui lòng đăng nhập trước khi mua");
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
        throw new Error("Hệ thống không trả về link thanh toán");
      }
      window.location.href = payUrl;
    } catch (paymentError) {
      setError(paymentError.message || "Không tạo được đơn thanh toán");
    } finally {
      setLoading(false);
    }
  };

  const getPurchaseBlockedReason = (pkg) => {
    if (sessionLoading) {
      return "Hệ thống đang kiểm tra phiên đăng nhập của bạn.";
    }
    if (!user) {
      return "Bạn cần đăng nhập hoặc đăng ký tài khoản user trước khi thanh toán.";
    }
    if (!config.momoConfigured) {
      return "Thanh toán MoMo chưa được cấu hình hoàn chỉnh. Vui lòng liên hệ admin.";
    }
    if (!pkg?.purchasable) {
      return "Gói này hiện chưa hỗ trợ mua tự động hoặc đang tạm hết hàng.";
    }
    return "Thanh toán MoMo xong, hệ thống sẽ tự cấp tài khoản ngay trên web.";
  };

  const handlePurchaseButtonClick = (pkg) => {
    if (sessionLoading || loading) return;
    if (!user) {
      setMessage("");
      setError("Bạn chưa đăng nhập tài khoản user. Vui lòng đăng nhập hoặc đăng ký rồi thử lại.");
      focusAuthCard("login");
      return;
    }
    if (!config.momoConfigured) {
      setMessage("");
      setError("Thanh toán MoMo chưa được cấu hình hoàn chỉnh. Vui lòng liên hệ admin.");
      return;
    }
    if (!pkg?.purchasable) {
      setMessage("");
      setError("Gói này hiện chưa hỗ trợ mua tự động hoặc đang tạm hết hàng.");
      return;
    }
    handleCreatePayment(pkg.code);
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
          code: String(data?.code || ""),
          expiresIn: Number(data?.expiresIn || 0),
          usageLeft: Number(data?.usageLeft || 0),
        },
      }));
      await loadSession(token);
    } catch (otpError) {
      setError(otpError.message || "Không lấy được mã 2FA");
    }
  };

  const copyText = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setMessage(successMessage || "Đã sao chép");
    } catch {
      setError("Không sao chép được");
    }
  };

  const handleLogout = () => {
    setSessionToken("");
    setUser(null);
    setOrders([]);
    setMessage("Đã đăng xuất");
  };

  const authPanel = (
    <div ref={authCardRef} className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setAuthMode("login")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "login" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Đăng nhập
          </button>
          <button
            onClick={() => setAuthMode("register")}
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

        <div className="mt-5 border-t border-slate-800 pt-5">
          <p className="mb-3 text-sm text-slate-400">Quên mật khẩu</p>
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-3 sm:flex-row">
            <input className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} placeholder="Nhập email để nhận link đặt lại mật khẩu" />
            <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
              Gửi email
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck size={18} />
          <h2 className="text-lg font-semibold">Bảo mật & OTP</h2>
        </div>
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>Gói 1: nhận mã bí mật riêng và chỉ hiển thị OTP 6 số khi cần đăng nhập.</li>
          <li>Gói 2: nhận đầy đủ tài khoản, mật khẩu, 2FA và công cụ lấy mã 30 giây.</li>
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
              {pkg.available === null ? "Liên hệ" : `Còn ${pkg.available}`}
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
            <button onClick={() => handlePurchaseButtonClick(pkg)} disabled={sessionLoading || loading} className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-semibold text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              {sessionLoading
                ? "Đang kiểm tra..."
                : !user
                  ? "Đăng nhập để mua"
                  : !config.momoConfigured
                    ? "Chưa cấu hình MoMo"
                    : pkg.purchasable
                      ? "Mua ngay"
                      : "Tạm hết hàng"}
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
    return (
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300">Mã bí mật</span>
          <code className="break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{order.package1AccessToken}</code>
          <button onClick={() => copyText(order.package1AccessToken, "Đã sao chép mã bí mật Gói 1")} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200">
            <Copy size={14} />
            Sao chép
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-400">Còn {order.package1UsageLeft} / 3 lượt lấy mã OTP.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => handleGeneratePackage1Code(order)} disabled={loading || order.package1UsageLeft <= 0} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
            {order.package1UsageLeft > 0 ? "Lấy mã" : "Đã hết lượt"}
          </button>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-2xl font-bold tracking-[0.3em] text-emerald-300">{otp.code || "------"}</div>
          <span className="text-sm text-slate-400">{otp.expiresIn ? `Hết hạn sau ${otp.expiresIn}s` : "OTP hiển thị 6 số"}</span>
        </div>
      </div>
    );
  };

  const renderPackage2Order = (order) => {
    const otp = otpResults[order.id] || { code: "------", expiresIn: 0 };
    return (
      <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        {[
          ["Tài khoản", order.assignedUsername],
          ["Mật khẩu", order.assignedPassword],
          ["Mã 2FA", order.assignedOtpSecret],
          ["Link", order.assignedLink],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-center gap-3">
            <span className="min-w-24 text-sm text-slate-400">{label}</span>
            <code className="flex-1 break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{value || "--"}</code>
            {value ? (
              <button onClick={() => copyText(value, `Đã sao chép ${label}`)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200">
                Sao chép
              </button>
            ) : null}
          </div>
        ))}
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-sm text-slate-300">Công cụ lấy mã 2FA từ secret này, tự động làm mới mỗi 30 giây.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-slate-900 px-4 py-3 text-2xl font-bold tracking-[0.3em] text-cyan-300">{otp.code || "------"}</div>
            <span className="text-sm text-slate-400">{otp.expiresIn ? `Hết hạn sau ${otp.expiresIn}s` : "Đang đợi mã"}</span>
          </div>
        </div>
      </div>
    );
  };

  const orderCards = (
    <div className="space-y-5">
      {orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-slate-400">Chưa có đơn hàng nào.</div>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{order.packageName}</h3>
                <p className="mt-1 text-sm text-slate-400">Đơn #{order.id} • {formatDateTime(order.createdAt)}</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-100">{formatStatusLabel(order.status)}</span>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Giá tiền</p><p className="mt-1 font-semibold text-white">{formatMoney(order.amount)}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">MoMo order</p><p className="mt-1 font-semibold text-white">{order.momoOrderId || "--"}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Trạng thái MoMo</p><p className="mt-1 font-semibold text-white">{order.momoMessage || "--"}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Hạn thanh toán</p><p className="mt-1 font-semibold text-white">{order.expiresAt ? formatDateTime(order.expiresAt) : "--"}</p></div>
            </div>
            {isPendingStorePayment(order.status) ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-amber-200">
                  Nick đang được giữ riêng cho đơn này đến {order.expiresAt ? formatDateTime(order.expiresAt) : "--"}.
                </p>
                {order.momoPayUrl ? (
                  <a
                    href={order.momoPayUrl}
                    className="inline-flex items-center rounded-2xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Tiếp tục thanh toán
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
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Mua ChatGPT tự động</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Đăng ký hoặc đăng nhập để thanh toán MoMo và nhận tài khoản ngay trên web.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {user ? (
                <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100">
                  <LogOut size={16} />
                  Đăng xuất
                </button>
              ) : null}
            </div>
          </div>
          {user ? (
            <div className="mt-6 grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 sm:grid-cols-3">
              <div className="flex items-center gap-3"><User className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Người dùng</p><p className="font-semibold text-white">{user.fullName}</p></div></div>
              <div className="flex items-center gap-3"><Phone className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Zalo / SDT</p><p className="font-semibold text-white">{user.phone || "--"}</p></div></div>
              <div className="flex items-center gap-3"><Mail className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Email</p><p className="font-semibold text-white">{user.email}</p></div></div>
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
            </section>

            <section className="mt-10 grid gap-8 xl:grid-cols-[1.4fr,0.8fr]">
              <div>
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Đơn hàng</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Tài khoản đã mua</h2>
                </div>
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
                  <div className="mb-3 flex items-center gap-2 text-white"><KeyRound size={18} className="text-cyan-400" /><h3 className="text-lg font-semibold">Công cụ OTP</h3></div>
                  <p className="text-sm leading-6 text-slate-400">Dán TOTP secret để lấy mã đăng nhập. Gói 2 sẽ tự động làm mới mỗi 30 giây, còn ô này dùng để kiểm tra thủ công khi cần.</p>
                  <div className="mt-4 space-y-3">
                    <textarea value={manualSecret} onChange={(event) => setManualSecret(event.target.value)} placeholder="Dán mã 2FA secret vào đây" className="min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" />
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-slate-950 px-4 py-3 text-2xl font-bold tracking-[0.35em] text-cyan-300">{manualOtp.code || "------"}</div>
                      <button onClick={async () => { try { const data = await apiRequest("/api/store/totp/generate", { method: "POST", body: { secret: manualSecret } }); setManualOtp({ code: String(data?.code || ""), expiresIn: Number(data?.expiresIn || 0) }); } catch (manualError) { setError(manualError.message || "Không lấy được OTP"); } }} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white">
                        <RefreshCw size={16} />
                        Lấy mã
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                  <h3 className="text-lg font-semibold text-white">Quy trình nhận nick sau khi thanh toán</h3>
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <li>1. Đăng ký hoặc đăng nhập tài khoản user bằng email hoặc số điện thoại.</li>
                    <li>2. Chọn gói phù hợp rồi thanh toán qua MoMo.</li>
                    <li>3. Sau khi thanh toán thành công, hệ thống tự cấp tài khoản tương ứng.</li>
                    <li>4. Gói 1 chỉ nhận OTP 6 số qua mã bí mật, tối đa 3 lượt.</li>
                    <li>5. Gói 2 nhận đầy đủ tài khoản, mật khẩu, mã 2FA và công cụ lấy mã trên web.</li>
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
