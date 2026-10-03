import * as S from './shaders.js';

// ------------------------------------------------------------------ materials (render side)
const LOOKS = {
  water:     { base: [0.55, 0.75, 0.85], absorb: [0.26, 0.075, 0.045], opacity: 0.0, rough: 0.05, f0: 0.02,  refract: 0.06, sss: 0.0,  foam: 1.0, noise: 0.0 },
  milk:      { base: [0.93, 0.91, 0.86], absorb: [0.04, 0.05, 0.08],   opacity: 1.6, rough: 0.28, f0: 0.03,  refract: 0.01, sss: 0.7,  foam: 0.0, noise: 0.0 },
  chocolate: { base: [0.15, 0.065, 0.028], absorb: [0.5, 0.8, 1.0],    opacity: 3.0, rough: 0.16, f0: 0.045, refract: 0.0,  sss: 0.15, foam: 0.0, noise: 0.0 },
  honey:     { base: [0.85, 0.45, 0.06], absorb: [0.06, 0.25, 0.85],   opacity: 0.05, rough: 0.05, f0: 0.045, refract: 0.09, sss: 0.45, foam: 0.0, noise: 0.0 },
  mud:       { base: [0.27, 0.19, 0.12], absorb: [0.6, 0.8, 1.0],      opacity: 4.0, rough: 0.6,  f0: 0.025, refract: 0.0,  sss: 0.05, foam: 0.0, noise: 0.35 },
};
const SCENE_DEFAULT_MAT = { dam: 'water', splash: 'milk', ocean: 'water', pour: 'chocolate' };

// ------------------------------------------------------------------ GL setup
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) fail('WebGL2 is not supported by this browser.');
if (!gl.getExtension('EXT_color_buffer_float')) fail('EXT_color_buffer_float is required (float render targets).');
function fail(msg) { document.getElementById('err').textContent = msg; throw new Error(msg); }

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
    fail('Shader compile error: ' + log);
  }
  return sh;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail('Program link error: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

const progs = {
  sky: program(S.FULLSCREEN_VS, S.SKY_FS),
  mesh: program(S.MESH_VS, S.MESH_FS),
  depth: program(S.PARTICLE_VS, S.DEPTH_FS),
  thick: program(S.PARTICLE_VS, S.THICK_FS),
  debug: program(S.PARTICLE_VS, S.DEBUG_FS),
  bilateral: program(S.FULLSCREEN_VS, S.BILATERAL_FS),
  blur: program(S.FULLSCREEN_VS, S.BLUR_FS),
  composite: program(S.FULLSCREEN_VS, S.COMPOSITE_FS),
};

// ------------------------------------------------------------------ render targets
function tex(w, h, ifmt, fmt, type, filter = gl.NEAREST) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function fbo(colors, depth) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  colors.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) fail('Framebuffer incomplete: 0x' + st.toString(16));
  return f;
}
function rb(w, h) {
  const r = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, r);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  return r;
}

let RT = null, W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (w === W && h === H && RT) return;
  W = w; H = h; canvas.width = w; canvas.height = h;
  if (RT) {
    for (const t of RT.textures) gl.deleteTexture(t);
    for (const f of RT.fbos) gl.deleteFramebuffer(f);
    for (const r of RT.rbs) gl.deleteRenderbuffer(r);
  }
  const sceneCol = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  const sceneDepth = tex(w, h, gl.R32F, gl.RED, gl.FLOAT);
  const fDepthA = tex(w, h, gl.R32F, gl.RED, gl.FLOAT);
  const fDepthB = tex(w, h, gl.R32F, gl.RED, gl.FLOAT);
  const thickA = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  const thickB = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  const rbScene = rb(w, h), rbFluid = rb(w, h);
  RT = {
    sceneCol, sceneDepth, fDepthA, fDepthB, thickA, thickB,
    sceneF: fbo([sceneCol, sceneDepth], rbScene),
    depthF: fbo([fDepthA], rbFluid),
    depthBF: fbo([fDepthB]),
    depthAF: fbo([fDepthA]),
    thickF: fbo([thickA]),
    thickBF: fbo([thickB]),
    textures: [sceneCol, sceneDepth, fDepthA, fDepthB, thickA, thickB],
    rbs: [rbScene, rbFluid],
  };
  RT.fbos = [RT.sceneF, RT.depthF, RT.depthBF, RT.depthAF, RT.thickF, RT.thickBF];
}

// ------------------------------------------------------------------ geometry
function meshVAO(pos, nrm, idx, mode = gl.TRIANGLES) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b0 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b0); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, mode, bufs: [b0, b1, ib] };
}
function sphereMesh(seg = 40, ring = 24) {
  const p = [], n = [], idx = [];
  for (let r = 0; r <= ring; r++) {
    const th = r / ring * Math.PI;
    for (let s = 0; s <= seg; s++) {
      const ph = s / seg * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      p.push(x, y, z); n.push(x, y, z);
    }
  }
  for (let r = 0; r < ring; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return meshVAO(p, n, idx);
}
function boxMesh() {
  const p = [], n = [], idx = [];
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const f of faces) {
    const u = f[1] !== 0 ? [1, 0, 0] : [0, 1, 0];
    const vv = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    const b = p.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      p.push(f[0] + u[0] * a + vv[0] * c, f[1] + u[1] * a + vv[1] * c, f[2] + u[2] * a + vv[2] * c);
      n.push(...f);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return meshVAO(p, n, idx);
}
const sphere = sphereMesh(), box = boxMesh();
const floorMesh = meshVAO([-200, 0, -200, 200, 0, -200, 200, 0, 200, -200, 0, 200], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 2, 1, 0, 3, 2]);
let rampMesh = null, tankLines = null;
const emptyVAO = gl.createVertexArray();

// particle buffers
const pVAO = gl.createVertexArray();
const posBuf = gl.createBuffer(), densBuf = gl.createBuffer();
gl.bindVertexArray(pVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, 4 * 3 * 30000, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, densBuf); gl.bufferData(gl.ARRAY_BUFFER, 4 * 30000, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// ------------------------------------------------------------------ math
const M = {
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  lookAt(e, c, up) {
    let z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  },
  invRigid(m) { // inverse of rotation+translation
    const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
    const t = [m[12], m[13], m[14]];
    r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
    r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
    r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
    return r;
  },
  model(t, s) { return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1]; },
};
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// ------------------------------------------------------------------ app state
const state = {
  scene: 'dam', material: 'water', paused: false, view: 'fluid',
  substeps: 1, smoothIters: 3, ballSize: 2.2, ballDensity: 2.0,
};
let sceneInfo = null, frame = null, waiting = false, N = 0, radius = 0.3;
const cam = { yaw: -0.55, pitch: 0.42, dist: 60, target: [20, 6, 7], fov: 45 * Math.PI / 180 };

const worker = new Worker('./src/sim-worker.js');
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'scene') {
    sceneInfo = m; radius = m.radius;
    cam.target = [m.W / 2, m.H * 0.22, m.D / 2];
    cam.dist = Math.max(m.W, m.H) * 1.35;
    buildSceneGeometry(m);
  } else if (m.type === 'frame') {
    frame = m; waiting = false; N = m.N;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, densBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.dens);
    simMsAvg = simMsAvg * 0.9 + m.simMs * 0.1;
  }
};
let simMsAvg = 0;

function buildSceneGeometry(m) {
  if (rampMesh) { gl.deleteVertexArray(rampMesh.vao); rampMesh = null; }
  const ramp = m.obstacles.find(o => o.type === 'ramp');
  if (ramp) {
    const { x0, x1, height } = ramp, D = m.D, n = ramp.n;
    rampMesh = meshVAO(
      [x0, 0.01, 0, x1, height, 0, x1, height, D, x0, 0.01, D,  x1, height, 0, x1, 0, 0, x1, 0, D, x1, height, D],
      [n[0], n[1], 0, n[0], n[1], 0, n[0], n[1], 0, n[0], n[1], 0,  1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
      [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
  }
  if (tankLines) gl.deleteVertexArray(tankLines.vao);
  const [a, b, c] = [m.W, m.H, m.D];
  const v = [[0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0], [0, 0, c], [a, 0, c], [a, b, c], [0, b, c]];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  tankLines = meshVAO(v.flat(), v.flat().map(() => 0), e, gl.LINES);
}

function loadScene(name, material) {
  state.scene = name;
  state.material = material || SCENE_DEFAULT_MAT[name];
  worker.postMessage({ type: 'scene', name, material: state.material });
  syncUI();
}
function setMaterial(name) { state.material = name; worker.postMessage({ type: 'material', name }); syncUI(); }

// ------------------------------------------------------------------ camera matrices
let view, proj, invView, eye, tanXY, projScale;
function updateCamera() {
  const cp = Math.cos(cam.pitch);
  eye = [cam.target[0] + cam.dist * cp * Math.sin(cam.yaw), cam.target[1] + cam.dist * Math.sin(cam.pitch), cam.target[2] + cam.dist * cp * Math.cos(cam.yaw)];
  view = M.lookAt(eye, cam.target, [0, 1, 0]);
  invView = M.invRigid(view);
  const asp = W / H;
  proj = M.persp(cam.fov, asp, 0.5, 2000);
  const ty = Math.tan(cam.fov / 2);
  tanXY = [ty * asp, ty];
  projScale = H * proj[5]; // pixels per (world unit / eye depth) * 2
}

// ------------------------------------------------------------------ passes
function drawMesh(m, model, color, mode = 0, rough = 0.5) {
  const u = progs.mesh.u;
  gl.uniformMatrix4fv(u.uModel, false, model);
  gl.uniform3fv(u.uColor, color);
  gl.uniform1i(u.uMode, mode);
  gl.uniform1f(u.uRough, rough);
  gl.bindVertexArray(m.vao);
  gl.drawElements(m.mode, m.count, gl.UNSIGNED_SHORT, 0);
}
function ballColor(d) { return d < 1 ? [0.85, 0.75, 0.2] : d < 2.5 ? [0.75, 0.12, 0.1] : [0.35, 0.37, 0.42]; }

function renderScene() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.sceneF);
  gl.viewport(0, 0, W, H);
  gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
  gl.clearBufferfv(gl.COLOR, 1, [1e6, 0, 0, 0]);
  gl.clearBufferfv(gl.DEPTH, 0, [1]);
  // sky
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(progs.sky.p);
  gl.uniformMatrix4fv(progs.sky.u.uInvView, false, invView);
  gl.uniform2fv(progs.sky.u.uTan, tanXY);
  gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  // meshes
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
  
  const u = progs.mesh.u;
  gl.useProgram(progs.mesh.p);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniform3fv(u.uCamPos, eye);
  const balls = frame ? frame.balls : [];
  const bdata = new Float32Array(24);
  balls.forEach((b, i) => bdata.set([b.p[0], b.p[1], b.p[2], b.r], i * 4));
  gl.uniform4fv(u.uBalls, bdata);
  gl.uniform1i(u.uBallCount, balls.length);

  drawMesh(floorMesh, M.model([0, 0, 0], [1, 1, 1]), [1, 1, 1], 1, 0.7);
  if (!sceneInfo) return;
  for (const o of sceneInfo.obstacles) {
    if (o.type === 'sphere') drawMesh(sphere, M.model(o.c, [o.r, o.r, o.r]), [0.75, 0.75, 0.78], 0, 0.25);
    else if (o.type === 'box') drawMesh(box, M.model(o.c, o.h), [0.62, 0.55, 0.48], 0, 0.6);
  }
  
  if (rampMesh) drawMesh(rampMesh, M.model([0, 0, 0], [1, 1, 1]), [0.76, 0.68, 0.52], 0, 0.9);
  
  for (const b of balls) drawMesh(sphere, M.model(b.p, [b.r, b.r, b.r]), ballColor(b.density), 0, 0.3);
  if (frame && frame.paddleX != null) {
    const D = sceneInfo.D, h = sceneInfo.H * 0.55;
    drawMesh(box, M.model([frame.paddleX - 0.5, h / 2, D / 2], [0.5, h / 2, D / 2]), [0.3, 0.33, 0.38], 0, 0.4);
  }
  
  if (tankLines) drawMesh(tankLines, M.model([0, 0, 0], [1, 1, 1]), [0.9, 0.95, 1.0], 3);
}

function setParticleUniforms(pg) {
  gl.useProgram(pg.p);
  gl.uniformMatrix4fv(pg.u.uView, false, view);
  gl.uniformMatrix4fv(pg.u.uProj, false, proj);
  gl.uniform1f(pg.u.uRadius, radius * RENDER_RADIUS);
  gl.uniform1f(pg.u.uScale, projScale);
  if (pg.u.uSceneDepth) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, RT.sceneDepth); gl.uniform1i(pg.u.uSceneDepth, 0); }
}
const RENDER_RADIUS = 1.45; // impostor radius relative to half-spacing (overlap -> continuous surface)

function renderFluid() {
  // depth
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.depthF);
  gl.viewport(0, 0, W, H);
  gl.clearBufferfv(gl.COLOR, 0, [1e6, 0, 0, 0]);
  gl.clearBufferfv(gl.DEPTH, 0, [1]);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
  setParticleUniforms(progs.depth);
  gl.bindVertexArray(pVAO); gl.drawArrays(gl.POINTS, 0, N);
  gl.disable(gl.DEPTH_TEST);

  // thickness (additive)
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.thickF);
  gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  setParticleUniforms(progs.thick);
  gl.drawArrays(gl.POINTS, 0, N);
  gl.disable(gl.BLEND);

  // bilateral smoothing of depth (A -> B -> A)
  const bp = progs.bilateral; gl.useProgram(bp.p);
  gl.uniform1f(bp.u.uWorldRadius, radius * 3.2);
  gl.uniform1f(bp.u.uScale, projScale * 0.5);
  gl.uniform1f(bp.u.uFalloff, radius * 2.2);
  gl.uniform1i(bp.u.uTex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(emptyVAO);
  for (let i = 0; i < state.smoothIters; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.depthBF); gl.bindTexture(gl.TEXTURE_2D, RT.fDepthA);
    gl.uniform2f(bp.u.uDir, 1, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, RT.depthAF); gl.bindTexture(gl.TEXTURE_2D, RT.fDepthB);
    gl.uniform2f(bp.u.uDir, 0, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // thickness blur (A -> B -> A)
  const tp = progs.blur; gl.useProgram(tp.p); gl.uniform1i(tp.u.uTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.thickBF); gl.bindTexture(gl.TEXTURE_2D, RT.thickA);
  gl.uniform2f(tp.u.uDir, 1, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.thickF); gl.bindTexture(gl.TEXTURE_2D, RT.thickB);
  gl.uniform2f(tp.u.uDir, 0, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function composite(t) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  const c = progs.composite, u = c.u, L = LOOKS[state.material];
  gl.useProgram(c.p);
  const bind = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name], unit); };
  bind(0, RT.sceneCol, 'uScene'); bind(1, RT.fDepthA, 'uDepth'); bind(2, RT.thickA, 'uThick'); bind(3, RT.sceneDepth, 'uSceneDepth');
  gl.uniformMatrix4fv(u.uInvView, false, invView);
  gl.uniform2fv(u.uTan, tanXY); gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uTime, t);
  gl.uniform3fv(u.uBase, L.base); gl.uniform3fv(u.uAbsorb, L.absorb);
  gl.uniform1f(u.uOpacity, L.opacity); gl.uniform1f(u.uRough, L.rough); gl.uniform1f(u.uF0, L.f0);
  gl.uniform1f(u.uRefract, L.refract); gl.uniform1f(u.uSSS, L.sss); gl.uniform1f(u.uFoam, L.foam);
  gl.uniform1f(u.uNoise, L.noise);
  gl.uniform1i(u.uShowFluid, state.view === 'fluid' ? 1 : 0);
  gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
}

function renderDebugParticles() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // draw particles on top of the composited scene using the default depth buffer
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  const pg = progs.debug; gl.useProgram(pg.p);
  gl.uniformMatrix4fv(pg.u.uView, false, view);
  gl.uniformMatrix4fv(pg.u.uProj, false, proj);
  gl.uniform1f(pg.u.uRadius, radius);
  gl.uniform1f(pg.u.uScale, projScale);
  gl.bindVertexArray(pVAO); gl.drawArrays(gl.POINTS, 0, N);
  gl.disable(gl.DEPTH_TEST);
}

// ------------------------------------------------------------------ loop
let last = performance.now(), fps = 60;
function loop(now) {
  const dtf = Math.min((now - last) / 1000, 0.1); last = now;
  fps = fps * 0.95 + (1 / Math.max(dtf, 1e-3)) * 0.05;
  resize(); updateCamera();
  if (!waiting && sceneInfo) {
    waiting = true;
    worker.postMessage({ type: 'tick', dt: (1 / 60) / state.substeps, substeps: state.substeps, paused: state.paused });
  }
  renderScene();
  if (N > 0 && state.view === 'fluid') renderFluid();
  else { gl.bindFramebuffer(gl.FRAMEBUFFER, RT.depthAF); gl.clearBufferfv(gl.COLOR, 0, [1e6, 0, 0, 0]); }
  composite(now / 1000);
  if (state.view === 'particles' && N > 0) renderDebugParticles();
  statsEl.textContent = `${N.toLocaleString()} particles · ${fps.toFixed(0)} fps · sim ${simMsAvg.toFixed(1)} ms/frame · ${W}×${H}`;
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ input
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, b: e.button }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.b === 2 || e.shiftKey) { // pan
    const r = [view[0], view[4], view[8]], up = [view[1], view[5], view[9]], s = cam.dist * 0.0015;
    for (let a = 0; a < 3; a++) cam.target[a] += (-r[a] * dx + up[a] * dy) * s;
  } else {
    cam.yaw -= dx * 0.006; cam.pitch = Math.min(1.5, Math.max(-0.05, cam.pitch + dy * 0.006));
  }
});
canvas.addEventListener('pointerup', e => {
  if (drag && drag.b === 0 && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) throwAt(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.min(300, Math.max(8, cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

function throwAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const nx = ((cx - r.left) / r.width) * 2 - 1, ny = 1 - ((cy - r.top) / r.height) * 2;
  const dE = norm([nx * tanXY[0], ny * tanXY[1], -1]);
  const d = norm([invView[0] * dE[0] + invView[4] * dE[1] + invView[8] * dE[2], invView[1] * dE[0] + invView[5] * dE[1] + invView[9] * dE[2], invView[2] * dE[0] + invView[6] * dE[1] + invView[10] * dE[2]]);
  worker.postMessage({ type: 'throw', o: eye, d, r: state.ballSize, density: state.ballDensity });
}

// ------------------------------------------------------------------ UI
const statsEl = document.getElementById('stats');
function syncUI() {
  document.querySelectorAll('[data-scene]').forEach(b => b.classList.toggle('on', b.dataset.scene === state.scene));
  document.querySelectorAll('[data-mat]').forEach(b => b.classList.toggle('on', b.dataset.mat === state.material));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  document.getElementById('pause').textContent = state.paused ? 'Resume' : 'Pause';
}
document.querySelectorAll('[data-scene]').forEach(b => b.onclick = () => loadScene(b.dataset.scene, state.keepMat ? state.material : undefined));
document.querySelectorAll('[data-mat]').forEach(b => b.onclick = () => setMaterial(b.dataset.mat));
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; syncUI(); });
document.getElementById('reset').onclick = () => loadScene(state.scene, state.material);
document.getElementById('pause').onclick = () => { state.paused = !state.paused; syncUI(); };
document.getElementById('drop').onclick = () => {
  if (!sceneInfo) return;
  const o = [sceneInfo.W * (0.3 + Math.random() * 0.4), sceneInfo.H - 1, sceneInfo.D / 2];
  worker.postMessage({ type: 'throw', o, d: [0, -1, 0], r: state.ballSize, density: state.ballDensity });
};
const bind = (id, key, fmt = v => v) => {
  const el = document.getElementById(id), out = document.getElementById(id + 'V');
  const upd = () => { state[key] = parseFloat(el.value); if (out) out.textContent = fmt(state[key]); };
  el.oninput = upd; upd();
};
bind('ballSize', 'ballSize', v => v.toFixed(1));
bind('ballDensity', 'ballDensity', v => v < 1 ? v.toFixed(1) + ' (floats)' : v.toFixed(1) + ' (sinks)');
bind('substeps', 'substeps', v => v + '×');
bind('smooth', 'smoothIters');
document.getElementById('keepMat').onchange = e => { state.keepMat = e.target.checked; };
window.addEventListener('keydown', e => {
  if (e.key === ' ') { state.paused = !state.paused; syncUI(); e.preventDefault(); }
  if (e.key === 'r') loadScene(state.scene, state.material);
  if (e.key === 'p') { state.view = state.view === 'fluid' ? 'particles' : 'fluid'; syncUI(); }
});

loadScene('dam');
requestAnimationFrame(loop);
