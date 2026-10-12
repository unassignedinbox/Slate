// ---------------------------------------------------------------------------
// SPINE RUNNER — global tuning. Everything gameplay-facing lives here so the
// feel can be dialled in without hunting through the modules.
// ---------------------------------------------------------------------------
export const CONFIG = {
  laps: 3,
  rivals: 3,               // AI opponents
  fixedStep: 1 / 60,       // deterministic physics step (seconds)
  maxSubSteps: 8,

  // --- ship ---
  hoverHeight: 1.75,
  baseTopSpeed: 116,       // m/s  (~418 km/h on the HUD)
  accel: 41,
  brakeDecel: 78,
  coastDecel: 6.5,
  reverseSpeed: 14,

  boostTopSpeed: 189,      // hyperboost ceiling (~680 km/h)
  boostAccel: 78,
  boostDrain: 30,          // energy %/s
  boostRegen: 8.5,
  boostMinToEngage: 12,

  steerRate: 2.25,         // rad/s at full authority (min turn radius ~52 m at top speed)
  steerSpeedFactor: 0.42,  // how much of the steer rate needs speed
  driftSteerRate: 2.5,     // extra yaw while airbraking
  airbrakeLatAccel: 78,    // lateral shove of Q/E
  lateralGrip: 10.5,       // lateral velocity decay (1/s)
  maxLateralSpeed: 34,

  // mild auto-alignment to the deck tangent — gentle curves flow, hairpins don't
  alignRate: 1.15,
  alignSpeedExp: 1.35,

  wallScrub: 0.62,         // speed kept after a hard perpendicular hit
  wallDrag: 0.985,
  wallDamagePerSpeed: 0.10,
  hullMax: 100,
  hullRegen: 0.9,

  invulnTime: 1.5,
  respawnHold: 1.15,       // seconds pinned after a wreck respawn

  // --- race ---
  countdown: 4.0,
  rolloffSpeed: 46,        // speed the pack is released at
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const formatTime = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
