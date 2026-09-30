// ---------------------------------------------------------------------------
// GLASS — the one material where Voronoi is visibly wrong.
// Real annealed glass fails with RADIAL cracks racing out of the impact point
// plus CONCENTRIC (spider-web) rings, a pulverized Hertzian core, and outer
// shards that stay wedged in the frame. We generate that exact morphology at
// runtime, aligned to the impact point (pattern-based fracture a la Müller
// 2013), extrude the 2D cells through the pane thickness, and split them into
//   - powder (particles) at the core,
//   - flying dagger shards near the impact,
//   - cracked-but-hanging plates further out, released on a second hit.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  P2,
  PanelBasis,
  clipToRect,
  extrudePoly,
  polyCentroid,
  panelToWorld,
  worldToPanel,
  rand,
  randInt,
} from '../pattern2d';
import { Ctx, HitInfo, Station, spawnShardBody, randomSpin, disposeMesh } from './common';
import { Shard, shardToGeometry, volumeCentroid } from '../convex';
import { playImpact } from '../audio';

const PANE_W = 1.5;
const PANE_H = 1.05;
const PANE_T = 0.012;
const PANE_CY = 1.02; // center height

interface HangingShard {
  mesh: THREE.Mesh;
  shard: Shard; // world space
  centroid: THREE.Vector3;
  releaseAt: number; // -1 = not scheduled
}

export class GlassStation implements Station {
  group = new THREE.Group();
  private ctx: Ctx;
  private origin: THREE.Vector3;
  private basis: PanelBasis;
  private paneMesh: THREE.Mesh | null = null;
  private hanging: HangingShard[] = [];
  private time = 0;
  private glassMat: THREE.MeshPhysicalMaterial;
  private edgeMat: THREE.MeshPhysicalMaterial;

  constructor(ctx: Ctx, origin: THREE.Vector3) {
    this.ctx = ctx;
    this.origin = origin;
    this.basis = {
      origin: origin.clone().setY(PANE_CY),
      u: new THREE.Vector3(1, 0, 0),
      v: new THREE.Vector3(0, 1, 0),
      n: new THREE.Vector3(0, 0, 1),
    };
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0fbfa,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.22,
      envMapIntensity: 1.8,
      depthWrite: false,
    });
    this.edgeMat = new THREE.MeshPhysicalMaterial({
      color: 0xa8ddcc, // the green tint real glass shows on broken edges
      roughness: 0.3,
      metalness: 0,
      transparent: true,
      opacity: 0.6,
      envMapIntensity: 1.2,
      depthWrite: false,
    });
    this.buildFrame();
    this.buildPane();
  }

  private buildFrame(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.7 });
    const mk = (w: number, h: number, d: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(this.origin.x + x, y, this.origin.z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    const fw = PANE_W + 0.12;
    mk(0.07, PANE_H + 0.16, 0.07, -fw / 2, PANE_CY); // left post
    mk(0.07, PANE_H + 0.16, 0.07, fw / 2, PANE_CY); // right post
    mk(fw + 0.07, 0.07, 0.07, 0, PANE_CY + (PANE_H + 0.12) / 2); // top
    mk(fw + 0.07, 0.07, 0.07, 0, PANE_CY - (PANE_H + 0.12) / 2); // bottom
    // feet
    mk(0.3, 0.05, 0.3, -fw / 2, 0.025);
    mk(0.3, 0.05, 0.3, fw / 2, 0.025);
  }

  private buildPane(): void {
    const geo = new THREE.BoxGeometry(PANE_W, PANE_H, PANE_T);
    this.paneMesh = new THREE.Mesh(geo, this.glassMat);
    this.paneMesh.position.copy(this.basis.origin);
    this.paneMesh.castShadow = false;
    this.group.add(this.paneMesh);
    this.ctx.registerHittable(this.paneMesh, (hit) => this.shatter(hit));
  }

  /** First impact: generate the aligned radial/concentric pattern. */
  private shatter(hit: HitInfo): void {
    if (!this.paneMesh) return;
    this.ctx.unregisterHittable(this.paneMesh);
    disposeMesh(this.ctx.scene, this.paneMesh);
    this.group.remove(this.paneMesh);
    this.paneMesh = null;

    const p = worldToPanel(this.basis, hit.point);
    p.x = THREE.MathUtils.clamp(p.x, -PANE_W / 2 + 0.02, PANE_W / 2 - 0.02);
    p.y = THREE.MathUtils.clamp(p.y, -PANE_H / 2 + 0.02, PANE_H / 2 - 0.02);

    playImpact('glass', Math.min(1.4, hit.speed / 18));

    // ---- pattern: rays + rings aligned to impact -------------------------
    const corners: P2[] = [
      { x: -PANE_W / 2, y: -PANE_H / 2 },
      { x: PANE_W / 2, y: -PANE_H / 2 },
      { x: PANE_W / 2, y: PANE_H / 2 },
      { x: -PANE_W / 2, y: PANE_H / 2 },
    ];
    let maxR = 0;
    for (const c of corners) maxR = Math.max(maxR, Math.hypot(c.x - p.x, c.y - p.y));

    const numRays = randInt(11, 16);
    const angles: number[] = [];
    for (let i = 0; i < numRays; i++) {
      angles.push((i / numRays) * Math.PI * 2 + rand(-0.5, 0.5) * (Math.PI / numRays));
    }
    angles.sort((a, b) => a - b);

    const radii: number[] = [0.035];
    let r = 0.075;
    while (r < maxR) {
      radii.push(r);
      r *= rand(1.45, 1.8);
    }
    radii.push(maxR * 1.7); // guarantees full pane coverage after rect clip

    // jittered node lattice; shared nodes keep neighbouring cells watertight
    const nodes: P2[][] = [];
    for (let i = 0; i < numRays; i++) {
      nodes.push([]);
      for (let k = 0; k < radii.length; k++) {
        const a = angles[i] + rand(-0.22, 0.22) * (Math.PI / numRays) * Math.min(1, radii[k] * 6);
        const rr = radii[k] * rand(0.88, 1.14);
        nodes[i].push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
      }
    }

    const dynRadius = THREE.MathUtils.clamp(hit.speed * 0.022, 0.16, 0.6);
    const dirWorld = hit.dir.clone();
    let dynCount = 0;

    for (let i = 0; i < numRays; i++) {
      const i2 = (i + 1) % numRays;
      for (let k = 0; k < radii.length - 1; k++) {
        const quad: P2[] = [nodes[i][k], nodes[i2][k], nodes[i2][k + 1], nodes[i][k + 1]];
        const cell = clipToRect(
          quad.map((q) => ({ x: q.x, y: q.y })),
          PANE_W / 2,
          PANE_H / 2
        );
        if (cell.length < 3) continue;
        const c2 = polyCentroid(cell);
        const dist = Math.hypot(c2.x - p.x, c2.y - p.y);
        const shard = extrudePoly(this.basis, cell, PANE_T);
        const cw = panelToWorld(this.basis, c2, 0);

        if (dist < dynRadius) {
          // flying shard
          dynCount++;
          const falloff = Math.exp(-dist * 4.5);
          const vel = dirWorld
            .clone()
            .multiplyScalar(hit.speed * (0.12 + 0.28 * falloff))
            .add(
              new THREE.Vector3(rand(-0.7, 0.7), rand(-0.4, 0.9), rand(-0.3, 0.9))
            );
          spawnShardBody(this.ctx, shard, [this.glassMat, this.edgeMat], {
            velocity: vel,
            angVel: randomSpin(14),
            density: 2500,
            restitution: 0.3,
            friction: 0.35,
            castShadow: false,
          });
        } else {
          this.addHangingShard(shard, cw);
        }
      }
    }

    // pulverized Hertzian core -> glitter
    this.ctx.particles.burst(hit.point, dirWorld, 220, new THREE.Color(0xd9fff2), {
      speed: hit.speed * 0.28,
      spread: 0.55,
      size: 0.014,
      life: 1.4,
      drag: 1.6,
    });
    this.ctx.particles.burst(hit.point, dirWorld, 80, new THREE.Color(0xffffff), {
      speed: hit.speed * 0.12,
      spread: 1.2,
      size: 0.008,
      life: 2.2,
      drag: 0.8,
    });
    void dynCount;
  }

  /** Cracked plate that stays wedged in the frame. Shrunk ~1.5% so the crack
   * lines are visible, tilted a hair so facets catch the light. */
  private addHangingShard(shard: Shard, centroidWorld: THREE.Vector3): void {
    const { centroid } = volumeCentroid(shard);
    const local: Shard = {
      faces: shard.faces.map((f) =>
        f.map((v) => v.clone().sub(centroid).multiplyScalar(0.985))
      ),
      inner: shard.inner.slice(),
    };
    const geo = shardToGeometry(local);
    const mesh = new THREE.Mesh(geo, [this.glassMat, this.edgeMat]);
    mesh.position.copy(centroid);
    mesh.rotateOnAxis(
      new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      rand(0.004, 0.014)
    );
    this.group.add(mesh);
    const entry: HangingShard = { mesh, shard: local, centroid: centroidWorld, releaseAt: -1 };
    this.hanging.push(entry);
    this.ctx.registerHittable(mesh, (hit) => this.hitHanging(entry, hit));
  }

  /** Second impact: release nearby hangers immediately, cascade the rest. */
  private hitHanging(entry: HangingShard, hit: HitInfo): void {
    playImpact('glass', Math.min(1.2, hit.speed / 22));
    this.ctx.particles.burst(hit.point, hit.dir, 90, new THREE.Color(0xe4fff4), {
      speed: hit.speed * 0.2,
      spread: 0.7,
      size: 0.012,
      life: 1.2,
    });
    for (const h of this.hanging) {
      if (h.releaseAt >= 0) continue;
      const d = h.centroid.distanceTo(hit.point);
      if (d < 0.34) {
        h.releaseAt = this.time; // now
      } else if (Math.random() < 0.75) {
        // cracked glass loses integrity -> the rest rains out over ~a second
        h.releaseAt = this.time + d * rand(0.25, 0.6) + rand(0, 0.3);
      }
    }
  }

  private release(h: HangingShard, kick: number): void {
    this.ctx.unregisterHittable(h.mesh);
    this.group.remove(h.mesh);
    this.ctx.scene.add(h.mesh); // keep world transform (group is at origin anyway)
    const world: Shard = {
      faces: h.shard.faces.map((f) => f.map((v) => v.clone().add(h.mesh.position))),
      inner: h.shard.inner.slice(),
    };
    disposeMesh(this.ctx.scene, h.mesh);
    spawnShardBody(this.ctx, world, [this.glassMat, this.edgeMat], {
      velocity: new THREE.Vector3(rand(-0.2, 0.2), rand(-0.4, 0), rand(-0.15, kick)),
      angVel: randomSpin(5),
      density: 2500,
      restitution: 0.3,
      friction: 0.35,
      castShadow: false,
    });
  }

  update(dt: number): void {
    this.time += dt;
    if (this.hanging.length) {
      const still: HangingShard[] = [];
      for (const h of this.hanging) {
        if (h.releaseAt >= 0 && this.time >= h.releaseAt) {
          this.release(h, rand(0.1, 0.5));
        } else {
          still.push(h);
        }
      }
      if (still.length !== this.hanging.length) this.hanging = still;
    }
  }

  reset(): void {
    for (const h of this.hanging) {
      this.ctx.unregisterHittable(h.mesh);
      this.group.remove(h.mesh);
      disposeMesh(this.ctx.scene, h.mesh);
    }
    this.hanging = [];
    if (this.paneMesh) {
      this.ctx.unregisterHittable(this.paneMesh);
      this.group.remove(this.paneMesh);
      disposeMesh(this.ctx.scene, this.paneMesh);
      this.paneMesh = null;
    }
    this.buildPane();
  }
}
