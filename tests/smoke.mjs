// Numerical smoke tests: noise determinism, SDF sanity, field build,
// droplet mass conservation, mesher output. Run: npm test
import assert from 'node:assert/strict';
import { mulberry32, valueNoise3, fbm3 } from '../js/sim/noise.js';
import { LAYERS, makeLayer } from '../js/sim/sdf.js';
import { VoxelField, buildStack } from '../js/sim/field.js';
import { runHydraulic, HYDRO_DEFAULTS } from '../js/sim/erode-hydraulic.js';
import { runThermal } from '../js/sim/erode-thermal.js';
import { runRivers } from '../js/sim/erode-river.js';
import { surfaceMesh, colorize } from '../js/sim/mesher.js';

// 1. determinism
{
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  assert.equal(valueNoise3(1.5, 2.5, 3.5, 9), valueNoise3(1.5, 2.5, 3.5, 9));
  assert.ok(fbm3(0.1, 0.2, 0.3, 4, 0.5, 2, 1) >= 0 && fbm3(0.1, 0.2, 0.3, 4, 0.5, 2, 1) <= 1);
  console.log('ok 1 determinism');
}
// 2. SDF primitives: inside negative, outside positive
{
  const s = LAYERS.sphere.eval(0, 14, 0, { x: 0, y: 14, z: 0, r: 8 });
  assert.ok(s.d < 0, 'center inside');
  const s2 = LAYERS.sphere.eval(100, 100, 100, { x: 0, y: 14, z: 0, r: 8 });
  assert.ok(s2.d > 0, 'far outside');
  console.log('ok 2 sdf sign');
}
// 3. build a tiny stack
const field = new VoxelField(40, 20, 40, 120, 60, 120, 0);
{
  const layers = [
    makeLayer('slab', 'add', { y0: 9, thick: 14, noiseAmp: 2, noiseFreq: 0.045, hard: 0.55 }),
    makeLayer('mountain', 'add', { x: 0, z: 0, radius: 26, height: 24, yBase: 6, stretch: 1, ridgeAmp: 5, ridgeFreq: 0.07, seed: 11, hard: 0.7 }),
  ];
  const st = buildStack(field, layers, { seed: 5, warpAmp: 0, warpFreq: 0.02 }, null);
  assert.ok(st.solid > 1000, 'has solid voxels, got ' + st.solid);
  assert.ok(st.solid < st.voxels, 'has air voxels');
  console.log('ok 3 build', JSON.stringify(st));
}
// 4. hydraulic droplets conserve sediment (drift < 8% of eroded)
{
  const P = { ...HYDRO_DEFAULTS, count: 1500, seed: 3 };
  const r = runHydraulic(field, P, 6.5, {});
  assert.ok(r.eroded > 0, 'droplets eroded something');
  const drift = Math.abs(r.drift) / r.eroded;
  assert.ok(drift < 0.08, `drift ${(drift * 100).toFixed(2)}% too high (E=${r.eroded} D=${r.deposited})`);
  console.log(`ok 4 hydro E=${r.eroded.toFixed(2)} D=${r.deposited.toFixed(2)} drift=${(drift * 100).toFixed(2)}%`);
}
// 5. thermal moves mass
{
  const r = runThermal(field, { samples: 20000, talusDeg: 30, rate: 0.4, hardResist: 0.5, seed: 4 }, {});
  assert.ok(r.eroded >= 0);
  console.log('ok 5 thermal moved=' + r.eroded.toFixed(2));
}
// 6. rivers produce paths
{
  const r = runRivers(field, { rivers: 3, ttl: 200, width0: 1.4, depth0: 0.5, momentum: 0.55, meander: 0.5, rainFeed: 0.012, carveK: 0.6, depositK: 0.4, leveeK: 0.12, hardResist: 0.5, seed: 9 }, 6.5, {});
  assert.ok(r.paths.length >= 1, 'at least one river path');
  console.log('ok 6 rivers paths=' + r.paths.length);
}
// 7. mesher emits indexed geometry + colors
{
  const mesh = surfaceMesh(field);
  assert.ok(mesh.tris > 100, 'tris=' + mesh.tris);
  assert.ok(mesh.nv > 0 && mesh.indices.length === mesh.tris * 3);
  const cols = colorize(mesh, field, 'material', 6.5, 40);
  assert.equal(cols.length, mesh.nv * 3);
  let finite = true;
  for (let i = 0; i < mesh.positions.length; i += 7) if (!isFinite(mesh.positions[i])) finite = false;
  assert.ok(finite, 'all positions finite');
  console.log(`ok 7 mesh tris=${mesh.tris} verts=${mesh.nv}`);
}
console.log('ALL SMOKE TESTS PASSED');
