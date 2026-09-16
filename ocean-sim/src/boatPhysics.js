// src/boatPhysics.js
// 6-DOF Hydrodynamic Buoyant Rigid-Body Simulation
// Simulates realistic waterline plane sampling, 2nd-order heave-pitch-roll mass inertia,
// dynamic hull planing lift, banking roll in turns, and trailing wake fluid disturbances

import * as THREE from 'three';
import { PHYSICS } from './constants.js';

export class BoatController {
  constructor(scene, waveModel, fluidGrid, particleSystem) {
    this.scene = scene;
    this.waveModel = waveModel;
    this.fluidGrid = fluidGrid;
    this.particleSystem = particleSystem;

    // Rigid body state
    this.position = new THREE.Vector3(0, 0.25, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.heading = 0.0;     // Yaw angle (radians)
    this.pitch = 0.0;       // Pitch angle (radians)
    this.roll = 0.0;        // Roll angle (radians)

    // Dynamic velocities
    this.velY = 0.0;
    this.velPitch = 0.0;
    this.velRoll = 0.0;
    this.angularVelYaw = 0.0;

    // Engine and control inputs
    this.throttle = 0.0;
    this.rudder = 0.0;
    this.speed = 0.0;

    // Physical mass, inertias, and hydrodynamic dimensions
    this.mass = 3200.0;           // kg
    this.maxForwardSpeed = 24.0;  // m/s (~46 knots)
    this.maxReverseSpeed = -5.5;  // m/s
    this.enginePower = 15.0;      // m/s^2

    // 8-Point Hydrodynamic Waterline Sampling Probes (local coordinates)
    this.probes = [
      { localPos: new THREE.Vector3( 0.0, -0.2,  4.5), weight: 1.2, name: 'bow' },
      { localPos: new THREE.Vector3(-0.95,-0.2,  2.4), weight: 1.0, name: 'bow-port' },
      { localPos: new THREE.Vector3( 0.95,-0.2,  2.4), weight: 1.0, name: 'bow-starboard' },
      { localPos: new THREE.Vector3(-1.35,-0.2,  0.0), weight: 1.1, name: 'mid-port' },
      { localPos: new THREE.Vector3( 1.35,-0.2,  0.0), weight: 1.1, name: 'mid-starboard' },
      { localPos: new THREE.Vector3(-1.15,-0.2, -3.2), weight: 1.3, name: 'stern-port' },
      { localPos: new THREE.Vector3( 1.15,-0.2, -3.2), weight: 1.3, name: 'stern-starboard' },
      { localPos: new THREE.Vector3( 0.0, -0.6, -0.2), weight: 1.6, name: 'keel' }
    ];

    this.buildBoatMesh();
    this.setupInput();
  }

  buildBoatMesh() {
    this.root = new THREE.Group();

    // High quality PBR materials
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x0f1c2b,
      roughness: 0.22,
      metalness: 0.15
    });

    const deckMat = new THREE.MeshStandardMaterial({
      color: 0xeff3f8,
      roughness: 0.35,
      metalness: 0.05
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x031020,
      roughness: 0.04,
      metalness: 0.95,
      transmission: 0.65,
      transparent: true,
      opacity: 0.88
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe0e0e0,
      roughness: 0.12,
      metalness: 0.96
    });

    const engineMat = new THREE.MeshStandardMaterial({
      color: 0x181818,
      roughness: 0.28,
      metalness: 0.8
    });

    // 1. Sleek V-bottom offshore boat hull
    const hullGeo = new THREE.BufferGeometry();
    const hullVerts = new Float32Array([
      // Bow stem wedge
       0.0, -0.85,  4.6,   0.0,  0.65,  4.6,  -1.2,  0.55,  2.0,
       0.0, -0.85,  4.6,  -1.2,  0.55,  2.0,  -0.55,-0.72,  2.0,
       0.0, -0.85,  4.6,   1.2,  0.55,  2.0,   0.0,  0.65,  4.6,
       0.0, -0.85,  4.6,   0.55,-0.72,  2.0,   1.2,  0.55,  2.0,

      // Midship hull sections
      -1.2,  0.55,  2.0,  -1.42, 0.55, -2.5,  -0.65,-0.72, -2.5,
      -1.2,  0.55,  2.0,  -0.65,-0.72, -2.5,  -0.55,-0.72,  2.0,
       1.2,  0.55,  2.0,   0.65,-0.72, -2.5,   1.42, 0.55, -2.5,
       1.2,  0.55,  2.0,   0.55,-0.72,  2.0,   0.65,-0.72, -2.5,

      // Keel V bottom
       0.0, -0.92,  2.0,  -0.55,-0.72,  2.0,  -0.65,-0.72, -2.5,
       0.0, -0.92,  2.0,  -0.65,-0.72, -2.5,   0.0, -0.88, -2.5,
       0.0, -0.92,  2.0,   0.65,-0.72, -2.5,   0.55,-0.72,  2.0,
       0.0, -0.92,  2.0,   0.0, -0.88, -2.5,   0.65,-0.72, -2.5,

      // Transom stern
      -1.42, 0.55, -2.5,  -1.32, 0.55, -3.8,  -0.65,-0.72, -3.8,
      -1.42, 0.55, -2.5,  -0.65,-0.72, -3.8,  -0.65,-0.72, -2.5,
       1.42, 0.55, -2.5,   0.65,-0.72, -3.8,   1.32, 0.55, -3.8,
       1.42, 0.55, -2.5,   0.65,-0.72, -2.5,   0.65,-0.72, -3.8,

      // Stern flat transom plate
      -1.32, 0.55, -3.8,   1.32, 0.55, -3.8,   0.0, -0.88, -3.8,
      -1.32, 0.55, -3.8,   0.0, -0.88, -3.8,  -0.65,-0.72, -3.8,
       1.32, 0.55, -3.8,   0.65,-0.72, -3.8,   0.0, -0.88, -3.8,
    ]);

    hullGeo.setAttribute('position', new THREE.BufferAttribute(hullVerts, 3));
    hullGeo.computeVertexNormals();
    const hullMesh = new THREE.Mesh(hullGeo, hullMat);
    this.root.add(hullMesh);

    // 2. Deck structure
    const deckGeo = new THREE.BoxGeometry(2.55, 0.25, 7.8);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.set(0, 0.48, -0.1);
    this.root.add(deckMesh);

    // 3. Cabin & tinted windshield
    const cabinGeo = new THREE.BoxGeometry(1.95, 0.88, 2.9);
    const cabinMesh = new THREE.Mesh(cabinGeo, deckMat);
    cabinMesh.position.set(0, 0.98, 0.2);
    this.root.add(cabinMesh);

    const glassGeo = new THREE.BoxGeometry(1.88, 0.68, 1.85);
    const glassMesh = new THREE.Mesh(glassGeo, glassMat);
    glassMesh.position.set(0, 1.4, 0.45);
    glassMesh.rotation.x = -0.25;
    this.root.add(glassMesh);

    // Hardtop roof
    const roofGeo = new THREE.BoxGeometry(2.15, 0.12, 2.45);
    const roofMesh = new THREE.Mesh(roofGeo, deckMat);
    roofMesh.position.set(0, 1.82, 0.15);
    this.root.add(roofMesh);

    // Marine radar dome
    const radarGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.22, 16);
    const radarMesh = new THREE.Mesh(radarGeo, chromeMat);
    radarMesh.position.set(0, 2.02, 0.15);
    this.root.add(radarMesh);

    // 4. Twin High-Performance Outboard Motors
    for (let side = -1; side <= 1; side += 2) {
      const motorGroup = new THREE.Group();
      const motorGeo = new THREE.BoxGeometry(0.36, 0.95, 0.58);
      const motorMesh = new THREE.Mesh(motorGeo, engineMat);
      motorGroup.add(motorMesh);

      const lowerGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.65, 8);
      const lowerMesh = new THREE.Mesh(lowerGeo, chromeMat);
      lowerMesh.position.set(0, -0.6, 0);
      motorGroup.add(lowerMesh);

      motorGroup.position.set(side * 0.78, 0.2, -4.1);
      this.root.add(motorGroup);
    }

    // 5. Chrome bow railing
    const railGeo = new THREE.TorusGeometry(1.18, 0.035, 8, 24, Math.PI);
    const railMesh = new THREE.Mesh(railGeo, chromeMat);
    railMesh.rotation.x = Math.PI * 0.5;
    railMesh.position.set(0, 0.75, 2.6);
    this.root.add(railMesh);

    // 6. Navigation lights
    const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0xff1122 }));
    navRed.position.set(-1.15, 0.68, 2.3);
    this.root.add(navRed);

    const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.06), new THREE.MeshBasicMaterial({ color: 0x11ff44 }));
    navGreen.position.set(1.15, 0.68, 2.3);
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
    // 1. Process Input Controls
    let targetThrottle = 0.0;
    if (this.keys.forward) targetThrottle += 1.0;
    if (this.keys.backward) targetThrottle -= 0.6;
    if (this.keys.boost && targetThrottle > 0) targetThrottle *= 1.45;

    let targetRudder = 0.0;
    if (this.keys.left) targetRudder -= 1.0;
    if (this.keys.right) targetRudder += 1.0;

    this.throttle = THREE.MathUtils.lerp(this.throttle, targetThrottle, dt * 5.0);
    this.rudder = THREE.MathUtils.lerp(this.rudder, targetRudder, dt * 6.0);

    // Forward thrust and hull drag
    const forwardAcc = this.throttle * (this.enginePower * (this.keys.boost ? 1.5 : 1.0));
    const dragCoeff = 0.042 + (Math.abs(this.speed) > 7.0 ? 0.015 : 0.035);
    this.speed += (forwardAcc - Math.sign(this.speed) * dragCoeff * this.speed * this.speed) * dt;

    const maxSpd = this.keys.boost ? this.maxForwardSpeed * 1.35 : this.maxForwardSpeed;
    this.speed = Math.max(this.maxReverseSpeed, Math.min(maxSpd, this.speed));

    // Yaw turning dynamics
    const turnSensitivity = 1.15 * Math.sign(this.speed) * Math.min(1.0, Math.abs(this.speed) * 0.22);
    this.angularVelYaw = THREE.MathUtils.lerp(this.angularVelYaw, this.rudder * turnSensitivity, dt * 8.0);
    this.heading += this.angularVelYaw * dt;

    // Dynamic Planing Lift (as boat speeds up, water pressure lifts the hull and angles bow up)
    const speedRatio = Math.max(0.0, Math.min(1.0, (Math.abs(this.speed) - 3.5) / 16.0));
    const planingLift = speedRatio * 0.42;
    const dynamicBowRise = speedRatio * 0.085;

    // Centrifugal Banking Roll (leans inward during turns)
    const bankingRoll = -this.angularVelYaw * (this.speed * 0.09);

    // 2. Hydrodynamic Waterline Plane Sampling
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    let sumWaterHeight = 0.0;
    let sumWeights = 0.0;

    let bowHeight = 0.0;
    let sternHeight = 0.0;
    let portHeight = 0.0;
    let starboardHeight = 0.0;

    for (let i = 0; i < this.probes.length; i++) {
      const probe = this.probes[i];
      const lx = probe.localPos.x;
      const lz = probe.localPos.z;

      // Probe position in world coordinates (based on vessel heading)
      const worldPx = this.position.x + (cosH * lx - sinH * lz);
      const worldPz = this.position.z + (sinH * lx + cosH * lz);

      const h = this.waveModel.getHeight(worldPx, worldPz, time) +
                this.fluidGrid.sampleHeight(worldPx, worldPz);

      sumWaterHeight += h * probe.weight;
      sumWeights += probe.weight;

      if (probe.name === 'bow') bowHeight = h;
      if (probe.name === 'stern-port' || probe.name === 'stern-starboard') sternHeight += h * 0.5;
      if (probe.name === 'mid-port') portHeight = h;
      if (probe.name === 'mid-starboard') starboardHeight = h;
    }

    const meanWaterHeight = sumWaterHeight / sumWeights;

    // Physical waterline slopes:
    // Pitch slope along centerline (bow is +4.5m, stern is -3.2m -> length = 7.7m)
    // When bow is higher than stern, water slopes up towards the bow: boat pitches up (-pitch angle)
    const targetPitchSlope = -Math.atan2(bowHeight - sternHeight, 7.7) + dynamicBowRise;

    // Roll slope across vessel beam (port is -1.35m, starboard is +1.35m -> beam = 2.7m)
    // When port is higher than starboard, boat rolls towards starboard
    const targetRollSlope = Math.atan2(portHeight - starboardHeight, 2.7) + bankingRoll;

    // Equilibrium floating height (+0.25m deck waterline height + planing lift)
    const targetHeave = meanWaterHeight + 0.25 + planingLift;

    // 3. Critically Damped 2nd-Order Spring-Damper Physics Integration
    // Natural frequencies (rad/s) and damping ratios
    const omegaY = 5.8;
    const zetaY = 0.86;
    const accelY = (omegaY * omegaY) * (targetHeave - this.position.y) - (2.0 * zetaY * omegaY * this.velY);
    this.velY += accelY * dt;
    this.position.y += this.velY * dt;

    const omegaP = 6.4;
    const zetaP = 0.88;
    const accelP = (omegaP * omegaP) * (targetPitchSlope - this.pitch) - (2.0 * zetaP * omegaP * this.velPitch);
    this.velPitch += accelP * dt;
    this.pitch += this.velPitch * dt;

    const omegaR = 7.2;
    const zetaR = 0.88;
    const accelR = (omegaR * omegaR) * (targetRollSlope - this.roll) - (2.0 * zetaR * omegaR * this.velRoll);
    this.velRoll += accelR * dt;
    this.roll += this.velRoll * dt;

    // Safe bounds to prevent unnatural inversion
    this.pitch = Math.max(-0.48, Math.min(0.55, this.pitch));
    this.roll = Math.max(-0.45, Math.min(0.45, this.roll));

    // 4. Advance Horizontal World Position
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

    // 5. Dynamic Fluid Simulation Wake & Particle Foam
    this.fluidGrid.setCenter(this.position.x, this.position.z);

    const bowX = this.position.x - sinH * 4.3;
    const bowZ = this.position.z + cosH * 4.3;
    const sternX = this.position.x + sinH * 3.8;
    const sternZ = this.position.z - cosH * 3.8;

    this.fluidGrid.addBoatWake(bowX, bowZ, sternX, sternZ, Math.abs(this.speed), this.heading);
    this.particleSystem.emitBoatWakeFoam(bowX, bowZ, sternX, sternZ, Math.abs(this.speed), this.heading);
  }

  getChaseCameraTarget(outPos, outLookAt) {
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    const dist = 13.5;
    const height = 4.6;

    outPos.set(
      this.position.x + sinH * dist,
      this.position.y + height,
      this.position.z - cosH * dist
    );

    outLookAt.set(
      this.position.x - sinH * 3.5,
      this.position.y + 1.2,
      this.position.z + cosH * 3.5
    );
  }

  getHelmCameraTarget(outPos, outLookAt) {
    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);

    outPos.set(
      this.position.x - sinH * 0.25,
      this.position.y + 1.48,
      this.position.z + cosH * 0.25
    );

    outLookAt.set(
      this.position.x - sinH * 16.0,
      this.position.y + 1.2,
      this.position.z + cosH * 16.0
    );
  }
}
