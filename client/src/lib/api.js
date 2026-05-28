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

// On 401, redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 || err.response?.status === 403) {
      localStorage.removeItem('adminKey');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
