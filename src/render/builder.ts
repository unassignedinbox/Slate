// Pure triangle-mesh accumulator. Output is plain typed-array-friendly arrays,
// bucketed by material name, so the renderer can turn each bucket into one
// BufferGeometry (few draw calls even for a city-sized network).
import { V3, V, sub, cross3, len3, mul, add } from '../core/geometry';

export interface Bucket {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

const UP = V(0, 1, 0);

export class MeshBuilder {
  readonly buckets = new Map<string, Bucket>();

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { pos: [], nrm: [], uv: [], idx: [] };
      this.buckets.set(key, b);
    }
    return b;
  }

  private vert(b: Bucket, p: V3, n: V3, u: number, v: number): number {
    b.pos.push(p.x, p.y, p.z);
    b.nrm.push(n.x, n.y, n.z);
    b.uv.push(u, v);
    return b.pos.length / 3 - 1;
  }

  /** Convex/fan polygon. Winding is fixed so the geometric normal agrees with `n`. */
  poly(key: string, pts: V3[], n: V3 = UP, uvOf?: (p: V3) => [number, number]): void {
    if (pts.length < 3) return;
    const b = this.bucket(key);
    const uv = (p: V3): [number, number] => (uvOf ? uvOf(p) : [p.x / 4, p.z / 4]);
    // Determine winding from the first non-degenerate corner.
    let flip = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const c = cross3(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
      const d = c.x * n.x + c.y * n.y + c.z * n.z;
      if (Math.abs(d) > 1e-12) {
        flip = d < 0;
        break;
      }
    }
    const ids = pts.map((p) => {
      const [u, v] = uv(p);
      return this.vert(b, p, n, u, v);
    });
    for (let i = 1; i < ids.length - 1; i++) {
      if (flip) b.idx.push(ids[0], ids[i + 1], ids[i]);
      else b.idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }

  quad(key: string, a: V3, b: V3, c: V3, d: V3, n: V3 = UP): void {
    this.poly(key, [a, b, c, d], n);
  }

  /** Oriented box. `ax` is a unit XZ vector along the box's length; `halfAcross` runs perpendicular to it. */
  box(key: string, centre: V3, ax: V3, halfAlong: number, halfY: number, halfAcross: number): void {
    const across = V(-ax.z, 0, ax.x);
    const corner = (sa: number, sy: number, sc: number): V3 =>
      V(
        centre.x + ax.x * sa * halfAlong + across.x * sc * halfAcross,
        centre.y + sy * halfY,
        centre.z + ax.z * sa * halfAlong + across.z * sc * halfAcross,
      );
    const faces: [number[][], V3][] = [
      [[[1, 1, -1], [1, 1, 1], [-1, 1, 1], [-1, 1, -1]], UP],
      [[[1, -1, 1], [1, -1, -1], [-1, -1, -1], [-1, -1, 1]], mul(UP, -1)],
      [[[1, 1, 1], [1, -1, 1], [-1, -1, 1], [-1, 1, 1]], V(0, 0, 0)],
      [[[-1, 1, -1], [-1, -1, -1], [1, -1, -1], [1, 1, -1]], V(0, 0, 0)],
      [[[1, 1, -1], [1, -1, -1], [1, -1, 1], [1, 1, 1]], V(0, 0, 0)],
      [[[-1, 1, 1], [-1, -1, 1], [-1, -1, -1], [-1, 1, -1]], V(0, 0, 0)],
    ];
    // Side normals: sa (along) for faces 4/5, sc (across) for faces 2/3.
    const sideNormal = [V(0, 0, 0), V(0, 0, 0), across, mul(across, -1), ax, mul(ax, -1)];
    faces.forEach(([corners, n], fi) => {
      const pts = corners.map(([sa, sy, sc]) => corner(sa, sy, sc));
      const normal = fi < 2 ? n : sideNormal[fi];
      this.poly(key, pts, normal, (p) => [p.x / 4, p.z / 4]);
    });
  }

  /** Upright cylinder (no bottom cap). */
  cylinder(key: string, base: V3, radius: number, height: number, seg = 10): void {
    const pts: V3[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(V(base.x + Math.cos(a) * radius, base.y, base.z + Math.sin(a) * radius));
    }
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      const n = V(nx, 0, nz);
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const q0 = V(p0.x, base.y + height, p0.z);
      const q1 = V(p1.x, base.y + height, p1.z);
      this.poly(key, [p0, p1, q1, q0], n, (p) => [(i / seg) * 2, p.y / 2]);
    }
    const top = pts.slice(0, seg).map((p) => V(p.x, base.y + height, p.z));
    this.poly(key, top, UP);
  }

  /** Tube around a 3D polyline (used for subway tunnels). */
  tube(key: string, pts: V3[], radius: number, sides = 10): void {
    if (pts.length < 2) return;
    const rings: V3[][] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)];
      const c = pts[Math.min(pts.length - 1, k + 1)];
      const t = sub(c, a);
      const tl = len3(t) || 1;
      const tn = V(t.x / tl, t.y / tl, t.z / tl);
      let right = cross3(tn, UP);
      if (len3(right) < 1e-6) right = V(1, 0, 0);
      const rl = len3(right);
      right = V(right.x / rl, 0, right.z / rl);
      const up = cross3(right, tn);
      const ring: V3[] = [];
      for (let i = 0; i < sides; i++) {
        const th = (i / sides) * Math.PI * 2;
        const dir = add(mul(right, Math.cos(th)), mul(up, Math.sin(th)));
        ring.push(add(pts[k], mul(dir, radius)));
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        const p0 = rings[k][i];
        const p1 = rings[k][j];
        const q0 = rings[k + 1][i];
        const q1 = rings[k + 1][j];
        const cen = mul(add(add(p0, p1), add(q0, q1)), 0.25);
        const n = mul(sub(cen, pts[k]), -1 / radius); // inward-facing for a tunnel seen from inside
        this.poly(key, [p0, q0, q1, p1], n, (p) => [p.x / 4, p.z / 4]);
      }
    }
  }
}
