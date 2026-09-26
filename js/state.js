// state.js — shared game state & config (no imports beyond three types)
export const CFG = {
  minX: -196, maxX: 196, minZ: -450, maxZ: 180,
  wallFaceZ: 170,          // front (beach) face of the great wall
  wallBaseY: 3.3, wallTopY: 19.3,
  winZ: 162,               // reaching this close to the wall wins
  tideStart: -6.9,
  tideMax: 2.05,
  tideRate: 0.025,         // metres of tide per second
  spawn: { x: 0, z: -400 },
  carSpawn: { x: 0, z: -396, yaw: 0.05 },
};

export const S = {
  mode: 'intro',           // intro | play | pause | dead | win
  t: 0,                    // mission clock (pauses with game)
  realT: 0,                // real elapsed time (drives water waves, intro/orbit cams)
  scene: null, camera: null, renderer: null, sun: null, sunTarget: null,
  waterLevel: CFG.tideStart,
  waterlineZ: -497,
  player: null,
  car: null,
  sentries: [],
  planes: null,            // Planes system (bombers)
  bombs: [],
  tankMines: [],
  apMines: [],
  wires: [],               // wire chunks: {belt, seg, mesh, postIds, coilIds, destroyed}
  wireSegs: [],            // {ax,az,bx,bz, chunk}
  obstacles: [],           // {x,z,r,type}
  pendingBooms: [],
  effects: null,
  audio: null,
  stats: { deaths: 0, minesTripped: 0, carLost: false },
  wireSlow: 0,
  keys: Object.create(null),
  camMode: 'fp',           // fp | chase (in car) | orbit (showcase)
  orbitT: 0,
  banners: [],
  flags: {
    warnedTide1: false, warnedTide2: false, warnedMines: false, vehicleLost: false,
  },
  muted: false,
};
