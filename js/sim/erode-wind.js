// Aeolian erosion: saltating sand grains + windward abrasion (sandblasting).
// Windward faces (dot(n, wind) < 0) are polished/cut; leeward zones grow dunes.
import { mulberry32, valueNoise3 } from './noise.js';
import { clamp } from './sdf.js';

export const WIND_DEFAULTS = {
  count: 40000, ttl: 90, dirDeg: 35, speed: 6.0, gust: 0.55,
  abrasion: 0.5, saltation: 1.0, depositK: 0.3, sand: 1.0,
  hardResist: 0.75, windH: 0.75, seed: 9001,
};

export function runWind(field, P, hooks = {}) {
  const { onProgress = null, shouldStop = null, vizCap = 24000 } = hooks;
  const rng = mulberry32((P.seed | 0) * 31337 + 3 | 0);
  const { nx, ny, nz, vox } = field;
  const th = (P.dirDeg * Math.PI) / 180;
  const wx = Math.sin(th), wz = Math.cos(th); // wind blows TOWARD +w
  const viz = new Float32Array(vizCap * 3);
  let vizN = 0; // ring buffer: always shows the most recent activity
  const pushViz = (fx, fy, fz) => {
    const k = vizN % vizCap; vizN++;
    const w = field.voxToWorld(fx, fy, fz);
    viz[k * 3] = w[0]; viz[k * 3 + 1] = w[1]; viz[k * 3 + 2] = w[2];
  };
  const vizCount = () => Math.min(vizN, vizCap);
  const g = [0, 0, 0];
  const seed = P.seed | 0;
  let abraded = 0, deposited = 0;
  const total = P.count | 0;
  const reportEvery = Math.max(1, Math.floor(total / 40));
  const maxY = Math.max(4, ny * P.windH);
  for (let n = 0; n < total; n++) {
    if (shouldStop && shouldStop()) break;
    // spawn on upwind boundary
    let fx, fz;
    if (Math.abs(wx) > Math.abs(wz)) { fx = wx > 0 ? 1 : nx - 2; fz = 1 + rng() * (nz - 3); }
    else { fz = wz > 0 ? 1 : nz - 2; fx = 1 + rng() * (nx - 3); }
    let fy = 1 + rng() * maxY;
    let vx = wx * P.speed, vy = 0, vz = wz * P.speed;
    let load = rng() * 0.02 * vox * P.sand;
    for (let s = 0; s < P.ttl; s++) {
      const gust = 0.55 + P.gust * valueNoise3(fx * 0.05, fy * 0.05 + n * 0.001, fz * 0.05, seed) * 1.4;
      const tx = wx * P.speed * gust, tz = wz * P.speed * gust;
      vx += (tx - vx) * 0.12; vz += (tz - vz) * 0.12;
      vy -= 0.028 * P.saltation * vox * 2; // settling (voxel units-ish)
      vy *= 0.985;
      fx += vx * 0.16; fy += vy * 0.9; fz += vz * 0.16;
      if (fx < 1 || fz < 1 || fx > nx - 2 || fz > nz - 2 || fy < 0.5) break;
      if (fy > ny - 1) { fy = ny - 1; vy = 0; }
      if (s % 4 === 0) pushViz(fx, fy, fz);
      const d = field.denAt(fx, fy, fz);
      if (d > -vox * 0.9) {
        field.gradAt(fx, fy, fz, g);
        const gl = Math.hypot(g[0], g[1], g[2]) || 1;
        const nx_ = -g[0] / gl, ny_ = -g[1] / gl, nz_ = -g[2] / gl;
        const facing = nx_ * wx + nz_ * wz; // <0 windward
        const hard = clamp(field.sample(field.hard, fx, fy, fz), 0, 1);
        const sp = Math.hypot(vx, vy, vz);
        if (facing < -0.08) {
          const a = Math.min(vox * 0.03 * P.abrasion * sp * -facing * (1 - hard * P.hardResist), vox * 0.05);
          if (a > 1e-7) { const took = -field.splat(fx, fy, fz, 1.1, -a, { dWet: 0 }); abraded += took; load += took; }
        } else if (facing > 0.15 && load > 1e-6) {
          const dep = Math.min(load, load * P.depositK * facing * 2 + vox * 0.002);
          const got = field.splat(fx, fy + 0.4, fz, 1.3, dep, { dSed: dep * 1.2, setHard: 0.08, hardMix: 0.6 });
          deposited += got;
          load -= got;
        }
        // bounce
        const vn = vx * nx_ + vy * ny_ + vz * nz_;
        if (vn < 0) {
          vx -= 1.35 * vn * nx_; vy -= 1.35 * vn * ny_; vz -= 1.35 * vn * nz_;
          vx *= 0.72; vy = Math.abs(vy) * 0.4 + 0.12; vz *= 0.72;
          fx += nx_ * 0.7; fy += ny_ * 0.7 + 0.2; fz += nz_ * 0.7;
        }
      }
    }
    if (load > 1e-6 && fx > 0 && fz > 0 && fx < nx - 1 && fz < nz - 1 && fy > 0.5 && fy < ny - 1) {
      deposited += field.splat(fx, fy, fz, 1.4, load, { dSed: load * 1.2, setHard: 0.08, hardMix: 0.5 });
    }
    if (onProgress && n % reportEvery === 0) onProgress(n / total, viz.subarray(0, vizCount() * 3), vizCount());
  }
  // Field abrasion pass: large-scale polish on exposed faces (yardang banding via noise).
  const ap = Math.floor(total * 0.5);
  for (let n = 0; n < ap; n++) {
    if (shouldStop && shouldStop()) break;
    const ix = 2 + ((rng() * (nx - 4)) | 0), iy = 1 + ((rng() * (ny - 3)) | 0), iz = 2 + ((rng() * (nz - 4)) | 0);
    const i = field.idx(ix, iy, iz);
    if (field.den[i] < 0 || field.den[i] > vox * 2) continue;
    field.gradAt(ix, iy, iz, g);
    const gl = Math.hypot(g[0], g[1], g[2]) || 1;
    const facing = (-g[0] / gl) * wx + (-g[2] / gl) * wz;
    if (facing > -0.05) continue;
    const band = 0.4 + 0.6 * valueNoise3(ix * 0.06, iy * 0.22, iz * 0.06, seed + 5);
    const hard = clamp(field.hard[i], 0, 1);
    const a = vox * 0.02 * P.abrasion * band * -facing * (1 - hard * P.hardResist) * 2;
    if (a > 1e-7 && field.den[i] - a > -vox * 2) { field.den[i] -= a; abraded += a; }
  }
  if (onProgress) onProgress(1, viz.subarray(0, vizN * 3), vizN);
  return { particles: total, eroded: abraded, deposited, drift: abraded - deposited, viz: viz.subarray(0, vizN * 3), vizN };
}
function count0() { return -1; }
