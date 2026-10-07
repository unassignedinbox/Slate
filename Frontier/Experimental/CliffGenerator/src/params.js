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
  // Rocks (plain scatter)
  rocksEnabled: 1,
  rockSeed: 7,
  rockDensity: 0.35,
  rockSlopeMin: 0,          // [°]
  rockSlopeMax: 55,         // [°]
  rockClustering: 0.5,
  rockClusterScale: 80,     // [m]
  rockTilt: 0.7,
  rockSizeMin: 0.8,         // [m]
  rockSizeMax: 9,           // [m]
  rockAngularity: 0.7,
  rockEmbed: 0.45,
  pebblesOn: 1,
  pebbleDensity: 0.45,
  pebbleSize: 0.45,         // [m]
  // Cliff depth (mesh displacement)
  overhang: 3.5,            // [m]
  buttress: 0.5,
  ledgeNoise: 0.6,
  meshSubdivision: 2,
  detailRelief: 0.5,        // [m]
  detailScale: 7,           // [m]
  detailCliffBias: 0.8,
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
  // Mineral flakes — three layers, each with its own colour / size / height / crystals
  flakesOn: 1,
  flakeStrength: 0.7,
  flakeSheen: 0.35,
  flakeEdge: 0.3,
  flakeOxide: 0.5,
  flakeSparkle: 0.6,
  flakeOn1: 1, flakeColor1: '#9d9893', flakeSize1: 1.6, flakeDensity1: 0.7, flakeHeight1: 6, flakeCrystal1: 0.0, flakeVar1: 0.5, flakeShape1: 0.2, flakeReveal1: 0.0,
  flakeOn2: 1, flakeColor2: '#bdb4a7', flakeSize2: 0.55, flakeDensity2: 0.75, flakeHeight2: 4, flakeCrystal2: 0.08, flakeVar2: 0.5, flakeShape2: 0.1, flakeReveal2: 0.3,
  flakeOn3: 1, flakeColor3: '#d9d6cf', flakeSize3: 0.18, flakeDensity3: 0.6, flakeHeight3: 2, flakeCrystal3: 0.3, flakeVar3: 0.6, flakeShape3: 0.0, flakeReveal3: 0.0,
  // Spalling (peel)
  peelOn: 1,
  peelStrength: 0.6,
  peelScale: 1.6,           // [m]
  peelCoverage: 0.3,
  peelThickness: 0.025,     // [m]
  peelSecond: 0.6,
  peelPits: 0.5,
  peelBedding: 0.4,
  peelFresh: 0.7,
  peelShadow: 0.6,
  // Ground cover
  runoffOn: 1,
  wetness: 0.6,
  streakScale: 6,           // [m]
  streakAmount: 1,
  gravelOn: 1,
  gravelAmount: 0.8,
  gravelScale: 0.14,        // [m]
  gravelRelief: 0.7,
  gravelVariation: 0.6,
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
  // Drawn features (roads · rivers · lakes)
  features: { roads: [], rivers: [], lakes: [] },
  showFeatureLines: 1,
  roadWidth: 6,             // [m]
  roadShoulder: 2,          // [m]
  roadSmoothing: 60,        // [m]
  roadCut: 60,              // [°]
  roadFill: 34,             // [°]
  roadColor: '#5f5b55',
  roadShading: 1,
  riverWidth: 14,           // [m]
  riverDepth: 4,            // [m]
  riverBank: 35,            // [°]
  riverMaxBank: 30,         // [m]
  riverMeander: 0.4,
  riverErosion: 0.6,
  riverWater: 1,
  riverWaterDepth: 1.2,     // [m]
  lakeDepth: 6,             // [m]
  lakeLevelOffset: 6,       // [m]
  lakeWater: 1,
  // Water
  waterColor: '#15303c',
  waterOpacity: 0.9,
  shoreWet: 0.7,
  bedShading: 1,
  siltColor: '#b9ad94',
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
  debugView: 0,
};

export const presets = {
  'Alpine granite': {
    palette: 'granite', mountainHeight: 560, baseFrequency: 1.7, ridgeSharpness: 2.2, peakPower: 1.4, warpStrength: 0.6,
    strataBand: 26, strataStrength: 0.6, strataDip: 6, hardnessContrast: 0.7, plateauStrength: 0, canyonDepth: 0,
    snowLine: 430, vegetation: 0.6, seaLevel: 0, waterEnabled: 1, talusSoft: 34, talusHard: 80, droplets: 180000, peelStrength: 0.45, peelCoverage: 0.3, flakeStrength: 0.65,
  },
  'Sandstone mesa': {
    palette: 'sandstone', mountainHeight: 320, baseElevation: 60, baseFrequency: 1.3, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.45,
    strataBand: 18, strataStrength: 1.0, strataDip: 2, hardnessContrast: 1.0, plateauStrength: 0.85, plateauHeight: 300,
    canyonDepth: 0, snowLine: 5000, vegetation: 0.15, seaLevel: -100, waterEnabled: 0, talusSoft: 30, talusHard: 86,
    droplets: 140000, erodeSpeed: 0.3, peelStrength: 0.7, peelScale: 3.0, peelCoverage: 0.45, flakeStrength: 0.4,
    sunElevation: 32, sunAzimuth: 240, turbidity: 6,
  },
  'Canyon': {
    palette: 'sandstone', mountainHeight: 260, baseElevation: 240, baseFrequency: 1.1, ridgeSharpness: 1.2, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 420, canyonDepth: 380, canyonWidth: 420,
    strataBand: 16, strataStrength: 1.0, strataDip: 1.5, hardnessContrast: 1.0, snowLine: 5000, vegetation: 0.1, seaLevel: -20, waterEnabled: 1,
    talusSoft: 31, talusHard: 86, droplets: 160000,
    peelStrength: 0.7, peelScale: 3.2, peelCoverage: 0.45, flakeStrength: 0.4, sunElevation: 38, sunAzimuth: 200, turbidity: 5,
  },
  'Sea cliffs': {
    palette: 'basalt', mountainHeight: 300, baseElevation: 20, baseFrequency: 1.4, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.5,
    reliefContrast: 0.9, strataBand: 22, strataStrength: 0.85, strataDip: 8, strataDipDirection: 120, hardnessContrast: 0.9,
    plateauStrength: 0.5, plateauHeight: 220, canyonDepth: 0, snowLine: 5000, vegetation: 0.9, mossiness: 0.8, seaLevel: 70, waterEnabled: 1,
    talusSoft: 35, talusHard: 84, droplets: 150000,
    peelStrength: 0.5, peelScale: 1.8, flakeStrength: 0.7, sunElevation: 18, sunAzimuth: 290, turbidity: 3, fogDensity: 0.5,
  },
  'Limestone escarpment': {
    palette: 'limestone', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.2, ridgeSharpness: 1.7, peakPower: 1.2, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 30, strataStrength: 0.9, strataDip: 10, strataDipDirection: 300, hardnessContrast: 0.9,
    plateauStrength: 0.35, plateauHeight: 400, canyonDepth: 0, snowLine: 5000, vegetation: 0.75, mossiness: 0.5, seaLevel: 0, waterEnabled: 0,
    talusSoft: 33, talusHard: 82, droplets: 170000,
    peelStrength: 0.55, peelScale: 2.4, flakeStrength: 0.5, sunElevation: 28, sunAzimuth: 160, turbidity: 4,
  },
};

Object.assign(presets, {
  'Fjord': {
    palette: 'slate', mountainHeight: 720, baseElevation: -140, baseFrequency: 1.1, ridgeSharpness: 2.6, peakPower: 1.5, warpStrength: 0.7,
    reliefContrast: 0.95, strataBand: 40, strataStrength: 0.4, strataDip: 8, hardnessContrast: 0.5, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 520, vegetation: 0.5, mossiness: 0.7, seaLevel: 0, waterEnabled: 1, talusSoft: 36, talusHard: 84, droplets: 160000,
    rockDensity: 0.3, peelStrength: 0.35, sunElevation: 20, sunAzimuth: 300, turbidity: 3, fogDensity: 0.55,
  },
  'Badlands': {
    palette: 'sandstone', mountainHeight: 180, baseElevation: 80, baseFrequency: 2.6, ridgeSharpness: 1.3, peakPower: 0.9, warpStrength: 0.5,
    reliefFrequency: 2.2, reliefContrast: 0.5, strataBand: 9, strataStrength: 1, strataDip: 1, hardnessContrast: 0.9, plateauStrength: 0.6, plateauHeight: 220,
    canyonDepth: 0, snowOn: 0, vegetation: 0.05, mossiness: 0.1, waterEnabled: 0, seaLevel: -100, droplets: 320000, erodeSpeed: 0.6, sedimentCapacity: 7, evaporation: 0.01,
    talusSoft: 32, talusHard: 80, rockDensity: 0.15, oxideAmount: 0.8, peelStrength: 0.3, sunElevation: 40, sunAzimuth: 215, turbidity: 7, fogDensity: 0.25,
  },
  'Dolomite towers': {
    palette: 'limestone', mountainHeight: 650, baseElevation: 120, baseFrequency: 2.0, ridgeSharpness: 3.2, peakPower: 1.9, warpStrength: 0.45,
    reliefContrast: 1, strataBand: 34, strataStrength: 0.9, strataDip: 3, hardnessContrast: 1, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 560, vegetation: 0.7, mossiness: 0.3, waterEnabled: 0, seaLevel: -100, talusSoft: 35, talusHard: 88, droplets: 150000,
    overhang: 5, rockDensity: 0.35, sunElevation: 30, sunAzimuth: 190, turbidity: 4, fogDensity: 0.3,
  },
  'Desert buttes': {
    palette: 'sandstone', mountainHeight: 240, baseElevation: 40, baseFrequency: 1.0, ridgeSharpness: 1.2, peakPower: 1.6, warpStrength: 0.3,
    reliefFrequency: 1.8, reliefContrast: 1, plateauStrength: 1, plateauHeight: 230, canyonDepth: 0, strataBand: 14, strataStrength: 1, hardnessContrast: 1,
    snowOn: 0, vegetation: 0.03, mossiness: 0, waterEnabled: 0, seaLevel: -100, talusSoft: 31, talusHard: 88, droplets: 120000, thermalIterations: 40,
    rockDensity: 0.4, oxideAmount: 0.7, sunElevation: 48, sunAzimuth: 230, turbidity: 8, fogDensity: 0.2,
  },
  'Volcanic island': {
    palette: 'basalt', mountainHeight: 520, baseElevation: -90, baseFrequency: 0.8, ridgeSharpness: 1.5, peakPower: 1.8, warpStrength: 0.5,
    reliefFrequency: 0.8, reliefContrast: 1, strataBand: 22, strataStrength: 0.5, hardnessContrast: 0.6, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.9, mossiness: 0.8, seaLevel: 0, waterEnabled: 1, droplets: 240000, erodeSpeed: 0.45, talusSoft: 33, talusHard: 80,
    rockDensity: 0.3, fogDensity: 0.4, turbidity: 5, sunElevation: 35, sunAzimuth: 120,
  },
  'Highland glens': {
    palette: 'granite', mountainHeight: 380, baseElevation: 20, baseFrequency: 1.3, ridgeSharpness: 1.6, peakPower: 1.1, warpStrength: 0.8,
    reliefContrast: 0.7, strataBand: 30, strataStrength: 0.35, hardnessContrast: 0.5, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.95, mossiness: 0.8, dryness: 0.6, seaLevel: -10, waterEnabled: 1, droplets: 220000, talusSoft: 34, talusHard: 78,
    rockDensity: 0.5, peelStrength: 0.3, sunElevation: 22, sunAzimuth: 250, turbidity: 4, fogDensity: 0.5,
  },
  'Boulder field': {
    palette: 'granite', mountainHeight: 420, baseElevation: 30, baseFrequency: 1.5, ridgeSharpness: 1.4, peakPower: 1.0, warpStrength: 0.7,
    reliefContrast: 0.6, strataBand: 36, strataStrength: 0.3, hardnessContrast: 0.4, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.25, mossiness: 0.5, dryness: 0.7, waterEnabled: 0, seaLevel: -100, droplets: 200000, thermalIterations: 40, talusSoft: 36, talusHard: 76,
    rockDensity: 0.95, rockSlopeMax: 50, rockClustering: 0.35, rockSizeMin: 1.5, rockSizeMax: 16, rockEmbed: 0.4, pebbleDensity: 0.7,
    peelStrength: 0.4, sunElevation: 30, sunAzimuth: 225, turbidity: 4, fogDensity: 0.25,
  },
  'Scree slopes': {
    palette: 'slate', mountainHeight: 600, baseElevation: 40, baseFrequency: 1.4, ridgeSharpness: 2.6, peakPower: 1.5, warpStrength: 0.55,
    reliefContrast: 0.9, strataBand: 24, strataStrength: 0.6, strataDip: 12, hardnessContrast: 0.8, plateauStrength: 0, canyonDepth: 0,
    snowOn: 1, snowLine: 620, vegetation: 0.15, mossiness: 0.3, waterEnabled: 0, seaLevel: -100, droplets: 160000, thermalIterations: 60, thermalRate: 0.7, talusSoft: 37, talusHard: 84,
    rockDensity: 0.8, rockSlopeMin: 15, rockSlopeMax: 48, rockClustering: 0.2, rockSizeMin: 0.5, rockSizeMax: 6, pebbleDensity: 0.9, pebbleSize: 0.6, gravelAmount: 1,
    peelStrength: 0.5, sunElevation: 26, sunAzimuth: 200, turbidity: 3, fogDensity: 0.35,
  },
  'Granite domes': {
    palette: 'granite', mountainHeight: 520, baseElevation: 60, baseFrequency: 0.9, ridgeSharpness: 1.1, peakPower: 1.7, warpStrength: 0.35,
    reliefFrequency: 1.2, reliefContrast: 1, strataBand: 60, strataStrength: 0.15, hardnessContrast: 0.3, plateauStrength: 0.2, plateauHeight: 520, canyonDepth: 0,
    snowOn: 0, vegetation: 0.35, mossiness: 0.2, waterEnabled: 0, seaLevel: -100, droplets: 90000, erodeSpeed: 0.2, thermalIterations: 10, talusSoft: 38, talusHard: 85,
    rockDensity: 0.5, rockSlopeMax: 35, rockClustering: 0.6, rockSizeMin: 2, rockSizeMax: 22, rockEmbed: 0.55, pebbleDensity: 0.3,
    peelStrength: 0.85, peelCoverage: 0.45, peelScale: 4, peelThickness: 0.05, flakeStrength: 0.8, sunElevation: 42, sunAzimuth: 240, turbidity: 5, fogDensity: 0.15,
  },
  'Rocky coast': {
    palette: 'basalt', mountainHeight: 220, baseElevation: -40, baseFrequency: 1.8, ridgeSharpness: 1.8, peakPower: 1.2, warpStrength: 0.6,
    reliefContrast: 0.8, strataBand: 16, strataStrength: 0.8, strataDip: 6, hardnessContrast: 0.9, plateauStrength: 0.4, plateauHeight: 140, canyonDepth: 0,
    snowOn: 0, vegetation: 0.5, mossiness: 0.7, seaLevel: 0, waterEnabled: 1, droplets: 180000, talusSoft: 34, talusHard: 86,
    rockDensity: 0.9, rockSlopeMax: 60, rockClustering: 0.4, rockSizeMin: 0.8, rockSizeMax: 12, pebbleDensity: 0.9, pebbleSize: 0.5, gravelAmount: 1,
    peelStrength: 0.4, sunElevation: 20, sunAzimuth: 280, turbidity: 4, fogDensity: 0.45, wetness: 0.9,
  },
  'Talus canyon': {
    palette: 'sandstone', mountainHeight: 300, baseElevation: 220, baseFrequency: 1.1, ridgeSharpness: 1.3, peakPower: 0.9, warpStrength: 0.4,
    plateauStrength: 0.9, plateauHeight: 440, canyonDepth: 360, canyonWidth: 520, strataBand: 20, strataStrength: 1, strataDip: 2, hardnessContrast: 1,
    snowOn: 0, vegetation: 0.08, mossiness: 0.05, seaLevel: -20, waterEnabled: 0, droplets: 170000, thermalIterations: 50, thermalRate: 0.7, talusSoft: 33, talusHard: 87,
    rockDensity: 0.9, rockSlopeMin: 10, rockSlopeMax: 55, rockClustering: 0.3, rockSizeMin: 0.8, rockSizeMax: 14, pebbleDensity: 0.8, pebbleSize: 0.6, gravelAmount: 1,
    peelStrength: 0.6, peelScale: 3, oxideAmount: 0.7, sunElevation: 40, sunAzimuth: 205, turbidity: 6, fogDensity: 0.2,
  },
  'Karst pinnacles': {
    palette: 'limestone', mountainHeight: 300, baseElevation: 30, baseFrequency: 3.2, ridgeSharpness: 3.0, peakPower: 1.7, warpStrength: 0.4,
    reliefFrequency: 2.4, reliefContrast: 0.9, strataBand: 20, strataStrength: 0.5, hardnessContrast: 0.8, plateauStrength: 0, canyonDepth: 0,
    snowOn: 0, vegetation: 0.85, mossiness: 0.9, waterEnabled: 1, seaLevel: 0, droplets: 200000, talusSoft: 36, talusHard: 88,
    overhang: 4, rockDensity: 0.25, sunElevation: 45, sunAzimuth: 170, turbidity: 6, fogDensity: 0.45,
  },
});

export const palettes = {
  granite:   { name: 'Granite',   rockA: '#b3b1ae', rockB: '#94918f', rockC: '#c7c2ba', fresh: '#d6d3cd', oxide: '#ac947b', flakeColor1: '#9d9893', flakeColor2: '#c9bfb3', flakeColor3: '#e4e0d8', gravelColor: '#9a938a' },
  sandstone: { name: 'Sandstone', rockA: '#e1b794', rockB: '#bd8f72', rockC: '#eed6b7', fresh: '#f3dec2', oxide: '#a8755a', flakeColor1: '#c9a07c', flakeColor2: '#e5c8a4', flakeColor3: '#f2e3c9', gravelColor: '#c7a383' },
  limestone: { name: 'Limestone', rockA: '#d9d3c7', rockB: '#b3aea4', rockC: '#e9e4d9', fresh: '#f1ede4', oxide: '#baa080', flakeColor1: '#c4bdae', flakeColor2: '#e2dccf', flakeColor3: '#f3f0e8', gravelColor: '#bdb6a8' },
  basalt:    { name: 'Basalt',    rockA: '#858588', rockB: '#616165', rockC: '#a09e9c', fresh: '#b1b0ae', oxide: '#a08068', flakeColor1: '#6c6c70', flakeColor2: '#8e8d8a', flakeColor3: '#b5b2ad', gravelColor: '#7a7a7c' },
  slate:     { name: 'Slate',     rockA: '#9498a0', rockB: '#6f7580', rockC: '#b0b3ba', fresh: '#c2c6ca', oxide: '#a48a75', flakeColor1: '#767b86', flakeColor2: '#a3a7ae', flakeColor3: '#cfd2d6', gravelColor: '#8a8e96' },
};
export const paletteKeys = ['rockA', 'rockB', 'rockC', 'fresh', 'oxide', 'flakeColor1', 'flakeColor2', 'flakeColor3', 'gravelColor'];

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
        ['resolution', 'Resolution', 128, 2048, 128, 'px', 'Heightfield side in samples. 512 ≈ 2 s, 1024 ≈ 15 s, 2048 ≈ 1 min and a 4 M-vertex mesh'],
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
    id: 'relief', name: 'Cliff depth', type: 'Overhangs, ledges & mesh detail', stage: 'mesh', color: '#b9a3d6',
    cards: [
      { title: 'Face displacement', controls: [
        ['overhang', 'Caprock overhang', 0, 8, 0.25, 'm', 'Hard beds pushed out of the face, soft beds recessed — real overhangs a heightmap cannot hold (capped at ~85% of the grid cell)'],
        ['buttress', 'Buttress bulge', 0, 1, 0.05, '', 'Large-scale swelling of the faces into ribs and alcoves'],
        ['ledgeNoise', 'Ledge irregularity', 0, 1, 0.05, '', 'Breaks ledges into blocks and notches'],
      ] },
      { title: 'Mesh detail', controls: [
        ['meshSubdivision', 'Mesh subdivision', 1, 4, 1, '×', 'Vertices per heightfield cell (bicubic). Mesh side is capped at 2049 vertices'],
        ['detailRelief', 'Detail relief', 0, 3, 0.05, 'm', 'Fine bumps and knobs pushed along the surface normal — independent of the heightfield'],
        ['detailScale', 'Detail scale', 1, 40, 0.5, 'm', ''],
        ['detailCliffBias', 'Cliff bias', 0, 1, 0.05, '', '0 = everywhere, 1 = steep rock only'],
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
    id: 'features', name: 'Roads, rivers & lakes', type: 'Drawn features', stage: 'mesh', color: '#7fb3d5',
    cards: [
      { title: 'Draw', kind: 'draw' },
      { title: 'Features', kind: 'featureList' },
      { title: 'Rivers', stage: 'terrain', controls: [
        ['riverWidth', 'Channel width', 2, 120, 1, 'm', 'Width of the carved channel'],
        ['riverDepth', 'Channel depth', 0.5, 40, 0.5, 'm', 'Incision below the smoothed valley profile'],
        ['riverBank', 'Bank angle', 10, 80, 1, '°', 'Slope of the cut banks'],
        ['riverMaxBank', 'Bank height', 2, 200, 1, 'm', 'Banks are shaped up to this height; higher ground is cut as a gorge with steep walls'],
        ['riverMeander', 'Meander', 0, 1, 0.05, '', 'Lateral sinuosity added to the drawn line'],
        ['riverErosion', 'Water erosion', 0, 1, 0.05, '', 'Share of erosion droplets that start in the river and how much water they carry — carves the bed and drains the slopes into it. Rivers flow from their higher end'],
        ['riverWaterDepth', 'Water depth', 0.2, 10, 0.1, 'm', 'Depth of water standing in the channel'],
      ] },
      { title: 'Roads', controls: [
        ['roadWidth', 'Road width', 2, 30, 0.5, 'm', '6 m ≈ two-lane; 3.5 m ≈ track'],
        ['roadShoulder', 'Shoulder', 0, 10, 0.5, 'm', 'Bare verge either side'],
        ['roadSmoothing', 'Grade smoothing', 10, 300, 5, 'm', 'Length over which the road profile is averaged'],
        ['roadCut', 'Cut slope', 30, 85, 1, '°', 'Rock cut above the road'],
        ['roadFill', 'Fill slope', 20, 60, 1, '°', 'Embankment below the road'],
        ['roadShading', 'Road surface', 0, 1, 1, '', 'Shade the carriageway (off = bare carved ground)'],
        ['roadColor', 'Road colour', 0, 0, 0, 'color', ''],
      ] },
      { title: 'Lakes', controls: [
        ['lakeLevelOffset', 'Level above click', 0, 60, 1, 'm', 'New lakes fill to the clicked ground height plus this'],
        ['lakeDepth', 'Bed depth', 1, 40, 0.5, 'm', 'Flat silt bed this far below the level'],
      ] },
      { title: 'Water in channels', controls: [
        ['riverWater', 'Water in rivers', 0, 1, 1, '', 'Off = dried river beds (cobbles and silt)'],
        ['lakeWater', 'Water in lakes', 0, 1, 1, '', 'Off = dried lake beds'],
      ] },
      { title: 'Display', controls: [
        ['showFeatureLines', 'Show feature lines', 0, 1, 1, '', 'Guide lines over roads, rivers and lake markers'],
      ] },
    ],
  },
  {
    id: 'rocks', name: 'Rocks', type: 'Plain scatter', stage: 'rocks', color: '#a8bbeb',
    cards: [
      { title: 'Scatter', controls: [
        ['rocksEnabled', 'Enable rocks', 0, 1, 1, '', ''],
        ['rockDensity', 'Density', 0, 1, 0.05, '', 'How many rocks are scattered'],
        ['rockSlopeMin', 'Slope · min', 0, 80, 1, '°', 'No rocks on ground gentler than this'],
        ['rockSlopeMax', 'Slope · max', 5, 89, 1, '°', 'No rocks on ground steeper than this'],
        ['rockClustering', 'Clustering', 0, 1, 0.05, '', 'Even spread → grouped into patches'],
        ['rockClusterScale', 'Cluster size', 10, 400, 5, 'm', ''],
        ['rockTilt', 'Follow slope', 0, 1, 0.05, '', 'Upright → aligned to the ground normal'],
      ] },
      { title: 'Gravel stones', controls: [
        ['pebblesOn', 'Enable stones', 0, 1, 1, '', 'Real small stone meshes on scree aprons and river beds, on top of the pebble shading'],
        ['pebbleDensity', 'Stone density', 0, 1, 0.05, '', 'Up to 40 000 instances'],
        ['pebbleSize', 'Largest stone', 0.1, 2, 0.05, 'm', ''],
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
    id: 'flakes', name: 'Mineral flakes', type: 'Layered grain', stage: 'live', color: '#d8c38a',
    cards: [
      { title: 'Flakes', controls: [
        ['flakesOn', 'Enable flakes', 0, 1, 1, '', ''],
        ['flakeStrength', 'Coverage', 0, 1, 0.05, '', 'Overall amount of plates on exposed rock'],
        ['flakeEdge', 'Rim highlight', 0, 1, 0.05, '', 'Bright bevel along plate edges'],
        ['flakeSheen', 'Plate sheen', 0, 1, 0.05, '', 'Lower roughness on plates so they catch light'],
        ['flakeSparkle', 'Crystal glitter', 0, 2, 0.05, '', 'Sun glints on crystal plates (view dependent)'],
        ['flakeOxide', 'Oxidise with runoff', 0, 1, 0.05, '', 'Plates take the oxide colour where water flows and in oxide pockets — the erosion channels drive the tint'],
      ] },
      { title: 'Layer 1 · base chips', controls: [
        ['flakeOn1', 'Enable layer', 0, 1, 1, '', 'Largest plates at the bottom of the stack'],
        ['flakeColor1', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize1', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity1', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight1', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar1', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape1', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal1', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal1', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
      { title: 'Layer 2 · laminae', controls: [
        ['flakeOn2', 'Enable layer', 0, 1, 1, '', 'Mid-size plates over the chips'],
        ['flakeColor2', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize2', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity2', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight2', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar2', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape2', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal2', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal2', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
      { title: 'Layer 3 · fine grain', controls: [
        ['flakeOn3', 'Enable layer', 0, 1, 1, '', 'Smallest plates on top; the usual place for crystals'],
        ['flakeColor3', 'Layer colour', 0, 0, 0, 'color', ''],
        ['flakeSize3', 'Plate size', 0.03, 8, 0.01, 'm', ''],
        ['flakeDensity3', 'Density', 0.1, 1, 0.05, '', 'Fraction of cells that grow a plate'],
        ['flakeHeight3', 'Plate height', 0, 30, 0.5, 'mm', 'Tilt and rim bevel in the normal'],
        ['flakeVar3', 'Tint variation', 0, 1, 0.05, '', 'Per-plate lightness / warmth jitter around the layer colour'],
        ['flakeShape3', 'Shape', 0, 1, 0.05, '', 'Angular chips → rounded grains'],
        ['flakeCrystal3', 'Crystals', 0, 1, 0.05, '', 'Share of plates that are crystals: brighter, glossy, they glint in the sun'],
        ['flakeReveal3', 'Reveal by hardness', -1, 1, 0.05, '', '−1 only on soft / eroded beds · 0 everywhere · +1 only on hard caprock'],
      ] },
    ],
  },
  {
    id: 'exfoliation', name: 'Spalling', type: 'Sheets flaked off the face', stage: 'live', color: '#c9a37c',
    cards: [
      { title: 'Spalls', controls: [
        ['peelOn', 'Enable spalling', 0, 1, 1, '', 'Irregular patches where a thin sheet has flaked off: a shallow step with a bevelled rim, paler fresh rock inside'],
        ['peelStrength', 'Amount', 0, 1, 0.05, '', ''],
        ['peelCoverage', 'Coverage', 0, 1, 0.05, '', 'Share of the rock face that has spalled'],
        ['peelScale', 'Patch size', 0.2, 12, 0.1, 'm', ''],
        ['peelThickness', 'Sheet thickness', 0, 0.15, 0.005, 'm', 'Height of the step at the patch edge'],
        ['peelSecond', 'Small spalls', 0, 1, 0.05, '', 'Second generation of smaller patches stepping down inside and around the first'],
        ['peelPits', 'Weathering pits', 0, 1, 0.05, '', 'Sparse small holes'],
        ['peelBedding', 'Follow bedding', 0, 1, 0.05, '', 'Stretch patches horizontally along the beds'],
        ['peelFresh', 'Fresh contrast', 0, 1, 0.05, '', 'How pale the freshly exposed rock is'],
        ['peelShadow', 'Rim shadow', 0, 1, 0.05, '', 'Soft darkening in the bevel'],
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
        ['gravelScale', 'Stone size', 0.03, 1.5, 0.01, 'm', 'Largest pebbles; a second generation at 0.45× fills the gaps'],
        ['gravelRelief', 'Stone relief', 0, 1, 0.05, '', 'Dome normal on each stone'],
        ['gravelVariation', 'Stone variation', 0, 1, 0.05, '', 'Tone and warmth jitter per stone'],
        ['gravelColor', 'Stone colour', 0, 0, 0, 'color', 'Matrix between the stones is a mix of this and the silt colour'],
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
    ],
  },
  {
    id: 'water', name: 'Water', type: 'Sea level & water bodies', stage: 'live', color: '#5aa7c9',
    cards: [
      { title: 'Sea level', controls: [
        ['waterEnabled', 'Sea', 0, 1, 1, '', 'Global water plane'],
        ['seaLevel', 'Sea level', -200, 800, 1, 'm', 'Everything below this is flooded — live'],
      ] },
      { title: 'Appearance', controls: [
        ['waterColor', 'Water colour', 0, 0, 0, 'color', ''],
        ['waterOpacity', 'Opacity', 0.2, 1, 0.05, '', ''],
        ['shoreWet', 'Shoreline wetness', 0, 1, 0.05, '', 'Dark wet band just above the waterline'],
        ['bedShading', 'Bed shading', 0, 1, 1, '', 'Silt / cobble shading on river and lake beds'],
        ['siltColor', 'Silt colour', 0, 0, 0, 'color', ''],
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
      { title: 'Isolate layer', controls: [
        ['debugView', 'Show only', 0, 8, 1, 'enum', 'Off|Strata|Grain|Flakes|Spalls|Pebbles|Cover|Masks|Features'],
      ] },
      { title: 'Export', kind: 'export' },
    ],
  },
];

export const outlinerSections = [
  { label: 'TERRAIN', ids: ['landform', 'strata', 'relief', 'erosion', 'features'] },
  { label: 'DRESSING', ids: ['rocks', 'material', 'flakes', 'exfoliation', 'cover'] },
  { label: 'ENVIRONMENT', ids: ['sun', 'water', 'viewport'] },
];

export function paramsForStage(values, stage) {
  const keys = new Set();
  for (const g of groups) for (const c of g.cards) if ((c.stage || g.stage) === stage) for (const ctl of c.controls || []) keys.add(ctl[0]);
  const out = {};
  for (const k of keys) out[k] = values[k];
  return out;
}

export function stageOf(key) {
  for (const g of groups) for (const c of g.cards) for (const ctl of c.controls || []) if (ctl[0] === key) return c.stage || g.stage;
  if (key === 'palette') return 'live';
  if (key === 'features') return 'mesh';
  return 'terrain';
}
