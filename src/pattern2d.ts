// ---------------------------------------------------------------------------
// 2D crack-pattern helpers: polygon clipping in a local (u,v) plane and
// extrusion of pattern cells into prism shards through a panel's thickness.
// Used for glass (radial+concentric), wood (grain splinters), plastic (petals).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Shard } from './convex';

export type P2 = { x: number; y: number };

export function polyArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polyCentroid(poly: P2[]): P2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    let mx = 0, my = 0;
    for (const p of poly) { mx += p.x; my += p.y; }
    return { x: mx / poly.length, y: my / poly.length };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Sutherland–Hodgman clip of polygon against half-plane n·p <= d. */
function clipHalfPlane(poly: P2[], nx: number, ny: number, d: number): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = nx * a.x + ny * a.y - d;
    const db = nx * b.x + ny * b.y - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Clip polygon to axis-aligned rect [-hw,hw]x[-hh,hh]. */
export function clipToRect(poly: P2[], hw: number, hh: number): P2[] {
  let p = clipHalfPlane(poly, 1, 0, hw);
  if (p.length >= 3) p = clipHalfPlane(p, -1, 0, hw);
  if (p.length >= 3) p = clipHalfPlane(p, 0, 1, hh);
  if (p.length >= 3) p = clipHalfPlane(p, 0, -1, hh);
  return p.length >= 3 ? p : [];
}

export interface PanelBasis {
  origin: THREE.Vector3; // world position of panel center
  u: THREE.Vector3; // in-plane axis 1 (unit)
  v: THREE.Vector3; // in-plane axis 2 (unit)
  n: THREE.Vector3; // panel normal (unit)
}

export function panelToWorld(b: PanelBasis, p: P2, offsetN: number): THREE.Vector3 {
  return b.origin
    .clone()
    .addScaledVector(b.u, p.x)
    .addScaledVector(b.v, p.y)
    .addScaledVector(b.n, offsetN);
}

export function worldToPanel(b: PanelBasis, w: THREE.Vector3): P2 {
  const d = w.clone().sub(b.origin);
  return { x: d.dot(b.u), y: d.dot(b.v) };
}

/**
 * Extrude a 2D polygon (in panel space) through the panel thickness into a
 * convex-ish prism shard in WORLD space. Caps are "outer" surface; side walls
 * are fracture surfaces.
 */
export function extrudePoly(basis: PanelBasis, poly: P2[], thickness: number): Shard {
  let p = poly;
  if (polyArea(p) < 0) p = p.slice().reverse(); // enforce CCW in (u,v)
  const ht = thickness / 2;
  const front = p.map((q) => panelToWorld(basis, q, ht)); // +n side
  const back = p.map((q) => panelToWorld(basis, q, -ht));

  const faces: THREE.Vector3[][] = [];
  const inner: boolean[] = [];

  // Front cap: CCW seen from +n.
  faces.push(front.map((v) => v.clone()));
  inner.push(false);
  // Back cap: reversed.
  faces.push(back.map((v) => v.clone()).reverse());
  inner.push(false);
  // Sides.
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([back[i].clone(), back[j].clone(), front[j].clone(), front[i].clone()]);
    inner.push(true);
  }
  return { faces, inner };
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
