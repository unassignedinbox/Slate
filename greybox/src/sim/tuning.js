// Designer-tunable numbers for the greybox. Units: metres, seconds, m/s.
// Shared by the browser game AND the headless level checker, so a change here
// is immediately reflected in the par-time numbers the checker reports.

export const T = {
  // --- road / centreline ---------------------------------------------------
  step: 0.5,            // centreline sample spacing (m)
  roadHalfWidth: 4.5,   // drivable half-width of the road (m) -> 9 m road
  tileLength: 8,        // road tile length; every tile boundary is a visible crack (m)
  gateHalfWidth: 6.5,   // how far across the road a portal aperture reaches (m)
  gateTriggerLat: 8,    // car must be this close (lateral, m) to trigger a gate

  // --- building / town clearance rules (checked by levels/.../check.mjs) ---
  clearance: 7,         // min distance from ground-level road to a building wall (m)
  roofHeadroom: 2.2,    // road that passes over a roof must clear it by this much (m)

  // --- car: arcade physics in a low-gravity world -------------------------
  fixedDt: 1 / 120,     // physics sub-step (s)
  gravity: 6.5,         // m/s^2. Deliberately low: the town is floating and cars feel light in the air
  airDrag: 0.05,        // per-second damping of vertical speed while airborne
  engineAccel: 9,       // m/s^2 at standstill
  engineTopSpeed: 30,   // engine tapers to zero at this speed (m/s)
  airEngine: 0.3,       // fraction of engine authority while airborne
  brakeDecel: 20,       // m/s^2
  reverseTopSpeed: 8,   // m/s
  rollResist: 0.02,     // linear rolling resistance
  dragQuad: 0.0012,     // quadratic drag
  yaw0: 2.6,            // max yaw rate at low speed (rad/s)
  yawFalloff: 18,       // speed (m/s) at which max yaw rate halves
  gripRoad: 6,          // lateral grip on road (1/s). Higher = snappier
  gripAir: 0.6,         // lateral grip while airborne
  carRadius: 1.0,       // collision radius in XZ (m)
  carHeight: 1.6,       // used for ceiling / prop overlap tests (m)
  maxAirTime: 3.0,      // seconds airborne off-road before respawn
  respawnBack: 10,      // on respawn, go this far back along the road (m)
  fallY: 60,            // respawn if this far below the shard (m)
};
