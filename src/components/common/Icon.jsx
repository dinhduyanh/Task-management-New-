const iconPaths = {
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-3l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1L12 7h3l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-1a7 7 0 0 1 14 0v1" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1" /><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 5v1" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 2.5 2.5L16 9" /></>,
  file: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
  spaces: <><path d="M3 7h7l2 2h9v10H3z" /><path d="M3 7V5h7l2 2" /></>,
  filter: <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5z" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  moreVertical: <><circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /><path d="M10 11v5M14 11v5" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  shield: <><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  workflow: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><path d="M9 6h6M18 9v3a3 3 0 0 1-3 3h-3" /></>,
  bug: <><path d="M9 8.5 7 5.7M15 8.5l2-2.8M7.3 11.5H3.7M7.1 15.5H3.4M16.7 11.5h3.6M16.9 15.5h3.7" strokeWidth="2" /><circle cx="12" cy="6.5" r="2.5" fill="currentColor" stroke="none" /><path d="M12 8.5c-3 0-4.6 2-4.6 5v3a4.6 4.6 0 0 0 9.2 0v-3c0-3-1.6-5-4.6-5Z" fill="currentColor" stroke="none" /><path d="M12 9.5v8M9.2 12.5h5.6M9.2 15.5h5.6" stroke="#fff" strokeWidth="1.1" /></>,
  highest: <><path d="m7 14 5-5 5 5M7 8l5-5 5 5" /></>,
  medium: <path d="M5 9h14M5 15h14" />,
  low: <path d="m7 10 5 5 5-5" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  eye: <><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A11 11 0 0 1 12 5c6 0 9.5 7 9.5 7a14 14 0 0 1-2.3 3.2" /><path d="M6.2 6.2C3.9 7.6 2.5 10 2.5 12c1 2.5 4.5 7 9.5 7 1.5 0 2.8-.4 4-1.1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  refresh: <><path d="M20 7v5h-5" /><path d="M4.9 9a7.5 7.5 0 0 1 12.7-2L20 12M4 17v-5h5" /><path d="M19.1 15a7.5 7.5 0 0 1-12.7 2L4 12" /></> ,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>,
  epic: <path d="M13.2 2.5 4.8 13h5.8l-.7 8.5L19.2 10h-6l0-7.5Z" />,
  feature: <><path d="M4.2 20V10.4l5.5-5.7a3.2 3.2 0 0 1 4.6 0l5.5 5.7V20H4.2Z" /><path d="m8.2 15.2 2.1-2.1 2.1 1.1 3.3-3" /></>,
  improvement: <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  story: <><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 0 3 21.5z" /><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v18a2 2 0 0 1 2-2h3.5a2.5 2.5 0 0 1 2.5 2.5z" /></>,
  subTask: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10a2 2 0 0 0 2 2h8M8 5h6a4 4 0 0 1 4 4v8" /></>
  ,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 5V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" /></>,
  maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M8 8 3 3M16 8l5-5M8 16l-5 5M16 16l5 5" /></>,
  minimize: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /></>,
  edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15z" /></>,
  paperclip: <path d="m8 12.5 6.6-6.6a3.5 3.5 0 0 1 5 5L10 20.5a5 5 0 0 1-7.1-7.1L13 3.3" />,
  inbox: <><path d="M4 4h16l2 11h-6l-2 3h-4l-2-3H2z" /><path d="M2 15h6l2 3h4l2-3h6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  power: <><path d="M12 3v9" /><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" /></>,
  grip: <><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  more: <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>,
  board: <><rect x="3" y="4" width="5" height="16" rx="1.2" /><rect x="10" y="4" width="5" height="11" rx="1.2" /><rect x="17" y="4" width="4" height="7" rx="1.2" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>
};

export default function Icon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name] || null}
    </svg>
  );
}
