/**
 * Minimal WebGL2 compute harness.
 *
 * Everything in Slate is computed on the GPU by rendering full-screen passes into
 * floating point textures. This file is the only place that touches raw WebGL.
 *
 *  - Tex2D  : 2D render target (R32F / RGBA32F / RGBA8)   -> heightfields, masks, colour
 *  - Vol3D  : 3D render target (R32F)                     -> cave / carve SDF volumes
 *  - pass() : run a fragment shader over a target (MRT up to 4 attachments)
 *  - pass3D(): run a fragment shader over every Z slice of a volume
 *
 * Targets are recycled through a pool so a 200-iteration erosion loop does not
 * allocate 400 textures.
 */

export type TexFormat = 'R32F' | 'RG32F' | 'RGBA32F' | 'RGBA8';

export interface Tex2D {
  tex: WebGLTexture;
  w: number;
  h: number;
  fmt: TexFormat;
  /** pool bookkeeping */
  key: string;
  uid: number;
}

export interface Vol3D {
  tex: WebGLTexture;
  size: number;
  uid: number;
}

export interface TexRef {
  __texref: true;
  tex: WebGLTexture;
  is3D: boolean;
}

export type UniformValue = number | boolean | number[] | Float32Array | TexRef;

export function t2(t: Tex2D | null | undefined): TexRef | number {
  if (!t) return 0;
  return { __texref: true, tex: t.tex, is3D: false };
}
export function t3(v: Vol3D | null | undefined): TexRef | number {
  if (!v) return 0;
  return { __texref: true, tex: v.tex, is3D: true };
}

const VERT_SRC = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  // full-screen triangle
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface CompiledProgram {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface FormatInfo {
  internal: number;
  format: number;
  type: number;
  channels: number;
}

export class GPU {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly caps: {
    colorBufferFloat: boolean;
    floatLinear: boolean;
    maxTextureSize: number;
    max3DTextureSize: number;
    renderer: string;
  };

  private programs = new Map<string, CompiledProgram>();
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private pool = new Map<string, Tex2D[]>();
  private volPool = new Map<number, Vol3D[]>();
  private uidCounter = 1;
  private live = new Set<number>();
  /** every texture this context owns, pooled or checked out */
  private allTex = new Set<WebGLTexture>();
  /** bytes currently held by pooled + live targets */
  public bytesAllocated = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    const gl = (this.canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required — this browser or GPU does not support it.');
    this.gl = gl;

    const cbf = gl.getExtension('EXT_color_buffer_float');
    const fl = gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');

    this.caps = {
      colorBufferFloat: !!cbf,
      floatLinear: !!fl,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    };
    if (!this.caps.colorBufferFloat) {
      throw new Error('EXT_color_buffer_float unavailable — float render targets are required.');
    }

    this.fbo = gl.createFramebuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  }

  // ---------------------------------------------------------------- formats

  private fmtInfo(fmt: TexFormat): FormatInfo {
    const gl = this.gl;
    switch (fmt) {
      case 'R32F':
        return { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, channels: 1 };
      case 'RG32F':
        return { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, channels: 2 };
      case 'RGBA32F':
        return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, channels: 4 };
      case 'RGBA8':
        return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, channels: 4 };
    }
  }

  private bytesOf(w: number, h: number, fmt: TexFormat) {
    const i = this.fmtInfo(fmt);
    return w * h * i.channels * (fmt === 'RGBA8' ? 1 : 4);
  }

  // ------------------------------------------------------------ allocation

  alloc(w: number, h: number, fmt: TexFormat = 'R32F'): Tex2D {
    const key = `${w}|${h}|${fmt}`;
    const bucket = this.pool.get(key);
    if (bucket && bucket.length) {
      const t = bucket.pop()!;
      this.live.add(t.uid);
      return t;
    }
    const gl = this.gl;
    const info = this.fmtInfo(fmt);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, info.internal, w, h);
    const filter = fmt === 'RGBA8' || this.caps.floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.allTex.add(tex);
    this.bytesAllocated += this.bytesOf(w, h, fmt);
    const t: Tex2D = { tex, w, h, fmt, key, uid: this.uidCounter++ };
    this.live.add(t.uid);
    return t;
  }

  free(t: Tex2D | null | undefined) {
    if (!t) return;
    if (!this.live.has(t.uid)) return; // already pooled — double free guard
    this.live.delete(t.uid);
    let bucket = this.pool.get(t.key);
    if (!bucket) this.pool.set(t.key, (bucket = []));
    bucket.push(t);
  }

  allocVolume(size: number): Vol3D {
    const bucket = this.volPool.get(size);
    if (bucket && bucket.length) return bucket.pop()!;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R32F, size, size, size);
    const filter = this.caps.floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    this.allTex.add(tex);
    this.bytesAllocated += size * size * size * 4;
    return { tex, size, uid: this.uidCounter++ };
  }

  freeVolume(v: Vol3D | null | undefined) {
    if (!v) return;
    let bucket = this.volPool.get(v.size);
    if (!bucket) this.volPool.set(v.size, (bucket = []));
    if (bucket.indexOf(v) === -1) bucket.push(v);
  }

  /** Drop every pooled texture (used when the build resolution changes). */
  purge() {
    const gl = this.gl;
    for (const bucket of this.pool.values()) {
      for (const t of bucket) { gl.deleteTexture(t.tex); this.allTex.delete(t.tex); }
    }
    for (const bucket of this.volPool.values()) {
      for (const v of bucket) { gl.deleteTexture(v.tex); this.allTex.delete(v.tex); }
    }
    this.pool.clear();
    this.volPool.clear();
    this.bytesAllocated = 0;
  }

  // -------------------------------------------------------------- programs

  program(label: string, frag: string, vert: string = VERT_SRC): CompiledProgram {
    // Keyed by source, never by name: two passes that share a debug name but
    // emit different GLSL must not collide into one program.
    const key = frag;
    const hit = this.programs.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, vert, label + ':vert');
    const fs = this.compile(gl.FRAGMENT_SHADER, frag, label + ':frag');
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error(`Link failed [${label}]: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      uniforms.set(name, gl.getUniformLocation(prog, name));
    }
    const compiled = { prog, uniforms };
    this.programs.set(key, compiled);
    return compiled;
  }

  private compile(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) ?? '';
      const numbered = src
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(4)}| ${l}`)
        .join('\n');
      // eslint-disable-next-line no-console
      console.error(`Shader compile failed [${label}]\n${log}\n${numbered}`);
      throw new Error(`Shader compile failed [${label}]: ${log}`);
    }
    return sh;
  }

  // ------------------------------------------------------------ dispatch

  private applyUniforms(p: CompiledProgram, uniforms: Record<string, UniformValue>) {
    const gl = this.gl;
    let unit = 0;
    for (const name in uniforms) {
      const loc = p.uniforms.get(name);
      if (loc === undefined || loc === null) continue;
      const v = uniforms[name];
      if (typeof v === 'number') {
        // Integers must go through uniform1i for sampler-free int uniforms; we
        // rely on shaders declaring floats for float-ish values.
        gl.uniform1f(loc, v);
      } else if (typeof v === 'boolean') {
        gl.uniform1i(loc, v ? 1 : 0);
      } else if ((v as TexRef).__texref) {
        const r = v as TexRef;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(r.is3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, r.tex);
        gl.uniform1i(loc, unit);
        unit++;
      } else {
        const a = v as number[];
        switch (a.length) {
          case 2: gl.uniform2f(loc, a[0], a[1]); break;
          case 3: gl.uniform3f(loc, a[0], a[1], a[2]); break;
          case 4: gl.uniform4f(loc, a[0], a[1], a[2], a[3]); break;
          case 9: gl.uniformMatrix3fv(loc, false, a as number[]); break;
          case 16: gl.uniformMatrix4fv(loc, false, a as number[]); break;
          default: gl.uniform1fv(loc, a as number[]); break;
        }
      }
    }
  }

  private fboChecked = new Set<string>();

  /** Framebuffer completeness depends only on the attachment formats, so this
   *  costs one check per distinct layout rather than one per pass. */
  private checkFramebuffer(layoutKey: string, name: string) {
    if (this.fboChecked.has(layoutKey)) return;
    this.fboChecked.add(layoutKey);
    const st = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (st !== this.gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Incomplete framebuffer (0x${st.toString(16)}) for ${layoutKey} in pass "${name}" — this GPU cannot render to that format combination.`);
    }
  }

  /** Integer uniforms need an explicit path. */
  private applyInts(p: CompiledProgram, ints?: Record<string, number>) {
    if (!ints) return;
    const gl = this.gl;
    for (const name in ints) {
      const loc = p.uniforms.get(name);
      if (loc === undefined || loc === null) continue;
      gl.uniform1i(loc, ints[name] | 0);
    }
  }

  pass(opts: {
    name: string;
    frag: string;
    uniforms?: Record<string, UniformValue>;
    ints?: Record<string, number>;
    target: Tex2D | Tex2D[];
  }) {
    const gl = this.gl;
    const targets = Array.isArray(opts.target) ? opts.target : [opts.target];
    const p = this.program(opts.name, opts.frag);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const bufs: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (i < targets.length) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, targets[i].tex, 0);
        bufs.push(gl.COLOR_ATTACHMENT0 + i);
      } else {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
      }
    }
    gl.drawBuffers(bufs);
    this.checkFramebuffer(targets.map((t) => t.fmt).join('+'), opts.name);
    gl.viewport(0, 0, targets[0].w, targets[0].h);
    const uni = { ...(opts.uniforms ?? {}) } as Record<string, UniformValue>;
    if (p.uniforms.has('uTexel')) uni.uTexel = [1 / targets[0].w, 1 / targets[0].h];
    if (p.uniforms.has('uRes')) uni.uRes = [targets[0].w, targets[0].h];
    this.applyUniforms(p, uni);
    this.applyInts(p, opts.ints);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  /** Render straight to the canvas (default framebuffer). */
  present(opts: {
    name: string;
    frag: string;
    uniforms?: Record<string, UniformValue>;
    ints?: Record<string, number>;
    width: number;
    height: number;
  }) {
    const gl = this.gl;
    const p = this.program(opts.name, opts.frag);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, opts.width, opts.height);
    const uni = { ...(opts.uniforms ?? {}) } as Record<string, UniformValue>;
    uni.uTexel = [1 / opts.width, 1 / opts.height];
    uni.uRes = [opts.width, opts.height];
    this.applyUniforms(p, uni);
    this.applyInts(p, opts.ints);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Runs `frag` once per Z slice. The shader gets `uLayer` (int) and `uVolRes` (float). */
  pass3D(opts: {
    name: string;
    frag: string;
    uniforms?: Record<string, UniformValue>;
    ints?: Record<string, number>;
    target: Vol3D;
  }) {
    const gl = this.gl;
    const p = this.program(opts.name, opts.frag);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, opts.target.size, opts.target.size);
    const uni = { ...(opts.uniforms ?? {}) } as Record<string, UniformValue>;
    uni.uVolRes = opts.target.size;
    uni.uTexel = [1 / opts.target.size, 1 / opts.target.size];
    this.applyUniforms(p, uni);
    this.applyInts(p, opts.ints);
    const layerLoc = p.uniforms.get('uLayer');
    for (let z = 0; z < opts.target.size; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, opts.target.tex, 0, z);
      if (layerLoc) gl.uniform1f(layerLoc, (z + 0.5) / opts.target.size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ LUTs

  private luts = new Map<string, WebGLTexture>();

  /** 1D RGBA8 lookup texture, cached by key (used by SatMap gradients). */
  lut(key: string, data: Uint8Array): WebGLTexture {
    const hit = this.luts.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    const width = data.length / 4;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    // keep the cache from growing without bound
    if (this.luts.size > 64) {
      const first = this.luts.keys().next().value as string;
      gl.deleteTexture(this.luts.get(first)!);
      this.luts.delete(first);
    }
    this.luts.set(key, tex);
    return tex;
  }

  // -------------------------------------------------------------- readback

  /**
   * Read a float target back to the CPU.
   *
   * Only (RGBA, FLOAT) is guaranteed by EXT_color_buffer_float; RED/RG reads
   * are implementation-defined, so we ask the driver what it prefers and fall
   * back to a strided RGBA read when it disagrees. Getting this wrong shows up
   * as an INVALID_OPERATION that kills the whole build, so it is worth the
   * extra branch.
   */
  read(t: Tex2D, out?: Float32Array): Float32Array {
    const gl = this.gl;
    const info = this.fmtInfo(t.fmt);
    const n = t.w * t.h * info.channels;
    const buf = out ?? new Float32Array(n);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);

    const want = info.channels === 1 ? gl.RED : info.channels === 2 ? gl.RG : gl.RGBA;
    const implFmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) as number;
    const implType = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) as number;

    if (info.channels === 4 || (implFmt === want && implType === gl.FLOAT)) {
      gl.readPixels(0, 0, t.w, t.h, want, gl.FLOAT, buf);
    } else {
      const wide = new Float32Array(t.w * t.h * 4);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, wide);
      for (let i = 0, j = 0; i < n; i += info.channels, j += 4) {
        for (let c = 0; c < info.channels; c++) buf[i + c] = wide[j + c];
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
  }

  readBytes(t: Tex2D, out?: Uint8Array): Uint8Array {
    const gl = this.gl;
    const buf = out ?? new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
  }

  /** Parallel reduction to a small tile, then CPU finish. Returns [min, max]. */
  minMax(src: Tex2D): [number, number] {
    const TILE = 8;
    let cur = this.alloc(src.w, src.h, 'RG32F');
    this.pass({
      name: 'reduce.seed',
      frag: REDUCE_SEED,
      uniforms: { uSrc: t2(src) },
      target: cur,
    });
    while (cur.w > TILE || cur.h > TILE) {
      const nw = Math.max(TILE, Math.ceil(cur.w / 2));
      const nh = Math.max(TILE, Math.ceil(cur.h / 2));
      const next = this.alloc(nw, nh, 'RG32F');
      this.pass({
        name: 'reduce.step',
        frag: REDUCE_STEP,
        uniforms: { uSrc: t2(cur), uSrcRes: [cur.w, cur.h] },
        target: next,
      });
      this.free(cur);
      cur = next;
      if (nw === TILE && nh === TILE) break;
    }
    const data = this.read(cur);
    this.free(cur);
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < data.length; i += 2) {
      if (data[i] < mn) mn = data[i];
      if (data[i + 1] > mx) mx = data[i + 1];
    }
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx)) mx = 1;
    return [mn, mx];
  }

  dispose() {
    const gl = this.gl;
    this.purge();
    // purge() only reclaims pooled targets; anything still checked out (the
    // render payload) has to go too or it outlives the context.
    for (const tex of this.allTex) gl.deleteTexture(tex);
    this.allTex.clear();
    for (const tex of this.luts.values()) gl.deleteTexture(tex);
    this.luts.clear();
    this.live.clear();
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.programs.clear();
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
  }
}

const REDUCE_SEED = `#version 300 es
precision highp float;
in vec2 vUV; out vec2 o;
uniform sampler2D uSrc;
void main(){ float v = texture(uSrc, vUV).r; o = vec2(v, v); }`;

const REDUCE_STEP = `#version 300 es
precision highp float;
in vec2 vUV; out vec2 o;
uniform sampler2D uSrc; uniform vec2 uSrcRes;
void main(){
  vec2 base = vUV * uSrcRes - 0.5;
  float lo = 1e30, hi = -1e30;
  for (int y=0;y<2;y++) for (int x=0;x<2;x++){
    vec2 c = (floor(base) + vec2(float(x), float(y)) + 0.5) / uSrcRes;
    vec2 s = texture(uSrc, clamp(c, vec2(0.0), vec2(1.0))).rg;
    lo = min(lo, s.x); hi = max(hi, s.y);
  }
  o = vec2(lo, hi);
}`;
