/** Thin WebGL2 helpers. */

export type GL = WebGL2RenderingContext;

export function createShader(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`Shader compile failed:\n${log}\n${numbered}`);
  }
  return s;
}

export class Program {
  prog: WebGLProgram;
  private loc = new Map<string, WebGLUniformLocation | null>();
  constructor(public gl: GL, vs: string, fs: string) {
    const p = gl.createProgram()!;
    gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
    }
    this.prog = p;
  }
  use(): void { this.gl.useProgram(this.prog); }
  u(name: string): WebGLUniformLocation | null {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name)!;
  }
  m4(name: string, v: Float32Array): void { this.gl.uniformMatrix4fv(this.u(name), false, v); }
  f(name: string, v: number): void { this.gl.uniform1f(this.u(name), v); }
  i(name: string, v: number): void { this.gl.uniform1i(this.u(name), v); }
  v2(name: string, x: number, y: number): void { this.gl.uniform2f(this.u(name), x, y); }
  v3(name: string, x: number, y: number, z: number): void { this.gl.uniform3f(this.u(name), x, y, z); }
  v4(name: string, x: number, y: number, z: number, w: number): void { this.gl.uniform4f(this.u(name), x, y, z, w); }
}

export interface GpuMesh { vao: WebGLVertexArrayObject; count: number; buffers: WebGLBuffer[]; }

/** Build a VAO from interleaved-by-stream arrays (pos3, nrm3, attr3). */
export function makeMesh(gl: GL, pos: Float32Array, nrm: Float32Array, attr: Float32Array): GpuMesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  const bind = (data: Float32Array, loc: number, size: number) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    buffers.push(b);
  };
  bind(pos, 0, 3);
  bind(nrm, 1, 3);
  bind(attr, 2, 3);
  gl.bindVertexArray(null);
  return { vao, count: pos.length / 3, buffers };
}

export function freeMesh(gl: GL, m: GpuMesh): void {
  for (const b of m.buffers) gl.deleteBuffer(b);
  gl.deleteVertexArray(m.vao);
}

export function makeDynamicMesh(gl: GL, maxVerts: number): GpuMesh & { pos: WebGLBuffer; nrm: WebGLBuffer; attr: WebGLBuffer } {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const mk = (loc: number, size: number) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, maxVerts * size * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  };
  const pos = mk(0, 3), nrm = mk(1, 3), attr = mk(2, 3);
  gl.bindVertexArray(null);
  return { vao, count: 0, buffers: [pos, nrm, attr], pos, nrm, attr };
}
