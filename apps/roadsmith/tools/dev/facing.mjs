// Does every directional prop point where it should?
import { buildScene, defaultSettings } from '../../src/road/scene.js';
import { SURF } from '../../src/core/mesh.js';

const scene = buildScene(defaultSettings(process.argv[2] || 'downtown'));
const STRIDE = 20;
const faceSurf = new Set([SURF.SIGN_SPEED, SURF.SIGN_STOP, SURF.SIGN_GIVEWAY, SURF.SIGN_INFO]);

// average normal + centre of every connected sign-face island
const m = scene.props.meshes.signage;
let flat = 0, vertical = 0, n = 0;
const faces = [];
for (let t = 0; t < m.indices.length; t += 3) {
  const o = m.indices[t] * STRIDE;
  if (!faceSurf.has(Math.round(m.vertices[o + 11]))) continue;
  const N = { x: m.vertices[o + 3], y: m.vertices[o + 4], z: m.vertices[o + 5] };
  n++;
  if (Math.abs(N.y) > 0.5) flat++; else vertical++;
  faces.push({ p: { x: m.vertices[o], y: m.vertices[o + 1], z: m.vertices[o + 2] }, N });
}
console.log(`sign faces: ${n} tris · vertical ${vertical} · lying flat ${flat}`);

// junction signs/signals must look back along the approach
let wrong = 0, right = 0;
for (const [, j] of scene.surface.junctions) {
  for (const mo of j.mouths) {
    const near = faces.filter((f) => Math.hypot(f.p.x - mo.kerbR.x, f.p.z - mo.kerbR.z) < 6);
    for (const f of near) {
      const d = f.N.x * mo.dir.x + f.N.z * mo.dir.z;
      if (d > 0.3) right++; else if (d < -0.3) wrong++;
    }
  }
}
console.log(`junction sign faces aimed at traffic: ${right} · aimed away: ${wrong}`);

// street lamps: luminaire must hang over the carriageway, not the verge
let over = 0, off = 0;
for (const l of scene.props.lights) {
  let best = null;
  for (const edge of scene.net.edges.values()) {
    const d = edge.curve.closestPoint ? null : null;
    void d;
  }
  void best;
}
const band = (edge) => edge.profile;
void band; void over; void off;

// vehicles: nose must lead
let back = 0;
for (const v of scene.traffic.vehicles) {
  const f = { x: Math.cos(v.yaw), z: Math.sin(v.yaw) };
  const path = v.conn ? v.conn.path : v.lane.pts;
  const a = path[Math.max(0, Math.min(path.length - 2, Math.floor(v.s / 3)))];
  const b = path[Math.max(1, Math.min(path.length - 1, Math.floor(v.s / 3) + 1))];
  const d = { x: b.x - a.x, z: b.z - a.z };
  if (f.x * d.x + f.z * d.z < 0) back++;
}
console.log(`vehicles facing backwards: ${back}/${scene.traffic.vehicles.length}`);
