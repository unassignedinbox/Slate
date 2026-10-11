// Top-down orthographic plan of the generated scene, rasterised straight from the geometry so
// the layout can be inspected without a GPU.  Writes a raw RGB buffer that plan.py turns into
// a PNG.  node tools/dev/plan.mjs [preset] [size] [--zoom x,z,halfSpan]
import { buildScene, defaultSettings } from '../../src/road/scene.js';
import { SURF, SURF_NAMES } from '../../src/core/mesh.js';
import { writeFileSync } from 'node:fs';

const preset = process.argv[2] || 'downtown';
const SIZE = parseInt(process.argv[3] || '1100', 10);
const zoomArg = process.argv.find((a) => a.startsWith('--zoom'));
const scene = buildScene(defaultSettings(preset));
const STRIDE = 20;

const C = {
  [SURF.ASPHALT]: [38, 38, 41], [SURF.ASPHALT_JUNCTION]: [45, 45, 48],
  [SURF.GUTTER]: [62, 62, 64], [SURF.KERB_FACE]: [150, 148, 142], [SURF.KERB_TOP]: [176, 174, 168],
  [SURF.FOOTWAY]: [131, 128, 122], [SURF.VERGE]: [60, 96, 44], [SURF.MEDIAN]: [70, 104, 50],
  [SURF.SHOULDER]: [52, 52, 55], [SURF.CONCRETE]: [142, 140, 136], [SURF.BRIDGE_UNDER]: [100, 98, 96],
  [SURF.RAIL_BED]: [92, 84, 74], [SURF.METAL]: [120, 122, 126], [SURF.PAINTED_CONCRETE]: [160, 158, 150],
  [SURF.TACTILE]: [170, 150, 60], [SURF.DIRT]: [110, 92, 68], [SURF.WATER]: [40, 70, 100],
  [SURF.COBBLE]: [104, 98, 92], [SURF.BRICK]: [122, 78, 62], [SURF.GRASS]: [58, 92, 42],
  [SURF.PAVER]: [138, 134, 128], [SURF.LINE_PAINT]: [230, 230, 224], [SURF.SOIL]: [120, 102, 74],
  [SURF.GRAVEL]: [118, 114, 106], [SURF.ROAD_PLATE]: [96, 94, 92], [SURF.RAIL_STEEL]: [168, 164, 160],
  [SURF.SLEEPER]: [86, 78, 70], [SURF.BALLAST]: [104, 98, 90], [SURF.TUNNEL_LINING]: [88, 88, 92],
  [SURF.CAR_PAINT]: [210, 60, 50], [SURF.SIGN_SPEED]: [240, 240, 240],
};
const fallback = [150, 60, 200];   // anything unmapped screams

const meshes = [];
const add = (m, tag) => { if (m && m.vertexCount) meshes.push({ m, tag }); };
add(scene.ground, 'ground');
add(scene.blocks.mesh, 'blocks');
add(scene.structures.meshes.bridges, 'bridge');
add(scene.structures.meshes.retaining, 'wall');
add(scene.rail?.mesh, 'rail');
add(scene.surface.mesh, 'road');
for (const [k, v] of Object.entries(scene.props.meshes || {})) add(v, `prop:${k}`);
add(scene.crossing?.mesh, 'crossing');

let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const { m } of meshes) {
  const b = m.bounds;
  minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x);
  minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
}
let cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, span = Math.max(maxX - minX, maxZ - minZ) / 2 * 1.02;
if (zoomArg) {
  const [x, z, h] = zoomArg.split('=')[1].split(',').map(Number);
  cx = x; cz = z; span = h;
}
const px = (x) => ((x - (cx - span)) / (2 * span)) * SIZE;
const py = (z) => ((z - (cz - span)) / (2 * span)) * SIZE;

const buf = new Uint8Array(SIZE * SIZE * 3).fill(16);
const depth = new Float32Array(SIZE * SIZE).fill(-1e9);

function tri(A, B, Cc, col) {
  const minx = Math.max(0, Math.floor(Math.min(A.x, B.x, Cc.x)));
  const maxx = Math.min(SIZE - 1, Math.ceil(Math.max(A.x, B.x, Cc.x)));
  const miny = Math.max(0, Math.floor(Math.min(A.y, B.y, Cc.y)));
  const maxy = Math.min(SIZE - 1, Math.ceil(Math.max(A.y, B.y, Cc.y)));
  const d = (B.y - Cc.y) * (A.x - Cc.x) + (Cc.x - B.x) * (A.y - Cc.y);
  if (Math.abs(d) < 1e-9) return;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const w0 = ((B.y - Cc.y) * (x + 0.5 - Cc.x) + (Cc.x - B.x) * (y + 0.5 - Cc.y)) / d;
      const w1 = ((Cc.y - A.y) * (x + 0.5 - Cc.x) + (A.x - Cc.x) * (y + 0.5 - Cc.y)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const h = w0 * A.h + w1 * B.h + w2 * Cc.h;
      const i = y * SIZE + x;
      if (h <= depth[i]) continue;
      depth[i] = h;
      const shade = 0.72 + Math.min(0.5, Math.max(-0.2, h * 0.03));
      buf[i * 3] = Math.min(255, col[0] * shade);
      buf[i * 3 + 1] = Math.min(255, col[1] * shade);
      buf[i * 3 + 2] = Math.min(255, col[2] * shade);
    }
  }
}

for (const { m } of meshes) {
  for (let t = 0; t < m.indices.length; t += 3) {
    const V = [0, 1, 2].map((k) => {
      const o = m.indices[t + k] * STRIDE;
      return { x: px(m.vertices[o]), y: py(m.vertices[o + 2]), h: m.vertices[o + 1], s: Math.round(m.vertices[o + 11]) };
    });
    tri(V[0], V[1], V[2], C[V[0].s] || fallback);
  }
}
writeFileSync('/tmp/plan.raw', Buffer.from(buf));
console.log(`${SIZE}x${SIZE} centred ${cx.toFixed(0)},${cz.toFixed(0)} span ±${span.toFixed(0)} m`);
const used = new Set();
for (const { m } of meshes) for (let i = 0; i < m.vertexCount; i++) used.add(Math.round(m.vertices[i * STRIDE + 11]));
console.log('unmapped surfaces:', [...used].filter((s) => !C[s]).map((s) => SURF_NAMES[s]).join(' ') || 'none');
