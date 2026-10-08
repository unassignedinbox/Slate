// spline.js — centerline math for the Frontier road editor.
// Pure functions only: no DOM, no three.js, so the whole module is unit-testable
// in Node (tests/spline.test.js). Units are meters, Y-up, matching the engine.

// The engine's own PRNG (Frontier Terrain Lab, quarry.js). Reused verbatim so
// seeded behaviour stays consistent across the engine and its tools.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const EPS = 1e-9;

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Distance in the XZ plane (roads are authored and measured on the map).
export function xzDistance(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

// Remove consecutive duplicate control points (closer than minSpacing in XZ).
// The first and last points are always kept.
export function dedupePoints(points, minSpacing = 0.5) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && xzDistance(last.x, last.z, p.x, p.z) < minSpacing) continue;
    out.push({ x: p.x, y: p.y ?? 0, z: p.z });
  }
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (xzDistance(first.x, first.z, last.x, last.z) < minSpacing) out.pop();
  }
  return out;
}

// Total XZ length of a control polygon.
export function polylineLength(points, closed = false) {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    total += xzDistance(points[i].x, points[i].z, points[i + 1].x, points[i + 1].z);
  }
  if (closed && points.length > 2) {
    total += xzDistance(points[points.length - 1].x, points[points.length - 1].z, points[0].x, points[0].z);
  }
  return total;
}

// Resample a dense XZ point list uniformly by arc length into `count` points.
function resampleByArcLength(pts, count) {
  if (pts.length === 0) return [];
  if (pts.length === 1 || count <= 1) return [pts[0], pts[pts.length - 1]].slice(0, Math.max(count, 1));
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + xzDistance(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z));
  }
  const total = cumulative[cumulative.length - 1];
  const out = [];
  if (total < EPS) return Array.from({ length: count }, () => ({ ...pts[0] }));
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    while (seg < pts.length - 2 && cumulative[seg + 1] < target) seg++;
    const segLen = cumulative[seg + 1] - cumulative[seg];
    const t = segLen < EPS ? 0 : (target - cumulative[seg]) / segLen;
    out.push({
      x: lerp(pts[seg].x, pts[seg + 1].x, t),
      z: lerp(pts[seg].z, pts[seg + 1].z, t),
    });
  }
  return out;
}

// Dense uniform Catmull-Rom through the control points (XZ only).
// Open splines clamp their end tangents; closed splines wrap.
function catmullRomDense(points, closed, perSegment = 64) {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ x: p.x, z: p.z }));
  if (n === 2) {
    return resampleByArcLength([points[0], points[1]], perSegment + 1);
  }
  const at = (i) => {
    if (closed) return points[((i % n) + n) % n];
    return points[clamp(i, 0, n - 1)];
  };
  const dense = [];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      const t2 = t * t, t3 = t2 * t;
      dense.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  if (closed) dense.push({ x: points[0].x, z: points[0].z });
  else dense.push({ x: points[n - 1].x, z: points[n - 1].z });
  return dense;
}

// Sample a road centerline into stations.
// smoothing: 0 = exact polyline through the control points, 1 = full Catmull-Rom.
// Returns stations: { x, z, arc, tx, tz, curv } — tangent unit-length in XZ,
// signed curvature in 1/m (negative = turning left when right = (tz, 0, -tx)).
export function sampleCenterline(points, { closed = false, smoothing = 0.65, sampleLength = 2 } = {}) {
  const clean = dedupePoints(points);
  if (clean.length < 2) return [];
  const useClosed = closed && clean.length >= 3;
  const s = clamp(smoothing, 0, 1);
  const spacing = clamp(sampleLength, 0.25, 100);

  let stations;
  if (s < 1e-6) {
    // Zero smoothing is the exact control polygon: resample it directly so the
    // corner vertices survive (a dense resample would cut them).
    const count = Math.max(2, Math.round(polylineLength(clean, useClosed) / spacing) + 1);
    stations = resampleByArcLength(clean, count);
  } else {
    // Two dense reference curves, resampled to a common point count, then blended.
    const RES = 1024;
    const poly = resampleByArcLength(clean, RES);
    const curve = resampleByArcLength(catmulRomSafe(clean, useClosed), RES);
    const blended = poly.map((p, i) => ({
      x: lerp(p.x, curve[i].x, s),
      z: lerp(p.z, curve[i].z, s),
    }));
    const count = Math.max(2, Math.round(polylineLength(blended, useClosed) / spacing) + 1);
    stations = resampleByArcLength(blended, count);
  }
  if (useClosed && stations.length > 1) {
    stations.push({ x: stations[0].x, z: stations[0].z });
  }

  // Arc length, tangents and curvature from finite differences.
  let arc = 0;
  const n = stations.length;
  const result = stations.map((p, i) => {
    if (i > 0) arc += xzDistance(stations[i - 1].x, stations[i - 1].z, p.x, p.z);
    const prev = stations[Math.max(0, i - 1)];
    const next = stations[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x, tz = next.z - prev.z;
    const len = Math.hypot(tx, tz);
    if (len < EPS) { tx = 1; tz = 0; } else { tx /= len; tz /= len; }
    return { x: p.x, y: 0, z: p.z, arc, tx, tz, curv: 0 };
  });
  // Signed curvature: (T x dT).y / ds between the neighbouring tangents.
  // Negative when turning left, where "right" is the XZ vector (tz, 0, -tx).
  for (let i = 0; i < n; i++) {
    const a = result[Math.max(0, i - 1)];
    const b = result[Math.min(n - 1, i + 1)];
    const ds = Math.max(EPS, b.arc - a.arc);
    result[i].curv = (result[i].tx * b.tz - result[i].tz * b.tx - (a.tx * result[i].tz - a.tz * result[i].tx)) / ds;
  }
  return result;
}

// catmullRomDense wrapped so a degenerate input never throws.
function catmulRomSafe(points, closed) {
  try {
    return catmullRomDense(points, closed);
  } catch {
    return points.map((p) => ({ x: p.x, z: p.z }));
  }
}

// Set station heights. mode: 'follow' (terrain + ride height), 'flat' (constant
// height), 'grade' (linear from first to last station height). Mutates copies.
export function applyElevation(stations, mode, { heightFn = () => 0, rideHeight = 0.15, flatY = 0 } = {}) {
  if (!stations.length) return stations;
  if (mode === 'flat') {
    for (const st of stations) st.y = flatY;
    return stations;
  }
  if (mode === 'grade') {
    const y0 = heightFn(stations[0].x, stations[0].z) + rideHeight;
    const y1 = heightFn(stations[stations.length - 1].x, stations[stations.length - 1].z) + rideHeight;
    const total = stations[stations.length - 1].arc;
    for (const st of stations) st.y = total < EPS ? y0 : lerp(y0, y1, st.arc / total);
    return stations;
  }
  // follow
  for (const st of stations) st.y = heightFn(st.x, st.z) + rideHeight;
  return stations;
}

// Road statistics from sampled stations.
export function computeStats(stations, { closed = false } = {}) {
  const empty = { length: 0, lengthXZ: 0, maxGradePct: 0, minY: 0, maxY: 0, curveStations: 0, stations: 0 };
  if (!stations || stations.length < 2) return empty;
  let length = 0, lengthXZ = 0, maxGrade = 0;
  let minY = Infinity, maxY = -Infinity;
  let curves = 0;
  const n = stations.length;
  for (let i = 0; i < n; i++) {
    const st = stations[i];
    minY = Math.min(minY, st.y);
    maxY = Math.max(maxY, st.y);
    if (Math.abs(st.curv) > 1 / 150) curves++;
    if (i > 0) {
      const prev = stations[i - 1];
      const d3 = Math.hypot(st.x - prev.x, st.y - prev.y, st.z - prev.z);
      const d2 = Math.max(EPS, xzDistance(prev.x, prev.z, st.x, st.z));
      length += d3;
      lengthXZ += d2;
      maxGrade = Math.max(maxGrade, Math.abs(st.y - prev.y) / d2);
    }
  }
  return {
    length, lengthXZ,
    maxGradePct: maxGrade * 100,
    minY, maxY,
    curveStations: curves,
    stations: n,
  };
}

// 2D segment intersection (XZ) for self-intersection checks.
function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return false;
}

// First self-intersection of the control polygon, or null. Adjacent segments
// (and the wrap pair when closed) never count as intersections.
export function findSelfIntersection(points, closed = false) {
  const n = points.length;
  const segCount = closed ? n : n - 1;
  if (segCount < 3) return null;
  for (let i = 0; i < segCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    for (let j = i + 1; j < segCount; j++) {
      if (j === i) continue;
      if (!closed && (j === i + 1)) continue;
      if (closed && j === (i + 1) % segCount) continue;
      if (closed && i === 0 && j === segCount - 1) continue;
      const c = points[j], d = points[(j + 1) % n];
      if (segmentsCross(a, b, c, d)) return { a: i, b: j };
    }
  }
  return null;
}

// Editor validation. errors block the build; warnings are advisory.
export function validateRoad(points, { closed = false, minSpacing = 0.5 } = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(points) || points.length < 2) {
    errors.push('Add at least two control points to lay a road.');
    return { errors, warnings, clean: [] };
  }
  // Overlaps are checked on the authored points: duplicates are an authoring
  // error worth reporting, not something to fix silently.
  for (let i = 0; i + 1 < points.length; i++) {
    if (xzDistance(points[i].x, points[i].z, points[i + 1].x, points[i + 1].z) < minSpacing) {
      errors.push(`Control points ${i + 1} and ${i + 2} overlap. Move them apart.`);
    }
  }
  if (closed && points.length < 3) {
    errors.push('A closed loop needs at least three control points.');
  }
  const clean = dedupePoints(points, minSpacing);
  if (clean.length < 2) {
    errors.push('Add at least two control points to lay a road.');
    return { errors, warnings, clean };
  }
  const span = polylineLength(clean, closed && clean.length >= 3);
  if (span < 2) errors.push('The road is too short. Stretch it to at least 2 m.');
  const crossing = findSelfIntersection(clean, closed && clean.length >= 3);
  if (crossing) {
    warnings.push(`The centerline crosses itself between points ${crossing.a + 1} and ${crossing.b + 1}.`);
  }
  return { errors, warnings, clean };
}
