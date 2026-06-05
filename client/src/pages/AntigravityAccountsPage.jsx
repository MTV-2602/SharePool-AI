import { useState, useEffect, useCallback } from 'react';
import { Bot, Trash2, RefreshCw, Search, Plus, X } from 'lucide-react';
import api from '../lib/api';

export default function AntigravityAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ total: 0, available: 0, cooldown: 0, failed: 0 });

  // OAuth State
  const [oauthState, setOauthState] = useState(null);
  const [oauthStep, setOauthStep] = useState(null); // 'authorizing' | 'exchanging' | 'completed' | 'failed'
  const [oauthError, setOauthError] = useState('');

  // Manual Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importForm, setImportForm] = useState({ email: '', refreshToken: '', projectId: '' });
  const [importing, setImporting] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/antigravity-admin-api/stats');
      setAccounts(res.data.accounts?.details || []);
      setStats({
        total: res.data.accounts?.total || 0,
        available: res.data.accounts?.available || 0,
        cooldown: res.data.accounts?.cooldown || 0,
        failed: res.data.accounts?.failed || 0
      });
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải danh sách tài khoản Antigravity.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = async (id) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tài khoản này khỏi hệ thống xoay vòng?')) return;
    try {
      await api.delete(`/antigravity-admin-api/accounts/${id}`);
      setMsg({ type: 'success', text: 'Đã xóa tài khoản thành công.' });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Xóa thất bại.' });
    }
  };

  // Google OAuth flow initiation
  const handleConnectGoogle = async () => {
    setOauthStep('authorizing');
    setOauthError('');
    try {
      const res = await api.get('/antigravity-admin-api/oauth/google/authorize');
      const { authUrl, state } = res.data;
      setOauthState(state);

      // Open OAuth popup
      const width = 600, height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(
        authUrl,
        'Google OAuth',
        `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
      );
    } catch (err) {
      setOauthStep(null);
      setMsg({ type: 'error', text: 'Không thể khởi tạo phiên OAuth.' });
    }
  };

  const handleManualImport = async (e) => {
    e.preventDefault();
    if (!importForm.email.trim() || !importForm.refreshToken.trim() || !importForm.projectId.trim()) {
      alert('Vui lòng nhập đầy đủ thông tin!');
      return;
    }
    setImporting(true);
    try {
      await api.post('/antigravity-admin-api/accounts/import-manual', {
        email: importForm.email.trim(),
        refreshToken: importForm.refreshToken.trim(),
        projectId: importForm.projectId.trim()
      });
      setMsg({ type: 'success', text: 'Thêm tài khoản thủ công thành công!' });
      setShowImportModal(false);
      setImportForm({ email: '', refreshToken: '', projectId: '' });
      fetchAccounts();
    } catch (err) {
      alert(err.response?.data?.error?.message || err.message || 'Lỗi thêm tài khoản.');
    } finally {
      setImporting(false);
    }
  };

  // Poll for OAuth status
  useEffect(() => {
    if (!oauthState || !oauthStep || oauthStep === 'completed' || oauthStep === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/antigravity-admin-api/oauth/google/poll-status`, {
          params: { state: oauthState }
        });
        
        const status = res.data.status;
        if (status === 'completed') {
          setOauthStep('completed');
          clearInterval(interval);
          setOauthState(null);
          setMsg({ type: 'success', text: `Đã kết nối tài khoản Google ${res.data.email || ''} thành công!` });
          fetchAccounts();
          setTimeout(() => setOauthStep(null), 3000);
        } else if (status === 'failed') {
          setOauthStep('failed');
          setOauthError(res.data.error || 'Yêu cầu ủy quyền bị từ chối.');
          clearInterval(interval);
          setOauthState(null);
        } else if (status === 'exchanging') {
          setOauthStep('exchanging');
        }
      } catch (err) {
        // Ignore polling errors transiently
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [oauthState, oauthStep, fetchAccounts]);

  const filtered = accounts.filter(acc => {
    const term = (search || '').toLowerCase();
    const email = (acc.email || '').toLowerCase();
    const name = (acc.name || '').toLowerCase();
    const matchesSearch = email.includes(term) || name.includes(term);
    if (statusFilter === 'all') return matchesSearch;
    return matchesSearch && acc.status === statusFilter;
  });

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bot size={22} style={{ color: '#e0a82e' }} />
            AntiGravity Accounts Pool
          </h1>
          <p>Danh sách các tài khoản Google kết nối xoay vòng cho Gemini Code Assist</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImportModal(true)} style={{ color: '#e0a82e', borderColor: '#e0a82e', border: '1px solid' }}>
            <Plus size={14} /> Nhập thủ công
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleConnectGoogle} style={{ backgroundColor: '#e0a82e', borderColor: '#e0a82e' }}>
            <Plus size={14} /> Thêm tài khoản Google (OAuth)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={fetchAccounts} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
          </button>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* OAuth overlay card */}
      {oauthStep && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid rgba(224, 168, 46, 0.3)', background: 'rgba(224, 168, 46, 0.03)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {oauthStep !== 'failed' && oauthStep !== 'completed' && <span className="spinner" style={{ borderLeftColor: '#e0a82e' }} />}
            <div>
              <strong style={{ display: 'block', fontSize: '0.95rem' }}>
                {oauthStep === 'authorizing' && 'Đang chờ xác thực tài khoản Google...'}
                {oauthStep === 'exchanging' && 'Đang liên kết tài khoản Google & Cấu hình dịch vụ...'}
                {oauthStep === 'completed' && '✨ Kết nối thành công!'}
                {oauthStep === 'failed' && '❌ Lỗi kết nối'}
              </strong>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {oauthStep === 'authorizing' && 'Vui lòng hoàn thành quá trình đăng nhập và cho phép các quyền trong cửa sổ Google vừa mở.'}
                {oauthStep === 'exchanging' && 'Đang tải thông tin Project ID và kích hoạt Companion API của Google.'}
                {oauthStep === 'completed' && 'Tài khoản Google đã sẵn sàng hoạt động trong hệ thống xoay vòng.'}
                {oauthStep === 'failed' && `Thao tác thất bại: ${oauthError}`}
              </span>
            </div>
            {oauthStep === 'failed' && (
              <button className="btn btn-ghost btn-xs" onClick={() => setOauthStep(null)} style={{ marginLeft: 'auto' }}>Đóng</button>
            )}
          </div>
        </div>
      )}

      {/* Summary grid */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          {[
            { label: 'Tổng số', value: stats.total, color: 'var(--text-primary)' },
            { label: 'Hoạt động', value: stats.available, color: 'var(--green)' },
            { label: 'Cooldown', value: stats.cooldown, color: 'var(--yellow)' },
            { label: 'Bị lỗi', value: stats.failed, color: 'var(--red)' }
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Search filters */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <input
              placeholder="Tìm theo email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 12 }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Active / Loaded</option>
            <option value="cooldown">Cooldown</option>
            <option value="failed">Failed / Lỗi</option>
          </select>
        </div>
      </div>

      {/* Accounts List Table */}
      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Project ID</th>
                <th>Trạng thái</th>
                <th>Lỗi cuối</th>
                <th>Hoạt động cuối</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    Không tìm thấy tài khoản nào.
                  </td>
                </tr>
              ) : (
                filtered.map(acc => {
                  const cooldownText = acc.cooldownRemaining > 0 
                    ? ` (hồi sau ${Math.ceil(acc.cooldownRemaining / 60000)}p)`
                    : '';
                  return (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{acc.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{acc.email}</div>
                      </td>
                      <td>
                        <code className="font-mono">{acc.projectId || '—'}</code>
                      </td>
                      <td>
                        {acc.status === 'failed' && <span className="badge badge-red">Lỗi</span>}
                        {acc.status === 'cooldown' && <span className="badge badge-yellow">Cooldown{cooldownText}</span>}
                        {acc.status === 'active' && <span className="badge badge-green">Hoạt động</span>}
                        {acc.status === 'loaded' && <span className="badge badge-gray">Chờ</span>}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={acc.lastError}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--red)' }}>{acc.lastError || '—'}</span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {acc.lastUsedAt ? new Date(acc.lastUsedAt).toLocaleString('vi-VN') : 'Chưa sử dụng'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-xs btn-icon text-red" onClick={() => handleDelete(acc.id)} title="Xóa tài khoản">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ borderColor: 'rgba(224, 168, 46, 0.3)' }}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e0a82e' }}>
                <Bot size={16} /> Nhập tài khoản Google thủ công
              </span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowImportModal(false)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleManualImport} style={{ display: 'grid', gap: 14 }}>
              <div className="form-group">
                <label>Email tài khoản Google *</label>
                <input
                  type="email"
                  placeholder="VD: team89a6@gmail.com"
                  value={importForm.email}
                  onChange={e => setImportForm(v => ({ ...v, email: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>OAuth Refresh Token *</label>
                <input
                  type="text"
                  placeholder="Nhập refresh_token (lấy từ local 9router hoặc VS Code)..."
                  value={importForm.refreshToken}
                  onChange={e => setImportForm(v => ({ ...v, refreshToken: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>Project ID *</label>
                <input
                  type="text"
                  placeholder="VD: ninth-bonfire-447406-t7"
                  value={importForm.projectId}
                  onChange={e => setImportForm(v => ({ ...v, projectId: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: '#e0a82e', borderColor: '#e0a82e' }} disabled={importing}>
                  {importing ? <><span className="spinner" /> Đang thêm...</> : <><Plus size={14} /> Thêm tài khoản</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
