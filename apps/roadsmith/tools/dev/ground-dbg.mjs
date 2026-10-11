// Rasterises the terrain apron and asks the only question that matters:
// does any part of the ground sit above the road surface it is supposed to sit under?
import { buildScene, defaultSettings } from '../../src/road/scene.js';

const preset = process.argv[2] || 'downtown';
const scene = buildScene(defaultSettings(preset));
const g = scene.ground;
const STRIDE = 20;
console.log(`${preset}: ground ${g.vertexCount} verts · ${g.triCount} tris · ${g.quadCount} quads`);

// --- build a lookup of ground quads by XZ cell
const CELL = 24;
const hash = new Map();
const pos = g.vertices;
const tri = g.indices;
const add = (k, v) => { let l = hash.get(k); if (!l) hash.set(k, (l = [])); l.push(v); };
for (let t = 0; t < tri.length; t += 3) {
  const a = tri[t] * STRIDE, b = tri[t + 1] * STRIDE, c = tri[t + 2] * STRIDE;
  const T = [
    { x: pos[a], y: pos[a + 1], z: pos[a + 2] },
    { x: pos[b], y: pos[b + 1], z: pos[b + 2] },
    { x: pos[c], y: pos[c + 1], z: pos[c + 2] },
  ];
  const minx = Math.min(T[0].x, T[1].x, T[2].x), maxx = Math.max(T[0].x, T[1].x, T[2].x);
  const minz = Math.min(T[0].z, T[1].z, T[2].z), maxz = Math.max(T[0].z, T[1].z, T[2].z);
  for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++) {
    for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) add(`${i},${j}`, T);
  }
}

/** height of the ground at (x,z), or null when the apron has been carved away there */
function groundAt(x, z) {
  const list = hash.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!list) return null;
  let best = null;
  for (const T of list) {
    const [A, B, C] = T;
    const d = (B.z - C.z) * (A.x - C.x) + (C.x - B.x) * (A.z - C.z);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((B.z - C.z) * (x - C.x) + (C.x - B.x) * (z - C.z)) / d;
    const w1 = ((C.z - A.z) * (x - C.x) + (A.x - C.x) * (z - C.z)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const y = w0 * A.y + w1 * B.y + w2 * C.y;
    if (best === null || y > best) best = y;
  }
  return best;
}

// --- sample the road surface: every station, every profile point
let samples = 0, buried = 0, worst = 0, worstAt = null, covered = 0;
const histogram = new Map();
for (const [id, rib] of scene.surface.ribbons) {
  for (const st of rib.stations) {
    for (const q of st.row.pts) {
      const p = q.world || q.p;
      samples++;
      const gy = groundAt(p.x, p.z);
      if (gy === null) continue;
      covered++;
      const over = gy - p.y;
      if (over > 0.12) {   // a few cm of silt in a ramp ditch is not a bug
        buried++;
        histogram.set(q.group, (histogram.get(q.group) || 0) + 1);
        if (over > worst) { worst = over; worstAt = { id, group: q.group, x: p.x.toFixed(1), z: p.z.toFixed(1), road: p.y.toFixed(3), ground: gy.toFixed(3) }; }
      }
    }
  }
}
// junction plates too
let plateBuried = 0, plateSamples = 0;
for (const info of scene.surface.junctions.values()) {
  for (let a = 0; a < 12; a++) {
    for (const f of [0.25, 0.55, 0.85]) {
      const r = info.radius * f;
      const x = info.centre.x + Math.cos((a / 12) * Math.PI * 2) * r;
      const z = info.centre.z + Math.sin((a / 12) * Math.PI * 2) * r;
      plateSamples++;
      const gy = groundAt(x, z);
      if (gy !== null && gy > (info.centre.y ?? 0) + 0.02) plateBuried++;
    }
  }
}

// --- holes: a point inside the city must be covered by road, block or ground
const inPoly = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const corridor = [];
for (const rib of scene.surface.ribbons.values()) {
  for (const st of rib.stations) {
    const pts = st.row.pts;
    const l = pts[0].world || pts[0].p, r = pts[pts.length - 1].world || pts[pts.length - 1].p;
    const c = st.frame.p;
    corridor.push({ x: c.x, z: c.z, hw: Math.max(Math.hypot(c.x - l.x, c.z - l.z), Math.hypot(c.x - r.x, c.z - r.z)) });
  }
}
for (const info of scene.surface.junctions.values()) corridor.push({ x: info.centre.x, z: info.centre.z, hw: info.radius ?? 8 });
const b = scene.surface.mesh.bounds || { min: { x: -500, z: -500 }, max: { x: 500, z: 500 } };
let probes = 0, holes = 0;
const histo = {};
const holeList = [];
for (let x = b.min.x; x <= b.max.x; x += 7) {
  for (let z = b.min.z; z <= b.max.z; z += 7) {
    probes++;
    if (groundAt(x, z) !== null) continue;
    if (corridor.some((c) => Math.hypot(c.x - x, c.z - z) < c.hw)) continue;
    if ((scene.blocks.blocks || []).some((bl) => inPoly(x, z, bl.ring))) continue;
    let dmin = Infinity;
    for (const c of corridor) { const d = Math.hypot(c.x - x, c.z - z) - c.hw; if (d < dmin) dmin = d; }
    holes++;
    histo[Math.min(5, Math.floor(dmin / 4))] = (histo[Math.min(5, Math.floor(dmin / 4))] || 0) + 1;
    if (dmin > 6 && holeList.length < 6) holeList.push(`${x.toFixed(0)},${z.toFixed(0)}@${dmin.toFixed(1)}m`);
  }
}
const far = Object.entries(histo).filter(([k]) => +k >= 2).reduce((a, [, v]) => a + v, 0);
console.log(`coverage           ${probes} probes · ${holes} uncovered (${((holes / probes) * 100).toFixed(2)}%) · by distance from the kerb ${JSON.stringify(histo)}`);
console.log(`gaps >8 m out      ${far}${holeList.length ? ' e.g. ' + holeList.join(' ') : ''}`);

console.log(`road samples       ${samples} (${covered} over apron quads, ${samples - covered} over carved-out holes)`);
console.log(`buried by ground   ${buried}  (${((buried / samples) * 100).toFixed(2)}%)`);
if (histogram.size) console.log(`by band            ${[...histogram].map(([k, v]) => `${k}:${v}`).join(' ')}`);
if (worstAt) console.log(`worst              ${JSON.stringify(worstAt)}`);
console.log(`junction plates    ${plateBuried}/${plateSamples} samples under the apron`);
process.exit(buried > 0 || plateBuried > 0 || far > probes * 0.002 ? 1 : 0);
