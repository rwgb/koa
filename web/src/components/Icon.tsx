// All icons: viewBox 0 0 16 16, stroke="currentColor", fill="none", strokeWidth={1.5}
// strokeLinecap="round", strokeLinejoin="round"
// Use `size` prop to scale; color inherits from parent via currentColor.

export type IconName =
  | 'chat' | 'memory' | 'plug' | 'wrench' | 'bell'
  | 'chart' | 'gear' | 'send' | 'trash' | 'copy'
  | 'eye' | 'eye-off' | 'chevron-down' | 'chevron-up'
  | 'x' | 'check' | 'alert'
  | 'anthropic' | 'github' | 'envelope' | 'server'
  | 'shield' | 'link' | 'phone'
  | 'folder' | 'list-checks' | 'search' | 'plus' | 'kanban' | 'dependency' | 'database'
  | 'calendar'
  | 'repeat';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
  'aria-label'?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  // Nav / actions
  chat: <path d="M13 1H3a2 2 0 00-2 2v7a2 2 0 002 2h2v2.5l3-2.5h5a2 2 0 002-2V3a2 2 0 00-2-2z" />,

  memory: <>
    <path d="M8 1L1 4.5l7 3.5 7-3.5L8 1z" />
    <path d="M1 8l7 3.5L15 8" />
    <path d="M1 11.5l7 3.5 7-3.5" />
  </>,

  plug: <>
    <path d="M5.5 1v4M10.5 1v4" />
    <path d="M3.5 5h9l-1 5a2 2 0 01-2 2h-3a2 2 0 01-2-2l-1-5z" />
    <path d="M6.5 12v2M9.5 12v2" />
  </>,

  wrench: <>
    <path d="M12.5 2a2.5 2.5 0 00-3.5 3.5L2.5 12a1 1 0 001.5 1.5L10.5 7A2.5 2.5 0 0012.5 2z" />
    <path d="M11 3.5l1.5 1.5" />
  </>,

  bell: <>
    <path d="M8 1.5a5 5 0 00-5 5v2l-1.5 2.5h13L13 8.5v-2a5 5 0 00-5-5z" />
    <path d="M6.5 12.5a1.5 1.5 0 003 0" />
  </>,

  chart: <>
    <path d="M1 14h14" />
    <rect x="2" y="8" width="3" height="5" />
    <rect x="6.5" y="5" width="3" height="8" />
    <rect x="11" y="2" width="3" height="11" />
  </>,

  gear: <>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" />
  </>,

  send: <path d="M14.5 1.5L1 6.5l5.5 2 1.5 5.5 6.5-12.5zM6.5 8.5l4.5-5" />,

  trash: <>
    <path d="M1.5 4.5h13" />
    <path d="M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5" />
    <path d="M3 4.5l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
    <path d="M6.5 7v4M9.5 7v4" />
  </>,

  copy: <>
    <rect x="5" y="5" width="8" height="9" rx="1" />
    <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v8a1 1 0 001 1h2" />
  </>,

  eye: <>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
  </>,

  'eye-off': <>
    <path d="M2 2l12 12" />
    <path d="M6.5 3.5A6.5 6.5 0 0115 8s-.6 1.3-1.8 2.5" />
    <path d="M9.5 12.4A6.5 6.5 0 011 8s.6-1.3 1.8-2.5" />
    <path d="M6.1 6.1a2 2 0 002.8 2.8" />
  </>,

  'chevron-down': <path d="M3.5 5.5l4.5 5 4.5-5" />,

  'chevron-up': <path d="M3.5 10.5l4.5-5 4.5 5" />,

  x: <path d="M3 3l10 10M13 3L3 13" />,

  check: <path d="M2 8.5l4 4 8-8" />,

  alert: <>
    <path d="M8 2L1.5 13.5h13L8 2z" />
    <path d="M8 6.5v3" />
    <path d="M8 11v.5" />
  </>,

  // Integration-specific icons
  anthropic: <>
    <path d="M8 2L3.5 14M8 2l4.5 12M5.5 10h5" />
  </>,

  github: <>
    <path d="M8 1a7 7 0 00-2.2 13.6c.3.1.4-.2.4-.4v-1.3c-1.8.4-2.2-.9-2.2-.9-.3-.8-.7-1-.7-1-.6-.4 0-.4 0-.4.6 0 1 .6 1 .6.6 1 1.5.7 1.9.5.1-.4.2-.7.4-.8-1.5-.2-3-.7-3-3.3 0-.7.2-1.3.6-1.8-.1-.2-.3-.9.1-1.8 0 0 .5-.2 1.8.7a6 6 0 013.2 0c1.3-.9 1.8-.7 1.8-.7.4.9.2 1.6.1 1.8.4.5.6 1.1.6 1.8 0 2.6-1.5 3.1-3 3.3.3.2.5.6.5 1.2v1.8c0 .2.1.5.4.4A7 7 0 008 1z" />
  </>,

  envelope: <>
    <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
    <path d="M1.5 4l6.5 5 6.5-5" />
  </>,

  server: <>
    <rect x="1.5" y="2.5" width="13" height="4" rx="1" />
    <rect x="1.5" y="9.5" width="13" height="4" rx="1" />
    <path d="M4 4.5h.5M4 11.5h.5" />
  </>,

  shield: <path d="M8 1.5l5.5 2V9a5.5 5.5 0 01-5.5 5.5A5.5 5.5 0 012.5 9V3.5L8 1.5z" />,

  link: <>
    <path d="M6.5 9.5a3 3 0 000-4.3l-.7-.7a3 3 0 10-4.3 4.3l.7.7A3 3 0 006.5 9.5z" />
    <path d="M9.5 6.5a3 3 0 000 4.3l.7.7a3 3 0 104.3-4.3l-.7-.7A3 3 0 009.5 6.5z" />
    <path d="M9 7L7 9" />
  </>,

  phone: <>
    <rect x="4.5" y="1" width="7" height="14" rx="1.5" />
    <path d="M7.5 12.5h1" />
  </>,

  folder: <>
    <path d="M1 3.5a1 1 0 011-1h4l2 2h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1v-9z" />
  </>,

  'list-checks': <>
    <path d="M1.5 4h1l1-1 1 1h1" />
    <path d="M7 4h7.5" />
    <path d="M1.5 8h1l1-1 1 1h1" />
    <path d="M7 8h7.5" />
    <path d="M1.5 12h1l1-1 1 1h1" />
    <path d="M7 12h7.5" />
  </>,

  search: <>
    <circle cx="7" cy="7" r="5" />
    <path d="M10.5 10.5L14 14" />
  </>,

  plus: <path d="M8 2v12M2 8h12" />,

  kanban: <>
    <rect x="1" y="2" width="4" height="12" rx="1" />
    <rect x="6" y="2" width="4" height="8" rx="1" />
    <rect x="11" y="2" width="4" height="10" rx="1" />
  </>,

  dependency: <>
    <circle cx="3" cy="8" r="2" />
    <circle cx="13" cy="8" r="2" />
    <path d="M5 8h6" />
    <path d="M9 6l2 2-2 2" />
  </>,

  database: <>
    <ellipse cx="8" cy="4" rx="6" ry="2" />
    <path d="M2 4v4c0 1.1 2.7 2 6 2s6-.9 6-2V4" />
    <path d="M2 8v4c0 1.1 2.7 2 6 2s6-.9 6-2V8" />
  </>,

  calendar: <>
    <rect x="2" y="3" width="12" height="11" rx="1" />
    <path d="M2 7h12" />
    <path d="M5.5 1.5v3M10.5 1.5v3" />
    <path d="M5 10.5h.5M8 10.5h.5M11 10.5h.5" />
  </>,

  repeat: <>
    <path d="M2 4h9a3 3 0 010 6H1" />
    <path d="M1 10l2-2-2-2" />
    <path d="M14 12H5a3 3 0 010-6h1" />
    <path d="M15 6l-2 2 2 2" />
  </>,
};

export function Icon({
  name,
  size = 16,
  className,
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel,
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
    >
      {PATHS[name]}
    </svg>
  );
}
