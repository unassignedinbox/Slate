import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage1Rooftops {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'SHATTERED METROPOLIS';
    this.subtitle = 'Floating Rooftops & Drifting Debris';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.5, 10),
      heading: 0
    };

    // Environmental lighting & fog settings
    this.fogColor = 0x0a0c18;
    this.skyColor = 0x12172b;

    this.platforms = [];
    this.debrisObjects = [];
    this.time = 0;

    this._buildEnvironment();
    this._buildRooftops();
    this._buildFloatingDebris();
    this._buildPortal();
  }

  _buildEnvironment() {
    // Distant floating skyscraper silhouettes
    const bldgMat = new THREE.MeshStandardMaterial({
      color: 0x090b14,
      roughness: 0.9,
      metalness: 0.1
    });
    const winMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.7
    });

    for (let i = 0; i < 45; i++) {
      const w = 15 + Math.random() * 25;
      const d = 15 + Math.random() * 25;
      const h = 60 + Math.random() * 140;
      const bGeom = new THREE.BoxGeometry(w, h, d);
      const bMesh = new THREE.Mesh(bGeom, bldgMat);

      const angle = (i / 45) * Math.PI * 2 + Math.random() * 0.2;
      const dist = 75 + Math.random() * 120;
      bMesh.position.set(
        Math.cos(angle) * dist,
        -h * 0.5 + Math.random() * 30 - 20,
        Math.sin(angle) * dist - 80
      );
      this.root.add(bMesh);

      // Window grid rows
      if (Math.random() > 0.4) {
        const winGeom = new THREE.PlaneGeometry(w * 0.8, 1.2);
        for (let y = 10; y < h * 0.8; y += 8) {
          const winMesh = new THREE.Mesh(winGeom, winMat);
          winMesh.position.set(bMesh.position.x, bMesh.position.y + y, bMesh.position.z + d * 0.51);
          this.root.add(winMesh);
        }
      }
    }

    // Distant floating fractured concrete rocks in the abyss
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c1e28, roughness: 0.95 });
    for (let i = 0; i < 30; i++) {
      const s = 4 + Math.random() * 10;
      const rockGeom = new THREE.DodecahedronGeometry(s, 1);
      const rock = new THREE.Mesh(rockGeom, rockMat);
      rock.position.set(
        (Math.random() - 0.5) * 160,
        -25 + (Math.random() - 0.5) * 40,
        -Math.random() * 220
      );
      rock.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.root.add(rock);
    }
  }

  _buildRooftops() {
    // Rooftop sections layout (Z moves forward along -Z)
    const roofConfigs = [
      // { x, y, z, width, length, angle }
      { x: 0,   y: 0,   z: 0,    w: 16, l: 38, type: 'start' },
      { x: 2,   y: 1.5, z: -46,  w: 14, l: 36, type: 'hvac' },
      { x: -4,  y: 3.0, z: -92,  w: 15, l: 38, type: 'helipad' },
      { x: 0,   y: 1.0, z: -140, w: 12, l: 40, type: 'solar' },
      { x: 5,   y: 4.5, z: -190, w: 16, l: 42, type: 'antenna' },
      { x: 0,   y: 6.0, z: -245, w: 22, l: 48, type: 'portalRoof' }
    ];

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x22252e,
      roughness: 0.75,
      metalness: 0.2
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xff4422,
      emissive: 0xff2200,
      emissiveIntensity: 0.8
    });

    roofConfigs.forEach(cfg => {
      // Main rooftop slab
      const geom = new THREE.BoxGeometry(cfg.w, 40, cfg.l);
      const mesh = new THREE.Mesh(geom, roofMat);
      mesh.position.set(cfg.x, cfg.y - 20, cfg.z);
      mesh.receiveShadow = true;
      this.root.add(mesh);

      // Flashing neon hazard curb lines along the roof edges
      const curbGeom = new THREE.BoxGeometry(0.3, 0.4, cfg.l);
      [-cfg.w * 0.5 + 0.2, cfg.w * 0.5 - 0.2].forEach(ox => {
        const curb = new THREE.Mesh(curbGeom, edgeMat);
        curb.position.set(cfg.x + ox, cfg.y + 0.2, cfg.z);
        this.root.add(curb);
      });

      // Rooftop Props
      if (cfg.type === 'start') {
        // Start line markings
        const lineGeom = new THREE.PlaneGeometry(cfg.w * 0.7, 1.0);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const line = new THREE.Mesh(lineGeom, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(cfg.x, cfg.y + 0.05, cfg.z + 12);
        this.root.add(line);
      } else if (cfg.type === 'helipad') {
        // Helipad Yellow Circle & H
        const circleGeom = new THREE.RingGeometry(4.2, 4.6, 32);
        const circleMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide });
        const circle = new THREE.Mesh(circleGeom, circleMat);
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(cfg.x, cfg.y + 0.04, cfg.z);
        this.root.add(circle);
      } else if (cfg.type === 'hvac') {
        // Air conditioning chiller units along sides
        const hvacMat = new THREE.MeshStandardMaterial({ color: 0x444a55, roughness: 0.6 });
        [-cfg.w * 0.35, cfg.w * 0.35].forEach(ox => {
          const hvacGeom = new THREE.BoxGeometry(3, 2.2, 4);
          const hvac = new THREE.Mesh(hvacGeom, hvacMat);
          hvac.position.set(cfg.x + ox, cfg.y + 1.1, cfg.z);
          hvac.castShadow = true;
          this.root.add(hvac);
        });
      } else if (cfg.type === 'solar') {
        // Solar panels
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x052244, roughness: 0.2, metalness: 0.8 });
        const panelGeom = new THREE.BoxGeometry(2.5, 0.2, 5);
        for (let j = -12; j <= 12; j += 8) {
          const panel = new THREE.Mesh(panelGeom, panelMat);
          panel.position.set(cfg.x - 4, cfg.y + 0.6, cfg.z + j);
          panel.rotation.z = 0.2;
          this.root.add(panel);
        }
      }

      this.platforms.push({
        minX: cfg.x - cfg.w * 0.5,
        maxX: cfg.x + cfg.w * 0.5,
        minZ: cfg.z - cfg.l * 0.5,
        maxZ: cfg.z + cfg.l * 0.5,
        y: cfg.y
      });
    });

    // Connecting suspension skyway ramps between roofs
    const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x30333e, metalness: 0.4, roughness: 0.6 });
    for (let i = 0; i < roofConfigs.length - 1; i++) {
      const p1 = roofConfigs[i];
      const p2 = roofConfigs[i + 1];

      const startZ = p1.z - p1.l * 0.5;
      const endZ = p2.z + p2.l * 0.5;
      const gapL = startZ - endZ;
      const midZ = (startZ + endZ) * 0.5;
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;

      const bridgeGeom = new THREE.BoxGeometry(9.0, 0.8, gapL + 1.0);
      const bridgeMesh = new THREE.Mesh(bridgeGeom, bridgeMat);
      bridgeMesh.position.set(midX, midY, midZ);
      bridgeMesh.rotation.x = Math.atan2(p2.y - p1.y, -gapL);
      bridgeMesh.rotation.y = Math.atan2(p2.x - p1.x, -gapL);
      this.root.add(bridgeMesh);

      this.platforms.push({
        minX: Math.min(p1.x, p2.x) - 4.5,
        maxX: Math.max(p1.x, p2.x) + 4.5,
        minZ: endZ - 1.0,
        maxZ: startZ + 1.0,
        y: midY
      });
    }
  }

  _buildFloatingDebris() {
    // Dynamic moving floating building chunks that can hit players!
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x3d414d,
      roughness: 0.8,
      metalness: 0.3
    });
    const rebarMat = new THREE.MeshStandardMaterial({
      color: 0x8a3a22,
      roughness: 0.5,
      metalness: 0.7
    });

    const debrisConfigs = [
      // Gap 1 Debris (oscillates left-right)
      { basePos: new THREE.Vector3(0, 2.0, -26), size: [3.8, 2.5, 3.8], type: 'hOscillate', range: 7.0, speed: 1.8 },
      { basePos: new THREE.Vector3(-3, 3.5, -34), size: [3.0, 3.0, 3.0], type: 'tumble', range: 4.0, speed: 2.2 },

      // Gap 2 Debris
      { basePos: new THREE.Vector3(2, 4.0, -72), size: [4.2, 3.0, 4.0], type: 'hOscillate', range: 8.0, speed: 2.5 },
      { basePos: new THREE.Vector3(-4, 5.0, -80), size: [3.5, 2.2, 3.5], type: 'tumble', range: 5.0, speed: 1.9 },

      // Gap 3 Debris (vertical & horizontal wave)
      { basePos: new THREE.Vector3(0, 3.0, -118), size: [4.5, 2.8, 4.0], type: 'vOscillate', range: 3.5, speed: 2.4 },
      { basePos: new THREE.Vector3(4, 2.5, -126), size: [3.8, 3.2, 3.8], type: 'hOscillate', range: 6.5, speed: 3.0 },

      // Gap 4 Debris (approaching final roof)
      { basePos: new THREE.Vector3(-2, 5.5, -168), size: [4.2, 3.5, 4.2], type: 'hOscillate', range: 8.5, speed: 2.8 },
      { basePos: new THREE.Vector3(3, 6.5, -178), size: [3.6, 2.8, 3.6], type: 'tumble', range: 5.0, speed: 2.6 },
      { basePos: new THREE.Vector3(0, 7.5, -218), size: [5.0, 3.5, 4.5], type: 'hOscillate', range: 7.5, speed: 3.2 }
    ];

    debrisConfigs.forEach((cfg, idx) => {
      const dGroup = new THREE.Group();
      dGroup.position.copy(cfg.basePos);

      // Fractured concrete slab
      const dGeom = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
      const dMesh = new THREE.Mesh(dGeom, debrisMat);
      dMesh.castShadow = true;
      dGroup.add(dMesh);

      // Jagged rebar rods sticking out of broken concrete
      const rebarGeom = new THREE.CylinderGeometry(0.08, 0.08, 2.8, 6);
      for (let r = 0; r < 3; r++) {
        const rebar = new THREE.Mesh(rebarGeom, rebarMat);
        rebar.position.set(
          (Math.random() - 0.5) * cfg.size[0],
          (Math.random() - 0.5) * cfg.size[1],
          cfg.size[2] * 0.5 + 0.8
        );
        rebar.rotation.set(0.4, 0.2, (Math.random() - 0.5) * 0.8);
        dGroup.add(rebar);
      }

      this.root.add(dGroup);
      this.debrisObjects.push({
        group: dGroup,
        basePos: cfg.basePos.clone(),
        type: cfg.type,
        range: cfg.range,
        speed: cfg.speed,
        radius: Math.max(cfg.size[0], cfg.size[2]) * 0.6,
        phase: idx * 1.3
      });
    });
  }

  _buildPortal() {
    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 6.0, -260),
      2, // Leads to Stage 2
      'SEWER PIPE CONDUIT'
    );
  }

  querySurface(x, z) {
    // Check which platform the car is on
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
        return { height: p.y, normal: new THREE.Vector3(0, 1, 0), friction: 1.0 };
      }
    }
    // Fallen into abyss
    return { height: -40.0, normal: new THREE.Vector3(0, 1, 0), friction: 1.0 };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;

    // Animate floating debris
    this.debrisObjects.forEach(d => {
      if (d.type === 'hOscillate') {
        d.group.position.x = d.basePos.x + Math.sin(this.time * d.speed + d.phase) * d.range;
        d.group.rotation.y += dt * 0.5;
      } else if (d.type === 'vOscillate') {
        d.group.position.y = d.basePos.y + Math.sin(this.time * d.speed + d.phase) * d.range;
        d.group.rotation.x += dt * 0.4;
      } else if (d.type === 'tumble') {
        d.group.position.x = d.basePos.x + Math.cos(this.time * d.speed + d.phase) * d.range;
        d.group.rotation.x += dt * 1.2;
        d.group.rotation.y += dt * 0.8;
        d.group.rotation.z += dt * 0.9;
      }

      // Check collision with car
      const dx = car.pos.x - d.group.position.x;
      const dy = car.pos.y - d.group.position.y;
      const dz = car.pos.z - d.group.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < d.radius + 1.8 && Math.abs(dy) < 2.5) {
        // Hit by debris!
        const pushX = (dx / (dist || 1)) * 18.0;
        const pushZ = (dz / (dist || 1)) * 18.0;
        car.externalForce.x += pushX;
        car.externalForce.z += pushZ;
        car.takeDamage(12.0);
      }
    });

    // Fall-off check
    if (car.pos.y < -8.0) {
      car.takeDamage(25.0);
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
