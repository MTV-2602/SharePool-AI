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
  if (normalized === "fulfilled") return "Da giao";
  if (normalized === "paid") return "Da thanh toan";
  if (normalized === "awaiting_payment") return "Cho thanh toan";
  if (normalized === "payment_failed") return "Thanh toan that bai";
  if (normalized === "fulfillment_failed") return "Can xu ly thu cong";
  if (normalized === "pending_payment") return "Dang tao thanh toan";
  return normalized || "Moi";
};

const packageFeatureMap = {
  package1: [
    "Nhan ma bi mat rieng",
    "Lay OTP toi da 3 lan",
    "Khong hien TOTP secret goc",
    "Nick cap tu kho tong",
  ],
  package2: [
    "Nhan day du TK / MK / 2FA",
    "Co cong cu lay OTP tren web",
    "Nick moi tu kho tong",
    "Huong dan dang nhap chi tiet",
  ],
  package3: ["Chua mua tu dong", "Chuyen sang lien he admin", "Zalo / Messenger"],
};

function PublicStorefront() {
  const [route, setRouteState] = useState(readStoreRoute());
  const [config, setConfig] = useState({
    packages: [],
    googleClientId: "",
    contact: { zaloUrl: "", messengerUrl: "" },
    momoConfigured: false,
  });
  const [token, setToken] = useState(
    typeof window !== "undefined" ? localStorage.getItem(STORE_TOKEN_KEY) || "" : "",
  );
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [loading, setLoading] = useState(false);
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

  const refreshRouteState = () => setRouteState(readStoreRoute());

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
    loadConfig().catch((configError) => {
      setError(configError.message || "Khong tai duoc cau hinh web");
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    loadSession(token).catch((sessionError) => {
      setSessionToken("");
      setError(sessionError.message || "Khong tai duoc phien dang nhap");
    });
  }, [token]);

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
            setMessage("Dang nhap Google thanh cong");
            await loadSession(data?.token || "");
          } catch (googleError) {
            setError(googleError.message || "Dang nhap Google that bai");
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
      setMessage("Dang nhap thanh cong");
      await loadSession(data?.token || "");
    } catch (loginError) {
      setError(loginError.message || "Dang nhap that bai");
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
      setMessage("Dang ky thanh cong");
      await loadSession(data?.token || "");
    } catch (registerError) {
      setError(registerError.message || "Dang ky that bai");
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
      setMessage(data?.message || "Neu email ton tai, he thong da gui huong dan");
    } catch (forgotError) {
      setError(forgotError.message || "Khong gui duoc email");
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
      setMessage(data?.message || "Da dat lai mat khau");
      setResetPassword("");
      setStoreRoute({ view: "home" });
      refreshRouteState();
    } catch (resetError) {
      setError(resetError.message || "Khong dat lai duoc mat khau");
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePayment = async (packageCode) => {
    if (!user) {
      setError("Vui long dang nhap truoc khi mua");
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
        throw new Error("He thong khong tra ve link thanh toan");
      }
      window.location.href = payUrl;
    } catch (paymentError) {
      setError(paymentError.message || "Khong tao duoc don thanh toan");
    } finally {
      setLoading(false);
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
          code: String(data?.code || ""),
          expiresIn: Number(data?.expiresIn || 0),
          usageLeft: Number(data?.usageLeft || 0),
        },
      }));
      await loadSession(token);
    } catch (otpError) {
      setError(otpError.message || "Khong lay duoc ma 2FA");
    }
  };

  const copyText = async (value, successMessage) => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      setMessage(successMessage || "Da copy");
    } catch {
      setError("Khong copy duoc");
    }
  };

  const handleLogout = () => {
    setSessionToken("");
    setUser(null);
    setOrders([]);
    setMessage("Da dang xuat");
  };

  const authPanel = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setAuthMode("login")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "login" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Dang nhap
          </button>
          <button
            onClick={() => setAuthMode("register")}
            className={`rounded-full px-4 py-2 text-sm font-medium ${authMode === "register" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            Dang ky
          </button>
        </div>

        {authMode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Email hoac SDT</span>
              <input className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.identifier} onChange={(event) => setLoginForm((prev) => ({ ...prev, identifier: event.target.value }))} placeholder="Email hoac SDT" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Mat khau</span>
              <input type="password" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-blue-500" value={loginForm.password} onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))} placeholder="Mat khau" />
            </label>
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60">
              Dang nhap
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {[
              ["fullName", "Ho ten"],
              ["phone", "So dien thoai (Zalo)"],
              ["email", "Email"],
              ["password", "Mat khau"],
            ].map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-sm text-slate-300">{label}</span>
                <input type={key === "password" ? "password" : "text"} className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500" value={registerForm[key]} onChange={(event) => setRegisterForm((prev) => ({ ...prev, [key]: event.target.value }))} placeholder={label} />
              </label>
            ))}
            <button type="submit" disabled={loading} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
              Dang ky
            </button>
          </form>
        )}

        <div className="mt-5 border-t border-slate-800 pt-5">
          <p className="mb-3 text-sm text-slate-400">Quen mat khau</p>
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-3 sm:flex-row">
            <input className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} placeholder="Nhap email de nhan link dat lai mat khau" />
            <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-60">
              Gui email
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck size={18} />
          <h2 className="text-lg font-semibold">Bao mat & OTP</h2>
        </div>
        <ul className="space-y-3 text-sm leading-6 text-slate-300">
          <li>Goi 1: he thong cap mot ma bi mat rieng va chi hien OTP 6 so.</li>
          <li>Goi 2: hien day du TK, MK, 2FA secret va cong cu lay ma 30s.</li>
          <li>Thong tin nhay cam duoc luu o .env, khong commit len Git.</li>
          <li>Mua tren web nay chi lay nick tu kho tong, khong dung vao kho market.</li>
        </ul>
        <div className="mt-6">
          <p className="mb-3 text-sm text-slate-400">Dang nhap nhanh bang Google</p>
          <div ref={googleButtonRef} />
          {!config.googleClientId ? (
            <p className="mt-2 text-xs text-slate-500">Chua cau hinh GOOGLE_CLIENT_ID.</p>
          ) : null}
        </div>
      </div>
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
              {pkg.available === null ? "Lien he" : `Con ${pkg.available}`}
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
            <a href={config.contact?.zaloUrl || config.contact?.messengerUrl || "#"} target="_blank" rel="noreferrer" className="block rounded-2xl bg-amber-500 px-4 py-3 text-center font-semibold text-slate-950">
              Lien he admin
            </a>
          ) : (
            <button onClick={() => handleCreatePayment(pkg.code)} disabled={!user || !pkg.purchasable || loading || !config.momoConfigured} className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 font-semibold text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
              {!user ? "Dang nhap de mua" : !config.momoConfigured ? "Chua cau hinh MoMo" : pkg.purchasable ? "Mua ngay" : "Tam het hang"}
            </button>
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
          <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300">Ma bi mat</span>
          <code className="break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{order.package1AccessToken}</code>
          <button onClick={() => copyText(order.package1AccessToken, "Da copy ma bi mat Goi 1")} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200">
            <Copy size={14} />
            Copy
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-400">Con {order.package1UsageLeft} / 3 luot lay ma OTP.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => handleGeneratePackage1Code(order)} disabled={loading || order.package1UsageLeft <= 0} className="rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">
            {order.package1UsageLeft > 0 ? "Lay ma" : "Da het luot"}
          </button>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-2xl font-bold tracking-[0.3em] text-emerald-300">{otp.code || "------"}</div>
          <span className="text-sm text-slate-400">{otp.expiresIn ? `Het han sau ${otp.expiresIn}s` : "OTP hien 6 so"}</span>
        </div>
      </div>
    );
  };

  const renderPackage2Order = (order) => {
    const otp = otpResults[order.id] || { code: "------", expiresIn: 0 };
    return (
      <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        {[
          ["Tai khoan", order.assignedUsername],
          ["Mat khau", order.assignedPassword],
          ["Ma 2FA", order.assignedOtpSecret],
          ["Link", order.assignedLink],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-center gap-3">
            <span className="min-w-24 text-sm text-slate-400">{label}</span>
            <code className="flex-1 break-all rounded-xl bg-slate-900 px-3 py-2 text-sm text-white">{value || "--"}</code>
            {value ? (
              <button onClick={() => copyText(value, `Da copy ${label}`)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-slate-200">
                Copy
              </button>
            ) : null}
          </div>
        ))}
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <p className="text-sm text-slate-300">Cong cu lay ma 2FA tu secret nay, tu dong refresh moi 30 giay.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-slate-900 px-4 py-3 text-2xl font-bold tracking-[0.3em] text-cyan-300">{otp.code || "------"}</div>
            <span className="text-sm text-slate-400">{otp.expiresIn ? `Het han sau ${otp.expiresIn}s` : "Dang doi ma"}</span>
          </div>
        </div>
      </div>
    );
  };

  const orderCards = (
    <div className="space-y-5">
      {orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-center text-slate-400">Chua co don hang nao.</div>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{order.packageName}</h3>
                <p className="mt-1 text-sm text-slate-400">Don #{order.id} • {formatDateTime(order.createdAt)}</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-100">{formatStatusLabel(order.status)}</span>
            </div>
            <div className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Gia tien</p><p className="mt-1 font-semibold text-white">{formatMoney(order.amount)}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">MoMo order</p><p className="mt-1 font-semibold text-white">{order.momoOrderId || "--"}</p></div>
              <div className="rounded-2xl bg-slate-950/70 p-3"><p className="text-slate-500">Trang thai MoMo</p><p className="mt-1 font-semibold text-white">{order.momoMessage || "--"}</p></div>
            </div>
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
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Mua nick tu dong tu kho tong</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                He thong user rieng cho Goi 1 / Goi 2. Nick ban ra chi lay tu kho tong, khong dung vao kho market.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/" className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">Ve admin</a>
              {user ? (
                <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100">
                  <LogOut size={16} />
                  Dang xuat
                </button>
              ) : null}
            </div>
          </div>
          {user ? (
            <div className="mt-6 grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 sm:grid-cols-3">
              <div className="flex items-center gap-3"><User className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Nguoi dung</p><p className="font-semibold text-white">{user.fullName}</p></div></div>
              <div className="flex items-center gap-3"><Phone className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Zalo / SDT</p><p className="font-semibold text-white">{user.phone || "--"}</p></div></div>
              <div className="flex items-center gap-3"><Mail className="text-cyan-400" size={18} /><div><p className="text-xs text-slate-500">Email</p><p className="font-semibold text-white">{user.email}</p></div></div>
            </div>
          ) : null}
        </header>

        {message ? <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
        {error ? <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        {route.view === "reset-password" ? (
          <section className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="text-2xl font-semibold text-white">Dat lai mat khau</h2>
            <p className="mt-2 text-sm text-slate-400">Nhap mat khau moi cho tai khoan cua ban.</p>
            <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
              <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Mat khau moi" className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" />
              <div className="flex gap-3">
                <button type="button" onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="flex-1 rounded-2xl bg-slate-800 px-4 py-3 text-slate-200">Quay lai</button>
                <button type="submit" disabled={loading} className="flex-1 rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white disabled:opacity-60">Dat lai mat khau</button>
              </div>
            </form>
          </section>
        ) : (
          <>
            {!user ? authPanel : null}
            <section className="mt-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Goi dich vu</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Goi 1 / Goi 2 tu dong, Goi 3 lien he admin</h2>
                </div>
                {route.view === "payment-result" ? (
                  <button onClick={() => { setStoreRoute({ view: "home" }); refreshRouteState(); }} className="rounded-2xl bg-slate-800 px-4 py-3 text-sm text-slate-100">Ve trang mua hang</button>
                ) : null}
              </div>
              {packageCards}
            </section>

            <section className="mt-10 grid gap-8 xl:grid-cols-[1.4fr,0.8fr]">
              <div>
                <div className="mb-4">
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-400">Don hang</p>
                  <h2 className="mt-2 text-2xl font-bold text-white">Tai khoan da mua</h2>
                </div>
                {user ? orderCards : <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-8 text-slate-400">Dang nhap de xem don hang va nhan thong tin tai khoan.</div>}
                {route.view === "payment-result" ? (
                  <div className="mt-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                    <h3 className="text-lg font-semibold text-white">Ket qua thanh toan</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {currentPaymentOrder ? `Don #${currentPaymentOrder.id} dang o trang thai: ${formatStatusLabel(currentPaymentOrder.status)}` : "Dang tai thong tin don hang..."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                  <div className="mb-3 flex items-center gap-2 text-white"><KeyRound size={18} className="text-cyan-400" /><h3 className="text-lg font-semibold">Cong cu OTP</h3></div>
                  <p className="text-sm leading-6 text-slate-400">Dan TOTP secret de lay ma dang nhap. Goi 2 se tu dong refresh 30s, con o day ban co the test secret thu cong.</p>
                  <div className="mt-4 space-y-3">
                    <textarea value={manualSecret} onChange={(event) => setManualSecret(event.target.value)} placeholder="Dan ma 2FA secret vao day" className="min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-500" />
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-slate-950 px-4 py-3 text-2xl font-bold tracking-[0.35em] text-cyan-300">{manualOtp.code || "------"}</div>
                      <button onClick={async () => { try { const data = await apiRequest("/api/store/totp/generate", { method: "POST", body: { secret: manualSecret } }); setManualOtp({ code: String(data?.code || ""), expiresIn: Number(data?.expiresIn || 0) }); } catch (manualError) { setError(manualError.message || "Khong lay duoc OTP"); } }} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 font-semibold text-white">
                        <RefreshCw size={16} />
                        Lay ma
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
                  <h3 className="text-lg font-semibold text-white">Huong dan dang nhap Goi 2</h3>
                  <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <li>1. Mo ChatGPT va dang nhap bang TK / MK duoc cap.</li>
                    <li>2. Neu he thong yeu cau 2FA, copy TOTP secret va lay ma 6 so tren web.</li>
                    <li>3. Khong doi mat khau khi chua duoc huong dan bo sung.</li>
                    <li>4. Goi 1 chi nhan OTP 6 so, khong hien secret goc.</li>
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
