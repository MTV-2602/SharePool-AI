import { useState, useEffect, useCallback, useRef } from 'react';
import { Bot, Upload, Plus, Trash2, RefreshCw, Edit2, Check, X, KeyRound, Copy, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../lib/api';

const TABS = ['Pool Tài khoản', 'Nhập thủ công', 'Acc AutoReg (Email/Pass)'];

// ─── TOTP Helper Functions for 2FA ───────────────────────────────────────────
function base32tohex(base32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", hex = "";
  for (let i = 0; i < base32.length; i++) {
    const v = chars.indexOf(base32.charAt(i).toUpperCase());
    if (v !== -1) bits += v.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.substr(i, 4), 2).toString(16);
  return hex;
}

async function getTOTP(secret) {
  try {
    const hex = base32tohex(secret.replace(/\s/g, ''));
    const time = Math.floor(Math.floor(Date.now() / 1000) / 30).toString(16).padStart(16, "0");
    const timeBuffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) timeBuffer[i] = parseInt(time.substr(i * 2, 2), 16);
    const keyBuffer = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length / 2; i++) keyBuffer[i] = parseInt(hex.substr(i * 2, 2), 16);
    const key = await window.crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: { name: "SHA-1" } }, false, ["sign"]);
    const hmac = new Uint8Array(await window.crypto.subtle.sign("HMAC", key, timeBuffer));
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return (code % 1000000).toString().padStart(6, "0");
  } catch (e) { console.error("TOTP error", e); return null; }
}

function TwoFactorCell({ secret }) {
  const [otp, setOtp] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateOtp = async () => {
    if (!secret) return;
    setLoading(true);
    try {
      const code = await getTOTP(secret);
      if (code) {
        setOtp(code);
        navigator.clipboard.writeText(code).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
        setTimeLeft(remaining);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!otp) return;
    const interval = setInterval(() => {
      const rem = 30 - (Math.floor(Date.now() / 1000) % 30);
      if (rem <= 0 || rem > 30) {
        generateOtp();
      } else {
        setTimeLeft(rem);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [otp, secret]);

  if (!secret) return <span style={{ color: 'var(--text-muted)' }}>—</span>;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <code style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }} title={secret}>
        {secret.slice(0, 12)}...
      </code>
      {otp ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              background: 'var(--green)',
              color: '#000',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'inline-block'
            }}
            onClick={generateOtp}
            title="Bấm để copy lại mã OTP mới"
          >
            {otp}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            ({timeLeft}s)
          </span>
          {copied && <span style={{ fontSize: '0.65rem', color: 'var(--green)' }}>Đã copy</span>}
        </div>
      ) : (
        <button
          className="btn btn-ghost btn-xs"
          onClick={generateOtp}
          disabled={loading}
          style={{
            padding: '2px 6px',
            fontSize: '0.68rem',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text-secondary)'
          }}
        >
          {loading ? 'Đang lấy...' : '🔑 Lấy mã OTP'}
        </button>
      )}
    </div>
  );
}

export default function ChatGPTPage() {
  const [tab, setTab] = useState(0);
  return (
    <div>
      <div className="page-header">
        <h1>
          <Bot size={22} className="icon-green" />
          ChatGPT Accounts
        </h1>
        <p>Quản lý pool tài khoản ChatGPT upstream (Xoay key)</p>
      </div>
      <div className="tab-nav">
        {TABS.map((t, i) => (
          <button key={t} className={`tab-btn ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
            {i === 0 ? <Bot size={14} /> : i === 1 ? <Upload size={14} /> : <KeyRound size={14} />}
            {t}
          </button>
        ))}
      </div>
      {tab === 0 && <ChatGPTPool />}
      {tab === 1 && <ChatGPTBulkImport />}
      {tab === 2 && <AutoRegCredentials />}
    </div>
  );
}

// ─── Account Quota Cell ────────────────────────────────────────────────────────
function AccountQuotaCell({ accountName, sessionToken }) {
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchQuota = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use POST with a request body to completely avoid URL length and character restrictions
      const res = await api.post('/admin-api/accounts/quota', {
        name: accountName,
        sessionToken
      });
      if (res.data.ok) {
        setQuota(res.data);
      } else {
        setError('Lỗi tải');
      }
    } catch (e) {
      const errData = e.response?.data?.error;
      const errMsg = typeof errData === 'object' ? errData.message : errData;
      setError(errMsg || e.message || 'Lỗi kết nối');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuota();
  }, [accountName, sessionToken]);

  if (loading) return <span className="text-xs text-muted" style={{ fontSize: '0.72rem' }}>Đang tải...</span>;
  if (error) {
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--red)', fontSize: '0.72rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 2 }}
        title={error}
        onClick={fetchQuota}
      >
        Lỗi 🔄
      </span>
    );
  }
  if (!quota) {
    return (
      <button className="btn btn-ghost btn-xs" onClick={fetchQuota} style={{ padding: '2px 6px', fontSize: '0.7rem' }}>
        Xem Quota
      </button>
    );
  }

  const { plan, limits = [] } = quota;

  const renderLimitItem = (lim) => {
    const remaining = lim.remaining;
    const progressColor = remaining > 70 ? '#10b981' : remaining > 30 ? '#f59e0b' : '#ef4444';

    let resetText = '';
    if (lim.resetAt) {
      const resetDate = new Date(lim.resetAt);
      const diffMs = resetDate.getTime() - Date.now();
      if (diffMs > 0) {
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHrs = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (diffDays > 0) {
          resetText = `Reset in ${diffDays}d ${diffHrs}h`;
        } else {
          resetText = `Reset in ${diffHrs}h ${diffMins}m`;
        }
      }
    }

    return (
      <div key={lim.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontWeight: 600 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{lim.name || 'Quota'}</span>
          <span style={{ color: remaining > 30 ? 'var(--text-primary)' : progressColor }}>{remaining}% left</span>
        </div>
        <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${remaining}%`, height: '100%', background: progressColor, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
        {resetText && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{resetText}</span>}
      </div>
    );
  };

  const activeLimits = limits.length > 0 ? limits : [ { id: 'default', name: 'Quota', remaining: quota.quota?.remaining ?? 100, resetAt: quota.quota?.resetAt } ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 130 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)' }}>
        {plan}
      </div>
      {activeLimits.map(renderLimitItem)}
    </div>
  );
}

// ─── Cooldown Timer Component ─────────────────────────────────────────────────
function CooldownTimer({ initialMs }) {
  const [remaining, setRemaining] = useState(initialMs);

  useEffect(() => {
    setRemaining(initialMs);
  }, [initialMs]);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setInterval(() => {
      setRemaining(r => {
        const next = r - 1000;
        if (next <= 0) {
          clearInterval(t);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [remaining]);

  if (remaining <= 0) return null;

  const s = Math.floor(remaining / 1000);
  let text = "";
  if (s < 60) text = `${s}s`;
  else if (s < 3600) text = `${Math.floor(s / 60)}m ${s % 60}s`;
  else text = `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  return <span style={{ fontSize: '0.72rem', color: 'var(--yellow)', fontFamily: 'monospace', fontWeight: 600 }}>⏱ {text}</span>;
}

// ─── POOL STATUS (Session Tokens) ─────────────────────────────────────────────
function ChatGPTPool() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showOAuthModal, setShowOAuthModal] = useState(false);

  // Pagination states
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ total: 0, active: 0, cooldown: 0, failed: 0 });
  const [jumpPage, setJumpPage] = useState('');

  // Bulk selection states
  const [selectedTokens, setSelectedTokens] = useState([]);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/accounts', {
        params: { page, limit, search, status: statusFilter }
      });
      setAccounts(res.data.accounts || []);
      setTotalPages(res.data.totalPages || 1);
      setStats(res.data.stats || { total: 0, active: 0, cooldown: 0, failed: 0 });
      setSelectedTokens([]); // Reset selection when data page changes
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải accounts.' });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Reset page when filter or search changes
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, limit]);

  const handleReload = async () => {
    setLoading(true);
    try {
      await api.post('/admin-api/upstream');
      await fetchAccounts();
      setMsg({ type: 'success', text: 'Đã reload pool.' });
    } catch (e) {
      setMsg({ type: 'error', text: 'Reload thất bại.' });
      setLoading(false);
    }
  };

  const handleDelete = async (sessionToken) => {
    try {
      await api.delete('/admin-api/accounts', { data: { sessionToken } });
      setMsg({ type: 'success', text: 'Đã xóa tài khoản.' });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Xóa thất bại.' });
    }
  };

  const handleMarkFailed = async (sessionToken) => {
    try {
      await api.post('/admin-api/accounts/mark-failed', { sessionToken });
      setMsg({
        type: 'success',
        text: 'Đã đánh dấu tài khoản lỗi. Tiện ích (Extension) sẽ quét thấy và tự động đăng nhập lại ChatGPT để làm mới session.'
      });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Thao tác thất bại.' });
    }
  };

  const handleToggleActive = async (sessionToken, currentActive) => {
    try {
      await api.patch('/admin-api/accounts', {
        oldSessionToken: sessionToken,
        isActive: !currentActive
      });
      setMsg({ type: 'success', text: `Đã ${!currentActive ? 'bật' : 'tắt'} tài khoản thành công.` });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Thao tác thất bại.' });
    }
  };

  const handleBulkToggleActive = async (isActive) => {
    if (selectedTokens.length === 0) return;
    setLoading(true);
    try {
      await api.patch('/admin-api/accounts', {
        sessionTokens: selectedTokens,
        isActive
      });
      setMsg({
        type: 'success',
        text: `Đã ${isActive ? 'bật' : 'tắt'} ${selectedTokens.length} tài khoản thành công.`
      });
      setSelectedTokens([]);
      await fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Thao tác thất bại.' });
      setLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTokens.length === 0) return;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedTokens.length} tài khoản đã chọn không?`)) {
      return;
    }
    setLoading(true);
    try {
      await api.delete('/admin-api/accounts', { data: { sessionTokens: selectedTokens } });
      setMsg({ type: 'success', text: `Đã xóa ${selectedTokens.length} tài khoản thành công.` });
      setSelectedTokens([]);
      await fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Xóa thất bại.' });
      setLoading(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const tokensOnPage = accounts.map(acc => acc.sessionToken).filter(Boolean);
      setSelectedTokens(prev => {
        const next = [...prev];
        tokensOnPage.forEach(token => {
          if (!next.includes(token)) next.push(token);
        });
        return next;
      });
    } else {
      const tokensOnPage = accounts.map(acc => acc.sessionToken).filter(Boolean);
      setSelectedTokens(prev => prev.filter(token => !tokensOnPage.includes(token)));
    }
  };

  const handleSelectRow = (sessionToken) => {
    setSelectedTokens(prev => {
      if (prev.includes(sessionToken)) {
        return prev.filter(t => t !== sessionToken);
      } else {
        return [...prev, sessionToken];
      }
    });
  };

  const startEdit = (acc) => {
    setEditRow(acc.sessionToken);
    setEditValues({ name: acc.name, newSessionToken: '' });
  };

  const saveEdit = async (oldToken) => {
    try {
      await api.patch('/admin-api/accounts', {
        oldSessionToken: oldToken,
        name: editValues.name,
        ...(editValues.newSessionToken ? { newSessionToken: editValues.newSessionToken } : {})
      });
      setMsg({ type: 'success', text: 'Đã cập nhật.' });
      setEditRow(null);
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Lỗi cập nhật.' });
    }
  };

  const statusBadge = (s) => {
    if (!s || s === 'active') return <span className="badge badge-green">Active</span>;
    if (s === 'cooldown') return <span className="badge badge-yellow">Cooldown</span>;
    if (s === 'failed' || s === 'error') return <span className="badge badge-red">Failed</span>;
    if (s === 'disabled') return <span className="badge badge-gray" style={{ backgroundColor: '#374151', color: '#9ca3af' }}>Disabled</span>;
    return <span className="badge badge-gray">{s}</span>;
  };

  const isAllSelected = accounts.length > 0 && accounts.every(acc => !acc.sessionToken || selectedTokens.includes(acc.sessionToken));
  const isSomeSelected = accounts.length > 0 && accounts.some(acc => acc.sessionToken && selectedTokens.includes(acc.sessionToken)) && !isAllSelected;

  return (
    <div>
      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'} mb-3`}>
          {msg.text}
          <button className="alert-close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      <div className="card reveal" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'Tổng', value: stats.total, color: 'var(--text-primary)' },
              { label: 'Active', value: stats.active, color: 'var(--green)' },
              { label: 'Cooldown', value: stats.cooldown, color: 'var(--yellow)' },
              { label: 'Failed', value: stats.failed, color: 'var(--red)' },
              { label: 'Disabled', value: stats.disabled || 0, color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowOAuthModal(true)}>
              <Bot size={14} /> Kết nối Codex (OAuth)
            </button>
            <button id="chatgpt-reload-btn" className="btn btn-ghost btn-sm" onClick={handleReload}>
              <RefreshCw size={14} /> Reload Pool
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card reveal" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              placeholder="Tìm theo tên hoặc token..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ paddingLeft: 32 }}
            />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Active</option>
            <option value="cooldown">Cooldown</option>
            <option value="failed">Failed</option>
            <option value="disabled">Disabled</option>
          </select>
          <select value={limit} onChange={e => { setLimit(parseInt(e.target.value, 10)); setPage(1); }} style={{ width: 'auto' }}>
            <option value="10">10 acc / trang</option>
            <option value="20">20 acc / trang</option>
            <option value="30">30 acc / trang</option>
            <option value="40">40 acc / trang</option>
            <option value="50">50 acc / trang</option>
            <option value="100">100 acc / trang</option>
          </select>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedTokens.length > 0 && (
        <div className="card" style={{ marginBottom: 14, backgroundColor: 'rgba(99, 102, 241, 0.08)', borderColor: 'var(--accent)', animation: 'slideUp 0.2s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                Đã chọn <strong style={{ color: 'var(--accent-light)' }}>{selectedTokens.length}</strong> tài khoản
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-success btn-sm" onClick={() => handleBulkToggleActive(true)}>
                Bật hoạt động
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => handleBulkToggleActive(false)} style={{ color: 'var(--yellow)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
                Tắt hoạt động
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                Xóa đã chọn
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTokens([])}>
                Bỏ chọn
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
        ) : (
          <div className="table-container" style={{ borderRadius: 0, border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={el => {
                        if (el) {
                          el.indeterminate = isSomeSelected;
                        }
                      }}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </th>
                  <th>#</th>
                  <th>Tên</th>
                  <th>Trạng thái</th>
                  <th>Hoạt động</th>
                  <th>Quotas</th>
                  <th>Hoạt động cuối</th>
                  <th style={{ textAlign: 'right' }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Không tìm thấy tài khoản nào
                    </td>
                  </tr>
                ) : accounts.map((acc, i) => (
                  <tr key={acc.sessionToken || i} style={selectedTokens.includes(acc.sessionToken) ? { backgroundColor: 'rgba(99, 102, 241, 0.05)' } : {}}>
                    <td style={{ width: 40, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedTokens.includes(acc.sessionToken)}
                        onChange={() => handleSelectRow(acc.sessionToken)}
                        disabled={!acc.sessionToken}
                        style={{ cursor: 'pointer', width: 16, height: 16 }}
                      />
                    </td>
                    <td style={{ color: 'var(--text-muted)', width: 40 }}>{(page - 1) * limit + i + 1}</td>
                    <td>
                      {editRow === acc.sessionToken ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            value={editValues.name}
                            onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
                            style={{ width: '100%', padding: '4px 8px', fontSize: '0.85rem' }}
                            placeholder="Tên tài khoản"
                          />
                          <input
                            placeholder="Token mới (để trống nếu không đổi)"
                            value={editValues.newSessionToken}
                            onChange={e => setEditValues(v => ({ ...v, newSessionToken: e.target.value }))}
                            className="font-mono"
                            style={{ width: '100%', padding: '4px 8px', fontSize: '0.75rem' }}
                          />
                        </div>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{acc.name}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {statusBadge(acc.status)}
                          {acc.status === 'cooldown' && acc.cooldownRemaining > 0 && (
                            <CooldownTimer initialMs={acc.cooldownRemaining} />
                          )}
                          {acc.status !== 'failed' && acc.status !== 'error' && acc.status !== 'disabled' ? (
                            <button
                              className="btn btn-ghost btn-xs text-xs"
                              onClick={() => handleMarkFailed(acc.sessionToken)}
                              title="Đánh dấu tài khoản lỗi để test re-login tự động từ Extension"
                              style={{ padding: '2px 4px', fontSize: '0.68rem', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
                            >
                              Mô phỏng lỗi (Test Re-login)
                            </button>
                          ) : acc.status !== 'disabled' ? (
                            <button
                              className="btn btn-warning btn-xs text-xs"
                              onClick={() => handleMarkFailed(acc.sessionToken)}
                              title="Yêu cầu Extension tự động đăng nhập lại ChatGPT để lấy session mới"
                              style={{ padding: '2px 6px', fontSize: '0.68rem', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                            >
                              🔄 Re-login qua Extension
                            </button>
                          ) : null}
                        </div>
                        {acc.lastError && (acc.status === 'failed' || acc.status === 'error') && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--red)', wordBreak: 'break-all', maxWidth: '300px' }} title={acc.lastError}>
                            Lỗi: {acc.lastError}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <label className="switch-wrapper">
                        <input
                          type="checkbox"
                          checked={acc.isActive}
                          onChange={() => handleToggleActive(acc.sessionToken, acc.isActive)}
                        />
                        <span className="switch-slider" />
                      </label>
                    </td>
                    <td>
                      <AccountQuotaCell accountName={acc.name} sessionToken={acc.sessionToken} />
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                      {acc.lastUsedAt ? new Date(acc.lastUsedAt).toLocaleString('vi-VN') : 'Chưa sử dụng'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {editRow === acc.sessionToken ? (
                          <>
                            <button className="btn btn-success btn-sm btn-icon" onClick={() => saveEdit(acc.sessionToken)} title="Lưu"><Check size={13} /></button>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditRow(null)} title="Hủy"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => startEdit(acc)} title="Sửa"><Edit2 size={13} /></button>
                            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleDelete(acc.sessionToken)} title="Xóa"><Trash2 size={13} style={{ color: 'var(--red)' }} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination & Quick Jump */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <div className="pagination" style={{ margin: 0 }}>
            <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p = i + 1;
              if (totalPages > 7) {
                if (page <= 4) p = i + 1;
                else if (page >= totalPages - 3) p = totalPages - 6 + i;
                else p = page - 3 + i;
              }
              return (
                <button
                  key={p}
                  className={`page-btn ${page === p ? 'active' : ''}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              );
            })}
            <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              <ChevronRight size={14} />
            </button>
          </div>

          <form
            onSubmit={e => {
              e.preventDefault();
              const p = parseInt(jumpPage, 10);
              if (p >= 1 && p <= totalPages) {
                setPage(p);
                setJumpPage('');
              } else {
                alert(`Vui lòng nhập trang từ 1 đến ${totalPages}`);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Trang {page} / {totalPages}
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>| Đi đến trang:</span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={jumpPage}
              onChange={e => setJumpPage(e.target.value)}
              placeholder="Nhập số..."
              style={{ width: 80, padding: '4px 8px', fontSize: '0.82rem', textAlign: 'center' }}
            />
            <button type="submit" className="btn btn-ghost btn-sm" style={{ padding: '4px 10px', height: 'auto' }}>
              Đi
            </button>
          </form>
        </div>
      )}

      <CodexOAuthModal
        isOpen={showOAuthModal}
        onClose={() => setShowOAuthModal(false)}
        onSuccess={fetchAccounts}
      />
    </div>
  );
}

// ─── BULK IMPORT (Session Token) ──────────────────────────────────────────────
function ChatGPTBulkImport() {
  const [rawText, setRawText] = useState('');
  const [singleName, setSingleName] = useState('');
  const [singleToken, setSingleToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [singleLoading, setSingleLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [singleResult, setSingleResult] = useState(null);

  const handleBulk = async () => {
    setLoading(true); setResult(null);
    try {
      const res = await api.post('/admin-api/accounts/import-bulk', { rawText });
      setResult({ ok: true, data: res.data });
      setRawText('');
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi import.' });
    } finally { setLoading(false); }
  };

  const handleSingle = async () => {
    if (!singleToken.trim()) return;
    setSingleLoading(true); setSingleResult(null);
    try {
      const res = await api.post('/admin-api/accounts/import-manual', {
        name: singleName.trim(),
        sessionToken: singleToken.trim()
      });
      setSingleResult({ ok: true, data: res.data });
      setSingleName(''); setSingleToken('');
    } catch (e) {
      setSingleResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi lưu.' });
    } finally { setSingleLoading(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Single */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Plus size={15} /> Thêm 1 tài khoản (Token / OAuth JSON)</span>
        </div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label>Tên tài khoản (Email - Phải có trong kho Hotmail)</label>
            <input id="chatgpt-single-name" placeholder="VD: user@hotmail.com" value={singleName} onChange={e => setSingleName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Token hoặc OAuth JSON</label>
            <input id="chatgpt-single-token" placeholder="eyJhbGciOi... hoặc JSON" value={singleToken} onChange={e => setSingleToken(e.target.value)} className="font-mono" style={{ fontSize: '0.82rem' }} />
          </div>
        </div>
        <button id="chatgpt-single-save-btn" className="btn btn-primary" onClick={handleSingle} disabled={singleLoading || !singleToken.trim() || !singleName.trim()}>
          {singleLoading ? <><span className="spinner" /> Đang lưu...</> : <><Check size={14} /> Lưu</>}
        </button>
        {singleResult && (
          <div className={`alert alert-${singleResult.ok ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
            {singleResult.ok ? `✅ Đã lưu. Tổng: ${singleResult.data.count} tài khoản.` : `❌ ${singleResult.error}`}
          </div>
        )}
      </div>

      {/* Bulk */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Upload size={15} /> Nhập nhanh nhiều tài khoản</span>
          <span className="text-xs text-muted">Format: email|token (Email phải có trong kho Hotmail)</span>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Dán danh sách vào đây</label>
          <textarea
            id="chatgpt-bulk-textarea"
            rows={8}
            placeholder={"user1@outlook.com|eyJhbGci...\nuser2@hotmail.com|eyJhbGci...\n\nHoặc chỉ token (hệ thống sẽ tự giải mã email từ token):\neyJhbGciOiJ...\neyJhbGciOiJ..."}
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            className="font-mono"
            style={{ fontSize: '0.8rem', minHeight: 160 }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {rawText.split('\n').filter(l => l.trim()).length} dòng
          </div>
        </div>
        <button id="chatgpt-bulk-import-btn" className="btn btn-success" onClick={handleBulk} disabled={loading || !rawText.trim()}>
          {loading ? <><span className="spinner" /> Đang import...</> : <><Upload size={14} /> Import</>}
        </button>
        {result && (
          <div className={`alert alert-${result.ok ? 'success' : 'error'}`} style={{ marginTop: 12, flexDirection: 'column', alignItems: 'flex-start' }}>
            {result.ok ? (
              <>
                <div>✅ Đã import {result.data.imported} tài khoản. Tổng pool: {result.data.total}</div>
                {result.data.errors && result.data.errors.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: '0.8rem', width: '100%', borderTop: '1px solid rgba(16, 185, 129, 0.2)', paddingTop: 8 }}>
                    <div style={{ fontWeight: 600, color: 'var(--yellow)', marginBottom: 4 }}>⚠️ Các dòng bị bỏ qua ({result.data.errors.length}):</div>
                    <ul style={{ paddingLeft: 16, margin: 0, color: 'var(--text-secondary)', maxHeight: 150, overflowY: 'auto' }}>
                      {result.data.errors.map((err, i) => (
                        <li key={i} style={{ marginBottom: 2 }}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div>❌ {result.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUTO REG CREDENTIALS (email+password từ AutoRegUnified) ─────────────────
function AutoRegCredentials() {
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);

  // Manual add form
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addOtp, setAddOtp] = useState('');
  const [addReLogin, setAddReLogin] = useState(true);
  const [addLoading, setAddLoading] = useState(false);

  // Bulk import
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const fetchCreds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/chatgpt-credentials');
      setCreds(res.data.credentials || []);
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải credentials.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCreds(); }, [fetchCreds]);

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xóa credential này?')) return;
    try {
      await api.delete(`/admin-api/chatgpt-credentials/${id}`);
      setMsg({ type: 'success', text: 'Đã xóa.' });
      fetchCreds();
    } catch (e) {
      setMsg({ type: 'error', text: 'Xóa thất bại.' });
    }
  };

  const downloadAll = () => {
    if (!creds.length) return;
    const lines = creds.map(c => `${c.email}|${c.password}|${c.otp_secret || ''}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chatgpt_credentials.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  // Helper to parse line with multiple delimiters and validate email
  const parseLine = (line) => {
    const clean = line.trim();
    if (!clean) return null;

    // Detect separator: |, \t, ;, ---, :
    const separators = ['|', '\t', ';', '---', ':'];
    let sep = null;
    for (const s of separators) {
      if (clean.includes(s)) {
        sep = s;
        break;
      }
    }

    let email = '';
    let password = '';
    let otpSecret = '';

    if (!sep) {
      email = clean;
    } else {
      const idx = clean.indexOf(sep);
      email = clean.slice(0, idx).trim();
      const rest = clean.slice(idx + sep.length).trim();
      
      if (rest.includes(sep)) {
        const idx2 = rest.indexOf(sep);
        password = rest.slice(0, idx2).trim();
        otpSecret = rest.slice(idx2 + sep.length).trim();
      } else {
        password = rest;
      }
    }

    // Basic email validation regex to ensure a valid email format is entered
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    if (!emailRegex.test(email)) {
      return null;
    }

    return { email, password, otpSecret };
  };

  // Handle manual single add
  const handleAddSingle = async () => {
    const trimmedEmail = addEmail.trim();
    if (!trimmedEmail) return;
    
    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    if (!emailRegex.test(trimmedEmail)) {
      setMsg({ type: 'error', text: 'Lỗi: Định dạng email không hợp lệ.' });
      return;
    }

    setAddLoading(true);
    try {
      const res = await api.post('/admin-api/chatgpt-credentials', {
        email: trimmedEmail,
        password: addPassword.trim(),
        otpSecret: addOtp.trim(),
        triggerReLogin: addReLogin
      });
      const poolMsg = res.data.poolStatus === 'marked_failed'
        ? ' → Đã đánh dấu lỗi trong pool, Extension sẽ tự re-login.'
        : res.data.poolStatus === 'not_in_pool'
          ? ' (Chưa có trong pool, Extension sẽ thêm khi re-login).'
          : '';
      setMsg({ type: 'success', text: `✅ ${res.data.message}${poolMsg}` });
      setAddEmail(''); setAddPassword(''); setAddOtp('');
      fetchCreds();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Lỗi thêm credential.' });
    } finally { setAddLoading(false); }
  };

  // Handle bulk import
  const handleBulkImport = async () => {
    const parsedLines = bulkText
      .split('\n')
      .map(l => parseLine(l))
      .filter(Boolean);

    if (!parsedLines.length) { 
      setMsg({ type: 'error', text: 'Không tìm thấy dòng hợp lệ. Định dạng hỗ trợ: email|password|otp_secret hoặc email:password' }); 
      return; 
    }

    setBulkLoading(true);
    let success = 0, fail = 0;
    const failedEmails = [];
    for (const item of parsedLines) {
      try {
        await api.post('/admin-api/chatgpt-credentials', {
          email: item.email, 
          password: item.password, 
          otpSecret: item.otpSecret,
          triggerReLogin: addReLogin
        });
        success++;
      } catch (e) { 
        fail++; 
        const errText = e.response?.data?.error?.message || e.message || 'Lỗi không xác định';
        failedEmails.push(`${item.email} (${errText})`);
      }
    }
    
    if (fail > 0) {
      setMsg({ 
        type: 'error', 
        text: `⚠️ Import hoàn tất: ${success} thành công, ${fail} thất bại.\nCác tài khoản lỗi:\n${failedEmails.join('\n')}` 
      });
    } else {
      setMsg({ type: 'success', text: `✅ Import thành công tất cả ${success} tài khoản.` });
      setBulkText('');
    }
    
    fetchCreds();
    setBulkLoading(false);
  };

  return (
    <div>
      {/* Manual Add Form */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <span className="card-title"><Plus size={15} /> Thêm credential thủ công</span>
          <button
            className={`btn btn-ghost btn-sm`}
            onClick={() => setShowBulk(!showBulk)}
            style={{ fontSize: '0.75rem' }}
          >
            {showBulk ? '📝 Nhập từng dòng' : '📋 Nhập nhanh nhiều dòng'}
          </button>
        </div>

        {!showBulk ? (
          /* Single add form */
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div className="form-group">
                <label>Email <span style={{ color: 'var(--red)' }}>*</span></label>
                <input
                  placeholder="user@outlook.com"
                  value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  placeholder="mật khẩu ChatGPT"
                  value={addPassword}
                  onChange={e => setAddPassword(e.target.value)}
                  type="password"
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
              <div className="form-group">
                <label>2FA Secret (OTP)</label>
                <input
                  placeholder="ABCDEF... (base32)"
                  value={addOtp}
                  onChange={e => setAddOtp(e.target.value)}
                  className="font-mono"
                  style={{ fontSize: '0.82rem' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                className="btn btn-primary"
                onClick={handleAddSingle}
                disabled={addLoading || !addEmail.trim()}
              >
                {addLoading ? <><span className="spinner" /> Đang lưu...</> : <><Plus size={14} /> Thêm credential</>}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={addReLogin} onChange={e => setAddReLogin(e.target.checked)} />
                Tự đánh dấu lỗi để Extension re-login
              </label>
            </div>
          </>
        ) : (
          /* Bulk import form */
          <>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Dán nhiều dòng: <code style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>email|password|otp_secret</code></label>
              <textarea
                rows={6}
                placeholder={"user1@outlook.com|myPass123|ABCDE...\nuser2@outlook.com|pass456|FGHIJ...\nuser3@outlook.com|pass789"}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                className="font-mono"
                style={{ fontSize: '0.8rem', minHeight: 120 }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {bulkText.split('\n').map(l => parseLine(l)).filter(Boolean).length} dòng hợp lệ
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                className="btn btn-success"
                onClick={handleBulkImport}
                disabled={bulkLoading || !bulkText.trim()}
              >
                {bulkLoading ? <><span className="spinner" /> Đang import...</> : <><Upload size={14} /> Import tất cả</>}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={addReLogin} onChange={e => setAddReLogin(e.target.checked)} />
                Tự đánh dấu lỗi để Extension re-login
              </label>
            </div>
          </>
        )}
      </div>

      {/* Stats + actions bar */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent)' }}>{creds.length}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tổng acc đã đăng ký</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchCreds}><RefreshCw size={14} /> Làm mới</button>
            <button className="btn btn-success btn-sm" onClick={downloadAll} disabled={!creds.length}><Download size={14} /> Tải về TXT</button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="card-title"><KeyRound size={14} /> Tài khoản ChatGPT (AutoReg + Nhập tay)</span>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
        ) : (
          <div className="table-container" style={{ borderRadius: 0, border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Email</th>
                  <th>Password</th>
                  <th>2FA Secret</th>
                  <th>Nguồn</th>
                  <th>Ngày tạo</th>
                  <th style={{ textAlign: 'right' }}>Xóa</th>
                </tr>
              </thead>
              <tbody>
                {creds.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Chưa có tài khoản nào. Dùng form phía trên để nhập thủ công hoặc Extension AutoRegUnified sẽ tự động đẩy lên.
                    </td>
                  </tr>
                ) : creds.map((c, i) => (
                  <tr key={c.id}>
                    <td style={{ color: 'var(--text-muted)', width: 40 }}>{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.email}</span>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ padding: 2 }}
                          onClick={() => copyText(c.email, `email-${c.id}`)} title="Copy">
                          {copied === `email-${c.id}` ? <Check size={11} style={{ color: 'var(--green)' }} /> : <Copy size={11} />}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{c.password}</code>
                        <button className="btn btn-ghost btn-sm btn-icon" style={{ padding: 2 }}
                          onClick={() => copyText(c.password, `pass-${c.id}`)} title="Copy">
                          {copied === `pass-${c.id}` ? <Check size={11} style={{ color: 'var(--green)' }} /> : <Copy size={11} />}
                        </button>
                      </div>
                    </td>
                    <td>
                      <TwoFactorCell secret={c.otp_secret} />
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: c.source === 'ManualInput' ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.12)',
                        color: c.source === 'ManualInput' ? '#818cf8' : '#10b981',
                        fontWeight: 600
                      }}>
                        {c.source === 'ManualInput' ? '✍️ Thủ công' : '🤖 AutoReg'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('vi-VN') : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleDelete(c.id)} title="Xóa">
                          <Trash2 size={13} style={{ color: 'var(--red)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CODEX OAUTH MODAL (9Router-style) ─────────────────────────────────────────
function CodexOAuthModal({ isOpen, onClose, onSuccess }) {
  const [step, setStep] = useState('loading'); // loading | input | success | error
  const [authData, setAuthData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const startOAuth = useCallback(async () => {
    setStep('loading');
    setErrorMsg('');
    try {
      // 1. Get authorize URL & state from backend
      const authRes = await api.get('/admin-api/oauth/codex/authorize');
      setAuthData(authRes.data);
      
      // 2. Start the local proxy server (will only bind on local machine)
      try {
        await api.get('/admin-api/oauth/codex/start-proxy');
      } catch (_) {
        // Ignore, proxy will fail silently on remote VPS, user falls back to manual pasting
      }
      
      setStep('input');
    } catch (err) {
      setErrorMsg(err.response?.data?.error?.message || err.message || 'Lỗi khởi tạo luồng OAuth');
      setStep('error');
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      startOAuth();
    }
  }, [isOpen, startOAuth]);

  // Polling for local proxy callback
  useEffect(() => {
    if (step !== 'input' || !authData?.state) return;
    
    let cancelled = false;
    const POLL_INTERVAL_MS = 1500;
    const MAX_ATTEMPTS = 200; // ~5 minutes
    let attempts = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await api.get(`/admin-api/oauth/codex/poll-status?state=${encodeURIComponent(authData.state)}`);
        if (cancelled) return;
        if (res.data.status === 'done') {
          setStep('success');
          onSuccess?.();
          return;
        }
        if (res.data.status === 'error') {
          setErrorMsg(res.data.error || 'Xác thực thất bại');
          setStep('error');
          return;
        }
      } catch {
        // Network error, keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        setErrorMsg('Hết thời gian chờ ủy quyền (5 phút)');
        setStep('error');
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; };
  }, [step, authData, onSuccess]);

  const handleClose = () => {
    api.get('/admin-api/oauth/codex/stop-proxy').catch(() => {});
    onClose();
  };

  const handleCopyLink = () => {
    if (!authData?.authUrl) return;
    navigator.clipboard.writeText(authData.authUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bot size={18} style={{ color: 'var(--accent-light)' }} />
            Kết nối Codex (OAuth)
          </span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={handleClose} style={{ border: 'none', background: 'none' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {step === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
              <span className="spinner" />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Đang xử lý...</span>
            </div>
          )}

          {step === 'input' && (
            <>
              {/* Info banner */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: 'rgba(99,102,241,0.08)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
                <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🔐</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: 3 }}>Đăng nhập 1 lần — tự động vĩnh viễn</div>
                  <div style={{ fontSize: '0.77rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Bấm nút bên dưới → đăng nhập ChatGPT → cửa sổ tự đóng → hệ thống tự kết nối. <strong>Không cần copy paste gì cả!</strong>
                  </div>
                </div>
              </div>

              {/* Main CTA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <a
                  href={authData?.authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, textDecoration: 'none', padding: '12px 20px', fontSize: '0.95rem' }}
                >
                  🚀 Mở trang đăng nhập OpenAI
                </a>
                <button className="btn btn-ghost" onClick={handleCopyLink} disabled={!authData?.authUrl}
                  style={{ fontSize: '0.82rem' }}>
                  {copied ? '✅ Đã copy' : '📋 Copy liên kết (mở thủ công)'}
                </button>
              </div>

              {/* Auto-detect status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(16,185,129,0.07)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.15)' }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--green)' }}>Đang tự động phát hiện...</strong> Hệ thống sẽ tự kết nối ngay sau khi bạn đăng nhập thành công.
                </div>
              </div>
            </>
          )}

          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%', background: 'rgba(16,185,129,0.1)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--green)'
              }}>
                <Check size={36} />
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Liên kết thành công!</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0 0 20px 0' }}>
                Tài khoản Codex đã được thêm vào pool và sẵn sàng sử dụng.
              </p>
              <button className="btn btn-primary w-full" onClick={handleClose}>
                Hoàn tất
              </button>
            </div>
          )}

          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%', background: 'rgba(239,68,68,0.1)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--red)'
              }}>
                <X size={36} />
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Liên kết thất bại</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--red)', margin: '0 0 20px 0', wordBreak: 'break-all' }}>
                {errorMsg}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={startOAuth} style={{ flex: 1 }}>
                  Thử lại
                </button>
                <button className="btn btn-ghost" onClick={handleClose} style={{ flex: 1 }}>
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

