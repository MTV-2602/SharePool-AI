import { useState, useEffect } from 'react';
import { Activity, BarChart3, RefreshCw } from 'lucide-react';
import api from '../lib/api';

export default function UsagePage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const role = localStorage.getItem('role') || 'admin';

  const fetch = async () => {
    setLoading(true);
    try {
      if (role === 'user') {
        const res = await api.get('/user-api/daily');
        setData(Array.isArray(res.data) ? res.data : []);
      } else {
        const res = await api.get('/admin-api/usage');
        setData(Array.isArray(res.data) ? res.data : []);
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải usage.' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const maxVal = Math.max(1, ...data.map(d => d.total || 0));

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={22} style={{ color: 'var(--green)' }} />
            Usage Analytics
          </h1>
          <p>Thống kê request theo ngày (30 ngày gần nhất)</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetch} disabled={loading}>
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>

      {msg && <div className="alert alert-error" style={{ marginBottom: 14 }}>{msg.text}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" style={{ width: 32, height: 32 }} /></div>
      ) : data.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <BarChart3 size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Chưa có dữ liệu usage nào.</p>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title"><BarChart3 size={15} /> Biểu đồ requests theo ngày</span>
            <span className="text-xs text-muted">Tổng: {data.reduce((s, d) => s + (d.total || 0), 0).toLocaleString()} requests</span>
          </div>

          {/* Bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160, marginBottom: 8, padding: '0 4px', overflowX: 'auto' }}>
            {data.slice(-30).map((d, i) => {
              const pct = (d.total || 0) / maxVal;
              return (
                <div key={d.date || i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 20 }}>
                  <div title={`${d.date}: ${d.total?.toLocaleString()}`} style={{
                    width: '100%', height: Math.max(2, pct * 130),
                    background: `linear-gradient(to top, var(--accent), var(--accent-light))`,
                    borderRadius: '3px 3px 0 0',
                    transition: 'height 0.3s ease',
                    cursor: 'default',
                    opacity: 0.85
                  }} />
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div style={{ display: 'flex', gap: 4, padding: '0 4px', overflowX: 'auto' }}>
            {data.slice(-30).map((d, i) => (
              <div key={i} style={{ flex: 1, minWidth: 20, textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {i % 5 === 0 ? (d.date || '').slice(5) : ''}
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="table-container" style={{ marginTop: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Tokens In</th>
                  <th style={{ textAlign: 'right' }}>Tokens Out</th>
                  <th style={{ textAlign: 'right' }}>Tổng Tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((d, i) => (
                  <tr key={d.date || i}>
                    <td style={{ fontWeight: 500 }}>{d.date || '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-light)', fontWeight: 600 }}>
                      {(d.total || 0).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {(d.tokens_in || 0).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {(d.tokens_out || 0).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {(d.tokens_total || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
