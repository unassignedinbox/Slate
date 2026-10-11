// Minimal inline SVG icon set (stroke style, 1.5px) — no icon font, no dependency.

const svg = (body, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  road: svg('<path d="M4 21 7 3M20 21 17 3M12 4v3M12 11v3M12 18v3"/>'),
  blocks: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  terrain: svg('<path d="M2 20h20M4 20l6-9 4 5 2-2.5L20 20"/>'),
  bridge: svg('<path d="M2 9h20M4 9v11M20 9v11M8 20v-5a4 4 0 0 1 8 0v5"/>'),
  wall: svg('<path d="M3 6h18M3 12h18M3 18h18M8 6v6M16 6v6M12 12v6"/>'),
  tunnel: svg('<path d="M3 21V12a9 9 0 0 1 18 0v9M9 21v-8a3 3 0 0 1 6 0v8"/>'),
  subway: svg('<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 11h14M8 20l-2 2M16 20l2 2"/><circle cx="8.5" cy="13.5" r=".6"/><circle cx="15.5" cy="13.5" r=".6"/>'),
  rail: svg('<path d="M6 2 4 22M18 2l2 20M3 8h18M2.5 15h19"/>'),
  crossing: svg('<path d="M12 3v7M5 12h14M12 14v7"/><circle cx="8" cy="12" r="1.4"/><circle cx="16" cy="12" r="1.4"/>'),
  lamp: svg('<path d="M7 21V5a2 2 0 0 1 2-2h5a4 4 0 0 1 4 4"/><path d="M15 9h6l-3 5z"/>'),
  signal: svg('<rect x="8" y="2" width="8" height="16" rx="2.5"/><path d="M12 18v4M5 6h3M16 6h3"/><circle cx="12" cy="6" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="12" cy="14" r="1.2"/>'),
  sign: svg('<path d="M12 22V9"/><rect x="4" y="2" width="16" height="7" rx="1.5"/>'),
  bollard: svg('<path d="M8 21h8M10 21V6a2 2 0 1 1 4 0v15"/>'),
  railing: svg('<path d="M3 7h18M3 13h18M6 4v16M18 4v16M12 7v6"/>'),
  billboard: svg('<rect x="2" y="4" width="20" height="10" rx="1.5"/><path d="M8 14v7M16 14v7"/>'),
  bench: svg('<path d="M3 10h18M4 10v8M20 10v8M6 14h12"/>'),
  cone: svg('<path d="M12 3 5 20h14zM8.4 13h7.2M3 20h18"/>'),
  drain: svg('<circle cx="12" cy="12" r="8"/><path d="M8 10h8M8 13h8M12 6v12"/>'),
  prop: svg('<circle cx="12" cy="12" r="8"/>'),
  car: svg('<path d="M4 16v3M20 16v3"/><path d="M2.5 15.5h19v-3l-2-1-2-4H8l-2.5 4-3 1z"/><circle cx="7" cy="16" r="1.6"/><circle cx="17" cy="16" r="1.6"/>'),
  parked: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M10 17V8h3.2a2.8 2.8 0 0 1 0 5.6H10"/>'),
  train: svg('<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8 20l-2 2M16 20l2 2M9 16h6"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', 15),
  eyeOff: svg('<path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2"/><path d="M7.4 7.5C4.4 9.2 2 12 2 12s3.6 7 10 7a10.9 10.9 0 0 0 4.3-.9M12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.4 3.3"/>', 15),
  layers: svg('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>'),
  palette: svg('<path d="M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2.5 2.5 0 0 0-1.8 4.2A1.8 1.8 0 0 1 12 21Z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="9.5" r="1"/>'),
  grid: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  play: svg('<path d="m7 4 13 8-13 8z"/>'),
  pause: svg('<path d="M8 4v16M16 4v16"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>'),
  move: svg('<path d="M12 2v20M2 12h20M12 2 9 5M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>'),
  lock: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  check: svg('<path d="m4 12.5 5 5L20 6"/>', 14),
  minus: svg('<path d="M5 12h14"/>', 14),
  node: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7"/>'),
  curve: svg('<path d="M3 20c7 0 11-16 18-16"/><circle cx="3" cy="20" r="2"/><circle cx="21" cy="4" r="2"/>'),
  wrench: svg('<path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9L21 21l-9-9 2.7-5.7Z"/><path d="m12 12-7.5 7.5a2.1 2.1 0 0 1-3-3L9 9"/>'),
  camera: svg('<path d="M3 8h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13" r="4"/>'),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>'),
};

export function icon(name, size) {
  const raw = ICONS[name] || ICONS.prop;
  if (!size) return raw;
  return raw.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
}
