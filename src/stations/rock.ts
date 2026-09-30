// ---------------------------------------------------------------------------
// ROCK — brittle granular failure. Key realism cues, none of which uniform
// Voronoi gives you:
//   * fragment size GRADES with distance from impact (comminution): powder
//     and small debris at the impact, big slabs at the far side,
//   * fracture surfaces are ROUGH (matched noise displacement on both sides
//     of every cut, so crack faces mate but look granular),
//   * chunks can be re-fractured with further hits (recursive fracture,
//     the headline feature of Müller et al. 2013 / NVIDIA Blast).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  Shard,
  makeBoxShard,
  sliceShard,
  volumeCentroid,
  shardRadius,
  shardToGeometry,
} from '../convex';
import { Ctx, HitInfo, Station, spawnShardBody, randomSpin, disposeMesh } from './common';
import { RigidBody } from '../physics';
import { rand } from '../pattern2d';
import { playImpact } from '../audio';

export class RockStation implements Station {
  group = new THREE.Group();
  private ctx: Ctx;
  private origin: THREE.Vector3;
  private boulderMesh: THREE.Mesh | null = null;
  private boulderShard: Shard | null = null;
  private outerMat: THREE.MeshStandardMaterial;
  private innerMat: THREE.MeshStandardMaterial;
  private chunkMeshes: THREE.Mesh[] = [];

  constructor(ctx: Ctx, origin: THREE.Vector3) {
    this.ctx = ctx;
    this.origin = origin;
    this.outerMat = new THREE.MeshStandardMaterial({ color: 0x6e6a63, roughness: 0.95 });
    this.innerMat = new THREE.MeshStandardMaterial({ color: 0x9a9489, roughness: 1.0 });
    this.buildBoulder();
  }

  private buildBoulder(): void {
    // irregular boulder: box carved by ~10 random tangent planes
    const R = 0.46;
    const center = this.origin.clone().setY(R * 0.92);
    let s: Shard = makeBoxShard(R * 2.1, R * 2.0, R * 2.1, center);
    for (let i = 0; i < 10; i++) {
      const n = new THREE.Vector3(rand(-1, 1), rand(-0.9, 1), rand(-1, 1)).normalize();
      const point = center.clone().addScaledVector(n, R * rand(0.82, 1.02));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, point);
      const { below } = sliceShard(s, plane);
      if (below && volumeCentroid(below).volume > 0.08) s = below;
    }
    // flat bottom so it sits on the ground
    const bottom = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0.015, 0)
    );
    const cut = sliceShard(s, bottom);
    if (cut.below) s = cut.below;
    // boulder exterior renders as weathered rock everywhere
    s.inner = s.inner.map(() => false);

    this.boulderShard = s;
    const { centroid } = volumeCentroid(s);
    const local: Shard = {
      faces: s.faces.map((f) => f.map((v) => v.clone().sub(centroid))),
      inner: s.inner.slice(),
    };
    this.createBoulderMesh(local, centroid);
  }

  private createBoulderMesh(local: Shard, centroid: THREE.Vector3): void {
    const mesh = new THREE.Mesh(shardToGeometry(local), this.outerMat);
    mesh.position.copy(centroid);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.boulderMesh = mesh;
    this.ctx.registerHittable(mesh, (hit) => {
      if (!this.boulderShard || !this.boulderMesh) return;
      const shard = this.boulderShard;
      this.ctx.unregisterHittable(this.boulderMesh);
      this.group.remove(this.boulderMesh);
      disposeMesh(this.ctx.scene, this.boulderMesh);
      this.boulderMesh = null;
      this.boulderShard = null;
      this.fracture(shard, hit);
    });
  }

  /** Recursive impact-graded fracture of a world-space shard. */
  fracture(shard: Shard, hit: HitInfo): void {
    playImpact('rock', Math.min(1.4, hit.speed / 14));

    const done: Shard[] = [];
    const stack: Shard[] = [shard];
    let guard = 0;

    while (stack.length && guard++ < 300) {
      const s = stack.pop()!;
      const { volume, centroid } = volumeCentroid(s);
      if (volume < 2e-5) continue;
      const radius = shardRadius(s, centroid);
      const dist = centroid.distanceTo(hit.point);
      // fragment size target grows with distance from the impact
      const t = THREE.MathUtils.clamp(dist / 0.55, 0, 1);
      const target = THREE.MathUtils.lerp(0.055, 0.34, t * t);
      if (radius <= target || volume < 6e-5) {
        done.push(s);
        continue;
      }
      // cut plane through the shard, roughly aimed so cracks radiate from the
      // impact: normal biased perpendicular to the radial direction
      const radial = centroid.clone().sub(hit.point).normalize();
      let n = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      if (Math.random() < 0.5) {
        n.addScaledVector(radial, -n.dot(radial)).normalize(); // project out radial
        if (n.lengthSq() < 0.5) n = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      }
      const point = centroid
        .clone()
        .add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)).multiplyScalar(radius * 0.4));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, point);
      const { below, above } = sliceShard(s, plane, {
        roughness: Math.min(0.028, radius * 0.16),
        noiseScale: 30,
      });
      if (below && above) {
        stack.push(below, above);
      } else {
        done.push(s);
      }
    }

    for (const p of done) {
      const { centroid } = volumeCentroid(p);
      const dst = Math.max(0.04, centroid.distanceTo(hit.point));
      const falloff = Math.exp(-dst * 4.2);
      const vel = hit.dir
        .clone()
        .multiplyScalar(hit.speed * 0.2 * falloff)
        .addScaledVector(centroid.clone().sub(hit.point).normalize(), hit.speed * 0.08 * falloff)
        .add(new THREE.Vector3(rand(-0.2, 0.2), rand(0, 0.3) * falloff, rand(-0.2, 0.2)));
      const body = spawnShardBody(this.ctx, p, [this.outerMat, this.innerMat], {
        velocity: vel,
        angVel: randomSpin(1 + 9 * falloff),
        density: 2600,
        restitution: 0.07,
        friction: 0.9,
      });
      // big chunks can be shot again -> recursive re-fracture
      if (body && shardRadius(p, centroid) > 0.13) {
        this.makeRefracturable(body);
      }
    }

    this.ctx.particles.burst(hit.point, hit.dir, 150, new THREE.Color(0x8d887e), {
      speed: hit.speed * 0.2,
      spread: 0.8,
      size: 0.028,
      life: 1.5,
      drag: 2.2,
    });
    this.ctx.particles.burst(hit.point, hit.dir, 70, new THREE.Color(0xb5afa2), {
      speed: hit.speed * 0.07,
      spread: 1.5,
      size: 0.05,
      life: 2.2,
      drag: 3,
    });
  }

  private makeRefracturable(body: RigidBody): void {
    const mesh = body.mesh as THREE.Mesh;
    this.chunkMeshes.push(mesh);
    this.ctx.registerHittable(mesh, (hit) => {
      // rebuild world-space shard from the body's current transform
      this.ctx.unregisterHittable(mesh);
      const idx = this.chunkMeshes.indexOf(mesh);
      if (idx >= 0) this.chunkMeshes.splice(idx, 1);
      // the local-space shard was stored at spawn; move it to the body's
      // CURRENT transform and fracture again
      const stored = (mesh.userData.shard as Shard) || null;
      this.ctx.world.remove(body);
      disposeMesh(this.ctx.scene, mesh);
      if (stored) {
        const world: Shard = {
          faces: stored.faces.map((f) =>
            f.map((v) => v.clone().applyQuaternion(body.quat).add(body.pos))
          ),
          inner: stored.inner.slice(),
        };
        this.fracture(world, hit);
      }
    });
  }

  update(): void {}

  reset(): void {
    for (const m of this.chunkMeshes) this.ctx.unregisterHittable(m);
    this.chunkMeshes = [];
    if (this.boulderMesh) {
      this.ctx.unregisterHittable(this.boulderMesh);
      this.group.remove(this.boulderMesh);
      disposeMesh(this.ctx.scene, this.boulderMesh);
      this.boulderMesh = null;
    }
    this.boulderShard = null;
    this.buildBoulder();
  }
}
