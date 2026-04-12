import { Component, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import HotmailReader from "./HotmailReader.jsx";
import PublicStorefront from "./PublicStorefront.jsx";

const STORE_TOKEN_KEY = "store_user_token";
const ADMIN_TOKEN_KEY = "admin_token";
const ADMIN_TOKEN_EXPIRES_AT_KEY = "token_expires_at";
const SESSION_ROLE_KEY = "active_session_role";

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

const clearStoredAdminSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_EXPIRES_AT_KEY);
};

const clearStoredStoreSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORE_TOKEN_KEY);
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

function SessionBootScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 text-slate-100"
      style={{ backgroundColor: "#0f172a" }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-cyan-500/20 bg-slate-900/90 p-8 shadow-2xl text-center">
        <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">
          Đang khởi tạo phiên
        </div>
        <h1 className="mt-3 text-3xl font-black text-white">
          Hệ thống đang kiểm tra vai trò đăng nhập
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          App sẽ tự nhận diện bạn đang là admin hay user và chuyển tới đúng
          trang, tránh bị lẫn hai phiên trong cùng một trình duyệt.
        </p>
      </div>
    </div>
  );
}

function SessionRouter() {
  const [mode, setMode] = useState("");

  useEffect(() => {
    const pathname =
      typeof window !== "undefined"
        ? window.location.pathname.toLowerCase()
        : "/";
    const onStoreRoute = pathname.startsWith("/store");
    const onHotmailReaderRoute = pathname.startsWith("/hotmail-reader");
    const sessionRole = readStoredSessionRole();
    const storeToken = String(localStorage.getItem(STORE_TOKEN_KEY) || "").trim();
    const hasStoreSession = !!storeToken;
    const hasAdminSession = hasValidStoredAdminSession();

    if (onHotmailReaderRoute) {
      setMode("hotmail-reader");
      return;
    }

    if (sessionRole === "user" && hasStoreSession) {
      clearStoredAdminSession();
      if (!onStoreRoute) {
        window.location.replace("/store");
        return;
      }
      setMode("store");
      return;
    }

    if (sessionRole === "admin" && hasAdminSession) {
      clearStoredStoreSession();
      if (onStoreRoute) {
        window.location.replace("/");
        return;
      }
      setMode("admin");
      return;
    }

    if (hasStoreSession && !hasAdminSession) {
      writeStoredSessionRole("user");
      if (!onStoreRoute) {
        window.location.replace("/store");
        return;
      }
      setMode("store");
      return;
    }

    if (hasAdminSession && !hasStoreSession) {
      writeStoredSessionRole("admin");
      if (onStoreRoute) {
        window.location.replace("/");
        return;
      }
      setMode("admin");
      return;
    }

    if (hasStoreSession && hasAdminSession) {
      if (onStoreRoute) {
        clearStoredAdminSession();
        writeStoredSessionRole("user");
        setMode("store");
        return;
      }
      clearStoredStoreSession();
      writeStoredSessionRole("admin");
      setMode("admin");
      return;
    }

    writeStoredSessionRole("");
    setMode(onStoreRoute ? "store" : "admin");
  }, []);

  if (!mode) {
    return <SessionBootScreen />;
  }

  const ActiveComponent =
    mode === "store"
      ? PublicStorefront
      : mode === "hotmail-reader"
        ? HotmailReader
        : App;
  return <ActiveComponent />;
}

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "Đã xảy ra lỗi render không mong muốn.",
    };
  }

  componentDidCatch(error, info) {
    console.error("Root render crashed", error, info);
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-4 text-slate-100"
          style={{ backgroundColor: "#0f172a" }}
        >
          <div className="w-full max-w-xl rounded-3xl border border-red-500/30 bg-slate-900/90 p-8 shadow-2xl">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-red-300">
              Lỗi giao diện
            </div>
            <h1 className="mt-3 text-3xl font-black text-white">
              Trang vừa bị lỗi render
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              App đã chặn lỗi để không hiện màn hình trắng. Bạn thử tải lại
              trang. Nếu lỗi còn lặp lại, hãy gửi lại ảnh chụp màn hình này cho
              mình.
            </p>
            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-300 break-all">
              {this.state.message || "Không có thông điệp lỗi chi tiết."}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="rounded-2xl bg-cyan-600 px-5 py-3 font-bold text-white transition-colors hover:bg-cyan-500"
              >
                Tải lại trang
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RootErrorBoundary>
      <SessionRouter />
    </RootErrorBoundary>
  </StrictMode>,
);
