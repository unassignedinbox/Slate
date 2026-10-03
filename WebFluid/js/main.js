// ============================================================================
// WebFluid — realtime PBF fluid simulation (WebGPU)
//  - compute: position-based fluids + spatial hash + XSPH + adhesion
//  - render : screen-space fluid (depth -> bilateral blur -> normals ->
//             thickness -> absorption/refraction/fresnel composite)
//  - Unreal-style dynamic resolution: render scale tracks frame time
// ============================================================================

'use strict';

// ----------------------------------------------------------------- mat4 math

const m4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f;
    out[10] = far / (near - far); out[11] = -1;
    out[14] = (near * far) / (near - far);
    return out;
  },
  lookAt(eye, target, up) {
    const z = v3norm(v3sub(eye, target));
    const x = v3norm(v3cross(up, z));
    const y = v3cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -v3dot(x, eye), -v3dot(y, eye), -v3dot(z, eye), 1,
    ]);
  },
  cameraWorld(eye, target, up) { // inverse of lookAt
    const z = v3norm(v3sub(eye, target));
    const x = v3norm(v3cross(up, z));
    const y = v3cross(z, x);
    return new Float32Array([
      x[0], x[1], x[2], 0,
      y[0], y[1], y[2], 0,
      z[0], z[1], z[2], 0,
      eye[0], eye[1], eye[2], 1,
    ]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
    inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
    inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
    inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
    inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
    inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
    inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
    inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
    inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
    inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
    inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
    inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
    inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
    let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
    det = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
  translateScale(t, s) {
    return new Float32Array([
      s[0], 0, 0, 0,
      0, s[1], 0, 0,
      0, 0, s[2], 0,
      t[0], t[1], t[2], 1,
    ]);
  },
};
function v3sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function v3add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function v3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function v3cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
function v3norm(a) { const l = v3len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ----------------------------------------------------------- sim constants

const MAX_PARTICLES = 65536;
const H = 0.10;                 // SPH kernel radius
const REST_DIST = 0.05;         // rest particle spacing
const PARTICLE_R = 0.025;       // collision radius
const BOX = { min: [-1.4, 0.0, -0.9], max: [1.4, 1.8, 0.9] };
const GRID_MIN = [-1.6, -0.2, -1.1];
const GRID_DIMS = [32, 22, 22];
const CELL = 0.10;
const NUM_CELLS = GRID_DIMS[0] * GRID_DIMS[1] * GRID_DIMS[2];
const SUBSTEPS = 2;
const ITERS = 3;
const DT = 1 / 120;
const GRAVITY = -9.8;

const POLY6 = 315 / (64 * Math.PI * Math.pow(H, 9));
const SPIKY = 45 / (Math.PI * Math.pow(H, 6));
const DQ = 0.3 * H;
const W_DQ = POLY6 * Math.pow(H*H - DQ*DQ, 3);

// rest density from an ideal lattice at REST_DIST spacing
let RHO0 = 0;
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) {
  const r2 = (i*i + j*j + k*k) * REST_DIST * REST_DIST;
  if (r2 < H*H) RHO0 += POLY6 * Math.pow(H*H - r2, 3);
}

// rendering radii
const DRAW_R = 0.058;
const THICK_R = 0.095;
const BLUR_WORLD = 0.13;
const BLUR_RANGE = 0.30;

// ------------------------------------------------------------------ presets

const PRESETS = {
  water: {
    visc: 0.05, coh: 0.20, stick: 0.00, vort: 0.10,
    mat: { base: [0.07, 0.24, 0.33], opacityK: 0.25, absorb: [0.95, 0.28, 0.12],
           roughness: 0.04, specI: 1.15, refractK: 0.085, grain: 0, fresnelK: 0.9 },
  },
  milk: {
    visc: 0.14, coh: 0.26, stick: 0.10, vort: 0.05,
    mat: { base: [0.93, 0.90, 0.84], opacityK: 6.0, absorb: [0.05, 0.08, 0.16],
           roughness: 0.24, specI: 0.42, refractK: 0.02, grain: 0, fresnelK: 0.22 },
  },
  chocolate: {
    visc: 0.60, coh: 0.62, stick: 0.85, vort: 0.0,
    mat: { base: [0.200, 0.085, 0.034], opacityK: 9.0, absorb: [0.0, 0.0, 0.0],
           roughness: 0.10, specI: 0.85, refractK: 0.008, grain: 0, fresnelK: 0.32 },
  },
  mud: {
    visc: 0.80, coh: 0.50, stick: 0.55, vort: 0.0,
    mat: { base: [0.26, 0.205, 0.148], opacityK: 11.0, absorb: [0.0, 0.0, 0.0],
           roughness: 0.78, specI: 0.13, refractK: 0.004, grain: 1.0, fresnelK: 0.07 },
  },
};

// ------------------------------------------------------------------- state

const state = {
  preset: 'water',
  visc: 0.05, coh: 0.2, stick: 0.0,
  count: 26000, active: 0,
  pour: false, pourCarry: 0,
  stir: false, stirAngle: 0,
  block: true,
  vort: 0.10, splashPending: 0, debugView: 0,
  ballPhys: true, ballVel: [0, 0, 0],
  ballSample: { count: 0, v: [0, 0, 0] }, ballReadPending: false,
  spherePos: [0.55, 0.42, 0.0], sphereVel: [0, 0, 0], sphereR: 0.22,
  cam: { yaw: 0.55, pitch: 0.33, dist: 4.4, target: [0, 0.6, 0] },
  drag: null, lastPointer: null,
  dyn: { auto: true, targetFps: 60, scale: 0.78, cooldown: 0, raiseStreak: 0, emaMs: 16 },
  stats: { frames: 0, acc: 0, fps: 0, ms: 0 },
};

// ------------------------------------------------------------------ geometry

function makeUVSphere(slices, stacks) {
  const verts = [], idx = [];
  for (let st = 0; st <= stacks; st++) {
    const phi = (st / stacks) * Math.PI;
    for (let sl = 0; sl <= slices; sl++) {
      const th = (sl / slices) * 2 * Math.PI;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      verts.push(x, y, z, x, y, z);
    }
  }
  const row = slices + 1;
  for (let st = 0; st < stacks; st++) for (let sl = 0; sl < slices; sl++) {
    const a = st * row + sl, b = a + row;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

function makeCube() {
  const f = [
    [[ 1,0,0], [ .5,-.5,-.5], [ .5, .5,-.5], [ .5, .5, .5], [ .5,-.5, .5]],
    [[-1,0,0], [-.5,-.5, .5], [-.5, .5, .5], [-.5, .5,-.5], [-.5,-.5,-.5]],
    [[0, 1,0], [-.5, .5,-.5], [-.5, .5, .5], [ .5, .5, .5], [ .5, .5,-.5]],
    [[0,-1,0], [-.5,-.5, .5], [-.5,-.5,-.5], [ .5,-.5,-.5], [ .5,-.5, .5]],
    [[0,0, 1], [-.5,-.5, .5], [ .5,-.5, .5], [ .5, .5, .5], [-.5, .5, .5]],
    [[0,0,-1], [ .5,-.5,-.5], [-.5,-.5,-.5], [-.5, .5,-.5], [ .5, .5,-.5]],
  ];
  const verts = [], idx = [];
  f.forEach(([n, ...vs], fi) => {
    vs.forEach(v => verts.push(...v, ...n));
    const b = fi * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

function makeBoxEdges(min, max) {
  const c = (i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const e = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const out = [];
  e.forEach(([a, b]) => out.push(...c(a), ...c(b)));
  return new Float32Array(out);
}

// =================================================================== main

async function main() {
  const canvas = document.getElementById('gfx');
  const fatal = (msg) => {
    document.getElementById('fatal').style.display = 'flex';
    if (msg) document.getElementById('fatalMsg').innerHTML = msg;
  };

  if (!navigator.gpu) { fatal(); return; }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); }
  catch (e) { /* fallthrough */ }
  if (!adapter) { fatal(); return; }
  const device = await adapter.requestDevice();
  device.lost.then(info => { if (info.reason !== 'destroyed') fatal('GPU device lost: ' + info.message); });
  device.onuncapturederror = (e) => console.error('WebGPU error:', e.error.message);

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  // ------------------------------------------------------------- shaders
  async function loadShader(path) {
    const src = await (await fetch(path)).text();
    const mod = device.createShaderModule({ code: src, label: path });
    const info = await mod.getCompilationInfo();
    for (const m of info.messages) {
      if (m.type === 'error') { console.error(`${path}:${m.lineNum}: ${m.message}`); }
    }
    return mod;
  }
  const [simMod, sceneMod, partMod, postMod] = await Promise.all([
    loadShader('shaders/sim.wgsl'), loadShader('shaders/scene.wgsl'),
    loadShader('shaders/particles.wgsl'), loadShader('shaders/post.wgsl'),
  ]);

  // ------------------------------------------------------------- buffers
  const B = (size, usage, label) => device.createBuffer({ size, usage, label });
  const SU = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const posBuf    = B(MAX_PARTICLES * 16, SU, 'pos');
  const velBuf    = B(MAX_PARTICLES * 16, SU, 'vel');
  const predA     = B(MAX_PARTICLES * 16, GPUBufferUsage.STORAGE, 'predA');
  const predB     = B(MAX_PARTICLES * 16, GPUBufferUsage.STORAGE, 'predB');
  const ballBuf   = B(32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, 'ballAcc');
  const ballRead  = B(32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'ballRead');
  const headBuf   = B(NUM_CELLS * 4, GPUBufferUsage.STORAGE, 'gridHead');
  const nextBuf   = B(MAX_PARTICLES * 4, GPUBufferUsage.STORAGE, 'gridNext');
  const velTmpBuf = B(MAX_PARTICLES * 16, GPUBufferUsage.STORAGE, 'velTmp');

  const UB = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const simUBO  = B(192, UB, 'simParams');
  const camUBO  = B(320, UB, 'cam');
  const matUBO  = B(80, UB, 'mat');
  const blurHU  = B(16, UB, 'blurH');
  const blurVU  = B(16, UB, 'blurV');
  const sphereU = B(96, UB, 'objSphere');
  const blockU  = B(96, UB, 'objBlock');

  device.queue.writeBuffer(blurHU, 0, new Float32Array([1, 0, BLUR_WORLD, BLUR_RANGE]));
  device.queue.writeBuffer(blurVU, 0, new Float32Array([0, 1, BLUR_WORLD, BLUR_RANGE]));

  // geometry buffers
  const sphGeo = makeUVSphere(28, 18);
  const cubGeo = makeCube();
  const edges = makeBoxEdges(BOX.min, BOX.max);
  const VB = (data) => {
    const b = B(data.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(b, 0, data); return b;
  };
  const IB = (data) => {
    const b = B(Math.ceil(data.byteLength / 4) * 4, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(b, 0, data); return b;
  };
  const sphVB = VB(sphGeo.verts), sphIB = IB(sphGeo.idx);
  const cubVB = VB(cubGeo.verts), cubIB = IB(cubGeo.idx);
  const edgeVB = VB(edges);

  // obstacle block extents
  const OBS = { min: [-1.4, 0.0, -0.9], max: [-0.78, 0.38, -0.27] };
  {
    const c = v3scale(v3add(OBS.min, OBS.max), 0.5);
    const s = v3sub(OBS.max, OBS.min);
    const u = new Float32Array(24);
    u.set(m4.translateScale(c, s), 0);
    u.set([0.52, 0.54, 0.58, 0.6], 16);  // albedo + roughness
    u.set([0.25, 0, 0, 0], 20);          // spec intensity
    device.queue.writeBuffer(blockU, 0, u);
  }

  // ----------------------------------------------------- bind group layouts
  const simBGL = device.createBindGroupLayout({
    label: 'sim',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ...[1,2,3,4,5,6,7,8].map(i => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } })),
    ],
  });
  const camBGL = device.createBindGroupLayout({
    label: 'cam',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const objBGL = device.createBindGroupLayout({
    label: 'obj',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const partsBGL = device.createBindGroupLayout({
    label: 'parts',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
  });
  const blurBGL = device.createBindGroupLayout({
    label: 'blur',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const compBGL = device.createBindGroupLayout({
    label: 'composite',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    ],
  });

  const simBG_A = device.createBindGroup({
    layout: simBGL,
    entries: [
      { binding: 0, resource: { buffer: simUBO } },
      { binding: 1, resource: { buffer: posBuf } },
      { binding: 2, resource: { buffer: velBuf } },
      { binding: 3, resource: { buffer: predA } },
      { binding: 4, resource: { buffer: ballBuf } },
      { binding: 5, resource: { buffer: headBuf } },
      { binding: 6, resource: { buffer: nextBuf } },
      { binding: 7, resource: { buffer: velTmpBuf } },
      { binding: 8, resource: { buffer: predB } },
    ],
  });
  const simBG_B = device.createBindGroup({
    layout: simBGL,
    entries: [
      { binding: 0, resource: { buffer: simUBO } },
      { binding: 1, resource: { buffer: posBuf } },
      { binding: 2, resource: { buffer: velBuf } },
      { binding: 3, resource: { buffer: predB } },
      { binding: 4, resource: { buffer: ballBuf } },
      { binding: 5, resource: { buffer: headBuf } },
      { binding: 6, resource: { buffer: nextBuf } },
      { binding: 7, resource: { buffer: velTmpBuf } },
      { binding: 8, resource: { buffer: predA } },
    ],
  });
  const camBG = device.createBindGroup({ layout: camBGL, entries: [{ binding: 0, resource: { buffer: camUBO } }] });
  const sphereBG = device.createBindGroup({ layout: objBGL, entries: [{ binding: 0, resource: { buffer: sphereU } }] });
  const blockBG = device.createBindGroup({ layout: objBGL, entries: [{ binding: 0, resource: { buffer: blockU } }] });
  const partsBG = device.createBindGroup({ layout: partsBGL, entries: [{ binding: 0, resource: { buffer: posBuf } }] });

  const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  // ------------------------------------------------------------- pipelines
  const simPL = device.createPipelineLayout({ bindGroupLayouts: [simBGL] });
  const compPipe = (entry) => device.createComputePipeline({
    label: entry, layout: simPL, compute: { module: simMod, entryPoint: entry },
  });
  const pPredict = compPipe('predict');
  const pClear   = compPipe('clearGrid');
  const pBuild   = compPipe('buildGrid');
  const pLambda  = compPipe('computeLambda');
  const pDelta   = compPipe('applyDelta');
  const pFinal   = compPipe('finalizeVel');
  const pXsph    = compPipe('xsph');
  const pCurl    = compPipe('computeCurl');
  const pVort    = compPipe('applyVorticity');

  const SCENE_FMT = 'rgba16float';
  const depthStencil = (write, cmp = 'less') => ({
    format: 'depth32float', depthWriteEnabled: write, depthCompare: cmp,
  });
  const meshVBL = [{
    arrayStride: 24,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
    ],
  }];

  const camPL = device.createPipelineLayout({ bindGroupLayouts: [camBGL] });
  const camObjPL = device.createPipelineLayout({ bindGroupLayouts: [camBGL, objBGL] });
  const camPartsPL = device.createPipelineLayout({ bindGroupLayouts: [camBGL, partsBGL] });
  const camBlurPL = device.createPipelineLayout({ bindGroupLayouts: [camBGL, blurBGL] });
  const camCompPL = device.createPipelineLayout({ bindGroupLayouts: [camBGL, compBGL] });

  const skyPipe = device.createRenderPipeline({
    label: 'sky', layout: camPL,
    vertex: { module: sceneMod, entryPoint: 'vsSky' },
    fragment: { module: sceneMod, entryPoint: 'fsSky', targets: [{ format: SCENE_FMT }] },
    depthStencil: depthStencil(false, 'less-equal'),
  });
  const floorPipe = device.createRenderPipeline({
    label: 'floor', layout: camPL,
    vertex: { module: sceneMod, entryPoint: 'vsFloor' },
    fragment: { module: sceneMod, entryPoint: 'fsFloor', targets: [{ format: SCENE_FMT }] },
    depthStencil: depthStencil(true),
  });
  const meshPipe = device.createRenderPipeline({
    label: 'mesh', layout: camObjPL,
    vertex: { module: sceneMod, entryPoint: 'vsMesh', buffers: meshVBL },
    fragment: { module: sceneMod, entryPoint: 'fsMesh', targets: [{ format: SCENE_FMT }] },
    primitive: { cullMode: 'back' },
    depthStencil: depthStencil(true),
  });
  const linePipe = device.createRenderPipeline({
    label: 'lines', layout: camPL,
    vertex: {
      module: sceneMod, entryPoint: 'vsLine',
      buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
    },
    fragment: { module: sceneMod, entryPoint: 'fsLine', targets: [{ format: SCENE_FMT }] },
    primitive: { topology: 'line-list' },
    depthStencil: depthStencil(true),
  });
  const depthSpritePipe = device.createRenderPipeline({
    label: 'fluidDepth', layout: camPartsPL,
    vertex: { module: partMod, entryPoint: 'vsDepth' },
    fragment: { module: partMod, entryPoint: 'fsDepth', targets: [{ format: 'r32float' }] },
    depthStencil: depthStencil(true),
  });
  const thickPipe = device.createRenderPipeline({
    label: 'thickness', layout: camPartsPL,
    vertex: { module: partMod, entryPoint: 'vsThick' },
    fragment: {
      module: partMod, entryPoint: 'fsThick',
      targets: [{
        format: 'r16float',
        blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
      }],
    },
    depthStencil: depthStencil(false),
  });
  const blurPipe = device.createRenderPipeline({
    label: 'blur', layout: camBlurPL,
    vertex: { module: postMod, entryPoint: 'vsFull' },
    fragment: { module: postMod, entryPoint: 'fsBlur', targets: [{ format: 'r32float' }] },
  });
  const compositePipe = device.createRenderPipeline({
    label: 'composite', layout: camCompPL,
    vertex: { module: postMod, entryPoint: 'vsFull' },
    fragment: { module: postMod, entryPoint: 'fsComposite', targets: [{ format }] },
  });

  // --------------------------------------------------------- render targets
  let T = null; // targets
  function createTargets() {
    if (T) for (const k of ['sceneColor', 'depth', 'fluidA', 'fluidB', 'thick']) T[k].destroy();
    const s = state.dyn.scale;
    const w = Math.max(16, Math.floor(canvas.width * s));
    const h = Math.max(16, Math.floor(canvas.height * s));
    const mk = (fmt, usage) => device.createTexture({ size: [w, h], format: fmt, usage });
    const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    T = {
      w, h,
      sceneColor: mk(SCENE_FMT, RT),
      depth: mk('depth32float', GPUTextureUsage.RENDER_ATTACHMENT),
      fluidA: mk('r32float', RT),
      fluidB: mk('r32float', RT),
      thick: mk('r16float', RT),
    };
    T.sceneColorV = T.sceneColor.createView();
    T.depthV = T.depth.createView();
    T.fluidAV = T.fluidA.createView();
    T.fluidBV = T.fluidB.createView();
    T.thickV = T.thick.createView();
    T.blurBG_H = device.createBindGroup({
      layout: blurBGL,
      entries: [{ binding: 0, resource: T.fluidAV }, { binding: 1, resource: { buffer: blurHU } }],
    });
    T.blurBG_V = device.createBindGroup({
      layout: blurBGL,
      entries: [{ binding: 0, resource: T.fluidBV }, { binding: 1, resource: { buffer: blurVU } }],
    });
    T.compBG = device.createBindGroup({
      layout: compBGL,
      entries: [
        { binding: 0, resource: { buffer: matUBO } },
        { binding: 1, resource: linSampler },
        { binding: 2, resource: T.sceneColorV },
        { binding: 3, resource: T.thickV },
        { binding: 4, resource: T.fluidAV },
      ],
    });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(16, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(16, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      createTargets();
    }
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // ------------------------------------------------------------ fluid init

  function fillBlock(count) {
    const data = new Float32Array(count * 4);
    const velZ = new Float32Array(count * 4);
    const s = REST_DIST;
    // decide footprint: dam-break (left half) if it fits, else full pool
    const xN_half = Math.floor(1.30 / s), zN = Math.floor(1.70 / s);
    const layersHalf = Math.ceil(count / (xN_half * zN));
    const full = layersHalf * s > 1.55;
    const x0 = -1.35, x1 = full ? 1.35 : -0.05;
    const xN = Math.floor((x1 - x0) / s);
    let n = 0;
    outer:
    for (let y = 0; ; y++) {
      for (let zi = 0; zi < zN; zi++) {
        for (let xi = 0; xi < xN; xi++) {
          if (n >= count) break outer;
          const j = () => (Math.random() - 0.5) * s * 0.35;
          data[n*4+0] = x0 + (xi + 0.5) * s + j();
          data[n*4+1] = 0.035 + y * s * 0.95 + j() * 0.5;
          data[n*4+2] = -0.85 + (zi + 0.5) * s + j();
          data[n*4+3] = 1;
          n++;
        }
      }
    }
    device.queue.writeBuffer(posBuf, 0, data);
    device.queue.writeBuffer(velBuf, 0, velZ);
    state.active = count;
  }
  fillBlock(state.count);

  function emitPour(dt) {
    if (!state.pour || state.active >= MAX_PARTICLES) return;
    state.pourCarry += 1600 * dt;
    const n = Math.min(Math.floor(state.pourCarry), MAX_PARTICLES - state.active, 400);
    if (n <= 0) return;
    state.pourCarry -= n;
    const p = new Float32Array(n * 4), v = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.09;
      p[i*4+0] = 0.25 + Math.cos(a) * r;
      p[i*4+1] = 1.70 + Math.random() * 0.05;
      p[i*4+2] = 0.30 + Math.sin(a) * r;
      p[i*4+3] = 1;
      v[i*4+0] = (Math.random() - 0.5) * 0.3;
      v[i*4+1] = -3.0 - Math.random() * 0.5;
      v[i*4+2] = (Math.random() - 0.5) * 0.3;
    }
    device.queue.writeBuffer(posBuf, state.active * 16, p);
    device.queue.writeBuffer(velBuf, state.active * 16, v);
    state.active += n;
  }

  // ------------------------------------------------------------- uniforms

  const simArr = new ArrayBuffer(192);
  const simF = new Float32Array(simArr);
  const simI = new Int32Array(simArr);
  const simU = new Uint32Array(simArr);

  function writeSimUBO() {
    simF.set(GRID_MIN, 0); simF[3] = CELL;
    simI.set(GRID_DIMS, 4); simU[7] = state.active;
    simF[8] = DT; simF[9] = H; simF[10] = 1 / RHO0; simF[11] = 120.0;
    simF[12] = state.coh * 0.012; simF[13] = 1 / W_DQ; simF[14] = state.visc; simF[15] = POLY6;
    simF[16] = SPIKY; simF[17] = PARTICLE_R; simF[18] = state.stick * 9.0; simF[19] = state.stick * 11.0;
    simF[20] = 0; simF[21] = GRAVITY; simF[22] = 0; simF[23] = H * 0.9; // adhesion range
    simF.set(BOX.min, 24); simF[27] = state.vort;
    simF.set(BOX.max, 28); simF[31] = state.splashPending;
    simF.set(state.spherePos, 32); simF[35] = state.sphereR;
    simF.set(state.sphereVel, 36); simF[39] = Math.random() * 1000;
    simF.set(OBS.min, 40);
    simF.set(OBS.max, 44); simF[47] = state.block ? 1 : 0;
    device.queue.writeBuffer(simUBO, 0, simArr);
  }

  const camArr = new Float32Array(80);
  const SUN = v3norm([0.55, 1.0, 0.38]);
  let projMat = null, invViewMat = null, eyePos = [0, 0, 0];

  function writeCamUBO(time) {
    const c = state.cam;
    const eye = [
      c.target[0] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw),
      c.target[1] + c.dist * Math.sin(c.pitch),
      c.target[2] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw),
    ];
    eyePos = eye;
    const aspect = canvas.width / canvas.height;
    const view = m4.lookAt(eye, c.target, [0, 1, 0]);
    const proj = m4.perspective(50 * Math.PI / 180, aspect, 0.05, 60);
    const invView = m4.cameraWorld(eye, c.target, [0, 1, 0]);
    const invProj = m4.invert(proj);
    projMat = proj; invViewMat = invView;
    camArr.set(view, 0); camArr.set(proj, 16); camArr.set(invView, 32); camArr.set(invProj, 48);
    camArr.set(eye, 64); camArr[67] = time;
    camArr.set(SUN, 68); camArr[71] = DRAW_R;
    camArr[72] = T.w; camArr[73] = T.h; camArr[74] = THICK_R; camArr[75] = 0;
    device.queue.writeBuffer(camUBO, 0, camArr);
  }

  const matArr = new Float32Array(20);
  function writeMatUBO() {
    const m = PRESETS[state.preset].mat;
    matArr.set(m.base, 0); matArr[3] = m.opacityK;
    matArr.set(m.absorb, 4); matArr[7] = m.roughness;
    matArr[8] = m.specI; matArr[9] = m.refractK; matArr[10] = m.grain; matArr[11] = m.fresnelK;
    matArr[12] = T.w; matArr[13] = T.h; matArr[14] = canvas.width; matArr[15] = canvas.height;
    matArr[16] = state.debugView;
    device.queue.writeBuffer(matUBO, 0, matArr);
  }

  function writeSphereUBO() {
    const u = new Float32Array(24);
    const r = state.sphereR;
    u.set(m4.translateScale(state.spherePos, [r, r, r]), 0);
    u.set([0.88, 0.37, 0.14, 0.14], 16);
    u.set([0.8, 0, 0, 0], 20);
    device.queue.writeBuffer(sphereU, 0, u);
  }

  // ------------------------------------------------------------- UI wiring

  const $ = (id) => document.getElementById(id);
  const sliders = {
    visc: [$('sVisc'), $('vVisc'), (v) => { state.visc = v / 100; }],
    coh: [$('sCoh'), $('vCoh'), (v) => { state.coh = v / 100; }],
    stick: [$('sStick'), $('vStick'), (v) => { state.stick = v / 100; }],
  };
  for (const k in sliders) {
    const [el, lab, fn] = sliders[k];
    const upd = () => { fn(+el.value); lab.textContent = (+el.value / 100).toFixed(2); };
    el.addEventListener('input', upd); upd();
  }
  {
    const el = $('sCount'), lab = $('vCount');
    const upd = () => { lab.textContent = (+el.value / 1000).toFixed(0) + 'k'; };
    el.addEventListener('input', upd);
    el.addEventListener('change', () => { state.count = +el.value; fillBlock(state.count); });
    upd();
  }
  {
    const el = $('sScale'), lab = $('vScale');
    const upd = () => {
      lab.textContent = el.value + '%';
      if (!state.dyn.auto) { state.dyn.scale = +el.value / 100; createTargets(); }
    };
    el.addEventListener('input', upd); upd();
  }

  function applyPreset(name) {
    state.preset = name;
    const p = PRESETS[name];
    state.visc = p.visc; state.coh = p.coh; state.stick = p.stick; state.vort = p.vort;
    sliders.visc[0].value = p.visc * 100; sliders.visc[1].textContent = p.visc.toFixed(2);
    sliders.coh[0].value = p.coh * 100; sliders.coh[1].textContent = p.coh.toFixed(2);
    sliders.stick[0].value = p.stick * 100; sliders.stick[1].textContent = p.stick.toFixed(2);
    document.querySelectorAll('.preset').forEach(el =>
      el.classList.toggle('active', el.dataset.p === name));
  }
  document.querySelectorAll('.preset').forEach(el =>
    el.addEventListener('click', () => applyPreset(el.dataset.p)));
  applyPreset('water');

  const toggle = (id, fn) => $(id).addEventListener('click', () => {
    $(id).classList.toggle('on'); fn($(id).classList.contains('on'));
  });
  toggle('bPour', (on) => { state.pour = on; });
  toggle('bStir', (on) => { state.stir = on; });
  toggle('bBlock', (on) => { state.block = on; });
  toggle('bBallPhys', (on) => { state.ballPhys = on; state.ballVel = [0, 0, 0]; });
  $('bReset').addEventListener('click', () => { fillBlock(state.count); state.ballVel = [0, 0, 0]; });
  $('bSplash').addEventListener('click', () => {
    state.splashPending = 1.4;
    $('bSplash').classList.add('on');
    setTimeout(() => $('bSplash').classList.remove('on'), 180);
  });
  $('selView').addEventListener('change', (e) => { state.debugView = +e.target.value; });

  function setAuto(fps) {
    const was60 = $('bAuto').classList.contains('on');
    const was30 = $('bAuto30').classList.contains('on');
    if (fps === 60 && was60) { state.dyn.auto = false; $('bAuto').classList.remove('on'); }
    else if (fps === 30 && was30) { state.dyn.auto = false; $('bAuto30').classList.remove('on'); }
    else {
      state.dyn.auto = true; state.dyn.targetFps = fps;
      $('bAuto').classList.toggle('on', fps === 60);
      $('bAuto30').classList.toggle('on', fps === 30);
    }
    if (!state.dyn.auto) { state.dyn.scale = +$('sScale').value / 100; createTargets(); }
  }
  $('bAuto').addEventListener('click', () => setAuto(60));
  $('bAuto30').addEventListener('click', () => setAuto(30));

  // --------------------------------------------------------------- input

  function pointerRay(e) {
    const rect = canvas.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width * 2 - 1;
    const v = 1 - (e.clientY - rect.top) / rect.height * 2;
    const p0 = unproj(u, v, 0.1), p1 = unproj(u, v, 0.9);
    return { ro: p0, rd: v3norm(v3sub(p1, p0)) };
  }
  function unproj(u, v, z) {
    const ip = m4.invert(projMat);
    // clip -> view
    const cx = [u, v, z, 1];
    const vx = [
      ip[0]*cx[0] + ip[4]*cx[1] + ip[8]*cx[2] + ip[12]*cx[3],
      ip[1]*cx[0] + ip[5]*cx[1] + ip[9]*cx[2] + ip[13]*cx[3],
      ip[2]*cx[0] + ip[6]*cx[1] + ip[10]*cx[2] + ip[14]*cx[3],
      ip[3]*cx[0] + ip[7]*cx[1] + ip[11]*cx[2] + ip[15]*cx[3],
    ];
    const w = vx[3] || 1;
    const pv = [vx[0]/w, vx[1]/w, vx[2]/w];
    const iv = invViewMat;
    return [
      iv[0]*pv[0] + iv[4]*pv[1] + iv[8]*pv[2] + iv[12],
      iv[1]*pv[0] + iv[5]*pv[1] + iv[9]*pv[2] + iv[13],
      iv[2]*pv[0] + iv[6]*pv[1] + iv[10]*pv[2] + iv[14],
    ];
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    state.lastPointer = { x: e.clientX, y: e.clientY };
    if (e.shiftKey) { state.drag = { mode: 'pan' }; return; }
    // ray vs sphere
    const { ro, rd } = pointerRay(e);
    const oc = v3sub(ro, state.spherePos);
    const b = v3dot(oc, rd);
    const c = v3dot(oc, oc) - Math.pow(state.sphereR * 1.15, 2);
    if (b * b - c > 0 && -b > 0) {
      state.stir = false; $('bStir').classList.remove('on');
      state.drag = { mode: 'sphere', prev: [...state.spherePos] };
    } else {
      state.drag = { mode: 'orbit' };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drag) return;
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    state.lastPointer = { x: e.clientX, y: e.clientY };
    if (state.drag.mode === 'orbit') {
      state.cam.yaw -= dx * 0.0055;
      state.cam.pitch = clamp(state.cam.pitch + dy * 0.0045, -0.05, 1.35);
    } else if (state.drag.mode === 'pan') {
      const iv = invViewMat, s = state.cam.dist * 0.0012;
      state.cam.target[0] -= (iv[0]*dx - iv[4]*dy) * s;
      state.cam.target[1] = clamp(state.cam.target[1] - (iv[1]*dx - iv[5]*dy) * s, 0, 2.2);
      state.cam.target[2] -= (iv[2]*dx - iv[6]*dy) * s;
    } else if (state.drag.mode === 'sphere') {
      const { ro, rd } = pointerRay(e);
      const fwd = [-invViewMat[8], -invViewMat[9], -invViewMat[10]];
      const denom = v3dot(rd, fwd);
      if (Math.abs(denom) > 1e-4) {
        const t = v3dot(v3sub(state.spherePos, ro), fwd) / denom;
        const p = v3add(ro, v3scale(rd, t));
        const r = state.sphereR;
        state.spherePos = [
          clamp(p[0], BOX.min[0] + r * 0.6, BOX.max[0] - r * 0.6),
          clamp(p[1], r * 0.55, 2.4),
          clamp(p[2], BOX.min[2] + r * 0.6, BOX.max[2] - r * 0.6),
        ];
      }
    }
  });
  const endDrag = (e) => { state.drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.cam.dist = clamp(state.cam.dist * Math.exp(e.deltaY * 0.001), 1.6, 12);
  }, { passive: false });

  // --------------------------------------------------- dynamic resolution

  const SCALE_STEPS = [0.45, 0.55, 0.62, 0.70, 0.78, 0.86, 0.93, 1.0];
  let lastRaiseAt = -1e9, ceilingIdx = SCALE_STEPS.length - 1, ceilingExpire = 0;
  function updateDynRes(dtMs) {
    const d = state.dyn;
    d.emaMs = d.emaMs * 0.92 + dtMs * 0.08;
    if (!d.auto) return;
    if (d.cooldown > 0) { d.cooldown--; return; }
    const now = performance.now();
    const targetMs = 1000 / d.targetFps;
    if (now > ceilingExpire) ceilingIdx = SCALE_STEPS.length - 1;
    let idx = SCALE_STEPS.findIndex(s => Math.abs(s - d.scale) < 1e-3);
    if (idx < 0) idx = 4;
    if (d.emaMs > targetMs * 1.18 && idx > 0) {
      // if we just raised and immediately missed, remember this step as too high
      if (now - lastRaiseAt < 2500) { ceilingIdx = idx - 1; ceilingExpire = now + 9000; }
      d.scale = SCALE_STEPS[idx - 1]; d.cooldown = 30; d.raiseStreak = 0;
      createTargets();
    } else if (d.emaMs <= targetMs * 1.02 && idx < Math.min(SCALE_STEPS.length - 1, ceilingIdx)) {
      // consistently hitting target (vsync-bound counts): try one step up
      if (++d.raiseStreak > 90) {
        d.scale = SCALE_STEPS[idx + 1]; d.cooldown = 30; d.raiseStreak = 0;
        lastRaiseAt = now;
        createTargets();
      }
    } else {
      d.raiseStreak = 0;
    }
  }

  // ------------------------------------------------------------ sphere anim

  let prevSpherePos = [...state.spherePos];
  const BALL_DENSITY = 420;                              // kg/m^3 -> floats in water
  const N_FULL = 900;                                    // contact samples when fully submerged
  function updateSphere(dt) {
    const draggingBall = state.drag && state.drag.mode === 'sphere';

    if (state.stir) {
      state.stirAngle += dt * 1.5;
      const R = 0.72, a = state.stirAngle;
      state.spherePos = [Math.cos(a) * R, 0.38, Math.sin(a) * R * 0.65];
    } else if (state.ballPhys && !draggingBall) {
      // ---- dynamic rigid ball: gravity + buoyancy + fluid drag
      const r = state.sphereR;
      const vol = (4 / 3) * Math.PI * r * r * r;
      const mass = BALL_DENSITY * vol;
      const smp = state.ballSample;
      const sub = clamp(smp.count / N_FULL, 0, 1.25);    // submersion fraction
      let v = state.ballVel;
      const F = [0, -9.8 * mass, 0];
      F[1] += 1000 * vol * 9.8 * sub;                    // Archimedes (water rho)
      const cD = 55 * sub;                               // fluid drag toward local flow
      F[0] += (smp.v[0] - v[0]) * cD;
      F[1] += (smp.v[1] - v[1]) * cD;
      F[2] += (smp.v[2] - v[2]) * cD;
      v = [v[0] + F[0] / mass * dt, v[1] + F[1] / mass * dt, v[2] + F[2] / mass * dt];
      const sp = Math.hypot(v[0], v[1], v[2]);
      if (sp > 6) v = v3scale(v, 6 / sp);
      let p = v3add(state.spherePos, v3scale(v, dt));
      // container collisions
      const lo = [BOX.min[0] + r, r, BOX.min[2] + r];
      const hi = [BOX.max[0] - r, 3.0, BOX.max[2] - r];
      for (let a = 0; a < 3; a++) {
        if (p[a] < lo[a]) { p[a] = lo[a]; if (v[a] < 0) v[a] *= -0.25; }
        if (p[a] > hi[a]) { p[a] = hi[a]; if (v[a] > 0) v[a] *= -0.25; }
      }
      // obstacle block collision (sphere vs AABB)
      if (state.block) {
        const cp = [
          clamp(p[0], OBS.min[0], OBS.max[0]),
          clamp(p[1], OBS.min[1], OBS.max[1]),
          clamp(p[2], OBS.min[2], OBS.max[2]),
        ];
        const d = v3sub(p, cp), l = v3len(d);
        if (l < r) {
          if (l > 1e-6) {
            const n = v3scale(d, 1 / l);
            p = v3add(cp, v3scale(n, r));
            const vn = v3dot(v, n);
            if (vn < 0) v = v3sub(v, v3scale(n, vn * 1.25));
          } else {
            p[1] = OBS.max[1] + r;
          }
        }
      }
      state.ballVel = v;
      state.spherePos = p;
      state.sphereVel = [...v];
      prevSpherePos = [...p];
      return;
    }

    // kinematic (dragged / stirred / physics off): velocity from motion
    const inst = v3scale(v3sub(state.spherePos, prevSpherePos), 1 / Math.max(dt, 1e-4));
    state.sphereVel = [
      state.sphereVel[0] * 0.6 + inst[0] * 0.4,
      state.sphereVel[1] * 0.6 + inst[1] * 0.4,
      state.sphereVel[2] * 0.6 + inst[2] * 0.4,
    ];
    state.ballVel = [...state.sphereVel];                // hand-off for release
    prevSpherePos = [...state.spherePos];
  }

  // ---------------------------------------------------------------- frame

  let lastT = performance.now();
  let simBGs = [simBG_A, simBG_B];
  let cur = 0; // which bind group holds "pred" as current

  let statTimer = 0;

  function frame(now) {
    const dtMs = Math.min(now - lastT, 100);
    lastT = now;
    const dt = dtMs / 1000;

    updateDynRes(dtMs);
    updateSphere(dt);
    emitPour(dt);

    writeSimUBO();
    writeCamUBO(now / 1000);
    writeMatUBO();
    writeSphereUBO();
    device.queue.writeBuffer(ballBuf, 0, new Int32Array(8)); // clear accumulators
    state.splashPending = 0;

    const enc = device.createCommandEncoder();

    // ---------------- simulation
    const nWG = Math.ceil(Math.max(state.active, 1) / 256);
    const cWG = Math.ceil(NUM_CELLS / 256);
    const cp = enc.beginComputePass();
    for (let s = 0; s < SUBSTEPS; s++) {
      cp.setBindGroup(0, simBGs[cur]);
      cp.setPipeline(pPredict); cp.dispatchWorkgroups(nWG);
      cp.setPipeline(pClear); cp.dispatchWorkgroups(cWG);
      cp.setPipeline(pBuild); cp.dispatchWorkgroups(nWG);
      for (let it = 0; it < ITERS; it++) {
        cp.setBindGroup(0, simBGs[cur]);
        cp.setPipeline(pLambda); cp.dispatchWorkgroups(nWG);
        cp.setPipeline(pDelta); cp.dispatchWorkgroups(nWG);
        cur ^= 1;
      }
      cp.setBindGroup(0, simBGs[cur]);
      cp.setPipeline(pFinal); cp.dispatchWorkgroups(nWG);
      cp.setPipeline(pXsph); cp.dispatchWorkgroups(nWG);
      if (state.vort > 0.001) {
        cp.setPipeline(pCurl); cp.dispatchWorkgroups(nWG);
        cp.setPipeline(pVort); cp.dispatchWorkgroups(nWG);
      }
    }
    cp.end();

    // fluid -> ball force samples (async readback, ~1 frame latency)
    if (!state.ballReadPending) enc.copyBufferToBuffer(ballBuf, 0, ballRead, 0, 32);

    // ---------------- scene pass (HDR, scaled res)
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: T.sceneColorV, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: T.depthV, depthLoadOp: 'clear', depthStoreOp: 'store',
          depthClearValue: 1.0 },
      });
      rp.setBindGroup(0, camBG);
      rp.setPipeline(skyPipe); rp.draw(3);
      rp.setPipeline(floorPipe); rp.draw(6);
      rp.setPipeline(meshPipe);
      rp.setBindGroup(1, sphereBG);
      rp.setVertexBuffer(0, sphVB); rp.setIndexBuffer(sphIB, 'uint16');
      rp.drawIndexed(sphGeo.idx.length);
      if (state.block) {
        rp.setBindGroup(1, blockBG);
        rp.setVertexBuffer(0, cubVB); rp.setIndexBuffer(cubIB, 'uint16');
        rp.drawIndexed(cubGeo.idx.length);
      }
      rp.setPipeline(linePipe);
      rp.setVertexBuffer(0, edgeVB);
      rp.draw(24);
      rp.end();
    }

    // ---------------- fluid thickness (additive, depth-tested vs scene)
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: T.thickV, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        depthStencilAttachment: { view: T.depthV, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      rp.setBindGroup(0, camBG); rp.setBindGroup(1, partsBG);
      rp.setPipeline(thickPipe);
      rp.draw(6, state.active);
      rp.end();
    }

    // ---------------- fluid depth (sphere impostors)
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: T.fluidAV, loadOp: 'clear', storeOp: 'store',
          clearValue: { r: 1e9, g: 0, b: 0, a: 0 } }],
        depthStencilAttachment: { view: T.depthV, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      rp.setBindGroup(0, camBG); rp.setBindGroup(1, partsBG);
      rp.setPipeline(depthSpritePipe);
      rp.draw(6, state.active);
      rp.end();
    }

    // ---------------- bilateral blur H then V (skipped in particles debug view)
    if (state.debugView !== 1) {
      {
        const rp = enc.beginRenderPass({
          colorAttachments: [{ view: T.fluidBV, loadOp: 'clear', storeOp: 'store' }],
        });
        rp.setBindGroup(0, camBG); rp.setBindGroup(1, T.blurBG_H);
        rp.setPipeline(blurPipe); rp.draw(3);
        rp.end();
      }
      {
        const rp = enc.beginRenderPass({
          colorAttachments: [{ view: T.fluidAV, loadOp: 'clear', storeOp: 'store' }],
        });
        rp.setBindGroup(0, camBG); rp.setBindGroup(1, T.blurBG_V);
        rp.setPipeline(blurPipe); rp.draw(3);
        rp.end();
      }
    }

    // ---------------- composite + upscale to canvas
    {
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(),
          loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      });
      rp.setBindGroup(0, camBG); rp.setBindGroup(1, T.compBG);
      rp.setPipeline(compositePipe); rp.draw(3);
      rp.end();
    }

    device.queue.submit([enc.finish()]);

    // ---------------- ball force readback
    if (!state.ballReadPending) {
      state.ballReadPending = true;
      ballRead.mapAsync(GPUMapMode.READ).then(() => {
        const a = new Int32Array(ballRead.getMappedRange());
        const count = a[3] / SUBSTEPS;
        const inv = a[3] > 0 ? 1 / (256 * a[3]) : 0;
        state.ballSample = { count, v: [a[0] * inv, a[1] * inv, a[2] * inv] };
        ballRead.unmap();
        state.ballReadPending = false;
      }).catch(() => { state.ballReadPending = false; });
    }

    // ---------------- stats
    state.stats.frames++;
    state.stats.acc += dtMs;
    statTimer += dtMs;
    if (statTimer > 450) {
      const fps = 1000 / (state.stats.acc / state.stats.frames);
      $('stFps').textContent = fps.toFixed(0);
      $('stMs').textContent = (state.stats.acc / state.stats.frames).toFixed(1);
      $('stN').textContent = (state.active / 1000).toFixed(1) + 'k';
      $('stScale').textContent = Math.round(state.dyn.scale * 100) + '%' +
        (state.dyn.auto ? ' auto' : ' manual') + ` (${T.w}×${T.h})`;
      $('dyresFill').style.width = Math.round(state.dyn.scale * 100) + '%';
      state.stats.frames = 0; state.stats.acc = 0;
      statTimer = 0;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(err => {
  console.error(err);
  const f = document.getElementById('fatal');
  f.style.display = 'flex';
  document.getElementById('fatalMsg').textContent = 'Initialization failed: ' + err.message;
});
