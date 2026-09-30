/* Tuning view for the portable dent bake: every type at full damage, lit from
   a raking angle so fold lines read. */
import { bakeDentAtlas, DENT_TYPES } from '../src/frac/dentmap';
import { Canvas, View, drawShell, v3 } from './raster';

const RES = Number(process.env.RES ?? 48);
const FR = Number(process.env.FR ?? 12);
const atlas = bakeDentAtlas(RES, FR);
const W = 700, H = 640;
const c = new Canvas(W * atlas.types.length, H);

atlas.types.forEach((ty, ti) => {
  const half = ty.half, R = atlas.res;
  const pos = new Float32Array(R * R * 3);
  const tris: number[] = [];
  const f = atlas.frames - 1;
  let lo = 0, hi = 0, strain = 0;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = j * R + i;
    const s = ((ti * atlas.frames + f) * R * R + k) * 4;
    pos[k * 3] = (i / (R - 1) - 0.5) * 2 * half + atlas.pos[s];
    pos[k * 3 + 1] = (j / (R - 1) - 0.5) * 2 * half + atlas.pos[s + 1];
    pos[k * 3 + 2] = atlas.pos[s + 2];
    lo = Math.min(lo, atlas.pos[s + 2]); hi = Math.max(hi, atlas.pos[s + 2]);
    strain = Math.max(strain, atlas.pos[s + 3]);
  }
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < R - 1; i++) {
    const a = j * R + i;
    tris.push(a, a + 1, a + R + 1, a, a + R + 1, a + R);
  }
  console.log(`${ty.label.padEnd(26)} depth ${(lo * 1000).toFixed(1)} mm  lip +${(hi * 1000).toFixed(1)} mm  strain ${strain.toFixed(2)}`);
  const view: View = {
    eye: v3(0.22, -0.70, 0.52), ctr: v3(0, 0, -0.02), scale: 0.80,
    vx: ti * W, vy: 0, vw: W, vh: H,
  };
  drawShell(c, view, pos, new Uint32Array(tris), [118, 124, 134]);
});
console.log(`atlas ${atlas.types.length}x${atlas.frames}x${atlas.res}^2 = ` +
  `${((atlas.pos.length + atlas.nrm.length) * 4 / 1048576).toFixed(2)} MB in ${atlas.ms.toFixed(0)} ms`);
c.save('/tmp/dentmap.png');
