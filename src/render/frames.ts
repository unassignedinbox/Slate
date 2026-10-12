// Builds lateral "frames" along a sampled road and emits lane-aligned strips,
// walls, dashes and arrows on top of MeshBuilder.
import { V3, V, Sampled, at, perpRight } from '../core/geometry';
import { MeshBuilder } from './builder';

export interface Frame {
  p: V3;
  n: V3;
  t: V3;
  y: number; // absolute height of the surface row
}

export function framesAll(S: Sampled, lift = 0): Frame[] {
  return S.pts.map((p, k) => ({ p, n: perpRight(S.tan[k]), t: S.tan[k], y: p.y + lift }));
}

/** Frames covering the arc-length range [s0, s1], including both endpoints. */
export function framesRange(S: Sampled, s0: number, s1: number, lift = 0): Frame[] {
  const out: Frame[] = [];
  const pushAt = (s: number) => {
    const h = at(S, s);
    out.push({ p: h.p, n: h.n, t: h.t, y: h.p.y + lift });
  };
  pushAt(s0);
  for (let k = 0; k < S.s.length; k++) {
    if (S.s[k] > s0 + 1e-6 && S.s[k] < s1 - 1e-6) {
      out.push({ p: S.pts[k], n: perpRight(S.tan[k]), t: S.tan[k], y: S.pts[k].y + lift });
    }
  }
  pushAt(s1);
  return out;
}

/** Flat ribbon between lateral offsets a..b along the frames. */
export function strip(mb: MeshBuilder, key: string, rows: Frame[], a: number, b: number): void {
  for (let k = 0; k < rows.length - 1; k++) {
    const r0 = rows[k];
    const r1 = rows[k + 1];
    const pa0 = V(r0.p.x + r0.n.x * a, r0.y, r0.p.z + r0.n.z * a);
    const pb0 = V(r0.p.x + r0.n.x * b, r0.y, r0.p.z + r0.n.z * b);
    const pa1 = V(r1.p.x + r1.n.x * a, r1.y, r1.p.z + r1.n.z * a);
    const pb1 = V(r1.p.x + r1.n.x * b, r1.y, r1.p.z + r1.n.z * b);
    mb.quad(key, pa0, pb0, pb1, pa1);
  }
}

/** Vertical wall at lateral offset `off` from yLo to yHi, facing `facing` (+1 right, -1 left). */
export function wall(mb: MeshBuilder, key: string, rows: Frame[], off: number, yLo: number, yHi: number, facing: 1 | -1): void {
  if (yHi - yLo < 1e-4) return;
  for (let k = 0; k < rows.length - 1; k++) {
    const r0 = rows[k];
    const r1 = rows[k + 1];
    const x0 = r0.p.x + r0.n.x * off;
    const z0 = r0.p.z + r0.n.z * off;
    const x1 = r1.p.x + r1.n.x * off;
    const z1 = r1.p.z + r1.n.z * off;
    const n = V(r0.n.x * facing, 0, r0.n.z * facing);
    const nn = V(r1.n.x * facing, 0, r1.n.z * facing);
    // Both rows share the same normal direction convention; use the row-0 normal.
    mb.poly(key, [V(x0, yLo, z0), V(x0, yHi, z0), V(x1, yHi, z1), V(x1, yLo, z1)], n, (p) => [
      (r0.t.x * p.x + r0.t.z * p.z) / 4,
      p.y / 4,
    ]);
    void nn;
  }
}

/** Simple dashed/solid line. dash=0 means solid. */
export function lineMarking(
  mb: MeshBuilder,
  key: string,
  S: Sampled,
  off: number,
  width: number,
  lift: number,
  dash = 0,
  gap = 0,
): void {
  const half = width / 2;
  if (dash <= 0) {
    strip(mb, key, framesAll(S, lift), off - half, off + half);
    return;
  }
  for (let s = 0; s < S.length; s += dash + gap) {
    const s1 = Math.min(S.length, s + dash);
    if (s1 - s < 0.2) break;
    strip(mb, key, framesRange(S, s, s1, lift), off - half, off + half);
  }
}

/** Arrow pointing along travel direction `dir` (±1) centred at (s, lateral c). */
export function arrow(mb: MeshBuilder, key: string, S: Sampled, s: number, c: number, dir: 1 | -1, lift: number): void {
  const h = at(S, s);
  const pt = (along: number, across: number): V3 => {
    const x = h.p.x + h.t.x * along * dir + h.n.x * (c + across);
    const z = h.p.z + h.t.z * along * dir + h.n.z * (c + across);
    return V(x, h.p.y + lift, z);
  };
  mb.poly(key, [pt(-1.5, -0.3), pt(0.6, -0.3), pt(0.6, 0.3), pt(-1.5, 0.3)]);
  mb.poly(key, [pt(0.6, -0.75), pt(1.7, 0), pt(0.6, 0.75)]);
}

