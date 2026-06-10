import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import RootLayout from './layouts/RootLayout.js';
import ChatPage from './pages/ChatPage.js';
import MemoryPage from './pages/MemoryPage.js';
import IntegrationsPage from './pages/IntegrationsPage.js';
import SkillsPage from './pages/SkillsPage.js';
import NotificationsPage from './pages/NotificationsPage.js';
import ActivityPage from './pages/ActivityPage.js';
import SettingsPage from './pages/SettingsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import ProjectDetailPage from './pages/ProjectDetailPage.js';
import TaskDetailPage from './pages/TaskDetailPage.js';
import DecisionsPage from './pages/DecisionsPage.js';
import SearchPage from './pages/SearchPage.js';
import CalendarPage from './pages/CalendarPage.js';
import DelegationsPage from './pages/DelegationsPage.js';
import { pingServer, verifyToken, getStoredToken, setStoredToken } from './api.js';

type AuthState = 'loading' | 'ready' | 'needs-token';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { auth } = await pingServer();
        if (!auth) { setAuthState('ready'); return; }

        const stored = getStoredToken();
        if (stored && await verifyToken(stored)) {
          setAuthState('ready');
        } else {
          setAuthState('needs-token');
        }
      } catch {
        // Server unreachable — still show app, individual calls will surface errors
        setAuthState('ready');
      }
    })();
  }, []);

  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTokenError('');
    setChecking(true);
    const ok = await verifyToken(tokenInput.trim());
    setChecking(false);
    if (ok) {
      setStoredToken(tokenInput.trim());
      setAuthState('ready');
    } else {
      setTokenError('Invalid token — check your credentials file and try again.');
    }
  }

  if (authState === 'loading') {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (authState === 'needs-token') {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-logo">Koa</div>
          <h2>Authentication required</h2>
          <p>Enter your web token to continue. Generate one with <code>koa config set web-token</code>.</p>
          <form onSubmit={handleTokenSubmit}>
            <input
              type="password"
              className="auth-input"
              placeholder="Paste token…"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              autoFocus
            />
            {tokenError && <p className="auth-error">{tokenError}</p>}
            <button className="auth-btn" type="submit" disabled={checking || !tokenInput.trim()}>
              {checking ? 'Verifying…' : 'Connect'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="decisions" element={<DecisionsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="delegations" element={<DelegationsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
