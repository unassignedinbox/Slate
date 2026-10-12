//==================================================================================================
//  ROADEDITOR — SPLINE
//==================================================================================================
//  Centreline authoring and sampling. A road keeps its control points for editing and its sampled
//  path for everything else: topology, geometry, markings, props. Sampling adapts to curvature so
//  straights stay cheap and hairpins stay smooth.
//==================================================================================================

import { clamp, lerp, lerp3, norm3, sub3, add3, mul3, len3, TAU } from './core.js';

export function bezier3(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

export function bezier2(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    z: (p0.z ?? 0) * u * u + (p1.z ?? 0) * 2 * u * t + (p2.z ?? 0) * t * t,
  };
}

const AXES = ['x', 'y', 'z'];
const crLerp = (a, b, u) => {
  const o = { x: 0, y: 0, z: 0 };
  for (const k of AXES) o[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * u;
  return o;
};
const crDist = (a, b) => Math.max(1e-5, Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)));

/**
 * Centripetal Catmull–Rom (alpha = 0.5) through four control points. Centripetal parameterisation
 * is what keeps a hairpin from looping back on itself the way a uniform spline does.
 */
export function catmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
  const t0 = 0;
  const t1 = t0 + Math.pow(crDist(p0, p1), alpha);
  const t2 = t1 + Math.pow(crDist(p1, p2), alpha);
  const t3 = t2 + Math.pow(crDist(p2, p3), alpha);
  const tt = lerp(t1, t2, t);
  const A1 = crLerp(p0, p1, (tt - t0) / (t1 - t0));
  const A2 = crLerp(p1, p2, (tt - t1) / (t2 - t1));
  const A3 = crLerp(p2, p3, (tt - t2) / (t3 - t2));
  const B1 = crLerp(A1, A2, (tt - t0) / (t2 - t0));
  const B2 = crLerp(A2, A3, (tt - t1) / (t3 - t1));
  return crLerp(B1, B2, (tt - t1) / (t2 - t1));
}

/**
 * Curve through control points: returns a densely sampled path (used before adaptive resampling).
 *
 * The end segments of an open curve duplicate their end control point rather than wrapping to the
 * far end of the list. Wrapping is the usual mistake here and it is a silent one: the curve leaves
 * its first control point heading toward its last one, which on a three-point cul-de-sac produces a
 * kilometre of optimistic spaghetti that then crosses half the city.
 */
export function sampleControlPoints(ctrl, closed = false, perSegment = 14) {
  const n = ctrl.length;
  if (n < 2) return ctrl.slice();
  const pts = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = closed ? ctrl[(i - 1 + n) % n] : ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = closed ? ctrl[(i + 2) % n] : ctrl[Math.min(n - 1, i + 2)];
    for (let s = 0; s < perSegment; s++) pts.push(catmullRomPoint(p0, p1, p2, p3, s / perSegment));
  }
  if (!closed) pts.push({ ...ctrl[n - 1] });
  else pts.push({ ...pts[0] });
  return pts;
}

export function pathLength(path, closed = false) {
  let l = 0;
  const n = path.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    l += Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
  }
  return l;
}

/** Curvature at index i (1/m). */
export function curvatureAt(path, i, closed = false) {
  const n = path.length;
  if (n < 3) return 0;
  const ia = clamp(i - 1, 0, n - 1);
  const ib = clamp(i + 1, 0, n - 1);
  const a = path[ia];
  const b = path[i];
  const c = path[ib];
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  if (ab < 1e-6 || bc < 1e-6) return 0;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
  return (4 * area) / (ab * bc * ca || 1e-6);
}

/**
 * Adaptive resample: dense where the path bends, sparse on straights. `maxSpacing` also bounds
 * straight-run tessellation so surface shading stays even over long straights.
 */
export function resampleAdaptive(path, minSpacing = 2.5, maxSpacing = 9, curvatureScale = 26, closed = false) {
  if (path.length < 2) return path.slice();
  const dense = closed ? [...path, path[0]] : path;
  const out = [dense[0]];
  let acc = 0;
  let prev = dense[0];
  for (let i = 1; i < dense.length; i++) {
    const p = dense[i];
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y, (p.z ?? 0) - (prev.z ?? 0));
    acc += seg;
    const k = curvatureAt(dense, i, false);
    const target = clamp(curvatureScale / (1 + k * curvatureScale * 12), minSpacing, maxSpacing);
    if (acc >= target || i === dense.length - 1) {
      out.push(p);
      acc = 0;
    }
    prev = p;
  }
  if (closed) out[out.length - 1] = { ...out[0] };
  return out;
}

/** Even spacing along an existing path, preserving z. */
export function resampleEven(path, spacing, closed = false) {
  const total = pathLength(path, closed);
  const count = Math.max(2, Math.round(total / spacing) + 1);
  const out = [];
  for (let i = 0; i < count; i++) out.push(alongPath(path, (i / (count - 1)) * total, closed));
  return out;
}

/** Point at arc-length distance s along a path, with the 3D tangent. */
export function alongPath(path, s, closed = false) {
  const n = path.length;
  if (n === 1) return { ...path[0], tx: 0, ty: 1, tz: 0, i: 0, t: 0 };
  if (n < 2) return { x: 0, y: 0, z: 0, tx: 0, ty: 1, tz: 0, i: 0, t: 0 };
  const last = closed ? n : n - 1;
  const total = pathLength(path, closed);
  let target = clamp(s, 0, total);
  for (let i = 0; i < last; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = (b.z ?? 0) - (a.z ?? 0);
    const seg = Math.hypot(dx, dy, dz);
    if (target <= seg || i === last - 1) {
      const t = seg > 1e-9 ? target / seg : 0;
      const l = seg || 1;
      return { x: a.x + dx * t, y: a.y + dy * t, z: (a.z ?? 0) + dz * t, tx: dx / l, ty: dy / l, tz: dz / l, i, t };
    }
    target -= seg;
  }
  const a = path[n - 2] || path[0];
  const b = path[n - 1];
  const l = Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)) || 1;
  return { x: b.x, y: b.y, z: b.z ?? 0, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l, tz: ((b.z ?? 0) - (a.z ?? 0)) / l, i: n - 2, t: 1 };
}

/** Sub-path between two arc lengths (used when a junction cuts a road short). */
export function subPath(path, s0, s1, closed = false) {
  const total = pathLength(path, closed);
  const a = clamp(Math.min(s0, s1), 0, total);
  const b = clamp(Math.max(s0, s1), 0, total);
  const out = [alongPath(path, a, closed)];
  let acc = 0;
  const n = path.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = path[i];
    const q = path[(i + 1) % n];
    const seg = Math.hypot(q.x - p.x, q.y - p.y, (q.z ?? 0) - (p.z ?? 0));
    acc += seg;
    if (acc > a && acc < b) out.push(q);
  }
  out.push(alongPath(path, b, closed));
  return out;
}

/** Chaikin corner cutting; keeps the endpoints pinned. */
export function smoothPath(path, iterations = 1, closed = false) {
  let pts = path;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: lerp(a.x, b.x, 0.25), y: lerp(a.y, b.y, 0.25), z: lerp(a.z ?? 0, b.z ?? 0, 0.25) });
      out.push({ x: lerp(a.x, b.x, 0.75), y: lerp(a.y, b.y, 0.75), z: lerp(a.z ?? 0, b.z ?? 0, 0.75) });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Parallel-transport frames along a 3D path. Avoids the twist a naive up-vector produces on
 * vertical curvature (ramps, bridges, tunnels). Returns per-point { t, left, up }.
 */
export function pathFrames(path, closed = false, bankFn = null) {
  const n = path.length;
  const frames = new Array(n);
  const tangents = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const b = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    tangents[i] = norm3({ x: b.x - a.x, y: b.y - a.y, z: (b.z ?? 0) - (a.z ?? 0) });
  }
  let left = norm3({ x: -tangents[0].y, y: tangents[0].x, z: 0 });
  if (!isFinite(left.x) || len3(left) < 1e-6) left = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    if (i > 0) {
      // Minimal rotation bringing the previous tangent onto this one.
      const prev = tangents[i - 1];
      const axis = { x: prev.y * t.z - prev.z * t.y, y: prev.z * t.x - prev.x * t.z, z: prev.x * t.y - prev.y * t.x };
      const sinA = len3(axis);
      const cosA = clamp(prev.x * t.x + prev.y * t.y + prev.z * t.z, -1, 1);
      if (sinA > 1e-9) {
        const k = { x: axis.x / sinA, y: axis.y / sinA, z: axis.z / sinA };
        const a = Math.atan2(sinA, cosA);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const kv = k.x * left.x + k.y * left.y + k.z * left.z;
        left = {
          x: left.x * c + (k.y * left.z - k.z * left.y) * s + k.x * kv * (1 - c),
          y: left.y * c + (k.z * left.x - k.x * left.z) * s + k.y * kv * (1 - c),
          z: left.z * c + (k.x * left.y - k.y * left.x) * s + k.z * kv * (1 - c),
        };
      }
      // Re-orthogonalise against drift.
      const d = left.x * t.x + left.y * t.y + left.z * t.z;
      left = norm3({ x: left.x - t.x * d, y: left.y - t.y * d, z: left.z - t.z * d });
    }
    let up = norm3({
      x: t.y * left.z - t.z * left.y,
      y: t.z * left.x - t.x * left.z,
      z: t.x * left.y - t.y * left.x,
    });
    if (up.z < 0) {
      up = mul3(up, -1);
      left = mul3(left, -1);
    }
    let leftOut = left;
    let upOut = up;
    const bank = bankFn ? bankFn(i, tangents[i]) : 0;
    if (Math.abs(bank) > 1e-4) {
      const c = Math.cos(-bank);
      const s = Math.sin(-bank);
      leftOut = norm3({
        x: left.x * c + up.x * s,
        y: left.y * c + up.y * s,
        z: left.z * c + up.z * s,
      });
      upOut = norm3({ x: -leftOut.z * 0, y: 0, z: 0 });
      upOut = norm3({
        x: t.y * leftOut.z - t.z * leftOut.y,
        y: t.z * leftOut.x - t.x * leftOut.z,
        z: t.x * leftOut.y - t.y * leftOut.x,
      });
      if (upOut.z < 0) upOut = mul3(upOut, -1);
    }
    frames[i] = { t, left: leftOut, up: upOut };
  }
  return frames;
}

/** Rounded corner polyline: fillets the interior vertices of a 2D polyline at a given radius. */
export function filletPolyline(pts, radius, closed = false) {
  const out = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push({ x: a.x, y: a.y, z: a.z ?? 0 });
    const c = pts[(i + 2) % n];
    if (!closed && i + 2 >= n) break;
    const v1 = norm2({ x: b.x - a.x, y: b.y - a.y });
    const v2 = norm2({ x: c.x - b.x, y: c.y - b.y });
    const dot = clamp(v1.x * v2.x + v1.y * v2.y, -1, 1);
    const ang = Math.acos(dot);
    if (ang < 0.12 || Math.PI - ang < 0.05) continue;
    const len1 = Math.hypot(b.x - a.x, b.y - a.y);
    const len2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, len1 * 0.45, len2 * 0.45);
    const cut = r * Math.tan(ang / 2);
    const p1 = { x: b.x - v1.x * cut, y: b.y - v1.y * cut, z: lerp(a.z ?? 0, b.z ?? 0, 1 - cut / (len1 || 1)) };
    const p2 = { x: b.x + v2.x * cut, y: b.y + v2.y * cut, z: lerp(b.z ?? 0, c.z ?? 0, cut / (len2 || 1)) };
    out.push(p1);
    const steps = clamp(Math.ceil(ang * 6), 3, 18);
    for (let s = 1; s < steps; s++) out.push(bezier2(p1, b, p2, s / steps));
    out.push(p2);
  }
  if (!closed) out.push({ ...pts[n - 1] });
  else out.push({ ...out[0] });
  return out;
}

function norm2(a) {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

/** Reverses a path (and its frames' tangent direction is recomputed downstream, not here). */
export function reversePath(path) {
  return path.slice().reverse().map((p) => ({ ...p }));
}

/** Offsets a path laterally by d metres on the left, keeping z. Used for lane connectors. */
export function offsetPath(path, frames, d, dz = 0) {
  return path.map((p, i) => {
    const f = frames[i];
    return {
      x: p.x + f.left.x * d + f.up.x * dz,
      y: p.y + f.left.y * d + f.up.y * dz,
      z: (p.z ?? 0) + f.left.z * d + f.up.z * dz,
    };
  });
}
