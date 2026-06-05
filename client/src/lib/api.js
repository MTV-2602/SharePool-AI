import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Inject admin or user key from localStorage on every request
api.interceptors.request.use((config) => {
  const adminKey = localStorage.getItem('adminKey');
  if (adminKey) {
    config.headers['x-admin-key'] = adminKey;
    config.headers['x-api-key'] = adminKey;
  }
  return config;
});

// On 401 or 403, redirect to login unless we are already logging in
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isLoginPath = window.location.pathname === '/login' || window.location.pathname === '/antigravity/login';
    const isAuthRequest = err.config?.url?.includes('/login') || err.config?.url?.includes('/stats');

    if ((err.response?.status === 401 || err.response?.status === 403) && !isLoginPath && !isAuthRequest) {
      localStorage.removeItem('adminKey');
      localStorage.removeItem('role');
      if (window.location.pathname.startsWith('/antigravity')) {
        window.location.href = '/antigravity/login';
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
