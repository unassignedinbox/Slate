// Particle erosion on volumetric SDF: hydraulic droplets (with settling),
// thermal relaxation, wind saltation/abrasion, river path capture. DOM-free.
import { Rng, makeNoise } from './noise.js';
import { clamp01 } from './sdf.js';

const TRAIL = 24; // recorded trail points per droplet (for river extraction)

// 2D top-down discharge map feeding the water shader (flow dir + foam).
export class FlowMap {
  constructor(n = 256, halfXZ = 100) {
    this.n = n; this.hx = halfXZ;
    this.data = new Float32Array(n * n * 4); // r:discharge g:dirx b:dirz a:sediment
    this.bytes = new Uint8Array(n * n * 4);
    this.maxQ = 1;
    this.dirty = true;
  }
  reset() { this.data.fill(0); this.maxQ = 1; this.dirty = true; }
  splat(x, z, dx, dz, q, sed) {
    const n = this.n;
    const gx = ((x + this.hx) / (2 * this.hx)) * (n - 1);
    const gz = ((z + this.hx) / (2 * this.hx)) * (n - 1);
    const ix = Math.round(gx), iz = Math.round(gz);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return;
    const id = (iz * n + ix) * 4, d = this.data;
    d[id] += q; d[id + 1] += dx * q; d[id + 2] += dz * q; d[id + 3] += sed;
    if (d[id] > this.maxQ) this.maxQ = d[id];
    this.dirty = true;
  }
  decay(f = 0.9995) {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] *= f;
    this.maxQ *= f; if (this.maxQ < 1) this.maxQ = 1;
    this.dirty = true;
  }
  // Rebuild from a 3D field's flow channel by top-down max projection.
  // Discharge is overwritten; directions are preserved so water keeps flowing.
  reproject(field) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 0; d[i + 3] *= 0.25; }
    this.maxQ = 1;
    const R = field.res, n = this.n, fl = field.flow;
    for (let iz = 0; iz < n; iz++) {
      const z = -this.hx + (iz / (n - 1)) * 2 * this.hx;
      for (let ix = 0; ix < n; ix++) {
        const x = -this.hx + (ix / (n - 1)) * 2 * this.hx;
        const gx = Math.round(((x + field.hx) / (2 * field.hx)) * (R - 1));
        const gz = Math.round(((z + field.hx) / (2 * field.hx)) * (R - 1));
        let best = 0;
        for (let j = 0; j < R; j++) {
          const v = fl[(gz * R + j) * R + gx];
          if (v > best) best = v;
        }
        if (best > 0) {
          const id = (iz * n + ix) * 4;
          this.data[id] = best;
          if (best > this.maxQ) this.maxQ = best;
        }
      }
    }
    this.dirty = true;
  }
  quantize() { // -> Uint8 RGBA for GPU upload
    const d = this.data, b = this.bytes, m = 1 / Math.max(1e-6, this.maxQ);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 4) {
      const q = Math.min(1, d[i] * m * 3);
      b[j] = Math.round(255 * Math.pow(q, 0.6));
      const dl = Math.hypot(d[i + 1], d[i + 2]) || 1;
      b[j + 1] = Math.round(255 * (0.5 + 0.5 * d[i + 1] / dl * Math.min(1, q * 4)));
      b[j + 2] = Math.round(255 * (0.5 + 0.5 * d[i + 2] / dl * Math.min(1, q * 4)));
      b[j + 3] = Math.round(255 * Math.min(1, d[i + 3] * m * 3));
    }
    this.dirty = false;
    return this.bytes;
  }
}

let _g = [0, 0, 0];

// ---------------------------------------------------------------- hydraulic
export class HydroSim {
  constructor(cap = 16000, seed = 7) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.dir = new Float32Array(cap * 3);
    this.speed = new Float32Array(cap);
    this.water = new Float32Array(cap);
    this.sed = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.state = new Uint8Array(cap);   // 0 dead, 1 eroding, 2 depositing, 3 airborne, 4 settled-dying
    this.trail = new Float32Array(cap * TRAIL * 3);
    this.trailN = new Uint8Array(cap);
    this.trailTick = new Uint8Array(cap);
    this.travel = new Float32Array(cap);
    this.charge = new Float32Array(cap); // accumulated discharge (river candidacy)
    this.vy = new Float32Array(cap);     // airborne vertical velocity
    this.cursor = 0;
    this.alive = 0;
    this.rng = new Rng(seed);
    this.rivers = [];
    // render buffers (filled each step for live particles)
    this.rPos = new Float32Array(cap * 3);
    this.rCol = new Float32Array(cap * 3);
    this.rCount = 0;
    this.eroded = 0; this.deposited = 0; this.drops = 0;
  }
  reset() {
    this.state.fill(0); this.trailN.fill(0); this.travel.fill(0); this.charge.fill(0);
    this.alive = 0; this.rCount = 0; this.rivers.length = 0;
    this.eroded = 0; this.deposited = 0; this.drops = 0;
  }
  spawn(field, n, mode, P, srcPts, waterLevel = -1) {
    const avail = this.cap - this.alive; // early-out: never scan a saturated pool
    if (avail <= 0) return 0;
    n = Math.min(n, avail);
    const rng = this.rng;
    let spawned = 0, guard = n * 12 + 50;
    while (spawned < n && guard-- > 0) {
      let x, z;
      if (mode === 'sources' && srcPts && srcPts.length) {
        const s = srcPts[(rng.next() * srcPts.length) | 0];
        x = s[0] + rng.range(-1, 1) * (P.sourceSpread || 6);
        z = s[1] + rng.range(-1, 1) * (P.sourceSpread || 6);
      } else if (mode === 'both' && srcPts && srcPts.length && rng.next() < 0.45) {
        const s = srcPts[(rng.next() * srcPts.length) | 0];
        x = s[0] + rng.range(-1, 1) * (P.sourceSpread || 6);
        z = s[1] + rng.range(-1, 1) * (P.sourceSpread || 6);
      } else {
        x = rng.range(-field.hx * 0.98, field.hx * 0.98);
        z = rng.range(-field.hx * 0.98, field.hx * 0.98);
      }
      const y = field.findSurface(x, z);
      if (y === null || y < waterLevel + 0.3) continue; // rain on lakes does nothing
      // find dead slot
      let idx = -1;
      for (let t = 0; t < this.cap; t++) {
        this.cursor = (this.cursor + 1) % this.cap;
        if (this.state[this.cursor] === 0) { idx = this.cursor; break; }
      }
      if (idx < 0) return spawned;
      const i3 = idx * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = y + field.dy * 0.4; this.pos[i3 + 2] = z;
      const a = rng.next() * Math.PI * 2;
      this.dir[i3] = Math.cos(a); this.dir[i3 + 1] = -0.2; this.dir[i3 + 2] = Math.sin(a);
      this.speed[idx] = 1;
      this.water[idx] = 1;
      this.sed[idx] = 0; this.life[idx] = P.maxLife * rng.range(0.6, 1.2);
      this.state[idx] = 1; this.trailN[idx] = 0; this.trailTick[idx] = 0;
      this.travel[idx] = 0; this.charge[idx] = 0; this.vy[idx] = 0;
      this.alive++; this.drops++; spawned++;
    }
    return spawned;
  }
  kill(i, field, P, rec, finalize = true) {
    // SETTLING: deposit remaining sediment, but slide below the angle of
    // repose first so death-settling builds fans — never spires.
    const s = this.sed[i];
    if (s > 1e-4 && finalize) {
      const i3 = i * 3;
      const vox = (field.dx + field.dy) * 0.5;
      let x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      const repose = P.repose || 0.85;
      for (let t = 0; t < 6; t++) {
        field.gradFast(field.d, x, y, z, _g);
        const gl = Math.hypot(_g[0], _g[1], _g[2]) || 1;
        const slope = Math.hypot(_g[0], _g[2]) / Math.max(0.2, _g[1] / gl);
        if (slope < repose) break;
        const dl = Math.hypot(_g[0], _g[2]) || 1;
        x -= (_g[0] / dl) * vox * 1.5; z -= (_g[2] / dl) * vox * 1.5;
        y -= vox * 0.8;
      }
      let amt = Math.min(s, P.maxSed) * P.settleScale;
      if (rec && rec.baseSnap) {
        const fill = field.sample(rec.baseSnap, x, y, z) - field.sample(field.d, x, y, z);
        if (fill > 0) amt *= clamp01(1 - fill / (P.maxFill || 6));
      }
      const r = vox * P.radius * 2.4; // wide, soft fan
      field.splat(field.d, x, y, z, r, -amt, rec ? rec.delta : null);
      if (rec) field.splat(rec.sedA, x, y, z, r, s * 0.4);
      this.deposited += s;
    }
    // river candidacy from trail
    if (finalize && this.trailN[i] >= 5 && this.charge[i] > (P.riverMin || 30) && this.travel[i] > field.dx * 8) {
      const pts = [], ws = [];
      const tn = this.trailN[i];
      for (let t = 0; t < tn; t++) {
        const o = (i * TRAIL + t) * 3;
        pts.push([this.trail[o], this.trail[o + 1], this.trail[o + 2]]);
        ws.push(P.riverWidth || 2);
      }
      this.rivers.push({ pts, w: ws, q: this.charge[i] / Math.max(1, tn), score: this.charge[i] * this.travel[i] });
      if (this.rivers.length > 48) {
        this.rivers.sort((a, b) => b.score - a.score);
        this.rivers.length = 48;
      }
    }
    this.state[i] = 0; this.alive--;
  }
  step(field, flowmap, dt, P, rec, waterLevel) {
    dt = Math.min(dt, 1 / 20);
    const vox = (field.dx + field.dy) * 0.5;
    const surfOff = vox * 0.35, airGap = vox * 2.2;
    const maxStep = vox * 1.6;
    let rc = 0;
    const rP = this.rPos, rC = this.rCol;
    for (let i = 0; i < this.cap; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      const i3 = i * 3;
      let x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      // drowned in lake/sea -> rapid sedimentation, settle, die
      if (y < waterLevel - vox * 0.5) {
        const dep = this.sed[i];
        if (dep > 1e-4 && rec && rec.baseSnap) {
          const fill = field.sample(rec.baseSnap, x, y, z) - field.sample(field.d, x, y, z);
          if (fill > (P.maxFill || 6)) { this.sed[i] = 0; this.kill(i, field, P, rec, false); continue; }
        }
        if (dep > 1e-4) {
          field.splat(field.d, x, y, z, vox * P.radius * 2.4, -dep * P.settleScale, rec ? rec.delta : null);
          if (rec) field.splat(rec.sedA, x, y, z, vox * P.radius * 2.4, dep * 0.6);
          this.deposited += dep; this.sed[i] = 0;
        }
        if (flowmap && this.speed[i] > 0.5) flowmap.splat(x, z, this.dir[i3], this.dir[i3 + 2], this.water[i], 0);
        this.kill(i, field, P, rec, true);
        continue;
      }
      const dd = field.sample(field.d, x, y, z);
      if (dd > airGap || st === 3) {
        // ---- airborne: ballistic fall (waterfalls off cliffs/overhangs) ----
        this.state[i] = 3;
        this.vy[i] -= P.gravity * dt;
        x += this.dir[i3] * this.speed[i] * dt * 0.6;
        y += this.vy[i] * dt;
        z += this.dir[i3 + 2] * this.speed[i] * dt * 0.6;
        this.water[i] *= (1 - P.evap * dt * 0.5);
        this.life[i] -= dt * 60 * 0.5;
        const nd = field.sample(field.d, x, y, z);
        if (nd <= surfOff) { // impact!
          this.state[i] = 1;
          this.speed[i] = Math.min(24, this.speed[i] * 0.4 + Math.abs(this.vy[i]) * 0.35);
          this.vy[i] = 0;
          y += (surfOff - nd) * 0.5;
          // impact crater (small) + splash wetness
          const imp = Math.min(0.5, this.water[i] * 0.1) * P.erode;
          if (imp > 0.001) {
            const hard = field.sample(field.hard, x, y, z);
            field.splat(field.d, x, y, z, vox * P.radius, imp * (1 - hard * P.hardness), rec ? rec.delta : null);
            this.eroded += imp; this.sed[i] = Math.min(P.maxSed, this.sed[i] + imp);
          }
          if (flowmap) flowmap.splat(x, z, this.dir[i3], this.dir[i3 + 2], this.water[i] * 2, this.sed[i]);
        } else if (!field.inWorld(x, y, z, 2) || this.life[i] <= 0 || y < -1) {
          this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
          this.kill(i, field, P, rec, false);
          continue;
        }
        this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
        rP[rc * 3] = x; rP[rc * 3 + 1] = y; rP[rc * 3 + 2] = z;
        rC[rc * 3] = 0.45; rC[rc * 3 + 1] = 0.65; rC[rc * 3 + 2] = 1.0;
        rc++;
        continue;
      }
      // ---- on surface ----
      field.gradFast(field.d, x, y, z, _g);
      let gl = Math.hypot(_g[0], _g[1], _g[2]);
      if (gl < 1e-5) { this.kill(i, field, P, rec, true); continue; }
      const nx = _g[0] / gl, ny = _g[1] / gl, nz = _g[2] / gl;
      if (ny < 0.12) { this.state[i] = 3; this.vy[i] = 0; continue; } // overhang lip -> detach
      // steepest descent tangent
      let tx = -nx * ny, ty = -(1 - ny * ny), tz = -nz * ny;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-5) { tx = this.dir[i3]; ty = 0; tz = this.dir[i3 + 2]; tl = Math.hypot(tx, tz) || 1; }
      tx /= tl; ty /= tl; tz /= tl;
      const slope = Math.min(1.2, Math.hypot(nx, nz) / Math.max(0.25, ny));
      const inert = P.inertia;
      let dx = this.dir[i3] * inert + tx * (1 - inert);
      let dy = this.dir[i3 + 1] * inert + ty * (1 - inert);
      let dz = this.dir[i3 + 2] * inert + tz * (1 - inert);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      // speed dynamics: accelerate downhill, friction on flats
      const target = Math.min(26, slope * 34);
      let sp = this.speed[i] + (target - this.speed[i]) * Math.min(1, 2.5 * dt);
      if (slope < P.minSlope) sp *= (1 - 3.0 * dt);
      sp = Math.max(0, sp);
      let stepLen = Math.min(maxStep, sp * dt + vox * 0.15);
      x += dx * stepLen; z += dz * stepLen;
      y += dy * stepLen;
      // re-project onto surface
      const pd = field.sample(field.d, x, y, z);
      if (pd > airGap) { // walked off a cliff
        this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
        this.dir[i3] = dx; this.dir[i3 + 1] = dy; this.dir[i3 + 2] = dz;
        this.speed[i] = sp; this.state[i] = 3; this.vy[i] = 0;
        continue;
      }
      field.gradFast(field.d, x, y, z, _g);
      gl = Math.hypot(_g[0], _g[1], _g[2]) || 1;
      const corr = (pd - surfOff) / gl;
      x -= (_g[0] / gl) * corr; y -= (_g[1] / gl) * corr; z -= (_g[2] / gl) * corr;
      this.travel[i] += stepLen;
      // sediment capacity & exchange (Hansson-style, hardness + settling)
      const w = this.water[i];
      const cap = P.capacity * Math.max(0, slope - P.minSlope * 0.5) * (0.25 + 0.75 * Math.min(1, sp / 14)) * w + 1e-5;
      const hard = field.sample(field.hard, x, y, z);
      let drew = 1;
      if (this.sed[i] < cap && slope > P.minSlope) {
        let amt = Math.min((cap - this.sed[i]) * P.erode, P.maxErode * dt * 60);
        amt *= (1 - hard * P.hardness);
        if (rec && rec.baseSnap) { // bedrock: incision limit + sediment shielding
          const cur = field.sample(field.d, x, y, z);
          const inc = cur - field.sample(rec.baseSnap, x, y, z);
          if (inc > 0) amt *= clamp01(1 - inc / (P.maxDepth || 14));
          amt *= clamp01(1 - field.sample(rec.sedA, x, y, z) / 6);
        }
        if (amt > 1e-5) {
          field.splat(field.d, x, y, z, vox * P.radius, amt, rec ? rec.delta : null, 0);
          // lateral undercut: widens channels, undercuts banks -> overhangs
          if (P.lateral > 0.01) {
            field.splat(field.d, x - nx * vox * 0.8, y - vox * 0.4, z - nz * vox * 0.8,
              vox * P.radius * 1.6, amt * P.lateral, rec ? rec.delta : null, 0);
          }
          this.sed[i] = Math.min(P.maxSed, this.sed[i] + amt * (1 + P.lateral));
          this.eroded += amt;
          if (rec) field.splat(rec.flowA, x, y, z, vox * P.radius * 1.5, amt * 2 + w * dt * 2);
          drew = 1;
        }
      } else {
        let amt = Math.min((this.sed[i] - cap) * P.deposit, this.sed[i]);
        if (this.sed[i] > P.maxSed) amt = Math.max(amt, (this.sed[i] - P.maxSed) * 0.5);
        if (slope > (P.repose || 0.85)) {
          // too steep to settle: keep carrying (only bleed off hard overload)
          amt = Math.min(amt, Math.max(0, this.sed[i] - P.maxSed) * 0.25);
        }
        if (rec && rec.baseSnap && amt > 1e-5) { // fill-cap: mounds can't pile forever
          const fill = field.sample(rec.baseSnap, x, y, z) - field.sample(field.d, x, y, z);
          if (fill > 0) amt *= clamp01(1 - fill / (P.maxFill || 6));
        }
        if (amt > 1e-5) {
          field.splat(field.d, x + dx * vox * 1.5, y, z + dz * vox * 1.5,
            vox * P.radius * 2.3, -amt * P.settleScale, rec ? rec.delta : null);
          if (rec) field.splat(rec.sedA, x, y, z, vox * P.radius * 2.0, amt * 0.6);
          this.sed[i] -= amt; this.deposited += amt;
          drew = 2;
        }
      }
      this.charge[i] += w * (0.5 + sp * 0.25) * dt * 60 * 0.05;
      if (flowmap) flowmap.splat(x, z, dx, dz, w * (0.4 + sp * 0.12) * dt * 60 * 0.08, this.sed[i] * dt);
      // trail record
      if (++this.trailTick[i] >= 4) {
        this.trailTick[i] = 0;
        let tn = this.trailN[i];
        if (tn >= TRAIL) { // shift
          const b = i * TRAIL * 3;
          this.trail.copyWithin(b, b + 3, b + TRAIL * 3);
          tn = TRAIL - 1;
        }
        const o = (i * TRAIL + tn) * 3;
        this.trail[o] = x; this.trail[o + 1] = y; this.trail[o + 2] = z;
        this.trailN[i] = tn + 1;
      }
      // evaporate / age; flats sink water -> forced settle (no eternal cutters)
      this.water[i] = w * (1 - P.evap * dt * 2);
      if (slope < P.minSlope) this.water[i] -= P.sink * dt;
      this.life[i] -= dt * 60;
      this.dir[i3] = dx; this.dir[i3 + 1] = dy; this.dir[i3 + 2] = dz;
      this.speed[i] = sp;
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      if (this.life[i] <= 0 || this.water[i] <= 0.04 || !field.inWorld(x, y, z, 1)) {
        this.kill(i, field, P, rec, true); // <-- settle remainder
        continue;
      }
      this.state[i] = drew;
      rP[rc * 3] = x; rP[rc * 3 + 1] = y; rP[rc * 3 + 2] = z;
      if (drew === 1) { rC[rc * 3] = 1.0; rC[rc * 3 + 1] = 0.55 + hard * 0.2; rC[rc * 3 + 2] = 0.2; }
      else { rC[rc * 3] = 0.3; rC[rc * 3 + 1] = 0.85; rC[rc * 3 + 2] = 1.0; }
      rc++;
    }
    this.rCount = rc;
  }
}

// ---------------------------------------------------------------- thermal
export class ThermalSim {
  constructor(seed = 21) { this.rng = new Rng(seed); this.moved = 0; }
  reset() { this.moved = 0; }
  step(field, samples, P, rec) {
    const rng = this.rng, R = field.res;
    const vox = (field.dx + field.dy) * 0.5;
    let moved = 0;
    for (let s = 0; s < samples; s++) {
      const i = 1 + ((rng.next() * (R - 2)) | 0), j = 1 + ((rng.next() * (R - 2)) | 0), k = 1 + ((rng.next() * (R - 2)) | 0);
      const id = (k * R + j) * R + i;
      const dv = field.d[id];
      if (dv > vox * 1.5 || dv < -vox * 2.5) continue; // only near surface
      const x = -field.hx + (i / (R - 1)) * 2 * field.hx;
      const y = (j / (R - 1)) * field.h;
      const z = -field.hx + (k / (R - 1)) * 2 * field.hx;
      field.gradFast(field.d, x, y, z, _g);
      const gl = Math.hypot(_g[0], _g[1], _g[2]) || 1;
      const ny = _g[1] / gl;
      const slope = Math.hypot(_g[0], _g[2]) / Math.max(0.2, ny); // tan of slope angle
      if (slope <= P.talus) continue;
      const hard = field.hard[id];
      let amt = (slope - P.talus) * P.rate * (1 - hard * P.hardness);
      if (amt <= 1e-5) continue;
      amt = Math.min(amt, 0.6);
      // move from high point to downhill neighbour
      const dl = Math.hypot(_g[0], _g[2]) || 1;
      const hx = x - (_g[0] / dl) * vox * 1.6, hz = z - (_g[2] / dl) * vox * 1.6;
      const hy = Math.max(0.5, y - vox * 1.2);
      field.splat(field.d, x, y, z, vox * 1.1, amt, rec ? rec.delta : null, 0);
      field.splat(field.d, hx, hy, hz, vox * 1.3, -amt, rec ? rec.delta : null);
      if (rec) field.splat(rec.sedA, hx, hy, hz, vox * 1.4, amt * 0.4);
      moved += amt;
    }
    this.moved += moved;
    return moved;
  }
}

// ---------------------------------------------------------------- wind
export class WindSim {
  constructor(cap = 6000, seed = 99) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.sed = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.state = new Uint8Array(cap);
    this.cursor = 0; this.alive = 0;
    this.rng = new Rng(seed);
    this.noise = makeNoise(seed);
    this.seg = new Float32Array(cap * 6); // line segments for streaks
    this.segN = 0;
    this.eroded = 0; this.deposited = 0;
  }
  reset() { this.state.fill(0); this.alive = 0; this.segN = 0; this.eroded = 0; this.deposited = 0; }
  spawn(field, n, P) {
    const avail = this.cap - this.alive; // early-out: never scan a saturated pool
    if (avail <= 0) return 0;
    n = Math.min(n, avail);
    const rng = this.rng;
    const ang = (P.direction || 0) * Math.PI / 180;
    const wx = Math.cos(ang), wz = Math.sin(ang);
    let spawned = 0, guard = n * 4 + 20;
    while (spawned < n && guard-- > 0) {
      let idx = -1;
      for (let t = 0; t < this.cap; t++) {
        this.cursor = (this.cursor + 1) % this.cap;
        if (this.state[this.cursor] === 0) { idx = this.cursor; break; }
      }
      if (idx < 0) return spawned;
      // spawn on upwind face
      const t = rng.next(), h = rng.range(0.02, 0.75);
      const m = field.hx * 0.96;
      const x = -wx * m + -wz * (t - 0.5) * 2 * m;
      const z = -wz * m + wx * (t - 0.5) * 2 * m;
      const y = Math.max(1, field.findSurface(x, z) ?? 2) + rng.range(0.5, 14) * (1 - h * 0.5);
      const i3 = idx * 3;
      this.pos[i3] = x; this.pos[i3 + 1] = Math.min(field.h - 1, y); this.pos[i3 + 2] = z;
      const sp = P.speed * rng.range(0.7, 1.3);
      this.vel[i3] = wx * sp; this.vel[i3 + 1] = rng.range(-1, 0.5); this.vel[i3 + 2] = wz * sp;
      this.sed[idx] = 0; this.life[idx] = rng.range(80, 200);
      this.state[idx] = 1;
      this.alive++; spawned++;
    }
    return spawned;
  }
  step(field, dt, P, rec) {
    dt = Math.min(dt, 1 / 20);
    const vox = (field.dx + field.dy) * 0.5;
    const ang = (P.direction || 0) * Math.PI / 180;
    const wx = Math.cos(ang), wz = Math.sin(ang);
    const turb = P.turbulence, t = (this._t = (this._t || 0) + dt);
    let sn = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.state[i] === 0) continue;
      const i3 = i * 3;
      let x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      // turbulence gust field
      const s = 0.02;
      const n1 = this.noise.n3(x * s + t * 0.3, y * s, z * s);
      const n2 = this.noise.n3(x * s, y * s + 7.3, z * s + t * 0.23);
      let vx = wx * P.speed + n1 * turb * P.speed * 0.6;
      let vy = this.vel[i3 + 1] * 0.94 + (n2 * turb * 3 - 1.2) * dt * 4 - P.gravity * dt * 0.25;
      let vz = wz * P.speed + n2 * turb * P.speed * 0.6;
      x += vx * dt; y += vy * dt; z += vz * dt;
      this.life[i] -= dt * 60;
      const dd = field.sample(field.d, x, y, z);
      if (dd < vox * 2.5 && y > 0.3) {
        field.gradFast(field.d, x, y, z, _g);
        const gl = Math.hypot(_g[0], _g[1], _g[2]) || 1;
        const nx = _g[0] / gl, ny = _g[1] / gl, nz = _g[2] / gl;
        const windward = -(wx * nx + wz * nz); // >0 facing the wind
        const vl = Math.hypot(vx, vy, vz);
        const cap = P.capacity * Math.min(1, vl / 20);
        if (windward > 0.12 && this.sed[i] < cap) {
          // abrasion: sandblast windward faces, polish (carve, hardness-gated hard)
          const hard = field.sample(field.hard, x, y, z);
          let amt = Math.min((cap - this.sed[i]) * P.abrade * dt * 4, 0.1) * windward * (1 - hard * P.hardness);
          if (rec && rec.baseSnap) { // bedrock guard for abrasion
            const inc = field.sample(field.d, x, y, z) - field.sample(rec.baseSnap, x, y, z);
            if (inc > 0) amt *= clamp01(1 - inc / 10);
          }
          if (amt > 1e-5) {
            field.splat(field.d, x, y, z, vox * 1.2, amt, rec ? rec.delta : null, 0);
            this.sed[i] += amt; this.eroded += amt;
          }
          y += Math.max(0, windward) * 2 * dt; // deflect up over obstacle
        } else if ((windward < -0.08 || vl < P.speed * 0.45) && this.sed[i] > 1e-4) {
          // leeward shadow / slowdown -> dune deposition, SETTLE
          const amt = Math.min(this.sed[i] * P.deposit * dt * 6, this.sed[i]);
          field.splat(field.d, x, y, z, vox * 1.5, -amt * 1.4, rec ? rec.delta : null);
          if (rec) field.splat(rec.sedA, x, y, z, vox * 1.6, amt * 0.8);
          this.sed[i] -= amt; this.deposited += amt;
        }
        if (dd < vox * 0.4) { // saltation hop
          vy = Math.abs(vy) * 0.4 + 2.5 + turb * 3;
          y += vox * 0.6;
          vx *= 0.85; vz *= 0.85;
        }
      } else if (this.sed[i] > 0.02 && y < 2) {
        const amt = this.sed[i] * 0.1; // settle out when slow near ground
        field.splat(field.d, x, Math.max(0.5, y - 1), z, vox * 1.6, -amt, rec ? rec.delta : null);
        this.sed[i] -= amt; this.deposited += amt;
      }
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      if (this.life[i] <= 0 || !field.inWorld(x, y, z, 4)) {
        // settle remaining load
        if (this.sed[i] > 1e-4) {
          const sy = field.findSurface(x, z);
          if (sy !== null) {
            field.splat(field.d, x, sy + vox * 0.5, z, vox * 1.6, -this.sed[i], rec ? rec.delta : null);
            if (rec) field.splat(rec.sedA, x, sy + vox * 0.5, z, vox * 1.7, this.sed[i] * 0.8);
            this.deposited += this.sed[i];
          }
        }
        this.state[i] = 0; this.alive--;
        continue;
      }
      // streak segment
      const o = sn * 6;
      this.seg[o] = x; this.seg[o + 1] = y; this.seg[o + 2] = z;
      const back = 0.09;
      this.seg[o + 3] = x - vx * back; this.seg[o + 4] = y - vy * back; this.seg[o + 5] = z - vz * back;
      sn++;
    }
    this.segN = sn;
  }
}

export function defaultHydro() {
  return {
    inertia: 0.3, capacity: 2.2, erode: 0.2, deposit: 0.55, evap: 0.012, sink: 0.08,
    gravity: 26, maxLife: 70, radius: 1.1, maxSed: 2.0, maxErode: 0.12,
    minSlope: 0.035, hardness: 0.85, lateral: 0.18, settleScale: 0.4,
    repose: 0.85, maxDepth: 14, maxFill: 6,
    spawn: 'rain', rate: 160, sources: 4, sourceSpread: 8, riverMin: 14, riverWidth: 2.2
  };
}
export function defaultThermal() { return { talus: 0.7, rate: 0.1, hardness: 0.7, samples: 6000 }; }
export function defaultWind() {
  return {
    direction: 35, speed: 16, turbulence: 0.55, gravity: 3, capacity: 0.5,
    abrade: 0.25, deposit: 0.7, hardness: 0.9, rate: 50
  };
}
