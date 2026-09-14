// Regression suite for the rewritten edge-blend kernel, using CORRECT oracles.
//
// Oracle for a swept edge blend of radius r on an extruded prism:
//   Along a straight run the blend surface is a cylinder (fillet) or a plane
//   (chamfer) built on the supporting line offset inward by r at z = zt - r.
//   Where two blended runs meet, those surfaces INTERSECT; the corner curve is
//   the mitre, and a mitre point lies exactly on BOTH surfaces. So the
//   invariant is "distance to the nearest run axis == r", NOT "distance to a
//   sphere centred on a spine point == r".
const path = require('path');
const { load } = require('./harness');
const { sandbox, loadErrors } = load(process.env.APP || path.join(__dirname, '..', 'app', 'index.html'));
if (loadErrors.length) { console.error('LOAD ERRORS', loadErrors); process.exit(1); }
const A = sandbox.__app;
const f4 = (x) => (!isFinite(x) ? String(x) : (Math.abs(x) < 5e-7 ? 0 : x).toFixed(4));

let pass = 0, fail = 0;
function T(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
  if (detail) detail.split('\n').forEach((l) => console.log('        ' + l));
}

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
const zl = (m) => [...new Set(V(m).map((p) => +p[2].toFixed(4)))].sort((a, b) => a - b);
const keysOf = (b, re) => build(b, []).m.brep.edges.map((e) => e.key).filter((k) => re.test(k));
function distToLoop(p, loop) { let best = Infinity;
  for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))); }
  return best; }
// inward offset of a convex CCW polygon by r (for the run axes)
function insetPoly(loop, r) {
  const n = loop.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n], q = loop[i], s = loop[(i + 1) % n];
    const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [s[0] - q[0], s[1] - q[1]];
    const l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1;
    const n1 = [-d1[1] / l1, d1[0] / l1], n2 = [-d2[1] / l2, d2[0] / l2]; // left normal = inward for CCW
    const a1 = [p[0] + n1[0] * r, p[1] + n1[1] * r], a2 = [q[0] + n2[0] * r, q[1] + n2[1] * r];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) { out.push(a2); continue; }
    const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
    out.push([a1[0] + d1[0] * t, a1[1] + d1[1] * t]);
  }
  return out;
}

const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const H = 20;
const bs = mkBody(SQ, H, 'R1');
const topK = keysOf(bs, /^top:/), botK = keysOf(bs, /^bot:/), sideK = keysOf(bs, /^side:/);

console.log('\n--- 1. blend surface accuracy (mitre oracle) ---\n');
for (const r of [2, 5, 8]) for (const type of ['chamfer', 'fillet']) {
  const { m, e } = build(bs, topK.map((k) => ({ type, key: k, r })));
  if (e) { T(`${type} r=${r}`, false, 'build threw ' + e); continue; }
  const axis = insetPoly(SQ, r);
  let worst = 0;
  V(m).filter((p) => p[2] > H - r + 1e-9).forEach((p) => {
    const t = p[2] - (H - r);
    // nearest supporting line of the offset polygon
    let best = Infinity;
    for (let i = 0; i < axis.length; i++) {
      const a = axis[i], b2 = axis[(i + 1) % axis.length];
      const dx = b2[0] - a[0], dy = b2[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const perp = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
      best = Math.min(best, type === 'fillet' ? Math.hypot(perp, t) : perp + t);
    }
    worst = Math.max(worst, Math.abs(best - r));
  });
  T(`${type} r=${r} surface`, worst < 1e-6, `max |surface - r| = ${f4(worst)}`);
}

console.log('\n--- 2. per-edge radius independence ---\n');
{
  const { m } = build(bs, [{ type: 'chamfer', key: topK[0], r: 2 },
    { type: 'chamfer', key: topK[1], r: 8 }]);
  const z = zl(m);
  T('two chamfers r=2 and r=8 coexist', z.includes(18) && z.includes(12),
    `zLevels ${z.join(',')} (want 18 and 12)`);
}
{
  const { m } = build(bs, [{ type: 'fillet', key: topK[0], r: 6 },
    { type: 'chamfer', key: topK[2], r: 3 }]);
  const z = zl(m);
  T('fillet r=6 + chamfer r=3 coexist', z.includes(17) && z.length > 5,
    `zLevels=${z.length}, has 17 (=20-3 chamfer): ${z.includes(17)}, min=${f4(z[1])} (want 14 = 20-6)`);
}

console.log('\n--- 3. clamping is monotone and safe ---\n');
{
  let prev = Infinity, mono = true, safe = true;
  const rows = [];
  for (const r of [2, 5, 9.9, 10, 12, 18, 25, 100]) {
    const { m, e } = build(bs, topK.map((k) => ({ type: 'chamfer', key: k, r })));
    if (e) { safe = false; rows.push(`r=${r} ERROR`); continue; }
    const v = V(m);
    if (v.some((p) => p.some((c) => !isFinite(c)))) safe = false;
    if (v.some((p) => Math.abs(p[0]) > 20 + 1e-6 || Math.abs(p[1]) > 20 + 1e-6 ||
      p[2] < -1e-6 || p[2] > H + 1e-6)) safe = false;
    const cap = v.filter((p) => Math.abs(p[2] - H) < 1e-6);
    const cr = cap.length ? Math.max(...cap.map((p) => Math.hypot(p[0], p[1]))) : 0;
    if (cr > prev + 1e-6) mono = false;
    prev = cr; rows.push(`r=${String(r).padEnd(5)} capMaxR=${f4(cr)}`);
  }
  T('over-size radius clamps monotonically, no NaN / no out-of-bounds', mono && safe, rows.join('\n'));
}

console.log('\n--- 4. top-only blend may use the full height ---\n');
{
  const { m } = build(bs, topK.map((k) => ({ type: 'chamfer', key: k, r: 15 })));
  T('chamfer r=15 on a 20-tall prism reaches z=5', zl(m).includes(5), `zLevels ${zl(m).join(',')}`);
}

console.log('\n--- 5. top + bottom on the same edge share the height ---\n');
{
  const { m, e } = build(bs, [...topK.map((k) => ({ type: 'chamfer', key: k, r: 14 })),
    ...botK.map((k) => ({ type: 'chamfer', key: k, r: 14 }))]);
  if (e) T('top+bottom oversize', false, e);
  else {
    const v = V(m);
    const bad = v.filter((p) => p[2] < -1e-6 || p[2] > H + 1e-6).length;
    T('top+bottom r=14 each on a 20-tall prism stays inside the height', bad === 0,
      `zLevels ${zl(m).join(',')}  outOfRange=${bad}`);
  }
}

console.log('\n--- 6. bottom mirrors top ---\n');
for (const type of ['chamfer', 'fillet']) {
  const a = build(bs, topK.map((k) => ({ type, key: k, r: 4 }))).m;
  const b2 = build(bs, botK.map((k) => ({ type, key: k, r: 4 }))).m;
  const za = zl(a).map((z) => +(H - z).toFixed(4)).sort((x, y) => x - y);
  const zb2 = zl(b2).sort((x, y) => x - y);
  T(`${type} bottom is the mirror of top`,
    JSON.stringify(za) === JSON.stringify(zb2), `top(mirrored)=${za.join(',')}\nbottom=${zb2.join(',')}`);
}

console.log('\n--- 7. concave (reflex) corner ---\n');
{
  const LSH = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 40], [0, 40]];
  const bl = mkBody(LSH, 20, 'R2');
  const kl = keysOf(bl, /^top:/);
  for (const type of ['chamfer', 'fillet']) {
    const { m, e } = build(bl, kl.map((k) => ({ type, key: k, r: 4 })));
    if (e) { T(`L-shape ${type}`, false, e); continue; }
    const cap = V(m).filter((p) => Math.abs(p[2] - 20) < 1e-6);
    const ins = cap.map((p) => distToLoop(p, LSH));
    // at a reflex corner the inset vertex is farther than r from the boundary
    // (that is correct); every cap vertex must be at least r away.
    const ok = cap.length > 0 && Math.min(...ins) > 4 - 1e-6;
    T(`L-shape ${type} r=4 keeps the cap at least r inside`, ok,
      `inset range [${f4(Math.min(...ins))}, ${f4(Math.max(...ins))}] (min must be >= 4)`);
  }
}

console.log('\n--- 8. non-90 corner (triangle) ---\n');
{
  const TRI = [[-20, -12], [20, -12], [0, 20]];
  const bt = mkBody(TRI, 20, 'R3');
  const kt = keysOf(bt, /^top:/);
  for (const type of ['chamfer', 'fillet']) {
    const r = 3;
    const { m, e } = build(bt, kt.map((k) => ({ type, key: k, r })));
    if (e) { T(`triangle ${type}`, false, e); continue; }
    const axis = insetPoly(TRI, r);
    let worst = 0;
    V(m).filter((p) => p[2] > 20 - r + 1e-9).forEach((p) => {
      const t = p[2] - (20 - r);
      let best = Infinity;
      for (let i = 0; i < axis.length; i++) {
        const a = axis[i], b2 = axis[(i + 1) % axis.length];
        const dx = b2[0] - a[0], dy = b2[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const perp = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
        best = Math.min(best, type === 'fillet' ? Math.hypot(perp, t) : perp + t);
      }
      worst = Math.max(worst, Math.abs(best - r));
    });
    T(`triangle ${type} r=${r} surface`, worst < 1e-6, `max |surface - r| = ${f4(worst)}`);
  }
}

console.log('\n--- 9. vertical edge + combined ---\n');
{
  const { m, e } = build(bs, [{ type: 'chamfer', key: sideK[0], r: 5 }]);
  if (e) T('vertical chamfer', false, e);
  else {
    const cap = V(m).filter((p) => Math.abs(p[2] - H) < 1e-6);
    const set = cap.filter((p) => p[0] < -10 && p[1] < -10)
      .map((p) => Math.hypot(p[0] + 20, p[1] + 20)).sort((a, b) => a - b);
    T('vertical chamfer r=5 sets back 5 along both edges',
      set.length >= 2 && Math.abs(set[set.length - 1] - 5) < 1e-6 && Math.abs(set[0] - 5) < 1e-6,
      `setbacks ${set.map(f4).join(' ')} (want 5 and 5)`);
  }
}
for (const type of ['chamfer', 'fillet']) {
  const { m, e } = build(bs, [...topK.map((k) => ({ type, key: k, r: 4 })),
    { type, key: sideK[0], r: 4 }]);
  if (e) { T(`top+side ${type}`, false, e); continue; }
  const v = V(m);
  const bad = v.filter((p) => p.some((c) => !isFinite(c)) ||
    Math.abs(p[0]) > 20 + 1e-6 || Math.abs(p[1]) > 20 + 1e-6).length;
  T(`top + vertical ${type} r=4 together`, bad === 0, `verts=${v.length} bad=${bad}`);
}

console.log('\n--- 10. zero / no-op edits ---\n');
{
  const b0 = zl(build(bs, []).m);
  const { m, e } = build(bs, topK.map((k) => ({ type: 'fillet', key: k, r: 0 })));
  T('r=0 is a no-op (no degenerate geometry)', !e && JSON.stringify(zl(m)) === JSON.stringify(b0),
    `base=${b0.join(',')}  r0=${e || zl(m).join(',')}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
