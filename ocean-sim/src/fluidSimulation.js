// src/fluidSimulation.js
// Real-time 2D Eulerian Dynamic Fluid Heightfield Simulation (Shallow Water / Wave PDE)
// Simulates interactive boat wakes, object splashes, and fluid disturbance ripples

import * as THREE from 'three';

export class DynamicFluidGrid {
  constructor(size = 192, worldRadius = 120.0) {
    this.size = size;
    this.worldRadius = worldRadius; // World extent: [-worldRadius, worldRadius]
    this.worldSize = worldRadius * 2.0;
    this.cellSize = this.worldSize / size;

    // Simulation ping-pong state
    this.buffer0 = new Float32Array(size * size);
    this.buffer1 = new Float32Array(size * size);
    this.current = this.buffer0;
    this.previous = this.buffer1;

    // Texture for GPU shader sampling
    // Encoded into RGBA: R = height, G = normX, B = normZ, A = velocity
    this.textureData = new Uint8Array(size * size * 4);
    this.fluidTexture = new THREE.DataTexture(
      this.textureData,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.fluidTexture.minFilter = THREE.LinearFilter;
    this.fluidTexture.magFilter = THREE.LinearFilter;
    this.fluidTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.fluidTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.fluidTexture.needsUpdate = true;

    // Simulation tuning parameters
    this.waveSpeed = 0.48;     // c^2 * dt^2 / dx^2 (CFL stability limit < 0.5)
    this.damping = 0.988;      // Viscous decay
    this.heightScale = 2.5;    // Visual amplitude scaling in meters

    // Tracking world center (follows boat / active area)
    this.worldCenter = new THREE.Vector2(0, 0);
  }

  setCenter(x, z) {
    this.worldCenter.set(x, z);
  }

  // Inject a radial splash / disturbance at world coordinates (wx, wz)
  addDisturbance(wx, wz, radiusWorld, intensity) {
    const minX = this.worldCenter.x - this.worldRadius;
    const minZ = this.worldCenter.y - this.worldRadius;

    const gx = Math.floor(((wx - minX) / this.worldSize) * this.size);
    const gz = Math.floor(((wz - minZ) / this.worldSize) * this.size);
    const radCells = Math.max(1, Math.floor((radiusWorld / this.worldSize) * this.size));

    const s = this.size;
    for (let dy = -radCells; dy <= radCells; dy++) {
      const cy = gz + dy;
      if (cy < 1 || cy >= s - 1) continue;
      for (let dx = -radCells; dx <= radCells; dx++) {
        const cx = gx + dx;
        if (cx < 1 || cx >= s - 1) continue;

        const distSq = dx * dx + dy * dy;
        if (distSq <= radCells * radCells) {
          const factor = Math.exp(-distSq / (radCells * radCells * 0.45));
          const idx = cy * s + cx;
          this.current[idx] += intensity * factor;
          // Clamp to avoid numerical explosions
          this.current[idx] = Math.max(-4.0, Math.min(4.0, this.current[idx]));
        }
      }
    }
  }

  // Inject a moving directional hull / propeller wake
  addBoatWake(bowX, bowZ, sternX, sternZ, speed, headingAngle) {
    // Bow push disturbance (upward mound of water pushed by bow)
    const bowPush = Math.min(1.8, speed * 0.12);
    this.addDisturbance(bowX, bowZ, 2.2, bowPush);

    // Twin stern propeller turbulence & suction depression
    const sternDepression = -Math.min(1.4, speed * 0.14);
    this.addDisturbance(sternX, sternZ, 2.8, sternDepression);

    // Flank Kelvin wake ripples
    if (speed > 2.0) {
      const perpX = -Math.sin(headingAngle) * 2.5;
      const perpZ = Math.cos(headingAngle) * 2.5;
      this.addDisturbance(bowX + perpX, bowZ + perpZ, 1.8, bowPush * 0.5);
      this.addDisturbance(bowX - perpX, bowZ - perpZ, 1.8, bowPush * 0.5);
    }
  }

  // Step the 2D Wave PDE: Leapfrog / Verlet numerical solver
  step(delta) {
    const s = this.size;
    const c = this.current;
    const p = this.previous;
    const speedSq = this.waveSpeed;
    const damp = this.damping;

    // Ping-pong buffer swap
    const next = p; // reuse previous buffer as next buffer

    // Discrete 2D wave equation finite difference operator
    for (let y = 1; y < s - 1; y++) {
      const row = y * s;
      const rowUp = (y - 1) * s;
      const rowDown = (y + 1) * s;

      for (let x = 1; x < s - 1; x++) {
        const idx = row + x;
        const laplacian =
          c[idx - 1] +
          c[idx + 1] +
          c[rowUp + x] +
          c[rowDown + x] -
          4.0 * c[idx];

        // Wave PDE time integration
        let val = (2.0 * c[idx] - next[idx] + speedSq * laplacian) * damp;

        // Numerical threshold cut to avoid subnormal floats
        if (Math.abs(val) < 0.0001) val = 0.0;

        next[idx] = val;
      }
    }

    // Boundary damping / non-reflective Dirichlet
    for (let i = 0; i < s; i++) {
      next[i] = 0.0;
      next[(s - 1) * s + i] = 0.0;
      next[i * s] = 0.0;
      next[i * s + (s - 1)] = 0.0;
    }

    // Swap buffers
    this.previous = this.current;
    this.current = next;

    // Encode into texture for GPU sampling
    this.updateTexture();
  }

  // Encode heights and finite-difference surface slopes into RGBA texture
  updateTexture() {
    const s = this.size;
    const c = this.current;
    const d = this.textureData;

    let pIdx = 0;
    for (let y = 0; y < s; y++) {
      const row = y * s;
      const rowUp = Math.max(0, y - 1) * s;
      const rowDown = Math.min(s - 1, y + 1) * s;

      for (let x = 0; x < s; x++) {
        const idx = row + x;
        const xLeft = row + Math.max(0, x - 1);
        const xRight = row + Math.min(s - 1, x + 1);

        const h = c[idx];
        // Slopes for normal perturbation
        const dhdx = (c[xRight] - c[xLeft]) * 0.5;
        const dhdz = (c[rowDown + x] - c[rowUp + x]) * 0.5;

        // Map height to [0, 255] with neutral 128
        const hNorm = Math.floor(Math.max(0, Math.min(255, 128 + h * 60.0)));
        // Map slopes to [0, 255] with neutral 128
        const nxNorm = Math.floor(Math.max(0, Math.min(255, 128 + dhdx * 120.0)));
        const nzNorm = Math.floor(Math.max(0, Math.min(255, 128 + dhdz * 120.0)));

        d[pIdx + 0] = hNorm;
        d[pIdx + 1] = nxNorm;
        d[pIdx + 2] = nzNorm;
        d[pIdx + 3] = 255;

        pIdx += 4;
      }
    }

    this.fluidTexture.needsUpdate = true;
  }

  // Sample dynamic fluid height on CPU at arbitrary world coordinates
  sampleHeight(wx, wz) {
    const minX = this.worldCenter.x - this.worldRadius;
    const minZ = this.worldCenter.y - this.worldRadius;

    const u = (wx - minX) / this.worldSize;
    const v = (wz - minZ) / this.worldSize;

    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0.0;

    const gx = u * (this.size - 1);
    const gz = v * (this.size - 1);

    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(this.size - 1, x0 + 1);
    const z1 = Math.min(this.size - 1, z0 + 1);

    const fx = gx - x0;
    const fz = gz - z0;

    const s = this.size;
    const h00 = this.current[z0 * s + x0];
    const h10 = this.current[z0 * s + x1];
    const h01 = this.current[z1 * s + x0];
    const h11 = this.current[z1 * s + x1];

    const top = h00 * (1 - fx) + h10 * fx;
    const bot = h01 * (1 - fx) + h11 * fx;

    return (top * (1 - fz) + bot * fz) * (this.heightScale * 0.4);
  }
}
