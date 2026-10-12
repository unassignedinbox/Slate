// Vehicles and car-following traffic (pure logic).
// A vehicle sits on a graph edge at centreline distance s, travelling in direction d (+1 = a->b),
// at lateral lane offset o. Each step: intelligent-driver-model (IDM) car following against the
// nearest leader (vehicle, stopped obstacle, or one on the next edge), curvature and turn speed
// limits, opportunistic lane changes to overtake, then integration and edge transitions.
import { KMH } from './graph.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

let NEXT_ID = 1;

export class Vehicle {
  constructor(o) {
    this.id = NEXT_ID++;
    this.kind = o.kind;                 // 'civ' | 'racer' | 'police'
    this.role = o.role || (o.kind === 'police' ? 'patrol' : 'drive');
    this.name = o.name || '';
    this.color = o.color ?? 0xffffff;
    this.model = o.model || (o.kind === 'police' ? 'cruiser' : 'sedan');
    this.len = o.len ?? (o.kind === 'police' ? 5.1 : 4.6);
    this.width = 1.9;
    this.e = o.e; this.d = o.d; this.s = o.s; this.o = o.o; this.oT = o.o;
    this.v = o.v ?? 0; this.v0 = o.v0 ?? 13;
    this.amax = o.amax ?? 2.3; this.bcomf = 2.6; this.T = o.T ?? 1.2; this.s0 = 3.0;
    this.aLat = o.aLat ?? 5.5;
    this.acc = 0;
    this.route = null; this.ri = -1;    // route[ri] is the move currently being driven (if any)
    this.alive = true;
    this.parked = !!o.parked;
    this.stalled = 0; this.stunned = 0; this.jammed = 0; this.netted = 0; this.spun = 0; this.marked = 0;
    this.blocked = false; this.lcT = 0; this.wobble = Math.random() * 6.28;
    this.x = 0; this.y = 0; this.z = 0; this.hx = 1; this.hz = 0; this.progress = 0;
    this.vx = 0; this.vz = 0;           // visual slide-in after a junction transfer (render-only)
    this.target = null; this.repathT = 0; this.cd = {}; this.wanted = 0; this.raceDist = null;
    this.finished = false; this.place = 0; this.stuckT = 0; this.pitT = 0; this.age = 0;
    this.hitWalls = new Set(); this.rammed = 0; this.tag = o.tag || '';
  }
  get impaired() { return this.stalled > 0 || this.stunned > 0 || this.spun > 0; }
}

export class Traffic {
  constructor(graph, rng) {
    this.g = graph;
    this.rng = rng;
    this.vehicles = [];
    this.buckets = new Map();
    this.obstacleList = new Map();   // key -> {on, e, s, o0, o1, passPolice}
    this.obsIndex = new Map();
    this._f = {};
  }

  add(opts) {
    const v = new Vehicle(opts);
    this.vehicles.push(v);
    this.place(v);
    return v;
  }

  setObstacle(key, ob) { this.obstacleList.set(key, { on: true, passPolice: false, ...ob }); }
  removeObstacle(key) { this.obstacleList.delete(key); }

  // ---------------------------------------------------------------- step
  update(dt) {
    this.vehicles = this.vehicles.filter(v => v.alive);
    this.buckets.clear();
    for (const v of this.vehicles) { let b = this.buckets.get(v.e); if (!b) this.buckets.set(v.e, b = []); b.push(v); }
    this.obsIndex.clear();
    for (const ob of this.obstacleList.values()) {
      if (!ob.on) continue;
      let b = this.obsIndex.get(ob.e); if (!b) this.obsIndex.set(ob.e, b = []); b.push(ob);
    }
    for (const v of this.vehicles) { v.age += dt; this.decide(v, dt); }
    for (const v of this.vehicles) if (v.alive) this.move(v, dt);
  }

  decide(v, dt) {
    const E = this.g.edges[v.e];
    const L = E.len;
    const p = v.d > 0 ? v.s : L - v.s;
    v.progress = p;
    for (const k of ['stalled', 'stunned', 'jammed', 'netted', 'spun', 'marked', 'pitT']) if (v[k] > 0) v[k] = Math.max(0, v[k] - dt);
    if (v.parked) { v.acc = v.v > 0.05 ? -8 : 0; return; }

    let v0 = v.v0;
    const impaired = v.impaired;
    if (impaired) v0 = 0;
    else if (v.jammed > 0) v0 *= 0.55;
    if (v.netted > 0) v0 = Math.min(v0, 6);

    const lead = this.leader(v, E, p);
    let acc;
    if (v0 < 0.05) acc = v.v > 0.05 ? -7.5 : 0;
    else acc = v.amax * (1 - Math.pow(v.v / v0, 4));
    if (lead.gap < 400) {
      const gap = Math.max(lead.gap, 0.05);
      const sStar = v.s0 + Math.max(0, v.v * v.T + (v.v * (v.v - lead.vl)) / (2 * Math.sqrt(v.amax * v.bcomf)));
      acc -= v.amax * (sStar / gap) ** 2;
    }
    v.blocked = lead.gap < 4.5 && lead.obstacle;   // stopped by a barrier, not by ordinary traffic

    // Curvature and upcoming-turn speed limits.
    const cap = this.speedCap(v, E, p, L);
    if (cap.vc < v.v) acc = Math.min(acc, -(v.v * v.v - cap.vc * cap.vc) / (2 * Math.max(cap.dist, 1)));

    // Overtaking: if slowed behind a slower car, look for a free adjacent lane.
    v.lcT = Math.max(0, v.lcT - dt);
    if (v.lcT === 0 && !impaired && lead.gap < 32 && lead.vl < 0.85 * v0 && v.v > 4 && Math.abs(v.oT - v.o) < 0.2 && v.kind !== 'police') {
      const alt = this.freeAdjacentLane(v, E, p);
      if (alt !== null) { v.oT = alt; v.lcT = 4; }
    }

    v.acc = clamp(acc, -9, v.amax);
  }

  // Nearest leader gap (bumper to bumper, metres) and its speed on this edge or the next one.
  leader(v, E, p) {
    let gap = Infinity, vl = 0, obstacle = false;
    const bucket = this.buckets.get(v.e);
    if (bucket) for (const u of bucket) {
      if (u === v || u.d !== v.d || Math.abs(u.o - v.o) >= 1.7) continue;
      const pu = u.d > 0 ? u.s : E.len - u.s;
      if (pu <= p) continue;
      const ds = pu - p - (u.len + v.len) / 2;
      if (ds < gap) { gap = ds; vl = u.v; obstacle = !!u.parked && u.kind === 'police'; }
    }
    for (const ob of this.obsIndex.get(v.e) || []) {
      if (ob.passPolice && v.kind === 'police') continue;
      if (v.o < ob.o0 - 1 || v.o > ob.o1 + 1) continue;
      const po = v.d > 0 ? ob.s : E.len - ob.s;
      if (po <= p) continue;
      const ds = po - p - v.len / 2 - 0.8;
      if (ds < gap) { gap = ds; vl = 0; obstacle = true; }
    }
    const remain = v.d > 0 ? E.len - v.s : v.s;
    if (remain < 70) {
      const endNode = v.d > 0 ? E.b : E.a;
      const nx = v.route && v.route[v.ri + 1];
      const moves = nx && nx.from === endNode ? [nx] : this.g.nodes[endNode].moves;
      for (const m of moves) {
        if (m.e === v.e) continue;
        const F = this.g.edges[m.e];
        const bk = this.buckets.get(m.e);
        if (bk) for (const u of bk) {
          if (u.d !== m.d || Math.abs(u.o - v.o) >= 1.7) continue;
          const pu = u.d > 0 ? u.s : F.len - u.s;
          const ds = remain + pu - (u.len + v.len) / 2;
          if (ds < gap) { gap = ds; vl = u.v; obstacle = !!u.parked && u.kind === 'police'; }
        }
        for (const ob of this.obsIndex.get(m.e) || []) {
          if (ob.passPolice && v.kind === 'police') continue;
          if (v.o < ob.o0 - 1 || v.o > ob.o1 + 1) continue;
          const po = m.d > 0 ? ob.s : F.len - ob.s;
          const ds = remain + po - v.len / 2 - 0.8;
          if (ds < gap) { gap = ds; vl = 0; obstacle = true; }
        }
      }
    }
    return { gap, vl, obstacle };
  }

  speedCap(v, E, p, L) {
    const cl = E.cl;
    const lat = v.aLat;
    let vc = Infinity, dist = 0;
    // Local curvature on this edge, sampled ahead.
    const steps = [0, 10, 22, 38, 58];
    let prevTheta = null, prevD = 0;
    for (const dd of steps) {
      const q = p + dd;
      if (q > L) break;
      const s = v.d > 0 ? q : L - q;
      const f = cl.frameAt(clamp(s, 0, L), this._f);
      const theta = Math.atan2(f.tz, f.tx);
      if (prevTheta !== null && dd > prevD) {
        const kappa = Math.abs(wrapAngle(theta - prevTheta)) / (dd - prevD);
        if (kappa > 1e-4) {
          const vmax = Math.sqrt(lat / kappa);
          if (vmax < vc) { vc = vmax; dist = prevD; }
        }
      }
      prevTheta = theta; prevD = dd;
    }
    // Upcoming junction turn.
    const remain = v.d > 0 ? L - v.s : v.s;
    if (remain < 60) {
      const endNode = v.d > 0 ? E.b : E.a;
      const f0 = cl.frameAt(v.d > 0 ? L : 0, this._f);
      const out = Math.atan2(f0.tz * v.d, f0.tx * v.d);
      const nx = v.route && v.route[v.ri + 1];
      const moves = nx && nx.from === endNode ? [nx] : this.g.nodes[endNode].moves.filter(m => !(m.e === v.e && m.d === -v.d));
      let worst = 0;
      for (const m of moves) {
        const F = this.g.edges[m.e];
        const f1 = F.cl.frameAt(m.d > 0 ? 0 : F.len, this._f);
        const inn = Math.atan2(f1.tz * m.d, f1.tx * m.d);
        worst = Math.max(worst, Math.abs(wrapAngle(inn - out)));
      }
      if (worst > 0.2) {
        const vt = Math.max(3.5, 18 - 5.2 * worst) * Math.sqrt(lat / 5.5);
        if (vt < vc) { vc = vt; dist = remain; }
      }
    }
    return { vc, dist };
  }

  freeAdjacentLane(v, E, p) {
    const lanes = this.g.lanesFor(E, v.d);
    if (lanes.length < 2) return null;
    const bucket = this.buckets.get(v.e) || [];
    const ob = this.obsIndex.get(v.e) || [];
    const cands = lanes.filter(l => Math.abs(l.o - v.o) > 1.5 && Math.abs(l.o - v.o) < 4.5);
    cands.sort((a, b) => Math.abs(a.o - v.o) - Math.abs(b.o - v.o));
    for (const l of cands) {
      let free = true;
      for (const u of bucket) {
        if (u === v || u.d !== v.d || Math.abs(u.o - l.o) >= 1.9) continue;
        const pu = u.d > 0 ? u.s : E.len - u.s;
        if (Math.abs(pu - p) < 14 + u.len / 2) { free = false; break; }
      }
      if (free) for (const o of ob) {
        if (l.o < o.o0 - 1 || l.o > o.o1 + 1) continue;
        const po = v.d > 0 ? o.s : E.len - o.s;
        if (po > p && po - p < 70) { free = false; break; }
      }
      if (free) return l.o;
    }
    return null;
  }

  move(v, dt) {
    if (v.parked) { v.v = Math.max(0, v.v + v.acc * dt); if (v.v === 0) v.acc = 0; this.place(v); return; }
    v.v = Math.max(0, v.v + v.acc * dt);
    const ds = v.v * dt;
    if (v.raceDist !== null) v.raceDist += ds;
    v.wobble += dt;
    const dO = v.oT - v.o, mx = 1.2 * dt;
    v.o += clamp(dO, -mx, mx);
    v.s += v.d * ds;
    const ox = v.x, oz = v.z;
    let crossed = false;
    for (let guard = 0; guard < 6 && v.alive; guard++) {
      const E = this.g.edges[v.e];
      if (v.d > 0 && v.s > E.len) { crossed = true; if (!this.enterNode(v, E.b, v.s - E.len)) break; }
      else if (v.d < 0 && v.s < 0) { crossed = true; if (!this.enterNode(v, E.a, -v.s)) break; }
      else break;
    }
    if (v.alive) this.place(v);
    // Junction transfers can shift the car sideways where roads meet at sharp angles; the drawn
    // position slides from the old spot instead of snapping.
    if (crossed && v.alive) { v.vx += ox - v.x; v.vz += oz - v.z; }
    const decay = Math.exp(-dt * 6);
    v.vx *= decay; v.vz *= decay;
  }

  enterNode(v, node, over) {
    let m = null;
    const nx = v.route && v.route[v.ri + 1];
    if (nx && nx.from === node) { m = nx; v.ri++; }
    else { v.route = null; v.ri = -1; m = this.randomMove(v, node); }
    if (!m) { v.alive = false; return false; }      // dead end with no way out
    // Keep the physical position continuous across the junction: take the car's true world point
    // (old edge end + lateral offset + overshoot along the travel direction) and project it onto the
    // new edge's centreline for both distance along and lateral offset.
    const Eo = this.g.edges[v.e];
    const endF = Eo.cl.frameAt(v.d > 0 ? Eo.len : 0, {});
    const ov = Math.min(over, 25);
    const px = endF.x + endF.nx * v.o + v.d * endF.tx * ov;
    const pz = endF.z + endF.nz * v.o + v.d * endF.tz * ov;
    const F = this.g.edges[m.e];
    const near = F.cl.nearest(px, pz);
    const f = F.cl.frameAt(near.s, {});
    v.e = m.e; v.d = m.d;
    v.s = near.s;
    v.o = (px - f.x) * f.nx + (pz - f.z) * f.nz;
    const lanes = this.g.lanesFor(F, v.d);
    let best = lanes[0];
    for (const l of lanes) if (Math.abs(l.o - v.o) < Math.abs(best.o - v.o)) best = l;
    if (best) v.oT = best.o;
    return true;
  }

  randomMove(v, node) {
    const ms = this.g.nodes[node].moves;
    if (!ms.length) return null;
    let cand = ms.filter(m => !(m.e === v.e && m.d === -v.d));
    if (!cand.length) cand = ms;
    return cand[Math.floor(this.rng() * cand.length)];
  }

  place(v) {
    const E = this.g.edges[v.e];
    const f = E.cl.frameAt(clamp(v.s, 0, E.len), this._f);
    v.x = f.x + f.nx * v.o; v.z = f.z + f.nz * v.o; v.y = f.y;
    v.hx = f.tx * v.d; v.hz = f.tz * v.d;
  }

  // True when the vehicle's lane lies inside a lateral span [lo, hi] (with a little tolerance).
  laneOverlap(v, lo, hi) { return v.o >= lo - 1.2 && v.o <= hi + 1.2; }
}

export function kmh(v) { return v * KMH; }
