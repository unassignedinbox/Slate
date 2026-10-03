/* =====================================================================================================================
   Offline checks for the quad tread builder inside References/TyreGenerator.html.

   The page needs three.js and clipper-lib from a CDN, neither of which is reachable here, so this harness lifts the
   geometry functions out of the page by name and runs them against tiny stand-ins:
     · THREE      — only Vector2 / ShapeUtils.triangulateShape / BufferGeometry are touched by this code path.
     · ClipperLib — replaced by the dependency-free rectangle clipper already exported from the tread core, which is
                    enough for the convex test regions used below.
   Run:  node Scratchpad/TyreGeneratorChecks/check-geometry.mjs
   ===================================================================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../References/TyreGenerator.html'), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  pass  ${label}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
};
const section = t => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

// ------------------------------------------------------------------ load the dependency-free tread core
const coreMatch = html.match(/<script id="tread-core">([\s\S]*?)<\/script>/);
if (!coreMatch) { console.error('tread-core script block not found'); process.exit(1); }
const sandbox = { console, Math, Set, Map, JSON, Array, Object, Number, structuredClone };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(coreMatch[1], sandbox, { filename: 'tread-core.js' });
const ST = sandbox.SlateTread;

// ------------------------------------------------------------------ lift named functions out of the page module
const moduleSrc = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
function lift(name) {
  const start = moduleSrc.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in the page module`);
  const end = moduleSrc.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`end of ${name} not found`);
  return moduleSrc.slice(start + 1, end + 3);
}

// ------------------------------------------------------------------ stand-ins for the CDN libraries
const THREE = {
  Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  ShapeUtils: {
    // three.js' earcut takes holes directly; here each hole is bridged into the outline first and the result is
    // ear-clipped, which is enough for the small clipped cells quadrangulate hands over.
    triangulateShape(contour, holes) {
      const outer = contour.map(p => [p.x, p.y]);
      if (!holes.length) return ST.earClip(outer);
      let ring = outer.slice(), map = outer.map((_, i) => i), base = outer.length;
      for (const hole of holes) {
        const hp = hole.map(p => [p.x, p.y]);
        let hi = 0;
        for (let i = 1; i < hp.length; i++) if (hp[i][0] > hp[hi][0]) hi = i;
        let oi = 0, best = Infinity;
        for (let i = 0; i < ring.length; i++) {
          const dist = Math.hypot(ring[i][0] - hp[hi][0], ring[i][1] - hp[hi][1]);
          if (dist < best) { best = dist; oi = i; }
        }
        const nextRing = [], nextMap = [];
        const push = (pt, idx) => { nextRing.push(pt); nextMap.push(idx); };
        for (let i = 0; i <= oi; i++) push(ring[i], map[i]);
        for (let k = 0; k < hp.length; k++) { const j = (hi + k) % hp.length; push(hp[j], base + j); }
        push(hp[hi], base + hi);
        for (let i = oi; i < ring.length; i++) push(ring[i], map[i]);
        ring = nextRing; map = nextMap; base += hp.length;
      }
      return ST.earClip(ring).map(t => t.map(i => map[i]));
    }
  },
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.userData = {}; }
    setAttribute(k, v) { this.attributes[k] = v; return this; }
    setIndex(i) { this.index = { count: i.length, array: i }; return this; }
    computeBoundingSphere() { }
  },
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = a.length / n; } }
};
const toPath = ring => ring.map(p => [p[0], p[1]]);
const orient = path => path;
const rectPath = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// Stand-in for Clipper's intersection. Every ring in this fixture is an axis-aligned rectangle, so the clip can
// be computed exactly by splitting on the edge coordinates and keeping the sub-rectangles that survive. Positive
// rings add, negative rings subtract, which is what Clipper's non-zero fill does with an outline plus its holes.
const bbox = ring => [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
  Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
const inter = (subject, clip) => {
  const c = bbox(clip[0]);
  const parts = subject.map(ring => ({ rect: bbox(ring), add: ST.ringArea(ring) > 0 }));
  const xs = new Set([c[0], c[2]]), ys = new Set([c[1], c[3]]);
  for (const part of parts) {
    for (const v of [part.rect[0], part.rect[2]]) if (v > c[0] && v < c[2]) xs.add(v);
    for (const v of [part.rect[1], part.rect[3]]) if (v > c[1] && v < c[3]) ys.add(v);
  }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b), out = [];
  for (let i = 0; i < X.length - 1; i++) for (let j = 0; j < Y.length - 1; j++) {
    const mx = (X[i] + X[i + 1]) / 2, my = (Y[j] + Y[j + 1]) / 2;
    let inside = false;
    for (const part of parts) {
      const r = part.rect;
      if (mx > r[0] && mx < r[2] && my > r[1] && my < r[3]) inside = part.add;
    }
    if (inside) out.push([[X[i], Y[j]], [X[i + 1], Y[j]], [X[i + 1], Y[j + 1]], [X[i], Y[j + 1]]]);
  }
  return out;
};
const exPolygons = paths => paths.filter(r => r.length >= 3).map(outer => ({ outer, holes: [] }));

// Two concentric rectangles: an outer tread floor at depth 0 and a rectangular groove at full depth. The groove
// border is what the wall pass has to find, so this covers both halves of buildPolyTread in one go.
const CIRC = 1884, THALF = 95, SR = 26, AHALF = THALF + SR * Math.sin(80 * Math.PI / 180);
const d = { circ: CIRC, treadHalf: THALF, acrossHalf: AHALF, sr: SR, Rout: 300 };
const outerRing = [[0, -AHALF], [CIRC, -AHALF], [CIRC, AHALF], [0, AHALF]];
const grooveRing = [[300, -40], [900, -40], [900, 40], [300, 40]];
const grooveHoleInOuter = grooveRing.slice().reverse();              // negative area, so it reads as a hole

const ctx = {
  console, Math, Set, Map, Array, Object, Number, isNaN, parseFloat, Infinity, NaN, JSON,
  THREE, ST, TAU: Math.PI * 2,
  T: { treadDepth: 9, polyDetail: 6, crown: 3, radial: 360 },
  P: { layers: [] },
  toPath, orient, rectPath, inter, exPolygons,
  union: p => p, diff: p => p,
  sampleDepth: (pm, u, v) => {
    const x = ((u % 1) + 1) % 1 * CIRC, y = v * 2 * AHALF - AHALF;
    return (x > 300 && x < 900 && y > -40 && y < 40) ? 1 : 0;
  },
  treadRegions: () => ({
    levels: [0, 1],
    pieces: [
      { depth: 0, paths: [outerRing, grooveHoleInOuter] },
      { depth: 1, paths: [grooveRing] }
    ]
  })
};
// Stand-in for Clipper's PolyTree: positive rings are outlines, negative rings are holes of the previous one.
ctx.exPolygons = rings => {
  const out = [];
  for (const r of rings) {
    if (!r || r.length < 3) continue;
    if (ST.ringArea(r) > 0) out.push({ outer: r, holes: [] });
    else if (out.length) out[out.length - 1].holes.push(r);
  }
  return out;
};
ctx.buildProfile = () => ([
  { x: -AHALF, r: 250, nx: -1, nr: 0.2, zone: 'side', s: 0, edge: true },
  { x: -AHALF - 4, r: 220, nx: -1, nr: 0, zone: 'side', s: 0.4 },
  { x: -AHALF - 6, r: 190, nx: -1, nr: -0.2, zone: 'side', s: 1 },
  { x: AHALF, r: 250, nx: 1, nr: 0.2, zone: 'side', s: 0, edge: true },
  { x: AHALF + 4, r: 220, nx: 1, nr: 0, zone: 'side', s: 0.4 },
  { x: AHALF + 6, r: 190, nx: 1, nr: -0.2, zone: 'side', s: 1 }
]);
vm.createContext(ctx);
for (const fn of ['treadProfileAt', 'treadGridLines', 'buildPolyTread', 'buildSidewallSurface', 'surfaceToGeometry'])
  vm.runInContext(lift(fn), ctx, { filename: fn + '.js' });

// =====================================================================================================================
section('Tread grid');
const grid = vm.runInContext('treadGridLines(' + JSON.stringify(d) + ', 6)', ctx);
ok('columns start at zero and close on the circumference',
  grid.xs[0] === 0 && Math.abs(grid.xs[grid.xs.length - 1] - CIRC) < 1e-9, `${grid.xs.length} columns`);
ok('column spacing is close to the requested detail',
  Math.abs(CIRC / (grid.xs.length - 1) - 6) < 0.5, `${(CIRC / (grid.xs.length - 1)).toFixed(3)} mm`);
ok('rows are strictly increasing', grid.ys.every((v, i) => i === 0 || v > grid.ys[i - 1]), `${grid.ys.length} rows`);
ok('rows are symmetric about the centre line',
  grid.ys.every((v, i) => Math.abs(v + grid.ys[grid.ys.length - 1 - i]) < 1e-9));
ok('rows reach both shoulder edges exactly',
  Math.abs(grid.ys[0] + AHALF) < 1e-5 && Math.abs(grid.ys[grid.ys.length - 1] - AHALF) < 1e-5);
ok('the tread/shoulder junction is a grid line', grid.ys.some(v => Math.abs(v - THALF) < 1e-9));

// =====================================================================================================================
section('Quad tread surface');
const pm = { W: 64, H: 32, depth: new Float64Array(64 * 32), wearRow: () => 0 };
const surface = vm.runInContext('buildPolyTread(' + JSON.stringify(d) + ', pmGeo)', Object.assign(ctx, { pmGeo: pm }));
const stats = surface.stats();
ok('a surface was produced', stats.faces > 0, `${stats.faces} faces, ${stats.vertices} vertices`);
ok('the surface is quad dominant', stats.quadRatio > 0.95, `${(stats.quadRatio * 100).toFixed(1)}% quads`);
ok('no face has a repeated vertex', surface.faces.every(f => new Set(f.v).size === f.v.length));
ok('no position is NaN', surface.positions.every(p => p.every(Number.isFinite)));
ok('every corner normal is unit length',
  surface.faces.every(f => f.n.every(n => Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-6)));
ok('no face is degenerate in 3D', surface.faces.every(f => {
  const p = f.v.map(i => surface.positions[i]);
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  return Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) > 1e-9;
}));

// The groove floor must sit one tread depth below the crown, and the two levels must be joined by walls.
const radii = surface.positions.map(p => Math.hypot(p[1], p[2]));
// Design coordinates are recoverable from the revolved position: axial x is the across coordinate and the
// angle around the axle is the position along the circumference.
const along = p => { const a = Math.atan2(p[2], p[1]); return ((a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2)) * CIRC; };
const near = (lo, hi) => surface.positions.map((p, i) => ({ p, r: radii[i] }))
  .filter(q => Math.abs(q.p[0]) < 6 && along(q.p) > lo && along(q.p) < hi);
const crownR = Math.max(...near(1000, 1800).map(q => q.r));
const floorR = Math.min(...near(360, 840).map(q => q.r));
ok('the crown sits on the outer radius', Math.abs(crownR - 300) < 0.05, `${crownR.toFixed(3)} mm`);
ok('the groove floor is one tread depth below the crown',
  Math.abs((crownR - floorR) - 9) < 0.05, `${(crownR - floorR).toFixed(3)} mm of 9`);

const wallFaces = surface.faces.filter(f => f.wall);
ok('groove walls were generated', wallFaces.length > 0, `${wallFaces.length} wall faces`);
ok('every wall face is a quad', wallFaces.every(f => f.v.length === 4));
// Walls face into the groove: the normal must point away from the groove centre in the plane of the tread.
const gx = 600 / CIRC * Math.PI * 2, gc = [0, crownR * Math.cos(gx), crownR * Math.sin(gx)];
ok('wall normals face into the groove', wallFaces.every(f => {
  const p = f.v.map(i => surface.positions[i]);
  const mid = [0, 1, 2].map(k => p.reduce((a, q) => a + q[k], 0) / p.length);
  const toCentre = [gc[0] - mid[0], gc[1] - mid[1], gc[2] - mid[2]];
  const len = Math.hypot(...toCentre) || 1;
  const n = f.n[0];
  return (n[0] * toCentre[0] + n[1] * toCentre[1] + n[2] * toCentre[2]) / len > -0.2;
}));

// Welding: the x = 0 / x = circ seam must be a single set of vertices, never two coincident rows.
const seam = surface.positions.filter(p => Math.abs(p[2]) < 1e-6 && p[1] > 0);
const seamKeys = new Set(seam.map(p => p[0].toFixed(4) + '|' + p[1].toFixed(4)));
ok('the circumferential seam is welded, not duplicated', seamKeys.size === seam.length,
  `${seam.length} seam vertices, ${seamKeys.size} unique`);

// A boolean border that crosses a grid line leaves a T-junction: the neighbouring cell spans the whole grid
// edge while the clipped cell splits it. The shell stays geometrically closed — the split edge is covered by the
// longer one — so the real requirement is that no open edge is an actual gap.
const open = surface.boundaryEdges();
const rimEdge = e => Math.abs(Math.abs(surface.positions[e.a][0]) - AHALF) < 1e-3 &&
  Math.abs(Math.abs(surface.positions[e.b][0]) - AHALF) < 1e-3;
// The crown is a parabola, so a point that splits a grid edge sits a few microns off the straight chord
// between that edge's ends. 50 µm separates that curvature error from a genuine hole in the shell.
const SKIN = 0.05;
const liesOn = (p, e) => {
  const a = surface.positions[e.a], b = surface.positions[e.b];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
  if (t <= 1e-6 || t >= 1 - 1e-6) return false;
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]) < SKIN;
};
// Covered either because another vertex splits this edge, or because this edge is the short half of a longer
// neighbouring edge. Both cases describe the same T-junction seen from its two sides.
const covered = e => {
  if (surface.positions.some((p, i) => i !== e.a && i !== e.b && liesOn(p, e))) return true;
  const a = surface.positions[e.a], b = surface.positions[e.b];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return open.some(f => f !== e && liesOn(mid, f));
};
const rims = open.filter(rimEdge);
const gaps = open.filter(e => !rimEdge(e) && !covered(e));
ok('both shoulder rims are open, as the sidewall closes them', rims.length > 600, `${rims.length} rim edges`);
ok('no open edge is an actual gap in the shell', gaps.length === 0,
  `${open.length - rims.length} T-junctions, ${gaps.length} gaps`);
if (process.env.DUMP_GAPS) for (const e of gaps.slice(0, 30)) {
  const a = surface.positions[e.a], b = surface.positions[e.b];
  const ang = p => { const t = Math.atan2(p[2], p[1]); return ((t < 0 ? t + Math.PI * 2 : t) / (Math.PI * 2)) * CIRC; };
  console.log('    gap', a[0].toFixed(2), ang(a).toFixed(2), Math.hypot(a[1], a[2]).toFixed(2),
    '->', b[0].toFixed(2), ang(b).toFixed(2), Math.hypot(b[1], b[2]).toFixed(2));
}
ok('the shell has no non-manifold edge', surface.nonManifoldEdges() === 0);

// =====================================================================================================================
section('Render + export plumbing');
const geo = vm.runInContext('surfaceToGeometry(surf)', Object.assign(ctx, { surf: surface }));
ok('the render index triangulates every face',
  geo.index.count === (stats.quads * 2 + stats.tris) * 3, `${geo.index.count / 3} triangles`);
ok('positions, normals and uvs agree in length',
  geo.attributes.position.count === geo.attributes.normal.count &&
  geo.attributes.position.count === geo.attributes.uv.count);
ok('tangents are four-component', geo.attributes.tangent.itemSize === 4);
ok('the quad statistics ride along on the geometry', geo.userData.quads.faces === stats.faces);
ok('every index is inside the vertex range',
  geo.index.array.every(i => i >= 0 && i < geo.attributes.position.count));

const obj = surface.toOBJ('tread', 0.001);
const faceLines = obj.split('\n').filter(l => l.startsWith('f '));
ok('OBJ keeps quad faces instead of triangulating',
  faceLines.filter(l => l.trim().split(/\s+/).length === 5).length === stats.quads,
  `${faceLines.filter(l => l.trim().split(/\s+/).length === 5).length} quad faces of ${faceLines.length}`);
ok('OBJ is written in metres', obj.split('\n').filter(l => l.startsWith('v ')).every(l => {
  const v = l.split(/\s+/).slice(1).map(Number);
  return v.every(n => Math.abs(n) < 1);
}));

// =====================================================================================================================
section('Sidewall surface');
const sw = vm.runInContext('buildSidewallSurface(' + JSON.stringify(d) + ', buildProfile())', ctx);
const swStats = sw.stats();
ok('the sidewall is entirely quads', swStats.quadRatio === 1, `${swStats.quads} quads`);
ok('the sidewall has no NaN position', sw.positions.every(p => p.every(Number.isFinite)));
ok('the sidewall seam is welded', (() => {
  const ring = sw.positions.filter(p => Math.abs(p[2]) < 1e-6 && p[1] > 0);
  return new Set(ring.map(p => p[0].toFixed(4) + '|' + p[1].toFixed(4))).size === ring.length;
})());
ok('smooth normals are unit length',
  sw.faces.every(f => f.n.every(n => Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-6)));

// =====================================================================================================================
section('Polygon lug instancing');
for (const fn of ['blocksMetrics', 'blocksInstances']) vm.runInContext(lift(fn), ctx, { filename: fn + '.js' });
ctx.layer = {
  type: 'blocks', design: 'rugged', count: 33.4, reach: 1.1, gap: 1, depth: 1, sipeWidth: 1, sipeDepth: 0.5,
  shapes: ST.designFromLibrary('rugged')
};
const metrics = vm.runInContext('blocksMetrics(layer, ' + JSON.stringify(d) + ')', ctx);
ok('the repeat count is rounded to a whole number', metrics.count === 33, `${metrics.count}`);
ok('the pitch divides the circumference', Math.abs(metrics.pitch * metrics.count - CIRC) < 1e-9,
  `${metrics.pitch.toFixed(3)} mm`);
ok('the lug band follows the across reach', Math.abs(metrics.bandHalf - THALF * 1.1) < 1e-9);
ok('groove spacing of 1 leaves the lugs at full size', metrics.scale === 1);
ctx.wide = Object.assign({}, ctx.layer, { gap: 1.5 });
ok('a wider groove spacing shrinks each lug',
  vm.runInContext('blocksMetrics(wide, ' + JSON.stringify(d) + ').scale', ctx) < 0.94);

const inst = vm.runInContext('blocksInstances(layer, ' + JSON.stringify(d) + ')', ctx);
// Two pads on each side keep the seam continuous; pitch A and pitch B carry different shape counts.
const pitches = Array.from({ length: metrics.count + 4 }, (_, k) => k - 2);
const perParity = [0, 1].map(par => ST.designShapes(ctx.layer.shapes, par).length);
const expected = pitches.reduce((n, i) => n + perParity[((i % 2) + 2) % 2], 0);
ok('every pitch in the repeat is instanced', inst.length === expected,
  `${inst.length} instances over ${pitches.length} pitches (A:${perParity[0]} B:${perParity[1]})`);
ok('instancing covers the whole circumference and overruns both seams',
  Math.min(...inst.map(b => Math.min(...b.outer.map(q => q[0])))) < 0 &&
  Math.max(...inst.map(b => Math.max(...b.outer.map(q => q[0])))) > CIRC);
ok('no lug leaves the band', inst.every(b => b.outer.every(q => Math.abs(q[1]) <= metrics.bandHalf + 1e-9)));
ok('roles survive instancing', new Set(inst.map(b => b.role)).size >= 1 &&
  inst.every(b => ST.ROLES.includes(b.role)));
ok('every outline is still a simple polygon', inst.every(b => ST.validPolygon(b.outer)));
// Pitch A and pitch B must repeat every two pitches, which is what makes the A/B cell worth having.
const atPitch = i => inst.filter(b => b.outer.every(q => q[0] >= i * metrics.pitch - 1e-6 && q[0] <= (i + 1) * metrics.pitch + 1e-6))
  .map(b => b.outer.map(q => [q[0] - i * metrics.pitch, q[1]].map(v => v.toFixed(4)).join(',')).join(' ')).sort().join('|');
ok('the design repeats every two pitches', atPitch(4) === atPitch(6) && atPitch(5) === atPitch(7), '');

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
