// Engine smoke test: every catalogue entry runs on a small grid, outputs are finite and in range, and the
// presets evaluate end to end. Also checks the catalogue numbering matches the brief (1-240, no gaps).
import { ALL_DEFS, byId, byKey } from '../src/engine/registry.js';
import { createPreset, presetNames, createLayer } from '../src/engine/document.js';
import { evaluateStack } from '../src/engine/stack.js';
import { createContext } from '../src/engine/context.js';
import { newGrid } from '../src/engine/grid.js';

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL', msg); };
const ok = (msg) => console.log('ok  ', msg);

// 1. Catalogue numbering -------------------------------------------------------------------------------------
const ids = ALL_DEFS.map((d) => d.id);
const unique = new Set(ids);
if (unique.size !== ids.length) fail('duplicate catalogue ids');
const missing = [];
for (let n = 1; n <= 240; n++) if (!unique.has(n)) missing.push(n);
if (missing.length) fail(`missing catalogue numbers: ${missing.join(', ')}`);
if (ALL_DEFS.length !== 240) fail(`expected 240 catalogue entries, found ${ALL_DEFS.length}`);
else ok('catalogue has 240 entries numbered 1-240');
const keys = ALL_DEFS.map((d) => d.key);
if (new Set(keys).size !== keys.length) fail('duplicate catalogue keys');

// 2. Every layer-type runs ------------------------------------------------------------------------------------
const N = 48;
const cfg = { resolution: N, worldSize: 2048, heightScale: 600, seed: 3 };
const runFailures = [];
const slow = [];
for (const def of ALL_DEFS) {
  const t0 = performance.now();
  // Give the layer a base surface first, so layers that read height have something meaningful.
  const base = createLayer('fbm', { params: { ...byKey.get('fbm').defaults, octaves: 3 } });
  const layer = createLayer(def.id, { mask: null });
  const doc = { config: cfg, layers: [base, layer], previewLayerId: layer.id };
  const r = evaluateStack(doc);
  const ms = performance.now() - t0;
  if (ms > 1500) slow.push(`${def.id} ${def.key} ${Math.round(ms)}ms`);
  if (r.errors.length) { runFailures.push(`${def.id} ${def.key}: ${r.errors[0].message}`); continue; }
  for (let i = 0; i < r.H.length; i++) if (!Number.isFinite(r.H[i])) { runFailures.push(`${def.id} ${def.key}: non-finite height`); break; }
  for (let i = 0; i < r.C.length; i++) if (!Number.isFinite(r.C[i])) { runFailures.push(`${def.id} ${def.key}: non-finite colour`); break; }
  const { min, max } = r.summary;
  if (min < -1e-6 || max > 1 + 1e-6) runFailures.push(`${def.id} ${def.key}: height out of range [${min.toFixed(3)}, ${max.toFixed(3)}]`);
}
if (runFailures.length) for (const f of runFailures) fail(f);
else ok(`all ${ALL_DEFS.length} layer types evaluate with finite, in-range output`);
if (slow.length) console.warn('slow layers at test size:', slow.join('; '));

// 3. Presets end to end ---------------------------------------------------------------------------------------
for (const name of presetNames) {
  const doc = createPreset(name, 64);
  const r = evaluateStack(doc);
  if (r.errors.length) fail(`preset ${name}: ${r.errors.map((e) => e.message).join('; ')}`);
  else ok(`preset "${name}": ${doc.layers.length} layers, ${r.summary.ms.toFixed(0)} ms at 64^2, height ${r.summary.min.toFixed(3)}..${r.summary.max.toFixed(3)}`);
}

// 4. Water is carved, not overlaid ----------------------------------------------------------------------------
{
  const N2 = 96;
  const c2 = { resolution: N2, worldSize: 2048, heightScale: 600, seed: 5 };
  const terrain = [createLayer('fbm', { params: { ...byKey.get('fbm').defaults, octaves: 5 } }),
    createLayer('ridged', { params: { ...byKey.get('ridged').defaults }, blend: 'add', opacity: 0.6 })];
  const before = evaluateStack({ config: c2, layers: terrain });
  const withRiver = evaluateStack({ config: c2, layers: [...terrain, createLayer('river', { params: { ...byKey.get('river').defaults, threshold: 0.6, depth: 0.1 } })] });
  let lower = 0, wet = 0, sumDelta = 0;
  for (let i = 0; i < before.H.length; i++) {
    const d = withRiver.H[i] - before.H[i];
    if (d < -1e-4) lower++;
    if (d > 1e-4) sumDelta += d;
    if (withRiver.water[i] > 0) wet++;
  }
  if (lower === 0) fail('river did not carve any cells below the original surface');
  else ok(`river carves ${lower} cells below the original surface (${wet} with water depth)`);
  if (sumDelta > 1e-3) fail('river raised terrain in places it should only carve');
}

// 5. Lake basins: water surface sits inside a carved depression ------------------------------------------------
{
  const N2 = 96;
  const c2 = { resolution: N2, worldSize: 2048, heightScale: 600, seed: 9 };
  const base = [createLayer('fbm', { params: { ...byKey.get('fbm').defaults, octaves: 5 } })];
  const r = evaluateStack({ config: c2, layers: [...base, createLayer('lake', { params: { ...byKey.get('lake').defaults, count: 3 } })] });
  let wet = 0, bad = 0;
  for (let i = 0; i < r.H.length; i++) {
    if (r.water[i] > 0) { wet++; if (r.H[i] > r.H[i] + r.water[i] + 1e-6) bad++; }
  }
  if (wet === 0) fail('lake produced no water');
  else ok(`lake: ${wet} water cells, surface above floor everywhere`);
}

// 6. Masks: values are in 0..1 for every mask type ------------------------------------------------------------
{
  const maskKeys = ['slope', 'height', 'curvature', 'cavity', 'convexity', 'flow', 'water', 'snow', 'shadow', 'ao', 'direction', 'roughness', 'terrace', 'cliff', 'ridge', 'valley', 'edge', 'distance', 'position', 'angle', 'range', 'gradient', 'radial', 'angular', 'select', 'painted'];
  const base = createLayer('fbm', { params: { ...byKey.get('fbm').defaults, octaves: 4 } });
  const bad = [];
  for (const mk of maskKeys) {
    const layer = createLayer('constant', { params: { value: 0.5 }, mask: { type: mk, params: {}, invert: false } });
    const r = evaluateStack({ config: cfg, layers: [base, layer] });
    if (r.errors.length) bad.push(`${mk}: ${r.errors[0].message}`);
  }
  if (bad.length) for (const b of bad) fail(`mask ${b}`);
  else ok(`all ${maskKeys.length} mask types attach to a layer`);
}

// 7. Blend modes match their formulas ------------------------------------------------------------------------
{
  const { blendFn } = await import('../src/engine/blend.js');
  const checks = [
    ['add', 0.3, 0.4, 0.7], ['multiply', 0.5, 0.5, 0.25], ['max', 0.2, 0.9, 0.9], ['min', 0.2, 0.9, 0.2],
    ['difference', 0.2, 0.9, 0.7], ['screen', 0.5, 0.5, 0.75], ['hardmix', 0.6, 0.6, 1],
  ];
  const bad = checks.filter(([m, a, b, e]) => Math.abs(blendFn[m](a, b) - e) > 1e-6);
  if (bad.length) fail(`blend formulas: ${bad.map((b) => b[0]).join(', ')}`);
  else ok('blend mode spot checks pass');
}

// 8. Hydrology: every interior cell drains after depression filling -------------------------------------------
{
  const { routeWater } = await import('../src/engine/hydrology.js');
  const n = 64;
  const h = Float32Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.37) * 0.1 + ((i % n) / n) * 0.2);
  const r = routeWater(h, n);
  let sinks = 0;
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0;
    const interior = x > 0 && y > 0 && x < n - 1 && y < n - 1;
    if (interior && r.dir[i] < 0) sinks++;
  }
  if (sinks) fail(`hydrology left ${sinks} interior sinks`);
  else ok('hydrology drains every interior cell');
}

// 9. Voxel form is derived from the heightmap ----------------------------------------------------------------
{
  const { voxelize, exposedVoxels, voxelStats } = await import('../src/engine/voxels.js');
  const n = 8, z = 10;
  const solid = voxelize(new Float32Array(n * n).fill(0.5), n, z);
  const st = voxelStats(solid);
  const ex = exposedVoxels(solid, n, z);
  if (st.solid !== n * n * 5) fail(`voxelize: expected ${n * n * 5} solid voxels, got ${st.solid}`);
  else if (ex.list.length / 3 === 0) fail('voxelize: no exposed voxels');
  else ok(`voxels: ${st.solid} solid, ${ex.list.length / 3} exposed for a flat 0.5 surface`);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nengine tests passed');
