// Inline SVG path fragments keyed by name. Reused by the tools panel and the
// sketch directory so an entity's icon matches the tool that drew it.
export const GLYPH = {
  // ---- 2D primitives ----
  line:'<path d="M4 20 20 4"/>',
  polyline:'<path d="M3 17 9 8l4 5 8-9"/>',
  rectangle:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle:'<circle cx="12" cy="12" r="8"/>',
  arc:'<path d="M4 18a10 10 0 0 1 16 0"/>',
  ellipse:'<ellipse cx="12" cy="12" rx="9" ry="6"/>',
  point:'<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7"/>',
  bezier:'<path d="M3 18C7 6 17 6 21 18"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/><circle cx="21" cy="18" r="1.5" fill="currentColor" stroke="none"/>',
  hermite:'<path d="M3 16c5 0 5-8 9-8s4 8 9 8"/>',
  spline:'<path d="M3 18c3-10 7 2 9-4s5-2 9-6"/>',
  rspline:'<path d="M3 18c4-12 14-12 18 0"/><circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none"/>',
  construction:'<path d="M3 18 21 6" stroke-dasharray="3 3"/>',
  tangentarc:'<path d="M3 20h7a7 7 0 0 0 7-7V6"/>',
  polygon:'<path d="m12 3 8 6-3 10H7L4 9l8-6Z"/>',
  slot:'<rect x="3" y="8" width="18" height="8" rx="4"/>',
  // ---- operations ----
  fillet:'<path d="M5 19V9a4 4 0 0 1 4-4h10"/>',
  chamfer:'<path d="M5 19V11l6-6h8"/>',
  trim:'<path d="M6 6l12 12M9 15l-4 4M15 9l4-4"/><circle cx="7" cy="17" r="1.6"/>',
  extend:'<path d="M3 12h11M11 8l4 4-4 4M18 6v12"/>',
  offset:'<rect x="4" y="8" width="12" height="10" rx="1"/><path d="M8 4h12v12" stroke-dasharray="3 3"/>',
  cut:'<path d="M6 6l12 12M18 6 6 18"/><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/>',
  // ---- dimensions ----
  lineardim:'<path d="M3 8v8M21 8v8M3 12h18"/><path d="M6 10l-3 2 3 2M18 10l3 2-3 2"/>',
  angulardim:'<path d="M5 19 19 5M5 19h9"/><path d="M5 19a10 10 0 0 1 6-9"/>',
  radialdim:'<circle cx="12" cy="12" r="7"/><path d="M12 12 19 7"/>',
  // ---- constraints ----
  horizontal:'<path d="M3 12h18"/><path d="M6 9v6M18 9v6"/>',
  vertical:'<path d="M12 3v18"/><path d="M9 6h6M9 18h6"/>',
  coincident:'<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/>',
  parallel:'<path d="M7 20 13 4M11 20 17 4"/>',
  perpendicular:'<path d="M6 4v14h14"/><path d="M6 12h6v6"/>',
  tangent:'<circle cx="9" cy="14" r="5"/><path d="M3 5h18"/>',
  equal:'<path d="M5 9h14M5 15h14"/>',
  midpoint:'<path d="M4 12h16"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M4 9v6M20 9v6"/>',
  symmetry:'<path d="M12 3v18" stroke-dasharray="3 3"/><path d="M9 7 4 12l5 5M15 7l5 5-5 5"/>',
  concentric:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  // ---- booleans ----
  union:'<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  boolcut:'<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" fill="#121212"/>',
  intersect:'<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 7a6 6 0 0 0 0 10 6 6 0 0 0 0-10Z" fill="currentColor" fill-opacity="0.25" stroke="none"/>',
  // ---- directory chrome ----
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  folderOpen:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2"/><path d="m3 9 2.5 9a1 1 0 0 0 1 0.8h12a1 1 0 0 0 1-0.8L22 10a1 1 0 0 0-1-1H4"/>',
  plane:'<path d="M3 17 12 21l9-4M3 12l9 4 9-4M3 7l9-4 9 4-9 4Z"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  cursor:'<path d="M4 3l7 17 2.5-6.5L20 11 4 3Z"/>',
  trash:'<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  newfolder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v4M10 13h4"/>',
};

export function iconSvg(pathFrag, cls) {
  return `<svg viewBox="0 0 24 24" class="ico ${cls || ''}">${pathFrag || GLYPH.point}</svg>`;
}
