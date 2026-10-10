/// <reference types="@webgpu/types" />
/**
 * WebGPU terrain engine.
 *
 * Everything lives on the GPU: the layer stack is evaluated in one compute
 * dispatch, erosion is a pipe-model shallow-water solve stepped at interactive
 * rates, and the analysis pass bakes normals / horizon AO / curvature / wetness
 * into two RGBA16F textures the shading reads. Nothing round-trips to the CPU
 * except exports.
 */
import { GEN, HYDRO_FLUX, HYDRO_ERODE, HYDRO_TRANSPORT, HYDRO_COMMIT, THERMAL_CALC, THERMAL_APPLY, ANALYSIS } from './shaders/compute.wgsl';
import { TERRAIN_SHADER, WATER_SHADER, SKY_SHADER } from './shaders/render.wgsl';

export const MAX_GEN_LAYERS = 16;
export const MAX_MAT_LAYERS = 10;

export interface ErosionSettings {
  iterations: number;
  rain: number; evaporation: number; capacity: number; dissolve: number; deposit: number;
  minSlope: number; gravity: number; pipeArea: number; inertia: number; dt: number;
  hardnessInfluence: number; talus: number; thermalRate: number; thermalEvery: number;
  rainSpotScale: number; rainSpotAmount: number;
}

export interface WorldSettings {
  seed: number; worldSize: number; heightScale: number;
  strataScale: number; strataContrast: number; strataTilt: number;
  seaLevel: number;
  aoDirs: number; aoSteps: number; aoRadius: number;
  flowGain: number; depGain: number; eroGain: number;
}

export interface RenderSettings {
  sunAzimuth: number; sunElevation: number; sunIntensity: number;
  sunColor: [number, number, number];
  zenith: [number, number, number]; horizon: [number, number, number];
  ambient: number; bounce: number; exposure: number; fog: number;
  shadowSteps: number; detail: number; shadingMode: number;
  showWater: boolean; wireframe: boolean;
}

export class TerrainEngine {
  device!: GPUDevice;
  ctx!: GPUCanvasContext;
  format!: GPUTextureFormat;
  res = 1024;
  gridN = 768;
  adapterInfo = '';

  private buffers: Record<string, GPUBuffer> = {};
  private genU!: GPUBuffer; private eroU!: GPUBuffer; private anaU!: GPUBuffer; private renU!: GPUBuffer;
  private nrmAo!: GPUTexture; private masks!: GPUTexture; private sampler!: GPUSampler;
  private msaa?: GPUTexture; private depth?: GPUTexture;
  private pipelines: Record<string, GPUComputePipeline> = {};
  private renderPipes: Record<string, GPURenderPipeline> = {};
  private bindGroups: Record<string, GPUBindGroup> = {};
  private layouts: Record<string, GPUBindGroupLayout> = {};
  private canvasSize = [1, 1];
  erosionDone = 0;
  /** surfaced to the UI: WGSL compile errors and GPU validation errors */
  onError: (title: string, msg: string) => void = () => {};

  async init(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser. Use Chrome/Edge 113+, or Safari 18+.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter found.');
    const limits: Record<string, number> = {};
    const want = 1024 * 1024 * 1024;
    const al = adapter.limits as unknown as Record<string, number>;
    if (al.maxStorageBufferBindingSize > 134217728) {
      limits.maxStorageBufferBindingSize = Math.min(al.maxStorageBufferBindingSize, want);
      limits.maxBufferSize = Math.min(al.maxBufferSize, want);
    }
    // the terrain mesh is vertex-pulled straight out of the height storage
    // buffer, so make sure the vertex stage is actually allowed to read one
    for (const k of ['maxStorageBuffersInVertexStage', 'maxStorageBuffersPerShaderStage']) {
      if (typeof al[k] === 'number' && al[k] > 0) limits[k] = Math.min(al[k], 8);
    }
    this.device = await adapter.requestDevice({ requiredLimits: limits });
    this.device.lost.then(info => {
      console.error('WebGPU device lost:', info.message);
      this.onError('GPU device lost', info.message || 'The GPU process restarted.');
    });
    this.device.addEventListener('uncapturederror', (e: Event) => {
      const err = (e as GPUUncapturedErrorEvent).error;
      console.error(err);
      this.onError('GPU validation error', String(err.message).replace(/\n/g, '<br>'));
    });
    const info = (adapter as unknown as { info?: GPUAdapterInfo }).info;
    this.adapterInfo = info ? `${info.vendor || '?'} ${info.architecture || ''} ${info.description || ''}`.trim() : 'GPU';

    this.ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    this.genU = this.device.createBuffer({ size: 1056 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.eroU = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.anaU = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renU = this.device.createBuffer({ size: 64 + 16 * 8 + 72 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.buildPipelines();
    this.allocate(this.res);
  }

  /* ----------------------------- resources ----------------------------- */

  private storage(size: number, extra: GPUBufferUsageFlags = 0) {
    return this.device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra });
  }

  allocate(res: number) {
    this.res = res;
    for (const b of Object.values(this.buffers)) b.destroy();
    this.buffers = {};
    const n = res * res;
    for (const name of ['height', 'water', 'sediment', 'sedimentTmp', 'hardness', 'deposited', 'eroded', 'delta']) {
      this.buffers[name] = this.storage(n * 4);
    }
    this.buffers.flux = this.storage(n * 16);
    this.buffers.vel = this.storage(n * 8);

    this.nrmAo?.destroy(); this.masks?.destroy();
    const texDesc: GPUTextureDescriptor = {
      size: [res, res], format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    };
    this.nrmAo = this.device.createTexture(texDesc);
    this.masks = this.device.createTexture(texDesc);
    this.buildBindGroups();
    this.erosionDone = 0;
  }

  /** createShaderModule + async compilation diagnostics (line numbers included) */
  private module(code: string, label: string) {
    const m = this.device.createShaderModule({ code, label });
    void m.getCompilationInfo().then(info => {
      const errs = info.messages.filter(x => x.type === 'error');
      if (!errs.length) return;
      const lines = code.split('\n');
      const text = errs.slice(0, 4).map(x =>
        `<b>${label}:${x.lineNum}</b> ${x.message}<br><code style="color:#8b97a5">${(lines[x.lineNum - 1] ?? '').trim()}</code>`).join('<br><br>');
      this.onError('WGSL compile error', text);
      console.error(label, errs);
    });
    return m;
  }

  private buildPipelines() {
    const dev = this.device;
    const mkCompute = (code: string, layout: GPUBindGroupLayout) =>
      dev.createComputePipeline({
        layout: dev.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module: this.module(code, 'compute'), entryPoint: 'main' },
      });

    const C = GPUShaderStage.COMPUTE;
    this.layouts.gen = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'storage' } },
        { binding: 2, visibility: C, buffer: { type: 'storage' } },
      ],
    });
    this.layouts.erode = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        ...Array.from({ length: 10 }, (_, i) => ({
          binding: i + 1, visibility: C, buffer: { type: 'storage' as const },
        })),
      ],
    });
    this.layouts.analysis = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        ...Array.from({ length: 5 }, (_, i) => ({
          binding: i + 1, visibility: C, buffer: { type: 'read-only-storage' as const },
        })),
        { binding: 6, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 7, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.layouts.render = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });

    this.pipelines.gen = mkCompute(GEN, this.layouts.gen);
    this.pipelines.flux = mkCompute(HYDRO_FLUX, this.layouts.erode);
    this.pipelines.erode = mkCompute(HYDRO_ERODE, this.layouts.erode);
    this.pipelines.transport = mkCompute(HYDRO_TRANSPORT, this.layouts.erode);
    this.pipelines.commit = mkCompute(HYDRO_COMMIT, this.layouts.erode);
    this.pipelines.thermalCalc = mkCompute(THERMAL_CALC, this.layouts.erode);
    this.pipelines.thermalApply = mkCompute(THERMAL_APPLY, this.layouts.erode);
    this.pipelines.analysis = mkCompute(ANALYSIS, this.layouts.analysis);

    const pl = dev.createPipelineLayout({ bindGroupLayouts: [this.layouts.render] });
    const mkRender = (code: string, opts: { blend?: boolean; depthWrite: boolean; depthCompare: GPUCompareFunction; topology?: GPUPrimitiveTopology }) =>
      dev.createRenderPipeline({
        layout: pl,
        vertex: { module: this.module(code, 'render-vs'), entryPoint: 'vs' },
        fragment: {
          module: this.module(code, 'render-fs'), entryPoint: 'fs',
          targets: [{
            format: this.format,
            blend: opts.blend ? {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            } : undefined,
          }],
        },
        primitive: { topology: opts.topology ?? 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: opts.depthWrite, depthCompare: opts.depthCompare },
        multisample: { count: 4 },
      });

    this.renderPipes.sky = mkRender(SKY_SHADER, { depthWrite: false, depthCompare: 'always' });
    this.renderPipes.terrain = mkRender(TERRAIN_SHADER, { depthWrite: true, depthCompare: 'less' });
    this.renderPipes.terrainWire = mkRender(TERRAIN_SHADER, { depthWrite: true, depthCompare: 'less', topology: 'line-list' });
    this.renderPipes.water = mkRender(WATER_SHADER, { blend: true, depthWrite: false, depthCompare: 'less' });
  }

  private buildBindGroups() {
    const dev = this.device;
    const B = (name: string) => ({ buffer: this.buffers[name] });
    this.bindGroups.gen = dev.createBindGroup({
      layout: this.layouts.gen,
      entries: [
        { binding: 0, resource: { buffer: this.genU } },
        { binding: 1, resource: B('height') },
        { binding: 2, resource: B('hardness') },
      ],
    });
    this.bindGroups.erode = dev.createBindGroup({
      layout: this.layouts.erode,
      entries: [
        { binding: 0, resource: { buffer: this.eroU } },
        { binding: 1, resource: B('height') },
        { binding: 2, resource: B('water') },
        { binding: 3, resource: B('sediment') },
        { binding: 4, resource: B('sedimentTmp') },
        { binding: 5, resource: B('flux') },
        { binding: 6, resource: B('vel') },
        { binding: 7, resource: B('hardness') },
        { binding: 8, resource: B('deposited') },
        { binding: 9, resource: B('eroded') },
        { binding: 10, resource: B('delta') },
      ],
    });
    this.bindGroups.analysis = dev.createBindGroup({
      layout: this.layouts.analysis,
      entries: [
        { binding: 0, resource: { buffer: this.anaU } },
        { binding: 1, resource: B('height') },
        { binding: 2, resource: B('water') },
        { binding: 3, resource: B('deposited') },
        { binding: 4, resource: B('eroded') },
        { binding: 5, resource: B('hardness') },
        { binding: 6, resource: this.nrmAo.createView() },
        { binding: 7, resource: this.masks.createView() },
      ],
    });
    this.bindGroups.render = dev.createBindGroup({
      layout: this.layouts.render,
      entries: [
        { binding: 0, resource: { buffer: this.renU } },
        { binding: 1, resource: B('height') },
        { binding: 2, resource: B('water') },
        { binding: 3, resource: this.nrmAo.createView() },
        { binding: 4, resource: this.masks.createView() },
        { binding: 5, resource: this.sampler },
      ],
    });
  }

  /* ------------------------------- passes ------------------------------- */

  private dispatch(enc: GPUCommandEncoder, pipe: GPUComputePipeline, group: GPUBindGroup) {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    const g = Math.ceil(this.res / 8);
    pass.dispatchWorkgroups(g, g);
    pass.end();
  }

  /** Evaluate the terrain layer stack (and the rock-hardness field). */
  generate(world: WorldSettings, layerData: Float32Array, layerCount: number) {
    const head = new ArrayBuffer(32);
    const u = new Uint32Array(head); const f = new Float32Array(head);
    u[0] = this.res; u[1] = layerCount; u[2] = world.seed >>> 0; u[3] = 0;
    f[4] = world.worldSize; f[5] = world.strataScale; f[6] = world.strataContrast; f[7] = world.strataTilt;
    this.device.queue.writeBuffer(this.genU, 0, head);
    this.device.queue.writeBuffer(this.genU, 32, layerData);

    const zeros = new Float32Array(this.res * this.res);
    for (const name of ['water', 'sediment', 'sedimentTmp', 'deposited', 'eroded', 'delta']) {
      this.device.queue.writeBuffer(this.buffers[name], 0, zeros);
    }
    this.device.queue.writeBuffer(this.buffers.flux, 0, new Float32Array(this.res * this.res * 4));
    this.device.queue.writeBuffer(this.buffers.vel, 0, new Float32Array(this.res * this.res * 2));

    const enc = this.device.createCommandEncoder();
    this.dispatch(enc, this.pipelines.gen, this.bindGroups.gen);
    this.device.queue.submit([enc.finish()]);
    this.erosionDone = 0;
  }

  private writeErosionUniforms(e: ErosionSettings, world: WorldSettings, iter: number) {
    const buf = new ArrayBuffer(96);
    const u = new Uint32Array(buf); const f = new Float32Array(buf);
    u[0] = this.res; u[1] = iter; u[2] = 0; u[3] = 0;
    const cell = world.worldSize / this.res;
    f[4] = cell / world.heightScale;     // cell size in "height units" keeps slopes scale-correct
    f[5] = e.dt; f[6] = e.rain; f[7] = e.evaporation;
    f[8] = e.capacity; f[9] = e.dissolve; f[10] = e.deposit; f[11] = e.minSlope;
    f[12] = e.gravity; f[13] = e.pipeArea; f[14] = e.hardnessInfluence; f[15] = e.inertia;
    f[16] = e.talus; f[17] = e.thermalRate; f[18] = e.rainSpotScale; f[19] = e.rainSpotAmount;
    f[20] = world.seaLevel; f[21] = 0; f[22] = 0; f[23] = 0;
    this.device.queue.writeBuffer(this.eroU, 0, buf);
  }

  /** Step the erosion simulation `steps` iterations. */
  erode(e: ErosionSettings, world: WorldSettings, steps: number) {
    const enc = this.device.createCommandEncoder();
    for (let i = 0; i < steps; i++) {
      this.writeErosionUniforms(e, world, this.erosionDone + i);
      this.dispatch(enc, this.pipelines.flux, this.bindGroups.erode);
      this.dispatch(enc, this.pipelines.erode, this.bindGroups.erode);
      this.dispatch(enc, this.pipelines.transport, this.bindGroups.erode);
      this.dispatch(enc, this.pipelines.commit, this.bindGroups.erode);
      if (e.thermalEvery > 0 && (this.erosionDone + i) % e.thermalEvery === 0) {
        this.dispatch(enc, this.pipelines.thermalCalc, this.bindGroups.erode);
        this.dispatch(enc, this.pipelines.thermalApply, this.bindGroups.erode);
      }
    }
    this.device.queue.submit([enc.finish()]);
    this.erosionDone += steps;
  }

  /** Bake normals, horizon AO, curvature and the wetness / sediment masks. */
  analyze(world: WorldSettings) {
    const buf = new ArrayBuffer(48);
    const u = new Uint32Array(buf); const f = new Float32Array(buf);
    u[0] = this.res; u[1] = world.aoDirs; u[2] = world.aoSteps; u[3] = 0;
    f[4] = world.worldSize; f[5] = world.heightScale; f[6] = world.aoRadius; f[7] = world.flowGain;
    f[8] = world.depGain; f[9] = world.eroGain; f[10] = world.seaLevel; f[11] = 0;
    this.device.queue.writeBuffer(this.anaU, 0, buf);
    const enc = this.device.createCommandEncoder();
    this.dispatch(enc, this.pipelines.analysis, this.bindGroups.analysis);
    this.device.queue.submit([enc.finish()]);
  }

  /* ------------------------------- render ------------------------------- */

  resize(w: number, h: number) {
    if (w === this.canvasSize[0] && h === this.canvasSize[1]) return;
    this.canvasSize = [w, h];
    this.msaa?.destroy(); this.depth?.destroy();
    this.msaa = this.device.createTexture({
      size: [w, h], sampleCount: 4, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depth = this.device.createTexture({
      size: [w, h], sampleCount: 4, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  render(
    viewProj: Float32Array, camPos: [number, number, number], camBasis: number[],
    world: WorldSettings, rs: RenderSettings, matData: Float32Array, matCount: number, time: number,
  ) {
    const head = new Float32Array(64 / 4 + 8 * 4);
    head.set(viewProj, 0);
    let o = 16;
    head.set([camPos[0], camPos[1], camPos[2], 1], o); o += 4;
    const az = rs.sunAzimuth * Math.PI / 180, el = rs.sunElevation * Math.PI / 180;
    const sun: [number, number, number] = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    head.set([...sun, rs.sunIntensity], o); o += 4;
    head.set([...rs.sunColor, 1], o); o += 4;
    head.set([...rs.zenith, rs.ambient], o); o += 4;
    head.set([...rs.horizon, rs.bounce], o); o += 4;
    head.set([world.worldSize, world.heightScale, this.res, this.gridN], o); o += 4;
    head.set([time, rs.shadowSteps, world.seaLevel, rs.exposure], o); o += 4;
    head.set([rs.shadingMode, matCount, rs.detail, rs.fog], o);
    this.device.queue.writeBuffer(this.renU, 0, head);
    this.device.queue.writeBuffer(this.renU, 64 + 16 * 8, matData);
    // camera basis for the sky (slots 64..67 of the mats array)
    this.device.queue.writeBuffer(this.renU, 64 + 16 * 8 + 64 * 16, new Float32Array(camBasis));

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.msaa!.createView(),
        resolveTarget: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.03, b: 0.04, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depth!.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.bindGroups.render);
    pass.setPipeline(this.renderPipes.sky);
    pass.draw(3);
    pass.setPipeline(rs.wireframe ? this.renderPipes.terrainWire : this.renderPipes.terrain);
    const quads = (this.gridN - 1) * (this.gridN - 1);
    pass.draw(quads * 6);
    if (rs.showWater) {
      pass.setPipeline(this.renderPipes.water);
      pass.draw(quads * 6);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  /* ------------------------------- export ------------------------------- */

  async readBuffer(name: string): Promise<Float32Array> {
    const size = this.res * this.res * 4;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buffers[name], 0, staging, 0, size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return out;
  }
}
