import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../lib/api';
import './LoginPage.css'; // Reuse login styling

export default function AntigravityLoginPage() {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'AntiGravity Portal';
    let faviconEl = document.querySelector('link[rel="icon"]');
    if (faviconEl) {
      faviconEl.setAttribute('type', 'image/svg+xml');
      faviconEl.setAttribute('href', '/favicon.svg');
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    try {
      localStorage.setItem('adminKey', key.trim());
      // Try admin verify first
      try {
        await api.get('/antigravity-admin-api/stats');
        localStorage.setItem('role', 'admin');
        navigate('/antigravity/dashboard');
      } catch (errAdmin) {
        // If admin check fails, try user verify
        try {
          await api.post('/antigravity-user-api/login', { key: key.trim() });
          localStorage.setItem('role', 'user');
          navigate('/antigravity/dashboard');
        } catch (errUser) {
          throw errUser; // Bubble up
        }
      }
    } catch (err) {
      localStorage.removeItem('adminKey');
      localStorage.removeItem('role');
      const msg = err.response?.data?.error?.message || err.response?.data?.error || err.message || 'Lỗi kết nối server';
      setError(`Đăng nhập thất bại: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg ag-login-bg" />
      <div className="login-noise" aria-hidden="true" />
      <div className="login-card ag-login-card">
        <div className="login-logo ag-login-logo">
          <Rocket size={28} />
        </div>
        <h1 className="login-title">AntiGravity Portal</h1>
        <p className="login-sub">Nhập Admin Key hoặc AntiGravity API Key để tiếp tục</p>

        <form onSubmit={handleLogin} className="login-form" aria-label="Form đăng nhập AntiGravity">
          <div className="form-group">
            <label htmlFor="admin-key-input">Admin Key / API Key</label>
            <div className="input-wrapper">
              <Lock size={15} className="input-icon" />
              <input
                id="admin-key-input"
                type={show ? 'text' : 'password'}
                placeholder="agk-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="input-toggle"
                onClick={() => setShow(!show)}
                tabIndex={-1}
              >
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error">{error}</div>
          )}

          <button
            id="login-submit-btn"
            type="submit"
            className="btn btn-primary ag-accent-bg w-full"
            disabled={loading || !key.trim()}
          >
            {loading ? <span className="spinner" /> : <Lock size={15} />}
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
