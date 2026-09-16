// src/boatPhysics.js
// 6-DOF Hydrodynamic Buoyant Boat Simulation & Interactive Vessel
// Features multi-probe hydrostatic buoyancy, wave riding, dynamic wake injection, and particle foam churn

import * as THREE from 'three';
import { PHYSICS } from './constants.js';

export class BoatController {
  constructor(scene, waveModel, fluidGrid, particleSystem) {
    this.scene = scene;
    this.waveModel = waveModel;
    this.fluidGrid = fluidGrid;
    this.particleSystem = particleSystem;

    // Rigid body state
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.heading = 0.0; // Yaw angle (radians)
    this.pitch = 0.0;
    this.roll = 0.0;
    this.yawRate = 0.0;

    this.throttle = 0.0;      // [-1.0, 1.0]
    this.rudder = 0.0;        // [-1.0, 1.0]
    this.speed = 0.0;         // Forward speed (knots / m/s)
    this.isBoosted = false;

    // Physical mass & dimensions
    this.mass = 2800.0;       // kg
    this.maxSpeed = 22.0;     // m/s (~43 knots)
    this.acceleration = 12.0;

    // 6 Hydrodynamic Buoyancy Sampling Probes (relative to boat center)
    this.probes = [
      { localPos: new THREE.Vector3( 0.0, -0.2,  4.2), area: 0.85, name: 'bow' },
      { localPos: new THREE.Vector3(-1.3, -0.2,  0.8), area: 1.1,  name: 'mid-port' },
      { localPos: new THREE.Vector3( 1.3, -0.2,  0.8), area: 1.1,  name: 'mid-starboard' },
      { localPos: new THREE.Vector3(-1.2, -0.2, -3.4), area: 1.25, name: 'stern-port' },
      { localPos: new THREE.Vector3( 1.2, -0.2, -3.4), area: 1.25, name: 'stern-starboard' },
      { localPos: new THREE.Vector3( 0.0, -0.7, -0.5), area: 1.5,  name: 'keel' }
    ];

    this.buildBoatMesh();
    this.setupInput();
  }

  buildBoatMesh() {
    this.root = new THREE.Group();

    // High quality PBR materials
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x111e2e, // Deep navy performance hull
      roughness: 0.25,
      metalness: 0.1
    });

    const deckMat = new THREE.MeshStandardMaterial({
      color: 0xe8ecf0, // Clean yacht white deck
      roughness: 0.4,
      metalness: 0.05
    });

    const cabinGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x051525,
      roughness: 0.05,
      metalness: 0.9,
      transmission: 0.6,
      transparent: true,
      opacity: 0.85
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      roughness: 0.15,
      metalness: 0.95
    });

    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
      metalness: 0.7
    });

    // 1. Sleek V-bottom offshore boat hull
    const hullGeo = new THREE.BufferGeometry();
    // Procedural deep-V hull vertices
    const hullVerts = new Float32Array([
      // Bow stem wedge
       0.0, -0.8,  4.5,   0.0,  0.6,  4.5,  -1.2,  0.5,  2.0,
       0.0, -0.8,  4.5,  -1.2,  0.5,  2.0,  -0.5, -0.7,  2.0,
       0.0, -0.8,  4.5,   1.2,  0.5,  2.0,   0.0,  0.6,  4.5,
       0.0, -0.8,  4.5,   0.5, -0.7,  2.0,   1.2,  0.5,  2.0,

      // Midship hull sections
      -1.2,  0.5,  2.0,  -1.4,  0.5, -2.5,  -0.6, -0.7, -2.5,
      -1.2,  0.5,  2.0,  -0.6, -0.7, -2.5,  -0.5, -0.7,  2.0,
       1.2,  0.5,  2.0,   0.6, -0.7, -2.5,   1.4,  0.5, -2.5,
       1.2,  0.5,  2.0,   0.5, -0.7,  2.0,   0.6, -0.7, -2.5,

      // Keel V bottom
       0.0, -0.9,  2.0,  -0.5, -0.7,  2.0,  -0.6, -0.7, -2.5,
       0.0, -0.9,  2.0,  -0.6, -0.7, -2.5,   0.0, -0.85,-2.5,
       0.0, -0.9,  2.0,   0.6, -0.7, -2.5,   0.5, -0.7,  2.0,
       0.0, -0.9,  2.0,   0.0, -0.85,-2.5,   0.6, -0.7, -2.5,

      // Transom stern
      -1.4,  0.5, -2.5,  -1.3,  0.5, -3.8,  -0.6, -0.7, -3.8,
      -1.4,  0.5, -2.5,  -0.6, -0.7, -3.8,  -0.6, -0.7, -2.5,
       1.4,  0.5, -2.5,   0.6, -0.7, -3.8,   1.3,  0.5, -3.8,
       1.4,  0.5, -2.5,   0.6, -0.7, -2.5,   0.6, -0.7, -3.8,

      // Stern flat transom plate
      -1.3,  0.5, -3.8,   1.3,  0.5, -3.8,   0.0, -0.85,-3.8,
      -1.3,  0.5, -3.8,   0.0, -0.85,-3.8,  -0.6, -0.7, -3.8,
       1.3,  0.5, -3.8,   0.6, -0.7, -3.8,   0.0, -0.85,-3.8,
    ]);

    hullGeo.setAttribute('position', new THREE.BufferAttribute(hullVerts, 3));
    hullGeo.computeVertexNormals();
    const hullMesh = new THREE.Mesh(hullGeo, hullMat);
    this.root.add(hullMesh);

    // 2. Deck structure
    const deckGeo = new THREE.BoxGeometry(2.5, 0.25, 7.6);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.set(0, 0.45, -0.1);
    this.root.add(deckMesh);

    // 3. Cockpit cabin & tinted windshield
    const cabinGeo = new THREE.BoxGeometry(1.9, 0.85, 2.8);
    const cabinMesh = new THREE.Mesh(cabinGeo, deckMat);
    cabinMesh.position.set(0, 0.95, 0.2);
    this.root.add(cabinMesh);

    const glassGeo = new THREE.BoxGeometry(1.82, 0.65, 1.8);
    const glassMesh = new THREE.Mesh(glassGeo, cabinGlassMat);
    glassMesh.position.set(0, 1.35, 0.4);
    glassMesh.rotation.x = -0.22;
    this.root.add(glassMesh);

    // Hardtop roof
    const roofGeo = new THREE.BoxGeometry(2.1, 0.12, 2.4);
    const roofMesh = new THREE.Mesh(roofGeo, deckMat);
    roofMesh.position.set(0, 1.75, 0.1);
    this.root.add(roofMesh);

    // Marine radar dome on roof
    const radarGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.22, 16);
    const radarMesh = new THREE.Mesh(radarGeo, chromeMat);
    radarMesh.position.set(0, 1.95, 0.1);
    this.root.add(radarMesh);

    // 4. Twin High-Performance Outboard Motors
    for (let side = -1; side <= 1; side += 2) {
      const motorGroup = new THREE.Group();
      const motorGeo = new THREE.BoxGeometry(0.35, 0.9, 0.55);
      const motorMesh = new THREE.Mesh(motorGeo, engineMat);
      motorGroup.add(motorMesh);

      // Lower gearcase & prop shaft
      const lowerGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.6, 8);
      const lowerMesh = new THREE.Mesh(lowerGeo, chromeMat);
      lowerMesh.position.set(0, -0.55, 0);
      motorGroup.add(lowerMesh);

      motorGroup.position.set(side * 0.75, 0.2, -4.05);
      this.root.add(motorGroup);
    }

    // 5. Chrome bow railing
    const railMat = chromeMat;
    const railGeo = new THREE.TorusGeometry(1.15, 0.035, 8, 24, Math.PI);
    const railMesh = new THREE.Mesh(railGeo, railMat);
    railMesh.rotation.x = Math.PI * 0.5;
    railMesh.position.set(0, 0.72, 2.5);
    this.root.add(railMesh);

    // 6. Navigation lights (Port red, Starboard green)
    const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xff1122 }));
    navRed.position.set(-1.1, 0.65, 2.2);
    this.root.add(navRed);

    const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0x11ff44 }));
    navGreen.position.set(1.1, 0.65, 2.2);
    this.root.add(navGreen);

    this.scene.add(this.root);
  }

  setupInput() {
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      boost: false
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          break;
        case 'Space':
          this.keys.boost = true;
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          break;
        case 'Space':
          this.keys.boost = false;
          break;
      }
    });
  }

  update(dt, time) {
    // 1. Process Player Input Controls
    let targetThrottle = 0.0;
    if (this.keys.forward) targetThrottle += 1.0;
    if (this.keys.backward) targetThrottle -= 0.6;
    if (this.keys.boost && targetThrottle > 0) targetThrottle *= 1.45;

    let targetRudder = 0.0;
    if (this.keys.left) targetRudder -= 1.0;
    if (this.keys.right) targetRudder += 1.0;

    // Smooth throttle and steering input
    this.throttle = THREE.MathUtils.lerp(this.throttle, targetThrottle, dt * 4.0);
    this.rudder = THREE.MathUtils.lerp(this.rudder, targetRudder, dt * 6.0);

    // Forward thrust and hull drag
    const forwardAcc = this.throttle * (this.acceleration * (this.keys.boost ? 1.5 : 1.0));
    const dragCoeff = 0.045 + (this.speed > 8.0 ? 0.015 : 0.035); // Lower planing drag at speed
    this.speed += (forwardAcc - Math.sign(this.speed) * dragCoeff * this.speed * this.speed) * dt;

    // Cap speed
    const maxSpd = this.keys.boost ? this.maxSpeed * 1.35 : this.maxSpeed;
    this.speed = Math.max(-6.0, Math.min(maxSpd, this.speed));

    // Turning dynamics (rudder torque is proportional to forward velocity)
    const turnRate = this.rudder * (1.2 * Math.sign(this.speed) * Math.min(1.0, Math.abs(this.speed) * 0.2));
    this.heading += turnRate * dt;

    // Planing lift at high speed: boat bows up slightly and rises above waterline
    const planingLift = Math.min(0.35, Math.max(0.0, (this.speed - 5.0) * 0.03));
    const bowRise = Math.min(0.12, Math.max(0.0, this.speed * 0.008));

    // 2. 6-DOF Hydrodynamic Buoyancy Simulation (Multi-Probe Sampling)
    // Transform probes into world space based on current heading, pitch, and roll
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    let totalBuoyancy = 0.0;
    let targetPitch = bowRise;
    let targetRoll = -turnRate * 0.25; // Inward bank while turning
    let avgWaterHeight = 0.0;

    for (let i = 0; i < this.probes.length; i++) {
      const probe = this.probes[i];
      // World coordinates of probe
      const pWorldX = this.position.x + (cosH * probe.localPos.x - sinH * probe.localPos.z);
      const pWorldZ = this.position.z + (sinH * probe.localPos.x + cosH * probe.localPos.z);
      const pWorldY = this.position.y + probe.localPos.y;

      // Sample wave height + dynamic fluid simulation disturbance
      const waveH = this.waveModel.getHeight(pWorldX, pWorldZ, time) + this.fluidGrid.sampleHeight(pWorldX, pWorldZ);
      avgWaterHeight += waveH;

      const submersion = Math.max(0.0, waveH - pWorldY);
      const force = submersion * probe.area * PHYSICS.GRAVITY * 180.0;
      totalBuoyancy += force;

      // Pitch torque contribution (Z offset)
      targetPitch += (waveH - this.position.y) * (-probe.localPos.z * 0.04);
      // Roll torque contribution (X offset)
      targetRoll += (waveH - this.position.y) * (probe.localPos.x * 0.06);
    }

    avgWaterHeight /= this.probes.length;

    // Vertical heave equilibrium (damped spring toward wave water height)
    const targetY = avgWaterHeight + 0.25 + planingLift;
    this.position.y = THREE.MathUtils.lerp(this.position.y, targetY, dt * 7.0);

    // Smooth pitch and roll toward hydro equilibrium
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, dt * 5.0);
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, dt * 6.0);

    // Clamp angles to prevent extreme tilting in freak waves
    this.pitch = Math.max(-0.45, Math.min(0.55, this.pitch));
    this.roll = Math.max(-0.45, Math.min(0.45, this.roll));

    // 3. Advance World Position
    // Direction vector of boat (heading: 0 = +Z forward)
    const moveX = -sinH * this.speed * dt;
    const moveZ = cosH * this.speed * dt;

    this.position.x += moveX;
    this.position.z += moveZ;

    // Apply orientation and position to 3D mesh
    this.root.position.copy(this.position);
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.heading);
    this.root.rotateX(this.pitch);
    this.root.rotateZ(this.roll);

    // 4. Update Dynamic Fluid Grid Center & Inject Boat Wake & Particle Foam
    this.fluidGrid.setCenter(this.position.x, this.position.z);

    const bowX = this.position.x - sinH * 4.2;
    const bowZ = this.position.z + cosH * 4.2;
    const sternX = this.position.x + sinH * 3.8;
    const sternZ = this.position.z - cosH * 3.8;

    // Inject physical wake displacement into dynamic wave PDE grid
    this.fluidGrid.addBoatWake(bowX, bowZ, sternX, sternZ, Math.abs(this.speed), this.heading);

    // Emit trailing physical foam particles & spray from propeller & hull
    this.particleSystem.emitBoatWakeFoam(bowX, bowZ, sternX, sternZ, Math.abs(this.speed), this.heading);
  }

  // Camera anchor positions
  getChaseCameraTarget(outPos, outLookAt) {
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    // 12m behind, 4.5m above boat
    const dist = 12.0;
    const height = 4.2;

    outPos.set(
      this.position.x + sinH * dist,
      this.position.y + height,
      this.position.z - cosH * dist
    );

    // Look slightly ahead of boat
    outLookAt.set(
      this.position.x - sinH * 3.0,
      this.position.y + 1.2,
      this.position.z + cosH * 3.0
    );
  }

  getHelmCameraTarget(outPos, outLookAt) {
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    // At the cockpit helm
    outPos.set(
      this.position.x - sinH * 0.2,
      this.position.y + 1.45,
      this.position.z + cosH * 0.2
    );

    outLookAt.set(
      this.position.x - sinH * 15.0,
      this.position.y + 1.2,
      this.position.z + cosH * 15.0
    );
  }
}
