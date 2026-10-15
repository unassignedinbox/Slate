import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage5Monorail {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'METRO MONORAIL CROSSINGS';
    this.subtitle = 'High-Speed Rail Intersections';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x080e18;
    this.skyColor = 0x101b2d;

    this.trackLength = 260.0;
    this.crossings = [];
    this.trains = [];
    this.time = 0;

    this._buildEnvironment();
    this._buildCrossings();
    this._buildPortal();
  }

  _buildEnvironment() {
    // Roadway
    const roadGeom = new THREE.PlaneGeometry(16, this.trackLength);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x181a20,
      roughness: 0.7,
      metalness: 0.3
    });
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.trackLength * 0.5 + 15);
    road.receiveShadow = true;
    this.root.add(road);

    // Urban buildings & elevated track pylons
    const bldgMat = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 0.8 });
    [-1, 1].forEach(side => {
      for (let z = 15; z >= -this.trackLength + 20; z -= 30) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(16, 50 + Math.random() * 40, 20), bldgMat);
        b.position.set(side * 22, 25, z);
        this.root.add(b);
      }
    });
  }

  _buildCrossings() {
    const crossingConfigs = [
      { z: -45,  dir: 1,  speed: 42.0, interval: 4.8, offset: 0.5 },
      { z: -115, dir: -1, speed: 48.0, interval: 4.2, offset: 2.2 },
      { z: -185, dir: 1,  speed: 54.0, interval: 3.8, offset: 1.0 }
    ];

    const railMat = new THREE.MeshStandardMaterial({ color: 0x555d6e, metalness: 0.9, roughness: 0.2 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2d3340, roughness: 0.7 });

    crossingConfigs.forEach((cfg, idx) => {
      // Concrete Monorail Guide Beam spanning across the road
      const beamGeom = new THREE.BoxGeometry(160, 1.4, 2.2);
      const beam = new THREE.Mesh(beamGeom, beamMat);
      beam.position.set(0, 0.7, cfg.z);
      this.root.add(beam);

      // Steel running rails on beam
      [-0.6, 0.6].forEach(oz => {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(160, 0.2, 0.15), railMat);
        rail.position.set(0, 1.45, cfg.z + oz);
        this.root.add(rail);
      });

      // Crossing Signals & Barriers (Left and Right sides of road)
      const signals = [];
      [-9.5, 9.5].forEach(x => {
        const sGroup = new THREE.Group();
        sGroup.position.set(x, 0, cfg.z + (x > 0 ? 5 : -5));

        // Signal Mast
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 5, 8), new THREE.MeshStandardMaterial({ color: 0x222 }));
        mast.position.y = 2.5;
        sGroup.add(mast);

        // Crossbuck sign
        const crossbuck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        crossbuck.position.y = 4.2;
        crossbuck.rotation.z = Math.PI / 4;
        sGroup.add(crossbuck);
        const crossbuck2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        crossbuck2.position.y = 4.2;
        crossbuck2.rotation.z = -Math.PI / 4;
        sGroup.add(crossbuck2);

        // Flashing Red Alternate Lights
        const lightA = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x330000 }));
        lightA.position.set(-0.4, 3.8, 0.15);
        sGroup.add(lightA);

        const lightB = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x330000 }));
        lightB.position.set(0.4, 3.8, 0.15);
        sGroup.add(lightB);

        // Lowering barrier arm
        const armPivot = new THREE.Group();
        armPivot.position.set(0, 1.2, 0);
        sGroup.add(armPivot);

        const armGeom = new THREE.BoxGeometry(7.5, 0.2, 0.1);
        armGeom.translate(x > 0 ? -3.75 : 3.75, 0, 0);
        const armMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
        const arm = new THREE.Mesh(armGeom, armMat);
        armPivot.add(arm);

        this.root.add(sGroup);
        signals.push({ lightA, lightB, armPivot, isLeft: x < 0 });
      });

      // Construct High-Speed Monorail Train (Engine + 2 Cars = 3-car train)
      const trainGroup = new THREE.Group();
      const trainLength = 32.0;

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xdd2233,
        metalness: 0.85,
        roughness: 0.25
      });
      const winMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.85 });

      // Build 3 connected cars
      for (let c = 0; c < 3; c++) {
        const carX = (c - 1) * 10.5;
        const carGeom = new THREE.BoxGeometry(9.8, 2.6, 2.8);
        const carMesh = new THREE.Mesh(carGeom, bodyMat);
        carMesh.position.set(carX, 2.2, 0);
        carMesh.castShadow = true;
        trainGroup.add(carMesh);

        // Windows
        const win = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 0.8), winMat);
        win.position.set(carX, 2.4, 1.41);
        trainGroup.add(win);
        const win2 = win.clone();
        win2.position.z = -1.41;
        win2.rotation.y = Math.PI;
        trainGroup.add(win2);
      }

      // Front headlights
      const hl1 = new THREE.PointLight(0xffffff, 2.5, 25);
      hl1.position.set(cfg.dir > 0 ? 16 : -16, 2.2, 0);
      trainGroup.add(hl1);

      this.root.add(trainGroup);

      this.trains.push({
        group: trainGroup,
        z: cfg.z,
        dir: cfg.dir,
        speed: cfg.speed,
        interval: cfg.interval,
        timer: cfg.offset,
        posX: cfg.dir > 0 ? -80 : 80,
        trainLength: trainLength,
        signals: signals,
        warningDist: 35.0,
        whooshPlayed: false
      });
    });
  }

  _buildPortal() {
    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 1.0, -this.trackLength + 10),
      6, // Leads to Stage 6
      'MAGNETIC SCRAPYARD CRANE'
    );
  }

  querySurface(x, z) {
    return { height: 0, normal: new THREE.Vector3(0, 1, 0), friction: 0.95 };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;

    this.trains.forEach(t => {
      t.timer += dt;

      // Update train position
      t.posX += t.dir * t.speed * dt;

      // Reset train on cycle
      if ((t.dir > 0 && t.posX > 85) || (t.dir < 0 && t.posX < -85)) {
        if (t.timer >= t.interval) {
          t.posX = t.dir > 0 ? -85 : 85;
          t.timer = 0;
          t.whooshPlayed = false;
        }
      }

      t.group.position.set(t.posX, 0, t.z);

      // Warning signals check (active when train is within warning distance)
      const distToRoad = Math.abs(t.posX);
      const isApproaching = distToRoad < t.warningDist;

      t.signals.forEach(s => {
        if (isApproaching) {
          // Flashing alternate lights
          const flash = Math.sin(this.time * 12.0) > 0;
          s.lightA.material.color.setHex(flash ? 0xff0022 : 0x330000);
          s.lightB.material.color.setHex(flash ? 0x330000 : 0xff0022);

          // Lower barrier arms
          s.armPivot.rotation.z = THREE.MathUtils.lerp(s.armPivot.rotation.z, s.isLeft ? -Math.PI / 2 : Math.PI / 2, dt * 6.0);
        } else {
          s.lightA.material.color.setHex(0x330000);
          s.lightB.material.color.setHex(0x330000);
          // Raise barrier arms
          s.armPivot.rotation.z = THREE.MathUtils.lerp(s.armPivot.rotation.z, 0, dt * 4.0);
        }
      });

      // Sound audio check when train crosses the highway
      if (distToRoad < 20.0 && !t.whooshPlayed) {
        t.whooshPlayed = true;
        sound.playMonorailWhoosh();
      }

      // Train collision with car
      const dx = car.pos.x - t.posX;
      const dz = car.pos.z - t.z;

      if (Math.abs(dx) < t.trainLength * 0.5 + 1.8 && Math.abs(dz) < 2.5) {
        // T-boned by monorail train!
        sound.playCrash(1.0);
        this.particles.spawnSparks(car.pos.x, car.pos.y + 1.0, car.pos.z, 30, 16);
        car.externalForce.x += t.dir * 45.0;
        car.externalForce.z += 15.0;
        car.takeDamage(28.0);
      }
    });

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
