// Slate Fluid — WebGPU edition. Simulation (PBF) and rendering both run on the GPU.
import { SIM_WGSL, MAX_BALLS, MAX_OBS, CELL_CAP } from './sim.wgsl.js';
import { PARTICLE_WGSL, SCENE_WGSL, SMOOTH_WGSL, BLUR_WGSL, COMPOSITE_WGSL } from './render.wgsl.js';

const SPACING = 0.6, PR = 0.3, BASE_G = 98;
const errEl = document.getElementById('err');
function fail(msg) { errEl.innerHTML = msg; throw new Error(msg); }

// ------------------------------------------------------------------ fluids
// sim: viscosity (XSPH c), passes, adhesion, friction, cohesion, yield, iterations
// look: albedo+opacity, absorption+roughness, inscatter colour+density, [F0, refraction, wrap, foam], [noise, detail, clearcoat, caustics]
const FLUIDS = {
  water: {
    sim: { visc: 0.012, passes: 1, adh: 0.02, fric: 0.01, coh: 0.0, yld: 0, iters: 4, foam: 1 },
    look: { base: [0.6, 0.8, 0.9, 0.0], absorb: [0.30, 0.085, 0.05, 0.035], scatter: [0.02, 0.16, 0.2, 0.25], p0: [0.02, 0.07, 0.0, 1.0], p1: [0, 0.035, 0, 1.0] },
  },
  milk: {
    sim: { visc: 0.05, passes: 1, adh: 0.08, fric: 0.05, coh: 0.02, yld: 0, iters: 4, foam: 0 },
    look: { base: [0.94, 0.92, 0.87, 1.7], absorb: [0.04, 0.05, 0.08, 0.24], scatter: [0, 0, 0, 0], p0: [0.03, 0.01, 0.75, 0], p1: [0, 0.02, 0.25, 0.0] },
  },
  chocolate: {
    sim: { visc: 0.35, passes: 2, adh: 0.35, fric: 0.3, coh: 0.08, yld: 0.6, iters: 4, foam: 0 },
    look: { base: [0.13, 0.055, 0.024, 3.5], absorb: [0.5, 0.8, 1.0, 0.22], scatter: [0, 0, 0, 0], p0: [0.045, 0.0, 0.2, 0], p1: [0, 0.03, 0.8, 0.0] },
  },
  honey: {
    sim: { visc: 0.55, passes: 3, adh: 0.6, fric: 0.55, coh: 0.12, yld: 0, iters: 4, foam: 0 },
    look: { base: [0.85, 0.45, 0.06, 0.04], absorb: [0.05, 0.22, 0.85, 0.05], scatter: [0.55, 0.25, 0.02, 0.18], p0: [0.045, 0.09, 0.5, 0], p1: [0, 0.0, 0.9, 0.6] },
  },
  mud: {
    sim: { visc: 0.4, passes: 2, adh: 0.4, fric: 0.5, coh: 0.05, yld: 2.5, iters: 4, foam: 0 },
    look: { base: [0.27, 0.19, 0.12, 4.0], absorb: [0.6, 0.8, 1.0, 0.62], scatter: [0, 0, 0, 0], p0: [0.025, 0.0, 0.05, 0], p1: [1, 0.35, 0.15, 0.0] },
  },
};
const SCENE_DEFAULT = { dam: 'water', splash: 'milk', ocean: 'water', pour: 'chocolate' };
const QUALITY = { tiny: 5000, fast: 15000, low: 40000, medium: 100000, high: 200000 };

// ------------------------------------------------------------------ init
if (!navigator.gpu) fail('WebGPU is not available in this browser.<br>Use Chrome/Edge 113+ (desktop) or open <a href="legacy.html">the WebGL/CPU version</a>.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found. <a href="legacy.html">Open the WebGL/CPU version</a>.');
const device = await adapter.requestDevice({
  requiredLimits: {
    maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
    maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
  },
});
device.lost.then(i => fail('GPU device lost: ' + i.message));
device.addEventListener('uncapturederror', e => { console.error(e.error.message); errEl.textContent = 'WebGPU error: ' + e.error.message; });

const canvas = document.getElementById('c');
const ctx = canvas.getContext('webgpu');
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

const U = GPUBufferUsage, T = GPUTextureUsage, S = GPUShaderStage;
const buf = (size, usage) => device.createBuffer({ size: Math.ceil(size / 16) * 16, usage });
const mod = (code) => device.createShaderModule({ code });

// ------------------------------------------------------------------ layouts
function bgl(entries) {
  return device.createBindGroupLayout({
    entries: entries.map((e, i) => {
      const [vis, kind, extra] = e;
      const o = { binding: i, visibility: vis };
      if (kind === 'u') o.buffer = { type: 'uniform' };
      else if (kind === 's') o.buffer = { type: 'storage' };
      else if (kind === 'r') o.buffer = { type: 'read-only-storage' };
      else if (kind === 't') o.texture = { sampleType: extra || 'unfilterable-float' };
      else if (kind === 'p') o.sampler = { type: 'filtering' };
      return o;
    }),
  });
}
const VF = S.VERTEX | S.FRAGMENT, F = S.FRAGMENT, V = S.VERTEX, C = S.COMPUTE;
const L = {
  sim: bgl([[C, 'u'], [C, 's'], [C, 's'], [C, 's'], [C, 's'], [C, 's'], [C, 's'], [C, 's']]),
  part: bgl([[VF, 'u'], [V, 'r'], [V, 'r'], [F, 't']]),
  scene: bgl([[VF, 'u'], [VF, 'r'], [VF, 'r'], [F, 't'], [F, 't', 'float'], [F, 'p'], [F, 'u']]),
  smooth: bgl([[F, 'u'], [F, 't'], [F, 'u']]),
  blur: bgl([[F, 't'], [F, 'u']]),
  comp: bgl([[F, 'u'], [F, 'u'], [F, 't', 'float'], [F, 't'], [F, 't'], [F, 't'], [F, 't'], [F, 't', 'float'], [F, 'p']]),
};
const pl = (l) => device.createPipelineLayout({ bindGroupLayouts: [l] });

// ------------------------------------------------------------------ pipelines
const simMod = mod(SIM_WGSL);
const simPipes = {};
for (const ep of ['ballPredict', 'ballFinalize', 'clearGrid', 'predict', 'insert', 'lambda', 'delta', 'copyPred', 'velocity', 'viscosity', 'copyVel', 'finalize'])
  simPipes[ep] = device.createComputePipeline({ layout: pl(L.sim), compute: { module: simMod, entryPoint: ep } });

const partMod = mod(PARTICLE_WGSL), sceneMod = mod(SCENE_WGSL), smoothMod = mod(SMOOTH_WGSL), blurMod = mod(BLUR_WGSL), compMod = mod(COMPOSITE_WGSL);
const ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
const SCENE_TARGETS = [{ format: 'rgba16float' }, { format: 'r32float' }];
const DEPTH = (write = true, cmp = 'less') => ({ format: 'depth24plus', depthWriteEnabled: write, depthCompare: cmp });
function rp(layout, module, vs, fs, targets, opts = {}) {
  return device.createRenderPipeline({
    layout: pl(layout),
    vertex: { module, entryPoint: vs, buffers: opts.buffers || [] },
    fragment: { module, entryPoint: fs, targets },
    primitive: { topology: opts.topology || 'triangle-list', cullMode: opts.cull || 'none' },
    depthStencil: opts.depth,
  });
}
const MESH_BUFS = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] }];
const P = {
  fluidDepth: rp(L.part, partMod, 'vsCam', 'fsDepth', [{ format: 'r32float' }], { depth: DEPTH() }),
  fluidThick: rp(L.part, partMod, 'vsCam', 'fsThick', [{ format: 'rgba16float', blend: ADD }]),
  lightDepth: rp(L.part, partMod, 'vsLight', 'fsLightDepth', [{ format: 'r32float' }], { depth: DEPTH() }),
  lightThick: rp(L.part, partMod, 'vsLight', 'fsLightThick', [{ format: 'r16float', blend: ADD }]),
  debug: rp(L.part, partMod, 'vsCam', 'fsDebug', SCENE_TARGETS, { depth: DEPTH() }),
  sky: rp(L.scene, sceneMod, 'vsFull', 'fsSky', SCENE_TARGETS, { depth: DEPTH(false, 'always') }),
  mesh: rp(L.scene, sceneMod, 'vsMesh', 'fsMesh', SCENE_TARGETS, { depth: DEPTH(), buffers: MESH_BUFS }),
  walls: rp(L.scene, sceneMod, 'vsMesh', 'fsMesh', SCENE_TARGETS, { depth: DEPTH(), buffers: MESH_BUFS, cull: 'front' }),
  smooth: rp(L.smooth, smoothMod, 'vsFull', 'fsSmooth', [{ format: 'r32float' }]),
  blur: rp(L.blur, blurMod, 'vsFull', 'fsBlur', [{ format: 'rgba16float' }]),
  comp: rp(L.comp, compMod, 'vsFull', 'fsComposite', [{ format: canvasFormat }]),
};

// ------------------------------------------------------------------ geometry
function meshBuffers(verts, idx) {
  const vb = device.createBuffer({ size: verts.length * 4, usage: U.VERTEX | U.COPY_DST });
  device.queue.writeBuffer(vb, 0, new Float32Array(verts));
  const padded = idx.length % 2 ? [...idx, 0] : idx;
  const ib = device.createBuffer({ size: padded.length * 2, usage: U.INDEX | U.COPY_DST });
  device.queue.writeBuffer(ib, 0, new Uint16Array(padded));
  return { vb, ib, count: idx.length };
}
function sphereGeo(seg = 48, ring = 28) {
  const v = [], idx = [];
  for (let r = 0; r <= ring; r++) for (let s = 0; s <= seg; s++) {
    const th = r / ring * Math.PI, ph = s / seg * Math.PI * 2;
    const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    v.push(x, y, z, x, y, z);
  }
  for (let r = 0; r < ring; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return meshBuffers(v, idx);
}
function boxGeo() {
  const v = [], idx = [];
  for (const f of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const u = f[1] !== 0 ? [1, 0, 0] : [0, 1, 0];
    const w = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    const b = v.length / 6;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      v.push(f[0] + u[0] * a + w[0] * c, f[1] + u[1] * a + w[1] * c, f[2] + u[2] * a + w[2] * c, ...f);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return meshBuffers(v, idx);
}
const GEO = {
  sphere: sphereGeo(), box: boxGeo(),
  floor: meshBuffers([-400, 0, -400, 0, 1, 0, 400, 0, -400, 0, 1, 0, 400, 0, 400, 0, 1, 0, -400, 0, 400, 0, 1, 0], [0, 2, 1, 0, 3, 2]),
};

// ------------------------------------------------------------------ math
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function lookAt(e, c, up) {
  const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, f / (n - f), -1, 0, 0, n * f / (n - f), 0]; }
function ortho(e, far) { return [1 / e, 0, 0, 0, 0, 1 / e, 0, 0, 0, 0, -1 / far, 0, 0, 0, 0, 1]; }
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function invRigid(m) {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]);
  r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]);
  r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
}
const TS = (t, s) => [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1];
const SUN = norm([0.42, 0.82, 0.38]);

// ------------------------------------------------------------------ state
const state = { scene: 'dam', fluid: 'water', quality: 'tiny', paused: false, view: 'fluid', smooth: 3, ballSize: 2.2, ballDensity: 2.0, keep: false, slowmo: 1 };
const cam = { yaw: -0.55, pitch: 0.42, dist: 60, target: [20, 6, 7], fov: 45 * Math.PI / 180 };
let SC = null;           // current scene description
let sim = null;          // GPU sim resources
let N = 0, numBalls = 0, ballCursor = 0;

// ------------------------------------------------------------------ scene construction (CPU, once per reset)
function rampFrom(x0, x1, h) { const nx = -h, ny = x1 - x0, l = Math.hypot(nx, ny); const n = [nx / l, ny / l]; return { type: 'ramp', n, o: n[0] * x0, x0, x1, h }; }
function sdStatic(obs, x, y, z) {
  let best = 1e9;
  for (const o of obs) {
    let d;
    if (o.type === 'sphere') d = Math.hypot(x - o.c[0], y - o.c[1], z - o.c[2]) - o.r;
    else if (o.type === 'box') {
      const q = [Math.abs(x - o.c[0]) - o.h[0], Math.abs(y - o.c[1]) - o.h[1], Math.abs(z - o.c[2]) - o.h[2]];
      d = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(...q), 0);
    } else d = o.n[0] * x + o.n[1] * y - o.o;
    best = Math.min(best, d);
  }
  return best;
}
function buildScene(name, target) {
  const base = { dam: 12900, splash: 11400, ocean: 9800, pour: 12000 }[name];
  const s = Math.cbrt(target / base);
  const sc = { name, s, obstacles: [], paddle: null, emitter: null, balls: [] };
  const box = (c, h) => sc.obstacles.push({ type: 'box', c: c.map(v => v * s), h: h.map(v => v * s) });
  const sph = (c, r) => sc.obstacles.push({ type: 'sphere', c: c.map(v => v * s), r: r * s });
  const fills = [];
  if (name === 'dam') {
    [sc.W, sc.H, sc.D] = [40 * s, 28 * s, 14 * s];
    box([26, 4.5, 7], [1.5, 4.5, 2.5]); sph([33, 2.5, 3.5], 2.5);
    fills.push([0.5, 0.5, 0.5, 13 * s, 17 * s, sc.D - 0.5]);
  } else if (name === 'splash') {
    [sc.W, sc.H, sc.D] = [28 * s, 30 * s, 16 * s];
    fills.push([0.5, 0.5, 0.5, sc.W - 0.5, 5.5 * s, sc.D - 0.5]);
    const c = [9 * s, 16 * s, 8 * s], R = 3.6 * s;
    fills.push([c[0] - R, c[1] - R, c[2] - R, c[0] + R, c[1] + R, c[2] + R, (x, y, z) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < R * R]);
    sc.balls.push({ p: [19 * s, 22 * s, 8 * s], v: [0, -10 * s, 0], r: 2.6 * s, density: 2.5 });
  } else if (name === 'ocean') {
    [sc.W, sc.H, sc.D] = [56 * s, 24 * s, 10 * s];
    sc.obstacles.push(rampFrom(28 * s, 56 * s, 13 * s));
    box([40, 6, 5], [1.2, 6, 1.2]);
    sc.paddle = { base: 1.0 * s, amp: 6.0 * s, period: 2.6 };
    fills.push([sc.paddle.base + 0.5, 0.5, 0.5, sc.W - 0.5, 6.5 * s, sc.D - 0.5]);
  } else if (name === 'pour') {
    [sc.W, sc.H, sc.D] = [30 * s, 34 * s, 20 * s];
    box([15, 3.5, 10], [3, 3.5, 3]); sph([15, 11.2, 10], 4.4); box([6, 1.5, 6], [2.5, 1.5, 2.5]);
    sc.emitter = { c: [14.2 * s, 30 * s, 10 * s], r: 1.5 * s, speed: 16 * s, acc: 0 };
    fills.push([0.5, 0.5, 0.5, sc.W - 0.5, 1.4 * s, sc.D - 0.5]);
  }
  sc.g = BASE_G * s;
  sc.substeps = Math.max(2, Math.ceil(2 * s));
  sc.max = Math.ceil(target * 1.2) + 4096;
  // particles
  const pts = [];
  const jit = () => (Math.random() - 0.5) * 0.02;
  for (const [x0, y0, z0, x1, y1, z1, acc] of fills)
    for (let y = y0; y < y1; y += SPACING) for (let z = z0; z < z1; z += SPACING) for (let x = x0; x < x1; x += SPACING) {
      if (acc && !acc(x, y, z)) continue;
      if (sdStatic(sc.obstacles, x, y, z) < PR) continue;
      if (pts.length / 3 >= sc.max) break;
      pts.push(x + jit(), y + jit(), z + jit());
    }
  sc.initial = pts;
  return sc;
}

// rest density for the lattice
const RHO0 = (() => { let s = 0; for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) { const r2 = (i * i + j * j + k * k) * SPACING * SPACING; if (r2 < 1) s += 1.5666814 * (1 - r2) ** 3; } return s; })();

// ------------------------------------------------------------------ GPU sim resources
const paramsBuf = buf(352, U.UNIFORM | U.COPY_DST);
const paramsAB = new ArrayBuffer(352), pF = new Float32Array(paramsAB), pU = new Uint32Array(paramsAB);
const worldBuf = buf(400, U.STORAGE | U.COPY_DST);
const camBuf = buf(384, U.UNIFORM | U.COPY_DST);
const camF = new Float32Array(96);
const matBuf = buf(80, U.UNIFORM | U.COPY_DST);
const dirBufs = [0, 1, 2, 3].map(() => buf(16, U.UNIFORM | U.COPY_DST));
const instBuf = buf(96 * 32, U.STORAGE | U.COPY_DST);
const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
const LIGHT_RES = 1024;
const lightDepthTex = device.createTexture({ size: [LIGHT_RES, LIGHT_RES], format: 'r32float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
const lightThickTex = device.createTexture({ size: [LIGHT_RES, LIGHT_RES], format: 'r16float', usage: T.RENDER_ATTACHMENT | T.TEXTURE_BINDING });
const lightZ = device.createTexture({ size: [LIGHT_RES, LIGHT_RES], format: 'depth24plus', usage: T.RENDER_ATTACHMENT });
const dummyR32 = device.createTexture({ size: [1, 1], format: 'r32float', usage: T.TEXTURE_BINDING });

function createSim(sc) {
  if (sim) for (const b of sim.buffers) b.destroy();
  const M = sc.max;
  const gx = Math.ceil(sc.W), gy = Math.ceil(sc.H), gz = Math.ceil(sc.D);
  const cells = gx * gy * gz;
  const mk = (n) => buf(n, U.STORAGE | U.COPY_DST | U.VERTEX);
  const pos = mk(M * 16), vel = mk(M * 16), pred = mk(M * 16), tmp = mk(M * 16);
  const gridCount = mk(cells * 4), gridIdx = mk(cells * CELL_CAP * 4);
  const simBG = device.createBindGroup({
    layout: L.sim, entries: [paramsBuf, pos, vel, pred, tmp, gridCount, gridIdx, worldBuf].map((b, i) => ({ binding: i, resource: { buffer: b } })),
  });
  sim = { pos, vel, pred, tmp, gridCount, gridIdx, simBG, cells, gx, gy, gz, buffers: [pos, vel, pred, tmp, gridCount, gridIdx] };
  // initial particles
  N = sc.initial.length / 3;
  const P4 = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { P4[i * 4] = sc.initial[i * 3]; P4[i * 4 + 1] = sc.initial[i * 3 + 1]; P4[i * 4 + 2] = sc.initial[i * 3 + 2]; P4[i * 4 + 3] = 1; }
  device.queue.writeBuffer(pos, 0, P4);
  device.queue.writeBuffer(vel, 0, new Float32Array(M * 4));
  // world: balls + paddle
  numBalls = 0; ballCursor = 0;
  const W = new Float32Array(100);
  W[MAX_BALLS * 8] = sc.paddle ? sc.paddle.base : 0;
  device.queue.writeBuffer(worldBuf, 0, W);
  for (const b of sc.balls) addBall(b.p, b.v, b.r, b.density);
  rebuildBindGroups();
}

function addBall(p, v, r, density) {
  const k = ballCursor; ballCursor = (ballCursor + 1) % MAX_BALLS; numBalls = Math.min(MAX_BALLS, numBalls + 1);
  const m = density * (4 / 3) * Math.PI * r ** 3 / SPACING ** 3;
  device.queue.writeBuffer(worldBuf, k * 32, new Float32Array([p[0], p[1], p[2], r, v[0], v[1], v[2], m]));
  ballDensities[k] = density;
}
const ballDensities = new Array(MAX_BALLS).fill(2);

function writeParams() {
  const sc = SC, f = FLUIDS[state.fluid].sim;
  const dt = (1 / 60) / sc.substeps * state.slowmo;
  pF.set([sc.W, sc.H, sc.D, PR], 0);
  pU.set([sim.gx, sim.gy, sim.gz, N], 4);
  pF.set([dt, sc.g, RHO0, 0.35], 8);
  pF.set([f.visc, f.adh, f.fric, f.coh], 12);
  pF.set([f.yld * sc.s, 0.004, sc.paddle ? sc.paddle.base : 0, sc.paddle ? sc.paddle.amp : 0], 16);
  pF.set([sc.paddle ? sc.paddle.period : 0, numBalls, sc.obstacles.length, f.foam], 20);
  for (let k = 0; k < MAX_OBS * 2; k++) pF.set([0, 0, 0, 0], 24 + k * 4);
  sc.obstacles.slice(0, MAX_OBS).forEach((o, k) => {
    const a = 24 + k * 8;
    if (o.type === 'sphere') { pF.set([0, ...o.c], a); pF.set([o.r, 0, 0, 0], a + 4); }
    else if (o.type === 'box') { pF.set([1, ...o.c], a); pF.set([...o.h, 0], a + 4); }
    else { pF.set([2, o.n[0], o.n[1], o.o], a); }
  });
  device.queue.writeBuffer(paramsBuf, 0, paramsAB);
}

function emit(frameDt) {
  const e = SC.emitter;
  if (!e || N >= Math.min(SC.max, QUALITY[state.quality])) return;
  e.acc += e.speed * frameDt * state.slowmo;
  const pts = [];
  while (e.acc >= SPACING) {
    e.acc -= SPACING;
    const y = e.c[1] - e.acc;
    for (let a = -e.r; a <= e.r; a += SPACING) for (let b = -e.r; b <= e.r; b += SPACING)
      if (a * a + b * b <= e.r * e.r) pts.push(e.c[0] + a + (Math.random() - 0.5) * 0.02, y, e.c[2] + b + (Math.random() - 0.5) * 0.02);
  }
  const n = Math.min(pts.length / 3, SC.max - N);
  if (n <= 0) return;
  const P4 = new Float32Array(n * 4), V4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { P4.set([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 1], i * 4); V4.set([0, -e.speed, 0, 0], i * 4); }
  device.queue.writeBuffer(sim.pos, N * 16, P4);
  device.queue.writeBuffer(sim.vel, N * 16, V4);
  N += n;
}

// ------------------------------------------------------------------ render targets
let RT = null, Wpx = 0, Hpx = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (RT && w === Wpx && h === Hpx) return;
  Wpx = w; Hpx = h; canvas.width = w; canvas.height = h;
  if (RT) for (const t of RT.all) t.destroy();
  const tex = (format, usage = T.RENDER_ATTACHMENT | T.TEXTURE_BINDING) => device.createTexture({ size: [w, h], format, usage });
  RT = {
    sceneColor: tex('rgba16float'), sceneLin: tex('r32float'), sceneZ: tex('depth24plus', T.RENDER_ATTACHMENT),
    fDepthA: tex('r32float'), fDepthB: tex('r32float'), fluidZ: tex('depth24plus', T.RENDER_ATTACHMENT),
    thickA: tex('rgba16float'), thickB: tex('rgba16float'),
  };
  RT.all = Object.values(RT);
  rebuildBindGroups();
}

let BG = null;
function rebuildBindGroups() {
  if (!RT || !sim) return;
  const e = (list) => list.map((r, i) => ({ binding: i, resource: r instanceof GPUBuffer ? { buffer: r } : r instanceof GPUTexture ? r.createView() : r }));
  BG = {
    part: device.createBindGroup({ layout: L.part, entries: e([camBuf, sim.pos, sim.vel, RT.sceneLin]) }),
    partNoScene: device.createBindGroup({ layout: L.part, entries: e([camBuf, sim.pos, sim.vel, dummyR32]) }),
    scene: device.createBindGroup({ layout: L.scene, entries: e([camBuf, instBuf, worldBuf, lightDepthTex, lightThickTex, sampler, matBuf]) }),
    smoothH: device.createBindGroup({ layout: L.smooth, entries: e([camBuf, RT.fDepthA, dirBufs[0]]) }),
    smoothV: device.createBindGroup({ layout: L.smooth, entries: e([camBuf, RT.fDepthB, dirBufs[1]]) }),
    blurH: device.createBindGroup({ layout: L.blur, entries: e([RT.thickA, dirBufs[2]]) }),
    blurV: device.createBindGroup({ layout: L.blur, entries: e([RT.thickB, dirBufs[3]]) }),
    comp: device.createBindGroup({ layout: L.comp, entries: e([camBuf, matBuf, RT.sceneColor, RT.fDepthA, RT.thickA, RT.sceneLin, lightDepthTex, lightThickTex, sampler]) }),
  };
}

// ------------------------------------------------------------------ scene instances
let draws = [];
function buildInstances(sc) {
  const inst = [];
  draws = [];
  const push = (model, color, kind, ball = 0, rough = 0.5) => { inst.push({ model, color, params: [kind, ball, rough, 0] }); return inst.length - 1; };
  draws.push({ geo: 'floor', first: push(TS([0, 0, 0], [1, 1, 1]), [1, 1, 1, 1], 3, 0, 0.75), count: 1, pipe: 'mesh' });
  draws.push({ geo: 'box', first: push(TS([sc.W / 2, sc.H / 2 - 0.02, sc.D / 2], [sc.W / 2, sc.H / 2, sc.D / 2]), [1, 1, 1, 1], 4, 0, 0.35), count: 1, pipe: 'walls' });
  for (const o of sc.obstacles) {
    if (o.type === 'sphere') draws.push({ geo: 'sphere', first: push(TS(o.c, [o.r, o.r, o.r]), [0.78, 0.78, 0.8, 1], 0, 0, 0.2), count: 1, pipe: 'mesh' });
    else if (o.type === 'box') draws.push({ geo: 'box', first: push(TS(o.c, o.h), [0.6, 0.53, 0.46, 1], 0, 0, 0.6), count: 1, pipe: 'mesh' });
    else {
      const len = Math.hypot(o.x1 - o.x0, o.h), th = 1.5 * sc.s, a = Math.atan2(o.h, o.x1 - o.x0);
      const c = [(o.x0 + o.x1) / 2 - o.n[0] * th, o.h / 2 - o.n[1] * th, sc.D / 2];
      const ca = Math.cos(a), sa = Math.sin(a), hx = len / 2, hz = sc.D / 2;
      const m = [ca * hx, sa * hx, 0, 0, -sa * th, ca * th, 0, 0, 0, 0, hz, 0, c[0], c[1], c[2], 1];
      draws.push({ geo: 'box', first: push(m, [0.78, 0.7, 0.54, 1], 0, 0, 0.9), count: 1, pipe: 'mesh' });
    }
  }
  if (sc.paddle) {
    const h = sc.H * 0.55;
    draws.push({ geo: 'box', first: push(TS([-0.5, h / 2, sc.D / 2], [0.5, h / 2, sc.D / 2]), [0.3, 0.33, 0.38, 1], 2, 0, 0.4), count: 1, pipe: 'mesh' });
  }
  const ballFirst = inst.length;
  for (let k = 0; k < MAX_BALLS; k++) push(TS([0, 0, 0], [1, 1, 1]), [0.75, 0.12, 0.1, 1], 1, k, 0.3);
  draws.push({ geo: 'sphere', first: ballFirst, count: 'balls', pipe: 'mesh' });
  const F32 = new Float32Array(inst.length * 24);
  inst.forEach((it, i) => { F32.set(it.model, i * 24); F32.set(it.color, i * 24 + 16); F32.set(it.params, i * 24 + 20); });
  device.queue.writeBuffer(instBuf, 0, F32);
  SC.ballFirst = ballFirst;
}
function updateBallColors() {
  for (let k = 0; k < MAX_BALLS; k++) {
    const d = ballDensities[k];
    const c = d < 1 ? [0.9, 0.72, 0.15, 1] : d < 2.5 ? [0.75, 0.1, 0.08, 1] : [0.33, 0.35, 0.4, 1];
    device.queue.writeBuffer(instBuf, (SC.ballFirst + k) * 96 + 64, new Float32Array(c));
  }
}

// ------------------------------------------------------------------ load
function loadScene(name, fluid) {
  state.scene = name;
  state.fluid = fluid || SCENE_DEFAULT[name];
  SC = buildScene(name, QUALITY[state.quality]);
  createSim(SC);
  buildInstances(SC);
  cam.target = [SC.W / 2, SC.H * 0.2, SC.D / 2];
  cam.dist = Math.max(SC.W, SC.H) * 1.3;
  syncUI();
}

// ------------------------------------------------------------------ per-frame uniforms
let eye, view, invView, tanXY;
function writeCamera(time) {
  const cp = Math.cos(cam.pitch);
  eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  view = lookAt(eye, cam.target, [0, 1, 0]);
  invView = invRigid(view);
  const asp = Wpx / Hpx, proj = persp(cam.fov, asp, 0.5, 3000);
  const ty = Math.tan(cam.fov / 2); tanXY = [ty * asp, ty];
  // light: orthographic from the sun, covering the tank
  const center = [SC.W / 2, SC.H * 0.35, SC.D / 2];
  const R = 0.5 * Math.hypot(SC.W, SC.H, SC.D) + 2;
  const lo = [center[0] + SUN[0] * R * 1.5, center[1] + SUN[1] * R * 1.5, center[2] + SUN[2] * R * 1.5];
  const lview = lookAt(lo, center, [0, 1, 0]);
  const lvp = mul(ortho(R, R * 3), lview);
  camF.set(view, 0); camF.set(proj, 16); camF.set(invView, 32); camF.set(lvp, 48);
  camF.set([...eye, time], 64);
  camF.set([Wpx, Hpx, tanXY[0], tanXY[1]], 68);
  camF.set([PR * RENDER_SCALE, Hpx * proj[5], numBalls, state.view === 'fluid' ? 1 : 0], 72);
  camF.set([SC.W, SC.H, SC.D, SC.paddle ? 1 : 0], 76);
  camF.set([...lo, LIGHT_RES], 80);
  camF.set([lview[0], lview[4], lview[8], R], 84);
  camF.set([lview[1], lview[5], lview[9], 0], 88);
  device.queue.writeBuffer(camBuf, 0, camF);
  const lk = FLUIDS[state.fluid].look;
  device.queue.writeBuffer(matBuf, 0, new Float32Array([...lk.base, ...lk.absorb, ...lk.scatter, ...lk.p0, ...lk.p1]));
  const r = PR * 3.0, fall = PR * 2.2;
  device.queue.writeBuffer(dirBufs[0], 0, new Float32Array([1, 0, r, fall]));
  device.queue.writeBuffer(dirBufs[1], 0, new Float32Array([0, 1, r, fall]));
  device.queue.writeBuffer(dirBufs[2], 0, new Float32Array([1, 0, 1.5, 0]));
  device.queue.writeBuffer(dirBufs[3], 0, new Float32Array([0, 1, 1.5, 0]));
}
const RENDER_SCALE = 1.5;

// ------------------------------------------------------------------ frame
function encodeSim(enc) {
  const f = FLUIDS[state.fluid].sim;
  const pass = enc.beginComputePass();
  pass.setBindGroup(0, sim.simBG);
  const wg = Math.ceil(N / 128), wgCells = Math.ceil(sim.cells / 256);
  const run = (name, n) => { pass.setPipeline(simPipes[name]); pass.dispatchWorkgroups(n); };
  for (let s = 0; s < SC.substeps; s++) {
    run('ballPredict', 1);
    run('clearGrid', wgCells);
    run('predict', wg);
    run('insert', wg);
    const iters = SC.substeps >= 4 ? 3 : f.iters;
    for (let it = 0; it < iters; it++) { run('lambda', wg); run('delta', wg); run('copyPred', wg); }
    run('velocity', wg);
    for (let v = 0; v < f.passes; v++) { run('viscosity', wg); run('copyVel', wg); }
    run('finalize', wg);
    run('ballFinalize', 1);
  }
  pass.end();
}
const view_ = (t) => t.createView();
function drawGeo(pass, d) {
  const g = GEO[d.geo];
  const count = d.count === 'balls' ? numBalls : d.count;
  if (!count) return;
  pass.setPipeline(P[d.pipe]);
  pass.setVertexBuffer(0, g.vb);
  pass.setIndexBuffer(g.ib, 'uint16');
  pass.drawIndexed(g.count, count, 0, 0, d.first);
}
function encodeRender(enc) {
  const fluidOn = state.view === 'fluid';
  // 1. light-space fluid maps (shadows, caustics, self-shadowing)
  {
    const p = enc.beginRenderPass({
      colorAttachments: [{ view: view_(lightDepthTex), clearValue: [1e6, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: view_(lightZ), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    p.setPipeline(P.lightDepth); p.setBindGroup(0, BG.partNoScene); p.draw(6, N); p.end();
    const q = enc.beginRenderPass({ colorAttachments: [{ view: view_(lightThickTex), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
    q.setPipeline(P.lightThick); q.setBindGroup(0, BG.partNoScene); q.draw(6, N); q.end();
  }
  // 2. scene
  {
    const p = enc.beginRenderPass({
      colorAttachments: [
        { view: view_(RT.sceneColor), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' },
        { view: view_(RT.sceneLin), clearValue: [1e6, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: view_(RT.sceneZ), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    p.setBindGroup(0, BG.scene);
    p.setPipeline(P.sky); p.draw(3);
    for (const d of draws) drawGeo(p, d);
    if (!fluidOn) { p.setPipeline(P.debug); p.setBindGroup(0, BG.partNoScene); p.draw(6, N); }
    p.end();
  }
  // 3. fluid surface depth + thickness
  {
    const p = enc.beginRenderPass({
      colorAttachments: [{ view: view_(RT.fDepthA), clearValue: [1e6, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: view_(RT.fluidZ), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    if (fluidOn) { p.setPipeline(P.fluidDepth); p.setBindGroup(0, BG.part); p.draw(6, N); }
    p.end();
    const q = enc.beginRenderPass({ colorAttachments: [{ view: view_(RT.thickA), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
    if (fluidOn) { q.setPipeline(P.fluidThick); q.setBindGroup(0, BG.part); q.draw(6, N); }
    q.end();
  }
  // 4. smoothing
  const fs = (target, pipe, bg) => {
    const p = enc.beginRenderPass({ colorAttachments: [{ view: view_(target), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
    p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
  };
  if (fluidOn) {
    for (let i = 0; i < state.smooth; i++) { fs(RT.fDepthB, P.smooth, BG.smoothH); fs(RT.fDepthA, P.smooth, BG.smoothV); }
    fs(RT.thickB, P.blur, BG.blurH); fs(RT.thickA, P.blur, BG.blurV);
  }
  // 5. composite
  fs(ctx.getCurrentTexture(), P.comp, BG.comp);
}

let last = performance.now(), fps = 60, t0 = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  fps = fps * 0.95 + 0.05 / Math.max(dt, 1e-3);
  resize();
  if (!state.paused) emit(1 / 60);
  writeParams();
  writeCamera((now - t0) / 1000);
  const enc = device.createCommandEncoder();
  if (!state.paused && N > 0) encodeSim(enc);
  encodeRender(enc);
  device.queue.submit([enc.finish()]);
  statsEl.textContent = `GPU · ${N.toLocaleString()} particles · ${SC.substeps} substeps · ${fps.toFixed(0)} fps · ${Wpx}×${Hpx}`;
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ input
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, b: e.button }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.b === 2 || e.shiftKey) {
    const r = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]], s = cam.dist * 0.0015;
    for (let a = 0; a < 3; a++) cam.target[a] += (-r[a] * dx + up[a] * dy) * s;
  } else { cam.yaw -= dx * 0.006; cam.pitch = Math.min(1.5, Math.max(-0.05, cam.pitch + dy * 0.006)); }
});
canvas.addEventListener('pointerup', e => {
  if (drag && drag.b === 0 && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) throwAt(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.min(600, Math.max(8, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

function throwAt(cx, cy) {
  const rc = canvas.getBoundingClientRect();
  const nx = ((cx - rc.left) / rc.width) * 2 - 1, ny = 1 - ((cy - rc.top) / rc.height) * 2;
  const dE = norm([nx * tanXY[0], ny * tanXY[1], -1]);
  const d = norm([invView[0] * dE[0] + invView[4] * dE[1] + invView[8] * dE[2], invView[1] * dE[0] + invView[5] * dE[1] + invView[9] * dE[2], invView[2] * dE[0] + invView[6] * dE[1] + invView[10] * dE[2]]);
  const r = state.ballSize * SC.s;
  let t0 = 0, t1 = 1e9;
  const lo = [r, r, r], hi = [SC.W - r, SC.H - r, SC.D - r];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) { if (eye[a] < lo[a] || eye[a] > hi[a]) t0 = 1e9; continue; }
    let ta = (lo[a] - eye[a]) / d[a], tb = (hi[a] - eye[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  const p = (t0 > t1 || t0 >= 1e8) ? [SC.W / 2, SC.H - r - 0.5, SC.D / 2] : [eye[0] + d[0] * t0, eye[1] + d[1] * t0, eye[2] + d[2] * t0];
  addBall(p, d.map(v => v * 45 * SC.s), r, state.ballDensity);
  updateBallColors();
}

// ------------------------------------------------------------------ UI
const statsEl = document.getElementById('stats');
function syncUI() {
  document.querySelectorAll('[data-scene]').forEach(b => b.classList.toggle('on', b.dataset.scene === state.scene));
  document.querySelectorAll('[data-mat]').forEach(b => b.classList.toggle('on', b.dataset.mat === state.fluid));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === state.quality));
  document.getElementById('pause').textContent = state.paused ? 'Resume' : 'Pause';
}
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => loadScene(b.dataset.scene, state.keep ? state.fluid : undefined));
document.querySelectorAll('[data-mat]').forEach(b => b.onclick = () => { state.fluid = b.dataset.mat; syncUI(); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; syncUI(); });
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { state.quality = b.dataset.q; loadScene(state.scene, state.fluid); });
document.getElementById('reset').onclick = () => loadScene(state.scene, state.fluid);
document.getElementById('pause').onclick = () => { state.paused = !state.paused; syncUI(); };
document.getElementById('drop').onclick = () => {
  const r = state.ballSize * SC.s;
  addBall([SC.W * (0.3 + Math.random() * 0.4), SC.H - r - 0.5, SC.D * (0.3 + Math.random() * 0.4)], [0, -10 * SC.s, 0], r, state.ballDensity);
  updateBallColors();
};
const bindRange = (id, key, fmt = v => v) => {
  const el = document.getElementById(id), out = document.getElementById(id + 'V');
  const upd = () => { state[key] = parseFloat(el.value); if (out) out.textContent = fmt(state[key]); };
  el.oninput = upd; upd();
};
bindRange('ballSize', 'ballSize', v => v.toFixed(1));
bindRange('ballDensity', 'ballDensity', v => v.toFixed(1) + (v < 1 ? ' (floats)' : ' (sinks)'));
bindRange('smooth', 'smooth');
bindRange('slowmo', 'slowmo', v => v.toFixed(2) + '×');
document.getElementById('keepMat').onchange = e => { state.keep = e.target.checked; };
window.addEventListener('keydown', e => {
  if (e.key === ' ') { state.paused = !state.paused; syncUI(); e.preventDefault(); }
  if (e.key === 'r') loadScene(state.scene, state.fluid);
  if (e.key === 'p') { state.view = state.view === 'fluid' ? 'particles' : 'fluid'; syncUI(); }
});

resize();
loadScene('dam');
requestAnimationFrame(frame);
