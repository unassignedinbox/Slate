// Headless logic smoke test: exercises the full spider + cave build and a
// couple thousand simulated animation frames (walk / turn / wall-transition
// / threat / strike) OUTSIDE the browser, without ever touching WebGL, just
// to catch reference errors, NaNs and other logic bugs before relying on
// the live preview for visual confirmation.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.self = dom.window;

// Minimal stub 2D context: enough for our procedural-texture generation
// (createImageData/putImageData) without a real canvas backend.
dom.window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    const w = this.width, h = this.height;
    return {
      createImageData: (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }),
      putImageData: () => {},
      fillRect: () => {},
      clearRect: () => {},
      drawImage: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillStyle: null,
    };
  }
  return null;
};

const THREE = await import('three');
const { buildCave } = await import('../src/world/cave.js');
const { buildSpiderMaterials } = await import('../src/spider/materials.js');
const { SpiderController } = await import('../src/spider/controller.js');

function assertFinite(v, label) {
  if (!Number.isFinite(v)) throw new Error(`Non-finite value at ${label}: ${v}`);
}
function assertVec3Finite(v, label) {
  assertFinite(v.x, `${label}.x`); assertFinite(v.y, `${label}.y`); assertFinite(v.z, `${label}.z`);
}

console.log('Building cave...');
const cave = buildCave(20260927);
console.log(`  cave colliders: ${cave.colliders.length}`);

console.log('Building materials...');
const materials = buildSpiderMaterials();

console.log('Building spider...');
const scene = new THREE.Scene();
const start = cave.pointOnShell(0.15, 2.4);
const spider = new SpiderController(scene, materials, cave.colliders, { position: start.point });
console.log(`  legs: ${spider.legs.length}, pedipalps: ${spider.pedipalps.length}, chelicerae: ${spider.chelicerae.length}`);

function checkSpiderState(frameLabel) {
  assertVec3Finite(spider.position, `${frameLabel} position`);
  assertVec3Finite(spider.up, `${frameLabel} up`);
  assertVec3Finite(spider.forward, `${frameLabel} forward`);
  for (const leg of spider.legs) {
    assertVec3Finite(leg.footWorld, `${frameLabel} leg ${leg.pairId}${leg.side} footWorld`);
    for (let i = 0; i < leg.ikJoints.length; i++) assertVec3Finite(leg.ikJoints[i], `${frameLabel} leg ${leg.pairId}${leg.side} joint${i}`);
  }
}

const dt = 1 / 60;
let frame = 0;

console.log('Simulating idle...');
for (let i = 0; i < 60; i++) { spider.update(dt); checkSpiderState(`idle#${frame++}`); }

console.log('Simulating walk forward + turning...');
spider.setMoveInput(1, 0, false);
for (let i = 0; i < 300; i++) {
  spider.setYawInput(Math.sin(i * 0.05));
  spider.update(dt);
  checkSpiderState(`walk#${frame++}`);
}

console.log('Simulating run + strafe (should traverse onto walls/ceiling via cave curvature)...');
spider.setMoveInput(1, 0.4, true);
for (let i = 0; i < 900; i++) {
  spider.setYawInput(Math.cos(i * 0.02) * 0.6);
  spider.update(dt);
  checkSpiderState(`run#${frame++}`);
}
console.log(`  final up vector: (${spider.up.x.toFixed(2)}, ${spider.up.y.toFixed(2)}, ${spider.up.z.toFixed(2)}) -- should differ from (0,1,0) if it left the floor`);

console.log('Simulating threat display...');
spider.setMoveInput(0, 0, false);
spider.triggerThreat();
for (let i = 0; i < 90; i++) { spider.update(dt); checkSpiderState(`threat#${frame++}`); }
if (spider.state !== 'threat') throw new Error('expected state threat');
if (spider.rearAmount < 0.5) throw new Error('expected rearAmount to have risen during threat display');

console.log('Simulating strike attack...');
spider.triggerStrike();
for (let i = 0; i < 90; i++) { spider.update(dt); checkSpiderState(`strike#${frame++}`); }
if (spider.state !== 'idle') throw new Error(`expected strike to resolve back to idle, got ${spider.state}`);
if (Math.abs(spider.rearAmount) > 0.01 || Math.abs(spider.fangAmount) > 0.01) throw new Error('expected pose to fully reset after strike');

console.log('Simulating autopilot-style long traversal (5000 frames)...');
spider.setMoveInput(1, 0, false);
for (let i = 0; i < 5000; i++) {
  spider.setYawInput(Math.sin(i * 0.003) * 0.8);
  spider.update(dt);
  if (i % 500 === 0) checkSpiderState(`long#${frame++}`);
}
checkSpiderState('long#final');

console.log('Exercising Autopilot + CameraRig...');
const { Autopilot } = await import('../src/ui/autopilot.js');
const { CameraRig } = await import('../src/ui/camera.js');
const camera = new THREE.PerspectiveCamera(52, 1.6, 0.01, 40);
const domStub = document.createElement('canvas');
const cameraRig = new CameraRig(camera, domStub, spider, cave.colliders);
const autopilot = new Autopilot(cave, spider);
autopilot.toggle();
for (const mode of ['Follow', 'Free Orbit', 'Cinematic', 'Follow']) {
  while (cameraRig.cycle() !== mode) { /* spin to mode (defensive, should be immediate) */ break; }
}
cameraRig.cycle(); // Free Orbit
cameraRig.cycle(); // Cinematic
cameraRig.cycle(); // back to Follow
for (let i = 0; i < 400; i++) {
  autopilot.update(dt);
  spider.update(dt);
  cameraRig.update(dt);
  checkSpiderState(`autopilot#${frame++}`);
  assertVec3Finite(camera.position, `autopilot#${i} camera.position`);
}
autopilot.toggle();
console.log('  autopilot + camera rig OK');

console.log(`\nOK — ${frame} frames simulated with no exceptions or NaNs.`);
console.log(`Hair instances (sanity, prosoma): ${spider.bodyParts.prosoma.children.filter(c=>c.userData?.isFur).map(c=>c.userData.hairCount)}`);
