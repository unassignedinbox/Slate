//==================================================================================================
//  ROADEDITOR — WEBGL2 RENDERER
//==================================================================================================
//  One opaque pass (instanced, procedural materials), a shadow map pass, a sky pass drawn from the
//  same sun the shadows come from, and the x-ray overlay for authoring. No dependencies.
//==================================================================================================

import { MATERIAL_GLSL } from './materials.js';
import { clamp } from './core.js';

const QUAD_VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SUN_UBO = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uSkyColour;
uniform vec3 uGroundColour;
uniform vec3 uEye;
uniform float uTime;
uniform float uExposure;
uniform float uFogDensity;
uniform float uShadowTexel;
uniform mat4 uLightViewProj;
`;

const SURFACE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aNrmOct;
layout(location = 2) in vec4 aColour;
layout(location = 3) in vec4 aInst0;
layout(location = 4) in vec4 aInst1;
layout(location = 5) in vec4 aInst2;
layout(location = 6) in vec4 aInst3;
uniform mat4 uViewProj;
uniform int uInstanced;
out vec3 vWorld;
out vec3 vNrm;
out vec4 vColour;
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
void main() {
  vec3 pos = aPos;
  vec3 nrm = octDecode(aNrmOct);
  if (uInstanced == 1) {
    mat4 M = mat4(aInst0, aInst1, aInst2, aInst3);
    pos = (M * vec4(aPos, 1.0)).xyz;
    nrm = normalize(mat3(M) * nrm);
  }
  vWorld = pos;
  vNrm = nrm;
  vColour = aColour;
  gl_Position = uViewProj * vec4(pos, 1.0);
}`;

const SURFACE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNrm;
in vec4 vColour;
out vec4 fragColour;
uniform sampler2D uShadow;
uniform float uShadowStrength;
${SUN_UBO}
${MATERIAL_GLSL}

float shadowLookup(vec3 world, float ndl) {
  vec4 lp = uLightViewProj * vec4(world + normalize(vNrm) * 0.28, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.001 || p.x > 0.999 || p.y < 0.001 || p.y > 0.999 || p.z > 1.0) return 1.0;
  // 4-tap rotated PCF: enough to soften the stair-stepping without a blur pass.
  float bias = max(0.0016, 0.006 * (1.0 - ndl));
  float sum = 0.0;
  vec2 texel = vec2(uShadowTexel);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1) - 0.5, float((i >> 1) & 1) - 0.5) * texel * 1.6;
    float d = texture(uShadow, p.xy + o).r;
    sum += (p.z - bias) <= d ? 1.0 : 0.0;
  }
  return sum * 0.25;
}

vec3 skyRadiance(vec3 dir) {
  float up = clamp(dir.z, -1.0, 1.0);
  float t = pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), 0.65);
  vec3 col = mix(uGroundColour, uSkyColour, t);
  float sunAmt = max(dot(normalize(dir), uSunDir), 0.0);
  col += uSunColour * pow(sunAmt, 8.0) * 0.35;
  col += uSunColour * pow(sunAmt, 900.0) * 18.0;
  return col;
}

void main() {
  vec3 n = normalize(vNrm);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uEye - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  int mat = int(vColour.a * 255.0 + 0.5);
  vec3 tint = vColour.rgb;
  MatInfo mi = matLookup(mat, vWorld, n, tint);
  // Perturb the normal with the material's bump so grazing light picks out the grain.
  vec3 T = normalize(abs(n.z) < 0.9 ? cross(vec3(0.0, 0.0, 1.0), n) : cross(vec3(1.0, 0.0, 0.0), n));
  vec3 B = cross(n, T);
  float bumpScale = mi.bump * 0.05;
  vec3 nn = normalize(n + (T + B) * bumpScale);

  float ndl = max(dot(nn, uSunDir), 0.0);
  float shadow = shadowLookup(vWorld, ndl);
  shadow = mix(1.0, shadow, uShadowStrength);
  vec3 diffuse = mi.albedo * uSunColour * ndl * shadow;
  // Ambient: a coarse hemisphere term, cheap but keeps undersides readable.
  float skyAmt = clamp(nn.z * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = mi.albedo * mix(uGroundColour, uSkyColour, skyAmt) * 0.55;
  // Specular: Blinn-Phong with a roughness-driven exponent, which is enough for wet-looking asphalt.
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(nn, H), 0.0), mix(220.0, 6.0, mi.roughness));
  vec3 specCol = mix(uSunColour, mi.albedo, mi.metallic) * spec * mix(0.5, 2.4, mi.metallic) * shadow;
  vec3 col = diffuse + ambient + specCol;

  // Distance fog tinted by the sky, so far roads read as haze rather than grey paint.
  float dist = length(uEye - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  vec3 fogCol = skyRadiance(normalize(vWorld - uEye));
  col = mix(col, fogCol, clamp(fog, 0.0, 1.0));
  col *= uExposure;
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  fragColour = vec4(col, 1.0);
}`;

const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColour;
uniform mat4 uInvViewProj;
${SUN_UBO}
void main() {
  vec3 ndc = vec3(vUv * 2.0 - 1.0, 1.0);
  vec4 far = uInvViewProj * vec4(ndc, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uEye);
  float up = clamp(dir.z, -1.0, 1.0);
  float t = pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), 0.62);
  vec3 col = mix(uGroundColour, uSkyColour, t);
  float sunAmt = max(dot(dir, uSunDir), 0.0);
  col += uSunColour * pow(sunAmt, 6.0) * 0.3;
  float disc = smoothstep(0.9993, 0.9997, sunAmt);
  col += uSunColour * disc * 24.0;
  col += uSunColour * pow(sunAmt, 900.0) * 12.0;
  float horizon = exp(-abs(up) * 9.0);
  col = mix(col, uSkyColour * 1.18 + vec3(0.02, 0.025, 0.03), horizon * 0.35);
  col *= uExposure * 1.15;
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  fragColour = vec4(col, 1.0);
}`;

const SHADOW_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 3) in vec4 aInst0;
layout(location = 4) in vec4 aInst1;
layout(location = 5) in vec4 aInst2;
layout(location = 6) in vec4 aInst3;
uniform mat4 uLightViewProj;
uniform int uInstanced;
void main() {
  vec3 pos = aPos;
  if (uInstanced == 1) {
    mat4 M = mat4(aInst0, aInst1, aInst2, aInst3);
    pos = (M * vec4(aPos, 1.0)).xyz;
  }
  gl_Position = uLightViewProj * vec4(pos, 1.0);
}`;

const SHADOW_FRAG = /* glsl */ `#version 300 es
precision highp float;
void main() {}`;

const XRAY_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aColour;
uniform mat4 uViewProj;
uniform float uPulse;
out vec4 vColour;
void main() {
  vColour = vec4(aColour.rgb * (0.75 + uPulse * 0.25), 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const XRAY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vColour;
out vec4 fragColour;
void main() {
  fragColour = vColour;
}`;

const WATER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNrm;
in vec4 vColour;
out vec4 fragColour;
${SUN_UBO}
void main() {
  vec3 n = vec3(0.0, 0.0, 1.0);
  float w = uTime * 0.35;
  n.x += sin(vWorld.x * 0.09 + w) * 0.05 + sin(vWorld.x * 0.031 - w * 0.7) * 0.03;
  n.y += cos(vWorld.y * 0.011 + w * 0.8) * 0.05;
  n = normalize(n);
  vec3 V = normalize(uEye - vWorld);
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  vec3 deep = vec3(0.035, 0.075, 0.1);
  vec3 shallow = vec3(0.07, 0.13, 0.15);
  vec3 col = mix(deep, shallow, 0.5);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 260.0);
  col += uSunColour * spec * 3.0;
  float skyAmt = 0.5;
  vec3 sky = mix(uGroundColour, uSkyColour, skyAmt);
  col = mix(col, sky, fres * 0.75);
  float dist = length(uEye - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  col = mix(col, sky, fog);
  col *= uExposure;
  col = col / (col + vec3(1.0));
  col = pow(col, vec3(1.0 / 2.2));
  fragColour = vec4(col, 1.0);
}`;

const WATER_VERT = SURFACE_VERT;

function compile(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    throw new Error(`${label} shader failed: ${log}`);
  }
  return sh;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label}.vert`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label} link failed: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function uniforms(gl, p) {
  const out = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    out[name] = gl.getUniformLocation(p, name);
  }
  return out;
}

class Batch {
  constructor(gl, arrays, name) {
    this.name = name;
    this.count = arrays.index.length;
    this.index32 = arrays.index32;
    this.vertexCount = arrays.vertexCount;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arrays.position, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nbo);
    gl.bufferData(gl.ARRAY_BUFFER, arrays.normalPacked, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.BYTE, true, 4, 0);
    this.cbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cbo);
    gl.bufferData(gl.ARRAY_BUFFER, arrays.color, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arrays.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }
  dispose(gl) {
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.nbo);
    gl.deleteBuffer(this.cbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

class InstancedBatch {
  constructor(gl, geometry, placements) {
    this.count = geometry.index.length;
    this.index32 = geometry.index32;
    this.instances = placements.length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.position, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nrm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.normalPacked, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.BYTE, true, 4, 0);
    const col = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, col);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.color, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    const m = new Float32Array(placements.length * 16);
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const s = p.scale ?? 1;
      const c = Math.cos(p.rot || 0);
      const sn = Math.sin(p.rot || 0);
      m[i * 16 + 0] = c * s;
      m[i * 16 + 1] = sn * s;
      m[i * 16 + 4] = -sn * s;
      m[i * 16 + 5] = c * s;
      m[i * 16 + 10] = s;
      m[i * 16 + 12] = p.x;
      m[i * 16 + 13] = p.y;
      m[i * 16 + 14] = p.z;
      m[i * 16 + 15] = 1;
    }
    this.mbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mbo);
    gl.bufferData(gl.ARRAY_BUFFER, m, gl.STATIC_DRAW);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(3 + i);
      gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(3 + i, 1);
    }
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index, gl.STATIC_DRAW);
    this.ibo = ibo;
    gl.bindVertexArray(null);
    this.buffers = [pos, nrm, col, this.mbo, ibo];
  }
  dispose(gl) {
    for (const b of this.buffers) gl.deleteBuffer(b);
    gl.deleteVertexArray(this.vao);
  }
}

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.extCull = gl.getExtension('EXT_color_buffer_float');
    this.shadowSize = opts.shadowSize ?? 2048;
    this.stats = { drawCalls: 0, tris: 0, batches: 0 };
    this.initPrograms();
    this.initShadow();
    this.emptyVao = gl.createVertexArray();
    this.batches = [];
    this.instancedBatches = [];
  }

  initPrograms() {
    const gl = this.gl;
    this.surfaceProgram = program(gl, SURFACE_VERT, SURFACE_FRAG, 'surface');
    this.surfaceUniforms = uniforms(gl, this.surfaceProgram);
    this.skyProgram = program(gl, QUAD_VERT, SKY_FRAG, 'sky');
    this.skyUniforms = uniforms(gl, this.skyProgram);
    this.shadowProgram = program(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow');
    this.shadowUniforms = uniforms(gl, this.shadowProgram);
    this.xrayProgram = program(gl, XRAY_VERT, XRAY_FRAG, 'xray');
    this.xrayUniforms = uniforms(gl, this.xrayProgram);
    this.waterProgram = program(gl, WATER_VERT, WATER_FRAG, 'water');
    this.waterUniforms = uniforms(gl, this.waterProgram);
  }

  initShadow() {
    const gl = this.gl;
    this.shadowFbo = gl.createFramebuffer();
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('shadow framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  setModel(model) {
    const gl = this.gl;
    this.disposeModel();
    this.model = model;
    this.batches = [
      ['surfaces', new Batch(gl, model.surfaces, 'surfaces')],
      ['markings', new Batch(gl, model.markings, 'markings')],
      ['structures', new Batch(gl, model.structures, 'structures')],
      ['rail', new Batch(gl, model.rail, 'rail')],
      ['subway', new Batch(gl, model.subway, 'subway')],
    ].filter(([, b]) => b.count > 0);
    this.xray = model.xray.index.length ? new Batch(gl, model.xray, 'xray') : null;
    this.water = model.water.index.length ? new Batch(gl, model.water, 'water') : null;
    this.instancedBatches = [];
    const groups = new Map();
    for (const inst of model.instances) {
      if (!groups.has(inst.kind)) groups.set(inst.kind, []);
      groups.get(inst.kind).push(inst);
    }
    for (const [kind, list] of groups) {
      if (kind.startsWith('_')) continue;
      const geo = model.propGeometry ? model.propGeometry(kind) : null;
      if (!geo || !geo.index.length) continue;
      this.instancedBatches.push(new InstancedBatch(gl, geo, list));
    }
  }

  disposeModel() {
    const gl = this.gl;
    for (const [, b] of this.batches || []) b.dispose(gl);
    for (const b of this.instancedBatches || []) b.dispose(gl);
    if (this.xray) this.xray.dispose(gl);
    if (this.water) this.water.dispose(gl);
    if (this.overlay) this.overlay.dispose(gl);
    this.overlay = null;
    this.batches = [];
    this.instancedBatches = [];
    this.xray = null;
    this.water = null;
  }

  /** Selection highlight: a small mesh rebuilt whenever the selection changes. */
  setOverlay(arrays) {
    const gl = this.gl;
    if (this.overlay) {
      this.overlay.dispose(gl);
      this.overlay = null;
    }
    if (arrays && arrays.index.length) this.overlay = new Batch(gl, arrays, 'overlay');
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h };
  }

  render(view) {
    const gl = this.gl;
    const { w, h } = this.resize();
    this.stats.drawCalls = 0;
    this.stats.tris = 0;
    this.stats.batches = 0;

    // Shadow pass: fit an ortho box around the viewer so shadows stay sharp where it matters.
    const lightDir = view.sunDir;
    const focus = {
      x: view.eye.x + view.forward.x * 90,
      y: view.eye.y + view.forward.y * 90,
      z: view.eye.z + view.forward.z * 90,
    };
    const radius = view.shadowRadius ?? 340;
    const lightPos = { x: focus.x + lightDir.x * radius * 2.2, y: focus.y + lightDir.y * radius * 2.2, z: focus.z + lightDir.z * radius * 2.2 };
    const lightView = lookAt(lightPos, focus, { x: 0, y: 0, z: 1 });
    const lightProj = ortho(-radius, radius, -radius, radius, 0.5, radius * 5);
    const lightVP = mul4(lightProj, lightView);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(this.shadowUniforms.uLightViewProj, false, lightVP);
    gl.uniform1i(this.shadowUniforms.uInstanced, 0);
    gl.disable(gl.CULL_FACE);
    for (const [, b] of this.batches) {
      if (b.name === 'markings') continue;
      gl.bindVertexArray(b.vao);
      gl.drawElements(gl.TRIANGLES, b.count, b.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
    gl.uniform1i(this.shadowUniforms.uInstanced, 1);
    for (const b of this.instancedBatches) {
      gl.bindVertexArray(b.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, b.count, b.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0, b.instances);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Main pass
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.05, 0.06, 0.08, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    const viewProj = mul4(view.projection, view.view);
    const invViewProj = invert4(viewProj);

    const shared = (u) => {
      gl.uniform3fv(u.uSunDir, [lightDir.x, lightDir.y, lightDir.z]);
      gl.uniform3fv(u.uSunColour, view.sunColour);
      gl.uniform3fv(u.uSkyColour, view.skyColour);
      gl.uniform3fv(u.uGroundColour, view.groundColour);
      gl.uniform3fv(u.uEye, [view.eye.x, view.eye.y, view.eye.z]);
      gl.uniform1f(u.uTime, view.time);
      gl.uniform1f(u.uExposure, view.exposure);
      gl.uniform1f(u.uFogDensity, view.fogDensity);
      gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
      gl.uniformMatrix4fv(u.uLightViewProj, false, lightVP);
      gl.uniform1f(u.uShadowTexel, 1 / this.shadowSize);
    };

    // Sky
    gl.useProgram(this.skyProgram);
    gl.depthMask(false);
    gl.uniformMatrix4fv(this.skyUniforms.uInvViewProj, false, invViewProj);
    shared(this.skyUniforms);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // Opaque
    gl.useProgram(this.surfaceProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(this.surfaceUniforms.uShadow, 0);
    gl.uniform1f(this.surfaceUniforms.uShadowStrength, view.shadows === false ? 0 : 1);
    shared(this.surfaceUniforms);
    gl.uniform1i(this.surfaceUniforms.uInstanced, 0);
    for (const [, b] of this.batches) {
      gl.bindVertexArray(b.vao);
      gl.drawElements(gl.TRIANGLES, b.count, b.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      this.stats.drawCalls++;
      this.stats.tris += b.count / 3;
    }
    gl.uniform1i(this.surfaceUniforms.uInstanced, 1);
    for (const b of this.instancedBatches) {
      gl.bindVertexArray(b.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, b.count, b.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0, b.instances);
      this.stats.drawCalls++;
      this.stats.tris += (b.count / 3) * b.instances;
    }
    gl.uniform1i(this.surfaceUniforms.uInstanced, 0);

    // Water
    if (this.water && view.water !== false) {
      gl.useProgram(this.waterProgram);
      shared(this.waterUniforms);
      gl.uniform1i(this.waterUniforms.uInstanced, 0);
      gl.bindVertexArray(this.water.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.drawElements(gl.TRIANGLES, this.water.count, this.water.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
      this.stats.drawCalls++;
      this.stats.tris += this.water.count / 3;
    }

    // X-ray overlay
    if (this.xray && view.xray) {
      gl.useProgram(this.xrayProgram);
      gl.uniformMatrix4fv(this.xrayUniforms.uViewProj, false, viewProj);
      gl.uniform1f(this.xrayUniforms.uPulse, view.pulse ?? 0.5);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.xray.vao);
      gl.drawElements(gl.TRIANGLES, this.xray.count, this.xray.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      this.stats.drawCalls++;
    }
    // Selection highlight, drawn last so it is never hidden by the geometry it marks.
    if (this.overlay) {
      gl.useProgram(this.xrayProgram);
      gl.uniformMatrix4fv(this.xrayUniforms.uViewProj, false, viewProj);
      gl.uniform1f(this.xrayUniforms.uPulse, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.overlay.vao);
      gl.drawElements(gl.TRIANGLES, this.overlay.count, this.overlay.index32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      this.stats.drawCalls++;
    }
    gl.bindVertexArray(null);
    return this.stats;
  }
}

//--------------------------------------------------------------------------------------------------
//  Small matrix helpers (column-major, same layout WebGL expects)
//--------------------------------------------------------------------------------------------------
export function lookAt(eye, target, up) {
  let z = normalize(sub(eye, target));
  if (length(z) < 1e-6) z = { x: 0, y: 1, z: 0 };
  let x = normalize(cross(up, z));
  if (length(x) < 1e-6) x = { x: 1, y: 0, z: 0 };
  const y = cross(z, x);
  return new Float32Array([
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

export function mul4(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function invert4(m) {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-12) return new Float32Array(16);
  det = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a) => Math.hypot(a.x, a.y, a.z);
function normalize(a) {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
