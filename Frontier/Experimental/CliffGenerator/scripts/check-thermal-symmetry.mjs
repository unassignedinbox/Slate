// Diagonal bias of thermal erosion: a rotationally symmetric cone (steeper than the soft talus) is
// slumped, then the change along the axis is compared with the change along the diagonal at the
// same radius (bilinear sampling). An isotropic scheme would give equal changes.
// Usage: node scripts/check-thermal-symmetry.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const { thermalErosion } = await import(path.join(SRC, 'erosion.js'));
const { defaults } = await import(path.join(SRC, 'params.js'));
const N = 257, worldSize = 1024, cell = worldSize / (N - 1), c0 = (N - 1) / 2;
const bil = (h, x, y) => {
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j, at = (a, b) => h[b * N + a];
  return at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
};
const make = () => { const h = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = 120 - 2.0 * Math.hypot(i - c0, j - c0) * cell; return h; };
for (const hardness of [0, 0.1]) {
  const h = make(), hard = new Float32Array(N * N).fill(hardness), ref = make();
  thermalErosion(h, hard, { ...defaults, resolution: N, worldSize, thermalIterations: 60, thermalRate: 0.5, talusSoft: 40, talusHard: 89 });
  let ax = 0, dg = 0, n = 0;
  for (let k = 12; k < c0 - 12; k++) {
    const dx = k / Math.SQRT2;
    ax += bil(h, c0 + k, c0) - bil(ref, c0 + k, c0);
    dg += bil(h, c0 + dx, c0 + dx) - bil(ref, c0 + dx, c0 + dx);
    n++;
  }
  console.log(JSON.stringify({ hardness, axisChange: +(ax / n).toFixed(3), diagChange: +(dg / n).toFixed(3), diagOverAxis: +(dg / ax).toFixed(3) }));
}
