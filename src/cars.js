/**
 * cars.js — vehicle data.
 *
 * Power/torque/redline/firing-order figures are published manufacturer or
 * manufacturer-derived numbers (see README → "Sources"). Gearbox ratios, final
 * drives, rotating inertia and the acoustic "tone" blocks are engineering
 * estimates chosen to reproduce each car's measured behaviour and recorded
 * exhaust note — they are labelled `estimated` where that is the case.
 */

const HP_TO_NM = (hp, rpm) => (hp * 7127) / rpm; // Nm

/* ------------------------------------------------------------------ engines */

const VR38DETT = {
  name: 'VR38DETT',
  layout: '3.8 L 60° V6, twin-turbo',
  displacement: 3799,
  cylinders: 6,
  aspiration: 'turbo',
  firingOrder: [1, 2, 3, 4, 5, 6],
  // 60° V6, three crank throws at 120° → even firing every 120°
  firingPhases: [0, 120, 240, 360, 480, 600],
  // hand-built exhaust runners are not perfectly equal — mild 3rd-order leakage
  cylinderWeights: [1.0, 0.94, 1.02, 0.97, 1.03, 0.95],
  idle: 800,
  redline: 7400,
  fuelCut: 7500,
  peakPower: 600,
  peakPowerRpm: 6800,
  peakTorque: 652,
  peakTorqueRpm: 3600,
  // Nm, full boost
  torqueCurve: [
    [1000, 180], [1500, 330], [2000, 480], [2500, 570], [3000, 620],
    [3600, 652], [4500, 650], [5500, 632], [6000, 622], [6800, 628],
    [7000, 600], [7400, 520], [7500, 480],
  ],
  inertia: 0.2, // kg·m² (estimated) — heavy crank + two IHI rotors
  maxBoost: 1.1, // bar (estimated, NISMO spec)
  boostRampRpm: [1700, 3400],
  boostTimeConstant: 0.85,
};

const M918_V8 = {
  name: 'Porsche 4.6 L V8 (RS Spyder derived)',
  layout: '4.6 L 90° flat-plane V8, naturally aspirated',
  displacement: 4593,
  cylinders: 8,
  aspiration: 'na',
  firingOrder: [1, 8, 4, 3, 6, 5, 7, 2],
  // 90° V8 on 180° crank pins → even firing every 90°
  firingPhases: [0, 90, 180, 270, 360, 450, 540, 630],
  cylinderWeights: [1.0, 1.0, 0.99, 1.01, 1.0, 1.0, 1.01, 0.99],
  idle: 950,
  redline: 9150,
  fuelCut: 9400,
  peakPower: 608,
  peakPowerRpm: 8700,
  peakTorque: 540,
  peakTorqueRpm: 6700,
  torqueCurve: [
    [1000, 130], [2000, 300], [3000, 400], [4000, 470], [5000, 510],
    [6000, 535], [6700, 540], [7500, 530], [8000, 515], [8500, 502],
    [8700, 498], [9000, 470], [9150, 430], [9400, 380],
  ],
  inertia: 0.11, // kg·m² (estimated) — titanium con-rods, race crank
};

const F140_FE = {
  name: 'Ferrari F140 FE',
  layout: '6.3 L 65° V12, naturally aspirated',
  displacement: 6262,
  cylinders: 12,
  aspiration: 'na',
  firingOrder: [1, 12, 5, 8, 3, 10, 6, 7, 2, 11, 4, 9],
  // 65° V12 on six 60° throws → even firing every 60°
  firingPhases: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660],
  cylinderWeights: [1.0, 1.01, 0.99, 1.0, 1.01, 1.0, 0.99, 1.0, 1.01, 1.0, 0.99, 1.0],
  idle: 1000,
  redline: 9250,
  fuelCut: 9500,
  peakPower: 800,
  peakPowerRpm: 9000,
  peakTorque: 700,
  peakTorqueRpm: 6750,
  torqueCurve: [
    [1000, 150], [2000, 380], [3000, 520], [4000, 610], [5000, 665],
    [6000, 695], [6750, 700], [7500, 680], [8000, 660], [8500, 645],
    [9000, 633], [9250, 590], [9500, 520],
  ],
  inertia: 0.1, // kg·m² (estimated) — F1-derived bottom end
};

const MA25_FLAT6 = {
  name: 'Porsche 4.0 L flat-six',
  layout: '4.0 L 180° boxer six, naturally aspirated',
  displacement: 3995,
  cylinders: 6,
  aspiration: 'na',
  firingOrder: [1, 6, 2, 4, 3, 5],
  firingPhases: [0, 120, 240, 360, 480, 600],
  cylinderWeights: [1.0, 1.02, 0.98, 1.01, 0.99, 1.0],
  idle: 850,
  redline: 8000,
  fuelCut: 8200,
  peakPower: 414,
  peakPowerRpm: 7600,
  peakTorque: 419,
  peakTorqueRpm: 5000,
  torqueCurve: [
    [1000, 110], [2000, 250], [3000, 330], [4000, 385], [5000, 419],
    [6000, 419], [6800, 419], [7200, 405], [7600, 388], [8000, 350], [8200, 310],
  ],
  inertia: 0.14, // kg·m² (estimated)
};

/* ------------------------------------------------------------- tone recipes */
/*
 * `pulse` models the exhaust pressure pulse of a single firing: its spectrum is
 * flat below `cutoff` and rolls off as 1/f^alpha above. A lazy, part-throttle
 * pulse is broad (low cutoff); a full-throttle pulse is sharp (high cutoff),
 * which is why engines gain "edge" and top-end hiss as load rises.
 *
 * `resonances` are the fixed-frequency chamber / runner / tail-pipe resonances
 * (Helmholtz and quarter-wave) of that specific exhaust system. They do not
 * track rpm — that is what makes one car recognisable from another.
 */

const TONE_GTR = {
  harmonics: { count: 48, gain: 1.0 },
  pulse: { cutoffIdle: 170, cutoffFull: 1150, alpha: 1.7 },
  lowOrderBoost: 1.5, // big 3rd-order growl
  resonances: [
    { f: 95, q: 2.2, gain: 2.4 },
    { f: 190, q: 3.0, gain: 1.9 },
    { f: 300, q: 2.5, gain: 1.3 },
    { f: 520, q: 2.0, gain: 1.0 },
    { f: 950, q: 2.5, gain: 1.2 },
    { f: 1800, q: 1.8, gain: 0.9 },
    { f: 3200, q: 1.4, gain: 0.6 },
  ],
  induction: { gain: 0.34, q: 1.1, freqIdle: 260, freqFull: 1500, hpf: 120 },
  mechanical: { gain: 0.055, hpf: 2600 },
  topEnd: { gain: 0.42, center: 3000, q: 0.9 },
  turbo: {
    turbos: 2,
    minHz: 430,
    maxHz: 2450,
    gain: 0.16,
    detuneCents: 35,
    wastegateHz: 1750,
    bov: { gain: 0.5, decay: 0.28 },
  },
  crackle: { minRpm: 2400, rate: 26, gain: 0.5, center: 2400 },
  saturation: { driveIdle: 1.3, driveFull: 4.2 },
  eq: [
    { type: 'lowshelf', f: 140, gain: 4.0, q: 0.7 },
    { type: 'peaking', f: 700, gain: -2.0, q: 0.8 },
    { type: 'highshelf', f: 5200, gain: -4.0, q: 0.7 },
  ],
};

const TONE_918 = {
  harmonics: { count: 48, gain: 1.0 },
  pulse: { cutoffIdle: 250, cutoffFull: 1900, alpha: 1.5 },
  lowOrderBoost: 1.05,
  resonances: [
    { f: 130, q: 2.0, gain: 1.9 },
    { f: 260, q: 3.2, gain: 1.7 },
    { f: 430, q: 2.8, gain: 1.5 },
    { f: 780, q: 3.0, gain: 1.4 },
    { f: 1350, q: 2.5, gain: 1.3 },
    { f: 2400, q: 2.0, gain: 1.05 },
    { f: 4200, q: 1.6, gain: 0.85 },
  ],
  induction: { gain: 0.3, q: 1.3, freqIdle: 320, freqFull: 2100, hpf: 150 },
  mechanical: { gain: 0.075, hpf: 3000 },
  topEnd: { gain: 0.5, center: 4200, q: 0.9 },
  electric: { gain: 0.055, baseHz: 320, ratio: 0.36, harmonics: 3 },
  crackle: { minRpm: 3200, rate: 14, gain: 0.32, center: 3000 },
  saturation: { driveIdle: 1.4, driveFull: 3.6 },
  eq: [
    { type: 'lowshelf', f: 160, gain: 1.5, q: 0.7 },
    { type: 'peaking', f: 1200, gain: 2.5, q: 0.9 },
    { type: 'highshelf', f: 6000, gain: 1.0, q: 0.7 },
  ],
};

const TONE_LAFERRARI = {
  harmonics: { count: 48, gain: 1.05 },
  pulse: { cutoffIdle: 300, cutoffFull: 2400, alpha: 1.4 },
  lowOrderBoost: 0.85,
  resonances: [
    { f: 120, q: 2.0, gain: 1.6 },
    { f: 240, q: 2.6, gain: 1.4 },
    { f: 480, q: 3.0, gain: 1.5 },
    { f: 900, q: 3.2, gain: 1.75 },
    { f: 1500, q: 2.6, gain: 1.45 },
    { f: 2700, q: 2.2, gain: 1.2 },
    { f: 4600, q: 1.8, gain: 1.0 },
    { f: 6800, q: 1.5, gain: 0.7 },
  ],
  induction: { gain: 0.42, q: 1.0, freqIdle: 300, freqFull: 1900, hpf: 120 },
  mechanical: { gain: 0.08, hpf: 3200 },
  topEnd: { gain: 0.55, center: 5200, q: 0.85 },
  electric: { gain: 0.05, baseHz: 380, ratio: 0.3, harmonics: 3 },
  crackle: { minRpm: 4200, rate: 8, gain: 0.22, center: 3400 },
  saturation: { driveIdle: 1.5, driveFull: 3.2 },
  eq: [
    { type: 'lowshelf', f: 150, gain: 0.5, q: 0.7 },
    { type: 'peaking', f: 900, gain: 3.0, q: 1.0 },
    { type: 'highshelf', f: 5200, gain: 3.0, q: 0.7 },
  ],
};

const TONE_718 = {
  harmonics: { count: 48, gain: 0.95 },
  pulse: { cutoffIdle: 200, cutoffFull: 1500, alpha: 1.6 },
  lowOrderBoost: 1.25,
  resonances: [
    { f: 110, q: 2.4, gain: 2.1 },
    { f: 220, q: 3.0, gain: 1.6 },
    { f: 390, q: 2.6, gain: 1.35 },
    { f: 700, q: 2.2, gain: 1.15 },
    { f: 1300, q: 2.4, gain: 1.2 },
    { f: 2400, q: 1.8, gain: 0.9 },
    { f: 4000, q: 1.5, gain: 0.65 },
  ],
  induction: { gain: 0.32, q: 1.2, freqIdle: 280, freqFull: 1700, hpf: 130 },
  mechanical: { gain: 0.06, hpf: 2800 },
  topEnd: { gain: 0.4, center: 3600, q: 0.9 },
  crackle: { minRpm: 3000, rate: 12, gain: 0.3, center: 2600 },
  saturation: { driveIdle: 1.3, driveFull: 3.8 },
  eq: [
    { type: 'lowshelf', f: 150, gain: 3.0, q: 0.7 },
    { type: 'peaking', f: 800, gain: 0.5, q: 0.9 },
    { type: 'highshelf', f: 5000, gain: -1.0, q: 0.7 },
  ],
};

/* ------------------------------------------------------------------- cars */

export const CARS = [
  {
    id: 'gtr-nismo',
    make: 'Nissan',
    model: 'GT-R NISMO (R35)',
    year: '2020–2023',
    accent: '#e4002b',
    engine: VR38DETT,
    tone: TONE_GTR,
    hybrid: null,
    mass: 1720,
    cda: 0.62, // Cd·A, m² (estimated)
    crr: 0.014,
    wheelRadius: 0.354, // 285/35 R20
    gears: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], // GR6 dual-clutch
    finalDrive: 3.7,
    shiftTime: 0.14, // s, DCT (estimated)
    gearbox: 'GR6 6-speed dual-clutch',
    topSpeedKph: 315,
    redlineNote: '7 400 rpm redline / 7 500 rpm fuel cut',
    blurb:
      'Hand-built 3.8 L twin-turbo V6. Big third-order growl, turbo whoosh, ' +
      'titanium exhaust and wastegate chatter on the overrun.',
  },
  {
    id: 'p918',
    make: 'Porsche',
    model: '918 Spyder',
    year: '2014–2015',
    accent: '#d8d3c4',
    engine: M918_V8,
    tone: TONE_918,
    hybrid: { kw: 208, kwh: 6.8, motors: 2, name: 'Dual e-machines (front + rear)' },
    mass: 1674,
    cda: 0.58,
    crr: 0.013,
    wheelRadius: 0.347, // 265/35 R21
    gears: [3.83, 2.36, 1.69, 1.31, 1.04, 0.86, 0.8], // estimated PDK set
    finalDrive: 4.3,
    shiftTime: 0.12,
    gearbox: '7-speed PDK dual-clutch',
    topSpeedKph: 345,
    redlineNote: '9 150 rpm redline / 9 400 rpm fuel cut',
    blurb:
      'RS Spyder LMP2-derived flat-plane V8 with 208 kW of electric assist. ' +
      'Even 90° firing, race exhaust, motor whine under the V8.',
  },
  {
    id: 'laferrari',
    make: 'Ferrari',
    model: 'LaFerrari',
    year: '2013–2016',
    accent: '#ff2800',
    engine: F140_FE,
    tone: TONE_LAFERRARI,
    hybrid: { kw: 120, kwh: 2.2, motors: 1, name: 'HY-KERS' },
    mass: 1585,
    cda: 0.55,
    crr: 0.012,
    wheelRadius: 0.3575, // 345/30 R20
    gears: [3.06, 2.28, 1.79, 1.45, 1.2, 1.0, 0.85], // estimated DCT set
    finalDrive: 4.05,
    shiftTime: 0.11,
    gearbox: '7-speed dual-clutch',
    topSpeedKph: 350,
    redlineNote: '9 250 rpm redline / 9 500 rpm fuel cut',
    blurb:
      '6.3 L 65° V12 firing every 60°, plus HY-KERS. A sixth-order-of-crank ' +
      'scream at 900 Hz with harmonics well past 6 kHz.',
  },
  {
    id: 'spyder-718',
    make: 'Porsche',
    model: '718 Spyder 4.0',
    year: '2020–2023',
    accent: '#f2c200',
    engine: MA25_FLAT6,
    tone: TONE_718,
    hybrid: null,
    mass: 1450,
    cda: 0.62,
    crr: 0.013,
    wheelRadius: 0.3425, // 295/30 R20
    gears: [3.31, 1.95, 1.41, 1.13, 0.95, 0.81], // 6-speed manual
    finalDrive: 4.24,
    shiftTime: 0.34, // manual + clutch
    gearbox: '6-speed manual',
    topSpeedKph: 301,
    redlineNote: '8 000 rpm redline / 8 200 rpm fuel cut',
    blurb:
      'Bonus preset: the 4.0 L boxer six — flat-six third-order thrum with a ' +
      'sharp intake bark and no turbo lag at all.',
  },
];

export function getCar(id) {
  const car = CARS.find((c) => c.id === id);
  if (!car) throw new Error(`unknown car: ${id}`);
  return car;
}

export { HP_TO_NM };
