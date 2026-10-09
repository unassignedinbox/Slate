// Monoline 24px icons (stroke = currentColor), used for app icons and nav bar.
const P = {
  cockpit: '<path d="M3.5 15a8.5 8.5 0 1 1 17 0"/><path d="M12 15l4.2-4.2"/><circle cx="12" cy="15" r="1.4"/>',
  suspension: '<path d="M12 2v4M12 18v4"/><path d="M7 6h10M7 18h10"/><path d="M12 6l-4 2 8 2-8 2 8 2-8 2 4 2"/>',
  aero: '<path d="M2.5 8.5c3-1.4 6-1.4 9.5 0s6.5 1.4 9.5 0"/><path d="M4 13h16"/><path d="M6 8.5V13M18 8.5V13"/>',
  tyre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/><path d="M12 8.4V3M12 15.6V21M8.4 12H3M15.6 12H21"/>',
  weather: '<path d="M7 18.5h10.2a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/>',
  online: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.2M18.2 14.6c1.8.9 2.8 2.8 2.8 5.4"/>',
  apps: '<circle cx="6" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="18" cy="6" r="1.7"/><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/><circle cx="6" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="18" cy="18" r="1.7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  home: '<circle cx="12" cy="12" r="7.5"/>',
  recents: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  rain: '<path d="M7 14.5h10.2a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 14.5z"/><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/>',
  cloud: '<path d="M7 18.5h10.2a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  send: '<path d="M4 12l16-7-6 16-2.5-6.5z"/>',
};

export function icon(name, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
