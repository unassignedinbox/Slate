import * as THREE from 'three';
import { MAT } from '../props/materials.js';
import { box, cyl, mergeInPlace, prism } from '../util/geo.js';
import { WEAPONS } from '../config.js';
import { clamp, damp, makeRNG } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// Low-poly ground-attack aircraft.
//
// They come in on a straight attack run at 70-90 m, solve the ballistic drop
// for the car's predicted position, release, then pull up and away. The bombs
// keep the aircraft's forward speed, whistle on the way down, and throw up a
// proper crater. Stay off the open road when you hear the engines.
// ---------------------------------------------------------------------------

export function buildPlane(seed = 1) {
  const g = new THREE.Group();
  const paint = MAT.oliveDark;
  const paintLight = MAT.olive;

  // fuselage: tapered prism, nose at +Z
  const fus = prism([
    [-0.55, 0], [0.55, 0], [0.62, 0.55], [0.3, 0.95], [-0.3, 0.95], [-0.62, 0.55],
  ], 7.4, paint);
  fus.rotation.y = Math.PI / 2;
  fus.position.y = 0.1;
  g.add(fus);
  // nose cowling + spinner + prop
  g.add(cyl(0.62, 0.68, 0.7, 9, MAT.steelDark, 0, 0.5, 3.6, Math.PI / 2, 0, 0));
  g.add(cyl(0.1, 0.3, 0.6, 8, MAT.gunmetal, 0, 0.5, 4.1, Math.PI / 2, 0, 0));
  const prop = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = box(0.14, 2.9, 0.06, MAT.black, 0, 0, 0, 0, 0, (i * Math.PI * 2) / 3);
    blade.rotation.z = (i * Math.PI * 2) / 3;
    prop.add(blade);
  }
  prop.position.set(0, 0.5, 4.3);
  g.add(prop);

  // wings: tapered, slight dihedral, kinked (gull) inner section
  for (const s of [-1, 1]) {
    const inner = box(3.4, 0.22, 2.0, paintLight, s * 1.9, 0.28, 0.4, 0, 0, s * -0.16);
    g.add(inner);
    const outer = box(3.6, 0.18, 1.5, paintLight, s * 5.3, 0.62, 0.5, 0, s * 0.06, s * 0.1);
    g.add(outer);
    g.add(box(1.0, 0.1, 0.5, paint, s * 6.9, 0.7, 0.5)); // tip
    // fixed undercarriage with spats
    g.add(box(0.3, 0.7, 0.4, paint, s * 2.2, -0.3, 0.9));
    g.add(cyl(0.34, 0.34, 0.2, 8, MAT.black, s * 2.2, -0.75, 0.9, 0, 0, Math.PI / 2));
  }
  // canopy
  g.add(box(0.9, 0.5, 2.4, MAT.glass, 0, 1.15, 0.5));
  g.add(box(0.95, 0.12, 2.5, paint, 0, 1.45, 0.5));
  // tail
  g.add(box(2.8, 0.14, 1.0, paintLight, 0, 0.5, -3.1));
  g.add(box(0.14, 1.5, 1.3, paintLight, 0, 1.1, -3.3));
  g.add(box(0.5, 0.1, 0.5, paint, 0, -0.1, -3.4));
  // markings
  for (const s of [-1, 1]) g.add(cyl(0.45, 0.45, 0.03, 8, MAT.white, s * 4.2, 0.72, 0.5));
  g.add(box(0.9, 0.12, 0.9, MAT.black, 0, 0.95, -3.3, 0, 0, 0.78));

  mergeInPlace(prop);
  mergeInPlace(g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.prop = prop;
  return g;
}

function buildBomb() {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.16, 1.0, 8, MAT.oliveDark, 0, 0, 0, Math.PI / 2, 0, 0));
  g.add(cyl(0.02, 0.16, 0.42, 8, MAT.oliveDark, 0, 0, 0.7, -Math.PI / 2, 0, 0));
  for (let i = 0; i < 4; i++) {
    const fin = box(0.03, 0.34, 0.34, MAT.steelDark, 0, 0, -0.55);
    fin.rotation.z = (i * Math.PI) / 2;
    g.add(fin);
  }
  g.add(box(0.36, 0.05, 0.05, MAT.rust, 0, 0.17, 0));
  return mergeInPlace(g);
}

const _v = new THREE.Vector3();

class Plane {
  constructor(model, start, dirYaw, altitude, speed, bombs) {
    this.model = model;
    this.pos = start.clone();
    this.yaw = dirYaw;
    this.altitude = altitude;
    this.speed = speed;
    this.bombsLeft = bombs;
    this.dropTimer = 0;
    this.life = 0;
    this.bank = 0;
    this.pitch = 0;
    this.released = false;
    this.state = 'run';
  }
}

export class AirSupport {
  constructor(scene, field, effects, audio) {
    this.scene = scene;
    this.field = field;
    this.effects = effects;
    this.audio = audio;
    this.planes = [];
    this.bombs = [];
    this.pool = [];
    this.bombPool = [];
    this.rng = makeRNG(4242);
    this.cooldown = 22;
    this.group = new THREE.Group();
    this.group.name = 'aircraft';
    scene.add(this.group);

    // ground shadows
    this.shadowGeo = new THREE.CircleGeometry(1, 10);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x2a2b26, transparent: true, opacity: 0.3, depthWrite: false });
  }

  _takePlane() {
    let m = this.pool.pop();
    if (!m) {
      m = buildPlane();
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.scale.setScalar(6);
      m.userData.shadow = shadow;
    }
    this.group.add(m);
    this.group.add(m.userData.shadow);
    return m;
  }

  _takeBomb() {
    let m = this.bombPool.pop();
    if (!m) m = buildBomb();
    this.group.add(m);
    return m;
  }

  /** Send a flight of aircraft after the car. */
  launch(car, count = 1) {
    for (let i = 0; i < count; i++) {
      const approach = this.rng.range(-0.55, 0.55) + (this.rng.chance(0.5) ? 0 : Math.PI);
      const dist = 420 + i * 60;
      const alt = this.rng.range(62, 88);
      const start = new THREE.Vector3(
        car.pos.x - Math.sin(approach) * dist + this.rng.range(-70, 70),
        this.field.height(car.pos.x, car.pos.z) + alt,
        car.pos.z - Math.cos(approach) * dist + this.rng.range(-70, 70),
      );
      const model = this._takePlane();
      const plane = new Plane(model, start, approach, alt, this.rng.range(78, 95), this.rng.int(1, 2));
      plane.delay = i * 1.1;
      this.planes.push(plane);
    }
    if (this.audio) this.audio.planeIncoming();
  }

  update(dt, car, progress, gameTime) {
    // --- wave scheduling: heavier as you get deeper inland --------------------
    this.cooldown -= dt;
    if (this.cooldown <= 0 && car.alive) {
      const pressure = clamp(progress * 1.4 + gameTime / 260, 0, 1.6);
      this.launch(car, 1 + (this.rng.chance(pressure * 0.5) ? 1 : 0));
      this.cooldown = clamp(30 - pressure * 13, 11, 30) * this.rng.range(0.8, 1.25);
    }

    // --- aircraft -------------------------------------------------------------
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.life += dt;
      if (p.delay > 0) {
        p.delay -= dt;
        p.model.visible = false;
        p.model.userData.shadow.visible = false;
        continue;
      }
      p.model.visible = true;
      p.model.userData.shadow.visible = true;

      const dx = car.pos.x - p.pos.x;
      const dz = car.pos.z - p.pos.z;
      const distToCar = Math.hypot(dx, dz);

      if (p.state === 'run') {
        // gently steer onto the target
        const desired = Math.atan2(dx, dz);
        let delta = desired - p.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const turn = clamp(delta, -0.5 * dt, 0.5 * dt);
        p.yaw += turn;
        p.bank = damp(p.bank, clamp(delta * 1.1, -0.8, 0.8), 2.5, dt);
        p.pitch = damp(p.pitch, -0.04, 2, dt);

        // ballistic release solution
        const groundY = this.field.height(car.pos.x, car.pos.z);
        const fall = Math.max(1, p.pos.y - groundY - 0.5);
        const tFall = Math.sqrt((2 * fall) / 9.81);
        const releaseDist = p.speed * tFall;
        if (p.bombsLeft > 0 && distToCar < releaseDist + 18 && Math.abs(delta) < 0.35) {
          this.dropBomb(p, car);
          p.bombsLeft--;
          p.dropTimer = 0.45;
          if (p.bombsLeft <= 0) p.state = 'climb';
        }
        if (distToCar < 40 && p.bombsLeft > 0) {
          // overshot - go around
          p.state = 'climb';
        }
      } else {
        p.pitch = damp(p.pitch, 0.22, 1.5, dt);
        p.bank = damp(p.bank, 0.35, 1.2, dt);
        p.yaw += 0.22 * dt;
        p.altitude += 18 * dt;
      }

      const climbRate = Math.sin(p.pitch) * p.speed;
      p.pos.x += Math.sin(p.yaw) * p.speed * dt;
      p.pos.z += Math.cos(p.yaw) * p.speed * dt;
      p.pos.y += climbRate * dt;
      const minY = this.field.height(p.pos.x, p.pos.z) + 32;
      if (p.pos.y < minY) p.pos.y = minY;

      p.model.position.copy(p.pos);
      p.model.rotation.set(0, 0, 0);
      p.model.rotateY(p.yaw);
      p.model.rotateX(p.pitch);
      p.model.rotateZ(-p.bank);
      p.model.userData.prop.rotation.z += dt * 46;

      const sh = p.model.userData.shadow;
      const gy = this.field.height(p.pos.x, p.pos.z);
      sh.position.set(p.pos.x, gy + 0.15, p.pos.z);
      sh.scale.setScalar(clamp(9 - (p.pos.y - gy) * 0.03, 3.5, 9));
      sh.material.opacity = clamp(0.32 - (p.pos.y - gy) * 0.0016, 0.05, 0.32);

      if (this.audio) this.audio.planeDrone(p.pos, distToCar, p.life);

      if (p.life > 34 || (p.state === 'climb' && distToCar > 620)) {
        this.group.remove(p.model);
        this.group.remove(p.model.userData.shadow);
        this.pool.push(p.model);
        this.planes.splice(i, 1);
      }
    }

    // --- bombs ----------------------------------------------------------------
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.vel.y -= 9.81 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.life += dt;
      b.model.position.copy(b.pos);
      _v.copy(b.vel).normalize();
      b.model.lookAt(b.pos.x + _v.x, b.pos.y + _v.y, b.pos.z + _v.z);
      if (b.life > 0.25 && this.audio) this.audio.bombWhistle(b.pos, b.vel.y);

      const ground = this.field.height(b.pos.x, b.pos.z);
      const hitCar = Math.hypot(b.pos.x - car.pos.x, b.pos.y - car.pos.y - 0.7, b.pos.z - car.pos.z) < 2.2;
      if (b.pos.y <= ground || hitCar) {
        const at = new THREE.Vector3(b.pos.x, Math.max(ground, b.pos.y) + 0.4, b.pos.z);
        this.detonate(at, car);
        this.group.remove(b.model);
        this.bombPool.push(b.model);
        this.bombs.splice(i, 1);
      } else if (b.life > 14) {
        this.group.remove(b.model);
        this.bombPool.push(b.model);
        this.bombs.splice(i, 1);
      }
    }
  }

  dropBomb(plane, car) {
    const model = this._takeBomb();
    const pos = plane.pos.clone();
    pos.y -= 0.8;
    const bomb = {
      model,
      pos,
      vel: new THREE.Vector3(Math.sin(plane.yaw) * plane.speed, -2, Math.cos(plane.yaw) * plane.speed),
      life: 0,
    };
    model.position.copy(pos);
    this.bombs.push(bomb);
  }

  detonate(at, car) {
    this.effects.explosion(at, 2.1);
    if (this.audio) this.audio.explosion(at, 1.3);
    const d = Math.hypot(at.x - car.pos.x, at.z - car.pos.z);
    if (d < WEAPONS.bombRadius * 2.5) this.nearMisses = (this.nearMisses || 0) + 1;
    if (d < WEAPONS.bombRadius && car.alive) {
      const falloff = 1 - d / WEAPONS.bombRadius;
      car.damage(WEAPONS.bombDamage * falloff * falloff, 'bomb');
      car.impactShake = Math.max(car.impactShake || 0, falloff);
      // blast shoves the car
      const push = falloff * 9;
      car.speed += (Math.random() - 0.3) * push * 0.4;
      if (falloff > 0.55) {
        car.airborne = true;
        car.vy = Math.max(car.vy, falloff * 7);
      }
    }
    this.lastBlast = { pos: at.clone(), time: 0 };
  }
}
