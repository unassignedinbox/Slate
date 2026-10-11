import { buildScene, defaultSettings } from '../../src/road/scene.js';
const preset = process.argv[2] || 'downtown';
const scene = buildScene(defaultSettings(preset));
const g = scene.ground, S = 20, GC = 12, gh = new Map();
for (let t = 0; t < g.indices.length; t += 3) {
  const T = [0, 1, 2].map((k) => {
    const o = g.indices[t + k] * S;
    return { x: g.vertices[o], y: g.vertices[o + 1], z: g.vertices[o + 2] };
  });
  const mnx = Math.min(T[0].x, T[1].x, T[2].x), mxx = Math.max(T[0].x, T[1].x, T[2].x);
  const mnz = Math.min(T[0].z, T[1].z, T[2].z), mxz = Math.max(T[0].z, T[1].z, T[2].z);
  for (let i = Math.floor(mnx / GC); i <= Math.floor(mxx / GC); i++)
    for (let j = Math.floor(mnz / GC); j <= Math.floor(mxz / GC); j++) {
      const k = `${i},${j}`; let l = gh.get(k); if (!l) gh.set(k, (l = [])); l.push(T);
    }
}
const groundAt = (x, z) => {
  const l = gh.get(`${Math.floor(x / GC)},${Math.floor(z / GC)}`); if (!l) return null;
  let best = null;
  for (const T of l) {
    const [a, b, c] = T;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-9) continue;
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    const w = 1 - u - v; if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
    const y = u * a.y + v * b.y + w * c.y; if (best === null || y > best) best = y;
  }
  return best;
};
for (const info of scene.surface.junctions.values()) {
  let bad = 0, worst = 0;
  for (let a = 0; a < 12; a++) for (const f of [0.3, 0.6, 0.9]) {
    const r = info.radius * f;
    const x = info.centre.x + Math.cos((a / 12) * Math.PI * 2) * r;
    const z = info.centre.z + Math.sin((a / 12) * Math.PI * 2) * r;
    const gy = groundAt(x, z);
    if (gy !== null && gy > (info.centre.y ?? 0) + 0.05) { bad++; worst = Math.max(worst, gy - info.centre.y); }
  }
  if (bad) console.log(info.id, info.kind, 'r', info.radius.toFixed(1), 'centre', info.centre.x.toFixed(1), info.centre.y.toFixed(2), info.centre.z.toFixed(1), 'bad', bad, 'worst', worst.toFixed(2));
}
