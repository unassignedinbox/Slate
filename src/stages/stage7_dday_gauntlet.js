import * as THREE from 'three';
import { sound } from '../audio.js';

export class Stage7DDayGauntlet {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'D-DAY GAUNTLET & FINALE';
    this.subtitle = 'Abandoned Minefield & Pillbox Turrets';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x14181f;
    this.skyColor = 0x1a222e;

    this.trackLength = 280.0;
    this.mines = [];
    this.turrets = [];
    this.finishReached = false;
    this.time = 0;

    this._buildEnvironment();
    this._buildMinefield();
    this._buildTurrets();
    this._buildFinishLine();
  }

  _buildEnvironment() {
    // Trench / Beach battlefield road
    const roadGeom = new THREE.PlaneGeometry(16, this.trackLength, 8, 48);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x3d3830,
      roughness: 0.95,
      metalness: 0.1
    });
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.trackLength * 0.5 + 15);
    road.receiveShadow = true;
    this.root.add(road);

    // Anti-tank Czech hedgehogs (steel I-beam crosses)
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.85, roughness: 0.4 });
    const beamGeom = new THREE.BoxGeometry(0.3, 3.2, 0.3);

    for (let z = 10; z >= -this.trackLength + 35; z -= 14) {
      [-9, 9].forEach(sideX => {
        const hGroup = new THREE.Group();
        hGroup.position.set(sideX + (Math.random() - 0.5) * 1.5, 0.8, z);

        const b1 = new THREE.Mesh(beamGeom, steelMat);
        b1.rotation.set(0.6, 0.3, 0);
        hGroup.add(b1);

        const b2 = new THREE.Mesh(beamGeom, steelMat);
        b2.rotation.set(-0.6, -0.3, 0);
        hGroup.add(b2);

        const b3 = new THREE.Mesh(beamGeom, steelMat);
        b3.rotation.set(0, 0, Math.PI / 2);
        hGroup.add(b3);

        this.root.add(hGroup);
      });
    }

    // Sandbag trenches and embankments
    const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x7a6c52, roughness: 0.9 });
    for (let z = 0; z >= -this.trackLength + 40; z -= 28) {
      [-8.5, 8.5].forEach(x => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 6.0), sandbagMat);
        wall.position.set(x, 0.7, z);
        this.root.add(wall);
      });
    }
  }

  _buildMinefield() {
    // Active proximity landmines placed in a maze formation
    const minePositions = [
      // Section 1
      { x: -3.5, z: -15 }, { x: 3.0, z: -25 }, { x: -1.0, z: -35 }, { x: 4.5, z: -45 },
      // Section 2
      { x: -4.0, z: -60 }, { x: 0.5, z: -70 }, { x: -2.5, z: -80 }, { x: 3.5, z: -90 },
      // Section 3
      { x: -1.5, z: -105 }, { x: 4.0, z: -115 }, { x: -4.5, z: -125 }, { x: 1.0, z: -135 },
      // Section 4
      { x: 3.0, z: -150 }, { x: -3.0, z: -160 }, { x: 0.0, z: -170 }, { x: 4.5, z: -180 },
      // Section 5
      { x: -2.0, z: -195 }, { x: 3.5, z: -205 }, { x: -4.0, z: -215 }
    ];

    const mineBodyMat = new THREE.MeshStandardMaterial({ color: 0x242621, metalness: 0.8, roughness: 0.4 });
    const mineLedMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    minePositions.forEach(mp => {
      const mineGroup = new THREE.Group();
      mineGroup.position.set(mp.x, 0.08, mp.z);

      // Mine disc casing
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.18, 16), mineBodyMat);
      mineGroup.add(casing);

      // Blinking red proximity LED
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mineLedMat);
      led.position.y = 0.12;
      mineGroup.add(led);

      const pLight = new THREE.PointLight(0xff0000, 0.8, 4.0);
      pLight.position.y = 0.2;
      mineGroup.add(pLight);

      this.root.add(mineGroup);

      this.mines.push({
        group: mineGroup,
        led: led,
        light: pLight,
        x: mp.x,
        z: mp.z,
        radius: 1.1,
        active: true
      });
    });
  }

  _buildTurrets() {
    // Concrete Pillbox Bunkers with rotating machine gun turrets
    const turretSpawns = [
      { x: -12, z: -40,  aimSide: 1 },
      { x: 12,  z: -95,  aimSide: -1 },
      { x: -13, z: -150, aimSide: 1 },
      { x: 13,  z: -200, aimSide: -1 }
    ];

    const bunkerMat = new THREE.MeshStandardMaterial({ color: 0x484d54, roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x1f2226, metalness: 0.9, roughness: 0.2 });

    turretSpawns.forEach((ts, idx) => {
      const bunker = new THREE.Group();
      bunker.position.set(ts.x, 0, ts.z);

      // Concrete pillbox base
      const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.2, 3.2, 16), bunkerMat);
      baseMesh.position.y = 1.6;
      bunker.add(baseMesh);

      // Rotating turret dome
      const turretHead = new THREE.Group();
      turretHead.position.set(0, 3.2, 0);
      bunker.add(turretHead);

      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.0, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), metalMat);
      turretHead.add(dome);

      // Twin machine gun barrels
      const barrelGeom = new THREE.CylinderGeometry(0.1, 0.1, 3.2, 8);
      barrelGeom.rotateX(Math.PI / 2);

      [-0.45, 0.45].forEach(bx => {
        const barrel = new THREE.Mesh(barrelGeom, metalMat);
        barrel.position.set(bx, 0.7, 2.2);
        turretHead.add(barrel);
      });

      // Red laser targeting beam
      const laserMat = new THREE.MeshBasicMaterial({ color: 0xff0022, transparent: true, opacity: 0.6 });
      const laserGeom = new THREE.CylinderGeometry(0.03, 0.03, 35, 6);
      laserGeom.rotateX(Math.PI / 2);
      laserGeom.translate(0, 0, 17.5);
      const laser = new THREE.Mesh(laserGeom, laserMat);
      laser.position.set(0, 0.7, 3.8);
      turretHead.add(laser);

      this.root.add(bunker);

      this.turrets.push({
        group: bunker,
        head: turretHead,
        laser: laser,
        x: ts.x,
        z: ts.z,
        fireCooldown: Math.random() * 0.8,
        burstCount: 0,
        inBurst: false,
        range: 45.0
      });
    });
  }

  _buildFinishLine() {
    // Grand Victory Finish Line Archway at Z = -255
    this.finishZ = -255.0;
    this.finishGroup = new THREE.Group();
    this.finishGroup.position.set(0, 0, this.finishZ);

    const archMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.9, roughness: 0.2 });

    // Archway structure
    [-8.5, 8.5].forEach(px => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9.0, 1.4), archMat);
      pillar.position.set(px, 4.5, 0);
      this.finishGroup.add(pillar);
    });

    const crossbeam = new THREE.Mesh(new THREE.BoxGeometry(19.0, 1.8, 1.6), archMat);
    crossbeam.position.set(0, 8.5, 0);
    this.finishGroup.add(crossbeam);

    // Neon "FINISH LINE" Banner
    const bannerGeom = new THREE.PlaneGeometry(12.0, 2.2);
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512;
    bannerCanvas.height = 128;
    const ctx = bannerCanvas.getContext('2d');
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏁 FINISH LINE 🏁', 256, 64);

    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
    const banner = new THREE.Mesh(bannerGeom, bannerMat);
    banner.position.set(0, 8.5, 0.85);
    this.finishGroup.add(banner);

    // Checkered finish line on ground
    const checkGeom = new THREE.PlaneGeometry(16.0, 2.0);
    const checkCanvas = document.createElement('canvas');
    checkCanvas.width = 512;
    checkCanvas.height = 64;
    const cctx = checkCanvas.getContext('2d');
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        cctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#000000';
        cctx.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    const checkTex = new THREE.CanvasTexture(checkCanvas);
    const checkMat = new THREE.MeshBasicMaterial({ map: checkTex });
    const checkLine = new THREE.Mesh(checkGeom, checkMat);
    checkLine.rotation.x = -Math.PI / 2;
    checkLine.position.set(0, 0.05, 0);
    this.finishGroup.add(checkLine);

    // Flashing victory floodlights
    this.floodlights = [];
    [-7.5, 7.5].forEach(fx => {
      const fl = new THREE.SpotLight(0x00f0ff, 4.0, 40, Math.PI / 4, 0.4);
      fl.position.set(fx, 9.0, 2.0);
      fl.target.position.set(fx * 0.5, 0, -10.0);
      this.finishGroup.add(fl);
      this.finishGroup.add(fl.target);
      this.floodlights.push(fl);
    });

    this.root.add(this.finishGroup);
  }

  querySurface(x, z) {
    return { height: 0, normal: new THREE.Vector3(0, 1, 0), friction: 0.94 };
  }

  update(dt, car, onFinish) {
    this.time += dt;

    // Minefield proximity & detonation logic
    this.mines.forEach(m => {
      if (!m.active) return;

      // Pulse red LED
      const pulse = Math.sin(this.time * 8.0) > 0;
      m.led.material.color.setHex(pulse ? 0xff0022 : 0x440000);
      m.light.intensity = pulse ? 1.4 : 0.2;

      // Check distance to car
      const dx = car.pos.x - m.x;
      const dz = car.pos.z - m.z;
      const dist = Math.hypot(dx, dz);

      if (dist < m.radius + 1.2 && car.pos.y < 1.4) {
        // DETONATION!
        m.active = false;
        m.group.visible = false;

        sound.playExplosion();
        this.particles.spawnExplosion(m.x, 0.4, m.z);

        // Huge shockwave impulse launches the car!
        car.externalForce.y += 32.0;
        car.externalForce.x += (dx / (dist || 1)) * 25.0;
        car.externalForce.z += (dz / (dist || 1)) * 25.0;
        car.takeDamage(26.0);
      }
    });

    // Pillbox Machine Gun Turret tracking and firing
    this.turrets.forEach(t => {
      const dx = car.pos.x - t.x;
      const dz = car.pos.z - t.z;
      const dist = Math.hypot(dx, dz);

      if (dist < t.range) {
        // Aim turret head towards car
        const targetAngle = Math.atan2(dx, dz);
        t.head.rotation.y = THREE.MathUtils.lerp(t.head.rotation.y, targetAngle, dt * 6.0);

        t.fireCooldown -= dt;
        if (t.fireCooldown <= 0) {
          t.fireCooldown = 0.12; // rapid machine gun cadence
          t.burstCount++;

          // Fire machine gun tracer round!
          sound.playTurretFire();

          // Tracer start position at gun barrel tip
          const startX = t.x + Math.sin(t.head.rotation.y) * 3.5;
          const startY = 3.9;
          const startZ = t.z + Math.cos(t.head.rotation.y) * 3.5;

          // Add slight spread/inaccuracy
          const spreadX = (Math.random() - 0.5) * 1.8;
          const spreadY = (Math.random() - 0.5) * 0.8;
          const spreadZ = (Math.random() - 0.5) * 1.8;

          this.particles.fireTracer(
            startX, startY, startZ,
            car.pos.x + spreadX, car.pos.y + 0.6 + spreadY, car.pos.z + spreadZ
          );

          // Chance to hit car directly
          if (dist < 30.0 && Math.random() < 0.35) {
            this.particles.spawnSparks(car.pos.x + spreadX, car.pos.y + 0.6, car.pos.z + spreadZ, 6, 8);
            car.takeDamage(4.0);
          }

          // Reload pause after 6 shots
          if (t.burstCount >= 6) {
            t.burstCount = 0;
            t.fireCooldown = 1.4 + Math.random() * 0.8;
          }
        }
      }
    });

    // Check Victory Finish Line crossing
    if (!this.finishReached && car.pos.z < this.finishZ) {
      this.finishReached = true;
      sound.playVictoryFanfare();

      // Launch fireworks
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          this.particles.spawnFireworks(
            (Math.random() - 0.5) * 25.0,
            12.0 + Math.random() * 8.0,
            this.finishZ - Math.random() * 15.0
          );
        }, i * 350);
      }

      if (onFinish) {
        onFinish();
      }
    }

    // Boundary check
    if (Math.abs(car.pos.x) > 9.0) {
      car.respawn(this.spawn.pos, this.spawn.heading);
    }
  }

  destroy() {
    this.scene.remove(this.root);
  }
}
