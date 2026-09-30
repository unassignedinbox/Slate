/**
 * Debris batcher.
 *
 * A diced tempered pane is ~500 rigid bodies and a collapsing wall is a few
 * hundred more. One draw call per fragment would murder the frame time, so
 * every fragment that shares a shading style is transformed on the CPU into
 * one big dynamic vertex buffer and drawn in a single call — the same trick
 * shipping engines use for destruction debris.
 *
 * Per-fragment variation (the noise seed) rides along in the vertex stream
 * instead of a uniform, so batching costs nothing visually.
 */

import { GL, GpuMesh } from './gl';
import { MeshData } from '../geom/convex';
import { M4 } from '../core/math';

export interface BatchInput { mesh: MeshData; model: M4; seed: number; }

export class Batch {
  private pos = new Float32Array(0);
  private nrm = new Float32Array(0);
  private attr = new Float32Array(0);
  private cap = 0;
  gpu: GpuMesh | null = null;
  count = 0;

  constructor(private gl: GL) {}

  private grow(verts: number): void {
    if (verts <= this.cap) return;
    this.cap = Math.max(verts, Math.ceil(this.cap * 1.7) + 4096);
    this.pos = new Float32Array(this.cap * 3);
    this.nrm = new Float32Array(this.cap * 3);
    this.attr = new Float32Array(this.cap * 3);
    if (this.gpu) {
      for (const b of this.gpu.buffers) this.gl.deleteBuffer(b);
      this.gl.deleteVertexArray(this.gpu.vao);
      this.gpu = null;
    }
  }

  private alloc(): void {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    for (const [loc, arr] of [[0, this.pos], [1, this.nrm], [2, this.attr]] as [number, Float32Array][]) {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      buffers.push(b);
    }
    gl.bindVertexArray(null);
    this.gpu = { vao, count: 0, buffers };
  }

  /** Transform every input into world space and upload. */
  build(items: BatchInput[]): GpuMesh | null {
    let total = 0;
    for (const it of items) total += it.mesh.count;
    if (!total) { this.count = 0; return null; }
    this.grow(total);
    if (!this.gpu) this.alloc();

    const P = this.pos, N = this.nrm, A = this.attr;
    let o = 0;
    for (const it of items) {
      const m = it.model;
      const m0 = m[0], m1 = m[1], m2 = m[2];
      const m4_ = m[4], m5 = m[5], m6 = m[6];
      const m8 = m[8], m9 = m[9], m10 = m[10];
      const tx = m[12], ty = m[13], tz = m[14];
      const sp = it.mesh.pos, sn = it.mesh.nrm, sa = it.mesh.attr;
      const n = it.mesh.count;
      const seed = it.seed;
      for (let i = 0; i < n; i++) {
        const x = sp[i * 3], y = sp[i * 3 + 1], z = sp[i * 3 + 2];
        const j = (o + i) * 3;
        P[j] = m0 * x + m4_ * y + m8 * z + tx;
        P[j + 1] = m1 * x + m5 * y + m9 * z + ty;
        P[j + 2] = m2 * x + m6 * y + m10 * z + tz;
        const nx = sn[i * 3], ny = sn[i * 3 + 1], nz = sn[i * 3 + 2];
        N[j] = m0 * nx + m4_ * ny + m8 * nz;
        N[j + 1] = m1 * nx + m5 * ny + m9 * nz;
        N[j + 2] = m2 * nx + m6 * ny + m10 * nz;
        A[j] = sa[i * 3];
        A[j + 1] = sa[i * 3 + 1];
        A[j + 2] = seed;
      }
      o += n;
    }

    const gl = this.gl;
    const g = this.gpu!;
    gl.bindVertexArray(g.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buffers[0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, P, 0, total * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buffers[1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, N, 0, total * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buffers[2]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, A, 0, total * 3);
    gl.bindVertexArray(null);
    g.count = total;
    this.count = total;
    return g;
  }

  dispose(): void {
    if (!this.gpu) return;
    for (const b of this.gpu.buffers) this.gl.deleteBuffer(b);
    this.gl.deleteVertexArray(this.gpu.vao);
    this.gpu = null;
    this.cap = 0;
  }
}
