// Drivable graph derived from the generated road network (pure logic, no rendering).
// Each road edge carries its centreline, drivable lanes (lateral offsets relative to the
// a->b centreline) and speed limit. Nodes hold the directed "moves" that leave them, which is
// what vehicles follow and what the route search (Dijkstra) walks.
import { getProfile, layout } from '../../map/road/profiles.js';

export const KMH = 1 / 3.6;
const MIN_LIMIT = 20 * KMH;          // alleys still get a sensible desired speed
const SAMPLE_STEP = 30;              // metres between spatial-index samples
const CELL = 120;                    // spatial-index cell size

// Lane types that cars may use. Tram tracks are excluded so cars never drive on rails.
const isCarLane = l => !!l.meta?.traffic && !l.meta?.rails;

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export class DriveGraph {
  constructor(net) {
    this.net = net;
    this.nodes = [];
    this.edges = [];
    const nodeIndex = new Map();
    for (const n of net.nodes.values()) {
      nodeIndex.set(n.id, this.nodes.length);
      this.nodes.push({ i: this.nodes.length, x: n.x, y: n.y || 0, z: n.z, moves: [] });
    }
    for (const e of net.edges.values()) {
      const a = nodeIndex.get(e.a), b = nodeIndex.get(e.b);
      if (a === undefined || b === undefined || a === b) continue;
      const prof = getProfile(e);
      const lanes = layout(prof).lanes.filter(isCarLane).map(l => ({ o: (l.o0 + l.o1) / 2, w: l.width, dir: l.dir ?? 0 }));
      if (!lanes.length) continue;
      const cl = net.centerline(e);
      if (!(cl.length > 2)) continue;
      const idx = this.edges.length;
      const byDir = { 1: [], '-1': [] };
      for (const l of lanes) { if (l.dir === 0) { byDir[1].push(l); byDir[-1].push(l); } else byDir[l.dir].push(l); }
      const rec = {
        i: idx, id: e.id, name: e.name || '', a, b, cl, len: cl.length,
        limit: Math.max(MIN_LIMIT, (prof.speed || 40) * KMH), cat: prof.category || 'urban',
        lanes, byDir, fwd: byDir[1].length > 0, bwd: byDir['-1'].length > 0,
        span: [Math.min(...lanes.map(l => l.o - l.w / 2)), Math.max(...lanes.map(l => l.o + l.w / 2))],
        bridge: cl.yMax > 1.5,
      };
      this.edges.push(rec);
      if (rec.fwd) this.nodes[a].moves.push(makeMove(rec, 1));
      if (rec.bwd) this.nodes[b].moves.push(makeMove(rec, -1));
    }
    this.buildSampleIndex();
  }

  lanesFor(e, d) { return e.byDir[d] || []; }

  // Point and heading on an edge. d = travel direction along a->b; o = lateral offset.
  pointAt(ei, s, o = 0, out = {}) {
    const E = this.edges[ei];
    const f = E.cl.frameAt(Math.max(0, Math.min(E.len, s)), this._f || (this._f = {}));
    out.x = f.x + f.nx * o; out.y = f.y; out.z = f.z + f.nz * o; out.tx = f.tx; out.tz = f.tz;
    return out;
  }
  nodeOfEnd(ei, d) { const E = this.edges[ei]; return d > 0 ? E.b : E.a; }

  // Dijkstra over nodes using time cost (length / speed limit). Returns array of moves or null.
  route(fromNode, toNode) {
    if (fromNode === toNode) return [];
    const N = this.nodes.length, dist = new Float64Array(N).fill(Infinity), via = new Array(N).fill(null);
    dist[fromNode] = 0;
    const heap = new MinHeap(); heap.push(0, fromNode);
    while (heap.size) {
      const [d0, u] = heap.pop();
      if (u === toNode) break;
      if (d0 > dist[u]) continue;
      for (const m of this.nodes[u].moves) {
        const nd = d0 + m.cost;
        if (nd < dist[m.to]) { dist[m.to] = nd; via[m.to] = m; heap.push(nd, m.to); }
      }
    }
    if (!via[toNode]) return null;
    const out = [];
    for (let n = toNode; n !== fromNode;) { const m = via[n]; out.push(m); n = m.from; }
    return out.reverse();
  }

  // Closed race loop through the city: start node plus waypoints spread around it.
  buildLoop(R, { minLen = 2600, maxLen = 4800, waypoints = 3, tries = 80 } = {}) {
    const N = this.nodes;
    const usable = N.filter(n => n.moves.length >= 2);
    for (let attempt = 0; attempt < tries; attempt++) {
      const start = R.pick(usable);
      const pts = [start];
      const base = R() * Math.PI * 2;
      for (let k = 1; k <= waypoints; k++) {
        const ang = base + (k / (waypoints + 1)) * Math.PI * 2 + (R() - 0.5) * 0.5;
        const rad = R.range(520, 900);
        const wx = start.x + Math.cos(ang) * rad, wz = start.z + Math.sin(ang) * rad;
        pts.push(this.nearestNode(wx, wz, usable));
      }
      pts.push(start);
      let moves = [], ok = true;
      for (let k = 0; k < pts.length - 1 && ok; k++) {
        const seg = this.route(pts[k].i, pts[k + 1].i);
        if (!seg || (k > 0 && !seg.length)) ok = false; else moves = moves.concat(seg);
      }
      if (!ok || moves.length < 6) continue;
      let uturn = false;
      for (let k = 1; k < moves.length; k++) if (moves[k].e === moves[k - 1].e && moves[k].d === -moves[k - 1].d) { uturn = true; break; }
      if (uturn) continue;
      const length = moves.reduce((s, m) => s + m.len, 0);
      if (length < minLen || length > maxLen) continue;
      return { moves, length, startNode: start.i };
    }
    return null;
  }

  nearestNode(x, z, list = this.nodes) {
    let best = null, bd = Infinity;
    for (const n of list) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  // Spatial index of sample points along every edge (used for spawning and placement).
  buildSampleIndex() {
    this.grid = new Map();
    for (const E of this.edges) {
      for (let s = 0; ; s += SAMPLE_STEP) {
        const ss = Math.min(s, E.len);
        const p = this.pointAt(E.i, ss, 0);
        const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL);
        let list = this.grid.get(key); if (!list) this.grid.set(key, list = []);
        list.push({ e: E.i, s: ss, x: p.x, z: p.z });
        if (ss >= E.len) break;
      }
    }
  }
  // All sample points within r metres of (x, z).
  near(x, z, r) {
    const out = [];
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let k = z0; k <= z1; k++) {
      const list = this.grid.get(i + ',' + k); if (!list) continue;
      for (const q of list) if ((q.x - x) ** 2 + (q.z - z) ** 2 <= r * r) out.push(q);
    }
    return out;
  }

  // Walk the vehicle's planned route ahead; returns the edge/offset `dist` metres in front.
  aheadOf(v, dist) {
    let e = v.e, d = v.d, s = v.s, left = dist;
    let ri = v.ri, route = v.route;
    for (let guard = 0; guard < 64; guard++) {
      const E = this.edges[e];
      const remain = d > 0 ? E.len - s : s;
      if (left <= remain) { const ss = d > 0 ? s + left : s - left; return { e, d, s: ss, x: 0, z: 0 }; }
      left -= remain;
      const node = d > 0 ? E.b : E.a;
      let m = null;
      if (route && route[ri + 1] && route[ri + 1].from === node) { m = route[ri + 1]; ri++; }
      else { route = null; const ms = this.nodes[node].moves.filter(mm => !(mm.e === e && mm.d === -d)); m = ms[0] || null; }
      if (!m) return null;
      e = m.e; d = m.d; s = d > 0 ? 0 : this.edges[e].len;
    }
    return null;
  }
}

// Visit edges ahead of a vehicle along its route (or its first available move), up to maxD metres.
// fn(edgeIndex, direction, base) receives the distance from the vehicle to the edge's travel-start
// point; a point at centreline distance s on that edge lies at base + (d > 0 ? s : len - s).
// Returning true from fn stops the walk.
DriveGraph.prototype.walkAhead = function walkAhead(v, maxD, fn) {
  let e = v.e, d = v.d, route = v.route, ri = v.ri;
  let base = -(d > 0 ? v.s : this.edges[e].len - v.s);
  for (let guard = 0; guard < 80; guard++) {
    const E = this.edges[e];
    if (fn(e, d, base) === true) return;
    base += E.len;
    if (base > maxD) return;
    const node = d > 0 ? E.b : E.a;
    let m = null;
    if (route && route[ri + 1] && route[ri + 1].from === node) { m = route[ri + 1]; ri++; }
    else {
      route = null;
      const ms = this.nodes[node].moves;
      m = ms.find(mm => !(mm.e === e && mm.d === -d)) || ms[0] || null;
    }
    if (!m) return;
    e = m.e; d = m.d;
  }
};

function makeMove(E, d) {
  const from = d > 0 ? E.a : E.b, to = d > 0 ? E.b : E.a;
  return { e: E.i, d, from, to, len: E.len, cost: E.len / E.limit };
}
