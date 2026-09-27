// Headless smoke test: build Track/World/car with DOM stubs and sanity-check
// pure math (curve length, locate() accuracy, banking, finite geometry).
// Run: node test/smoke.mjs
import * as THREE from 'three';

// ---- DOM stubs for canvas-texture usage
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return {};
    return (...a) => gradient;
  },
  set() { return true; },
});
globalThis.document = {
  createElement(tag) {
    return {
      tag, width: 0, height: 0,
      getContext: () => ctx2d,
      classList: { add() {}, toggle() {} },
      style: {},
      addEventListener() {},
    };
  },
  getElementById: () => null,
  body: { appendChild() {} },
};
globalThis.window = { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { Track } = await import('../src/track.js');
const { World } = await import('../src/world.js');
const { buildCar } = await import('../src/car.js');

const scene = new THREE.Scene();
const track = new Track(scene);
let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) fails++;
};

// 1. circuit length plausible (should be a ~1.5–2 km roval)
check('length in range', track.length > 1200 && track.length < 2600, `${track.length.toFixed(0)} m`);

// 2. samples finite
let finite = true;
for (let i = 0; i < track.N; i++) {
  const p = track.sPos[i];
  if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) { finite = false; break; }
}
check('samples finite', finite);

// 3. locate(): every sample's centerline must report progress close to its own index
let maxPU = 0, maxD = 0;
for (let i = 0; i < track.N; i += 7) {
  const p = track.sPos[i];
  const loc = track.locate(p.x, p.z);
  let dp = Math.abs(loc.progress - i / track.N);
  dp = Math.min(dp, 1 - dp);
  maxPU = Math.max(maxPU, dp);
  maxD = Math.max(maxD, Math.abs(loc.d));
}
check('locate() progress error', maxPU < 0.01, `max ${(maxPU * 100).toFixed(3)}% of lap`);
check('locate() centerline lateral ≈ 0', maxD < 0.5, `max ${maxD.toFixed(3)} m`);

// 4. cross-track self-interference: points on the esses & bowl must locate correctly
//    (nearest-branches ambiguity would blow this up)
const esses = track.sPos[Math.floor(track.N * 0.42)];
const bowl = track.sPos[Math.floor(track.N * 0.70)];
check('esses locate', Math.abs(track.locate(esses.x, esses.z).d) < 0.5);
check('bowl locate', Math.abs(track.locate(bowl.x, bowl.z).d) < 0.5);

// 5. banking range sane
let minB = 99, maxB = -99;
for (const b of track.sBank) { minB = Math.min(minB, b); maxB = Math.max(maxB, b); }
check('bank max ~18deg', maxB > 0.28 && maxB < 0.36, `${THREE.MathUtils.radToDeg(maxB).toFixed(1)}°`);
check('bank min small negative', minB < 0 && minB > -0.12, `${THREE.MathUtils.radToDeg(minB).toFixed(1)}°`);

// 6. lateral wall points stay sensible on banking (car y at wall base finite)
let wl = 0;
for (let i = 1; i < track.N; i += 3) {
  for (const o of [-13.5, 13.5]) {
    const V = track.surfacePoint(i, o);
    if (!isFinite(V.x + V.y + V.z)) wl++;
  }
}
check('wall-base surface points finite', wl === 0);

// 7. road geometry buffers well-formed
const road = track.group.children.find(c => c.geometry && c.geometry.attributes.position.count === track.N * 5);
check('road ribbon built', !!road,
  road ? `${road.geometry.attributes.position.count} verts` : 'not found');
if (road) {
  const arr = road.geometry.attributes.position.array;
  let bad = 0;
  for (let i = 0; i < arr.length; i++) if (!isFinite(arr[i])) bad++;
  check('road verts finite', bad === 0, bad + ' bad');
}

// 8. no duplicate/degenerate curve segments (tangent never NaN)
let tanOK = true;
for (let i = 0; i < track.N; i++) {
  const t = track.sTan[i];
  if (!isFinite(t.x) || !isFinite(t.z) || Math.abs(t.length() - 1) > 0.001) { tanOK = false; break; }
}
check('tangents unit & finite', tanOK);

// 9. spawn pose at start line points roughly along +x (main straight east)
const sp = track.spawnPose(0.0);
check('spawn heading +x', Math.abs(Math.sin(sp.yaw)) > 0.95, `sin(yaw)=${Math.sin(sp.yaw).toFixed(2)}`);

// 10. World + car build without throwing and produce meshes
const world = new World(scene, track);
const car = buildCar(scene);
let meshCount = 0;
scene.traverse(o => { if (o.isMesh || o.isPoints || o.isSprite) meshCount++; });
check('scene populated', meshCount > 50, `${meshCount} drawables`);
check('car has 4 wheels', car.wheels.length === 4);
check('car front axle steerable', car.frontAxle.length === 2);

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
