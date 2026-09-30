import * as THREE from 'three';
import {
  Shard,
  shardToGeometry,
  shardVertices,
  shardRadius,
  volumeCentroid,
} from '../convex';
import { PhysicsWorld, RigidBody } from '../physics';
import { ParticleSystem } from '../particles';

export interface HitInfo {
  point: THREE.Vector3;
  dir: THREE.Vector3; // unit direction of projectile
  speed: number;
}

export interface Ctx {
  scene: THREE.Scene;
  world: PhysicsWorld;
  particles: ParticleSystem;
  registerHittable(mesh: THREE.Object3D, onHit: (hit: HitInfo) => void): void;
  unregisterHittable(mesh: THREE.Object3D): void;
}

export interface Station {
  group: THREE.Group;
  reset(): void;
  update(dt: number): void;
}

export interface SpawnOpts {
  velocity?: THREE.Vector3;
  angVel?: THREE.Vector3;
  density?: number;
  restitution?: number;
  friction?: number;
  life?: number;
  castShadow?: boolean;
}

/**
 * Turn a world-space shard into a mesh + rigid body (geometry recentered on
 * its centroid so rotation looks right).
 */
export function spawnShardBody(
  ctx: Ctx,
  shard: Shard,
  materials: THREE.Material | THREE.Material[],
  opts: SpawnOpts = {}
): RigidBody | null {
  const { volume, centroid } = volumeCentroid(shard);
  if (volume < 1e-8) return null;

  // recenter
  const local: Shard = {
    faces: shard.faces.map((f) => f.map((v) => v.clone().sub(centroid))),
    inner: shard.inner.slice(),
  };
  const geo = shardToGeometry(local);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.userData.shard = local; // kept for recursive re-fracture
  mesh.position.copy(centroid);
  mesh.castShadow = opts.castShadow ?? true;
  mesh.receiveShadow = true;
  ctx.scene.add(mesh);

  const verts = shardVertices(local, 16);
  const radius = shardRadius(local, new THREE.Vector3());
  const density = opts.density ?? 1200;
  const body = new RigidBody(mesh, verts, radius, {
    mass: Math.max(0.02, volume * density),
    restitution: opts.restitution,
    friction: opts.friction,
    life: opts.life,
  });
  if (opts.velocity) body.vel.copy(opts.velocity);
  if (opts.angVel) body.angVel.copy(opts.angVel);
  ctx.world.add(body);
  return body;
}

export function disposeMesh(scene: THREE.Scene, obj: THREE.Object3D): void {
  scene.remove(obj);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

/** velocity kick pattern shared by brittle materials: impact push + radial burst */
export function shardKick(
  shardCentroid: THREE.Vector3,
  impact: THREE.Vector3,
  dir: THREE.Vector3,
  speed: number,
  radialFalloff: number
): THREE.Vector3 {
  const away = shardCentroid.clone().sub(impact);
  const dist = Math.max(0.02, away.length());
  away.normalize();
  const falloff = Math.exp(-dist * radialFalloff);
  return dir
    .clone()
    .multiplyScalar(speed * 0.16 * falloff)
    .addScaledVector(away, speed * 0.10 * falloff)
    .add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 0.6
      )
    );
}

export function randomSpin(strength: number): THREE.Vector3 {
  return new THREE.Vector3(
    (Math.random() - 0.5) * strength,
    (Math.random() - 0.5) * strength,
    (Math.random() - 0.5) * strength
  );
}
