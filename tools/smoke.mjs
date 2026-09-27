/**
 * Headless smoke test: builds the circuit + car in Node (with a tiny canvas
 * stub) and drives an AI lap to verify geometry, collision and lap timing.
 *
 *   node tools/smoke.mjs
 */
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------- DOM stub
function ctx2d() {
  const noop = () => {};
  return new Proxy(
    {
      canvas: { width: 512, height: 512 },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      globalAlpha: 1,
      textAlign: '',
      textBaseline: '',
      lineCap: '',
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: noop,
      createRadialGradient: () => ({ addColorStop: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 10 }),
    },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) }
  );
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d(), style: {} }),
  createElementNS: () => ({ style: {} }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { toggle: () => {} } },
};
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, innerWidth: 1280, innerHeight: 720 };
globalThis.self = globalThis.window;

const THREE = await import('three');
const { Track } = await import('../src/track.js');
const { Car, buildCarMesh, LIVERIES } = await import('../src/car.js');
const { buildEnvironment, drawJumbotron } = await import('../src/environment.js');

let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail++;
};

// ------------------------------------------------------------------ build
let t0 = performance.now();
const track = new Track();
const buildMs = performance.now() - t0;

let tris = 0;
track.group.traverse((o) => {
  if (o.isMesh && o.geometry) {
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
});

console.log('\n=== CIRCUIT ===');
console.log(`  length      ${track.length.toFixed(1)} m`);
console.log(`  samples     ${track.N} (${track.ds.toFixed(2)} m apart)`);
console.log(`  build       ${buildMs.toFixed(0)} ms, ~${Math.round(tris).toLocaleString()} triangles`);
const maxBank = Math.max(...track.banks);
const minBank = Math.min(...track.banks);
const ys = track.centers.map((c) => c.y);
console.log(`  bank range  ${((minBank * 180) / Math.PI).toFixed(1)}° … ${((maxBank * 180) / Math.PI).toFixed(1)}°`);
console.log(`  elevation   ${Math.min(...ys).toFixed(1)} m … ${Math.max(...ys).toFixed(1)} m`);

check('track is a sane length', track.length > 1000 && track.length < 3000, `${track.length.toFixed(0)} m`);
check('banking reaches the bowls', Math.max(Math.abs(maxBank), Math.abs(minBank)) > 0.3);
check('all frames finite', track.centers.every((c) => isFinite(c.x + c.y + c.z)));
check('start gantry built', track.startLights.length === 5);
check('tunnel section found', Array.isArray(track.tunnelRun) && track.tunnelRun.length > 10, `${track.tunnelRun?.length} samples`);

// crossover: bridge must clear the tunnel road
let clearance = Infinity;
for (let i = 0; i < track.N; i++) {
  for (let j = 0; j < track.N; j++) {
    const a = track.centers[i];
    const b = track.centers[j];
    const cyc = Math.min((i - j + track.N) % track.N, (j - i + track.N) % track.N);
    if (cyc < 60) continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < 8) clearance = Math.min(clearance, Math.abs(a.y - b.y));
  }
}
console.log(`  crossover clearance ${clearance === Infinity ? 'n/a' : clearance.toFixed(1) + ' m'}`);
check('bridge clears the undercross', clearance > 11);

// --------------------------------------------------------- environment
const scene = new THREE.Scene();
t0 = performance.now();
const env = buildEnvironment(scene);
const envMs = performance.now() - t0;
let envTris = 0;
scene.traverse((o) => {
  if (o.isMesh && o.geometry) {
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    envTris += n * (o.isInstancedMesh ? o.count : 1);
  }
});
console.log('\n=== STADIUM ===');
console.log(`  build       ${envMs.toFixed(0)} ms, ~${Math.round(envTris).toLocaleString()} triangles (incl. instances)`);
check('stadium + sky + zalem built', scene.children.length > 6, `${scene.children.length} roots`);
check('two jumbotrons', env.screens.length === 2);
drawJumbotron(env.screens[0], { kmh: 240, lap: '2/5', best: '0:31.900' });

// car meshes for every livery
for (let i = 0; i < LIVERIES.length; i++) {
  const m = buildCarMesh(i);
  check(`car mesh builds: ${LIVERIES[i].name}`, m.children.length > 20, `${m.children.length} parts`);
}

// ----------------------------------------------------------- drive a lap
const car = new Car(track, 0);
const input = { throttle: 1, brake: 0, steer: 0, boost: false, handbrake: false };
const dt = 1 / 60;
let index = car.hint;
let travelled = 0;
let maxSpeed = 0;
let stuck = 0;
let laps = 0;
let lapTime = 0;
let halfway = false;
const start = track.startIndex;
const half = (start + Math.floor(track.N / 2)) % track.N;

t0 = performance.now();
for (let step = 0; step < 60 * 180; step++) {
  // simple pursuit driver: aim 22 m down the track, on the racing line
  const look = (car.hint + Math.round(24 / track.ds)) % track.N;
  const target = track.pointAt(look, 0, 0.5);
  const toT = target.clone().sub(car.position);
  const yawWanted = Math.atan2(toT.x, toT.z);
  let diff = yawWanted - car.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  input.steer = Math.max(-1, Math.min(1, diff * 2.4));
  input.throttle = Math.abs(diff) > 0.42 ? 0.35 : 1;
  input.brake = Math.abs(diff) > 0.75 && car.kmh > 150 ? 1 : 0;
  input.boost = Math.abs(diff) < 0.06 && car.kmh < 260;

  const prev = car.hint;
  car.update(dt, input, false);
  if (!isFinite(car.position.x + car.position.y + car.position.z)) {
    check('physics stayed finite', false, `NaN at step ${step}`);
    break;
  }
  const d = (car.hint - prev + track.N) % track.N;
  if (d > 0 && d < track.N / 2) {
    travelled += d * track.ds;
    const contains = (tgt) => ((tgt - prev + track.N) % track.N) > 0 && ((tgt - prev + track.N) % track.N) <= d;
    if (contains(half)) halfway = true;
    if (contains(start) && halfway) {
      halfway = false;
      laps++;
      console.log(`  lap ${laps}: ${lapTime.toFixed(2)} s`);
      lapTime = 0;
      if (laps >= 2) break;
    }
  }
  lapTime += dt;
  maxSpeed = Math.max(maxSpeed, car.kmh);
  if (car.kmh < 6) stuck++;
  else stuck = 0;
  if (stuck > 60 * 4) {
    check('car never got stuck', false, `stuck at index ${car.hint} (${car.position.x.toFixed(0)}, ${car.position.z.toFixed(0)})`);
    break;
  }
  index = car.hint;
}
const simMs = performance.now() - t0;

console.log('\n=== DRIVE TEST ===');
console.log(`  distance    ${travelled.toFixed(0)} m`);
console.log(`  top speed   ${maxSpeed.toFixed(0)} km/h`);
console.log(`  sim cost    ${(simMs / (60 * 180) * 1000).toFixed(1)} µs/step`);
check('AI completed 2 laps', laps >= 2, `${laps} laps`);
check('reached racing speed', maxSpeed > 220, `${maxSpeed.toFixed(0)} km/h`);
check('car stayed on the road', Math.abs(car.surf.u) <= car.surf.halfWidth + 1);
void index;

console.log(fail === 0 ? '\nALL CHECKS PASSED\n' : `\n${fail} CHECK(S) FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
