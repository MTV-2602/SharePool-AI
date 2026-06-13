import { useEffect, useState } from 'react';
import {
  BarChart3, Key, Mail, Bot, Users,
  TrendingUp, Activity, RefreshCw, Rocket,
  Copy, Check, Clock
} from 'lucide-react';
import api from '../lib/api';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const role = localStorage.getItem('role') || 'admin';

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      if (role === 'user') {
        const res = await api.post('/user-api/login', { key: localStorage.getItem('adminKey') });
        setStats(res.data);
      } else {
        const res = await api.get('/admin-api/stats');
        setStats(res.data);
      }
    } catch (err) {
      setError('Không lấy được dữ liệu dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  if (loading && !stats) return (
    <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  if (role === 'user') {
    return <UserDashboard stats={stats} error={error} fetchStats={fetchStats} loading={loading} />;
  }

  const statItems = stats ? [
    {
      icon: Activity, label: 'Tổng request', value: stats.totalRequests?.toLocaleString() ?? '0',
      color: '#6366f1', bg: 'rgba(99,102,241,0.1)'
    },
    {
      icon: Key, label: 'API Keys', value: stats.totalKeys ?? '0',
      color: '#10b981', bg: 'rgba(16,185,129,0.1)'
    },
    {
      icon: Mail, label: 'Hotmail', value: (stats.hotmail?.total ?? stats.hotmailTotal ?? '—'),
      color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'
    },
    {
      icon: TrendingUp, label: 'Hôm nay', value: stats.todayRequests?.toLocaleString() ?? '0',
      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'
    },
  ] : [];

  return (
    <div>
      <div className="page-header page-header-flex">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Rocket size={22} className="header-icon" />
            Dashboard
          </h1>
          <p>Tổng quan hệ thống realtime</p>
        </div>
        <button
          id="dashboard-refresh-btn"
          className="btn btn-ghost btn-sm"
          onClick={fetchStats}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
          Làm mới
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-grid reveal">
        {statItems.map(({ icon: Icon, label, value, color, bg }) => (
          <div key={label} className="stat-card">
            <div className="stat-card-icon" style={{ background: bg }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div className="stat-card-value">{value}</div>
            <div className="stat-card-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Quota & Token Capacity Analysis */}
      {stats && stats.totalCapacity !== undefined && (() => {
        const totalCapacitySession = stats.totalCapacitySession || 0;
        const totalCapacityMonthly = stats.totalCapacityMonthly || 0;
        const allocatedQuotaRaw = stats.allocatedQuotaRaw || 0;
        const remainingToSellQuota = stats.remainingToSell || 0;
        const averageMultiplier = stats.averageMultiplier || 1.5;

        const isSafe = remainingToSellQuota >= 0;

        const formatTokens = (val) => {
          return val >= 1_000_000 
            ? `${(val / 1_000_000).toFixed(1)}M` 
            : `${(val / 1_000).toFixed(0)}K`;
        };

        return (
          <div className="card" style={{ marginBottom: 16, marginTop: 16 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={16} style={{ color: 'var(--accent)' }} />
                Cân Đối Quota & Dự Báo Kinh Doanh (Hạn mức Thực tế & Tỷ giá Hệ thống)
              </span>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Tỷ giá tiêu thụ TB hệ thống: <strong style={{ color: 'var(--cyan)' }}>{averageMultiplier.toFixed(2)}x</strong>
              </div>
            </div>
            <div className="stat-grid" style={{ marginBottom: 14 }}>
              {totalCapacitySession > 0 ? (
                <div className="stat-card" style={{ padding: 14, borderLeft: '4px solid var(--accent)' }}>
                  <div className="stat-card-value" style={{ fontSize: '1.3rem' }}>
                    {formatTokens(totalCapacitySession)}
                  </div>
                  <div className="stat-card-label" style={{ fontSize: '0.72rem' }}>Hạn mức 5H thực tế (Raw Session)</div>
                </div>
              ) : (
                <div className="stat-card" style={{ padding: 14, borderLeft: '4px solid var(--accent)', opacity: 0.75 }}>
                  <div className="stat-card-value" style={{ fontSize: '1.3rem', color: 'var(--text-muted)' }}>
                    Không áp dụng
                  </div>
                  <div className="stat-card-label" style={{ fontSize: '0.72rem' }}>Hạn mức 5H thực tế (Tài khoản Free)</div>
                </div>
              )}
              <div className="stat-card" style={{ padding: 14, borderLeft: '4px solid #a855f7' }}>
                <div className="stat-card-value" style={{ fontSize: '1.3rem' }}>
                  {formatTokens(totalCapacityMonthly)}
                </div>
                <div className="stat-card-label" style={{ fontSize: '0.72rem' }}>Hạn mức Tháng thực tế (Raw Monthly)</div>
              </div>
              <div className="stat-card" style={{ padding: 14, borderLeft: '4px solid #3b82f6' }}>
                <div className="stat-card-value" style={{ fontSize: '1.3rem' }}>
                  {(allocatedQuotaRaw / 1_000_000).toFixed(1)}M
                </div>
                <div className="stat-card-label" style={{ fontSize: '0.72rem' }}>Dung lượng Quota đã bán (Quy đổi Raw)</div>
              </div>
              <div className="stat-card" style={{ padding: 14, borderLeft: `4px solid ${isSafe ? 'var(--green)' : 'var(--red)'}` }}>
                <div className="stat-card-value" style={{ fontSize: '1.3rem', color: isSafe ? 'var(--green)' : 'var(--red)' }}>
                  {(remainingToSellQuota / 1_000_000).toFixed(1)}M
                </div>
                <div className="stat-card-label" style={{ fontSize: '0.72rem' }}>
                  {isSafe ? 'Dung lượng Quota còn lại có thể bán thêm' : 'Dung lượng bán vượt mức (Over-sell)'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', padding: 12, borderRadius: 8 }}>
              <strong>💡 Gợi ý cho Admin:</strong>
              {isSafe ? (
                <span style={{ marginLeft: 6 }}>
                  Hệ thống hoạt động an toàn. Bạn có thể tạo thêm API Key mới với hạn mức tối đa khoảng <strong>{(remainingToSellQuota / 1_000_000).toFixed(1)}M Quota tokens</strong> (tính theo tỷ giá tiêu thụ trung bình {averageMultiplier.toFixed(2)}x của hệ thống).
                </span>
              ) : (
                <span style={{ marginLeft: 6 }}>
                  ⚠️ Cảnh báo: Hệ thống đang ở trạng thái bán vượt mức (Over-sell) <strong>{Math.abs(remainingToSellQuota / 1_000_000).toFixed(1)}M Quota tokens</strong>. Hãy bổ sung tài khoản hoặc nâng cấp gói để đảm bảo vận hành ổn định.
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Accounts pool */}
      {stats?.accounts && (
        <div className="card" style={{ marginBottom: 16, marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">
              <Bot size={16} style={{ color: 'var(--accent)' }} />
              ChatGPT Account Pool
            </span>
          </div>
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            {[
              { label: 'Tổng', value: stats.accounts.total ?? 0, color: 'var(--text-primary)' },
              { label: 'Available', value: stats.accounts.available ?? 0, color: 'var(--green)' },
              { label: 'Exhausted', value: stats.accounts.exhausted ?? 0, color: 'var(--yellow)' },
              { label: 'Failed', value: stats.accounts.failed ?? 0, color: 'var(--red)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="stat-card" style={{ padding: 14 }}>
                <div className="stat-card-value" style={{ color, fontSize: '1.3rem' }}>{value}</div>
                <div className="stat-card-label">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Keys */}
      {stats?.topKeys?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <BarChart3 size={16} style={{ color: 'var(--accent)' }} />
              Top API Keys sử dụng nhiều nhất
            </span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên</th>
                  <th>Key</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.topKeys.map((k, i) => (
                  <tr key={k.id || i}>
                    <td>
                      <span style={{
                        width: 24, height: 24,
                        background: i === 0 ? 'var(--accent-glow)' : 'var(--bg-elevated)',
                        borderRadius: '50%',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700,
                        color: i === 0 ? 'var(--accent-light)' : 'var(--text-muted)'
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{k.name || '—'}</td>
                    <td><code className="font-mono">{k.key_value?.slice(0, 16) || '...'}...</code></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-light)' }}>
                      {k.total?.toLocaleString() ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .spin-anim { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function UserDashboard({ stats, error, fetchStats, loading }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!stats?.key) return;
    navigator.clipboard.writeText(stats.key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!stats) return null;

  const total = stats.quotaTotal ?? 0;
  const used = stats.quotaUsed ?? 0;
  const remaining = stats.quotaRemaining ?? 0;
  const pct = stats.usagePct ?? 0;
  const isInfinite = total >= 9999999999;

  return (
    <div>
      <div className="page-header page-header-flex">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Rocket size={22} className="header-icon" />
            Dashboard của bạn
          </h1>
          <p>Chào mừng, {stats.name || 'User'}! Theo dõi mức độ sử dụng API key.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchStats} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin-anim' : ''} /> Làm mới
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Grid statistics */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Quota đã dùng', value: used.toLocaleString(), color: 'var(--accent)' },
          { label: 'Quota còn lại', value: isInfinite ? '∞' : remaining.toLocaleString(), color: 'var(--green)' },
          { label: 'Tổng Quota', value: isInfinite ? 'Không giới hạn' : total.toLocaleString(), color: 'var(--text-primary)' },
          { label: 'Tokens Input', value: (stats.tokensIn || 0).toLocaleString(), color: 'var(--cyan)' },
          { label: 'Tokens Output', value: (stats.tokensOut || 0).toLocaleString(), color: 'var(--purple)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-card-value" style={{ color: s.color, fontSize: '1.4rem' }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* API Key info */}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Key size={16} style={{ color: 'var(--accent)' }} />
              API Key của bạn
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <code style={{
              flex: 1, display: 'block', padding: '10px 12px',
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', fontSize: '0.8rem',
              wordBreak: 'break-all', color: 'var(--cyan)',
              fontFamily: 'monospace'
            }}>
              {stats.key}
            </code>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={handleCopy} title="Copy Key" style={{ padding: 8 }}>
              {copied ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Copy size={14} />}
            </button>
          </div>
          <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Sử dụng API Key này làm Bearer Token hoặc x-api-key trong ứng dụng của bạn.
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} style={{ color: 'var(--accent)' }} />
              Chi tiết Key
            </span>
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 12, fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Trạng thái:</span>
              <span className="badge badge-green">Hoạt động</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Ngày hết hạn:</span>
              <span style={{ fontWeight: 600 }}>
                {stats.expiresAt ? new Date(stats.expiresAt).toLocaleDateString('vi-VN') : 'Không giới hạn'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Tỷ lệ đã dùng:</span>
              <span style={{ fontWeight: 600, color: pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--accent)' }}>
                {pct}%
              </span>
            </div>
            {stats.note && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ghi chú:</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{stats.note}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <style>{`
        .spin-anim { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
