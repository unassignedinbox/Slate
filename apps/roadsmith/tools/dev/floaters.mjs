// Looks for geometry that does not touch the world: props hovering above or sunk into the
// surface they are supposed to stand on, and meshes with implausible bounds.
import { buildScene, defaultSettings } from '../../src/road/scene.js';

const preset = process.argv[2] || 'downtown';
const scene = buildScene(defaultSettings(preset));
const STRIDE = 20;

// ---- height field of everything walkable: road ribbons, junction plates, blocks, ground
const CELL = 12;
const field = new Map();
const put = (x, z, y) => {
  const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const e = field.get(k);
  if (!e) field.set(k, { lo: y, hi: y });
  else { if (y < e.lo) e.lo = y; if (y > e.hi) e.hi = y; }
};
const scan = (mesh) => {
  if (!mesh) return;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const o = i * STRIDE;
    put(mesh.vertices[o], mesh.vertices[o + 2], mesh.vertices[o + 1]);
  }
};
scan(scene.surface.mesh);
scan(scene.blocks.mesh);
scan(scene.ground);
const groundNear = (x, z) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const e = field.get(`${Math.floor(x / CELL) + i},${Math.floor(z / CELL) + j}`);
      if (!e) continue;
      if (e.lo < lo) lo = e.lo;
      if (e.hi > hi) hi = e.hi;
    }
  }
  return lo === Infinity ? null : { lo, hi };
};

// ---- connected components of each prop mesh = individual props
let checked = 0, floating = 0, sunk = 0;
const worst = [];
for (const [name, mesh] of Object.entries(scene.props.meshes || {})) {
  if (!mesh || !mesh.vertexCount) continue;
  const parent = new Int32Array(mesh.vertexCount).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    uni(mesh.indices[t], mesh.indices[t + 1]);
    uni(mesh.indices[t], mesh.indices[t + 2]);
  }
  const comps = new Map();
  for (let i = 0; i < mesh.vertexCount; i++) {
    const r = find(i);
    const o = i * STRIDE;
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { minY: Infinity, maxY: -Infinity, sx: 0, sz: 0, n: 0 }));
    const y = mesh.vertices[o + 1];
    if (y < c.minY) c.minY = y;
    if (y > c.maxY) c.maxY = y;
    c.sx += mesh.vertices[o]; c.sz += mesh.vertices[o + 2]; c.n++;
  }
  for (const c of comps.values()) {
    const cx = c.sx / c.n, cz = c.sz / c.n;
    const g = groundNear(cx, cz);
    if (!g) continue;
    checked++;
    const gap = c.minY - g.hi;
    const dig = g.lo - c.minY;
    const MAST = name === 'signals' || name === 'signage' || name === 'lighting';  // heads/faces hang off a mast on purpose
    const tall = !MAST && (c.maxY - c.minY) > 0.8;
    if (tall && gap > 0.45) { floating++; worst.push({ kind: name, gap: +gap.toFixed(2), x: +cx.toFixed(0), z: +cz.toFixed(0), h: +(c.maxY - c.minY).toFixed(1) }); }
    if (dig > 1.6) { sunk++; worst.push({ kind: name + ' SUNK', gap: +(-dig).toFixed(2), x: +cx.toFixed(0), z: +cz.toFixed(0), h: +(c.maxY - c.minY).toFixed(1) }); }
  }
}
worst.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
console.log(`${preset}: ${checked} props checked`);
console.log(`floating > 0.45 m : ${floating}`);
console.log(`sunk > 1.6 m      : ${sunk}`);
if (worst.length) console.log('worst             :', JSON.stringify(worst.slice(0, 8)));

// ---- implausible mesh bounds anywhere in the scene
const named = {
  surface: scene.surface.mesh, blocks: scene.blocks.mesh, ground: scene.ground,
  bridges: scene.structures.meshes.bridges, retaining: scene.structures.meshes.retaining,
  tunnels: scene.structures.meshes.tunnels, rail: scene.rail?.mesh,
};
for (const [k, m] of Object.entries(scene.props.meshes || {})) named[`props:${k}`] = m;
let bad = 0;
for (const [name, m] of Object.entries(named)) {
  if (!m || !m.bounds) continue;
  const b = m.bounds;
  const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  if (b.min.y < -40 || b.max.y > 60 || span > 4000) {
    bad++;
    console.log(`  implausible bounds ${name}: y ${b.min.y.toFixed(1)}..${b.max.y.toFixed(1)} span ${span.toFixed(0)} m`);
  }
}
console.log(`mesh bounds       : ${bad} implausible`);

// ---- vehicles sit on the road?
let vBad = 0;
for (const v of scene.traffic.vehicles) {
  const g = groundNear(v.pos.x, v.pos.z);
  if (!g) continue;
  if (v.pos.y < g.lo - 1.2 || v.pos.y > g.hi + 2.5) vBad++;
}
console.log(`vehicles off road : ${vBad}/${scene.traffic.vehicles.length}`);
process.exit(floating > 2 || sunk > 2 || bad > 0 || vBad > 0 ? 1 : 0);
