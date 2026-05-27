import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Key, Mail, BookOpen,
  Settings, LogOut, Zap, ChevronRight,
  Send, Activity
} from 'lucide-react';
import './Sidebar.css';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/hotmail', icon: Mail, label: 'Hotmail' },
  { to: '/coursera', icon: BookOpen, label: 'Coursera' },
  { to: '/telegram', icon: Send, label: 'Telegram' },
  { to: '/api-keys', icon: Key, label: 'API Keys' },
  { to: '/usage', icon: Activity, label: 'Usage' },
  { to: '/settings', icon: Settings, label: 'Cài đặt' },
];

export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('adminKey');
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <Zap size={18} />
        </div>
        <span className="brand-name">CodeX Admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ to, icon: Icon, label }) => (
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

      <button className="sidebar-logout" onClick={handleLogout}>
        <LogOut size={16} />
        <span>Đăng xuất</span>
      </button>
    </aside>
  );
}
