/* Headless check of the portable (stamped) dent path: the same maths the
   vertex shader runs, evaluated on the CPU and rasterised. */
import { makeScene, SCENES, SheetScene, CarScene } from '../src/app/scenes';
import { bakeDentAtlas } from '../src/frac/dentmap';
import { DentField } from '../src/app/dentfield';
import { shellNormals } from '../src/geom/carbody';
import { Canvas, View, drawShell, v3 } from './raster';

const atlas = bakeDentAtlas();
console.log(`dent library: ${atlas.types.length} types, ${atlas.frames} frames, ${atlas.res}^2, ` +
  `${((atlas.pos.length + atlas.nrm.length) * 4 / 1048576).toFixed(2)} MB, ${atlas.ms.toFixed(0)} ms bake`);

const W = 620, H = 470;
const c = new Canvas(W * 4, H);

// ---------------------------------------------------------------- sheet panel
const sheet = makeScene(SCENES.find((s) => s.id === 'sheet')!) as SheetScene;
sheet.dents = new DentField(atlas);
const shots: [number, number, number][] = [
  [-0.42, 0.22, 2600], [0.30, -0.10, 900], [0.52, 0.30, 12000],
  [-0.30, -0.28, 5000], [-0.34, -0.24, 5000],   // two close hits -> one deeper dent
];
for (const [x, y, e] of shots) {
  sheet.hit(v3(x, sheet.originY + y, sheet.T / 2), v3(0, 0, -1), e);
}
for (const d of sheet.dents.items) d.level = d.target;
console.log(`sheet: ${shots.length} shots -> ${sheet.dents.items.length} dent instances (${sheet.dents.describe()})`);

const pos = new Float32Array(sheet.shell.pos);
let deepest = 0;
for (let i = 0; i < sheet.shell.n; i++) {
  const p = v3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const { d } = sheet.dents.sample(p);
  pos[i * 3] += d.x; pos[i * 3 + 1] += d.y; pos[i * 3 + 2] += d.z;
  deepest = Math.max(deepest, Math.hypot(d.x, d.y, d.z));
}
console.log(`sheet: deepest displacement ${(deepest * 1000).toFixed(1)} mm`);
const vw = (i: number, eye: [number, number, number], ctr: [number, number, number], sc: number): View =>
  ({ eye: v3(...eye), ctr: v3(...ctr), scale: sc, vx: i * W, vy: 0, vw: W, vh: H });
drawShell(c, vw(0, [0.35, 0.45, 1.9], [0, 0, 0], 0.75), pos, sheet.shell.tris, [96, 104, 116]);
drawShell(c, vw(1, [1.15, 0.30, 0.62], [0, 0, 0], 0.62), pos, sheet.shell.tris, [96, 104, 116]);

// ------------------------------------------------------------------- car body
const car = makeScene(SCENES.find((s) => s.id === 'car')!) as CarScene;
car.dents = new DentField(atlas);
const hits: [number, number, number, number][] = [
  [0.34, 0.12, 0.92, 9000],    // driver's door, pole
  [-1.25, 0.10, 0.90, 14000],  // rear quarter, another car's corner
  [0.95, 0.52, 0.30, 2600],    // bonnet, someone sat on it
  [-0.55, 0.78, -0.25, 1100],  // roof, blunt
  [0.30, -0.18, 0.95, 4000],   // sill, kerb strike
];
for (const [x, y, z, e] of hits) {
  const p = v3(x, y, z);
  car.dents.add(p, car.rig.normalAt(p), v3(-0.2, -0.3, -1), e);
}
for (const d of car.dents.items) d.level = d.target;
const cpos = new Float32Array(car.rig.shell.pos);
for (let i = 0; i < car.rig.shell.n; i++) {
  const p = v3(cpos[i * 3], cpos[i * 3 + 1], cpos[i * 3 + 2]);
  const { d } = car.dents.sample(p);
  cpos[i * 3] += d.x; cpos[i * 3 + 1] += d.y; cpos[i * 3 + 2] += d.z;
}
shellNormals(cpos, car.rig.shell.tris);
console.log(`car: ${car.dents.items.length} stamped dents, no per-site bake used`);
drawShell(c, vw(2, [3.4, 1.6, 3.8], [0, 0.2, 0], 0.62), cpos, car.rig.shell.tris, [34, 62, 106]);
drawShell(c, vw(3, [1.8, 0.9, 2.6], [0.25, 0.15, 0.45], 0.62), cpos, car.rig.shell.tris, [34, 62, 106]);

c.save('/tmp/sheet.png');
console.log('wrote /tmp/sheet.png');
