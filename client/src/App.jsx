import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import HotmailPage from './pages/HotmailPage';
import CourseraPage from './pages/CourseraPage';
import ApiKeysPage from './pages/ApiKeysPage';
import SettingsPage from './pages/SettingsPage';
import TelegramPage from './pages/TelegramPage';
import UsagePage from './pages/UsagePage';

function RequireAuth({ children }) {
  const key = localStorage.getItem('adminKey');
  if (!key) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
          <Route path="coursera" element={<CourseraPage />} />
          <Route path="telegram" element={<TelegramPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
