import * as THREE from 'three';
import { mat, mergeParts } from './materials.js';
import { DIFFICULTY, WALL } from './config.js';
import { Rng, clamp } from './util.js';

function apMineGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.19, 0.21, 0.16, 9);
  body.translate(0, 0.06, 0);
  parts.push(body);
  const stem = new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6);
  stem.translate(0, 0.22, 0);
  parts.push(stem);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4);
    prong.rotateZ(0.25);
    prong.rotateY(a);
    prong.translate(Math.cos(a) * 0.04, 0.33, Math.sin(a) * 0.04);
    parts.push(prong);
  }
  return mergeParts(parts);
}

function tellerMineGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.48, 0.5, 0.13, 12);
  body.translate(0, 0.065, 0);
  parts.push(body);
  const cap = new THREE.CylinderGeometry(0.2, 0.24, 0.07, 10);
  cap.translate(0, 0.16, 0);
  parts.push(cap);
  const handle = new THREE.TorusGeometry(0.1, 0.02, 4, 8);
  handle.rotateY(Math.PI / 2);
  handle.translate(0.42, 0.14, 0);
  parts.push(handle);
  return mergeParts(parts);
}

const CELL = 16;

export class Minefield {
  constructor(scene, terrain, colliders, fx) {
    this.terrain = terrain;
    this.colliders = colliders;
    this.fx = fx;
    this.mines = [];
    this.buckets = new Map();
    this.triggered = 0;
    this.pending = [];

    const rng = new Rng(1944);
    const apMat = mat(0x4b4f42, { roughness: 0.95, metalness: 0.2 });
    const tellerMat = mat(0x3d4038, { roughness: 0.92, metalness: 0.3 });

    const apTransforms = [];
    const tellerTransforms = [];

    const onRoad = (x, z) => terrain.roadMaskAt(x, z) > 0.12;
    const valid = (x, z) => {
      if (!terrain.inBounds(x, z, 14)) return false;
      if (z < WALL.z + 22) return false;
      if (onRoad(x, z)) return false;
      const h = terrain.heightAt(x, z);
      if (h < -0.8) return false;
      if (terrain.slopeAt(x, z) > 0.75) return false;
      return true;
    };

    // Dense belts, thickest where the beach narrows in front of the wall.
    const fields = [
      { z: -60, spread: 46, count: 44, teller: 0.34 },
      { z: -140, spread: 42, count: 40, teller: 0.42 },
      { z: -196, spread: 26, count: 34, teller: 0.5 },
      { z: 20, spread: 52, count: 34, teller: 0.24 },
      { z: 104, spread: 44, count: 26, teller: 0.18 },
      { z: 170, spread: 40, count: 20, teller: 0.12 },
    ];

    for (const f of fields) {
      for (let i = 0; i < f.count; i++) {
        const x = rng.float(terrain.minX + 18, terrain.maxX - 18);
        const z = f.z + rng.float(-f.spread, f.spread);
        if (!valid(x, z)) continue;
        const teller = rng.chance(f.teller);
        this._addMine(x, z, teller ? 'teller' : 'ap', teller ? tellerTransforms : apTransforms, rng);
      }
    }

    // A nasty ring of anti-tank mines around each cluster of cover, so the
    // obvious hiding spots are not free.
    const coverSpots = [
      [-128, 16],
      [62, -26],
      [-62, -116],
      [128, -134],
      [-148, -176],
      [92, -186],
    ];
    for (const [cx, cz] of coverSpots) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rng.float(-0.1, 0.1);
        const r = rng.float(26, 34);
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (!valid(x, z)) continue;
        const teller = rng.chance(0.55);
        this._addMine(x, z, teller ? 'teller' : 'ap', teller ? tellerTransforms : apTransforms, rng);
      }
    }

    this.apMesh = this._buildInstances(apMineGeometry(), apMat, apTransforms, scene);
    this.tellerMesh = this._buildInstances(tellerMineGeometry(), tellerMat, tellerTransforms, scene);
  }

  _addMine(x, z, kind, transformList, rng) {
    const y = this.terrain.heightAt(x, z) - (kind === 'teller' ? 0.02 : 0.03);
    const mine = {
      x,
      y,
      z,
      kind,
      alive: true,
      index: transformList.length,
      mesh: kind === 'teller' ? 'teller' : 'ap',
    };
    const xf = { x, y, z, yaw: rng.float(0, Math.PI * 2), scale: rng.float(0.92, 1.12) };
    mine.transform = xf;
    transformList.push(xf);
    this.mines.push(mine);

    const key = this._key(x, z);
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    arr.push(mine);

    const trigger =
      kind === 'teller' ? DIFFICULTY.tellerTrigger : DIFFICULTY.apMineTrigger;
    this.colliders.addCircle(x, z, trigger, {
      kind: 'trigger',
      data: mine,
      onHit: (car) => {
        if (mine.alive) this.queue(mine, 0);
      },
    });
    return mine;
  }

  _key(x, z) {
    return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  }

  _buildInstances(geo, material, transforms, scene) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    transforms.forEach((t, i) => {
      e.set(0, t.yaw, 0);
      q.setFromEuler(e);
      p.set(t.x, t.y, t.z);
      s.setScalar(t.scale);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  queue(mine, delay) {
    if (!mine.alive || mine.queued) return;
    mine.queued = true;
    this.pending.push({ mine, t: delay });
  }

  nearest(x, z, radius = 26) {
    let best = Infinity;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const span = Math.ceil(radius / CELL);
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cz - span; j <= cz + span; j++) {
        const arr = this.buckets.get(`${i},${j}`);
        if (!arr) continue;
        for (const m of arr) {
          if (!m.alive) continue;
          const d = Math.hypot(m.x - x, m.z - z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Re-arm every mine for a fresh attempt. */
  reset() {
    this.triggered = 0;
    this.pending.length = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let dirty = { ap: false, teller: false };
    for (const mine of this.mines) {
      if (mine.alive) continue;
      mine.alive = true;
      const mesh = mine.mesh === 'teller' ? this.tellerMesh : this.apMesh;
      const t = mine.transform;
      if (mesh && t) {
        e.set(0, t.yaw, 0);
        q.setFromEuler(e);
        p.set(t.x, t.y, t.z);
        sc.setScalar(t.scale);
        m.compose(p, q, sc);
        mesh.setMatrixAt(mine.index, m);
        dirty[mine.mesh] = true;
      }
    }
    if (dirty.ap && this.apMesh) this.apMesh.instanceMatrix.needsUpdate = true;
    if (dirty.teller && this.tellerMesh) this.tellerMesh.instanceMatrix.needsUpdate = true;
  }

  explode(mine, ctx) {
    if (!mine.alive) return;
    mine.alive = false;
    this.triggered++;

    // Hide the instance.
    const mesh = mine.mesh === 'teller' ? this.tellerMesh : this.apMesh;
    if (mesh) {
      const m = new THREE.Matrix4();
      m.makeScale(0.0001, 0.0001, 0.0001);
      m.setPosition(mine.x, mine.y - 5, mine.z);
      mesh.setMatrixAt(mine.index, m);
      mesh.instanceMatrix.needsUpdate = true;
    }

    const teller = mine.kind === 'teller';
    const scale = teller ? 2.1 : 1.15;
    const pos = new THREE.Vector3(mine.x, mine.y + 0.2, mine.z);
    this.fx.explosion(pos, scale, { debrisColor: 0xa08b62 });

    const car = ctx.car;
    const dist = Math.hypot(car.pos.x - mine.x, car.pos.z - mine.z);
    const radius = teller ? DIFFICULTY.tellerRadius : DIFFICULTY.apMineRadius;
    if (dist < radius && car.alive) {
      const falloff = 1 - clamp(dist / radius, 0, 1);
      const dmg = (teller ? DIFFICULTY.tellerDamage : DIFFICULTY.apMineDamage) * (0.35 + falloff * 0.85);
      car.damage(dmg, 'mine');
      const push = new THREE.Vector3(car.pos.x - mine.x, 0, car.pos.z - mine.z);
      if (push.lengthSq() < 0.01) push.set(0, 0, 1);
      push.normalize().multiplyScalar((teller ? 11 : 4.5) * falloff);
      push.y = (teller ? 9.5 : 4.2) * falloff;
      car.applyImpulse(push);
      this.fx.addShake(teller ? 1.0 : 0.5);
    } else {
      this.fx.addShake(clamp((teller ? 26 : 14) / Math.max(dist, 6), 0, 0.35));
    }

    if (ctx.audio) ctx.audio.explosion(pos, ctx.listener, teller ? 1.3 : 0.85);

    // Sympathetic detonations.
    const chain = teller ? 7.5 : 4.2;
    const cx = Math.floor(mine.x / CELL);
    const cz = Math.floor(mine.z / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        const arr = this.buckets.get(`${i},${j}`);
        if (!arr) continue;
        for (const other of arr) {
          if (!other.alive || other.queued) continue;
          const d = Math.hypot(other.x - mine.x, other.z - mine.z);
          if (d < chain) this.queue(other, 0.08 + d * 0.02);
        }
      }
    }
  }

  /** Blast from something else (shell, chain) in the area. */
  detonateNear(x, z, radius) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const span = Math.ceil(radius / CELL) + 1;
    for (let i = cx - span; i <= cx + span; i++) {
      for (let j = cz - span; j <= cz + span; j++) {
        const arr = this.buckets.get(`${i},${j}`);
        if (!arr) continue;
        for (const m of arr) {
          if (!m.alive || m.queued) continue;
          const d = Math.hypot(m.x - x, m.z - z);
          if (d < radius) this.queue(m, 0.05 + d * 0.02);
        }
      }
    }
  }

  update(dt, ctx) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        this.pending.splice(i, 1);
        this.explode(p.mine, ctx);
      }
    }
  }
}
