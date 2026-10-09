// Vehicle simulation. It produces the same telemetry frame the C++ backend will publish.
// Units: km/h, m, m/s, mm (suspension), degC, bar, N, g.
import { TRACK, trackAt, LAT_G } from './track.js';

export const CORNERS = ['fl', 'fr', 'rl', 'rr'];
export const WHEELBASE = 3.2;     // m
export const TRACK_WIDTH = 1.7;   // m
export const TYRE_RADIUS = 0.34;  // m
const GEAR_TOPS = [60, 105, 150, 190, 230, 265, 300]; // km/h upshift points
const COMPOUNDS = { soft: { temp: 8, wear: 1.6 }, medium: { temp: 0, wear: 1 }, hard: { temp: -6, wear: 0.7 } };

export const DEFAULT_SETTINGS = {
  rideHeight: 0,     // mm, -25..+25 (positive = higher)
  springRate: 0.5,   // 0..1
  damping: 0.5,      // 0..1 (higher = firmer, less body motion)
  antiRoll: 0.5,     // 0..1
  wingRear: 0.4,     // 0..1 rear flap angle
  wingFront: 0.5,    // 0..1 front flap angle
  compound: 'medium',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

// Road height under a wheel (mm). Spatial, so the rear axle sees the front bumps later.
const road = (s, side) =>
  9 * Math.sin(s * 0.021) +
  4 * Math.sin(s * 0.067 + side * 0.8) +
  2.2 * Math.sin(s * 0.19 + side) +
  22 * Math.max(0, Math.sin(s * 0.0031) - 0.98) * 50; // occasional kerb strikes

export class VehicleSim {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.t = 0;
    this.distance = 0;
    this.v = 0;
    this.lap = 1;
    this.lapStart = 0;
    this.lastLap = null;
    this.bestLap = null;
    this.susp = { fl: 0, fr: 0, rl: 0, rr: 0 };       // filtered compression (mm)
    this.temps = { fl: 80, fr: 80, rl: 80, rr: 80 };  // tyre temps (degC)
    this.wear = { fl: 0, fr: 0, rl: 0, rr: 0 };       // %
  }

  set(partial) {
    Object.assign(this.settings, partial);
  }

  step(dt) {
    const S = this.settings;
    this.t += dt;

    // Longitudinal: follow the reference speed profile (a stand-in for the driver/controller).
    const ref = trackAt(TRACK, this.distance);
    const ax = clamp((ref.v - this.v) * 1.6, -28, 9.5);
    this.v = Math.max(0, this.v + ax * dt);
    this.distance += this.v * dt;
    const longG = ax / 9.81;
    const latG = clamp((this.v * this.v * ref.k) / 9.81, -LAT_G * 1.4, LAT_G * 1.4);
    const kph = this.v * 3.6;

    // Suspension: wheels see the road; the damper filters it; load transfer adds a static offset.
    const sOf = {
      fl: this.distance, fr: this.distance,
      rl: this.distance - WHEELBASE, rr: this.distance - WHEELBASE,
    };
    const side = { fl: -1, fr: 1, rl: -1, rr: 1 };
    const roadMm = {};
    const frontLong = -longG * 16, rearLong = longG * 16;     // braking dives the nose
    const roll = latG * 12 * (1.4 - S.antiRoll);              // lateral load to the outside
    const load = {
      fl: frontLong + roll, fr: frontLong - roll,
      rl: rearLong + roll, rr: rearLong - roll,
    };
    const springScale = 0.6 + 0.8 * (1 - S.springRate * 0.5);
    const tau = 0.02 + 0.12 * (1 - S.damping);
    const blend = 1 - Math.exp(-dt / tau);
    for (const c of CORNERS) {
      roadMm[c] = road(sOf[c], side[c]);
      const target = springScale * roadMm[c] + load[c] - S.rideHeight;
      this.susp[c] += (target - this.susp[c]) * blend;
    }
    const avg = (a, b) => (a + b) / 2;
    const frontC = avg(this.susp.fl, this.susp.fr);
    const rearC = avg(this.susp.rl, this.susp.rr);
    const leftC = avg(this.susp.fl, this.susp.rl);
    const rightC = avg(this.susp.fr, this.susp.rr);
    const attitude = {
      pitchDeg: ((frontC - rearC) / 1000 / WHEELBASE) * DEG,  // + = nose down
      rollDeg: ((leftC - rightC) / 1000 / TRACK_WIDTH) * DEG, // + = left side down
      heaveMm: (frontC + rearC) / 2,
    };

    // Tyres: temperature relaxes toward a load/speed/compound target; wear accumulates.
    const comp = COMPOUNDS[S.compound] ?? COMPOUNDS.medium;
    const tyres = {};
    const tBlend = 1 - Math.exp(-dt / 12);
    for (const c of CORNERS) {
      const target = 72 + comp.temp + kph * 0.05 + Math.abs(latG) * 4 + (c[0] === 'f' ? 2 : 0);
      this.temps[c] += (target - this.temps[c]) * tBlend;
      this.wear[c] += this.v * dt * 5e-5 * (1 + Math.abs(latG)) * comp.wear;
      tyres[c] = {
        tempC: this.temps[c],
        pressureBar: 1.95 * ((this.temps[c] + 273.15) / 298.15), // ideal-gas rise from 25 degC cold
        wearPct: this.wear[c],
      };
    }

    // Aero: downforce and drag from the two flap angles (simplified coefficient model).
    const q = 0.5 * 1.225 * this.v * this.v;
    const Clr = 0.9 + 1.9 * S.wingRear;
    const Clf = 0.5 + 1.1 * S.wingFront;
    const Cl = Clr + Clf;
    const Cd = 0.32 + 0.35 * S.wingRear + 0.2 * S.wingFront;
    const aero = {
      downforceN: q * 1.6 * Cl,
      dragN: q * 1.6 * Cd,
      balanceFrontPct: (100 * Clf) / Cl,
      lOverD: Cl / Cd,
      wingRear: S.wingRear,
      wingFront: S.wingFront,
    };

    // Powertrain: gear from speed bands, rpm interpolated within the band.
    let gear = 1;
    while (gear < 7 && kph > GEAR_TOPS[gear - 1]) gear++;
    const lo = gear > 1 ? GEAR_TOPS[gear - 2] : 0;
    const hi = GEAR_TOPS[gear - 1];
    const f = clamp((kph - lo) / (hi - lo), 0, 1);
    const rpm = kph < 1 ? 900 : 3300 + f * 8000;
    const throttle = ax > 0 ? clamp(ax / 9.5, 0, 1) : 0;
    const brake = ax < 0 ? clamp(-ax / 28, 0, 1) : 0;

    // Lap timing.
    const lapIdx = Math.floor(this.distance / TRACK.length) + 1;
    if (lapIdx > this.lap) {
      const lt = this.t - this.lapStart;
      this.lastLap = lt;
      this.bestLap = this.bestLap == null ? lt : Math.min(this.bestLap, lt);
      this.lapStart = this.t;
      this.lap = lapIdx;
    }

    const alerts = [];
    for (const c of CORNERS) {
      if (this.temps[c] > 110) alerts.push({ level: 'warn', key: `temp-${c}`, text: `${c.toUpperCase()} tyre ${Math.round(this.temps[c])}°C` });
    }
    if (Math.abs(latG) > LAT_G * 1.2) alerts.push({ level: 'info', key: 'lat', text: `High lateral load ${latG.toFixed(1)} g` });

    return {
      t: this.t,
      distanceM: this.distance,
      lap: this.lap,
      lapTimeS: this.t - this.lapStart,
      lastLapS: this.lastLap,
      bestLapS: this.bestLap,
      speedKph: kph,
      rpm,
      gear,
      throttle,
      brake,
      longG,
      latG,
      susp: { ...this.susp },
      roadMm,
      attitude,
      tyres,
      aero,
      track: { x: ref.x, y: ref.y, heading: ref.heading, curvature: ref.k, progress: (this.distance % TRACK.length) / TRACK.length },
      settings: { ...S },
      alerts,
    };
  }
}
