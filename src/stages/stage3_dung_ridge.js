import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage3DungRidge {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'DUNG BEETLE RIDGE';
    this.subtitle = 'Boulder Avalanches & Scarab Crossing';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x2b1e15;
    this.skyColor = 0x5a341a;

    this.trackLength = 260.0;
    this.beetles = [];
    this.boulders = [];
    this.boulderPool = [];
    this.time = 0;

    this._buildTerrain();
    this._buildBeetles();
    this._buildBoulders();
    this._buildPortal();
  }

  _buildTerrain() {
    // Canyon floor & road
    const roadGeom = new THREE.PlaneGeometry(16, this.trackLength, 8, 48);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x422d20,
      roughness: 0.95,
      metalness: 0.05
    });
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.trackLength * 0.5 + 15);
    road.receiveShadow = true;
    this.root.add(road);

    // Canyon bluffs / hillsides on left (-X) and right (+X)
    const bluffMat = new THREE.MeshStandardMaterial({
      color: 0x6e432a,
      roughness: 0.9,
      metalness: 0.1
    });

    [-1, 1].forEach(side => {
      for (let z = 15; z >= -this.trackLength + 15; z -= 22) {
        const hillGeom = new THREE.ConeGeometry(14 + Math.random() * 8, 18 + Math.random() * 10, 7);
        const hill = new THREE.Mesh(hillGeom, bluffMat);
        hill.position.set(side * (18 + Math.random() * 6), 7, z);
        hill.rotation.y = Math.random() * Math.PI;
        hill.castShadow = true;
        hill.receiveShadow = true;
        this.root.add(hill);
      }
    });

    // Canyon boulders & obstacles along road edges
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x543625, roughness: 0.95 });
    for (let z = 0; z >= -this.trackLength + 30; z -= 18) {
      const rx = (Math.random() - 0.5) * 11;
      const rockGeom = new THREE.DodecahedronGeometry(1.6 + Math.random() * 1.2);
      const rock = new THREE.Mesh(rockGeom, rockMat);
      rock.position.set(rx > 0 ? rx + 2 : rx - 2, 1.0, z);
      rock.rotation.set(Math.random() * 4, Math.random() * 4, 0);
      rock.castShadow = true;
      this.root.add(rock);
    }
  }

  _buildBeetles() {
    // 5 Giant Dung Beetles stationed along the high ridge bluffs
    const beetleSpawns = [
      { x: -16, y: 12, z: -25,  side: -1 },
      { x: 17,  y: 13, z: -65,  side: 1 },
      { x: -18, y: 14, z: -110, side: -1 },
      { x: 16,  y: 12, z: -155, side: 1 },
      { x: -17, y: 13, z: -200, side: -1 }
    ];

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1208,
      metalness: 0.85,
      roughness: 0.25
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x0f0b06,
      roughness: 0.6
    });

    beetleSpawns.forEach((s, idx) => {
      const beetle = new THREE.Group();
      beetle.position.set(s.x, s.y, s.z);

      // Carapace (rounded back shell)
      const carapaceGeom = new THREE.SphereGeometry(2.4, 16, 12);
      carapaceGeom.scale(1.2, 0.9, 1.5);
      const carapace = new THREE.Mesh(carapaceGeom, bodyMat);
      carapace.position.set(0, 1.2, 0);
      beetle.add(carapace);

      // Head & Horn
      const headGeom = new THREE.ConeGeometry(0.8, 1.6, 8);
      const head = new THREE.Mesh(headGeom, bodyMat);
      head.rotation.x = Math.PI / 2;
      head.position.set(0, 0.8, s.side * 2.2);
      beetle.add(head);

      const hornGeom = new THREE.CylinderGeometry(0.12, 0.25, 2.0, 6);
      const horn = new THREE.Mesh(hornGeom, bodyMat);
      horn.rotation.x = Math.PI * 0.35;
      horn.position.set(0, 1.8, s.side * 2.8);
      beetle.add(horn);

      // Articulated legs
      const legs = [];
      for (let l = -1; l <= 1; l++) {
        [-1, 1].forEach(lx => {
          const legGeom = new THREE.CylinderGeometry(0.12, 0.08, 2.5, 6);
          const leg = new THREE.Mesh(legGeom, legMat);
          leg.position.set(lx * 2.0, 0.2, l * 1.2);
          leg.rotation.z = lx * 0.6;
          beetle.add(leg);
          legs.push(leg);
        });
      }

      // Orient beetle facing toward the road
      beetle.rotation.y = s.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(beetle);

      this.beetles.push({
        group: beetle,
        legs: legs,
        spawn: s,
        cooldown: Math.random() * 2.5,
        interval: 3.2 + Math.random() * 1.5,
        rollAnim: 0
      });
    });
  }

  _buildBoulders() {
    // Pool of reusable rolling dung boulders
    const dungMat = new THREE.MeshStandardMaterial({
      color: 0x3d2715,
      roughness: 0.95,
      metalness: 0.05
    });

    for (let i = 0; i < 20; i++) {
      const radius = 1.4 + Math.random() * 0.7;
      const bGeom = new THREE.DodecahedronGeometry(radius, 2);
      const mesh = new THREE.Mesh(bGeom, dungMat);
      mesh.castShadow = true;
      mesh.visible = false;
      this.root.add(mesh);

      this.boulderPool.push({
        mesh: mesh,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(0, 0, 0),
        radius: radius,
        active: false,
        rotAxis: new THREE.Vector3(0, 0, 1),
        dustTimer: 0
      });
    }
  }

  _spawnBoulder(startX, startY, startZ, targetSide) {
    const b = this.boulderPool.find(x => !x.active);
    if (!b) return;

    b.active = true;
    b.mesh.visible = true;
    b.pos.set(startX, startY, startZ);

    // Roll diagonally downhill across the road
    const vx = targetSide * (10.0 + Math.random() * 5.0);
    const vz = (Math.random() - 0.5) * 4.0;
    const vy = -4.0;
    b.vel.set(vx, vy, vz);

    b.rotAxis.set(vz, 0, -vx).normalize();
  }

  _buildPortal() {
    // Ancient desert rock arch
    const archMat = new THREE.MeshStandardMaterial({ color: 0x5a341a, roughness: 0.9 });
    const archGeom = new THREE.TorusGeometry(6.0, 1.2, 8, 18, Math.PI);
    const arch = new THREE.Mesh(archGeom, archMat);
    arch.position.set(0, 0, -this.trackLength + 10);
    this.root.add(arch);

    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 1.0, -this.trackLength + 10),
      4, // Leads to Stage 4
      'SMART CITY WAVE BOLLARDS'
    );
  }

  querySurface(x, z) {
    // Road surface is flat Y = 0, sides incline steeply up into bluffs
    let h = 0;
    const absX = Math.abs(x);
    if (absX > 7.5) {
      h = (absX - 7.5) * 1.4; // steep hill slope
    }
    return { height: h, normal: new THREE.Vector3(0, 1, 0), friction: 0.88 };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;

    // Beetles AI: animate and toss boulders
    this.beetles.forEach(b => {
      b.cooldown -= dt;

      // Leg wiggle
      b.legs.forEach((leg, i) => {
        leg.rotation.x = Math.sin(this.time * 6.0 + i) * 0.3;
      });

      if (b.cooldown <= 0) {
        b.cooldown = b.interval;
        // Spawn rolling boulder down the hill toward the opposite side
        const targetSide = -b.spawn.side;
        this._spawnBoulder(b.spawn.x, b.spawn.y - 1.5, b.spawn.z, targetSide);
      }
    });

    // Update active rolling boulders
    this.boulderPool.forEach(b => {
      if (!b.active) return;

      // Move boulder
      b.pos.x += b.vel.x * dt;
      b.pos.z += b.vel.z * dt;

      // Gravity & ground contact
      const surfaceH = this.querySurface(b.pos.x, b.pos.z).height;
      if (b.pos.y > surfaceH + b.radius) {
        b.vel.y -= 18.0 * dt;
        b.pos.y += b.vel.y * dt;
      } else {
        b.pos.y = surfaceH + b.radius;
        // Bounce dampening
        if (b.vel.y < -3.0) {
          b.vel.y = -b.vel.y * 0.45;
          const distToCar = car.pos.distanceTo(b.pos);
          if (distToCar < 35.0) sound.playBoulderThud();
        } else {
          b.vel.y = 0;
        }
      }

      // Roll rotation
      b.mesh.rotateOnAxis(b.rotAxis, (b.vel.length() / b.radius) * dt);
      b.mesh.position.copy(b.pos);

      // Dust puffs
      b.dustTimer += dt;
      if (b.dustTimer > 0.12 && b.pos.y < 3.0) {
        b.dustTimer = 0;
        this.particles.spawnDust(b.pos.x, b.pos.y - b.radius * 0.5, b.pos.z, 3, 1.2);
      }

      // Check collision with car
      const dx = car.pos.x - b.pos.x;
      const dy = car.pos.y - b.pos.y;
      const dz = car.pos.z - b.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < b.radius + 1.8 && Math.abs(dy) < 2.5) {
        // Hit by dung boulder!
        sound.playCrash(1.0);
        this.particles.spawnDust(car.pos.x, car.pos.y, car.pos.z, 20, 2.5);

        // Heavy impulse push
        car.externalForce.x += b.vel.x * 2.2;
        car.externalForce.z += (Math.random() - 0.5) * 20.0;
        car.takeDamage(18.0);

        // Deactivate this boulder on impact
        b.active = false;
        b.mesh.visible = false;
      }

      // Deactivate when off bounds
      if (Math.abs(b.pos.x) > 28.0) {
        b.active = false;
        b.mesh.visible = false;
      }
    });

    // Check bounds
    if (Math.abs(car.pos.x) > 18.0) {
      car.respawn(this.spawn.pos, this.spawn.heading);
    }

    // Portal update
    if (this.portal) {
      this.portal.update(dt, car.pos, onPortalTrigger);
    }
  }

  destroy() {
    this.scene.remove(this.root);
    if (this.portal) this.portal.destroy();
  }
}
