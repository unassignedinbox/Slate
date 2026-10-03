// =====================================================================================================================
//  Offline checks for the Slate tyre generator's tread core.
//
//  The generator is a single self-contained page (References/TyreGenerator.html) that pulls three.js and Clipper
//  from a CDN at runtime. This script extracts the dependency-free <script id="tread-core"> block from that page
//  and exercises it in Node, so the design model, the ported reference tread library and the quad-dominant
//  surface builder can be validated without a browser.
//
//      node Scratchpad/TyreGeneratorChecks/check-tread-core.mjs
// =====================================================================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(here, '../../References/TyreGenerator.html');
const page = readFileSync(pagePath, 'utf8');

const open = page.indexOf('<script id="tread-core">');
const close = page.indexOf('</script>', open);
if (open < 0 || close < 0) { console.error('Could not find the tread-core script block in', pagePath); process.exit(1); }
const source = page.slice(page.indexOf('>', open) + 1, close);

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'tread-core.js' });
const T = sandbox.SlateTread;
if (!T) { console.error('tread-core did not publish SlateTread'); process.exit(1); }

let failures = 0, checks = 0;
const ok = (name, condition, detail = '') => {
  checks++;
  if (condition) console.log(`  pass  ${name}${detail ? ' — ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = name => console.log(`\n${name}`);

// ------------------------------------------------------------------------------------------------ design model
section('Design model');
{
  const shape = T.normaliseShape({ points: [[-.2, .1], [.2, .1], [.2, .6], [-.2, .6]], mirror: { mode: 'point', axisX: 0, axisY: .5, stagger: 0 } });
  const copies = T.expandShape(shape);
  ok('point mirror produces a source and one linked copy', copies.length === 2, `${copies.length} instances`);
  const mirrored = copies.find(c => c.instance === 'point');
  ok('point mirror reverses both axes', Math.abs(mirrored.points[0][0] + shape.points[0][0]) < 1e-9 &&
    Math.abs(mirrored.points[0][1] - (1 - shape.points[0][1])) < 1e-9);

  const square = T.normaliseShape({ points: [[-.2, .1], [.2, .1], [.2, .6], [-.2, .6]] });
  const symmetric = T.expandShape(Object.assign({}, square, { mirror: { mode: 'width', axisX: 0, axisY: .5, stagger: 0 } }));
  ok('a self-symmetric outline does not duplicate itself', symmetric.length === 1, `${symmetric.length} instance`);

  ok('valid polygon accepted', T.validPolygon([[0, 0], [1, 0], [1, 1], [0, 1]]));
  ok('self-crossing outline rejected', !T.validPolygon([[0, 0], [1, 1], [1, 0], [0, 1]]));
  ok('degenerate outline rejected', !T.validPolygon([[0, 0], [1, 0], [2, 0]]));

  const phased = [
    T.normaliseShape({ points: [[-.2, .1], [.2, .1], [.2, .6]], phase: '0' }),
    T.normaliseShape({ points: [[-.2, .1], [.2, .1], [.2, .6]], phase: '1' }),
    T.normaliseShape({ points: [[-.2, .1], [.2, .1], [.2, .6]], phase: 'both' })
  ];
  ok('pitch A selects the A and every-pitch shapes', T.designShapes(phased, 0).length === 2);
  ok('pitch B selects the B and every-pitch shapes', T.designShapes(phased, 1).length === 2);
}

// --------------------------------------------------------------------------------------------- ported library
section('Ported reference tread library');
{
  const ported = T.TREAD_LIBRARY.filter(d => d.origin !== 'slate'), drawn = T.TREAD_LIBRARY.filter(d => d.origin === 'slate');
  ok('the eight reference designs are published', ported.length === 8, ported.map(d => d.id).join(', '));
  ok('the library is not limited to the ported designs', drawn.length >= 4, drawn.map(d => d.id).join(', '));
  ok('the library spans more than the off-road categories',
    new Set(T.TREAD_LIBRARY.map(d => d.category)).size >= 6,
    [...new Set(T.TREAD_LIBRARY.map(d => d.category))].join(', '));
  for (const entry of T.TREAD_LIBRARY) {
    const shapes = T.designFromLibrary(entry.id);
    const expanded = [...T.designShapes(shapes, 0), ...T.designShapes(shapes, 1)];
    const bad = T.invalidShapes(shapes);
    const outside = expanded.filter(s => s.points.some(([x]) => Math.abs(x) > .52));
    const sipes = expanded.reduce((n, s) => n + s.sipes.length, 0);
    const linked = shapes.filter(s => s.mirror.mode !== 'none').length;
    ok(`${entry.id}: outlines are simple polygons`, bad.length === 0, bad.map(s => s.name).join(', '));
    ok(`${entry.id}: shapes stay inside the tread band`, outside.length === 0, `${outside.length} outside`);
    ok(`${entry.id}: has editable lugs and cut lines`, shapes.length >= 2 && expanded.length >= 4 && sipes > 0,
      `${shapes.length} shapes (${linked} with linked mirrors), ${expanded.length} instances, ${sipes} cut lines`);
    ok(`${entry.id}: carries a Slate carcass preset`, entry.tyre && entry.tyre.width > 150 && entry.count >= 20 && entry.count % 2 === 0,
      `${entry.tyre.width}/${entry.tyre.aspect} R${entry.tyre.rim}, ${entry.count} repeats`);
  }
  const rugged = T.designFromLibrary('rugged');
  ok('rugged recovers exact mirror pairs instead of duplicating halves',
    rugged.filter(s => s.mirror.mode === 'point').length >= 2,
    `${rugged.filter(s => s.mirror.mode !== 'none').length} linked shapes of ${rugged.length}`);
  const ejectors = T.designFromLibrary('mud').filter(s => s.role === 'ejector');
  ok('mud keeps its low ejector bars below full lug height',
    ejectors.length > 0 && ejectors.every(s => s.heightRatio < .5), `${ejectors.length} ejectors`);
}

// ------------------------------------------------------------------------------------------ quadrangulation
section('Quad-dominant surface');
const gridLines = (from, to, step) => {
  const out = [];
  for (let v = from; v < to - 1e-9; v += step) out.push(v);
  out.push(to);
  return out;
};
{
  const rect = [[0, 0], [60, 0], [60, 36], [0, 36]];
  const xs = gridLines(0, 60, 6), ys = gridLines(0, 36, 6);
  const r = T.quadrangulate([rect], xs, ys, T.clipRectSimple);
  const quads = r.faces.filter(f => f.length === 4).length;
  ok('an axis-aligned rectangle becomes pure quads', quads === r.faces.length && r.faces.length === 60,
    `${quads} quads / ${r.faces.length} faces`);
  const area = r.faces.reduce((sum, f) => sum + Math.abs(T.ringArea(f.map(i => r.points[i]))), 0);
  ok('quad areas reproduce the polygon area', Math.abs(area - 60 * 36) < 1e-6, `${area.toFixed(3)} mm²`);
}
{
  // An angled lug outline: the interior must be quads, with triangles only along the sloped boundary.
  const lug = [[3.5, 2.2], [48, 9], [52, 40], [9, 33]];
  const xs = gridLines(0, 60, 5), ys = gridLines(0, 45, 5);
  const r = T.quadrangulate([lug], xs, ys, T.clipRectSimple);
  const quads = r.faces.filter(f => f.length === 4).length;
  const ratio = quads / r.faces.length;
  ok('an angled lug is quad dominant', ratio > 0.75, `${(ratio * 100).toFixed(1)}% quads (${quads}/${r.faces.length})`);
  const area = r.faces.reduce((sum, f) => sum + Math.abs(T.ringArea(f.map(i => r.points[i]))), 0);
  ok('angled lug area is preserved', Math.abs(area - Math.abs(T.ringArea(lug))) < 1e-4,
    `${area.toFixed(3)} vs ${Math.abs(T.ringArea(lug)).toFixed(3)} mm²`);
  const wound = r.faces.every(f => T.ringArea(f.map(i => r.points[i])) > 0);
  ok('every face is wound consistently', wound);
}
{
  // Conforming shared edges: two neighbouring polygons that touch along a slanted seam must not leave
  // a T-junction, which is what would tear a deforming tyre apart at a groove wall.
  const xs = gridLines(0, 40, 5), ys = gridLines(0, 40, 5);
  const left = [[0, 0], [22, 7], [22, 33], [0, 40]];
  const right = [[22, 7], [40, 0], [40, 40], [22, 33]];
  const a = T.quadrangulate([left], xs, ys, T.clipRectSimple);
  const b = T.quadrangulate([right], xs, ys, T.clipRectSimple);
  const key = p => `${Math.round(p[0] * 1e4)}|${Math.round(p[1] * 1e4)}`;
  const seamA = new Set(a.points.filter(p => Math.abs((p[0] - 22) * 26 - (p[1] - 7) * 0) < 1e-6 && p[0] > 21.9).map(key));
  const seamB = new Set(b.points.filter(p => p[0] > 21.9 && p[0] < 22.1).map(key));
  const shared = [...seamB].filter(k => seamA.has(k)).length;
  ok('a shared boundary produces identical seam vertices', shared === seamB.size && shared > 0,
    `${shared} of ${seamB.size} seam vertices match`);
}

// --------------------------------------------------------------------------------------------- welded topology
section('Welded quad topology');
{
  const surface = new T.QuadSurface();
  const n = [0, 1, 0];
  const corner = (x, z) => ({ p: [x, 0, z], n, uv: [x / 10, z / 10] });
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    surface.addFace([corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)]);
  const stats = surface.stats();
  ok('a 4x4 patch welds to 25 shared vertices', stats.vertices === 25, `${stats.vertices} vertices`);
  ok('all 16 faces are quads', stats.quads === 16 && stats.tris === 0, `${stats.quads} quads`);
  ok('quad ratio is reported', Math.abs(stats.quadRatio - 1) < 1e-9);
  ok('the open patch has 16 boundary edges', surface.boundaryEdges().length === 16, `${surface.boundaryEdges().length}`);
  ok('no non-manifold edges', surface.nonManifoldEdges() === 0);

  const render = surface.toRenderArrays();
  ok('render arrays triangulate every quad', render.index.length === 16 * 6, `${render.index.length / 3} triangles`);
  ok('render positions stay finite', render.position.every(Number.isFinite) && render.normal.every(Number.isFinite));

  const obj = surface.toOBJ('patch', 0.001);
  const objFaces = obj.split('\n').filter(l => l.startsWith('f '));
  ok('OBJ export keeps quads as four-sided faces',
    objFaces.length === 16 && objFaces.every(l => l.trim().split(/\s+/).length === 5),
    `${objFaces.length} faces, first: ${objFaces[0]}`);
  ok('OBJ vertex count matches the welded topology',
    obj.split('\n').filter(l => l.startsWith('v ')).length === 25);
  ok('OBJ scale is applied', obj.includes('v 0.004000'), 'millimetres → metres');

  surface.computeSmoothNormals();
  ok('smooth normals point out of the patch plane',
    surface.faces.every(f => f.n.every(n => Math.abs(Math.abs(n[1]) - 1) < 1e-9)));

  const wire = surface.wireframe();
  ok('wireframe emits unique quad edges only', wire.length / 6 === 40, `${wire.length / 6} edges`);
}
{
  const surface = new T.QuadSurface();
  const n = [0, 0, 1];
  const c = (x, y) => ({ p: [x, y, 0], n, uv: [0, 0] });
  ok('a collapsed quad is rejected', surface.addFace([c(0, 0), c(0, 0), c(1, 1), c(0, 1)]) === null);
  ok('a valid triangle is accepted', surface.addFace([c(0, 0), c(1, 0), c(0, 1)]) !== null);
  ok('triangles are counted separately', surface.stats().tris === 1 && surface.stats().quads === 0);
}

// ------------------------------------------------------------------------------------------- tri → quad merge
section('Triangle to quad conversion');
{
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const faces = T.trianglesToQuads(pts, [[0, 1, 2], [0, 2, 3]]);
  ok('two triangles sharing a diagonal merge into one quad', faces.length === 1 && faces[0].length === 4,
    JSON.stringify(faces));
}
{
  // A pairing whose corner opens to almost 180 degrees would deform badly, so it stays as two triangles.
  const pts = [[0, 0], [10, 0], [20, .3], [10, 8]];
  const faces = T.trianglesToQuads(pts, [[0, 1, 3], [1, 2, 3]]);
  ok('a near-degenerate corner is left as triangles', faces.length === 2 && faces.every(f => f.length === 3),
    JSON.stringify(faces));
  ok('a thin but square-cornered pair still merges',
    T.trianglesToQuads([[0, 0], [10, 0], [10, .4], [0, .4]], [[0, 1, 2], [0, 2, 3]]).length === 1);
}
{
  const pts = [[0, 0], [10, 0], [5, 2], [10, 10], [0, 10]];
  const faces = T.trianglesToQuads(pts, [[0, 1, 2], [0, 2, 4], [2, 3, 4]]);
  ok('a concave pairing is never merged', faces.every(f => f.length === 3 || T.quadConvex(...f.map(i => pts[i]))));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
