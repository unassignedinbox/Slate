// Runs the material and condition campaign and writes docs/campaign.json and docs/CAMPAIGN.md.
// Usage: node scripts/run-campaign.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materialSweep, scenarioMatrix, repeatRuns, mountSweep, runScenario } from '../src/physics/campaign.js';
import { SCENARIOS } from '../src/physics/scenarios.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();

const sweep = materialSweep();
const matrix = scenarioMatrix();
const mounts = mountSweep();
const nominal = SCENARIOS.find((s) => s.id === 'nominal');
const repeats = repeatRuns({}, nominal, [1, 2, 3, 4, 5]);
// Each material level under the same pump-trip case, so the failure behaviour can be compared.
const pumpTrip = SCENARIOS.find((s) => s.id === 'pump_trip');
const pumpByCoolant = ['H2O', 'D2O', 'HE', 'NA', 'LBE', 'FLIBE'].map((c) => ({
  coolant: c, ...runScenario({ materials: { coolant: c } }, pumpTrip, 1),
}));

const out = { generatedAt: new Date().toISOString(), runtimeMs: null, sweep, matrix, mounts, repeats, pumpByCoolant };
out.runtimeMs = Date.now() - t0;

const dir = resolve(root, 'docs');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'campaign.json'), JSON.stringify(out, null, 2));

const f = (v, d = 3) => (v === null || v === undefined ? '-' : Number(v).toPrecision(d));
const lines = [];
lines.push('# Campaign results', '', `Generated ${out.generatedAt} (runtime ${out.runtimeMs} ms). Produced by \`npm run campaign\`.`, '');
lines.push('## Material sweep (one factor at a time, default design otherwise)', '');
lines.push('Surface-dose columns hold the source fixed (no multiplication), so they compare shielding transmission only.', '');
lines.push('| Factor | Level | Valid | k_eff | k_inf | p (resonance escape) | P_NL | Lambda (s) | rho rods in | rho rods out | Mass (kg) | Surface dose per 1e6 n/s (uSv/h) | Surface dose per 1e6 photons/s (uSv/h) | Reason if rejected |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of sweep) {
  lines.push(`| ${r.factor} | ${r.level} | ${r.valid ? 'yes' : 'no'} | ${f(r.kEff)} | ${f(r.kInf)} | ${f(r.p)} | ${f(r.PNL)} | ${f(r.Lambda)} | ${f(r.rhoIn)} | ${f(r.rhoOut)} | ${f(r.massKg)} | ${f(r.surfaceDosePer1e6n)} | ${f(r.surfaceDosePer1e6gamma)} | ${r.valid ? '' : (r.reasons[0] || '').replace(/\|/g, '/')} |`);
}
lines.push('', '## Scenario matrix (default design, seed 1)', '');
lines.push('| Scenario | Outcome | Trips | Accidents | P end (W) | T_fuel max (C) | Dose at surface (uSv/h) | Energy Th (J) | Energy E (J) |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of matrix) {
  if (r.rejected) { lines.push(`| ${r.name} | rejected | | | | | | | |`); continue; }
  lines.push(`| ${r.name} | ${r.state} | ${r.trips.map((t) => `${t.reason}@${f(t.t, 4)}s`).join(', ') || '-'} | ${r.accidents.map((a) => `${a.reason}@${f(a.t, 4)}s`).join(', ') || '-'} | ${f(r.Pfis)} | ${f(r.TfMaxC, 4)} | ${f(r.dose.surface)} | ${f(r.energyThJ)} | ${f(r.energyEJ)} |`);
}
lines.push('', '## Vibration: mount diameter sweep (truck profile, L = 20 mm, 60 s)', '');
lines.push('| Structure | d (mm) | f_n (Hz) | z_rms (mm) | sigma_rms (MPa) | Yield (MPa) | Peak 3-sigma (MPa) | Predicted life (s) | Failed | First failure (s) |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of mounts) {
  lines.push(`| ${r.structure} | ${r.dMm} | ${f(r.fnHz, 4)} | ${f(r.zRmsMm)} | ${f(r.sigmaRmsMPa, 4)} | ${f(r.yieldMPa, 4)} | ${f(r.peakMPa, 4)} | ${f(r.predictedLifeS)} | ${r.failed ? 'yes' : 'no'} | ${f(r.firstFailT, 4)} |`);
}
lines.push('', '## Reliability: nominal case over 5 seeds', '');
lines.push(repeats.rejected ? `Rejected: ${repeats.reason}` : `- Runs: ${repeats.n}
- Trips total: ${repeats.tripCount}; accidents total: ${repeats.accidentCount}
- Thermal energy: mean ${f(repeats.meanEnergyThJ)} J, sd ${f(repeats.sdEnergyThJ)} J
- Fuel max temperature: mean ${f(repeats.meanTfMaxC, 5)} C, sd ${f(repeats.sdTfMaxC, 3)} C`);
lines.push('', '## Pump trip at 60 s by coolant', '');
lines.push('| Coolant | Outcome | Trips | Accidents |');
lines.push('|---|---|---|---|');
for (const r of pumpByCoolant) {
  if (r.rejected) { lines.push(`| ${r.coolant} | rejected: ${r.reason.slice(0, 120)} | | |`); continue; }
  lines.push(`| ${r.coolant} | ${r.state} | ${r.trips.map((t) => `${t.reason}@${f(t.t, 4)}s`).join(', ') || '-'} | ${r.accidents.map((a) => `${a.reason}@${f(a.t, 4)}s`).join(', ') || '-'} |`);
}
writeFileSync(resolve(dir, 'CAMPAIGN.md'), lines.join('\n') + '\n');
console.log(`campaign done in ${out.runtimeMs} ms: sweep ${sweep.length}, scenarios ${matrix.length}, mounts ${mounts.length}`);
