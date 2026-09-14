// Third pass: per-edge radius/type independence, and mixed fillet+chamfer.
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
const b = mkBody(SQ, 20, 'P1');
const keys = build(b, []).m.brep.edges.map((e) => e.key).filter((k) => /^top:/.test(k));
console.log('top keys:', keys.join(' '), '\n');

// Which physical side does each top:N key correspond to? Inspect via single-edge blend.
console.log('### F. Per-edge INDEPENDENCE: blend only ONE top edge with r=6.');
console.log('###    Only that edge should move; the other three stay sharp at z=20.\n');
for (const k of keys) {
  const { m, e } = build(b, [{ type: 'chamfer', key: k, r: 6 }]);
  if (e) { console.log(`  ${k}: ERROR ${e}`); continue; }
  const v = V(m);
  const zs = [...new Set(v.map((p) => +p[2].toFixed(4)))].sort((x, y) => x - y);
  const cap = v.filter((p) => Math.abs(p[2] - 20) < 1e-6);
  console.log(`  ${k}: zLevels=${zs.join(',')}  capPts=` +
    cap.map((p) => `(${f4(p[0])},${f4(p[1])})`).join(' '));
}

console.log('\n### G. Per-edge RADIUS: two top edges with DIFFERENT radii (2 and 8).');
console.log('###    A correct kernel honours both; a broken one applies one value to both.\n');
{
  const edits = [{ type: 'chamfer', key: keys[0], r: 2 }, { type: 'chamfer', key: keys[1], r: 8 }];
  const { m, e } = build(b, edits);
  if (e) console.log('  ERROR', e);
  else {
    const v = V(m);
    const zs = [...new Set(v.map((p) => +p[2].toFixed(4)))].sort((x, y) => x - y);
    console.log('  zLevels:', zs.join(','), ' (expect BOTH 12 and 18 present)');
    console.log('  cap pts:', v.filter((p) => Math.abs(p[2] - 20) < 1e-6)
      .map((p) => `(${f4(p[0])},${f4(p[1])})`).join(' '));
  }
}

console.log('\n### H. MIXED type: one top edge filleted, another chamfered.');
console.log('###    A correct kernel honours both; a broken one collapses to one type.\n');
{
  const edits = [{ type: 'fillet', key: keys[0], r: 5 }, { type: 'chamfer', key: keys[1], r: 5 }];
  const { m, e } = build(b, edits);
  if (e) console.log('  ERROR', e);
  else {
    const v = V(m);
    const zs = [...new Set(v.map((p) => +p[2].toFixed(4)))].sort((x, y) => x - y);
    console.log('  zLevels count:', zs.length,
      '\n  (a fillet contributes ~13 levels, a chamfer 2; a correct mix shows the fillet arc AND a flat chamfer)');
    console.log('  zLevels:', zs.map((z) => f4(z)).join(','));
  }
}

console.log('\n### I. BOTTOM edge blend — must mirror the top exactly.\n');
{
  const bk = build(b, []).m.brep.edges.map((e) => e.key).filter((k) => /^bot:/.test(k));
  for (const type of ['chamfer', 'fillet']) {
    const { m, e } = build(b, bk.map((k) => ({ type, key: k, r: 4 })));
    if (e) { console.log(`  ${type}: ERROR ${e}`); continue; }
    const v = V(m);
    const bot = v.filter((p) => Math.abs(p[2]) < 1e-6);
    const ins = bot.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])));
    console.log(`  ${type} r=4: bottom face half-extent ` +
      `[${f4(Math.min(...ins))},${f4(Math.max(...ins))}] want 16 (=20-4)`);
  }
}
