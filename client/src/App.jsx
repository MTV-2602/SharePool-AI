import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import HotmailPage from './pages/HotmailPage';
import ChatGPTPage from './pages/ChatGPTPage';
import ApiKeysPage from './pages/ApiKeysPage';
import SettingsPage from './pages/SettingsPage';
import TelegramPage from './pages/TelegramPage';
import UsagePage from './pages/UsagePage';

// Antigravity Pages
import AntigravityLoginPage from './pages/AntigravityLoginPage';
import AntigravityDashboardPage from './pages/AntigravityDashboardPage';
import AntigravityAccountsPage from './pages/AntigravityAccountsPage';
import AntigravityApiKeysPage from './pages/AntigravityApiKeysPage';
import AntigravityUsagePage from './pages/AntigravityUsagePage';
import GuidePage from './pages/GuidePage';

function RequireAuth({ children }) {
  const key = localStorage.getItem('adminKey');
  if (!key) {
    const isAntigravity = window.location.pathname.startsWith('/antigravity');
    return <Navigate to={isAntigravity ? "/antigravity/login" : "/login"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/antigravity/login" element={<AntigravityLoginPage />} />
        <Route path="/antigravity/guide" element={<GuidePage />} />

        {/* CodeX Portal Routes */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="hotmail" element={<HotmailPage />} />
          <Route path="chatgpt" element={<ChatGPTPage />} />
          <Route path="telegram" element={<TelegramPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* AntiGravity Portal Routes */}
        <Route
          path="/antigravity"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/antigravity/dashboard" replace />} />
          <Route path="dashboard" element={<AntigravityDashboardPage />} />
          <Route path="accounts" element={<AntigravityAccountsPage />} />
          <Route path="api-keys" element={<AntigravityApiKeysPage />} />
          <Route path="usage" element={<AntigravityUsagePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
