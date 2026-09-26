// car.js — the low-poly sedan (Nissan-Sentra-ish silhouette) + arcade driving
import * as THREE from './vendor/three.module.min.js';
import { clamp, clamp01, lerp, part, mergeGeoms } from './utils.js';
import { S, CFG } from './state.js';
import { H } from './world.js';
import { addSmokeSpot } from './props.js';
import { explode } from './combat.js';

// ------------------------------------------------------------------
// MESH — extruded side profile gives a real sedan silhouette
// ------------------------------------------------------------------
export function buildCarMesh(bodyColor = 0xd0492e, wrecked = false) {
  const group = new THREE.Group();
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: bodyColor, flatShading: true, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({
      color: wrecked ? 0x14181c : 0x9db8c6,
      flatShading: true, roughness: 0.18, metalness: 0.15,
      transparent: !wrecked, opacity: wrecked ? 1 : 0.62,
      side: THREE.DoubleSide,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2e3338, flatShading: true, roughness: 0.6, metalness: 0.3 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x23262a, flatShading: true, roughness: 0.95 }),
    hub: new THREE.MeshStandardMaterial({ color: wrecked ? 0x4a4c50 : 0xb9bcc0, flatShading: true, roughness: 0.4, metalness: 0.6 }),
    light: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0xfff2c8, emissiveIntensity: wrecked ? 0 : 0.8 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x7a1410, emissive: 0xff2211, emissiveIntensity: wrecked ? 0 : 0.7 }),
  };

  // body shell profile (x = length, nose at +x).
  // Points are ordered COUNTER-clockwise so ExtrudeGeometry side normals
  // point outward without relying on its internal winding auto-fix.
  const shellPts = [
    [-2.30, 0.34],   // front bottom
    [2.30, 0.34],    // rear bottom (mirrored below: profile x → world z)
    [2.34, 0.56],    // bumper top
    [2.26, 0.80],    // nose
    [1.92, 0.92],    // hood
    [1.14, 0.99],    // windshield base
    [0.44, 1.38],    // roof front
    [-0.70, 1.34],   // roof rear
    [-1.32, 0.92],   // C-pillar base
    [-1.52, 0.90],   // trunk
    [-2.24, 0.84],   // trunk lip (little ducktail)
    [-2.34, 0.62],
    [-2.30, 0.34],
  ];
  const shell = new THREE.Shape();
  // contour runs: rear-bottom → front-bottom → up the nose → back along the
  // roof → down the tail = counter-clockwise in shape space
  shell.moveTo(shellPts[0][0], shellPts[0][1]);
  for (let i = 1; i < shellPts.length; i++) shell.lineTo(shellPts[i][0], shellPts[i][1]);
  shell.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(shell, { depth: 1.62, bevelEnabled: false });
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.translate(0.81, 0, 0);
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, mats.body);
  body.castShadow = true;
  group.add(body);

  // greenhouse glass band (slightly proud of the body)
  const glassShape = new THREE.Shape();
  glassShape.moveTo(-1.06, 0.99);
  glassShape.lineTo(-0.40, 1.33);
  glassShape.lineTo(0.66, 1.30);
  glassShape.lineTo(1.26, 0.94);
  glassShape.closePath();
  const glassGeo = new THREE.ExtrudeGeometry(glassShape, { depth: 1.66, bevelEnabled: false });
  glassGeo.rotateY(-Math.PI / 2);
  glassGeo.translate(0.83, 0, 0);
  glassGeo.computeVertexNormals();
  const glass = new THREE.Mesh(glassGeo, mats.glass);
  glass.castShadow = true;
  group.add(glass);

  // underbody + rocker skirts
  const under = new THREE.Mesh(mergeGeoms([
    part(new THREE.BoxGeometry(1.46, 0.22, 3.9), 0x1d2124, { p: [0, 0.30, -0.05] }),
    part(new THREE.BoxGeometry(0.07, 0.17, 2.6), 0x2e3338, { p: [-0.83, 0.35, -0.1] }),
    part(new THREE.BoxGeometry(0.07, 0.17, 2.6), 0x2e3338, { p: [0.83, 0.35, -0.1] }),
  ]), mats.trim);
  under.castShadow = true;
  group.add(under);

  // bumpers, grille, lights, mirrors, spoiler, plates, exhaust
  const details = new THREE.Mesh(mergeGeoms([
    part(new THREE.BoxGeometry(1.64, 0.24, 0.34), 0x2e3338, { p: [0, 0.44, 2.28] }),
    part(new THREE.BoxGeometry(1.64, 0.26, 0.3), 0x2e3338, { p: [0, 0.5, -2.3] }),
    part(new THREE.BoxGeometry(0.82, 0.15, 0.08), 0x191d20, { p: [0, 0.68, 2.335] }),
    part(new THREE.BoxGeometry(0.4, 0.09, 0.06), 0xd8d8d0, { p: [0, 0.47, 2.42] }),
    part(new THREE.BoxGeometry(0.4, 0.09, 0.06), 0xd8d8d0, { p: [0, 0.56, -2.39] }),
    part(new THREE.BoxGeometry(1.5, 0.05, 0.24), 0x2e3338, { p: [0, 0.97, -2.16] }), // lip spoiler
    part(new THREE.BoxGeometry(0.14, 0.1, 0.16), 0x2e3338, { p: [-0.9, 1.0, 1.02] }), // mirrors
    part(new THREE.BoxGeometry(0.14, 0.1, 0.16), 0x2e3338, { p: [0.9, 1.0, 1.02] }),
    part(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), 0x3a3f44, { p: [-0.55, 0.3, -2.42], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.014, 0.02, 0.55, 5), 0x22262a, { p: [0.55, 1.62, -0.78], r: [0.5, 0, 0] }),
  ]), mats.trim);
  details.castShadow = true;
  group.add(details);

  const lampGeo = mergeGeoms([
    part(new THREE.BoxGeometry(0.36, 0.15, 0.09), 0xffffff, { p: [-0.58, 0.72, 2.325] }),
    part(new THREE.BoxGeometry(0.36, 0.15, 0.09), 0xffffff, { p: [0.58, 0.72, 2.325] }),
  ]);
  const head = new THREE.Mesh(lampGeo, mats.light);
  group.add(head);
  const tailGeo = mergeGeoms([
    part(new THREE.BoxGeometry(0.34, 0.13, 0.08), 0xffffff, { p: [-0.58, 0.8, -2.345] }),
    part(new THREE.BoxGeometry(0.34, 0.13, 0.08), 0xffffff, { p: [0.58, 0.8, -2.345] }),
  ]);
  const tail = new THREE.Mesh(tailGeo, mats.tail);
  group.add(tail);

  // wheels — front pair steers, all spin
  const wheelGeo = part(new THREE.CylinderGeometry(0.33, 0.33, 0.26, 12), 0xffffff, { r: [0, 0, Math.PI / 2] });
  const hubGeo = part(new THREE.CylinderGeometry(0.185, 0.185, 0.29, 8), 0xffffff, { r: [0, 0, Math.PI / 2] });
  const makeWheel = (x, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.33, z);
    const tireMesh = new THREE.Mesh(wheelGeo, mats.tire);
    tireMesh.castShadow = true;
    const hubMesh = new THREE.Mesh(hubGeo, mats.hub);
    pivot.add(tireMesh, hubMesh);
    group.add(pivot);
    return { pivot, tireMesh, hubMesh };
  };
  const wheels = {
    fl: makeWheel(-0.84, 1.28), fr: makeWheel(0.84, 1.28),
    rl: makeWheel(-0.84, -1.32), rr: makeWheel(0.84, -1.32),
  };
  if (wrecked) {
    for (const k of Object.keys(wheels)) wheels[k].pivot.scale.y = 0.74;
  }
  return { group, wheels, mats };
}

// ------------------------------------------------------------------
// VEHICLE LOGIC
// ------------------------------------------------------------------
export class Car {
  constructor() {
    const built = buildCarMesh(0xd0492e, false);
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.mats = built.mats;
    this.pos = new THREE.Vector3(CFG.carSpawn.x, 0, CFG.carSpawn.z);
    this.yaw = CFG.carSpawn.yaw;
    this.visYaw = this.yaw;
    this.pitch = 0; this.roll = 0;
    this.speed = 0; this.steer = 0;
    this.health = 120;
    this.alive = true;
    this.disabled = false;
    this.wrecked = false;
    this.smokeT = 0;
    this.lastHitT = -9;
    this.updateTransform(0);
  }

  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  update(dt, input) {
    if (!this.alive) {
      this.speed = 0;
      this.updateTransform(dt);
      return;
    }
    const depth = S.waterLevel - H(this.pos.x, this.pos.z);
    let maxF = 23;
    if (depth > 0.4) maxF *= clamp01(1 - (depth - 0.4) / 0.75);
    if (this.disabled) maxF = 0;

    let th = this.disabled ? 0 : input.throttle;
    if (th > 0) this.speed += 11 * th * dt * (this.speed < 0 ? 2.2 : 1);
    else if (th < 0) this.speed += 13 * th * dt * (this.speed > 0 ? 2.2 : 1);
    // drag & rolling resistance
    this.speed -= this.speed * 0.35 * dt + Math.sign(this.speed) * this.speed * this.speed * 0.012 * dt;
    if (input.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 26 * dt);
    if (Math.abs(th) < 0.01 && Math.abs(this.speed) < 0.25) this.speed = 0;
    this.speed = clamp(this.speed, -8, maxF);

    // steering (speed sensitive)
    const target = input.steer;
    this.steer = lerp(this.steer, target, clamp01(dt * 7));
    const grip = clamp01(Math.abs(this.speed) / 7);
    this.yaw -= this.steer * 1.65 * grip * dt * Math.sign(this.speed || 1);

    // integrate
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // obstacle collisions
    for (const o of S.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const rr = o.r + 1.45;
      if (dx * dx + dz * dz < rr * rr) {
        const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
        this.pos.x = o.x + (dx / d) * rr;
        this.pos.z = o.z + (dz / d) * rr;
        const sp = Math.abs(this.speed);
        if (sp > 8) {
          this.damage((sp - 8) * 1.7 + 3, 'crash');
          S.effects.spark(this.pos.x, H(this.pos.x, this.pos.z) + 0.7, this.pos.z, 10);
          S.audio.crash(this.pos, sp / 24);
          S.effects.addTrauma(0.25);
        } else if (sp > 3) {
          S.audio.crash(this.pos, 0.15);
        }
        if (o.type === 'hedgehog') { this.damage(18, 'hedgehog'); this.speed *= 0.1; }
        else if (o.type === 'teeth') { this.damage(9, 'teeth'); this.speed *= 0.15; }
        else this.speed *= 0.3;
      }
    }
    // great wall + bounds
    if (this.pos.z > 165.6) {
      this.pos.z = 165.6;
      if (Math.abs(this.speed) > 8) this.damage((Math.abs(this.speed) - 8) * 1.5, 'wall');
      this.speed *= -0.15;
    }
    this.pos.x = clamp(this.pos.x, CFG.minX + 2, CFG.maxX - 2);
    this.pos.z = clamp(this.pos.z, CFG.minZ + 10, 165.6);

    // flood the engine
    if (!this.disabled && depth > 1.1) {
      this.disabled = true;
      S.banners.push({ text: 'VEHICLE FLOODED — ENGINE DEAD', ttl: 4, color: '#ffb84d' });
      S.audio.floodWarn(this.pos);
    }

    this.updateTransform(dt);

    // damage smoke / fire
    if (this.health < 45 && this.alive) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.health < 18 ? 0.12 : 0.4;
        S.effects.puff(this.pos.x, this.pos.y + 1.1, this.pos.z, this.health < 18 ? 3 : 2, this.health < 18);
      }
    }
  }

  updateTransform(dt) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const lx = -fz, lz = fx; // lateral (right side)
    const hF = H(this.pos.x + fx * 1.3, this.pos.z + fz * 1.3);
    const hB = H(this.pos.x - fx * 1.3, this.pos.z - fz * 1.3);
    const hL = H(this.pos.x + lx * 0.8, this.pos.z + lz * 0.8);
    const hR = H(this.pos.x - lx * 0.8, this.pos.z - lz * 0.8);
    const gy = (hF + hB + hL + hR) / 4;
    const tPitch = Math.atan2(hB - hF, 2.6);
    const tRoll = Math.atan2(hR - hL, 1.6);
    const k = dt ? clamp01(dt * 8) : 1;
    this.pitch = lerp(this.pitch, tPitch, k);
    this.roll = lerp(this.roll, tRoll, k);
    this.pos.y = lerp(this.pos.y, gy + 0.02, k);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    // wheels
    const spin = (this.speed / 0.33) * (dt || 0);
    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const w = this.wheels[key];
      w.tireMesh.rotation.x += spin;
      w.hubMesh.rotation.x += spin;
    }
    const st = this.steer * 0.42;
    this.wheels.fl.pivot.rotation.y = st;
    this.wheels.fr.pivot.rotation.y = st;
  }

  damage(n, cause) {
    if (!this.alive) return;
    this.health -= n;
    this.lastHitT = S.t;
    if (this.health <= 0) this.destroy(cause);
  }

  destroy(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.wrecked = true;
    this.disabled = true;
    explode(this.pos.clone().setY(this.pos.y + 0.7), { radius: 7, playerDmg: 200, carDmg: 0, big: true });
    this.mats.body.color.set(0x241f1c);
    this.mats.glass.color.set(0x101315);
    this.mats.light.emissiveIntensity = 0;
    this.mats.tail.emissiveIntensity = 0;
    for (const key of Object.keys(this.wheels)) this.wheels[key].pivot.scale.y = 0.7;
    S.stats.carLost = true;
    S.flags.vehicleLost = true;
    S.banners.push({ text: 'VEHICLE DESTROYED', ttl: 4, color: '#ff5a3c' });
    addSmokeSpot(this.pos.x, this.pos.y + 1.1, this.pos.z, 0.5);
  }

  get wheelPositions() {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const lx = -fz, lz = fx;
    return [
      [this.pos.x + fx * 1.28 - lx * 0.84, this.pos.z + fz * 1.28 - lz * 0.84],
      [this.pos.x + fx * 1.28 + lx * 0.84, this.pos.z + fz * 1.28 + lz * 0.84],
      [this.pos.x - fx * 1.32 - lx * 0.84, this.pos.z - fz * 1.32 - lz * 0.84],
      [this.pos.x - fx * 1.32 + lx * 0.84, this.pos.z - fz * 1.32 + lz * 0.84],
    ];
  }
}
