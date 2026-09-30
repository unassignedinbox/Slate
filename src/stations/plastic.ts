// ---------------------------------------------------------------------------
// PLASTIC — DUCTILE failure, the opposite of glass. Polymers absorb energy by
// plastic deformation: a projectile punches a hole and the material around it
// tears into PETALS that bend outward around a hinge and STAY ATTACHED,
// showing stress-whitening along the tear. Only the punched-out core
// detaches. Weak hits just scuff. No shattering, no shard rain.
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

const PANE_W = 1.25;
const PANE_H = 0.95;
const PANE_T = 0.014;
const PANE_CY = 1.0;

interface Petal {
  mesh: THREE.Mesh;
  pivot: THREE.Vector3; // world hinge point
  axis: THREE.Vector3; // world hinge axis
  basePos: THREE.Vector3; // mesh position before bending
  angle: number;
  vel: number;
  target: number;
}

interface StaticCell {
  mesh: THREE.Mesh;
  shard: Shard; // local (centered) shard
  centroid: THREE.Vector3;
}

export class PlasticStation implements Station {
  group = new THREE.Group();
  private ctx: Ctx;
  private origin: THREE.Vector3;
  private basis: PanelBasis;
  private panel: THREE.Mesh | null = null;
  private petals: Petal[] = [];
  private cells: StaticCell[] = [];
  private plasticMat: THREE.MeshPhysicalMaterial;
  private tornMat: THREE.MeshPhysicalMaterial;
  private whitenedMat: THREE.MeshPhysicalMaterial;

  constructor(ctx: Ctx, origin: THREE.Vector3) {
    this.ctx = ctx;
    this.origin = origin;
    this.basis = {
      origin: origin.clone().setY(PANE_CY),
      u: new THREE.Vector3(1, 0, 0),
      v: new THREE.Vector3(0, 1, 0),
      n: new THREE.Vector3(0, 0, 1),
    };
    this.plasticMat = new THREE.MeshPhysicalMaterial({
      color: 0x1c6fd4,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.25,
    });
    this.tornMat = new THREE.MeshPhysicalMaterial({
      color: 0xdcecff, // stress-whitened torn edge
      roughness: 0.85,
      metalness: 0,
    });
    this.whitenedMat = new THREE.MeshPhysicalMaterial({
      color: 0x7ba9e8,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.3,
    });
    this.buildFrame();
    this.buildPanel();
  }

  private buildFrame(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.55, metalness: 0.6 });
    const mk = (w: number, h: number, d: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(this.origin.x + x, y, this.origin.z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    const fw = PANE_W + 0.12;
    mk(0.07, PANE_H + 0.16, 0.07, -fw / 2, PANE_CY);
    mk(0.07, PANE_H + 0.16, 0.07, fw / 2, PANE_CY);
    mk(fw + 0.07, 0.07, 0.07, 0, PANE_CY + (PANE_H + 0.12) / 2);
    mk(fw + 0.07, 0.07, 0.07, 0, PANE_CY - (PANE_H + 0.12) / 2);
    mk(0.3, 0.05, 0.3, -fw / 2, 0.025);
    mk(0.3, 0.05, 0.3, fw / 2, 0.025);
  }

  private buildPanel(): void {
    const geo = new THREE.BoxGeometry(PANE_W, PANE_H, PANE_T);
    this.panel = new THREE.Mesh(geo, this.plasticMat);
    this.panel.position.copy(this.basis.origin);
    this.panel.castShadow = this.panel.receiveShadow = true;
    this.group.add(this.panel);
    this.ctx.registerHittable(this.panel, (hit) => this.firstHit(hit));
  }

  private firstHit(hit: HitInfo): void {
    if (hit.speed < 9) {
      // weak hit: ductile plastic just scuffs
      playImpact('plastic', 0.4);
      this.ctx.particles.burst(hit.point, hit.dir, 25, new THREE.Color(0xbcd8ff), {
        speed: 1.5,
        spread: 1,
        size: 0.01,
        life: 0.8,
      });
      return;
    }
    if (!this.panel) return;
    this.ctx.unregisterHittable(this.panel);
    this.group.remove(this.panel);
    disposeMesh(this.ctx.scene, this.panel);
    this.panel = null;
    this.tear(hit);
  }

  /** Punch a petaled hole at the impact and re-tessellate the rest of the
   * panel into cells (exact seams -> still looks like one solid sheet). */
  private tear(hit: HitInfo): void {
    playImpact('plastic', Math.min(1.3, hit.speed / 14));

    const p = worldToPanel(this.basis, hit.point);
    p.x = THREE.MathUtils.clamp(p.x, -PANE_W / 2 + 0.05, PANE_W / 2 - 0.05);
    p.y = THREE.MathUtils.clamp(p.y, -PANE_H / 2 + 0.05, PANE_H / 2 - 0.05);

    const corners: P2[] = [
      { x: -PANE_W / 2, y: -PANE_H / 2 },
      { x: PANE_W / 2, y: -PANE_H / 2 },
      { x: PANE_W / 2, y: PANE_H / 2 },
      { x: -PANE_W / 2, y: PANE_H / 2 },
    ];
    let maxR = 0;
    for (const c of corners) maxR = Math.max(maxR, Math.hypot(c.x - p.x, c.y - p.y));

    const holeR = THREE.MathUtils.clamp(hit.speed * 0.008, 0.05, 0.1); // punched core
    const petalR = holeR * rand(2.1, 2.6); // petal reach
    const numRays = randInt(6, 8);

    const angles: number[] = [];
    for (let i = 0; i < numRays; i++) {
      angles.push((i / numRays) * Math.PI * 2 + rand(-0.6, 0.6) * (Math.PI / numRays));
    }
    angles.sort((a, b) => a - b);

    // node lattice: core ring, petal ring, then coarse outer rings
    const radii = [holeR * 0.35, petalR];
    let r = petalR * 1.9;
    while (r < maxR) {
      radii.push(r);
      r *= rand(1.9, 2.4);
    }
    radii.push(maxR * 1.7);

    const nodes: P2[][] = [];
    for (let i = 0; i < numRays; i++) {
      nodes.push([]);
      for (let k = 0; k < radii.length; k++) {
        const jag = k === 1 ? 0.32 : 0.16; // tear edges are raggedy
        const a = angles[i] + rand(-jag, jag) * (Math.PI / numRays);
        const rr = radii[k] * rand(0.9, 1.12);
        nodes[i].push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
      }
    }

    const dirW = hit.dir.clone();
    const pushSign = dirW.dot(this.basis.n) >= 0 ? 1 : -1;

    for (let i = 0; i < numRays; i++) {
      const i2 = (i + 1) % numRays;
      for (let k = 0; k < radii.length - 1; k++) {
        const quad: P2[] = [nodes[i][k], nodes[i2][k], nodes[i2][k + 1], nodes[i][k + 1]];
        const cell = clipToRect(quad.map((q) => ({ ...q })), PANE_W / 2, PANE_H / 2);
        if (cell.length < 3) continue;
        const shard = extrudePoly(this.basis, cell, PANE_T);

        if (k === 0) {
          // PETAL: stays attached, bends outward around its outer edge
          this.addPetal(shard, nodes[i][1], nodes[i2][1], pushSign, hit.speed);
        } else {
          // rest of sheet: static cells, whitened when near the tear
          this.addStaticCell(shard, k === 1);
        }
      }
    }

    // punched-out core: a few jagged fragments + spray
    const coreFrags = randInt(2, 4);
    for (let f = 0; f < coreFrags; f++) {
      const a0 = rand(0, Math.PI * 2);
      const poly: P2[] = [];
      const nv = randInt(4, 6);
      for (let v = 0; v < nv; v++) {
        const a = a0 + (v / nv) * Math.PI * 2;
        const rr = holeR * 0.4 * rand(0.5, 1);
        poly.push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
      }
      const shard = extrudePoly(this.basis, poly, PANE_T);
      spawnShardBody(this.ctx, shard, [this.plasticMat, this.tornMat], {
        velocity: dirW.clone().multiplyScalar(hit.speed * rand(0.35, 0.6)).add(randomSpin(1)),
        angVel: randomSpin(18),
        density: 950,
        restitution: 0.4,
        friction: 0.4,
      });
    }

    this.ctx.particles.burst(hit.point, dirW, 60, new THREE.Color(0xcfe3ff), {
      speed: hit.speed * 0.15,
      spread: 0.6,
      size: 0.012,
      life: 1.0,
      drag: 2,
    });
  }

  private addPetal(shard: Shard, hingeA2: P2, hingeB2: P2, pushSign: number, speed: number): void {
    const { centroid } = volumeCentroid(shard);
    const local: Shard = {
      faces: shard.faces.map((f) => f.map((v) => v.clone().sub(centroid))),
      inner: shard.inner.slice(),
    };
    const mesh = new THREE.Mesh(shardToGeometry(local), [this.whitenedMat, this.tornMat]);
    mesh.position.copy(centroid);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);

    const hA = panelToWorld(this.basis, hingeA2, 0);
    const hB = panelToWorld(this.basis, hingeB2, 0);
    const pivot = hA.clone().add(hB).multiplyScalar(0.5);
    let axis = hB.clone().sub(hA).normalize();

    // choose rotation sign so the petal's free end moves along the push dir
    const arm = centroid.clone().sub(pivot);
    const moveDir = new THREE.Vector3().crossVectors(axis, arm);
    if (moveDir.dot(this.basis.n.clone().multiplyScalar(pushSign)) < 0) axis.negate();

    this.petals.push({
      mesh,
      pivot,
      axis,
      basePos: centroid.clone(),
      angle: 0,
      vel: THREE.MathUtils.clamp(speed * 0.9, 6, 20), // initial angular speed
      target: THREE.MathUtils.clamp(speed * 0.055, 0.5, 1.5), // rest bend angle
    });
  }

  private addStaticCell(shard: Shard, nearTear: boolean): void {
    const { centroid } = volumeCentroid(shard);
    const local: Shard = {
      faces: shard.faces.map((f) => f.map((v) => v.clone().sub(centroid))),
      inner: shard.inner.slice(),
    };
    const mesh = new THREE.Mesh(shardToGeometry(local), [
      nearTear ? this.whitenedMat : this.plasticMat,
      this.tornMat,
    ]);
    mesh.position.copy(centroid);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    const cell: StaticCell = { mesh, shard: local, centroid };
    this.cells.push(cell);
    this.ctx.registerHittable(mesh, (hit) => this.hitCell(cell, hit));
  }

  /** Later hits tear off nearby already-stressed cells (material fatigue). */
  private hitCell(cell: StaticCell, hit: HitInfo): void {
    playImpact('plastic', Math.min(1.2, hit.speed / 16));
    const torn: StaticCell[] = [];
    for (const c of this.cells) {
      if (c.centroid.distanceTo(hit.point) < 0.22) torn.push(c);
    }
    for (const c of torn) {
      const i = this.cells.indexOf(c);
      if (i >= 0) this.cells.splice(i, 1);
      this.ctx.unregisterHittable(c.mesh);
      this.group.remove(c.mesh);
      const world: Shard = {
        faces: c.shard.faces.map((f) => f.map((v) => v.clone().add(c.mesh.position))),
        inner: c.shard.inner.slice(),
      };
      disposeMesh(this.ctx.scene, c.mesh);
      spawnShardBody(this.ctx, world, [this.whitenedMat, this.tornMat], {
        velocity: hit.dir.clone().multiplyScalar(hit.speed * 0.18).add(randomSpin(0.8)),
        angVel: randomSpin(6),
        density: 950,
        restitution: 0.35,
        friction: 0.45,
      });
    }
    this.ctx.particles.burst(hit.point, hit.dir, 40, new THREE.Color(0xcfe3ff), {
      speed: hit.speed * 0.12,
      spread: 0.8,
      size: 0.012,
      life: 0.9,
    });
  }

  update(dt: number): void {
    // petal bending: springy hinge that settles at the plastic rest angle
    for (const pt of this.petals) {
      if (Math.abs(pt.target - pt.angle) < 1e-3 && Math.abs(pt.vel) < 1e-3) continue;
      const k = 60;
      const damp = 9;
      pt.vel += (pt.target - pt.angle) * k * dt - pt.vel * damp * dt;
      pt.angle += pt.vel * dt;
      const q = new THREE.Quaternion().setFromAxisAngle(pt.axis, pt.angle);
      pt.mesh.quaternion.copy(q);
      pt.mesh.position.copy(
        pt.basePos.clone().sub(pt.pivot).applyQuaternion(q).add(pt.pivot)
      );
    }
  }

  reset(): void {
    for (const c of this.cells) {
      this.ctx.unregisterHittable(c.mesh);
      this.group.remove(c.mesh);
      disposeMesh(this.ctx.scene, c.mesh);
    }
    this.cells = [];
    for (const pt of this.petals) {
      this.group.remove(pt.mesh);
      disposeMesh(this.ctx.scene, pt.mesh);
    }
    this.petals = [];
    if (this.panel) {
      this.ctx.unregisterHittable(this.panel);
      this.group.remove(this.panel);
      disposeMesh(this.ctx.scene, this.panel);
      this.panel = null;
    }
    this.buildPanel();
  }
}
