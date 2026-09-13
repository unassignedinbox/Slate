// 3D thermal (talus) erosion: true volumetric slope relaxation, NOT a heightfield blur,
// so overhangs and cave ceilings survive. Donor surface voxels shed mass to their
// lowest air-side neighbor when the slope exceeds the angle of repose.
import { mulberry32 } from './noise.js';
import { clamp } from './sdf.js';

export const THERMAL_DEFAULTS = { samples: 120000, talusDeg: 34, rate: 0.35, hardResist: 0.9, seed: 777 };

export function runThermal(field, P, hooks = {}) {
  const { onProgress = null, shouldStop = null } = hooks;
  const rng = mulberry32((P.seed | 0) * 40503 + 7 | 0);
  const { nx, ny, nz, vox } = field;
  const tanT = Math.tan((P.talusDeg * Math.PI) / 180);
  const g = [0, 0, 0];
  let movedE = 0, movedD = 0;
  const total = P.samples | 0;
  const reportEvery = Math.max(1, Math.floor(total / 30));
  for (let n = 0; n < total; n++) {
    if (shouldStop && shouldStop()) break;
    const ix = 2 + ((rng() * (nx - 4)) | 0);
    const iy = 1 + ((rng() * (ny - 3)) | 0);
    const iz = 2 + ((rng() * (nz - 4)) | 0);
    const i = field.idx(ix, iy, iz);
    const dd = field.den[i];
    if (dd < 0 || dd > vox * 2.5) continue; // only just-inside surface voxels
    field.gradAt(ix, iy, iz, g);
    const gl = Math.hypot(g[0], g[1], g[2]);
    if (gl < 1e-6) continue;
    const ny_ = -g[1] / gl; // outward normal Y
    if (ny_ < -0.25) continue; // walls + slopes shed; cave ceilings stay
    const slope = Math.hypot(g[0], g[2]) / Math.max(1e-4, Math.abs(g[1]));
    if (slope <= tanT) continue;
    const hard = clamp(field.hard[i], 0, 1);
    const excess = Math.min(2.5, slope - tanT);
    let m = excess * P.rate * vox * 0.28 * (1 - hard * P.hardResist);
    m = Math.min(m, dd + vox * 0.5, vox * 0.5);
    if (m <= 1e-7) continue;
    // recipient: lowest-density neighbor biased downhill (outward + down)
    let bi = -1, bd = Infinity;
    const ox = -g[0] / gl, oz = -g[2] / gl;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      const jx = ix + dx, jy = iy + dy, jz = iz + dz;
      if (!field.inRange(jx, jy, jz)) continue;
      const j = field.idx(jx, jy, jz);
      const bias = -(dx * ox + dz * oz) * vox * 0.25 + dy * vox * 0.35;
      const v = field.den[j] + bias;
      if (v < bd) { bd = v; bi = j; }
    }
    if (bi < 0) continue;
    field.den[i] -= m;
    const add = Math.max(0, Math.min(m, field.trunc - field.den[bi]));
    field.den[bi] += add;
    field.sed[bi] += add * 0.6;
    field.hard[bi] = Math.min(field.hard[bi], 0.3);
    movedE += m; movedD += add;
    if (onProgress && n % reportEvery === 0) onProgress(n / total);
  }
  if (onProgress) onProgress(1);
  return { particles: total, eroded: movedE, deposited: movedD, drift: movedE - movedD };
}
