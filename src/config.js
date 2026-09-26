// Central tuning + world layout for Operation Slate.
// Coordinate system:  +X = east, +Z = SOUTH (out to sea), -Z = north (towards the wall).
// The player lands in the surf at high +Z and must reach the breach in the wall at -Z.

export const WORLD = {
  minX: -260,
  maxX: 260,
  minZ: -300,
  maxZ: 300,
  cell: 3, // terrain grid resolution in metres
};

export const WALL = {
  z: -262, // centre of the wall slab
  thickness: 9,
  height: 23.5,
  length: 514, // spans the cove, ends buried in the headlands
  gateX: 0,
  gateHalfWidth: 15,
};

export const OBJECTIVE = {
  x: WALL.gateX,
  z: -246,
  radius: 17,
};

export const SPAWN = { x: 14, z: 232, heading: Math.PI }; // heading PI => facing -Z

export const TIDE = {
  start: -1.7, // sea level at t=0
  end: 4.6, // sea level once the tide is fully in
  duration: 175, // seconds for a full rise
  swell: 0.28, // extra wave height amplitude
  surgePeriod: 23,
  surgeAmount: 0.55,
};

export const CAR = {
  mass: 1300,
  maxHealth: 100,
  engineForce: 14000, // traction-limited in practice, see the friction ellipse
  reverseForce: 6200,
  brakeForce: 17500,
  maxSpeed: 40, // m/s ~ 145 km/h
  maxReverse: 9,
  dragCoef: 0.52,
  rollResist: 4.2,
  wheelBase: 2.62,
  trackWidth: 1.58,
  wheelRadius: 0.33,
  bodyRadius: 1.75, // collision proxy

  /* ---- steering ---- */
  maxSteer: 0.6, // rad at the road wheel, parking lock
  steerGripBudget: 0.88, // fraction of the grip-limited angle you may ask for
  steerMin: 0.035, // never take the wheel away completely
  steerSpeed: 3.6, // rad/s toward lock
  steerReturn: 5.4, // rad/s back to centre
  counterSteerAssist: 0.5, // how much of the slide the car catches for you

  /* ---- chassis ---- */
  weightFront: 0.62, // static front weight fraction (transverse engine, FWD)
  cgHeight: 0.52,
  yawInertia: 1750, // kg m^2
  yawDamp: 340, // N m s. The tyres do the real damping; this only settles keyboard wobble
  maxYawRate: 2.2, // rad/s

  /* ---- tyres: simplified Pacejka magic formula ----
   * Fy = D sin(C atan(B a - E (B a - atan(B a)))), D = mu * Fz
   * B stiffness, C shape, E curvature. Road tyres on sand are soft and
   * forgiving: a low B (slow build-up) and a peak that falls away gently. */
  tyreB: 8.4,
  tyreC: 1.56,
  tyreE: 0.92,
  muPeak: 1.15, // multiplied by the surface grip table
  // Understeer bias: a stiffer, grippier rear axle means the nose washes out
  // before the tail steps out. Forgiving, and true to a family saloon.
  rearStiffness: 1.22,
  rearGrip: 1.05,
  driveFront: 1.0, // front-wheel drive, so power-on pushes into understeer
  brakeBiasFront: 0.62,
  handbrakeForce: 9500,
  handbrakeGrip: 0.4, // rear lateral grip while the lever is up
};

export const DIFFICULTY = {
  sentryRange: 215,
  sentryLockTime: 1.05,
  sentryBurst: 5,
  sentryBurstGap: 2.3,
  sentryShotGap: 0.11,
  sentrySpread: 0.027,
  sentryDamage: 2.4,
  bulletSpeed: 230,
  atRange: 300,
  atReload: 7.5,
  atShellSpeed: 120,
  atDamage: 46,
  maxFiringSentries: 2,
  sentryAimError: 0.026, // radians-ish: multiplied by range, re-rolled per burst
  atAimError: 0.02,
  apMineDamage: 19,
  apMineRadius: 9,
  apMineTrigger: 1.7,
  tellerDamage: 52,
  tellerRadius: 15,
  tellerTrigger: 2.3,
  drownDps: 11,
  wireDps: 5.5,
  repairAmount: 28,
};

/* ------------------------------------------------------------------ */
/* Beach profile: height of the sand along Z (before detail)           */
/* ------------------------------------------------------------------ */
export const BEACH_PROFILE = [
  [-300, 9.4],
  [-272, 9.2],
  [-256, 8.6],
  [-240, 7.5],
  [-222, 6.4],
  [-196, 5.3],
  [-160, 4.6],
  [-110, 4.0],
  [-50, 3.3],
  [10, 2.5],
  [70, 1.7],
  [120, 0.8],
  [170, -0.35],
  [205, -1.5],
  [235, -2.8],
  [265, -4.6],
  [300, -7.2],
];

/* ------------------------------------------------------------------ */
/* Roads / pathways                                                    */
/* ------------------------------------------------------------------ */
export const ROADS = [
  {
    name: 'causeway',
    width: 11,
    kind: 'gravel',
    berm: true,
    points: [
      [16, 290],
      [12, 240],
      [4, 194],
      [-6, 150],
      [-8, 104],
      [-2, 52],
      [4, 0],
      [0, -54],
      [-6, -112],
      [-2, -170],
      [0, -214],
      [0, -262],
    ],
  },
  {
    name: 'west-track',
    width: 8.5,
    kind: 'dirt',
    berm: false,
    points: [
      [-206, 286],
      [-190, 236],
      [-168, 190],
      [-150, 140],
      [-134, 92],
      [-112, 44],
      [-96, -8],
      [-84, -62],
      [-64, -116],
      [-42, -164],
      [-20, -200],
      [-6, -228],
      [-2, -250],
    ],
  },
  {
    name: 'east-track',
    width: 8,
    kind: 'dirt',
    berm: true,
    points: [
      [196, 284],
      [176, 232],
      [160, 182],
      [150, 128],
      [132, 74],
      [116, 18],
      [96, -40],
      [74, -98],
      [46, -152],
      [22, -196],
      [8, -226],
      [4, -252],
    ],
  },
  {
    name: 'lateral',
    width: 7,
    kind: 'dirt',
    berm: false,
    points: [
      [-208, -74],
      [-150, -84],
      [-96, -74],
      [-40, -88],
      [16, -76],
      [76, -88],
      [138, -76],
      [206, -84],
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Trenches (zig-zag lines with gaps that act as vehicle crossings)    */
/* ------------------------------------------------------------------ */
function zigzag(z, fromX, toX, amp, period, phase = 0) {
  const pts = [];
  const step = period / 2;
  const dir = Math.sign(toX - fromX);
  for (let x = fromX; dir > 0 ? x <= toX : x >= toX; x += step * dir) {
    const k = Math.round((x - fromX) / (step * dir));
    pts.push([x, z + (k % 2 === 0 ? -amp : amp) + phase]);
  }
  return pts;
}

export const TRENCHES = [
  { depth: 2.7, width: 7.5, points: zigzag(-38, -236, -96, 7, 46) },
  { depth: 2.7, width: 7.5, points: zigzag(-44, -56, 60, 7, 46) },
  { depth: 2.7, width: 7.5, points: zigzag(-38, 104, 240, 7, 46) },
  { depth: 3.1, width: 8.5, points: zigzag(-142, -240, -110, 8, 52) },
  { depth: 3.1, width: 8.5, points: zigzag(-148, -66, 30, 8, 52) },
  { depth: 3.1, width: 8.5, points: zigzag(-142, 78, 244, 8, 52) },
  { depth: 2.4, width: 7, points: zigzag(-208, -230, -44, 6, 44) },
  { depth: 2.4, width: 7, points: zigzag(-212, 30, 236, 6, 44) },
];

/* ------------------------------------------------------------------ */
/* Huge mounds of earth + shell craters                                */
/* ------------------------------------------------------------------ */
export const MOUNDS = [
  { x: -128, z: 16, r: 38, h: 7.6 },
  { x: -46, z: -14, r: 26, h: 5.4 },
  { x: 62, z: -26, r: 32, h: 6.8 },
  { x: 152, z: -54, r: 30, h: 6.2 },
  { x: -186, z: -96, r: 34, h: 6.6 },
  { x: -62, z: -116, r: 30, h: 6.4 },
  { x: 34, z: -122, r: 27, h: 5.8 },
  { x: 128, z: -134, r: 29, h: 6.0 },
  { x: -148, z: -176, r: 26, h: 5.2 },
  { x: 92, z: -186, r: 25, h: 5.0 },
  { x: -24, z: 96, r: 33, h: 5.4 },
  { x: 108, z: 78, r: 28, h: 4.6 },
  { x: -158, z: 108, r: 30, h: 4.8 },
  { x: 186, z: 148, r: 26, h: 3.8 },
  { x: -96, z: 186, r: 24, h: 3.0 },
  { x: 214, z: -8, r: 30, h: 6.0 },
  { x: -226, z: -22, r: 28, h: 6.2 },
];

/* Long earth berms (capsule shaped ridges) */
export const BERMS = [
  { ax: -84, az: -46, bx: -18, bz: -58, r: 11, h: 4.2 },
  { ax: 34, az: -70, bx: 108, bz: -60, r: 10, h: 3.8 },
  { ax: -196, az: -140, bx: -128, bz: -148, r: 12, h: 4.4 },
  { ax: 118, az: -190, bx: 176, bz: -178, r: 11, h: 4.0 },
  { ax: -40, az: 154, bx: 42, bz: 146, r: 12, h: 3.4 },
];

/* ------------------------------------------------------------------ */
/* Defences: bunkers hold the sentries that shoot vehicles             */
/* ------------------------------------------------------------------ */
export const BUNKERS = [
  { x: -196, z: -238, yaw: 0.22, kind: 'mg' },
  { x: -118, z: -234, yaw: 0.1, kind: 'at' },
  { x: -52, z: -240, yaw: 0.04, kind: 'mg' },
  { x: 48, z: -240, yaw: -0.05, kind: 'mg' },
  { x: 116, z: -234, yaw: -0.12, kind: 'at' },
  { x: 198, z: -238, yaw: -0.24, kind: 'mg' },
  { x: -150, z: -172, yaw: 0.3, kind: 'mg' },
  { x: 96, z: -182, yaw: -0.26, kind: 'mg' },
  { x: -18, z: -196, yaw: 0.0, kind: 'mg' },
];

/* Wall-top sentry posts */
export const WALL_SENTRIES = [
  { x: -232, kind: 'mg' },
  { x: -84, kind: 'mg' },
  { x: 30, kind: 'mg' },
  { x: 164, kind: 'mg' },
];

export const COLORS = {
  sandDry: 0xd9c89b,
  sandPale: 0xe3d5ac,
  sandWet: 0x9c8a67,
  sandDeep: 0x6e6248,
  mineGround: 0xb5a37c, // scraped, re-filled sand over a buried charge
  grass: 0x6f7a4a,
  grassDark: 0x5b6640,
  dirt: 0x8a7350,
  mud: 0x7d6a4c,
  gravel: 0xa29684,
  concrete: 0xb8b5ab,
  concreteDark: 0x8e8b82,
  steel: 0x5e6059,
  rust: 0x7a4f35,
  olive: 0x4c5340,
  oliveDark: 0x3a4031,
  burnt: 0x2b2926,
  sandbag: 0xbfae86,
  sandbagAlt: 0xa99a76,
  wood: 0x7b6142,
  woodDark: 0x5e4a33,
  waterDeep: 0x143a4d,
  waterShallow: 0x2f7d86,
  foam: 0xdff1f2,
  sky: 0x9fb2c0,
  fog: 0xa9b8c4,
  sun: 0xffd9a8,
};
