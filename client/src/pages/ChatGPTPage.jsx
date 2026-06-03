import { useState, useEffect, useCallback } from 'react';
import { Bot, Upload, Plus, Trash2, RefreshCw, Edit2, Check, X, KeyRound, Copy, Download } from 'lucide-react';
import api from '../lib/api';

const TABS = ['Pool Session Token', 'Nhập thủ công', 'Acc AutoReg (Email/Pass)'];

export default function ChatGPTPage() {
  const [tab, setTab] = useState(0);
  return (
    <div>
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bot size={22} style={{ color: '#10b981' }} />
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

// ─── POOL STATUS (Session Tokens) ─────────────────────────────────────────────
function ChatGPTPool() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editValues, setEditValues] = useState({});

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/accounts');
      const list = Array.isArray(res.data) ? res.data : (res.data.accounts || []);
      setAccounts(list);
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải accounts.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

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
    return <span className="badge badge-gray">{s}</span>;
  };

  return (
    <div>
      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'Tổng', value: accounts.length, color: 'var(--text-primary)' },
              { label: 'Active', value: accounts.filter(a => !a.status || a.status === 'active').length, color: 'var(--green)' },
              { label: 'Cooldown', value: accounts.filter(a => a.status === 'cooldown').length, color: 'var(--yellow)' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button id="chatgpt-reload-btn" className="btn btn-ghost btn-sm" onClick={handleReload}>
            <RefreshCw size={14} /> Reload Pool
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
        ) : (
          <div className="table-container" style={{ borderRadius: 0, border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên</th>
                  <th>Session Token</th>
                  <th>Trạng thái</th>
                  <th>Quotas</th>
                  <th>Requests</th>
                  <th style={{ textAlign: 'right' }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Chưa có tài khoản session nào. Dùng extension AutoRegUnified để tự đăng ký, hoặc nhập thủ công.
                    </td>
                  </tr>
                ) : accounts.map((acc, i) => (
                  <tr key={acc.sessionToken || i}>
                    <td style={{ color: 'var(--text-muted)', width: 40 }}>{i + 1}</td>
                    <td>
                      {editRow === acc.sessionToken ? (
                        <input
                          value={editValues.name}
                          onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
                          style={{ width: 140, padding: '4px 8px', fontSize: '0.85rem' }}
                        />
                      ) : (
                        <span style={{ fontWeight: 600 }}>{acc.name}</span>
                      )}
                    </td>
                    <td>
                      {editRow === acc.sessionToken ? (
                        <input
                          placeholder="Token mới (để trống nếu không đổi)"
                          value={editValues.newSessionToken}
                          onChange={e => setEditValues(v => ({ ...v, newSessionToken: e.target.value }))}
                          className="font-mono"
                          style={{ width: 200, padding: '4px 8px', fontSize: '0.78rem' }}
                        />
                      ) : (
                        <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {acc.sessionToken?.slice(0, 24)}...
                        </code>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {statusBadge(acc.status)}
                        {acc.status !== 'failed' && acc.status !== 'error' ? (
                          <button
                            className="btn btn-ghost btn-xs text-xs"
                            onClick={() => handleMarkFailed(acc.sessionToken)}
                            title="Đánh dấu tài khoản lỗi để test re-login tự động từ Extension"
                            style={{ padding: '2px 4px', fontSize: '0.68rem', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}
                          >
                            Mô phỏng lỗi (Test Re-login)
                          </button>
                        ) : (
                          <button
                            className="btn btn-warning btn-xs text-xs"
                            onClick={() => handleMarkFailed(acc.sessionToken)}
                            title="Yêu cầu Extension tự động đăng nhập lại ChatGPT để lấy session mới"
                            style={{ padding: '2px 6px', fontSize: '0.68rem', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                          >
                            🔄 Re-login qua Extension
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <AccountQuotaCell accountName={acc.name} sessionToken={acc.sessionToken} />
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{acc.totalRequests ?? 0}</td>
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
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi import.' });
    } finally { setLoading(false); }
  };

  const handleSingle = async () => {
    if (!singleToken.trim()) return;
    setSingleLoading(true); setSingleResult(null);
    try {
      const res = await api.post('/admin-api/accounts/import-manual', {
        name: singleName.trim() || `Acc-${Date.now()}`,
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
          <span className="card-title"><Plus size={15} /> Thêm 1 tài khoản Session Token</span>
        </div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label>Tên tài khoản</label>
            <input id="chatgpt-single-name" placeholder="VD: Acc-ChatGPT-01" value={singleName} onChange={e => setSingleName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Session Token</label>
            <input id="chatgpt-single-token" placeholder="eyJhbGciOi..." value={singleToken} onChange={e => setSingleToken(e.target.value)} className="font-mono" style={{ fontSize: '0.82rem' }} />
          </div>
        </div>
        <button id="chatgpt-single-save-btn" className="btn btn-primary" onClick={handleSingle} disabled={singleLoading || !singleToken.trim()}>
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
          <span className="text-xs text-muted">Format: name|sessionToken (mỗi dòng)</span>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Dán danh sách vào đây</label>
          <textarea
            id="chatgpt-bulk-textarea"
            rows={8}
            placeholder={"Acc-01|eyJhbGci...\nAcc-02|eyJhbGci...\n\nHoặc chỉ token:\neyJhbGciOiJ...\neyJhbGciOiJ..."}
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
          <div className={`alert alert-${result.ok ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
            {result.ok
              ? `✅ Đã import ${result.data.imported} tài khoản. Tổng pool: ${result.data.total}`
              : `❌ ${result.error}`}
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

  return (
    <div>
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="card-title"><KeyRound size={14} /> Tài khoản ChatGPT do AutoRegUnified đăng ký tự động</span>
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
                  <th>Worker</th>
                  <th>Ngày tạo</th>
                  <th style={{ textAlign: 'right' }}>Xóa</th>
                </tr>
              </thead>
              <tbody>
                {creds.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Chưa có tài khoản nào. Extension AutoRegUnified sẽ tự động đẩy lên sau khi đăng ký.
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
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {c.otp_secret ? c.otp_secret.slice(0, 16) + '...' : '—'}
                      </code>
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.worker_id || '—'}</td>
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
