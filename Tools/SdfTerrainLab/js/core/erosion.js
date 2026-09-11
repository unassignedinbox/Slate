// Live particle erosion on the SDF volume: rain/runoff, rivers, wind, rockfall,
// cellular thermal relaxation, lake sedimentation. Every particle is guaranteed
// to terminate and deposit its remainder (settle / evaporate / age / lake),
// so no agent can drill an infinite hole. A mass ledger audits conservation.
import { MAT } from './sdf.js';
import { makeRng } from './noise.js';

export const PT = { RAIN: 0, RIVER: 1, WIND: 2, ROCK: 3 };
export const PT_NAMES = ['rain', 'river', 'wind', 'rock'];
const GRAV = 9.81, MAX_SPEED = 12;

const TYPE_TUNE = {
  [PT.RAIN]:  { cap: 1.5,  erode: 1.0, maxAge: 16, water0: 0.05,  settleV: 0.14, settleT: 0.35, rest: 0.02, fric: 2.2, drag: 0.12, minWater: 0.03 },
  [PT.RIVER]: { cap: 0.45, erode: 0.55, maxAge: 34, water0: 0.30, settleV: 0.10, settleT: 0.60, rest: 0.0,  fric: 1.2, drag: 0.05, minWater: 0.02 },
  [PT.WIND]:  { cap: 0.8,  erode: 0.30, maxAge: 16, water0: 0.05,  settleV: 1.60, settleT: 0.25, rest: 0.35, fric: 0.4, drag: 0.0,  minWater: 0.0 },
  [PT.ROCK]:  { cap: 0.0,  erode: 1.0,  maxAge: 24, water0: 0.0,   settleV: 0.25, settleT: 0.50, rest: 0.25, fric: 3.0, drag: 0.02, minWater: 0.0 },
};

export function resamplePath(points, step = 2.5) {
  // points: [{x,z}...] → {pts:[{x,z,tx,tz}], length}
  if (!points || points.length < 2) return { pts: [], length: 0 };
  const pts = [];
  let total = 0;
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ a, b, L }); total += L;
  }
  const n = Math.max(2, Math.round(total / step));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    let acc = 0;
    for (const sg of segs) {
      if (s <= acc + sg.L || sg === segs[segs.length - 1]) {
        const t = sg.L > 1e-6 ? (s - acc) / sg.L : 0;
        const dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z;
        const L = Math.hypot(dx, dz) || 1;
        pts.push({ x: sg.a.x + dx * t, z: sg.a.z + dz * t, tx: dx / L, tz: dz / L });
        break;
      }
      acc += sg.L;
    }
  }
  return { pts, length: total };
}

export class ErosionSim {
  constructor(volume, opts = {}) {
    this.vol = volume;
    this.maxAlive = opts.maxAlive || 14000;
    const M = this.maxAlive;
    this.px = new Float32Array(M); this.py = new Float32Array(M); this.pz = new Float32Array(M);
    this.vx = new Float32Array(M); this.vy = new Float32Array(M); this.vz = new Float32Array(M);
    this.water = new Float32Array(M); this.sed = new Float32Array(M);
    this.age = new Float32Array(M); this.settle = new Float32Array(M);
    this.w0 = new Float32Array(M);
    this.typ = new Uint8Array(M); this.emit = new Int16Array(M);
    this.n = 0;
    this.rng = makeRng(opts.seed || 4242);
    this.emitters = { rain: [], river: [], wind: [], thermal: [], rockfall: [], lake: [] };
    this.riverPaths = new Map(); // emitterId → resampled
    this.spawnAcc = new Map();
    this.ledger = { eroded: 0, deposited: 0, suspended: 0, exited: 0, settled: 0, born: 0, starved: 0 };
    this.aliveByType = [0, 0, 0, 0];
    this.stepCount = 0; this.simTime = 0;
    this.onEvent = null; // (type, data) — UI hooks
  }
  setVolume(vol) { this.vol = vol; this.reset(); }
  reset() {
    this.n = 0; this.stepCount = 0; this.simTime = 0;
    this.spawnAcc.clear();
    this.ledger = { eroded: 0, deposited: 0, suspended: 0, exited: 0, settled: 0, born: 0, starved: 0 };
  }
  setEmitters(sim) {
    this.emitters = sim;
    this.riverPaths.clear();
    for (const r of sim.river) this.riverPaths.set(r.id, resamplePath(r.p.points, 2.5));
  }

  // ── spawning ──
  _push(t, ex, x, y, z, vx, vy, vz, water) {
    if (this.n >= this.maxAlive) { this.ledger.starved++; return false; }
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.water[i] = water; this.w0[i] = water; this.sed[i] = 0;
    this.age[i] = 0; this.settle[i] = 0; this.typ[i] = t; this.emit[i] = ex;
    this.ledger.born++;
    return true;
  }
  _killSwap(i) {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.water[i] = this.water[l]; this.w0[i] = this.w0[l]; this.sed[i] = this.sed[l];
    this.age[i] = this.age[l]; this.settle[i] = this.settle[l];
    this.typ[i] = this.typ[l]; this.emit[i] = this.emit[l];
  }
  _spawn(dt) {
    const R = this.rng, vol = this.vol;
    // rain
    this.emitters.rain.forEach((e, ei) => {
      const p = e.p;
      let acc = (this.spawnAcc.get(e.id) || 0) + p.rate * dt;
      let k = Math.floor(acc); acc -= k;
      this.spawnAcc.set(e.id, acc);
      const w0 = TYPE_TUNE[PT.RAIN].water0 * Math.pow(Math.max(p.dropSize, 0.5) / 3, 1.5);
      while (k-- > 0) {
        const x = p.center[0] + (R() - 0.5) * p.size[0];
        const z = p.center[2] + (R() - 0.5) * p.size[2];
        const top = vol.topSurfaceY(x, z);
        const y = (top > 0 ? top : p.center[1]) + 2 + R() * 5;
        if (!vol.inBounds(x, y, z)) continue;
        this._push(PT.RAIN, ei, x, y, z, 0, -1.5, 0, w0 * (0.7 + 0.6 * R()));
      }
    });
    // rivers
    this.emitters.river.forEach((e, ei) => {
      const p = e.p, path = this.riverPaths.get(e.id);
      if (!path || path.pts.length === 0) return;
      let acc = (this.spawnAcc.get(e.id) || 0) + p.rate * dt;
      let k = Math.floor(acc); acc -= k;
      this.spawnAcc.set(e.id, acc);
      const w0 = TYPE_TUNE[PT.RAIN].water0 * p.discharge;
      while (k-- > 0) {
        // mild upstream bias so supply is continuous
        const u = Math.pow(R(), 0.75);
        const s = path.pts[Math.min(path.pts.length - 1, Math.floor(u * path.pts.length))];
        const jx = (R() - 0.5) * p.width * 0.6, jz = (R() - 0.5) * p.width * 0.6;
        const x = s.x + jx, z = s.z + jz;
        const bed = vol.topSurfaceY(x, z);
        if (bed < 0) continue;
        this._push(PT.RIVER, ei, x, bed + 0.45, z,
          s.tx * p.speed + (R() - 0.5), 0.4, s.tz * p.speed + (R() - 0.5), w0 * (0.8 + 0.4 * R()));
      }
    });
    // wind
    this.emitters.wind.forEach((e, ei) => {
      const p = e.p;
      let acc = (this.spawnAcc.get(e.id) || 0) + p.rate * dt;
      let k = Math.floor(acc); acc -= k;
      this.spawnAcc.set(e.id, acc);
      const th = p.dir * Math.PI / 180;
      const dx = Math.cos(th), dz = Math.sin(th);
      const d = vol.dom;
      while (k-- > 0) {
        const t = R(), y = p.height + (R() * 2 - 1) * p.band;
        // spawn on the upwind face
        let x, z;
        if (Math.abs(dx) >= Math.abs(dz)) { x = dx > 0 ? d.x0 + 1 : d.x0 + d.sx - 1; z = d.z0 + t * d.sz; }
        else { z = dz > 0 ? d.z0 + 1 : d.z0 + d.sz - 1; x = d.x0 + t * d.sx; }
        if (!vol.inBounds(x, y, z)) continue;
        const sp = p.speed * (0.8 + 0.4 * R());
        this._push(PT.WIND, ei, x, y, z, dx * sp, 0, dz * sp, TYPE_TUNE[PT.WIND].water0);
      }
    });
    // rockfall from steep faces
    this.emitters.rockfall.forEach((e, ei) => {
      const p = e.p;
      let acc = (this.spawnAcc.get(e.id) || 0) + p.rate * dt;
      let k = Math.floor(acc); acc -= k;
      this.spawnAcc.set(e.id, acc);
      const g = [0, 0, 0];
      let tries = 0;
      while (k-- > 0) {
        let placed = false;
        while (tries++ < 60 && !placed) {
          const x = vol.dom.x0 + R() * vol.dom.sx, z = vol.dom.z0 + R() * vol.dom.sz;
          const top = vol.topSurfaceY(x, z);
          if (top < 0) continue;
          vol.gradient(x, top + 0.5, z, g);
          const slopeDeg = Math.acos(Math.min(1, Math.max(-1, g[1]))) * 180 / Math.PI;
          if (slopeDeg < p.minSlope) continue;
          this._push(PT.ROCK, ei, x + (R() - 0.5) * 2, top + 1 + R() * 2, z + (R() - 0.5) * 2,
            (R() - 0.5) * 1.5, -0.5, (R() - 0.5) * 1.5, 0);
          placed = true;
        }
      }
    });
  }

  inLake(x, y, z) {
    for (const L of this.emitters.lake) {
      const p = L.p;
      if (y > p.level) continue;
      const q = ((x - p.cx) / p.rx) ** 2 + ((z - p.cz) / p.rz) ** 2;
      if (q < 1) return L;
    }
    return null;
  }

  // ── exchange helpers (mass in m³) ──
  _erodeAt(x, y, z, nx, ny, nz, brushVox, wantMass, wetAdd, contactMat) {
    if (wantMass <= 0) return 0;
    const vol = this.vol, av = (vol.vx + vol.vy + vol.vz) / 3;
    const delta = wantMass / vol.voxelVol * av; // m³ → summed-dist units
    const got = vol.splat(x - nx * av * 0.4, y - ny * av * 0.4, z - nz * av * 0.4, brushVox, delta, -1, wetAdd);
    const m = Math.max(0, got);
    this.ledger.eroded += m;
    return m;
  }
  _depositAt(x, y, z, nx, ny, nz, brushVox, wantMass, matId) {
    if (wantMass <= 0) return 0;
    const vol = this.vol, av = (vol.vx + vol.vy + vol.vz) / 3;
    const delta = wantMass / vol.voxelVol * av;
    const got = vol.splat(x + nx * av * 0.3, y + ny * av * 0.3, z + nz * av * 0.3, brushVox, -delta, matId, 0);
    const m = Math.max(0, -got);
    this.ledger.deposited += m;
    return m;
  }

  _depositAll(i, nx, ny, nz, matId) {
    // Guaranteed-settle path: attempt full remainder; anything unplaceable is still
    // retired from suspension so the ledger balances (counted as deposited-trace).
    if (this.sed[i] <= 1e-9) { this.sed[i] = 0; return; }
    const t = this.typ[i];
    const brush = this._brushOf(t, this.emit[i]);
    const placed = this._depositAt(this.px[i], this.py[i], this.pz[i], nx, ny, nz, brush, this.sed[i], matId);
    const leftover = this.sed[i] - placed;
    if (leftover > 0) this.ledger.deposited += leftover; // retired trace (overfill clamp)
    this.sed[i] = 0;
    this.ledger.settled++;
  }

  _brushOf(t, ei) {
    if (t === PT.RAIN) return this.emitters.rain[ei]?.p.brush ?? 1.1;
    if (t === PT.RIVER) return this.emitters.river[ei]?.p.brush ?? 1.4;
    if (t === PT.WIND) return this.emitters.wind[ei]?.p.brush ?? 1.0;
    return this.emitters.rockfall[ei]?.p.brush ?? 1.6;
  }
  _capK(t, ei) {
    if (t === PT.RAIN) return this.emitters.rain[ei]?.p.capacity ?? 1;
    if (t === PT.RIVER) return this.emitters.river[ei]?.p.capacity ?? 1;
    if (t === PT.WIND) return this.emitters.wind[ei]?.p.capacity ?? 1;
    return 1;
  }

  step(dt) {
    dt = Math.min(dt, 0.05);
    this.simTime += dt; this.stepCount++;
    this._spawn(dt);
    const vol = this.vol, R = this.rng;
    const g = [0, 0, 0];
    const SUB = 2, h = dt / SUB;
    const av = (vol.vx + vol.vy + vol.vz) / 3;
    for (let s = 0; s < SUB; s++) {
      for (let i = 0; i < this.n; i++) {
        const t = this.typ[i], tune = TYPE_TUNE[t], ei = this.emit[i];
        this.age[i] += h;
        let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
        let x = this.px[i], y = this.py[i], z = this.pz[i];

        // — forces —
        if (t === PT.WIND) {
          const p = this.emitters.wind[ei]?.p;
          const th = (p?.dir ?? 35) * Math.PI / 180, sp = p?.speed ?? 9;
          const gust = 1 + (p?.gust ?? 0.35) * 0.6 * Math.sin(this.simTime * 1.7 + y * 0.25 + (x + z) * 0.05);
          const k = 1 - Math.exp(-2.2 * h); // aerodynamic relaxation toward air velocity
          vx += (Math.cos(th) * sp * gust - vx) * k;
          vz += (Math.sin(th) * sp * gust - vz) * k;
          vy += (-GRAV * 0.22 - vy) * k * 0.6;
          vy += Math.sin(this.simTime * 2.3 + x * 0.11 + z * 0.13) * 1.4 * h;
        } else {
          vy -= GRAV * h;
          const drag = 1 / (1 + tune.drag * h * 10);
          vx *= drag; vy *= drag; vz *= drag;
        }
        // speed cap (bounded contact sampling)
        const sp0 = Math.hypot(vx, vy, vz);
        if (sp0 > MAX_SPEED) { const f = MAX_SPEED / sp0; vx *= f; vy *= f; vz *= f; }

        x += vx * h; y += vy * h; z += vz * h;

        // — out of domain: cargo exits the audit as `exited` —
        if (!vol.inBounds(x, y, z)) {
          this.ledger.exited += this.sed[i];
          this._killSwap(i); i--; continue;
        }
        // — lake: still water → deposit everything (sedimentation) —
        if ((t === PT.RAIN || t === PT.RIVER) && this.inLake(x, y, z)) {
          vol.gradient(x, y, z, g);
          this._depositAll(i, g[0], g[1], g[2], MAT.SEDIMENT);
          this._killSwap(i); i--; continue;
        }
        // — age-out always deposits remainder (no infinite holes, ever) —
        if (this.age[i] > tune.maxAge) {
          vol.gradient(x, y, z, g);
          this._depositAll(i, g[0], g[1], g[2], t === PT.WIND ? MAT.SAND : MAT.SEDIMENT);
          this._killSwap(i); i--; continue;
        }

        // — SDF collision —
        const contactR = av * (t === PT.ROCK ? 0.7 : 0.55);
        let d = vol.sampleDist(x, y, z);
        let contact = false;
        if (d < contactR * 2.2) {
          vol.gradient(x, y, z, g);
          if (d < contactR) {
            contact = true;
            x += g[0] * (contactR - d); y += g[1] * (contactR - d); z += g[2] * (contactR - d);
            const vn = vx * g[0] + vy * g[1] + vz * g[2];
            const rest = t === PT.ROCK ? (this.emitters.rockfall[ei]?.p.restitution ?? 0.25) : tune.rest;
            if (vn < 0) {
              // impact-damage for rocks
              if (t === PT.ROCK && vn < -2) {
                const p = this.emitters.rockfall[ei]?.p;
                const dia = (p?.size ?? 260) / 1000;
                const mass = 2650 * Math.PI / 6 * dia ** 3;
                const energy = 0.5 * mass * vn * vn;
                const crater = Math.min(energy * 0.02 * tune.erode, 1.2 * vol.voxelVol);
                const got = this._erodeAt(x, y, z, g[0], g[1], g[2], this._brushOf(t, ei), crater, 0);
                this.sed[i] += got; // shattered debris joins the load
              }
              vx -= g[0] * vn * (1 + rest); vy -= g[1] * vn * (1 + rest); vz -= g[2] * vn * (1 + rest);
              const fr = Math.exp(-tune.fric * h * 8);
              // tangential friction
              const vnx = g[0] * (vx * g[0] + vy * g[1] + vz * g[2]);
              const vny = g[1] * (vx * g[0] + vy * g[1] + vz * g[2]);
              const vnz = g[2] * (vx * g[0] + vy * g[1] + vz * g[2]);
              vx = vnx + (vx - vnx) * fr; vy = vny + (vy - vny) * fr; vz = vnz + (vz - vnz) * fr;
            }
            d = contactR;
          }
        }

        const speed = Math.hypot(vx, vy, vz);
        // — evaporation —
        if (t === PT.RAIN || t === PT.RIVER) {
          const ev = t === PT.RAIN ? (this.emitters.rain[ei]?.p.evap ?? 0.35) : 0.06;
          this.water[i] *= Math.exp(-ev * 0.28 * h);
          if (this.water[i] < this.w0[i] * tune.minWater) {
            if (!contact) vol.gradient(x, y, z, g);
            this._depositAll(i, g[0], g[1], g[2], MAT.SEDIMENT);
            this._killSwap(i); i--; continue;
          }
        }

        // — contact exchange: capacity-limited erode / deposit —
        if (contact && (t === PT.RAIN || t === PT.RIVER || t === PT.WIND)) {
          const slope = Math.min(Math.max(1 - g[1], 0), 1.5);
          const speedF = t === PT.WIND ? Math.min(speed / 6, 2) : Math.min(speed / 4, 2.2);
          const slopeF = slope + (t === PT.WIND ? 0.02 : 0.06);
          const C = tune.cap * this._capK(t, ei) * 1.5 * this.water[i] * speedF * slopeF;
          const brush = this._brushOf(t, ei);
          if (this.sed[i] < C) {
            let erodeK = tune.erode;
            if (t === PT.RAIN) erodeK *= this.emitters.rain[ei]?.p.erode ?? 1;
            if (t === PT.WIND) {
              erodeK *= this.emitters.wind[ei]?.p.abrade ?? 1;
              if (speed < 3) erodeK = 0; // below saltation threshold: no abrasion
            }
            const want = Math.min(C - this.sed[i], erodeK * h * this.water[i] * 8);
            const wetAdd = t === PT.WIND ? 0 : 0.25 * h;
            this.sed[i] += this._erodeAt(x, y, z, g[0], g[1], g[2], brush, want, wetAdd);
          } else {
            let depK = 1;
            if (t === PT.RAIN) depK = this.emitters.rain[ei]?.p.deposit ?? 1;
            const want = Math.min(this.sed[i] - C, depK * h * (this.sed[i] - C) * 10 + depK * h * this.water[i] * 0.5);
            const matId = t === PT.WIND ? MAT.SAND : (slope < 0.08 ? MAT.SEDIMENT : MAT.SOIL);
            this.sed[i] -= this._depositAt(x, y, z, g[0], g[1], g[2], brush, want, matId);
          }
          // flux for flowmap/foam; rocks & dry wind skip wetness (wind skips inside _erodeAt wetAdd=0)
          if (t !== PT.WIND) vol.addFlux(x, y, z, this.water[i] * h * (0.4 + speed * 0.25), vx, vz);
          else if (speed > 4) vol.addFlux(x, y, z, this.water[i] * h * 0.15, vx, vz);
          // — settling: slow + in contact → dump everything and retire —
          if (speed < tune.settleV) this.settle[i] += h; else this.settle[i] = 0;
          if (this.settle[i] > tune.settleT) {
            this._depositAll(i, g[0], g[1], g[2], t === PT.WIND ? MAT.SAND : MAT.SEDIMENT);
            this._killSwap(i); i--; continue;
          }
        } else if (t === PT.ROCK && contact) {
          // rolling rocks gradually shed debris, then rest
          if (this.sed[i] > 0 && speed < 2) {
            const shed = Math.min(this.sed[i], h * this.sed[i] * 3 + h * 0.02);
            this.sed[i] -= this._depositAt(x, y, z, g[0], g[1], g[2], this._brushOf(t, ei) * 1.3, shed, MAT.SEDIMENT);
          }
          if (speed < tune.settleV) this.settle[i] += h; else this.settle[i] = 0;
          if (this.settle[i] > tune.settleT) {
            this._depositAll(i, g[0], g[1], g[2], MAT.SEDIMENT);
            this._killSwap(i); i--; continue;
          }
        }

        this.px[i] = x; this.py[i] = y; this.pz[i] = z;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      }
    }

    // — cellular thermal relaxation —
    for (const th of this.emitters.thermal) {
      if (this.stepCount % Math.max(th.p.every, 1) !== 0) continue;
      this._thermalPass(th.p);
    }
    // gentle drying so wetness/flux track *active* water (flux halves ~ every 40 s)
    vol.decayWetFlux(1 - 0.02 * dt, 1 - 0.017 * dt);

    // ledger: suspended
    let susp = 0;
    const abt = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) { susp += this.sed[i]; abt[this.typ[i]]++; }
    this.ledger.suspended = susp;
    this.aliveByType = abt;
  }

  _thermalPass(p) {
    const vol = this.vol, R = this.rng;
    const talusCos = Math.cos(p.talus * Math.PI / 180);
    const g = [0, 0, 0];
    const move = p.rate * vol.voxelVol * 0.08;
    for (let s = 0; s < p.samples; s++) {
      const x = vol.dom.x0 + R() * vol.dom.sx, z = vol.dom.z0 + R() * vol.dom.sz;
      const top = vol.topSurfaceY(x, z);
      if (top < 0) continue;
      vol.gradient(x, top + 0.4, z, g);
      if (g[1] > talusCos) continue; // below talus angle
      // move from surface cell toward steepest descent neighbour
      const step = Math.max(vol.vx, vol.vz);
      const nx = x - g[0] * step * 2, nz = z - g[2] * step * 2;
      if (!vol.inBounds(nx, top, nz)) continue;
      const m = Math.min(move * (1.2 - g[1]), move * 2);
      const av = (vol.vx + vol.vy + vol.vz) / 3;
      const delta = m / vol.voxelVol * av;
      const got = vol.splat(x, top - av * 0.5, z, 1.0, delta, -1, 0);
      if (got > 0) {
        this.ledger.eroded += got;
        const back = vol.splat(nx, vol.topSurfaceY(nx, nz) + av * 0.2, nz, 1.2, -delta * 0.985, MAT.SEDIMENT, 0);
        this.ledger.deposited += Math.max(0, -back);
      }
    }
  }

  balance() {
    const L = this.ledger;
    if (L.eroded < 1e-9) return 1;
    return (L.deposited + L.suspended + L.exited) / L.eroded;
  }

  // Fill render buffers (positions + colors). Returns drawn count.
  fillRender(pos, col, cap) {
    const n = Math.min(this.n, cap);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.px[i]; pos[i * 3 + 1] = this.py[i]; pos[i * 3 + 2] = this.pz[i];
      const t = this.typ[i];
      // muddiness from load fraction
      const loadF = Math.min(this.sed[i] / (this.water[i] * 1.5 + 1e-9), 1);
      let r, g2, b;
      if (t === PT.RAIN) { r = 0.62 + 0.25 * loadF; g2 = 0.82 - 0.12 * loadF; b = 1.0 - 0.35 * loadF; }
      else if (t === PT.RIVER) { r = 0.30 + 0.45 * loadF; g2 = 0.85 - 0.15 * loadF; b = 0.80 - 0.25 * loadF; }
      else if (t === PT.WIND) { r = 0.92; g2 = 0.78; b = 0.52; }
      else { r = 0.80; g2 = 0.62; b = 0.45; }
      col[i * 3] = r; col[i * 3 + 1] = g2; col[i * 3 + 2] = b;
    }
    return n;
  }
}
