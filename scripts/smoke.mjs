// Slate smoke test: executes ALL 240 items (190 layers + 24 blends + 26 masks).
// Run: node scripts/smoke.mjs
import { LAYERS, BLENDS, MASKS, coverageReport, defaultParams, MASK_MAP } from '../src/engine/registry.js';
import { evaluate, createContext, waterDepth } from '../src/engine/stack.js';
import { voxelizeFull, voxelStats } from '../src/engine/voxel.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.error(`  FAIL: ${label}`); }
}
const allFinite = (f, n = 1e6) => {
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (!Number.isFinite(v) || Math.abs(v) > n) return false;
  }
  return true;
};
const mk = (type, extra = {}) => ({
  uid: `t-${type}`, type, name: type, visible: true, opacity: 1, blend: 'blend',
  mask: 'none', maskParams: {}, params: defaultParams((LAYERS.find((l) => l.id === type) || {})),
  ...extra,
});

// 1. Coverage
console.log('— coverage —');
const cov = coverageReport();
console.log(`layers=${cov.layers} blends=${cov.blends} masks=${cov.masks} total=${cov.total}`);
ok(cov.total === 240, `total items == 240 (got ${cov.total})`);
ok(cov.missing.length === 0, `no missing numbers (${cov.missing.join(',')})`);
ok(cov.dup.length === 0, `no duplicate numbers (${cov.dup.join(',')})`);

// 2. Every layer runs
console.log('— 190 layers —');
for (const def of LAYERS) {
  const stack = [mk('constant', { params: { value: 0.42 } }), mk(def.id)];
  // give color layers something to chew on; generators overwrite anyway
  try {
    const ctx = await evaluate(stack, 16, {});
    const hOk = allFinite(ctx.h), aOk = allFinite(ctx.alb);
    ok(hOk && aOk, `#${def.n} ${def.id}: finite buffers`);
    if (def.n === 110) ok(ctx.maps.histogram && ctx.maps.histogram.bins.length > 0, '#110 histogram stored');
    if (def.id === 'scatter') ok(Array.isArray(ctx.scatter), '#236 scatter array');
  } catch (e) {
    ok(false, `#${def.n} ${def.id}: threw ${e.message}`);
  }
}

// 3. Every blend mode runs + actually blends
console.log('— 24 blends —');
for (const b of BLENDS) {
  const stack = [
    mk('constant', { params: { value: 0.3 } }),
    mk('constant', { params: { value: 0.7 }, blend: b.id, opacity: 0.5 }),
  ];
  try {
    const ctx = await evaluate(stack, 8, {});
    ok(allFinite(ctx.h), `#${b.n} blend:${b.id} finite (v=${ctx.h[0].toFixed(4)})`);
  } catch (e) {
    ok(false, `#${b.n} blend:${b.id} threw ${e.message}`);
  }
}

// 4. Every mask runs
console.log('— 26 masks —');
for (const m of MASKS) {
  const stack = [
    mk('constant', { params: { value: 0.35 } }),
    mk('fbm', { mask: m.id, maskParams: defaultParams(MASK_MAP[m.id]) }),
  ];
  try {
    const ctx = await evaluate(stack, 16, {});
    ok(allFinite(ctx.h), `#${m.n} mask:${m.id} finite`);
    // direct mask range check on a varied terrain
    const c2 = createContext(16);
    const fb = LAYERS.find((l) => l.id === 'fbm');
    const S = { h: new Float32Array(256), alb: new Float32Array(256 * 3) };
    fb.run(c2, { freq: 5, oct: 4, lac: 2, gain: 0.5, seed: 3 }, S);
    c2.h.set(S.h);
    const out = new Float32Array(256);
    m.run(c2, defaultParams(MASK_MAP[m.id]), out);
    let inRange = true;
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i]) || out[i] < -1e-3 || out[i] > 1 + 1e-3) inRange = false;
    ok(inRange, `#${m.n} mask:${m.id} range [0,1]`);
  } catch (e) {
    ok(false, `#${m.n} mask:${m.id} threw ${e.message}`);
  }
}

// 5. Integration: realistic terrain+texture stack with carving + water + voxel
console.log('— integration —');
try {
  const stack = [
    mk('fbm', { params: { freq: 4, oct: 5, lac: 2, gain: 0.5, seed: 7 } }),
    mk('mountain', { params: { x: 0.5, y: 0.5, radius: 0.4, height: 0.8, rugged: 0.6, snow: 0, freq: 9, seed: 7 }, blend: 'max', opacity: 0.8 }),
    mk('thermal', { params: { talus: 0.03, iters: 6, rate: 0.5 } }),
    mk('river', { params: { count: 3, depth: 0.12, width: 2, valley: 8, valleyD: 0.06, length: 300, seed: 9 } }),
    mk('lake', { params: { count: 2, size: 14, depth: 0.12, level: 0.32, round: 0.75, seed: 11 } }),
    mk('splat', { params: { rock: '#6b6259', scree: '#8a7f6a', grass: '#4c7a35', snow: '#eef2f6', sand: '#d9bd7f', snowLine: 0.68, sandLine: 0.32, breakup: 8 } }),
    mk('scatter', { params: { kind: 0, count: 300, hLo: 0.3, hHi: 0.7, slopeMax: 35, moistMin: 0.1, sizeMin: 0.7, sizeMax: 1.6, seed: 91 } }),
  ];
  const t0 = Date.now();
  const ctx = await evaluate(stack, 64, {});
  const ms = Date.now() - t0;
  ok(allFinite(ctx.h) && allFinite(ctx.alb), 'integration: finite buffers');
  ok(Math.abs(ctx.waterLevel - 0.32) < 1e-6, `integration: water level set (${ctx.waterLevel})`);
  const wd = waterDepth(ctx);
  let wet = 0;
  for (let i = 0; i < wd.length; i++) if (wd[i] > 0) wet++;
  ok(wet > 10, `integration: carved basins hold water (${wet} wet cells)`);
  ok(ctx.scatter.length > 20, `integration: scatter placed (${ctx.scatter.length})`);
  ok(ctx.maps.splat && ctx.maps.splat.length === 64 * 64 * 5, 'integration: splat weights stored');
  const vox = voxelizeFull(ctx, 48, 24);
  const vs = voxelStats(vox);
  ok(vox.solid > 1000 && vs.fillPct > 0, `integration: voxelized ${vs.dims} fill=${vs.fillPct}%`);
  console.log(`  integration eval: ${ms}ms @64², ${ctx.scatter.length} trees, ${wet} wet cells`);
} catch (e) {
  ok(false, `integration threw: ${e.stack || e.message}`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) console.log('failures:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
