import { useState, useEffect } from 'react';
import { Send, Bot, MessageSquare, RefreshCw, Copy, Check } from 'lucide-react';
import api from '../lib/api';

export default function TelegramPage() {
  const [loading, setLoading] = useState(false);
  const [botInfo, setBotInfo] = useState(null);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${window.location.origin}/api/telegram-webhook`;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const testBot = async () => {
    setLoading(true); setMsg(null); setBotInfo(null);
    try {
      // Try to get bot info through our backend
      const res = await api.get('/admin-api/settings');
      const token = res.data.settings?.TELEGRAM_BOT_TOKEN;
      if (!token) {
        setMsg({ type: 'error', text: 'Chưa cài Telegram Bot Token. Vào Settings để nhập.' });
        return;
      }
      setMsg({ type: 'success', text: `✅ Bot Token đã được cấu hình: ${token.slice(0, 12)}...` });
    } catch (e) {
      setMsg({ type: 'error', text: 'Lỗi kiểm tra bot.' });
    } finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <h1>
          <Send size={22} className="icon-cyan" />
          Telegram Bot
        </h1>
        <p>Cấu hình Telegram Bot để nhận thông báo và điều khiển qua chat</p>
      </div>

      {msg && (
        <div className={`alert alert-${msg.type === 'success' ? 'success' : 'error'} mb-4`}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Status card */}
        <div className="card reveal">
          <div className="card-header">
            <span className="card-title"><Bot size={15} /> Trạng thái Bot</span>
            <button className="btn btn-ghost btn-sm" onClick={testBot} disabled={loading}>
              <RefreshCw size={14} /> Kiểm tra
            </button>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Đi tới <strong>Settings</strong> để nhập Telegram Bot Token, sau đó quay lại đây để kiểm tra.
          </p>
        </div>

        {/* Webhook URL */}
        <div className="card reveal">
          <div className="card-header">
            <span className="card-title"><MessageSquare size={15} /> Webhook URL</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 12 }}>
            Sử dụng URL này để đăng ký webhook với Telegram (tự động nếu deploy trên Vercel):
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, display: 'block', padding: '10px 12px',
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)', fontSize: '0.8rem',
              wordBreak: 'break-all', color: 'var(--cyan)'
            }}>
              {webhookUrl}
            </code>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={copyWebhook} title="Copy">
              {copied ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Guide */}
        <div className="card reveal">
          <div className="card-header">
            <span className="card-title">📖 Hướng dẫn cài đặt</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              { step: '1', text: 'Tìm @BotFather trên Telegram và tạo bot mới bằng lệnh /newbot' },
              { step: '2', text: 'Copy Bot Token từ BotFather và dán vào Settings → Telegram Bot Token' },
              { step: '3', text: 'Lưu settings — webhook sẽ tự đăng ký nếu đang chạy trên Vercel' },
              { step: '4', text: 'Chat với bot của bạn để kiểm tra hoạt động' },
            ].map(({ step, text }) => (
              <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  width: 26, height: 26, background: 'var(--accent-glow)',
                  borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700,
                  color: 'var(--accent-light)', flexShrink: 0
                }}>{step}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', paddingTop: 3 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
