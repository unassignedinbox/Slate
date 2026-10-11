// Lane graph + microscopic traffic. IDM car-following, junction turn paths with conflict
// reservation, signal phases, and level-crossing interlocking with the train.

import { lanesOf, ROAD_CLASS } from '../road/profile.js';
import { turnType, classRank } from '../road/network.js';
import { surfaceDisplacement } from '../road/roadmesh.js';
import { hermitePolyline, polylineLength, resamplePolyline } from '../core/spline.js';
import {
  v3, v3sub, v3add, v3scale, v3dist2D, normXZ, clamp, lerp, angleDelta, headingOf, wrapAngle,
} from '../core/math.js';
import { VEHICLE_TYPES, vehicleSpec, PAINT_COLOURS } from './vehicles.js';

const LANE_STEP = 3.0;

export function buildLaneGraph(net, surface) {
  const lanes = new Map();
  const nodeIn = new Map();
  const nodeOut = new Map();
  const push = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };

  for (const edge of net.edges.values()) {
    const ribbon = surface.ribbons.get(edge.id);
    if (!ribbon) continue;
    const s0 = ribbon.s0, s1 = ribbon.s1;
    if (s1 - s0 < 4) continue;
    const list = lanesOf(edge.profile).filter((l) => l.type === 'travel');
    for (const l of list) {
      const forward = l.dir > 0;
      const raw = edge.curve.offsetPolyline(l.centreT, LANE_STEP, s0, s1);
      const pts = (forward ? raw : raw.slice().reverse()).map((p) => ({
        x: p.x, y: p.y + 0.02, z: p.z, s: p.s,
      }));
      for (const p of pts) p.y += surfaceDisplacement(edge, p.s, l.centreT) * 0.9;
      const id = `${edge.id}:${l.dir > 0 ? 'f' : 'b'}${l.index}`;
      const lane = {
        id, edgeId: edge.id, dir: l.dir, offsetT: l.centreT, index: l.index,
        pts, length: polylineLength(pts),
        from: forward ? edge.a : edge.b,
        to: forward ? edge.b : edge.a,
        speed: (edge.profile.speedLimit || 50) / 3.6,
        cls: edge.profile.class,
        rank: classRank[edge.profile.class] ?? 1,
        vehicles: [],
      };
      lanes.set(id, lane);
      push(nodeOut, lane.from, lane);
      push(nodeIn, lane.to, lane);
    }
  }

  // --- junction connections
  const connections = [];
  const nodeInfo = new Map();
  for (const node of net.nodes.values()) {
    const ins = nodeIn.get(node.id) || [];
    const outs = nodeOut.get(node.id) || [];
    if (!ins.length) continue;
    const local = [];
    for (const i of ins) {
      const inHeading = headingOf(dirAtEnd(i.pts, true));
      const candidates = outs.filter((o) => o.edgeId !== i.edgeId);
      const pool = candidates.length ? candidates : outs.filter((o) => o.edgeId === i.edgeId);
      // group by target edge, pick the lane with the closest index
      const byEdge = new Map();
      for (const o of pool) {
        if (!byEdge.has(o.edgeId)) byEdge.set(o.edgeId, []);
        byEdge.get(o.edgeId).push(o);
      }
      for (const [, group] of byEdge) {
        group.sort((a, b) => a.index - b.index);
        const target = group[Math.min(group.length - 1, i.index)] || group[0];
        const p0 = i.pts[i.pts.length - 1];
        const p1 = target.pts[0];
        const d = Math.max(4, v3dist2D(p0, p1));
        const m0 = v3scale(dirAtEnd(i.pts, true), d * 1.05);
        const m1 = v3scale(dirAtEnd(target.pts, false), d * 1.05);
        const path = resamplePolyline(hermitePolyline(p0, m0, p1, m1, 14), 2.2);
        const outHeading = headingOf(dirAtEnd(target.pts, false));
        const conn = {
          id: `${i.id}>${target.id}`,
          from: i, to: target, path, length: polylineLength(path),
          turn: turnType(inHeading + Math.PI, outHeading),
          node: node.id,
          group: 0,
          priority: i.rank,
          occupied: 0,
          conflicts: [],
        };
        connections.push(conn);
        local.push(conn);
        if (!i.exits) i.exits = [];
        i.exits.push(conn);
      }
    }
    // conflicts between crossing paths of this junction
    for (let a = 0; a < local.length; a++) {
      for (let b = a + 1; b < local.length; b++) {
        const A = local[a], B = local[b];
        if (A.from === B.from) continue;
        if (pathsCross(A.path, B.path)) { A.conflicts.push(B); B.conflicts.push(A); }
      }
    }
    // signal phases: split approaches into two groups by heading axis
    const j = surface.junctions.get(node.id);
    const signalised = !!(j && j.signalised && local.length > 2);
    let axis = 0;
    if (j && j.mouths.length) {
      const widest = j.mouths.reduce((m, x) => (x.halfWidth > m.halfWidth ? x : m), j.mouths[0]);
      axis = widest.heading;
    }
    for (const c of local) {
      const h = headingOf(dirAtEnd(c.from.pts, true));
      const d = Math.abs(angleDelta(axis, h));
      c.group = (d < Math.PI / 4 || d > (3 * Math.PI) / 4) ? 0 : 1;
      c.signalised = signalised;
    }
    nodeInfo.set(node.id, {
      id: node.id, signalised, connections: local, axis,
      control: node.control, phase: 0, timer: 0,
      majorRank: Math.max(0, ...ins.map((i) => i.rank)),
    });
  }

  return { lanes, connections, nodes: nodeInfo, nodeIn, nodeOut };
}

function dirAtEnd(pts, atEnd) {
  const a = atEnd ? pts[Math.max(0, pts.length - 2)] : pts[0];
  const b = atEnd ? pts[pts.length - 1] : pts[Math.min(1, pts.length - 1)];
  return normXZ(v3sub(b, a));
}

function pathsCross(A, B) {
  for (let i = 0; i < A.length - 1; i++) {
    for (let j = 0; j < B.length - 1; j++) {
      if (segHit(A[i], A[i + 1], B[j], B[j + 1])) return true;
    }
  }
  return false;
}

function segHit(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

/* ------------------------------------------------------------------ simulation */

const IDM = { a: 1.45, b: 2.1, s0: 2.4, T: 1.35, delta: 4 };

export class TrafficSim {
  constructor(graph, net, opts = {}) {
    this.graph = graph;
    this.net = net;
    this.rng = opts.rng || Math.random;
    this.maxVehicles = Math.min(25, opts.count ?? 18);
    this.vehicles = [];
    this.time = 0;
    this.signalCycle = { green: 13, amber: 3.2, allRed: 1.6 };
    this.spawnable = [...graph.lanes.values()].filter((l) => l.length > 18);
    this.trainBlocked = new Set();
    this.populate();
  }

  populate() {
    let guard = 0;
    while (this.vehicles.length < this.maxVehicles && guard++ < 400) this.spawn();
  }

  spawn() {
    if (!this.spawnable.length) return null;
    const lane = this.spawnable[Math.floor(this.rng() * this.spawnable.length)];
    const s = this.rng() * Math.max(1, lane.length - 12);
    for (const v of lane.vehicles) if (Math.abs(v.s - s) < 12) return null;
    const type = pickType(this.rng, lane.cls);
    const spec = vehicleSpec(type);
    const v = {
      id: `V${this.vehicles.length}-${Math.floor(this.rng() * 1e4)}`,
      type, spec,
      colour: PAINT_COLOURS[Math.floor(this.rng() * PAINT_COLOURS.length)],
      lane, conn: null, s, v: lane.speed * 0.6,
      pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, roll: 0,
      wheelSpin: 0, steer: 0, brake: 0, indicator: 0,
      nextConn: null, waiting: 0,
    };
    lane.vehicles.push(v);
    this.vehicles.push(v);
    this.updatePose(v, 0);
    return v;
  }

  /** Signal phase bookkeeping. */
  stepSignals(dt) {
    const cycle = this.signalCycle;
    const total = (cycle.green + cycle.amber + cycle.allRed) * 2;
    for (const [, n] of this.graph.nodes) {
      if (!n.signalised) continue;
      n.timer = (n.timer + dt) % total;
      const half = total / 2;
      const inFirst = n.timer < half;
      const local = inFirst ? n.timer : n.timer - half;
      n.phase = inFirst ? 0 : 1;
      n.state = local < cycle.green ? 'green' : local < cycle.green + cycle.amber ? 'amber' : 'red';
    }
  }

  signalFor(conn) {
    const n = this.graph.nodes.get(conn.node);
    if (!n || !n.signalised) return 'uncontrolled';
    if (n.phase !== conn.group) return 'red';
    return n.state;
  }

  /** Light state per signal group index, consumed by the shader. */
  signalStates() {
    const out = [];
    for (const [, n] of this.graph.nodes) {
      if (!n.signalised) continue;
      out.push({ node: n.id, phase: n.phase, state: n.state });
    }
    return out;
  }

  laneClear(lane, fromS, span) {
    for (const o of lane.vehicles) {
      if (o.s > fromS - 1 && o.s < fromS + span) return false;
    }
    return true;
  }

  gapAhead(v) {
    // distance to the next obstacle and its speed, following the lane -> connection -> lane chain
    const horizon = 70;
    let dist = Infinity, leadV = 0;
    if (v.conn) {
      for (const o of v.conn.vehicles || []) {
        if (o === v || o.s <= v.s) continue;
        const d = o.s - v.s - o.spec.len;
        if (d < dist) { dist = d; leadV = o.v; }
      }
      const rest = v.conn.length - v.s;
      const next = v.conn.to;
      let best = Infinity, bv = 0;
      for (const o of next.vehicles) {
        const d = rest + o.s - o.spec.len;
        if (o.s < 30 && d < best) { best = d; bv = o.v; }
      }
      if (best < dist) { dist = best; leadV = bv; }
      return { dist, leadV };
    }
    for (const o of v.lane.vehicles) {
      if (o === v || o.s <= v.s) continue;
      const d = o.s - v.s - o.spec.len;
      if (d < dist) { dist = d; leadV = o.v; }
    }
    const toEnd = v.lane.length - v.s;
    if (toEnd < horizon) {
      const conn = v.nextConn;
      if (!conn) return { dist: Math.min(dist, toEnd - 1.5), leadV: 0, stopping: true };
      const allowed = this.mayEnter(v, conn);
      if (!allowed) return { dist: Math.min(dist, Math.max(0.2, toEnd - 3.0)), leadV: 0, stopping: true };
      for (const o of conn.vehicles || []) {
        const d = toEnd + o.s - o.spec.len;
        if (d < dist) { dist = d; leadV = o.v; }
      }
      for (const o of conn.to.vehicles) {
        const d = toEnd + conn.length + o.s - o.spec.len;
        if (o.s < 25 && d < dist) { dist = d; leadV = o.v; }
      }
    }
    return { dist, leadV };
  }

  mayEnter(v, conn) {
    const toEnd = v.lane.length - v.s;
    if (this.trainBlocked.has(v.lane.edgeId) && toEnd < 40) return false;
    const sig = this.signalFor(conn);
    if (sig === 'red') return false;
    if (sig === 'amber' && toEnd > 6 && v.v < 11) return false;
    if (sig === 'green') return (conn.occupied === 0 || toEnd > 6);
    // unsignalised: hold for occupied conflicting paths, yield if we are the minor road
    for (const c of conn.conflicts) if (c.occupied > 0) return false;
    const n = this.graph.nodes.get(conn.node);
    if (n && v.lane.rank < n.majorRank) {
      for (const other of n.connections) {
        if (other === conn) continue;
        if (other.from.rank <= v.lane.rank) continue;
        for (const o of other.from.vehicles) {
          const d = other.from.length - o.s;
          if (d < 26 && o.v > 1.5) return false;
        }
      }
    }
    if (conn.turn === 'left' && !n?.signalised) {
      for (const c of conn.conflicts) {
        for (const o of c.from.vehicles) {
          const d = c.from.length - o.s;
          if (d < 22 && o.v > 2) return false;
        }
      }
    }
    return conn.occupied === 0 || conn.occupied < 2;
  }

  chooseConnection(v) {
    const exits = v.lane.exits;
    if (!exits || !exits.length) return null;
    const weights = exits.map((c) => (c.turn === 'through' ? 3.0 : c.turn === 'right' ? 1.4 : c.turn === 'left' ? 1.0 : 0.12));
    let total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < exits.length; i++) {
      r -= weights[i];
      if (r <= 0) return exits[i];
    }
    return exits[exits.length - 1];
  }

  step(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.stepSignals(dt);
    for (const v of this.vehicles) {
      if (!v.conn && !v.nextConn) v.nextConn = this.chooseConnection(v);
      const { dist, leadV, stopping } = this.gapAhead(v);
      const v0 = Math.min(v.lane ? v.lane.speed : 12, v.conn ? v.conn.from.speed * 0.72 : 99, v.spec.type === 'bus' ? 16 : 34);
      const gap = Math.max(0.4, dist);
      const dv = v.v - leadV;
      const sStar = IDM.s0 + Math.max(0, v.v * IDM.T + (v.v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
      let acc = IDM.a * (1 - Math.pow(v.v / Math.max(v0, 0.1), IDM.delta) - Math.pow(sStar / gap, 2));
      acc = clamp(acc, -6.5, 2.4);
      const prevV = v.v;
      v.v = Math.max(0, v.v + acc * dt);
      v.brake = acc < -0.6 ? clamp(-acc / 3, 0, 1) : 0;
      v.waiting = v.v < 0.3 ? v.waiting + dt : 0;
      v.s += v.v * dt;
      v.wheelSpin += (v.v * dt) / Math.max(0.15, v.spec.wheelR);

      if (v.conn) {
        if (v.s >= v.conn.length) {
          const over = v.s - v.conn.length;
          releaseConn(v.conn, v);
          const target = v.conn.to;
          v.conn = null;
          v.lane = target;
          v.s = over;
          target.vehicles.push(v);
          v.nextConn = this.chooseConnection(v);
          v.indicator = 0;
        }
      } else if (v.s >= v.lane.length - 0.05) {
        const conn = v.nextConn;
        if (conn && this.mayEnter(v, conn)) {
          const over = v.s - v.lane.length;
          v.lane.vehicles = v.lane.vehicles.filter((x) => x !== v);
          v.conn = conn;
          v.s = Math.max(0, over);
          v.nextConn = null;
          conn.vehicles = conn.vehicles || [];
          conn.vehicles.push(v);
          conn.occupied++;
          v.indicator = conn.turn === 'left' ? -1 : conn.turn === 'right' ? 1 : 0;
        } else {
          v.s = v.lane.length - 0.05;
          v.v = Math.min(v.v, 0.4);
          if (!conn && v.waiting > 1.2) this.recycle(v);
        }
      }
      this.updatePose(v, dt);
    }
    // keep the fleet at target size
    while (this.vehicles.length < this.maxVehicles) {
      if (!this.spawn()) break;
    }
  }

  recycle(v) {
    if (v.conn) releaseConn(v.conn, v);
    if (v.lane) v.lane.vehicles = v.lane.vehicles.filter((x) => x !== v);
    this.vehicles = this.vehicles.filter((x) => x !== v);
  }

  updatePose(v, dt) {
    const path = v.conn ? v.conn.path : v.lane.pts;
    const total = v.conn ? v.conn.length : v.lane.length;
    const s = clamp(v.s, 0, total);
    const { p, dir } = samplePath(path, s);
    const yaw = Math.atan2(dir.z, dir.x);
    const prevYaw = v.yaw || yaw;
    const dyaw = wrapAngle(yaw - prevYaw);
    v.steer = clamp(dyaw / Math.max(dt, 0.001) * 0.35, -0.6, 0.6);
    v.yaw = yaw;
    // suspension: sample the carriageway displacement under the axles
    let pitch = 0, lift = 0;
    if (!v.conn && v.lane) {
      const edge = this.net.edges.get(v.lane.edgeId);
      if (edge) {
        const sRoad = roadSFor(v.lane, s);
        const half = v.spec.wheelbase / 2;
        const f = surfaceDisplacement(edge, sRoad + half * v.lane.dir, v.lane.offsetT);
        const r = surfaceDisplacement(edge, sRoad - half * v.lane.dir, v.lane.offsetT);
        pitch = Math.atan2(r - f, v.spec.wheelbase) * (v.lane.dir > 0 ? 1 : 1);
        lift = (f + r) * 0.5;
      }
    }
    v.pitch = lerp(v.pitch || 0, pitch, 0.35);
    v.pos = { x: p.x, y: p.y + lift, z: p.z };
    v.roll = lerp(v.roll || 0, clamp(-v.steer * Math.min(v.v, 20) * 0.012, -0.06, 0.06), 0.2);
  }
}

function roadSFor(lane, s) {
  const i = clamp(Math.floor((s / Math.max(lane.length, 0.01)) * (lane.pts.length - 1)), 0, lane.pts.length - 1);
  return lane.pts[i].s ?? s;
}

function releaseConn(conn, v) {
  conn.occupied = Math.max(0, conn.occupied - 1);
  if (conn.vehicles) conn.vehicles = conn.vehicles.filter((x) => x !== v);
}

function samplePath(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = v3dist2D(pts[i], pts[i + 1]) || 1e-5;
    if (acc + d >= s) {
      const f = (s - acc) / d;
      return {
        p: {
          x: lerp(pts[i].x, pts[i + 1].x, f),
          y: lerp(pts[i].y, pts[i + 1].y, f),
          z: lerp(pts[i].z, pts[i + 1].z, f),
        },
        dir: normXZ(v3sub(pts[i + 1], pts[i])),
      };
    }
    acc += d;
  }
  const n = pts.length;
  return { p: pts[n - 1], dir: normXZ(v3sub(pts[n - 1], pts[n - 2] || pts[n - 1])) };
}

function pickType(rng, cls) {
  const r = rng();
  if (cls === ROAD_CLASS.HIGHWAY || cls === ROAD_CLASS.RAMP) {
    return r < 0.5 ? 'sedan' : r < 0.68 ? 'suv' : r < 0.84 ? 'van' : 'truck';
  }
  if (r < 0.34) return 'sedan';
  if (r < 0.56) return 'hatch';
  if (r < 0.74) return 'suv';
  if (r < 0.86) return 'van';
  if (r < 0.94) return 'bus';
  return 'truck';
}

/** Static kerbside parking: fills marked bays, leaving realistic gaps. */
export function generateParkedCars(net, surface, rng, density = 0.6, limit = 150) {
  const out = [];
  const edges = [...net.edges.values()];
  rng.shuffle(edges);
  for (const edge of edges) {
    if (out.length >= limit) break;
    const ribbon = surface.ribbons.get(edge.id);
    if (!ribbon) continue;
    const p = edge.profile;
    for (const side of [-1, 1]) {
      const has = side < 0 ? p.parkingL : p.parkingR;
      if (!has) continue;
      const lanes = lanesOf(p).filter((l) => l.type === 'parking' && l.side === side);
      if (!lanes.length) continue;
      const t = lanes[0].centreT;
      let s = ribbon.s0 + 6;
      while (s < ribbon.s1 - 8 && out.length < limit) {
        const gap = rng.range(0.1, 1) < density ? 0 : rng.range(5, 16);
        if (gap > 0) { s += gap; continue; }
        const type = rng() < 0.45 ? 'sedan' : rng() < 0.7 ? 'hatch' : rng() < 0.88 ? 'suv' : 'van';
        const spec = vehicleSpec(type);
        const f = edge.curve.frameAt(s + spec.len / 2);
        out.push({
          type,
          colour: PAINT_COLOURS[Math.floor(rng() * PAINT_COLOURS.length)],
          pos: {
            x: f.p.x + f.right.x * (t + rng.range(-0.1, 0.1)),
            y: f.p.y - 0.022 * Math.abs(t) + 0.01,
            z: f.p.z + f.right.z * (t + rng.range(-0.1, 0.1)),
          },
          yaw: Math.atan2(f.t.z, f.t.x) + (side > 0 ? 0 : Math.PI) + rng.range(-0.02, 0.02),
        });
        s += spec.len + rng.range(0.7, 1.9);
      }
    }
  }
  return out;
}

/** Simple train service: carriages following the alignment, with crossing interlocking. */
export class TrainSim {
  constructor(lines, opts = {}) {
    this.lines = lines;
    this.trains = lines.map((line, i) => ({
      line,
      s: line.curve.length * (0.1 + 0.3 * i),
      v: line.speed,
      cars: opts.cars ?? 4,
      dir: 1,
    }));
    this.barrierState = 0;
  }

  step(dt, sim) {
    const blocked = new Set();
    let anyNear = 0;
    for (const t of this.trains) {
      t.s += t.v * t.dir * dt;
      const L = t.line.curve.length;
      const trainLen = t.cars * 20;
      if (t.s > L + trainLen + 60) t.s = -trainLen - 40;
      for (const c of t.line.crossings) {
        const d = c.sRail - t.s;
        if (d > -trainLen - 25 && d < 230) {
          blocked.add(c.edgeId);
          anyNear = Math.max(anyNear, clamp(1 - Math.abs(d) / 230, 0, 1));
        }
      }
    }
    this.barrierState = clamp(this.barrierState + (anyNear > 0.05 ? dt / 2.2 : -dt / 2.6), 0, 1);
    if (sim) sim.trainBlocked = blocked;
    return blocked;
  }

  poses() {
    const out = [];
    for (const t of this.trains) {
      const L = t.line.curve.length;
      for (let i = 0; i < t.cars; i++) {
        const s = t.s - i * 20.4;
        if (s < -20 || s > L + 20) continue;
        const sc = clamp(s, 0, L);
        const f = t.line.curve.frameAt(sc);
        out.push({
          pos: { x: f.p.x, y: f.p.y + 0.36, z: f.p.z },
          yaw: Math.atan2(f.t.z, f.t.x),
          lead: i === 0,
        });
      }
    }
    return out;
  }
}
