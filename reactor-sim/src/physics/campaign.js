// Material and condition campaign. Compares swappable materials (one factor at a time against the
// default design) and records how each one behaves or fails. Pure functions; no I/O here.
// The Node driver is scripts/run-campaign.mjs.

import { createReactor, buildBaseModel } from './reactor.js';
import { doseAt } from './radiation.js';
import { SCENARIOS } from './scenarios.js';

// Factor levels to compare. Each factor is varied alone, with the others at the default.
export const FACTORS = {
  fuel: ['UO2', 'UN', 'UCO_KERNEL', 'TRISO'],
  cladding: ['ZRY4', 'SS316L', 'IN718', 'SIC_SIC'],
  moderator: ['NONE', 'GRAPHITE', 'ZRH', 'BEO'],
  reflector: ['BE', 'GRAPHITE', 'BEO', 'SS316L'],
  shield: ['W', 'PB', 'BPE', 'SS316L', 'B4C'],
  coolant: ['H2O', 'D2O', 'HE', 'NA', 'LBE', 'FLIBE'],
  structure: ['SS316L', 'IN718', 'TI64'],
  te: ['BI2TE3', 'PBTE', 'SIGE'],
  absorber: ['B4C', 'HF', 'AGINCD', 'GD2O3'],
};

// Summarise a run for the report.
export function summariseRun(reactor, rec) {
  const x = rec.at(-1);
  const st = reactor.state;
  const first = (reason) => st.accidents.find((a) => a.reason === reason)?.t ?? null;
  return {
    state: x.state,
    Pfis: x.Pfis, Pth: x.Pth, Pe: x.Pe, etaTE: x.etaTE, energyThJ: x.energyThJ, energyEJ: x.energyEJ,
    TfMaxC: x.TfMaxC, TcladMaxC: x.TcladMaxC, TbC: x.TbC, TwC: x.TwC,
    dose: x.dose, vib: x.vib,
    trips: st.trips.map((t) => ({ reason: t.reason, t: t.t })),
    accidents: st.accidents.map((a) => ({ reason: a.reason, t: a.t })),
    killReason: st.killReason, tKill: st.tKill,
    firstTripT: st.trips[0]?.t ?? null,
    firstAccidentT: st.accidents[0]?.t ?? null,
    accidentTimes: Object.fromEntries(['coolant_overtemp', 'loss_of_cooling', 'structural_fatigue', 'dose_exceeded'].map((r) => [r, first(r)])),
    mass: x.mass,
  };
}

// Predicted mount life (s) from the accumulated Miner damage rate, if the mount has not failed.
export function predictedLifeS(sum) {
  const rate = sum.vib?.dRate;
  if (!rate || rate <= 0) return Infinity;
  return 1 / rate;
}

// One-factor-at-a-time: base build report for each level.
export function materialSweep({ baseConfig = {}, factors = FACTORS } = {}) {
  const rows = [];
  for (const [factor, levels] of Object.entries(factors)) {
    for (const level of levels) {
      const cfg = { ...baseConfig, materials: { ...(baseConfig.materials || {}), [factor]: level } };
      let B;
      try {
        B = buildBaseModel(cfg);
      } catch (e) {
        rows.push({ factor, level, valid: false, reasons: [e.message] });
        continue;
      }
      // Transmission at a fixed source (no multiplication): surface dose per 1e6 neutrons/s and per
      // 1e6 photons/s through the radial stack. This isolates shielding from the k_eff change that a
      // different shield causes, which a fixed-power comparison would mix in.
      const perNeutron = doseAt({ d: B.paths.dSideCm, path: B.paths.radial, Sn_eff: 1e6, Sg: 0 }).neutron;
      const perPhoton = doseAt({ d: B.paths.dSideCm, path: B.paths.radial, Sn_eff: 0, Sg: 1e6 }).gamma;
      rows.push({
        factor, level,
        valid: B.valid,
        reasons: B.validity.reasons,
        kEff: B.k0, kInf: B.kInf0, p: B.ff.p, PNL: B.PNL, Lambda: B.Lambda,
        rhoIn: B.rhoIn, rhoOut: B.rhoOut, massKg: B.thermal.mTotal,
        surfaceDosePer1e6n: perNeutron, surfaceDosePer1e6gamma: perPhoton,
      });
    }
  }
  return rows;
}

// Run a named scenario for one configuration. Returns the summary, or the rejection reason.
export function runScenario(config, scenario, seed = 1) {
  let reactor;
  try {
    reactor = createReactor({ ...config, ...scenario.config, seed });
  } catch (e) {
    return { rejected: true, reason: e.message };
  }
  const rec = reactor.run(scenario.dt, scenario.duration, { sampleEvery: Math.max(scenario.dt, scenario.duration / 10) });
  return { rejected: false, ...summariseRun(reactor, rec) };
}

// Repeated runs for reliability: same physics, different sensor/pulsation seeds.
export function repeatRuns(config, scenario, seeds = [1, 2, 3, 4, 5]) {
  const runs = seeds.map((seed) => runScenario(config, scenario, seed));
  if (runs.some((r) => r.rejected)) return { rejected: true, reason: runs.find((r) => r.rejected).reason };
  const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  const sd = (f) => {
    const m = mean(f);
    return Math.sqrt(runs.reduce((a, r) => a + (f(r) - m) ** 2, 0) / Math.max(1, runs.length - 1));
  };
  return {
    rejected: false,
    n: runs.length,
    meanEnergyThJ: mean((r) => r.energyThJ),
    sdEnergyThJ: sd((r) => r.energyThJ),
    meanTfMaxC: mean((r) => r.TfMaxC),
    sdTfMaxC: sd((r) => r.TfMaxC),
    tripCount: runs.reduce((a, r) => a + r.trips.length, 0),
    accidentCount: runs.reduce((a, r) => a + r.accidents.length, 0),
  };
}

// Vibration life across mount diameters for each structural alloy.
export function mountSweep({ materials = ['SS316L', 'IN718', 'TI64'], dMm = [6, 8, 10, 12, 16], profile = 'truck', L = 20, duration = 60 } = {}) {
  const rows = [];
  for (const structure of materials) {
    for (const d of dMm) {
      const cfg = {
        materials: { structure },
        vibration: { profile, scale: 1 },
        support: { dMm: d, LMm: L, zeta: null },
        safety: { autoCoreKill: false },
      };
      const reactor = createReactor(cfg);
      const rec = reactor.run(0.1, duration, { sampleEvery: duration });
      const x = rec.at(-1);
      rows.push({
        structure, dMm: d, LMm: L, profile,
        fnHz: x.vib.fn, zRmsMm: x.vib.zRmsMm, sigmaRmsMPa: x.vib.sigmaRmsMPa, yieldMPa: x.vib.yieldMPa,
        peakMPa: x.vib.peakMPa, damageAfter: x.vib.damage,
        predictedLifeS: predictedLifeS(x),
        failed: reactor.state.accidents.some((a) => a.reason.startsWith('structural')),
        firstFailT: reactor.state.accidents.find((a) => a.reason.startsWith('structural'))?.t ?? null,
      });
    }
  }
  return rows;
}

// Scenario matrix on the default design.
export function scenarioMatrix({ scenarios = SCENARIOS, config = {} } = {}) {
  return scenarios.map((s) => ({ id: s.id, name: s.name, ...runScenario(config, s, 1) }));
}
