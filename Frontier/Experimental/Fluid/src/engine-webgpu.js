/**
 * WebGPU Real-Time XPBD Cloth & Dress Simulation Engine
 * Uses WGSL @compute @workgroup_size(64) shaders over storage buffers with
 * 16-capsule articulated human avatar SDF collision and anisotropic PBR rendering.
 */

import { WGSL_CLOTH_COMPUTE_SHADER, WGSL_CLOTH_RENDER_SHADER } from "./shaders-wgsl.js";
import { DressGenerator } from "./DressGenerator.js";
import { COLOR_PALETTES } from "./presets.js";

export class WebGPUClothEngine {
  static async isAvailable() {
    if (typeof navigator === "undefined" || !navigator.gpu) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch {
      return false;
    }
  }

  static async create(canvas, params, avatar) {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) {
      throw new Error("No WebGPU adapter found.");
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Could not acquire WebGPU canvas context.");
    }
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    device.pushErrorScope("validation");
    let engine;
    try {
      engine = new WebGPUClothEngine(canvas, params, avatar, device, context, format);
      const error = await device.popErrorScope();
      if (error) throw new Error(error.message);
      return engine;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }

  constructor(canvas, params, avatar, device, context, format) {
    this.canvas = canvas;
    this.params = params;
    this.avatar = avatar;
    this.device = device;
    this.context = context;
    this.format = format;
    this.backendName = "WebGPU (WGSL Compute XPBD)";

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

    this.simUniformData = new Float32Array(57 * 4); // 57 vec4f = 912 bytes
    this.renderUniformData = new Float32Array(48);

    this.depthTexture = null;
    this.depthWidth = 0;
    this.depthHeight = 0;

    this.initPipelines();
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

  initPipelines() {
    const device = this.device;

    // 1. Compute Pipelines
    const computeModule = device.createShaderModule({
      code: WGSL_CLOTH_COMPUTE_SHADER,
    });
    this.computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const computeLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.computeBGL],
    });
    const makeCompute = (entryPoint) =>
      device.createComputePipeline({
        layout: computeLayout,
        compute: { module: computeModule, entryPoint },
      });

    this.computePipelines = {
      predict: makeCompute("csPredict"),
      solve: makeCompute("csSolveConstraints"),
      collide: makeCompute("csCollideAndUpdate"),
      normals: makeCompute("csComputeNormals"),
    };

    this.simUniformBuffer = device.createBuffer({
      size: 912,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 2. Render Pipelines
    const renderModule = device.createShaderModule({
      code: WGSL_CLOTH_RENDER_SHADER,
    });

    this.renderUniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Floor & Avatar share Group 0 with only binding 0 (uRender)
    this.sceneBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.sceneBindGroup = device.createBindGroup({
      layout: this.sceneBGL,
      entries: [{ binding: 0, resource: { buffer: this.renderUniformBuffer } }],
    });

    const sceneLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.sceneBGL],
    });

    this.floorPipeline = device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: renderModule, entryPoint: "vsFloor" },
      fragment: {
        module: renderModule,
        entryPoint: "fsFloor",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.avatarPipeline = device.createRenderPipeline({
      layout: sceneLayout,
      vertex: {
        module: renderModule,
        entryPoint: "vsAvatar",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: {
        module: renderModule,
        entryPoint: "fsAvatar",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // Cloth render pipeline uses storage buffers for zero-copy vertex pulling from compute output
    this.clothBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    const clothLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.clothBGL],
    });

    this.clothPipeline = device.createRenderPipeline({
      layout: clothLayout,
      vertex: { module: renderModule, entryPoint: "vsCloth" },
      fragment: {
        module: renderModule,
        entryPoint: "fsCloth",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  initAvatarBuffers() {
    const device = this.device;
    this.avatarVertexBuffer?.destroy();
    this.avatarIndexBuffer?.destroy();

    this.avatarVertexBuffer = device.createBuffer({
      size: this.avatar.interleaved.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.avatarVertexBuffer, 0, this.avatar.interleaved);

    // Pad Uint32Array to 4-byte multiple (already Uint32)
    this.avatarIndexBuffer = device.createBuffer({
      size: this.avatar.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.avatarIndexBuffer, 0, this.avatar.indices);
    this.avatarIndexCount = this.avatar.indexCount;
  }

  rebuildDress(params = this.params) {
    this.params = params;
    const dress = DressGenerator.buildDress(params);
    this.dressData = dress;
    this.pieReport = dress.pieReport;
    this.numCols = dress.numCols;
    this.numRows = dress.numRows;
    this.vertexCount = dress.vertexCount;
    this.constraintCount = dress.constraintCount;
    this.indexCount = dress.indexCount;
    this.gridRes = dress.numCols;

    const device = this.device;
    [
      this.posBufferA,
      this.posBufferB,
      this.prevPosBuffer,
      this.velBuffer,
      this.restLenBuffer,
      this.anchorBuffer,
      this.normalBuffer,
      this.uvBuffer,
      this.clothIndexBuffer,
    ].forEach((b) => b?.destroy());

    const byteSize = dress.vertexCount * 16; // vec4f per vertex
    const makeStorage = (data, extraUsage = 0) => {
      const buf = device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
      });
      if (data) device.queue.writeBuffer(buf, 0, data);
      return buf;
    };

    // Transform initial positions to current avatar pose so re-draping matches avatar
    const initPos = new Float32Array(dress.initialPositions);
    const zeroVel = new Float32Array(dress.vertexCount * 4);
    const initNrm = new Float32Array(dress.vertexCount * 4);
    for (let i = 0; i < dress.vertexCount; i++) {
      initNrm[i * 4 + 2] = 1.0;
    }

    this.posBufferA = makeStorage(initPos);
    this.posBufferB = makeStorage(initPos);
    this.prevPosBuffer = makeStorage(initPos);
    this.velBuffer = makeStorage(zeroVel);
    this.restLenBuffer = makeStorage(dress.restLengths);
    this.anchorBuffer = makeStorage(dress.anchorTargets);
    this.normalBuffer = makeStorage(initNrm);
    this.uvBuffer = makeStorage(dress.uvsAndPanel);

    this.clothIndexBuffer = device.createBuffer({
      size: dress.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.clothIndexBuffer, 0, dress.indices);

    // Ping-pong bind groups: GroupAB reads A -> writes B; GroupBA reads B -> writes A
    this.computeBG_AB = device.createBindGroup({
      layout: this.computeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 1, resource: { buffer: this.posBufferA } },
        { binding: 2, resource: { buffer: this.posBufferB } },
        { binding: 3, resource: { buffer: this.prevPosBuffer } },
        { binding: 4, resource: { buffer: this.velBuffer } },
        { binding: 5, resource: { buffer: this.restLenBuffer } },
        { binding: 6, resource: { buffer: this.anchorBuffer } },
        { binding: 7, resource: { buffer: this.normalBuffer } },
      ],
    });

    this.computeBG_BA = device.createBindGroup({
      layout: this.computeBGL,
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 1, resource: { buffer: this.posBufferB } },
        { binding: 2, resource: { buffer: this.posBufferA } },
        { binding: 3, resource: { buffer: this.prevPosBuffer } },
        { binding: 4, resource: { buffer: this.velBuffer } },
        { binding: 5, resource: { buffer: this.restLenBuffer } },
        { binding: 6, resource: { buffer: this.anchorBuffer } },
        { binding: 7, resource: { buffer: this.normalBuffer } },
      ],
    });

    this.clothRenderBG = device.createBindGroup({
      layout: this.clothBGL,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: this.posBufferA } },
        { binding: 2, resource: { buffer: this.normalBuffer } },
        { binding: 3, resource: { buffer: this.uvBuffer } },
        { binding: 4, resource: { buffer: this.velBuffer } },
      ],
    });
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

  stepSimulation(dt) {
    const t0 = performance.now();
    const scaledDt = Math.min(0.033, dt) * (this.params.timeScale || 1.0);
    this.time += scaledDt;
    this.stepCount++;

    if (this.updraftTimer > 0) this.updraftTimer = Math.max(0, this.updraftTimer - scaledDt);
    if (this.twirlTimer > 0) this.twirlTimer = Math.max(0, this.twirlTimer - scaledDt);
    if (this.crosswindTimer > 0) this.crosswindTimer = Math.max(0, this.crosswindTimer - scaledDt);

    // 1. Evaluate articulated human body pose & collision capsules
    this.avatar.evaluatePose(this.time, scaledDt, this.params);
    this.device.queue.writeBuffer(this.avatarVertexBuffer, 0, this.avatar.interleaved);

    const substeps = Math.max(4, Math.min(20, Math.round(this.params.substeps || 12)));
    const subDt = Math.max(0.0005, scaledDt / substeps);

    const windAz = ((this.params.windDirection || 0) * Math.PI) / 180;
    const extraCrosswind = this.crosswindTimer > 0 ? Math.sin(this.time * 9.0) * 4.5 : 0;
    const windSpeed = (this.params.windSpeed || 0) + Math.abs(extraCrosswind);
    const windX = Math.cos(windAz) * windSpeed + extraCrosswind;
    const windZ = Math.sin(windAz) * windSpeed;

    const u = this.simUniformData;
    // 0: gridInfo
    u[0] = this.numCols;
    u[1] = this.numRows;
    u[2] = this.vertexCount;
    u[3] = subDt;
    // 1: solverInfo
    u[4] = this.params.stretchCompliance ?? 0.006;
    u[5] = this.params.shearCompliance ?? 0.018;
    u[6] = this.params.bendStiffness ?? 0.42;
    u[7] = this.params.damping ?? 0.22;
    // 2: envInfo
    u[8] = this.params.gravity ?? 9.81;
    u[9] = this.params.clothThickness ?? 0.012;
    u[10] = this.params.bodyFriction ?? 0.28;
    u[11] = this.time;
    // 3: windInfo
    u[12] = windX;
    u[13] = 0.25 * windSpeed;
    u[14] = windZ;
    u[15] = this.params.windTurbulence ?? 0.85;
    // 4: avatarMotion
    u[16] = this.avatar.motionState.yaw;
    u[17] = this.avatar.motionState.offsetY;
    u[18] = this.avatar.motionState.hipSwingX;
    u[19] = this.avatar.motionState.shoulderTilt;
    // 5: brushPos
    u[20] = this.brushPos[0];
    u[21] = this.brushPos[1];
    u[22] = this.brushPos[2];
    u[23] = this.brushActive ? 1.0 : 0.0;
    // 6: brushVel
    u[24] = this.brushVel[0];
    u[25] = this.brushVel[1];
    u[26] = this.brushVel[2];
    u[27] = 0.26;
    // 7: impulseInfo
    u[28] = this.updraftTimer > 0 ? 11.5 * Math.sin((this.updraftTimer / 1.6) * Math.PI) : 0.0;
    u[29] = this.twirlTimer > 0 ? 4.2 * Math.sin((this.twirlTimer / 2.4) * Math.PI) : this.avatar.motionState.yawVelocity * 0.4;
    u[30] = this.params.windEnabled ? 1.0 : 0.0;
    u[31] = 0.0;
    // 8: pieInfo (Zhang et al. 2025 SIGGRAPH '25)
    u[32] = this.params.pieAnisotropy ?? 1.45;
    u[33] = this.params.pieLockingRelief ?? 0.68;
    u[34] = this.params.pieShirringRatio ?? 0.64;
    u[35] = this.params.pieDownPressure ?? 0.0;
    // 9..56: 16 capsules * 12 floats = 192 floats
    u.set(this.avatar.capsuleData, 36);

    this.device.queue.writeBuffer(this.simUniformBuffer, 0, u);

    const workgroups = Math.ceil(this.vertexCount / 64);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    for (let s = 0; s < substeps; s++) {
      // 1. Predict: A -> B
      pass.setPipeline(this.computePipelines.predict);
      pass.setBindGroup(0, this.computeBG_AB);
      pass.dispatchWorkgroups(workgroups);

      // 2. Solve Constraints Pass 1: B -> A
      pass.setPipeline(this.computePipelines.solve);
      pass.setBindGroup(0, this.computeBG_BA);
      pass.dispatchWorkgroups(workgroups);

      // 3. Solve Constraints Pass 2: A -> B
      pass.setPipeline(this.computePipelines.solve);
      pass.setBindGroup(0, this.computeBG_AB);
      pass.dispatchWorkgroups(workgroups);

      // 4. Collide & Update Velocity: B -> A
      pass.setPipeline(this.computePipelines.collide);
      pass.setBindGroup(0, this.computeBG_BA);
      pass.dispatchWorkgroups(workgroups);
    }

    // Recompute smooth vertex normals from final posBufferA
    pass.setPipeline(this.computePipelines.normals);
    pass.setBindGroup(0, this.computeBG_AB);
    pass.dispatchWorkgroups(workgroups);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.simDurationMs = performance.now() - t0;
  }

  ensureDepthTexture() {
    const w = Math.max(2, this.canvas.width);
    const h = Math.max(2, this.canvas.height);
    if (!this.depthTexture || this.depthWidth !== w || this.depthHeight !== h) {
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [w, h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthWidth = w;
      this.depthHeight = h;
    }
  }

  render(camera) {
    this.ensureDepthTexture();

    const vp = camera.getViewProjectionMatrix();
    const ru = this.renderUniformData;
    ru.set(vp, 0);

    // cameraPos (offset 16)
    ru[16] = camera.position[0];
    ru[17] = camera.position[1];
    ru[18] = camera.position[2];
    ru[19] = this.params.exposure ?? 1.15;

    // lightDir (offset 20)
    const el = ((this.params.sunElevation ?? 44) * Math.PI) / 180;
    const az = ((this.params.sunAzimuth ?? 36) * Math.PI) / 180;
    ru[20] = Math.cos(el) * Math.sin(az);
    ru[21] = Math.sin(el);
    ru[22] = Math.cos(el) * Math.cos(az);
    ru[23] = this.params.sunIntensity ?? 2.6;

    const pal = COLOR_PALETTES[this.params.colorPalette ?? 0] || COLOR_PALETTES[0];
    // primaryColor (offset 24)
    ru[24] = pal.primary[0];
    ru[25] = pal.primary[1];
    ru[26] = pal.primary[2];
    ru[27] = this.params.ambientIntensity ?? 0.75;

    // sheenColor (offset 28)
    ru[28] = pal.sheen[0];
    ru[29] = pal.sheen[1];
    ru[30] = pal.sheen[2];
    ru[31] = this.params.sheenIntensity ?? 1.35;

    // trimColor (offset 32)
    ru[32] = pal.trim[0];
    ru[33] = pal.trim[1];
    ru[34] = pal.trim[2];
    ru[35] = this.params.hemTrim ?? 0.55;

    // weaveParams (offset 36)
    ru[36] = this.params.weaveType ?? 0;
    ru[37] = this.params.weaveScale ?? 28;
    ru[38] = this.params.weaveBump ?? 0.45;
    ru[39] = this.params.fabricRoughness ?? 0.28;

    // extraParams (offset 40)
    ru[40] = this.params.renderChannel ?? 0;
    ru[41] = this.params.subsurfaceScatter ?? 0.65;
    ru[42] = this.params.showSeamLines ? 1.0 : 0.0;
    ru[43] = this.params.avatarFinish ?? 0;

    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru);

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.068, g: 0.071, b: 0.078, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    if (this.params.showFloorGrid) {
      pass.setPipeline(this.floorPipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      pass.draw(6);
    }

    if (this.params.avatarVisible) {
      pass.setPipeline(this.avatarPipeline);
      pass.setBindGroup(0, this.sceneBindGroup);
      pass.setVertexBuffer(0, this.avatarVertexBuffer);
      pass.setIndexBuffer(this.avatarIndexBuffer, "uint32");
      pass.drawIndexed(this.avatarIndexCount);
    }

    if (this.params.garmentEnabled) {
      pass.setPipeline(this.clothPipeline);
      pass.setBindGroup(0, this.clothRenderBG);
      pass.setIndexBuffer(this.clothIndexBuffer, "uint32");
      pass.drawIndexed(this.indexCount);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy() {
    [
      this.posBufferA,
      this.posBufferB,
      this.prevPosBuffer,
      this.velBuffer,
      this.restLenBuffer,
      this.anchorBuffer,
      this.normalBuffer,
      this.uvBuffer,
      this.clothIndexBuffer,
      this.avatarVertexBuffer,
      this.avatarIndexBuffer,
      this.simUniformBuffer,
      this.renderUniformBuffer,
      this.depthTexture,
    ].forEach((res) => res?.destroy?.());
  }
}
