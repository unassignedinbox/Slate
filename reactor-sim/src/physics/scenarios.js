// Scenario library and Monte Carlo runner.
//
// Each run draws its own random conditions from the same seeded RNG: sensor noise and pump
// tolerance (inside the simulation), plus event timing jitter, vibration severity, ambient
// temperature and heat-sink conductance (drawn here). Outcome probabilities carry Wilson 95 %
// confidence intervals.

import { ReactorSimulation, outcomeOf } from './reactor.js';
import { defaultDesign } from './design.js';
import { createRng } from './rng.js';

const T0 = 60; // nominal event time after the warm-up hand-over (s)

/** Scenario definitions. `events(rng)` returns the timeline for one run. */
export const SCENARIOS = {
  nominal: {
    label: 'Nominal operation',
    description: 'Steady operation at rated power with sensor noise and pump tolerance.',
    duration: 600,
    protection: true,
    events: () => [],
  },
  pumpTrip: {
    label: 'Pump trip',
    description: 'Pump coasts down at T+60 s. Flow-loss trip should SCRAM the reactor.',
    duration: 400,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'pumpTrip' }],
  },
  vibration: {
    label: 'Sustained vibration',
    description: 'Vibration environment rises to 3-10× the design PSD (randomised).',
    duration: 600,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'vibration', params: { multiplier: r.range(3, 10) } }],
  },
  severeVibration: {
    label: 'Severe vibration (shock)',
    description: 'Vibration rises to 30-100× the design PSD for the rest of the run.',
    duration: 3600,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'vibration', params: { multiplier: r.range(30, 100) } }],
  },
  sinkLoss: {
    label: 'Heat-sink loss',
    description: 'External heat-sink conductance drops to 0-10 % of design at T+60 s.',
    duration: 1800,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'sink', params: { factor: r.range(0, 0.1) } }],
  },
  hotAmbient: {
    label: 'Hot ambient (+40 K)',
    description: 'Ambient rises by 35-45 K at T+60 s.',
    duration: 1200,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'ambient', params: { K: 293.15 + r.range(35, 45) } }],
  },
  unprotectedWithdraw: {
    label: 'Rod withdrawal, no protection',
    description: 'Trips disabled. Operator withdraws rods at 0.05-0.5 /s at T+60 s.',
    duration: 600,
    protection: false,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'withdraw', params: { rate: r.range(0.05, 0.5) } }],
  },
  stuckRodsPumpTrip: {
    label: 'Stuck rods and pump trip',
    description: 'Rod drive faults (all rods stick), pump trips at T+60 s, operator SCRAM at T+90 s.',
    duration: 600,
    protection: true,
    events: (r) => [
      { t: 30, action: 'stuckRods' },
      { t: jitter(r, T0, 10), action: 'pumpTrip' },
      { t: T0 + 30, action: 'scram' },
    ],
  },
  kill: {
    label: 'Core kill',
    description: 'Permanent poison injection at T+60 s.',
    duration: 600,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'kill' }],
  },
  destroy: {
    label: 'Core destruction',
    description: 'Accident response destroys the core at T+60 s: fission stops, decay heat and release remain.',
    duration: 600,
    protection: true,
    events: (r) => [{ t: jitter(r, T0, 10), action: 'destroy' }],
  },
};

function jitter(r, centre, half) {
  return Math.max(1, centre + r.range(-half, half));
}

/**
 * Run one scenario. `designOverrides` is merged into defaultDesign().
 * Returns the simulation and a flat summary.
 */
export function runScenario(designOverrides = {}, scenarioKey = 'nominal', { seed = 1, noise = true, dt = 0.01, warmUpS = 3000 } = {}) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw new Error(`Unknown scenario ${scenarioKey}`);
  const design = { ...defaultDesign(), ...designOverrides };
  const draw = createRng(seed * 7919 + 17); // independent stream for event draws
  const timeline = scenario.events(draw);
  const sim = new ReactorSimulation(design, { seed, noise, dt, warmUpS, protection: scenario.protection });
  // track the peak fuel temperature and the converter output over the run
  sim.run(scenario.duration, timeline);
  return { sim, summary: summarise(sim, scenario, timeline) };
}

export function summarise(sim, scenario, timeline) {
  const s = sim.snapshot();
  const duration = scenario.duration;
  const scramEvent = sim.events.find((e) => e.message.startsWith('SCRAM requested'));
  return {
    scenario: scenario.label,
    outcome: outcomeOf(sim),
    destroyed: sim.destroyed,
    destroyCause: sim.destroyCause,
    breach: sim.breach,
    converterFailed: sim.converterFailed,
    fuelDamaged: sim.fuelDamaged,
    scramTime: scramEvent ? scramEvent.t : null,
    tripCauses: s.tripCauses,
    maxTf: sim.maxima.Tf,
    maxTc: sim.maxima.Tc,
    maxTw: sim.maxima.Tw,
    peakGrms: sim.maxima.grms,
    fatigueDamage: sim.fatigueDamage,
    meanElectricW: sim.energy.electric / Math.max(sim.t, 1e-9),
    meanThermalW: sim.energy.thermal / Math.max(sim.t, 1e-9),
    energyThermalJ: sim.energy.thermal,
    energyElectricJ: sim.energy.electric,
    finalN: s.n,
    finalPth: s.Pth,
    duration,
    timeline: timeline.map((e) => ({ t: e.t, action: e.action })),
  };
}

/** Wilson score interval for a binomial proportion (z = 1.96 for 95 %). */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Monte Carlo over N seeded runs of one scenario.
 * Returns outcome counts, probabilities with Wilson 95 % intervals, and power statistics.
 */
export function monteCarlo(designOverrides, scenarioKey, { n = 50, seed0 = 1, ...opts } = {}) {
  const outcomes = {};
  const electric = [];
  const peakTf = [];
  const grms = [];
  let destroyed = 0;
  let breach = 0;
  let converterFail = 0;
  let fuelDamaged = 0;
  const causes = {};
  for (let i = 0; i < n; i += 1) {
    const { summary } = runScenario(designOverrides, scenarioKey, { seed: seed0 + i, ...opts });
    outcomes[summary.outcome] = (outcomes[summary.outcome] || 0) + 1;
    if (summary.destroyed) {
      destroyed += 1;
      causes[summary.destroyCause] = (causes[summary.destroyCause] || 0) + 1;
    }
    if (summary.breach) breach += 1;
    if (summary.converterFailed) converterFail += 1;
    if (summary.fuelDamaged) fuelDamaged += 1;
    electric.push(summary.meanElectricW);
    peakTf.push(summary.maxTf);
    grms.push(summary.peakGrms);
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
  };
  return {
    scenario: SCENARIOS[scenarioKey].label,
    n,
    seed0,
    outcomes,
    pDestroyed: wilson(destroyed, n),
    pBreach: wilson(breach, n),
    pConverterFailed: wilson(converterFail, n),
    pFuelDamaged: wilson(fuelDamaged, n),
    destroyCauses: causes,
    meanElectricW: mean(electric),
    sdElectricW: sd(electric),
    meanPeakTfK: mean(peakTf),
    maxPeakTfK: Math.max(...peakTf),
    meanPeakGrms: mean(grms),
  };
}
