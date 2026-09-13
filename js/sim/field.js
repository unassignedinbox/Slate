// VoxelField: truncated-SDF density volume + material channels.
// Convention: den > 0 solid, den < 0 air, surface at 0. |den| <= trunc (world units).
import { LAYERS, smin, clamp } from './sdf.js';
import { fbm3 } from './noise.js';

export class VoxelField {
  constructor(nx, ny, nz, sx, sy, sz, y0 = 0) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.sx = sx; this.sy = sy; this.sz = sz; this.y0 = y0;
    this.vox = sx / nx; // cubic voxels assumed (sx/nx == sy/ny == sz/nz)
    this.trunc = this.vox * 6;
    const n = nx * ny * nz;
    this.den = new Float32Array(n);
    this.hard = new Float32Array(n).fill(0.5);
    this.sed = new Float32Array(n);
    this.wet = new Float32Array(n);
  }
  idx(x, y, z) { return x + this.nx * (z + this.nz * y); }
  inRange(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  worldToVox(x, y, z) {
    return [(x + this.sx / 2) / this.vox - 0.5, (y - this.y0) / this.vox - 0.5, (z + this.sz / 2) / this.vox - 0.5];
  }
  worldToVoxY(y) { return (y - this.y0) / this.vox - 0.5; }
  voxToWorld(ix, iy, iz) {
    return [(ix + 0.5) * this.vox - this.sx / 2, this.y0 + (iy + 0.5) * this.vox, (iz + 0.5) * this.vox - this.sz / 2];
  }
  voxToWorldY(iy) { return this.y0 + (iy + 0.5) * this.vox; }
  sample(arr, fx, fy, fz) {
    const { nx, ny, nz } = this;
    fx = clamp(fx, 0, nx - 1.001); fy = clamp(fy, 0, ny - 1.001); fz = clamp(fz, 0, nz - 1.001);
    const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0;
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const i000 = this.idx(x0, y0, z0), i100 = i000 + 1;
    const i010 = i000 + nx * nz, i110 = i010 + 1;
    const i001 = i000 + nx, i101 = i001 + 1, i011 = i001 + nx * nz, i111 = i011 + 1;
    const a = arr[i000] + (arr[i100] - arr[i000]) * tx;
    const b = arr[i010] + (arr[i110] - arr[i010]) * tx;
    const c = arr[i001] + (arr[i101] - arr[i001]) * tx;
    const d = arr[i011] + (arr[i111] - arr[i011]) * tx;
    return (a + (b - a) * ty) + (((c + (d - c) * ty)) - (a + (b - a) * ty)) * tz;
  }
  denAt(fx, fy, fz) { return this.sample(this.den, fx, fy, fz); }
  // Gradient of density in voxel units (direction only matters for normals/flow).
  gradAt(fx, fy, fz, out) {
    const e = 0.75;
    out[0] = (this.denAt(fx + e, fy, fz) - this.denAt(fx - e, fy, fz)) / (2 * e);
    out[1] = (this.denAt(fx, fy + e, fz) - this.denAt(fx, fy - e, fz)) / (2 * e);
    out[2] = (this.denAt(fx, fy, fz + e) - this.denAt(fx, fy, fz - e)) / (2 * e);
    return out;
  }
  // Volumetric splat: add dDen with (1-d/r)^2 kernel normalized to preserve mass.
  // Optional per-splat material writes. Returns actually-applied density mass.
  splat(fx, fy, fz, rVox, dDen, opts = {}) {
    const r = Math.max(0.6, rVox);
    const R = Math.ceil(r);
    const cx = Math.round(fx), cy = Math.round(fy), cz = Math.round(fz);
    // First pass: weights.
    let wsum = 0;
    const ws = [];
    for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r) continue;
      const w = (1 - d / r) * (1 - d / r);
      if (w <= 0) continue;
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      if (!this.inRange(ix, iy, iz)) continue;
      ws.push([this.idx(ix, iy, iz), w]); wsum += w;
    }
    if (wsum <= 0 || ws.length === 0) return 0;
    const { dSed = 0, dWet = 0, setHard = -1, hardMix = 0, clampLo = -this.trunc, clampHi = this.trunc } = opts;
    const k = dDen / wsum, ks = dSed / wsum, kw = dWet / wsum;
    let applied = 0;
    for (let n = 0; n < ws.length; n++) {
      const [i, w] = ws[n];
      const before = this.den[i];
      let after = before + k * w;
      if (after < clampLo) after = clampLo; else if (after > clampHi) after = clampHi;
      applied += after - before;
      this.den[i] = after;
      if (ks) this.sed[i] = Math.max(0, this.sed[i] + ks * w);
      if (kw) this.wet[i] = clamp(this.wet[i] + kw * w, 0, 1.5);
      if (setHard >= 0 && hardMix > 0) this.hard[i] += (setHard - this.hard[i]) * Math.min(1, hardMix * w);
    }
    return applied;
  }
  // Project voxel-coords point onto surface (Newton iterations on SDF). Returns den.
  projectToSurface(p, iters = 3) {
    const g = [0, 0, 0];
    for (let k = 0; k < iters; k++) {
      const d = this.denAt(p[0], p[1], p[2]);
      this.gradAt(p[0], p[1], p[2], g);
      const l2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (l2 < 1e-8) return d;
      const step = d / l2; // move opposite gradient by d/|g| (density units≈world? no: voxel units)
      // den is in world units; grad in world/voxel; step in voxels:
      p[0] -= g[0] * step; p[1] -= g[1] * step; p[2] -= g[2] * step;
      if (Math.abs(d) < this.vox * 0.08) return d;
    }
    return this.denAt(p[0], p[1], p[2]);
  }
  solidStats() {
    let solid = 0;
    const d = this.den;
    for (let i = 0; i < d.length; i++) if (d[i] > 0) solid++;
    return { voxels: d.length, solid, frac: solid / d.length };
  }
}

export function buildStack(field, layers, project, onProgress) {
  const W = { sx: field.sx, sy: field.sy, sz: field.sz };
  field.den.fill(-field.trunc);
  field.hard.fill(0.5); field.sed.fill(0); field.wet.fill(0);
  const t0 = performance.now ? performance.now() : Date.now();
  const active = layers.filter((l) => l.enabled);
  let step = 0;
  for (const layer of active) {
    const def = LAYERS[layer.kind];
    if (!def) continue;
    if (def.mode === 'analytic') buildAnalyticLayer(field, layer, def, W);
    else if (def.mode === 'stamp') buildStampLayer(field, layer, def, project.seed | 0);
    else if (def.mode === 'modifier' && def.apply) def.apply(field, layer.params);
    step++;
    if (onProgress) onProgress(step / Math.max(1, active.length), layer.name);
  }
  if (project.warpAmp > 0) applyWarp(field, project, onProgress);
  const t1 = performance.now ? performance.now() : Date.now();
  return { ms: t1 - t1 + (t1 - t0), ...field.solidStats() };
}

function buildAnalyticLayer(field, layer, def, W) {
  const p = layer.params;
  const bb = def.bbox(p, W);
  const [fx0, fy0, fz0] = field.worldToVox(bb.x0, bb.y0, bb.z0);
  const [fx1, fy1, fz1] = field.worldToVox(bb.x1, bb.y1, bb.z1);
  const x0 = Math.max(0, Math.floor(fx0)), x1 = Math.min(field.nx - 1, Math.ceil(fx1));
  const y0 = Math.max(0, Math.floor(fy0)), y1 = Math.min(field.ny - 1, Math.ceil(fy1));
  const z0 = Math.max(0, Math.floor(fz0)), z1 = Math.min(field.nz - 1, Math.ceil(fz1));
  const op = layer.op, k = layer.k || 2;
  for (let y = y0; y <= y1; y++) {
    const wy = field.voxToWorldY(y);
    for (let z = z0; z <= z1; z++) {
      const wz = (z + 0.5) * field.vox - field.sz / 2;
      for (let x = x0; x <= x1; x++) {
        const wx = (x + 0.5) * field.vox - field.sx / 2;
        const r = def.eval(wx, wy, wz, p);
        const d = clamp(r.d, -field.trunc, field.trunc);
        const i = field.idx(x, y, z);
        const cur = field.den[i];
        if (op === 'add') {
          const nd = -d;
          if (nd > cur) { field.den[i] = nd; field.hard[i] = r.hard; }
        } else if (op === 'sub') {
          if (d < cur) { field.den[i] = d; if (d < 0 && cur > 0) { /* freshly cut: keep hardness */ } }
        } else if (op === 'intersect') {
          const nd = -d;
          if (nd < cur) { field.den[i] = nd; field.hard[i] = r.hard; }
        } else { // smooth union
          const sNew = -smin(-cur, d, k);
          if (sNew !== cur) {
            const t = clamp((sNew - cur) / (k || 1) + 0.5, 0, 1);
            field.hard[i] = field.hard[i] * (1 - t * 0.5) + r.hard * t * 0.5;
            field.den[i] = sNew;
          }
        }
      }
    }
  }
}

function buildStampLayer(field, layer, def, seedBase) {
  const p = layer.params;
  if (layer.kind === 'worms') {
    const paths = def.makePaths(p, field, seedBase + (layer.id.length * 13));
    const sub = layer.op !== 'add';
    for (const pts of paths) {
      for (const [fx, fy, fz, rr] of pts) {
        // Carve by stamping strong negative density (caves cut any rock).
        stampBall(field, fx, fy, fz, rr, sub ? -1 : 1);
      }
    }
  } else if (def.apply) {
    def.apply(field, p, layer.op);
  }
}

// Hard spherical stamp: sets density toward -trunc (carve) or +trunc (add) with soft edge.
function stampBall(field, fx, fy, fz, r, sign) {
  const R = Math.ceil(r + 1);
  const cx = Math.round(fx), cy = Math.round(fy), cz = Math.round(fz);
  for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const ix = cx + dx, iy = cy + dy, iz = cz + dz;
    if (!field.inRange(ix, iy, iz)) continue;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r; // <0 inside
    if (d > 1.2) continue;
    const i = field.idx(ix, iy, iz);
    const target = sign < 0 ? -field.trunc : field.trunc;
    const t = clamp(0.5 - d * 0.8, 0, 1); // soft edge
    if (sign < 0) {
      const want = field.den[i] * (1 - t) + target * t;
      if (want < field.den[i]) field.den[i] = want;
    } else {
      const want = field.den[i] * (1 - t) + target * t;
      if (want > field.den[i]) { field.den[i] = want; field.hard[i] = 0.5; }
    }
  }
}

function applyWarp(field, project, onProgress) {
  const { nx, ny, nz } = field;
  const src = Float32Array.from(field.den);
  const srcH = Float32Array.from(field.hard);
  const amp = project.warpAmp / field.vox, f = project.warpFreq * field.vox, seed = (project.seed | 0) + 913;
  const sample = (arr, fx, fy, fz) => {
    fx = clamp(fx, 0, nx - 1.001); fy = clamp(fy, 0, ny - 1.001); fz = clamp(fz, 0, nz - 1.001);
    const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0, tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const i000 = x0 + nx * (z0 + nz * y0);
    const at = (dx, dy, dz) => arr[i000 + dx + nx * (dz + nz * dy)];
    const a = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * tx;
    const b = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * tx;
    const c = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * tx;
    const d = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * tx;
    return a + (b - a) * ty + ((c + (d - c) * ty) - (a + (b - a) * ty)) * tz;
  };
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const ox = (fbm3(x * f, y * f, z * f, 3, 0.5, 2, seed) - 0.5) * 2 * amp;
      const oz = (fbm3(x * f, y * f, z * f, 3, 0.5, 2, seed + 7) - 0.5) * 2 * amp;
      const i = field.idx(x, y, z);
      field.den[i] = sample(src, x + ox, y, z + oz);
      field.hard[i] = sample(srcH, x + ox, y, z + oz);
    }
    if (onProgress && (y & 15) === 0) onProgress(0.97 + 0.03 * (y / ny), 'domain warp');
  }
}
