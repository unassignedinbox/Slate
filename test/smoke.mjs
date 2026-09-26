// smoke.mjs — headless logic test: builds the whole battlefield and simulates
// gameplay (walking, driving, sentries, mines, wire, tide, explosions) in Node.
import * as THREE from '../js/vendor/three.module.min.js';
import { S, CFG } from '../js/state.js';
import * as world from '../js/world.js';
import { buildProps } from '../js/props.js';
import { Car } from '../js/car.js';
import { Player } from '../js/player.js';
import { Effects } from '../js/effects.js';
import { AudioSys } from '../js/audio.js';
import { updateCombat, explode } from '../js/combat.js';

let fails = 0;
const assert = (c, msg) => {
  if (!c) { console.error('  FAIL:', msg); fails++; }
};

console.log('== building world ==');
S.scene = new THREE.Scene();
S.camera = new THREE.PerspectiveCamera(70, 1.7, 0.1, 1000);
S.effects = new Effects(S.scene);
S.audio = new AudioSys();
const t0 = Date.now();
world.buildWorld(new THREE.Vector3(-0.5, 0.8, -0.6).normalize());
buildProps();
S.car = new Car();
S.scene.add(S.car.mesh);
S.player = new Player();
S.mode = 'play';
console.log(`  built in ${Date.now() - t0}ms`);

console.log('== assertions on the battlefield ==');
assert(S.tankMines.length >= 80, `tank mines (${S.tankMines.length})`);
assert(S.apMines.length >= 40, `ap mines (${S.apMines.length})`);
assert(S.sentries.length === 16, `MG turrets = ${S.sentries.length} (want 16)`);
assert(S.obstacles.length > 120, `obstacles (${S.obstacles.length})`);
assert(S.wireSegs.length > 200, `wire segments (${S.wireSegs.length})`);
assert(S.smokeSpots && S.smokeSpots.length >= 3, 'smoke spots');

const posAttr = S.terrainMesh.geometry.attributes.position;
let bad = 0;
for (let i = 0; i < posAttr.array.length; i++) if (!Number.isFinite(posAttr.array[i])) bad++;
assert(bad === 0, `terrain NaN verts (${bad})`);
assert(posAttr.count > 50000, `terrain verts (${posAttr.count})`);

for (const [x, z] of [[0, -400], [0, -250], [0, 0], [60, 60], [-100, -60], [0, 160], [-170, -300], [120, 120]]) {
  assert(Number.isFinite(world.H(x, z)), `H finite at ${x},${z} = ${world.H(x, z)}`);
}
// trench T1 is actually carved (test away from the road crossing at -8,-232)
const t1c = world.H(52, -233), t1p = world.H(52, -225);
assert(t1c < t1p - 1.5, `trench carved (floor ${t1c.toFixed(2)} vs rim ${t1p.toFixed(2)})`);
// mound rises
assert(world.H(-70, -224) > world.H(-70, -190) + 6, 'strongpoint mound rises');
// spawn shelf is dry at low tide
assert(world.H(0, -400) > CFG.tideStart + 1, `spawn dry (H=${world.H(0, -400).toFixed(2)} vs tide ${CFG.tideStart})`);
// wall zone flat-ish
assert(world.H(0, 165) > 2.8, `wall base height ${world.H(0, 165).toFixed(2)}`);

console.log('== simulating 25s on foot (sprinting inland) ==');
const input = { fwd: 1, side: 0.15, sprint: true, jump: false };
let simT = 0;
for (let i = 0; i < 1500; i++) {
  const dt = 1 / 60;
  simT += dt; S.t += dt;
  S.player.update(dt, input);
  S.car.update(dt, { throttle: 0, steer: 0, brake: false });
  updateCombat(dt);
  S.effects.update(dt);
}
console.log(`  z=${S.player.pos.z.toFixed(1)} hp=${S.player.health.toFixed(0)} alive=${S.player.alive} waterline=${S.waterlineZ.toFixed(1)} deaths=${S.stats.deaths} mines=${S.stats.minesTripped}`);
if (!S.player.alive) { S.player.respawn(); S.mode = 'play'; }
assert(S.player.alive, 'player respawned');
assert(S.waterlineZ > -480, `tide advanced (${S.waterlineZ.toFixed(1)})`);

console.log('== simulating car run from the landing shelf (25s full throttle) ==');
S.player.inCar = true;
S.player.pos.copy(S.car.pos);
let carStartHP = S.car.health;
for (let i = 0; i < 1500; i++) {
  const dt = 1 / 60;
  S.t += dt;
  S.player.update(dt, { fwd: 0, side: 0, sprint: false, jump: false });
  S.car.update(dt, { throttle: 1, steer: 0.04, brake: false });
  updateCombat(dt);
  S.effects.update(dt);
}
console.log(`  car z=${S.car.pos.z.toFixed(1)} hp=${S.car.health.toFixed(0)} alive=${S.car.alive} disabled=${S.car.disabled} mines=${S.stats.minesTripped} deaths=${S.stats.deaths}`);
assert(S.car.pos.z > -380, 'car made progress inland');
assert(S.stats.minesTripped > 0 || S.car.health < carStartHP, 'car got hurt by something (mines/sentries)');

console.log('== sentry engagement (fresh car in the open) ==');
S.player.respawn();
S.player.inCar = false;
S.mode = 'play';
S.car = new Car();
S.scene.add(S.car.mesh);
S.car.pos.set(0, 0, 30);
S.car.updateTransform(0);
let sentryTargets = 0, sentryFrames = 0;
for (let i = 0; i < 420; i++) {
  const dt = 1 / 60;
  S.t += dt;
  S.car.update(dt, { throttle: 0.25, steer: 0, brake: false });
  updateCombat(dt);
  S.effects.update(dt);
  if (S.sentries.some((s) => s.target === 'car')) sentryFrames++;
}
console.log(`  car hp=${S.car.health.toFixed(0)} alive=${S.car.alive} frames-with-target=${sentryFrames}/420`);
assert(sentryFrames > 30, `sentries acquired the car (${sentryFrames} frames)`);
assert(S.car.health < 120, `turrets (or mines) damaged the car (hp ${S.car.health.toFixed(0)})`);

console.log('== wire damages the player ==');
S.player.respawn();
S.player.pos.set(-152, world.H(-152, -101), -101);
const hpWire = S.player.health;
S.wireSlow = 0;
for (let i = 0; i < 30; i++) updateCombat(1 / 60);
console.log(`  on wire: slow=${S.wireSlow} hp ${hpWire.toFixed(0)} -> ${S.player.health.toFixed(0)}`);
assert(S.wireSlow === 1, 'wire slows player');
assert(S.player.health < hpWire, 'wire damages player');

console.log('== forced explosion near player ==');
S.player.respawn();
S.player.pos.set(30, world.H(30, 100), 100);
const hpBefore = S.player.health;
explode(new THREE.Vector3(31, world.H(31, 100) + 0.3, 101), { radius: 6, playerDmg: 80 });
console.log(`  hp ${hpBefore.toFixed(0)} -> ${S.player.health.toFixed(0)}, alive=${S.player.alive}`);
assert(S.player.health < hpBefore || !S.player.alive, 'explosion damaged player');

console.log('== long tide sim (max out the tide) ==');
for (let i = 0; i < 60 * 500; i++) {
  updateCombat(1 / 60);
}
console.log(`  waterLevel=${S.waterLevel.toFixed(2)} (max ${CFG.tideMax}) waterlineZ=${S.waterlineZ.toFixed(1)}`);
assert(Math.abs(S.waterLevel - CFG.tideMax) < 0.01, 'tide reached max');

console.log('== wire destruction by car ==');
const wireBefore = S.wireSegs.length;
S.car.alive = true; S.car.health = 120; S.car.disabled = false; S.car.speed = 15; S.car.yaw = 0;
S.car.pos.set(-152, 0, -106);
for (let i = 0; i < 40; i++) {
  S.car.update(1 / 60, { throttle: 1, steer: 0, brake: false });
  updateCombat(1 / 60);
}
console.log(`  wire segs ${wireBefore} -> ${S.wireSegs.length}, car z=${S.car.pos.z.toFixed(1)}`);
assert(S.wireSegs.length < wireBefore, 'car smashed wire');

console.log('== effects stress ==');
for (let k = 0; k < 30; k++) S.effects.burst(0, world.H(0, 0) + 1, 0, 1.4);
for (let i = 0; i < 200; i++) S.effects.update(1 / 60);
console.log('  30 explosions + 200 ticks OK');

console.log(fails === 0 ? '\nSMOKE TEST PASSED' : `\nSMOKE TEST FAILED (${fails} failures)`);
process.exit(fails === 0 ? 0 : 1);
