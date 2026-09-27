import * as THREE from 'three';

// ---------------------------------------------------------------------------
// World scale: 1 unit ~= 1 metre. The car is ~4.6 units long (Sentra sized).
// The battlefield runs from the surf line (+Z) inland to the Atlantic Wall (-Z).
// ---------------------------------------------------------------------------

export const WORLD = {
  halfWidth: 470,        // playable half-width in X
  zStart: 460,           // deep water end
  zEnd: -2880,           // behind the wall
  cell: 5,               // terrain grid resolution (metres)
  seed: 19440606,
};

export const COURSE = {
  spawn: new THREE.Vector3(6, 0, 240),
  gateZ: -2660,          // the gate in the giant wall = finish line
  wallZ: -2690,
  finishRadius: 30,
};

export const TIDE = {
  startLevel: -9.5,
  // metres of sea-level rise per second. The beach is shallow, so this eats
  // ground *fast* early on and slows as the land climbs inland.
  rise: 0.135,
  maxLevel: 17.5,
  graceSeconds: 8,       // calm before the tide starts climbing
};

export const CAR = {
  mass: 1240,
  maxSpeed: 47,          // ~170 km/h on tarmac
  offroadSpeed: 26,
  accel: 17,
  brake: 34,
  reverseSpeed: 11,
  grip: 3.1,
  steerRate: 2.0,
  maxHealth: 100,
};

export const WEAPONS = {
  mgRange: 330,
  mgBurst: 7,
  mgBurstGap: 0.085,
  mgReload: 1.9,
  mgSpread: 0.028,
  bulletSpeed: 235,
  bulletDamage: 3.4,
  bombDamage: 62,
  bombRadius: 22,
  mineDamage: 28,
  tankMineDamage: 65,
};

export const COLORS = {
  sand: 0xd6c496,
  wetSand: 0x9c8963,
  grass: 0x5d6b3a,
  dryGrass: 0x8c8b4e,
  dirt: 0x8a7350,
  mud: 0x584b34,
  rock: 0x8d8b83,
  road: 0x9a8d75,
  concrete: 0xb3aea3,
  concreteDark: 0x8e8a80,
  steel: 0x5b6067,
  steelDark: 0x3a3f45,
  olive: 0x4e5a38,
  oliveDark: 0x3a4429,
  sandbag: 0xb8a67c,
  sandbagAlt: 0xa8946a,
  wood: 0x6d573a,
  woodDark: 0x54432e,
  rust: 0x7a4b2e,
  water: 0x2f6076,
  waterDeep: 0x184257,
  foam: 0xd9ecef,
  sky: 0x9fb4c0,
  fog: 0xa9bcc6,
};
