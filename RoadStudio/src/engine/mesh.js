// Triangle-buffer builder. Output layout per vertex (9 floats, 36 bytes):
//   pos.xyz, nrm.xyz, material, uv.x (across-carriageway 0..1), ao
// Quads are the primary primitive; they are emitted as two triangles and counted
// separately so the UI can report the quad ratio of the generated topology.
import { cross, sub, norm, len } from './math.js';

export const VERTEX_FLOATS = 9;

export class MeshBuilder {
  constructor(initial = 1 << 16) {
    this.data = new Float32Array(initial);
    this.n = 0;
    this.quads = 0;
    this.tris = 0;
    this.degenerate = 0;
  }

  ensure(k) {
    if (this.n + k <= this.data.length) return;
    const d = new Float32Array(Math.max(this.data.length * 2, this.n + k));
    d.set(this.data.subarray(0, this.n));
    this.data = d;
  }

  emit(p, n, mat, u, ao) {
    this.ensure(VERTEX_FLOATS);
    const d = this.data, i = this.n;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    d[i + 3] = n[0]; d[i + 4] = n[1]; d[i + 5] = n[2];
    d[i + 6] = mat; d[i + 7] = u; d[i + 8] = ao;
    this.n += VERTEX_FLOATS;
  }

  // Vertices are [x, y, z, u, ao]. Winding is not relied upon: the shader flips normals.
  tri(a, b, c, mat) {
    const pa = a.slice(0, 3), pb = b.slice(0, 3), pc = c.slice(0, 3);
    const nn = cross(sub(pb, pa), sub(pc, pa));
    if (len(nn) < 1e-12) { this.degenerate++; return; }
    const n = norm(nn);
    this.emit(pa, n, mat, a[3] ?? 0.5, a[4] ?? 1);
    this.emit(pb, n, mat, b[3] ?? 0.5, b[4] ?? 1);
    this.emit(pc, n, mat, c[3] ?? 0.5, c[4] ?? 1);
    this.tris++;
  }

  quad(a, b, c, d, mat) {
    const pa = a.slice(0, 3), pb = b.slice(0, 3), pc = c.slice(0, 3), pd = d.slice(0, 3);
    const nn = cross(sub(pc, pa), sub(pd, pb));
    if (len(nn) < 1e-12) { this.degenerate++; return; }
    const n = norm(nn);
    // Each half of the quad is only emitted if it has area, so collapsed edges
    // (poles, zero-width bands) never leave zero-area triangles behind.
    const t1 = len(cross(sub(pb, pa), sub(pc, pa)));
    const t2 = len(cross(sub(pc, pa), sub(pd, pa)));
    if (t1 < 1e-12 && t2 < 1e-12) { this.degenerate++; return; }
    const emitTri = (x, y, z, px, py, pz) => {
      this.emit(px, n, mat, x[3] ?? 0.5, x[4] ?? 1);
      this.emit(py, n, mat, y[3] ?? 0.5, y[4] ?? 1);
      this.emit(pz, n, mat, z[3] ?? 0.5, z[4] ?? 1);
    };
    let count = 0;
    if (t1 >= 1e-12) { emitTri(a, b, c, pa, pb, pc); count++; }
    if (t2 >= 1e-12) { emitTri(a, c, d, pa, pc, pd); count++; }
    if (count === 2) this.quads++;
    this.tris += count;
  }


  result() {
    return this.data.subarray(0, this.n);
  }
}
