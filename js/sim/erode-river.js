// Fluvial erosion: discharge-routed rivers with sediment transport.
// Sources spawn on high ground; channels widen with discharge (w ∝ √Q),
// carve bed + banks, build levees, and dump alluvial fans/deltas at base level.
import { mulberry32, valueNoise3 } from './noise.js';
import { clamp } from './sdf.js';

export const RIVER_DEFAULTS = {
  rivers: 7, ttl: 420, width0: 1.6, depth0: 0.5, momentum: 0.55,
  meander: 0.5, rainFeed: 0.012, carveK: 0.6, depositK: 0.4,
  leveeK: 0.12, hardResist: 0.7, seed: 5150,
};

export function runRivers(field, P, seaLevel, hooks = {}) {
  const { onProgress = null, shouldStop = null } = hooks;
  const rng = mulberry32((P.seed | 0) * 2246822519 + 11 | 0);
  const { nx, ny, nz, vox } = field;
  const g = [0, 0, 0];
  const seaY = field.worldToVoxY(seaLevel);
  let eroded = 0, deposited = 0;
  const paths = [];
  // --- pick sources: highest surface points with separation ---
  const cand = [];
  for (let k = 0; k < 600; k++) {
    const ix = 4 + ((rng() * (nx - 8)) | 0), iz = 4 + ((rng() * (nz - 8)) | 0);
    let sy = -1;
    for (let y = ny - 2; y > 2; y--) { if (field.den[field.idx(ix, y, iz)] > 0) { sy = y; break; } }
    if (sy > seaY + 4) cand.push([ix, sy, iz]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const sources = [];
  for (const c of cand) {
    if (sources.length >= P.rivers) break;
    if (sources.every((s) => Math.hypot(s[0] - c[0], s[2] - c[2]) > nx * 0.12)) sources.push(c);
  }
  const total = Math.max(1, sources.length);
  sources.forEach(([six, siy, siz], ri) => {
    if (shouldStop && shouldStop()) return;
    let fx = six, fy = siy + 0.5, fz = siz;
    let dx = rng() - 0.5, dz = rng() - 0.5;
    const dl0 = Math.hypot(dx, dz) || 1; dx /= dl0; dz /= dl0;
    let Q = 1, load = 0;
    const pts = [];
    const stepLen = 1.6;
    for (let s = 0; s < P.ttl; s++) {
      field.gradAt(fx, fy, fz, g);
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl < 1e-6) break;
      const nx_ = -g[0] / gl, ny_ = -g[1] / gl, nz_ = -g[2] / gl;
      let tx = -nx_ * -ny_, tz = -nz_ * -ny_; // downhill tangent (xz)
      const tl = Math.hypot(tx, tz);
      if (tl > 1e-5) { tx /= tl; tz /= tl; } else { tx = dx; tz = dz; }
      // meander noise, perpendicular
      const mn = (valueNoise3(fx * 0.03, ri * 7.3, fz * 0.03, P.seed | 0) - 0.5) * 2 * P.meander;
      const px = -tz, pz = tx;
      dx = dx * P.momentum + (tx + px * mn) * (1 - P.momentum);
      dz = dz * P.momentum + (tz + pz * mn) * (1 - P.momentum);
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const py = fy;
      fx += dx * stepLen; fz += dz * stepLen;
      // descend to surface
      let guard = 0;
      while (guard++ < 12 && fy > 0.5 && field.denAt(fx, fy, fz) < -vox * 0.6) fy -= 1;
      if (fy <= 0.5) break;
      const q = [fx, fy, fz];
      field.projectToSurface(q, 2);
      fx = q[0]; fy = q[1]; fz = q[2];
      if (fx < 2 || fz < 2 || fx > nx - 3 || fz > nz - 3) break;
      Q += P.rainFeed * (1 + Math.sqrt(Q)); // tributary growth
      const width = P.width0 * Math.sqrt(Q);           // voxels (half-width-ish)
      const depth = P.depth0 * Math.sqrt(Math.sqrt(Q)) * vox;
      const dh = (py - fy) * vox;
      const slope = dh / (stepLen * vox);
      const hard = clamp(field.sample(field.hard, fx, fy, fz), 0, 1);
      const soft = 1 - hard * P.hardResist;
      const wWorld = field.voxToWorld(fx, fy, fz);
      if (s % 2 === 0) pts.push([wWorld[0], wWorld[1], wWorld[2], width * vox, Q]);
      if (wWorld[1] < seaLevel - vox * 3) {
        // delta: dump load in a fan
        if (load > 1e-4) {
          deposited += field.splat(fx, fy + 1, fz, width * 1.6, load, { dSed: load, dWet: 0.5, setHard: 0.1, hardMix: 0.6 });
          load = 0;
        }
        break;
      }
      if (slope > 0.004) {
        // carve: 3 overlapping spheres along flow dir
        const amt = Math.min(depth * P.carveK * soft * (0.4 + slope * 3), vox * 0.5);
        for (let k = -1; k <= 1; k++) {
          const took = -field.splat(fx + dx * k * width * 0.5, fy, fz + dz * k * width * 0.5, width * 0.62, -amt * 0.5,
            { dWet: 0.2 });
          eroded += took; load += took;
        }
        // levees
        const lv = amt * P.leveeK;
        const g1 = field.splat(fx - dz * width * 1.3, fy + 0.3, fz + dx * width * 1.3, width * 0.5, lv, { dSed: lv, setHard: 0.2, hardMix: 0.4 });
        const g2 = field.splat(fx + dz * width * 1.3, fy + 0.3, fz - dx * width * 1.3, width * 0.5, lv, { dSed: lv, setHard: 0.2, hardMix: 0.4 });
        deposited += g1 + g2;
        load -= g1 + g2; if (load < 0) load = 0;
      } else {
        // flat: deposit fan (alluvial)
        const dep = Math.min(load * P.depositK + vox * 0.01, vox * 0.4);
        if (dep > 1e-6) {
          const got = field.splat(fx, fy + 0.3, fz, width * 1.1, dep, { dSed: dep, dWet: 0.25, setHard: 0.12, hardMix: 0.5 });
          deposited += got;
          load -= got; if (load < 0) load = 0;
        }
      }
      // capacity cap: overloaded streams dump
      const cap = slope * Q * vox * 0.5 + vox * 0.05;
      if (load > cap * 4 && load > 1e-4) {
        const dump = (load - cap) * 0.5;
        const got = field.splat(fx, fy + 0.3, fz, width, dump, { dSed: dump, setHard: 0.12, hardMix: 0.5 });
        deposited += got;
        load -= got;
      }
    }
    if (load > 1e-4) {
      deposited += field.splat(fx, fy + 0.5, fz, P.width0 * 2, load, { dSed: load, setHard: 0.12, hardMix: 0.5 });
      load = 0;
    }
    if (pts.length > 3) paths.push(pts);
    if (onProgress) onProgress((ri + 1) / total);
  });
  return { particles: total, eroded, deposited, drift: eroded - deposited, paths };
}
