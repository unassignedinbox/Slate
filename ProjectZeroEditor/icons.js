/* ============================================================================
   ICONS — the outliner's glyph function ported from OutlinerPanel.cpp:
   "24-unit viewBox scaled into a Size box, stroke 1.6, round caps and joins".
   Registry names mirror IconSymbols.inc. The set is COMPLETED with the
   artwork the native build was missing (MainEditorIntegration.md blockers +
   generator entities): Tyre, Vehicle, Cloth/Fabric, Rim, Suspension,
   Height Fog / Atmospheric Fog replacements, Clouds, Local Cloud, Local Fog.
   ========================================================================== */

const ICONS = {
  /* ── folders ── */
  folder:      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderWorld: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="13" cy="13" r="3.4"/><path d="M9.6 13h6.8M13 9.6c1.3 2.2 1.3 4.6 0 6.8M13 9.6c-1.3 2.2-1.3 4.6 0 6.8"/>',
  folderEnv:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8.5 14.5c1.5-3.5 4.5-5 7-5-.3 3.6-2.2 6-5.6 6-.5 0-1-.1-1.4-.3M8.5 16c.6-1.8 1.7-3.2 3.2-4.2"/>',
  folderScene: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 11h8M9 14.5h5"/>',

  /* ── cameras ── */
  camera:  '<rect x="3.5" y="7" width="13" height="11" rx="2.4"/><path d="M16.5 11l4-2.6v8.2l-4-2.6"/><circle cx="10" cy="12.5" r="2.6"/>',
  cine:    '<rect x="3" y="8.5" width="14" height="9" rx="2"/><circle cx="7.5" cy="6" r="2.4"/><circle cx="13.5" cy="6" r="2.4"/><path d="M17 12.5l4-2v5.5l-4-2"/>',
  postpro: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',

  /* ── celestial / environment ── */
  sun:     '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>',
  moon:    '<path d="M19.5 13.5A8 8 0 1 1 10.5 4.5a6.5 6.5 0 0 0 9 9z"/>',
  sky:     '<path d="M3 17c2-5.5 5.5-9 9-9s7 3.5 9 9"/><path d="M5 20h14M8.5 11.5c.9 1.4 2.1 2.3 3.5 2.3s2.6-.9 3.5-2.3"/>',
  stars:   '<path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M18.8 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8zM5 16.5l.6 1.6 1.6.6-1.6.6L5 21l-.6-1.7-1.6-.6 1.6-.6z"/>',
  atmosphere: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.8 2.2 4.2 5 4.2 8s-1.4 5.8-4.2 8c-2.8-2.2-4.2-5-4.2-8s1.4-5.8 4.2-8z"/>',
  wind:    '<path d="M3 8.5h10.5a2.6 2.6 0 1 0-2.6-2.6M3 12.5h15a2.8 2.8 0 1 1-2.8 2.8M3 16.5h7.5a2.3 2.3 0 1 1-2.3 2.3"/>',
  fog:     '<path d="M5.5 10.5a4.5 4.5 0 0 1 8.8-1.4A3.7 3.7 0 0 1 18.5 13H6a2.6 2.6 0 0 1-.5-2.5z"/><path d="M4 16h16M6.5 19h11"/>',
  cloud:   '<path d="M6.5 17.5a4 4 0 0 1-.4-8 5 5 0 0 1 9.8-1 4.2 4.2 0 0 1 1.6 8.2 4.5 4.5 0 0 1-1 .8z"/>',
  localCloud: '<path d="M7 14a3.2 3.2 0 0 1-.3-6.4 4 4 0 0 1 7.8-.8 3.4 3.4 0 0 1 1.3 6.6z"/><path d="M5.5 18.5h2M9.5 18.5h2M13.5 18.5h2M7.5 21h2M11.5 21h2"/>',
  localFog:'<rect x="4" y="7" width="16" height="10" rx="3" stroke-dasharray="3 2.4"/><path d="M8 11h8M7 14h10"/>',
  rain:    '<path d="M6.5 13a4 4 0 0 1-.4-8 5 5 0 0 1 9.8-1 4.2 4.2 0 0 1 1.6 8.3"/><path d="M8 16.5l-1.2 3M12.5 16.5l-1.2 3M17 16.5l-1.2 3"/>',
  rainbow: '<path d="M4 17a8 8 0 0 1 16 0M7.2 17a4.8 4.8 0 0 1 9.6 0"/><circle cx="4.5" cy="18.5" r="1.3"/><circle cx="19.5" cy="18.5" r="1.3"/>',
  lensflare:'<circle cx="9" cy="9" r="3.4"/><path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M13.6 4.4l-1.4 1.4"/><circle cx="16.5" cy="16.5" r="1.6"/><circle cx="20" cy="20" r=".9"/>',

  /* ── lights ── */
  pointLight:'<circle cx="12" cy="10" r="4.6"/><path d="M9.8 17h4.4M10.4 19.6h3.2M12 2.8v1.6M4.8 10H3.2M20.8 10h-1.6M6 4.6l1.1 1.1M18 4.6l-1.1 1.1"/>',
  spotLight:'<path d="M9.5 3.5h5l-1 5.5h-3z"/><path d="M8 20.5L10.5 9M16 20.5L13.5 9M5 20.5h14"/>',
  areaLight:'<rect x="5" y="4" width="14" height="9" rx="1.6"/><path d="M8 16.5l-1 4M16 16.5l1 4M12 16.5v4M8.5 13v3.5h7V13"/>',

  /* ── geometry ── */
  mesh:    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v9m0 0l8-4.5M12 12l-8-4.5M12 21v-9"/>',
  cube:    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  sphere:  '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.4"/>',
  cone:    '<path d="M12 3.5L19 17.5a7 2.6 0 0 1-14 0z"/><ellipse cx="12" cy="17.5" rx="7" ry="2.6"/>',
  pyramid: '<path d="M12 3.5L21 18H3z"/><path d="M12 3.5V18"/>',
  cylinder:'<ellipse cx="12" cy="5.5" rx="6.5" ry="2.5"/><path d="M5.5 5.5v13a6.5 2.5 0 0 0 13 0v-13"/>',
  torus:   '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/><ellipse cx="12" cy="12" rx="3.2" ry="1.8"/>',
  plane:   '<path d="M3.5 16.5l7-9h10l-7 9z"/>',

  /* ── THE MISSING ARTWORK — now filled in ── */
  tyre:    '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4"/><path d="M12 3.4v2.8M12 17.8v2.8M3.4 12h2.8M17.8 12h2.8M5.9 5.9l2 2M16.1 16.1l2 2M18.1 5.9l-2 2M7.9 16.1l-2 2"/>',
  rim:     '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.2"/><path d="M12 9.8V3.4M13.9 13.3l5.3 3.7M10.1 13.3l-5.3 3.7M13.9 10.9l5.6-3.2M10.1 10.9L4.5 7.7"/>',
  vehicle: '<path d="M4 16v-3.2L5.8 8.6A2 2 0 0 1 7.7 7.3h8.6a2 2 0 0 1 1.9 1.3L20 12.8V16"/><path d="M4 12.8h16M3 16h18"/><circle cx="7.5" cy="17.5" r="2.1"/><circle cx="16.5" cy="17.5" r="2.1"/>',
  cloth:   '<path d="M4.5 5.5c2.5 1.6 5 1.6 7.5 0s5-1.6 7.5 0M4.5 10c2.5 1.6 5 1.6 7.5 0s5-1.6 7.5 0M4.5 14.5c2.5 1.6 5 1.6 7.5 0s5-1.6 7.5 0M4.5 19c2.5 1.6 5 1.6 7.5 0s5-1.6 7.5 0"/>',
  suspension:'<path d="M7 3.5h10M7 20.5h10M12 3.5v2M12 18.5v2M8 6.5l8 2-8 2 8 2-8 2 8 2"/>',

  /* ── ui glyphs ── */
  check:   '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn:    '<path d="M12 4L21 19.5H3z"/><path d="M12 10v4.4M12 17.2v.1"/>',
  dot:     '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  eye:     '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff:  '<path d="M4.5 4.5l15 15M9.8 5.4A9.8 9.8 0 0 1 12 6c5.5 0 9 6 9 6a16.6 16.6 0 0 1-2.8 3.3M6 7.2A15.6 15.6 0 0 0 3 12s3.5 6 9 6a9 9 0 0 0 3.2-.6"/>',
  chevron: '<path d="M9 5.5l7 6.5-7 6.5"/>',
  search:  '<circle cx="10.5" cy="10.5" r="6"/><path d="M15.2 15.2L20.5 20.5"/>',
  sliders: '<path d="M4 7.5h10M18 7.5h2M4 12h4M12 12h8M4 16.5h12M20 16.5h0"/><circle cx="15.5" cy="7.5" r="1.8"/><circle cx="9.5" cy="12" r="1.8"/><circle cx="17.5" cy="16.5" r="1.8"/>',
  lock:    '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock:  '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  plus:    '<path d="M12 5.5v13M5.5 12h13"/>',
  gear:    '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
  play:    '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  pause:   '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  step:    '<path d="M6 5.5L14 12l-8 6.5zM17 5.5v13"/>',
  stop:    '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  flag:    '<path d="M5.5 21V4.5M5.5 5h11l-2.5 3.5L16.5 12h-11"/>',
  target:  '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  grid:    '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  bell:    '<path d="M6 17h12c-1.4-1.3-1.8-3-1.8-5.2 0-3-1.5-5.3-4.2-5.3S7.8 8.8 7.8 11.8C7.8 14 7.4 15.7 6 17z"/><path d="M10.2 19.5a1.9 1.9 0 0 0 3.6 0"/>',
  gauge:   '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 14.5l3.4-4.4"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/>',
  sparkles:'<path d="M12 4l1.5 4.2L17.7 9.7l-4.2 1.5L12 15.4l-1.5-4.2L6.3 9.7l4.2-1.5z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  sunIllum:'<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
  raySlash:'<path d="M4 20L20 4"/><path d="M6 8l-2-2M10 5l-1-2.6M5 11l-2.6-1M18 16l2 2M14 19l1 2.6M19 13l2.6 1"/>',
  videoCam:'<rect x="3" y="7" width="12" height="10" rx="2.4"/><path d="M15 11l5.5-3v8L15 13"/>',
  wifi:    '<path d="M4 10a12 12 0 0 1 16 0M7 13.2a8 8 0 0 1 10 0M10 16.3a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/>',
  compact: '<path d="M4.5 7h15M4.5 12h15M4.5 17h9"/>',
  dockL:   '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M9 6v12" /><rect x="4" y="6" width="5" height="12" rx="2" fill="currentColor" stroke="none" opacity=".55"/>',
  dockR:   '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M15 6v12"/><rect x="15" y="6" width="5" height="12" rx="2" fill="currentColor" stroke="none" opacity=".55"/>',
  effects: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15M4.5 12h15" stroke-dasharray="2.4 2.6"/>',
  physics: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>',
};

function icon(name, size = 16, cls = '') {
  const body = ICONS[name] || ICONS.mesh;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
