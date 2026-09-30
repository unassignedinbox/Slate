// Headless smoke test: instantiate every station, shoot every material,
// step physics, verify no crashes / NaNs and sensible shard counts.
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics';
import { Ctx, HitInfo } from '../src/stations/common';
import { GlassStation } from '../src/stations/glass';
import { WoodStation } from '../src/stations/wood';
import { WallStation } from '../src/stations/wall';
import { PlasticStation } from '../src/stations/plastic';
import { RockStation } from '../src/stations/rock';

const scene = new THREE.Scene();
const world = new PhysicsWorld();
world.onRemove = (b) => scene.remove(b.mesh);

const particleCalls: number[] = [];
const fakeParticles = {
  burst: (..._args: unknown[]) => {
    particleCalls.push(1);
  },
  update: () => {},
} as never;

const hittables = new Map<THREE.Object3D, (h: HitInfo) => void>();
const ctx: Ctx = {
  scene,
  world,
  particles: fakeParticles,
  registerHittable: (m, cb) => hittables.set(m, cb),
  unregisterHittable: (m) => hittables.delete(m),
};

function hitNearest(point: THREE.Vector3, dir: THREE.Vector3, speed: number): boolean {
  let best: { d: number; cb: (h: HitInfo) => void } | null = null;
  for (const [mesh, cb] of hittables) {
    const wp = new THREE.Vector3();
    mesh.getWorldPosition(wp);
    const d = wp.distanceTo(point);
    if (!best || d < best.d) best = { d, cb };
  }
  if (!best) return false;
  best.cb({ point, dir, speed });
  return true;
}

function stepAll(stations: { update(dt: number): void }[], seconds: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    world.step(dt);
    for (const s of stations) s.update(dt);
  }
}

function assertFinite(label: string): void {
  for (const b of world.bodies) {
    if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z)) {
      throw new Error(`${label}: NaN body position`);
    }
    if (!Number.isFinite(b.quat.x + b.quat.y + b.quat.z + b.quat.w)) {
      throw new Error(`${label}: NaN quaternion`);
    }
  }
}

// ---- glass ----
const glass = new GlassStation(ctx, new THREE.Vector3(-4.6, 0, 0));
console.log('glass hittables:', hittables.size);
hitNearest(new THREE.Vector3(-4.5, 1.1, 0.006), new THREE.Vector3(0, 0, -1), 20);
console.log('glass after hit1: bodies=', world.bodies.length, 'hanging(hittables)=', hittables.size);
stepAll([glass], 1);
assertFinite('glass1');
hitNearest(new THREE.Vector3(-4.9, 0.8, 0.006), new THREE.Vector3(0, 0, -1), 20);
stepAll([glass], 2);
assertFinite('glass2');
console.log('glass after hit2: bodies=', world.bodies.length, 'hittables=', hittables.size);
glass.reset();

// ---- wood ----
const wood = new WoodStation(ctx, new THREE.Vector3(-2.3, 0, 0));
hitNearest(new THREE.Vector3(-2.3, 0.58, 0), new THREE.Vector3(0, -0.3, -1).normalize(), 22);
stepAll([wood], 2);
assertFinite('wood');
console.log('wood: bodies=', world.bodies.length);
wood.reset();

// ---- wall ----
const wall = new WallStation(ctx, new THREE.Vector3(0, 0, 0));
console.log('wall baked chunks (hittables):', hittables.size);
hitNearest(new THREE.Vector3(0, 0.9, 0.12), new THREE.Vector3(0, 0, -1), 26);
stepAll([wall], 3);
assertFinite('wall');
console.log('wall after hit: bodies=', world.bodies.length, 'remaining hittables=', hittables.size);
wall.reset();

// ---- plastic ----
const plastic = new PlasticStation(ctx, new THREE.Vector3(2.4, 0, 0));
hitNearest(new THREE.Vector3(2.5, 1.05, 0.007), new THREE.Vector3(0, 0, -1), 20);
stepAll([plastic], 2);
assertFinite('plastic');
console.log('plastic after tear: bodies=', world.bodies.length, 'hittables=', hittables.size);
plastic.reset();

// ---- rock ----
const rock = new RockStation(ctx, new THREE.Vector3(4.5, 0, 0));
hitNearest(new THREE.Vector3(4.5, 0.45, 0.4), new THREE.Vector3(0, 0, -1), 24);
stepAll([rock], 2);
assertFinite('rock');
console.log('rock after hit: bodies=', world.bodies.length, 'refracturable=', hittables.size);
// refracture one chunk if any registered
if (hittables.size > 0) {
  const [mesh, cb] = [...hittables.entries()][0];
  const wp = new THREE.Vector3();
  mesh.getWorldPosition(wp);
  cb({ point: wp, dir: new THREE.Vector3(0, -0.2, -1).normalize(), speed: 22 });
  stepAll([rock], 1);
  assertFinite('rock-refracture');
  console.log('rock after refracture: bodies=', world.bodies.length);
}
rock.reset();

console.log('SMOKE OK — particles bursts:', particleCalls.length);
