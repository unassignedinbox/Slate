// Headless gameplay simulation (dev tool).
// Drives the car with a simple autopilot so physics, collisions, mines and the
// defence network all get exercised without a browser.
//   node scripts/sim.mjs [seconds] [mode]
import { installDom } from './domstub.mjs';
installDom();

import * as THREE from 'three';
import { Terrain } from '../src/terrain.js';
import { Ocean } from '../src/water.js';
import { Colliders } from '../src/physics.js';
import { Fx } from '../src/fx.js';
import { buildWall } from '../src/wall.js';
import { buildTanks } from '../src/tanks.js';
import { buildObstacles } from '../src/obstacles.js';
import { Minefield } from '../src/mines.js';
import { DefenseNetwork } from '../src/defense.js';
import { Car } from '../src/car.js';
import { OBJECTIVE, ROADS, DIFFICULTY } from '../src/config.js';
import { resamplePolyline } from '../src/util.js';
import { makeAutopilot } from './lib/autopilot.mjs';

const seconds = Number(process.argv[2] || 150);
const mode = process.argv[3] || 'direct'; // direct | road

const scene = new THREE.Scene();
const terrain = new Terrain();
scene.add(terrain.mesh);
const sunDir = new THREE.Vector3(-0.34, 0.38, 0.78).normalize();
const ocean = new Ocean(terrain, sunDir, 0xb5c2cb);
const colliders = new Colliders();
const fx = new Fx(scene, terrain);
const wall = buildWall(scene, terrain, colliders);
buildTanks(scene, terrain, colliders, fx);
buildObstacles(scene, terrain, colliders, ocean);
const minefield = new Minefield(scene, terrain, colliders, fx);
const defense = new DefenseNetwork(scene, terrain, colliders, fx, wall.mounts);
const car = new Car(terrain, ocean);
scene.add(car.object);

console.log(
  `colliders=${colliders.items.length} occluders=${colliders.occluders.length} ` +
    `mines=${minefield.mines.length} sentries=${defense.sentries.length}`
);

// Route for the road-following bot.
const route = resamplePolyline(ROADS[0].points, 8);
// route runs beach -> wall already; skip the points behind the spawn
let startIdx = 0;
let waypoint = 0;

const dt = 1 / 60;
let t = 0;
let shots = 0;
let hitsTaken = 0;
let lastHealth = car.health;
let minSpeedStreak = 0;
let stuckEvents = 0;
const log = [];

const drive = makeAutopilot(car, colliders, { speedCap: 18 });
function autopilot() {
  let tx = OBJECTIVE.x;
  let tz = OBJECTIVE.z;
  if (mode === 'road') {
    if (waypoint === 0) {
      let best = 0;
      let bestD = Infinity;
      route.forEach((p, i) => {
        const d = Math.hypot(p[0] - car.pos.x, p[1] - car.pos.z);
        if (p[1] < car.pos.z && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      waypoint = best;
    }
    while (
      waypoint < route.length - 1 &&
      Math.hypot(route[waypoint][0] - car.pos.x, route[waypoint][1] - car.pos.z) < 16
    ) {
      waypoint++;
    }
    tx = route[waypoint][0];
    tz = route[waypoint][1];
  }
  return drive(tx, tz);
}

const ctx = { car, audio: null, listener: null };
let won = false;
let lost = false;

while (t < seconds && !won && !lost) {
  t += dt;
  ocean.update(dt, true);
  const input = autopilot();
  car.update(dt, input, { dragPenalty: 0 });
  const res = colliders.resolveCar(car, dt, {});
  if (res.wire) car.damage(5.4 * dt, 'wire');
  minefield.update(dt, ctx);
  defense.update(dt, car, {
    playerVisible: true,
    onShellImpact: (pos) => {
      const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
      if (d < 12) car.damage(DIFFICULTY.atDamage * (1 - d / 12), 'gunfire');
      minefield.detonateNear(pos.x, pos.z, 7);
    },
  });
  fx.update(dt, null);

  if (car.health < lastHealth - 0.4) hitsTaken++;
  lastHealth = car.health;
  if (Math.abs(car.speed) < 0.8) {
    minSpeedStreak += dt;
    if (minSpeedStreak > 3) {
      stuckEvents++;
      minSpeedStreak = 0;
    }
  } else minSpeedStreak = 0;

  if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.yaw + car.speed)) {
    console.error('!! NaN in car state at t=', t.toFixed(2), car.pos, car.speed, car.yaw);
    process.exit(1);
  }

  if (Math.abs(t % 10) < dt) {
    log.push(
      `t=${t.toFixed(0).padStart(3)}s z=${car.pos.z.toFixed(0).padStart(5)} x=${car.pos.x
        .toFixed(0)
        .padStart(5)} hp=${car.health.toFixed(0).padStart(3)} v=${(car.speed * 3.6)
        .toFixed(0)
        .padStart(3)}km/h tide=${(ocean.tideProgress * 100).toFixed(0)}% water=${(
        car.waterDepth || 0
      ).toFixed(1)}m mines=${minefield.triggered}`
    );
  }

  const dObj = Math.hypot(car.pos.x - OBJECTIVE.x, car.pos.z - OBJECTIVE.z);
  if (dObj < OBJECTIVE.radius) won = true;
  if (!car.alive) lost = true;
}

console.log(log.join('\n'));
console.log('---');
console.log(
  `mode=${mode} result=${won ? 'REACHED WALL' : lost ? `DESTROYED (${car.deathCause})` : 'timeout'} ` +
    `t=${t.toFixed(1)}s hp=${car.health.toFixed(0)} mines=${minefield.triggered} ` +
    `hits=${hitsTaken} stuck=${stuckEvents} dist=${car.distanceTravelled.toFixed(0)}m ` +
    `tide=${(ocean.tideProgress * 100).toFixed(0)}%`
);
