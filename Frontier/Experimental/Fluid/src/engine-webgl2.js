/**
 * WebGL2 Real-Time XPBD Cloth & Dress Simulation Engine (Fallback for non-WebGPU browsers)
 * Runs identical XPBD cloth physics, 16-capsule human avatar SDF collision, and PBR anisotropic shading.
 */

import {
  GLSL_FLOOR_VS,
  GLSL_FLOOR_FS,
  GLSL_AVATAR_VS,
  GLSL_AVATAR_FS,
  GLSL_CLOTH_VS,
  GLSL_CLOTH_FS,
} from "./shaders-glsl.js";
import { DressGenerator } from "./DressGenerator.js";
import { COLOR_PALETTES, getFabricLoadScale } from "./presets.js";

export class WebGL2ClothEngine {
  constructor(canvas, params, avatar) {
    this.canvas = canvas;
    this.params = params;
    this.avatar = avatar;
    this.backendName = "WebGL2 (XPBD Fallback)";

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      depth: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!gl) {
      throw new Error("WebGL2 is not supported in this browser.");
    }
    this.gl = gl;
    this.extColorBufferFloat = true;

    this.time = 0.0;
    this.stepCount = 0;
    this.simDurationMs = 0.0;
    this.pendingImpulses = [];

    this.brushPos = [0, 0, 0];
    this.brushVel = [0, 0, 0];
    this.brushActive = false;

    this.updraftTimer = 0.0;
    this.twirlTimer = 0.0;
    this.crosswindTimer = 0.0;

    this.initPrograms();
    this.initAvatarBuffers();
    this.rebuildDress(this.params);
  }

  getBoundsBox() {
    const skirtW = 0.55 + (this.params.skirtFlare || 0.6) * 0.45;
    return {
      boxMin: [-skirtW, 0.0, -skirtW],
      boxMax: [skirtW, 1.74, skirtW],
      effWidth: skirtW * 2.0,
      effHeight: 1.74,
    };
  }

  compileProgram(vsSource, fsSource) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`GLSL compile error: ${log}`);
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`GLSL link error: ${log}`);
    }
    return prog;
  }

  initPrograms() {
    this.floorProg = this.compileProgram(GLSL_FLOOR_VS, GLSL_FLOOR_FS);
    this.avatarProg = this.compileProgram(GLSL_AVATAR_VS, GLSL_AVATAR_FS);
    this.clothProg = this.compileProgram(GLSL_CLOTH_VS, GLSL_CLOTH_FS);
    this.emptyVAO = this.gl.createVertexArray();
  }

  initAvatarBuffers() {
    const gl = this.gl;
    if (this.avatarVAO) gl.deleteVertexArray(this.avatarVAO);
    if (this.avatarVBO) gl.deleteBuffer(this.avatarVBO);
    if (this.avatarIBO) gl.deleteBuffer(this.avatarIBO);

    this.avatarVAO = gl.createVertexArray();
    gl.bindVertexArray(this.avatarVAO);

    this.avatarVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.avatarVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.avatar.interleaved, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    this.avatarIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.avatarIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.avatar.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.avatarIndexCount = this.avatar.indexCount;
  }

  rebuildDress(params = this.params) {
    this.params = params;
    const dress = DressGenerator.buildDress(params);
    DressGenerator.updateAttachments(dress, this.avatar);
    this.dressData = dress;
    this.pieReport = dress.pieReport;
    this.numCols = dress.numCols;
    this.numRows = dress.numRows;
    this.vertexCount = dress.vertexCount; // simulated skirt/body grid
    this.renderVertexCount = dress.renderVertexCount ?? dress.vertexCount;
    this.constraintCount = dress.constraintCount;
    this.indexCount = dress.indexCount;
    this.gridRes = dress.numCols;

    this.posA = new Float32Array(dress.renderInitialPositions);
    this.posB = new Float32Array(dress.renderInitialPositions);
    this.prevPos = new Float32Array(dress.renderInitialPositions);
    this.velocities = new Float32Array(dress.renderVelocities);
    this.normals = new Float32Array(dress.renderNormals);
    this.restLengths = dress.restLengths;
    this.anchorTargets = dress.anchorTargets;
    this.uvsAndPanel = dress.renderUvsAndPanel;

    this.computeNormalsCPU();

    const gl = this.gl;
    if (this.clothVAO) gl.deleteVertexArray(this.clothVAO);
    [this.posVBO, this.nrmVBO, this.uvVBO, this.velVBO, this.clothIBO].forEach(
      (b) => b && gl.deleteBuffer(b),
    );

    this.clothVAO = gl.createVertexArray();
    gl.bindVertexArray(this.clothVAO);

    this.posVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.posA, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    this.nrmVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);

    this.uvVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.uvsAndPanel, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0);

    this.velVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.velocities, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0);

    this.clothIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.clothIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, dress.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  setGridResolution(res) {
    this.params.gridResolution = res;
    this.rebuildDress(this.params);
  }

  clearGrid() {
    this.rebuildDress(this.params);
  }

  setBrush(pos, vel, active) {
    this.brushActive = Boolean(active && pos);
    if (pos) this.brushPos = [...pos];
    if (vel) this.brushVel = [...vel];
  }

  triggerImpulse(kind = "twirl") {
    if (kind === "twirl") {
      this.twirlTimer = 2.4;
      this.avatar.triggerTwirl();
    } else if (kind === "updraft") {
      this.updraftTimer = 1.6;
    } else if (kind === "crosswind") {
      this.crosswindTimer = 2.0;
    } else if (kind === "catwalk") {
      this.params.avatarPose = this.params.avatarPose === 1 ? 0 : 1;
    } else if (kind === "redrape") {
      this.rebuildDress(this.params);
    }
  }

  transformAnchor(ax, ay, az) {
    const yaw = this.avatar.motionState.yaw;
    const offsetY = this.avatar.motionState.offsetY;
    const hipSwingX = this.avatar.motionState.hipSwingX;
    const shoulderTilt = this.avatar.motionState.shoulderTilt;

    const y = ay + offsetY;
    const hipInf = Math.max(0, 1 - Math.abs(ay - 0.90) / 0.32);
    const upperInf = Math.max(0, Math.min(1, (ay - 1.02) / 0.45));
    const lx = ax + hipSwingX * hipInf + shoulderTilt * upperInf;
    const lz = az;

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [lx * c + lz * s, y, -lx * s + lz * c];
  }

  stepSimulation(dt) {
    const t0 = performance.now();
    const scaledDt = Math.min(0.033, dt) * (this.params.timeScale || 1.0);
    this.time += scaledDt;
    this.stepCount++;

    if (this.updraftTimer > 0) this.updraftTimer = Math.max(0, this.updraftTimer - scaledDt);
    if (this.twirlTimer > 0) this.twirlTimer = Math.max(0, this.twirlTimer - scaledDt);
    if (this.crosswindTimer > 0) this.crosswindTimer = Math.max(0, this.crosswindTimer - scaledDt);

    this.avatar.evaluatePose(this.time, scaledDt, this.params);
    if (this.dressData.attachmentWeights?.length) {
      DressGenerator.updateAttachments(this.dressData, this.avatar);
      const offset4 = this.dressData.attachmentOffset * 4;
      this.posA.set(this.dressData.renderInitialPositions.subarray(offset4), offset4);
      this.normals.set(this.dressData.renderNormals.subarray(offset4), offset4);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.avatarVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.avatar.interleaved);

    const substeps = Math.max(4, Math.min(14, Math.round(this.params.substeps || 10)));
    const subDt = Math.max(0.0005, scaledDt / substeps);
    const numCols = this.numCols;
    const numRows = this.numRows;
    const count = this.vertexCount;

    const windAz = ((this.params.windDirection || 0) * Math.PI) / 180;
    const extraCrosswind = this.crosswindTimer > 0 ? Math.sin(this.time * 9.0) * 4.5 : 0;
    const windSpeed = (this.params.windSpeed || 0) + Math.abs(extraCrosswind);
    const windX = Math.cos(windAz) * windSpeed + extraCrosswind;
    const windZ = Math.sin(windAz) * windSpeed;
    const turb = this.params.windTurbulence ?? 0.85;
    const gravity = (this.params.gravity ?? 9.81) * getFabricLoadScale(this.params.arealDensity ?? 85);
    const windResponse = Math.max(0.05, this.params.windResponse ?? 1.0);
    const thickness = this.params.clothThickness ?? 0.012;
    const friction = this.params.bodyFriction ?? 0.28;
    const damping = this.params.damping ?? 0.22;
    const updraft = this.updraftTimer > 0 ? 11.5 * Math.sin((this.updraftTimer / 1.6) * Math.PI) : 0.0;
    const twirlOmega = this.twirlTimer > 0 ? 4.2 * Math.sin((this.twirlTimer / 2.4) * Math.PI) : this.avatar.motionState.yawVelocity * 0.4;

    const aniso = Math.max(0.5, Math.min(2.5, this.params.pieAnisotropy ?? 1.45));
    const lockingRelief = Math.max(0.0, Math.min(1.0, this.params.pieLockingRelief ?? 0.68));
    const stretchStiff = Math.max(0.15, Math.min(0.95, 1.0 / (1.0 + (this.params.stretchCompliance ?? 0.006) * 28.0)));
    const warpStiff = Math.max(0.18, Math.min(0.97, 1.0 / (1.0 + ((this.params.stretchCompliance ?? 0.006) / aniso) * 28.0)));
    const shearStiff = Math.max(0.08, Math.min(0.75, 1.0 / (1.0 + (this.params.shearCompliance ?? 0.018) * 36.0)));
    const bendStiff = Math.max(0.02, Math.min(0.45, (this.params.bendStiffness ?? 0.42) * 0.45));

    const posA = this.posA;
    const posB = this.posB;
    const prev = this.prevPos;
    const vel = this.velocities;
    const rl = this.restLengths;
    const anc = this.anchorTargets;
    const caps = this.avatar.capsuleData;

    const idxOf = (c, r) => {
      const wc = ((c % numCols) + numCols) % numCols;
      return r * numCols + wc;
    };

    for (let s = 0; s < substeps; s++) {
      // 1. Predict
      for (let i = 0; i < count; i++) {
        const i4 = i * 4;
        const px = posA[i4], py = posA[i4 + 1], pz = posA[i4 + 2];
        const pinW = anc[i4 + 3];
        prev[i4] = px;
        prev[i4 + 1] = py;
        prev[i4 + 2] = pz;
        prev[i4 + 3] = pinW;

        let ax = 0, ay = -gravity, az = 0;
        if (this.params.windEnabled) {
          const gx = Math.sin(py * 5.5 + pz * 3.8 + this.time * 3.4) * turb;
          const gy = 0.35 * Math.cos(px * 4.8 - this.time * 2.7) * turb;
          const gz = Math.cos(px * 5.2 + py * 4.1 - this.time * 3.1) * turb;
          ax += (windX + gx) * 1.4 * windResponse;
          ay += (0.25 * windSpeed + gy) * 1.4 * windResponse;
          az += (windZ + gz) * 1.4 * windResponse;
        }
        if (Math.abs(updraft) > 1e-3) {
          ay += updraft;
        }
        if (Math.abs(twirlOmega) > 1e-3) {
          const rLen = Math.max(0.04, Math.hypot(px, pz));
          ax += (-pz / rLen) * twirlOmega * 2.4 + (px / rLen) * Math.abs(twirlOmega) * 1.65;
          az += (px / rLen) * twirlOmega * 2.4 + (pz / rLen) * Math.abs(twirlOmega) * 1.65;
        }

        let nx = px + vel[i4] * subDt + ax * subDt * subDt;
        let ny = py + vel[i4 + 1] * subDt + ay * subDt * subDt;
        let nz = pz + vel[i4 + 2] * subDt + az * subDt * subDt;

        if (this.brushActive) {
          const dx = nx - this.brushPos[0];
          const dy = ny - this.brushPos[1];
          const dz = nz - this.brushPos[2];
          const d = Math.hypot(dx, dy, dz);
          if (d < 0.26) {
            const f = Math.pow(1 - d / 0.26, 1.5) * subDt * 1.35;
            nx += this.brushVel[0] * f;
            ny += this.brushVel[1] * f;
            nz += this.brushVel[2] * f;
          }
        }

        if (pinW > 0.001) {
          const [tx, ty, tz] = this.transformAnchor(anc[i4], anc[i4 + 1], anc[i4 + 2]);
          nx = nx * (1 - pinW) + tx * pinW;
          ny = ny * (1 - pinW) + ty * pinW;
          nz = nz * (1 - pinW) + tz * pinW;
        }

        posB[i4] = nx;
        posB[i4 + 1] = ny;
        posB[i4 + 2] = nz;
        posB[i4 + 3] = posA[i4 + 3];
      }

      // 2. Constraint Solve (posB -> posA)
      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const idx = r * numCols + c;
          const i4 = idx * 4;
          const pinW = prev[i4 + 3];
          if (pinW >= 0.96) {
            posA[i4] = posB[i4];
            posA[i4 + 1] = posB[i4 + 1];
            posA[i4 + 2] = posB[i4 + 2];
            posA[i4 + 3] = 0;
            continue;
          }

          const sx = posB[i4], sy = posB[i4 + 1], sz = posB[i4 + 2];
          let cx = 0, cy = 0, cz = 0, wSum = 0, strainAcc = 0;

          const addSpring = (otherIdx, restL, stiff, relief = lockingRelief) => {
            if (restL <= 0.0001) return;
            const o4 = otherIdx * 4;
            const dx = posB[o4] - sx;
            const dy = posB[o4 + 1] - sy;
            const dz = posB[o4 + 2] - sz;
            const d = Math.hypot(dx, dy, dz);
            if (d > 1e-6) {
              const err = d - restL;
              const compScale = err < 0 ? Math.max(0.18, 1.0 - relief * 0.78) : 1.0;
              const s = (err / d) * stiff * compScale;
              cx += dx * s;
              cy += dy * s;
              cz += dz * s;
              wSum += 1.0;
            }
          };

          const iRight = idxOf(c + 1, r);
          const iLeft = idxOf(c - 1, r);
          addSpring(iRight, rl[i4], stretchStiff);
          addSpring(iLeft, rl[iLeft * 4], stretchStiff);
          const dWeft = Math.hypot(posB[iRight * 4] - sx, posB[iRight * 4 + 1] - sy, posB[iRight * 4 + 2] - sz);
          strainAcc += Math.abs(dWeft - rl[i4]) / Math.max(0.005, rl[i4]);

          if (r < numRows - 1) {
            const iDown = idxOf(c, r + 1);
            addSpring(iDown, rl[i4 + 1], warpStiff, lockingRelief * 0.5);
            addSpring(idxOf(c + 1, r + 1), rl[i4 + 2], shearStiff);
            addSpring(idxOf(c - 1, r + 1), rl[iLeft * 4 + 2], shearStiff);
          }
          if (r > 0) {
            const iUp = idxOf(c, r - 1);
            addSpring(iUp, rl[iUp * 4 + 1], warpStiff, lockingRelief * 0.5);
            const iLU = idxOf(c - 1, r - 1);
            const iRU = idxOf(c + 1, r - 1);
            addSpring(iLU, rl[iLU * 4 + 2], shearStiff);
            addSpring(iRU, rl[iUp * 4 + 2], shearStiff);
          }

          const iR2 = idxOf(c + 2, r);
          const iL2 = idxOf(c - 2, r);
          addSpring(iR2, rl[i4 + 3], bendStiff, 0.0);
          addSpring(iL2, rl[iL2 * 4 + 3], bendStiff, 0.0);

          const scale = (1 - pinW * 0.92) / Math.max(1.0, wSum * 0.52);
          posA[i4] = sx + cx * scale;
          posA[i4 + 1] = sy + cy * scale;
          posA[i4 + 2] = sz + cz * scale;
          posA[i4 + 3] = Math.min(1.0, strainAcc * 1.8);
        }
      }

      // 3. Collide with 16 human body capsules & update velocity
      for (let i = 0; i < count; i++) {
        const i4 = i * 4;
        let px = posA[i4], py = posA[i4 + 1], pz = posA[i4 + 2];
        const ppx = prev[i4], ppy = prev[i4 + 1], ppz = prev[i4 + 2];
        const pinW = prev[i4 + 3];
        let minSdf = 10.0;

        for (let k = 0; k < 16; k++) {
          const b = k * 12;
          const ax = caps[b], ay = caps[b + 1], az = caps[b + 2], rA = caps[b + 3];
          const bx = caps[b + 4], by = caps[b + 5], bz = caps[b + 6], rB = caps[b + 7];
          const abx = bx - ax, aby = by - ay, abz = bz - az;
          const abLenSq = abx * abx + aby * aby + abz * abz;
          const t = abLenSq > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / abLenSq)) : 0;
          const clx = ax + abx * t, cly = ay + aby * t, clz = az + abz * t;
          const rad = rA * (1 - t) + rB * t + thickness;
          const dx = px - clx, dy = py - cly, dz = pz - clz;
          const dist = Math.hypot(dx, dy, dz);
          const sdf = dist - rad;
          if (sdf < minSdf) minSdf = sdf;
          if (sdf < 0) {
            const invD = dist > 1e-5 ? 1 / dist : 0;
            const nx = dist > 1e-5 ? dx * invD : 0;
            const ny = dist > 1e-5 ? dy * invD : 1;
            const nz = dist > 1e-5 ? dz * invD : 0;
            px = clx + nx * rad;
            py = cly + ny * rad;
            pz = clz + nz * rad;
            // Friction damping
            px = px * (1 - friction * 0.25) + ppx * (friction * 0.25);
            pz = pz * (1 - friction * 0.25) + ppz * (friction * 0.25);
            const rdx = px - clx, rdy = py - cly, rdz = pz - clz;
            const rDist = Math.hypot(rdx, rdy, rdz);
            if (rDist < rad) {
              px = clx + nx * rad;
              py = cly + ny * rad;
              pz = clz + nz * rad;
            }
          }
        }

        if (py < 0.012) py = 0.012;

        if (pinW > 0.65) {
          const [tx, ty, tz] = this.transformAnchor(anc[i4], anc[i4 + 1], anc[i4 + 2]);
          px = px * (1 - pinW) + tx * pinW;
          py = py * (1 - pinW) + ty * pinW;
          pz = pz * (1 - pinW) + tz * pinW;
        }

        const dampFactor = Math.exp(-damping * subDt * 2.5);
        let vx = ((px - ppx) / subDt) * dampFactor;
        let vy = ((py - ppy) / subDt) * dampFactor;
        let vz = ((pz - ppz) / subDt) * dampFactor;
        const sp = Math.hypot(vx, vy, vz);
        if (sp > 6.0) {
          const sc = 6.0 / sp;
          vx *= sc;
          vy *= sc;
          vz *= sc;
        }

        posA[i4] = px;
        posA[i4 + 1] = py;
        posA[i4 + 2] = pz;
        vel[i4] = vx;
        vel[i4 + 1] = vy;
        vel[i4 + 2] = vz;
        vel[i4 + 3] = Math.max(0, Math.min(1, minSdf * 8.0));
      }
    }

    this.computeNormalsCPU();

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.normals);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.velocities);

    this.simDurationMs = performance.now() - t0;
  }

  computeNormalsCPU() {
    const numCols = this.numCols;
    const numRows = this.numRows;
    const pos = this.posA;
    const nrm = this.normals;
    const idxOf = (c, r) => r * numCols + (((c % numCols) + numCols) % numCols);

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const i4 = (r * numCols + c) * 4;
        const px = pos[i4], py = pos[i4 + 1], pz = pos[i4 + 2];
        const iR = idxOf(c + 1, r) * 4;
        const iL = idxOf(c - 1, r) * 4;
        const rx = pos[iR] - px, ry = pos[iR + 1] - py, rz = pos[iR + 2] - pz;
        const lx = pos[iL] - px, ly = pos[iL + 1] - py, lz = pos[iL + 2] - pz;

        let dx = 0, dy = -0.02, dz = 0;
        if (r < numRows - 1) {
          const iD = idxOf(c, r + 1) * 4;
          dx = pos[iD] - px;
          dy = pos[iD + 1] - py;
          dz = pos[iD + 2] - pz;
        }
        let ux = 0, uy = 0.02, uz = 0;
        if (r > 0) {
          const iU = idxOf(c, r - 1) * 4;
          ux = pos[iU] - px;
          uy = pos[iU + 1] - py;
          uz = pos[iU + 2] - pz;
        }

        const nx = (dy * rz - dz * ry) + (ry * uz - rz * uy) + (uy * lz - uz * ly) + (ly * dz - lz * dy);
        const ny = (dz * rx - dx * rz) + (rz * ux - rx * uz) + (uz * lx - ux * lz) + (lz * dx - lx * dz);
        const nz = (dx * ry - dy * rx) + (rx * uy - ry * ux) + (ux * ly - uy * lx) + (lx * dy - ly * dx);
        const len = Math.hypot(nx, ny, nz) || 1;
        nrm[i4] = nx / len;
        nrm[i4 + 1] = ny / len;
        nrm[i4 + 2] = nz / len;
        nrm[i4 + 3] = pos[i4 + 3];
      }
    }
  }

  render(camera) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.068, 0.071, 0.078, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.Disable?.(gl.CULL_FACE);
    gl.disable(gl.CULL_FACE);

    const vp = camera.getViewProjectionMatrix();
    const el = ((this.params.sunElevation ?? 44) * Math.PI) / 180;
    const az = ((this.params.sunAzimuth ?? 36) * Math.PI) / 180;
    const lx = Math.cos(el) * Math.sin(az);
    const ly = Math.sin(el);
    const lz = Math.cos(el) * Math.cos(az);
    const pal = COLOR_PALETTES[this.params.colorPalette ?? 0] || COLOR_PALETTES[0];

    if (this.params.showFloorGrid) {
      gl.useProgram(this.floorProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.floorProg, "uViewProj"), false, vp);
      gl.uniform3fv(gl.getUniformLocation(this.floorProg, "uTrimColor"), pal.trim);
      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (this.params.avatarVisible) {
      gl.useProgram(this.avatarProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.avatarProg, "uViewProj"), false, vp);
      gl.uniform4f(gl.getUniformLocation(this.avatarProg, "uCameraPos"), camera.position[0], camera.position[1], camera.position[2], this.params.exposure ?? 1.15);
      gl.uniform4f(gl.getUniformLocation(this.avatarProg, "uLightDir"), lx, ly, lz, this.params.sunIntensity ?? 2.6);
      gl.uniform4f(gl.getUniformLocation(this.avatarProg, "uPrimaryCol"), pal.primary[0], pal.primary[1], pal.primary[2], this.params.ambientIntensity ?? 0.75);
      gl.uniform4f(gl.getUniformLocation(this.avatarProg, "uExtraParams"), this.params.renderChannel ?? 0, this.params.subsurfaceScatter ?? 0.65, this.params.showSeamLines ? 1 : 0, this.params.avatarFinish ?? 0);
      gl.bindVertexArray(this.avatarVAO);
      gl.drawElements(gl.TRIANGLES, this.avatarIndexCount, gl.UNSIGNED_INT, 0);
    }

    if (this.params.garmentEnabled) {
      gl.useProgram(this.clothProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.clothProg, "uViewProj"), false, vp);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uCameraPos"), camera.position[0], camera.position[1], camera.position[2], this.params.exposure ?? 1.15);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uLightDir"), lx, ly, lz, this.params.sunIntensity ?? 2.6);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uPrimaryCol"), pal.primary[0], pal.primary[1], pal.primary[2], this.params.ambientIntensity ?? 0.75);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uSheenCol"), pal.sheen[0], pal.sheen[1], pal.sheen[2], this.params.sheenIntensity ?? 1.35);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uTrimCol"), pal.trim[0], pal.trim[1], pal.trim[2], this.params.hemTrim ?? 0.55);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uWeaveParams"), this.params.weaveType ?? 0, this.params.weaveScale ?? 28, this.params.weaveBump ?? 0.45, this.params.fabricRoughness ?? 0.28);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uExtraParams"), this.params.renderChannel ?? 0, this.params.subsurfaceScatter ?? 0.65, this.params.showSeamLines ? 1 : 0, this.params.avatarFinish ?? 0);
      gl.uniform4f(gl.getUniformLocation(this.clothProg, "uStyleInfo"), this.params.dressStyle ?? 0, this.params.arealDensity ?? 85, this.params.windResponse ?? 1, 0);
      gl.bindVertexArray(this.clothVAO);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    }

    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;
    [this.posVBO, this.nrmVBO, this.uvVBO, this.velVBO, this.clothIBO, this.avatarVBO, this.avatarIBO].forEach(
      (b) => b && gl.deleteBuffer(b),
    );
    [this.clothVAO, this.avatarVAO, this.emptyVAO].forEach((v) => v && gl.deleteVertexArray(v));
    [this.floorProg, this.avatarProg, this.clothProg].forEach((p) => p && gl.deleteProgram(p));
  }
}
