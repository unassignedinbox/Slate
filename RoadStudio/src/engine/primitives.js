// Quad-based primitives used for props, rails, poles and vehicles.
import { add, scale, cross, norm } from './math.js';

const vtx = (p, u = 0.5, ao = 1) => [p[0], p[1], p[2], u, ao];

// Six faces of a box, each as four corner indices into the sign table below.
const BOX_FACES = [
  [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
  [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
  [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
  [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
  [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
];

// Oriented box. R = lateral, U = up, F = forward; half extents hx, hy, hz along them.
export function box(mb, c, R, U, F, hx, hy, hz, mat) {
  const corner = (s) =>
    add(c, add(add(scale(R, s[0] * hx), scale(U, s[1] * hy)), scale(F, s[2] * hz)));
  for (const f of BOX_FACES) {
    mb.quad(vtx(corner(f[0])), vtx(corner(f[1])), vtx(corner(f[2])), vtx(corner(f[3])), mat);
  }
}

// Orthonormal frame [X, Y, Z] with Y = axis.
export function frameFromAxis(axis) {
  const a = norm(axis);
  const helper = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const b = norm(cross(a, helper));
  const c = norm(cross(b, a));
  return [b, a, c];
}

// Tapered (optionally fluted) cylinder from base along axis, height h.
export function cylinder(mb, base, axis, r0, r1, h, seg, mat, opts = {}) {
  const [X, Y, Z] = frameFromAxis(axis);
  const rf = opts.radiusFn || (() => 1);
  const ring = (center, r) => {
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const rr = r * rf(th);
      pts.push(add(center, add(scale(X, Math.cos(th) * rr), scale(Z, Math.sin(th) * rr))));
    }
    return pts;
  };
  const bottom = ring(base, r0);
  const topC = add(base, scale(Y, h));
  const top = ring(topC, r1);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    mb.quad(vtx(bottom[i]), vtx(bottom[j]), vtx(top[j]), vtx(top[i]), mat);
  }
  if (opts.caps !== false) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      mb.tri(vtx(base), vtx(bottom[j]), vtx(bottom[i]), mat);
      mb.tri(vtx(topC), vtx(top[i]), vtx(top[j]), mat);
    }
  }
}

export function sphere(mb, c, r, mat, seg = 20, rings = 12) {
  const P = (i, j) => {
    const th = (j / seg) * Math.PI * 2;
    const ph = (i / rings) * Math.PI;
    return add(c, [Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r]);
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      // Pole rings collapse to a point: emit one real triangle instead of a degenerate quad.
      if (i === 0) mb.tri(vtx(P(0, j)), vtx(P(1, j)), vtx(P(1, j + 1)), mat);
      else if (i === rings - 1) mb.tri(vtx(P(i, j)), vtx(P(i + 1, j)), vtx(P(i, j + 1)), mat);
      else mb.quad(vtx(P(i, j)), vtx(P(i + 1, j)), vtx(P(i + 1, j + 1)), vtx(P(i, j + 1)), mat);
    }
  }
}

// Sweeps a closed 2D profile [[lateral, up], ...] along rows [{ c, R, U }].
export function sweepClosed(mb, rows, profile, mat) {
  const m = profile.length;
  const pts = rows.map((rw) => profile.map(([l, u]) => vtx(add(rw.c, add(scale(rw.R, l), scale(rw.U, u))))));
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      mb.quad(pts[i][k], pts[i][k2], pts[i + 1][k2], pts[i + 1][k], mat);
    }
  }
}

// Open profile sweep for flat strips.
export function sweepOpen(mb, rows, profile, mat) {
  const m = profile.length;
  const pts = rows.map((rw) => profile.map(([l, u]) => vtx(add(rw.c, add(scale(rw.R, l), scale(rw.U, u))))));
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k + 1 < m; k++) {
      mb.quad(pts[i][k], pts[i][k + 1], pts[i + 1][k + 1], pts[i + 1][k], mat);
    }
  }
}
