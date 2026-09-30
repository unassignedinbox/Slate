// ---------------------------------------------------------------------------
// BUILDING / CONCRETE — the AAA structural-destruction recipe:
//   1. BAKE: the wall volume is pre-fractured offline (here: at load) into an
//      irregular chunk hierarchy with jittered cutting planes. Seams are
//      exactly coplanar, so the intact wall renders seamless.
//   2. SUPPORT GRAPH: chunk adjacency is precomputed; chunks touching the
//      ground are "supports".
//   3. RUNTIME: an impact destroys/loosens chunks near the hit (with fresh
//      rough sub-fracture), then a flood-fill from the supports finds
//      orphaned islands -> they lose integrity and cascade-collapse with a
//      small propagation delay. This is the Blast / R6 Siege model.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  Shard,
  makeBoxShard,
  sliceShard,
  volumeCentroid,
  shardToGeometry,
  shardRadius,
} from '../convex';
import { Ctx, HitInfo, Station, spawnShardBody, randomSpin, disposeMesh } from './common';
import { rand } from '../pattern2d';
import { playImpact } from '../audio';

const W = 2.1;
const H = 1.55;
const D = 0.24;

interface Chunk {
  shard: Shard; // world space
  centroid: THREE.Vector3;
  radius: number;
  aabb: THREE.Box3;
  mesh: THREE.Mesh | null;
  alive: boolean;
  neighbors: Chunk[];
  grounded: boolean;
  collapseAt: number; // -1 = stable
}

export class WallStation implements Station {
  group = new THREE.Group();
  private ctx: Ctx;
  private origin: THREE.Vector3;
  private chunks: Chunk[] = [];
  private time = 0;
  private outerMat: THREE.MeshStandardMaterial;
  private innerMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, origin: THREE.Vector3) {
    this.ctx = ctx;
    this.origin = origin;
    this.outerMat = new THREE.MeshStandardMaterial({ color: 0xb6b0a4, roughness: 0.92 });
    this.innerMat = new THREE.MeshStandardMaterial({ color: 0x8d867a, roughness: 1.0 });
    this.bake();
  }

  // --------------------------- BAKE -------------------------------------
  private bake(): void {
    const root = makeBoxShard(W, H, D, this.origin.clone().setY(H / 2));
    const leaves: Shard[] = [];
    const stack: Shard[] = [root];

    while (stack.length) {
      const s = stack.pop()!;
      const box = new THREE.Box3();
      for (const f of s.faces) for (const v of f) box.expandByPoint(v);
      const size = box.getSize(new THREE.Vector3());
      const target = rand(0.24, 0.4);
      let axis = 0;
      if (size.y > size.x && size.y >= size.z) axis = 1;
      else if (size.z > size.x && size.z > size.y) axis = 2;
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim <= target || leaves.length + stack.length > 220) {
        leaves.push(s);
        continue;
      }
      const n = new THREE.Vector3(
        axis === 0 ? 1 : rand(-0.18, 0.18),
        axis === 1 ? 1 : rand(-0.18, 0.18),
        axis === 2 ? 1 : rand(-0.18, 0.18)
      ).normalize();
      const center = box.getCenter(new THREE.Vector3());
      const jitterAxis = axis === 0 ? size.x : axis === 1 ? size.y : size.z;
      const point = center.clone().addScaledVector(n, rand(-0.2, 0.2) * jitterAxis);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, point);
      const { below, above } = sliceShard(s, plane); // exact planes: seams invisible
      if (below && above) {
        stack.push(below, above);
      } else {
        leaves.push(s);
      }
    }

    for (const s of leaves) {
      const { volume, centroid } = volumeCentroid(s);
      if (volume < 1e-6) continue;
      const aabb = new THREE.Box3();
      for (const f of s.faces) for (const v of f) aabb.expandByPoint(v);
      const local: Shard = {
        faces: s.faces.map((f) => f.map((v) => v.clone().sub(centroid))),
        inner: s.inner.map(() => false), // baked seams render as outer surface
      };
      const mesh = new THREE.Mesh(shardToGeometry(local), this.outerMat);
      mesh.position.copy(centroid);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);

      const chunk: Chunk = {
        shard: s,
        centroid,
        radius: shardRadius(s, centroid),
        aabb,
        mesh,
        alive: true,
        neighbors: [],
        grounded: aabb.min.y < 0.03,
        collapseAt: -1,
      };
      this.chunks.push(chunk);
      this.ctx.registerHittable(mesh, (hit) => this.damage(hit));
    }

    // adjacency
    const inflated = this.chunks.map((c) => c.aabb.clone().expandByScalar(0.012));
    for (let i = 0; i < this.chunks.length; i++) {
      for (let j = i + 1; j < this.chunks.length; j++) {
        if (inflated[i].intersectsBox(this.chunks[j].aabb)) {
          this.chunks[i].neighbors.push(this.chunks[j]);
          this.chunks[j].neighbors.push(this.chunks[i]);
        }
      }
    }
  }

  // --------------------------- RUNTIME ----------------------------------
  private damage(hit: HitInfo): void {
    playImpact('concrete', Math.min(1.4, hit.speed / 15));
    const R = THREE.MathUtils.clamp(hit.speed * 0.02, 0.24, 0.5);

    for (const c of this.chunks) {
      if (!c.alive) continue;
      const d = c.centroid.distanceTo(hit.point);
      if (d < R) {
        this.destroyChunk(c, hit, true);
      } else if (d < R * 1.7 && Math.random() < 0.55) {
        this.destroyChunk(c, hit, false); // knocked loose, stays whole
      }
    }

    this.ctx.particles.burst(hit.point, hit.dir, 160, new THREE.Color(0xaaa294), {
      speed: hit.speed * 0.22,
      spread: 0.9,
      size: 0.03,
      life: 1.6,
      drag: 2.4,
    });
    this.ctx.particles.burst(hit.point, hit.dir, 60, new THREE.Color(0xcfc8bb), {
      speed: hit.speed * 0.08,
      spread: 1.6,
      size: 0.06,
      life: 2.4,
      drag: 3.2,
    });

    this.solveSupport();
  }

  private destroyChunk(c: Chunk, hit: HitInfo | null, subFracture: boolean): void {
    if (!c.alive || !c.mesh) return;
    c.alive = false;
    this.ctx.unregisterHittable(c.mesh);
    this.group.remove(c.mesh);
    disposeMesh(this.ctx.scene, c.mesh);
    c.mesh = null;

    const pieces: Shard[] = [];
    if (subFracture && hit) {
      // fresh, rough sub-fracture near the impact
      let parts: Shard[] = [c.shard];
      const cuts = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < cuts; k++) {
        const next: Shard[] = [];
        for (const p of parts) {
          const { centroid } = volumeCentroid(p);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
            centroid.clone().add(new THREE.Vector3(rand(-0.04, 0.04), rand(-0.04, 0.04), rand(-0.04, 0.04)))
          );
          const { below, above } = sliceShard(p, plane, { roughness: 0.02, noiseScale: 40 });
          if (below) next.push(below);
          if (above) next.push(above);
          if (!below && !above) next.push(p);
        }
        parts = next;
      }
      pieces.push(...parts);
    } else {
      pieces.push(c.shard);
    }

    for (const p of pieces) {
      const { centroid } = volumeCentroid(p);
      let vel = new THREE.Vector3(rand(-0.2, 0.2), rand(-0.2, 0.1), rand(-0.2, 0.2));
      let spin = randomSpin(1.2);
      if (hit) {
        const dst = Math.max(0.05, centroid.distanceTo(hit.point));
        const falloff = Math.exp(-dst * 3.2);
        vel = hit.dir
          .clone()
          .multiplyScalar(hit.speed * 0.22 * falloff)
          .addScaledVector(centroid.clone().sub(hit.point).normalize(), hit.speed * 0.06 * falloff)
          .add(vel);
        spin = randomSpin(2 + 8 * falloff);
      }
      spawnShardBody(this.ctx, p, [this.outerMat, this.innerMat], {
        velocity: vel,
        angVel: spin,
        density: 2000,
        restitution: 0.08,
        friction: 0.85,
      });
    }
  }

  /** Flood fill from grounded chunks; orphaned islands collapse. */
  private solveSupport(): void {
    const seen = new Set<Chunk>();
    const queue: Chunk[] = [];
    for (const c of this.chunks) {
      if (c.alive && c.grounded) {
        seen.add(c);
        queue.push(c);
      }
    }
    while (queue.length) {
      const c = queue.pop()!;
      for (const n of c.neighbors) {
        if (n.alive && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    for (const c of this.chunks) {
      if (c.alive && !seen.has(c) && c.collapseAt < 0) {
        // higher chunks let go slightly later -> visible cascade
        c.collapseAt = this.time + 0.06 + (c.centroid.y / H) * rand(0.1, 0.35);
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    let any = false;
    for (const c of this.chunks) {
      if (c.alive && c.collapseAt >= 0 && this.time >= c.collapseAt) {
        this.destroyChunk(c, null, false);
        any = true;
      }
    }
    if (any) {
      playImpact('concrete', 0.5);
      this.solveSupport();
    }
  }

  reset(): void {
    for (const c of this.chunks) {
      if (c.mesh) {
        this.ctx.unregisterHittable(c.mesh);
        this.group.remove(c.mesh);
        disposeMesh(this.ctx.scene, c.mesh);
      }
    }
    this.chunks = [];
    this.bake();
  }
}
