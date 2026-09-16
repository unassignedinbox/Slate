// src/particleFoam.js
// Physical Lagrangian Foam & Airborne Spray Particle Simulation
// STRICTLY NO SHADER FOAM: 100% of whitecaps, foam streaks, and spray are physical particles!
// Optimized for rock-solid 60 FPS on GTX cards (GTX 1060+) using GPU Instancing

import * as THREE from 'three';
import { PARTICLE_CONFIG, PHYSICS } from './constants.js';

const TYPE_SPRAY = 0.0; // Airborne spindrift / wave spray
const TYPE_FOAM = 1.0;  // Surface foam bubble / whitecap windrow

export class PhysicalParticleFoamSystem {
  constructor(scene, waveModel, fluidGrid) {
    this.scene = scene;
    this.waveModel = waveModel;
    this.fluidGrid = fluidGrid;

    this.maxParticles = PARTICLE_CONFIG.MAX_PARTICLES;
    this.activeCount = 0;

    // CPU particle state arrays (Structure of Arrays for memory cache coherency)
    this.posX = new Float32Array(this.maxParticles);
    this.posY = new Float32Array(this.maxParticles);
    this.posZ = new Float32Array(this.maxParticles);

    this.velX = new Float32Array(this.maxParticles);
    this.velY = new Float32Array(this.maxParticles);
    this.velZ = new Float32Array(this.maxParticles);

    this.life = new Float32Array(this.maxParticles);
    this.maxLife = new Float32Array(this.maxParticles);
    this.size = new Float32Array(this.maxParticles);
    this.type = new Float32Array(this.maxParticles); // 0 = spray, 1 = foam
    this.alpha = new Float32Array(this.maxParticles);
    this.rotation = new Float32Array(this.maxParticles);
    this.rotSpeed = new Float32Array(this.maxParticles);

    // Free list / pool for O(1) particle allocation
    this.freeIndices = new Int32Array(this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++) {
      this.freeIndices[i] = i;
    }
    this.freeCount = this.maxParticles;

    // Simulation tuning
    this.foamEmissionRate = 1.0;
    this.sprayIntensity = 1.0;
    this.bioluminescence = 0.0; // 0.0 = natural white foam, 1.0 = glowing neon-cyan

    // Candidate crest search grid parameters
    this.gridRadius = 60.0; // World radius around camera/boat to search for breaking crests
    this.gridSteps = 24;    // 24x24 probe grid = 576 probe points evaluated per frame

    // Build GPU Instanced Mesh
    this.initMesh();
  }

  initMesh() {
    // 3D low-poly icosasphere or multi-faceted bubble for authentic 3D particle lighting
    const baseGeo = new THREE.DodecahedronGeometry(0.35, 1);

    // Custom Instanced Shader
    const customMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
        uSkyColor: { value: new THREE.Color(0.2, 0.45, 0.75) },
        uBioluminescence: { value: 0.0 },
        uTime: { value: 0.0 }
      },
      vertexShader: `
        attribute vec4 aParticleData; // x: lifeRatio (1->0), y: type (0=spray, 1=foam), z: size, w: alpha
        attribute float aRotation;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec4 vData;
        varying vec3 vViewDir;

        mat3 rotateY(float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return mat3(
            c, 0.0, s,
            0.0, 1.0, 0.0,
            -s, 0.0, c
          );
        }

        void main() {
          vData = aParticleData;
          float life = aParticleData.x;
          float pType = aParticleData.y;
          float baseSize = aParticleData.z;

          // Scale dynamics:
          // Spray starts small, stays compact
          // Surface foam bubbles expand as they aerate and spread out
          float currentScale = baseSize;
          if (pType > 0.5) {
            currentScale *= (1.0 + (1.0 - life) * 0.7);
          } else {
            currentScale *= (0.8 + life * 0.4);
          }

          vec3 transformed = position * currentScale;
          transformed = rotateY(aRotation) * transformed;

          // Apply instance matrix to world position
          vec4 worldPos = modelMatrix * (instanceMatrix * vec4(transformed, 1.0));
          vWorldPos = worldPos.xyz;

          mat3 normalMat = mat3(modelMatrix) * mat3(instanceMatrix);
          vNormal = normalize(normalMat * (rotateY(aRotation) * normal));

          vec4 mvPos = viewMatrix * worldPos;
          vViewDir = normalize(cameraPosition - vWorldPos);

          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform float uBioluminescence;
        uniform float uTime;

        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec4 vData;
        varying vec3 vViewDir;

        void main() {
          float life = vData.x;
          float pType = vData.y;
          float alpha = vData.w;

          if (life <= 0.001 || alpha <= 0.01) {
            discard;
          }

          vec3 N = normalize(vNormal);
          vec3 L = normalize(uSunDir);
          vec3 V = normalize(vViewDir);

          // Diffuse lighting on aerated bubbles
          float NdotL = max(0.0, dot(N, L));
          float hemi = N.y * 0.5 + 0.5;

          // Mie forward-scattering (essential for AAA sea spray glowing into the sun!)
          float forwardScatter = pow(max(0.0, dot(V, -L)), 6.0) * 2.8;

          // Subtle bubble specular rim glint
          vec3 H = normalize(L + V);
          float spec = pow(max(0.0, dot(N, H)), 32.0) * 0.8;

          // Base particle color
          vec3 particleColor;

          if (uBioluminescence > 0.1) {
            // Glowing neon bioluminescent dinoflagellates
            vec3 bioCyan = vec3(0.05, 0.95, 1.0);
            vec3 bioGreen = vec3(0.1, 1.0, 0.6);
            float pulse = sin(uTime * 4.0 + vWorldPos.x * 2.0) * 0.2 + 0.8;
            particleColor = mix(bioCyan, bioGreen, sin(uTime * 2.0 + vWorldPos.z) * 0.5 + 0.5) * pulse * 2.2;
          } else {
            // Physical aerated foam & spray lighting
            vec3 foamWhite = vec3(0.96, 0.98, 1.0);
            vec3 ambient = mix(uSkyColor * 0.6, vec3(0.85, 0.92, 0.98), hemi);
            particleColor = foamWhite * (ambient + uSunColor * (NdotL + forwardScatter) + spec);
          }

          // Fade alpha smoothly with lifetime
          float smoothAlpha = alpha * smoothstep(0.0, 0.2, life);

          // Spray particles are softer and more translucent; foam is denser
          if (pType < 0.5) {
            smoothAlpha *= 0.65;
          }

          gl_FragColor = vec4(particleColor, smoothAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.mesh = new THREE.InstancedMesh(baseGeo, customMaterial, this.maxParticles);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Custom attributes per instance
    this.particleDataAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
    this.particleDataAttr.setUsage(THREE.DynamicDrawUsage);
    baseGeo.setAttribute('aParticleData', this.particleDataAttr);

    this.rotationAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles), 1);
    this.rotationAttr.setUsage(THREE.DynamicDrawUsage);
    baseGeo.setAttribute('aRotation', this.rotationAttr);

    this.dummy = new THREE.Object3D();

    // Initialize all instances to zero scale / hidden
    for (let i = 0; i < this.maxParticles; i++) {
      this.dummy.position.set(0, -9999, 0);
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      this.particleDataAttr.setXYZW(i, 0, 0, 0, 0);
      this.rotationAttr.setX(i, 0);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.particleDataAttr.needsUpdate = true;
    this.rotationAttr.needsUpdate = true;

    this.scene.add(this.mesh);
  }

  // Allocate a particle from the pool
  spawnParticle(x, y, z, vx, vy, vz, size, lifetime, type, alpha = 0.95) {
    if (this.freeCount <= 0) return -1;

    const idx = this.freeIndices[--this.freeCount];

    this.posX[idx] = x;
    this.posY[idx] = y;
    this.posZ[idx] = z;

    this.velX[idx] = vx;
    this.velY[idx] = vy;
    this.velZ[idx] = vz;

    this.life[idx] = lifetime;
    this.maxLife[idx] = lifetime;
    this.size[idx] = size;
    this.type[idx] = type;
    this.alpha[idx] = alpha;
    this.rotation[idx] = Math.random() * Math.PI * 2.0;
    this.rotSpeed[idx] = (Math.random() - 0.5) * 3.0;

    return idx;
  }

  // Free dead particle
  killParticle(idx) {
    this.life[idx] = 0.0;
    this.freeIndices[this.freeCount++] = idx;

    // Move GPU instance out of sight
    this.dummy.position.set(0, -9999, 0);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(idx, this.dummy.matrix);
    this.particleDataAttr.setXYZW(idx, 0, 0, 0, 0);
  }

  // Physical wave breaking crest detector (Stokes limit & Jacobian area compression)
  detectAndEmitWaveBreaking(centerX, centerZ, time, dt) {
    if (this.foamEmissionRate <= 0.01) return;

    const sample = {};
    const radius = this.gridRadius;
    const steps = this.gridSteps;
    const stepSize = (radius * 2.0) / steps;

    const windDx = Math.cos(this.waveModel.windAngle);
    const windDz = Math.sin(this.waveModel.windAngle);
    const windSpeed = this.waveModel.windSpeed;

    // Scan probes across view center
    for (let iz = 0; iz < steps; iz++) {
      const pz = centerZ - radius + (iz + 0.5) * stepSize + (Math.sin(iz * 3.1 + time) * stepSize * 0.3);
      for (let ix = 0; ix < steps; ix++) {
        const px = centerX - radius + (ix + 0.5) * stepSize + (Math.cos(ix * 2.7 + time) * stepSize * 0.3);

        this.waveModel.sampleOcean(px, pz, time, sample);

        // Check Miche wave breaking criterion:
        // Jacobian area compression J < 0.32 OR downward acceleration < -0.35g, with high crest
        if (sample.isBreaking && sample.breakSeverity > 0.05) {
          const prob = sample.breakSeverity * this.foamEmissionRate * 0.35;
          if (Math.random() < prob) {
            // Emit surface foam cluster along the breaking crest
            const clusterSize = 2 + Math.floor(sample.breakSeverity * 4);
            for (let c = 0; c < clusterSize; c++) {
              // Offset perpendicular to wave travel direction (along the crest ridge)
              const ridgeOffsetX = (-windDz * (Math.random() - 0.5) * 3.5) + (Math.random() - 0.5) * 1.0;
              const ridgeOffsetZ = (windDx * (Math.random() - 0.5) * 3.5) + (Math.random() - 0.5) * 1.0;

              const fx = sample.x + ridgeOffsetX;
              const fz = sample.z + ridgeOffsetZ;
              const fy = sample.y + 0.05;

              // Surface foam velocity: orbital wave velocity + Stokes drift
              const stokesDriftX = windDx * 0.6;
              const stokesDriftZ = windDz * 0.6;
              const fvx = sample.velX * 0.5 + stokesDriftX;
              const fvy = 0.0;
              const fvz = sample.velZ * 0.5 + stokesDriftZ;

              const foamLife = PARTICLE_CONFIG.FOAM_LIFETIME_MIN +
                Math.random() * (PARTICLE_CONFIG.FOAM_LIFETIME_MAX - PARTICLE_CONFIG.FOAM_LIFETIME_MIN);
              const pSize = 0.4 + Math.random() * 0.5;

              this.spawnParticle(fx, fy, fz, fvx, fvy, fvz, pSize, foamLife, TYPE_FOAM, 0.9);
            }

            // High-energy breaking crests launch airborne spray particles (spindrift)!
            if (windSpeed > 7.0 && sample.breakSeverity > 0.3 && this.sprayIntensity > 0.05) {
              const sprayCount = 1 + Math.floor(sample.breakSeverity * 3 * this.sprayIntensity);
              for (let s = 0; s < sprayCount; s++) {
                const sx = sample.x + (Math.random() - 0.5) * 2.0;
                const sz = sample.z + (Math.random() - 0.5) * 2.0;
                const sy = sample.y + 0.15;

                // Ejected tangentially forward and upward by wind shear
                const svx = sample.velX * 0.8 + windDx * (windSpeed * 0.4) + (Math.random() - 0.5) * 2.0;
                const svy = Math.abs(sample.velY) * 0.6 + 2.0 + Math.random() * 3.5;
                const svz = sample.velZ * 0.8 + windDz * (windSpeed * 0.4) + (Math.random() - 0.5) * 2.0;

                const sprayLife = PARTICLE_CONFIG.SPRAY_LIFETIME_MIN +
                  Math.random() * (PARTICLE_CONFIG.SPRAY_LIFETIME_MAX - PARTICLE_CONFIG.SPRAY_LIFETIME_MIN);
                const sSize = 0.25 + Math.random() * 0.25;

                this.spawnParticle(sx, sy, sz, svx, svy, svz, sSize, sprayLife, TYPE_SPRAY, 0.7);
              }
            }
          }
        }
      }
    }
  }

  // Emit trailing wake foam & propeller churn from boats / moving bodies
  emitBoatWakeFoam(bowX, bowZ, sternX, sternZ, speed, headingAngle) {
    if (speed < 0.5) return;

    // Stern propeller churn foam
    const sternCount = Math.min(8, Math.floor(speed * 0.9));
    for (let i = 0; i < sternCount; i++) {
      const offsetX = (Math.random() - 0.5) * 1.8;
      const offsetZ = (Math.random() - 0.5) * 1.8;
      const px = sternX + offsetX;
      const pz = sternZ + offsetZ;
      const py = this.waveModel.getHeight(px, pz, performance.now() * 0.001) + 0.05;

      // Backward propeller slipstream velocity
      const slipSpeed = -speed * 0.4;
      const vx = Math.cos(headingAngle) * slipSpeed + (Math.random() - 0.5) * 1.5;
      const vz = Math.sin(headingAngle) * slipSpeed + (Math.random() - 0.5) * 1.5;

      const life = 4.0 + Math.random() * 4.0;
      const size = 0.45 + Math.random() * 0.5;

      this.spawnParticle(px, py, pz, vx, 0, vz, size, life, TYPE_FOAM, 0.95);
    }

    // Bow spray when cutting through water at speed
    if (speed > 5.0) {
      const bowSprayCount = Math.floor(speed * 0.35);
      for (let i = 0; i < bowSprayCount; i++) {
        const side = (Math.random() > 0.5) ? 1.0 : -1.0;
        const flankAngle = headingAngle + (Math.PI * 0.5 * side);
        const sx = bowX + Math.cos(flankAngle) * 1.2;
        const sz = bowZ + Math.sin(flankAngle) * 1.2;
        const sy = this.waveModel.getHeight(sx, sz, performance.now() * 0.001) + 0.2;

        const spraySpeed = speed * 0.6;
        const svx = Math.cos(flankAngle) * spraySpeed + (Math.random() - 0.5) * 2.0;
        const svy = 2.0 + Math.random() * 3.0;
        const svz = Math.sin(flankAngle) * spraySpeed + (Math.random() - 0.5) * 2.0;

        this.spawnParticle(sx, sy, sz, svx, svy, svz, 0.28, 1.2, TYPE_SPRAY, 0.85);
      }
    }
  }

  // Update physics for all active particles and sync GPU instancing
  update(dt, time, focusX, focusZ) {
    const windDx = Math.cos(this.waveModel.windAngle);
    const windDz = Math.sin(this.waveModel.windAngle);
    const windSpeed = this.waveModel.windSpeed;

    const g = PARTICLE_CONFIG.GRAVITY;
    const drag = PARTICLE_CONFIG.DRAG_COEFFICIENT;
    const windShear = PARTICLE_CONFIG.WIND_SHEAR_FACTOR;

    let active = 0;

    // Scan breaking crests to continuously replenish physical foam and spray
    this.detectAndEmitWaveBreaking(focusX, focusZ, time, dt);

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.life[i] <= 0.0) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0.0) {
        this.killParticle(i);
        continue;
      }

      active++;

      const pType = this.type[i];
      let px = this.posX[i];
      let py = this.posY[i];
      let pz = this.posZ[i];

      let vx = this.velX[i];
      let vy = this.velY[i];
      let vz = this.velZ[i];

      if (pType === TYPE_SPRAY) {
        // Airborne Spray / Spindrift Ballistic Physics
        // Relative velocity to wind
        const relVx = vx - (windDx * windSpeed);
        const relVz = vz - (windDz * windSpeed);
        const relSpeed = Math.sqrt(relVx * relVx + vy * vy + relVz * relVz);

        // Aerodynamic drag + gravity
        const dragAccX = -drag * relSpeed * relVx;
        const dragAccY = -drag * relSpeed * vy - g;
        const dragAccZ = -drag * relSpeed * relVz;

        vx += dragAccX * dt;
        vy += dragAccY * dt;
        vz += dragAccZ * dt;

        px += vx * dt;
        py += vy * dt;
        pz += vz * dt;

        // Check impact with dynamic ocean water surface
        const waterHeight = this.waveModel.getHeight(px, pz, time) + this.fluidGrid.sampleHeight(px, pz);
        if (py <= waterHeight + 0.05) {
          // Spray hits water: splash into surface foam bubble!
          py = waterHeight + 0.04;
          this.type[i] = TYPE_FOAM;
          this.life[i] = Math.min(this.life[i], 3.5); // Foam duration
          this.size[i] *= 1.4; // Expand into aerated foam circle
          vx *= 0.3;
          vy = 0.0;
          vz *= 0.3;

          // Tiny disturbance ripple in dynamic fluid grid
          this.fluidGrid.addDisturbance(px, pz, 1.2, 0.15);
        }
      } else {
        // Surface Foam Bubble Physics (rides moving ocean surface & Langmuir streaks)
        // Advected by Stokes drift, wind friction shear, and local orbital velocity
        const surfVx = windDx * (windSpeed * windShear);
        const surfVz = windDz * (windSpeed * windShear);

        vx = (vx * 0.94) + surfVx * 0.06;
        vz = (vz * 0.94) + surfVz * 0.06;

        px += vx * dt;
        pz += vz * dt;

        // Surface foam height is locked directly to the wave elevation
        const waterHeight = this.waveModel.getHeight(px, pz, time) + this.fluidGrid.sampleHeight(px, pz);
        py = waterHeight + 0.04;
      }

      this.posX[i] = px;
      this.posY[i] = py;
      this.posZ[i] = pz;
      this.velX[i] = vx;
      this.velY[i] = vy;
      this.velZ[i] = vz;

      this.rotation[i] += this.rotSpeed[i] * dt;

      // Update GPU instance transformation matrix
      this.dummy.position.set(px, py, pz);
      this.dummy.scale.set(1.0, 1.0, 1.0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Pass lifetime ratio, type, size, and alpha to vertex shader
      const lifeRatio = this.life[i] / this.maxLife[i];
      this.particleDataAttr.setXYZW(i, lifeRatio, pType, this.size[i], this.alpha[i]);
      this.rotationAttr.setX(i, this.rotation[i]);
    }

    this.activeCount = active;

    // Flag GPU buffers for fast upload
    this.mesh.instanceMatrix.needsUpdate = true;
    this.particleDataAttr.needsUpdate = true;
    this.rotationAttr.needsUpdate = true;

    // Update material uniforms
    this.mesh.material.uniforms.uTime.value = time;
    this.mesh.material.uniforms.uBioluminescence.value = this.bioluminescence;
  }

  setSunParameters(sunDir, sunColor, skyColor) {
    this.mesh.material.uniforms.uSunDir.value.copy(sunDir);
    this.mesh.material.uniforms.uSunColor.value.copy(sunColor);
    this.mesh.material.uniforms.uSkyColor.value.copy(skyColor);
  }
}
