import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Plus, Upload, Trash2, Eye, RefreshCw,
  Search, ChevronLeft, ChevronRight, Download,
  CheckCircle, XCircle, Clock, Inbox
} from 'lucide-react';
import api from '../lib/api';

const TABS = ['Danh sách', 'Nhập nhanh', 'Đọc Mail'];

export default function HotmailPage() {
  const [tab, setTab] = useState(0);

  return (
    <div>
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mail size={22} style={{ color: '#3b82f6' }} />
          Hotmail Manager
        </h1>
        <p>Quản lý kho tài khoản Hotmail/Outlook</p>
      </div>

      <div className="tab-nav">
        {TABS.map((t, i) => (
          <button key={t} className={`tab-btn ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
            {i === 0 && <Mail size={14} />}
            {i === 1 && <Upload size={14} />}
            {i === 2 && <Inbox size={14} />}
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && <HotmailList />}
      {tab === 1 && <HotmailBulkImport />}
      {tab === 2 && <HotmailReader />}
    </div>
  );
}

// ─── TAB 1: DANH SÁCH ─────────────────────────────────────────────────────────
function HotmailList() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50); // Default limit 50
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [msg, setMsg] = useState(null);
  const [jumpPage, setJumpPage] = useState('');

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/hotmail/accounts', {
        params: { page, limit, state: stateFilter, search }
      });
      setAccounts(res.data.accounts || []);
      setTotalPages(res.data.totalPages || 1);
      setTotal(res.data.filteredTotal || 0);
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải danh sách.' });
    } finally {
      setLoading(false);
    }
  }, [page, limit, stateFilter, search]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // Reset page when search, status, or limit changes
  useEffect(() => {
    setPage(1);
  }, [search, stateFilter, limit]);

  const handleDelete = async (email) => {
    try {
      await api.delete(`/admin-api/hotmail/delete/${encodeURIComponent(email)}`);
      setMsg({ type: 'success', text: `Đã xóa ${email}` });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Xóa thất bại.' });
    }
    setDeleteTarget(null);
  };

  const handleResetAll = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn Reset TOÀN BỘ tài khoản về trạng thái Available?")) return;
    try {
      await api.post('/admin-api/hotmail/reset-all');
      setMsg({ type: 'success', text: 'Đã reset toàn bộ tài khoản Hotmail về Available.' });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Reset thất bại.' });
    }
  };

  const handleUpdateState = async (email, state) => {
    try {
      await api.post('/admin-api/hotmail/update-state', { email, state });
      setMsg({ type: 'success', text: `Đã cập nhật trạng thái ${email} thành ${state}` });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error?.message || e.message || 'Cập nhật thất bại.' });
    }
  };

  const stateBadge = (s) => {
    if (s === 'available') return <span className="badge badge-green">Available</span>;
    if (s === 'reserved') return <span className="badge badge-yellow">Reserved</span>;
    if (s === 'used') return <span className="badge badge-gray">Used</span>;
    return <span className="badge badge-blue">{s}</span>;
  };

  return (
    <div>
      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'} mb-3`}>
          {msg.text}
          <button className="alert-close" onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-3">
        <div className="filter-bar">
          <div className="input-icon-wrapper">
            <Search size={14} className="input-icon" />
            <input
              placeholder="Tìm email..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ paddingLeft: 32 }}
            />
          </div>
          <select value={stateFilter} onChange={e => { setStateFilter(e.target.value); setPage(1); }} style={{ width: 'auto' }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            <option value="used">Used</option>
          </select>
          <select value={limit} onChange={e => { setLimit(parseInt(e.target.value, 10)); setPage(1); }} style={{ width: 'auto' }}>
            <option value="10">10 acc / trang</option>
            <option value="20">20 acc / trang</option>
            <option value="30">30 acc / trang</option>
            <option value="40">40 acc / trang</option>
            <option value="50">50 acc / trang</option>
            <option value="100">100 acc / trang</option>
          </select>
          <button id="hotmail-refresh-btn" className="btn btn-ghost btn-sm" onClick={fetchAccounts}>
            <RefreshCw size={14} />
            Làm mới
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleResetAll}
            style={{ marginLeft: 'auto', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', cursor: 'pointer' }}
          >
            <RefreshCw size={14} />
            Reset toàn bộ Available
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Tổng: <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> tài khoản
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner" /></div>
        ) : (
          <div className="table-container" style={{ borderRadius: 0, border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Trạng thái</th>
                  <th>Đã dùng</th>
                  <th>Lấy lúc</th>
                  <th>Note</th>
                  <th style={{ textAlign: 'right' }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Không có tài khoản nào
                    </td>
                  </tr>
                ) : accounts.map(acc => (
                  <tr key={acc.email}>
                    <td>
                      <span className="font-mono" style={{ color: 'var(--cyan)' }}>{acc.email}</span>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {acc.hasChatGPT ? (
                          <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(16,185,129,0.15)', color: '#10b981', borderRadius: 4, border: '1px solid rgba(16,185,129,0.2)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
                            Đã có ChatGPT
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 4, border: '1px solid rgba(239,68,68,0.15)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444' }} />
                            Chưa tạo ChatGPT
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{stateBadge(acc.state)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{acc.usedCount ?? 0}x</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {acc.takenAt ? new Date(acc.takenAt).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td>
                      <span className="truncate text-secondary text-xs">{acc.takenNote || '—'}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {acc.state !== 'available' && (
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Reset về Available"
                            onClick={() => handleUpdateState(acc.email, 'available')}
                          >
                            <RefreshCw size={13} style={{ color: 'var(--cyan)' }} />
                          </button>
                        )}
                        {acc.state !== 'used' && (
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Đánh dấu đã dùng (Used)"
                            onClick={() => handleUpdateState(acc.email, 'used')}
                          >
                            <CheckCircle size={13} style={{ color: 'var(--green)' }} />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Xóa"
                          onClick={() => setDeleteTarget(acc.email)}
                        >
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
                <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
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

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">⚠️ Xác nhận xóa</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              Bạn chắc muốn xóa <strong style={{ color: 'var(--red)' }}>{deleteTarget}</strong> không?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Hủy</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteTarget)}>Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB 2: NHẬP NHANH ────────────────────────────────────────────────────────
function HotmailBulkImport() {
  const [lines, setLines] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [singleLine, setSingleLine] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState(null);

  const handleBulk = async () => {
    if (!lines.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post('/admin-api/hotmail/bulk-import', { lines });
      setResult({ ok: true, data: res.data });
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi import.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSingle = async () => {
    if (!singleLine.trim()) return;
    setSingleLoading(true);
    setSingleResult(null);
    try {
      const res = await api.post('/admin-api/hotmail/save', { line: singleLine.trim() });
      setSingleResult({ ok: true, data: res.data });
    } catch (e) {
      setSingleResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi lưu.' });
    } finally {
      setSingleLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Single import */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Plus size={15} /> Thêm 1 tài khoản (có validate live)</span>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Format: email|pass|refresh_token|client_id hoặc email|pass|refresh_token|client_id|secret2fa</label>
          <input
            id="hotmail-single-input"
            placeholder="user@hotmail.com|password|eyJ...|client_id"
            value={singleLine}
            onChange={e => setSingleLine(e.target.value)}
            className="font-mono"
            style={{ fontSize: '0.82rem' }}
          />
        </div>
        <button
          id="hotmail-single-save-btn"
          className="btn btn-primary"
          onClick={handleSingle}
          disabled={singleLoading || !singleLine.trim()}
        >
          {singleLoading ? <><span className="spinner" /> Đang validate...</> : <><CheckCircle size={14} /> Lưu & Validate</>}
        </button>
        {singleResult && (
          <div className={`alert alert-${singleResult.ok ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
            {singleResult.ok
              ? `✅ ${singleResult.data.message} — ${singleResult.data.email}${singleResult.data.liveMessage ? ` | ${singleResult.data.liveMessage}` : ''}`
              : `❌ ${singleResult.error}`
            }
          </div>
        )}
      </div>

      {/* Bulk import */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Upload size={15} /> Nhập nhanh nhiều tài khoản</span>
          <span className="text-xs text-muted">Mỗi dòng 1 tài khoản, không validate live (nhanh)</span>
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label>Dán danh sách vào đây (mỗi dòng 1 account)</label>
          <textarea
            id="hotmail-bulk-textarea"
            rows={10}
            placeholder={"user1@hotmail.com|pass1|refresh_token1|client_id1\nuser2@hotmail.com|pass2|refresh_token2|client_id2\n..."}
            value={lines}
            onChange={e => setLines(e.target.value)}
            className="font-mono"
            style={{ fontSize: '0.8rem', minHeight: 200 }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {lines.split('\n').filter(l => l.trim()).length} dòng
          </div>
        </div>
        <button
          id="hotmail-bulk-import-btn"
          className="btn btn-success"
          onClick={handleBulk}
          disabled={loading || !lines.trim()}
        >
          {loading ? <><span className="spinner" /> Đang import...</> : <><Upload size={14} /> Import tất cả</>}
        </button>

        {result && (
          <div style={{ marginTop: 14 }}>
            {result.ok ? (
              <div>
                <div className="alert alert-success">
                  ✅ Import xong: <strong>{result.data.total}</strong> dòng —
                  <strong style={{ color: 'var(--green)' }}> {result.data.results?.filter(r => r.ok).length} thành công</strong>,
                  <strong style={{ color: 'var(--red)' }}> {result.data.results?.filter(r => !r.ok).length} thất bại</strong>
                </div>
                {result.data.results?.filter(r => !r.ok).length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--red)', marginBottom: 6 }}>Dòng lỗi:</div>
                    {result.data.results.filter(r => !r.ok).map((r, i) => (
                      <div key={i} className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--red)', background: 'rgba(239,68,68,0.07)', padding: '4px 8px', borderRadius: 4, marginBottom: 4 }}>
                        ❌ {r.line || r.email} — {r.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="alert alert-error">❌ {result.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TAB 3: ĐỌC MAIL ─────────────────────────────────────────────────────────
function HotmailReader() {
  const [email, setEmail] = useState('');
  const [line, setLine] = useState('');
  const [top, setTop] = useState('10');
  const [mode, setMode] = useState('email'); // 'email' | 'line'
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [viewMode, setViewMode] = useState({}); // {idx: 'html'|'text'}

  const handleRead = async () => {
    setLoading(true);
    setResult(null);
    setExpandedIdx(null);
    try {
      const payload = mode === 'email'
        ? { email: email.trim(), top: parseInt(top) }
        : { line: line.trim(), top: parseInt(top) };
      const res = await api.post('/admin-api/hotmail/read', payload);
      setResult({ ok: true, data: res.data });
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error?.message || e.message || 'Lỗi đọc mail.' });
    } finally {
      setLoading(false);
    }
  };

  const isHtml = (body) => body && /<[a-z][\s\S]*>/i.test(body);

  const toggleExpand = (i) => setExpandedIdx(prev => prev === i ? null : i);
  const getViewMode = (i, body) => viewMode[i] || (isHtml(body) ? 'html' : 'text');
  const setModeFor = (i, m) => setViewMode(prev => ({ ...prev, [i]: m }));

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Inbox size={15} /> Đọc Inbox Hotmail</span>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn ${mode === 'email' ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode('email')}>
            Tìm theo Email
          </button>
          <button className={`btn ${mode === 'line' ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode('line')}>
            Dán dòng thủ công
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {mode === 'email' ? (
            <div className="form-group">
              <label>Email (phải có trong kho)</label>
              <input
                id="hotmail-reader-email"
                placeholder="user@hotmail.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          ) : (
            <div className="form-group">
              <label>Dòng thủ công: email|pass|refresh_token|client_id</label>
              <input
                id="hotmail-reader-line"
                placeholder="user@hotmail.com|pass|eyJ...|client_id"
                value={line}
                onChange={e => setLine(e.target.value)}
                className="font-mono"
                style={{ fontSize: '0.82rem' }}
              />
            </div>
          )}
          <div className="form-group" style={{ maxWidth: 120 }}>
            <label>Số mail đọc</label>
            <select value={top} onChange={e => setTop(e.target.value)}>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>

        <button
          id="hotmail-read-btn"
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          onClick={handleRead}
          disabled={loading || (mode === 'email' ? !email.trim() : !line.trim())}
        >
          {loading ? <><span className="spinner" /> Đang đọc...</> : <><Inbox size={14} /> Đọc Inbox</>}
        </button>
      </div>

      {result && (
        <div className="card">
          {result.ok ? (
            <>
              <div className="card-header">
                <span className="card-title">
                  <Mail size={15} style={{ color: 'var(--blue)' }} />
                  {result.data.email} — {result.data.count} email
                </span>
                <span className="badge badge-blue">{result.data.scope || 'IMAP'}</span>
              </div>

              {result.data.messages?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>Hộp thư trống</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {result.data.messages.map((m, i) => {
                    const expanded = expandedIdx === i;
                    const bodyIsHtml = isHtml(m.body);
                    const curView = getViewMode(i, m.body);

                    return (
                      <div key={i} style={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden'
                      }}>
                        {/* Header hàng - click để mở rộng */}
                        <div
                          onClick={() => toggleExpand(i)}
                          style={{
                            display: 'flex', alignItems: 'center',
                            gap: 10, padding: '10px 14px',
                            cursor: 'pointer',
                            userSelect: 'none',
                            background: expanded ? 'rgba(59,130,246,0.06)' : 'transparent',
                            transition: 'background 0.2s'
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 20 }}>
                            {expanded ? '▼' : '▶'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {m.subject || '(Không có tiêu đề)'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              From: <strong>{m.from}</strong>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {bodyIsHtml && (
                              <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>HTML</span>
                            )}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {m.date ? new Date(m.date).toLocaleString('vi-VN') : ''}
                            </span>
                          </div>
                        </div>

                        {/* Nội dung email - chỉ hiện khi expand */}
                        {expanded && m.body && (
                          <div style={{ borderTop: '1px solid var(--border)' }}>
                            {/* Toggle HTML/Text nếu là HTML email */}
                            {bodyIsHtml && (
                              <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                                <button
                                  className={`btn btn-sm ${curView === 'html' ? 'btn-primary' : 'btn-ghost'}`}
                                  style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                  onClick={() => setModeFor(i, 'html')}
                                >
                                  Xem HTML
                                </button>
                                <button
                                  className={`btn btn-sm ${curView === 'text' ? 'btn-primary' : 'btn-ghost'}`}
                                  style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                  onClick={() => setModeFor(i, 'text')}
                                >
                                  Xem Raw
                                </button>
                              </div>
                            )}

                            {/* Nội dung render */}
                            {bodyIsHtml && curView === 'html' ? (
                              /* Render HTML email trong iframe sandbox */
                              <iframe
                                srcDoc={`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:Arial,sans-serif;background:#fff;color:#222;font-size:14px;line-height:1.5}img{max-width:100%}a{color:#2563eb}</style></head><body>${m.body}</body></html>`}
                                style={{
                                  width: '100%',
                                  minHeight: 300,
                                  maxHeight: 600,
                                  border: 'none',
                                  display: 'block',
                                  background: '#fff'
                                }}
                                sandbox="allow-same-origin"
                                title={`email-${i}`}
                                onLoad={e => {
                                  try {
                                    const h = e.target.contentDocument?.body?.scrollHeight;
                                    if (h) e.target.style.height = Math.min(h + 24, 600) + 'px';
                                  } catch {}
                                }}
                              />
                            ) : (
                              /* Hiện text thuần / raw */
                              <pre style={{
                                margin: 0,
                                padding: '12px 14px',
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontFamily: 'monospace',
                                maxHeight: 400,
                                overflow: 'auto',
                                background: 'var(--bg-surface)'
                              }}>{m.body}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="alert alert-error">❌ {result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

