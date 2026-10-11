import { sunMatrix } from '../../src/core/camera.js';
const m = new Float32Array(16);
const el = 0.72, az = 1.15;
const sun = { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
sunMatrix(m, sun, { x: 0, y: 0, z: 0 }, 200);
const proj = (p) => {
  const x = m[0]*p.x + m[4]*p.y + m[8]*p.z + m[12];
  const y = m[1]*p.x + m[5]*p.y + m[9]*p.z + m[13];
  const z = m[2]*p.x + m[6]*p.y + m[10]*p.z + m[14];
  const w = m[3]*p.x + m[7]*p.y + m[11]*p.z + m[15];
  return { x: x/w, y: y/w, z: z/w };
};
const ground = proj({ x: 0, y: 0, z: 0 });
const high = proj({ x: 0, y: 12, z: 0 });      // a lamp post top: closer to the sun => smaller depth
const far = proj({ x: 120, y: 0, z: -90 });
console.log('centre ndc', ground.x.toFixed(3), ground.y.toFixed(3), 'depth', ground.z.toFixed(4));
console.log('12 m up   depth', high.z.toFixed(4), high.z < ground.z ? '(nearer the light ✓)' : '(FARTHER — matrix is flipped ✗)');
console.log('offset pt ndc', far.x.toFixed(3), far.y.toFixed(3), 'inside frustum:', Math.abs(far.x) < 1 && Math.abs(far.y) < 1 && far.z > 0 && far.z < 1);
