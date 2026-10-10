// Safety protocols: sensors, voting, protective actions (SCRAM) and accident classes.
//
// Two layers:
//  1. Protective actions (SCRAM): control rods drop when a measured quantity crosses a
//     trip point. Sensors are noisy, so trips use 2-out-of-3 voting by default. The
//     system can trip falsely (noise) or miss a real trip (both sensors high or low).
//  2. Accidents: physical limits on the true state. Crossing one is an accident, and with
//     auto core-kill enabled the core is poisoned and the fuel is declared destroyed.
//     The fuel is destroyed even if the trip came from noise, because the physical
//     accident criterion is applied to the true state.
//
// Limits are documented in docs/REACTOR-SIM-NOTES.md.

export const SAFETY_DEFAULTS = {
  designPowerW: 1e-6,            // design thermal power, W (1 uW)
  overpowerFactor: 1.15,         // overpower trip at 1.15 x design power (measured)
  flowLowFrac: 0.5,              // low-flow trip below 50 % of nominal (measured)
  flowLowHoldS: 3,               // ... sustained for 3 s
  lossOfCoolingFlowFrac: 0.02,   // true flow below 2 % of nominal is loss of cooling
  lossOfCoolingHoldS: 30,        // ... sustained for 30 s
  tripMarginK: 10,               // SCRAM when a temperature is within 10 K of its limit
  doseLimitSurfaceUSvh: 2,       // can-surface dose-equivalent limit (uSv/h)
  doseLimit1mUSvh: 0.114,        // public limit ~1 mSv/y at 1 m, continuous (alarm only)
  fatigueAlarm: 0.5,             // accumulated Miner damage that triggers SCRAM
  fatigueFailure: 1.0,           // accumulated Miner damage at which the mount fails
  scramHoldS: 30,                // a SCRAM-state temperature limit that persists this long is an accident
  autoCoreKill: true,            // destroy and poison the core on any accident
  scramCutsGenerator: true,      // a SCRAM switches off an external neutron generator (not Cf-252)
  voting: '2oo3',                // '2oo3' or '1oo1'
};

export const ACCIDENT_LABELS = {
  prompt_critical: 'Prompt-critical excursion (rho >= beta)',
  fuel_melt: 'Fuel melting',
  clad_breach: 'Cladding breach (over clad limit)',
  coolant_overtemp: 'Coolant over-temperature / boiling',
  coolant_freeze: 'Coolant freeze',
  loss_of_cooling: 'Loss of cooling (flow)',
  structural_fatigue: 'Mount fatigue failure',
  structural_yield: 'Mount yield (3 sigma)',
  dose_exceeded: 'Radiation limit exceeded',
  scram_failed: 'Heat not removed after SCRAM',
  manual_kill: 'Manual core kill',
};

export const TRIP_LABELS = {
  overpower: 'Overpower (measured power)',
  low_flow: 'Low flow (measured)',
  temperature: 'Temperature near limit',
  dose: 'Dose above limit (measured)',
  fatigue: 'Fatigue damage alarm',
  manual: 'Manual SCRAM',
};

// A noisy sensor reading.
//   spec: { relNoise (fraction of value), absNoise (units of value), bias (fraction),
//           absBias (units of value), extraNoise (added fraction, e.g. from vibration) }
export function sensorReading(trueValue, spec, rng) {
  const rel = spec.relNoise + (spec.extraNoise || 0);
  return trueValue * (1 + spec.bias + rel * rng.gaussian())
    + (spec.absBias || 0)
    + spec.absNoise * rng.gaussian();
}

// Three sensors per channel with biases drawn once per run (fixed for the run).
//   biasRange: relative bias range (+/- fraction); absBiasRange: additive bias range (value units)
export function makeSensorSet(rng, { relNoise = 0, absNoise = 0, biasRange = 0, absBiasRange = 0 }) {
  return [0, 1, 2].map(() => ({
    relNoise,
    absNoise,
    bias: biasRange * (2 * rng.next() - 1),
    absBias: absBiasRange * (2 * rng.next() - 1),
  }));
}

// Vote on a boolean condition across sensors. mode '2oo3' trips when at least two of three
// readings satisfy the test; '1oo1' uses the first sensor only.
export function vote(readings, test, mode = '2oo3') {
  if (mode === '1oo1') return test(readings[0]);
  let n = 0;
  for (const r of readings) if (test(r)) n++;
  return n >= 2;
}
