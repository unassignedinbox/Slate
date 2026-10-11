// Quad-based primitive kit. Everything that is not a road surface (furniture, barriers, rails,
// structures, vehicles) is lofted, lathed or swept with these so the whole scene stays quad-first.

import { v3, v3add, v3sub, v3scale, v3norm, v3cross, v3dist, normXZ, TAU, lerp } from './math.js';
import { SURF } from './mesh.js';

const UP = { x: 0, y: 1, z: 0 };

/** Orthonormal frame for a direction. */
export function frameFor(dir, upHint = UP) {
  const f = v3norm(dir);
  let up = upHint;
  if (Math.abs(f.y) > 0.98) up = { x: 1, y: 0, z: 0 };
  const r = v3norm(v3cross(f, up));
  const u = v3norm(v3cross(r, f));
  return { f, r, u };
}

/** Axis-aligned box (6 quads), optionally subdivided for nicer shading. */
export function box(mb, centre, size, opts = {}) {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
  const yaw = opts.yaw || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (x, y, z) => ({
    x: centre.x + x * c - z * s,
    y: centre.y + y,
    z: centre.z + x * s + z * c,
  });
  const v = [
    P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz),
    P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz),
  ];
  const uv = opts.uvScale ?? 1;
  const add = (p) => mb.vertex(p, { u: (p.x + p.z) * uv, v: p.y * uv, ...opts.attrs });
  const i = v.map(add);
  mb.quad(i[4], i[5], i[6], i[7]);   // top
  mb.quad(i[3], i[2], i[1], i[0]);   // bottom
  mb.quad(i[0], i[1], i[5], i[4]);   // -z
  mb.quad(i[2], i[3], i[7], i[6]);   // +z
  mb.quad(i[1], i[2], i[6], i[5]);   // +x
  mb.quad(i[3], i[0], i[4], i[7]);   // -x
  return i;
}

/** Cylinder / truncated cone between two points, all-quad sides and midpoint-fan caps. */
export function cylinder(mb, p0, p1, r0, r1, segments = 16, opts = {}) {
  const dir = v3sub(p1, p0);
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1e-5;
  const { f, r, u } = frameFor(dir);
  const ring = (centre, radius, vCoord) => {
    const idx = [], pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU;
      const p = {
        x: centre.x + (r.x * Math.cos(a) + u.x * Math.sin(a)) * radius,
        y: centre.y + (r.y * Math.cos(a) + u.y * Math.sin(a)) * radius,
        z: centre.z + (r.z * Math.cos(a) + u.z * Math.sin(a)) * radius,
      };
      pts.push(p);
      idx.push(mb.vertex(p, { u: (a / TAU) * Math.max(radius, 0.05) * 6, v: vCoord, ...opts.attrs }));
    }
    return { idx, pts };
  };
  const a = ring(p0, r0, 0);
  const b = ring(p1, r1, len);
  for (let i = 0; i < segments; i++) {
    const n = (i + 1) % segments;
    mb.quad(a.idx[i], b.idx[i], b.idx[n], a.idx[n]);
  }
  if (opts.capStart !== false && r0 > 1e-4) capRing(mb, a, p0, opts, true);
  if (opts.capEnd !== false && r1 > 1e-4) capRing(mb, b, p1, opts, false);
  return { a, b };
}

function capRing(mb, ring, centre, opts, flip) {
  const n = ring.idx.length;
  const mids = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mp = {
      x: (ring.pts[i].x + ring.pts[j].x) / 2,
      y: (ring.pts[i].y + ring.pts[j].y) / 2,
      z: (ring.pts[i].z + ring.pts[j].z) / 2,
    };
    mids.push(mb.vertex(mp, { u: mp.x, v: mp.z, ...opts.attrs }));
  }
  const c = mb.vertex(centre, { u: centre.x, v: centre.z, ...opts.attrs });
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    if (flip) mb.quad(ring.idx[i], mids[prev], c, mids[i]);
    else mb.quad(ring.idx[i], mids[i], c, mids[prev]);
  }
}

/**
 * Sweep a 2D profile along a 3D polyline. profile = [{x: lateral, y: vertical, surface?}].
 * This is how kerbs, W-beams, Jersey barriers, handrails, rails and copings are made.
 */
export function sweep(mb, path, profile, opts = {}) {
  if (path.length < 2) return [];
  const closedProfile = !!opts.closedProfile;
  const rows = [];
  let dist = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dir = normXZ(v3sub(next, prev));
    const right = { x: dir.z, y: 0, z: -dir.x };
    if (i > 0) dist += v3dist(path[i - 1], p);
    const row = profile.map((q) => {
      const wp = {
        x: p.x + right.x * q.x,
        y: p.y + q.y,
        z: p.z + right.z * q.x,
      };
      if (q.surface !== undefined) mb.attr({ surface: q.surface });
      else if (opts.surface !== undefined) mb.attr({ surface: opts.surface });
      return mb.vertex(wp, { u: dist, v: q.x, ...opts.attrs, ...(q.attrs || {}) });
    });
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    for (let j = 0; j < A.length - 1; j++) mb.quad(A[j], B[j], B[j + 1], A[j + 1]);
    if (closedProfile) mb.quad(A[A.length - 1], B[B.length - 1], B[0], A[0]);
  }
  if (opts.capEnds) {
    capProfile(mb, rows[0], true);
    capProfile(mb, rows[rows.length - 1], false);
  }
  return rows;
}

function capProfile(mb, row, flip) {
  // even-sided profile caps as quad pairs (walk inwards from both ends)
  const n = row.length;
  for (let i = 0; i < Math.floor(n / 2) - 1; i++) {
    const a = row[i], b = row[i + 1], c = row[n - 2 - i], d = row[n - 1 - i];
    if (flip) mb.quad(a, b, c, d); else mb.quad(d, c, b, a);
  }
}

/** Revolve a 2D profile [{x: radius, y: height}] about +Y at `centre`. */
export function lathe(mb, centre, profile, segments = 16, opts = {}) {
  const rows = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const row = profile.map((q, k) => {
      const p = { x: centre.x + ca * q.x, y: centre.y + q.y, z: centre.z + sa * q.x };
      if (q.surface !== undefined) mb.attr({ surface: q.surface });
      else if (opts.surface !== undefined) mb.attr({ surface: opts.surface });
      return mb.vertex(p, { u: (a / TAU) * 3, v: q.y, ...opts.attrs });
    });
    rows.push(row);
  }
  for (let i = 0; i < segments; i++) {
    const A = rows[i], B = rows[i + 1];
    for (let j = 0; j < A.length - 1; j++) mb.quad(A[j], A[j + 1], B[j + 1], B[j]);
  }
  return rows;
}

/** Loft equal-length vertex rings (used for vehicle bodies and tunnel tubes). */
export function loft(mb, sections, opts = {}) {
  const rows = sections.map((sec, si) => sec.map((p, pi) => {
    if (p.surface !== undefined) mb.attr({ surface: p.surface });
    else if (opts.surface !== undefined) mb.attr({ surface: opts.surface });
    return mb.vertex(p, { u: si * (opts.uStep ?? 1), v: pi * (opts.vStep ?? 1), ...opts.attrs });
  }));
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    const n = Math.min(A.length, B.length);
    for (let j = 0; j < n - 1; j++) mb.quad(A[j], B[j], B[j + 1], A[j + 1]);
    if (opts.closed) mb.quad(A[n - 1], B[n - 1], B[0], A[0]);
  }
  return rows;
}

/** Flat quad patch from 4 corners. */
export function quadPatch(mb, a, b, c, d, opts = {}) {
  const i = [a, b, c, d].map((p) => mb.vertex(p, { u: p.x, v: p.z, ...opts.attrs }));
  mb.quad(i[0], i[1], i[2], i[3]);
  return i;
}

/** Subdivided ground patch (grid of quads) with an optional height function. */
export function grid(mb, origin, sizeX, sizeZ, nx, nz, heightFn, opts = {}) {
  const rows = [];
  for (let i = 0; i <= nx; i++) {
    const row = [];
    for (let j = 0; j <= nz; j++) {
      const x = origin.x + (sizeX * i) / nx;
      const z = origin.z + (sizeZ * j) / nz;
      const y = heightFn ? heightFn(x, z) : origin.y;
      row.push(mb.vertex({ x, y, z }, { u: x, v: z, ...opts.attrs }));
    }
    rows.push(row);
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      mb.quad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]);
    }
  }
  return rows;
}

/** Ring of a superellipse — the basis of car body cross-sections. */
export function superEllipse(cx, cy, rx, ry, n, power = 2.6, yScaleTop = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const sx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / power);
    const sy = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / power);
    pts.push({ x: cx + sx * rx, y: cy + sy * ry * (sa > 0 ? yScaleTop : 1) });
  }
  return pts;
}

/**
 * Flat signboard / plate.  `pts` are convex, anticlockwise, in plate space (x across, y up,
 * metres); the artwork face looks along +yaw and carries uv normalised to [-1,1], which is the
 * space the sign shader paints in.  Back and rim are plain metal.  Quads throughout, except a
 * triangular plate, which is one triangle by definition.
 */
export function platePoly(mb, centre, yaw, pts, surf, variant = 0, thick = 0.035, backSurf = SURF.METAL) {
  const f = { x: Math.cos(yaw), z: Math.sin(yaw) };
  const u = { x: Math.sin(yaw), z: -Math.cos(yaw) };      // u x up = f
  let hw = 1e-3, hh = 1e-3;
  for (const q of pts) { hw = Math.max(hw, Math.abs(q.x)); hh = Math.max(hh, Math.abs(q.y)); }
  const mk = (q, sgn, sid, scaled) => mb.vertex({
    x: centre.x + u.x * q.x + f.x * thick * 0.5 * sgn,
    y: centre.y + q.y,
    z: centre.z + u.z * q.x + f.z * thick * 0.5 * sgn,
  }, {
    u: scaled ? q.x / hw : q.x, v: scaled ? q.y / hh : q.y,
    surface: sid, laneA: variant, laneB: 0, wear: 0.1, ao: 1, flags: 0, mark: 0, laneWidth: 1, param: 0,
  });
  mb.attr({ surface: surf });
  const F = pts.map((q) => mk(q, 1, surf, true));
  mb.attr({ surface: backSurf });
  const B = pts.map((q) => mk(q, -1, backSurf, false));
  const n = pts.length;
  if (n === 3) {
    mb.attr({ surface: surf }); mb.tri(F[0], F[1], F[2]);
    mb.attr({ surface: backSurf }); mb.tri(B[2], B[1], B[0]);
  } else {
    mb.attr({ surface: surf });
    for (let i = 1; i + 2 <= n - 1; i += 2) mb.quad(F[0], F[i], F[i + 1], F[i + 2]);
    mb.attr({ surface: backSurf });
    for (let i = 1; i + 2 <= n - 1; i += 2) mb.quad(B[i + 2], B[i + 1], B[i], B[0]);
  }
  mb.attr({ surface: backSurf });
  for (let i = 0; i < n; i++) mb.quad(B[i], B[(i + 1) % n], F[(i + 1) % n], F[i]);
  return { hw, hh };
}

/** Regular n-gon in plate space. */
export function regularPoly(sides, r, rot = 0) {
  return Array.from({ length: sides }, (_, i) => {
    const a = rot + (i / sides) * TAU;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/** Axis-aligned rectangle in plate space. */
export function rectPoly(w, h) {
  const x = w / 2, y = h / 2;
  return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }];
}
