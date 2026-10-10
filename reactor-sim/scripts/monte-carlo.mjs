// Generates public/data/monte-carlo.json: scenario Monte Carlo (N seeded runs each) and a
// material comparison under identical random events. Run: node scripts/monte-carlo.mjs [N]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { monteCarlo, SCENARIOS } from '../src/physics/scenarios.js';
import { defaultDesign, checkDesign } from '../src/physics/design.js';
import { FUELS, COOLANTS, CONVERTERS } from '../src/physics/materials.js';

const N = Number(process.argv[2] ?? 50);
const NCOMP = Math.max(5, Math.round(N * 0.4));
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/data/monte-carlo.json');
const t0 = Date.now();

const scenarioKeys = Object.keys(SCENARIOS);
const scenarios = {};
for (const key of scenarioKeys) {
  scenarios[key] = monteCarlo({}, key, { n: N, seed0: 1000 });
  console.error(`scenario ${key} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const compareKeys = ['vibration', 'severeVibration', 'pumpTrip'];
const compare = [];
const variants = [];
for (const fuel of Object.keys(FUELS)) variants.push({ label: FUELS[fuel].name, overrides: { fuel } });
for (const coolant of Object.keys(COOLANTS)) {
  variants.push({
    label: COOLANTS[coolant].name,
    overrides: { coolant, coolantPressureMPa: COOLANTS[coolant].defaultPressureMPa },
  });
}
for (const converter of Object.keys(CONVERTERS)) {
  variants.push({ label: CONVERTERS[converter].name, overrides: { converter } });
}
for (const structure of ['ss316', 'inconel718', 'ti64']) {
  variants.push({ label: `Support structure: ${structure}`, overrides: { structure } });
}

for (const v of variants) {
  const design = { ...defaultDesign(), ...v.overrides };
  const check = checkDesign(design);
  if (!check.ok) {
    compare.push({ label: v.label, overrides: v.overrides, valid: false, violations: check.violations });
    continue;
  }
  const byScenario = {};
  for (const key of compareKeys) {
    const r = monteCarlo(v.overrides, key, { n: NCOMP, seed0: 5000 });
    byScenario[key] = {
      outcomes: r.outcomes,
      pDestroyed: r.pDestroyed,
      pConverterFailed: r.pConverterFailed,
      meanElectricW: r.meanElectricW,
      meanPeakTfK: r.meanPeakTfK,
    };
  }
  compare.push({ label: v.label, overrides: v.overrides, valid: true, warnings: check.warnings, byScenario });
  console.error(`variant ${v.label} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

const payload = {
  generatedBy: 'scripts/monte-carlo.mjs',
  generatedAt: new Date().toISOString(),
  N,
  compareN: NCOMP,
  seeds: { scenarios: 'seed0 = 1000', comparison: 'seed0 = 5000' },
  scenarios,
  compare,
};
writeFileSync(out, JSON.stringify(payload, null, 1));
console.error(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
