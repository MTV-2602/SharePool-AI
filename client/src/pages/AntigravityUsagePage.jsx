import { useState, useEffect } from 'react';
import { Activity, BarChart3, RefreshCw } from 'lucide-react';
import api from '../lib/api';

export default function AntigravityUsagePage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const role = localStorage.getItem('role') || 'admin';

  const fetch = async () => {
    setLoading(true);
    try {
      if (role === 'user') {
        const res = await api.get('/antigravity-user-api/daily');
        setData(Array.isArray(res.data) ? res.data : []);
      } else {
        // For admin, we can get usage stats by daily
        const res = await api.get('/antigravity-admin-api/stats');
        setData(Array.isArray(res.data.daily) ? res.data.daily : []);
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi tải usage.' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const maxVal = Math.max(1, ...data.map(d => (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0))) || 0));

  return (
    <div>
      <div className="page-header page-header-flex">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={22} style={{ color: '#e0a82e' }} />
            AntiGravity Usage Analytics
          </h1>
          <p>Thống kê lượng Tokens tiêu thụ qua phím AntiGravity (30 ngày gần nhất)</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetch} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin-anim' : ''} /> Làm mới
        </button>
      </div>

      {msg && <div className="alert alert-error" style={{ marginBottom: 14 }}>{msg.text}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" style={{ width: 32, height: 32, borderLeftColor: '#e0a82e' }} /></div>
      ) : data.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <BarChart3 size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Chưa có dữ liệu usage nào.</p>
        </div>
      ) : (
        <div className="card reveal">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span className="card-title"><BarChart3 size={15} /> Biểu đồ Tokens theo ngày</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: '#e0a82e', borderRadius: 2 }} />
                <span className="text-muted">Tokens In: {data.reduce((s, d) => s + (d.tokens_in || d.tokensIn || 0), 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: 'var(--green)', borderRadius: 2 }} />
                <span className="text-muted">Tokens Out: {data.reduce((s, d) => s + (d.tokens_out || d.tokensOut || 0), 0).toLocaleString()}</span>
              </div>
              <span className="text-xs text-muted" style={{ marginLeft: 8, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
                Tổng: {data.reduce((s, d) => s + (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0)) || 0), 0).toLocaleString()} tokens (~${((data.reduce((s, d) => s + (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0)) || 0), 0) / 1000000) * 5.5).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)
              </span>
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, marginBottom: 8, padding: '0 4px', overflowX: 'auto' }}>
            {data.slice(-30).map((d, i) => {
              const tIn = d.tokens_in || d.tokensIn || 0;
              const tOut = d.tokens_out || d.tokensOut || 0;
              const tTotal = d.tokens_total || d.tokensTotal || (tIn + tOut);
              const pctIn = tIn / maxVal;
              const pctOut = tOut / maxVal;
              const heightIn = Math.max(tIn > 0 ? 3 : 0, pctIn * 130);
              const heightOut = Math.max(tOut > 0 ? 3 : 0, pctOut * 130);

              return (
                <div key={d.date || i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto', width: 24 }}>
                  <div 
                    title={`${d.date}\nTokens In: ${tIn.toLocaleString()}\nTokens Out: ${tOut.toLocaleString()}\nTổng: ${tTotal.toLocaleString()}`}
                    style={{
                      width: '100%',
                      height: 130,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      cursor: 'default',
                    }}
                  >
                    {/* Tokens Out (Top Part) */}
                    {tOut > 0 && (
                      <div style={{
                        width: '100%',
                        height: heightOut,
                        background: 'linear-gradient(to top, var(--green), #34d399)',
                        borderRadius: tIn > 0 ? '3px 3px 0 0' : '3px',
                        transition: 'height 0.3s ease',
                        opacity: 0.9,
                      }} />
                    )}
                    {/* Tokens In (Bottom Part) */}
                    {tIn > 0 && (
                      <div style={{
                        width: '100%',
                        height: heightIn,
                        background: 'linear-gradient(to top, #e0a82e, #ffcb6b)',
                        borderRadius: tOut > 0 ? '0' : '3px 3px 0 0',
                        transition: 'height 0.3s ease',
                        opacity: 0.85,
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div style={{ display: 'flex', gap: 8, padding: '0 4px', overflowX: 'auto', marginBottom: 12 }}>
            {data.slice(-30).map((d, i) => (
              <div key={i} style={{ flex: '0 0 auto', width: 24, textAlign: 'center', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
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
                  <th style={{ textAlign: 'right' }}>Chi phí (~USD)</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((d, i) => {
                  const tIn = d.tokens_in || d.tokensIn || 0;
                  const tOut = d.tokens_out || d.tokensOut || 0;
                  const tTotal = d.tokens_total || d.tokensTotal || (tIn + tOut);
                  const estCost = (tTotal / 1000000) * 5.5;
                  return (
                    <tr key={d.date || i}>
                      <td style={{ fontWeight: 500 }}>{d.date || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#e0a82e', fontWeight: 600 }}>
                        {(d.requests || d.total || 0).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {tIn.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {tOut.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {tTotal.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {`~$${estCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
