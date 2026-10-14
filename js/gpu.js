//============================================================================================================================================
//                                                                GPU.JS
//============================================================================================================================================
// 📦 WebGPU orchestration for the SDF GI pipeline. Owns every buffer/texture/pipeline/bind-group and the
//    per-frame pass order:
//
//      (init)  mesh-SDF bake → static mesh-card capture → first field fills (amortized afterwards)
//      (frame) dynamic card capture → GDF tile builds (per clipmap queue) → surface-cache relight
//              (amortized row band) → voxel light (amortized tile set) → G-buffer raster
//              → final gather (cone trace + history) → composite + debug views
//
//    No part of the field/lighting is evaluated on the CPU: the JS side only plans tile/coords and writes
//    small job records, exactly like a host engine would.

import { CLIPS } from "./gdfgrid.js";
import { loadWgslModule } from "./loader.js";

const ATLAS_TEX_DIM = [512, 512, 32];           // 2048-tile pool: 32x32x2 tiles of 16^3 voxels
const MESH_SDF_DIM = [160, 64, 64];
const SC_ATLAS = 1024;
const DINV = [0, 1, 2];

export async function requestGpu(canvas) {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  const device = await adapter.requestDevice();
  device.addEventListener?.("uncapturederror", (e) => console.error("[webgpu uncaptured]", e.error?.message ?? e));
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}

const tex = (device, size, format, usage, label) =>
  device.createTexture({ label, size: { width: size[0], height: size[1], depthOrArrayLayers: size[2] ?? 1 }, format, usage });
const buf = (device, size, usage, label) =>
  device.createBuffer({ label, size: Math.max(16, size), usage });

const U = globalThis.GPUBufferUsage;          // browser-only enums; guarded so tools can import this module in node
const T = globalThis.GPUTextureUsage;

export class SdfGiGpu {
  constructor(device, context, format, scene) {
    this.d = device;
    this.ctx = context;
    this.format = format;
    this.scene = scene;               // { objects, renderStream, cardSystem, staticSoups:[{..}x3], carManifest }
    this.frame = 0;
    this.captureSize = [960, 540];
    this.gatherScale = 0.67;
    this.stats = {};
    this.objectTf = new Float32Array(10 * 16);
    this.dynTfs = null;               // mat4 list for dynamic objects (5)
  }

  // -----------------------------------------------------------------------------------------------------------------
  async build() {
    const d = this.d, scene = this.scene;
    const [capW, capH] = this.captureSize;
    const gw = Math.max(160, Math.round(capW * this.gatherScale));
    const gh = Math.max(90, Math.round(capH * this.gatherScale));
    this.gatherSize = [gw, gh];

    // ---------------- buffers ----------------
    this.bFrame = buf(d, 352, U.UNIFORM | U.COPY_DST, "frameUBO");
    this.bField = buf(d, 48, U.UNIFORM | U.COPY_DST, "fieldUBO");
    this.bMaterials = buf(d, 16 * 48, U.STORAGE | U.COPY_DST, "materials");
    this.bTransforms = buf(d, 10 * 64, U.STORAGE | U.COPY_DST, "transforms");
    this.bCards = buf(d, 16384 * 64, U.STORAGE | U.COPY_DST, "cardsWorld");
    this.bCardInfo = buf(d, 2048 * 4, U.STORAGE | U.COPY_DST, "tileCardInfo");
    this.bCardIds = buf(d, 2048 * 24 * 4, U.STORAGE | U.COPY_DST, "tileCardIds");
    const tableSlots = CLIPS.reduce((a, c) => a + c.gridDim ** 3, 0);
    this.bTables = buf(d, tableSlots * 2 * 4, U.STORAGE | U.COPY_DST, "gdfTables");
    this.bSoup = CLIPS.map((c, i) => buf(d, c.poolSize * c.cap * 64, U.STORAGE | U.COPY_DST, `soup${i}`));
    this.bJobs = CLIPS.map((c, i) => buf(d, 256 * 32, U.STORAGE | U.COPY_DST, `jobs${i}`));
    this.bDyn = buf(d, 8 * 96, U.STORAGE | U.COPY_DST, "gdfDyn");
    this.bJobInfo = buf(d, 64, U.UNIFORM | U.COPY_DST, "jobInfo");
    this.bVxJobs = buf(d, 256 * 16, U.STORAGE | U.COPY_DST, "vxJobs");
    this.bVxInfo = buf(d, 16, U.UNIFORM | U.COPY_DST, "vxInfo");
    this.bRelightCfg = buf(d, 32, U.UNIFORM | U.COPY_DST, "relightCfg");
    this.bGatherJob = buf(d, 16, U.UNIFORM | U.COPY_DST, "gatherJob");
    this.bSdfView = buf(d, 128, U.UNIFORM | U.COPY_DST, "sdfViewCfg");
    this.bRender = buf(d, scene.renderStream.buffer.byteLength, U.VERTEX | U.COPY_DST, "renderStream");
    this.bCapture = buf(d, scene.cardSystem.capture.buffer.byteLength, U.VERTEX | U.COPY_DST, "captureStream");
    d.queue.writeBuffer(this.bRender, 0, scene.renderStream.buffer);
    d.queue.writeBuffer(this.bCapture, 0, scene.cardSystem.capture.buffer);

    // per-object bake source buffers (positions vec4f + indices u32)
    this.bakeSrc = {};
    for (const o of this.scene.objects) {
      if (!o.sdf || this.bakeSrc[o.name]) continue;
      const n = o.mesh.positions.length / 3;
      const pos4 = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) pos4.set(o.mesh.positions.subarray(i * 3, i * 3 + 3), i * 4);
      this.bakeSrc[o.name] = {
        pos: buf(d, pos4.byteLength, U.STORAGE | U.COPY_DST, `bakePos:${o.name}`),
        idx: buf(d, o.mesh.triangles.byteLength, U.STORAGE | U.COPY_DST, `bakeIdx:${o.name}`),
      };
      d.queue.writeBuffer(this.bakeSrc[o.name].pos, 0, pos4);
      d.queue.writeBuffer(this.bakeSrc[o.name].idx, 0, o.mesh.triangles);
    }

    // ---------------- textures ----------------
    const TGU = T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_DST;
    this.tGdf = DINV.map(i => tex(d, ATLAS_TEX_DIM, "r16float", TGU, `gdf${i}`));
    this.tVox = tex(d, ATLAS_TEX_DIM, "rgba16float", TGU, "voxRad0");
    this.tMeshSdf = tex(d, MESH_SDF_DIM, "r16float", TGU, "meshSdfAtlas");
    const RT16 = T.RENDER_ATTACHMENT | T.TEXTURE_BINDING;
    this.tScPos = tex(d, [SC_ATLAS, SC_ATLAS], "rgba32uint", RT16, "scPos");
    this.tScA1 = tex(d, [SC_ATLAS, SC_ATLAS], "rgba16float", RT16, "scA1");
    this.tScA2 = tex(d, [SC_ATLAS, SC_ATLAS], "rgba16float", RT16, "scA2");
    this.tScA3 = tex(d, [SC_ATLAS, SC_ATLAS], "rgba16float", RT16, "scA3");
    this.tScRad = tex(d, [SC_ATLAS, SC_ATLAS], "rgba16float", TGU | T.RENDER_ATTACHMENT, "scRadiance");
    this.tScDepth = tex(d, [SC_ATLAS, SC_ATLAS], "depth32float", T.RENDER_ATTACHMENT, "scDepth");
    this.tGb0 = tex(d, [capW, capH], "rgba16float", RT16, "gb0");
    this.tGb1 = tex(d, [capW, capH], "rgba16float", RT16, "gb1");
    this.tGb2 = tex(d, [capW, capH], "rgba16float", RT16, "gb2");
    this.tGbDepth = tex(d, [capW, capH], "depth32float", RT16, "gbDepth");
    this.tGather = [0, 1].map(i => ({
      a: tex(d, [gw, gh], "rgba16float", RT16, `gatherA${i}`),
      i: tex(d, [gw, gh], "rgba16float", RT16, `gatherInd${i}`),
      p: tex(d, [gw, gh], "rgba16float", RT16, `gatherPos${i}`),
    }));

    this.vGdf = this.tGdf.map(t => t.createView());
    this.vVox = this.tVox.createView();
    this.vMeshSdf = this.tMeshSdf.createView();
    this.vScPos = this.tScPos.createView();
    this.vScA = [this.tScA1, this.tScA2, this.tScA3].map(t => t.createView());
    this.vScRad = this.tScRad.createView();
    this.vScDepth = this.tScDepth.createView();
    this.vGb = [this.tGb0, this.tGb1, this.tGb2].map(t => t.createView());
    this.vGbDepth = this.tGbDepth.createView();
    this.vGather = this.tGather.map(s => ({ a: s.a.createView(), i: s.i.createView(), p: s.p.createView() }));

    this.sLin = d.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });
    this.sNear = d.createSampler({ magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });

    // ---------------- bind-group layouts ----------------
    const S = GPUShaderStage;
    const ALL = S.VERTEX | S.FRAGMENT | S.COMPUTE;
    const bgl0 = d.createBindGroupLayout({ label: "G0", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "uniform" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ALL, buffer: { type: "read-only-storage" } },
    ] });
    const bgl1Full = d.createBindGroupLayout({ label: "G1", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "uniform" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 3, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 4, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 5, visibility: ALL, sampler: { type: "filtering" } },
      { binding: 6, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
    ] });
    const bgl1Table = d.createBindGroupLayout({ label: "G1-table", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "uniform" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
    ] });
    const bgl1Novox = d.createBindGroupLayout({ label: "G1-novox", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "uniform" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 3, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 4, visibility: ALL, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 5, visibility: ALL, sampler: { type: "filtering" } },
    ] });
    const bgl2Full = d.createBindGroupLayout({ label: "G2", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: ALL, texture: { sampleType: "float" } },
    ] });
    const bgl2Norad = d.createBindGroupLayout({ label: "G2-norad", entries: [
      { binding: 0, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: ALL, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: ALL, buffer: { type: "read-only-storage" } },
    ] });

    // ---------------- bind groups ----------------
    this.bg0 = d.createBindGroup({ layout: bgl0, entries: [
      { binding: 0, resource: { buffer: this.bFrame } },
      { binding: 1, resource: { buffer: this.bMaterials } },
      { binding: 2, resource: { buffer: this.bTransforms } },
    ] });
    this.bg1Full = d.createBindGroup({ layout: bgl1Full, entries: [
      { binding: 0, resource: { buffer: this.bField } },
      { binding: 1, resource: { buffer: this.bTables } },
      { binding: 2, resource: this.vGdf[0] },
      { binding: 3, resource: this.vGdf[1] },
      { binding: 4, resource: this.vGdf[2] },
      { binding: 5, resource: this.sLin },
      { binding: 6, resource: this.vVox },
    ] });
    this.bg1Table = d.createBindGroup({ layout: bgl1Table, entries: [
      { binding: 0, resource: { buffer: this.bField } },
      { binding: 1, resource: { buffer: this.bTables } },
    ] });
    this.bg1Novox = d.createBindGroup({ layout: bgl1Novox, entries: [
      { binding: 0, resource: { buffer: this.bField } },
      { binding: 1, resource: { buffer: this.bTables } },
      { binding: 2, resource: this.vGdf[0] },
      { binding: 3, resource: this.vGdf[1] },
      { binding: 4, resource: this.vGdf[2] },
      { binding: 5, resource: this.sLin },
    ] });
    this.bg2Full = d.createBindGroup({ layout: bgl2Full, entries: [
      { binding: 0, resource: { buffer: this.bCards } },
      { binding: 1, resource: { buffer: this.bCardInfo } },
      { binding: 2, resource: { buffer: this.bCardIds } },
      { binding: 3, resource: this.vScRad },
    ] });
    this.bg2Norad = d.createBindGroup({ layout: bgl2Norad, entries: [
      { binding: 0, resource: { buffer: this.bCards } },
      { binding: 1, resource: { buffer: this.bCardInfo } },
      { binding: 2, resource: { buffer: this.bCardIds } },
    ] });

    // ---------------- shader modules ----------------
    const mods = {};
    for (const name of ["gbuffer", "mesh_sdf_bake", "gdf_build", "sc_capture", "sc_relight", "vx_light", "final_gather", "composite"]) {
      const code = await loadWgslModule(name);
      mods[name] = d.createShaderModule({ label: name, code });
      const info = await mods[name].getCompilationInfo();
      for (const m of info.messages) console[m.type === "error" ? "error" : "warn"](`[wgsl ${name}:${m.lineNum}]`, m.message);
    }
    const L = (arr) => d.createPipelineLayout({ bindGroupLayouts: arr });
    const plFull = L([bgl0, bgl1Full, bgl2Full]);
    const plTable = L([bgl0, bgl1Table, bgl2Full]);
    const plNovox = L([bgl0, bgl1Novox, bgl2Full]);
    const plNorad = L([bgl0, bgl1Full, bgl2Norad]);

    // ---------------- pipelines ----------------
    // mesh SDF bake
    const bglBake = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "r16float", viewDimension: "3d" } },
    ] });
    this.pBake = d.createComputePipeline({ label: "bake", layout: L([bgl0, bgl1Full, bgl2Norad, bglBake]), compute: { module: mods.mesh_sdf_bake, entryPoint: "main" } });

    // gdf tile build (per level job/soup buffers)
    const bglGdf = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: S.COMPUTE, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 5, visibility: S.COMPUTE, sampler: { type: "filtering" } },
      { binding: 6, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "r16float", viewDimension: "3d" } },
      { binding: 7, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "r16float", viewDimension: "3d" } },
      { binding: 8, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "r16float", viewDimension: "3d" } },
    ] });
    this.pGdf = d.createComputePipeline({ label: "gdf", layout: L([bgl0, bgl1Table, bgl2Full, bglGdf]), compute: { module: mods.gdf_build, entryPoint: "main" } });

    // card capture (surface cache raster)
    const vsBufDescByte = 32;
    this.pCapture = d.createRenderPipeline({ label: "capture", layout: plTable,
      vertex: { module: mods.sc_capture, entryPoint: "vsMain", buffers: [{ arrayStride: 32, stepMode: "vertex", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "uint32" },
        { shaderLocation: 2, offset: 16, format: "uint32" },
        { shaderLocation: 3, offset: 20, format: "float32x3" },
      ] }] },
      fragment: { module: mods.sc_capture, entryPoint: "fsMain", targets: [
        { format: "rgba32uint" }, { format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba16float" },
      ] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less-equal" },
    });

    // surface cache relight
    const bglRelight = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.COMPUTE, texture: { sampleType: "uint" } },
      { binding: 1, visibility: S.COMPUTE, texture: { sampleType: "float" } },
      { binding: 2, visibility: S.COMPUTE, texture: { sampleType: "float" } },
      { binding: 3, visibility: S.COMPUTE, texture: { sampleType: "float" } },
      { binding: 4, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
      { binding: 5, visibility: S.COMPUTE, buffer: { type: "uniform" } },
    ] });
    this.pRelight = d.createComputePipeline({ label: "relight", layout: L([bgl0, bgl1Full, bgl2Norad, bglRelight]), compute: { module: mods.sc_relight, entryPoint: "main" } });

    // voxel lighting
    const bglVx = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: S.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: S.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
    ] });
    this.pVx = d.createComputePipeline({ label: "vx", layout: L([bgl0, bgl1Novox, bgl2Full, bglVx]), compute: { module: mods.vx_light, entryPoint: "main" } });

    // gbuffer
    this.pGbuffer = d.createRenderPipeline({ label: "gbuffer", layout: plFull,
      vertex: { module: mods.gbuffer, entryPoint: "vsMain", buffers: [{ arrayStride: 32, stepMode: "vertex", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "uint32" },
        { shaderLocation: 3, offset: 28, format: "uint32" },
      ] }] },
      fragment: { module: mods.gbuffer, entryPoint: "fsMain", targets: [{ format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba16float" }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    // final gather
    const bglGather = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: "depth" } },
      { binding: 4, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 6, visibility: S.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 7, visibility: S.FRAGMENT, buffer: { type: "uniform" } },
    ] });
    this.pGather = d.createRenderPipeline({ label: "gather", layout: L([bgl0, bgl1Full, bgl2Full, bglGather]),
      vertex: { module: mods.final_gather, entryPoint: "vsMain" },
      fragment: { module: mods.final_gather, entryPoint: "fsMain", targets: [{ format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });

    // composite
    const bglComp = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: S.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: S.FRAGMENT, texture: { sampleType: "float", viewDimension: "3d" } },
      { binding: 4, visibility: S.FRAGMENT, texture: { sampleType: "uint" } },
      { binding: 5, visibility: S.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 6, visibility: S.FRAGMENT, texture: { sampleType: "depth" } },
      { binding: 7, visibility: S.FRAGMENT, buffer: { type: "uniform" } },
    ] });
    this.pComposite = d.createRenderPipeline({ label: "composite", layout: L([bgl0, bgl1Full, bgl2Full, bglComp]),
      vertex: { module: mods.composite, entryPoint: "vsMain" },
      fragment: { module: mods.composite, entryPoint: "fsMain", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });

    // ---------------- per-level gdf pass bind groups ----------------
    this.bgGdf = CLIPS.map((c, i) => d.createBindGroup({ layout: bglGdf, entries: [
      { binding: 0, resource: { buffer: this.bJobInfo } },
      { binding: 1, resource: { buffer: this.bJobs[i] } },
      { binding: 2, resource: { buffer: this.bDyn } },
      { binding: 3, resource: { buffer: this.bSoup[i] } },
      { binding: 4, resource: this.vMeshSdf },
      { binding: 5, resource: this.sLin },
      { binding: 6, resource: this.vGdf[0] },
      { binding: 7, resource: this.vGdf[1] },
      { binding: 8, resource: this.vGdf[2] },
    ] }));

    this.bgBake = {};
    for (const key of Object.keys(this.bakeSrc)) {
      const obj = this.scene.objects.find(o => o.name === key);
      this.bgBake[key] = d.createBindGroup({ layout: bglBake, entries: [
        { binding: 0, resource: { buffer: this.sdfParamsFor(obj).buf } },
        { binding: 1, resource: { buffer: this.bakeSrc[key].pos } },
        { binding: 2, resource: { buffer: this.bakeSrc[key].idx } },
        { binding: 3, resource: this.vMeshSdf },
      ] });
    }

    this.bgRelight = d.createBindGroup({ layout: bglRelight, entries: [
      { binding: 0, resource: this.vScPos },
      { binding: 1, resource: this.vScA[0] },
      { binding: 2, resource: this.vScA[1] },
      { binding: 3, resource: this.vScA[2] },
      { binding: 4, resource: this.vScRad },
      { binding: 5, resource: { buffer: this.bRelightCfg } },
    ] });
    this.bgVx = d.createBindGroup({ layout: bglVx, entries: [
      { binding: 0, resource: { buffer: this.bVxInfo } },
      { binding: 1, resource: { buffer: this.bVxJobs } },
      { binding: 2, resource: this.vVox },
    ] });
    this.bgGather = [0, 1].map(i => d.createBindGroup({ layout: bglGather, entries: [
      { binding: 0, resource: this.vGb[0] },
      { binding: 1, resource: this.vGb[1] },
      { binding: 2, resource: this.vGb[2] },
      { binding: 3, resource: this.vGbDepth },
      { binding: 4, resource: this.vGather[i].a },
      { binding: 5, resource: this.vGather[i].p },
      { binding: 6, resource: this.sNear },
      { binding: 7, resource: { buffer: this.bGatherJob } },
    ] }));
    this.bgComposite = [0, 1].map(i => d.createBindGroup({ layout: bglComp, entries: [
      { binding: 0, resource: this.vGather[i].a },
      { binding: 1, resource: this.vGather[i].i },
      { binding: 2, resource: this.sLin },
      { binding: 3, resource: this.vMeshSdf },
      { binding: 4, resource: this.vScPos },
      { binding: 5, resource: this.vGb[0] },
      { binding: 6, resource: this.vGbDepth },
      { binding: 7, resource: { buffer: this.bSdfView } },
    ] }));

    // upload materials table
    d.queue.writeBuffer(this.bMaterials, 0, this.packMaterials());

    // gather job dims (used by temporal reprojection inside final_gather)
    const gj = new ArrayBuffer(16);
    const gjf = new Float32Array(gj);
    gjf.set([this.gatherSize[0], this.gatherSize[1], this.captureSize[0] / this.gatherSize[0], 1], 0);
    d.queue.writeBuffer(this.bGatherJob, 0, gj);
  }

  packMaterials() {
    const out = new Float32Array(16 * 12);
    for (let i = 0; i < 16; i++) {
      const m = this.scene.materials[i];
      out.set([m.base[0], m.base[1], m.base[2], m.metal], i * 12);
      out.set([m.emissive[0], m.emissive[1], m.emissive[2], m.rough], i * 12 + 4);
      out.set([m.flag, 0, 0, 0], i * 12 + 8);
    }
    return out;
  }

  // bake UBO params per object (matches BakeJob struct)
  sdfParamsFor(obj) {
    const bufB = buf(this.d, 64, U.UNIFORM | U.COPY_DST, `bakeJob:${obj.name}`);
    const m = obj.mesh.positions, n = m.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m[i * 3 + k]); hi[k] = Math.max(hi[k], m[i * 3 + k]); }
    const margin = obj.sdf.margin;
    for (let k = 0; k < 3; k++) { lo[k] -= margin * (hi[k] - lo[k]); hi[k] += margin * (hi[k] - lo[k]); }
    const dims = obj.sdf.dims;
    const invVox = [dims[0] / (hi[0] - lo[0]), dims[1] / (hi[1] - lo[1]), dims[2] / (hi[2] - lo[2])];
    const cfg = new ArrayBuffer(64);
    const f = new Float32Array(cfg), u = new Uint32Array(cfg);
    f.set([lo[0], lo[1], lo[2], 0], 0);
    f.set([invVox[0], invVox[1], invVox[2], 0], 4);
    u.set([obj.sdf.atlasBase[0], obj.sdf.atlasBase[1], obj.sdf.atlasBase[2], obj.mesh.family.length], 8);
    u.set([dims[0], dims[1], dims[2], 0], 12);
    this.d.queue.writeBuffer(bufB, 0, cfg);
    obj.sdf.lo = lo; obj.sdf.invVox = invVox;   // reused for GdfDyn uvw affine
    return { buf: bufB, lo, invVox, dims };
  }

  // one-time initialization passes: mesh SDF bake for every dynamic mesh + static card capture
  encodeInit(encoder) {
    // bake
    for (const key of Object.keys(this.bgBake)) {
      const obj = this.scene.objects.find(o => o.name === key);
      const pass = encoder.beginComputePass({ label: `bake:${key}` });
      pass.setPipeline(this.pBake);
      pass.setBindGroup(0, this.bg0);
      pass.setBindGroup(1, this.bg1Full);
      pass.setBindGroup(2, this.bg2Norad);
      pass.setBindGroup(3, this.bgBake[key]);
      const dm = obj.sdf.dims;
      pass.dispatchWorkgroups(Math.ceil(dm[0] / 4), Math.ceil(dm[1] / 4), Math.ceil(dm[2] / 4));
      pass.end();
    }
    // static card capture (cards never change for static objects)
    this.encodeCapture(encoder, false);
  }

  encodeCapture(encoder, dynamicOnly) {
    const pass = encoder.beginRenderPass({ label: dynamicOnly ? "capture:dyn" : "capture:static", colorAttachments: [
      { view: this.vScPos, loadOp: dynamicOnly ? "load" : "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: this.vScA[0], loadOp: dynamicOnly ? "load" : "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: this.vScA[1], loadOp: dynamicOnly ? "load" : "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: this.vScA[2], loadOp: dynamicOnly ? "load" : "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ], depthStencilAttachment: { view: this.vScDepth, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0 } });
    pass.setPipeline(this.pCapture);
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1Table);
    pass.setBindGroup(2, this.bg2Full);
    pass.setVertexBuffer(0, this.bCapture);
    for (const span of this.scene.cardSystem.capture.objSpans) {
      if (span.obj.dynamic !== dynamicOnly) continue;
      pass.draw(span.count, 1, span.first, span.obj.tfIndex);
    }
    pass.end();
  }

  // per-frame compute dispatches: gdf builds, relight bands, voxel lighting
  encodeCompute(encoder, plan, cfg) {
    // gdf builds per level
    if (cfg.gdf) {
      for (let li = 0; li < 3; li++) {
        const jobs = plan.jobs[li];
        if (!jobs.length) continue;
        const info = new Uint32Array(4);
        info[0] = jobs.length; info[1] = plan.dynCount;
        this.d.queue.writeBuffer(this.bJobInfo, 0, info);
        const ja = new ArrayBuffer(Math.max(1, jobs.length) * 32);
        const ji = new Int32Array(ja), ju = new Uint32Array(ja);
        jobs.forEach((j, i) => {
          ji.set([j.cell[0], j.cell[1], j.cell[2], li], i * 8);
          ju.set([j.pool, cfg.meshSdf ? j.dynMask : 0, j.pool * CLIPS[li].cap, j.entryCount], i * 8 + 4);
        });
        this.d.queue.writeBuffer(this.bJobs[li], 0, ja);
        const pass = encoder.beginComputePass({ label: `gdf@${li}` });
        pass.setPipeline(this.pGdf);
        pass.setBindGroup(0, this.bg0);
        pass.setBindGroup(1, this.bg1Table);
        pass.setBindGroup(2, this.bg2Full);
        pass.setBindGroup(3, this.bgGdf[li]);
        pass.dispatchWorkgroups(2, 2, 2 * jobs.length);
        pass.end();
      }
    }
    // surface cache relight: dynamic rows first, then the amortized static band
    if (cfg.surfaceCache) {
      const pass = encoder.beginComputePass({ label: "relight" });
      pass.setPipeline(this.pRelight);
      pass.setBindGroup(0, this.bg0);
      pass.setBindGroup(1, this.bg1Full);
      pass.setBindGroup(2, this.bg2Norad);
      pass.setBindGroup(3, this.bgRelight);
      const u = new Uint32Array(8);
      // dynamic rows (every frame) — the car's cards live [firstDyn, endDyn)
      u.set([plan.dynRow0, plan.dynRowCount, 0, 0], 0);
      this.d.queue.writeBuffer(this.bRelightCfg, 0, u.subarray(0, 4));
      if (plan.dynRowCount > 0) pass.dispatchWorkgroups(64, Math.ceil(plan.dynRowCount / 16));
      // static amortized band: whole atlas every 16 frames, skipping dynamic rows
      const bandStart = (plan.frameIdx % 16) * 64;
      u.set([bandStart, 64, 0, 0], 0);
      this.d.queue.writeBuffer(this.bRelightCfg, 0, u.subarray(0, 4));
      pass.dispatchWorkgroups(64, 4);
      pass.end();
    }
    // voxel lighting: scheduled L0 tiles
    if (cfg.voxelLight && plan.vxJobs.length) {
      const u = new Uint32Array(4);
      u[0] = plan.vxJobs.length;
      this.d.queue.writeBuffer(this.bVxInfo, 0, u);
      const ja = new Int32Array(plan.vxJobs.length * 4);
      plan.vxJobs.forEach((j, i) => ja.set([j.cell[0], j.cell[1], j.cell[2], j.pool], i * 4));
      this.d.queue.writeBuffer(this.bVxJobs, 0, ja);
      const pass = encoder.beginComputePass({ label: "vx" });
      pass.setPipeline(this.pVx);
      pass.setBindGroup(0, this.bg0);
      pass.setBindGroup(1, this.bg1Novox);
      pass.setBindGroup(2, this.bg2Full);
      pass.setBindGroup(3, this.bgVx);
      pass.dispatchWorkgroups(2, 2, 2 * plan.vxJobs.length);
      pass.end();
    }
  }

  encodeGbuffer(encoder) {
    const pass = encoder.beginRenderPass({ label: "gbuffer", colorAttachments: [
      { view: this.vGb[0], loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: this.vGb[1], loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: this.vGb[2], loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ], depthStencilAttachment: { view: this.vGbDepth, depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0 } });
    pass.setPipeline(this.pGbuffer);
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1Full);
    pass.setBindGroup(2, this.bg2Full);
    pass.setVertexBuffer(0, this.bRender);
    const spans = this.scene.renderStream.objSpans;
    for (let i = 0; i < spans.length; i++) {
      pass.draw(spans[i].count, 1, spans[i].first, this.scene.objects[i].tfIndex);
    }
    pass.end();
  }

  encodeGather(encoder, setIdx) {
    const cur = this.vGather[setIdx];
    const pass = encoder.beginRenderPass({ label: "gather", colorAttachments: [
      { view: cur.a, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: cur.i, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      { view: cur.p, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
    ] });
    pass.setPipeline(this.pGather);
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1Full);
    pass.setBindGroup(2, this.bg2Full);
    pass.setBindGroup(3, this.bgGather[setIdx ^ 1]);      // history = previous set
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  encodeComposite(encoder, setIdx, target) {
    const pass = encoder.beginRenderPass({ label: "composite", colorAttachments: [
      { view: target, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ] });
    pass.setPipeline(this.pComposite);
    pass.setBindGroup(0, this.bg0);
    pass.setBindGroup(1, this.bg1Full);
    pass.setBindGroup(2, this.bg2Full);
    pass.setBindGroup(3, this.bgComposite[setIdx]);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  // recreate capture/gather targets when the canvas aspect changes (called from the resize handler)
  setCaptureSize(w, h) {
    const d = this.d;
    this.captureSize = [w, h];
    const gw = Math.max(160, Math.round(w * this.gatherScale));
    const gh = Math.max(90, Math.round(h * this.gatherScale));
    this.gatherSize = [gw, gh];
    const RT16 = T.RENDER_ATTACHMENT | T.TEXTURE_BINDING;
    for (const t of [this.tGb0, this.tGb1, this.tGb2, this.tGbDepth]) t.destroy();
    for (const s of this.tGather) for (const t of [s.a, s.i, s.p]) t.destroy();
    this.tGb0 = tex(d, [w, h], "rgba16float", RT16, "gb0");
    this.tGb1 = tex(d, [w, h], "rgba16float", RT16, "gb1");
    this.tGb2 = tex(d, [w, h], "rgba16float", RT16, "gb2");
    this.tGbDepth = tex(d, [w, h], "depth32float", RT16, "gbDepth");
    this.tGather = [0, 1].map(i => ({
      a: tex(d, [gw, gh], "rgba16float", RT16, `gatherA${i}`),
      i: tex(d, [gw, gh], "rgba16float", RT16, `gatherInd${i}`),
      p: tex(d, [gw, gh], "rgba16float", RT16, `gatherPos${i}`),
    }));
    this.vGb = [this.tGb0, this.tGb1, this.tGb2].map(t => t.createView());
    this.vGbDepth = this.tGbDepth.createView();
    this.vGather = this.tGather.map(s => ({ a: s.a.createView(), i: s.i.createView(), p: s.p.createView() }));
    const bglGather = this.pGather.getBindGroupLayout(3);
    this.bgGather = [0, 1].map(i => d.createBindGroup({ layout: bglGather, entries: [
      { binding: 0, resource: this.vGb[0] },
      { binding: 1, resource: this.vGb[1] },
      { binding: 2, resource: this.vGb[2] },
      { binding: 3, resource: this.vGbDepth },
      { binding: 4, resource: this.vGather[i].a },
      { binding: 5, resource: this.vGather[i].p },
      { binding: 6, resource: this.sNear },
      { binding: 7, resource: { buffer: this.bGatherJob } },
    ] }));
    const bglComp = this.pComposite.getBindGroupLayout(3);
    this.bgComposite = [0, 1].map(i => d.createBindGroup({ layout: bglComp, entries: [
      { binding: 0, resource: this.vGather[i].a },
      { binding: 1, resource: this.vGather[i].i },
      { binding: 2, resource: this.sLin },
      { binding: 3, resource: this.vMeshSdf },
      { binding: 4, resource: this.vScPos },
      { binding: 5, resource: this.vGb[0] },
      { binding: 6, resource: this.vGbDepth },
      { binding: 7, resource: { buffer: this.bSdfView } },
    ] }));
    const gj = new ArrayBuffer(16);
    const gjf = new Float32Array(gj);
    gjf.set([gw, gh, w / gw, 1], 0);
    d.queue.writeBuffer(this.bGatherJob, 0, gj);
  }

  // full frame: [capture dyn] → compute → gbuffer → gather → composite
  frame(plan, cfg) {
    const encoder = this.d.createCommandEncoder();
    if (cfg.cards) this.encodeCapture(encoder, true);
    this.encodeCompute(encoder, plan, cfg);
    this.encodeGbuffer(encoder);
    const setIdx = this.frame % 2;
    this.encodeGather(encoder, setIdx);
    this.encodeComposite(encoder, setIdx, this.ctx.getCurrentTexture().createView());
    this.d.queue.submit([encoder.finish()]);
    this.frame++;
  }
}
