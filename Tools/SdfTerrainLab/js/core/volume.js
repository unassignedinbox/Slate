// Voxel SDF volume: dense float fields + material ids + sim accumulators.
// Y-up meters. dist: signed distance (inside<0). sed: loose sediment 0..1 (voxel units).
// wet: wetness 0..1. flux: accumulated water through-flow. flowX/flowZ: flux-weighted velocity.
import { MAT } from './sdf.js';

export const DOMAIN = { x0: -96, y0: 0, z0: -96, sx: 192, sy: 72, sz: 192 };
export const RESOLUTIONS = {
  draft:    { nx: 96,  ny: 36, nz: 96  },
  standard: { nx: 144, ny: 54, nz: 144 },
  high:     { nx: 192, ny: 72, nz: 192 },
};

export class Volume {
  constructor(res = RESOLUTIONS.standard, domain = DOMAIN) {
    this.nx = res.nx; this.ny = res.ny; this.nz = res.nz;
    this.dom = { ...domain };
    this.vx = domain.sx / res.nx; this.vy = domain.sy / res.ny; this.vz = domain.sz / res.nz;
    this.voxelVol = this.vx * this.vy * this.vz;
    const n = res.nx * res.ny * res.nz;
    this.dist = new Float32Array(n).fill(1e6);
    this.mat = new Uint8Array(n);
    this.sed = new Float32Array(n);
    this.wet = new Float32Array(n);
    this.flux = new Float32Array(n);
    this.flowX = new Float32Array(n);
    this.flowZ = new Float32Array(n);
    this.baseDist = null; this.baseMat = null; // baked checkpoint (pre-erosion)
    this.version = 0;
  }
  get count() { return this.nx * this.ny * this.nz; }
  idx(ix, iy, iz) { return (iy * this.nz + iz) * this.nx + ix; }
  inGrid(ix, iy, iz) { return ix >= 0 && iy >= 0 && iz >= 0 && ix < this.nx && iy < this.ny && iz < this.nz; }
  inBounds(x, y, z) {
    const d = this.dom;
    return x >= d.x0 && y >= d.y0 && z >= d.z0 && x <= d.x0 + d.sx && y <= d.y0 + d.sy && z <= d.z0 + d.sz;
  }
  cellCenter(ix, iy, iz, out) {
    out[0] = this.dom.x0 + (ix + 0.5) * this.vx;
    out[1] = this.dom.y0 + (iy + 0.5) * this.vy;
    out[2] = this.dom.z0 + (iz + 0.5) * this.vz;
    return out;
  }
  worldToGrid(x, y, z, out) {
    out[0] = (x - this.dom.x0) / this.vx - 0.5;
    out[1] = (y - this.dom.y0) / this.vy - 0.5;
    out[2] = (z - this.dom.z0) / this.vz - 0.5;
    return out;
  }

  // Trilinear sample of dist; outside → +far (air) except below domain → -far (solid floor guard)
  sampleDist(x, y, z) {
    const d = this.dom;
    if (y < d.y0 - 2) return -8;
    if (!this.inBounds(x, y, z)) return 8;
    const gx = (x - d.x0) / this.vx - 0.5, gy = (y - d.y0) / this.vy - 0.5, gz = (z - d.z0) / this.vz - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), z0 = Math.floor(gz);
    const fx = gx - x0, fy = gy - y0, fz = gz - z0;
    const { nx, ny, nz, dist } = this;
    const c = (ix, iy, iz) => {
      ix = ix < 0 ? 0 : ix >= nx ? nx - 1 : ix;
      iy = iy < 0 ? 0 : iy >= ny ? ny - 1 : iy;
      iz = iz < 0 ? 0 : iz >= nz ? nz - 1 : iz;
      return dist[(iy * nz + iz) * nx + ix];
    };
    const c00 = c(x0, y0, z0) + (c(x0 + 1, y0, z0) - c(x0, y0, z0)) * fx;
    const c10 = c(x0, y0 + 1, z0) + (c(x0 + 1, y0 + 1, z0) - c(x0, y0 + 1, z0)) * fx;
    const c01 = c(x0, y0, z0 + 1) + (c(x0 + 1, y0, z0 + 1) - c(x0, y0, z0 + 1)) * fx;
    const c11 = c(x0, y0 + 1, z0 + 1) + (c(x0 + 1, y0 + 1, z0 + 1) - c(x0, y0 + 1, z0 + 1)) * fx;
    return (c00 + (c10 - c00) * fy) + ((c01 + (c11 - c01) * fy) - (c00 + (c10 - c00) * fy)) * fz;
  }

  // Central-difference gradient (points toward air). out = [x,y,z], normalized-ish.
  gradient(x, y, z, out) {
    const e = Math.min(this.vx, this.vy, this.vz) * 0.75;
    out[0] = this.sampleDist(x + e, y, z) - this.sampleDist(x - e, y, z);
    out[1] = this.sampleDist(x, y + e, z) - this.sampleDist(x, y - e, z);
    out[2] = this.sampleDist(x, y, z + e) - this.sampleDist(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  // Normalized compact brush splat. delta>0 removes solid (dist+=), delta<0 adds.
  // Returns actual applied mass in m³ (dist-units × voxelVol, clamped by availability).
  splat(x, y, z, rVox, delta, matId = -1, wetAdd = 0) {
    const g = [0, 0, 0];
    this.worldToGrid(x, y, z, g);
    const r = Math.max(rVox, 0.6);
    const x0 = Math.floor(g[0] - r), x1 = Math.ceil(g[0] + r);
    const y0 = Math.floor(g[1] - r), y1 = Math.ceil(g[1] + r);
    const z0 = Math.floor(g[2] - r), z1 = Math.ceil(g[2] + r);
    // first pass: weights
    let wSum = 0;
    const ws = [];
    for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      if (!this.inGrid(ix, iy, iz)) continue;
      const dx = (ix - g[0]) / r, dy = (iy - g[1]) / r * (this.vy / this.vx), dz = (iz - g[2]) / r;
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (q > 1) continue;
      const w = (1 - q * q) * (1 - q * q);
      ws.push([this.idx(ix, iy, iz), w]); wSum += w;
    }
    if (wSum <= 0 || ws.length === 0 || Math.abs(delta) < 1e-12) return 0;
    // Availability: erosion only bites solid-ish cells, deposition only fills air-ish
    // cells. Skipped cells contribute nothing, so returned mass is always real.
    let applied = 0;
    const inv = 1 / wSum;
    for (let k = 0; k < ws.length; k++) {
      const [id, w] = ws[k];
      const share = delta * w * inv; // Σshares = delta (pre-clamp)
      const before = this.dist[id];
      if (share > 0 && before > 0.5 * this.vx) continue;   // eroding air: no-op
      if (share < 0 && before < -1.0 * this.vx) continue;  // filling deep solid: no-op
      let after = before + share;
      // erosion (share>0): don't push solid cells past small positive cap per stamp
      if (share > 0 && before < 0 && after > 0.35 * this.vx) after = 0.35 * this.vx;
      // deposition (share<0): don't overfill below -1 voxel
      if (share < 0 && after < -this.vx) after = -this.vx;
      after = after > 12 ? 12 : after < -8 ? -8 : after;
      this.dist[id] = after;
      applied += (after - before);
      if (matId >= 0 && share < 0 && after < 0.2 * this.vx) this.mat[id] = matId;
      if (share > 0 && before < 0 && after >= 0) this.mat[id] = MAT.SEDIMENT; // freshly exposed
      if (wetAdd > 0) this.wet[id] = Math.min(1, this.wet[id] + wetAdd * w * inv);
    }
    this.version++;
    // dist·sum (m) → removed/added solid (m³): fraction of a voxel ≈ δd / voxelSize
    const av = (this.vx + this.vy + this.vz) / 3;
    return applied * this.voxelVol / av;
  }

  addFlux(x, y, z, amount, vx, vz) {
    const g = [0, 0, 0];
    this.worldToGrid(x, y, z, g);
    const ix = Math.round(g[0]), iy = Math.round(g[1]), iz = Math.round(g[2]);
    if (!this.inGrid(ix, iy, iz)) return;
    const id = this.idx(ix, iy, iz);
    this.flux[id] += amount;
    this.flowX[id] += vx * amount;
    this.flowZ[id] += vz * amount;
  }

  // Highest surface Y at (x,z) by scanning down; -1 if none.
  topSurfaceY(x, z) {
    const d = this.dom;
    const ix = Math.floor((x - d.x0) / this.vx), iz = Math.floor((z - d.z0) / this.vz);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    for (let iy = this.ny - 1; iy >= 0; iy--) {
      if (this.dist[this.idx(ix, iy, iz)] < 0) return d.y0 + (iy + 1) * this.vy;
    }
    return -1;
  }

  // Bake field closure into dist/mat. onProgress(0..1) optional. Returns elapsed ms.
  bake(fieldEval, onProgress) {
    const t0 = performance.now ? performance.now() : Date.now();
    const { nx, ny, nz, dist, mat } = this;
    const o = { mat: 0 };
    const cc = [0, 0, 0];
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        let id = (iy * nz + iz) * nx;
        for (let ix = 0; ix < nx; ix++, id++) {
          this.cellCenter(ix, iy, iz, cc);
          let d = fieldEval(cc[0], cc[1], cc[2], o);
          if (!isFinite(d)) d = 1e6;
          dist[id] = d > 12 ? 12 : d < -8 ? -8 : d;
          mat[id] = o.mat;
        }
      }
      if (onProgress && (iy & 7) === 0) onProgress(iy / ny);
    }
    this.checkpoint();
    this.clearSim();
    this.version++;
    const t1 = performance.now ? performance.now() : Date.now();
    return t1 - t0;
  }

  checkpoint() {
    this.baseDist = Float32Array.from(this.dist);
    this.baseMat = Uint8Array.from(this.mat);
  }
  restoreBase() {
    if (!this.baseDist) return false;
    this.dist.set(this.baseDist); this.mat.set(this.baseMat);
    this.clearSim(); this.version++;
    return true;
  }
  clearSim() {
    this.sed.fill(0); this.wet.fill(0); this.flux.fill(0); this.flowX.fill(0); this.flowZ.fill(0);
    this.version++;
  }
  decayWetFlux(wetDecay, fluxDecay) {
    if (wetDecay > 0) { const w = this.wet; for (let i = 0; i < w.length; i++) w[i] *= wetDecay; }
    if (fluxDecay > 0 && fluxDecay < 1) {
      const f = this.flux, fx = this.flowX, fz = this.flowZ;
      for (let i = 0; i < f.length; i++) { f[i] *= fluxDecay; fx[i] *= fluxDecay; fz[i] *= fluxDecay; }
    }
  }

  stats() {
    let solid = 0, surf = 0;
    const { nx, ny, nz, dist } = this;
    for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const id = (iy * nz + iz) * nx + ix;
      if (dist[id] < 0) {
        solid++;
        if (ix + 1 >= nx || dist[id + 1] >= 0 || (iy + 1 < ny && dist[id + nz * nx] >= 0)) surf++;
      }
    }
    return { solid, surf, solidM3: solid * this.voxelVol };
  }

  // Top-down flow projection for the water shader: RGBA float (flowX, flowZ, flux, shoreDist)
  flowTextureData() {
    const { nx, nz, ny } = this;
    const data = new Float32Array(nx * nz * 4);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      let fx = 0, fz = 0, fl = 0, found = false;
      for (let iy = ny - 1; iy >= 0; iy--) {
        const id = (iy * nz + iz) * nx + ix;
        if (this.flux[id] > 1e-6) { fx = this.flowX[id]; fz = this.flowZ[id]; fl = this.flux[id]; found = true; break; }
      }
      const o = (iz * nx + ix) * 4;
      data[o] = fx; data[o + 1] = fz; data[o + 2] = fl; data[o + 3] = found ? 1 : 0;
    }
    return { data, nx, nz };
  }
}
