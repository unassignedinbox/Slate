// WebGL2 helpers — programs, FBOs, float textures, fullscreen & instanced quads.
// Conservative, pattern-tested WebGL2 usage only.
export class GL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is required.');
    this.gl = gl;
    this.canvas = canvas;
    this.extCBF = gl.getExtension('EXT_color_buffer_float');
    if (!this.extCBF) throw new Error('EXT_color_buffer_float is required for the SDF volume.');
    this.extBlend = gl.getExtension('EXT_float_blend');
    this.quadVAO = gl.createVertexArray();
    this.dummyVAO = gl.createVertexArray();
    this.progs = new Map();
  }

  program(key, vs, fs, label) {
    const gl = this.gl;
    if (this.progs.has(key)) { gl.deleteProgram(this.progs.get(key).p); this.progs.delete(key); }
    const compile = (type, src, kind) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) || '';
        const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)} | ${l}`).join('\n');
        console.error(`[${kind} ${label}] ${log}\n${lines}`);
        throw new Error(`Shader compile failed (${kind} ${label}): ${log}`);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, 'vs'));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, 'fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link failed (${label}): ${gl.getProgramInfoLog(p)}`);
    const u = new Proxy({}, { get: (t, name) => gl.getUniformLocation(p, name) });
    const rec = { p, u, label };
    this.progs.set(key, rec);
    return rec;
  }

  tex2D(key, w, h, internal, format, type, filter = gl0.NEAREST, wrap = gl0.CLAMP_TO_EDGE) {
    const gl = this.gl;
    if (this.tex && this.tex.has(key)) gl.deleteTexture(this.tex.get(key));
    if (!this.tex) this.tex = new Map();
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    this.tex.set(key, t);
    return t;
  }
  delTex(key) { if (this.tex && this.tex.has(key)) { this.gl.deleteTexture(this.tex.get(key)); this.tex.delete(key); } }

  fbo(key, textures) {
    const gl = this.gl;
    if (!this.fbos) this.fbos = new Map();
    if (this.fbos.has(key)) gl.deleteFramebuffer(this.fbos.get(key));
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    const attachments = [];
    textures.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      attachments.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.drawBuffers(attachments);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`FBO ${key} incomplete: 0x${st.toString(16)}`);
    this.fbos.set(key, f);
    return f;
  }
  delFbo(key) { if (this.fbos && this.fbos.has(key)) { this.gl.deleteFramebuffer(this.fbos.get(key)); this.fbos.delete(key); } }

  // Fullscreen triangle-strip quad via gl_VertexID (no attribute buffers).
  drawQuad(prog) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(this.dummyVAO);
  }
  drawQuadsInstanced(prog, instances) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
    gl.bindVertexArray(this.dummyVAO);
  }

  viewport(x, y, w, h) { this.gl.viewport(x, y, w, h); }
  bindFbo(key) {
    const gl = this.gl;
    if (key === null) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    else gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.get(key));
  }
  dispose() {
    const gl = this.gl;
    this.progs.forEach(r => gl.deleteProgram(r.p));
    if (this.tex) this.tex.forEach(t => gl.deleteTexture(t));
    if (this.fbos) this.fbos.forEach(f => gl.deleteFramebuffer(f));
  }
}
const gl0 = { NEAREST: 9728, LINEAR: 9729, CLAMP_TO_EDGE: 33071 };

export const FULLSCREEN_VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0,1);}`;

export function mat4() { return new Float32Array(16); }
export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
  return out;
}
export function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1; zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1; xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}
export function mul4(out, a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  out.set(o); return out;
}
