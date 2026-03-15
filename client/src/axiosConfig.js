import axios from "axios";

const API_ACTIVITY_EVENT = "codex:api-activity";

const emitApiActivity = (detail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(API_ACTIVITY_EVENT, { detail }));
};

export const subscribeToApiActivity = (listener) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(API_ACTIVITY_EVENT, listener);
  return () => window.removeEventListener(API_ACTIVITY_EVENT, listener);
};

// Add request interceptor to include token in all requests
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("admin_token");
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    config.__requestId = requestId;
    config.__skipGlobalLoading = config.skipGlobalLoading === true;
    if (!config.__skipGlobalLoading) {
      const originalUploadProgress = config.onUploadProgress;
      const originalDownloadProgress = config.onDownloadProgress;
      config.onUploadProgress = (event) => {
        emitApiActivity({
          type: "progress",
          requestId,
          phase: "upload",
          loaded: event?.loaded || 0,
          total: event?.total || 0,
        });
        if (typeof originalUploadProgress === "function") {
          originalUploadProgress(event);
        }
      };
      config.onDownloadProgress = (event) => {
        emitApiActivity({
          type: "progress",
          requestId,
          phase: "download",
          loaded: event?.loaded || 0,
          total: event?.total || 0,
        });
        if (typeof originalDownloadProgress === "function") {
          originalDownloadProgress(event);
        }
      };
      emitApiActivity({
        type: "start",
        requestId,
        method: String(config.method || "get").toUpperCase(),
        url: String(config.url || ""),
        label: config.requestLabel || "",
      });
    }
    // Only add Authorization header if token exists AND not login endpoint
    if (
      token &&
      !config.url.includes("/api/login") &&
      !config.url.includes("/api/telegram-webhook")
    ) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Add response interceptor to handle 401 errors globally
axios.interceptors.response.use(
  (response) => {
    const requestId = response?.config?.__requestId;
    if (requestId && !response?.config?.__skipGlobalLoading) {
      emitApiActivity({
        type: "finish",
        requestId,
        ok: true,
      });
    }
    return response;
  },
  (error) => {
    const requestId = error?.config?.__requestId;
    if (requestId && !error?.config?.__skipGlobalLoading) {
      emitApiActivity({
        type: "finish",
        requestId,
        ok: false,
        error: error?.message || "Request failed",
      });
    }
    if (
      error.response?.status === 401 &&
      !error.config.url.includes("/api/login")
    ) {
      // Token expired or invalid
      localStorage.removeItem("admin_token");
      localStorage.removeItem("token_expires_at");
      window.location.reload();
    }
    return Promise.reject(error);
  },
);

export default axios;
