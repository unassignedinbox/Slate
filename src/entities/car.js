import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { MAT, carPaint } from '../props/materials.js';
import { box, cyl, mergeInPlace } from '../util/geo.js';
import { CAR } from '../config.js';
import { clamp, damp, lerp, smoothstep } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// The car: a low-poly compact sedan (Sentra-ish three-box saloon).
//
// The body is built as CONVEX HULLS over hand-placed silhouette points. That
// matters: a convex hull is watertight and its faces are generated with an
// outward winding by construction, so the shading is correct from every angle
// - no flipped normals, no black panels, no double-sided hacks. Glass, lights
// and trim are explicit quads placed on the hull surface.
// +Z is forward.
// ---------------------------------------------------------------------------

function hull(points, mat) {
  const geo = new ConvexGeometry(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** Planar quad from 4 corners, wound so the normal points along `outward`. */
function quad(p0, p1, p2, p3, mat, outward) {
  const v = [p0, p1, p2, p3].map((p) => new THREE.Vector3(...p));
  const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[3], v[0]));
  const flip = outward && n.dot(new THREE.Vector3(...outward)) < 0;
  const order = flip ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3];
  const pos = new Float32Array(18);
  order.forEach((oi, i) => {
    pos[i * 3] = v[oi].x;
    pos[i * 3 + 1] = v[oi].y;
    pos[i * 3 + 2] = v[oi].z;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function wheel(radius = 0.33, width = 0.23) {
  const g = new THREE.Group();
  const tyre = cyl(radius, radius, width, 14, MAT.tyre, 0, 0, 0, 0, 0, Math.PI / 2);
  g.add(tyre);
  for (const s of [-1, 1]) {
    g.add(cyl(radius * 0.62, radius * 0.62, 0.02, 12, MAT.chrome, s * (width / 2 + 0.005), 0, 0, 0, 0, Math.PI / 2));
    g.add(cyl(radius * 0.2, radius * 0.2, 0.05, 8, MAT.chrome, s * (width / 2 + 0.02), 0, 0, 0, 0, Math.PI / 2));
    // five spokes
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.add(box(0.03, radius * 0.5, 0.09, MAT.steelDark,
        s * (width / 2 + 0.012), Math.sin(a) * radius * 0.3, Math.cos(a) * radius * 0.3, a, 0, 0));
    }
  }
  return g;
}

export function buildCarModel(color = 0x9fb8c8) {
  const paint = carPaint(color);
  const paintDark = carPaint(new THREE.Color(color).multiplyScalar(0.55).getHex());
  const root = new THREE.Group();
  root.name = 'car';

  const W = 0.86;      // half width at the waist
  const Wf = 0.80;     // half width at the bumpers
  const FRONT = 2.28;
  const REAR = -2.26;

  // --- lower body -----------------------------------------------------------
  const lower = [
    // front bumper / valance
    [-Wf + 0.06, 0.30, FRONT - 0.08], [Wf - 0.06, 0.30, FRONT - 0.08],
    [-Wf, 0.56, FRONT], [Wf, 0.56, FRONT],
    // bonnet leading edge
    [-Wf - 0.01, 0.78, FRONT - 0.12], [Wf + 0.01, 0.78, FRONT - 0.12],
    // bonnet / cowl
    [-W, 0.90, 0.98], [W, 0.90, 0.98],
    // waist line, sills
    [-W - 0.02, 0.72, 0.2], [W + 0.02, 0.72, 0.2],
    [-W - 0.02, 0.70, -0.9], [W + 0.02, 0.70, -0.9],
    [-W + 0.04, 0.34, 0.6], [W - 0.04, 0.34, 0.6],
    [-W + 0.04, 0.34, -0.8], [W - 0.04, 0.34, -0.8],
    // boot lid
    [-W, 0.93, -1.62], [W, 0.93, -1.62],
    [-Wf - 0.01, 0.86, -2.02], [Wf + 0.01, 0.86, -2.02],
    // rear bumper
    [-Wf, 0.58, REAR], [Wf, 0.58, REAR],
    [-Wf + 0.06, 0.32, REAR + 0.08], [Wf - 0.06, 0.32, REAR + 0.08],
    // floor pan
    [-0.62, 0.24, 1.4], [0.62, 0.24, 1.4], [-0.62, 0.24, -1.4], [0.62, 0.24, -1.4],
  ];
  const body = hull(lower, paint);
  body.castShadow = true;
  root.add(body);

  // --- greenhouse -----------------------------------------------------------
  const Wc = 0.80;
  const cabin = [
    [-W + 0.02, 0.88, 1.02], [W - 0.02, 0.88, 1.02],      // windscreen base
    [-Wc + 0.06, 1.40, 0.12], [Wc - 0.06, 1.40, 0.12],    // roof front
    [-Wc + 0.06, 1.42, -0.86], [Wc - 0.06, 1.42, -0.86],  // roof rear
    [-W + 0.02, 0.90, -1.66], [W - 0.02, 0.90, -1.66],    // backlight base
    [-W, 1.02, 0.55], [W, 1.02, 0.55],                    // shoulder line
    [-W, 1.04, -1.0], [W, 1.04, -1.0],
  ];
  const green = hull(cabin, paint);
  green.castShadow = true;
  root.add(green);

  // --- glazing (sits a whisker proud of the hull faces) ---------------------
  const g = 0.012;
  root.add(quad(
    [-W + 0.06, 0.90 + g, 1.0], [W - 0.06, 0.90 + g, 1.0],
    [Wc - 0.1, 1.39, 0.16], [-Wc + 0.1, 1.39, 0.16], MAT.glass, [0, 0.6, 0.8],
  ));
  root.add(quad(
    [-W + 0.06, 0.92 + g, -1.62], [-Wc + 0.1, 1.41, -0.9],
    [Wc - 0.1, 1.41, -0.9], [W - 0.06, 0.92 + g, -1.62], MAT.glass, [0, 0.6, -0.8],
  ));
  for (const s of [-1, 1]) {
    const x = s * (Wc + 0.015);
    // front door glass
    root.add(quad(
      [x, 1.06, 0.58], [x, 1.35, 0.12], [x, 1.36, -0.30], [x, 1.07, -0.32],
      MAT.glass, [s, 0, 0],
    ));
    // rear door glass
    root.add(quad(
      [x, 1.07, -0.42], [x, 1.36, -0.40], [x, 1.35, -0.88], [x, 1.05, -1.02],
      MAT.glass, [s, 0, 0],
    ));
    // quarter light
    root.add(quad(
      [x, 1.04, -1.10], [x, 1.33, -0.94], [x, 1.30, -1.18], [x, 1.02, -1.26],
      MAT.glass, [s, 0, 0],
    ));
  }

  // --- lamps, grille, trim --------------------------------------------------
  for (const s of [-1, 1]) {
    // headlamp cluster
    root.add(box(0.44, 0.17, 0.08, MAT.lamp, s * 0.52, 0.735, FRONT - 0.08, 0, 0, 0));
    root.add(box(0.2, 0.12, 0.07, MAT.lamp, s * 0.22, 0.72, FRONT - 0.1));
    // tail lamp
    root.add(box(0.46, 0.2, 0.07, MAT.red, s * 0.5, 0.80, REAR + 0.06));
    root.add(box(0.12, 0.18, 0.06, MAT.lamp, s * 0.72, 0.80, REAR + 0.07));
    // mirror
    root.add(cyl(0.025, 0.025, 0.12, 5, MAT.steelDark, s * (W + 0.02), 1.06, 0.62, 0, 0, s * 1.1));
    root.add(box(0.13, 0.09, 0.19, paintDark, s * (W + 0.11), 1.10, 0.62, 0, s * 0.2, 0));
    // door handles + rubbing strip
    root.add(box(0.03, 0.045, 0.16, MAT.chrome, s * (W + 0.03), 0.97, -0.12));
    root.add(box(0.03, 0.045, 0.16, MAT.chrome, s * (W + 0.03), 0.96, -0.95));
    root.add(box(0.025, 0.07, 2.5, paintDark, s * (W + 0.035), 0.66, -0.25));
  }
  // grille + bumpers + plate
  root.add(box(1.02, 0.16, 0.06, MAT.black, 0, 0.70, FRONT - 0.02));
  for (let i = 0; i < 3; i++) root.add(box(1.0, 0.022, 0.05, MAT.chrome, 0, 0.655 + i * 0.05, FRONT + 0.005));
  root.add(box(1.62, 0.20, 0.12, paintDark, 0, 0.48, FRONT - 0.03));
  root.add(box(1.62, 0.20, 0.12, paintDark, 0, 0.50, REAR + 0.03));
  root.add(box(0.36, 0.14, 0.03, MAT.white, 0, 0.47, FRONT + 0.04));
  root.add(box(0.36, 0.14, 0.03, MAT.white, 0, 0.49, REAR - 0.04));
  // wipers, aerial, exhaust
  root.add(box(0.5, 0.02, 0.03, MAT.black, -0.3, 0.90, 0.99, 0, 0.25, 0));
  root.add(box(0.5, 0.02, 0.03, MAT.black, 0.32, 0.90, 0.99, 0, -0.25, 0));
  root.add(cyl(0.012, 0.012, 0.62, 4, MAT.steelDark, -W + 0.06, 1.2, 0.86, 0.18, 0, 0.1));
  root.add(cyl(0.055, 0.06, 0.16, 6, MAT.steelDark, 0.5, 0.36, REAR + 0.02, Math.PI / 2, 0, 0));

  // --- wheels ---------------------------------------------------------------
  const wheels = [];
  const wb = 1.36;   // half wheelbase
  const track = 0.74;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = wheel();
    w.position.set(sx * track, 0.33, sz * wb);
    w.castShadow = true;
    root.add(w);
    wheels.push(w);
    // arch liner so you never see daylight through the body
    root.add(box(0.26, 0.42, 0.86, MAT.black, sx * (track - 0.12), 0.5, sz * wb));
  }

  for (const w of wheels) mergeInPlace(w);
  mergeInPlace(root);
  root.userData.wheels = wheels;
  root.userData.paint = paint;
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}

// ---------------------------------------------------------------------------
// Arcade-but-grounded car controller.
// ---------------------------------------------------------------------------

const SURFACE = {
  road: { grip: 1.0, drag: 0.012, top: 1.0 },
  track: { grip: 0.88, drag: 0.028, top: 0.88 },
  shoulder: { grip: 0.74, drag: 0.055, top: 0.72 },
  sand: { grip: 0.58, drag: 0.1, top: 0.6 },
  grass: { grip: 0.74, drag: 0.062, top: 0.72 },
  dirt: { grip: 0.8, drag: 0.05, top: 0.76 },
};

export class Car {
  constructor(field, colliders, spawn) {
    this.field = field;
    this.colliders = colliders;
    this.object = buildCarModel();
    this.pos = spawn.clone();
    this.pos.y = field.height(spawn.x, spawn.z);
    this.yaw = Math.PI;      // facing inland (-Z)
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.health = CAR.maxHealth;
    this.alive = true;
    this.wheelSpin = 0;
    this.steer = 0;
    this.slip = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.distanceTravelled = 0;
    this.lastImpact = 0;
    this.surface = 'sand';
    this.inWater = 0;
    this._tmp = new THREE.Vector3();
    this._hits = [];
    this.object.position.copy(this.pos);
  }

  get forward() {
    return this._tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  damage(amount, kind = 'hit') {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastImpact = amount;
    this.lastDamageKind = kind;
    this.damageFlash = 1;
    if (this.health <= 0) {
      this.alive = false;
      this.deathCause = kind;
    }
  }

  update(dt, input, ocean) {
    const f = this.field;
    if (!this.alive) {
      // dead cars still settle onto the ground
      this.speed = damp(this.speed, 0, 3, dt);
    }

    const surfName = f.surface(this.pos.x, this.pos.z);
    this.surface = surfName;
    const surf = SURFACE[surfName] || SURFACE.dirt;

    // water drags hard, then drowns the engine
    const depth = ocean ? ocean.level - this.pos.y : -10;
    this.inWater = Math.max(0, depth);
    const wading = clamp(depth / 1.2, 0, 1);

    const throttle = this.alive ? input.throttle : 0;
    const braking = this.alive ? input.brake : 1;

    let top = CAR.maxSpeed * surf.top * (1 - wading * 0.75);
    const accel = CAR.accel * surf.grip * (1 - wading * 0.6);

    if (throttle > 0) this.speed += accel * throttle * dt;
    if (braking > 0) {
      if (this.speed > 0.5) this.speed -= CAR.brake * braking * dt;
      else this.speed = Math.max(-CAR.reverseSpeed, this.speed - CAR.accel * 0.6 * braking * dt);
    }
    // rolling resistance + aero
    const drag = surf.drag + wading * 0.5 + (this.airborne ? -0.008 : 0);
    this.speed -= this.speed * Math.abs(this.speed) * 0.00055 * dt * 60;
    this.speed -= this.speed * drag * dt * 12;
    this.speed = clamp(this.speed, -CAR.reverseSpeed, top);

    // steering: speed sensitive, with a touch of slip for feel
    const speedK = clamp(Math.abs(this.speed) / 12, 0, 1);
    const steerTarget = input.steer * (1 - 0.55 * clamp(Math.abs(this.speed) / CAR.maxSpeed, 0, 1));
    this.steer = damp(this.steer, steerTarget, 9, dt);
    if (!this.airborne) {
      const turn = this.steer * CAR.steerRate * speedK * Math.sign(this.speed || 1) * dt;
      this.yaw += turn;
      this.slip = damp(this.slip, -this.steer * clamp(Math.abs(this.speed) / CAR.maxSpeed, 0, 1) * (1.15 - surf.grip), 6, dt);
    } else {
      this.slip = damp(this.slip, 0, 2, dt);
    }

    // integrate
    const dirX = Math.sin(this.yaw);
    const dirZ = Math.cos(this.yaw);
    const sideX = Math.cos(this.yaw);
    const sideZ = -Math.sin(this.yaw);
    let nx = this.pos.x + (dirX * this.speed + sideX * this.slip * this.speed * 0.35) * dt;
    let nz = this.pos.z + (dirZ * this.speed + sideZ * this.slip * this.speed * 0.35) * dt;

    // --- obstacle response ---------------------------------------------------
    const hits = this.colliders.query(nx, nz, 1.5, this._hits);
    for (const it of hits) {
      const dx = nx - it.x;
      const dz = nz - it.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const overlap = it.r + 1.35 - d;
      if (overlap <= 0) continue;
      const ux = dx / d;
      const uz = dz / d;
      if (it.kind === 'wire') {
        // barbed wire: shreds speed, snags you, chews the tyres
        this.speed *= 0.965;
        if (Math.abs(this.speed) > 6) {
          this.speed *= 0.9;
          this.damage(dt * 9, 'wire');
          this.snagged = 0.4;
        }
      } else if (it.kind === 'soft') {
        nx += ux * overlap * 0.6;
        nz += uz * overlap * 0.6;
        this.speed *= 0.93;
        if (Math.abs(this.speed) > 14) this.damage(Math.abs(this.speed) * 0.12, 'impact');
      } else {
        nx += ux * overlap;
        nz += uz * overlap;
        const impact = Math.abs(this.speed);
        if (impact > 7) {
          this.damage(clamp((impact - 7) * (it.damage || 0.55) * 0.55, 0, 26), 'impact');
          this.impactShake = Math.min(1, impact / 25);
        }
        // scrub off speed along the contact normal
        const along = dirX * ux + dirZ * uz;
        this.speed *= clamp(1 - Math.abs(along) * 0.85, 0.05, 1);
        this.yaw += (ux * dirZ - uz * dirX) * 0.06;
      }
    }

    // keep the player inside the bluffs
    const limit = 452;
    if (Math.abs(nx) > limit) {
      nx = Math.sign(nx) * limit;
      this.speed *= 0.6;
    }
    if (nz > 430) { nz = 430; this.speed *= 0.5; }

    this.distanceTravelled += Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.pos.x = nx;
    this.pos.z = nz;

    // --- suspension / airtime ------------------------------------------------
    const ground = f.height(nx, nz);
    if (this.airborne) {
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        const impact = -this.vy;
        this.pos.y = ground;
        this.airborne = false;
        if (impact > 13) this.damage((impact - 13) * 1.9, 'landing');
        this.landShake = clamp(impact / 22, 0, 1);
        this.vy = 0;
        this.speed *= clamp(1 - impact * 0.012, 0.55, 1);
      }
    } else {
      const climb = (ground - this.pos.y) / Math.max(dt, 1e-4);
      // launch off crests
      if (climb < -14 && Math.abs(this.speed) > 13) {
        this.airborne = true;
        this.vy = climb * 0.25;
      } else {
        this.pos.y = damp(this.pos.y, ground, 18, dt);
      }
    }

    // --- body attitude from four-wheel sampling ------------------------------
    const fx = dirX * 1.36;
    const fz = dirZ * 1.36;
    const sx = sideX * 0.78;
    const sz = sideZ * 0.78;
    const hFL = f.height(nx + fx - sx, nz + fz - sz);
    const hFR = f.height(nx + fx + sx, nz + fz + sz);
    const hRL = f.height(nx - fx - sx, nz - fz - sz);
    const hRR = f.height(nx - fx + sx, nz - fz + sz);
    const pitch = Math.atan2((hRL + hRR) / 2 - (hFL + hFR) / 2, 2.72);
    const roll = Math.atan2((hFL + hRL) / 2 - (hFR + hRR) / 2, 1.56);
    const squat = clamp(-(throttle - braking) * 0.02 + this.speed * 0.0002, -0.03, 0.03);
    this.bodyPitch = damp(this.bodyPitch, this.airborne ? this.bodyPitch * 0.9 : pitch + squat, 7, dt);
    this.bodyRoll = damp(this.bodyRoll, (this.airborne ? 0 : roll) - this.steer * clamp(this.speed / CAR.maxSpeed, 0, 1) * 0.1, 7, dt);

    // --- apply to the model ---------------------------------------------------
    const o = this.object;
    o.position.set(this.pos.x, this.pos.y, this.pos.z);
    o.rotation.set(0, 0, 0);
    o.rotateY(this.yaw + this.slip * 0.25);
    o.rotateX(this.bodyPitch);
    o.rotateZ(this.bodyRoll);

    this.wheelSpin += (this.speed / 0.33) * dt;
    const steerVis = this.steer * 0.5;
    const wheels = o.userData.wheels;
    for (let i = 0; i < wheels.length; i++) {
      wheels[i].rotation.set(0, 0, 0);
      if (i < 2) wheels[i].rotateY(steerVis);
      wheels[i].rotateX(this.wheelSpin);
    }

    if (this.snagged > 0) this.snagged -= dt;
    if (this.damageFlash > 0) this.damageFlash -= dt * 2;
    if (this.impactShake > 0) this.impactShake -= dt * 3;
    if (this.landShake > 0) this.landShake -= dt * 3;
    return this;
  }

  /** 0..1 how wrecked the car looks/sounds. */
  get damageRatio() {
    return 1 - this.health / CAR.maxHealth;
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6;
  }
}

export { SURFACE };
