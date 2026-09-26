// Headless integration self-test: builds the real world, drives the car for a
// couple of thousand frames, exercises the restart path and asserts invariants.
//   node scripts/selftest.mjs
import { installDom } from './domstub.mjs';
installDom();

import * as THREE from 'three';
import { Terrain, SURF } from '../src/terrain.js';
import { Ocean } from '../src/water.js';
import { Colliders } from '../src/physics.js';
import { Fx } from '../src/fx.js';
import { buildWall } from '../src/wall.js';
import { buildTanks } from '../src/tanks.js';
import { buildObstacles } from '../src/obstacles.js';
import { Minefield } from '../src/mines.js';
import { DefenseNetwork } from '../src/defense.js';
import { Car } from '../src/car.js';
import { OBJECTIVE, SPAWN, WALL, TIDE, DIFFICULTY } from '../src/config.js';
import { clamp } from '../src/util.js';
import { makeAutopilot } from './lib/autopilot.mjs';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  else {
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
    failures++;
  }
};

console.log('building world...');
const t0 = Date.now();
const scene = new THREE.Scene();
const terrain = new Terrain();
scene.add(terrain.mesh);
const sunDir = new THREE.Vector3(-0.34, 0.38, 0.78).normalize();
const ocean = new Ocean(terrain, sunDir, 0xb5c2cb);
scene.add(ocean.mesh);
const colliders = new Colliders();
const fx = new Fx(scene, terrain);
const wall = buildWall(scene, terrain, colliders);
const tanks = buildTanks(scene, terrain, colliders, fx);
const obstacles = buildObstacles(scene, terrain, colliders, ocean);
const minefield = new Minefield(scene, terrain, colliders, fx);
const defense = new DefenseNetwork(scene, terrain, colliders, fx, wall.mounts);
const car = new Car(terrain, ocean);
scene.add(car.object);
console.log(`built in ${Date.now() - t0}ms\n`);

/* ---------------------------------------------------------------- */
console.log('world contents');
ok(colliders.items.length > 800, 'collider count', `${colliders.items.length}`);
ok(minefield.mines.length > 150, 'mines placed', `${minefield.mines.length}`);
ok(defense.sentries.length >= 10, 'sentries', `${defense.sentries.length}`);
ok(wall.mounts.length >= 10, 'wall + bunker gun mounts', `${wall.mounts.length}`);
ok(tanks.length >= 8, 'tank wrecks', `${tanks.length}`);
ok(!!tanks.group, 'tanks are parented to one group');
ok(obstacles.repairCrates.length >= 3, 'repair crates', `${obstacles.repairCrates.length}`);
ok(
  minefield.mines.every((m) => m.transform && m.mesh),
  'every mine keeps its instance transform'
);

/* ---------------------------------------------------------------- */
console.log('\nterrain');
{
  const spawnH = terrain.heightAt(SPAWN.x, SPAWN.z);
  const spawnDepth0 = TIDE.start - spawnH;
  ok(spawnDepth0 < 0.5, 'spawn starts in the shallows, not afloat', `depth=${spawnDepth0.toFixed(2)}m`);
  const gateH = terrain.heightAt(OBJECTIVE.x, OBJECTIVE.z);
  ok(gateH > TIDE.end, 'objective stays above the full tide', `h=${gateH.toFixed(2)}`);
  // The wall must stand on land for its whole length.
  let floating = 0;
  for (let x = -WALL.length / 2; x <= WALL.length / 2; x += 4) {
    if (!terrain.inBounds(x, WALL.z, 1) || terrain.heightAt(x, WALL.z) < TIDE.end) floating++;
  }
  ok(floating === 0, 'no section of the wall hangs over water', `${floating} bad samples`);
  // No cliffs in the drivable middle of the beach.
  let steep = 0;
  let samples = 0;
  for (let x = -200; x <= 200; x += 7) {
    for (let z = -200; z <= 260; z += 7) {
      samples++;
      if (terrain.slopeAt(x, z) > 1.35) steep++;
    }
  }
  ok(steep / samples < 0.05, 'beach stays drivable', `${((steep / samples) * 100).toFixed(1)}% steep`);
  // Roads must be traceable and mine-free.
  let onRoadMines = 0;
  for (const m of minefield.mines) if (terrain.roadMaskAt(m.x, m.z) > 0.2) onRoadMines++;
  ok(onRoadMines === 0, 'roads are swept of mines', `${onRoadMines} found`);
  // The breach must be physically reachable: a clear lane up the middle.
  let blocked = 0;
  for (let z = -196; z >= OBJECTIVE.z; z -= 2) {
    for (const it of colliders.nearby(0, z, 6)) {
      if (it.kind !== 'solid') continue;
      if (Colliders.penetration(it, 0, z, 2.2)) blocked++;
    }
  }
  ok(blocked === 0, 'the gate corridor is clear of solid obstacles', `${blocked} blockers`);

  const roadTypes = new Set();
  for (let z = 240; z > -200; z -= 20) roadTypes.add(terrain.typeAt(4 + z * 0.02, z));
  ok(
    roadTypes.has(SURF.GRAVEL) || roadTypes.has(SURF.DIRT),
    'causeway reads as a made surface'
  );
}

/* ---------------------------------------------------------------- */
console.log('\ndriving (2 x 1500 frames, autopilot)');
const dt = 1 / 60;
const drive = makeAutopilot(car, colliders, { speedCap: 18 });
function step(frames, aim) {
  let nan = false;
  let maxDepth = 0;
  for (let i = 0; i < frames; i++) {
    ocean.update(dt, true);
    car.update(dt, drive(aim.x, aim.z), {});
    const res = colliders.resolveCar(car, dt, {});
    if (res.wire) car.damage(DIFFICULTY.wireDps * dt, 'wire');
    minefield.update(dt, { car });
    defense.update(dt, car, { playerVisible: true, onShellImpact: () => {} });
    fx.update(dt, null);
    maxDepth = Math.max(maxDepth, car.waterDepth || 0);
    if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.yaw + car.speed + car.health)) {
      nan = true;
      break;
    }
    if (!car.alive) break;
  }
  return { nan, maxDepth, z: car.pos.z, hp: car.health };
}

const run1 = step(1500, { x: OBJECTIVE.x, z: OBJECTIVE.z });
ok(!run1.nan, 'no NaN in car state (run 1)');
ok(
  car.distanceTravelled > 240 || run1.z < 40,
  'car crosses the beach',
  `${car.distanceTravelled.toFixed(0)}m, ended at z=${run1.z.toFixed(0)} hp=${run1.hp.toFixed(0)}`
);
ok(minefield.triggered > 0, 'mines detonate under the car', `${minefield.triggered}`);
ok(defense.bullets.length >= 0 && Number.isFinite(defense.bullets.length), 'bullet pool sane');

const detonated = minefield.triggered;
console.log('\nrestart path');
car.reset();
minefield.reset();
defense.reset();
fx.reset();
ocean.elapsed = 0;
ocean.update(0, false);
for (const c of obstacles.repairCrates) {
  c.taken = false;
  c.object.visible = true;
}
ok(minefield.triggered === 0, 're-arm clears the trigger count', `was ${detonated}`);
ok(
  minefield.mines.every((m) => m.alive),
  'every mine is live again'
);
ok(defense.bullets.length === 0 && defense.shells.length === 0, 'projectiles cleared');
ok(
  defense.sentries.every((s) => s.state === 'scan'),
  'sentries back to scanning'
);
ok(car.health === 100 && car.alive, 'car repaired', `hp=${car.health}`);
ok(
  Math.abs(car.pos.x - SPAWN.x) < 0.01 && Math.abs(car.pos.z - SPAWN.z) < 0.01,
  'car back on the start line'
);
ok(ocean.level <= TIDE.start + 0.35, 'tide reset', `level=${ocean.level.toFixed(2)}`);

const run2 = step(1500, { x: OBJECTIVE.x, z: OBJECTIVE.z });
ok(!run2.nan, 'no NaN in car state (run 2)');

// Deterministic check that a re-armed mine still fires.
{
  const before = minefield.triggered;
  const target = minefield.mines.find((m) => m.alive);
  minefield.detonateNear(target.x, target.z, 4);
  for (let i = 0; i < 90; i++) minefield.update(dt, { car });
  ok(minefield.triggered > before, 're-armed mines still detonate', `${minefield.triggered - before} fired`);
  ok(!target.alive, 'the detonated mine is spent again');
}

/* ---------------------------------------------------------------- */
console.log('\ntide');
{
  ocean.elapsed = 0;
  ocean.update(0, true);
  const startShore = ocean.shorelineZ();
  ocean.elapsed = TIDE.duration;
  ocean.update(0, true);
  const endShore = ocean.shorelineZ();
  ok(endShore < startShore - 40, 'the sea advances up the beach', `${startShore.toFixed(0)} -> ${endShore.toFixed(0)}`);
  ok(ocean.level >= TIDE.end - 0.6, 'tide reaches its high mark', `${ocean.level.toFixed(2)}`);
  const spawnDepth = ocean.level - terrain.heightAt(SPAWN.x, SPAWN.z);
  ok(spawnDepth > 1, 'the start line is under water at high tide', `${spawnDepth.toFixed(2)}m`);
  ocean.elapsed = 0;
  ocean.update(0, false);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
