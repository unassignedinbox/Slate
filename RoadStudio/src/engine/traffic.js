// Simple route-following traffic. Vehicles drive the road centrelines on their lane
// (right-hand traffic), pick a random onward road at each junction, and turn around
// at dead ends. Capped at MAX_VEHICLES to keep the simulation and draw cost bounded.
import { at } from './path.js';
import { rightOf } from './math.js';
import { ROAD_CLASSES } from './network.js';

export const MAX_VEHICLES = 25;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Traffic {
  constructor(seed = 7) {
    this.cars = [];
    this.rand = rng(seed);
    this.seed = seed;
  }

  laneOffset(road, lane) {
    const cs = { m2: road.median / 2, w: road.laneWidth };
    return cs.m2 + (lane + 0.5) * cs.w;
  }

  sync(doc, paths) {
    const enabled = doc.vis.traffic !== false;
    const want = enabled ? Math.min(MAX_VEHICLES, Math.max(0, Math.round(doc.traffic.count))) : 0;
    this.cars = this.cars.filter((c) => doc.roads[c.road] && paths[c.road]);
    while (this.cars.length > want) this.cars.pop();
    let guard = 0;
    while (this.cars.length < want && guard++ < 200) this.spawn(doc, paths);
  }

  spawn(doc, paths) {
    const ids = Object.keys(paths).filter((id) => doc.roads[id]);
    if (!ids.length) return;
    const id = ids[Math.floor(this.rand() * ids.length)];
    const road = doc.roads[id];
    const L = paths[id].L;
    const dir = this.rand() < 0.5 ? 1 : -1;
    const lane = Math.floor(this.rand() * road.lanes);
    const v = ((ROAD_CLASSES[road.cls]?.speed || 40) / 3.6) * (0.75 + this.rand() * 0.25) * 0.6;
    this.cars.push({
      road: id, s: this.rand() * L, dir, lane, v,
      lat: this.laneOffset(road, lane), paint: Math.floor(this.rand() * 8),
    });
  }

  pickNext(doc, jid, fromId) {
    const opts = [];
    for (const r of Object.values(doc.roads)) {
      if (r.id === fromId) continue;
      if (r.a === jid) opts.push({ road: r, dir: 1 });
      else if (r.b === jid) opts.push({ road: r, dir: -1 });
    }
    if (!opts.length) return null;
    return opts[Math.floor(this.rand() * opts.length)];
  }

  // Advances all cars by dt seconds and returns [{ model matrix, paint }] per car.
  update(dt, doc, paths) {
    for (const c of this.cars) {
      const road = doc.roads[c.road];
      const path = paths[c.road];
      if (!road || !path) continue;
      c.s += c.dir * c.v * dt;
      const L = path.L;
      if (c.s > L || c.s < 0) {
        const atEnd = c.s > L ? road.b : road.a;
        const over = c.s > L ? c.s - L : -c.s;
        const nx = this.pickNext(doc, atEnd, road.id);
        if (nx) {
          const np = paths[nx.road.id];
          if (np) {
            c.road = nx.road.id;
            c.dir = nx.dir;
            c.s = nx.dir > 0 ? Math.min(over, np.L) : Math.max(np.L - over, 0);
            c.lane = Math.min(c.lane, nx.road.lanes - 1);
            c.target = this.laneOffset(nx.road, c.lane);
          }
        } else {
          c.dir = -c.dir;
          c.s = Math.min(L, Math.max(0, c.s));
        }
      }
      const target = c.target ?? this.laneOffset(road, c.lane);
      c.target = target;
      c.lat += Math.max(-4 * dt, Math.min(4 * dt, target - c.lat));
    }
  }

  // World transform for each car, as a column-major 4x4 plus paint index.
  instances(doc, paths) {
    const out = [];
    for (const c of this.cars) {
      const road = doc.roads[c.road];
      const path = paths[c.road];
      if (!road || !path) continue;
      const a = at(path, c.s);
      const off = c.dir * c.lat;
      const pos = [a.p[0] + a.r[0] * off, a.p[1] + 0.02, a.p[2] + a.r[2] * off];
      const F = c.dir > 0 ? a.h : [-a.h[0], 0, -a.h[2]];
      const U = [0, 1, 0];
      const R = rightOf(F);
      out.push({
        m: new Float32Array([
          F[0], F[1], F[2], 0,
          U[0], U[1], U[2], 0,
          R[0], R[1], R[2], 0,
          pos[0], pos[1], pos[2], 1,
        ]),
        paint: c.paint,
      });
    }
    return out;
  }
}
