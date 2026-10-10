/*
 * Topology report. The claim is "quads, welded, no overlapping geometry at
 * junctions" - so it gets measured, not asserted.
 */
import { buildCity } from '../src/road/city';
import { buildNetwork } from '../src/road/build';
import { MAT } from '../src/road/profile';
import { Canvas, View, triSmooth, line, v3 } from './raster';
import { V3, add, sub, cross, norm, len } from '../src/core/vec';

const g = buildCity();
const t0 = Date.now();
const out = buildNetwork(g);
const ms = Date.now() - t0;
const m = out.mesh;
let bad = 0;
const fail = (s: string) => { console.log(`  FAIL ${s}`); bad++; };

console.log(`network: ${g.nodes.size} nodes, ${g.edges.size} edges`);
console.log(`mesh:    ${m.verts.length} verts, ${m.quads.length / 4} quads, ${m.tris.length / 3} tris ` +
  `(${(m.quadRatio * 100).toFixed(2)} % quads) in ${ms} ms`);

// ---- 1. face sanity
let degenerate = 0, sliver = 0, nonplanar = 0, worstPlanar = 0;
let areaSum = 0, minArea = 1e9, maxArea = 0;
for (let i = 0; i < m.quads.length; i += 4) {
  const p = [0, 1, 2, 3].map((k) => m.verts[m.quads[i + k]].p);
  const uniq = new Set(m.quads.slice(i, i + 4));
  if (uniq.size < 4) { degenerate++; continue; }
  const n1 = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const n2 = cross(sub(p[2], p[0]), sub(p[3], p[0]));
  const a = (len(n1) + len(n2)) / 2;
  areaSum += a; minArea = Math.min(minArea, a); maxArea = Math.max(maxArea, a);
  if (a < 1e-6) { degenerate++; continue; }
  // aspect: longest edge over shortest
  const e = [len(sub(p[1], p[0])), len(sub(p[2], p[1])), len(sub(p[3], p[2])), len(sub(p[0], p[3]))];
  const asp = Math.max(...e) / Math.max(Math.min(...e), 1e-6);
  if (asp > 60) sliver++;
  // planarity: angle between the two triangle normals
  const c = Math.min(1, Math.abs(len(n1) * len(n2)) > 0 ? Math.abs(
    (n1.x * n2.x + n1.y * n2.y + n1.z * n2.z) / (len(n1) * len(n2))) : 1);
  const ang = Math.acos(c) * 180 / Math.PI;
  worstPlanar = Math.max(worstPlanar, ang);
  if (ang > 12) nonplanar++;
}
console.log(`faces:   area ${minArea.toFixed(3)}-${maxArea.toFixed(2)} m2 (mean ${(areaSum / (m.quads.length / 4)).toFixed(2)}), ` +
  `${sliver} slivers, ${nonplanar} non-planar (worst ${worstPlanar.toFixed(1)} deg)`);
if (degenerate) fail(`${degenerate} degenerate quads`);
if (sliver > m.quads.length / 4 * 0.02) fail(`${sliver} sliver quads`);
const slK = [0, 0, 0];
for (let i = 0; i < m.quads.length; i += 4) {
  const p = [0, 1, 2, 3].map((k) => m.verts[m.quads[i + k]]);
  const e = [0, 1, 2, 3].map((k) => len(sub(p[(k + 1) % 4].p, p[k].p)));
  if (Math.max(...e) / Math.max(Math.min(...e), 1e-6) > 60) slK[p[0].kind]++;
}
console.log(`         slivers by kind: ${slK.map((v, i) => `kind${i}:${v}`).join(' ')}`);

// ---- 2. manifoldness: every edge used by one or two faces, never three
const edgeUse = new Map<string, number>();
const addEdge = (a: number, b: number) => {
  const k = a < b ? `${a}_${b}` : `${b}_${a}`;
  edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
};
for (let i = 0; i < m.quads.length; i += 4) {
  for (let k = 0; k < 4; k++) addEdge(m.quads[i + k], m.quads[i + ((k + 1) % 4)]);
}
for (let i = 0; i < m.tris.length; i += 3) {
  for (let k = 0; k < 3; k++) addEdge(m.tris[i + k], m.tris[i + ((k + 1) % 3)]);
}
let boundary = 0, interior = 0, nonmanifold = 0;
for (const u of edgeUse.values()) {
  if (u === 1) boundary++; else if (u === 2) interior++; else nonmanifold++;
}
console.log(`edges:   ${interior} interior, ${boundary} boundary, ${nonmanifold} non-manifold`);
if (nonmanifold > 0) fail(`${nonmanifold} edges shared by 3+ faces`);

// ---- 3. welding: junction surfaces must REUSE approach vertices, not clone them
const pos = new Map<string, number[]>();
m.verts.forEach((v, i) => {
  const k = `${Math.round(v.p.x * 1000)}_${Math.round(v.p.y * 1000)}_${Math.round(v.p.z * 1000)}`;
  const l = pos.get(k) ?? []; l.push(i); pos.set(k, l);
});
let coincident = 0, seamPairs = 0;
for (const l of pos.values()) {
  if (l.length < 2) continue;
  // a legitimate duplicate is a crease seam: same spot, different material
  const mats = new Set(l.map((i) => m.verts[i].mat));
  if (mats.size > 1) seamPairs += l.length - 1; else coincident += l.length - 1;
}
console.log(`welding: ${seamPairs} intentional crease seams, ${coincident} unexplained coincident verts`);
if (coincident > 0) fail(`${coincident} duplicated vertices at the same position and material ` +
  '(junction cloned the road end instead of welding to it)');

// ---- 4. no stacked asphalt.
//      Two carriageway faces count as stacked only if they genuinely overlap
//      in plan - separating-axis test on the projected quads - share no
//      vertices, and sit within 1.5 m of each other vertically. Bucketing
//      centroids is not enough: a junction fan has plenty of small faces
//      legitimately sitting 20 cm apart.
function sat(a: { x: number; z: number }[], b: { x: number; z: number }[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.z - p.z), az = q.x - p.x;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) { const d = v.x * ax + v.z * az; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const v of b) { const d = v.x * ax + v.z * az; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax <= bMin + 1e-7 || bMax <= aMin + 1e-7) return false;
    }
  }
  return true;
}
const grid = new Map<string, number[]>();
const faces: { ids: number[]; poly: { x: number; z: number }[]; y: number }[] = [];
const roadMats: number[] = [MAT.ASPHALT, MAT.GUTTER];
for (let i = 0; i < m.quads.length; i += 4) {
  const ids = [0, 1, 2, 3].map((k) => m.quads[i + k]);
  const vs = ids.map((k) => m.verts[k]);
  if (!roadMats.includes(vs[0].mat)) continue;
  const poly = vs.map((v) => ({ x: v.p.x, z: v.p.z }));
  const y = vs.reduce((s2, v) => s2 + v.p.y, 0) / 4;
  const fi = faces.length;
  faces.push({ ids, poly, y });
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  for (let gx = Math.floor(Math.min(...xs) / 4); gx <= Math.floor(Math.max(...xs) / 4); gx++) {
    for (let gz = Math.floor(Math.min(...zs) / 4); gz <= Math.floor(Math.max(...zs) / 4); gz++) {
      const k = `${gx}_${gz}`;
      const l = grid.get(k) ?? []; l.push(fi); grid.set(k, l);
    }
  }
}
let stacked = 0;
const stackKind = [0, 0, 0];
const seenPair = new Set<string>();
for (const l of grid.values()) {
  for (let i = 0; i < l.length; i++) {
    for (let j = i + 1; j < l.length; j++) {
      const A = faces[l[i]], B = faces[l[j]];
      if (A.ids.some((v) => B.ids.includes(v))) continue;
      if (Math.abs(A.y - B.y) > 1.5) continue;
      const key = `${l[i]}_${l[j]}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      if (sat(A.poly, B.poly)) { stacked++; stackKind[m.verts[A.ids[0]].kind]++; }
    }
  }
}
console.log(`overlap: ${stacked} genuinely overlapping carriageway faces ` +
  `(${stackKind.map((v, i) => `kind${i}:${v}`).join(' ')})`);
if (stacked > 0) fail(`${stacked} overlapping road faces - geometry is layered, not merged`);

// ---- 5. quad ratio claim
if (m.quadRatio < 0.995) fail(`only ${(m.quadRatio * 100).toFixed(1)} % quads`);

// ---------------------------------------------------------------- render
const W = 900, H = 760;
const c = new Canvas(W * 2, H);
const COL: Record<number, [number, number, number]> = {
  [MAT.ASPHALT]: [64, 66, 70], [MAT.GUTTER]: [86, 88, 92], [MAT.KERB_FACE]: [150, 148, 142],
  [MAT.FOOTWAY]: [128, 124, 118], [MAT.VERGE]: [62, 78, 52], [MAT.SHOULDER]: [78, 76, 74],
  [MAT.MEDIAN]: [70, 86, 58], [MAT.KERB_TOP]: [150, 148, 142],
};
function draw(view: View, wire: boolean): void {
  for (let i = 0; i < m.quads.length; i += 4) {
    const a = m.verts[m.quads[i]], b = m.verts[m.quads[i + 1]];
    const d = m.verts[m.quads[i + 2]], e = m.verts[m.quads[i + 3]];
    const col = COL[a.mat] ?? [100, 100, 100];
    triSmooth(c, view, [a.p, b.p, d.p], [a.n, b.n, d.n], col);
    triSmooth(c, view, [a.p, d.p, e.p], [a.n, d.n, e.n], col);
  }
  if (!wire) return;
  for (let i = 0; i < m.quads.length; i += 4) {
    const p = [0, 1, 2, 3].map((k) => m.verts[m.quads[i + k]].p);
    for (let k = 0; k < 4; k++) line(c, view, p[k], p[(k + 1) % 4], [18, 220, 190], 0.9985);
  }
}
draw({ eye: v3(10, 330, 330), ctr: v3(10, 0, 10), scale: 0.95, vx: 0, vy: 0, vw: W, vh: H }, false);
// close on the Y fork and a crossroads, with the quad wire on
// close on the busiest junction, quad wire on
let best = [...out.junctions.entries()].sort((a, b) =>
  (g.nodes.get(b[0])!.edges.length - g.nodes.get(a[0])!.edges.length))[0];
const jc = best[1].centre;
console.log(`close-up: node ${best[0]}, degree ${g.nodes.get(best[0])!.edges.length}, ` +
  `at ${jc.x.toFixed(0)},${jc.z.toFixed(0)}`);
draw({ eye: v3(jc.x + 16, 34, jc.z + 30), ctr: v3(jc.x, 0, jc.z), scale: 1.3, vx: W, vy: 0, vw: W, vh: H }, true);
c.save('/tmp/roads.png');
console.log('wrote /tmp/roads.png');

console.log(bad === 0 ? '\nTOPOLOGY OK' : `\n${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
