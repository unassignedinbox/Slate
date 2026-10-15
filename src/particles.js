import * as THREE from 'three';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;

    // Pool for general particles (smoke, dust, steam, sparks, fire)
    this.maxParticles = 800;
    this.particleIndex = 0;

    const pGeom = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    this.alphas = new Float32Array(this.maxParticles);

    // Particle metadata
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.lifetimes = new Float32Array(this.maxParticles);
    this.maxLifetimes = new Float32Array(this.maxParticles);
    this.drags = new Float32Array(this.maxParticles);
    this.gravities = new Float32Array(this.maxParticles);

    pGeom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    pGeom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    pGeom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    pGeom.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    // Custom shader material for soft round particles
    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (280.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float falloff = smoothstep(0.5, 0.05, dist);
          gl_FragColor = vec4(vColor, vAlpha * falloff);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(pGeom, this.material);
    this.scene.add(this.points);

    // Skid mark ribbon system
    this.maxSkids = 200;
    this.skidIndex = 0;
    const skidGeom = new THREE.BufferGeometry();
    this.skidPos = new Float32Array(this.maxSkids * 3);
    skidGeom.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    this.skidMat = new THREE.PointsMaterial({
      color: 0x111111,
      size: 0.8,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this.skidPoints = new THREE.Points(skidGeom, this.skidMat);
    this.scene.add(this.skidPoints);

    // Bullet tracer system
    this.bulletCount = 30;
    this.bulletGeom = new THREE.BufferGeometry();
    this.bulletPos = new Float32Array(this.bulletCount * 6); // line segments (2 points per bullet)
    this.bulletGeom.setAttribute('position', new THREE.BufferAttribute(this.bulletPos, 3));
    this.bulletMat = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    this.bulletLines = new THREE.LineSegments(this.bulletGeom, this.bulletMat);
    this.scene.add(this.bulletLines);

    this.activeBullets = [];

    // Warp streaks for portal hyperspace
    this.warpStreaksCount = 60;
    this.warpGeom = new THREE.BufferGeometry();
    this.warpPos = new Float32Array(this.warpStreaksCount * 6);
    this.warpGeom.setAttribute('position', new THREE.BufferAttribute(this.warpPos, 3));
    this.warpMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    this.warpLines = new THREE.LineSegments(this.warpGeom, this.warpMat);
    this.scene.add(this.warpLines);
    this.warpActive = false;
    this.warpProgress = 0;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 0.96, gravity = 0) {
    const idx = this.particleIndex;
    this.particleIndex = (this.particleIndex + 1) % this.maxParticles;

    const i3 = idx * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;

    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;

    this.colors[i3] = r;
    this.colors[i3 + 1] = g;
    this.colors[i3 + 2] = b;

    this.sizes[idx] = size;
    this.alphas[idx] = 1.0;
    this.lifetimes[idx] = life;
    this.maxLifetimes[idx] = life;
    this.drags[idx] = drag;
    this.gravities[idx] = gravity;
  }

  spawnSmoke(x, y, z, vx = 0, vy = 0.5, vz = 0, scale = 1.0) {
    const rx = (Math.random() - 0.5) * 0.4 + vx;
    const ry = (Math.random() * 0.5 + 0.3) * scale + vy;
    const rz = (Math.random() - 0.5) * 0.4 + vz;
    const shade = 0.6 + Math.random() * 0.3;
    this.spawn(x, y, z, rx, ry, rz, shade, shade, shade, 1.2 * scale, 0.8 + Math.random() * 0.5, 0.94, 0.1);
  }

  spawnNitro(x, y, z, dirX, dirY, dirZ) {
    // Twin cyan / orange flame particles
    for (let i = 0; i < 3; i++) {
      const spread = 0.2;
      const speed = -(8 + Math.random() * 12);
      const vx = dirX * speed + (Math.random() - 0.5) * spread;
      const vy = dirY * speed + (Math.random() - 0.5) * spread + 0.2;
      const vz = dirZ * speed + (Math.random() - 0.5) * spread;

      const isCyan = Math.random() > 0.3;
      const r = isCyan ? 0.1 : 1.0;
      const g = isCyan ? 0.8 : 0.4;
      const b = isCyan ? 1.0 : 0.05;

      this.spawn(x, y, z, vx, vy, vz, r, g, b, 0.8 + Math.random() * 0.5, 0.25 + Math.random() * 0.15, 0.85);
    }
  }

  spawnSparks(x, y, z, count = 10, speed = 6) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const spd = (0.5 + Math.random() * 0.8) * speed;
      const vx = Math.cos(theta) * Math.cos(phi) * spd;
      const vy = Math.sin(phi) * spd;
      const vz = Math.sin(theta) * Math.cos(phi) * spd;

      this.spawn(x, y, z, vx, vy, vz, 1.0, 0.7 + Math.random() * 0.3, 0.1, 0.35, 0.4 + Math.random() * 0.3, 0.95, -9.8);
    }
  }

  spawnSteam(x, y, z, dirX, dirY, dirZ, power = 1.0) {
    for (let i = 0; i < 4; i++) {
      const spd = (6 + Math.random() * 8) * power;
      const vx = dirX * spd + (Math.random() - 0.5) * 1.5;
      const vy = dirY * spd + (Math.random() - 0.5) * 1.5;
      const vz = dirZ * spd + (Math.random() - 0.5) * 1.5;

      const shade = 0.85 + Math.random() * 0.15;
      this.spawn(x, y, z, vx, vy, vz, shade * 0.8, shade * 0.9, shade, 1.5 * power, 0.6 + Math.random() * 0.4, 0.92);
    }
  }

  spawnDust(x, y, z, count = 4, scale = 1.0) {
    for (let i = 0; i < count; i++) {
      const vx = (Math.random() - 0.5) * 2;
      const vy = Math.random() * 1.5 + 0.3;
      const vz = (Math.random() - 0.5) * 2;
      this.spawn(x, y, z, vx, vy, vz, 0.75, 0.55, 0.35, 1.4 * scale, 0.7 + Math.random() * 0.4, 0.92, -0.5);
    }
  }

  spawnExplosion(x, y, z) {
    // Fireball center
    for (let i = 0; i < 35; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const spd = 4 + Math.random() * 12;
      const vx = Math.cos(theta) * Math.cos(phi) * spd;
      const vy = Math.sin(phi) * spd + 3.0;
      const vz = Math.sin(theta) * Math.cos(phi) * spd;

      const isFire = Math.random() > 0.4;
      const r = isFire ? 1.0 : 0.3;
      const g = isFire ? Math.random() * 0.6 : 0.3;
      const b = isFire ? 0.05 : 0.3;

      this.spawn(x, y, z, vx, vy, vz, r, g, b, 2.5 + Math.random() * 2, 0.8 + Math.random() * 0.5, 0.9, -4.0);
    }
    // High-speed spark burst
    this.spawnSparks(x, y + 0.5, z, 30, 16);
  }

  spawnFireworks(x, y, z) {
    const palette = [
      [1.0, 0.2, 0.3], // Red
      [0.2, 0.9, 1.0], // Cyan
      [1.0, 0.8, 0.1], // Gold
      [0.8, 0.2, 1.0], // Purple
      [0.2, 1.0, 0.4]  // Green
    ];
    const color = palette[Math.floor(Math.random() * palette.length)];

    for (let i = 0; i < 40; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const spd = 6 + Math.random() * 14;
      const vx = Math.cos(theta) * Math.cos(phi) * spd;
      const vy = Math.sin(phi) * spd;
      const vz = Math.sin(theta) * Math.cos(phi) * spd;

      this.spawn(x, y, z, vx, vy, vz, color[0], color[1], color[2], 1.2, 1.2 + Math.random() * 0.6, 0.96, -3.0);
    }
  }

  addSkid(x, y, z) {
    const i3 = this.skidIndex * 3;
    this.skidPos[i3] = x;
    this.skidPos[i3 + 1] = y + 0.03;
    this.skidPos[i3 + 2] = z;
    this.skidIndex = (this.skidIndex + 1) % this.maxSkids;
    this.skidPoints.geometry.attributes.position.needsUpdate = true;
  }

  fireTracer(startX, startY, startZ, endX, endY, endZ) {
    const dir = new THREE.Vector3(endX - startX, endY - startY, endZ - startZ);
    const dist = dir.length();
    dir.normalize();

    this.activeBullets.push({
      start: new THREE.Vector3(startX, startY, startZ),
      current: new THREE.Vector3(startX, startY, startZ),
      dir: dir,
      targetDist: dist,
      traveled: 0,
      speed: 160.0 // m/s
    });
  }

  triggerWarp(active) {
    this.warpActive = active;
    if (active) {
      this.warpProgress = 0;
      this.warpMat.opacity = 0.9;
    } else {
      this.warpMat.opacity = 0;
    }
  }

  update(dt, carPos, carDir) {
    // Update generic particles
    const pos = this.positions;
    const vel = this.velocities;
    const alp = this.alphas;
    const siz = this.sizes;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.lifetimes[i] > 0) {
        this.lifetimes[i] -= dt;
        const i3 = i * 3;

        // Apply velocity & drag
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;

        vel[i3] *= this.drags[i];
        vel[i3 + 1] = (vel[i3 + 1] + this.gravities[i] * dt) * this.drags[i];
        vel[i3 + 2] *= this.drags[i];

        // Fade alpha & expand size
        const lifeRatio = this.lifetimes[i] / this.maxLifetimes[i];
        alp[i] = lifeRatio;
        siz[i] *= 1.0 + dt * 0.8;
      } else {
        alp[i] = 0;
      }
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;

    // Update active bullet tracers
    for (let i = this.activeBullets.length - 1; i >= 0; i--) {
      const b = this.activeBullets[i];
      const move = b.speed * dt;
      b.traveled += move;
      b.current.addScaledVector(b.dir, move);

      if (b.traveled >= b.targetDist) {
        this.activeBullets.splice(i, 1);
      }
    }

    // Render bullets as short line segments
    const bPos = this.bulletPos;
    for (let i = 0; i < this.bulletCount; i++) {
      const i6 = i * 6;
      if (i < this.activeBullets.length) {
        const b = this.activeBullets[i];
        const tail = b.current.clone().addScaledVector(b.dir, -3.0);
        bPos[i6] = tail.x;
        bPos[i6 + 1] = tail.y;
        bPos[i6 + 2] = tail.z;
        bPos[i6 + 3] = b.current.x;
        bPos[i6 + 4] = b.current.y;
        bPos[i6 + 5] = b.current.z;
      } else {
        bPos[i6] = bPos[i6 + 1] = bPos[i6 + 2] = bPos[i6 + 3] = bPos[i6 + 4] = bPos[i6 + 5] = 0;
      }
    }
    this.bulletLines.geometry.attributes.position.needsUpdate = true;

    // Update warp effect around car
    if (this.warpActive && carPos && carDir) {
      this.warpProgress += dt * 3.0;
      this.warpMat.opacity = Math.min(1.0, this.warpProgress);

      const wPos = this.warpPos;
      for (let i = 0; i < this.warpStreaksCount; i++) {
        const i6 = i * 6;
        const radius = 2.0 + Math.random() * 8.0;
        const angle = (i / this.warpStreaksCount) * Math.PI * 2 + this.warpProgress * 2.0;
        const offsetDist = ((i * 37 + this.warpProgress * 40) % 50) - 10;

        const sx = carPos.x + Math.cos(angle) * radius - carDir.x * offsetDist;
        const sy = carPos.y + Math.sin(angle) * radius + 1.5;
        const sz = carPos.z + Math.cos(angle) * radius - carDir.z * offsetDist;

        wPos[i6] = sx;
        wPos[i6 + 1] = sy;
        wPos[i6 + 2] = sz;

        wPos[i6 + 3] = sx + carDir.x * 6.0;
        wPos[i6 + 4] = sy + carDir.y * 6.0;
        wPos[i6 + 5] = sz + carDir.z * 6.0;
      }
      this.warpLines.geometry.attributes.position.needsUpdate = true;
    } else {
      this.warpMat.opacity = 0;
    }
  }
}
