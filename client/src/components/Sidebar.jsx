import { useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Key, Mail, Bot,
  Settings, LogOut, Rocket, ChevronRight,
  Send, Activity, ArrowLeftRight
} from 'lucide-react';
import './Sidebar.css';

const NAV_CODEX = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/hotmail', icon: Mail, label: 'Hotmail' },
  { to: '/chatgpt', icon: Bot, label: 'ChatGPT Pool' },
  { to: '/telegram', icon: Send, label: 'Telegram' },
  { to: '/api-keys', icon: Key, label: 'API Keys' },
  { to: '/usage', icon: Activity, label: 'Usage' },
  { to: '/settings', icon: Settings, label: 'Cài đặt' },
];

const NAV_ANTIGRAVITY = [
  { to: '/antigravity/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/antigravity/accounts', icon: Bot, label: 'Google Pool' },
  { to: '/antigravity/api-keys', icon: Key, label: 'API Keys' },
  { to: '/antigravity/usage', icon: Activity, label: 'Usage' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = localStorage.getItem('role') || 'admin';
  const isAntigravity = location.pathname.startsWith('/antigravity');

  const handleLogout = () => {
    localStorage.removeItem('adminKey');
    localStorage.removeItem('role');
    if (isAntigravity) {
      navigate('/antigravity/login');
    } else {
      navigate('/login');
    }
  };

  const currentNav = isAntigravity ? NAV_ANTIGRAVITY : NAV_CODEX;

  const filteredNav = currentNav.filter(item => {
    if (role === 'user') {
      return item.to.endsWith('dashboard') || item.to.endsWith('usage');
    }
    return true;
  });

  const handleTogglePortal = () => {
    if (isAntigravity) {
      navigate('/dashboard');
    } else {
      navigate('/antigravity/dashboard');
    }
  };

  useEffect(() => {
    // Dynamic Title based on portal and role
    const titleText = isAntigravity 
      ? (role === 'user' ? 'AntiGravity Portal' : 'AntiGravity Admin')
      : (role === 'user' ? 'CodeX Portal' : 'CodeX Admin');
    document.title = titleText;

    // Dynamic Favicon based on role
    let faviconEl = document.querySelector('link[rel="icon"]');
    if (!faviconEl) {
      faviconEl = document.createElement('link');
      faviconEl.rel = 'icon';
      document.head.appendChild(faviconEl);
    }
    if (role === 'admin') {
      faviconEl.setAttribute('type', 'image/jpeg');
      faviconEl.setAttribute('href', '/admin.jpg');
    } else {
      faviconEl.setAttribute('type', 'image/svg+xml');
      faviconEl.setAttribute('href', '/favicon.svg');
    }
  }, [role, isAntigravity]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon" style={{ backgroundColor: isAntigravity ? '#e0a82e' : undefined }}>
          <Rocket size={18} />
        </div>
        <span className="brand-name">
          {isAntigravity 
            ? (role === 'user' ? 'AntiGravity Portal' : 'AntiGravity Admin')
            : (role === 'user' ? 'CodeX Portal' : 'CodeX Admin')}
        </span>
      </div>

      <nav className="sidebar-nav">
        {filteredNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={17} />
            <span>{label}</span>
            <ChevronRight size={13} className="nav-chevron" />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        {role === 'admin' && (
          <button className="sidebar-toggle-portal" onClick={handleTogglePortal}>
            <ArrowLeftRight size={15} />
            <span>{isAntigravity ? 'Chuyển sang CodeX' : 'Chuyển sang AntiGravity'}</span>
          </button>
        )}
        <button className="sidebar-logout" onClick={handleLogout}>
          <LogOut size={16} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
