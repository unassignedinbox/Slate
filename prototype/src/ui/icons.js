// Inline SVG app icons (no emoji dependency, so they render on any OS/browser).
const ICONS = {
  telemetry: '<path d="M5 19V12M12 19V6M19 19V9"/>',
  suspension: '<path d="M3 12h4l2-4 3 8 3-8 2 4h4"/>',
  aero: '<path d="M3 9h12a3 3 0 1 0-3-3M3 15h16a3 3 0 1 1-3 3M3 12h7"/>',
  tyres: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>',
  weather: '<circle cx="9" cy="9" r="3.5"/><path d="M9 2v1.5M3 9h1.5M4.6 4.6l1 1M13.4 4.6l-1 1"/><path d="M8 19h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A3 3 0 0 0 8 19z"/>',
  garage: '<path d="M3 15l2-5h14l2 5v3H3z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
  lobby: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 2 5 5"/>',
  store: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M16 14.5h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

// Returns an <svg> markup string for an app icon (white strokes on a coloured tile).
export function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}
export { ICONS };
