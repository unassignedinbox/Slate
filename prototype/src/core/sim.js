// Arcade vehicle + weather simulation. Same field names as the schema in
// docs/HMI_DESIGN.md §6, so the C++ build can replace this file with a real source.
import { state, notify } from './store.js';

const GEAR_MIN = [0, 60, 100, 140, 180, 220, 260, 300];   // km/h where each gear starts
const LAP_SECONDS = 84;                                    // arcade lap length
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let speed = 0;
let phase = 0;          // 0..1 along the lap
let t = 0;
let lastBrake = 0;

export function startSim() {
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function step(dt) {
  t += dt;
  const v = state.vehicle;
  const s = state.settings;

  // ---- Track & driver model -----------------------------------------
  phase = (phase + dt / LAP_SECONDS) % 1;
  const lap = 1 + Math.floor((t / LAP_SECONDS));
  const curv = Math.pow(Math.abs(Math.sin(2 * Math.PI * 4 * phase)), 2.2);   // 4 corners per lap
  const aero = v.aero;
  // Downforce helps cornering; drag lowers top speed.
  const topBoost = 1 - 0.0004 * aero.dragN;
  const target = (330 - 190 * curv) * topBoost + 6 * Math.sin(t * 0.7);

  let throttle = 0, brake = 0;
  if (speed < target) { throttle = 1; speed += dt * 28 * (1 - speed / 380); }
  else { brake = clamp((speed - target) / 40, 0, 1); speed -= dt * 70 * (0.3 + brake); }
  speed = clamp(speed, 0, 360);

  // Gear & rpm
  let gear = 1;
  for (let i = 0; i < GEAR_MIN.length; i++) if (speed >= GEAR_MIN[i]) gear = i + 1;
  const gLo = GEAR_MIN[gear - 1], gHi = GEAR_MIN[gear] ?? 360;
  const rpm = clamp(4000 + ((speed - gLo) / (gHi - gLo)) * 8500, 3800, 12800);

  // Steering from corner phase
  const steer = 28 * Math.sin(2 * Math.PI * 4 * phase) * curv;

  // ---- Suspension -----------------------------------------------------
  const sr = v.suspension.springRate, arb = v.suspension.antiRollBar;
  const pitch = brake * 9 - throttle * 4;                            // mm
  const roll = steer / 28 * 7 * (speed / 300);
  const bump = (k) => 2.2 * Math.sin(t * (7 + k) + k * 1.7) * (speed / 300);
  const base = 45 * (200 / sr.front) * 0.5 + 45 * 0.5;               // stiffer springs = less travel
  const trav = {
    FL: base + pitch - roll * (arb.front / 4) + bump(0),
    FR: base + pitch + roll * (arb.front / 4) + bump(1),
    RL: base - pitch * 0.6 - roll * (arb.rear / 4) + bump(2),
    RR: base - pitch * 0.6 + roll * (arb.rear / 4) + bump(3),
  };
  for (const k in trav) v.suspension.travelMm[k] = clamp(trav[k], 10, 90);

  // ---- Tyres ----------------------------------------------------------
  const load = brake * 0.5 + curv * 0.5 + throttle * 0.2;
  const tyreTargets = { FL: 70 + speed * 0.12 + load * 22, FR: 72 + speed * 0.12 + load * 22,
                        RL: 74 + speed * 0.1 + throttle * 12, RR: 76 + speed * 0.1 + throttle * 12 };
  for (const k in v.tyres) {
    const tyre = v.tyres[k];
    tyre.tempC += (tyreTargets[k] - tyre.tempC) * dt * 0.08;
    tyre.pressureBar = +(1.8 + (tyre.tempC - 20) * 0.0065).toFixed(2);
    tyre.wearPct = clamp(tyre.wearPct + dt * (0.0008 + load * 0.0015), 0, 100);
  }

  // ---- Aero (very simplified) ----------------------------------------
  const v2 = (speed / 3.6) ** 2;
  aero.downforceN = Math.round(0.9 * (aero.frontWingDeg * 1.05 + aero.rearWingDeg * 1.4) * v2 / 10);
  aero.dragN = Math.round(0.25 * (aero.frontWingDeg * 0.6 + aero.rearWingDeg * 0.9 + 10) * v2 / 10);

  // ---- Weather -------------------------------------------------------
  const w = state.weather;
  w.airTempC = 24 + 2 * Math.sin(t / 45);
  w.trackTempC = w.airTempC + 15 + throttle * 2;
  w.windKmh = 11 + 5 * Math.sin(t / 17);
  w.windDeg = (240 + 30 * Math.sin(t / 60)) % 360;
  w.humidityPct = 48 + 8 * Math.sin(t / 80);
  const rainCycle = clamp(Math.sin(t / 120) * 1.4 - 0.5, 0, 1);
  if (s.weatherOverride === 'rain') w.rainIntensity = 0.8;
  else if (s.weatherOverride === 'dry') w.rainIntensity = 0;
  else w.rainIntensity = rainCycle;

  // ---- Driver telemetry --------------------------------------------
  Object.assign(v, {
    speedKmh: +speed.toFixed(1), gear, rpm: Math.round(rpm), throttle, brake,
    steerDeg: +steer.toFixed(2), lap, lapProgress: phase,
    drs: speed > 260 && curv < 0.2 ? 'open' : speed > 240 ? 'ready' : 'off',
  });
  if (brake > 0.2) lastBrake = t;
  state.time = t;
  notify('vehicle');
}
