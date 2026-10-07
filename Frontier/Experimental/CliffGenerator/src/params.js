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
  rockProtrude: 0.5,
  // Cliff depth (mesh displacement)
  overhang: 3.5,            // [m]
  buttress: 0.5,
  ledgeNoise: 0.6,
  // Rock material
  palette: 'granite',
  rockA: '#b3b1ae', rockB: '#94918f', rockC: '#c7c2ba', fresh: '#d6d3cd', oxide: '#ac947b',
  strataOn: 1,
  strataContrast: 0.7,
  strataBandScale: 1,
  seamStrength: 0.35,
  seamWidth: 0.08,
  laminae: 0.6,
  bedGradient: 0.6,
  hardnessTint: 0.8,
  grainOn: 1,
  grainSize: 0.9,           // [m]
  grainStrength: 0.6,
  grainContrast: 0.5,
  grainFineness: 0.5,
  oxideOn: 1,
  oxideAmount: 0.5,
  oxideScale: 5,            // [m]
  cavityStrength: 0.8,
  bumpScale: 1,
  baseRoughness: 0.9,
  // Mineral flakes
  flakesOn: 1,
  flakeStrength: 0.6,
  flakeScale: 1.2,          // [m]
  flakeColor: 0.45,
  flakeRelief: 0.6,
  flakeSheen: 0.35,
  flakeDensity: 0.78,
  flakeLayers: 3,
  flakeEdge: 0.6,
  // Exfoliation & joints
  peelOn: 1,
  peelStrength: 0.5,
  peelScale: 2.6,           // [m]
  peelLift: 0.6,
  peelCoverage: 0.3,
  peelThickness: 1,
  peelBedding: 0.5,
  peelFresh: 0.8,
  peelOcclusion: 0.7,
  peelSmall: 0.6,
  jointsOn: 1,
  jointStrength: 0.25,
  jointScale: 4,            // [m]
  jointWidth: 0.04,
  jointDepth: 0.6,
  jointStretch: 0.4,
  // Ground cover
  runoffOn: 1,
  wetness: 0.6,
  streakScale: 6,           // [m]
  streakAmount: 1,
  gravelOn: 1,
  gravelAmount: 0.8,
  gravelScale: 0.5,         // [m]
  gravelColor: '#9a938a',
  vegOn: 1,
  vegetation: 0.6,
  vegScale: 20,             // [m]
  vegSlope: 44,             // [°]
  vegPatchiness: 0.5,
  dryness: 0.5,
  grassA: '#6f8051', grassB: '#a8a26f', dryColor: '#ac9c7b',
  mossOn: 1,
  mossiness: 0.5,
  mossScale: 4,             // [m]
  mossColor: '#687b4c',
  snowOn: 1,
  snowLine: 430,            // [m]
  snowSlope: 48,            // [°]
  snowSoftness: 1,
  snowRoughness: 0.75,
  snowColor: '#eef1f7',
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
    screeDensity: 0.7, cliffBlockDensity: 0.5, torDensity: 0.5, peelStrength: 0.45, peelCoverage: 0.3, flakeStrength: 0.65, flakeScale: 1.0, jointStrength: 0.2,
  },
  'Sandstone mesa': {
    palette: 'sandstone', mountainHeight: 320, baseElevation: 60, baseFrequency: 1.3, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.45,
    strataBand: 18, strataStrength: 1.0, strataDip: 2, hardnessContrast: 1.0, plateauStrength: 0.85, plateauHeight: 300,
    canyonDepth: 0, snowLine: 5000, vegetation: 0.15, seaLevel: -100, waterEnabled: 0, talusSoft: 30, talusHard: 86,
    droplets: 140000, erodeSpeed: 0.3, screeDensity: 0.8, cliffBlockDensity: 0.9, torDensity: 0.3, peelStrength: 0.7, peelScale: 3.0, peelCoverage: 0.45, flakeStrength: 0.4,
    sunElevation: 32, sunAzimuth: 240, turbidity: 6,
  },
  'Canyon': {
    palette: 'sandstone', mountainHeight: 260, baseElevation: 240, baseFrequency: 1.1, ridgeSharpness: 1.2, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 420, canyonDepth: 380, canyonWidth: 420,
    strataBand: 16, strataStrength: 1.0, strataDip: 1.5, hardnessContrast: 1.0, snowLine: 5000, vegetation: 0.1, seaLevel: -20, waterEnabled: 1,
    talusSoft: 31, talusHard: 86, droplets: 160000, screeDensity: 0.9, cliffBlockDensity: 0.9, torDensity: 0.2,
    peelStrength: 0.7, peelScale: 3.2, peelCoverage: 0.45, flakeStrength: 0.4, sunElevation: 38, sunAzimuth: 200, turbidity: 5,
  },
  'Sea cliffs': {
    palette: 'basalt', mountainHeight: 300, baseElevation: 20, baseFrequency: 1.4, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.5,
    reliefContrast: 0.9, strataBand: 22, strataStrength: 0.85, strataDip: 8, strataDipDirection: 120, hardnessContrast: 0.9,
    plateauStrength: 0.5, plateauHeight: 220, canyonDepth: 0, snowLine: 5000, vegetation: 0.9, mossiness: 0.8, seaLevel: 70, waterEnabled: 1,
    talusSoft: 35, talusHard: 84, droplets: 150000, screeDensity: 0.6, cliffBlockDensity: 0.7, torDensity: 0.3,
    peelStrength: 0.5, peelScale: 1.8, flakeStrength: 0.7, jointStrength: 0.4, jointScale: 2.5, sunElevation: 18, sunAzimuth: 290, turbidity: 3, fogDensity: 0.5,
  },
  'Limestone escarpment': {
    palette: 'limestone', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.2, ridgeSharpness: 1.7, peakPower: 1.2, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 30, strataStrength: 0.9, strataDip: 10, strataDipDirection: 300, hardnessContrast: 0.9,
    plateauStrength: 0.35, plateauHeight: 400, canyonDepth: 0, snowLine: 5000, vegetation: 0.75, mossiness: 0.5, seaLevel: 0, waterEnabled: 0,
    talusSoft: 33, talusHard: 82, droplets: 170000, screeDensity: 0.8, cliffBlockDensity: 0.8, torDensity: 0.4,
    peelStrength: 0.55, peelScale: 2.4, flakeStrength: 0.5, jointStrength: 0.35, sunElevation: 28, sunAzimuth: 160, turbidity: 4,
  },
};

export const palettes = {
  granite:   { name: 'Granite',   rockA: '#b3b1ae', rockB: '#94918f', rockC: '#c7c2ba', fresh: '#d6d3cd', oxide: '#ac947b' },
  sandstone: { name: 'Sandstone', rockA: '#e1b794', rockB: '#bd8f72', rockC: '#eed6b7', fresh: '#f3dec2', oxide: '#a8755a' },
  limestone: { name: 'Limestone', rockA: '#d9d3c7', rockB: '#b3aea4', rockC: '#e9e4d9', fresh: '#f1ede4', oxide: '#baa080' },
  basalt:    { name: 'Basalt',    rockA: '#858588', rockB: '#616165', rockC: '#a09e9c', fresh: '#b1b0ae', oxide: '#a08068' },
  slate:     { name: 'Slate',     rockA: '#9498a0', rockB: '#6f7580', rockC: '#b0b3ba', fresh: '#c2c6ca', oxide: '#a48a75' },
};
export const paletteKeys = ['rockA', 'rockB', 'rockC', 'fresh', 'oxide'];

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
    id: 'relief', name: 'Cliff depth', type: 'Overhangs & ledges', stage: 'mesh', color: '#b9a3d6',
    cards: [
      { title: 'Face displacement', controls: [
        ['overhang', 'Caprock overhang', 0, 8, 0.25, 'm', 'Hard beds pushed out of the face, soft beds recessed — real overhangs a heightmap cannot hold (capped at ~85% of the grid cell)'],
        ['buttress', 'Buttress bulge', 0, 1, 0.05, '', 'Large-scale swelling of the faces into ribs and alcoves'],
        ['ledgeNoise', 'Ledge irregularity', 0, 1, 0.05, '', 'Breaks ledges into blocks and notches'],
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
        ['rockBedding', 'Bed alignment', 0, 1, 0.05, '', 'Rotate blocks to follow the strata dip and snap them into bed rows'],
        ['rockProtrude', 'Face protrusion', 0, 1, 0.05, '', 'How far cliff blocks stand out of the face'],
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
    id: 'material', name: 'Rock material', type: 'Beds, grain & staining', stage: 'live', color: '#cab281',
    cards: [
      { title: 'Rock type', kind: 'palette' },
      { title: 'Colours', controls: [
        ['rockA', 'Base rock', 0, 0, 0, 'color', 'Dominant bed colour'],
        ['rockB', 'Dark beds', 0, 0, 0, 'color', 'Recessive / shaly beds'],
        ['rockC', 'Pale beds', 0, 0, 0, 'color', 'Caprock and resistant beds'],
        ['fresh', 'Fresh break', 0, 0, 0, 'color', 'Unweathered rock exposed by spalling'],
        ['oxide', 'Oxide stain', 0, 0, 0, 'color', 'Iron-oxide pocket colour'],
      ] },
      { title: 'Strata', controls: [
        ['strataOn', 'Enable strata', 0, 1, 1, '', ''],
        ['strataContrast', 'Bed contrast', 0, 1, 0.05, '', 'Tonal difference between beds'],
        ['strataBandScale', 'Band scale', 0.25, 4, 0.05, '×', 'Colour band thickness relative to the terrain bed thickness'],
        ['laminae', 'Laminae', 0, 1, 0.05, '', 'Thin sub-bands inside each bed'],
        ['bedGradient', 'Bed shading', 0, 1, 0.05, '', 'Darkening towards the base of each bed'],
        ['seamStrength', 'Seam darkness', 0, 1, 0.05, '', 'Dark lines along bedding planes'],
        ['seamWidth', 'Seam width', 0.01, 0.3, 0.01, '', 'Fraction of the bed taken by the seam'],
        ['hardnessTint', 'Caprock tint', 0, 1, 0.05, '', 'Hard beds paler, soft beds warmer'],
      ] },
      { title: 'Grain', controls: [
        ['grainOn', 'Enable grain', 0, 1, 1, '', ''],
        ['grainSize', 'Grain size', 0.1, 3, 0.05, 'm', 'Scale of the aggregate bump'],
        ['grainStrength', 'Grain relief', 0, 1, 0.05, '', 'Bump strength of the grain'],
        ['grainContrast', 'Grain mottle', 0, 1, 0.05, '', 'Colour mottling from the grain field'],
        ['grainFineness', 'Fine grain', 0, 1, 0.05, '', 'Scale of the secondary fine grain'],
      ] },
      { title: 'Oxide & cavity', controls: [
        ['oxideOn', 'Enable oxide', 0, 1, 1, '', ''],
        ['oxideAmount', 'Oxide amount', 0, 1, 0.05, '', 'Coverage of iron-oxide pockets'],
        ['oxideScale', 'Oxide scale', 0.5, 30, 0.5, 'm', 'Size of the staining pockets'],
        ['cavityStrength', 'Cavity shading', 0, 1, 0.05, '', 'Darken concavities, lighten convex edges'],
      ] },
      { title: 'Material response', controls: [
        ['bumpScale', 'Bump strength', 0, 2, 0.05, '', 'Global multiplier on all normal detail'],
        ['baseRoughness', 'Base roughness', 0.3, 1, 0.05, '', ''],
      ] },
    ],
  },
  {
    id: 'flakes', name: 'Mineral flakes', type: 'Cellular plates', stage: 'live', color: '#d8c38a',
    cards: [
      { title: 'Flakes', controls: [
        ['flakesOn', 'Enable flakes', 0, 1, 1, '', ''],
        ['flakeStrength', 'Flake coverage', 0, 1, 0.05, '', 'Three stacked layers of angular mineral plates — basal chips, laminae, fine flecks'],
        ['flakeScale', 'Flake size', 0.05, 8, 0.05, 'm', 'Size of the mid layer; chips are 1.65× and flecks 0.2× this'],
        ['flakeLayers', 'Layers', 1, 3, 1, '', 'Chips only · + laminae · + flecks'],
        ['flakeDensity', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
      ] },
      { title: 'Plate look', controls: [
        ['flakeColor', 'Colour variation', 0, 1, 0.05, '', 'Geology tint → independent hue per plate'],
        ['flakeRelief', 'Raised plates', 0, 1, 0.05, '', 'Fraction of plates with tilted / bevelled normals'],
        ['flakeEdge', 'Rim highlight', 0, 1, 0.05, '', 'Bright bevel along plate edges'],
        ['flakeSheen', 'Plate sheen', 0, 1, 0.05, '', 'Lower roughness on plates so they catch light'],
      ] },
    ],
  },
  {
    id: 'exfoliation', name: 'Exfoliation & joints', type: 'Peeling sheets & fractures', stage: 'live', color: '#c9a37c',
    cards: [
      { title: 'Peeling sheets', controls: [
        ['peelOn', 'Enable peeling', 0, 1, 1, '', ''],
        ['peelStrength', 'Peel strength', 0, 1, 0.05, '', 'Onion-skin sheets lifting and spalling off exposed rock'],
        ['peelCoverage', 'Coverage', 0, 1, 0.05, '', 'Fraction of the rock covered by peeling patches'],
        ['peelScale', 'Sheet size', 0.5, 12, 0.1, 'm', ''],
        ['peelThickness', 'Sheet thickness', 0, 2, 0.05, '', 'Relief of the sheet edges in the normal'],
        ['peelLift', 'Edge lift', 0, 1, 0.05, '', 'How far sheet edges curl away from the rock'],
        ['peelSmall', 'Small sheets', 0, 1, 0.05, '', 'Secondary generation of smaller spalls'],
        ['peelBedding', 'Follow bedding', 0, 1, 0.05, '', 'Stretch sheets horizontally along the beds'],
        ['peelFresh', 'Fresh contrast', 0, 1, 0.05, '', 'How pale the freshly exposed rock is'],
        ['peelOcclusion', 'Shadow depth', 0, 1, 0.05, '', 'Darkening under lifted edges and in cracks'],
      ] },
      { title: 'Joint network', controls: [
        ['jointsOn', 'Enable joints', 0, 1, 1, '', ''],
        ['jointStrength', 'Joint darkness', 0, 1, 0.05, '', 'Dark fracture lines across exposed rock'],
        ['jointScale', 'Block size', 0.5, 20, 0.1, 'm', 'Average spacing of the fractures'],
        ['jointWidth', 'Line width', 0.01, 0.2, 0.005, '', 'Width relative to block size'],
        ['jointDepth', 'Groove depth', 0, 1, 0.05, '', 'Relief of the fracture in the normal'],
        ['jointStretch', 'Bedding bias', 0, 1, 0.05, '', 'Elongate blocks along the beds'],
      ] },
    ],
  },
  {
    id: 'cover', name: 'Ground cover', type: 'Runoff, gravel, plants & snow', stage: 'live', color: '#9fb57a',
    cards: [
      { title: 'Runoff', controls: [
        ['runoffOn', 'Enable runoff', 0, 1, 1, '', ''],
        ['wetness', 'Wetness', 0, 1, 0.05, '', 'Dark wet staining along drainage'],
        ['streakAmount', 'Face streaks', 0, 1, 0.05, '', 'Vertical water streaks down the faces'],
        ['streakScale', 'Streak scale', 1, 30, 0.5, 'm', 'Spacing of the streaks'],
      ] },
      { title: 'Gravel', controls: [
        ['gravelOn', 'Enable gravel', 0, 1, 1, '', ''],
        ['gravelAmount', 'Gravel on scree', 0, 1, 0.05, '', 'Fine debris texture where sediment collected'],
        ['gravelScale', 'Gravel scale', 0.1, 3, 0.05, 'm', ''],
        ['gravelColor', 'Gravel colour', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Vegetation', controls: [
        ['vegOn', 'Enable vegetation', 0, 1, 1, '', ''],
        ['vegetation', 'Vegetation', 0, 1, 0.05, '', 'Grass and scrub on gentle ground'],
        ['vegSlope', 'Slope limit', 15, 70, 1, '°', 'Steeper ground stays bare'],
        ['vegScale', 'Patch scale', 4, 80, 1, 'm', ''],
        ['vegPatchiness', 'Patchiness', 0, 1, 0.05, '', 'Broken patches vs. continuous cover'],
        ['dryness', 'Dry grass', 0, 1, 0.05, '', 'Mix in dry straw patches'],
        ['grassA', 'Grass', 0, 0, 0, 'color', ''],
        ['grassB', 'Grass · pale', 0, 0, 0, 'color', ''],
        ['dryColor', 'Dry grass', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Moss', controls: [
        ['mossOn', 'Enable moss', 0, 1, 1, '', ''],
        ['mossiness', 'Moss on rock', 0, 1, 0.05, '', 'Lichen and moss in sheltered cracks'],
        ['mossScale', 'Moss scale', 0.5, 20, 0.5, 'm', ''],
        ['mossColor', 'Moss colour', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Snow', controls: [
        ['snowOn', 'Enable snow', 0, 1, 1, '', ''],
        ['snowLine', 'Snow line', 0, 5000, 10, 'm', 'Snow settles above this elevation'],
        ['snowSlope', 'Slope limit', 10, 80, 1, '°', 'Steeper faces shed snow'],
        ['snowSoftness', 'Transition', 0.1, 3, 0.1, '', 'Width of the snow-line band'],
        ['snowRoughness', 'Snow roughness', 0.3, 1, 0.05, '', ''],
        ['snowColor', 'Snow colour', 0, 0, 0, 'color', ''],
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

export const outlinerSections = [
  { label: 'TERRAIN', ids: ['landform', 'strata', 'relief', 'erosion'] },
  { label: 'DRESSING', ids: ['rocks', 'material', 'flakes', 'exfoliation', 'cover'] },
  { label: 'ENVIRONMENT', ids: ['sun', 'viewport'] },
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
