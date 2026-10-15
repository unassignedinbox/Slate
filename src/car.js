import * as THREE from 'three';
import { VEHICLE_DATA } from './vehicleData.js';
import { sound } from './audio.js';

export const CAR_COLORS = [
  { name: 'Apex Crimson', hex: 0xd6142b },
  { name: 'Cyber Blue',   hex: 0x0077ff },
  { name: 'Volt Orange',  hex: 0xff5500 },
  { name: 'Acid Green',   hex: 0x39ff14 },
  { name: 'Solar Gold',   hex: 0xffb700 },
  { name: 'Stealth Noir', hex: 0x18181c },
  { name: 'Neon Purple',  hex: 0x8a2be2 }
];

export class Car {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;

    // Root transform container
    this.mesh = new THREE.Group();
    this.scene.add(this.mesh);

    // Chassis group (applies suspension pitch, roll, and bounce relative to root)
    this.chassis = new THREE.Group();
    this.mesh.add(this.chassis);

    // Physics parameters & state
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.heading = 0; // 0 = pointing along -Z (forward)
    this.speed = 0; // m/s
    this.steerAngle = 0;
    this.targetSteerAngle = 0;

    // Dynamics scalars
    this.accel = 24.0; // m/s^2
    this.brakeForce = 38.0;
    this.reverseMaxSpeed = 14.0;
    this.maxSpeed = 52.0; // ~187 km/h base
    this.boostMaxSpeed = 75.0; // ~270 km/h with nitro
    this.nitro = 100.0;
    this.isBoosting = false;
    this.isDrifting = false;
    this.driftAngle = 0;
    this.driftScore = 0;
    this.driftMultiplier = 1;

    // Engine simulation
    this.rpm = 900;
    this.gear = 1;
    this.gearRatios = [3.4, 2.3, 1.6, 1.2, 0.95, 0.75];

    // Suspension dynamics
    this.suspensionPitch = 0;
    this.suspensionRoll = 0;
    this.suspensionY = 0;
    this.suspensionVelY = 0;
    this.normal = new THREE.Vector3(0, 1, 0);

    // Health & collision
    this.health = 100.0;
    this.maxHealth = 100.0;
    this.isAlive = true;
    this.invulnerableTimer = 0;

    // External forces (e.g. magnetic crane pull, steam jet push)
    this.externalForce = new THREE.Vector3(0, 0, 0);
    this.liftMultiplier = 0; // 0 = normal ground grip, 1 = floating in magnetic tractor beam

    this._buildMaterials();
    this._buildChassis();
    this._buildWheels();
    this._buildHeadlights();
  }

  _buildMaterials() {
    this.matBodyPaint = new THREE.MeshPhysicalMaterial({
      color: CAR_COLORS[0].hex,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 0.9
    });

    this.matGlass = new THREE.MeshPhysicalMaterial({
      color: 0x050d18,
      metalness: 0.2,
      roughness: 0.05,
      transparent: true,
      opacity: 0.78,
      transmission: 0.35,
      ior: 1.52
    });

    this.matPlastic = new THREE.MeshStandardMaterial({
      color: 0x141417,
      roughness: 0.82,
      metalness: 0.15
    });

    this.matTyreChassis = new THREE.MeshStandardMaterial({
      color: 0x121214,
      roughness: 0.88,
      metalness: 0.05
    });

    this.matTrim = new THREE.MeshStandardMaterial({
      color: 0x888899,
      metalness: 0.85,
      roughness: 0.25
    });

    this.matHeadlight = new THREE.MeshStandardMaterial({
      color: 0xddeeff,
      emissive: 0xccf0ff,
      emissiveIntensity: 2.8,
      roughness: 0.1
    });

    this.matTaillight = new THREE.MeshStandardMaterial({
      color: 0x220000,
      emissive: 0xff0022,
      emissiveIntensity: 1.2,
      roughness: 0.2
    });

    this.matDefault = new THREE.MeshStandardMaterial({
      color: 0x2b2b30,
      roughness: 0.65,
      metalness: 0.4
    });

    this.bodyMaterials = [
      this.matBodyPaint,   // 0
      this.matGlass,       // 1
      this.matPlastic,     // 2
      this.matTyreChassis, // 3
      this.matTrim,        // 4
      this.matHeadlight,   // 5
      this.matTaillight,   // 6
      this.matDefault      // 7
    ];
  }

  _buildChassis() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(VEHICLE_DATA.body.positions, 3));

    const groups = VEHICLE_DATA.body.groups;
    const groupOrder = ['bodyPaint', 'glass', 'plastic', 'tyre', 'trim', 'headlight', 'taillight', 'default'];
    const allIndices = [];
    let curIdx = 0;

    groupOrder.forEach((name, matIdx) => {
      const tris = groups[name] || [];
      if (tris.length > 0) {
        geom.addGroup(curIdx, tris.length, matIdx);
        allIndices.push(...tris);
        curIdx += tris.length;
      }
    });

    geom.setIndex(allIndices);
    geom.computeVertexNormals();

    this.bodyMesh = new THREE.Mesh(geom, this.bodyMaterials);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;

    // Resting model offset: ground is 0.417m below model origin
    this.bodyMesh.position.y = 0.417;
    this.chassis.add(this.bodyMesh);
  }

  _buildWheels() {
    // Wheel Rim Geometry
    const rimGeom = new THREE.BufferGeometry();
    rimGeom.setAttribute('position', new THREE.Float32BufferAttribute(VEHICLE_DATA.rim.positions, 3));
    const rimIndices = [...VEHICLE_DATA.rim.magTriangles, ...VEHICLE_DATA.rim.beadTriangles];
    rimGeom.addGroup(0, VEHICLE_DATA.rim.magTriangles.length, 0); // Mag
    rimGeom.addGroup(VEHICLE_DATA.rim.magTriangles.length, VEHICLE_DATA.rim.beadTriangles.length, 1); // Bead
    rimGeom.setIndex(rimIndices);
    rimGeom.computeVertexNormals();

    const magMat = new THREE.MeshStandardMaterial({
      color: 0x1188ff,
      emissive: 0x0044aa,
      emissiveIntensity: 0.6,
      metalness: 0.92,
      roughness: 0.22
    });
    const beadMat = new THREE.MeshStandardMaterial({
      color: 0x151518,
      roughness: 0.85,
      metalness: 0.1
    });

    // Tyre Geometry
    const tyreGeom = new THREE.BufferGeometry();
    tyreGeom.setAttribute('position', new THREE.Float32BufferAttribute(VEHICLE_DATA.tyre.positions, 3));
    tyreGeom.setIndex(VEHICLE_DATA.tyre.triangles);
    tyreGeom.computeVertexNormals();

    const tyreMat = new THREE.MeshStandardMaterial({
      color: 0x131316,
      roughness: 0.9,
      metalness: 0.05
    });

    // Create 4 wheel assemblies
    this.wheels = [];
    const sockets = [
      { name: 'FL', pos: VEHICLE_DATA.sockets.FL, isFront: true,  isLeft: true },
      { name: 'FR', pos: VEHICLE_DATA.sockets.FR, isFront: true,  isLeft: false },
      { name: 'RL', pos: VEHICLE_DATA.sockets.RL, isFront: false, isLeft: true },
      { name: 'RR', pos: VEHICLE_DATA.sockets.RR, isFront: false, isLeft: false }
    ];

    sockets.forEach(s => {
      // Steer pivot (for front wheels)
      const steerPivot = new THREE.Group();
      // Socket relative to car body origin (which is at Y = 0.417):
      steerPivot.position.set(s.pos[0], s.pos[1] + 0.417, s.pos[2]);
      this.chassis.add(steerPivot);

      // Spin pivot (for forward roll)
      const spinPivot = new THREE.Group();
      steerPivot.add(spinPivot);

      const rimMesh = new THREE.Mesh(rimGeom, [magMat, beadMat]);
      rimMesh.castShadow = true;
      spinPivot.add(rimMesh);

      const tyreMesh = new THREE.Mesh(tyreGeom, tyreMat);
      tyreMesh.castShadow = true;
      spinPivot.add(tyreMesh);

      // Right wheels face outward by rotating 180 degrees around Y
      if (!s.isLeft) {
        rimMesh.rotation.y = Math.PI;
        tyreMesh.rotation.y = Math.PI;
      }

      this.wheels.push({
        name: s.name,
        isFront: s.isFront,
        isLeft: s.isLeft,
        steerPivot: steerPivot,
        spinPivot: spinPivot,
        basePos: new THREE.Vector3(s.pos[0], s.pos[1] + 0.417, s.pos[2])
      });
    });
  }

  _buildHeadlights() {
    // Dynamic spotlights casting light ahead
    this.headlights = [];
    [-0.78, 0.78].forEach(xOffset => {
      const spot = new THREE.SpotLight(0xffffff, 4.0, 65, Math.PI / 5, 0.35, 1.2);
      spot.position.set(xOffset, 0.65, -2.8);
      spot.target.position.set(xOffset * 0.4, 0.1, -18.0);
      spot.castShadow = true;
      spot.shadow.mapSize.width = 512;
      spot.shadow.mapSize.height = 512;
      spot.shadow.camera.near = 0.5;
      spot.shadow.camera.far = 65;

      this.chassis.add(spot);
      this.chassis.add(spot.target);
      this.headlights.push(spot);
    });

    // Rear brake glow lights
    this.brakeLights = [];
    [-0.85, 0.85].forEach(xOffset => {
      const pLight = new THREE.PointLight(0xff0022, 0.4, 6.0, 1.5);
      pLight.position.set(xOffset, 0.72, 3.1);
      this.chassis.add(pLight);
      this.brakeLights.push(pLight);
    });
  }

  setPaintColor(hex) {
    this.matBodyPaint.color.setHex(hex);
  }

  takeDamage(amount) {
    if (this.invulnerableTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invulnerableTimer = 0.8;

    sound.playCrash(0.8);
    this.particles.spawnSparks(this.pos.x, this.pos.y + 0.5, this.pos.z, 25, 12);

    if (this.health <= 0) {
      this.isAlive = false;
      this.particles.spawnExplosion(this.pos.x, this.pos.y + 0.5, this.pos.z);
      sound.playExplosion();
    }
  }

  respawn(respawnPos, respawnHeading = 0) {
    this.pos.copy(respawnPos);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.heading = respawnHeading;
    this.steerAngle = 0;
    this.targetSteerAngle = 0;
    this.driftAngle = 0;
    this.health = this.maxHealth;
    this.isAlive = true;
    this.invulnerableTimer = 1.5;
    this.nitro = Math.max(this.nitro, 60.0);
    this.suspensionPitch = 0;
    this.suspensionRoll = 0;
    this.externalForce.set(0, 0, 0);
    this.liftMultiplier = 0;

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.heading, 0);
  }

  update(dt, input, trackQuery) {
    if (dt > 0.1) dt = 0.1; // clamp delta spike

    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer -= dt;
      this.bodyMesh.visible = Math.floor(this.invulnerableTimer * 12) % 2 === 0;
    } else {
      this.bodyMesh.visible = true;
    }

    if (!this.isAlive) {
      sound.updateEngine(0, 0, 0);
      sound.updateSkid(0);
      sound.updateNitro(false);
      return;
    }

    // --- STEERING INPUT ---
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const maxSteer = 0.52 - Math.min(Math.abs(this.speed) / 60.0, 0.32); // speed sensitive steering
    this.targetSteerAngle = steerInput * maxSteer;
    this.steerAngle += (this.targetSteerAngle - this.steerAngle) * Math.min(dt * 12.0, 1.0);

    // --- ACCELERATION & BRAKING ---
    let forwardAccel = 0;
    const isBraking = input.down && this.speed > 0.5;
    const isReversing = input.down && this.speed <= 0.5;

    // Nitro Boost
    this.isBoosting = input.boost && this.nitro > 0 && input.up && this.liftMultiplier < 0.8;
    if (this.isBoosting) {
      this.nitro = Math.max(0, this.nitro - dt * 28.0);
      forwardAccel += this.accel * 1.6;
    } else {
      this.nitro = Math.min(100.0, this.nitro + dt * 6.0); // gradual passive refill
    }

    if (input.up) {
      forwardAccel += this.accel;
    } else if (isBraking) {
      forwardAccel -= this.brakeForce;
    } else if (isReversing) {
      forwardAccel -= this.accel * 0.6;
    } else {
      // Engine drag & rolling friction
      forwardAccel -= Math.sign(this.speed) * Math.min(Math.abs(this.speed) * 0.8 + 4.0, Math.abs(this.speed) / dt);
    }

    // --- DRIFT MECHANIC ---
    this.isDrifting = input.drift && Math.abs(this.speed) > 10.0 && Math.abs(this.steerAngle) > 0.08 && this.liftMultiplier < 0.5;
    const gripFactor = this.isDrifting ? 0.35 : 0.88;

    // Update speed
    const currentMaxSpeed = this.isBoosting ? this.boostMaxSpeed : this.maxSpeed;
    this.speed += forwardAccel * dt;
    if (this.speed > currentMaxSpeed) this.speed = currentMaxSpeed;
    if (this.speed < -this.reverseMaxSpeed) this.speed = -this.reverseMaxSpeed;

    // Turn rate
    let turnRate = (this.speed / 3.4) * Math.tan(this.steerAngle);
    if (this.isDrifting) {
      turnRate *= 1.6; // faster yaw spin while drifting
      this.driftScore += Math.abs(this.speed) * dt * 2.0 * this.driftMultiplier;
      this.driftMultiplier = Math.min(4.0, this.driftMultiplier + dt * 0.5);
      this.nitro = Math.min(100.0, this.nitro + dt * 14.0); // drifting awards boost!
    } else {
      this.driftMultiplier = Math.max(1.0, this.driftMultiplier - dt * 1.0);
    }

    // Apply ground contact or magnetic lift
    const contactFactor = Math.max(0, 1.0 - this.liftMultiplier);
    this.heading += turnRate * dt * contactFactor;

    // Forward direction vector
    const fwdX = -Math.sin(this.heading);
    const fwdZ = -Math.cos(this.heading);

    // Compute velocity
    const targetVelX = fwdX * this.speed;
    const targetVelZ = fwdZ * this.speed;

    this.vel.x += (targetVelX - this.vel.x) * gripFactor * 8.0 * dt * contactFactor;
    this.vel.z += (targetVelZ - this.vel.z) * gripFactor * 8.0 * dt * contactFactor;

    // External forces (magnetic pull, explosions, steam)
    this.vel.x += this.externalForce.x * dt;
    this.vel.y += this.externalForce.y * dt;
    this.vel.z += this.externalForce.z * dt;
    this.externalForce.multiplyScalar(0.92);

    // Update position
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Track surface heightfield & normal query
    let targetGroundY = 0;
    let groundNormal = new THREE.Vector3(0, 1, 0);
    let surfaceFriction = 1.0;

    if (trackQuery) {
      const q = trackQuery(this.pos.x, this.pos.z);
      targetGroundY = q.height;
      groundNormal = q.normal;
      surfaceFriction = q.friction ?? 1.0;

      // Hydroplaning in sewage
      if (surfaceFriction < 0.6) {
        this.vel.x *= 0.995;
        this.vel.z *= 0.995;
      }
    }

    // Vertical suspension / ground clamping
    const targetY = targetGroundY + this.liftMultiplier * 4.5;
    this.pos.y += (targetY - this.pos.y) * Math.min(dt * 15.0, 1.0);

    // Update root mesh transform
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.heading;

    // Suspension Pitch & Roll
    const targetPitch = (-forwardAccel * 0.0035) + (this.liftMultiplier * 0.15);
    const targetRoll = (turnRate * this.speed * 0.003) * (this.isDrifting ? -0.5 : 1.0);
    this.suspensionPitch += (targetPitch - this.suspensionPitch) * Math.min(dt * 8.0, 1.0);
    this.suspensionRoll += (targetRoll - this.suspensionRoll) * Math.min(dt * 8.0, 1.0);

    this.chassis.rotation.x = this.suspensionPitch;
    this.chassis.rotation.z = this.suspensionRoll;

    // Wheel animation (spin & steer)
    const wheelRollDist = this.speed * dt;
    const wheelRotAngle = wheelRollDist / 0.50855; // divided by TyreRadius

    this.wheels.forEach(w => {
      // Steer front wheels
      if (w.isFront) {
        w.steerPivot.rotation.y = this.steerAngle * (w.isLeft ? 1 : 1);
      }
      // Spin wheels
      w.spinPivot.rotation.x -= wheelRotAngle;
    });

    // Taillight brake glow
    if (isBraking || isReversing) {
      this.matTaillight.emissiveIntensity = 4.0;
      this.brakeLights.forEach(l => l.intensity = 2.2);
    } else {
      this.matTaillight.emissiveIntensity = 1.0;
      this.brakeLights.forEach(l => l.intensity = 0.35);
    }

    // Headlight flicker if low health
    if (this.health < 30) {
      const flicker = Math.random() > 0.15 ? 1 : 0.2;
      this.headlights.forEach(h => h.intensity = 3.5 * flicker);
    } else {
      this.headlights.forEach(h => h.intensity = 4.0);
    }

    // Engine RPM & Gear calculation
    const speedKmh = Math.abs(this.speed) * 3.6;
    this.gear = Math.min(6, Math.max(1, Math.floor(speedKmh / 32) + 1));
    const gearSpeed = speedKmh / (this.gear * 30.0);
    this.rpm = 900 + Math.min(gearSpeed, 1.0) * 6200 + (input.up ? 400 : 0);
    const rpmRatio = (this.rpm - 900) / 6600;
    const speedRatio = Math.min(Math.abs(this.speed) / this.maxSpeed, 1.0);
    const throttle = input.up ? 1.0 : (isReversing ? 0.6 : 0.0);

    // Audio updates
    sound.updateEngine(rpmRatio, throttle, speedRatio);
    sound.updateSkid(this.isDrifting ? 0.9 : (Math.abs(turnRate) > 1.2 ? 0.4 : 0));
    sound.updateNitro(this.isBoosting);

    // Particle FX
    if (this.isBoosting) {
      // Twin exhaust particle jets
      const fwd = new THREE.Vector3(fwdX, 0, fwdZ);
      const right = new THREE.Vector3(-fwdZ, 0, fwdX);
      [-0.45, 0.45].forEach(side => {
        const exhaustPos = this.pos.clone()
          .addScaledVector(fwd, -2.95)
          .addScaledVector(right, side)
          .add(new THREE.Vector3(0, 0.4, 0));
        this.particles.spawnNitro(exhaustPos.x, exhaustPos.y, exhaustPos.z, fwdX, 0, fwdZ);
      });
    }

    if (this.isDrifting || (isBraking && Math.abs(this.speed) > 12)) {
      // Tire smoke & skid marks
      const fwd = new THREE.Vector3(fwdX, 0, fwdZ);
      const right = new THREE.Vector3(-fwdZ, 0, fwdX);
      [-0.95, 0.95].forEach(side => {
        const tirePos = this.pos.clone()
          .addScaledVector(fwd, -1.6)
          .addScaledVector(right, side);
        this.particles.spawnSmoke(tirePos.x, tirePos.y + 0.1, tirePos.z, -this.vel.x * 0.2, 0.4, -this.vel.z * 0.2, 0.8);
        this.particles.addSkid(tirePos.x, tirePos.y, tirePos.z);
      });
    }
  }
}
