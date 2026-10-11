// Raw WebGPU renderer: static road/prop mesh, instanced vehicles, one directional
// shadow map, and a fullscreen sky. The camera and lighting live in one uniform block.
import { WGSL } from './shaders.js';

export const GLOBALS_FLOATS = 464;
export const OFF = {
  viewProj: 0, lightVP: 16, invVP: 32, camPos: 48, sunDir: 52, sunColor: 56,
  skyTop: 60, skyHorizon: 64, groundTint: 68, fog: 72, misc: 76, palette: 80, stacks: 208,
};
const SHADOW_SIZE = 2048;
const MODEL_STRIDE = 36;   // pos3 nrm3 mat uv ao  = 9 floats
const INST_STRIDE = 80;    // m0..m3 (16 floats) + paint + pad

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.staticVerts = 0;
    this.carVerts = 0;
    this.depth = null;
  }

  async init() {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was found.');
    const device = await adapter.requestDevice();
    this.device = device;
    device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    this.ctx = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: WGSL });
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new Error('Shader error: ' + errs.map((m) => `${m.lineNum}:${m.message}`).join('; '));

    const F = GPUShaderStage;
    this.globals = device.createBuffer({ size: GLOBALS_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowTex = device.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });

    const bgl0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F.VERTEX | F.FRAGMENT, buffer: { type: 'uniform' } }] });
    const bgl1 = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: F.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: F.FRAGMENT, sampler: { type: 'comparison' } },
    ] });
    this.bg0 = device.createBindGroup({ layout: bgl0, entries: [{ binding: 0, resource: { buffer: this.globals } }] });
    this.bg1 = device.createBindGroup({ layout: bgl1, entries: [
      { binding: 0, resource: this.shadowTex.createView() },
      { binding: 1, resource: this.shadowSampler },
    ] });
    const layoutMain = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
    const layoutShadow = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

    const modelBuf = {
      arrayStride: MODEL_STRIDE, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32' },
        { shaderLocation: 3, offset: 28, format: 'float32' },
        { shaderLocation: 4, offset: 32, format: 'float32' },
      ],
    };
    const instBuf = {
      arrayStride: INST_STRIDE, stepMode: 'instance', attributes: [
        { shaderLocation: 5, offset: 0, format: 'float32x4' },
        { shaderLocation: 6, offset: 16, format: 'float32x4' },
        { shaderLocation: 7, offset: 32, format: 'float32x4' },
        { shaderLocation: 8, offset: 48, format: 'float32x4' },
        { shaderLocation: 9, offset: 64, format: 'float32' },
      ],
    };
    const depthMain = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' };
    const target = [{ format: this.format }];
    const prim = { topology: 'triangle-list', cullMode: 'none' };

    this.pipeStatic = device.createRenderPipeline({
      layout: layoutMain,
      vertex: { module, entryPoint: 'vs_main', buffers: [modelBuf] },
      fragment: { module, entryPoint: 'fs_main', targets: target },
      primitive: prim, depthStencil: depthMain,
    });
    this.pipeInst = device.createRenderPipeline({
      layout: layoutMain,
      vertex: { module, entryPoint: 'vs_inst', buffers: [modelBuf, instBuf] },
      fragment: { module, entryPoint: 'fs_main', targets: target },
      primitive: prim, depthStencil: depthMain,
    });
    this.pipeSky = device.createRenderPipeline({
      layout: layoutMain,
      vertex: { module, entryPoint: 'vs_sky' },
      fragment: { module, entryPoint: 'fs_sky', targets: target },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'always' },
    });
    const shadowDepth = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 };
    this.pipeShadow = device.createRenderPipeline({
      layout: layoutShadow,
      vertex: { module, entryPoint: 'vs_shadow', buffers: [modelBuf] },
      primitive: prim, depthStencil: shadowDepth,
    });
    this.pipeShadowInst = device.createRenderPipeline({
      layout: layoutShadow,
      vertex: { module, entryPoint: 'vs_shadow_inst', buffers: [modelBuf, instBuf] },
      primitive: prim, depthStencil: shadowDepth,
    });
    this.instBuffer = null;
    this.instCapacity = 0;
    return this;
  }

  upload(data) {
    const buf = this.device.createBuffer({
      size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  setStatic(data) {
    this.staticBuf?.destroy();
    this.staticBuf = this.upload(data);
    this.staticVerts = data.length / 9;
  }

  setCarModel(data) {
    this.carBuf = this.upload(data);
    this.carVerts = data.length / 9;
  }

  ensureDepth(w, h) {
    if (this.depth && this.depth.width === w && this.depth.height === h) return;
    this.depth?.destroy();
    this.depth = this.device.createTexture({ size: [w, h], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  // globals: Float32Array(GLOBALS_FLOATS). instances: Float32Array(count * 20) or null.
  render(globals, instances, count, shadows) {
    const device = this.device;
    const w = this.canvas.width, h = this.canvas.height;
    this.ensureDepth(w, h);
    device.queue.writeBuffer(this.globals, 0, globals);
    let instBuf = null;
    if (instances && count > 0) {
      if (!this.instBuffer || this.instCapacity < count) {
        this.instBuffer?.destroy();
        this.instCapacity = Math.max(32, count * 2);
        this.instBuffer = device.createBuffer({ size: this.instCapacity * INST_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      device.queue.writeBuffer(this.instBuffer, 0, instances, 0, count * INST_STRIDE / 4);
      instBuf = this.instBuffer;
    }
    const enc = device.createCommandEncoder();

    if (shadows && this.staticVerts) {
      const sp = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      sp.setBindGroup(0, this.bg0);
      sp.setPipeline(this.pipeShadow);
      sp.setVertexBuffer(0, this.staticBuf);
      sp.draw(this.staticVerts);
      if (instBuf && this.carVerts) {
        sp.setPipeline(this.pipeShadowInst);
        sp.setVertexBuffer(0, this.carBuf);
        sp.setVertexBuffer(1, instBuf);
        sp.draw(this.carVerts, count);
      }
      sp.end();
    }

    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1);
    pass.setPipeline(this.pipeSky);
    pass.draw(3);
    if (this.staticVerts) {
      pass.setPipeline(this.pipeStatic);
      pass.setVertexBuffer(0, this.staticBuf);
      pass.draw(this.staticVerts);
    }
    if (instBuf && this.carVerts) {
      pass.setPipeline(this.pipeInst);
      pass.setVertexBuffer(0, this.carBuf);
      pass.setVertexBuffer(1, instBuf);
      pass.draw(this.carVerts, count);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }
}
