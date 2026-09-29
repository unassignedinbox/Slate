import React from 'react';

type P = { size?: number; className?: string; strokeWidth?: number };

const S = ({ size = 16, className, strokeWidth = 1.4, children }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);

export const Icons = {
  filePlus: (p: P) => <S {...p}><path d="M14 3v5h5" /><path d="M19 10v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z" /><path d="M12 12v5M9.5 14.5h5" /></S>,
  save: (p: P) => <S {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></S>,
  undo: (p: P) => <S {...p}><path d="M3 10h11a5 5 0 0 1 0 10h-3" /><path d="M7 6l-4 4 4 4" /></S>,
  redo: (p: P) => <S {...p}><path d="M21 10H10a5 5 0 0 0 0 10h3" /><path d="M17 6l4 4-4 4" /></S>,
  cube: (p: P) => <S {...p}><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7z" /><path d="M3.5 7 12 11.6 20.5 7M12 11.6V21.4" /></S>,
  monitor: (p: P) => <S {...p}><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8.5 21h7M12 17v4" /></S>,
  camera: (p: P) => <S {...p}><path d="M3 8.5A2 2 0 0 1 5 6.5h2l1.4-2h7.2L17 6.5h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.2" /></S>,
  image: (p: P) => <S {...p}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="m3.5 17.5 5-5 4.5 4.5 3-3 4.5 4.5" /></S>,
  scissors: (p: P) => <S {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M20 4 8.1 16.1M14.5 14.5 20 20M8.1 7.9 11 10.8" /></S>,
  x: (p: P) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>,
  plus: (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  minus: (p: P) => <S {...p}><path d="M5 12h14" /></S>,
  check: (p: P) => <S {...p}><path d="m20 6-11 11-5-5" /></S>,
  chevronRight: (p: P) => <S {...p}><path d="m9 6 6 6-6 6" /></S>,
  chevronDown: (p: P) => <S {...p}><path d="m6 9 6 6 6-6" /></S>,
  chevronLeft: (p: P) => <S {...p}><path d="m15 6-6 6 6 6" /></S>,
  grid: (p: P) => <S {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="1.2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" /></S>,
  sliders: (p: P) => <S {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></S>,
  play: (p: P) => <S {...p}><path d="M7 4.5 19 12 7 19.5z" /></S>,
  pause: (p: P) => <S {...p}><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></S>,
  eye: (p: P) => <S {...p}><path d="M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12z" /><circle cx="12" cy="12" r="3" /></S>,
  eyeOff: (p: P) => <S {...p}><path d="M9.9 5.7A9.8 9.8 0 0 1 12 5.5c6.2 0 9.8 6.5 9.8 6.5a17 17 0 0 1-3.2 4M6.3 7.9A17 17 0 0 0 2.2 12S5.8 18.5 12 18.5a9.6 9.6 0 0 0 3.8-.8" /><path d="M3 3l18 18" /></S>,
  diamond: (p: P) => <S {...p}><path d="m12 3 9 9-9 9-9-9z" /></S>,
  lock: (p: P) => <S {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></S>,
  unlock: (p: P) => <S {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" /></S>,
  text: (p: P) => <S {...p}><path d="M5 5h14M12 5v14M9 19h6" /></S>,
  search: (p: P) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></S>,
  sparkles: (p: P) => <S {...p}><path d="m12 3 1.9 4.9L19 10l-5.1 2.1L12 17l-1.9-4.9L5 10l5.1-2.1z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></S>,
  layers: (p: P) => <S {...p}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5M3 17l9 5 9-5" /></S>,
  droplet: (p: P) => <S {...p}><path d="M12 3s6 6.3 6 10.3A6 6 0 0 1 6 13.3C6 9.3 12 3 12 3z" /></S>,
  river: (p: P) => <S {...p}><path d="M3 7c3 0 3 2.5 6 2.5S12 7 15 7s3 2.5 6 2.5" /><path d="M3 13c3 0 3 2.5 6 2.5s3-2.5 6-2.5 3 2.5 6 2.5" /><path d="M3 19c3 0 3 1.5 6 1.5" opacity=".5" /></S>,
  wind: (p: P) => <S {...p}><path d="M3 8h10a3 3 0 1 0-3-3" /><path d="M3 13h14a3 3 0 1 1-3 3" /><path d="M3 18h7" /></S>,
  snow: (p: P) => <S {...p}><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" /><path d="M12 6.5 9.8 4.6M12 6.5l2.2-1.9M12 17.5l-2.2 1.9M12 17.5l2.2 1.9" /></S>,
  scan: (p: P) => <S {...p}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M4 12h16" /></S>,
  palette: (p: P) => <S {...p}><path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" /><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="8.2" r="1.1" fill="currentColor" stroke="none" /></S>,
  circle: (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /></S>,
  circleDashed: (p: P) => <S {...p}><path d="M12 3.5a8.5 8.5 0 0 1 4.2 1.1M19.4 7.8A8.5 8.5 0 0 1 20.5 12M20.5 12a8.5 8.5 0 0 1-1.1 4.2M16.2 19.4A8.5 8.5 0 0 1 12 20.5M12 20.5a8.5 8.5 0 0 1-4.2-1.1M4.6 16.2A8.5 8.5 0 0 1 3.5 12M3.5 12a8.5 8.5 0 0 1 1.1-4.2M7.8 4.6A8.5 8.5 0 0 1 12 3.5" /></S>,
  brush: (p: P) => <S {...p}><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8l-8.7 8.7-3.6.8.8-3.6z" /><path d="M7 16c-1.8 0-3 1.2-3 3 0 .7-.3 1.4-1 2 1.2.6 2.3.8 3.3.6 1.9-.3 3.2-1.8 3.2-3.6 0-1.1-1-2-2.5-2z" /></S>,
  eraser: (p: P) => <S {...p}><path d="m5 15 6.5-6.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L15 19H8z" /><path d="M9 19h11" /></S>,
  stamp: (p: P) => <S {...p}><path d="M9 3h6a2 2 0 0 1 2 2v3.5c0 1.5-1 2-1 3.5h-8c0-1.5-1-2-1-3.5V5a2 2 0 0 1 2-2z" /><rect x="4.5" y="14" width="15" height="3.5" rx="1" /><path d="M5.5 20.5h13" /></S>,
  pipette: (p: P) => <S {...p}><path d="m17.5 3.5 3 3-2.2 2.2-3-3z" /><path d="M15.3 5.7 6.5 14.5 5 19l4.5-1.5 8.8-8.8z" /></S>,
  copy: (p: P) => <S {...p}><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M5.5 15.5h-.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v.5" /></S>,
  mask: (p: P) => <S {...p}><circle cx="9.5" cy="12" r="6.5" /><path d="M14.5 5.5a6.5 6.5 0 0 1 0 13" /></S>,
  shield: (p: P) => <S {...p}><path d="M12 3 5 6v5.5c0 4.2 2.9 7.8 7 9.5 4.1-1.7 7-5.3 7-9.5V6z" /></S>,
  refresh: (p: P) => <S {...p}><path d="M20 11a8 8 0 1 0-1.3 5.4" /><path d="M20 5v6h-6" /></S>,
  pin: (p: P) => <S {...p}><path d="M15 3.5 20.5 9l-3.2 1-3.6 3.6.5 3.4L12 19 5 12l1-2.2 3.4.5L13 6.7z" /><path d="m5 19 3.5-3.5" /></S>,
  trash: (p: P) => <S {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" /></S>,
  alert: (p: P) => <S {...p}><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v4M12 17.2v.1" /></S>,
  folder: (p: P) => <S {...p}><path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>,
  download: (p: P) => <S {...p}><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 18.5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></S>,
  upload: (p: P) => <S {...p}><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" /><path d="M4 18.5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></S>,
  gauge: (p: P) => <S {...p}><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 14 4-4" /><circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" /></S>,
};

export type IconName = keyof typeof Icons;

export function Icon({ name, size = 16, className, strokeWidth }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const F = (Icons as any)[name] ?? Icons.circle;
  return <F size={size} className={className} strokeWidth={strokeWidth} />;
}
