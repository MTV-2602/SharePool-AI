import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import './Layout.css';

export default function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const role = localStorage.getItem('role') || 'admin';
  const isAntigravity = location.pathname.startsWith('/antigravity');

  // Close sidebar automatically on navigation path changes
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="layout">
      {/* Sidebar Backdrop Overlay on Mobile */}
      {isSidebarOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar isMobileOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      <main className="layout-main">
        {/* Mobile Top Header */}
        <header className="layout-mobile-navbar">
          <button 
            className="mobile-menu-btn" 
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
          <div className="mobile-brand-name">
            {isAntigravity ? 'AntiGravity' : 'CodeX'} {role === 'admin' ? 'Admin' : 'Portal'}
          </div>
          <div style={{ width: 36 }} /> {/* Spacer to center title */}
        </header>

        <div className="layout-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
