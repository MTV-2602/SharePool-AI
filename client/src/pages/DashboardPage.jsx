import { useEffect, useState } from 'react';
import {
  BarChart3, Key, Mail, BookOpen, Users,
  TrendingUp, Activity, RefreshCw, Zap
} from 'lucide-react';
import api from '../lib/api';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin-api/stats');
      setStats(res.data);
    } catch (err) {
      setError('Không lấy được dữ liệu dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

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
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Zap size={22} style={{ color: 'var(--accent)' }} />
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

      {loading && !stats ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : (
        <>
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

          {/* Accounts pool */}
          {stats?.accounts && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <span className="card-title">
                  <BookOpen size={16} style={{ color: 'var(--accent)' }} />
                  Coursera Account Pool
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
                      <th style={{ textAlign: 'right' }}>Requests</th>
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
        </>
      )}

      <style>{`
        .spin-anim { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
