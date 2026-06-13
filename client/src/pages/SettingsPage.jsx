import { useState, useEffect } from 'react';
import { Settings, Save, Eye, EyeOff, RefreshCw } from 'lucide-react';
import api from '../lib/api';

export default function SettingsPage() {
  const [form, setForm] = useState({
    ADMIN_KEY: '',
    TELEGRAM_BOT_TOKEN: '',
    COURSERA_SHEET_SCRIPT_URL: '',
    SITE_NAME: '',
    ANTIGRAVITY_CLIENT_ID: '',
    ANTIGRAVITY_CLIENT_SECRET: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [showTg, setShowTg] = useState(false);
  const [showAgSecret, setShowAgSecret] = useState(false);

  useEffect(() => {
    api.get('/admin-api/settings')
      .then(res => {
        const s = res.data.settings || {};
        setForm({
          ADMIN_KEY: s.ADMIN_KEY || '',
          TELEGRAM_BOT_TOKEN: s.TELEGRAM_BOT_TOKEN || '',
          COURSERA_SHEET_SCRIPT_URL: s.COURSERA_SHEET_SCRIPT_URL || '',
          SITE_NAME: s.SITE_NAME || '',
          ANTIGRAVITY_CLIENT_ID: s.ANTIGRAVITY_CLIENT_ID || '',
          ANTIGRAVITY_CLIENT_SECRET: s.ANTIGRAVITY_CLIENT_SECRET || ''
        });
      })
      .catch(() => setMsg({ type: 'error', text: 'Lỗi tải settings.' }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.post('/admin-api/settings', form);
      setMsg({ type: 'success', text: '✅ Đã lưu settings thành công!' });
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Lỗi lưu settings.' });
    } finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" style={{ width: 32, height: 32 }} /></div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Settings size={22} />
          Cài đặt hệ thống
        </h1>
        <p>Cấu hình Admin Key, Telegram Bot, và các thông số khác</p>
      </div>

      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'} mb-4`}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Admin Key */}
        <div className="card reveal">
          <div className="card-header">
            <span className="card-title">🔑 Admin Key</span>
          </div>
          <div className="form-group">
            <label>Admin Key (dùng để đăng nhập dashboard)</label>
            <div className="password-wrapper">
              <input
                id="settings-admin-key"
                type={showKey ? 'text' : 'password'}
                value={form.ADMIN_KEY}
                onChange={e => set('ADMIN_KEY', e.target.value)}
                placeholder="Nhập admin key..."
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ⚠️ Sau khi đổi key, bạn cần đăng nhập lại bằng key mới.
            </span>
          </div>
        </div>

        {/* Telegram */}
        <div className="card reveal">
          <div className="card-header">
            <span className="card-title">📨 Telegram Bot</span>
          </div>
          <div className="form-group">
            <label>Bot Token (từ @BotFather)</label>
            <div className="password-wrapper">
              <input
                id="settings-telegram-token"
                type={showTg ? 'text' : 'password'}
                value={form.TELEGRAM_BOT_TOKEN}
                onChange={e => set('TELEGRAM_BOT_TOKEN', e.target.value)}
                placeholder="1234567890:ABCdef..."
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowTg(!showTg)}
              >
                {showTg ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>

        {/* Coursera Sheet */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📊 Coursera Google Sheet URL</span>
          </div>
          <div className="form-group">
            <label>Script URL (Google Apps Script)</label>
            <input
              id="settings-coursera-url"
              type="url"
              value={form.COURSERA_SHEET_SCRIPT_URL}
              onChange={e => set('COURSERA_SHEET_SCRIPT_URL', e.target.value)}
              placeholder="https://script.google.com/macros/s/..."
            />
          </div>
        </div>

        {/* Site Name */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">🌐 Tên Website</span>
          </div>
          <div className="form-group">
            <label>Site Name</label>
            <input
              id="settings-site-name"
              value={form.SITE_NAME}
              onChange={e => set('SITE_NAME', e.target.value)}
              placeholder="VD: CodeX Portal"
            />
          </div>
        </div>

        {/* AntiGravity Google OAuth Settings */}
        <div className="card reveal ag-accent-border">
          <div className="card-header">
            <span className="card-title" style={{ color: '#e0a82e' }}>🪐 AntiGravity Google OAuth (Gemini Code Assist)</span>
          </div>
          <div className="form-group">
            <label>Google Client ID</label>
            <input
              id="settings-antigravity-client-id"
              value={form.ANTIGRAVITY_CLIENT_ID}
              onChange={e => set('ANTIGRAVITY_CLIENT_ID', e.target.value)}
              placeholder="1234567890-xyz.apps.googleusercontent.com..."
            />
          </div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Google Client Secret</label>
            <div className="password-wrapper">
              <input
                id="settings-antigravity-client-secret"
                type={showAgSecret ? 'text' : 'password'}
                value={form.ANTIGRAVITY_CLIENT_SECRET}
                onChange={e => set('ANTIGRAVITY_CLIENT_SECRET', e.target.value)}
                placeholder="GOCSPX-..."
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowAgSecret(!showAgSecret)}
              >
                {showAgSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8, display: 'block' }}>
            ℹ️ Cấu hình thông tin ứng dụng Google OAuth để tự động liên kết tài khoản và onboarding dự án xoay vòng phím Google Gemini.
          </span>
        </div>

        <button
          id="settings-save-btn"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ alignSelf: 'flex-start' }}
        >
          {saving ? <><span className="spinner" /> Đang lưu...</> : <><Save size={14} /> Lưu cài đặt</>}
        </button>
      </div>
    </div>
  );
}
