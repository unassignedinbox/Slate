// Render an SVG wireframe/shaded proof of the blend kernel for visual review.
const fs = require('fs');
const path = require('path');
const { load } = require('./harness');
const A = load(process.env.APP || path.join(__dirname, '..', 'app', 'index.html')).sandbox.__app;

function mkBody(pts, h, name) {
  const sk = A.mk('sketch', name + 'S', {}, { children: [] }); A.doc.figures.push(sk);
  const cv = A.mk('curve', name + 'P', { pts, closed: true, bulge: pts.map(() => 0) },
    { ctype: 'poly', parent: sk.id }); A.doc.figures.push(cv); sk.children = [cv.id];
  const b = A.mk('body', name, { height: h, draft: 0, base: 0 },
    { op: 'extrude', src: sk.id, profile: cv.id }); A.doc.figures.push(b); return b;
}
function build(b, edits) {
  const s = b.edits; b.edits = edits; let m = null;
  try { m = A.solidBuild(b); } catch (e) { console.error('build failed', e.message); }
  b.edits = s; A.meshCache.clear(); A.topoCache.clear(); return m;
}

// isometric projection
const AZ = Math.PI / 4, EL = Math.PI / 6;
function proj(p) {
  const x = p[0] * Math.cos(AZ) - p[1] * Math.sin(AZ);
  const y = p[0] * Math.sin(AZ) + p[1] * Math.cos(AZ);
  return [x, -(p[2] * Math.cos(EL) - y * Math.sin(EL))];
}
const nrm = (t) => {
  const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
  const v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1; return n.map((c) => c / l);
};
const depth = (t) => t.reduce((a, p) => a + p[0] + p[1] + p[2], 0) / 3;

function panel(m, title, ox, oy, scale) {
  const tris = (m.tris || []).slice().sort((a, b) => depth(a) - depth(b));
  const L = [0.42, 0.42, 0.82];
  let s = `<text x="${ox - 150}" y="${oy - 105}" font-family="monospace" font-size="13" fill="#cfd6e4">${title}</text>`;
  tris.forEach((t) => {
    const n = nrm(t);
    const d = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    const c = Math.round(45 + 175 * d);
    const pts = t.map((p) => { const q = proj(p); return `${ox + q[0] * scale},${oy + q[1] * scale}`; }).join(' ');
    s += `<polygon points="${pts}" fill="rgb(${Math.round(c * .72)},${Math.round(c * .8)},${c})" stroke="rgba(10,14,22,.35)" stroke-width="0.4"/>`;
  });
  (m.lines || []).forEach((l) => {
    if (l.tangent) return;
    const a = proj(l[0]), b = proj(l[1]);
    s += `<line x1="${ox + a[0] * scale}" y1="${oy + a[1] * scale}" x2="${ox + b[0] * scale}" y2="${oy + b[1] * scale}" stroke="#0b1018" stroke-width="1.1" stroke-linecap="round"/>`;
  });
  return s;
}

const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const b = mkBody(SQ, 20, 'RV');
const keys = build(b, []).brep.edges.map((e) => e.key);
const top = keys.filter((k) => /^top:/.test(k));
const side = keys.filter((k) => /^side:/.test(k));

const cases = [
  ['no blend', []],
  ['chamfer 4 (all top)', top.map((k) => ({ type: 'chamfer', key: k, r: 4 }))],
  ['fillet 4 (all top)', top.map((k) => ({ type: 'fillet', key: k, r: 4 }))],
  ['chamfer 2 + chamfer 8', [{ type: 'chamfer', key: top[0], r: 2 }, { type: 'chamfer', key: top[1], r: 8 }]],
  ['fillet 6 + chamfer 3', [{ type: 'fillet', key: top[0], r: 6 }, { type: 'chamfer', key: top[2], r: 3 }]],
  ['top fillet 4 + vert fillet 5', [...top.map((k) => ({ type: 'fillet', key: k, r: 4 })), { type: 'fillet', key: side[0], r: 5 }]],
];

const W = 360, Hh = 300, COLS = 3, SC = 4.2;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * COLS}" height="${Hh * Math.ceil(cases.length / COLS)}" viewBox="0 0 ${W * COLS} ${Hh * Math.ceil(cases.length / COLS)}">`;
svg += `<rect width="100%" height="100%" fill="#11151d"/>`;
cases.forEach(([title, edits], i) => {
  const m = build(b, edits);
  const ox = (i % COLS) * W + W / 2, oy = Math.floor(i / COLS) * Hh + Hh / 2 + 20;
  svg += panel(m, title, ox, oy, SC);
});
svg += '</svg>';
const out = path.join(__dirname, '..', 'docs', 'blend-proof.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log('wrote', out);
