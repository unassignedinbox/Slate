// Checks the downhill direction field used by the streak shader against the simulated river network.
// Usage: node scripts/check-flow-direction.mjs
const ROOT = new URL('../src/', import.meta.url).href;
const { generateTerrain } = await import(ROOT + 'pipeline.js');
const { defaults, presets } = await import(ROOT + 'params.js');
for (const preset of ['Alpine granite', 'Icelandic river plains', 'Highland glens']) {
  const res = 256;
  const params = { ...defaults, ...presets[preset], resolution: res };
  params.droplets = Math.round(params.droplets * (res * res) / (512 * 512));
  const f = generateTerrain(params, () => {});
  const N = f.resolution, net = f.network;
  let n = 0, agree = 0, dot = 0, mag = 0, cnt = 0;
  for (let s = 0; s < N * N; s++) {
    const d = net.down[s];
    if (!net.isRiver[s] || d < 0 || !net.isRiver[d]) continue;
    const vx = net.px[d] - net.px[s], vz = net.pz[d] - net.pz[s];
    const L = Math.hypot(vx, vz); if (L < 1e-6) continue;
    const dx = f.dirX[s], dz = f.dirZ[s], dl = Math.hypot(dx, dz);
    if (dl < 1e-3) continue;
    n++;
    const c = (vx * dx + vz * dz) / (L * dl);
    dot += c; if (c > 0.5) agree++;
  }
  // coverage: share of land cells with a usable direction
  for (let i = 0; i < N * N; i++) { cnt++; if (Math.hypot(f.dirX[i], f.dirZ[i]) > 0.3) mag++; }
  console.log(JSON.stringify({ preset, riverCells: n, meanCos: +(dot / Math.max(1, n)).toFixed(3), agreeShare: +(agree / Math.max(1, n)).toFixed(3), dirCoverage: +(mag / cnt).toFixed(3) }));
}
