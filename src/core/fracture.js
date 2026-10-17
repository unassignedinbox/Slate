// Convex fracture.
//
// A polyhedron is { faces: [{ v: Vector3[], n: Vector3, kind, color }] } with each
// face convex and wound counter-clockwise seen from outside. Slicing it by a plane
// keeps both halves convex, so repeated slicing turns a wall, a slab or a whole
// building into jagged convex chunks. Original faces keep their surface kind (so a
// chunk of facade still shows its windows); the new faces are tagged K.CUT and get
// the darker "fresh break" treatment in the shader.
//
// Convexity is what makes the chunks cheap for physics too: a convex chunk is just
// its face planes, so ray and sphere tests are a handful of dot products.
import * as THREE from 'three';
import { K, newellNormal } from './geo.js';

const EPS = 1e-6;

export function boxPoly(w, h, d, faceFn) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const c = [];
  for (let i = 0; i < 8; i++) c.push(new THREE.Vector3(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz));
  const defs = [
    ['right', [1, 3, 7, 5], [1, 0, 0]], ['left', [0, 4, 6, 2], [-1, 0, 0]],
    ['top', [2, 6, 7, 3], [0, 1, 0]], ['bottom', [0, 1, 5, 4], [0, -1, 0]],
    ['front', [4, 5, 7, 6], [0, 0, 1]], ['back', [0, 2, 3, 1], [0, 0, -1]],
  ];
  const faces = [];
  for (const [name, ids, n] of defs) {
    const nn = new THREE.Vector3(...n);
    let v = ids.map((i) => c[i].clone());
    if (newellNormal(v, new THREE.Vector3()).dot(nn) < 0) v.reverse();
    const { kind, color } = faceFn(name, nn);
    faces.push({ v, n: nn, kind, color });
  }
  return { faces };
}

/** Polyhedron from a convex set of points arranged as an extruded polygon (top ring, bottom ring). */
export function prismPoly(topRing, botRing, kinds, colors) {
  // topRing / botRing: same vertex count, matching order (CCW seen from above).
  const faces = [];
  const m = topRing.length;
  const add = (v, kind, color) => {
    const n = newellNormal(v, new THREE.Vector3());
    faces.push({ v, n, kind, color });
  };
  add(topRing.map((p) => p.clone()), kinds.top, colors.top);
  add(botRing.map((p) => p.clone()).reverse(), kinds.bottom, colors.bottom);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    add([botRing[i].clone(), botRing[j].clone(), topRing[j].clone(), topRing[i].clone()], kinds.side, colors.side);
  }
  // make sure every face points outward (rings might be CW)
  const c = polyCentroidApprox({ faces });
  for (const f of faces) {
    const fc = f.v.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / f.v.length);
    if (f.n.dot(fc.sub(c)) < 0) { f.v.reverse(); f.n.negate(); }
  }
  return { faces };
}

export function transformPoly(poly, M) {
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  return {
    faces: poly.faces.map((f) => ({
      v: f.v.map((p) => p.clone().applyMatrix4(M)),
      n: f.n.clone().applyMatrix3(nm).normalize(),
      kind: f.kind, color: f.color,
    })),
  };
}

export function translatePoly(poly, t) {
  for (const f of poly.faces) for (const p of f.v) p.add(t);
  return poly;
}

function polyCentroidApprox(poly) {
  const c = new THREE.Vector3();
  let k = 0;
  for (const f of poly.faces) for (const p of f.v) { c.add(p); k++; }
  return c.multiplyScalar(1 / Math.max(1, k));
}

/** Exact volume + centroid by tetrahedral decomposition. */
export function polyMass(poly) {
  const o = poly.faces[0].v[0];
  let vol = 0;
  const cen = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cr = new THREE.Vector3();
  for (const f of poly.faces) {
    const v = f.v;
    for (let i = 1; i < v.length - 1; i++) {
      a.subVectors(v[0], o); b.subVectors(v[i], o); c.subVectors(v[i + 1], o);
      const tv = a.dot(cr.crossVectors(b, c)) / 6;
      vol += tv;
      cen.x += tv * (o.x + v[0].x + v[i].x + v[i + 1].x) / 4;
      cen.y += tv * (o.y + v[0].y + v[i].y + v[i + 1].y) / 4;
      cen.z += tv * (o.z + v[0].z + v[i].z + v[i + 1].z) / 4;
    }
  }
  if (Math.abs(vol) > 1e-12) cen.multiplyScalar(1 / vol);
  return { volume: vol, centroid: cen };
}

function polyArea(v) {
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let i = 1; i < v.length - 1; i++) {
    e1.subVectors(v[i], v[0]); e2.subVectors(v[i + 1], v[0]);
    n.add(cr.crossVectors(e1, e2));
  }
  return n.length() / 2;
}

function dedupe(points, eps = 1e-5) {
  const out = [];
  for (const p of points) if (!out.some((q) => q.distanceToSquared(p) < eps * eps)) out.push(p);
  return out;
}

/**
 * Split poly by plane n.x = d. Returns { neg, pos } (either may be null).
 * The new cap faces get kind `cutKind` and colour `cutColor`.
 */
export function clipPoly(poly, n, d, cutKind = K.CUT, cutColor = [0.1, 0.1, 0.1]) {
  const negFaces = [], posFaces = [];
  const cap = [];
  let anyNeg = false, anyPos = false;
  for (const f of poly.faces) {
    const vs = f.v, m = vs.length;
    const sd = new Array(m);
    for (let i = 0; i < m; i++) {
      sd[i] = n.dot(vs[i]) - d;
      if (sd[i] < -EPS) anyNeg = true; else if (sd[i] > EPS) anyPos = true;
    }
    const nv = [], pv = [];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const a = vs[i], b = vs[j], sa = sd[i], sb = sd[j];
      if (sa <= EPS) nv.push(a.clone());
      if (sa >= -EPS) pv.push(a.clone());
      if (Math.abs(sa) <= EPS) cap.push(a.clone());
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) {
        const t = sa / (sa - sb);
        const p = a.clone().lerp(b, t);
        nv.push(p.clone()); pv.push(p.clone()); cap.push(p);
      }
    }
    if (nv.length >= 3 && polyArea(nv) > 1e-7) negFaces.push({ v: nv, n: f.n.clone(), kind: f.kind, color: f.color });
    if (pv.length >= 3 && polyArea(pv) > 1e-7) posFaces.push({ v: pv, n: f.n.clone(), kind: f.kind, color: f.color });
  }
  if (!anyNeg) return { neg: null, pos: poly };
  if (!anyPos) return { neg: poly, pos: null };
  const pts = dedupe(cap);
  if (pts.length >= 3) {
    const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const u = new THREE.Vector3();
    if (Math.abs(n.x) < 0.9) u.set(1, 0, 0); else u.set(0, 1, 0);
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const tmp = new THREE.Vector3();
    pts.sort((p, q) => {
      tmp.subVectors(p, c); const ap = Math.atan2(tmp.dot(w), tmp.dot(u));
      tmp.subVectors(q, c); const aq = Math.atan2(tmp.dot(w), tmp.dot(u));
      return ap - aq;
    });
    // neg piece: outward normal +n, CCW around +n (ascending angle with u x w = n)
    negFaces.push({ v: pts.map((p) => p.clone()), n: n.clone(), kind: cutKind, color: cutColor });
    posFaces.push({ v: pts.map((p) => p.clone()).reverse(), n: n.clone().negate(), kind: cutKind, color: cutColor });
  }
  const neg = negFaces.length >= 4 ? { faces: negFaces } : null;
  const pos = posFaces.length >= 4 ? { faces: posFaces } : null;
  return { neg, pos };
}

export function polyBounds(poly) {
  const b = new THREE.Box3();
  for (const f of poly.faces) for (const p of f.v) b.expandByPoint(p);
  return b;
}

/**
 * Fracture into roughly `count` convex pieces by repeatedly slicing the largest
 * piece with a plane through a jittered point near its centroid.
 *  normalFn(rng, size) -> unit Vector3 lets callers bias crack orientation
 *  (e.g. mostly-vertical cracks through a road slab so the driving surface stays flat).
 */
export function fracturePoly(poly, { count = 6, rng, minFrac = 0.03, jitter = 0.3, normalFn = null, cutKind = K.CUT, cutColor = [0.1, 0.1, 0.1] }) {
  const total = polyMass(poly).volume;
  const minVol = total * minFrac;
  let pieces = [{ poly, vol: total }];
  let guard = 0;
  while (pieces.length < count && guard++ < count * 12) {
    pieces.sort((a, b) => b.vol - a.vol);
    const P = pieces[0];
    const bb = polyBounds(P.poly);
    const size = bb.getSize(new THREE.Vector3());
    const { centroid } = polyMass(P.poly);
    const pt = centroid.clone().add(new THREE.Vector3(
      (rng.next() * 2 - 1) * size.x * jitter,
      (rng.next() * 2 - 1) * size.y * jitter,
      (rng.next() * 2 - 1) * size.z * jitter,
    ));
    let nrm;
    if (normalFn) nrm = normalFn(rng, size);
    else {
      // prefer cutting across the longest dimension so chunks stay chunky
      nrm = new THREE.Vector3(rng.gauss() * size.x, rng.gauss() * size.y, rng.gauss() * size.z);
    }
    if (nrm.lengthSq() < 1e-9) continue;
    nrm.normalize();
    const { neg, pos } = clipPoly(P.poly, nrm, nrm.dot(pt), cutKind, cutColor);
    if (!neg || !pos) continue;
    const vn = polyMass(neg).volume, vp = polyMass(pos).volume;
    if (vn < minVol || vp < minVol) continue;
    pieces.shift();
    pieces.push({ poly: neg, vol: vn }, { poly: pos, vol: vp });
  }
  return pieces.map((p) => p.poly);
}

/** Re-centre a piece on its centroid. Returns { poly (local), centroid (original space) }. */
export function centrePoly(poly) {
  const { centroid } = polyMass(poly);
  const neg = centroid.clone().negate();
  const local = { faces: poly.faces.map((f) => ({ v: f.v.map((p) => p.clone().add(neg)), n: f.n.clone(), kind: f.kind, color: f.color })) };
  return { poly: local, centroid };
}

/** Face planes [nx, ny, nz, d] for collision (outward normals). */
export function polyPlanes(poly) {
  const out = [];
  for (const f of poly.faces) {
    const n = newellNormal(f.v, new THREE.Vector3());
    if (!isFinite(n.x)) continue;
    const d = n.dot(f.v[0]);
    // merge near-duplicate planes
    if (out.some((p) => p[0] * n.x + p[1] * n.y + p[2] * n.z > 0.9999 && Math.abs(p[3] - d) < 1e-4)) continue;
    out.push([n.x, n.y, n.z, d]);
  }
  return out;
}

export function polyVerts(poly) {
  const out = [];
  for (const f of poly.faces) for (const p of f.v) if (!out.some((q) => q.distanceToSquared(p) < 1e-8)) out.push(p.clone());
  return out;
}
