import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from './layouts/RootLayout.js';
import ChatPage from './pages/ChatPage.js';
import MemoryPage from './pages/MemoryPage.js';
import IntegrationsPage from './pages/IntegrationsPage.js';
import SkillsPage from './pages/SkillsPage.js';
import NotificationsPage from './pages/NotificationsPage.js';
import ActivityPage from './pages/ActivityPage.js';
import SettingsPage from './pages/SettingsPage.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootLayout />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
