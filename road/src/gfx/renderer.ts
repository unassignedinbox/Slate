/** WebGPU device, pipelines and frame submission. Nothing road-specific. */
import { SHADER } from './shader';
import { M4 } from '../core/vec';

export interface GpuMesh { vbo: GPUBuffer; ibo: GPUBuffer; count: number }
export interface LineMesh { vbo: GPUBuffer; count: number }

export class Renderer {
  device!: GPUDevice;
  ctx!: GPUCanvasContext;
  format!: GPUTextureFormat;
  pipe!: GPURenderPipeline;
  linePipe!: GPURenderPipeline;
  ubo!: GPUBuffer;
  bind!: GPUBindGroup;
  depth!: GPUTexture;
  msaa!: GPUTexture;
  readonly sampleCount = 4;
  private uData = new Float32Array(128);

  static async supported(): Promise<string | null> {
    if (!('gpu' in navigator)) return 'navigator.gpu is missing — this build needs WebGPU (Chrome/Edge 113+, or Safari 18+).';
    const a = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
    if (!a) return 'No WebGPU adapter. The browser knows the API but could not get a GPU.';
    return null;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const gpu = (navigator as Navigator & { gpu: GPU }).gpu;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('requestAdapter returned null');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    this.ctx = canvas.getContext('webgpu') as unknown as GPUCanvasContext;
    this.format = gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.device.pushErrorScope('validation');
    const mod = this.device.createShaderModule({ code: SHADER });
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) {
      throw new Error('WGSL compile error:\n' + errs
        .map((m) => `  line ${m.lineNum}:${m.linePos}  ${m.message}`).join('\n'));
    }

    this.ubo = this.device.createBuffer({
      size: this.uData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const layout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    this.bind = this.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.ubo } }] });
    const pl = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });

    this.pipe = this.device.createRenderPipeline({
      layout: pl,
      vertex: {
        module: mod, entryPoint: 'vs',
        buffers: [{
          arrayStride: 64,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x2' },
            { shaderLocation: 3, offset: 32, format: 'float32x4' },
            { shaderLocation: 4, offset: 48, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: this.sampleCount },
    });

    this.linePipe = this.device.createRenderPipeline({
      layout: pl,
      vertex: {
        module: mod, entryPoint: 'vsLine',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module: mod, entryPoint: 'fsLine', targets: [{ format: this.format }] },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample: { count: this.sampleCount },
    });
    const err = await this.device.popErrorScope();
    if (err) throw new Error('WebGPU validation: ' + err.message);
  }

  resize(w: number, h: number): void {
    const d = this.device;
    this.depth?.destroy();
    this.msaa?.destroy();
    this.depth = d.createTexture({
      size: [w, h], format: 'depth24plus', sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaa = d.createTexture({
      size: [w, h], format: this.format, sampleCount: this.sampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  upload(verts: Float32Array, idx: Uint32Array): GpuMesh {
    const d = this.device;
    const vbo = d.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbo, 0, verts);
    const ibo = d.createBuffer({ size: Math.max(4, idx.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(ibo, 0, idx);
    return { vbo, ibo, count: idx.length };
  }

  uploadLines(data: Float32Array): LineMesh {
    const d = this.device;
    const vbo = d.createBuffer({ size: Math.max(24, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(vbo, 0, data);
    return { vbo, count: data.length / 6 };
  }

  setUniforms(vp: M4, cam: [number, number, number], sun: [number, number, number, number],
    misc: [number, number, number, number], tint: [number, number, number, number],
    layers: Float32Array): void {
    this.uData.set(vp, 0);
    this.uData.set(cam, 16); this.uData[19] = 1;
    this.uData.set(sun, 20);
    this.uData.set(misc, 24);
    this.uData.set(tint, 28);
    this.uData.set(layers.subarray(0, 64), 32);
    this.device.queue.writeBuffer(this.ubo, 0, this.uData);
  }

  frame(solid: GpuMesh | null, lines: LineMesh | null, clear: [number, number, number]): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.msaa.createView(),
        resolveTarget: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    if (solid && solid.count) {
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, this.bind);
      pass.setVertexBuffer(0, solid.vbo);
      pass.setIndexBuffer(solid.ibo, 'uint32');
      pass.drawIndexed(solid.count);
    }
    if (lines && lines.count) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.bind);
      pass.setVertexBuffer(0, lines.vbo);
      pass.draw(lines.count);
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }
}
