import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage4WaveBollards {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'SMART CITY WAVE BOLLARDS';
    this.subtitle = 'Kinetic Security Grid & Traffic Detection';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x060c18;
    this.skyColor = 0x091428;

    this.trackLength = 260.0;
    this.gantries = [];
    this.bollardZones = [];
    this.allBollards = [];
    this.time = 0;

    this._buildCityscape();
    this._buildRoadway();
    this._buildTrafficGantries();
    this._buildWaveBollards();
    this._buildPortal();
  }

  _buildCityscape() {
    // Cyberpunk skyscrapers on left and right
    const bldgMat = new THREE.MeshStandardMaterial({ color: 0x111624, roughness: 0.7, metalness: 0.3 });
    const winMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6 });

    [-1, 1].forEach(side => {
      for (let z = 20; z >= -this.trackLength + 20; z -= 25) {
        const w = 18 + Math.random() * 12;
        const d = 22 + Math.random() * 10;
        const h = 50 + Math.random() * 90;

        const bldgGeom = new THREE.BoxGeometry(w, h, d);
        const bldg = new THREE.Mesh(bldgGeom, bldgMat);
        bldg.position.set(side * (24 + w * 0.5), h * 0.5 - 2, z);
        bldg.castShadow = true;
        bldg.receiveShadow = true;
        this.root.add(bldg);

        // Window stripes
        const stripeGeom = new THREE.PlaneGeometry(w * 0.9, 0.8);
        for (let y = 8; y < h * 0.7; y += 6) {
          const stripe = new THREE.Mesh(stripeGeom, winMat);
          stripe.position.set(bldg.position.x, y, z + d * 0.51);
          if (side < 0) stripe.rotation.y = Math.PI;
          this.root.add(stripe);
        }
      }
    });

    // Streetlights
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444b5c, metalness: 0.8 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0x00e1ff });
    for (let z = 10; z >= -this.trackLength + 20; z -= 28) {
      [-11, 11].forEach(x => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 8), poleMat);
        pole.position.set(x, 3.5, z);
        this.root.add(pole);

        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), lightMat);
        bulb.position.set(x + (x > 0 ? -1.0 : 1.0), 6.8, z);
        this.root.add(bulb);

        const pLight = new THREE.PointLight(0x00e1ff, 0.8, 14);
        pLight.position.copy(bulb.position);
        this.root.add(pLight);
      });
    }
  }

  _buildRoadway() {
    // 4-lane city avenue
    const roadGeom = new THREE.PlaneGeometry(18, this.trackLength, 1, 1);
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d24,
      roughness: 0.65,
      metalness: 0.25
    });
    const road = new THREE.Mesh(roadGeom, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -this.trackLength * 0.5 + 15);
    road.receiveShadow = true;
    this.root.add(road);

    // Glowing lane dividers
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.8 });
    for (let z = 15; z >= -this.trackLength + 15; z -= 8) {
      [-4.5, 4.5].forEach(x => {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 4.0), stripeMat);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(x, 0.02, z);
        this.root.add(stripe);
      });
    }
    // Center double yellow line
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    [-0.15, 0.15].forEach(x => {
      const yellowLine = new THREE.Mesh(new THREE.PlaneGeometry(0.12, this.trackLength), yellowMat);
      yellowLine.rotation.x = -Math.PI / 2;
      yellowLine.position.set(x, 0.02, -this.trackLength * 0.5 + 15);
      this.root.add(yellowLine);
    });
  }

  _buildTrafficGantries() {
    // 3 Overhead sensor gantries that detect the player's car
    const gantryPositions = [-40, -110, -180];
    const gantryMat = new THREE.MeshStandardMaterial({ color: 0x2a303d, metalness: 0.7, roughness: 0.3 });

    gantryPositions.forEach((gz, idx) => {
      const gantryGroup = new THREE.Group();
      gantryGroup.position.set(0, 0, gz);

      // Overhead truss arch
      const trussGeom = new THREE.BoxGeometry(20, 0.8, 1.2);
      const truss = new THREE.Mesh(trussGeom, gantryMat);
      truss.position.set(0, 7.5, 0);
      gantryGroup.add(truss);

      [-9.8, 9.8].forEach(px => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 1.2), gantryMat);
        pillar.position.set(px, 4, 0);
        gantryGroup.add(pillar);
      });

      // Traffic light housing (Green, Amber, Red)
      const housingGeom = new THREE.BoxGeometry(1.2, 3.2, 0.8);
      const housingMat = new THREE.MeshStandardMaterial({ color: 0x111317 });
      const housing = new THREE.Mesh(housingGeom, housingMat);
      housing.position.set(0, 6.2, 0);
      gantryGroup.add(housing);

      // Bulbs
      const redBulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshBasicMaterial({ color: 0x330000 }));
      redBulb.position.set(0, 7.0, 0.45);
      gantryGroup.add(redBulb);

      const amberBulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshBasicMaterial({ color: 0x332200 }));
      amberBulb.position.set(0, 6.2, 0.45);
      gantryGroup.add(amberBulb);

      const greenBulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), new THREE.MeshBasicMaterial({ color: 0x00ff66 }));
      greenBulb.position.set(0, 5.4, 0.45);
      gantryGroup.add(greenBulb);

      // Detection laser line across the road
      const laserGeom = new THREE.CylinderGeometry(0.04, 0.04, 18, 6);
      laserGeom.rotateZ(Math.PI / 2);
      const laserMat = new THREE.MeshBasicMaterial({ color: 0x00ff66, transparent: true, opacity: 0.45 });
      const laser = new THREE.Mesh(laserGeom, laserMat);
      laser.position.set(0, 0.15, 25); // sensor line 25m ahead of gantry
      gantryGroup.add(laser);

      this.root.add(gantryGroup);

      this.gantries.push({
        group: gantryGroup,
        z: gz,
        state: 'GREEN', // GREEN, AMBER, RED
        redBulb: redBulb,
        amberBulb: amberBulb,
        greenBulb: greenBulb,
        laser: laser,
        laserMat: laserMat,
        triggerDist: 40.0,
        timer: 0
      });
    });
  }

  _buildWaveBollards() {
    // 3 Major Bollard Grid Zones situated just after each gantry
    const zonePositions = [-50, -120, -190];

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x8892a0,
      metalness: 0.95,
      roughness: 0.2
    });
    const neonRingMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    zonePositions.forEach((zz, zoneIdx) => {
      const zoneBollards = [];
      // 4 rows of bollards per zone
      for (let r = 0; r < 4; r++) {
        const rowZ = zz - r * 5.0;
        // 9 bollards across road width (-7.0 to +7.0)
        for (let x = -7.0; x <= 7.0; x += 1.75) {
          const bGroup = new THREE.Group();
          bGroup.position.set(x, 0, rowZ);

          // Well hole casing
          const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.1, 16), new THREE.MeshBasicMaterial({ color: 0x111115 }));
          hole.position.y = 0.05;
          bGroup.add(hole);

          // Retractable cylinder piston
          const pistonGeom = new THREE.CylinderGeometry(0.28, 0.28, 1.8, 16);
          pistonGeom.translate(0, 0.9, 0); // origin at bottom
          const piston = new THREE.Mesh(pistonGeom, steelMat);
          piston.castShadow = true;
          bGroup.add(piston);

          // Neon glowing top rim
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 16), neonRingMat);
          rim.rotation.x = Math.PI / 2;
          rim.position.y = 1.8;
          piston.add(rim);

          this.root.add(bGroup);

          const bObj = {
            group: bGroup,
            piston: piston,
            rim: rim,
            x: x,
            z: rowZ,
            zoneIdx: zoneIdx,
            row: r,
            height: 0,
            maxHeight: 1.6
          };
          zoneBollards.push(bObj);
          this.allBollards.push(bObj);
        }
      }
      this.bollardZones.push({ z: zz, bollards: zoneBollards });
    });
  }

  _buildPortal() {
    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 1.0, -this.trackLength + 10),
      5, // Leads to Stage 5
      'METRO MONORAIL CROSSINGS'
    );
  }

  querySurface(x, z) {
    return { height: 0, normal: new THREE.Vector3(0, 1, 0), friction: 0.95 };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;

    // Traffic detection logic per gantry
    this.gantries.forEach((g, idx) => {
      const distToSensor = g.z + 25 - car.pos.z;

      // Detection trigger when car passes the sensor
      if (distToSensor < 0 && distToSensor > -45 && g.state === 'GREEN') {
        g.state = 'AMBER';
        g.timer = 0;
        sound.playCrossingBell();

        g.greenBulb.material.color.setHex(0x003311);
        g.amberBulb.material.color.setHex(0xffaa00);
        g.laserMat.color.setHex(0xffaa00);
      }

      if (g.state === 'AMBER') {
        g.timer += dt;
        if (g.timer > 0.8) {
          g.state = 'RED';
          g.amberBulb.material.color.setHex(0x332200);
          g.redBulb.material.color.setHex(0xff0022);
          g.laserMat.color.setHex(0xff0022);
        }
      }
    });

    // Wave bollards animation
    this.allBollards.forEach(b => {
      const gantry = this.gantries[b.zoneIdx];
      let waveSpeed = 4.0;
      let waveAmp = 0.35; // gentle idle wave

      if (gantry.state === 'RED') {
        waveSpeed = 7.5;
        waveAmp = 1.0; // full aggressive lockdown wave
        b.rim.material.color.setHex(0xff2244);
      } else if (gantry.state === 'AMBER') {
        waveSpeed = 6.0;
        waveAmp = 0.7;
        b.rim.material.color.setHex(0xffaa00);
      } else {
        b.rim.material.color.setHex(0x00f0ff);
      }

      // Sinusoidal wave across lateral X and row Z
      const wave = Math.sin(this.time * waveSpeed + b.x * 0.8 + b.row * 1.5);
      // Normalized between 0 (retracted) and 1 (fully extended)
      const extension = Math.max(0, wave);
      b.height = extension * b.maxHeight * waveAmp;

      b.piston.position.y = b.height - 1.8; // sunken when 0, rises up to 0

      // Collision check with car
      if (b.height > 0.4) {
        const dx = car.pos.x - b.x;
        const dz = car.pos.z - b.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 1.4 && car.pos.y < b.height + 0.3) {
          // Hard collision with extended bollard!
          sound.playCrash(0.9);
          this.particles.spawnSparks(car.pos.x, car.pos.y + 0.5, car.pos.z, 20, 10);
          car.speed *= 0.2;
          car.takeDamage(14.0);
          car.externalForce.z += 15.0; // push car back
        }
      }
    });

    // Boundary check
    if (Math.abs(car.pos.x) > 10.5) {
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
