import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage6MagneticCrane {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'MAGNETIC SCRAPYARD';
    this.subtitle = 'Overhead Crane & Magnetic Tractor Beam';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x140e08;
    this.skyColor = 0x24160c;

    this.trackLength = 260.0;
    this.craneZ = -80.0;
    this.craneX = 0;
    this.craneDir = 1;
    this.craneSpeed = 8.0;

    this.scrapObjects = [];
    this.droppedScrap = [];
    this.dropTimer = 0;
    this.time = 0;

    this._buildEnvironment();
    this._buildGantryCrane();
    this._buildPortal();
  }

  _buildEnvironment() {
    // Rusted steel plate roadway
    const roadGeom = new THREE.PlaneGeometry(16, this.trackLength);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x362820,
      roughness: 0.85,
      metalness: 0.4
    });
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.trackLength * 0.5 + 15);
    road.receiveShadow = true;
    this.root.add(road);

    // Mountainous scrap piles along sides
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x423126, roughness: 0.9, metalness: 0.6 });
    [-1, 1].forEach(side => {
      for (let z = 15; z >= -this.trackLength + 20; z -= 18) {
        const pile = new THREE.Mesh(new THREE.DodecahedronGeometry(8 + Math.random() * 5, 1), scrapMat);
        pile.position.set(side * (14 + Math.random() * 4), 3, z);
        pile.rotation.set(Math.random() * 6, Math.random() * 6, 0);
        this.root.add(pile);
      }
    });

    // Overhead gantry crane rails running parallel to road
    const railMat = new THREE.MeshStandardMaterial({ color: 0x222228, metalness: 0.8 });
    [-10.5, 10.5].forEach(x => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, this.trackLength), railMat);
      rail.position.set(x, 15, -this.trackLength * 0.5 + 15);
      this.root.add(rail);

      // Support pillars
      for (let z = 15; z >= -this.trackLength + 20; z -= 35) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 1.2), railMat);
        p.position.set(x, 7.5, z);
        this.root.add(p);
      }
    });
  }

  _buildGantryCrane() {
    this.craneGroup = new THREE.Group();

    // Cross gantry beam spanning the rails
    const gantryMat = new THREE.MeshStandardMaterial({ color: 0xcc8800, metalness: 0.7, roughness: 0.3 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 1.8, 3.5), gantryMat);
    beam.position.y = 15.5;
    this.craneGroup.add(beam);

    // Trolley moving along beam
    this.trolley = new THREE.Group();
    this.trolley.position.set(0, 14.5, 0);
    const trolleyMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.2, 3.2), gantryMat);
    this.trolley.add(trolleyMesh);
    this.craneGroup.add(this.trolley);

    // Steel hoist cables
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x111 });
    const cableGeom = new THREE.CylinderGeometry(0.06, 0.06, 7.5, 6);
    [-0.8, 0.8].forEach(cx => {
      const cable = new THREE.Mesh(cableGeom, cableMat);
      cable.position.set(cx, -3.75, 0);
      this.trolley.add(cable);
    });

    // Circular Electro-Magnet Head
    this.magnetGroup = new THREE.Group();
    this.magnetGroup.position.set(0, 7.5, 0);
    this.craneGroup.add(this.magnetGroup);

    const magGeom = new THREE.CylinderGeometry(3.2, 3.4, 1.4, 24);
    const magMat = new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.9, roughness: 0.2 });
    const magnetMesh = new THREE.Mesh(magGeom, magMat);
    this.magnetGroup.add(magnetMesh);

    // Glowing blue electromagnetic core
    const coreGeom = new THREE.RingGeometry(0.8, 3.1, 24);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, side: THREE.DoubleSide });
    const coreMesh = new THREE.Mesh(coreGeom, this.coreMat);
    coreMesh.rotation.x = Math.PI / 2;
    coreMesh.position.y = -0.71;
    this.magnetGroup.add(coreMesh);

    // Electric field light
    this.magLight = new THREE.PointLight(0x00d4ff, 3.0, 20);
    this.magLight.position.y = -1.2;
    this.magnetGroup.add(this.magLight);

    // Attached scrap bundle under the magnet
    this.scrapBundle = new THREE.Group();
    this.scrapBundle.position.set(0, -1.6, 0);
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x5a4232, metalness: 0.8, roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(1.2 + Math.random(), 0.8, 1.6 + Math.random()), scrapMat);
      s.position.set((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2.5);
      s.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.scrapBundle.add(s);
    }
    this.magnetGroup.add(this.scrapBundle);

    this.root.add(this.craneGroup);
  }

  _dropScrap() {
    const scrapGeom = new THREE.BoxGeometry(2.2, 1.4, 2.2);
    const scrapMat = new THREE.MeshStandardMaterial({ color: 0x483224, roughness: 0.8, metalness: 0.7 });
    const scrap = new THREE.Mesh(scrapGeom, scrapMat);
    scrap.castShadow = true;

    const spawnPos = new THREE.Vector3(
      this.craneGroup.position.x + this.trolley.position.x,
      7.0,
      this.craneGroup.position.z
    );
    scrap.position.copy(spawnPos);
    this.root.add(scrap);

    this.droppedScrap.push({
      mesh: scrap,
      pos: spawnPos,
      velY: -2.0,
      landed: false,
      radius: 1.6
    });

    // Sound
    sound.playCrash(0.6);
  }

  _buildPortal() {
    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 1.0, -this.trackLength + 10),
      7, // Leads to Stage 7 (Grand Finale!)
      'D-DAY BUNKERS & MINEFIELD'
    );
  }

  querySurface(x, z) {
    return { height: 0, normal: new THREE.Vector3(0, 1, 0), friction: 0.92 };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;

    // Move crane along the track length (Z = -50 to -180)
    this.craneZ += this.craneDir * this.craneSpeed * dt;
    if (this.craneZ < -180) {
      this.craneZ = -180;
      this.craneDir = 1;
    } else if (this.craneZ > -45) {
      this.craneZ = -45;
      this.craneDir = -1;
    }

    // Traverse trolley left and right across beam
    this.trolley.position.x = Math.sin(this.time * 1.4) * 6.0;
    this.magnetGroup.position.x = this.trolley.position.x;
    this.craneGroup.position.z = this.craneZ;

    // Electric arcs & pulse
    const magnetWorldPos = new THREE.Vector3(
      this.craneGroup.position.x + this.magnetGroup.position.x,
      this.magnetGroup.position.y,
      this.craneGroup.position.z
    );

    const distToMagnet = car.pos.distanceTo(magnetWorldPos);
    const inRange = distToMagnet < 18.0;

    // Update magnetic hum audio
    if (inRange) {
      sound.updateMagnetHum(1.0 - distToMagnet / 18.0);
      this.magLight.intensity = 4.0 + Math.sin(this.time * 18.0) * 2.0;

      // Hazard 2: Magnetic Tractor Pull! Car is attracted upwards
      const dx = magnetWorldPos.x - car.pos.x;
      const dz = magnetWorldPos.z - car.pos.z;
      const horizDist = Math.hypot(dx, dz);

      if (horizDist < 6.5) {
        // High magnetic intensity! Sucked toward magnet!
        const liftIntensity = Math.max(0, 1.0 - horizDist / 6.5);
        car.liftMultiplier = Math.min(1.0, car.liftMultiplier + liftIntensity * dt * 2.5);

        // Pull car laterally toward magnet center
        car.externalForce.x += (dx / (horizDist || 1)) * 14.0 * liftIntensity;
        car.externalForce.z += (dz / (horizDist || 1)) * 14.0 * liftIntensity;

        // Sparks flying between car roof and magnet!
        this.particles.spawnSparks(car.pos.x, car.pos.y + 1.2, car.pos.z, 6, 8);

        // If player uses boost, they can escape the field!
        if (car.isBoosting) {
          car.liftMultiplier = Math.max(0, car.liftMultiplier - dt * 3.0);
        }
      } else {
        car.liftMultiplier = Math.max(0, car.liftMultiplier - dt * 2.0);
      }
    } else {
      sound.updateMagnetHum(0);
      car.liftMultiplier = Math.max(0, car.liftMultiplier - dt * 2.0);
    }

    // Hazard 1: Occasional scrap drops!
    this.dropTimer += dt;
    if (this.dropTimer > 3.5) {
      this.dropTimer = 0;
      this._dropScrap();
    }

    // Update falling/dropped scrap
    for (let i = this.droppedScrap.length - 1; i >= 0; i--) {
      const s = this.droppedScrap[i];
      if (!s.landed) {
        s.velY -= 16.0 * dt;
        s.pos.y += s.velY * dt;
        if (s.pos.y <= 0.7) {
          s.pos.y = 0.7;
          s.landed = true;
          sound.playCrash(0.8);
          this.particles.spawnSparks(s.pos.x, 0.5, s.pos.z, 15, 10);
        }
        s.mesh.position.copy(s.pos);
      }

      // Check collision with car
      const dx = car.pos.x - s.pos.x;
      const dz = car.pos.z - s.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist < s.radius + 1.8 && car.pos.y < 2.0) {
        sound.playCrash(0.9);
        this.particles.spawnSparks(car.pos.x, car.pos.y + 0.5, car.pos.z, 20, 10);
        car.takeDamage(15.0);
        car.speed *= 0.3;
        car.externalForce.x += (dx / (dist || 1)) * 20.0;
        car.externalForce.z += (dz / (dist || 1)) * 20.0;
      }
    }

    // Boundary check
    if (Math.abs(car.pos.x) > 9.5) {
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
