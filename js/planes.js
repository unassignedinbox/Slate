// planes.js — low-poly bomber aircraft that hunt the vehicle with bomb runs.
// A run: spawn seaward, line up on the car's predicted position, drop two
// bombs, climb out. Straight-lining down the road gets you hit; turning
// and using cover keeps you alive.
import * as THREE from './vendor/three.module.min.js';
import { clamp, lerp, part, mergeGeoms } from './utils.js';
import { S, CFG } from './state.js';
import { H } from './world.js';
import { explode } from './combat.js';

const SPEED = 46;          // m/s approach speed
const ALT = 26;            // bombing altitude above the target
const GRAV = 22;           // bomb gravity (gamey, readable arcs)
const DROP_DIST = 96;      // horizontal distance at which bombs release

function buildPlaneMesh() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.35 });
  const BODY = 0x4d565e, DARK = 0x3a4249, ACC = 0x6b747b;
  const body = new THREE.Mesh(mergeGeoms([
    // fuselage
    part(new THREE.BoxGeometry(0.9, 0.85, 5.4), BODY, { p: [0, 0, -0.4] }),
    part(new THREE.BoxGeometry(0.62, 0.6, 1.5), DARK, { p: [0, -0.02, 2.9] }),
    part(new THREE.CylinderGeometry(0.34, 0.44, 0.9, 8), DARK, { p: [0, 0.02, 3.7], r: [Math.PI / 2, 0, 0] }),
    // canopy
    part(new THREE.BoxGeometry(0.56, 0.42, 1.0), 0x2a3b46, { p: [0, 0.55, 0.5], r: [0.12, 0, 0] }),
    // wings (slight dihedral), with tips
    part(new THREE.BoxGeometry(4.3, 0.16, 1.7), BODY, { p: [-2.5, 0.16, 0.2], r: [0, 0, 0.07] }),
    part(new THREE.BoxGeometry(4.3, 0.16, 1.7), BODY, { p: [2.5, 0.16, 0.2], r: [0, 0, -0.07] }),
    part(new THREE.BoxGeometry(0.5, 0.12, 1.1), ACC, { p: [-4.55, 0.44, 0.2], r: [0, 0, 0.07] }),
    part(new THREE.BoxGeometry(0.5, 0.12, 1.1), ACC, { p: [4.55, 0.44, 0.2], r: [0, 0, -0.07] }),
    // tail
    part(new THREE.BoxGeometry(2.4, 0.12, 0.9), BODY, { p: [0, 0.12, -2.75] }),
    part(new THREE.BoxGeometry(0.12, 1.15, 1.0), BODY, { p: [0, 0.62, -2.8] }),
    part(new THREE.BoxGeometry(0.14, 0.5, 0.6), ACC, { p: [0, 1.28, -2.85] }),
    // fixed gear with spats
    part(new THREE.BoxGeometry(0.3, 0.7, 1.1), DARK, { p: [-1.5, -0.55, 0.5], r: [0.25, 0, 0] }),
    part(new THREE.BoxGeometry(0.3, 0.7, 1.1), DARK, { p: [1.5, -0.55, 0.5], r: [0.25, 0, 0] }),
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 8), 0x23262a, { p: [-1.5, -0.9, 0.9], r: [0, 0, Math.PI / 2] }),
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 8), 0x23262a, { p: [1.5, -0.9, 0.9], r: [0, 0, Math.PI / 2] }),
  ]), mat);
  body.castShadow = true;
  // spinning prop
  const prop = new THREE.Mesh(mergeGeoms([
    part(new THREE.BoxGeometry(0.14, 3.1, 0.06), 0x23262a, {}),
    part(new THREE.BoxGeometry(0.06, 0.14, 0.2), 0x23262a, {}),
    part(new THREE.BoxGeometry(0.14, 0.06, 0.2), 0x23262a, {}),
  ]), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 }));
  prop.position.set(0, 0.02, 4.2);
  prop.castShadow = false;
  // wing bombs (hidden as they release)
  const bombGeo = mergeGeoms([
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.85, 8), 0x2c3033, { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.16, 0.06, 0.3, 8), 0x232629, { p: [0, 0, 0.55], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.BoxGeometry(0.04, 0.4, 0.3), 0x3a4249, { p: [0, 0, -0.5] }),
    part(new THREE.BoxGeometry(0.4, 0.04, 0.3), 0x3a4249, { p: [0, 0, -0.5] }),
  ]);
  const bombMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.4 });
  const bL = new THREE.Mesh(bombGeo, bombMat); bL.position.set(-1.5, -0.35, 0.2);
  const bR = new THREE.Mesh(bombGeo, bombMat); bR.position.set(1.5, -0.35, 0.2);
  bL.castShadow = bR.castShadow = true;
  const grp = new THREE.Group();
  grp.add(body, prop, bL, bR);
  return { grp, prop, wingBombs: [bL, bR] };
}

export class Planes {
  constructor(scene) {
    this.scene = scene;
    this.active = null;      // { grp, prop, wingBombs, vel, phase, dropT, dropped, propA }
    this.nextT = 14;         // first run
    this.runs = 0;
    this._bombs = [];        // { mesh, vel, t }
  }

  // test/hook: force a run immediately aimed at the current target
  spawnRun() {
    if (this.active) return;
    this._spawn();
  }

  _spawn() {
    const tgt = this._target();
    if (!tgt) return;
    const built = buildPlaneMesh();
    const grp = built.grp;
    // approach out of the sea, offset to one side, aimed at the target
    const side = Math.random() < 0.5 ? -1 : 1;
    const ang = (Math.random() - 0.5) * 0.5;
    const dirX = Math.sin(ang), dirZ = Math.cos(ang); // fly inland (+z)
    const startX = tgt.pos.x + side * (60 + Math.random() * 50) - dirX * 300;
    const startZ = Math.max(tgt.pos.z - 300, CFG.minZ - 70); // stay over the water, not the void
    const y = tgt.pos.y + ALT;
    grp.position.set(startX, y, startZ);
    grp.rotation.y = Math.atan2(dirX, dirZ);
    // slight bank into the run
    grp.rotation.z = -side * 0.12;
    this.scene.add(grp);
    this.active = {
      grp, prop: built.prop, wingBombs: built.wingBombs,
      vel: new THREE.Vector3(dirX * SPEED, 0, dirZ * SPEED),
      phase: 'run', dropped: 0, dropT: 0, propA: 0,
    };
    this.runs++;
    S.banners.push({ text: 'AIRCRAFT INBOUND — KEEP MOVING', ttl: 3.5, color: '#ffb84d' });
    if (S.audio && S.audio.planeSet) S.audio.planeSet(grp.position);
  }

  _target() {
    const car = S.car;
    if (car && car.alive) return { pos: car.pos, vel: car.forward(_tv).multiplyScalar(car.speed), isCar: true };
    const p = S.player;
    if (p && p.alive) return { pos: p.pos, vel: _tv.set(0, 0, 0), isCar: false };
    return null;
  }

  _dropBomb(from, vel, i) {
    const geo = mergeGeoms([
      part(new THREE.CylinderGeometry(0.16, 0.16, 0.85, 8), 0x2c3033, { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] }),
      part(new THREE.CylinderGeometry(0.16, 0.06, 0.3, 8), 0x232629, { p: [0, 0, 0.55], r: [Math.PI / 2, 0, 0] }),
      part(new THREE.BoxGeometry(0.04, 0.4, 0.3), 0x3a4249, { p: [0, 0, -0.5] }),
      part(new THREE.BoxGeometry(0.4, 0.04, 0.3), 0x3a4249, { p: [0, 0, -0.5] }),
    ]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.4 }));
    mesh.position.copy(from);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this._bombs.push({ mesh, vel: vel.clone(), t: 0 });
    if (S.audio && S.audio.bombWhistle) S.audio.bombWhistle(from);
  }

  update(dt) {
    if (S.mode !== 'play') {
      if (S.audio && S.audio.planeClear && this.active) S.audio.planeClear();
      return;
    }
    // ---- scheduling ----
    this.nextT -= dt;
    if (!this.active && this.nextT <= 0) {
      this._spawn();
      this.nextT = 22 + Math.random() * 16;
    }

    // ---- active plane ----
    const a = this.active;
    if (a) {
      a.propA += dt * 55;
      a.prop.rotation.z = a.propA;
      const tgt = this._target();
      if (a.phase === 'run') {
        a.grp.position.addScaledVector(a.vel, dt);
        // hold altitude over rising terrain
        if (tgt) {
          const ground = H(a.grp.position.x, a.grp.position.z);
          const want = Math.max(tgt.pos.y + ALT, ground + 14);
          a.grp.position.y = lerp(a.grp.position.y, want, clamp(dt * 2, 0, 1));
        }
        // release when the target is inside the drop cone
        if (tgt && a.dropped < 2) {
          a.dropT -= dt;
          const d = Math.hypot(tgt.pos.x - a.grp.position.x, tgt.pos.z - a.grp.position.z);
          if (d < DROP_DIST && a.dropT <= 0) {
            // lead the target: where will it be when the bomb lands?
            const h = a.grp.position.y - tgt.pos.y;
            const fall = Math.sqrt(Math.max(2 * h / GRAV, 0.2));
            const aim = _tv2.copy(tgt.pos).addScaledVector(tgt.vel, fall * 0.82);
            const err = 3.2 + Math.random() * 3.4; // scatter — turning defeats it
            aim.x += (Math.random() - 0.5) * err * 2;
            aim.z += (Math.random() - 0.5) * err * 2;
            // steer the bomb's initial velocity slightly toward the aim point
            const from = a.wingBombs[a.dropped].getWorldPosition(_tv3);
            const vel = a.vel.clone();
            const tof = Math.sqrt(Math.max(2 * (a.grp.position.y - aim.y) / GRAV, 0.2));
            vel.x = (aim.x - from.x) / tof;
            vel.z = (aim.z - from.z) / tof;
            this._dropBomb(from, vel, a.dropped);
            a.wingBombs[a.dropped].visible = false;
            a.dropped++;
            a.dropT = 0.16;
          }
        }
        // passed? climb out and leave
        if (!tgt || a.grp.position.z > CFG.maxZ + 60 || Math.abs(a.grp.position.x) > CFG.maxX + 160 || a.grp.position.z < CFG.minZ - 120) {
          a.phase = 'egress';
        }
      } else {
        a.grp.position.addScaledVector(a.vel, dt);
        a.grp.position.y += dt * 10;
        a.grp.rotation.x = -0.18;
        if (a.grp.position.distanceTo(S.camera ? S.camera.position : a.grp.position) > 420) {
          this.scene.remove(a.grp);
          this.active = null;
          if (S.audio && S.audio.planeClear) S.audio.planeClear();
        }
      }
      if (S.audio && S.audio.planeSet && this.active) S.audio.planeSet(a.grp.position);
    }

    // ---- bombs ----
    for (let i = this._bombs.length - 1; i >= 0; i--) {
      const b = this._bombs[i];
      b.t += dt;
      b.vel.y -= GRAV * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      // point the bomb along its velocity
      const vl = b.vel.length();
      if (vl > 1) b.mesh.quaternion.setFromUnitVectors(_fwd, _tv3.copy(b.vel).divideScalar(vl));
      const ground = H(b.mesh.position.x, b.mesh.position.z);
      if (b.mesh.position.y <= Math.max(ground, S.waterLevel) || b.t > 6) {
        const inWater = S.waterLevel > ground + 0.05;
        const p = b.mesh.position;
        this.scene.remove(b.mesh);
        this._bombs.splice(i, 1);
        if (inWater) {
          // splash column + a dud thump
          if (S.effects) S.effects.burst(p.x, S.waterLevel + 0.2, p.z, 1.4);
          if (S.audio && S.audio.explosion) S.audio.explosion(p, false, 0);
          if (S.effects) S.effects.puff(p.x, S.waterLevel + 0.4, p.z, 3, false);
        } else {
          explode(p.clone().setY(ground + 0.2), { radius: 7, playerDmg: 95, carDmg: 125, big: true });
        }
      }
    }
  }
}

const _tv = new THREE.Vector3();
const _tv2 = new THREE.Vector3();
const _tv3 = new THREE.Vector3();
const _fwd = new THREE.Vector3(0, 0, 1);
