import * as THREE from 'three';
import { Portal } from '../portal.js';
import { sound } from '../audio.js';

export class Stage2SewerPipe {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.name = 'SEWER CONDUIT';
    this.subtitle = 'Curved Aqueduct & High-Pressure Steam';
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.spawn = {
      pos: new THREE.Vector3(0, 0.4, 15),
      heading: 0
    };

    this.fogColor = 0x09140e;
    this.skyColor = 0x0f2216;

    this.pipeRadius = 14.0;
    this.pipeLength = 260.0;
    this.pipeStartZ = 20.0;
    this.pipeEndZ = -240.0;

    // Steam vents & cracks
    this.vents = [];
    this.pressure = 40.0; // 40% to 100%
    this.time = 0;

    this._buildPipe();
    this._buildSewerSludge();
    this._buildSteamCracks();
    this._buildPortal();
  }

  _buildPipe() {
    // Huge cylindrical pipe tunnel interior
    const pipeGeom = new THREE.CylinderGeometry(
      this.pipeRadius,
      this.pipeRadius,
      this.pipeLength,
      36,
      32,
      true,
      -Math.PI * 0.75,
      Math.PI * 1.5
    );
    // Invert faces to see inside cylinder
    pipeGeom.scale(-1, 1, 1);

    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x1f2622,
      roughness: 0.85,
      metalness: 0.35,
      side: THREE.DoubleSide
    });

    const pipeMesh = new THREE.Mesh(pipeGeom, pipeMat);
    pipeMesh.rotation.x = Math.PI / 2;
    pipeMesh.position.set(0, this.pipeRadius, (this.pipeStartZ + this.pipeEndZ) * 0.5);
    pipeMesh.receiveShadow = true;
    this.root.add(pipeMesh);

    // Structural reinforcing ring ribs along the pipe length
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x111613, metalness: 0.8, roughness: 0.3 });
    const ribGeom = new THREE.TorusGeometry(this.pipeRadius - 0.1, 0.45, 12, 36, Math.PI * 1.5);
    for (let z = this.pipeStartZ; z >= this.pipeEndZ; z -= 14) {
      const rib = new THREE.Mesh(ribGeom, ribMat);
      rib.position.set(0, this.pipeRadius, z);
      rib.rotation.z = Math.PI * 0.25;
      this.root.add(rib);

      // Yellow warning emergency lights along the ribs
      if (Math.abs(z % 28) < 1) {
        const warnLight = new THREE.PointLight(0xffaa00, 1.2, 18);
        warnLight.position.set(-this.pipeRadius + 1.2, this.pipeRadius * 0.7, z);
        this.root.add(warnLight);

        const blubGeom = new THREE.SphereGeometry(0.25, 8, 8);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
        const bulb = new THREE.Mesh(blubGeom, bulbMat);
        bulb.position.copy(warnLight.position);
        this.root.add(bulb);
      }
    }
  }

  _buildSewerSludge() {
    // Toxic fluorescent green sludge running along the bottom trough
    const sludgeGeom = new THREE.PlaneGeometry(5.2, this.pipeLength);
    this.sludgeMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv * vec2(1.0, 30.0);
          float flow = sin(uv.y * 4.0 - time * 3.0) * cos(uv.x * 6.0 + time * 2.0);
          vec3 baseGreen = vec3(0.08, 0.45, 0.12);
          vec3 glowGreen = vec3(0.25, 0.95, 0.35);
          vec3 col = mix(baseGreen, glowGreen, flow * 0.5 + 0.5);
          gl_FragColor = vec4(col, 0.88);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    const sludgeMesh = new THREE.Mesh(sludgeGeom, this.sludgeMat);
    sludgeMesh.rotation.x = -Math.PI / 2;
    sludgeMesh.position.set(0, 0.08, (this.pipeStartZ + this.pipeEndZ) * 0.5);
    this.root.add(sludgeMesh);
  }

  _buildSteamCracks() {
    // 16 crack vents along the curved conduit
    const crackMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      emissive: 0xff3300,
      emissiveIntensity: 1.5,
      roughness: 0.9
    });

    const ventConfigs = [
      { z: 0,    x: -3.5, side: 'left' },
      { z: -18,  x: 4.2,  side: 'right' },
      { z: -34,  x: 0.5,  side: 'floor' },
      { z: -50,  x: -4.8, side: 'left' },
      { z: -68,  x: 3.2,  side: 'right' },
      { z: -84,  x: -1.2, side: 'floor' },
      { z: -100, x: 5.0,  side: 'right' },
      { z: -116, x: -3.8, side: 'left' },
      { z: -132, x: 1.5,  side: 'floor' },
      { z: -148, x: -5.2, side: 'left' },
      { z: -164, x: 4.5,  side: 'right' },
      { z: -180, x: -0.5, side: 'floor' },
      { z: -196, x: -4.0, side: 'left' },
      { z: -210, x: 3.8,  side: 'right' },
      { z: -224, x: 0.0,  side: 'floor' },
      { z: -236, x: -3.5, side: 'left' }
    ];

    ventConfigs.forEach((cfg, idx) => {
      const crackGeom = new THREE.BoxGeometry(1.6, 0.15, 3.2);
      const crackMesh = new THREE.Mesh(crackGeom, crackMat);

      // Compute y on the curved pipe wall
      const r = this.pipeRadius;
      const y = r - Math.sqrt(Math.max(0.1, r * r - cfg.x * cfg.x));
      crackMesh.position.set(cfg.x, y + 0.05, cfg.z);

      // Tilt crack to align with pipe surface
      crackMesh.rotation.z = Math.atan2(cfg.x, r - y);
      this.root.add(crackMesh);

      // Point light for warning glow
      const ventLight = new THREE.PointLight(0xff4400, 0.5, 6);
      ventLight.position.set(cfg.x, y + 0.8, cfg.z);
      this.root.add(ventLight);

      this.vents.push({
        mesh: crackMesh,
        light: ventLight,
        x: cfg.x,
        y: y,
        z: cfg.z,
        side: cfg.side,
        unlockPressure: 40 + idx * 3.8, // opens up as pressure rises
        burstTimer: Math.random() * 2.0,
        burstPeriod: 2.2 + Math.random() * 1.2,
        isBursting: false,
        activeDuration: 0.9
      });
    });
  }

  _buildPortal() {
    // Sluice gate arch at end of pipe
    const gateGeom = new THREE.BoxGeometry(18, 18, 3);
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x151c17, roughness: 0.8 });
    const gate = new THREE.Mesh(gateGeom, gateMat);
    gate.position.set(0, 9, this.pipeEndZ - 5);
    this.root.add(gate);

    this.portal = new Portal(
      this.scene,
      this.particles,
      new THREE.Vector3(0, 1.0, this.pipeEndZ),
      3, // Leads to Stage 3
      'DUNG BEETLE RIDGE'
    );
  }

  querySurface(x, z) {
    // Curved pipe cross-section
    const r = this.pipeRadius;
    const clampedX = Math.max(-r * 0.72, Math.min(r * 0.72, x));
    const h = r - Math.sqrt(Math.max(0.01, r * r - clampedX * clampedX));

    // Surface normal
    const nx = -clampedX / r;
    const ny = Math.sqrt(Math.max(0.01, 1.0 - (clampedX * clampedX) / (r * r)));
    const normal = new THREE.Vector3(nx, ny, 0).normalize();

    // Sludge friction
    const isSludge = Math.abs(x) < 2.4;
    const friction = isSludge ? 0.38 : 0.95;

    return { height: h, normal: normal, friction: friction };
  }

  update(dt, car, onPortalTrigger) {
    this.time += dt;
    this.sludgeMat.uniforms.time.value += dt;

    // Rise pressure as car drives forward or over time
    const progress = Math.max(0, Math.min(1.0, (this.spawn.pos.z - car.pos.z) / this.pipeLength));
    this.pressure = 40.0 + progress * 55.0 + Math.sin(this.time * 0.8) * 5.0;

    // Process steam fissures & eruptions
    this.vents.forEach(v => {
      if (this.pressure >= v.unlockPressure) {
        v.burstTimer += dt;
        if (v.burstTimer >= v.burstPeriod) {
          v.isBursting = true;
          v.light.intensity = 2.8;

          // Compute steam jet direction from pipe wall inward
          const dirX = -v.x / this.pipeRadius;
          const dirY = (this.pipeRadius - v.y) / this.pipeRadius;

          this.particles.spawnSteam(v.x, v.y + 0.3, v.z, dirX, dirY, 0, 1.3);

          if (v.burstTimer >= v.burstPeriod + v.activeDuration) {
            v.burstTimer = 0;
            v.isBursting = false;
            v.light.intensity = 0.4;
          }

          // Sound check near car
          const distToCar = Math.hypot(car.pos.x - v.x, car.pos.z - v.z);
          if (distToCar < 15.0 && Math.random() < 0.1) {
            sound.playSteamHiss(1.0 - distToCar / 15.0);
          }

          // Hit car with steam jet
          if (distToCar < 3.2 && Math.abs(car.pos.y - v.y) < 2.8) {
            car.externalForce.x += dirX * 22.0;
            car.externalForce.y += dirY * 12.0;
            car.takeDamage(10.0);
          }
        }
      }
    });

    // Check bounds / fallen outside pipe
    if (Math.abs(car.pos.x) > this.pipeRadius * 0.85 || car.pos.y > this.pipeRadius * 1.5) {
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
