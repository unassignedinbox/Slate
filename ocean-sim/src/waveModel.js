// src/waveModel.js
// Non-FFT Multi-Scale Cascaded Trochoidal-Stokes Wave Spectrum & Analytical Hydrodynamics
// Complies strictly with the constraint: NO FFT!

import { PHYSICS } from './constants.js';

export const NUM_WAVES = 32;

export class WaveModel {
  constructor() {
    this.gravity = PHYSICS.GRAVITY;
    this.windSpeed = 12.0;       // m/s (~23 knots, Beaufort 6 strong breeze)
    this.windAngle = Math.PI * 0.25; // 45 degrees
    this.globalAmplitude = 1.0;
    this.globalSteepness = 1.0;
    this.speedMultiplier = 1.0;

    // Arrays storing wave parameters
    this.amplitudes = new Float32Array(NUM_WAVES);
    this.wavelengths = new Float32Array(NUM_WAVES);
    this.frequencies = new Float32Array(NUM_WAVES);
    this.directions = new Float32Array(NUM_WAVES * 2); // [dx, dz] normalized
    this.steepnesses = new Float32Array(NUM_WAVES);
    this.phases = new Float32Array(NUM_WAVES);

    // GLSL uniform packing (vec4: [dx, dz, k, A], vec4: [omega, Q, phi, padding])
    this.waveData0 = new Float32Array(NUM_WAVES * 4); // dx, dz, k, A
    this.waveData1 = new Float32Array(NUM_WAVES * 4); // omega, Q, phi, stokesWeight

    this.rebuildSpectrum();
  }

  setWind(speed, angle) {
    this.windSpeed = Math.max(1.0, speed);
    this.windAngle = angle;
    this.rebuildSpectrum();
  }

  setParameters(amplitude, steepness, speed) {
    this.globalAmplitude = amplitude;
    this.globalSteepness = steepness;
    this.speedMultiplier = speed;
    this.rebuildSpectrum();
  }

  // Synthesize realistic ocean wave spectrum without FFT:
  // Using 4 physical regimes: Primary Swells, Cross Swells, Wind Gravity Chop, Capillary Waves
  rebuildSpectrum() {
    const g = this.gravity;
    const wAngle = this.windAngle;
    const wSpeed = this.windSpeed;

    // Golden ratio / irrational factors to ensure waves NEVER repeat periodically
    const phiFactor = 1.61803398875;
    const piE = Math.PI * 2.71828182845;

    let index = 0;

    // 1. Primary Ocean Swells (6 waves): long wavelengths, high energy, dispersion dominated
    // Wavelengths from 70m to 180m depending on wind speed
    const swellBaseLambda = Math.min(220, Math.max(50, 4.0 * wSpeed * (1.0 + 0.1 * wSpeed)));
    for (let i = 0; i < 6; i++) {
      const lambda = swellBaseLambda * Math.pow(0.82, i) * (0.95 + 0.1 * ((i * phiFactor) % 1));
      const k = (2.0 * Math.PI) / lambda;
      const omega = Math.sqrt(g * k);
      
      // Slight directional spread around wind (+/- 12 degrees)
      const spread = (Math.sin(i * 1.7) * 0.22);
      const theta = wAngle + spread;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);

      // Phillips/JONSWAP energy distribution shape without FFT
      const ampBase = (0.35 * Math.pow(wSpeed / 12.0, 1.6)) / Math.sqrt(k);
      const A = Math.max(0.1, ampBase * Math.exp(-0.2 * i)) * this.globalAmplitude * 0.45;
      const Q = (0.55 / (k * A * Math.sqrt(NUM_WAVES))) * this.globalSteepness;
      const phase = (i * piE) % (2.0 * Math.PI);

      this.assignWave(index++, dx, dz, k, A, omega, Q, phase, 0.4);
    }

    // 2. Cross Swell (6 waves): angled from secondary weather system, diamond interference
    const crossBaseLambda = swellBaseLambda * 0.65;
    const crossAngle = wAngle + (Math.PI * 0.28); // ~50 degrees offset
    for (let i = 0; i < 6; i++) {
      const lambda = crossBaseLambda * Math.pow(0.80, i) * (0.92 + 0.15 * ((i * 1.3) % 1));
      const k = (2.0 * Math.PI) / lambda;
      const omega = Math.sqrt(g * k);

      const spread = (Math.cos(i * 2.1) * 0.35);
      const theta = crossAngle + spread;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);

      const A = (0.22 * Math.pow(wSpeed / 12.0, 1.4) / Math.sqrt(k)) * Math.exp(-0.25 * i) * this.globalAmplitude * 0.35;
      const Q = (0.6 / (k * A * Math.sqrt(NUM_WAVES))) * this.globalSteepness;
      const phase = ((i + 7) * piE) % (2.0 * Math.PI);

      this.assignWave(index++, dx, dz, k, A, omega, Q, phase, 0.35);
    }

    // 3. Wind Gravity Chop (12 waves): steep, tightly aligned with wind, breaks frequently
    const chopBaseLambda = Math.max(6.0, swellBaseLambda * 0.22);
    for (let i = 0; i < 12; i++) {
      const lambda = chopBaseLambda * Math.pow(0.78, i) * (0.9 + 0.2 * ((i * 2.7) % 1));
      const k = (2.0 * Math.PI) / lambda;
      // Capillary-gravity dispersion
      const omega = Math.sqrt(g * k + (0.000074 / 1025.0) * Math.pow(k, 3));

      // Directional spreading cos^s(theta)
      const spread = (Math.sin(i * 3.4) * 0.65) * Math.pow(0.9, i);
      const theta = wAngle + spread;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);

      const A = (0.15 * Math.pow(wSpeed / 12.0, 1.2) / Math.pow(k, 0.65)) * Math.exp(-0.18 * i) * this.globalAmplitude * 0.25;
      // Higher steepness for wind chop
      const Q = (0.75 / (k * A * Math.sqrt(NUM_WAVES))) * this.globalSteepness;
      const phase = ((i + 19) * piE) % (2.0 * Math.PI);

      this.assignWave(index++, dx, dz, k, A, omega, Q, phase, 0.5);
    }

    // 4. Capillary Ripples (8 waves): high frequency surface geometry
    const rippleBaseLambda = 2.8;
    for (let i = 0; i < 8; i++) {
      const lambda = rippleBaseLambda * Math.pow(0.72, i) * (0.85 + 0.3 * ((i * 1.9) % 1));
      const k = (2.0 * Math.PI) / lambda;
      const omega = Math.sqrt(g * k + (0.000074 / 1025.0) * Math.pow(k, 3));

      const spread = Math.sin(i * 4.1) * 1.1;
      const theta = wAngle + spread;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);

      const A = (0.04 * (wSpeed / 12.0) / Math.pow(k, 0.8)) * Math.exp(-0.2 * i) * this.globalAmplitude * 0.15;
      const Q = (0.8 / (k * A * Math.sqrt(NUM_WAVES))) * this.globalSteepness;
      const phase = ((i + 37) * piE) % (2.0 * Math.PI);

      this.assignWave(index++, dx, dz, k, A, omega, Q, phase, 0.6);
    }
  }

  assignWave(i, dx, dz, k, A, omega, Q, phi, stokesWeight) {
    this.amplitudes[i] = A;
    this.wavelengths[i] = (2.0 * Math.PI) / k;
    this.frequencies[i] = omega;
    this.directions[i * 2 + 0] = dx;
    this.directions[i * 2 + 1] = dz;
    // Bound steepness to prevent self-intersection loops
    const safeQ = Math.min(1.2, Math.max(0.05, Q));
    this.steepnesses[i] = safeQ;
    this.phases[i] = phi;

    // Pack into Float32 uniform arrays for GLSL
    const idx = i * 4;
    this.waveData0[idx + 0] = dx;
    this.waveData0[idx + 1] = dz;
    this.waveData0[idx + 2] = k;
    this.waveData0[idx + 3] = A;

    this.waveData1[idx + 0] = omega * this.speedMultiplier;
    this.waveData1[idx + 1] = safeQ;
    this.waveData1[idx + 2] = phi;
    this.waveData1[idx + 3] = stokesWeight;
  }

  // Exact CPU evaluation of wave displacement, normal, velocity, and wave breaking criteria
  // at any arbitrary world coordinate (x, z) and time t
  sampleOcean(x, z, time, outResult = {}) {
    const t = time * this.speedMultiplier;
    let dispX = 0.0;
    let dispY = 0.0;
    let dispZ = 0.0;

    let normX = 0.0;
    let normY = 1.0;
    let normZ = 0.0;

    let velX = 0.0;
    let velY = 0.0;
    let velZ = 0.0;

    // For Jacobian determinant area compression (breaking detection)
    let dxdx = 0.0;
    let dxdz = 0.0;
    let dzdx = 0.0;
    let dzdz = 0.0;

    // Vertical downward acceleration
    let accelY = 0.0;

    for (let i = 0; i < NUM_WAVES; i++) {
      const dx = this.directions[i * 2 + 0];
      const dz = this.directions[i * 2 + 1];
      const k = (2.0 * Math.PI) / this.wavelengths[i];
      const A = this.amplitudes[i];
      const omega = this.frequencies[i] * this.speedMultiplier;
      const Q = this.steepnesses[i];
      const phi = this.phases[i];

      const dot = dx * x + dz * z;
      const phase = k * dot - omega * t + phi;
      const sinP = Math.sin(phase);
      const cosP = Math.cos(phase);

      // Stokes 2nd-order harmonic wave peaking for razor-sharp crests
      const stokesSin2 = Math.sin(2.0 * phase);
      const stokesCos2 = Math.cos(2.0 * phase);
      const kA = k * A;

      // Horizontal and vertical trochoidal displacements
      dispX -= Q * A * dx * sinP;
      dispZ -= Q * A * dz * sinP;
      dispY += A * (cosP + 0.5 * kA * stokesCos2);

      // Orbital velocities (Eulerian fluid velocity)
      velX += omega * A * dx * cosP;
      velZ += omega * A * dz * cosP;
      velY += omega * A * sinP;

      // Vertical downward acceleration: a_y = -omega^2 * A * cos(phase)
      accelY -= omega * omega * A * cosP;

      // Partial derivatives for analytical normals
      normX -= dx * k * A * sinP;
      normZ -= dz * k * A * sinP;
      normY -= Q * k * A * cosP;

      // Jacobian derivatives
      dxdx -= Q * dx * dx * k * A * cosP;
      dxdz -= Q * dx * dz * k * A * cosP;
      dzdx -= Q * dz * dx * k * A * cosP;
      dzdz -= Q * dz * dz * k * A * cosP;
    }

    // Normalize normal vector
    const invLen = 1.0 / Math.sqrt(normX * normX + normY * normY + normZ * normZ);
    normX *= invLen;
    normY *= invLen;
    normZ *= invLen;

    // Area compression Jacobian determinant: J = (1 + dxdx)*(1 + dzdz) - (dxdz)*(dzdx)
    const J = (1.0 + dxdx) * (1.0 + dzdz) - (dxdz * dzdx);

    // Wave breaking criterion:
    // 1. Horizontal area compression (J < threshold, typically 0.3)
    // 2. Downward acceleration exceeds limit (accelY < -0.32 * g)
    // 3. Peak crest height above mean water level
    const isBreaking = (J < 0.32 || accelY < -0.35 * PHYSICS.GRAVITY) && dispY > 0.4;
    const breakSeverity = Math.max(0.0, Math.min(1.0, (0.35 - J) * 2.5 + Math.max(0.0, (-accelY / PHYSICS.GRAVITY - 0.35))));

    outResult.x = x + dispX;
    outResult.y = dispY;
    outResult.z = z + dispZ;
    outResult.dispX = dispX;
    outResult.dispY = dispY;
    outResult.dispZ = dispZ;
    outResult.normalX = normX;
    outResult.normalY = normY;
    outResult.normalZ = normZ;
    outResult.velX = velX;
    outResult.velY = velY;
    outResult.velZ = velZ;
    outResult.jacobian = J;
    outResult.accelY = accelY;
    outResult.isBreaking = isBreaking;
    outResult.breakSeverity = breakSeverity;

    return outResult;
  }

  // Fast height-only query (essential for buoyant hull sampling and particle clamping)
  getHeight(x, z, time) {
    const t = time * this.speedMultiplier;
    let dispY = 0.0;
    for (let i = 0; i < NUM_WAVES; i++) {
      const dx = this.directions[i * 2 + 0];
      const dz = this.directions[i * 2 + 1];
      const k = (2.0 * Math.PI) / this.wavelengths[i];
      const A = this.amplitudes[i];
      const omega = this.frequencies[i] * this.speedMultiplier;
      const phi = this.phases[i];

      const dot = dx * x + dz * z;
      const phase = k * dot - omega * t + phi;
      dispY += A * (Math.cos(phase) + 0.5 * k * A * Math.cos(2.0 * phase));
    }
    return dispY;
  }

  // GLSL snippet providing the exact same math in the GPU vertex shader!
  static getGLSLWaveFunction() {
    return `
      #define NUM_WAVES 32

      uniform vec4 uWaveData0[NUM_WAVES]; // [dx, dz, k, A]
      uniform vec4 uWaveData1[NUM_WAVES]; // [omega, Q, phi, stokesWeight]

      struct WaveResult {
        vec3 displacement;
        vec3 normal;
        vec3 velocity;
        float jacobian;
        float crestFactor;
      };

      WaveResult evaluateWaves(vec2 pos, float time) {
        vec3 disp = vec3(0.0);
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 vel = vec3(0.0);

        float dxdx = 0.0;
        float dxdz = 0.0;
        float dzdx = 0.0;
        float dzdz = 0.0;
        float crestAcc = 0.0;

        for (int i = 0; i < NUM_WAVES; i++) {
          vec4 w0 = uWaveData0[i];
          vec4 w1 = uWaveData1[i];

          vec2 dir = w0.xy;
          float k = w0.z;
          float A = w0.w;

          float omega = w1.x;
          float Q = w1.y;
          float phi = w1.z;
          float stokesWeight = w1.w;

          float dotP = dot(dir, pos);
          float phase = k * dotP - omega * time + phi;
          float sinP = sin(phase);
          float cosP = cos(phase);

          // Non-linear Stokes 2nd-order harmonic wave peaking
          float cos2P = cos(2.0 * phase);
          float stokesPeaking = 0.5 * k * A * cos2P * stokesWeight;

          // Trochoidal displacements (sharp crests, broad flat troughs)
          disp.x -= Q * A * dir.x * sinP;
          disp.z -= Q * A * dir.y * sinP;
          disp.y += A * (cosP + stokesPeaking);

          // Analytical partial derivatives for exact geometric normals
          n.x -= dir.x * k * A * sinP;
          n.z -= dir.y * k * A * sinP;
          n.y -= Q * k * A * cosP;

          // Orbital velocity
          vel.x += omega * A * dir.x * cosP;
          vel.z += omega * A * dir.y * cosP;
          vel.y += omega * A * sinP;

          // Area compression Jacobian derivatives
          dxdx -= Q * dir.x * dir.x * k * A * cosP;
          dxdz -= Q * dir.x * dir.y * k * A * cosP;
          dzdx -= Q * dir.y * dir.x * k * A * cosP;
          dzdz -= Q * dir.y * dir.y * k * A * cosP;

          // Downward crest curvature
          crestAcc += A * cosP;
        }

        n = normalize(n);
        float J = (1.0 + dxdx) * (1.0 + dzdz) - (dxdz * dzdx);

        WaveResult res;
        res.displacement = disp;
        res.normal = n;
        res.velocity = vel;
        res.jacobian = J;
        res.crestFactor = max(0.0, crestAcc);
        return res;
      }
    `;
  }
}
