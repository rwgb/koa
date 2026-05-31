import { NavLink } from 'react-router-dom';
import { Icon } from './Icon.js';
import type { IconName } from './Icon.js';

const NAV_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/chat', label: 'Chat', icon: 'chat' },
];

const SECONDARY_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/memory',        label: 'Memory',        icon: 'memory' },
  { to: '/integrations',  label: 'Integrations',  icon: 'plug' },
  { to: '/skills',        label: 'Skills',        icon: 'wrench' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/activity',      label: 'Activity',      icon: 'chart' },
];

const BOTTOM_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/settings', label: 'Settings', icon: 'gear' },
];

function RailLink({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-rail__item${isActive ? ' nav-rail__item--active' : ''}`}
    >
      <Icon name={icon} size={16} className="nav-rail__icon" />
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
