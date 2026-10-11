// Shared alignment used by asphalt, curbs, markings, picking and vehicle lanes.
// Tangent continuity is solved on degree-two graph vertices, not on the unioned
// outline after the fact. This avoids the former butt-cap lobes at bends.
export const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const unit = (v) => {
  const length = Math.hypot(...v);
  return length > 1e-10 ? v.map((x) => x / length) : [1, 0];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const addScaled = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s];
export function measure(points) {
  const stations = [0];
  for (let i = 1; i < points.length; i++)
    stations.push(stations[i - 1] + distance(points[i - 1], points[i]));
  return stations;
}
export function preparePath(points, tangents) {
  points.stations = measure(points);
  points.lengthMeters = points.stations.at(-1) || 0;
  points.tangents =
    tangents ||
    points.map((p, i) =>
      unit(
        sub(
          points[Math.min(points.length - 1, i + 1)],
          points[Math.max(0, i - 1)],
        ),
      ),
    );
  return points;
}
export function atStation(points, s) {
  const stations = points.stations || measure(points),
    total = stations.at(-1) || 0;
  if (points.length < 2)
    return {
      x: points[0]?.[0] || 0,
      z: points[0]?.[1] || 0,
      dx: 1,
      dz: 0,
      index: 0,
      t: 0,
    };
  s = Math.max(0, Math.min(total, s));
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (stations[mid] <= s) low = mid;
    else high = mid;
  }
  const a = points[low],
    b = points[high],
    t = (s - stations[low]) / (stations[high] - stations[low] || 1);
  const ta = points.tangents?.[low] || unit(sub(b, a)),
    tb = points.tangents?.[high] || ta;
  const tangent = unit([
    ta[0] * (1 - t) + tb[0] * t,
    ta[1] * (1 - t) + tb[1] * t,
  ]);
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    dx: tangent[0],
    dz: tangent[1],
    index: low,
    t,
  };
}
export function cubicPath(p, a, b, q, step = 0.3) {
  const count = Math.max(
      12,
      Math.ceil((distance(p, a) + distance(a, b) + distance(b, q)) / step),
    ),
    points = [],
    tangents = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count,
      s = 1 - t;
    points.push([
      s * s * s * p[0] +
        3 * s * s * t * a[0] +
        3 * s * t * t * b[0] +
        t * t * t * q[0],
      s * s * s * p[1] +
        3 * s * s * t * a[1] +
        3 * s * t * t * b[1] +
        t * t * t * q[1],
    ]);
    tangents.push(
      unit([
        3 * s * s * (a[0] - p[0]) +
          6 * s * t * (b[0] - a[0]) +
          3 * t * t * (q[0] - b[0]),
        3 * s * s * (a[1] - p[1]) +
          6 * s * t * (b[1] - a[1]) +
          3 * t * t * (q[1] - b[1]),
      ]),
    );
  }
  return preparePath(points, tangents);
}
function rawPath(road, nodes) {
  const a = nodes.find((n) => n.id === road.a),
    b = nodes.find((n) => n.id === road.b);
  if (!a || !b) return preparePath([]);
  const p = [a.x, a.z],
    q = [b.x, b.z];
  if (road.points)
    return preparePath([p, ...road.points.map((p) => [...p]), q]);
  const c = road.control || [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  return cubicPath(
    p,
    addScaled(p, sub(c, p), 2 / 3),
    addScaled(q, sub(c, q), 2 / 3),
    q,
  );
}
function outward(road, nodeId, nodes) {
  const points = rawPath(road, nodes);
  const start = road.a === nodeId;
  const t = points.tangents[start ? 0 : points.length - 1] || [1, 0];
  return {
    direction: start ? t : t.map((x) => -x),
    length: points.lengthMeters,
  };
}
function joint(road, nodeId, nodes, roads) {
  const incident = roads.filter((r) => r.a === nodeId || r.b === nodeId);
  if (incident.length !== 2) return null;
  const other = incident.find((r) => r !== road && r.id !== road.id);
  if (!other) return null;
  const own = outward(road, nodeId, nodes),
    peer = outward(other, nodeId, nodes);
  const delta = sub(own.direction, peer.direction);
  if (Math.hypot(...delta) < 0.15) return null; // near coincident branches are not a bend
  return {
    direction: unit(delta),
    reach: Math.min(own.length, peer.length) * 0.32,
  };
}
export function sampleRoad(road, nodes, roads = []) {
  const raw = rawPath(road, nodes);
  if (raw.length < 2) return raw;
  const start = joint(road, road.a, nodes, roads),
    end = joint(road, road.b, nodes, roads);
  if (!start && !end) return raw;
  if (!road.points) {
    const p = raw[0],
      q = raw.at(-1),
      c = road.control || [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    return cubicPath(
      p,
      start
        ? addScaled(p, start.direction, start.reach)
        : addScaled(p, sub(c, p), 2 / 3),
      end
        ? addScaled(q, end.direction, end.reach)
        : addScaled(q, sub(c, q), 2 / 3),
      q,
    );
  }
  // Preserve the interior of previously split polylines. Replace only the end
  // neighborhoods with tangent-matched cubic pieces, so edits don't erase bends.
  const total = raw.lengthMeters,
    lo = start ? Math.min(start.reach, total * 0.32) : 0,
    hi = total - (end ? Math.min(end.reach, total * 0.32) : 0);
  const result = [],
    tangents = [];
  const append = (path) =>
    path.forEach((p, i) => {
      if (result.length && distance(result.at(-1), p) < 1e-8) return;
      result.push(p);
      tangents.push(path.tangents[i]);
    });
  if (start) {
    const cut = atStation(raw, lo);
    append(
      cubicPath(
        raw[0],
        addScaled(raw[0], start.direction, lo / 3),
        [cut.x - (cut.dx * lo) / 3, cut.z - (cut.dz * lo) / 3],
        [cut.x, cut.z],
      ),
    );
  }
  const middle = [];
  for (let s = lo; s < hi; s += 0.3) {
    const p = atStation(raw, s);
    middle.push([p.x, p.z]);
  }
  const cut = atStation(raw, hi);
  middle.push([cut.x, cut.z]);
  append(preparePath(middle));
  if (end) {
    const span = total - hi;
    append(
      cubicPath(
        [cut.x, cut.z],
        [cut.x + (cut.dx * span) / 3, cut.z + (cut.dz * span) / 3],
        addScaled(raw.at(-1), end.direction, span / 3),
        raw.at(-1),
      ),
    );
  }
  return preparePath(result, tangents);
}
export function widthProfile(road, model, s, total) {
  let width = road.width;
  for (const [nodeId, position] of [
    [road.a, s],
    [road.b, total - s],
  ]) {
    const incident = model.roads.filter(
      (r) => r.a === nodeId || r.b === nodeId,
    );
    if (incident.length !== 2) continue;
    const span = Math.min(total * 0.25, 15);
    if (position >= span) continue;
    const other = incident.find((r) => r.id !== road.id);
    if (!other) continue;
    const t = Math.max(0, position / span),
      blend = 1 - t * t * (3 - 2 * t);
    width += (other.width - road.width) * 0.5 * blend;
  }
  return width;
}
