// Pinpoint the fillet defect: what exactly does the corner geometry do?
const path = require('path');
const { load } = require('./harness');
const { sandbox } = load(process.env.APP || path.join(__dirname, '..', 'app', 'index.html'));
const A = sandbox.__app;
const f4 = (x) => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(4);

function mkBody(pts, height, name) {
  const sk = A.mk('sketch', name + 'Sk', {}, { children: [] });
  A.doc.figures.push(sk);
  const cv = A.mk('curve', name + 'P', { pts, closed: true, bulge: pts.map(() => 0) },
    { ctype: 'poly', parent: sk.id });
  A.doc.figures.push(cv); sk.children = [cv.id];
  const b = A.mk('body', name, { height, draft: 0, base: 0 }, { op: 'extrude', src: sk.id, profile: cv.id });
  A.doc.figures.push(b); return b;
}
function build(b, edits) {
  const s = b.edits; b.edits = edits;
  let m, e = null; try { m = A.solidBuild(b); } catch (x) { e = String(x); }
  b.edits = s; A.meshCache.clear(); A.topoCache.clear(); return { m, e };
}
const V = (m) => {
  const o = []; (m.tris || []).forEach((t) => t.forEach((p) => o.push(p)));
  (m.quads || []).forEach((q) => q.p.forEach((p) => o.push(p)));
  const s = new Set(), u = [];
  o.forEach((p) => { const k = p.map((v) => v.toFixed(5)).join(','); if (!s.has(k)) { s.add(k); u.push(p); } });
  return u;
};

console.log('### 1. ringOf() — is the offset ring mitred or arc-rounded at a convex corner?\n');
const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const b0 = mkBody(SQ, 20, 'D0');
const L = A.profileSegs(A.byId(b0.profile))[0];
const subs = A.loopSubs(L);
console.log('subs:', subs.length, subs.map((s) => `[${f4(s.a[0])},${f4(s.a[1])}]`).join(' '));
[1, 2, 4].forEach((d) => {
  const ring = A.ringOf(subs, subs.map(() => d));
  console.log(`  offset d=${d}: ` + ring.map((p) => `(${f4(p[0])},${f4(p[1])})`).join(' '));
  const corner = ring[0];
  const radial = Math.hypot(corner[0] + 20, corner[1] + 20); // dist from original corner
  console.log(`     corner moved ${f4(radial)} from the original vertex; a MITRE gives d*sqrt2=${f4(d * Math.SQRT2)}, an ARC gives d=${f4(d)}`);
});

console.log('\n### 2. fillet ring stack — actual radial profile at the corner vs at a flat run\n');
const b1 = mkBody(SQ, 20, 'D1');
const keys = build(b1, []).m.brep.edges.map((e) => e.key).filter((k) => /^top:/.test(k));
const r = 5;
const { m } = build(b1, keys.map((k) => ({ type: 'fillet', key: k, r })));
const pts = V(m).filter((p) => p[2] > 20 - r - 1e-6 && p[2] <= 20 + 1e-6);

// sample the corner column (x>0,y>0) and the mid-edge column (x>0, y~0)
const cornerCol = pts.filter((p) => p[0] > 0 && p[1] > 0).sort((a, b) => a[2] - b[2]);
const edgeCol = pts.filter((p) => p[0] > 0 && Math.abs(p[1] - -20) < 1e-6).sort((a, b) => a[2] - b[2]);

console.log('CORNER column (should trace a sphere of radius r about the spine point (15,15,15)):');
cornerCol.forEach((p) => {
  const d = Math.hypot(p[0] - 15, p[1] - 15, p[2] - 15);
  console.log(`   (${f4(p[0])},${f4(p[1])},${f4(p[2])})  |p-spine|=${f4(d)}  err=${f4(d - r)}`);
});
console.log('\nFLAT-RUN column (should trace a cylinder of radius r about the spine line y=-15,z=15):');
edgeCol.forEach((p) => {
  const d = Math.hypot(p[1] - -15, p[2] - 15);
  console.log(`   (${f4(p[0])},${f4(p[1])},${f4(p[2])})  |p-spine|=${f4(d)}  err=${f4(d - r)}`);
});

console.log('\n### 3. non-90-degree corner (should still be a true rolling-ball fillet)\n');
const TRI = [[-20, -12], [20, -12], [0, 20]];
const b2 = mkBody(TRI, 20, 'D2');
const k2 = build(b2, []).m.brep.edges.map((e) => e.key).filter((k) => /^top:/.test(k));
const m2 = build(b2, k2.map((k) => ({ type: 'fillet', key: k, r: 3 }))).m;
const cap2 = V(m2).filter((p) => Math.abs(p[2] - 20) < 1e-6);
// apex corner of the triangle has a sharp (~56 deg) angle; inset must be 3 everywhere
const distToLoop = (p, loop) => {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
};
console.log('triangle cap inset (want 3.0 at every cap vertex):');
cap2.forEach((p) => console.log(`   (${f4(p[0])},${f4(p[1])})  inset=${f4(distToLoop(p, TRI))}`));

console.log('\n### 4. chamfer with a sharp corner — does it stay a 45-degree plane?\n');
const m3 = build(b2, k2.map((k) => ({ type: 'chamfer', key: k, r: 3 }))).m;
const cap3 = V(m3).filter((p) => Math.abs(p[2] - 20) < 1e-6);
console.log('triangle chamfer cap inset (want 3.0):');
cap3.forEach((p) => console.log(`   (${f4(p[0])},${f4(p[1])})  inset=${f4(distToLoop(p, TRI))}`));
