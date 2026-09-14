// Second diagnostic pass: concave corners, non-90 corners, oversize clamping,
// and the vertical-edge path (loopApplySideEdits).
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
const keysOf = (b, re) => build(b, []).m.brep.edges.map((e) => e.key).filter((k) => re.test(k));

// ---------------------------------------------------------------------------
console.log('### A. CONCAVE corner (L-shape). The rolling ball must stay INSIDE,');
console.log('###    and the cap inset must still be exactly r everywhere.\n');
const LSH = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 40], [0, 40]]; // reflex at (15,15)
const bl = mkBody(LSH, 20, 'L1');
const kl = keysOf(bl, /^top:/);
for (const type of ['chamfer', 'fillet']) {
  const r = 4;
  const { m, e } = build(bl, kl.map((k) => ({ type, key: k, r })));
  if (e) { console.log(`  ${type}: BUILD ERROR ${e}`); continue; }
  const cap = V(m).filter((p) => Math.abs(p[2] - 20) < 1e-6);
  const dist = (p) => { let best = Infinity;
    for (let i = 0; i < LSH.length; i++) { const a = LSH[i], b2 = LSH[(i + 1) % LSH.length];
      const dx = b2[0] - a[0], dy = b2[1] - a[1], L2 = dx * dx + dy * dy || 1;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))); }
    return best; };
  const ins = cap.map(dist);
  console.log(`  ${type} r=${r}: cap pts=${cap.length} inset range [${f4(Math.min(...ins))}, ${f4(Math.max(...ins))}] want ${r}`);
  cap.forEach((p) => console.log(`      (${f4(p[0])},${f4(p[1])}) inset=${f4(dist(p))}`));
}

// ---------------------------------------------------------------------------
console.log('\n### B. NON-90 corner: intermediate fillet rings (not just the cap).');
console.log('###    True rolling ball => every blend point is r from the spine point.\n');
const TRI = [[-20, -12], [20, -12], [0, 20]];
const bt = mkBody(TRI, 20, 'T9');
const kt = keysOf(bt, /^top:/);
{
  const r = 3;
  const m = build(bt, kt.map((k) => ({ type: 'fillet', key: k, r }))).m;
  // apex spine point = incenter-direction offset of the apex by r
  const apex = [0, 20];
  const e1 = [(-20) - 0, (-12) - 20], e2 = [20 - 0, (-12) - 20];
  const n1 = Math.hypot(...e1), n2 = Math.hypot(...e2);
  const bis = [e1[0] / n1 + e2[0] / n2, e1[1] / n1 + e2[1] / n2];
  const bn = Math.hypot(...bis);
  const cosH = (e1[0] * e2[0] + e1[1] * e2[1]) / (n1 * n2);
  const half = Math.acos(Math.max(-1, Math.min(1, cosH))) / 2;
  const spine = [apex[0] + bis[0] / bn * (r / Math.sin(half)),
    apex[1] + bis[1] / bn * (r / Math.sin(half)), 20 - r];
  console.log(`  apex spine point = (${f4(spine[0])},${f4(spine[1])},${f4(spine[2])})`);
  const near = V(m).filter((p) => p[2] > 20 - r - 1e-6 && p[1] > 10);
  near.sort((a, b) => a[2] - b[2]);
  near.slice(0, 16).forEach((p) => {
    const d = Math.hypot(p[0] - spine[0], p[1] - spine[1], p[2] - spine[2]);
    console.log(`      (${f4(p[0])},${f4(p[1])},${f4(p[2])})  |p-spine|=${f4(d)}  err=${f4(d - r)}`);
  });
}

// ---------------------------------------------------------------------------
console.log('\n### C. OVERSIZE clamping on the square: r >> height and r >> width.\n');
const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const bs = mkBody(SQ, 20, 'S9');
const ks = keysOf(bs, /^top:/);
for (const r of [9.9, 10, 12, 25, 100]) {
  for (const type of ['fillet', 'chamfer']) {
    const { m, e } = build(bs, ks.map((k) => ({ type, key: k, r })));
    if (e) { console.log(`  ${type} r=${r}: ERROR ${e}`); continue; }
    const v = V(m);
    const zs = v.map((p) => p[2]);
    const nan = v.filter((p) => p.some((c) => !isFinite(c))).length;
    const oob = v.filter((p) => Math.abs(p[0]) > 20 + 1e-6 || Math.abs(p[1]) > 20 + 1e-6 ||
      p[2] < -1e-6 || p[2] > 20 + 1e-6).length;
    // does the cap degenerate / invert?
    const cap = v.filter((p) => Math.abs(p[2] - 20) < 1e-6);
    const capR = cap.length ? Math.max(...cap.map((p) => Math.hypot(p[0], p[1]))) : 0;
    console.log(`  ${type} r=${String(r).padEnd(5)} verts=${String(v.length).padStart(4)} ` +
      `z=[${f4(Math.min(...zs))},${f4(Math.max(...zs))}] capMaxR=${f4(capR)} NaN=${nan} outOfBounds=${oob}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n### D. VERTICAL edge treatment via loopApplySideEdits.\n');
const kside = keysOf(bs, /^side:/);
console.log('  side keys:', kside.join(' '));
for (const type of ['fillet', 'chamfer']) {
  for (const r of [3, 15, 30]) {
    const { m, e } = build(bs, [{ type, key: kside[0], r }]);
    if (e) { console.log(`  ${type} r=${r}: ERROR ${e}`); continue; }
    const v = V(m);
    const capPts = v.filter((p) => Math.abs(p[2] - 20) < 1e-6);
    // the treated corner is (-20,-20); measure how far the cap pulls back
    const near = capPts.filter((p) => p[0] < 0 && p[1] < 0)
      .map((p) => Math.hypot(p[0] + 20, p[1] + 20)).sort((a, b) => a - b);
    console.log(`  ${type} r=${String(r).padEnd(3)} verts=${String(v.length).padStart(4)} ` +
      `setbacks from treated corner: ${near.slice(0, 4).map(f4).join(' ')}` +
      `   (want ~${type === 'chamfer' ? r : f4(r * Math.SQRT2 - r * (Math.SQRT2 - 1))})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n### E. TOP + SIDE treatment together (the classic CAD case).\n');
for (const type of ['fillet', 'chamfer']) {
  const r = 4;
  const edits = [...ks.map((k) => ({ type, key: k, r })), { type, key: kside[0], r }];
  const { m, e } = build(bs, edits);
  if (e) { console.log(`  ${type}: ERROR ${e}`); continue; }
  const v = V(m);
  const nan = v.filter((p) => p.some((c) => !isFinite(c))).length;
  const oob = v.filter((p) => Math.abs(p[0]) > 20 + 1e-6 || Math.abs(p[1]) > 20 + 1e-6).length;
  console.log(`  ${type} r=${r}: verts=${v.length} NaN=${nan} outsideFootprint=${oob}`);
}
