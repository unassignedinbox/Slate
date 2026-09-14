// Measure SolidArc's edge fillet/chamfer against analytic ground truth.
//
// Ground truth for an extruded prism of height H whose TOP edge loop is treated
// with size r. Let d(p) = inward distance of p from the original profile
// (0 on the wall), and t = p.z - (H - r) in [0, r].
//
//   chamfer : the blend is the plane through the wall line at z=H-r and the
//             cap line inset by r at z=H.   =>   d(p) == t   for all blend pts.
//   fillet  : rolling ball of radius r. The ball centre locus ("spine") is the
//             inward offset of the profile by r, at height H-r. Every point of
//             the blend is exactly r from that spine.
//             => |dist3D(p, spine) - r| == 0.
//             At a convex corner the spine is a point, so the correct surface
//             there is a SPHERICAL patch, not a mitred sweep.
const path = require('path');
const { load } = require('./harness');

const APP = process.env.APP || path.join(__dirname, '..', 'app', 'index.html');
const { sandbox, loadErrors } = load(APP);
if (loadErrors.length) { console.error('LOAD ERRORS', loadErrors); process.exit(1); }
const A = sandbox.__app;

const fmt = (x, n = 4) => (!isFinite(x) ? String(x) : (Math.abs(x) < 5e-7 ? 0 : x).toFixed(n));

function makeSketchBody(pts, height, name) {
  const doc = A.doc;
  const sk = A.mk('sketch', name + 'Sk', { size: 200 }, { children: [] });
  doc.figures.push(sk);
  const cv = A.mk('curve', name + 'Poly', { pts, closed: true, bulge: pts.map(() => 0) },
    { ctype: 'poly', parent: sk.id });
  doc.figures.push(cv);
  sk.children = [cv.id];
  const body = A.mk('body', name, { height, draft: 0, base: 0, sym: false },
    { op: 'extrude', src: sk.id, profile: cv.id });
  doc.figures.push(body);
  return body;
}

function buildWith(body, edits) {
  const saved = body.edits;
  body.edits = edits;
  let m = null, err = null;
  try { m = A.solidBuild(body); } catch (e) { err = String((e && e.message) || e); }
  body.edits = saved;
  A.meshCache.clear(); A.topoCache.clear();
  return { m, err };
}

function verts(m) {
  const out = [];
  (m.tris || []).forEach((t) => t.forEach((p) => out.push(p)));
  (m.quads || []).forEach((q) => q.p.forEach((p) => out.push(p)));
  // dedupe
  const seen = new Set(), u = [];
  out.forEach((p) => {
    const k = p.map((v) => v.toFixed(5)).join(',');
    if (!seen.has(k)) { seen.add(k); u.push(p); }
  });
  return u;
}
const zsOf = (m) => [...new Set(verts(m).map((p) => +p[2].toFixed(5)))].sort((a, b) => a - b);

function distToLoop(p, loop) {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  detail.split('\n').forEach((l) => console.log('        ' + l));
}

const SQ = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
const H = 20;
const HALF = 20;

console.log('=== square prism 40x40x20 — TOP edge treatment ===\n');
const body = makeSketchBody(SQ, H, 'T1');
const base = buildWith(body, []);
if (base.err) { console.log('base build error', base.err); process.exit(1); }
const baseKeys = base.m.brep.edges.map((e) => e.key);
console.log('edge keys :', baseKeys.join(' '));
console.log('face keys :', base.m.brep.faces.map((f) => f.key + '#' + f.kind).join(' '));
console.log('');

const topKeys = baseKeys.filter((k) => /^top:/.test(k));
const sideKeys = baseKeys.filter((k) => /^side:/.test(k));

// classify a blend point as "flat run" or "corner" region of the square
const isCornerRegion = (p, r) => {
  const ax = Math.abs(p[0]), ay = Math.abs(p[1]);
  return ax > HALF - r - 1e-6 && ay > HALF - r - 1e-6;
};

for (const r of [2, 5]) {
  for (const type of ['chamfer', 'fillet']) {
    const tag = `${type} r=${r}`;
    const { m, err } = buildWith(body, topKeys.map((k) => ({ type, key: k, r })));
    if (err) { check(tag, false, 'build threw: ' + err); continue; }

    const V = verts(m);
    const zt = Math.max(...V.map((p) => p[2]));
    const okCapZ = Math.abs(zt - H) < 1e-6;

    const capPts = V.filter((p) => Math.abs(p[2] - H) < 1e-6);
    const capIns = capPts.map((p) => distToLoop(p, SQ));
    const okInset = capIns.length &&
      Math.abs(Math.min(...capIns) - r) < 1e-3 && Math.abs(Math.max(...capIns) - r) < 1e-3;

    // blend band: strictly between the wall top and the cap
    const band = V.filter((p) => p[2] > H - r - 1e-6 && p[2] <= H + 1e-6);
    const outside = V.filter((p) => Math.abs(p[0]) > HALF + 1e-6 || Math.abs(p[1]) > HALF + 1e-6);

    let devFlat = 0, devCorner = 0, nF = 0, nC = 0;
    const spine = SQ.map(([x, y]) => [x - Math.sign(x) * r, y - Math.sign(y) * r]);
    band.forEach((p) => {
      const t = p[2] - (H - r);
      let dev;
      // Correct oracle: the blend surface of a straight run is a cylinder of
      // radius r about the inward-offset axis at z=H-r. At a corner the two
      // cylinders intersect and the mitre point lies on BOTH, so the invariant
      // is: distance to the NEAREST run axis == r. (A sphere is NOT the
      // correct corner surface for a swept edge blend - verified analytically.)
      if (type === 'chamfer') {
        dev = Math.abs(distToLoop(p, SQ) - t);
      } else {
        const axes = [
          [Math.abs(p[1] - (-(HALF - r))), 0], [Math.abs(p[0] - (HALF - r)), 0],
          [Math.abs(p[1] - (HALF - r)), 0], [Math.abs(p[0] - (-(HALF - r))), 0]];
        const best = Math.min(...axes.map((a) => Math.hypot(a[0], t)));
        dev = Math.abs(best - r);
      }
      if (isCornerRegion(p, r)) { devCorner = Math.max(devCorner, dev); nC++; }
      else { devFlat = Math.max(devFlat, dev); nF++; }
    });

    const tol = 1e-3;
    const ok = okCapZ && okInset && outside.length === 0 && devFlat < tol && devCorner < tol;
    check(tag, ok,
      `capZ=${fmt(zt)} want ${H}   capInset=[${fmt(Math.min(...capIns))},${fmt(Math.max(...capIns))}] want ${r}\n` +
      `blendPts flat=${nF} corner=${nC}   outsideFootprint=${outside.length}\n` +
      `maxDev  flatRun=${fmt(devFlat)}   CORNER=${fmt(devCorner)}   (want 0)`);
  }
}

console.log('\n=== vertical (side) edge treatment ===\n');
for (const type of ['chamfer', 'fillet']) {
  const r = 3, key = sideKeys[0];
  const { m, err } = buildWith(body, [{ type, key, r }]);
  const tag = `${type} r=${r} on ${key}`;
  if (err) { check(tag, false, 'build threw: ' + err); continue; }
  const V = verts(m);
  const outside = V.filter((p) => Math.abs(p[0]) > HALF + 1e-6 || Math.abs(p[1]) > HALF + 1e-6);
  check(tag, outside.length === 0, `verts=${V.length} outsideFootprint=${outside.length}`);
}

console.log('\n=== clamping: r larger than the feature ===\n');
for (const type of ['chamfer', 'fillet']) {
  const r = 40; // way bigger than the 20mm height and 40mm width
  const { m, err } = buildWith(body, topKeys.map((k) => ({ type, key: k, r })));
  const tag = `${type} r=${r} (over-size, must clamp not explode)`;
  if (err) { check(tag, false, 'build threw: ' + err); continue; }
  const V = verts(m);
  const bad = V.filter((p) => Math.abs(p[0]) > HALF + 1e-6 || Math.abs(p[1]) > HALF + 1e-6 ||
    p[2] < -1e-6 || p[2] > H + 1e-6 || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2]));
  check(tag, bad.length === 0, `verts=${V.length} outOfBounds/NaN=${bad.length}`);
}

console.log('\n=== summary ===');
const bad = results.filter((x) => !x.ok);
console.log(`${results.length - bad.length}/${results.length} passed`);
bad.forEach((b) => console.log('  FAILED: ' + b.name));
if (bad.length) process.exitCode = 1;
