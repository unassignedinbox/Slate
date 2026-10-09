// Headless smoke test: evaluate every preset through the full pipeline.
import { presets, makeDocument } from '../presets.js';
import { compositeStack, computeSignals } from '../terrain.js';
import { compositeSatmap, signalImage } from '../satmap.js';
import { layerDefaults, layerKinds, evalMask, maskKinds, Heightfield } from '../heightfield.js';
import { hydraulicErode, thermalErode, windErode, riverIncise, flowAccumulation } from '../erosion.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { failures++; console.error(`  ✗ ${name} ${extra}`); }
  else console.log(`  ✓ ${name}`);
};

for (const preset of presets) {
  console.log(`\n[${preset.name}]`);
  const doc = makeDocument(preset, { resolution: 160 });
  const t0 = performance.now();
  const { field, extra } = compositeStack(doc.layers, doc.resolution, { sunAz: doc.sun.azimuth, sunEl: doc.sun.elevation });
  const t1 = performance.now();
  const signals = computeSignals(field, extra, doc.sun.azimuth, doc.sun.elevation);
  const sat = compositeSatmap(signals, doc.satLayers, doc.resolution);
  const t2 = performance.now();

  const { min, max } = field.minMax();
  check('finite heights', Number.isFinite(min) && Number.isFinite(max), `min=${min.toFixed(3)} max=${max.toFixed(3)}`);
  check('relief present', max - min > 0.02, `span=${(max - min).toFixed(3)}`);
  check('satmap size', sat.length === doc.resolution * doc.resolution * 4);
  let bad = 0;
  for (let i = 0; i < sat.length; i++) if (!Number.isFinite(sat[i])) bad++;
  check('satmap finite', bad === 0, `${bad} bad bytes`);
  let variance = 0;
  for (const s of Object.values(signals.arrays)) {
    if (!s) continue;
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < s.length; i++) { if (s[i] < mn) mn = s[i]; if (s[i] > mx) mx = s[i]; }
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) bad++;
    variance += mx - mn;
  }
  check('signals sane', bad === 0 && variance > 0.1, `varSum=${variance.toFixed(2)}`);
  console.log(`    sim ${(t1 - t0).toFixed(0)}ms · satmap ${(t2 - t1).toFixed(0)}ms · elev ${min.toFixed(3)}–${max.toFixed(3)}`);
}

// mask evaluation coverage
console.log('\n[masks]');
const hf = new Heightfield(24);
for (let i = 0; i < hf.data.length; i++) hf.data[i] = Math.sin(i * 0.01) * 0.3 + 0.4;
const sig = computeSignals(hf, {});
for (const [k, spec] of Object.entries(maskKinds)) {
  const m = evalMask({ type: k, params: spec.defaults }, 0.5, 0.5, sig);
  check(`mask ${k}`, Number.isFinite(m) && m >= 0 && m <= 1, `v=${m.toFixed(2)}`);
}

// erosion unit behaviour
console.log('\n[erosion]');
{
  const f = new Heightfield(64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) f.data[y * 64 + x] = 0.5 - Math.hypot(x - 32, y - 32) / 90;
  const before = f.data[32 * 64 + 32];
  const r = hydraulicErode(f, { ...layerKinds.hydraulic.defaults, droplets: 4000, lifetime: 30 });
  check('hydraulic runs', r.flow?.length === 64 * 64 && r.deposition?.length === 64 * 64);
  check('hydraulic alters field', f.minMax().max !== before);
  const t = thermalErode(f, { talus: 0.4, iterations: 10, rate: 0.5 });
  check('thermal runs', t.slide?.length === 64 * 64);
  const w = windErode(f, { strength: 0.5, direction: 30, abrasion: 0.5, deposition: 0.5, duneScale: 2, iterations: 5, seed: 3 });
  check('wind runs', w.drift?.length === 64 * 64);
  const rv = riverIncise(f, { power: 1.3, depth: 0.2, bankSoftness: 0.4, threshold: 0.05, tributary: 0.5 });
  check('river runs', rv.flow?.length === 64 * 64);
  const acc = flowAccumulation(f);
  let sum = 0; for (let i = 0; i < acc.length; i++) sum += acc[i];
  check('flow accumulation positive', sum > acc.length, `sum=${sum.toFixed(0)}`);
}

console.log(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
process.exit(failures ? 1 : 0);
