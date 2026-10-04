/**
 * Sculpted 3D Human Body / Couture Mannequin Avatar with Articulated Pose Animation,
 * 16-Capsule Analytical SDF Collision Primitives for WebGPU Compute Shaders,
 * and Custom Wavefront .OBJ Avatar Import.
 */

export const POSE_MODES = [
  { id: 0, label: "Studio contrapposto" },
  { id: 1, label: "Runway catwalk" },
  { id: 2, label: "Couture twirl" },
  { id: 3, label: "Breeze sway" },
];

export class HumanAvatar {
  constructor() {
    this.capsuleCount = 16;
    // 16 capsules * 12 floats (vec4 pA_rA, vec4 pB_rB, vec4 vel_pad)
    this.capsuleData = new Float32Array(this.capsuleCount * 12);
    this.prevCapsuleCenters = new Float32Array(this.capsuleCount * 3);
    this.hasPrevCapsules = false;

    // Avatar root motion state for upper-bodice / strap attachment in WGSL
    this.motionState = {
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      yaw: 0,
      yawVelocity: 0,
      hipSwingX: 0,
      shoulderTilt: 0,
    };

    this.twirlImpulse = 0; // Remaining twirl impulse timer
    this.buildProceduralBody();
  }

  triggerTwirl() {
    this.twirlImpulse = 2.6;
  }

  /**
   * Constructs a smooth, anatomically proportioned 3D female mannequin mesh
   * (torso + head + neck + bust + waist + pelvis + articulated legs + arms + studio plinth).
   */
  buildProceduralBody() {
    const positions = [];
    const normals = [];
    const boneIds = []; // 0=torso/head, 1=leftLeg, 2=rightLeg, 3=leftArm, 4=rightArm, 5=plinth
    const boneWeights = []; // vertical parameter along limb [0..1]
    const indices = [];

    const addRingLoft = (rings, boneId) => {
      const baseVertex = positions.length / 3;
      const numRings = rings.length;
      const segs = rings[0].points.length;

      for (let r = 0; r < numRings; r++) {
        const ring = rings[r];
        for (let s = 0; s < segs; s++) {
          const p = ring.points[s];
          positions.push(p[0], p[1], p[2]);
          normals.push(0, 1, 0);
          boneIds.push(boneId);
          boneWeights.push(ring.weight ?? 0);
        }
      }

      for (let r = 0; r < numRings - 1; r++) {
        for (let s = 0; s < segs; s++) {
          const nextS = (s + 1) % segs;
          const i00 = baseVertex + r * segs + s;
          const i10 = baseVertex + r * segs + nextS;
          const i01 = baseVertex + (r + 1) * segs + s;
          const i11 = baseVertex + (r + 1) * segs + nextS;
          indices.push(i00, i01, i11);
          indices.push(i00, i11, i10);
        }
      }
    };

    // 1. Torso + Pelvis + Neck + Head Loft (y from 0.79m to 1.72m)
    const torsoRings = [];
    const torsoSegs = 40;
    const torsoSteps = 54;
    for (let i = 0; i <= torsoSteps; i++) {
      const t = i / torsoSteps;
      const y = 0.79 + t * (1.72 - 0.79);

      // Smooth anatomical profile rx (half-width) and rz (half-depth)
      let rx = 0.14;
      let rz = 0.10;
      let centerZ = 0.0;

      if (y < 0.88) {
        // Lower pelvis saddle to hip crest
        const u = (y - 0.79) / 0.09;
        const s = Math.sin(u * Math.PI * 0.5);
        rx = 0.105 + 0.068 * s;
        rz = 0.088 + 0.032 * s;
        centerZ = -0.008;
      } else if (y < 1.04) {
        // Hips (0.88) to natural waist cinch (1.04)
        const u = (y - 0.88) / 0.16;
        const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
        rx = 0.173 * (1 - smooth) + 0.120 * smooth;
        rz = 0.120 * (1 - smooth) + 0.092 * smooth;
        centerZ = -0.008 * (1 - smooth);
      } else if (y < 1.30) {
        // Waist (1.04) through ribcage & bust (1.24) to upper chest (1.30)
        const u = (y - 1.04) / 0.26;
        const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
        rx = 0.120 + 0.032 * smooth;
        rz = 0.092 + 0.020 * Math.sin(u * Math.PI);
        centerZ = 0.006 * Math.sin(u * Math.PI);
      } else if (y < 1.41) {
        // Upper chest (1.30) to broad deltoid/clavicle shoulders (1.38) then taper to neck base (1.41)
        const u = (y - 1.30) / 0.11;
        const shoulderPeak = Math.exp(-Math.pow((y - 1.375) / 0.032, 2));
        const neckTaper = u > 0.65 ? (u - 0.65) / 0.35 : 0;
        rx = (0.152 + 0.040 * shoulderPeak) * (1 - 0.68 * neckTaper);
        rz = (0.100 + 0.008 * shoulderPeak) * (1 - 0.46 * neckTaper);
        centerZ = -0.004 * u;
      } else if (y < 1.52) {
        // Slender neck column
        const u = (y - 1.41) / 0.11;
        rx = 0.054 - 0.004 * Math.sin(u * Math.PI);
        rz = 0.056 - 0.003 * Math.sin(u * Math.PI);
        centerZ = 0.004 * u;
      } else {
        // Sculpted head (1.52 to 1.72)
        const u = (y - 1.52) / 0.20;
        const sphereProfile = Math.sqrt(Math.max(0.002, 1 - Math.pow(u * 2 - 1, 2)));
        const jawTaper = u < 0.45 ? 0.78 + 0.22 * (u / 0.45) : 1.0;
        rx = 0.076 * sphereProfile * jawTaper;
        rz = 0.090 * sphereProfile * (u < 0.4 ? 0.88 : 1.0);
        centerZ = 0.010 * (1 - u * 0.6);
      }

      const points = [];
      for (let s = 0; s < torsoSegs; s++) {
        const angle = (s / torsoSegs) * Math.PI * 2;
        const cosA = Math.cos(angle); // +X right, -X left
        const sinA = Math.sin(angle); // +Z front, -Z back

        let x = cosA * rx;
        let z = centerZ + sinA * rz;

        // Sculpted anterior bust contour around y = 1.235m, z > 0
        if (y > 1.12 && y < 1.34 && sinA > 0) {
          const bustY = Math.exp(-Math.pow((y - 1.235) / 0.058, 2));
          const leftLobe = Math.exp(-Math.pow((x + 0.074) / 0.056, 2));
          const rightLobe = Math.exp(-Math.pow((x - 0.074) / 0.056, 2));
          const bustBridge = 0.22 * Math.exp(-Math.pow(x / 0.05, 2));
          const bustProj = 0.044 * bustY * Math.pow(sinA, 1.3) * (leftLobe + rightLobe + bustBridge);
          z += bustProj;
          x *= 1 + 0.06 * bustY;
        }

        // Sculpted posterior gluteal contour around y = 0.88m, z < 0
        if (y > 0.80 && y < 0.98 && sinA < 0) {
          const gluteY = Math.exp(-Math.pow((y - 0.885) / 0.055, 2));
          const gluteLobe =
            Math.exp(-Math.pow((x + 0.065) / 0.058, 2)) +
            Math.exp(-Math.pow((x - 0.065) / 0.058, 2));
          z -= 0.032 * gluteY * Math.pow(-sinA, 1.4) * gluteLobe;
        }

        // Subtle spinal groove along back
        if (y > 0.96 && y < 1.36 && sinA < -0.7) {
          const groove = Math.exp(-Math.pow(x / 0.025, 2));
          z += 0.007 * groove * (-sinA - 0.7);
        }

        points.push([x, y, z]);
      }
      torsoRings.push({ points, weight: t });
    }
    addRingLoft(torsoRings, 0);

    // 2. Left & Right Articulated Legs (y from 0.85m hip down to 0.0m foot)
    const buildLeg = (side, boneId) => {
      const legRings = [];
      const segs = 22;
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps; // 0 = hip (0.85m), 1 = sole (0.01m)
        const y = 0.85 * (1 - t) + 0.01 * t;

        // Lateral hip-to-ankle centerline
        const hipX = side * 0.094;
        const kneeX = side * 0.082;
        const ankleX = side * 0.076;
        const cx = t < 0.5 ? hipX * (1 - t * 2) + kneeX * (t * 2) : kneeX * (1 - (t - 0.5) * 2) + ankleX * ((t - 0.5) * 2);

        // Anatomical leg radius profile (thigh -> knee -> calf -> ankle -> foot)
        let rx = 0.06;
        let rz = 0.06;
        let cz = 0.0;
        if (y > 0.48) {
          // Thigh to knee
          const u = (0.85 - y) / (0.85 - 0.48);
          rx = 0.082 * (1 - u) + 0.053 * u;
          rz = 0.086 * (1 - u) + 0.055 * u;
        } else if (y > 0.09) {
          // Knee through gastrocnemius calf muscle to ankle
          const u = (0.48 - y) / (0.48 - 0.09);
          const calfBulge = Math.exp(-Math.pow((y - 0.33) / 0.085, 2));
          rx = 0.053 * (1 - u) + 0.035 * u + 0.011 * calfBulge;
          rz = 0.055 * (1 - u) + 0.038 * u + 0.016 * calfBulge;
          cz = -0.009 * calfBulge;
        } else {
          // Sculpted foot arch & toe box
          const u = (0.09 - y) / 0.08;
          const footCap = Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5);
          rx = (0.036 + 0.008 * footCap) * (u > 0.92 ? 0.25 : 1.0);
          rz = (0.042 + 0.055 * footCap) * (u > 0.92 ? 0.25 : 1.0);
          cz = 0.038 * footCap;
        }

        const points = [];
        for (let s = 0; s < segs; s++) {
          const angle = (s / segs) * Math.PI * 2;
          points.push([
            cx + Math.cos(angle) * rx,
            y,
            cz + Math.sin(angle) * rz,
          ]);
        }
        legRings.push({ points, weight: t });
      }
      addRingLoft(legRings, boneId);
    };
    buildLeg(-1, 1); // Left leg
    buildLeg(1, 2);  // Right leg

    // 3. Left & Right Articulated Arms (graceful A-pose abduction away from dress waist/skirt)
    const buildArm = (side, boneId) => {
      const armRings = [];
      const segs = 18;
      const steps = 22;
      const shoulder = [side * 0.178, 1.375, -0.008];
      const elbow = [side * 0.255, 1.115, -0.022];
      const wrist = [side * 0.315, 0.875, 0.018];
      const fingertips = [side * 0.332, 0.775, 0.032];

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let cx, cy, cz, r;
        if (t < 0.45) {
          const u = t / 0.45;
          cx = shoulder[0] * (1 - u) + elbow[0] * u;
          cy = shoulder[1] * (1 - u) + elbow[1] * u;
          cz = shoulder[2] * (1 - u) + elbow[2] * u;
          r = 0.048 * (1 - u) + 0.037 * u;
        } else if (t < 0.84) {
          const u = (t - 0.45) / 0.39;
          cx = elbow[0] * (1 - u) + wrist[0] * u;
          cy = elbow[1] * (1 - u) + wrist[1] * u;
          cz = elbow[2] * (1 - u) + wrist[2] * u;
          const forearmCurve = Math.sin(u * Math.PI) * 0.005;
          r = 0.037 * (1 - u) + 0.026 * u + forearmCurve;
        } else {
          const u = (t - 0.84) / 0.16;
          cx = wrist[0] * (1 - u) + fingertips[0] * u;
          cy = wrist[1] * (1 - u) + fingertips[1] * u;
          cz = wrist[2] * (1 - u) + fingertips[2] * u;
          r = 0.027 * (1 - u * 0.75);
        }

        const points = [];
        for (let s = 0; s < segs; s++) {
          const angle = (s / segs) * Math.PI * 2;
          // Frame perpendicular to arm direction
          const nx = Math.cos(angle) * r;
          const nz = Math.sin(angle) * r;
          points.push([cx + nx, cy - side * nx * 0.24, cz + nz]);
        }
        armRings.push({ points, weight: t });
      }
      addRingLoft(armRings, boneId);
    };
    buildArm(-1, 3); // Left arm
    buildArm(1, 4);  // Right arm

    // 4. Studio Runway Pedestal Plinth (y from -0.04m to 0.005m)
    const plinthRings = [
      { radius: 0.001, y: 0.005 },
      { radius: 0.44, y: 0.005 },
      { radius: 0.46, y: -0.005 },
      { radius: 0.46, y: -0.038 },
      { radius: 0.001, y: -0.038 },
    ].map(({ radius, y }) => {
      const pts = [];
      const segs = 36;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        pts.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
      }
      return { points: pts, weight: 0 };
    });
    addRingLoft(plinthRings, 5);

    this.vertexCount = positions.length / 3;
    this.indexCount = indices.length;
    this.basePositions = new Float32Array(positions);
    this.positions = new Float32Array(positions);
    this.normals = new Float32Array(normals);
    this.boneIds = new Uint8Array(boneIds);
    this.boneWeights = new Float32Array(boneWeights);
    this.indices = new Uint32Array(indices);
    // Interleaved [px, py, pz, nx, ny, nz] for GPU vertex upload
    this.interleaved = new Float32Array(this.vertexCount * 6);

    this.computeBaseNormals();
    this.baseNormals = new Float32Array(this.normals);
    this.evaluatePose(0, 0.016, {});
  }

  computeBaseNormals() {
    this.normals.fill(0);
    const pos = this.basePositions;
    const ind = this.indices;
    for (let i = 0; i < ind.length; i += 3) {
      const i0 = ind[i] * 3;
      const i1 = ind[i + 1] * 3;
      const i2 = ind[i + 2] * 3;
      const ax = pos[i1] - pos[i0];
      const ay = pos[i1 + 1] - pos[i0 + 1];
      const az = pos[i1 + 2] - pos[i0 + 2];
      const bx = pos[i2] - pos[i0];
      const by = pos[i2 + 1] - pos[i0 + 1];
      const bz = pos[i2 + 2] - pos[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      this.normals[i0] += nx;
      this.normals[i0 + 1] += ny;
      this.normals[i0 + 2] += nz;
      this.normals[i1] += nx;
      this.normals[i1 + 1] += ny;
      this.normals[i1 + 2] += nz;
      this.normals[i2] += nx;
      this.normals[i2 + 1] += ny;
      this.normals[i2 + 2] += nz;
    }
    for (let v = 0; v < this.vertexCount; v++) {
      const j = v * 3;
      const len = Math.hypot(this.normals[j], this.normals[j + 1], this.normals[j + 2]) || 1;
      this.normals[j] /= len;
      this.normals[j + 1] /= len;
      this.normals[j + 2] /= len;
    }
  }

  /**
   * Evaluates the articulated pose at `time` (seconds) and updates:
   * 1. `this.interleaved` (vertex positions + normals for GPU rendering)
   * 2. `this.capsuleData` (16 world-space anatomical capsules + velocities for WebGPU cloth collision)
   * 3. `this.motionState` (upper-body transform for dress shoulder/bodice pins)
   */
  evaluatePose(time, dt = 0.016, params = {}) {
    const poseMode = params.avatarPose ?? 0;
    const motionSpeed = params.avatarMotionSpeed ?? 1.0;
    const t = time * motionSpeed;

    if (this.twirlImpulse > 0) {
      this.twirlImpulse = Math.max(0, this.twirlImpulse - dt);
    }

    let yaw = 0;
    let hipSwingX = 0;
    let hipBobY = 0;
    let legSwing = 0;
    let armSwing = 0;
    let torsoSwayX = 0;

    // Impulse twirl spin smoothly adds 1 full revolution
    const twirlProgress = this.twirlImpulse > 0 ? 1 - this.twirlImpulse / 2.6 : 0;
    const impulseYaw =
      this.twirlImpulse > 0
        ? Math.PI * 2 * (0.5 - 0.5 * Math.cos(twirlProgress * Math.PI))
        : 0;

    if (poseMode === 0) {
      // Studio contrapposto: gentle breathing & natural weight shift
      hipSwingX = Math.sin(t * 1.3) * 0.014;
      hipBobY = Math.sin(t * 2.6) * 0.003;
      torsoSwayX = -Math.sin(t * 1.3) * 0.008;
      armSwing = Math.sin(t * 1.3) * 0.04;
      yaw = impulseYaw;
    } else if (poseMode === 1) {
      // Runway catwalk stride
      const walkFreq = 3.2;
      legSwing = Math.sin(t * walkFreq) * 0.34;
      hipSwingX = Math.cos(t * walkFreq) * 0.034;
      hipBobY = Math.abs(Math.sin(t * walkFreq)) * 0.014 - 0.007;
      torsoSwayX = -Math.cos(t * walkFreq) * 0.018;
      armSwing = -Math.sin(t * walkFreq) * 0.22;
      yaw = impulseYaw + Math.sin(t * walkFreq) * 0.07;
    } else if (poseMode === 2) {
      // Couture twirl
      yaw = t * 1.85 + impulseYaw;
      hipSwingX = Math.sin(t * 2.0) * 0.018;
      hipBobY = Math.sin(t * 3.7) * 0.006;
      armSwing = 0.14;
    } else if (poseMode === 3) {
      // Breeze sway
      hipSwingX = Math.sin(t * 1.8) * 0.042;
      torsoSwayX = Math.sin(t * 1.8 - 0.6) * 0.028;
      legSwing = Math.sin(t * 0.9) * 0.08;
      armSwing = Math.cos(t * 1.8) * 0.12;
      yaw = impulseYaw + Math.sin(t * 0.9) * 0.18;
    }

    const prevYaw = this.motionState.yaw;
    this.motionState.yaw = yaw;
    this.motionState.yawVelocity = dt > 1e-4 ? (yaw - prevYaw) / dt : 0;
    this.motionState.hipSwingX = hipSwingX;
    this.motionState.offsetY = hipBobY;
    this.motionState.shoulderTilt = torsoSwayX;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    // Helper to transform a base point according to boneId and weight
    const transformPoint = (x, y, z, boneId, w) => {
      if (boneId === 5) {
        // Plinth stays stationary on studio floor
        return [x, y, z];
      }

      let lx = x;
      let ly = y + hipBobY;
      let lz = z;

      if (boneId === 0) {
        // Torso & head: hip sway near pelvis, counter-sway near shoulders
        const hipInfluence = Math.max(0, 1 - Math.abs(y - 0.90) / 0.32);
        const upperInfluence = Math.max(0, Math.min(1, (y - 1.02) / 0.45));
        lx += hipSwingX * hipInfluence + torsoSwayX * upperInfluence;
      } else if (boneId === 1 || boneId === 2) {
        // Left (1) or Right (2) Leg swing around hip joint (y = 0.85m)
        const sign = boneId === 1 ? 1 : -1;
        const swingAngle = sign * legSwing;
        const kneeBend = Math.max(0, -swingAngle) * 0.55 * Math.max(0, (w - 0.42) / 0.58);
        const effAngle = swingAngle * Math.min(1, w * 1.35) - kneeBend;

        const dy = ly - 0.85;
        const dz = lz;
        const c = Math.cos(effAngle);
        const s = Math.sin(effAngle);
        ly = 0.85 + dy * c - dz * s;
        lz = dy * s + dz * c;
        lx += hipSwingX * (1 - w * 0.75);
      } else if (boneId === 3 || boneId === 4) {
        // Left (3) or Right (4) Arm swing around shoulder joint (y = 1.375m)
        const sign = boneId === 3 ? 1 : -1;
        const aAngle = sign * armSwing * w;
        const dy = ly - 1.375;
        const dz = lz + 0.008;
        const c = Math.cos(aAngle);
        const s = Math.sin(aAngle);
        ly = 1.375 + dy * c - dz * s;
        lz = -0.008 + dy * s + dz * c;
        lx += torsoSwayX;
      }

      // Apply global avatar yaw rotation around Y axis
      const wx = lx * cosY + lz * sinY;
      const wz = -lx * sinY + lz * cosY;
      return [wx, ly, wz];
    };

    // Update all mesh vertices and normals
    const baseP = this.basePositions;
    const baseN = this.baseNormals;
    const out = this.interleaved;
    for (let v = 0; v < this.vertexCount; v++) {
      const i3 = v * 3;
      const i6 = v * 6;
      const bId = this.boneIds[v];
      const w = this.boneWeights[v];

      const [wx, wy, wz] = transformPoint(baseP[i3], baseP[i3 + 1], baseP[i3 + 2], bId, w);
      out[i6] = wx;
      out[i6 + 1] = wy;
      out[i6 + 2] = wz;

      if (bId === 5) {
        out[i6 + 3] = baseN[i3];
        out[i6 + 4] = baseN[i3 + 1];
        out[i6 + 5] = baseN[i3 + 2];
      } else {
        out[i6 + 3] = baseN[i3] * cosY + baseN[i3 + 2] * sinY;
        out[i6 + 4] = baseN[i3 + 1];
        out[i6 + 5] = -baseN[i3] * sinY + baseN[i3 + 2] * cosY;
      }
    }

    // Update the 16 anatomical collision capsules in world space
    // Each capsule: [ax, ay, az, rA, bx, by, bz, rB, boneId, wA, wB]
    const localCapsules = [
      // 0: Head & Neck
      [0.0, 1.44, 0.0, 0.056, 0.0, 1.63, 0.008, 0.082, 0, 0.7, 0.95],
      // 1: Shoulder / Clavicle Bridge (Left to Right shoulder)
      [-0.155, 1.365, -0.006, 0.054, 0.155, 1.365, -0.006, 0.054, 0, 0.62, 0.62],
      // 2: Upper Chest / Ribcage
      [0.0, 1.28, -0.004, 0.118, 0.0, 1.13, -0.002, 0.108, 0, 0.52, 0.36],
      // 3: Left Bust Sphere
      [-0.072, 1.235, 0.042, 0.076, -0.068, 1.230, 0.050, 0.074, 0, 0.48, 0.48],
      // 4: Right Bust Sphere
      [0.072, 1.235, 0.042, 0.076, 0.068, 1.230, 0.050, 0.074, 0, 0.48, 0.48],
      // 5: Natural Waist Column
      [0.0, 1.07, 0.0, 0.104, 0.0, 0.98, -0.004, 0.108, 0, 0.30, 0.20],
      // 6: Upper Pelvis / Hip Crest Bridge
      [-0.062, 0.90, -0.008, 0.116, 0.062, 0.90, -0.008, 0.116, 0, 0.12, 0.12],
      // 7: Lower Pelvis / Gluteal Bridge
      [-0.058, 0.85, -0.018, 0.114, 0.058, 0.85, -0.018, 0.114, 0, 0.06, 0.06],
      // 8: Left Thigh Capsule
      [-0.092, 0.83, 0.0, 0.086, -0.082, 0.48, 0.0, 0.058, 1, 0.05, 0.45],
      // 9: Right Thigh Capsule
      [0.092, 0.83, 0.0, 0.086, 0.082, 0.48, 0.0, 0.058, 2, 0.05, 0.45],
      // 10: Left Calf Capsule
      [-0.082, 0.47, 0.0, 0.056, -0.076, 0.08, 0.0, 0.040, 1, 0.46, 0.92],
      // 11: Right Calf Capsule
      [0.082, 0.47, 0.0, 0.056, 0.076, 0.08, 0.0, 0.040, 2, 0.46, 0.92],
      // 12: Left Upper Arm Capsule
      [-0.178, 1.375, -0.008, 0.049, -0.255, 1.115, -0.022, 0.039, 3, 0.0, 0.45],
      // 13: Right Upper Arm Capsule
      [0.178, 1.375, -0.008, 0.049, 0.255, 1.115, -0.022, 0.039, 4, 0.0, 0.45],
      // 14: Left Forearm Capsule
      [-0.255, 1.115, -0.022, 0.038, -0.320, 0.83, 0.022, 0.030, 3, 0.45, 0.90],
      // 15: Right Forearm Capsule
      [0.255, 1.115, -0.022, 0.038, 0.320, 0.83, 0.022, 0.030, 4, 0.45, 0.90],
    ];

    const invDt = dt > 1e-4 ? 1.0 / dt : 0.0;
    for (let c = 0; c < this.capsuleCount; c++) {
      const def = localCapsules[c];
      const pA = transformPoint(def[0], def[1], def[2], def[8], def[9]);
      const pB = transformPoint(def[4], def[5], def[6], def[8], def[10]);

      const midX = 0.5 * (pA[0] + pB[0]);
      const midY = 0.5 * (pA[1] + pB[1]);
      const midZ = 0.5 * (pA[2] + pB[2]);

      const c3 = c * 3;
      let vx = 0, vy = 0, vz = 0;
      if (this.hasPrevCapsules) {
        vx = Math.max(-4.5, Math.min(4.5, (midX - this.prevCapsuleCenters[c3]) * invDt));
        vy = Math.max(-4.5, Math.min(4.5, (midY - this.prevCapsuleCenters[c3 + 1]) * invDt));
        vz = Math.max(-4.5, Math.min(4.5, (midZ - this.prevCapsuleCenters[c3 + 2]) * invDt));
      }
      this.prevCapsuleCenters[c3] = midX;
      this.prevCapsuleCenters[c3 + 1] = midY;
      this.prevCapsuleCenters[c3 + 2] = midZ;

      const base = c * 12;
      this.capsuleData[base + 0] = pA[0];
      this.capsuleData[base + 1] = pA[1];
      this.capsuleData[base + 2] = pA[2];
      this.capsuleData[base + 3] = def[3];
      this.capsuleData[base + 4] = pB[0];
      this.capsuleData[base + 5] = pB[1];
      this.capsuleData[base + 6] = pB[2];
      this.capsuleData[base + 7] = def[7];
      this.capsuleData[base + 8] = vx;
      this.capsuleData[base + 9] = vy;
      this.capsuleData[base + 10] = vz;
      this.capsuleData[base + 11] = 0.0;
    }
    this.hasPrevCapsules = true;
  }

  /**
   * Parses a user-supplied Wavefront .OBJ file to replace the avatar mesh,
   * automatically normalizing its height to [0.005m .. 1.72m] and assigning skeletal weights.
   */
  loadWavefrontObj(objText) {
    const rawV = [];
    const faces = [];
    const lines = objText.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith("v ")) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          rawV.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        }
      } else if (line.startsWith("f ")) {
        const parts = line.split(/\s+/).slice(1);
        const idx = parts.map((tok) => {
          const vIdx = parseInt(tok.split("/")[0], 10);
          return vIdx > 0 ? vIdx - 1 : rawV.length + vIdx;
        });
        for (let k = 1; k < idx.length - 1; k++) {
          faces.push(idx[0], idx[k], idx[k + 1]);
        }
      }
    }
    if (rawV.length < 12 || faces.length < 12) {
      throw new Error("The .obj file does not contain a valid triangle mesh.");
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const [x, y, z] of rawV) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const spanY = Math.max(1e-4, maxY - minY);
    const scale = 1.715 / spanY;
    const cx = 0.5 * (minX + maxX);
    const cz = 0.5 * (minZ + maxZ);

    const pos = new Float32Array(rawV.length * 3);
    const bIds = new Uint8Array(rawV.length);
    const bWeights = new Float32Array(rawV.length);

    for (let i = 0; i < rawV.length; i++) {
      const x = (rawV[i][0] - cx) * scale;
      const y = (rawV[i][1] - minY) * scale + 0.005;
      const z = (rawV[i][2] - cz) * scale;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      if (y < 0.85) {
        bIds[i] = x < 0 ? 1 : 2;
        bWeights[i] = Math.max(0, Math.min(1, (0.85 - y) / 0.84));
      } else if (Math.abs(x) > 0.16 && y < 1.42) {
        bIds[i] = x < 0 ? 3 : 4;
        bWeights[i] = Math.max(0, Math.min(1, (1.38 - y) / 0.55));
      } else {
        bIds[i] = 0;
        bWeights[i] = Math.max(0, Math.min(1, (y - 0.79) / 0.93));
      }
    }

    this.vertexCount = rawV.length;
    this.indexCount = faces.length;
    this.basePositions = pos;
    this.positions = new Float32Array(pos);
    this.normals = new Float32Array(pos.length);
    this.boneIds = bIds;
    this.boneWeights = bWeights;
    this.indices = new Uint32Array(faces);
    this.interleaved = new Float32Array(this.vertexCount * 6);

    this.computeBaseNormals();
    this.baseNormals = new Float32Array(this.normals);
    this.hasPrevCapsules = false;
    this.evaluatePose(0, 0.016, {});
  }
}
