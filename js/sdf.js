// Volumetric SDF field: storage, sampling, splats, primitives, CSG ops. DOM-free.
export const AIR = 1e4;
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function tapLinear(a, R, R2, gx, gy, gz) {
  gx = gx < 0 ? 0 : gx > R - 1.001 ? R - 1.001 : gx;
  gy = gy < 0 ? 0 : gy > R - 1.001 ? R - 1.001 : gy;
  gz = gz < 0 ? 0 : gz > R - 1.001 ? R - 1.001 : gz;
  const ix = gx | 0, iy = gy | 0, iz = gz | 0;
  const fx = gx - ix, fy = gy - iy, fz = gz - iz;
  const i000 = (iz * R + iy) * R + ix, i100 = i000 + 1;
  const i010 = i000 + R, i110 = i010 + 1;
  const i001 = i000 + R2, i101 = i001 + 1, i011 = i001 + R, i111 = i011 + 1;
  const x00 = a[i000] + (a[i100] - a[i000]) * fx;
  const x10 = a[i010] + (a[i110] - a[i010]) * fx;
  const x01 = a[i001] + (a[i101] - a[i001]) * fx;
  const x11 = a[i011] + (a[i111] - a[i011]) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export class SdfField {
  // World box: x,z in [-halfXZ, halfXZ], y in [0, height]. d<0 solid, d>0 air.
  constructor(res = 80, halfXZ = 100, height = 80) {
    this.res = res; this.hx = halfXZ; this.h = height;
    const n = res * res * res;
    this.d = new Float32Array(n);      // signed distance (approx, world units)
    this.hard = new Float32Array(n);   // rock hardness 0..1
    this.flow = new Float32Array(n);   // accumulated river discharge (viz)
    this.sed = new Float32Array(n);    // accumulated sediment deposit (viz)
    this.dx = (2 * halfXZ) / (res - 1);
    this.dy = height / (res - 1);
    this._nx = 1 / (2 * this.dx * 0.75); this._ny = 1 / (2 * this.dy * 0.75);
    this.clear();
  }
  get n() { return this.d.length; }
  clear(v = AIR) { this.d.fill(v); this.hard.fill(0.5); this.flow.fill(0); this.sed.fill(0); }
  idx(i, j, k) { return (k * this.res + j) * this.res + i; }
  w2g(x, y, z, out) {
    out = out || [0, 0, 0];
    out[0] = ((x + this.hx) / (2 * this.hx)) * (this.res - 1);
    out[1] = (y / this.h) * (this.res - 1);
    out[2] = ((z + this.hx) / (2 * this.hx)) * (this.res - 1);
    return out;
  }
  g2w(i, j, k, out) {
    out = out || [0, 0, 0];
    out[0] = -this.hx + (i / (this.res - 1)) * 2 * this.hx;
    out[1] = (j / (this.res - 1)) * this.h;
    out[2] = -this.hx + (k / (this.res - 1)) * 2 * this.hx;
    return out;
  }
  inWorld(x, y, z, m = 0) {
    return x > -this.hx - m && x < this.hx + m && y > -m && y < this.h + m && z > -this.hx - m && z < this.hx + m;
  }
  // Trilinear sample of any grid array in world coords (clamped).
  sample(a, x, y, z) {
    const R = this.res;
    let gx = ((x + this.hx) / (2 * this.hx)) * (R - 1);
    let gy = (y / this.h) * (R - 1);
    let gz = ((z + this.hx) / (2 * this.hx)) * (R - 1);
    gx = gx < 0 ? 0 : gx > R - 1.001 ? R - 1.001 : gx;
    gy = gy < 0 ? 0 : gy > R - 1.001 ? R - 1.001 : gy;
    gz = gz < 0 ? 0 : gz > R - 1.001 ? R - 1.001 : gz;
    const ix = gx | 0, iy = gy | 0, iz = gz | 0;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const i000 = (iz * R + iy) * R + ix, i100 = i000 + 1;
    const i010 = i000 + R, i110 = i010 + 1;
    const i001 = i000 + R * R, i101 = i001 + 1, i011 = i001 + R, i111 = i011 + 1;
    const x00 = a[i000] + (a[i100] - a[i000]) * fx;
    const x10 = a[i010] + (a[i110] - a[i010]) * fx;
    const x01 = a[i001] + (a[i101] - a[i001]) * fx;
    const x11 = a[i011] + (a[i111] - a[i011]) * fx;
    const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }
  // Central-difference gradient in world units. Points toward increasing values (outward for SDF).
  grad(a, x, y, z, out) {
    out = out || [0, 0, 0];
    const ex = this.dx * 0.75, ey = this.dy * 0.75, ez = this.dx * 0.75;
    out[0] = (this.sample(a, x + ex, y, z) - this.sample(a, x - ex, y, z)) / (2 * ex);
    out[1] = (this.sample(a, x, y + ey, z) - this.sample(a, x, y - ey, z)) / (2 * ey);
    out[2] = (this.sample(a, x, y, z + ez) - this.sample(a, x, y, z - ez)) / (2 * ez);
    return out;
  }
  // Faster gradient: single grid transform, direct trilinear taps (same math as grad).
  gradFast(a, x, y, z, out) {
    out = out || [0, 0, 0];
    const R = this.res, R2 = R * R;
    const sx = (R - 1) / (2 * this.hx), sy = (R - 1) / this.h;
    const gx = (x + this.hx) * sx, gy = y * sy, gz = (z + this.hx) * sx;
    out[0] = (tapLinear(a, R, R2, gx + 0.75, gy, gz) - tapLinear(a, R, R2, gx - 0.75, gy, gz)) * this._nx;
    out[1] = (tapLinear(a, R, R2, gx, gy + 0.75, gz) - tapLinear(a, R, R2, gx, gy - 0.75, gz)) * this._ny;
    out[2] = (tapLinear(a, R, R2, gx, gy, gz + 0.75) - tapLinear(a, R, R2, gx, gy, gz - 0.75)) * this._nx;
    return out;
  }
  // Add delta with smooth spherical falloff. Optional second array (delta recorder) + hardness gating.
  splat(a, x, y, z, rWorld, delta, second = null, hardGate = 0) {
    if (delta === 0 || rWorld <= 0) return;
    const R = this.res;
    const rx = rWorld / this.dx, ry = rWorld / this.dy, rz = rWorld / this.dx;
    const g = this.w2g(x, y, z, SdfField._g);
    const x0 = Math.max(0, Math.floor(g[0] - rx)), x1 = Math.min(R - 1, Math.ceil(g[0] + rx));
    const y0 = Math.max(0, Math.floor(g[1] - ry)), y1 = Math.min(R - 1, Math.ceil(g[1] + ry));
    const z0 = Math.max(0, Math.floor(g[2] - rz)), z1 = Math.min(R - 1, Math.ceil(g[2] + rz));
    const hard = this.hard, gate = hardGate !== 0;
    for (let k = z0; k <= z1; k++) {
      const dz = (k - g[2]) / rz;
      for (let j = y0; j <= y1; j++) {
        const dy = (j - g[1]) / ry;
        let id = (k * R + j) * R + x0;
        for (let i = x0; i <= x1; i++, id++) {
          const dx = (i - g[0]) / rx;
          const q = dx * dx + dy * dy + dz * dz;
          if (q > 1) continue;
          const fall = SdfField._lut[(q * 64) | 0];
          let m = delta * fall;
          if (gate) m *= 1 - hardGate * hard[id];
          a[id] += m;
          if (second) second[id] += m;
        }
      }
    }
  }
  // Scan a vertical column for the topmost surface. Returns world y or null.
  findSurface(x, z, yTop = null, yBot = 0) {
    const R = this.res;
    let gx = ((x + this.hx) / (2 * this.hx)) * (R - 1);
    let gz = ((z + this.hx) / (2 * this.hx)) * (R - 1);
    const ix = Math.round(gx < 0 ? 0 : gx > R - 1 ? R - 1 : gx);
    const iz = Math.round(gz < 0 ? 0 : gz > R - 1 ? R - 1 : gz);
    let j1 = R - 1;
    if (yTop !== null) j1 = Math.min(R - 1, Math.max(0, Math.round((yTop / this.h) * (R - 1))));
    const j0 = Math.max(0, Math.round((yBot / this.h) * (R - 1)));
    const d = this.d;
    let prev = d[(iz * R + j1) * R + ix] ?? AIR;
    for (let j = j1 - 1; j >= j0; j--) {
      const v = d[(iz * R + j) * R + ix];
      if (v < 0 && prev >= 0) {
        const t = prev / (prev - v);
        const gj = j + t;
        return (gj / (R - 1)) * this.h;
      }
      prev = v;
    }
    return null;
  }
  statSurface() { // fraction of columns with a surface (for spawn rejection stats)
    const R = this.res; let hit = 0, tot = 0;
    for (let iz = 0; iz < R; iz += 2) for (let ix = 0; ix < R; ix += 2) {
      tot++;
      for (let j = R - 1; j >= 0; j--) { if (this.d[(iz * R + j) * R + ix] < 0) { hit++; break; } }
    }
    return hit / Math.max(1, tot);
  }
}
SdfField._g = [0, 0, 0];
SdfField._lut = (() => { const L = new Float32Array(65); for (let i = 0; i < 65; i++) L[i] = 0.5 + 0.5 * Math.cos(Math.PI * Math.sqrt(i / 64)); return L; })();

// ---------- primitive SDFs (world space, negative inside) ----------
export const sdfSphere = (x, y, z, cx, cy, cz, r) =>
  Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r;
export function sdfBox(x, y, z, cx, cy, cz, sx, sy, sz, rotY = 0) {
  let px = x - cx, pz = z - cz;
  if (rotY) { const c = Math.cos(rotY), s = Math.sin(rotY); const tx = px * c - pz * s; pz = px * s + pz * c; px = tx; }
  const qx = Math.abs(px) - sx, qy = Math.abs(y - cy) - sy, qz = Math.abs(pz) - sz;
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0), az = Math.max(qz, 0);
  return Math.sqrt(ax * ax + ay * ay + az * az) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}
export function sdfTorus(x, y, z, cx, cy, cz, Rr, r) {
  const px = x - cx, py = y - cy, pz = z - cz;
  const q = Math.sqrt(px * px + pz * pz) - Rr;
  return Math.sqrt(q * q + py * py) - r;
}
export function sdfCapsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
// ---------- CSG ----------
export const opU = (a, b) => Math.min(a, b);
export const opS = (a, b) => Math.max(a, -b);
export const opI = (a, b) => Math.max(a, b);
export function opSU(a, b, k) {
  if (k <= 0.0001) return Math.min(a, b);
  const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}
export function opSS(a, b, k) { // smooth subtract: a minus b
  if (k <= 0.0001) return Math.max(a, -b);
  const h = Math.min(1, Math.max(0, 0.5 - 0.5 * (a + b) / k));
  const m = b * (1 - h) - a * h; // mix(b, -a, h)
  return -(m + k * h * (1 - h));
}
// Single 3x3x3 box-blur pass on d (in place, strength 0..1). Used by Smooth node.
export function blurFieldInPlace(d, res, strength = 0.5) {
  const tmp = new Float32Array(d);
  const R = res, s = Math.min(1, Math.max(0, strength)) / 27;
  for (let k = 1; k < R - 1; k++) for (let j = 1; j < R - 1; j++) {
    let id = (k * R + j) * R + 1;
    for (let i = 1; i < R - 1; i++, id++) {
      let sum = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++)
        sum += tmp[id + a + b * R + c * R * R];
      d[id] = d[id] + (sum * s * 27 / 27 * 27 / 27 - d[id]) * 0 + (sum / 27 - d[id]) * Math.min(1, Math.max(0, strength));
    }
  }
}
