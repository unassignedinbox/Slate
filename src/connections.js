import { nearestRoad, nearestOnSegment, distance } from "./network.js";
import { preparePath, atStation } from "./alignment.js";
import { containsPoint } from "./streetscape.js";
export function snapConnection(point, model, kind) {
  if (kind === "bridge") return point;
  const hit = nearestRoad(point, model);
  if (!hit || hit.distance > hit.road.width / 2 + model.sidewalk + 4)
    return point;
  if (kind === "concrete") return hit.point;
  const dx = point[0] - hit.point[0],
    dz = point[1] - hit.point[1],
    len = Math.hypot(dx, dz);
  if (len < 0.01) return point;
  const offset = hit.road.width / 2 + 0.22 + model.sidewalk - 0.15;
  return [
    hit.point[0] + (dx / len) * offset,
    hit.point[1] + (dz / len) * offset,
  ];
}
export function closestConnection(point, connections) {
  let best = null;
  for (const c of connections || [])
    for (let i = 1; i < c.points.length; i++) {
      const hit = nearestOnSegment(point, c.points[i - 1], c.points[i]);
      if (
        hit.distance < c.width / 2 + 0.8 &&
        (!best || hit.distance < best.distance)
      )
        best = { ...hit, connection: c };
    }
  return best?.connection;
}
export function moveConnectionEnd(c, end, x, z) {
  const index = end ? c.points.length - 1 : 0,
    old = c.points[index],
    dx = x - old[0],
    dz = z - old[1];
  c.points = c.points.map((p, i) => {
    const t = i / (c.points.length - 1),
      w = end ? t : 1 - t;
    return [p[0] + dx * w, p[1] + dz * w];
  });
}
export function bridgeGeometry(c, data) {
  const path = preparePath(c.points.map((p) => [...p])),
    length = path.lengthMeters,
    warnings = [];
  if (length < 12)
    return {
      valid: false,
      warnings: ["Bridge needs at least 12 m between its ends."],
    };
  const width = c.width + 0.3,
    height = c.height ?? 5.5,
    count = Math.ceil(length / 0.75);
  let start = length * 0.38,
    end = length * 0.62,
    first = Infinity,
    last = -Infinity;
  for (let i = 0; i <= count; i++) {
    const s = (length * i) / count,
      p = atStation(path, s);
    for (let step = 0; step <= Math.ceil(width / 0.5); step++) {
      const side = -1 + (2 * step) / Math.ceil(width / 0.5);
      if (
        containsPoint(
          data.baseWalkOuter || data.walkOuter,
          p.x - (p.dz * side * width) / 2,
          p.z + (p.dx * side * width) / 2,
        )
      ) {
        first = Math.min(first, s);
        last = Math.max(last, s);
      }
    }
  }
  if (Number.isFinite(first)) {
    start = Math.max(4, first - 2);
    end = Math.min(length - 4, last + 2);
    if (first < 4 || last > length - 4)
      return {
        valid: false,
        warnings: [
          "Bridge ends must be in the park, beyond the road and pavement. Move its ends farther inland.",
        ],
      };
  }
  if (start >= end || start < 4 || length - end < 4)
    return { valid: false, warnings: ["Insufficient approach length."] };
  const grade = Math.max(height / (start - 2), height / (length - end - 2));
  if (grade > 1 / 12 + 0.001)
    warnings.push(
      `Steep bridge approaches: ${(grade * 100).toFixed(1)}%. Lengthen the approaches for an 8.3% design target.`,
    );
  if (Number.isFinite(first) && height - 0.35 + 0.27 - 0.12 < 2)
    return {
      valid: false,
      warnings: [
        "Bridge is too low for the preview vehicles. Raise its deck and review road clearance.",
      ],
    };
  if (Number.isFinite(first) && height - 0.35 + 0.27 - 0.12 < 5)
    warnings.push(
      "Road clearance below 5 m: verify the clearance required for this project.",
    );
  const stations = [0, 2, start, end, length - 2, length];
  for (let i = 1; i < count; i++) stations.push((length * i) / count);
  stations.sort((a, b) => a - b);
  const frames = stations
    .filter((s, i) => !i || s - stations[i - 1] > 0.001)
    .map((s) => {
      const p = atStation(path, s),
        rise =
          s < start
            ? Math.max(0, (s - 2) / (start - 2))
            : s > end
              ? Math.max(0, (length - s - 2) / (length - end - 2))
              : 1;
      return { ...p, s, y: 0.27 + height * Math.min(1, rise) };
    });
  for (let i = 1; i < frames.length; i++)
    if (frames[i].dx * frames[i - 1].dx + frames[i].dz * frames[i - 1].dz < 0.2)
      return {
        valid: false,
        warnings: [
          "Bridge curve reverses too sharply. Use a gentler alignment.",
        ],
      };
  const positions = [],
    indices = [],
    uvs = [];
  const point = (p, side, dy = 0) => [
    p.x - (p.dz * side * width) / 2,
    p.y + dy,
    p.z + (p.dx * side * width) / 2,
  ];
  function quad(a, b, c, d) {
    const base = positions.length / 3;
    for (const v of [a, b, c, d]) {
      positions.push(...v);
      uvs.push(v[0] / 5, v[2] / 5);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1],
      b = frames[i];
    quad(point(a, -1), point(a, 1), point(b, 1), point(b, -1));
    quad(
      point(a, -1, -0.35),
      point(b, -1, -0.35),
      point(b, 1, -0.35),
      point(a, 1, -0.35),
    );
    quad(point(a, -1), point(b, -1), point(b, -1, -0.35), point(a, -1, -0.35));
    quad(point(a, 1), point(a, 1, -0.35), point(b, 1, -0.35), point(b, 1));
  }
  for (const [p, rev] of [
    [frames[0], false],
    [frames.at(-1), true],
  ]) {
    const vs = [
      point(p, -1),
      point(p, -1, -0.35),
      point(p, 1, -0.35),
      point(p, 1),
    ];
    quad(...(rev ? vs.reverse() : vs));
  }
  return {
    valid: true,
    positions,
    indices,
    uvs,
    frames,
    length,
    grade,
    start,
    end,
    warnings,
    width,
  };
}
