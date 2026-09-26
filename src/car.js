import * as THREE from 'three';
import { mat, buildLoft } from './materials.js';
import { CAR, DIFFICULTY, SPAWN } from './config.js';
import { SURF, SURFACE_GRIP } from './terrain.js';
import { clamp, lerp, damp, smoothstep, moveTowards } from './util.js';

/* ------------------------------------------------------------------ */
/* Model — a low-poly compact sedan (Sentra-ish three-box saloon)      */
/* ------------------------------------------------------------------ */

/** Build one body cross-section polygon from simple parameters. */
function bodySection(z, p) {
  const { yb, yt, wb, wm, wt, crown = 0.015, tuck = 0.1 } = p;
  return {
    z,
    pts: [
      [0, yb - 0.01],
      [wb, yb],
      [wm, yb + tuck + 0.16],
      [wm, yt - 0.18],
      [wt, yt],
      [0, yt + crown],
      [-wt, yt],
      [-wm, yt - 0.18],
      [-wm, yb + tuck + 0.16],
      [-wb, yb],
    ],
  };
}

function greenhouseSection(z, yTop, wTop, wBottom, yBottom = 0.84) {
  const crown = 0.018;
  return {
    z,
    pts: [
      [0, yBottom - 0.01],
      [wBottom, yBottom],
      [wTop, yTop - 0.1],
      [wTop * 0.82, yTop],
      [0, yTop + crown],
      [-wTop * 0.82, yTop],
      [-wTop, yTop - 0.1],
      [-wBottom, yBottom],
    ],
  };
}

const GREENHOUSE = [
  { z: 1.06, y: 0.99, w: 0.735 },
  { z: 0.62, y: 1.19, w: 0.715 },
  { z: 0.18, y: 1.402, w: 0.678 },
  { z: -0.42, y: 1.452, w: 0.678 },
  { z: -0.98, y: 1.436, w: 0.672 },
  { z: -1.34, y: 1.3, w: 0.7 },
  { z: -1.68, y: 1.01, w: 0.742 },
];

function makeWheel(radius, width) {
  const g = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 14, 1);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, mat(0x1c1c1e, { roughness: 0.98 }));
  tire.castShadow = true;
  g.add(tire);

  const rimGeo = new THREE.CylinderGeometry(radius * 0.63, radius * 0.63, width + 0.03, 12, 1);
  rimGeo.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, mat(0x9aa0a4, { roughness: 0.5, metalness: 0.5 }));
  g.add(rim);

  const hubGeo = new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, width + 0.06, 8, 1);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, mat(0x6d7276, { roughness: 0.6, metalness: 0.4 }));
  g.add(hub);

  // Five simple spokes cut the rim face so wheels read as wheels while spinning.
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.05, 0.055, radius * 0.5),
      mat(0x7d8286, { roughness: 0.55, metalness: 0.45 })
    );
    spoke.rotation.x = (i / 5) * Math.PI * 2;
    spoke.position.set(0, 0, 0);
    spoke.translateZ(radius * 0.32);
    g.add(spoke);
  }
  return g;
}

function makeSandbag(w = 0.46, h = 0.19, d = 0.28, color = 0xbfae86) {
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setX(i, x * (1 - Math.abs(y / h) * 0.28));
    pos.setZ(i, z * (1 - Math.abs(y / h) * 0.22) * (1 - Math.abs(x / w) * 0.25));
    pos.setY(i, y * (1 - Math.abs(x / w) * 0.18));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat(color, { roughness: 1.0 }));
}

export function createCarModel(paint = 0xb9c3c7) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paintMat = mat(paint, { roughness: 0.46, metalness: 0.28 });
  const trimMat = mat(0x2a2d30, { roughness: 0.85 });
  const glassMat = mat(0x223038, {
    roughness: 0.15,
    metalness: 0.2,
    transparent: true,
    opacity: 0.62,
  });
  const chromeMat = mat(0xb9bfc4, { roughness: 0.34, metalness: 0.7 });

  /* ---- main body (hood / fenders / doors / boot) ---- */
  const sections = [
    bodySection(-2.26, { yb: 0.33, yt: 0.78, wb: 0.56, wm: 0.76, wt: 0.66 }),
    bodySection(-2.08, { yb: 0.26, yt: 0.86, wb: 0.68, wm: 0.845, wt: 0.77 }),
    bodySection(-1.74, { yb: 0.2, yt: 0.925, wb: 0.735, wm: 0.878, wt: 0.815 }),
    bodySection(-1.12, { yb: 0.175, yt: 0.955, wb: 0.755, wm: 0.892, wt: 0.838 }),
    bodySection(-0.34, { yb: 0.165, yt: 0.968, wb: 0.755, wm: 0.885, wt: 0.845 }),
    bodySection(0.46, { yb: 0.165, yt: 0.968, wb: 0.755, wm: 0.885, wt: 0.845 }),
    bodySection(1.06, { yb: 0.175, yt: 0.95, wb: 0.748, wm: 0.88, wt: 0.838 }),
    bodySection(1.58, { yb: 0.19, yt: 0.9, wb: 0.735, wm: 0.872, wt: 0.815 }),
    bodySection(2.02, { yb: 0.235, yt: 0.845, wb: 0.695, wm: 0.84, wt: 0.775 }),
    bodySection(2.26, { yb: 0.33, yt: 0.755, wb: 0.55, wm: 0.765, wt: 0.635 }),
  ];
  const shell = new THREE.Mesh(buildLoft(sections), paintMat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);

  /* ---- greenhouse (A-pillar, roof, C-pillar) ---- */
  const ghSections = GREENHOUSE.map((s) => greenhouseSection(s.z, s.y, s.w, 0.8));
  const greenhouse = new THREE.Mesh(buildLoft(ghSections), paintMat);
  greenhouse.castShadow = true;
  body.add(greenhouse);

  /* ---- glass ---- */
  const glassGroup = new THREE.Group();
  const quad = (a, b, c, d) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3)
    );
    g.computeVertexNormals();
    return g;
  };
  // Windscreen
  glassGroup.add(
    new THREE.Mesh(
      quad(
        [-0.66, 1.0, 1.055],
        [0.66, 1.0, 1.055],
        [0.6, 1.398, 0.195],
        [-0.6, 1.398, 0.195]
      ),
      glassMat
    )
  );
  // Rear screen
  glassGroup.add(
    new THREE.Mesh(
      quad(
        [-0.6, 1.425, -1.0],
        [0.6, 1.425, -1.0],
        [0.66, 1.03, -1.66],
        [-0.66, 1.03, -1.66]
      ),
      glassMat
    )
  );
  // Side glass (front + rear door, split by the B-pillar)
  for (const side of [-1, 1]) {
    const x = side * 0.695;
    glassGroup.add(
      new THREE.Mesh(
        quad(
          [x, 1.025, 0.5],
          [x, 1.345, 0.16],
          [x, 1.36, -0.34],
          [x, 1.035, -0.32]
        ),
        glassMat
      )
    );
    glassGroup.add(
      new THREE.Mesh(
        quad(
          [x, 1.035, -0.44],
          [x, 1.36, -0.46],
          [x, 1.33, -1.01],
          [x, 1.04, -1.06]
        ),
        glassMat
      )
    );
  }
  glassGroup.children.forEach((m) => {
    m.material = glassMat;
    m.renderOrder = 1;
  });
  body.add(glassGroup);

  /* ---- bumpers, grille, lights ---- */
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 0.2), paintMat);
  frontBumper.position.set(0, 0.5, 2.24);
  body.add(frontBumper);
  const frontValance = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.18, 0.16), trimMat);
  frontValance.position.set(0, 0.33, 2.2);
  body.add(frontValance);

  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.2, 0.18), paintMat);
  rearBumper.position.set(0, 0.52, -2.25);
  body.add(rearBumper);
  const rearValance = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.14), trimMat);
  rearValance.position.set(0, 0.35, -2.22);
  body.add(rearValance);

  // Rocker sills
  for (const side of [-1, 1]) {
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 2.5), trimMat);
    sill.position.set(side * 0.83, 0.25, -0.15);
    body.add(sill);
  }

  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.13, 0.08), mat(0x17191b));
  grille.position.set(0, 0.68, 2.235);
  body.add(grille);
  const grilleBar = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.035, 0.1), chromeMat);
  grilleBar.position.set(0, 0.72, 2.24);
  body.add(grilleBar);

  const headMat = mat(0xfff1cf, { emissive: 0xffe6b0, emissiveIntensity: 0.85, roughness: 0.3 });
  const tailMat = mat(0x8d1a15, { emissive: 0xff2a1a, emissiveIntensity: 0.45, roughness: 0.4 });
  const headlights = [];
  for (const side of [-1, 1]) {
    const hlCase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), mat(0x1c1e20));
    hlCase.position.set(side * 0.54, 0.755, 2.19);
    hlCase.rotation.y = side * -0.1;
    body.add(hlCase);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.115, 0.08), headMat);
    hl.position.set(side * 0.54, 0.755, 2.215);
    hl.rotation.y = side * -0.1;
    body.add(hl);
    headlights.push(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.19, 0.1), tailMat);
    tl.position.set(side * 0.56, 0.78, -2.18);
    body.add(tl);

    // Door mirrors
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.08), trimMat);
    stalk.position.set(side * 0.83, 1.01, 0.62);
    body.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.17), paintMat);
    mirror.position.set(side * 0.92, 1.02, 0.6);
    mirror.rotation.y = side * 0.18;
    body.add(mirror);

    // Door handles
    for (const dz of [-0.06, -0.86]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.16), chromeMat);
      handle.position.set(side * 0.895, 0.885, dz);
      body.add(handle);
    }
  }

  // Number plate + boot trim
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.03), mat(0xd8d4c4));
  plate.position.set(0, 0.58, -2.3);
  body.add(plate);
  const bootTrim = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.035, 0.05), chromeMat);
  bootTrim.position.set(0, 0.9, -2.16);
  body.add(bootTrim);

  // Exhaust
  const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.2, 8);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaust = new THREE.Mesh(exhaustGeo, mat(0x4a4d50, { metalness: 0.6, roughness: 0.5 }));
  exhaust.position.set(0.5, 0.36, -2.3);
  body.add(exhaust);

  // Aerial
  const aerial = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5),
    mat(0x26292b)
  );
  aerial.position.set(-0.72, 1.24, -1.5);
  aerial.rotation.z = 0.16;
  body.add(aerial);

  /* ---- improvised armour: sandbags strapped to roof + bonnet ---- */
  const kit = new THREE.Group();
  const rackMat = mat(0x3c4043, { roughness: 0.7, metalness: 0.3 });
  for (const dz of [0.28, -0.72]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.045, 0.06), rackMat);
    bar.position.set(0, 1.47, dz);
    kit.add(bar);
  }
  const roofBags = [
    [-0.36, 1.56, -0.2, 0.08],
    [0.13, 1.55, -0.24, -0.05],
    [-0.13, 1.56, 0.22, 0.13],
    [0.38, 1.56, 0.18, -0.1],
    [0.0, 1.71, -0.02, 0.05],
  ];
  for (const [x, y, z, rot] of roofBags) {
    const bag = makeSandbag(0.5, 0.2, 0.32, Math.random() > 0.5 ? 0xbfae86 : 0xa99a76);
    bag.position.set(x, y, z);
    bag.rotation.y = rot;
    bag.castShadow = true;
    kit.add(bag);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.9), mat(0x3a3427));
  strap.position.set(-0.2, 1.58, -0.02);
  kit.add(strap);
  const strap2 = strap.clone();
  strap2.position.x = 0.32;
  kit.add(strap2);

  // Steel plate wired over the bonnet
  const plateGeo = new THREE.BoxGeometry(0.98, 0.045, 0.62);
  const bonnetPlate = new THREE.Mesh(
    plateGeo,
    mat(0x7d8489, { roughness: 0.62, metalness: 0.45 })
  );
  bonnetPlate.position.set(-0.04, 0.915, 1.7);
  bonnetPlate.rotation.x = 0.1;
  bonnetPlate.castShadow = true;
  kit.add(bonnetPlate);
  for (const sx of [-0.34, 0.3]) {
    const wire = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.72), mat(0x3a3d3f));
    wire.position.set(sx, 0.895, 1.7);
    wire.rotation.x = 0.1;
    kit.add(wire);
  }
  body.add(kit);

  /* ---- wheels ---- */
  const wheels = [];
  const wheelDefs = [
    { x: -0.79, z: 1.31, steer: true },
    { x: 0.79, z: 1.31, steer: true },
    { x: -0.79, z: -1.31, steer: false },
    { x: 0.79, z: -1.31, steer: false },
  ];
  for (const def of wheelDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(def.x, CAR.wheelRadius, def.z);
    const spin = makeWheel(CAR.wheelRadius, 0.23);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, steer: def.steer, base: pivot.position.clone() });
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  return { root, body, wheels, paintMat, headlights, kit };
}

/* ------------------------------------------------------------------ */
/* Vehicle physics                                                     */
/* ------------------------------------------------------------------ */

export class Car {
  constructor(terrain, ocean) {
    this.terrain = terrain;
    this.ocean = ocean;

    const model = createCarModel();
    this.object = model.root;
    this.bodyGroup = model.body;
    this.wheels = model.wheels;
    this.paintMat = model.paintMat;
    this.model = model;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = SPAWN.heading;
    this.steer = 0;
    this.speed = 0;
    this.airborne = false;
    this.health = CAR.maxHealth;
    this.alive = true;
    this.wheelSpin = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.suspension = 0;
    this.suspensionVel = 0;
    this.pitch = 0;
    this.roll = 0;
    this.slip = 0;
    this.engineLoad = 0;
    this.submerged = 0;
    this.distanceTravelled = 0;
    this.stuckTimer = 0;
    this.lastImpactTime = -10;
    this.time = 0;
    this.onRoad = 0;
    this.surface = SURF.SAND;
    this.recoverHold = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._normal = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._tmpN = new THREE.Vector3();

    this.reset();
  }

  reset() {
    this.pos.set(SPAWN.x, this.terrain.heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
    this.vel.set(0, 0, 0);
    this.yaw = SPAWN.heading;
    this.speed = 0;
    this.health = CAR.maxHealth;
    this.alive = true;
    this.airborne = false;
    this.distanceTravelled = 0;
    this.submerged = 0;
    this.suspension = 0;
    this.suspensionVel = 0;
    this.object.position.copy(this.pos);
    this.object.rotation.set(0, this.yaw, 0);
    this.paintMat.color.setHex(0xb9c3c7);
  }

  get forward() {
    return this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get right() {
    return this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  damage(amount, kind = 'hit') {
    if (!this.alive) return;
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.health -= amount;
    this.lastImpactTime = this.time;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathCause = kind;
    }
    // Paint gets progressively scorched.
    const t = 1 - clamp(this.health / CAR.maxHealth, 0, 1);
    this.paintMat.color.setHex(0xb9c3c7).lerp(new THREE.Color(0x4a4239), t * 0.8);
  }

  heal(amount) {
    if (!Number.isFinite(amount)) return;
    this.health = clamp(this.health + amount, 0, CAR.maxHealth);
    const t = 1 - clamp(this.health / CAR.maxHealth, 0, 1);
    this.paintMat.color.setHex(0xb9c3c7).lerp(new THREE.Color(0x4a4239), t * 0.8);
  }

  applyImpulse(vec) {
    this.vel.add(vec);
    if (vec.y > 1.5) this.airborne = true;
  }

  update(dt, input, world) {
    this.time += dt;
    const terrain = this.terrain;
    const prevPos = this._tmp.copy(this.pos);

    const dead = !this.alive;
    const throttleIn = dead ? 0 : input.throttle;
    const brakeIn = dead ? 1 : input.brake;

    /* ---- surface + water ---- */
    this.surface = terrain.typeAt(this.pos.x, this.pos.z);
    this.onRoad = terrain.roadMaskAt(this.pos.x, this.pos.z);
    const surfaceGrip = SURFACE_GRIP[this.surface] ?? 0.8;
    const waterDepth = this.ocean.depthAt(this.pos.x, this.pos.z);
    this.waterDepth = waterDepth;
    this.submerged = clamp(waterDepth / 1.8, 0, 1);
    const drowning = waterDepth > 1.45;
    if (waterDepth > 0.9 && this.alive) {
      this.damage(DIFFICULTY.drownDps * dt * smoothstep(0.9, 1.9, waterDepth), 'drown');
    }

    /* ---- steering ---- */
    const steerTarget = dead ? 0 : input.steer * CAR.maxSteer * lerp(1, 0.38, clamp(Math.abs(this.speed) / 26, 0, 1));
    const steerRate = Math.abs(steerTarget) > Math.abs(this.steer) ? CAR.steerSpeed : CAR.steerReturn;
    this.steer = moveTowards(this.steer, steerTarget, steerRate * dt);

    /* ---- longitudinal forces ---- */
    const fwd = this.forward.clone();
    const right = this.right.clone();
    let vLong = this.vel.dot(fwd);
    let vLat = this.vel.dot(right);

    const waterPower = drowning ? 0.12 : lerp(1, 0.45, clamp(waterDepth / 1.4, 0, 1));
    const powerCurve = 1 - clamp(Math.abs(vLong) / CAR.maxSpeed, 0, 1) * 0.82;
    let force = 0;
    if (throttleIn > 0) {
      force += throttleIn * CAR.engineForce * powerCurve * surfaceGrip * waterPower;
    }
    if (brakeIn > 0) {
      if (vLong > 0.4) force -= brakeIn * CAR.brakeForce * surfaceGrip;
      else force -= brakeIn * CAR.reverseForce * waterPower;
    }
    this.engineLoad = damp(this.engineLoad, throttleIn, 6, dt);

    // Resistance
    const dragC = CAR.dragCoef * (1 + this.submerged * 5.5) * (1 + (1 - surfaceGrip) * 0.8);
    force -= dragC * vLong * Math.abs(vLong);
    force -= CAR.rollResist * vLong * (2 - surfaceGrip) * 10;
    if (world && world.dragPenalty) force -= world.dragPenalty * vLong * 90;

    // Slope
    const normal = terrain.normalAt(this.pos.x, this.pos.z, this._normal);
    const slopeAccel = 9.81 * normal.y * (normal.x * fwd.x + normal.z * fwd.z);
    vLong += (force / CAR.mass + slopeAccel) * dt;

    if (Math.abs(vLong) < 0.12 && throttleIn === 0 && brakeIn === 0) vLong = 0;
    vLong = clamp(vLong, -CAR.maxReverse, CAR.maxSpeed);

    /* ---- yaw ---- */
    const speedFactor = clamp(Math.abs(vLong) / 4.5, 0, 1);
    const handbrake = input.handbrake && !dead;
    const yawRate =
      (vLong / CAR.wheelBase) * Math.tan(this.steer) * (handbrake ? 1.45 : 1) * speedFactor;
    if (!this.airborne) this.yaw += yawRate * dt;

    // Escape assist. Steering authority scales with speed, so a car shunted
    // nose-first between two hedgehogs would otherwise be pinned there for
    // good. After a second and a half of fruitless effort, let it pivot.
    if (this.stuckTimer > 1.4 && !this.airborne && Math.abs(vLong) < 1.8) {
      const effort = Math.max(Math.abs(throttleIn), Math.abs(brakeIn));
      if (effort > 0.1) {
        this.yaw += this.steer * 1.1 * effort * dt;
        this.wheelSpin += dt * 7;
      }
    }

    /* ---- lateral grip ---- */
    const gripBase = CAR.gripBase * surfaceGrip * (handbrake ? 0.22 : 1) * (this.airborne ? 0.15 : 1);
    vLat *= Math.exp(-gripBase * dt);
    this.slip = damp(this.slip, clamp(Math.abs(vLat) / 7, 0, 1), 8, dt);

    /* ---- recompose horizontal velocity ---- */
    const newFwd = this.forward;
    const newRight = this.right;
    this.vel.x = newFwd.x * vLong + newRight.x * vLat;
    this.vel.z = newFwd.z * vLong + newRight.z * vLat;
    this.speed = vLong;

    /* ---- integrate position ---- */
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Keep the car inside the playfield.
    const pad = 8;
    this.pos.x = clamp(this.pos.x, terrain.minX + pad, terrain.maxX - pad);
    this.pos.z = clamp(this.pos.z, terrain.minZ + pad + 24, terrain.maxZ - pad);

    /* ---- vertical: ground following + jumps ---- */
    const groundY = terrain.heightAt(this.pos.x, this.pos.z);
    const floatY = drowning ? Math.max(groundY, this.ocean.waveHeightAt(this.pos.x, this.pos.z) - 1.1) : groundY;
    if (this.airborne) {
      this.vel.y -= 22 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= floatY) {
        const impact = -this.vel.y;
        this.pos.y = floatY;
        if (impact > 9 && this.alive) {
          this.damage(clamp((impact - 9) * 1.7, 0, 30), 'impact');
          if (world && world.onHardLanding) world.onHardLanding(this.pos, impact);
        }
        this.suspensionVel -= clamp(impact * 0.1, 0, 1.4);
        this.vel.y = 0;
        this.airborne = false;
      }
    } else {
      const desiredVy = (floatY - this.pos.y) / Math.max(dt, 1e-4);
      const gravityLimit = this.vel.y - 22 * dt;
      if (desiredVy < gravityLimit && Math.abs(vLong) > 4) {
        this.airborne = true;
        this.vel.y = gravityLimit;
        this.pos.y += this.vel.y * dt;
      } else {
        this.vel.y = clamp(desiredVy, -30, 30);
        this.pos.y = floatY;
      }
    }

    /* ---- suspension bob ---- */
    this.suspensionVel += -this.suspension * 190 * dt - this.suspensionVel * 9 * dt;
    this.suspension += this.suspensionVel * dt;
    this.suspension = clamp(this.suspension, -0.22, 0.14);

    /* ---- chassis orientation from the 4 contact patches ---- */
    const hw = CAR.trackWidth * 0.5 + 0.08;
    const hl = CAR.wheelBase * 0.5;
    const sampleAt = (dx, dz) => {
      const wx = this.pos.x + newRight.x * dx + newFwd.x * dz;
      const wz = this.pos.z + newRight.z * dx + newFwd.z * dz;
      return terrain.heightAt(wx, wz);
    };
    const hFL = sampleAt(-hw, hl);
    const hFR = sampleAt(hw, hl);
    const hRL = sampleAt(-hw, -hl);
    const hRR = sampleAt(hw, -hl);
    const targetPitch = Math.atan2((hRL + hRR) / 2 - (hFL + hFR) / 2, CAR.wheelBase);
    const targetRoll = Math.atan2((hFR + hRR) / 2 - (hFL + hRL) / 2, CAR.trackWidth);
    const blend = this.airborne ? 1.4 : 11;
    this.pitch = damp(this.pitch, this.airborne ? this.pitch * 0.96 : targetPitch, blend, dt);
    this.roll = damp(this.roll, this.airborne ? this.roll * 0.96 : targetRoll, blend, dt);

    /* ---- visual weight transfer ---- */
    const accel = (vLong - (this.prevVLong ?? vLong)) / Math.max(dt, 1e-4);
    this.prevVLong = vLong;
    this.bodyPitch = damp(this.bodyPitch, clamp(-accel * 0.0055, -0.07, 0.07), 7, dt);
    this.bodyRoll = damp(this.bodyRoll, clamp(vLat * 0.028, -0.1, 0.1), 7, dt);

    /* ---- apply transforms ---- */
    this.object.position.copy(this.pos);
    this.object.rotation.set(0, this.yaw, 0);
    this.object.rotateX(this.pitch);
    this.object.rotateZ(-this.roll);
    this.bodyGroup.position.y = this.suspension;
    this.bodyGroup.rotation.x = this.bodyPitch;
    this.bodyGroup.rotation.z = this.bodyRoll;

    /* ---- wheels ---- */
    this.wheelSpin += (vLong / CAR.wheelRadius) * dt;
    for (const w of this.wheels) {
      if (w.steer) w.pivot.rotation.y = this.steer;
      w.spin.rotation.x = this.wheelSpin;
      const localZ = w.base.z;
      const localX = w.base.x;
      const wx = this.pos.x + newRight.x * localX + newFwd.x * localZ;
      const wz = this.pos.z + newRight.z * localX + newFwd.z * localZ;
      const gh = terrain.heightAt(wx, wz);
      const expected =
        this.pos.y + Math.sin(this.pitch) * -localZ + Math.sin(this.roll) * localX;
      const travel = clamp(gh - expected, -0.18, 0.2);
      w.pivot.position.y = CAR.wheelRadius + (this.airborne ? -0.05 : travel * 0.7) - this.suspension * 0.5;
    }

    /* ---- bookkeeping ---- */
    const moved = Math.hypot(this.pos.x - prevPos.x, this.pos.z - prevPos.z);
    this.distanceTravelled += moved;
    if (Math.abs(this.speed) < 1.2 && (throttleIn > 0.1 || brakeIn > 0.1)) {
      this.stuckTimer += dt;
    } else if (Math.abs(this.speed) > 2) {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

    return { moved, waterDepth };
  }

  /** Push the car out of a static collider, bleed off speed, glance off. */
  collide(pushX, pushZ, severity, damageScale = 1) {
    this.pos.x += pushX;
    this.pos.z += pushZ;
    const n = this._tmpN.set(pushX, 0, pushZ);
    const len = n.length();
    if (len < 1e-5) return 0;
    n.multiplyScalar(1 / len);
    const vn = this.vel.dot(n);
    if (vn >= 0) return 0;

    const impactSpeed = -vn;
    // Kill the component into the obstacle (plus a small bounce)...
    this.vel.addScaledVector(n, -vn * (1 + 0.18 * severity));
    // ...and let the car glance off round clutter instead of welding itself
    // to it: deflect part of the lost speed along the contact tangent.
    const tx = -n.z;
    const tz = n.x;
    const fwd = this.forward;
    const dirSign = Math.sign(fwd.x * tx + fwd.z * tz) || 1;
    const slide = impactSpeed * 0.42 * dirSign;
    this.vel.x += tx * slide;
    this.vel.z += tz * slide;

    const dmg = clamp((impactSpeed - 4.5) * 1.05 * severity * damageScale, 0, 30);
    if (dmg > 0.4) {
      this.damage(dmg, 'crash');
      this.suspensionVel -= 0.4;
      return dmg;
    }
    return 0;
  }
}
