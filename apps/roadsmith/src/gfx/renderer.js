// WebGPU renderer: shadowed forward pass into an MSAA HDR target, then a graded resolve.
// Only this file (plus ui/ and main.js) knows about the GPU or the DOM.

import { SURFACE_WGSL } from './shaders/surface.js';
import { SKY_WGSL } from './shaders/sky.js';
import { POST_WGSL } from './shaders/post.js';
import { OVERLAY_WGSL, WIRE_WGSL } from './shaders/overlay.js';
import { packMaterials, MATERIAL_SLOTS, MATERIAL_FLOATS } from './materials.js';
import { FLOATS_PER_VERTEX, quadWireIndices } from '../core/mesh.js';
import { sunMatrix } from '../core/camera.js';

const VERTEX_BYTES = FLOATS_PER_VERTEX * 4;      // 80
const INSTANCE_FLOATS = 12;
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;      // 48
const MAX_LIGHTS = 48;
const SIGNAL_GROUPS = 24;
const GLOBAL_FLOATS = 16 * 3 + 4 * 9;            // 3 mat4 + 9 vec4 = 84 floats / 336 B
const SHADOW_SIZE = 2048;
const HDR_FORMAT = 'rgba16float';
const SAMPLE_COUNT = 4;

export const GPU_UNSUPPORTED = 'WebGPU is not available in this browser.';

export class Renderer {
  static supported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  static async create(canvas) {
    if (!Renderer.supported()) throw new Error(GPU_UNSUPPORTED);
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No suitable GPU adapter was found.');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 512 * 1024 * 1024),
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      },
    });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not acquire a WebGPU canvas context.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    return new Renderer({ device, context, format, canvas, adapter });
  }

  constructor({ device, context, format, canvas, adapter }) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.adapterInfo = adapter.info || {};
    this.pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.width = 1; this.height = 1;
    this.layers = new Map();          // id -> {vbo, ibo, indexCount, wireIbo, wireCount, visible, mesh}
    this.instanced = new Map();       // key -> {vbo, ibo, indexCount, buffer, capacity, count, visible}
    this.lightSources = [];
    this.signalStates = new Float32Array(SIGNAL_GROUPS * 4);
    this.wireframe = false;
    this.overlayAlpha = 1;
    this.stats = { draws: 0, tris: 0, instances: 0, gpuMs: 0 };
    this._buildStaticResources();
  }

  // ------------------------------------------------------------------ setup
  _buildStaticResources() {
    const d = this.device;
    this.globalBuf = d.createBuffer({ size: GLOBAL_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.globalData = new Float32Array(GLOBAL_FLOATS);
    this.materialBuf = d.createBuffer({ size: MATERIAL_SLOTS * MATERIAL_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.materialData = new Float32Array(MATERIAL_SLOTS * MATERIAL_FLOATS);
    this.lightBuf = d.createBuffer({ size: MAX_LIGHTS * 8 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lightData = new Float32Array(MAX_LIGHTS * 8);
    this.signalBuf = d.createBuffer({ size: SIGNAL_GROUPS * 4 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postBuf = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.postData = new Float32Array(8);
    this.overlayUniform = d.createBuffer({ size: 4 * (16 + 4 + 4), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.overlayUniformData = new Float32Array(16 + 4 + 4);

    this.shadowTex = d.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      label: 'sun-shadow',
    });
    this.shadowView = this.shadowTex.createView();
    // a 1x1 stand-in bound during the shadow pass: a texture may not be sampled and
    // written in the same pass, so the shadow bind group points at this instead.
    this.dummyShadowTex = d.createTexture({
      size: [1, 1], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'shadow-dummy',
    });
    this.dummyShadowView = this.dummyShadowTex.createView();
    this.shadowSampler = d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.linearSampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const sceneLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.sceneBindGroup = d.createBindGroup({
      layout: sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: this.globalBuf } },
        { binding: 1, resource: { buffer: this.materialBuf } },
        { binding: 2, resource: { buffer: this.lightBuf } },
        { binding: 3, resource: { buffer: this.signalBuf } },
        { binding: 4, resource: this.shadowView },
        { binding: 5, resource: this.shadowSampler },
      ],
    });
    this.shadowBindGroup = d.createBindGroup({
      layout: sceneLayout,
      entries: [
        { binding: 0, resource: { buffer: this.globalBuf } },
        { binding: 1, resource: { buffer: this.materialBuf } },
        { binding: 2, resource: { buffer: this.lightBuf } },
        { binding: 3, resource: { buffer: this.signalBuf } },
        { binding: 4, resource: this.dummyShadowView },
        { binding: 5, resource: this.shadowSampler },
      ],
    });
    const scenePipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [sceneLayout] });

    const surfaceModule = d.createShaderModule({ code: SURFACE_WGSL, label: 'surface' });
    const skyModule = d.createShaderModule({ code: SKY_WGSL, label: 'sky' });
    const postModule = d.createShaderModule({ code: POST_WGSL, label: 'post' });
    const overlayModule = d.createShaderModule({ code: OVERLAY_WGSL, label: 'overlay' });
    const wireModule = d.createShaderModule({ code: WIRE_WGSL, label: 'wire' });

    const vertexBuffer = {
      arrayStride: VERTEX_BYTES,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x3' },
        { shaderLocation: 3, offset: 36, format: 'float32x2' },
        { shaderLocation: 4, offset: 44, format: 'float32x4' },
        { shaderLocation: 5, offset: 60, format: 'float32x4' },
      ],
    };
    const instanceBuffer = {
      arrayStride: INSTANCE_BYTES,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 6, offset: 0, format: 'float32x4' },
        { shaderLocation: 7, offset: 16, format: 'float32x4' },
        { shaderLocation: 8, offset: 32, format: 'float32x4' },
      ],
    };

    const depthStencil = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    const target = [{ format: HDR_FORMAT }];

    this.pipeStatic = d.createRenderPipeline({
      label: 'surface-static', layout: scenePipelineLayout,
      vertex: { module: surfaceModule, entryPoint: 'vs_static', buffers: [vertexBuffer] },
      fragment: { module: surfaceModule, entryPoint: 'fs_main', targets: target },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample: { count: SAMPLE_COUNT },
    });
    this.pipeInstanced = d.createRenderPipeline({
      label: 'surface-instanced', layout: scenePipelineLayout,
      vertex: { module: surfaceModule, entryPoint: 'vs_instanced', buffers: [vertexBuffer, instanceBuffer] },
      fragment: { module: surfaceModule, entryPoint: 'fs_main', targets: target },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample: { count: SAMPLE_COUNT },
    });
    this.pipeSky = d.createRenderPipeline({
      label: 'sky', layout: scenePipelineLayout,
      vertex: { module: skyModule, entryPoint: 'vs_main' },
      fragment: { module: skyModule, entryPoint: 'fs_main', targets: target },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: SAMPLE_COUNT },
    });
    this.pipeShadow = d.createRenderPipeline({
      label: 'shadow-static', layout: scenePipelineLayout,
      vertex: { module: surfaceModule, entryPoint: 'vs_shadow', buffers: [vertexBuffer] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.4 },
    });
    this.pipeShadowInst = d.createRenderPipeline({
      label: 'shadow-instanced', layout: scenePipelineLayout,
      vertex: { module: surfaceModule, entryPoint: 'vs_shadow_inst', buffers: [vertexBuffer, instanceBuffer] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.4 },
    });

    const overlayLayout = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.overlayBindGroup = d.createBindGroup({
      layout: overlayLayout, entries: [{ binding: 0, resource: { buffer: this.overlayUniform } }],
    });
    const overlayPipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [overlayLayout] });
    const blend = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const overlayVertex = {
      arrayStride: 28,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x4' },
      ],
    };
    const mkOverlay = (topology, depthCompare, label) => d.createRenderPipeline({
      label, layout: overlayPipelineLayout,
      vertex: { module: overlayModule, entryPoint: 'vs_main', buffers: [overlayVertex] },
      fragment: { module: overlayModule, entryPoint: 'fs_main', targets: [{ format: HDR_FORMAT, blend }] },
      primitive: { topology },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare },
      multisample: { count: SAMPLE_COUNT },
    });
    this.pipeLines = mkOverlay('line-list', 'less-equal', 'overlay-lines');
    this.pipeLinesTop = mkOverlay('line-list', 'always', 'overlay-lines-top');
    this.pipeTris = mkOverlay('triangle-list', 'less-equal', 'overlay-tris');
    this.pipeTrisTop = mkOverlay('triangle-list', 'always', 'overlay-tris-top');

    this.pipeWire = d.createRenderPipeline({
      label: 'wireframe', layout: overlayPipelineLayout,
      vertex: {
        module: wireModule, entryPoint: 'vs_main',
        buffers: [{ arrayStride: VERTEX_BYTES, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
      },
      fragment: { module: wireModule, entryPoint: 'fs_main', targets: [{ format: HDR_FORMAT, blend }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: SAMPLE_COUNT },
    });

    const postLayout = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.postLayout = postLayout;
    this.pipePost = d.createRenderPipeline({
      label: 'post', layout: d.createPipelineLayout({ bindGroupLayouts: [postLayout] }),
      vertex: { module: postModule, entryPoint: 'vs_main' },
      fragment: { module: postModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.overlayVbo = null;
    this.overlayCapacity = 0;
  }

  resize(width, height) {
    const w = Math.max(1, Math.floor(width * this.pixelRatio));
    const h = Math.max(1, Math.floor(height * this.pixelRatio));
    if (w === this.width && h === this.height && this.colourTex) return;
    this.width = w; this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const d = this.device;
    this.colourTex?.destroy();
    this.resolveTex?.destroy();
    this.depthTex?.destroy();
    this.colourTex = d.createTexture({
      size: [w, h], format: HDR_FORMAT, sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT, label: 'hdr-msaa',
    });
    this.resolveTex = d.createTexture({
      size: [w, h], format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'hdr-resolve',
    });
    this.depthTex = d.createTexture({
      size: [w, h], format: 'depth24plus', sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT, label: 'depth',
    });
    this.colourView = this.colourTex.createView();
    this.resolveView = this.resolveTex.createView();
    this.depthView = this.depthTex.createView();
    this.postBindGroup = d.createBindGroup({
      layout: this.postLayout,
      entries: [
        { binding: 0, resource: { buffer: this.postBuf } },
        { binding: 1, resource: this.resolveView },
        { binding: 2, resource: this.linearSampler },
      ],
    });
  }

  // ------------------------------------------------------------------ scene data
  _uploadMesh(mesh, label) {
    const d = this.device;
    const vbo = d.createBuffer({ size: align4(mesh.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: `${label}-v` });
    d.queue.writeBuffer(vbo, 0, mesh.vertices);
    const ibo = d.createBuffer({ size: align4(mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `${label}-i` });
    d.queue.writeBuffer(ibo, 0, mesh.indices);
    return { vbo, ibo, indexCount: mesh.indices.length };
  }

  /** Replace every GPU buffer with a freshly generated scene. */
  setScene(scene, { wireLayers = ['surface'] } = {}) {
    this.disposeScene();
    this.scene = scene;
    for (const layer of scene.layers) {
      if (!layer.mesh || layer.mesh.indices.length === 0) continue;
      const gpu = this._uploadMesh(layer.mesh, layer.id);
      gpu.visible = layer.visible !== false;
      gpu.mesh = layer.mesh;
      if (wireLayers.includes(layer.id) || wireLayers.includes('*')) {
        const wire = quadWireIndices(layer.mesh.quads);
        if (wire.length) {
          const wIbo = this.device.createBuffer({
            size: align4(wire.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `${layer.id}-wire`,
          });
          this.device.queue.writeBuffer(wIbo, 0, wire);
          gpu.wireIbo = wIbo;
          gpu.wireCount = wire.length;
        }
      }
      this.layers.set(layer.id, gpu);
    }
    // instanced groups
    const addGroup = (key, meshObj, capacity, layerId) => {
      if (!meshObj || !capacity) return;
      const gpu = this._uploadMesh(meshObj, key);
      gpu.capacity = capacity;
      gpu.count = 0;
      gpu.layerId = layerId;
      gpu.data = new Float32Array(capacity * INSTANCE_FLOATS);
      gpu.buffer = this.device.createBuffer({
        size: capacity * INSTANCE_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: `${key}-inst`,
      });
      this.instanced.set(key, gpu);
    };
    for (const [name, v] of Object.entries(scene.vehicleMeshes)) {
      addGroup(`car:${name}`, v.mesh, 32, 'traffic');
      addGroup(`parked:${name}`, v.mesh, 64, 'parked');
    }
    addGroup('wheel', scene.wheelMesh, 128, 'traffic');
    addGroup('parkedwheel', scene.wheelMesh, 400, 'parked');
    if (scene.trainMesh) addGroup('train', scene.trainMesh, 12, 'trains');
    if (scene.boomMesh) addGroup('boom', scene.boomMesh, 24, 'crossing');
    this.lightSources = scene.props.lights || [];
    this.setMaterialsFromChannels(scene.channels);
  }

  disposeScene() {
    for (const l of this.layers.values()) {
      l.vbo.destroy(); l.ibo.destroy(); l.wireIbo?.destroy();
    }
    this.layers.clear();
    for (const g of this.instanced.values()) {
      g.vbo.destroy(); g.ibo.destroy(); g.buffer.destroy();
    }
    this.instanced.clear();
    this.scene = null;
  }

  setLayerVisible(id, visible) {
    const l = this.layers.get(id);
    if (l) l.visible = visible;
    for (const g of this.instanced.values()) if (g.layerId === id) g.visible = visible;
    this._instancedVisibility = this._instancedVisibility || {};
    this._instancedVisibility[id] = visible;
  }

  setMaterialsFromChannels(channels) {
    if (!channels) return;
    packMaterials(channels, this.materialData);
    this.device.queue.writeBuffer(this.materialBuf, 0, this.materialData);
  }

  setSignalStates(groups) {
    // groups: array of {red, amber, green, ped}
    this.signalStates.fill(0);
    for (let i = 0; i < Math.min(groups.length, SIGNAL_GROUPS); i++) {
      const g = groups[i];
      this.signalStates[i * 4] = g.red ?? 0;
      this.signalStates[i * 4 + 1] = g.amber ?? 0;
      this.signalStates[i * 4 + 2] = g.green ?? 0;
      this.signalStates[i * 4 + 3] = g.ped ?? 0;
    }
    this.device.queue.writeBuffer(this.signalBuf, 0, this.signalStates);
  }

  /** Fill an instance group from a list of poses. */
  setInstances(key, poses) {
    const g = this.instanced.get(key);
    if (!g) return;
    const n = Math.min(poses.length, g.capacity);
    const data = g.data;
    for (let i = 0; i < n; i++) {
      const p = poses[i];
      const o = i * INSTANCE_FLOATS;
      data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z; data[o + 3] = p.yaw || 0;
      const c = p.colour || [0.8, 0.8, 0.8];
      data[o + 4] = c[0]; data[o + 5] = c[1]; data[o + 6] = c[2]; data[o + 7] = p.variant || 0;
      data[o + 8] = p.spin || 0; data[o + 9] = p.scale ?? 1; data[o + 10] = p.lift || 0; data[o + 11] = p.emissive ?? 0;
    }
    g.count = n;
    if (n) this.device.queue.writeBuffer(g.buffer, 0, data, 0, n * INSTANCE_FLOATS);
  }

  // ------------------------------------------------------------------ frame
  _updateLights(camera, env) {
    const cam = camera.position;
    const pool = this.lightSources;
    const night = env.night ?? 0;
    const lit = night > 0.02;
    let n = 0;
    if (lit && pool.length) {
      // nearest-first selection, cheap partial sort
      const scored = [];
      for (const l of pool) {
        const dx = l.p.x - cam.x, dz = l.p.z - cam.z, dy = l.p.y - cam.y;
        scored.push({ l, d2: dx * dx + dy * dy + dz * dz });
      }
      scored.sort((a, b) => a.d2 - b.d2);
      n = Math.min(MAX_LIGHTS, scored.length);
      for (let i = 0; i < n; i++) {
        const { l } = scored[i];
        const o = i * 8;
        this.lightData[o] = l.p.x; this.lightData[o + 1] = l.p.y; this.lightData[o + 2] = l.p.z;
        this.lightData[o + 3] = l.range ?? 22;
        const c = l.colour || [1, 0.86, 0.68];
        this.lightData[o + 4] = c[0]; this.lightData[o + 5] = c[1]; this.lightData[o + 6] = c[2];
        this.lightData[o + 7] = (l.intensity ?? 30) * night;
      }
    }
    this.lightCount = n;
    if (n) this.device.queue.writeBuffer(this.lightBuf, 0, this.lightData, 0, n * 8);
  }

  _writeGlobals(camera, env, time, selection) {
    const g = this.globalData;
    g.set(camera.viewProj, 0);
    const az = env.sunAzimuth, el = env.sunElevation;
    const sun = { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
    const focus = camera.target;
    const radius = Math.min(Math.max(camera.distance * 1.35, 70), 420);
    this.shadowRadius = radius;
    const sunVP = this._sunVP || (this._sunVP = new Float32Array(16));
    sunMatrix(sunVP, sun, { x: focus.x, y: 0, z: focus.z }, radius);
    g.set(sunVP, 16);
    g.set(camera.invViewProj, 32);
    const o = 48;
    g[o] = camera.position.x; g[o + 1] = camera.position.y; g[o + 2] = camera.position.z; g[o + 3] = time;
    g[o + 4] = sun.x; g[o + 5] = sun.y; g[o + 6] = sun.z; g[o + 7] = env.sunIntensity;
    g[o + 8] = env.sunColour[0]; g[o + 9] = env.sunColour[1]; g[o + 10] = env.sunColour[2]; g[o + 11] = env.ambient;
    g[o + 12] = env.zenith[0]; g[o + 13] = env.zenith[1]; g[o + 14] = env.zenith[2]; g[o + 15] = env.exposure;
    g[o + 16] = env.horizon[0]; g[o + 17] = env.horizon[1]; g[o + 18] = env.horizon[2]; g[o + 19] = env.bounce;
    g[o + 20] = env.wetness; g[o + 21] = env.wearGain ?? 1; g[o + 22] = 1 / SHADOW_SIZE; g[o + 23] = this.lightCount || 0;
    g[o + 24] = selection ? 1 : 0; g[o + 25] = env.markings === false ? 0 : 1; g[o + 26] = env.night ?? 0; g[o + 27] = env.shadow ?? 0.8;
    g[o + 28] = env.fog[0]; g[o + 29] = env.fog[1]; g[o + 30] = env.fog[2]; g[o + 31] = env.fogDensity;
    if (selection) {
      g[o + 32] = selection.x; g[o + 33] = selection.y; g[o + 34] = selection.z; g[o + 35] = selection.radius;
    } else {
      g[o + 32] = 0; g[o + 33] = 0; g[o + 34] = 0; g[o + 35] = 0;
    }
    this.device.queue.writeBuffer(this.globalBuf, 0, g);

    this.postData[0] = env.exposure; this.postData[1] = env.vignette ?? 0.38;
    this.postData[2] = env.grain ?? 0.016; this.postData[3] = time;
    this.postData[4] = env.lift ?? 0; this.postData[5] = env.gamma ?? 1.0;
    this.postData[6] = env.saturation ?? 1; this.postData[7] = env.contrast ?? 1.05;
    this.device.queue.writeBuffer(this.postBuf, 0, this.postData);

    this.overlayUniformData.set(camera.viewProj, 0);
    this.overlayUniformData[16] = camera.position.x;
    this.overlayUniformData[17] = camera.position.y;
    this.overlayUniformData[18] = camera.position.z;
    this.overlayUniformData[19] = 1;
    this.overlayUniformData[20] = 1;           // depth bias multiplier
    this.overlayUniformData[21] = time;
    this.overlayUniformData[22] = this.pixelRatio;
    this.overlayUniformData[23] = this.overlayAlpha;
    this.device.queue.writeBuffer(this.overlayUniform, 0, this.overlayUniformData);
  }

  /** overlay: {lines: Float32Array, lineCount, tris: Float32Array, triCount, topLines, topTris} */
  _uploadOverlay(overlay) {
    if (!overlay) return null;
    const total = (overlay.lineCount || 0) + (overlay.triCount || 0);
    if (!total) return null;
    const floats = total * 7;
    if (!this.overlayVbo || this.overlayCapacity < floats) {
      this.overlayVbo?.destroy();
      this.overlayCapacity = Math.max(floats * 2, 4096);
      this.overlayVbo = this.device.createBuffer({
        size: this.overlayCapacity * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'overlay',
      });
    }
    const buf = new Float32Array(floats);
    if (overlay.lineCount) buf.set(overlay.lines.subarray(0, overlay.lineCount * 7), 0);
    if (overlay.triCount) buf.set(overlay.tris.subarray(0, overlay.triCount * 7), overlay.lineCount * 7);
    this.device.queue.writeBuffer(this.overlayVbo, 0, buf);
    return { lineStart: 0, lineCount: overlay.lineCount || 0, triStart: overlay.lineCount || 0, triCount: overlay.triCount || 0 };
  }

  render({ camera, env, time, overlay, selection, wireframe, hiddenLayers }) {
    if (!this.scene) return;
    this._updateLights(camera, env);
    this._writeGlobals(camera, env, time, selection);
    const ov = this._uploadOverlay(overlay);
    const d = this.device;
    const encoder = d.createCommandEncoder();
    const hidden = hiddenLayers || new Set();
    this.stats.draws = 0; this.stats.tris = 0; this.stats.instances = 0;

    const visibleLayers = [];
    for (const [id, l] of this.layers) {
      if (hidden.has(id) || !l.visible) continue;
      visibleLayers.push(l);
    }
    const visibleInstanced = [];
    for (const [key, g] of this.instanced) {
      if (!g.count || hidden.has(g.layerId)) continue;
      visibleInstanced.push(g);
    }

    // ---------------------------------------------------------- shadow pass
    if ((env.shadow ?? 0.8) > 0.01) {
      const pass = encoder.beginRenderPass({
        label: 'shadow',
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this.pipeShadow);
      pass.setBindGroup(0, this.shadowBindGroup);
      for (const l of visibleLayers) {
        pass.setVertexBuffer(0, l.vbo);
        pass.setIndexBuffer(l.ibo, 'uint32');
        pass.drawIndexed(l.indexCount);
      }
      pass.setPipeline(this.pipeShadowInst);
      for (const g of visibleInstanced) {
        pass.setVertexBuffer(0, g.vbo);
        pass.setVertexBuffer(1, g.buffer);
        pass.setIndexBuffer(g.ibo, 'uint32');
        pass.drawIndexed(g.indexCount, g.count);
      }
      pass.end();
    }

    // ---------------------------------------------------------- main pass
    const pass = encoder.beginRenderPass({
      label: 'scene',
      colorAttachments: [{
        view: this.colourView, resolveTarget: this.resolveView,
        clearValue: { r: 0.02, g: 0.025, b: 0.03, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setBindGroup(0, this.sceneBindGroup);
    pass.setPipeline(this.pipeSky);
    pass.draw(3);
    this.stats.draws++;

    pass.setPipeline(this.pipeStatic);
    for (const l of visibleLayers) {
      pass.setVertexBuffer(0, l.vbo);
      pass.setIndexBuffer(l.ibo, 'uint32');
      pass.drawIndexed(l.indexCount);
      this.stats.draws++;
      this.stats.tris += l.indexCount / 3;
    }
    pass.setPipeline(this.pipeInstanced);
    for (const g of visibleInstanced) {
      pass.setVertexBuffer(0, g.vbo);
      pass.setVertexBuffer(1, g.buffer);
      pass.setIndexBuffer(g.ibo, 'uint32');
      pass.drawIndexed(g.indexCount, g.count);
      this.stats.draws++;
      this.stats.instances += g.count;
      this.stats.tris += (g.indexCount / 3) * g.count;
    }

    // quad wireframe over the road shell
    if (wireframe) {
      pass.setPipeline(this.pipeWire);
      pass.setBindGroup(0, this.overlayBindGroup);
      for (const l of visibleLayers) {
        if (!l.wireIbo) continue;
        pass.setVertexBuffer(0, l.vbo);
        pass.setIndexBuffer(l.wireIbo, 'uint32');
        pass.drawIndexed(l.wireCount);
        this.stats.draws++;
      }
    }

    // editor overlay (network graph, handles, gizmo)
    if (ov) {
      pass.setBindGroup(0, this.overlayBindGroup);
      pass.setVertexBuffer(0, this.overlayVbo);
      if (ov.lineCount) {
        pass.setPipeline(overlay.depthTest === false ? this.pipeLinesTop : this.pipeLines);
        pass.draw(ov.lineCount, 1, ov.lineStart);
        this.stats.draws++;
      }
      if (ov.triCount) {
        pass.setPipeline(overlay.depthTestTris === false ? this.pipeTrisTop : this.pipeTris);
        pass.draw(ov.triCount, 1, ov.triStart);
        this.stats.draws++;
      }
    }
    pass.end();

    // ---------------------------------------------------------- resolve + grade
    const post = encoder.beginRenderPass({
      label: 'post',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
    });
    post.setPipeline(this.pipePost);
    post.setBindGroup(0, this.postBindGroup);
    post.draw(3);
    post.end();

    d.queue.submit([encoder.finish()]);
  }
}

function align4(n) { return Math.ceil(n / 4) * 4; }
