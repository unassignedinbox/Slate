import * as THREE from 'three';
import { numberTexture, shadowTexture } from './textures.js';

/**
 * Low-poly 90s compact sedan (Nissan Sentra / Sunny B13 flavour) converted
 * into a Motorball-spec race car: widebody arches, splitter, roll cage,
 * big rear wing, twin turbo exhausts.
 */

export const LIVERIES = [
  { name: 'BATTLE ANGEL 99', body: 0x2b2f3a, accent: 0x8a4cff, trim: 0x18e0ff, number: '99' },
  { name: 'FACTORY WORKS', body: 0xb8bcc4, accent: 0xff3b3b, trim: 0x1a1c22, number: '07' },
  { name: 'KANSAS NIGHT', body: 0x101317, accent: 0xffb01e, trim: 0xff5a2a, number: '13' },
  { name: 'ZALEM SKY', body: 0xe9f4ff, accent: 0x14c8ff, trim: 0x7df7ff, number: '01' },
];

function bevelShape(points, radius = 0) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  void radius;
  return s;
}

function extrudeBody(points, width, bevel = 0.06) {
  const shape = bevelShape(points);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    steps: 1,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  return geo;
}

export function buildCarMesh(liveryIndex = 0) {
  const L = LIVERIES[liveryIndex % LIVERIES.length];
  const g = new THREE.Group();
  g.name = 'RaceCar';

  const bodyMat = new THREE.MeshStandardMaterial({ color: L.body, roughness: 0.34, metalness: 0.55, flatShading: true });
  const accentMat = new THREE.MeshStandardMaterial({ color: L.accent, roughness: 0.3, metalness: 0.4, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.75, metalness: 0.3, flatShading: true });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1a24, roughness: 0.12, metalness: 0.85, flatShading: true });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.25, metalness: 0.95, flatShading: true });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.95, metalness: 0.0, flatShading: true });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.3, metalness: 0.9, flatShading: true });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0, toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });

  // ---- lower body: classic 3-box sedan side profile (z = forward, y = up)
  const lower = [
    [2.24, 0.26],
    [2.3, 0.6],
    [2.18, 0.86],
    [1.06, 0.93],
    [-1.12, 0.96],
    [-2.02, 0.94],
    [-2.18, 0.68],
    [-2.12, 0.26],
  ];
  const bodyGeo = extrudeBody(lower, 1.86); // extrudeBody centres on X
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  g.add(body);

  // ---- greenhouse / cabin
  const cabin = [
    [1.06, 0.93],
    [0.28, 1.34],
    [-0.94, 1.36],
    [-1.3, 0.95],
  ];
  const cabGeo = extrudeBody(cabin, 1.6, 0.04);
  const cab = new THREE.Mesh(cabGeo, glassMat);
  cab.castShadow = true;
  g.add(cab);

  // roof panel + pillars in body colour
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.08, 1.24), bodyMat);
  roof.position.set(0, 1.37, -0.33);
  roof.rotation.x = -0.02;
  g.add(roof);
  for (const sx of [-1, 1]) {
    const aP = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.56, 0.12), bodyMat);
    aP.position.set(sx * 0.76, 1.12, 0.66);
    aP.rotation.x = 0.62;
    g.add(aP);
    const cP = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.12), bodyMat);
    cP.position.set(sx * 0.76, 1.14, -1.12);
    cP.rotation.x = -0.62;
    g.add(cP);
  }

  // ---- widebody arches
  for (const sx of [-1, 1]) {
    for (const [pz, w] of [[1.42, 0.92], [-1.38, 0.98]]) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, w), darkMat);
      arch.position.set(sx * 0.98, 0.72, pz);
      g.add(arch);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, w * 0.92), accentMat);
      lip.position.set(sx * 1.0, 0.56, pz);
      g.add(lip);
    }
    // side skirt
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.1), darkMat);
    skirt.position.set(sx * 0.92, 0.3, 0.02);
    g.add(skirt);
    // mirror
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.14), accentMat);
    mir.position.set(sx * 1.0, 1.02, 0.72);
    g.add(mir);
  }

  // ---- front splitter + canards
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.62), darkMat);
  splitter.position.set(0, 0.2, 2.2);
  g.add(splitter);
  for (const sx of [-1, 1]) {
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.26), accentMat);
    can.position.set(sx * 0.86, 0.42, 2.12);
    can.rotation.z = sx * 0.12;
    g.add(can);
  }
  // grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.08), darkMat);
  grille.position.set(0, 0.56, 2.3);
  g.add(grille);

  // ---- lights (rectangular, very B13)
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.06), lightMat);
    hl.position.set(sx * 0.6, 0.79, 2.21);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.06), tailMat);
    tl.position.set(sx * 0.58, 0.82, -2.16);
    g.add(tl);
  }

  // ---- rear wing
  const wing = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.07, 0.42), accentMat);
  blade.position.set(0, 1.3, -2.02);
  blade.rotation.x = -0.18;
  wing.add(blade);
  const gurney = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.1, 0.04), darkMat);
  gurney.position.set(0, 1.36, -2.21);
  wing.add(gurney);
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.56), darkMat);
    plate.position.set(sx * 0.9, 1.2, -2.02);
    wing.add(plate);
    const stay = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.1), chromeMat);
    stay.position.set(sx * 0.5, 1.12, -1.96);
    wing.add(stay);
  }
  g.add(wing);

  // ---- roll cage hint through the glass
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.06), chromeMat);
    bar.position.set(sx * 0.62, 1.12, -0.8);
    g.add(bar);
  }
  const halo = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.06), chromeMat);
  halo.position.set(0, 1.34, -0.8);
  g.add(halo);

  // ---- hood scoop + racing stripe
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.5), darkMat);
  scoop.position.set(0, 0.95, 1.5);
  g.add(scoop);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 4.2), accentMat);
  stripe.position.set(0, 0.99, 0.1);
  g.add(stripe);

  // ---- door numbers
  const numTex = numberTexture(L.number);
  for (const sx of [-1, 1]) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true, toneMapped: false })
    );
    plane.position.set(sx * 0.95, 0.72, -0.12);
    plane.rotation.y = sx * Math.PI * 0.5;
    g.add(plane);
  }
  const roofNum = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.8),
    new THREE.MeshBasicMaterial({ map: numTex, transparent: true, toneMapped: false })
  );
  roofNum.position.set(0, 1.42, -0.35);
  roofNum.rotation.set(-Math.PI / 2, 0, Math.PI);
  g.add(roofNum);

  // ---- exhausts + flame cones
  const flames = [];
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 8), chromeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(sx * 0.42, 0.36, -2.24);
    g.add(pipe);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.8, 8),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, toneMapped: false })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(sx * 0.42, 0.36, -2.6);
    flame.visible = false;
    g.add(flame);
    flames.push(flame);
  }

  // ---- wheels
  const wheels = [];
  const wheelDefs = [
    [0.86, 1.42, 'FL'],
    [-0.86, 1.42, 'FR'],
    [0.88, -1.38, 'RL'],
    [-0.88, -1.38, 'RR'],
  ];
  for (const [x, z, name] of wheelDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 10), rimMat);
    rim.rotation.z = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.23, 10), accentMat);
    face.rotation.y = Math.sign(x) * Math.PI * 0.5;
    face.position.x = Math.sign(x) * 0.17;
    const spin = new THREE.Group();
    spin.add(tire, rim, face);
    pivot.add(spin);
    pivot.userData = { spin, name, front: z > 0 };
    g.add(pivot);
    wheels.push(pivot);
  }

  // ---- contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 5.4),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 })
  );
  shadow.rotation.x = -Math.PI / 2;

  g.userData = { wheels, flames, shadow, materials: { bodyMat, accentMat }, livery: L };
  return g;
}

/**
 * Arcade-sim car physics that runs on the track's banked trough surface.
 * Gravity + surface projection means the half-pipe banking works naturally:
 * carry speed and you can run right up the wall.
 */
export class Car {
  constructor(track, liveryIndex = 0) {
    this.track = track;
    this.liveryIndex = liveryIndex;
    this.mesh = buildCarMesh(liveryIndex);
    this.shadow = this.mesh.userData.shadow;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.grounded = true;
    this.hint = 0;
    this.surf = {};
    this.wheelSpin = 0;
    this.steer = 0;
    this.slip = 0;
    this.boost = 1;
    this.boosting = false;
    this.airTime = 0;
    this.rpm = 0.15;
    this.gear = 1;
    this.crashFlash = 0;
    this.offTrack = false;

    // tuning
    this.maxEngine = 26.0; // m/s^2
    this.boostEngine = 41.0;
    this.brakeForce = 34.0;
    this.topSpeed = 86;
    this.topSpeedBoost = 108;
    this.reverseTop = 16;

    this.respawn();
  }

  respawn(index = null) {
    let spawn;
    if (index === null) {
      spawn = this.track.getSpawn(0, 30);
    } else {
      const t = this.track.tangents[index];
      spawn = { position: this.track.pointAt(index, 0, 0.8), yaw: Math.atan2(t.x, t.z), index };
    }
    this.position.copy(spawn.position);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw;
    this.speed = 0;
    this.hint = spawn.index;
    this.grounded = true;
    this.boost = 1;
    this.airTime = 0;
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }

  update(dt, input, frozen = false) {
    const track = this.track;
    const surf = track.sample(this.position, this.hint, this.surf);
    this.hint = surf.index;

    const n = surf.normal;
    const gravity = 26.0;

    // --- orientation basis on the surface
    const fwdFlat = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const f = fwdFlat.clone().addScaledVector(n, -fwdFlat.dot(n));
    if (f.lengthSq() < 1e-6) f.copy(fwdFlat);
    f.normalize();
    const r = new THREE.Vector3().crossVectors(f, n).normalize();

    const heightAbove = this.position.clone().sub(surf.surface).dot(n);
    const wasGrounded = this.grounded;
    this.grounded = heightAbove <= 0.62;

    // --- gravity
    this.velocity.y -= gravity * dt;

    if (this.grounded) {
      this.airTime = 0;
      // kill the into-surface velocity, keep everything tangential
      const vn = this.velocity.dot(n);
      if (vn < 0) this.velocity.addScaledVector(n, -vn);
      if (!wasGrounded) this.landing = Math.min(1, Math.abs(vn) / 18);

      let vLong = this.velocity.dot(f);
      let vLat = this.velocity.dot(r);

      // ---- engine / brakes
      const throttle = frozen ? 0 : input.throttle;
      const brake = frozen ? 1 : input.brake;
      this.boosting = !frozen && input.boost && this.boost > 0.02 && throttle > 0.1;

      const maxA = this.boosting ? this.boostEngine : this.maxEngine;
      const top = this.boosting ? this.topSpeedBoost : this.topSpeed;
      const powerCurve = 1 - THREE.MathUtils.clamp(Math.abs(vLong) / top, 0, 1) ** 1.6;

      if (throttle > 0) vLong += maxA * powerCurve * throttle * dt;
      if (brake > 0) {
        if (vLong > 0.5) vLong -= this.brakeForce * brake * dt;
        else vLong -= 13.0 * brake * dt * (1 - Math.min(1, -vLong / this.reverseTop));
      }
      if (throttle <= 0 && brake <= 0) vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), 5.0 * dt);
      // drag
      vLong -= vLong * Math.abs(vLong) * 0.0012 * dt;

      if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.26);
      else this.boost = Math.min(1, this.boost + dt * 0.1);

      // ---- surface friction (off the flat = more scrub on the trough wall)
      const wallness = THREE.MathUtils.clamp((Math.abs(surf.u) / surf.halfWidth - 0.55) / 0.45, 0, 1);

      // ---- lateral grip
      const speedAbs = Math.abs(vLong);
      let grip = 15.5 + speedAbs * 0.17;
      grip *= 0.42 + 0.58 * Math.max(0, n.y); // less grip on the steep banking
      if (input.handbrake && !frozen) grip *= 0.16;
      const latDrop = Math.min(Math.abs(vLat), grip * dt);
      vLat -= Math.sign(vLat) * latDrop;
      this.slip = THREE.MathUtils.clamp(Math.abs(vLat) / 9, 0, 1);

      // ---- steering
      const steerTarget = frozen ? 0 : input.steer;
      const speedFactor = 1 / (1 + Math.max(0, speedAbs) * 0.022);
      const maxSteer = 0.62 * speedFactor + (input.handbrake ? 0.16 : 0);
      this.steer += (steerTarget * maxSteer - this.steer) * Math.min(1, dt * 9);
      const wheelbase = 2.8;
      let yawRate = (vLong / wheelbase) * Math.tan(this.steer);
      // cap rotation to what the tyres can actually hold, so fast corners
      // need braking and the handbrake genuinely swings the tail out
      const maxYaw = (grip * (input.handbrake && !frozen ? 1.7 : 1.15)) / Math.max(7, Math.abs(vLong));
      yawRate = THREE.MathUtils.clamp(yawRate, -maxYaw, maxYaw);
      if (Math.abs(vLong) < 0.4) yawRate = 0;
      this.yaw += yawRate * dt;

      // rebuild velocity from the (rotated) basis
      const f2 = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      f2.addScaledVector(n, -f2.dot(n)).normalize();
      const r2 = new THREE.Vector3().crossVectors(f2, n).normalize();
      this.velocity.copy(f2).multiplyScalar(vLong).addScaledVector(r2, vLat);
      // gravity component down the bank keeps riding the wall honest
      const gTan = new THREE.Vector3(0, -gravity, 0);
      gTan.addScaledVector(n, -gTan.dot(n));
      this.velocity.addScaledVector(gTan, dt * (0.35 + 0.65 * wallness));

      this.speed = vLong;
      this.wheelSpin += (vLong / 0.36) * dt;
    } else {
      this.airTime += dt;
      // a little air control
      if (!frozen) this.yaw += input.steer * 0.7 * dt;
      this.speed = this.velocity.dot(f);
      this.wheelSpin += (this.speed / 0.36) * dt * 0.4;
      this.boost = Math.min(1, this.boost + dt * 0.05);
      this.boosting = false;
    }

    // --- integrate
    this.position.addScaledVector(this.velocity, dt);

    // --- resolve against the surface again (so we follow the trough)
    const s2 = track.sample(this.position, this.hint, this.surf);
    this.hint = s2.index;
    const above = this.position.clone().sub(s2.surface).dot(s2.normal);
    if (above < 0.42) {
      this.position.addScaledVector(s2.normal, 0.42 - above);
      const vn = this.velocity.dot(s2.normal);
      if (vn < 0) this.velocity.addScaledVector(s2.normal, -vn);
      this.grounded = true;
    }

    // --- barrier collision
    const limit = s2.halfWidth * 0.99 - 0.95;
    if (Math.abs(s2.u) > limit) {
      const push = (Math.abs(s2.u) - limit) * Math.sign(s2.u);
      this.position.addScaledVector(s2.right, -push);
      const vLatW = this.velocity.dot(s2.right);
      if (Math.sign(vLatW) === Math.sign(s2.u)) {
        this.velocity.addScaledVector(s2.right, -vLatW * 1.35);
        const vl = this.velocity.dot(s2.tangent);
        this.velocity.addScaledVector(s2.tangent, -vl * 0.14);
        this.crashFlash = Math.min(1, Math.abs(vLatW) / 14);
      }
    }

    // --- fell off the world
    this.offTrack = this.position.y < -30;
    if (this.offTrack) this.respawn(s2.index);

    this.crashFlash = Math.max(0, this.crashFlash - dt * 2.2);
    this.rpm = THREE.MathUtils.clamp(
      (Math.abs(this.speed) % 22) / 22 * 0.75 + 0.2 + (this.boosting ? 0.15 : 0),
      0,
      1
    );
    this.gear = THREE.MathUtils.clamp(Math.floor(Math.abs(this.speed) / 16) + 1, 1, 6);
    if (this.speed < -0.6) this.gear = 0;

    this._updateMesh(dt, s2);
    return s2;
  }

  _updateMesh(dt, surf) {
    const n = this.grounded ? surf.normal : new THREE.Vector3(0, 1, 0);
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const r = new THREE.Vector3().crossVectors(f, n).normalize();
    const m = new THREE.Matrix4().makeBasis(r, n, f);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);

    // body roll under cornering load + squat/dive, folded into the target
    const roll = THREE.MathUtils.clamp(-this.steer * Math.abs(this.speed) * 0.012, -0.09, 0.09);
    const pitch = THREE.MathUtils.clamp(this._lastSpeed === undefined ? 0 : (this.speed - this._lastSpeed) * 0.06, -0.05, 0.05);
    this._lastSpeed = this.speed;
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll, 'YXZ')));

    this.mesh.quaternion.slerp(q, Math.min(1, dt * 14));
    this.mesh.position.copy(this.position).addScaledVector(n, -0.34);

    // wheels
    const { wheels, flames } = this.mesh.userData;
    for (const w of wheels) {
      w.userData.spin.rotation.x = this.wheelSpin;
      if (w.userData.front) w.rotation.y = this.steer * 0.85;
    }
    const fscale = this.boosting ? 1 : 0;
    for (const fl of flames) {
      fl.visible = this.boosting;
      const s = 0.7 + Math.random() * 0.8;
      fl.scale.set(1, s * fscale + 0.001, 1);
    }

    // contact shadow
    this.shadow.position.copy(surf.surface).addScaledVector(surf.normal, 0.06);
    this.shadow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, n, f));
    this.shadow.rotateX(-Math.PI / 2);
    this.shadow.visible = this.grounded || this.airTime < 1.2;
    this.shadow.material.opacity = 0.85 * Math.max(0, 1 - this.airTime);
  }

  setLivery(i) {
    this.liveryIndex = i % LIVERIES.length;
    const L = LIVERIES[this.liveryIndex];
    const { bodyMat, accentMat } = this.mesh.userData.materials;
    bodyMat.color.setHex(L.body);
    accentMat.color.setHex(L.accent);
    return L;
  }
}
