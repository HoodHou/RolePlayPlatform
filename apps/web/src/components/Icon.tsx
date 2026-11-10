import type { ReactNode } from 'react';

const PATHS = {
  // A twenty-sided die, the app's mark.
  logo: (
    <>
      <path d="M12 2.6l8.1 4.7v9.4L12 21.4l-8.1-4.7V7.3z" />
      <path d="M12 2.6l-4.6 9.1h9.2zM7.4 11.7L3.9 7.3M16.6 11.7l3.5-4.4M7.4 11.7L12 21.4l4.6-9.7" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.4 8.6l-1.9 4.9-4.9 1.9 1.9-4.9z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  speech: <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  trash: <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V4.5h5V7" />,
  send: <path d="M12 19V5.5M6.5 11L12 5.5l5.5 5.5" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  chevron: <path d="M7 10l5 5 5-5" />,
  retry: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v5M12 16.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
