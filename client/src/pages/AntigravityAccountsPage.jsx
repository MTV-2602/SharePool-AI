import { useState, useEffect, useCallback } from 'react';
import { Bot, Trash2, RefreshCw, Search, Plus, X, Edit2, Check } from 'lucide-react';
import api from '../lib/api';

// Sub-component for individual account card displaying model quotas
function AntigravityAccountCard({ acc, onDelete, onUpdate, globalRefreshTrigger, onEditClick }) {
  const [quotas, setQuotas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [localRefreshTrigger, setLocalRefreshTrigger] = useState(0);

  const fetchQuota = async () => {
    // If account is not active, do not query quota to avoid unnecessary 401/403 errors
    if (!acc.isActive) {
      setQuotas([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/antigravity-admin-api/accounts/${acc.id}/quota`);
      if (res.data.ok) {
        setQuotas(res.data.quotas || []);
      }
    } catch (e) {
      const errData = e.response?.data?.error;
      const errMsg = typeof errData === 'object' ? errData.message : errData;
      setError(errMsg || e.message || 'Lỗi tải quota');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, [acc.id, acc.isActive, globalRefreshTrigger, localRefreshTrigger]);

  const handleToggleActive = async () => {
    try {
      const nextActive = !acc.isActive;
      await api.patch(`/antigravity-admin-api/accounts/${acc.id}`, {
        isActive: nextActive
      });
      onUpdate();
    } catch (e) {
      alert('Không thể cập nhật trạng thái hoạt động: ' + e.message);
    }
  };

  const formatRemainingTime = (dateStr) => {
    if (!dateStr) return '';
    const diff = new Date(dateStr) - new Date();
    if (diff <= 0) return '';
    const totalMins = Math.ceil(diff / 60000);
    if (totalMins < 60) return `${totalMins}m`;
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours < 24) return `${hours}h ${mins}m`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${mins}m`;
  };

  const renderStatusBadge = () => {
    if (!acc.isActive) return <span className="badge badge-gray" style={{ backgroundColor: '#374151', color: '#9ca3af' }}>Đã tắt</span>;
    if (acc.status === 'failed') return <span className="badge badge-red">Lỗi</span>;
    if (acc.status === 'cooldown') return <span className="badge badge-yellow">Cooldown</span>;
    if (acc.status === 'active') return <span className="badge badge-green">Hoạt động</span>;
    return <span className="badge badge-gray">Chờ</span>;
  };

  return (
    <div className="card" style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      border: '1px solid var(--border, #2d3748)',
      background: 'var(--surface, #1a202c)',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #e0a82e 0%, #f59e0b 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000',
            fontWeight: 800,
            fontSize: '1rem'
          }}>
            A
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{acc.email}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              Project: <code style={{ fontFamily: 'monospace', color: '#e0a82e' }}>{acc.projectId || '—'}</code>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-xs btn-icon" onClick={() => setLocalRefreshTrigger(t => t + 1)} title="Làm mới Quota" disabled={loading || !acc.isActive}>
            <RefreshCw size={13} className={loading ? 'spin-anim' : ''} />
          </button>
          <button className="btn btn-ghost btn-xs btn-icon" onClick={() => onEditClick(acc)} title="Sửa tên / Project ID">
            <Edit2 size={13} style={{ color: 'var(--text-muted)' }} />
          </button>
          <button className="btn btn-ghost btn-xs btn-icon" onClick={() => onDelete(acc.id)} title="Xóa tài khoản">
            <Trash2 size={13} style={{ color: 'var(--red)' }} />
          </button>
          
          {/* Toggle Switch */}
          <label className="switch-wrapper ag" title={acc.isActive ? 'Gạt để tắt tài khoản' : 'Gạt để bật tài khoản'}>
            <input 
              type="checkbox" 
              checked={!!acc.isActive} 
              onChange={handleToggleActive}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </div>

      {/* Quotas Progress list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 80 }}>
        {!acc.isActive ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Tài khoản đã tắt. Hãy gạt switch để kích hoạt lại.
          </div>
        ) : loading && quotas.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80 }}>
            <span className="spinner" style={{ borderLeftColor: '#e0a82e' }} />
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', height: 80, color: 'var(--red)', fontSize: '0.8rem', textAlign: 'center' }}>
            <span style={{ wordBreak: 'break-word' }}>⚠️ {error}</span>
            <button className="btn btn-ghost btn-xs" onClick={fetchQuota} style={{ alignSelf: 'center', border: '1px solid var(--border)' }}>Thử lại 🔄</button>
          </div>
        ) : quotas.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
            Không lấy được quota. Đảm bảo API Cloud Code đã được bật trên project của bạn.
          </div>
        ) : (
          quotas.map(quota => {
            const pct = quota.remainingPercentage;
            // Green if > 70%, Yellow if >= 30%, Red if < 30%
            const progressColor = pct > 70 ? '#10b981' : pct >= 30 ? '#f59e0b' : '#ef4444';
            const emoji = pct > 70 ? '🟢' : pct >= 30 ? '🟡' : '🔴';
            const countdown = formatRemainingTime(quota.resetAt);

            return (
              <div key={quota.modelKey} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', fontWeight: 600 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
                    <span>{emoji}</span>
                    {quota.name}
                  </span>
                  <span style={{ color: pct >= 30 ? 'var(--text-primary)' : progressColor }}>{pct}%</span>
                </div>
                
                {/* Progress bar and values */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--border, #2d3748)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: progressColor, borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', minWidth: 50, textAlign: 'right', fontFamily: 'monospace' }}>
                    {quota.used.toLocaleString()} / {quota.total.toLocaleString()}
                  </span>
                </div>

                {countdown && (
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 1 }}>
                    in {countdown}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border, #2d3748)',
        paddingTop: 10,
        marginTop: 4
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {renderStatusBadge()}
        </span>
        <span>
          Dùng cuối: {acc.lastUsedAt ? new Date(acc.lastUsedAt).toLocaleString('vi-VN') : 'Chưa dùng'}
        </span>
      </div>
    </div>
  );
}

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

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ id: '', name: '', projectId: '' });
  const [editing, setEditing] = useState(false);

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

  const handleEditAccount = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim() || !editForm.projectId.trim()) {
      alert('Vui lòng điền đầy đủ thông tin!');
      return;
    }
    setEditing(true);
    try {
      await api.patch(`/antigravity-admin-api/accounts/${editForm.id}`, {
        name: editForm.name.trim(),
        projectId: editForm.projectId.trim()
      });
      setMsg({ type: 'success', text: 'Cập nhật tài khoản thành công!' });
      setShowEditModal(false);
      fetchAccounts();
    } catch (err) {
      alert(err.response?.data?.error?.message || err.message || 'Lỗi cập nhật.');
    } finally {
      setEditing(false);
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
    if (statusFilter === 'active') return matchesSearch && (acc.isActive && acc.status !== 'failed');
    if (statusFilter === 'failed') return matchesSearch && (!acc.isActive || acc.status === 'failed');
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
            { label: 'Bị lỗi / Tắt', value: stats.failed, color: 'var(--red)' }
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
            <option value="active">Hoạt động / Sẵn sàng</option>
            <option value="cooldown">Cooldown</option>
            <option value="failed">Lỗi / Đã tắt</option>
          </select>
        </div>
      </div>

      {/* Accounts List Card Grid */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Không tìm thấy tài khoản nào.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: '20px',
          marginTop: '16px'
        }}>
          {filtered.map(acc => (
            <AntigravityAccountCard 
              key={acc.id} 
              acc={acc} 
              onDelete={handleDelete} 
              onUpdate={fetchAccounts}
              globalRefreshTrigger={loading}
              onEditClick={(acc) => {
                setEditForm({ id: acc.id, name: acc.name, projectId: acc.projectId });
                setShowEditModal(true);
              }}
            />
          ))}
        </div>
      )}

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

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ borderColor: 'rgba(224, 168, 46, 0.3)' }}>
            <div className="modal-header">
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e0a82e' }}>
                <Edit2 size={16} /> Chỉnh sửa thông tin tài khoản
              </span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowEditModal(false)}>
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleEditAccount} style={{ display: 'grid', gap: 14 }}>
              <div className="form-group">
                <label>Tên hiển thị *</label>
                <input
                  type="text"
                  placeholder="Nhập tên hiển thị..."
                  value={editForm.name}
                  onChange={e => setEditForm(v => ({ ...v, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Project ID *</label>
                <input
                  type="text"
                  placeholder="Nhập Project ID..."
                  value={editForm.projectId}
                  onChange={e => setEditForm(v => ({ ...v, projectId: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowEditModal(false)}>Hủy</button>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: '#e0a82e', borderColor: '#e0a82e' }} disabled={editing}>
                  {editing ? <><span className="spinner" /> Đang lưu...</> : <><Check size={14} /> Lưu thay đổi</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
