const app = document.querySelector('#app');

/*
 * This is a deliberately dependency-free HTML reconstruction of the native
 * Project-Zero editor. The layout vocabulary follows the C++ panels in
 * Frontier/Engine/Editor (OutlinerPanel, ViewportPanel, InspectorPanel and
 * NativeConstructPanel); it does not use the separate experimental editor.
 */

const iconPaths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m6.5 9 5.5 5.5L17.5 9"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.7"/><path d="m15 15 4.4 4.4"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/><circle cx="8" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="11" cy="18" r="1.5"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  folder: '<path d="M3.8 7.5a2 2 0 0 1 2-2h4l1.8 2.1h6.6a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z"/><path d="M3.8 9.4h16.4"/>',
  camera: '<path d="M4 8.2h11.2l2.2 2.2H20v7.1a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.5z"/><path d="m7.1 8.2 1.1-2h3.7l1.1 2"/><circle cx="12" cy="13.8" r="3.1"/>',
  light: '<circle cx="12" cy="12" r="3.4"/><path d="M12 3.2v2M12 18.8v2M3.2 12h2M18.8 12h2M5.8 5.8l1.4 1.4M16.8 16.8l1.4 1.4M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4"/>',
  sun: '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  sky: '<path d="M4 15.5c1.4-3 3.6-4.5 6-4.5 1.2-3.2 5.9-3.1 7.1.5 1.6-.2 3 1.1 3 2.7 0 1.7-1.4 3-3.1 3H7.3A3.3 3.3 0 0 1 4 15.5Z"/><path d="M5 19.5h14"/>',
  atmosphere: '<circle cx="12" cy="12" r="7.5"/><path d="M4.8 14.4c3.2-2.8 10.9-2.8 14.4 0M6.4 8.5c3.2 1.7 7.9 1.7 11.2 0"/>',
  stars: '<path d="m12 3 1.4 5.3L18.5 10l-5.1 1.6L12 17l-1.4-5.4L5.5 10l5.1-1.7Z"/><path d="m18.5 15 .65 2.35L21.5 18l-2.35.65L18.5 21l-.65-2.35L15.5 18l2.35-.65Z"/>',
  wind: '<path d="M3 8.2h10.5c3.4 0 3.4-4.1.3-4.1-1.4 0-2.3.7-2.9 1.6M3 12.2h15.1c3.7 0 3.5 4.2.2 4.2-1.6 0-2.4-.8-2.8-1.7M3 16.3h7.5"/>',
  fog: '<path d="M4 8.2h16M2.8 12h13.5M5 15.8h15M3.6 19.5h11"/>',
  geometry: '<path d="m12 3 7 4v10l-7 4-7-4V7z"/><path d="m5 7 7 4 7-4M12 11v10"/>',
  cube: '<path d="m12 3 7.4 4.2v9.6L12 21l-7.4-4.2V7.2z"/><path d="m4.6 7.2 7.4 4.2 7.4-4.2M12 11.4V21"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.2 2.1 3.2 4.8 3.2 8S14.2 17.9 12 20M12 4C9.8 6.1 8.8 8.8 8.8 12s1 5.9 3.2 8"/>',
  cylinder: '<ellipse cx="12" cy="5.7" rx="6.5" ry="2.7"/><path d="M5.5 5.7v12.6c0 1.5 13 1.5 13 0V5.7"/><path d="M5.5 18.3c0 1.5 13 1.5 13 0"/>',
  plane: '<path d="m3.5 12 8.5-7 8.5 7-8.5 7Z"/><path d="m3.5 12 8.5 1.6 8.5-1.6M12 13.6V19"/>',
  empty: '<circle cx="12" cy="12" r="2"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
  spline: '<path d="M4 17c2.3-9.6 7-10.4 10.3-5.1 1.7 2.8 3.5 3.1 5.7-.7"/><circle cx="4" cy="17" r="1.5"/><circle cx="10" cy="8.5" r="1.5"/><circle cx="15" cy="14" r="1.5"/><circle cx="20" cy="11.2" r="1.5"/>',
  vehicle: '<path d="M3.5 14.5V11l2-1.1 1.7-3.2h9.6l2.2 3.2 1.5 1.1v3.5"/><path d="M5.2 14.5h13.6M7.4 6.7l-.8 3.2m9.8-3.2.9 3.2"/><circle cx="7" cy="15.5" r="2"/><circle cx="17" cy="15.5" r="2"/><path d="M9.2 15.5h5.6"/>',
  tyre: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M5.9 5.9l1.4 1.4M16.7 16.7l1.4 1.4M18.1 5.9l-1.4 1.4M7.3 16.7l-1.4 1.4"/>',
  rim: '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="2.3"/><path d="m12 5.2 1.7 4.5 4.5-1.7-2.4 4 2.4 4-4.5-1.7L12 18.8l-1.7-4.5L5.8 16l2.4-4-2.4-4 4.5 1.7z"/>',
  cloth: '<path d="M4 5.1c4.9 2.6 10.5-2.1 16 .3v13.5c-4.9-2.5-10.4 2.1-16-.3Z"/><path d="M4 9.4c5 2.5 10.7-2 16 .4M4 13.8c4.9 2.6 10.6-2 16 .3"/>',
  softbody: '<path d="M4.4 8.2C4.4 5.6 7.1 4 10.1 5c1.7-2 5.4-1.3 5.9 1.3 2.9-.3 4.5 1.8 3.5 4.4 2.3 1.9 1.1 5.8-2 6.1-1 2.7-4.9 3.2-6.5 1-2.8 1.3-5.7-.7-5.1-3.5-2.7-1-2.8-4.7-1.5-6Z"/><path d="M8 10.2c1.1 1.3 2.4 1.7 4 1.7s3-.5 4-1.7M9.1 15c1.6-1.3 4.4-1.3 6 0"/>',
  physics: '<path d="M5 4.5h14v14H5z"/><path d="M8 8h8v8H8zM3 12h2m14 0h2M12 3v2m0 14v2"/>',
  terrain: '<path d="m3 18 6.2-8.5 3.8 4.4 2.5-3.1L21 18Z"/><path d="M3 20h18"/>',
  particles: '<circle cx="7" cy="8" r="1.5"/><circle cx="15.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="14" r="1.8"/><circle cx="9.5" cy="16" r="1"/><path d="M6 19c3-5 7-6 13-2"/>',
  audio: '<path d="M4 10h4l5-4v12l-5-4H4z"/><path d="M16 9.2c1.1.8 1.7 1.7 1.7 2.8s-.6 2-1.7 2.8M18.5 6.7c1.9 1.4 2.8 3.2 2.8 5.3s-.9 3.9-2.8 5.3"/>',
  material: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.6" cy="8.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="16.2" cy="13.5" r="1.15" fill="currentColor" stroke="none"/><path d="M8.5 15.7c1.6-1.4 3.8-.9 3.8.7 0 1.1-.7 1.6-2 1.6-3.5 0-6.3-2.6-6.3-6.1 0-4.2 3.6-7.9 8-7.9"/>',
  water: '<path d="M3 9.5c2.2 1.7 4.4 1.7 6.6 0 2.2-1.7 4.4-1.7 6.6 0 2.2 1.7 4.4 1.7 5.8 0M3 14c2.2 1.7 4.4 1.7 6.6 0 2.2-1.7 4.4-1.7 6.6 0 2.2 1.7 4.4 1.7 5.8 0M3 18.5c2.2 1.7 4.4 1.7 6.6 0 2.2-1.7 4.4-1.7 6.6 0 2.2 1.7 4.4 1.7 5.8 0"/>',
  animation: '<path d="M4 17c2.5-8 5.6-8 8-3.4 1.8 3.4 4.6 3.3 8-5.1"/><path d="M4 5v4M8 3v4M12 5v4M16 3v4M20 5v4"/>',
  play: '<path d="m8 5 10 7-10 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
  simulate: '<path d="M18.5 9.5A7 7 0 1 0 19 14"/><path d="M18.5 4.5v5h-5"/><path d="M12 8v4l2.8 1.6"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  marker: '<path d="M12 3.5c-2.8 0-5 2.1-5 4.8 0 3.7 5 9.2 5 9.2s5-5.5 5-9.2c0-2.7-2.2-4.8-5-4.8Z"/><circle cx="12" cy="8.3" r="1.5"/>',
  eye: '<path d="M2.8 12s3.4-5.2 9.2-5.2 9.2 5.2 9.2 5.2-3.4 5.2-9.2 5.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.3"/>',
  eyeoff: '<path d="m3.2 3.2 17.6 17.6M9.6 6.9A10.7 10.7 0 0 1 12 6.6c5.8 0 9.2 5.4 9.2 5.4a15 15 0 0 1-3 3.5M6.2 8.3A15.5 15.5 0 0 0 2.8 12S6.2 17.2 12 17.2c1.2 0 2.3-.2 3.3-.6"/><path d="M10 10a2.8 2.8 0 0 0 3.9 3.9"/>',
  lock: '<rect x="5.5" y="10" width="13" height="10" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>',
  unlock: '<rect x="5.5" y="10" width="13" height="10" rx="2"/><path d="M9.2 10V7.7A3.4 3.4 0 0 1 15.4 5"/>',
  gear: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6"/>',
  command: '<path d="M5.3 4.5 3.5 6.3v11.4l1.8 1.8M18.7 4.5l1.8 1.8v11.4l-1.8 1.8M6.5 9h11M6.5 15h11"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m12 3-2 2m2-2 2 2m0 7 2-2-2 2 2 2m-4 5 2-2-2 2-2-2m-5-5 2-2-2 2 2 2m5-4 2-2m-2 2-2-2m2 2 2 2m-2-2-2 2"/>',
  rotate: '<path d="M19 8.5A7.7 7.7 0 1 0 19.5 14"/><path d="m19.3 4.5-.3 4.2-4.2-.3"/>',
  scale: '<path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4M8 8l8 8"/>',
  duplicate: '<rect x="8" y="8" width="11" height="11" rx="1.4"/><path d="M5 16V5h11"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l.8 13h8.4L17 7M10 11v5M14 11v5"/>',
  arrow: '<path d="M5 12h13M14 7l5 5-5 5"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  warning: '<path d="m12 3 9 17H3Z"/><path d="M12 9v4M12 16.5h.01"/>',
};

function icon(name, className = '', label = '') {
  const body = iconPaths[name] || iconPaths.empty;
  const title = label ? `<title>${escapeHtml(label)}</title>` : '';
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="${label ? 'false' : 'true'}" ${label ? 'role="img"' : ''}>${title}${body}</svg>`;
}

let allEntitySeed = 1;

const groups = [
  {
    id: 'cameras',
    label: 'Cameras',
    children: [
      entity('main-camera', 'Main Camera', 'camera', 'Camera', 'cameras', '#35d28a', '55°', [152, 281], [46, 40]),
      entity('cine-camera', 'Cine Camera', 'camera', 'Camera', 'cameras', '#6ed8bd', '35 mm', [85, 340], [37, 30]),
    ],
  },
  {
    id: 'world',
    label: 'World',
    children: [
      entity('atmosphere', 'Atmosphere', 'atmosphere', 'Environment', 'world', '#62a9ff', 'AM 10.2', [320, 263], [61, 62]),
      entity('sun', 'Sun', 'sun', 'Light', 'world', '#ffb454', '5.2°', [520, 214], [58, 75], { dynamic: true }),
      entity('sky', 'Sky', 'sky', 'Environment', 'world', '#71a4ff', '5.08 kcd', [720, 267], [64, 48]),
      entity('stars', 'Stars', 'stars', 'Body', 'world', '#c9d2ff', 'mag -1.3', [812, 230], [35, 37]),
      entity('height-fog', 'Height Fog', 'fog', 'Environment', 'world', '#bdc5ca', '391 m', [283, 371], [72, 36]),
      entity('wind', 'Wind', 'wind', 'Environment', 'world', '#9eaebc', '4.2 m/s', [787, 384], [49, 34]),
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    children: [
      entity('aurora-coupe', 'Aurora Coupe', 'vehicle', 'Vehicle', 'transport', '#9e82ff', 'drive', [602, 319], [100, 57], { dynamic: true, physics: true }),
      entity('front-left-tyre', 'Front Left Tyre', 'tyre', 'Tyre', 'transport', '#389cff', '285/70R17', [702, 402], [53, 54], { dynamic: true, physics: true }),
      entity('front-left-rim', 'Front Left Rim', 'rim', 'Rim', 'transport', '#d9e0ed', '18 in', [760, 422], [39, 38]),
    ],
  },
  {
    id: 'simulation',
    label: 'Simulation',
    children: [
      entity('seat-fabric', 'Seat Fabric', 'cloth', 'Cloth', 'simulation', '#f17da9', '12 × 18', [436, 389], [58, 43], { dynamic: true, physics: true }),
      entity('soft-shell', 'Soft Shell', 'softbody', 'Soft body', 'simulation', '#dd8aff', 'XPBD', [531, 395], [55, 43], { dynamic: true, physics: true }),
    ],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    children: [
      entity('shader-ball', 'Shader Ball', 'sphere', 'Geometry', 'geometry', '#4dc7db', 'mesh', [404, 322], [48, 51]),
      entity('display-plinth', 'Display Plinth', 'cube', 'Geometry', 'geometry', '#d78e5b', '2.0 m', [212, 404], [77, 38]),
    ],
  },
];

function entity(id, name, iconName, category, group, color, meta, pos, size, flags = {}) {
  return {
    id,
    name,
    icon: iconName,
    category,
    group,
    color,
    meta,
    pos,
    size,
    visible: flags.visible !== false,
    locked: Boolean(flags.locked),
    dynamic: Boolean(flags.dynamic),
    physics: Boolean(flags.physics),
    notes: '',
    idNumber: flags.idNumber || 100 + allEntitySeed++,
  };
}

// Reset the initial seed to the native inspector's familiar #100 range after scene construction.
allEntitySeed = 113;
allEntities().forEach((item, index) => { item.idNumber = 100 + index + 1; });

const filterCatalog = [
  { id: 'Lights', color: '#ffb454', matches: (item) => item.category === 'Light' },
  { id: 'Sky', color: '#5aa9ff', matches: (item) => ['Environment'].includes(item.category) },
  { id: 'Bodies', color: '#dfe6f5', matches: (item) => ['Body', 'Vehicle', 'Tyre', 'Rim', 'Cloth', 'Soft body'].includes(item.category) },
  { id: 'Geometry', color: '#e2e8f0', matches: (item) => ['Geometry', 'Vehicle', 'Tyre', 'Rim', 'Cloth', 'Soft body'].includes(item.category) },
  { id: 'Camera', color: '#34c759', matches: (item) => item.category === 'Camera' },
];

const catalogue = [
  catalog('cube', 'Cube', 'cube', 'Geometry', 'Geometry', 'geometry', '#aebaf4', 'mesh • primitive'),
  catalog('sphere', 'Sphere', 'sphere', 'Geometry', 'Geometry', 'geometry', '#59c8e1', 'mesh • primitive'),
  catalog('cylinder', 'Cylinder', 'cylinder', 'Geometry', 'Geometry', 'geometry', '#d7a272', 'mesh • primitive'),
  catalog('plane', 'Plane', 'plane', 'Geometry', 'Geometry', 'geometry', '#9bc2b4', 'mesh • primitive'),
  catalog('spline', 'Spline', 'spline', 'Geometry', 'Geometry', 'geometry', '#a687ff', 'curve • editable'),
  catalog('empty', 'Empty Entity', 'empty', 'Geometry', 'Geometry', 'geometry', '#a8aab0', 'locator • null'),
  catalog('static-mesh', 'Static Mesh', 'geometry', 'Geometry', 'Geometry', 'geometry', '#d0d5df', 'mesh • asset'),
  catalog('camera', 'Camera', 'camera', 'Cameras', 'Camera', 'cameras', '#3bd08b', 'camera • scene'),
  catalog('directional-light', 'Directional Light', 'sun', 'Lighting', 'Light', 'world', '#ffb454', 'light • sun'),
  catalog('point-light', 'Point Light', 'light', 'Lighting', 'Light', 'world', '#ffd573', 'light • point'),
  catalog('area-light', 'Area Light', 'plane', 'Lighting', 'Light', 'world', '#ffa35a', 'light • area'),
  catalog('sky', 'Sky', 'sky', 'Environment', 'Environment', 'world', '#73a9ff', 'world • sky'),
  catalog('atmosphere', 'Atmosphere', 'atmosphere', 'Environment', 'Environment', 'world', '#75b8f8', 'world • volume'),
  catalog('fog', 'Height Fog', 'fog', 'Weather', 'Environment', 'world', '#bfc8cf', 'weather • volume'),
  catalog('wind', 'Wind', 'wind', 'Weather', 'Environment', 'world', '#9aafbf', 'weather • field'),
  catalog('rain', 'Particle Emitter', 'particles', 'Weather', 'Environment', 'world', '#62b4ef', 'weather • fx'),
  catalog('vehicle', 'Vehicle', 'vehicle', 'Transport', 'Vehicle', 'transport', '#9e82ff', 'transport • drive'),
  catalog('tyre', 'Tyre', 'tyre', 'Transport', 'Tyre', 'transport', '#389cff', 'transport • wheel'),
  catalog('rim', 'Wheel Rim', 'rim', 'Transport', 'Rim', 'transport', '#d9e0ed', 'transport • wheel'),
  catalog('cloth', 'Cloth', 'cloth', 'Simulation', 'Cloth', 'simulation', '#f17da9', 'simulation • fabric'),
  catalog('soft-body', 'Soft Body', 'softbody', 'Simulation', 'Soft body', 'simulation', '#dd8aff', 'simulation • XPBD'),
  catalog('rigid-body', 'Rigid Body', 'physics', 'Simulation', 'Geometry', 'simulation', '#f8b563', 'simulation • physics'),
  catalog('terrain', 'Terrain', 'terrain', 'Environment', 'Geometry', 'geometry', '#88b76a', 'landscape • mesh'),
  catalog('water', 'Water Body', 'water', 'Environment', 'Geometry', 'geometry', '#4eb7e5', 'fluid • surface'),
  catalog('material', 'Material', 'material', 'Media', 'Geometry', 'geometry', '#e38dcc', 'asset • surface'),
  catalog('audio', 'Audio Emitter', 'audio', 'Media', 'Geometry', 'geometry', '#b6a4ff', 'audio • spatial'),
  catalog('animation', 'Animation Rig', 'animation', 'Media', 'Geometry', 'geometry', '#6bd6c9', 'motion • rig'),
];

function catalog(id, label, iconName, paletteCategory, category, group, color, meta) {
  return { id, label, icon: iconName, paletteCategory, category, group, color, meta };
}

const paletteCategories = ['All', 'Environment', 'Weather', 'Cameras', 'Geometry', 'Lighting', 'Transport', 'Simulation', 'Media'];

const state = {
  selectedId: 'sun',
  outlinerSearch: '',
  filters: new Set(),
  filterOpen: false,
  collapsedGroups: new Set(),
  collapsedCards: new Set(),
  activeInstanceChips: new Set(['Visible']),
  toggles: new Set(['sun-intensity', 'tyre-pressure', 'tyre-depth', 'tyre-wear']),
  mode: 'EDIT',
  view: 'PERSPECTIVE',
  gizmoMode: 'move',
  menu: '',
  paletteOpen: false,
  paletteCategory: 'All',
  paletteSearch: '',
  command: '',
  commandOpen: false,
  tyreEditorOpen: false,
  tyreTab: 'Tyre',
  tyreView: 'Iso',
  addedCount: 0,
  status: 'Scene editable',
  toast: null,
};

function allEntities() {
  return groups.flatMap((group) => group.children);
}

function findEntity(id) {
  return allEntities().find((item) => item.id === id) || null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function hexShade(hex, multiplier) {
  const parsed = String(hex).replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(parsed)) return hex;
  const channels = [0, 2, 4].map((index) => Math.round(parseInt(parsed.slice(index, index + 2), 16) * multiplier));
  return `#${channels.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`;
}

function queryMatches(item, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [item.name, item.category, item.meta, item.icon].join(' ').toLocaleLowerCase().includes(normalized);
}

function filterMatches(item) {
  if (!state.filters.size) return true;
  return [...state.filters].some((filterId) => filterCatalog.find((filter) => filter.id === filterId)?.matches(item));
}

function visibleTreeGroups() {
  return groups.filter((group) => group.children.some((item) => queryMatches(item, state.outlinerSearch) && filterMatches(item)));
}

function visibleNumber() {
  const hidden = allEntities().filter((item) => !item.visible).length;
  return 122 + state.addedCount - hidden;
}

function hiddenNumber() {
  return allEntities().filter((item) => !item.visible).length;
}

function renderApp() {
  app.innerHTML = `${renderShell()}${state.paletteOpen ? renderPalette() : ''}${state.tyreEditorOpen ? renderTyreEditor() : ''}${state.toast ? renderToast() : ''}`;
}

function renderShell() {
  return `
    <div class="editor-shell">
      ${renderOutliner()}
      ${renderViewport()}
      ${renderInspector()}
    </div>`;
}

function renderOutliner() {
  const filters = filterCatalog.filter((filter) => state.filters.has(filter.id));
  return `
    <aside class="pane outliner-pane" aria-label="Outliner">
      <div class="tab-rail">
        <button class="editor-tab" type="button" data-action="focus-outliner" aria-label="Outliner tab">
          <span>Outliner</span><span class="tab-close">×</span>
        </button>
        <button class="tab-add" type="button" data-action="open-palette" aria-label="Add an entity">${icon('plus')}</button>
      </div>
      <div class="panel-head outliner-head">
        <div class="head-title-row">
          <h1 class="pane-title">Outliner</h1>
          <span class="scene-name">Showcase • ${122 + state.addedCount} nodes</span>
          <button class="menu-disc" type="button" data-action="toggle-menu" data-menu="outliner" aria-label="Outliner options">${icon('menu')}</button>
        </div>
        <div class="census-grid" aria-label="Scene census">
          <div class="census-card">
            <span class="status-dot ok">✓</span>
            <span class="census-number">${visibleNumber()}</span>
            <span class="census-label">Visible</span>
          </div>
          <div class="census-card">
            <span class="status-dot hidden">△</span>
            <span class="census-number">${hiddenNumber()}</span>
            <span class="census-label">Hidden</span>
          </div>
        </div>
        <div class="search-filter-row">
          <label class="search-field" aria-label="Search scene entities">
            ${icon('search')}
            <input id="outliner-search" autocomplete="off" value="${escapeAttr(state.outlinerSearch)}" placeholder="Search  Ctrl+Shift+F" />
          </label>
          <button class="filter-trigger ${state.filterOpen ? 'is-open' : ''}" type="button" data-action="toggle-filter-menu" aria-expanded="${state.filterOpen}">
            ${icon('filter')} <span>Filter</span><span>⌄</span>
          </button>
          ${state.filterOpen ? renderFilterMenu() : ''}
        </div>
      </div>
      ${filters.length ? `<div class="active-filters">${filters.map(renderFilterChip).join('')}</div>` : ''}
      <div class="outliner-tree" aria-label="Project-Zero scene hierarchy">
        ${renderTree()}
      </div>
      <footer class="footer-strip" aria-label="Realtime telemetry">
        <div class="readout-cell"><span class="readout-caption">Realtime</span><span class="readout-value good">60 fps</span></div>
        <div class="readout-cell"><span class="readout-caption">Quality</span><span class="readout-value">Standard</span></div>
        <div class="readout-cell"><span class="readout-caption">Sun</span><span class="readout-value">5.2°</span></div>
        <div class="readout-cell"><span class="readout-caption">Moons</span><span class="readout-value">1/4</span></div>
        <div class="readout-cell"><span class="readout-caption">Cam</span><span class="readout-value">0, 2.0, 0</span></div>
      </footer>
      ${state.menu === 'outliner' ? renderOutlinerMenu() : ''}
    </aside>`;
}

function renderFilterMenu() {
  return `<div class="filter-menu" role="menu" aria-label="Outliner filters">
    <div class="filter-menu-title">FILTER ENTITIES</div>
    ${filterCatalog.map((filter) => `
      <button class="filter-option ${state.filters.has(filter.id) ? 'selected' : ''}" type="button" data-action="toggle-filter" data-filter="${filter.id}" role="menuitemcheckbox" aria-checked="${state.filters.has(filter.id)}">
        <span class="filter-color" style="background:${filter.color}"></span>
        <span>${filter.id}</span>
        ${state.filters.has(filter.id) ? '<span class="filter-check">✓</span>' : ''}
      </button>`).join('')}
  </div>`;
}

function renderFilterChip(filter) {
  return `<button class="filter-chip" type="button" data-action="toggle-filter" data-filter="${filter.id}" title="Remove ${filter.id} filter">
    <span class="filter-color" style="background:${filter.color}"></span>${filter.id}<span class="chip-close">×</span>
  </button>`;
}

function renderTree() {
  const treeGroups = visibleTreeGroups();
  if (!treeGroups.length) {
    return `<div class="tree-empty">${icon('search')}<span>No scene entities match this filter.</span></div>`;
  }
  return treeGroups.map((group) => {
    const matchingChildren = group.children.filter((item) => queryMatches(item, state.outlinerSearch) && filterMatches(item));
    const forceOpen = Boolean(state.outlinerSearch || state.filters.size);
    const closed = state.collapsedGroups.has(group.id) && !forceOpen;
    return `<section class="tree-group" aria-label="${escapeAttr(group.label)} folder">
      <button class="tree-folder-row ${closed ? 'is-closed' : ''}" type="button" data-action="toggle-group" data-group="${group.id}" aria-expanded="${!closed}">
        ${icon('chevron', 'chevron')}
        <span class="folder-icon">${icon('folder')}</span>
        <span class="tree-folder-name">${escapeHtml(group.label)}</span>
        <span class="tree-folder-meta">${matchingChildren.length}</span>
      </button>
      ${closed ? '' : matchingChildren.map(renderTreeEntity).join('')}
    </section>`;
  }).join('');
}

function renderTreeEntity(item) {
  const selected = item.id === state.selectedId;
  return `<div class="tree-entity-row ${selected ? 'selected' : ''}" role="button" tabindex="0" data-action="select" data-id="${item.id}" style="--entity-color:${item.color}" aria-label="Select ${escapeAttr(item.name)}">
    <span class="entity-icon">${icon(item.icon)}</span>
    <span class="entity-name">${escapeHtml(item.name)}</span>
    ${item.dynamic ? '<span class="entity-tag">DYN</span>' : ''}
    <span class="entity-meta">${escapeHtml(item.meta)}</span>
    <button class="entity-status ${item.visible ? 'is-visible' : 'is-hidden'}" type="button" data-action="toggle-visible" data-id="${item.id}" aria-label="${item.visible ? 'Hide' : 'Show'} ${escapeAttr(item.name)}">
      ${icon(item.visible ? 'eye' : 'eyeoff')}
    </button>
  </div>`;
}

function renderOutlinerMenu() {
  return `<div class="tool-popover" style="top:65px;left:138px;right:auto" aria-label="Outliner options">
    <span class="popover-label">SCENE DIRECTORY</span>
    <button type="button" data-action="expand-all">${icon('folder')} Expand all folders</button>
    <button type="button" data-action="collapse-all">${icon('folder')} Collapse all folders</button>
    <button type="button" data-action="open-palette">${icon('plus')} Construct entity…</button>
  </div>`;
}

function renderViewport() {
  const selected = findEntity(state.selectedId);
  return `
    <section class="pane viewport-pane" aria-label="Viewport">
      <div class="tab-rail viewport-tab-rail">
        <button class="editor-tab" type="button" data-action="focus-viewport" aria-label="Viewport tab">Viewport <span class="tab-close">×</span></button>
        <div class="project-tab">Project-Zero</div>
      </div>
      <div class="viewport-toolbar">
        <div class="tool-cluster">
          <button class="tool-button tiny" type="button" data-action="focus-selected" title="Frame selected (F)">F</button>
          <button class="tool-button tiny" type="button" data-action="toggle-menu" data-menu="selection" title="Selection mode">${icon('geometry')}</button>
          <button class="tool-button tiny" type="button" data-action="toggle-menu" data-menu="grid" title="Grid settings">${icon('grid')}</button>
          <button class="tool-button add-entity" type="button" data-action="open-palette" title="Construct entity">${icon('plus')} ADD</button>
        </div>
        <div class="transport-toggle" aria-label="Editor run mode">
          ${['EDIT', 'SIMULATE', 'PLAY'].map((mode) => `<button class="mode-button ${state.mode === mode ? 'active' : ''}" type="button" data-action="editor-mode" data-mode="${mode}" aria-pressed="${state.mode === mode}">${mode === 'PLAY' ? '● PLAY' : mode === 'SIMULATE' ? '● SIMULATE' : 'EDIT'}</button>`).join('')}
        </div>
        <div class="tool-cluster right">
          <button class="toolbar-select" type="button" data-action="toggle-menu" data-menu="view" aria-expanded="${state.menu === 'view'}">${state.view} <span class="chev">⌄</span></button>
          <button class="tool-button" type="button" data-action="toggle-menu" data-menu="markers">${icon('marker')} MARKERS</button>
          <span class="live-state">LIVE</span>
          <button class="tool-button tiny settings-label" type="button" data-action="toggle-menu" data-menu="settings" aria-label="Viewport settings">${icon('gear')}</button>
        </div>
        ${state.menu === 'view' ? renderViewMenu() : ''}
        ${state.menu === 'settings' ? renderSettingsMenu() : ''}
        ${state.menu === 'selection' ? renderSelectionMenu() : ''}
        ${state.menu === 'grid' ? renderGridMenu() : ''}
      </div>
      <div class="gizmo-modebar" aria-label="Transform gizmo controls">
        ${[
          ['move', 'move', 'Move  G'],
          ['rotate', 'rotate', 'Rotate  R'],
          ['scale', 'scale', 'Scale  S'],
        ].map(([mode, glyph, label]) => `<button class="gizmo-mode-button ${state.gizmoMode === mode ? 'active' : ''}" type="button" data-action="gizmo-mode" data-mode="${mode}" aria-pressed="${state.gizmoMode === mode}">${icon(glyph)}${label}</button>`).join('')}
        <span class="gizmo-shortcut">WORLD • SNAP 0.1 m</span>
      </div>
      <div class="viewport-stage-wrap">
        <div class="viewport-stage" aria-label="Project-Zero scene viewport">
          ${renderSceneSvg(selected)}
          <div class="viewport-hud"><span class="hud-chip"><span class="tiny-dot"></span>${state.mode}</span><span class="hud-chip">${selected ? escapeHtml(selected.name) : 'No selection'}</span></div>
          ${renderAxisOrb()}
        </div>
        ${state.commandOpen ? renderCommandSuggestions() : ''}
        <form class="viewport-command" data-command-form>
          <span class="command-mark">${icon('command')}</span>
          <input id="command-input" class="command-input" autocomplete="off" value="${escapeAttr(state.command)}" placeholder="find" aria-label="Command console" />
          <span class="command-key">?K</span>
          <button class="command-submit" type="submit" aria-label="Run command">${icon('play')}</button>
        </form>
      </div>
      <footer class="viewport-footer" aria-label="Viewport statistics">
        <span>FPS <strong class="good">60</strong></span><span class="separator">•</span><span>16.7 ms</span><span class="separator">•</span><span>TRIS 5 994</span><span class="separator">•</span><span>INSTANCES ${122 + state.addedCount}</span><span class="separator">•</span><span>CAMERA +0° +0° 4.5m</span>
        <span class="viewport-status-message">${escapeHtml(state.status)}</span>
      </footer>
    </section>`;
}

function renderViewMenu() {
  return `<div class="tool-popover" aria-label="Viewport camera views">
    <span class="popover-label">CAMERA VIEW</span>
    ${['PERSPECTIVE', 'ORTHOGRAPHIC', 'FRONT', 'BACK', 'RIGHT', 'LEFT', 'TOP', 'BOTTOM'].map((view) => `<button class="${state.view === view ? 'active' : ''}" type="button" data-action="set-view" data-view="${view}">${icon(view === 'PERSPECTIVE' ? 'cube' : view === 'ORTHOGRAPHIC' ? 'grid' : 'marker')} ${view}</button>`).join('')}
  </div>`;
}

function renderSettingsMenu() {
  return `<div class="tool-popover" aria-label="Viewport settings">
    <span class="popover-label">VIEWPORT</span>
    <button type="button" data-action="toggle-setting" data-setting="grid">${icon('grid')} Grid <span style="margin-left:auto;color:#91e4ae">ON</span></button>
    <button type="button" data-action="toggle-setting" data-setting="gizmo">${icon('move')} Transform gizmo <span style="margin-left:auto;color:#91e4ae">ON</span></button>
    <button type="button" data-action="toggle-setting" data-setting="stats">${icon('command')} Statistics <span style="margin-left:auto;color:#91e4ae">ON</span></button>
  </div>`;
}

function renderSelectionMenu() {
  return `<div class="tool-popover" style="left:44px;right:auto" aria-label="Selection mode">
    <span class="popover-label">SELECTION</span>
    <button class="active" type="button" data-action="select-mode">${icon('geometry')} Object</button>
    <button type="button" data-action="select-mode">${icon('plane')} Surface</button>
    <button type="button" data-action="select-mode">${icon('spline')} Edge</button>
  </div>`;
}

function renderGridMenu() {
  return `<div class="tool-popover" style="left:76px;right:auto" aria-label="Grid settings">
    <span class="popover-label">GRID SETTINGS</span>
    <button type="button" data-action="set-status" data-status="Grid spacing set to 0.1 metres">${icon('grid')} 0.1 m snap</button>
    <button type="button" data-action="set-status" data-status="World axis display enabled">${icon('move')} World axes</button>
  </div>`;
}

function renderSceneSvg(selected) {
  const objects = allEntities().filter((item) => item.visible).map((item) => renderSceneObject(item, selected?.id === item.id)).join('');
  const gizmo = selected?.visible ? renderGizmo(selected) : '';
  return `<svg viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Abstract colored Project-Zero viewport boxes">
    <defs>
      <linearGradient id="viewport-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#273c5d"/><stop offset="0.55" stop-color="#5f81aa"/><stop offset="0.551" stop-color="#d6c9b8"/><stop offset="1" stop-color="#1e2733"/></linearGradient>
      <linearGradient id="floor-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8cbb9"/><stop offset="1" stop-color="#7d7582"/></linearGradient>
      <filter id="box-glow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity=".35"/></filter>
      <marker id="x-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 7 3 0 6z" fill="#ef5350"/></marker>
      <marker id="y-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 7 3 0 6z" fill="#69d06d"/></marker>
      <marker id="z-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 7 3 0 6z" fill="#5b8cff"/></marker>
    </defs>
    <rect width="960" height="540" fill="url(#viewport-sky)"/>
    <path d="M0 220H960V540H0Z" fill="url(#floor-wash)"/>
    <g opacity=".24" stroke="#7d7380" stroke-width="1">
      ${Array.from({ length: 12 }, (_, index) => `<path d="M0 ${255 + index * 28}H960"/>`).join('')}
      ${Array.from({ length: 15 }, (_, index) => {
        const x = index * 70;
        return `<path d="M480 220 ${x} 540"/>`;
      }).join('')}
    </g>
    <path d="M0 220H960" stroke="#f4ddbd" stroke-opacity=".78" stroke-width="2"/>
    <g filter="url(#box-glow)">${objects}</g>
    ${gizmo}
  </svg>`;
}

function renderSceneObject(item, selected) {
  const [x, y] = item.pos;
  const [width, height] = item.size;
  const depth = Math.max(11, Math.round(width * 0.32));
  const frontY = y + depth;
  const front = item.color;
  const top = hexShade(front, 1.24);
  const side = hexShade(front, 0.63);
  const shadow = hexShade(front, 0.45);
  return `<g class="scene-object ${selected ? 'selected' : ''}" data-action="select" data-id="${item.id}" role="button" tabindex="0" aria-label="Select ${escapeAttr(item.name)}">
    <title>${escapeHtml(item.name)}</title>
    <polygon class="object-shadow" points="${x + depth * .3},${frontY + height} ${x + width + depth * 1.9},${frontY + height + depth * .74} ${x + width + depth * 3.3},${frontY + height + depth * 1.78} ${x + depth * 1.1},${frontY + height + depth * 1.15}" fill="${shadow}"/>
    <polygon class="box-top" points="${x},${frontY} ${x + depth},${y} ${x + width + depth},${y} ${x + width},${frontY}" fill="${top}"/>
    <polygon class="box-side" points="${x + width},${frontY} ${x + width + depth},${y} ${x + width + depth},${y + height} ${x + width},${frontY + height}" fill="${side}"/>
    <rect class="box-front" x="${x}" y="${frontY}" width="${width}" height="${height}" fill="${front}"/>
    <rect class="selection-outline" x="${x - 4}" y="${y - 4}" width="${width + depth + 8}" height="${height + depth + 8}" rx="2"/>
  </g>`;
}

function renderGizmo(item) {
  const [x, y] = item.pos;
  const [width, height] = item.size;
  const cx = x + width * 0.5;
  const cy = y + height * 0.48;
  if (state.gizmoMode === 'rotate') {
    return `<g class="transform-gizmo rotation-gizmo" pointer-events="none">
      <ellipse cx="${cx}" cy="${cy}" rx="48" ry="17" fill="none" stroke="#ef5350" stroke-width="3"/>
      <ellipse cx="${cx}" cy="${cy}" rx="27" ry="45" fill="none" stroke="#69d06d" stroke-width="3" transform="rotate(-34 ${cx} ${cy})"/>
      <ellipse cx="${cx}" cy="${cy}" rx="27" ry="45" fill="none" stroke="#5b8cff" stroke-width="3" transform="rotate(40 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#f0f1f3"/>
    </g>`;
  }
  const scale = state.gizmoMode === 'scale';
  const endCap = scale ? `<rect x="${cx + 57}" y="${cy - 5}" width="10" height="10" fill="#ef5350"/><rect x="${cx - 5}" y="${cy - 67}" width="10" height="10" fill="#69d06d"/><rect x="${cx - 47}" y="${cy + 38}" width="10" height="10" fill="#5b8cff"/>` : '';
  return `<g class="transform-gizmo" pointer-events="none">
    <polygon points="${cx + 13},${cy - 13} ${cx + 28},${cy - 13} ${cx + 28},${cy - 28} ${cx + 13},${cy - 28}" fill="rgba(105,208,109,.28)" stroke="#69d06d" stroke-width="1.2"/>
    <polygon points="${cx - 13},${cy + 13} ${cx - 28},${cy + 13} ${cx - 28},${cy + 28} ${cx - 13},${cy + 28}" fill="rgba(91,140,255,.27)" stroke="#5b8cff" stroke-width="1.2"/>
    <line x1="${cx}" y1="${cy}" x2="${cx + 67}" y2="${cy}" stroke="#ef5350" stroke-width="3" marker-end="url(#x-arrow)"/>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 67}" stroke="#69d06d" stroke-width="3" marker-end="url(#y-arrow)"/>
    <line x1="${cx}" y1="${cy}" x2="${cx - 47}" y2="${cy + 47}" stroke="#5b8cff" stroke-width="3" marker-end="url(#z-arrow)"/>
    ${endCap}
    <circle cx="${cx}" cy="${cy}" r="7" fill="#f7f7f8" stroke="#4a4b51" stroke-width="2"/>
    <g fill="#f0f1f3" font-family="monospace" font-size="10"><text x="${cx + 73}" y="${cy + 4}">X</text><text x="${cx + 5}" y="${cy - 71}">Y</text><text x="${cx - 57}" y="${cy + 57}">Z</text></g>
  </g>`;
}

function renderAxisOrb() {
  return `<button class="axis-orb" type="button" data-action="toggle-menu" data-menu="view" aria-label="Open view directions">
    <svg viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r="30" fill="rgba(11,12,15,.18)"/>
      <line x1="38" y1="38" x2="64" y2="38" stroke="#ef5350" stroke-width="2.5"/><circle cx="64" cy="38" r="6" fill="#ef5350"/>
      <line x1="38" y1="38" x2="38" y2="14" stroke="#69d06d" stroke-width="2.5"/><circle cx="38" cy="14" r="6" fill="#69d06d"/>
      <line x1="38" y1="38" x2="20" y2="55" stroke="#5b8cff" stroke-width="2.5"/><circle cx="20" cy="55" r="6" fill="#5b8cff"/>
      <circle cx="38" cy="38" r="7" fill="#e5e5e8"/>
      <g fill="#e6e6e8" font-family="monospace" font-size="10"><text x="67" y="42">X</text><text x="42" y="16">Y</text><text x="10" y="64">Z</text></g>
    </svg>
  </button>`;
}

function commandSuggestions() {
  const commands = [
    { value: 'find <entity>', label: 'find <entity>', detail: 'SELECT IT, REVEAL IT IN THE TREE AND FRAME IT' },
    { value: 'rotate <entity> 40 degrees on z', label: 'rotate <entity> 40 degrees on z', detail: 'DEGREES BY DEFAULT, RADIANS IF YOU SAY SO' },
    { value: 'move <entity> 2 m on x', label: 'move <entity> 2 m on x', detail: 'OR “MOVE CUBE TO X 4 Y 1 Z 0”' },
    { value: 'enable physics on <entity>', label: 'enable physics on <entity>', detail: 'BODIES FALL AND SETTLE WHILE THE WORLD RUNS' },
    { value: 'delete from ram <entity>', label: 'delete from ram <entity>', detail: 'CLOSES IT AND DISPOSES ITS GPU + RAM BUFFERS' },
    { value: 'play', label: 'play', detail: 'RUN THE WORLD THROUGH A CAMERA' },
    { value: 'add tyre', label: 'add tyre', detail: 'CONSTRUCT A TRANSPORT TYRE ENTITY' },
  ];
  const needle = state.command.trim().toLocaleLowerCase();
  const suggestions = commands.filter((item) => !needle || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle));
  const matchingEntities = allEntities().filter((item) => needle && item.name.toLocaleLowerCase().includes(needle)).slice(0, 3).map((item) => ({
    value: `find ${item.name}`,
    label: item.name,
    detail: `${item.category.toUpperCase()} • FIND AND FRAME`,
    entity: item,
  }));
  return [...suggestions.slice(0, 5), ...matchingEntities].slice(0, 7);
}

function renderCommandSuggestions() {
  const suggestions = commandSuggestions();
  return `<div class="command-suggestions" role="listbox" aria-label="Command suggestions">
    <div class="command-suggestion-caption">${state.command.trim() ? 'WHAT THIS WILL DO' : 'SAY SOMETHING LIKE'}</div>
    ${suggestions.length ? suggestions.map((suggestion, index) => `<button class="command-suggestion ${index === 0 && state.command.trim() ? 'primary' : ''}" type="button" data-action="command-suggest" data-value="${escapeAttr(suggestion.value)}" role="option">
      ${suggestion.entity ? icon(suggestion.entity.icon) : icon('command')}
      <span>${escapeHtml(suggestion.label)}</span><span class="suggest-detail">${escapeHtml(suggestion.detail)}</span>
    </button>`).join('') : `<div class="command-suggestion"><span></span><span>No command found</span><span class="suggest-detail">PRESS ESC TO CLEAR</span></div>`}
  </div>`;
}

function renderInspector() {
  const selected = findEntity(state.selectedId);
  if (!selected) {
    return `<aside class="pane inspector-pane" aria-label="Inspector"><div class="tab-rail"><button class="editor-tab" type="button">Inspector <span class="tab-close">×</span></button></div><div class="inspector-head-empty">Nothing selected</div></aside>`;
  }
  return `<aside class="pane inspector-pane" aria-label="Inspector">
    <div class="tab-rail"><button class="editor-tab" type="button" data-action="focus-inspector">Inspector <span class="tab-close">×</span></button></div>
    <div class="inspector-ident" style="--entity-color:${selected.color}">
      <span class="ident-icon">${icon(selected.icon)}</span>
      <div class="ident-name-block">
        <input class="ident-name" data-input="entity-name" data-id="${selected.id}" value="${escapeAttr(selected.name)}" aria-label="Entity name" />
        <span class="ident-category">${escapeHtml(selected.category)}</span>
      </div>
      <div class="ident-actions">
        <button class="icon-button" type="button" data-action="toggle-lock" data-id="${selected.id}" aria-label="${selected.locked ? 'Unlock' : 'Lock'} ${escapeAttr(selected.name)}">${icon(selected.locked ? 'lock' : 'unlock')}</button>
        <button class="icon-button" type="button" data-action="toggle-visible" data-id="${selected.id}" aria-label="${selected.visible ? 'Hide' : 'Show'} ${escapeAttr(selected.name)}">${icon(selected.visible ? 'eye' : 'eyeoff')}</button>
      </div>
    </div>
    <div class="inspector-scroll">
      ${renderInspectorCards(selected)}
    </div>
    <footer class="footer-strip inspector-footer"><span class="footer-object">${escapeHtml(selected.category)} • ${selected.dynamic ? 'dynamic' : 'static'}</span><span class="footer-right"><span>FPS <b class="good">60</b></span><span>TRIS 5 994</span></span></footer>
  </aside>`;
}

function renderInspectorCards(item) {
  if (item.id === 'sun' || item.icon === 'sun') return renderLightInspector(item);
  if (item.icon === 'tyre') return renderTyreInspector(item);
  return renderGenericInspector(item);
}

function cardKey(item, id) {
  return `${item.id}:${id}`;
}

function renderCard(item, id, title, content) {
  const key = cardKey(item, id);
  const collapsed = state.collapsedCards.has(key);
  return `<section class="property-card ${collapsed ? 'collapsed' : ''}">
    <button class="card-heading" type="button" data-action="toggle-card" data-card="${escapeAttr(key)}" aria-expanded="${!collapsed}">${icon('chevron', 'chevron')}<span class="card-title">${escapeHtml(title)}</span></button>
    ${collapsed ? '' : `<div class="card-content">${content}</div>`}
  </section>`;
}

function numberPill(value, unit, label) {
  return `<label class="number-pill"><span class="screen-reader">${escapeHtml(label)}</span><input value="${escapeAttr(value)}" inputmode="decimal" aria-label="${escapeAttr(label)}"/><span>${escapeHtml(unit)}</span></label>`;
}

function toggleSwitch(key, on = true, label = 'Toggle') {
  const active = state.toggles.has(key) === on;
  return `<button class="switch ${active ? 'is-on' : ''}" type="button" data-action="toggle-switch" data-switch="${escapeAttr(key)}" aria-label="${escapeAttr(label)}" aria-pressed="${active}"></button>`;
}

function renderLightInspector(item) {
  return `
    ${renderCard(item, 'light', 'Light', `
      <div class="property-row"><span class="property-label">Intensity</span>${numberPill('32.0', '', 'Intensity')}<span class="select-pill">1×</span>${toggleSwitch('sun-intensity', true, 'Enable intensity')}</div>
      <div class="property-row"><span class="property-label">Colour</span><span class="color-swatch" aria-label="White colour"></span><span class="mini-copy">#FFFFFF</span></div>
    `)}
    ${renderCard(item, 'aim', 'Aim', `<div class="property-row"><span class="property-label">Direction</span><span class="property-value">-Z (nadir)</span></div>`)}
    ${renderInstanceCard(item)}
    ${renderNotesCard(item)}`;
}

function renderTyreInspector(item) {
  return `
    ${renderCard(item, 'inflation', 'Inflation', `
      <div class="inspector-hero-number">240<small>kPa</small></div>
      <p class="inspector-copy">The authored value. Hoop and spoke compliance derive from it, so the slider means something physical.</p>
      <div class="property-row"><span class="property-label">Pressure</span>${numberPill('240', 'kPa', 'Tyre pressure')}${toggleSwitch('tyre-pressure', true, 'Enable tyre pressure')}</div>
    `)}
    ${renderCard(item, 'tread', 'Tread', `
      <div class="inspector-hero-number">15.0<small>mm</small></div>
      <div class="property-row"><span class="property-label">Depth</span>${numberPill('15.0', 'mm', 'Tread depth')}${toggleSwitch('tyre-depth', true, 'Enable tread depth')}</div>
      <div class="property-row"><span class="property-label">Wear</span>${numberPill('0.00', '', 'Tread wear')}${toggleSwitch('tyre-wear', true, 'Enable tread wear')}</div>
      <div class="property-row"><span class="property-label">Bias</span>${numberPill('0.00', '', 'Tread bias')}${toggleSwitch('tyre-bias', false, 'Enable tread bias')}</div>
    `)}
    ${renderCard(item, 'rim', 'Rim bottoming', `
      <div class="inspector-hero-number">6.0<small>mm</small></div>
      <p class="inspector-copy">Part 4 settles the damping ratio at 0.25. At 1.00 the stop pumped energy back into the carcass.</p>
      <div class="property-row"><span class="property-label">Clearance</span>${numberPill('6.0', 'mm', 'Rim clearance')}${toggleSwitch('tyre-clearance', true, 'Enable rim clearance')}</div>
      <div class="property-row"><span class="property-label">Damping</span>${numberPill('0.25', '', 'Rim damping')}${toggleSwitch('tyre-damping', true, 'Enable rim damping')}</div>
    `)}
    ${renderCard(item, 'instance', 'Instance', `<div class="instance-definition"><span>Outer</span><span>831 mm</span></div><div class="instance-definition"><span>Circumference</span><span>2610 mm</span></div><div class="instance-definition"><span>Source</span><span>TreadMeshSolver</span></div>`)}
    <button class="open-editor-button" type="button" data-action="open-tyre-editor">${icon('tyre')} Open Tyre Generator</button>
    ${renderNotesCard(item)}`;
}

function renderGenericInspector(item) {
  const visualTitle = item.category === 'Soft body' ? 'Soft body' : item.category;
  const typeControls = genericControls(item);
  return `
    ${renderCard(item, 'primary', visualTitle, typeControls)}
    ${renderCard(item, 'transform', 'Transform', `
      <div class="property-caption" style="margin:2px 0 7px">POSITION</div>
      <div class="transform-vector"><span class="vector-cell x"><em>X</em>${(item.pos[0] / 100).toFixed(1)}</span><span class="vector-cell y"><em>Y</em>${(item.pos[1] / 100).toFixed(1)}</span><span class="vector-cell z"><em>Z</em>0.0</span></div>
      <div class="property-caption" style="margin:12px 0 7px">SCALE</div>
      <div class="transform-vector"><span class="vector-cell x"><em>X</em>1.00</span><span class="vector-cell y"><em>Y</em>1.00</span><span class="vector-cell z"><em>Z</em>1.00</span></div>
    `)}
    ${renderInstanceCard(item)}
    ${renderNotesCard(item)}`;
}

function genericControls(item) {
  if (item.icon === 'vehicle') {
    return `<div class="property-row"><span class="property-label">Drive mode</span><span class="select-pill">Road</span>${toggleSwitch(`${item.id}-drive`, true, 'Enable drive mode')}</div>
      <div class="property-row"><span class="property-label">Mass</span>${numberPill('1480', 'kg', 'Vehicle mass')}</div>
      <div class="property-row"><span class="property-label">Power</span>${numberPill('520', 'kW', 'Vehicle power')}</div>`;
  }
  if (item.icon === 'cloth') {
    return `<div class="property-row"><span class="property-label">Simulated</span>${toggleSwitch(`${item.id}-sim`, true, 'Enable cloth simulation')}</div>
      <div class="property-row"><span class="property-label">Bend stiffness</span>${numberPill('0.42', '', 'Cloth bend stiffness')}</div>
      <div class="property-row"><span class="property-label">Damping</span>${numberPill('0.18', '', 'Cloth damping')}</div>`;
  }
  if (item.icon === 'softbody') {
    return `<div class="property-row"><span class="property-label">Solver</span><span class="select-pill">XPBD</span>${toggleSwitch(`${item.id}-solve`, true, 'Enable soft body solver')}</div>
      <div class="property-row"><span class="property-label">Compliance</span>${numberPill('0.05', '', 'Soft body compliance')}</div>
      <div class="property-row"><span class="property-label">Substeps</span>${numberPill('8', '', 'Soft body substeps')}</div>`;
  }
  if (item.icon === 'camera') {
    return `<div class="property-row"><span class="property-label">Focal length</span>${numberPill('55', 'mm', 'Focal length')}</div>
      <div class="property-row"><span class="property-label">Live camera</span>${toggleSwitch(`${item.id}-live`, true, 'Set as live camera')}</div>`;
  }
  if (item.icon === 'atmosphere' || item.icon === 'sky' || item.icon === 'fog' || item.icon === 'wind') {
    return `<div class="property-row"><span class="property-label">Enabled</span>${toggleSwitch(`${item.id}-enabled`, true, `Enable ${item.name}`)}</div>
      <div class="property-row"><span class="property-label">Density</span>${numberPill(item.icon === 'fog' ? '0.34' : '1.00', '', 'Density')}</div>
      <div class="property-row"><span class="property-label">Quality</span><span class="select-pill">Standard</span></div>`;
  }
  return `<div class="property-row"><span class="property-label">Visible</span>${toggleSwitch(`${item.id}-enabled`, item.visible, `Enable ${item.name}`)}</div>
    <div class="property-row"><span class="property-label">Material</span><span class="select-pill">Default</span></div>
    <div class="property-row"><span class="property-label">Static</span><span class="property-value">Yes</span></div>`;
}

function renderInstanceCard(item) {
  const chips = ['Visible', 'Locked', 'Dynamic', 'Physics'];
  return renderCard(item, 'instance', 'Instance', `
    <div class="instance-chips">${chips.map((chip) => {
      const modelActive = chip === 'Visible' ? item.visible : chip === 'Locked' ? item.locked : chip === 'Dynamic' ? item.dynamic : item.physics;
      const isActive = state.activeInstanceChips.has(`${item.id}:${chip}`) || (item.id === 'sun' && chip === 'Visible') || modelActive;
      return `<button class="instance-chip ${isActive ? 'active' : ''}" type="button" data-action="toggle-instance-chip" data-chip="${chip}" data-id="${item.id}">${chip.toUpperCase()}</button>`;
    }).join('')}</div>
    <div class="instance-definition"><span>Type</span><span>${escapeHtml(item.category)}</span></div>
    <div class="instance-definition"><span>ID</span><span>#${item.idNumber}</span></div>`);
}

function renderNotesCard(item) {
  return renderCard(item, 'notes', 'Notes', `<textarea class="notes-input" data-input="notes" data-id="${item.id}" aria-label="Notes for ${escapeAttr(item.name)}" placeholder="">${escapeHtml(item.notes)}</textarea>`);
}

function renderPalette() {
  const cards = catalogue.filter((entry) => {
    const categoryMatch = state.paletteCategory === 'All' || entry.paletteCategory === state.paletteCategory;
    const text = `${entry.label} ${entry.meta} ${entry.category}`.toLocaleLowerCase();
    return categoryMatch && text.includes(state.paletteSearch.toLocaleLowerCase().trim());
  });
  return `<div class="modal-scrim" data-action="close-palette" role="presentation">
    <section class="construct-modal" role="dialog" aria-modal="true" aria-labelledby="construct-title">
      <header class="modal-titlebar">
        <h2 id="construct-title">CONSTRUCT&nbsp; / &nbsp;PROJECT-ZERO</h2><span class="modal-steps">01 Entities&nbsp; › &nbsp;02 Properties</span>
        <button class="modal-close" type="button" data-action="close-palette" aria-label="Close construct palette">${icon('close')}</button>
      </header>
      <label class="palette-search">${icon('search')}<input id="palette-search" autocomplete="off" value="${escapeAttr(state.paletteSearch)}" placeholder="Search engine entities, transport, simulation…" /></label>
      <div class="palette-body">
        <nav class="palette-categories" aria-label="Entity categories">
          ${paletteCategories.map((category) => `<button class="palette-category ${state.paletteCategory === category ? 'active' : ''}" type="button" data-action="palette-category" data-category="${category}">${category}</button>`).join('')}
        </nav>
        <div class="palette-cards" aria-label="Entities to add">
          ${cards.length ? cards.map((entry) => `<button class="palette-card" type="button" data-action="add-type" data-type="${entry.id}" style="--tile-color:${entry.color}">
            <span class="palette-card-icon">${icon(entry.icon)}</span><span class="palette-card-name">${escapeHtml(entry.label)}</span><span class="palette-card-meta">${escapeHtml(entry.meta)}</span>
          </button>`).join('') : '<div class="palette-empty">No matching engine entity.</div>'}
        </div>
      </div>
    </section>
  </div>`;
}

function renderTyreEditor() {
  const presetNames = [
    ['GZero', 'SLICK'], ['Grizzly Magnum', 'OFF-ROAD'], ['Vortex R1', 'GRIP / UHP'], ['Smokestack D', 'DRIFT'],
    ['Urban Pulse', 'STREET'], ['Monsoon Cut', 'WET'], ['Shadow Line', 'STREET / UHP'], ['HexaGrip Nova', 'GRIP'],
    ['Dimple Rave', 'SEMI-SLICK'], ['Frostbite Sipe', 'WINTER'], ['Kestrel TC', 'SEMI-SLICK'], ['Ravager Mud', 'RALLY'],
  ];
  return `<div class="modal-scrim" data-action="close-tyre-editor" role="presentation">
    <section class="tyre-modal" role="dialog" aria-modal="true" aria-labelledby="tyre-editor-title">
      <header class="modal-titlebar tyre-titlebar"><h2 id="tyre-editor-title">⌄&nbsp; Tyre Generator</h2><button class="modal-close" type="button" data-action="close-tyre-editor" aria-label="Close Tyre Generator">${icon('close')}</button></header>
      <nav class="tyre-tabs" aria-label="Tyre Generator sections">
        <span class="tyre-brand-mark">${icon('tyre')}</span>
        ${['Tyre', 'Rim', 'Look', 'Export'].map((tab) => `<button class="tyre-tab ${state.tyreTab === tab ? 'active' : ''}" type="button" data-action="tyre-tab" data-tab="${tab}">${tab}</button>`).join('')}
      </nav>
      <div class="tyre-body">
        <aside class="tyre-side">
          <section class="tyre-card"><div class="tyre-card-heading">Tyre size <span class="side-copy">432 mm rim</span></div><div class="tyre-size">285<span>/70</span></div><div class="tyre-side-pills"><span class="tyre-side-pill">sidewall 200 mm</span><span class="tyre-side-pill">tread 262 mm</span><span class="tyre-side-pill green">new</span></div><span class="tyre-control-label">SIZE</span><label class="tyre-slider-line"><input type="range" min="180" max="340" value="285"/><output>285</output></label><label class="tyre-slider-line"><input type="range" min="40" max="95" value="70"/><output>70</output></label><span class="tyre-control-label">TREAD MESH</span><label class="tyre-slider-line"><input type="range" min="2" max="12" value="6"/><output>6.0</output></label><label class="tyre-slider-line"><input type="range" min="360" max="960" value="720"/><output>720</output></label></section>
          <section class="tyre-card"><div class="tyre-card-heading">Tyre condition <span class="side-copy">New</span></div><div class="property-row" style="margin-top:13px"><span class="property-label">Tread wear</span><span class="property-value">0%</span></div><label class="tyre-slider-line"><input type="range" min="0" max="100" value="0"/><output></output></label><p class="mini-copy">0.0 mm worn • 15.0 mm remaining</p></section>
          <section class="tyre-card"><div class="tyre-card-heading">Cross-section <span class="side-copy">drag the handles</span></div><svg viewBox="0 0 220 110" style="width:100%;margin-top:10px" aria-label="Tyre cross-section"><path d="M30 92 36 27C68 17 152 17 184 27l6 65" fill="none" stroke="#e2e2e3" stroke-width="1.8"/><path d="M36 31H184" stroke="#e5c82d" stroke-dasharray="3 3"/><circle cx="36" cy="27" r="4" fill="#63d47a"/><circle cx="184" cy="27" r="4" fill="#63d47a"/><circle cx="30" cy="92" r="4" fill="#ffb454"/><circle cx="190" cy="92" r="4" fill="#ffb454"/><circle cx="110" cy="36" r="4" fill="#ef5350"/></svg></section>
        </aside>
        <main class="tyre-stage">
          <div class="tyre-title-card"><span class="overline">Off-road</span><strong>Grizzly Magnum</strong><small>285/70 R17</small></div>
          <div class="tyre-metrics"><div class="tyre-metric amber"><span class="metric-label">Overall Ø</span><strong>831<small> mm</small></strong></div><div class="tyre-metric"><span class="metric-label">Tread loft</span><strong>15.0<small> / 15 mm</small></strong></div><div class="tyre-metric amber"><span class="metric-label">Circumference</span><strong>2.61<small> m</small></strong></div><div class="tyre-metric"><span class="metric-label">Tread mesh</span><strong>138<small> k tris</small></strong></div></div>
          <svg class="tyre-illustration" viewBox="0 0 460 360" aria-label="Tyre preview"><defs><linearGradient id="rubber" x1="0" x2="1"><stop stop-color="#18191b"/><stop offset=".5" stop-color="#45464a"/><stop offset="1" stop-color="#17181a"/></linearGradient><pattern id="tread" width="18" height="14" patternUnits="userSpaceOnUse"><path d="M0 3h18M4 10h10" stroke="#18191a" stroke-width="3"/></pattern></defs><ellipse cx="230" cy="300" rx="160" ry="25" fill="#000" opacity=".42"/><path d="M113 56c-53 68-53 180 0 248 55 69 179 69 234 0 53-68 53-180 0-248-55-69-179-69-234 0Z" fill="url(#rubber)" stroke="#66676a" stroke-width="3"/><path d="M132 72c-38 59-38 157 0 216 47 61 149 61 196 0 38-59 38-157 0-216-47-61-149-61-196 0Z" fill="url(#tread)" stroke="#17181a" stroke-width="14"/><ellipse cx="230" cy="180" rx="71" ry="111" fill="#0d0e10" stroke="#77787c" stroke-width="5"/><ellipse cx="230" cy="180" rx="41" ry="72" fill="#303136" stroke="#929397" stroke-width="3"/><circle cx="230" cy="180" r="17" fill="#1a1b1e" stroke="#9d9ea2" stroke-width="3"/><g stroke="#9b9ca1" stroke-width="4"><path d="m230 180 0-58M230 180l42-32M230 180l42 32M230 180v58M230 180l-42 32M230 180l-42-32"/></g></svg>
          <div class="tyre-view-picker">${['Iso', 'Side', 'Tread', 'Front', 'Spin', 'X-ray cords'].map((view) => `<button class="${state.tyreView === view ? 'active' : ''}" type="button" data-action="tyre-view" data-view="${view}">${view}</button>`).join('')}</div>
        </main>
        <aside class="tyre-presets"><div class="tyre-preset-head">Tread presets <span>14 designs</span></div><div class="preset-grid">${presetNames.map(([name, kind], index) => `<button class="tread-preset ${index === 1 ? 'active' : ''}" type="button" data-action="set-status" data-status="${escapeAttr(`${name} tread preset selected`)}"><span class="tread-sample"></span><span class="preset-name">${name}</span><span class="preset-kind">${kind}</span></button>`).join('')}</div><div class="tyre-presets-bottom"><button class="primary" type="button" data-action="set-status" data-status="Random tyre generated">Random tyre</button><button type="button" data-action="set-status" data-status="Tyre name field enabled">New name</button></div></aside>
      </div>
    </section>
  </div>`;
}

function renderToast() {
  return `<div class="toast" role="status">${icon('check')}<div><strong>${escapeHtml(state.toast.title)}</strong><span>${escapeHtml(state.toast.message)}</span></div></div>`;
}

function renderWithFocus(selector, caret = null) {
  renderApp();
  if (!selector) return;
  requestAnimationFrame(() => {
    const element = document.querySelector(selector);
    if (!element) return;
    element.focus();
    if (typeof element.setSelectionRange === 'function') {
      const position = caret ?? element.value.length;
      element.setSelectionRange(position, position);
    }
  });
}

function setToast(title, message) {
  state.toast = { title, message };
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => {
    state.toast = null;
    renderApp();
  }, 3200);
}

function selectEntity(id, showToast = false) {
  const item = findEntity(id);
  if (!item) return;
  state.selectedId = id;
  state.status = `${item.name} selected`;
  state.menu = '';
  if (showToast) setToast('Selection framed', `${item.name} is active in the viewport and inspector.`);
  renderApp();
}

function addCatalogueType(typeId) {
  const type = catalogue.find((entry) => entry.id === typeId);
  if (!type) return;
  const group = groups.find((entry) => entry.id === type.group) || groups.find((entry) => entry.id === 'geometry');
  const sameKind = allEntities().filter((item) => item.icon === type.icon).length;
  const suffix = String(sameKind + 1).padStart(2, '0');
  const positions = [[120, 250], [690, 242], [337, 342], [615, 385], [819, 329], [176, 363], [532, 286]];
  const pos = positions[state.addedCount % positions.length];
  const size = type.icon === 'vehicle' ? [100, 57] : type.icon === 'tyre' ? [53, 54] : type.icon === 'cloth' ? [58, 43] : [48, 46];
  const item = entity(`new-${type.id}-${Date.now()}`, `${type.label} ${suffix}`, type.icon, type.category, group.id, type.color, type.meta.split(' • ')[0], pos, size, {
    dynamic: ['vehicle', 'tyre', 'cloth', 'softbody', 'physics'].includes(type.icon),
    physics: ['vehicle', 'tyre', 'cloth', 'softbody', 'physics'].includes(type.icon),
  });
  group.children.push(item);
  state.addedCount += 1;
  state.selectedId = item.id;
  state.paletteOpen = false;
  state.paletteSearch = '';
  state.status = `${item.name} added to ${group.label}`;
  setToast(`${type.label} constructed`, `${item.name} is selected and ready to edit.`);
  renderApp();
}

function executeCommand(raw) {
  const command = raw.trim();
  const lower = command.toLocaleLowerCase();
  if (!command) {
    state.commandOpen = false;
    state.status = 'Command console dismissed';
    renderApp();
    return;
  }
  if (lower === 'play') {
    state.mode = 'PLAY';
    state.status = 'Play mode armed through Main Camera';
    state.command = '';
    state.commandOpen = false;
    setToast('Play mode', 'The world is now running through Main Camera.');
    renderApp();
    return;
  }
  if (lower.startsWith('add ')) {
    const search = lower.slice(4).trim();
    const type = catalogue.find((entry) => entry.label.toLocaleLowerCase() === search || entry.id === search);
    if (type) {
      addCatalogueType(type.id);
      return;
    }
  }
  const searchTerm = lower.startsWith('find ') ? lower.slice(5).trim() : lower;
  const found = allEntities().find((item) => item.name.toLocaleLowerCase().includes(searchTerm));
  if (found) {
    state.command = '';
    state.commandOpen = false;
    selectEntity(found.id, true);
    return;
  }
  if (lower.startsWith('move ') || lower.startsWith('rotate ') || lower.startsWith('enable physics')) {
    state.status = `Queued: ${command}`;
    state.command = '';
    state.commandOpen = false;
    setToast('Command queued', command);
    renderApp();
    return;
  }
  state.status = 'I did not understand that command';
  state.command = '';
  state.commandOpen = false;
  setToast('Command not recognised', 'Try “find Sun”, “add tyre”, or “play”.');
  renderApp();
}

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;

  if ((action === 'close-palette' || action === 'close-tyre-editor') && target.classList.contains('modal-scrim') && event.target !== target) return;
  if (action === 'select') return selectEntity(target.dataset.id);
  if (action === 'toggle-visible') {
    event.stopPropagation();
    const item = findEntity(target.dataset.id);
    if (item) {
      item.visible = !item.visible;
      state.status = `${item.name} ${item.visible ? 'visible' : 'hidden'}`;
      renderApp();
    }
    return;
  }
  if (action === 'toggle-lock') {
    const item = findEntity(target.dataset.id);
    if (item) {
      item.locked = !item.locked;
      state.status = `${item.name} ${item.locked ? 'locked' : 'unlocked'}`;
      renderApp();
    }
    return;
  }
  if (action === 'toggle-group') {
    const id = target.dataset.group;
    state.collapsedGroups.has(id) ? state.collapsedGroups.delete(id) : state.collapsedGroups.add(id);
    renderApp();
    return;
  }
  if (action === 'toggle-filter-menu') {
    state.filterOpen = !state.filterOpen;
    state.menu = '';
    renderApp();
    return;
  }
  if (action === 'toggle-filter') {
    const id = target.dataset.filter;
    state.filters.has(id) ? state.filters.delete(id) : state.filters.add(id);
    renderWithFocus('#outliner-search');
    return;
  }
  if (action === 'toggle-menu') {
    const menu = target.dataset.menu;
    state.menu = state.menu === menu ? '' : menu;
    state.filterOpen = false;
    renderApp();
    return;
  }
  if (action === 'expand-all') {
    state.collapsedGroups.clear();
    state.menu = '';
    renderApp();
    return;
  }
  if (action === 'collapse-all') {
    groups.forEach((group) => state.collapsedGroups.add(group.id));
    state.menu = '';
    renderApp();
    return;
  }
  if (action === 'open-palette') {
    state.paletteOpen = true;
    state.paletteSearch = '';
    state.paletteCategory = 'All';
    state.menu = '';
    renderWithFocus('#palette-search');
    return;
  }
  if (action === 'close-palette') {
    state.paletteOpen = false;
    renderApp();
    return;
  }
  if (action === 'palette-category') {
    state.paletteCategory = target.dataset.category;
    renderWithFocus('#palette-search');
    return;
  }
  if (action === 'add-type') return addCatalogueType(target.dataset.type);
  if (action === 'gizmo-mode') {
    state.gizmoMode = target.dataset.mode;
    state.status = `${target.dataset.mode[0].toUpperCase()}${target.dataset.mode.slice(1)} gizmo active`;
    renderApp();
    return;
  }
  if (action === 'editor-mode') {
    state.mode = target.dataset.mode;
    state.status = `${state.mode[0]}${state.mode.slice(1).toLowerCase()} mode active`;
    renderApp();
    return;
  }
  if (action === 'set-view') {
    state.view = target.dataset.view;
    state.menu = '';
    state.status = `${state.view[0]}${state.view.slice(1).toLowerCase()} view framed`;
    renderApp();
    return;
  }
  if (action === 'toggle-setting' || action === 'select-mode') {
    state.status = target.textContent.trim().replace(/\s+/g, ' ');
    state.menu = '';
    renderApp();
    return;
  }
  if (action === 'set-status') {
    state.status = target.dataset.status || target.textContent.trim();
    renderApp();
    return;
  }
  if (action === 'focus-selected') {
    const item = findEntity(state.selectedId);
    if (item) {
      state.status = `${item.name} framed at 4.5m`;
      setToast('Framed selection', `${item.name} is centred in the viewport.`);
      renderApp();
    }
    return;
  }
  if (action === 'toggle-card') {
    const key = target.dataset.card;
    state.collapsedCards.has(key) ? state.collapsedCards.delete(key) : state.collapsedCards.add(key);
    renderApp();
    return;
  }
  if (action === 'toggle-switch') {
    const key = target.dataset.switch;
    state.toggles.has(key) ? state.toggles.delete(key) : state.toggles.add(key);
    renderApp();
    return;
  }
  if (action === 'toggle-instance-chip') {
    const key = `${target.dataset.id}:${target.dataset.chip}`;
    state.activeInstanceChips.has(key) ? state.activeInstanceChips.delete(key) : state.activeInstanceChips.add(key);
    renderApp();
    return;
  }
  if (action === 'command-suggest') {
    executeCommand(target.dataset.value);
    return;
  }
  if (action === 'open-tyre-editor') {
    state.tyreEditorOpen = true;
    renderApp();
    return;
  }
  if (action === 'close-tyre-editor') {
    state.tyreEditorOpen = false;
    renderApp();
    return;
  }
  if (action === 'tyre-tab') {
    state.tyreTab = target.dataset.tab;
    state.status = `Tyre Generator: ${state.tyreTab} page`;
    renderApp();
    return;
  }
  if (action === 'tyre-view') {
    state.tyreView = target.dataset.view;
    renderApp();
    return;
  }
  if (action === 'focus-outliner') {
    renderWithFocus('#outliner-search');
    return;
  }
  if (action === 'focus-viewport') {
    renderWithFocus('#command-input');
    return;
  }
});

app.addEventListener('submit', (event) => {
  if (!event.target.matches('[data-command-form]')) return;
  event.preventDefault();
  executeCommand(state.command);
});

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target.id === 'outliner-search') {
    state.outlinerSearch = target.value;
    return renderWithFocus('#outliner-search', target.selectionStart);
  }
  if (target.id === 'palette-search') {
    state.paletteSearch = target.value;
    return renderWithFocus('#palette-search', target.selectionStart);
  }
  if (target.id === 'command-input') {
    state.command = target.value;
    state.commandOpen = true;
    return renderWithFocus('#command-input', target.selectionStart);
  }
  if (target.dataset.input === 'entity-name') {
    const item = findEntity(target.dataset.id);
    if (item) item.name = target.value;
  }
  if (target.dataset.input === 'notes') {
    const item = findEntity(target.dataset.id);
    if (item) item.notes = target.value;
  }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target.dataset.input === 'entity-name') {
    const item = findEntity(target.dataset.id);
    if (item) {
      state.status = `${item.name || 'Unnamed entity'} renamed`;
      renderApp();
    }
  }
});

app.addEventListener('keydown', (event) => {
  const target = event.target;
  const inTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (event.key === 'Escape') {
    if (state.tyreEditorOpen) {
      state.tyreEditorOpen = false;
    } else if (state.paletteOpen) {
      state.paletteOpen = false;
    } else if (state.commandOpen) {
      state.commandOpen = false;
      state.command = '';
    } else if (state.filterOpen || state.menu) {
      state.filterOpen = false;
      state.menu = '';
    } else {
      return;
    }
    event.preventDefault();
    renderApp();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'f') {
    event.preventDefault();
    return renderWithFocus('#outliner-search');
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    state.commandOpen = true;
    return renderWithFocus('#command-input');
  }
  if (event.key === 'Enter' && target.id === 'command-input') {
    event.preventDefault();
    return executeCommand(state.command);
  }
  if (inTextField || event.ctrlKey || event.metaKey || event.altKey) return;
  const glyphMode = { g: 'move', r: 'rotate', s: 'scale' }[event.key.toLocaleLowerCase()];
  if (glyphMode) {
    state.gizmoMode = glyphMode;
    state.status = `${glyphMode[0].toUpperCase()}${glyphMode.slice(1)} gizmo active`;
    renderApp();
  }
});

// Keep the icon contract explicit: every C++-inspired entity in the construct
// catalogue has a visual mark, including the added transport and cloth types.
function validateIconCoverage() {
  const missing = [...allEntities(), ...catalogue].filter((item) => !iconPaths[item.icon]);
  if (missing.length) console.warn('Missing Project-Zero icon glyphs:', missing.map((item) => item.label || item.name));
}

validateIconCoverage();
renderApp();
