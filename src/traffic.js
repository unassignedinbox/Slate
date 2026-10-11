import { atStation, preparePath, cubicPath, distance } from "./alignment.js";
import { humpSpec, humpHeight } from "./traffic-calming.js";
const degree = (model, id) =>
  model.roads.filter((r) => r.a === id || r.b === id).length;
export function lanePath(road, dir = 1) {
  const samples = road.samples,
    points = samples.map((p, i) => {
      const tangent = samples.tangents[i],
        off = ((samples.widths?.[i] || road.width) / 4) * dir;
      return [p[0] - tangent[1] * off, p[1] + tangent[0] * off];
    });
  if (dir < 0) points.reverse();
  const tangents = samples.tangents.map((t) => t.map((x) => x * dir));
  if (dir < 0) tangents.reverse();
  const path = preparePath(points, tangents);
  path.centerStations = [...samples.stations];
  if (dir < 0) path.centerStations.reverse();
  return path;
}
function setback(model, node, road) {
  if (degree(model, node) < 3) return 0;
  return Math.min(
    road.samples.lengthMeters * 0.35,
    Math.max(
      ...model.roads
        .filter((r) => r.a === node || r.b === node)
        .map((r) => r.width),
    ) /
      2 +
      model.radius +
      3,
  );
}
export function roadLeg(road, dir, model) {
  const full = lanePath(road, dir),
    from = dir > 0 ? road.a : road.b,
    to = dir > 0 ? road.b : road.a;
  const start = setback(model, from, road),
    end = Math.max(start + 0.1, full.lengthMeters - setback(model, to, road));
  const points = [],
    tangents = [],
    centerStations = [];
  const centerAt = (p) =>
    full.centerStations[p.index] * (1 - p.t) +
    full.centerStations[Math.min(p.index + 1, full.length - 1)] * p.t;
  for (let s = start; s < end; s += 0.35) {
    const p = atStation(full, s);
    points.push([p.x, p.z]);
    tangents.push([p.dx, p.dz]);
    centerStations.push(centerAt(p));
  }
  const p = atStation(full, end);
  points.push([p.x, p.z]);
  tangents.push([p.dx, p.dz]);
  centerStations.push(centerAt(p));
  const path = preparePath(points, tangents);
  path.centerStations = centerStations;
  return {
    key: road.id + ":" + dir,
    road,
    dir,
    from,
    to,
    path,
    start,
    fullLength: full.lengthMeters,
  };
}
export function connectorPath(incoming, outgoing) {
  const a = atStation(incoming.path, incoming.path.lengthMeters),
    b = atStation(outgoing.path, 0),
    p = [a.x, a.z],
    q = [b.x, b.z];
  if (distance(p, q) < 1e-5) return null;
  // Join lane-center positions AND headings; never relocate a vehicle from one
  // independently offset centerline to another in a single simulation step.
  const h = distance(p, q) * 0.48;
  return cubicPath(
    p,
    [p[0] + a.dx * h, p[1] + a.dz * h],
    [q[0] - b.dx * h, q[1] - b.dz * h],
    q,
    0.2,
  );
}
export class TrafficSimulation {
  constructor(data, model, random = Math.random) {
    this.data = data;
    this.model = model;
    this.random = random;
    this.cars = [];
    this.reservations = new Map();
    this.legs = new Map();
    for (const r of data.sampled)
      for (const dir of [-1, 1]) {
        const leg = roadLeg(r, dir, model);
        this.legs.set(leg.key, leg);
      }
  }
  spawn(count) {
    this.cars = [];
    this.reservations.clear();
    for (let i = 0; i < Math.min(25, count); i++) {
      const r = this.data.sampled[i % this.data.sampled.length];
      if (!r) break;
      const dir = i % 2 ? 1 : -1,
        leg = this.legs.get(r.id + ":" + dir);
      this.cars.push({
        id: i,
        leg,
        s: Math.min(
          leg.path.lengthMeters - 2,
          5 + ((i * 17) % Math.max(1, leg.path.lengthMeters - 10)),
        ),
        speed: 0,
        stopped: false,
        pending: null,
      });
    }
    return this.cars;
  }
  plan(car) {
    if (car.pending || car.leg.connector) return;
    const choices = this.data.sampled.filter(
      (r) =>
        r.id !== car.leg.road.id && (r.a === car.leg.to || r.b === car.leg.to),
    );
    if (!choices.length) return;
    const next = choices[Math.floor(this.random() * choices.length)],
      dir = next.a === car.leg.to ? 1 : -1;
    const outgoing = this.legs.get(next.id + ":" + dir),
      path = connectorPath(car.leg, outgoing);
    car.pending = path
      ? {
          key: `junction:${car.leg.to}:${car.leg.key}:${outgoing.key}`,
          connector: true,
          to: car.leg.to,
          path,
          next: outgoing,
        }
      : outgoing;
  }
  step(dt) {
    dt = Math.min(dt, 0.1);
    for (const car of this.cars) {
      this.plan(car);
      const remaining = car.leg.path.lengthMeters - car.s;
      let target = this.model.speed / 3.6;
      // Lateral acceleration limit reduces corner speed without changing geometry.
      const here = atStation(car.leg.path, car.s),
        ahead = atStation(car.leg.path, car.s + 4),
        angle = Math.acos(
          Math.max(-1, Math.min(1, here.dx * ahead.dx + here.dz * ahead.dz)),
        );
      if (angle > 0.01) target = Math.min(target, Math.sqrt((2.0 * 4) / angle));
      if (!car.leg.connector) {
        const hump = humpSpec(car.leg.road, this.model);
        if (hump) {
          const cs = this.centerStation(car),
            aheadDistance = (hump.center - cs) * car.leg.dir;
          if (aheadDistance >= -hump.length / 2 - 2) {
            const distanceTo = Math.max(0, aheadDistance - hump.length / 2 - 3);
            target = Math.min(
              target,
              Math.sqrt((12 / 3.6) ** 2 + 2 * 2.5 * distanceTo),
            );
          }
        }
      }
      let gap = Infinity;
      for (const other of this.cars)
        if (other !== car && other.leg.key === car.leg.key && other.s > car.s)
          gap = Math.min(gap, other.s - car.s - 6);
      const busy =
        this.reservations.has(car.leg.to) &&
        this.reservations.get(car.leg.to) !== car.id;
      if (
        !car.leg.connector &&
        ((busy && car.pending?.connector) || !car.pending)
      )
        gap = Math.min(gap, remaining);
      target = Math.min(target, Math.sqrt(2 * 3 * Math.max(0, gap)));
      car.speed += Math.max(-3 * dt, Math.min(1.8 * dt, target - car.speed));
      let travel = Math.min(car.speed * dt, Math.max(0, gap));
      car.s += travel;
      if (car.s >= car.leg.path.lengthMeters - 1e-7) {
        const leftover = Math.max(0, car.s - car.leg.path.lengthMeters);
        if (car.leg.connector) {
          this.reservations.delete(car.leg.to);
          car.leg = car.leg.next;
          car.s = leftover;
          car.pending = null;
        } else if (car.pending && !(busy && car.pending.connector)) {
          if (car.pending.connector) this.reservations.set(car.leg.to, car.id);
          car.leg = car.pending;
          car.pending = null;
          car.s = leftover;
        } else {
          car.s = car.leg.path.lengthMeters;
          car.speed = 0;
          car.stopped = true;
        }
      }
    }
  }
  centerStation(car, offset = 0) {
    if (!car.leg.road) return 0;
    const path = car.leg.path,
      p = atStation(path, car.s + offset);
    return (
      path.centerStations[p.index] * (1 - p.t) +
      path.centerStations[Math.min(p.index + 1, path.length - 1)] * p.t
    );
  }
  pose(car) {
    const p = atStation(car.leg.path, car.s);
    let height = 0,
      pitch = 0;
    if (car.leg.road) {
      const h = humpSpec(car.leg.road, this.model);
      if (h) {
        const front = humpHeight(this.centerStation(car, 1.28), h),
          rear = humpHeight(this.centerStation(car, -1.28), h);
        height = (front + rear) / 2;
        pitch = -Math.atan2(front - rear, 2.56);
      }
    }
    return { ...p, height, pitch, speed: car.speed };
  }
}
