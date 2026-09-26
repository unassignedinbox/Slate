// Offscreen preview renderer (dev tool).
//   node scripts/render.mjs [viewName ...]
import fs from 'node:fs';
import { installDom } from './domstub.mjs';
installDom();

import * as THREE from 'three';
import { Raster } from './lib/raster.mjs';
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
import { ChaseCamera } from '../src/camera.js';
import { OBJECTIVE, TIDE, WALL } from '../src/config.js';

const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });

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
const mines = new Minefield(scene, terrain, colliders, fx);
const defense = new DefenseNetwork(scene, terrain, colliders, fx, wall.mounts);
const car = new Car(terrain, ocean);
scene.add(car.object);
console.log(`world built in ${Date.now() - t0}ms`);

const tideT = Number(process.env.TIDE || 0);
ocean.elapsed = TIDE.duration * tideT;
ocean.update(0.016, false);
ocean.mesh.position.y = ocean.level; // the shader does this on the GPU

function placeCar(x, z, yaw = Math.PI) {
  car.pos.set(x, terrain.heightAt(x, z), z);
  car.yaw = yaw;
  car.object.position.copy(car.pos);
  car.object.rotation.set(0, yaw, 0);
  for (const w of car.wheels) w.pivot.position.y = 0.33;
}

const VIEWS = {
  overview: () => {
    placeCar(10, 190);
    return { pos: [150, 96, 300], look: [-10, 6, -120], fov: 52 };
  },
  chase: () => {
    placeCar(6, 120, Math.PI);
    car.speed = 18;
    car.vel.set(Math.sin(car.yaw) * 18, 0, Math.cos(car.yaw) * 18);
    return { rig: 0 }; // use the real ChaseCamera
  },
  chaseWide: () => {
    placeCar(6, 120, Math.PI);
    car.speed = 18;
    car.vel.set(Math.sin(car.yaw) * 18, 0, Math.cos(car.yaw) * 18);
    return { rig: 2 };
  },
  car: () => {
    placeCar(6, 120, Math.PI * 0.82);
    const p = car.object.position;
    return { pos: [p.x + 5.4, p.y + 2.3, p.z + 5.8], look: [p.x, p.y + 0.85, p.z], fov: 42 };
  },
  carfront: () => {
    placeCar(6, 120, Math.PI);
    const p = car.object.position;
    return { pos: [p.x - 3.2, p.y + 1.9, p.z - 6.4], look: [p.x, p.y + 0.8, p.z], fov: 40 };
  },
  wall: () => {
    placeCar(4, -180);
    const p = car.object.position;
    return { pos: [p.x + 6, p.y + 7, p.z + 26], look: [WALL.gateX, 14, WALL.z], fov: 58 };
  },
  gate: () => {
    placeCar(2, -210);
    return { pos: [30, 20, -150], look: [0, 10, -252], fov: 50 };
  },
  bunker: () => {
    placeCar(-52, -210);
    return { pos: [-38, 12, -195], look: [-52, 6, -240], fov: 52 };
  },
  surf: () => {
    placeCar(60, 180);
    return { pos: [30, 14, 250], look: [40, 2, 140], fov: 58 };
  },
  tanks: () => {
    placeCar(-66, 10);
    return { pos: [-50, 10, 26], look: [-66, 2, -10], fov: 55 };
  },
  trench: () => {
    placeCar(0, -20);
    return { pos: [-20, 12, 10], look: [10, 0, -60], fov: 58 };
  },
  mines: () => {
    placeCar(-30, -56);
    const p = car.object.position;
    return { pos: [p.x + 4, p.y + 3.2, p.z + 9], look: [p.x - 2, p.y, p.z - 16], fov: 55 };
  },
  chicane: () => {
    placeCar(8, 96, Math.PI);
    const p = car.object.position;
    return { pos: [p.x + 3, p.y + 4.2, p.z + 13], look: [p.x - 1, p.y + 1, p.z - 24], fov: 58 };
  },
  spawn: () => {
    placeCar(14, 232, Math.PI);
    const p = car.object.position;
    return { pos: [p.x + 5, p.y + 4.4, p.z + 12], look: [p.x - 2, p.y + 1.6, p.z - 22], fov: 62 };
  },
  sentry: () => {
    // Eye-level on a pillbox embrasure and the wall-top nest above it.
    placeCar(-52, -214);
    return { pos: [-44, 10.5, -222], look: [-52, 8.6, -239], fov: 30 };
  },
  nest: () => {
    placeCar(30, -220);
    return { pos: [34, 26, -232], look: [30, 29.5, -258], fov: 34 };
  },
  bonnet: () => {
    placeCar(6, 60, Math.PI);
    const p = car.object.position;
    // mirrors the in-game bonnet camera
    const yaw = Math.PI;
    const lx = Math.sin(yaw), lz = Math.cos(yaw);
    return {
      pos: [p.x + lx * 1.52, p.y + 1.17, p.z + lz * 1.52],
      look: [p.x + lx * 16, p.y + 0.7, p.z + lz * 16],
      fov: 68,
    };
  },
  driver: () => {
    placeCar(6, 60, Math.PI * 0.72);
    const p = car.object.position;
    return {
      pos: [p.x - 3.1, p.y + 2.2, p.z - 2.6],
      look: [p.x, p.y + 1.1, p.z + 0.2],
      fov: 34,
      // the software rasteriser has no alpha blending, so drop the glass to
      // see what the player sees through it
      skip: (o) => o.material && o.material.transparent,
    };
  },
  minefield: () => {
    placeCar(40, 4, Math.PI);
    const p = car.object.position;
    return { pos: [p.x + 2, p.y + 3.4, p.z + 8], look: [p.x - 2, p.y - 0.4, p.z - 26], fov: 58 };
  },
  headland: () => {
    placeCar(140, -40);
    return { pos: [40, 48, 60], look: [250, 10, -170], fov: 58 };
  },
  aerial: () => {
    placeCar(10, 120);
    return { pos: [0, 320, 240], look: [0, 0, -120], fov: 55 };
  },
};

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(VIEWS);
const W = Number(process.env.W || 1100);
const H = Number(process.env.H || 620);

for (const name of names) {
  const make = VIEWS[name];
  if (!make) {
    console.log('unknown view', name);
    continue;
  }
  const spec = make();
  const camera = new THREE.PerspectiveCamera(spec.fov || 58, W / H, 0.5, 4000);
  if (spec.rig !== undefined) {
    // Drive the real chase rig for a few seconds so the preview shows exactly
    // what the player sees.
    const chase = new ChaseCamera(camera, terrain, ocean);
    chase.setMode(spec.rig);
    chase.snap(car);
    for (let i = 0; i < 90; i++) chase.update(1 / 60, car, { state: 'running', shake: 0 });
  } else {
    camera.position.set(...spec.pos);
    camera.lookAt(new THREE.Vector3(...spec.look));
  }

  const raster = new Raster(W, H, {
    sun: sunDir,
    ambient: new THREE.Color(0.20, 0.24, 0.29),
    sunColor: new THREE.Color(1.0, 0.93, 0.82),
    fogColor: new THREE.Color(0.68, 0.73, 0.78),
    fogNear: 280,
    fogFar: 1200,
  });
  raster.clearSky(0x6f8aa5, 0xc3cdd2, 0x8d959a, camera);
  const start = Date.now();
  raster.renderScene(scene, camera, {
    waterColor: 0x2f7d86,
    skip: (o) => o.isPoints || (spec.skip ? spec.skip(o) : false),
  });
  fs.writeFileSync(`${OUT}/${name}.png`, raster.toPNG(1.0));
  console.log(`${name}: ${raster.tris} tris in ${Date.now() - start}ms`);
}
