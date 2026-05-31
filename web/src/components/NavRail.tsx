import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat', icon: '💬' },
] as const;

const SECONDARY_ITEMS = [
  { to: '/memory', label: 'Memory', icon: '🧠' },
  { to: '/integrations', label: 'Integrations', icon: '🔌' },
  { to: '/skills', label: 'Skills', icon: '🛠' },
  { to: '/notifications', label: 'Notifications', icon: '📣' },
  { to: '/activity', label: 'Activity', icon: '📊' },
] as const;

const BOTTOM_ITEMS = [
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const;

function RailLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-rail__item${isActive ? ' nav-rail__item--active' : ''}`}
    >
      <span className="nav-rail__icon">{icon}</span>
      <span className="nav-rail__label">{label}</span>
    </NavLink>
  );
}

export default function NavRail() {
  return (
    <nav className="nav-rail">
      <div className="nav-rail__section">
        {NAV_ITEMS.map(item => (
          <RailLink key={item.to} {...item} />
        ))}
      </div>

      <div className="nav-rail__divider" />

      <div className="nav-rail__section">
        {SECONDARY_ITEMS.map(item => (
          <RailLink key={item.to} {...item} />
        ))}
      </div>

      <div className="nav-rail__spacer" />
      <div className="nav-rail__divider" />

      <div className="nav-rail__section">
        {BOTTOM_ITEMS.map(item => (
          <RailLink key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}
