import axios from 'axios';

// Add request interceptor to include token in all requests
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token && !config.url.includes('/api/login')) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle 401 errors globally
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config.url.includes('/api/login')) {
      // Token expired or invalid
      localStorage.removeItem('admin_token');
      localStorage.removeItem('token_expires_at');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default axios;
