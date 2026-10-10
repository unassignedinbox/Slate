/**
 * Quad mesh container.
 *
 * Faces are stored as QUADS and only fanned into triangles at upload time.
 * Keeping the quad list is not cosmetic: the junction builder, the topology
 * checker and the edge-flow statistics all reason about quads, and a mesh that
 * is only ever triangles cannot tell you whether its topology is any good.
 */
import { V3, v3, sub, cross, norm, add, mul } from '../core/vec';

export interface Vertex {
  p: V3; n: V3;
  /** lateral offset from the road centreline, metres (signed) */
  u: number;
  /** distance along the road, metres */
  v: number;
  mat: number;
  /** 0 = link, 1 = junction surface, 2 = corner */
  kind: number;
  /** carriageway half width at this station, for marking layout */
  half: number;
  /** 0..1 surface wear, drives polish and crack density */
  wear: number;
  /** lane width and lanes per direction, so the shader can lay out markings */
  laneW: number;
  lanes: number;
  /** 0 none, 1 zebra crossing, 2 stop bar, 3 works/patch */
  mark: number;
}

export class QuadMesh {
  verts: Vertex[] = [];
  /** 4 indices per face */
  quads: number[] = [];
  /** optional triangles, only used where a quad genuinely cannot exist */
  tris: number[] = [];

  push(v: Vertex): number { this.verts.push(v); return this.verts.length - 1; }

  quad(a: number, b: number, c: number, d: number): void {
    if (a === b || b === c || c === d || d === a || a === c || b === d) return;
    // positional degeneracy too: rings near a junction centre can collapse
    const P = this.verts;
    const n1 = cross(sub(P[b].p, P[a].p), sub(P[c].p, P[a].p));
    const n2 = cross(sub(P[c].p, P[a].p), sub(P[d].p, P[a].p));
    const area = (Math.hypot(n1.x, n1.y, n1.z) + Math.hypot(n2.x, n2.y, n2.z)) / 2;
    if (area < 2e-5) return;
    this.quads.push(a, b, c, d);
  }

  /** Connect two equal-length rings into a quad strip. */
  strip(ra: number[], rb: number[], seam: boolean[]): void {
    const n = Math.min(ra.length, rb.length);
    for (let i = 0; i < n - 1; i++) {
      if (seam[i]) continue;
      this.quad(ra[i], ra[i + 1], rb[i + 1], rb[i]);
    }
  }

  get faceCount(): number { return this.quads.length / 4 + this.tris.length / 3; }
  get quadRatio(): number {
    const q = this.quads.length / 4, t = this.tris.length / 3;
    return q + t === 0 ? 1 : q / (q + t);
  }

  /** Area-weighted vertex normals from the quad faces. */
  computeNormals(): void {
    for (const v of this.verts) v.n = v3(0, 0, 0);
    const accum = (ia: number, ib: number, ic: number) => {
      const a = this.verts[ia].p, b = this.verts[ib].p, c = this.verts[ic].p;
      const fn = cross(sub(b, a), sub(c, a));
      for (const i of [ia, ib, ic]) this.verts[i].n = add(this.verts[i].n, fn);
    };
    for (let i = 0; i < this.quads.length; i += 4) {
      const [a, b, c, d] = [this.quads[i], this.quads[i + 1], this.quads[i + 2], this.quads[i + 3]];
      accum(a, b, c); accum(a, c, d);
    }
    for (let i = 0; i < this.tris.length; i += 3) accum(this.tris[i], this.tris[i + 1], this.tris[i + 2]);
    for (const v of this.verts) {
      const l = Math.hypot(v.n.x, v.n.y, v.n.z);
      v.n = l > 1e-9 ? mul(v.n, 1 / l) : v3(0, 1, 0);
    }
  }

  /** Interleaved GPU buffers. Quads are fanned a-b-c, a-c-d. */
  toBuffers(): { verts: Float32Array; idx: Uint32Array } {
    const F = 16;
    const vb = new Float32Array(this.verts.length * F);
    this.verts.forEach((v, i) => {
      const o = i * F;
      vb[o] = v.p.x; vb[o + 1] = v.p.y; vb[o + 2] = v.p.z;
      vb[o + 3] = v.n.x; vb[o + 4] = v.n.y; vb[o + 5] = v.n.z;
      vb[o + 6] = v.u; vb[o + 7] = v.v;
      vb[o + 8] = v.mat; vb[o + 9] = v.kind; vb[o + 10] = v.half; vb[o + 11] = v.wear;
      vb[o + 12] = v.laneW; vb[o + 13] = v.lanes; vb[o + 14] = v.mark;
    });
    const idx = new Uint32Array(this.quads.length / 4 * 6 + this.tris.length);
    let k = 0;
    for (let i = 0; i < this.quads.length; i += 4) {
      const a = this.quads[i], b = this.quads[i + 1], c = this.quads[i + 2], d = this.quads[i + 3];
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = a; idx[k++] = c; idx[k++] = d;
    }
    for (let i = 0; i < this.tris.length; i++) idx[k++] = this.tris[i];
    return { verts: vb, idx };
  }
}

/** Shared vertex factory with sensible defaults. */
export const V = (
  p: V3, u: number, v: number, mat: number, kind = 0, half = 0, wear = 0,
  laneW = 3.5, lanes = 1, mark = 0,
): Vertex => ({ p, n: v3(0, 1, 0), u, v, mat, kind, half, wear, laneW, lanes, mark });

export { norm as vnorm };
