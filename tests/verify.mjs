// Node verification (no GPU): scene build, card packing, course physics, mesh-DF bake sanity.
import { buildScene, buildCards } from '../src/scene.js';
import { courseHeight, coneOrigin } from '../src/course.js';
import { bakeMeshDF } from '../src/meshdf.js';
import { Vehicle } from '../src/vehicle.js';
import { buildShaders } from '../src/shaders.js';

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) fails++; };

const scene = buildScene();
check('placements built', scene.placements.length >= 30, `(${scene.placements.length})`);
check('body mesh is ControlVehicle', scene.meshes[0].positions.length / 9 === 2924, `(${scene.meshes[0].positions.length / 9} tris)`);
const cards = buildCards(scene, 1024, 512);
check('cards generated', cards.cards.length > 80, `(${cards.cards.length})`);
check('card templates per mesh', cards.templatesByMesh.every(t => t.length >= 1 && t.length <= 6));
// atlas overlap audit
const seen = new Set(); let overlap = false;
for (const c of cards.cards) for (let y = 0; y < c.res[1]; y++) for (let x = 0; x < c.res[0]; x++) {
  const k = (c.atlas[1] + y) * 1024 + c.atlas[0] + x; if (seen.has(k)) overlap = true; seen.add(k);
}
check('atlas packing has no overlaps', !overlap, `(${seen.size} texels)`);
check('dynamic texels are vehicle+wheels only', cards.dynamicTexels.length > 1000, `(${cards.dynamicTexels.length})`);

// DriveCourse physics replica against DriveCourse.h numbers
check('ramp height at crest', Math.abs(courseHeight(15, 0) - 1.35) < 1e-6, `(${courseHeight(15, 0)})`);
check('ramp height mid', Math.abs(courseHeight(12, 0) - 0.675) < 1e-6);
check('speed bump peak', Math.abs(courseHeight(-7, 0) - 0.11) < 1e-6, `(${courseHeight(-7, 0)})`);
check('kerb top', courseHeight(0, 3.3) === 0.12);
check('flat pad', courseHeight(30, -20) === 0);
check('cone layout', JSON.stringify(coneOrigin(3)) === JSON.stringify([33, -2.4]));

// Mesh DF bake: unit box must be signed correctly (inside negative, outside positive)
const boxMesh = scene.meshes.find(m => m.name.startsWith('Unit box'));
const df = await bakeMeshDF({ ...boxMesh, dfLongest: 16 }, null);
const at = (x, y, z) => {
  const res = df.res, cell = df.bmax.map((v, i) => (v - df.bmin[i]) / res[i]);
  const ix = Math.round((x - df.bmin[0]) / cell[0] - 0.5), iy = Math.round((y - df.bmin[1]) / cell[1] - 0.5), iz = Math.round((z - df.bmin[2]) / cell[2] - 0.5);
  return df.dist[(iz * res[1] + iy) * res[0] + ix];
};
check('box DF inside is negative', at(0, 0, 0) < -0.3, `(${at(0,0,0).toFixed(3)})`);
check('box DF outside is positive (inside padded bounds)', at(0.60, 0, 0) > 0.03, `(${at(0.60,0,0).toFixed(3)})`);
check('box DF near face ~0', Math.abs(at(0.52, 0, 0)) < 0.12, `(${at(0.52,0,0).toFixed(3)})`);
check('box DF finite everywhere', df.dist.every(Number.isFinite));

// Vehicle actually drives and climbs (auto-drive route)
const v = new Vehicle(); const start = [...v.pos];
for (let i = 0; i < 60 * 20; i++) v.step(1 / 60, {});
const moved = Math.hypot(v.pos[0] - start[0], v.pos[1] - start[1]);
check('vehicle moves under auto-drive', moved > 15, `(${moved.toFixed(1)} m in 20 s, speed ${(v.speed*3.6).toFixed(0)} km/h)`);

// Shader generation + forbidden-cheat audit
const shaders = buildShaders({ ATLAS_N: 1024 * 512, GDF_N: 64 ** 3, triCount: 8000, dynCount: cards.dynamicTexels.length, staticCount: cards.staticTexels.length });
const all = Object.values(shaders).join('\n');
for (const stage of ['traceGDF', 'sampleMeshDF', 'sampleGDF', 'findCard', 'hemisphereDir', 'softShadowGDF'])
  check(`WGSL contains ${stage}`, all.includes(stage));
// Presentation orientation: WebGPU UV origin is top-left, clip y=-1 is the
// framebuffer bottom — the blit must flip v, or the frame presents upside down.
check('blit flips v so the frame is not upside down', shaders.BLIT.includes('vec2f(p.x, 1.0 - p.y)'));
check('no alias-table anywhere', !/alias/i.test(all));
check('no triangle trace in GI (no triIntersect/rayTri)', !/intersectTri|rayTriangle|TriangleIntersect/i.test(all));
console.log(fails ? `\n${fails} FAILURES` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
