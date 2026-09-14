// Re-derive the CORRECT ground truth and re-test.
//
// For a prism whose top edge run is blended with radius r:
//   fillet: the blend surface along a straight run is a CYLINDER whose axis is
//           the supporting line offset inward by r, at height zt-r.
//           Where two blended runs meet, the two cylinders INTERSECT, and the
//           corner curve is that intersection (a mitre) -- NOT a sphere.
//           Proof: the ring point at parameter phi is the intersection of both
//           supporting lines offset inward by d=r(1-cos phi), at z=zt-r+r sin phi.
//           Its distance to axis_i = hypot(r-d, r sin phi) = hypot(r cos phi, r sin phi) = r.
//           So the mitre point lies on BOTH cylinders exactly.
//   chamfer: same construction with a single linear band; the corner is the
//           intersection of the two chamfer planes.
//
// So the correct invariant is: every blend vertex is at distance exactly r from
// the axis of EVERY blended run it belongs to.
const path = require('path');
const { load } = require('./harness');
const { sandbox } = load(process.env.APP || path.join(__dirname, '..', 'app', 'index.html'));
const A = sandbox.__app;
const f4 = (x) => (!isFinite(x) ? String(x) : (Math.abs(x) < 5e-7 ? 0 : x).toFixed(4));

function mkBody(pts, height, name) {
  const sk = A.mk('sketch', name + 'Sk', {}, { children: [] }); A.doc.figures.push(sk);
  const cv = A.mk('curve', name + 'P', { pts, closed: true, bulge: pts.map(() => 0) },
    { ctype: 'poly', parent: sk.id }); A.doc.figures.push(cv); sk.children = [cv.id];
  const b = A.mk('body', name, { height, draft: 0, base: 0 },
    { op: 'extrude', src: sk.id, profile: cv.id }); A.doc.figures.push(b); return b;
}
function build(b, edits) {
  const s = b.edits; b.edits = edits; let m, e = null;
  try { m = A.solidBuild(b); } catch (x) { e = String((x && x.message) || x); }
  b.edits = s; A.meshCache.clear(); A.topoCache.clear(); return { m, e };
}
const V = (m) => { const o = [];
  (m.tris || []).forEach((t) => t.forEach((p) => o.push(p)));
  (m.quads || []).forEach((q) => q.p.forEach((p) => o.push(p)));
  const s = new Set(), u = []; o.forEach((p) => { const k = p.map((v) => v.toFixed(5)).join(',');
    if (!s.has(k)) { s.add(k); u.push(p); } }); return u; };

const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const H = 20, r = 5, zt = H;
const b = mkBody(SQ, H, 'V1');
const keys = build(b, []).m.brep.edges.map((e) => e.key).filter((k) => /^top:/.test(k));

console.log('### Corrected check: mitre, not sphere.\n');
const m = build(b, keys.map((k) => ({ type: 'fillet', key: k, r }))).m;
const band = V(m).filter((p) => p[2] > H - r - 1e-6);
// the 4 cylinder axes (inward offset by r at z=H-r)
const axes = [
  { fixed: 'y', v: -20 + r }, { fixed: 'x', v: 20 - r },
  { fixed: 'y', v: 20 - r }, { fixed: 'x', v: -20 + r },
];
let worst = 0;
band.forEach((p) => {
  // distance to the nearest axis must be exactly r (each blend point lies on
  // at least one cylinder; corner points lie on two)
  const ds = axes.map((a) => Math.hypot((a.fixed === 'x' ? p[0] : p[1]) - a.v, p[2] - (H - r)));
  const best = Math.min(...ds);
  worst = Math.max(worst, Math.abs(best - r));
});
console.log(`  blend pts=${band.length}  max |dist(axis) - r| = ${f4(worst)}  (want 0)`);
console.log(worst < 1e-6
  ? '  => the fillet corner MITRE is mathematically CORRECT. My earlier "sphere" truth was wrong.\n'
  : '  => genuine deviation.\n');

console.log('### Now the real defects: per-edge radius and per-edge type.\n');
const zl = (mesh) => [...new Set(V(mesh).map((p) => +p[2].toFixed(4)))].sort((x, y) => x - y);

{
  const { m: m1 } = build(b, [
    { type: 'chamfer', key: keys[0], r: 2 },
    { type: 'chamfer', key: keys[1], r: 8 }]);
  const z = zl(m1);
  console.log(`  two chamfers r=2 and r=8 -> zLevels ${z.join(',')}`);
  console.log(`     want both 18 (=20-2) and 12 (=20-8) present. got: ` +
    `${z.includes(18) ? '18 yes' : '18 MISSING'}, ${z.includes(12) ? '12 yes' : '12 MISSING'}`);
}
{
  const { m: m2 } = build(b, [
    { type: 'fillet', key: keys[0], r: 5 },
    { type: 'chamfer', key: keys[1], r: 5 }]);
  const z = zl(m2);
  console.log(`  fillet+chamfer mixed   -> ${z.length} zLevels`);
  console.log('     want: fillet arc (many levels) AND a chamfer band. got ' +
    (z.length <= 3 ? 'COLLAPSED to a single type (BUG)' : 'both'));
}
{
  // only the TOP is blended -> r should be allowed up to the full height H,
  // but the code clamps every band to H*0.499.
  const { m: m3 } = build(b, keys.map((k) => ({ type: 'chamfer', key: k, r: 15 })));
  const z = zl(m3);
  console.log(`  top-only chamfer r=15 on a ${H} tall prism -> zLevels ${z.join(',')}`);
  console.log(`     want 5 (=20-15). got ${z.includes(5) ? '5 yes' : '5 MISSING -> over-clamped to H/2'}`);
}
{
  // narrow profile: inward offset must not self-intersect
  const NARROW = [[-25, -4], [25, -4], [25, 4], [-25, 4]]; // 50 x 8 strip
  const bn = mkBody(NARROW, 40, 'V2');
  const kn = build(bn, []).m.brep.edges.map((e) => e.key).filter((k) => /^top:/.test(k));
  const { m: m4, e } = build(bn, kn.map((k) => ({ type: 'chamfer', key: k, r: 6 })));
  if (e) console.log('  narrow strip chamfer r=6: ERROR', e);
  else {
    const cap = V(m4).filter((p) => Math.abs(p[2] - 40) < 1e-6);
    const ys = cap.map((p) => p[1]);
    console.log(`  narrow 50x8 strip, chamfer r=6 (> half width 4): cap y range ` +
      `[${f4(Math.min(...ys))},${f4(Math.max(...ys))}]`);
    console.log('     want the cap to collapse/clamp, NOT invert. ' +
      (Math.min(...ys) > Math.max(...ys) - 1e-9 ? 'collapsed ok' :
        (Math.min(...ys) < -4 || Math.max(...ys) > 4 ? 'INVERTED/EXPANDED (BUG)' : 'clamped ok')));
  }
}
