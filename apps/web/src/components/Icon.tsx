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
  // Building blocks with one more to add: the play modules a story is given.
  modules: (
    <>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" />
      <path d="M16.5 13.5v6M13.5 16.5h6" />
    </>
  ),
  expand: <path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5" />
    </>
  ),
  back: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  branch: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 8.2v7.6M6.5 13c5 0 11-1 11-2.8" />
    </>
  ),
  download: <path d="M12 4.5v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15V4.5M7.5 9L12 4.5 16.5 9M5 19.5h14" />,
  code: <path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4" />,
  book: (
    <>
      <path d="M4.5 6A2.5 2.5 0 0 1 7 3.5h5v16H7A2.5 2.5 0 0 0 4.5 22z" />
      <path d="M19.5 6A2.5 2.5 0 0 0 17 3.5h-5v16h5A2.5 2.5 0 0 1 19.5 22z" />
    </>
  ),
  portrait: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.8 17.8c.9-2.2 2.4-3.3 4.2-3.3s3.3 1.1 4.2 3.3" />
    </>
  ),
  dossier: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1-5.1-1.9 5.1-1.9z" />
      <path d="M18.5 16v4M16.5 18h4" />
    </>
  ),
  grid: (
    <>
      <rect x="4.5" y="4.5" width="6.2" height="6.2" rx="1.2" />
      <rect x="13.3" y="4.5" width="6.2" height="6.2" rx="1.2" />
      <rect x="4.5" y="13.3" width="6.2" height="6.2" rx="1.2" />
      <rect x="13.3" y="13.3" width="6.2" height="6.2" rx="1.2" />
    </>
  ),
  list: <path d="M8.5 7h11M8.5 12h11M8.5 17h11M4.8 7h.01M4.8 12h.01M4.8 17h.01" />,
  gauge: (
    <>
      <path d="M4.8 17a8 8 0 1 1 14.4 0" />
      <path d="M12 13.5l3.5-3.5" />
      <circle cx="12" cy="13.5" r="1.3" />
    </>
  ),
  bolt: <path d="M13 3L5.5 13.5h5.5L10 21l8.5-11.5H13z" />,
  queue: <path d="M4.5 7h10M4.5 12h10M4.5 17h6.5M16.5 13.5v6M13.5 16.5h6" />,
  panelWide: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M11 4.5v15M8.5 10l-2 2 2 2" />
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
