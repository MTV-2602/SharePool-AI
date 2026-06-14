import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, RefreshCw, Power, RotateCcw, Edit2, Check, X, Copy, Calendar } from 'lucide-react';
import api from '../lib/api';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editKey, setEditKey] = useState(null);
  const [copied, setCopied] = useState(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/keys');
      setKeys(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải API keys.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const toast = (text, type = 'success') => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const copyKey = (keyVal) => {
    navigator.clipboard.writeText(keyVal).catch(() => {});
    setCopied(keyVal);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xóa API key này?')) return;
    try {
      await api.delete(`/admin-api/keys/${id}`);
      toast('Đã xóa API key.');
      fetchKeys();
    } catch (e) {
      toast('Xóa thất bại.', 'error');
    }
  };

  const handleToggle = async (id, currentState) => {
    try {
      const endpoint = currentState ? `/admin-api/keys/${id}/disable` : `/admin-api/keys/${id}/enable`;
      await api.post(endpoint);
      fetchKeys();
    } catch (e) {
      toast('Lỗi cập nhật trạng thái.', 'error');
    }
  };

  const handleReset = async (id) => {
    if (!window.confirm('Reset quota về 0?')) return;
    try {
      await api.post(`/admin-api/keys/${id}/reset`);
      toast('Đã reset usage.');
      fetchKeys();
    } catch (e) {
      toast('Reset thất bại.', 'error');
    }
  };

  const handleQuickExtend = async (k, days) => {
    try {
      const expRaw = k.expires_at || k.expiresAt;
      const base = expRaw ? new Date(expRaw) : new Date();
      const start = base < new Date() ? new Date() : base;
      let newDate = null;
      if (days !== null) {
        start.setDate(start.getDate() + days);
        newDate = start.toISOString().split('T')[0];
      }
      await api.patch(`/admin-api/keys/${k.id}`, { expiresAt: newDate });
      toast(days === null ? 'Đã đặt key không hết hạn!' : `Đã gia hạn thêm ${days} ngày!`);
      fetchKeys();
    } catch (e) {
      toast('Lỗi gia hạn: ' + (e.response?.data?.error?.message || e.message), 'error');
    }
  };

  const usagePct = (key) => {
    const used = key.quota_used ?? key.quotaUsed ?? 0;
    const total = key.quota_total ?? key.quotaTotal ?? 1;
    return Math.min(100, Math.round((used / total) * 100));
  };

  return (
    <div>
      <div className="page-header page-header-flex">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Key size={22} className="header-icon" />
            API Keys
          </h1>
          <p>Quản lý tất cả API keys và quota</p>
        </div>
        <div className="flex gap-2">
          <button id="apikeys-refresh-btn" className="btn btn-ghost btn-sm" onClick={fetchKeys} disabled={loading}>
            <RefreshCw size={14} /> Làm mới
          </button>
          <button id="apikeys-create-btn" className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Tạo Key mới
          </button>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'} mb-3`}>
          {msg.text}
          <button className="alert-close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* Stats summary */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {[
          { label: 'Tổng keys', value: keys.length },
          { label: 'Đang hoạt động', value: keys.filter(k => k.is_active || k.isActive).length, color: 'var(--green)' },
          { label: 'Tổng tokens', value: keys.reduce((s, k) => s + (k.quota_used ?? k.quotaUsed ?? 0), 0).toLocaleString(), color: 'var(--accent-light)' },
          { 
            label: 'Tổng chi phí', 
            value: `~$${((keys.reduce((s, k) => s + (k.quota_used ?? k.quotaUsed ?? 0), 0) / 1000000) * 5.0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
            color: 'var(--red)' 
          },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-card-value" style={{ color: s.color || 'var(--text-primary)', fontSize: '1.4rem' }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
        ) : (
          <div className="table-container" style={{ borderRadius: 0, border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Key</th>
                  <th>Trạng thái</th>
                  <th>Quota dùng / tổng</th>
                  <th>Chi phí (~USD)</th>
                  <th>Ngày tạo</th>
                  <th style={{ textAlign: 'right' }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Chưa có API key nào
                    </td>
                  </tr>
                ) : keys.map(k => {
                  const isActive = k.is_active || k.isActive;
                  const pct = usagePct(k);
                  const used = k.quota_used ?? k.quotaUsed ?? 0;
                  const total = k.quota_total ?? k.quotaTotal ?? 0;
                  const estCost = (used / 1000000) * 5.0;
                  return (
                    <tr key={k.id} style={{ opacity: isActive ? 1 : 0.5 }}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{k.name}</span>
                        {(() => {
                          const exp = k.expires_at || k.expiresAt;
                          if (!exp) return <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>Không hết hạn</div>;
                          const isExpired = new Date(exp) < new Date();
                          return <div style={{ fontSize: '0.7rem', color: isExpired ? 'var(--red)' : 'var(--text-muted)', marginTop: 2 }}>
                            Hạn: {new Date(exp).toLocaleDateString('vi-VN')}{isExpired ? ' (Hết hạn)' : ''}
                          </div>;
                        })()}
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '2px 5px', fontSize: '0.65rem', color: 'var(--accent-light)', height: 'auto', minHeight: 0 }}
                            onClick={() => handleQuickExtend(k, 7)} title="Gia hạn 7 ngày">+7đ</button>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '2px 5px', fontSize: '0.65rem', color: 'var(--accent-light)', height: 'auto', minHeight: 0 }}
                            onClick={() => handleQuickExtend(k, 30)} title="Gia hạn 30 ngày">+30đ</button>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '2px 5px', fontSize: '0.65rem', color: 'var(--accent-light)', height: 'auto', minHeight: 0 }}
                            onClick={() => handleQuickExtend(k, 90)} title="Gia hạn 90 ngày">+90đ</button>
                          <button className="btn btn-ghost btn-xs" style={{ padding: '2px 5px', fontSize: '0.65rem', color: 'var(--text-muted)', height: 'auto', minHeight: 0 }}
                            onClick={() => handleQuickExtend(k, null)} title="Không hết hạn">∞</button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {k.key_value?.slice(0, 20) ?? k.key?.slice(0, 20)}...
                          </code>
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title={copied === (k.key_value || k.key) ? 'Đã copy!' : 'Copy'}
                            onClick={() => copyKey(k.key_value || k.key)}
                            style={{ padding: '3px' }}
                          >
                            {copied === (k.key_value || k.key)
                              ? <Check size={12} style={{ color: 'var(--green)' }} />
                              : <Copy size={12} />}
                          </button>
                        </div>
                      </td>
                      <td>
                        {isActive
                          ? <span className="badge badge-green">Active</span>
                          : <span className="badge badge-gray">Disabled</span>}
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                          {used.toLocaleString()} / {total >= 1e8 ? '∞' : total.toLocaleString()}
                        </div>
                        <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            background: pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--accent)',
                            borderRadius: 2, transition: 'width 0.3s ease'
                          }} />
                        </div>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {`~$${estCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {k.created_at ? new Date(k.created_at).toLocaleDateString('vi-VN') : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Sửa / Gia hạn" onClick={() => setEditKey(k)}><Edit2 size={13} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" title={isActive ? 'Tắt' : 'Bật'} onClick={() => handleToggle(k.id, isActive)}>
                            <Power size={13} style={{ color: isActive ? 'var(--green)' : 'var(--text-muted)' }} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Reset quota" onClick={() => handleReset(k.id)}><RotateCcw size={13} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Xóa" onClick={() => handleDelete(k.id)}><Trash2 size={13} style={{ color: 'var(--red)' }} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && <CreateKeyModal onClose={() => setShowCreate(false)} onCreated={() => { fetchKeys(); toast('Tạo key thành công!'); }} />}
      {editKey && <EditKeyModal keyData={editKey} onClose={() => setEditKey(null)} onSaved={() => { fetchKeys(); toast('Cập nhật thành công!'); setEditKey(null); }} apiBase="/admin-api" />}
    </div>
  );
}

function CreateKeyModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', quotaTotal: '', note: '' });
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleExtendDays = (days) => {
    const base = expiresAt ? new Date(expiresAt) : new Date();
    base.setDate(base.getDate() + days);
    setExpiresAt(base.toISOString().split('T')[0]);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/admin-api/keys', {
        name: form.name.trim(),
        quota: form.quotaTotal ? parseInt(form.quotaTotal) : undefined,
        note: form.note.trim(),
        expiresAt: expiresAt || null
      });
      setResult({ ok: true, key: res.data });
      onCreated();
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Tạo thất bại.' });
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><Key size={16} /> Tạo API Key mới</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={15} /></button>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label>Tên *</label>
            <input id="create-key-name" placeholder="VD: Client App 1" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} autoFocus />
          </div>
          <div className="form-group">
            <label>Quota tối đa (để trống = không giới hạn)</label>
            <input id="create-key-quota" type="number" placeholder="VD: 1000000" value={form.quotaTotal} onChange={e => setForm(v => ({ ...v, quotaTotal: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Ghi chú</label>
            <input id="create-key-note" placeholder="Mô tả..." value={form.note} onChange={e => setForm(v => ({ ...v, note: e.target.value }))} />
          </div>
          
          {/* Expiration section */}
          <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 8, display: 'block' }}><Calendar size={13} style={{ verticalAlign: -2 }} /> Ngày hết hạn</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[7, 30, 90].map(d => (
                <button key={d} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => handleExtendDays(d)}>+{d} ngày</button>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => setExpiresAt('')}>Không hết hạn</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </div>
          </div>
        </div>

        {result && (
          <div style={{ margin: '14px 0' }}>
            {result.ok ? (
              <div className="alert alert-success">
                <div>✅ Tạo thành công!</div>
                <div style={{ marginTop: 8 }}>
                  <label style={{ marginBottom: 4, display: 'block' }}>API Key của bạn (copy và lưu lại):</label>
                  <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.8rem', padding: 8, background: 'var(--bg-elevated)', borderRadius: 6 }}>
                    {result.key.key_value || result.key.key}
                  </code>
                </div>
              </div>
            ) : (
              <div className="alert alert-error">❌ {result.error}</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>{result?.ok ? 'Đóng' : 'Hủy'}</button>
          {!result?.ok && (
            <button id="create-key-submit-btn" className="btn btn-primary" onClick={handleCreate} disabled={loading || !form.name.trim()}>
              {loading ? <><span className="spinner" /> Đang tạo...</> : <><Key size={14} /> Tạo Key</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditKeyModal({ keyData, onClose, onSaved, apiBase }) {
  const [name, setName] = useState(keyData.name || '');
  const [note, setNote] = useState(keyData.note || '');
  const [addTokens, setAddTokens] = useState('');
  const [directQuota, setDirectQuota] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => {
    const exp = keyData.expires_at || keyData.expiresAt;
    if (!exp) return '';
    try { return new Date(exp).toISOString().split('T')[0]; } catch { return ''; }
  });
  const [loading, setLoading] = useState(false);

  const currentQuota = keyData.quota_total ?? keyData.quotaTotal ?? 0;
  const currentUsed = keyData.quota_used ?? keyData.quotaUsed ?? 0;

  const handleAddQuick = (amount) => {
    setAddTokens(prev => String(Number(prev || 0) + amount));
    setDirectQuota('');
  };

  const handleExtendDays = (days) => {
    const base = expiresAt ? new Date(expiresAt) : new Date();
    base.setDate(base.getDate() + days);
    setExpiresAt(base.toISOString().split('T')[0]);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {};
      if (name.trim() !== keyData.name) payload.name = name.trim();
      if (note.trim() !== (keyData.note || '')) payload.note = note.trim();

      if (directQuota) {
        payload.quotaTotal = parseInt(directQuota, 10);
      } else if (addTokens) {
        payload.quotaTotal = currentQuota + parseInt(addTokens, 10);
      }

      const expRaw = keyData.expires_at || keyData.expiresAt || '';
      const origDate = expRaw ? (() => { try { return new Date(expRaw).toISOString().split('T')[0]; } catch { return ''; } })() : '';
      if (expiresAt !== origDate) {
        payload.expiresAt = expiresAt || null;
      }

      if (Object.keys(payload).length === 0) { onClose(); return; }

      await api.patch(`${apiBase}/keys/${keyData.id}`, payload);
      onSaved();
    } catch (e) {
      alert('Lỗi cập nhật: ' + (e.response?.data?.error?.message || e.message));
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title"><Edit2 size={16} /> Sửa & Gia hạn API Key</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={15} /></button>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          {/* Name & Note */}
          <div className="form-group">
            <label>Tên</label>
            <input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Ghi chú</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Mô tả..." />
          </div>

          {/* Quota / Token section */}
          <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 8, display: 'block' }}>🎫 Quota / Tokens</label>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>
              Hiện tại: <strong style={{ color: 'var(--text-primary)' }}>{currentUsed.toLocaleString()}</strong> / <strong style={{ color: 'var(--accent-light)' }}>{currentQuota >= 1e8 ? '∞' : currentQuota.toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[1_000_000, 10_000_000, 50_000_000, 100_000_000].map(amt => (
                <button key={amt} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => handleAddQuick(amt)}>+{(amt / 1e6)}M</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.72rem' }}>Cộng thêm tokens</label>
                <input type="number" placeholder="VD: 5000000" value={addTokens}
                  onChange={e => { setAddTokens(e.target.value); setDirectQuota(''); }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.72rem' }}>Hoặc đặt tổng Quota trực tiếp</label>
                <input type="number" placeholder={String(currentQuota)} value={directQuota}
                  onChange={e => { setDirectQuota(e.target.value); setAddTokens(''); }} />
              </div>
            </div>
            {addTokens && <div style={{ fontSize: '0.72rem', color: 'var(--green)', marginTop: 6 }}>→ Tổng quota mới: {(currentQuota + Number(addTokens)).toLocaleString()}</div>}
          </div>

          {/* Expiration section */}
          <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 8, display: 'block' }}><Calendar size={13} style={{ verticalAlign: -2 }} /> Ngày hết hạn</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[7, 30, 90].map(d => (
                <button key={d} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => handleExtendDays(d)}>+{d} ngày</button>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                onClick={() => setExpiresAt('')}>Không hết hạn</button>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? <><span className="spinner" /> Đang lưu...</> : <><Check size={14} /> Lưu thay đổi</>}
          </button>
        </div>
      </div>
    </div>
  );
}
