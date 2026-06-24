import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.js';
import NavRail from '../components/NavRail.js';
import { AgentProvider } from '../context/AgentContext.js';
import { ChatProvider } from '../context/ChatContext.js';

function RootLayoutInner() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Alt+C — focus chat input; skip when already typing in an input/textarea
      if (e.altKey && e.key === 'c') {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        navigate('/chat');
        // autoFocus on the textarea handles focus when ChatPage mounts;
        // if already on /chat, focus the textarea directly
        setTimeout(() => {
          const el = document.querySelector<HTMLTextAreaElement>('.input-row__input');
          el?.focus();
        }, 0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-content">
        <NavRail />
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function RootLayout() {
  return (
    <AgentProvider>
      <ChatProvider>
        <RootLayoutInner />
      </ChatProvider>
    </AgentProvider>
  );
}
