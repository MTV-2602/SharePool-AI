import { useState, useEffect } from 'react';
import { Activity, BarChart3, RefreshCw } from 'lucide-react';
import api from '../lib/api';

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const justDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = justDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
    }
    return dateStr;
  } catch {
    return dateStr;
  }
};

const formatChartDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const justDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = justDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`; // DD/MM
    }
    return dateStr.slice(5, 10);
  } catch {
    return dateStr;
  }
};

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

  const maxVal = Math.max(1, ...data.map(d => (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0))) || 0));

  // Compute points for SVG line chart
  const chartData = data.slice(-30);
  const pointsIn = [];
  const pointsOut = [];
  const pointsTotal = [];
  const N = chartData.length;

  chartData.forEach((d, i) => {
    const tIn = d.tokens_in || d.tokensIn || 0;
    const tOut = d.tokens_out || d.tokensOut || 0;
    const tTotal = d.tokens_total || d.tokensTotal || (tIn + tOut);

    const x = N > 1 ? 30 + (i / (N - 1)) * 940 : 500;
    const yIn = 130 - (tIn / maxVal) * 110;
    const yOut = 130 - (tOut / maxVal) * 110;
    const yTotal = 130 - (tTotal / maxVal) * 110;

    pointsIn.push({ x, y: yIn, val: tIn, date: d.date || '' });
    pointsOut.push({ x, y: yOut, val: tOut, date: d.date || '' });
    pointsTotal.push({ x, y: yTotal, val: tTotal, date: d.date || '' });
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            <Activity size={22} className="icon-green" />
            Usage Analytics
          </h1>
          <p>Thống kê lượng Token tiêu thụ theo ngày (30 ngày gần nhất)</p>
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
        <div className="card reveal">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span className="card-title"><BarChart3 size={15} /> Biểu đồ đường đi Tokens theo ngày</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 2 }} />
                <span className="text-muted">Tokens In: {data.reduce((s, d) => s + (d.tokens_in || d.tokensIn || 0), 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 10, height: 10, background: 'var(--green)', borderRadius: 2 }} />
                <span className="text-muted">Tokens Out: {data.reduce((s, d) => s + (d.tokens_out || d.tokensOut || 0), 0).toLocaleString()}</span>
              </div>
              <span className="text-xs text-muted" style={{ marginLeft: 8, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
                Tổng: {data.reduce((s, d) => s + (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0)) || 0), 0).toLocaleString()} tokens (~${((data.reduce((s, d) => s + (d.tokens_total || d.tokensTotal || ((d.tokens_in || d.tokensIn || 0) + (d.tokens_out || d.tokensOut || 0)) || 0), 0) / 1000000) * 5.0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)
              </span>
            </div>
          </div>

          {/* SVG Line Chart */}
          <div className="chart-container-wrapper" style={{ overflowX: 'auto', marginBottom: 16 }}>
            <svg viewBox="0 0 1000 160" width="100%" height="160" style={{ minWidth: 600, display: 'block' }}>
              <defs>
                <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.00" />
                </linearGradient>
                <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--green)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              
              {/* Horizontal Grid lines */}
              <line x1="30" y1="20" x2="970" y2="20" stroke="var(--border)" strokeDasharray="4 4" strokeWidth="0.8" />
              <line x1="30" y1="75" x2="970" y2="75" stroke="var(--border)" strokeDasharray="4 4" strokeWidth="0.8" />
              <line x1="30" y1="130" x2="970" y2="130" stroke="var(--border)" strokeWidth="1" />
              
              {/* Area under line: Tokens In */}
              {pointsIn.length > 1 && (
                <path
                  d={`M ${pointsIn[0].x} 130 ${pointsIn.map(p => `L ${p.x} ${p.y}`).join(' ')} L ${pointsIn[pointsIn.length - 1].x} 130 Z`}
                  fill="url(#gradIn)"
                />
              )}
              
              {/* Area under line: Tokens Out */}
              {pointsOut.length > 1 && (
                <path
                  d={`M ${pointsOut[0].x} 130 ${pointsOut.map(p => `L ${p.x} ${p.y}`).join(' ')} L ${pointsOut[pointsOut.length - 1].x} 130 Z`}
                  fill="url(#gradOut)"
                />
              )}

              {/* Line: Tokens In */}
              {pointsIn.length > 1 && (
                <path
                  d={pointsIn.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Line: Tokens Out */}
              {pointsOut.length > 1 && (
                <path
                  d={pointsOut.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Interactive Dots */}
              {pointsIn.map((p, idx) => {
                const pOut = pointsOut[idx];
                const dateStr = formatChartDate(p.date); // DD/MM
                
                return (
                  <g key={idx} className="chart-group">
                    {/* Hover indicator line */}
                    <line
                      x1={p.x}
                      y1="20"
                      x2={p.x}
                      y2="130"
                      stroke="var(--border)"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                      opacity="0"
                      className="chart-hover-line"
                    />
                    
                    {/* Dot: Tokens In */}
                    {p.val > 0 && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="3.5"
                        fill="var(--accent)"
                        stroke="var(--bg)"
                        strokeWidth="1.5"
                        className="chart-dot"
                      >
                        <title>{`${formatDate(p.date)}\nTokens In: ${p.val.toLocaleString()}`}</title>
                      </circle>
                    )}

                    {/* Dot: Tokens Out */}
                    {pOut.val > 0 && (
                      <circle
                        cx={pOut.x}
                        cy={pOut.y}
                        r="3.5"
                        fill="var(--green)"
                        stroke="var(--bg)"
                        strokeWidth="1.5"
                        className="chart-dot"
                      >
                        <title>{`${formatDate(pOut.date)}\nTokens Out: ${pOut.val.toLocaleString()}`}</title>
                      </circle>
                    )}
                    
                    {/* X Axis Label */}
                    {idx % 5 === 0 && (
                      <text
                        x={p.x}
                        y="148"
                        textAnchor="middle"
                        fill="var(--text-muted)"
                        fontSize="10"
                        fontWeight="500"
                      >
                        {dateStr}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
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
                  const estCost = (tTotal / 1000000) * 5.0;
                  return (
                    <tr key={d.date || i}>
                      <td style={{ fontWeight: 500 }}>{formatDate(d.date)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-light)', fontWeight: 600 }}>
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
