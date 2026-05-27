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
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [msg, setMsg] = useState(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin-api/hotmail/accounts', {
        params: { page, limit: 20, state: stateFilter, search }
      });
      setAccounts(res.data.accounts || []);
      setTotalPages(res.data.totalPages || 1);
      setTotal(res.data.filteredTotal || 0);
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải danh sách.' });
    } finally {
      setLoading(false);
    }
  }, [page, stateFilter, search]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleDelete = async (email) => {
    try {
      await api.delete(`/admin-api/hotmail/delete/${encodeURIComponent(email)}`);
      setMsg({ type: 'success', text: `Đã xóa ${email}` });
      fetchAccounts();
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || 'Xóa thất bại.' });
    }
    setDeleteTarget(null);
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
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: 14 }}>
          {msg.text}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }} onClick={() => setMsg(null)}>×</button>
        </div>
      )}

      {/* Filters */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
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
          <button id="hotmail-refresh-btn" className="btn btn-ghost btn-sm" onClick={fetchAccounts}>
            <RefreshCw size={14} />
            Làm mới
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
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
      setResult({ ok: false, error: e.response?.data?.error || 'Lỗi import.' });
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
      setSingleResult({ ok: false, error: e.response?.data?.error || 'Lỗi lưu.' });
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

  const handleRead = async () => {
    setLoading(true);
    setResult(null);
    try {
      const payload = mode === 'email'
        ? { email: email.trim(), top: parseInt(top) }
        : { line: line.trim(), top: parseInt(top) };
      const res = await api.post('/admin-api/hotmail/read', payload);
      setResult({ ok: true, data: res.data });
    } catch (e) {
      setResult({ ok: false, error: e.response?.data?.error || 'Lỗi đọc mail.' });
    } finally {
      setLoading(false);
    }
  };

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
                <div style={{ display: 'grid', gap: 10 }}>
                  {result.data.messages.map((m, i) => (
                    <div key={i} style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 14px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                          {m.subject || '(Không có tiêu đề)'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {m.date ? new Date(m.date).toLocaleString('vi-VN') : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                        From: <strong>{m.from}</strong>
                      </div>
                      {m.body && (
                        <div style={{
                          fontSize: '0.82rem',
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '8px 10px',
                          maxHeight: 120,
                          overflow: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'monospace'
                        }}>{m.body}</div>
                      )}
                    </div>
                  ))}
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
