// WebGL2 terrain viewport — heightfield mesh, satmap shading, water, sky.
/* eslint-disable */

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.9999,1.0); }`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
out vec4 frag;
void main(){
  float t = clamp(vUv.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.7));
  vec3 dir = normalize(vec3((vUv.x-0.5)*2.2, (vUv.y-0.25)*1.6, -1.0));
  float sunAmt = pow(max(dot(dir, normalize(uSunDir)), 0.0), 9.0);
  float glow = pow(max(dot(dir, normalize(uSunDir)), 0.0), 2.0);
  sky += uSunColor * sunAmt * 0.9 + uSunColor * glow * 0.12;
  frag = vec4(sky, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
out vec2 vUv;
void main(){
  vUv = aPos.xz * 0.5 + 0.5;
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec2 vUv;
uniform sampler2D uSat;
uniform sampler2D uSigA; // R height, G slope, B flow, A sediment
uniform sampler2D uSigB; // R protrusion, G wetness, B aspect, A ao
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyCol;
uniform vec3 uGroundCol;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform int uViewMode;
uniform float uFogDensity;
out vec4 frag;

vec3 hyps(float h){
  vec3 c0 = vec3(0.16,0.22,0.19);
  vec3 c1 = vec3(0.32,0.38,0.28);
  vec3 c2 = vec3(0.55,0.50,0.38);
  vec3 c3 = vec3(0.62,0.58,0.52);
  vec3 c4 = vec3(0.92,0.94,0.97);
  vec3 c = mix(c0,c1,smoothstep(0.0,0.28,h));
  c = mix(c,c2,smoothstep(0.28,0.55,h));
  c = mix(c,c3,smoothstep(0.55,0.78,h));
  c = mix(c,c4,smoothstep(0.78,1.0,h));
  return c;
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  vec4 sigA = texture(uSigA, vUv);
  vec4 sigB = texture(uSigB, vUv);
  vec4 sat = texture(uSat, vUv);

  float ndl = max(dot(N, L), 0.0);
  float back = max(dot(N, -L), 0.0) * 0.12;
  vec3 hemi = mix(uGroundCol, uSkyCol, N.y * 0.5 + 0.5);

  vec3 albedo;
  if (uViewMode == 1) {
    albedo = hyps(sigA.r);
  } else if (uViewMode == 2) {
    float s = sigA.g;
    albedo = mix(vec3(0.12,0.14,0.12), vec3(0.92,0.86,0.78), pow(s, 1.25));
  } else if (uViewMode == 3) {
    float f = sigA.b;
    albedo = mix(vec3(0.10,0.11,0.13), vec3(0.35,0.62,0.95), pow(f, 1.6));
    albedo += vec3(0.25,0.45,0.85) * pow(f, 4.0);
  } else if (uViewMode == 4) {
    float d = sigA.a;
    albedo = mix(vec3(0.13,0.12,0.11), vec3(0.85,0.72,0.5), pow(d, 1.2));
  } else if (uViewMode == 5) {
    float shade = ndl * 0.9 + 0.08;
    albedo = vec3(shade);
  } else if (uViewMode == 6) {
    albedo = N * 0.5 + 0.5;
  } else {
    albedo = sat.rgb;
  }

  float ao = mix(0.55, 1.0, sigB.a);
  vec3 diffuse = albedo * (uSunColor * (ndl + back) * 1.15 + hemi * 0.55) * ao;

  // wet surfaces glint near water
  float wet = sigB.g;
  vec3 V = normalize(uCamPos - vWorld);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0) * (0.08 + wet * 0.22);
  diffuse += uSunColor * spec;

  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  vec3 col = mix(diffuse, uFogColor, clamp(fog, 0.0, 1.0));

  frag = vec4(col, 1.0);
}`;

const WATER_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uMVP;
uniform float uLevel;
out vec2 vUv;
out vec3 vWorld;
void main(){
  vUv = aPos * 0.5 + 0.5;
  vec3 p = vec3(aPos.x, uLevel, aPos.y);
  vWorld = p;
  gl_Position = uMVP * vec4(p, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform vec3 uTint;
uniform float uTime;
uniform float uFogDensity;
out vec4 frag;

void main(){
  float w1 = sin(vWorld.x * 22.0 + uTime * 1.4) * 0.5 + 0.5;
  float w2 = sin(vWorld.z * 17.0 - uTime * 1.1 + vWorld.x * 3.0) * 0.5 + 0.5;
  vec3 N = normalize(vec3((w1-0.5)*0.22, 1.0, (w2-0.5)*0.22));
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * 1.6;
  vec3 col = mix(uTint, uFogColor * 1.1, fres * 0.65) + uSunColor * spec;
  float dist = length(uCamPos - vWorld);
  float fog = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  frag = vec4(col, 0.82 - fres * 0.12);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function mat4Identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }

function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye, center, up) {
  const zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1], xy = up[2] * z[0] - up[0] * z[2], xz = up[0] * z[1] - up[1] * z[0];
  let xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function hex3(hex) {
  const h = (hex || '#000').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is required');
    this.gl = gl;

    this.progSky = program(gl, SKY_VS, SKY_FS);
    this.progTerrain = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.progWater = program(gl, WATER_VS, WATER_FS);

    this.vaoSky = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSky);
    const skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.vaoWater = gl.createVertexArray();
    gl.bindVertexArray(this.vaoWater);
    const waterBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, waterBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.vaoTerrain = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTerrain);
    this.posBuf = gl.createBuffer();
    this.nrmBuf = gl.createBuffer();
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bindVertexArray(null);

    this.texSat = this.makeTexture();
    this.texSigA = this.makeTexture();
    this.texSigB = this.makeTexture();

    this.grid = 0;
    this.indexCount = 0;
    this.scaleY = 0.78; // world height per unit heightfield value
    this.cam = { yaw: 0.62, pitch: 0.42, dist: 2.55, target: [0, 0.12, 0] };
    this.sun = { azimuth: 135, elevation: 38 };
    this.viewMode = 0;
    this.water = { level: 0.16, tint: '#39627c', enabled: true };
    this.time = 0;
    this._last = performance.now();

    this.bindInput();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - this._last) / 1000);
      this._last = t;
      this.time += dt;
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.resize();
  }

  makeTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  uploadImage(tex, size, rgba) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /** Rebuild the terrain mesh from a heightfield (values roughly 0..1). */
  setField(field, sigA, sigB, satImg) {
    const gl = this.gl;
    const s = field.size;
    const grid = Math.min(220, s); // display mesh resolution
    if (grid !== this.grid) {
      this.grid = grid;
      const verts = grid * grid;
      this.positions = new Float32Array(verts * 3);
      this.normals = new Float32Array(verts * 3);
      const indices = new Uint32Array((grid - 1) * (grid - 1) * 6);
      let k = 0;
      for (let y = 0; y < grid - 1; y++) {
        for (let x = 0; x < grid - 1; x++) {
          const a = y * grid + x, b = a + 1, c = a + grid, d = c + 1;
          indices[k++] = a; indices[k++] = c; indices[k++] = b;
          indices[k++] = b; indices[k++] = c; indices[k++] = d;
        }
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.indexCount = indices.length;
    }
    // sample the heightfield down to the display grid
    const H = new Float32Array(grid * grid);
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        H[y * grid + x] = field.sample(x / (grid - 1), y / (grid - 1));
      }
    }
    // heights are 0..1 — map to a world scale of 1 unit across
    const scaleXZ = 1.0, scaleY = this.scaleY;
    let i = 0;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const u = x / (grid - 1), v = y / (grid - 1);
        this.positions[i * 3] = (u - 0.5) * scaleXZ * 2;
        this.positions[i * 3 + 1] = H[y * grid + x] * scaleY - 0.12;
        this.positions[i * 3 + 2] = (v - 0.5) * scaleXZ * 2;
        i++;
      }
    }
    // normals
    const dX = (2 * scaleXZ) / (grid - 1), dZ = (2 * scaleXZ) / (grid - 1);
    i = 0;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(grid - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(grid - 1, y + 1);
        const hL = H[y * grid + xm] * scaleY, hR = H[y * grid + xp] * scaleY;
        const hD = H[ym * grid + x] * scaleY, hU = H[yp * grid + x] * scaleY;
        const nx = (hL - hR) / (2 * dX);
        const nz = (hD - hU) / (2 * dZ);
        const len = Math.hypot(nx, 1, nz);
        this.normals[i * 3] = nx / len;
        this.normals[i * 3 + 1] = 1 / len;
        this.normals[i * 3 + 2] = nz / len;
        i++;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.normals, gl.DYNAMIC_DRAW);

    if (satImg) this.uploadImage(this.texSat, Math.sqrt(satImg.length / 4), satImg);
    if (sigA) this.uploadImage(this.texSigA, Math.sqrt(sigA.length / 4), sigA);
    if (sigB) this.uploadImage(this.texSigB, Math.sqrt(sigB.length / 4), sigB);
  }

  bindInput() {
    const c = this.canvas;
    let dragging = null, lx = 0, ly = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      lx = e.clientX; ly = e.clientY;
      c.classList.add('dragging');
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (dragging === 'orbit') {
        this.cam.yaw += dx * 0.0062;
        this.cam.pitch = Math.max(0.03, Math.min(1.5, this.cam.pitch + dy * 0.0052));
      } else {
        const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
        const k = this.cam.dist * 0.0016;
        this.cam.target[0] -= (cy * dx - sy * dy) * k;
        this.cam.target[2] -= (sy * dx + cy * dy) * k;
      }
    });
    const end = (e) => {
      dragging = null;
      c.classList.remove('dragging');
      try { c.releasePointerCapture(e.pointerId); } catch {}
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(0.55, Math.min(9, this.cam.dist * Math.exp(e.deltaY * 0.0011)));
    }, { passive: false });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, this.canvas.clientWidth * dpr);
    const h = Math.max(2, this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  render() {
    const gl = this.gl;
    this.resize();
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.06, 0.06, 0.065, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const az = this.sun.azimuth * Math.PI / 180;
    const el = this.sun.elevation * Math.PI / 180;
    const sunDir = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];

    const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw);
    const cp = Math.cos(this.cam.pitch), sp = Math.sin(this.cam.pitch);
    const eye = [
      this.cam.target[0] + this.cam.dist * cp * cy,
      this.cam.target[1] + this.cam.dist * sp,
      this.cam.target[2] + this.cam.dist * cp * sy,
    ];
    const aspect = w / Math.max(1, h);
    const proj = mat4Perspective(0.9, aspect, 0.02, 40);
    const view = mat4LookAt(eye, this.cam.target, [0, 1, 0]);
    const mvp = mat4Mul(proj, view);

    const lowSun = Math.max(0, Math.min(1, this.sun.elevation / 45));
    const sunColor = [1.0 * (0.55 + 0.45 * lowSun) + 0.12, 0.86 * (0.5 + 0.5 * lowSun) + 0.05, 0.68 * (0.35 + 0.65 * lowSun) + 0.05];
    const zenith = [0.16 + lowSun * 0.1, 0.2 + lowSun * 0.16, 0.3 + lowSun * 0.22];
    const horizon = [0.42 + lowSun * 0.25, 0.42 + lowSun * 0.22, 0.42 + lowSun * 0.18];
    const fogColor = [horizon[0] * 0.92, horizon[1] * 0.92, horizon[2] * 0.92];

    // sky
    gl.useProgram(this.progSky);
    gl.bindVertexArray(this.vaoSky);
    gl.depthMask(false);
    gl.uniform3fv(gl.getUniformLocation(this.progSky, 'uZenith'), zenith);
    gl.uniform3fv(gl.getUniformLocation(this.progSky, 'uHorizon'), horizon);
    gl.uniform3fv(gl.getUniformLocation(this.progSky, 'uSunDir'), sunDir);
    gl.uniform3fv(gl.getUniformLocation(this.progSky, 'uSunColor'), sunColor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    if (this.grid > 1) {
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(this.progTerrain);
      gl.bindVertexArray(this.vaoTerrain);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progTerrain, 'uMVP'), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progTerrain, 'uModel'), false, mat4Identity());
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uSunDir'), sunDir);
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uSunColor'), sunColor);
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uSkyCol'), zenith);
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uGroundCol'), [0.22, 0.2, 0.18]);
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uFogColor'), fogColor);
      gl.uniform3fv(gl.getUniformLocation(this.progTerrain, 'uCamPos'), eye);
      gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uViewMode'), this.viewMode);
      gl.uniform1f(gl.getUniformLocation(this.progTerrain, 'uFogDensity'), 0.16);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texSat);
      gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uSat'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texSigA);
      gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uSigA'), 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.texSigB);
      gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uSigB'), 2);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

      if (this.water.enabled && this.water.level > 0.005 && this.viewMode === 0) {
        gl.useProgram(this.progWater);
        gl.bindVertexArray(this.vaoWater);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.progWater, 'uMVP'), false, mvp);
        gl.uniform1f(gl.getUniformLocation(this.progWater, 'uLevel'), this.water.level * this.scaleY - 0.12);
        gl.uniform1f(gl.getUniformLocation(this.progWater, 'uTime'), this.time);
        gl.uniform3fv(gl.getUniformLocation(this.progWater, 'uSunDir'), sunDir);
        gl.uniform3fv(gl.getUniformLocation(this.progWater, 'uSunColor'), sunColor);
        gl.uniform3fv(gl.getUniformLocation(this.progWater, 'uFogColor'), fogColor);
        gl.uniform3fv(gl.getUniformLocation(this.progWater, 'uCamPos'), eye);
        gl.uniform3fv(gl.getUniformLocation(this.progWater, 'uTint'), hex3(this.water.tint));
        gl.uniform1f(gl.getUniformLocation(this.progWater, 'uFogDensity'), 0.16);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
    gl.bindVertexArray(null);
  }
}
