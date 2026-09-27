import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAT } from './materials.js';

// ---------------------------------------------------------------------------
// Mines. Two kinds, both modelled properly:
//
//  * Teller (anti-tank): a 65 cm dished steel plate with the raised cruciform
//    "X" pressure spider on top, carry handle on the rim, half buried.
//  * S-mine (anti-personnel): small canister with three trip prongs. Won't
//    kill you outright but it will wreck a wheel.
//
// They are drawn with InstancedMesh (two per kind, one per material) so a few
// hundred mines cost four draw calls, and an exploded mine is removed by
// zeroing its instance matrix.
// ---------------------------------------------------------------------------

function tellerParts() {
  const body = [];
  const detail = [];

  const plate = new THREE.CylinderGeometry(0.56, 0.52, 0.16, 12);
  plate.translate(0, 0.08, 0);
  body.push(plate);

  const rim = new THREE.TorusGeometry(0.55, 0.045, 3, 12);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.16, 0);
  detail.push(rim);

  // the cruciform pressure spider - the X
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.BoxGeometry(0.17, 0.075, 0.98);
    arm.rotateY((i * Math.PI) / 4);
    arm.translate(0, 0.2, 0);
    if (i % 2 === 0) detail.push(arm);
  }
  const armA = new THREE.BoxGeometry(0.18, 0.08, 1.0);
  armA.rotateY(Math.PI / 4);
  armA.translate(0, 0.2, 0);
  const armB = new THREE.BoxGeometry(0.18, 0.08, 1.0);
  armB.rotateY(-Math.PI / 4);
  armB.translate(0, 0.2, 0);
  detail.push(armA, armB);

  const cap = new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8);
  cap.translate(0, 0.24, 0);
  detail.push(cap);

  const handle = new THREE.TorusGeometry(0.13, 0.03, 3, 6, Math.PI);
  handle.rotateZ(Math.PI / 2);
  handle.translate(0.55, 0.14, 0);
  detail.push(handle);

  return {
    body: BufferGeometryUtils.mergeGeometries(body.map((g) => g.toNonIndexed())),
    detail: BufferGeometryUtils.mergeGeometries(detail.map((g) => g.toNonIndexed())),
  };
}

function sMineParts() {
  const body = [];
  const detail = [];
  const can = new THREE.CylinderGeometry(0.19, 0.19, 0.3, 9);
  can.translate(0, 0.15, 0);
  body.push(can);
  const lip = new THREE.CylinderGeometry(0.21, 0.21, 0.05, 9);
  lip.translate(0, 0.31, 0);
  detail.push(lip);
  // three trip prongs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = new THREE.CylinderGeometry(0.018, 0.018, 0.34, 4);
    prong.translate(Math.cos(a) * 0.07, 0.5, Math.sin(a) * 0.07);
    prong.rotateX(0);
    detail.push(prong);
  }
  const head = new THREE.CylinderGeometry(0.055, 0.045, 0.08, 6);
  head.translate(0, 0.38, 0);
  detail.push(head);
  return {
    body: BufferGeometryUtils.mergeGeometries(body.map((g) => g.toNonIndexed())),
    detail: BufferGeometryUtils.mergeGeometries(detail.map((g) => g.toNonIndexed())),
  };
}

export class MineField {
  /**
   * @param {Array<{x,z,y,kind,yaw}>} mines
   */
  constructor(mines) {
    this.group = new THREE.Group();
    this.group.name = 'mines';
    this.mines = mines.map((m) => ({ ...m, alive: true }));

    // a ring of scraped, disturbed earth around each mine: the tell that
    // gives a sharp-eyed driver a chance to swerve
    const patch = (r) => {
      const g = new THREE.CircleGeometry(r, 9);
      g.rotateX(-Math.PI / 2);
      return g;
    };

    const kinds = {
      tank: { parts: tellerParts(), mats: [MAT.oliveDark, MAT.steelDark], scale: 1.0, lift: 0.1, patch: 1.3 },
      ap: { parts: sMineParts(), mats: [MAT.steelDark, MAT.gunmetal], scale: 1.1, lift: 0.08, patch: 0.7 },
    };

    this.slots = new Map();
    const dummy = new THREE.Object3D();
    for (const kind of Object.keys(kinds)) {
      const list = this.mines.filter((m) => m.kind === kind);
      if (!list.length) continue;
      const spec = kinds[kind];
      const meshes = [
        new THREE.InstancedMesh(spec.parts.body, spec.mats[0], list.length),
        new THREE.InstancedMesh(spec.parts.detail, spec.mats[1], list.length),
      ];
      const patchMesh = new THREE.InstancedMesh(
        patch(spec.patch),
        new THREE.MeshLambertMaterial({ color: 0x7d6a4c, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
        list.length,
      );
      patchMesh.receiveShadow = true;
      meshes.push(patchMesh);
      list.forEach((m, i) => {
        dummy.position.set(m.x, m.y + spec.lift, m.z);
        dummy.rotation.set(m.tiltX || 0, m.yaw || 0, m.tiltZ || 0);
        dummy.scale.setScalar(spec.scale);
        dummy.updateMatrix();
        for (const mesh of meshes) mesh.setMatrixAt(i, dummy.matrix);
        m.bodyMatrix = dummy.matrix.clone();
        // the disturbed-earth patch stays flat on the ground
        dummy.position.set(m.x, m.y + 0.06, m.z);
        dummy.rotation.set(0, m.yaw || 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        patchMesh.setMatrixAt(i, dummy.matrix);
        m.patchMatrix = dummy.matrix.clone();
        m.patchMesh = patchMesh;
        m.slot = i;
        m.meshes = meshes;
      });
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
      this.slots.set(kind, meshes);
    }

    // broad-phase grid
    this.cell = 20;
    this.grid = new Map();
    for (const m of this.mines) {
      const k = this._key(m.x, m.z);
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, (b = []));
      b.push(m);
    }
  }

  _key(x, z) {
    return (Math.floor(x / this.cell) * 73856093) ^ (Math.floor(z / this.cell) * 19349663);
  }

  /** Mines within `radius` of (x,z) that are still armed. */
  query(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const b = this.grid.get(((cx + i) * 73856093) ^ ((cz + j) * 19349663));
        if (!b) continue;
        for (const m of b) {
          if (!m.alive) continue;
          if (Math.hypot(m.x - x, m.z - z) <= radius) out.push(m);
        }
      }
    }
    return out;
  }

  /** Re-arm everything (used on restart - the world itself is deterministic). */
  reset() {
    for (const m of this.mines) {
      if (m.alive) continue;
      m.alive = true;
      for (const mesh of m.meshes) mesh.setMatrixAt(m.slot, m.bodyMatrix);
      m.patchMesh.setMatrixAt(m.slot, m.patchMatrix);
      for (const mesh of m.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  detonate(mine) {
    if (!mine.alive) return;
    mine.alive = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of mine.meshes) {
      mesh.setMatrixAt(mine.slot, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
