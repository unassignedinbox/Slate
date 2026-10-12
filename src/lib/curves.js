import { CatmullRomCurve3, LineCurve3, CubicBezierCurve3, CurvePath, Vector3, Curve } from 'three';

const vector = (p) => new Vector3(p.x, p.y || 0, p.z);
const point = (p) => ({ x: p.x, y: p.y, z: p.z });

class CircularArc3 extends Curve {
  constructor(road) {
    super();
    this.road = road;
  }
  getPoint(t, target = new Vector3()) {
    const { center, radius, startAngle, endAngle, points } = this.road;
    const angle = startAngle + (endAngle - startAngle) * t;
    return target.set(
      center.x + Math.cos(angle) * radius,
      (points[0].y || 0) * (1 - t) + (points.at(-1).y || 0) * t,
      center.z + Math.sin(angle) * radius,
    );
  }
}

// Distance-parameterized, with averaged tangents at vertices. Used when slicing
// legacy Catmull-Rom curves; Bézier roads are sliced analytically instead.
class PolylineCurve3 extends Curve {
  constructor(points) {
    super();
    this.points = points;
    this.distances = [0];
    for (let i = 1; i < points.length; i++)
      this.distances.push(this.distances.at(-1) + points[i].distanceTo(points[i - 1]));
  }
  getLength() {
    return this.distances.at(-1);
  }
  getPoint(t, target = new Vector3()) {
    const d = Math.max(0, Math.min(1, t)) * this.getLength();
    let i = 1;
    while (i < this.distances.length - 1 && this.distances[i] < d) i++;
    const span = this.distances[i] - this.distances[i - 1];
    return target
      .copy(this.points[i - 1])
      .lerp(this.points[i], span ? (d - this.distances[i - 1]) / span : 0);
  }
  getPointAt(t, target) {
    return this.getPoint(t, target);
  }
  getTangentAt(t, target = new Vector3()) {
    const dt = Math.min(0.001, 0.05 / Math.max(1, this.getLength()));
    return target
      .copy(this.getPoint(Math.min(1, t + dt)))
      .sub(this.getPoint(Math.max(0, t - dt)))
      .normalize();
  }
}

export function createCurve(road) {
  if (road.roundaboutId && road.center && !road.customSpline) return new CircularArc3(road);
  const points = road.points.map(vector);
  if (road.curveType === 'polyline') return new PolylineCurve3(points);
  if (road.curveType === 'bezier' && points.length >= 4 && (points.length - 1) % 3 === 0) {
    const path = new CurvePath();
    for (let i = 0; i + 3 < points.length; i += 3)
      path.add(new CubicBezierCurve3(points[i], points[i + 1], points[i + 2], points[i + 3]));
    return path;
  }
  if (road.closed && points.length > 3)
    return new CatmullRomCurve3(points.slice(0, -1), true, 'centripetal');
  return points.length === 2
    ? new LineCurve3(points[0], points[1])
    : new CatmullRomCurve3(points, false, 'centripetal');
}

export function sampleCurve(road, spacing = 3, max = 650) {
  const curve = createCurve(road),
    length = curve.getLength();
  const n = Math.max(1, Math.min(max, Math.ceil(length / spacing)));
  const samples = Array.from({ length: n + 1 }, (_, i) => ({
    point: curve.getPointAt(i / n),
    distance: (length * i) / n,
    t: i / n,
  }));
  return { curve, length, samples };
}

export function frameAt(curve, distance, length = curve.getLength()) {
  const t = Math.max(0, Math.min(1, distance / Math.max(0.001, length)));
  const p = curve.getPointAt(t),
    tangent = curve.getTangentAt(t).normalize();
  const normal = new Vector3(-tangent.z, 0, tangent.x).normalize();
  return { point: p, tangent, normal, t, distance };
}

function splitBezier(points, t) {
  const [a, b, c, d] = points;
  const ab = a.clone().lerp(b, t),
    bc = b.clone().lerp(c, t),
    cd = c.clone().lerp(d, t);
  const abc = ab.clone().lerp(bc, t),
    bcd = bc.clone().lerp(cd, t);
  const m = abc.clone().lerp(bcd, t);
  return [
    [a, ab, abc, m],
    [m, bcd, cd, d],
  ];
}

/** Preserve Bézier tangents/shape, circular arcs and endpoint node IDs when split. */
export function sliceRoad(road, from, to, start, end, id = road.id) {
  const curve = createCurve(road),
    length = curve.getLength();
  let points,
    curveType = road.curveType;
  if (road.roundaboutId && !road.customSpline) {
    const startAngle = road.startAngle + (road.endAngle - road.startAngle) * from;
    const endAngle = road.startAngle + (road.endAngle - road.startAngle) * to;
    const mid = curve.getPointAt((from + to) / 2);
    return {
      ...road,
      id,
      points: [start, point(mid), end],
      startAngle,
      endAngle,
      island: road.island && from === 0,
      markingPhase: (road.markingPhase || 0) + from * length,
    };
  }
  if (road.curveType === 'bezier') {
    points = [];
    let prefix = 0;
    for (const segment of curve.curves) {
      const segmentLength = segment.getLength(),
        last = prefix + segmentLength;
      const a = Math.max(prefix, from * length),
        b = Math.min(last, to * length);
      if (b - a > 0.00001) {
        const t0 = segment.getUtoTmapping(Math.max(0, Math.min(1, (a - prefix) / segmentLength)));
        const t1 = segment.getUtoTmapping(Math.max(0, Math.min(1, (b - prefix) / segmentLength)));
        let controls = [segment.v0, segment.v1, segment.v2, segment.v3];
        if (t1 < 1) controls = splitBezier(controls, t1)[0];
        if (t0 > 0) controls = splitBezier(controls, t0 / t1)[1];
        points.push(...controls.slice(points.length ? 1 : 0).map(point));
      }
      prefix = last;
    }
  } else if (road.points.length === 2) {
    points = [start, end];
  } else {
    const n = Math.max(2, Math.min(127, Math.ceil(((to - from) * length) / 2)));
    points = Array.from({ length: n + 1 }, (_, i) =>
      point(curve.getPointAt(from + ((to - from) * i) / n)),
    );
    curveType = 'polyline';
  }
  points[0] = start;
  points[points.length - 1] = end;
  return {
    ...road,
    id,
    points,
    ...(road.bridgeSpan
      ? {
          bridgeSpan: {
            start: Math.max(0, Math.min(1, (road.bridgeSpan.start - from) / (to - from))),
            end: Math.max(0, Math.min(1, (road.bridgeSpan.end - from) / (to - from))),
          },
        }
      : {}),
    ...(curveType ? { curveType } : {}),
    markingPhase: (road.markingPhase || 0) + from * length,
  };
}

export function toPolyline(road) {
  const { samples } = sampleCurve(road, 2, 127);
  const points = samples.map((s) => point(s.point));
  points[0] = road.points[0];
  points[points.length - 1] = road.points.at(-1);
  return { ...road, points, curveType: 'polyline', customSpline: true };
}

export function addBezierHandle(road) {
  const segments = (road.points.length - 1) / 3;
  const index = Math.floor(segments / 2) * 3;
  const [left, right] = splitBezier(road.points.slice(index, index + 4).map(vector), 0.5);
  const controls = [...left, ...right.slice(1)].map(point);
  controls[0] = road.points[index];
  controls[controls.length - 1] = road.points[index + 3];
  return [...road.points.slice(0, index), ...controls, ...road.points.slice(index + 4)];
}
