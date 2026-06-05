import { useEffect, useState } from 'react';
import {
  BarChart3, Key, Bot,
  TrendingUp, Activity, RefreshCw, Zap,
  Copy, Check, Clock
} from 'lucide-react';
import api from '../lib/api';

export default function AntigravityDashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const role = localStorage.getItem('role') || 'admin';

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      if (role === 'user') {
        const res = await api.post('/antigravity-user-api/login', { key: localStorage.getItem('adminKey') });
        setStats(res.data);
      } else {
        const res = await api.get('/antigravity-admin-api/stats');
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
      icon: Activity, label: 'Tổng Tokens', value: stats.totalTokens?.toLocaleString() ?? '0',
      color: '#e0a82e', bg: 'rgba(224,168,46,0.1)'
    },
    {
      icon: Key, label: 'API Keys', value: stats.totalKeys ?? '0',
      color: '#10b981', bg: 'rgba(16,185,129,0.1)'
    },
    {
      icon: Bot, label: 'Google Accounts', value: stats.accounts?.total ?? '0',
      color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'
    },
    {
      icon: TrendingUp, label: 'Hôm nay', value: stats.todayTokens?.toLocaleString() ?? '0',
      color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'
    },
  ] : [];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={22} style={{ color: '#e0a82e' }} />
            AntiGravity Dashboard
          </h1>
          <p>Hệ thống xoay vòng phím Google Gemini Code Assist</p>
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

      <div className="stat-grid">
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

      {/* Accounts pool summary */}
      {stats?.accounts && (
        <div className="card" style={{ marginBottom: 16, marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bot size={16} style={{ color: '#e0a82e' }} />
              Google Account Pool
            </span>
          </div>
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            {[
              { label: 'Tổng số tài khoản', value: stats.accounts.total ?? 0, color: 'var(--text-primary)' },
              { label: 'Hoạt động tốt', value: stats.accounts.available ?? 0, color: 'var(--green)' },
              { label: 'Đang Cooldown', value: stats.accounts.cooldown ?? 0, color: 'var(--yellow)' },
              { label: 'Bị Lỗi / Thất bại', value: stats.accounts.failed ?? 0, color: 'var(--red)' },
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
              <BarChart3 size={16} style={{ color: '#e0a82e' }} />
              Top API Keys sử dụng nhiều nhất (tokens)
            </span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên</th>
                  <th>Key</th>
                  <th style={{ textAlign: 'right' }}>Tổng Tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.topKeys.map((k, i) => (
                  <tr key={k.id || i}>
                    <td>
                      <span style={{
                        width: 24, height: 24,
                        background: i === 0 ? 'rgba(224,168,46,0.1)' : 'var(--bg-elevated)',
                        borderRadius: '50%',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700,
                        color: i === 0 ? '#e0a82e' : 'var(--text-muted)'
                      }}>{i + 1}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{k.name || '—'}</td>
                    <td><code className="font-mono">{k.key_value?.slice(0, 16) || '...'}...</code></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#e0a82e' }}>
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
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={22} style={{ color: '#e0a82e' }} />
            Dashboard của bạn
          </h1>
          <p>Chào mừng, {stats.name || 'User'}! Theo dõi hạn mức sử dụng API Key AntiGravity.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchStats} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin-anim' : ''} /> Làm mới
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Grid statistics */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Quota đã dùng (tokens)', value: used.toLocaleString(), color: '#e0a82e' },
          { label: 'Quota còn lại (tokens)', value: isInfinite ? '∞' : remaining.toLocaleString(), color: 'var(--green)' },
          { label: 'Tổng Quota (tokens)', value: isInfinite ? 'Không giới hạn' : total.toLocaleString(), color: 'var(--text-primary)' },
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
              <Key size={16} style={{ color: '#e0a82e' }} />
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
            Sử dụng API Key này làm Bearer Token hoặc x-api-key cho endpoint: <code>/v1/antigravity</code>
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} style={{ color: '#e0a82e' }} />
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
              <span style={{ color: 'var(--text-secondary)' }}>Hạn mức đã dùng:</span>
              <span style={{ fontWeight: 600, color: pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : '#e0a82e' }}>
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
    </div>
  );
}
