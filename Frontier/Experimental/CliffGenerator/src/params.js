// Parameter defaults, presets and the control schema the inspector is built from.
// Groups map 1:1 onto outliner rows; `stage` says what has to be recomputed when a value changes:
//   'terrain' → full heightfield pipeline (worker), 'rocks' → rock placement only, 'live' → uniforms.

export const defaults = {
  // Landform
  seed: 428,
  resolution: 512,
  worldSize: 2048,          // [m]
  mountainHeight: 520,      // [m]
  baseElevation: 40,        // [m]
  baseFrequency: 1.7,
  ridgeSharpness: 2.0,
  peakPower: 1.35,
  warpStrength: 0.6,
  reliefFrequency: 1.4,
  reliefContrast: 0.6,
  plateauStrength: 0,
  plateauHeight: 380,       // [m]
  canyonDepth: 0,           // [m]
  canyonWidth: 260,         // [m]
  // Strata
  strataBand: 26,           // [m]
  strataStrength: 0.75,
  strataDip: 4,             // [°]
  strataDipDirection: 35,   // [°]
  hardnessContrast: 0.8,
  // Erosion
  droplets: 180000,
  inertia: 0.08,
  sedimentCapacity: 5,
  erodeSpeed: 0.35,
  depositSpeed: 0.25,
  evaporation: 0.015,
  gravity: 4,
  dropletLifetime: 40,
  erosionRadius: 3,
  initialSpeed: 1,
  hardnessInfluence: 0.85,
  thermalIterations: 24,
  thermalRate: 0.5,
  talusSoft: 33,            // [°]
  talusHard: 78,            // [°]
  // Rocks
  rocksEnabled: 1,
  rockSeed: 7,
  screeDensity: 0.7,
  cliffBlockDensity: 0.6,
  torDensity: 0.4,
  rockSizeMin: 1.2,         // [m]
  rockSizeMax: 14,          // [m]
  rockAngularity: 0.7,
  rockEmbed: 0.45,
  rockBedding: 0.8,
  // Surface
  palette: 'granite',
  strataContrast: 0.7,
  grainSize: 0.9,           // [m]
  grainStrength: 0.6,
  flakeStrength: 0.6,
  flakeScale: 0.35,         // [m]
  peelStrength: 0.7,
  peelScale: 2.2,           // [m]
  peelLift: 0.6,
  wetness: 0.6,
  snowLine: 430,            // [m]
  snowSlope: 48,            // [°]
  vegetation: 0.6,
  mossiness: 0.5,
  // Sun & sky
  sunAzimuth: 215,          // [°]
  sunElevation: 24,         // [°]
  turbidity: 4,
  exposure: 0.55,
  fogDensity: 0.35,
  seaLevel: 0,              // [m]
  waterEnabled: 1,
  // Viewport
  wireframe: 0,
  showRocks: 1,
  autoRotate: 0,
};

export const presets = {
  'Alpine granite': {
    palette: 'granite', mountainHeight: 560, baseFrequency: 1.7, ridgeSharpness: 2.2, peakPower: 1.4, warpStrength: 0.6,
    strataBand: 26, strataStrength: 0.6, strataDip: 6, hardnessContrast: 0.7, plateauStrength: 0, canyonDepth: 0,
    snowLine: 430, vegetation: 0.6, seaLevel: 0, waterEnabled: 1, talusSoft: 34, talusHard: 80, droplets: 180000,
    screeDensity: 0.7, cliffBlockDensity: 0.5, torDensity: 0.5, peelStrength: 0.55, flakeStrength: 0.65,
  },
  'Sandstone mesa': {
    palette: 'sandstone', mountainHeight: 320, baseElevation: 60, baseFrequency: 1.3, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.45,
    strataBand: 18, strataStrength: 1.0, strataDip: 2, hardnessContrast: 1.0, plateauStrength: 0.85, plateauHeight: 300,
    canyonDepth: 0, snowLine: 5000, vegetation: 0.15, seaLevel: -100, waterEnabled: 0, talusSoft: 30, talusHard: 86,
    droplets: 140000, erodeSpeed: 0.3, screeDensity: 0.8, cliffBlockDensity: 0.9, torDensity: 0.3, peelStrength: 0.9, peelScale: 3.0, flakeStrength: 0.4,
    sunElevation: 32, sunAzimuth: 240, turbidity: 6,
  },
  'Canyon': {
    palette: 'sandstone', mountainHeight: 260, baseElevation: 240, baseFrequency: 1.1, ridgeSharpness: 1.2, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 420, canyonDepth: 380, canyonWidth: 420,
    strataBand: 16, strataStrength: 1.0, strataDip: 1.5, hardnessContrast: 1.0, snowLine: 5000, vegetation: 0.1, seaLevel: -20, waterEnabled: 1,
    talusSoft: 31, talusHard: 86, droplets: 160000, screeDensity: 0.9, cliffBlockDensity: 0.9, torDensity: 0.2,
    peelStrength: 0.9, peelScale: 3.2, flakeStrength: 0.4, sunElevation: 38, sunAzimuth: 200, turbidity: 5,
  },
  'Sea cliffs': {
    palette: 'basalt', mountainHeight: 300, baseElevation: 20, baseFrequency: 1.4, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.5,
    reliefContrast: 0.9, strataBand: 22, strataStrength: 0.85, strataDip: 8, strataDipDirection: 120, hardnessContrast: 0.9,
    plateauStrength: 0.5, plateauHeight: 220, canyonDepth: 0, snowLine: 5000, vegetation: 0.9, mossiness: 0.8, seaLevel: 70, waterEnabled: 1,
    talusSoft: 35, talusHard: 84, droplets: 150000, screeDensity: 0.6, cliffBlockDensity: 0.7, torDensity: 0.3,
    peelStrength: 0.6, peelScale: 1.8, flakeStrength: 0.7, sunElevation: 18, sunAzimuth: 290, turbidity: 3, fogDensity: 0.5,
  },
  'Limestone escarpment': {
    palette: 'limestone', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.2, ridgeSharpness: 1.7, peakPower: 1.2, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 30, strataStrength: 0.9, strataDip: 10, strataDipDirection: 300, hardnessContrast: 0.9,
    plateauStrength: 0.35, plateauHeight: 400, canyonDepth: 0, snowLine: 5000, vegetation: 0.75, mossiness: 0.5, seaLevel: 0, waterEnabled: 0,
    talusSoft: 33, talusHard: 82, droplets: 170000, screeDensity: 0.8, cliffBlockDensity: 0.8, torDensity: 0.4,
    peelStrength: 0.7, peelScale: 2.4, flakeStrength: 0.5, sunElevation: 28, sunAzimuth: 160, turbidity: 4,
  },
};

export const palettes = {
  granite:   { name: 'Granite',   rockA: [0.46, 0.45, 0.43], rockB: [0.30, 0.29, 0.28], rockC: [0.58, 0.55, 0.50], fresh: [0.68, 0.66, 0.62], oxide: [0.42, 0.30, 0.20] },
  sandstone: { name: 'Sandstone', rockA: [0.76, 0.48, 0.30], rockB: [0.52, 0.28, 0.17], rockC: [0.86, 0.68, 0.48], fresh: [0.90, 0.74, 0.55], oxide: [0.40, 0.18, 0.10] },
  limestone: { name: 'Limestone', rockA: [0.70, 0.66, 0.58], rockB: [0.46, 0.43, 0.38], rockC: [0.82, 0.78, 0.70], fresh: [0.88, 0.85, 0.78], oxide: [0.50, 0.36, 0.22] },
  basalt:    { name: 'Basalt',    rockA: [0.24, 0.24, 0.25], rockB: [0.12, 0.12, 0.13], rockC: [0.36, 0.35, 0.34], fresh: [0.45, 0.44, 0.43], oxide: [0.36, 0.22, 0.14] },
  slate:     { name: 'Slate',     rockA: [0.30, 0.32, 0.36], rockB: [0.16, 0.18, 0.22], rockC: [0.44, 0.46, 0.50], fresh: [0.55, 0.57, 0.60], oxide: [0.38, 0.26, 0.18] },
};

// Inspector schema. Each group = one outliner row. Each control: [key, label, min, max, step, unit, hint]
export const groups = [
  {
    id: 'landform', name: 'Landform', type: 'Base relief', stage: 'terrain', color: '#d6a078',
    cards: [
      { title: 'Preset', kind: 'presets' },
      { title: 'Elevation', controls: [
        ['mountainHeight', 'Mountain height', 100, 1200, 10, 'm', 'Peak elevation above the datum'],
        ['baseElevation', 'Base elevation', -200, 400, 5, 'm', 'Elevation of the plains'],
        ['worldSize', 'World size', 1024, 4096, 128, 'm', 'Side length of the generated tile'],
      ] },
      { title: 'Relief', controls: [
        ['baseFrequency', 'Ridge frequency', 0.6, 4, 0.05, '', 'Number of ridge systems across the tile'],
        ['ridgeSharpness', 'Ridge sharpness', 1, 4, 0.05, '', 'Crest profile — rounded to knife-edge'],
        ['peakPower', 'Peak emphasis', 0.6, 2.5, 0.05, '', 'Concentrates height into the summits'],
        ['warpStrength', 'Domain warp', 0, 1.5, 0.05, '', 'Bends ridgelines into realistic curves'],
        ['reliefContrast', 'Massif contrast', 0.1, 1, 0.05, '', 'How sharply mountains rise from plains'],
        ['reliefFrequency', 'Massif frequency', 0.6, 3, 0.1, '', 'Scale of the mountain / plains pattern'],
      ] },
      { title: 'Mesa & canyon', controls: [
        ['plateauStrength', 'Plateau flattening', 0, 1, 0.05, '', 'Soft-clamps summits into flat tops'],
        ['plateauHeight', 'Plateau height', 50, 1000, 10, 'm', 'Elevation of the caprock surface'],
        ['canyonDepth', 'Canyon depth', 0, 600, 10, 'm', 'Incision of the meandering gorge'],
        ['canyonWidth', 'Canyon width', 60, 900, 10, 'm', 'Rim-to-rim width'],
      ] },
      { title: 'Grid', controls: [
        ['seed', 'Seed', 1, 9999, 1, '', 'Deterministic noise seed'],
        ['resolution', 'Resolution', 128, 1024, 128, 'px', 'Heightfield side in samples — 1024 is slow'],
      ] },
    ],
  },
  {
    id: 'strata', name: 'Strata', type: 'Cliff layering', stage: 'terrain', color: '#c29583',
    cards: [
      { title: 'Bedding', controls: [
        ['strataBand', 'Bed thickness', 6, 80, 1, 'm', 'Vertical thickness of each rock layer'],
        ['strataStrength', 'Terracing', 0, 1, 0.05, '', 'How strongly beds step into benches and faces'],
        ['hardnessContrast', 'Caprock contrast', 0, 1, 0.05, '', 'Resistant layers hold vertical faces; soft layers slope'],
      ] },
      { title: 'Geological dip', controls: [
        ['strataDip', 'Dip angle', 0, 25, 0.5, '°', 'Tilt of the bedding planes'],
        ['strataDipDirection', 'Dip direction', 0, 360, 5, '°', 'Compass direction the beds dip towards'],
      ] },
    ],
  },
  {
    id: 'erosion', name: 'Erosion', type: 'Hydraulic & thermal', stage: 'terrain', color: '#81b8c8',
    cards: [
      { title: 'Hydraulic erosion', controls: [
        ['droplets', 'Droplets', 0, 600000, 10000, '', 'Rain particles traced downhill'],
        ['erodeSpeed', 'Cutting rate', 0.05, 1, 0.05, '', 'How fast flowing water removes material'],
        ['depositSpeed', 'Deposition rate', 0.05, 1, 0.05, '', 'How readily sediment settles into fans'],
        ['sedimentCapacity', 'Sediment capacity', 1, 12, 0.5, '', 'Load a fast droplet can carry'],
        ['evaporation', 'Evaporation', 0.002, 0.05, 0.001, '', 'Droplet lifetime limit by drying'],
        ['inertia', 'Inertia', 0, 0.5, 0.01, '', 'Momentum of flow around obstacles'],
        ['erosionRadius', 'Brush radius', 1, 6, 1, 'px', 'Width of the carved channel'],
        ['hardnessInfluence', 'Rock resistance', 0, 1, 0.05, '', 'How much caprock resists cutting'],
      ] },
      { title: 'Thermal weathering', controls: [
        ['thermalIterations', 'Slump passes', 0, 80, 1, '', 'Iterations of talus slumping'],
        ['talusSoft', 'Repose angle · soft', 20, 45, 1, '°', 'Scree settles to this slope'],
        ['talusHard', 'Repose angle · hard', 45, 89, 1, '°', 'Caprock holds faces up to this angle'],
        ['thermalRate', 'Slump rate', 0.1, 1, 0.05, '', 'Fraction of excess moved per pass'],
      ] },
    ],
  },
  {
    id: 'rocks', name: 'Rocks', type: 'Boulders & scree', stage: 'rocks', color: '#a8bbeb',
    cards: [
      { title: 'Placement pattern', controls: [
        ['screeDensity', 'Scree aprons', 0, 1, 0.05, '', 'Loose debris where sediment collected below cliffs'],
        ['cliffBlockDensity', 'Cliff blocks', 0, 1, 0.05, '', 'Blocks embedded along resistant beds on faces'],
        ['torDensity', 'Summit tors', 0, 1, 0.05, '', 'Large blocks perched on crests'],
        ['rockBedding', 'Bed alignment', 0, 1, 0.05, '', 'Rotate blocks to follow the strata dip'],
      ] },
      { title: 'Rock shape', controls: [
        ['rockSizeMin', 'Smallest rock', 0.3, 6, 0.1, 'm', ''],
        ['rockSizeMax', 'Largest rock', 2, 40, 0.5, 'm', ''],
        ['rockAngularity', 'Angularity', 0, 1, 0.05, '', 'Planar cleavage cuts vs. rounded boulders'],
        ['rockEmbed', 'Embed depth', 0, 1, 0.05, '', 'How deep rocks sit in the ground'],
        ['rockSeed', 'Rock seed', 1, 999, 1, '', ''],
      ] },
    ],
  },
  {
    id: 'surface', name: 'Surface', type: 'Procedural rock material', stage: 'live', color: '#cab281',
    cards: [
      { title: 'Rock type', kind: 'palette' },
      { title: 'Strata & grain', controls: [
        ['strataContrast', 'Bed colour contrast', 0, 1, 0.05, '', 'Tonal difference between beds'],
        ['grainSize', 'Grain size', 0.1, 3, 0.05, 'm', 'Scale of the aggregate bump'],
        ['grainStrength', 'Grain relief', 0, 1, 0.05, '', 'Bump strength of the grain'],
      ] },
      { title: 'Mineral flakes', controls: [
        ['flakeStrength', 'Flake coverage', 0, 1, 0.05, '', 'Layered cellular mineral plates'],
        ['flakeScale', 'Flake size', 0.08, 1.5, 0.01, 'm', ''],
      ] },
      { title: 'Exfoliation', controls: [
        ['peelStrength', 'Peeling sheets', 0, 1, 0.05, '', 'Onion-skin sheets lifting and spalling off the face'],
        ['peelScale', 'Sheet size', 0.5, 6, 0.1, 'm', ''],
        ['peelLift', 'Edge lift', 0, 1, 0.05, '', 'How far sheet edges curl away from the rock'],
      ] },
      { title: 'Cover', controls: [
        ['wetness', 'Runoff staining', 0, 1, 0.05, '', 'Dark wet streaks along drainage'],
        ['vegetation', 'Vegetation', 0, 1, 0.05, '', 'Grass and scrub on gentle ground'],
        ['mossiness', 'Moss on rock', 0, 1, 0.05, '', 'Lichen and moss in sheltered cracks'],
        ['snowLine', 'Snow line', 0, 5000, 10, 'm', 'Snow settles above this elevation'],
        ['snowSlope', 'Snow slope limit', 10, 80, 1, '°', 'Steeper faces shed snow'],
      ] },
    ],
  },
  {
    id: 'sun', name: 'Sun & atmosphere', type: 'Lighting', stage: 'live', color: '#e8b65f',
    cards: [
      { title: 'Sun direction', controls: [
        ['sunAzimuth', 'Azimuth', 0, 360, 1, '°', ''],
        ['sunElevation', 'Elevation', 2, 80, 1, '°', 'Low sun rakes the cliff faces'],
      ] },
      { title: 'Atmosphere', controls: [
        ['turbidity', 'Turbidity', 1, 12, 0.5, '', 'Haze and aerosol density'],
        ['fogDensity', 'Valley fog', 0, 1, 0.05, '', 'Distance haze strength'],
        ['exposure', 'Exposure', 0.1, 1.5, 0.05, '', ''],
      ] },
      { title: 'Water', controls: [
        ['waterEnabled', 'Water plane', 0, 1, 1, '', ''],
        ['seaLevel', 'Water level', -200, 600, 5, 'm', ''],
      ] },
    ],
  },
  {
    id: 'viewport', name: 'Viewport', type: 'Display & export', stage: 'live', color: '#99aafa',
    cards: [
      { title: 'Display', controls: [
        ['wireframe', 'Wireframe', 0, 1, 1, '', ''],
        ['showRocks', 'Show rocks', 0, 1, 1, '', ''],
        ['autoRotate', 'Auto-rotate', 0, 1, 1, '', ''],
      ] },
      { title: 'Export', kind: 'export' },
    ],
  },
];

export function paramsForStage(values, stage) {
  const keys = new Set();
  for (const g of groups) if (g.stage === stage) for (const c of g.cards) for (const ctl of c.controls || []) keys.add(ctl[0]);
  const out = {};
  for (const k of keys) out[k] = values[k];
  return out;
}

export function stageOf(key) {
  for (const g of groups) for (const c of g.cards) for (const ctl of c.controls || []) if (ctl[0] === key) return g.stage;
  if (key === 'palette') return 'live';
  return 'terrain';
}
