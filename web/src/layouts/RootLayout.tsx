import { Outlet } from 'react-router-dom';
import TopNav from '../components/TopNav.js';
import NavRail from '../components/NavRail.js';
import { AgentProvider } from '../context/AgentContext.js';

export default function RootLayout() {
  return (
    <AgentProvider>
      <div className="app-shell">
        <TopNav />
        <div className="app-content">
          <NavRail />
          <main className="page-content">
            <Outlet />
          </main>
        </div>
      </div>
    </AgentProvider>
  );
}
