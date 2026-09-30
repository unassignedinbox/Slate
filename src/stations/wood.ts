// ---------------------------------------------------------------------------
// WOOD — fibrous, ANISOTROPIC failure. Wood never breaks into Voronoi
// chunks: it splits ALONG the grain into long spiked splinters and tears
// ACROSS the grain along a jagged break band at the impact point. We build
// exactly that: a splinter band of elongated, sharp-tipped strips aligned
// with the grain axis, and the two plank halves keep jagged stub edges,
// hinge off their supports and fall. Loose fibers fly as particles.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  P2,
  PanelBasis,
  extrudePoly,
  worldToPanel,
  rand,
} from '../pattern2d';
import { Ctx, HitInfo, Station, spawnShardBody, disposeMesh } from './common';
import { playImpact } from '../audio';

const LEN = 1.9; // x = grain axis
const WID = 0.26;
const THK = 0.05;
const SUP_H = 0.55;
const TOP_Y = SUP_H + THK / 2;

export class WoodStation implements Station {
  group = new THREE.Group();
  private ctx: Ctx;
  private origin: THREE.Vector3;
  private basis: PanelBasis;
  private plank: THREE.Mesh | null = null;
  private woodMat: THREE.MeshStandardMaterial;
  private breakMat: THREE.MeshStandardMaterial;

  constructor(ctx: Ctx, origin: THREE.Vector3) {
    this.ctx = ctx;
    this.origin = origin;
    // right-handed basis with n = +Y: u = grain (x), v = -z
    this.basis = {
      origin: origin.clone().setY(TOP_Y),
      u: new THREE.Vector3(1, 0, 0),
      v: new THREE.Vector3(0, 0, -1),
      n: new THREE.Vector3(0, 1, 0),
    };
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.75 });
    this.breakMat = new THREE.MeshStandardMaterial({ color: 0xdcb579, roughness: 1.0 });
    this.buildSupports();
    this.buildPlank();
  }

  private buildSupports(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 });
    for (const sx of [-0.72, 0.72]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, SUP_H, 0.36), mat);
      m.position.set(this.origin.x + sx, SUP_H / 2, this.origin.z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      const box = new THREE.Box3(
        new THREE.Vector3(this.origin.x + sx - 0.08, 0, this.origin.z - 0.18),
        new THREE.Vector3(this.origin.x + sx + 0.08, SUP_H, this.origin.z + 0.18)
      );
      this.ctx.world.staticBoxes.push(box);
    }
  }

  private buildPlank(): void {
    const geo = new THREE.BoxGeometry(LEN, THK, WID);
    this.plank = new THREE.Mesh(geo, this.woodMat);
    this.plank.position.copy(this.basis.origin);
    this.plank.castShadow = this.plank.receiveShadow = true;
    this.group.add(this.plank);
    this.ctx.registerHittable(this.plank, (hit) => this.snap(hit));
  }

  private snap(hit: HitInfo): void {
    if (!this.plank) return;
    this.ctx.unregisterHittable(this.plank);
    this.group.remove(this.plank);
    disposeMesh(this.ctx.scene, this.plank);
    this.plank = null;

    playImpact('wood', Math.min(1.3, hit.speed / 16));

    const hl = LEN / 2;
    const hw = WID / 2;
    const p = worldToPanel(this.basis, hit.point);
    const x0 = THREE.MathUtils.clamp(p.x, -hl + 0.35, hl - 0.35);

    // --- splinter band --------------------------------------------------
    const band = THREE.MathUtils.clamp(hit.speed * 0.014, 0.1, 0.26);
    // strips across the width (v axis)
    const edges: number[] = [-hw];
    let z = -hw;
    while (z < hw - 0.045) {
      z += rand(0.028, 0.06);
      edges.push(Math.min(z, hw));
    }
    if (edges[edges.length - 1] < hw - 1e-4) edges.push(hw);

    const nStrips = edges.length - 1;
    const xL: number[] = [];
    const xR: number[] = [];
    for (let j = 0; j < nStrips; j++) {
      xL.push(x0 - rand(0.25, 1) * band);
      xR.push(x0 + rand(0.25, 1) * band);
    }

    // --- left + right plank halves with jagged staircase edges -----------
    const leftPoly: P2[] = [{ x: -hl, y: -hw }];
    for (let j = 0; j < nStrips; j++) {
      leftPoly.push({ x: xL[j], y: edges[j] });
      if (Math.random() < 0.4) {
        // stub spike left behind on the half
        leftPoly.push({ x: xL[j] + rand(0.04, 0.13), y: (edges[j] + edges[j + 1]) / 2 });
      }
      leftPoly.push({ x: xL[j], y: edges[j + 1] });
    }
    leftPoly.push({ x: -hl, y: hw });

    const rightPoly: P2[] = [{ x: hl, y: hw }];
    for (let j = nStrips - 1; j >= 0; j--) {
      rightPoly.push({ x: xR[j], y: edges[j + 1] });
      if (Math.random() < 0.4) {
        rightPoly.push({ x: xR[j] - rand(0.04, 0.13), y: (edges[j] + edges[j + 1]) / 2 });
      }
      rightPoly.push({ x: xR[j], y: edges[j] });
    }
    rightPoly.push({ x: hl, y: -hw });

    const mats = [this.woodMat, this.breakMat];
    const dirW = hit.dir.clone();

    for (const [poly, side] of [
      [leftPoly, -1],
      [rightPoly, 1],
    ] as [P2[], number][]) {
      const shard = extrudePoly(this.basis, poly, THK);
      spawnShardBody(this.ctx, shard, mats, {
        velocity: new THREE.Vector3(0, -hit.speed * 0.02, dirW.z * hit.speed * 0.02),
        // pitch down toward the broken end (beam failing at midspan)
        angVel: new THREE.Vector3(0, 0, side * rand(0.8, 1.6)),
        density: 620,
        restitution: 0.18,
        friction: 0.7,
      });
    }

    // --- splinters: long, thin, sharp-tipped, along the grain ------------
    for (let j = 0; j < nStrips; j++) {
      const zm = (edges[j] + edges[j + 1]) / 2;
      const tipL = rand(0.02, 0.1);
      const tipR = rand(0.02, 0.1);
      const hex: P2[] = [
        { x: xL[j], y: edges[j] },
        { x: xR[j], y: edges[j] },
        { x: xR[j] + tipR, y: zm },
        { x: xR[j], y: edges[j + 1] },
        { x: xL[j], y: edges[j + 1] },
        { x: xL[j] - tipL, y: zm },
      ];
      // some splinters split through the thickness (thin surface slivers)
      const layers = Math.random() < 0.4 ? 2 : 1;
      for (let l = 0; l < layers; l++) {
        const t = THK / layers;
        const b: PanelBasis = {
          ...this.basis,
          origin: this.basis.origin
            .clone()
            .addScaledVector(this.basis.n, layers === 1 ? 0 : (l === 0 ? -t / 2 : t / 2)),
        };
        const shard = extrudePoly(b, hex, t * 0.96);
        spawnShardBody(this.ctx, shard, mats, {
          velocity: dirW
            .clone()
            .multiplyScalar(hit.speed * rand(0.1, 0.3))
            .add(new THREE.Vector3(rand(-0.8, 0.8), rand(0.5, 2.4), rand(-0.5, 0.5))),
          angVel: new THREE.Vector3(rand(-4, 4), rand(-6, 6), rand(-14, 14)),
          density: 620,
          restitution: 0.2,
          friction: 0.65,
        });
      }
    }

    // fibers + dust
    this.ctx.particles.burst(hit.point, dirW, 120, new THREE.Color(0xc9a066), {
      speed: hit.speed * 0.18,
      spread: 0.8,
      size: 0.02,
      life: 1.1,
      drag: 2.2,
    });
    this.ctx.particles.burst(hit.point, new THREE.Vector3(0, 1, 0), 40, new THREE.Color(0xe8d3a8), {
      speed: 1.2,
      spread: 1.4,
      size: 0.012,
      life: 1.8,
      drag: 3,
    });
  }

  update(): void {}

  reset(): void {
    if (this.plank) {
      this.ctx.unregisterHittable(this.plank);
      this.group.remove(this.plank);
      disposeMesh(this.ctx.scene, this.plank);
      this.plank = null;
    }
    this.buildPlank();
  }
}
