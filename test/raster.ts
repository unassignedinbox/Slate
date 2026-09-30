/* Tiny headless z-buffer rasteriser + PNG writer, for verifying geometry
   without a GPU (there is no browser in the build sandbox). */
import { deflateSync } from 'node:zlib';
import { V3, v3, norm, sub, cross, dot, add, mul } from '../src/core/math';

export function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (ty: string, d: Buffer) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(ty, 'ascii'), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export class Canvas {
  img: Uint8Array;
  z: Float32Array;
  constructor(public w: number, public h: number, bg: [number, number, number] = [16, 18, 22]) {
    this.img = new Uint8Array(w * h * 4);
    this.z = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) {
      this.img[i * 4] = bg[0]; this.img[i * 4 + 1] = bg[1]; this.img[i * 4 + 2] = bg[2]; this.img[i * 4 + 3] = 255;
    }
  }
  save(path: string): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(path, png(this.w, this.h, this.img));
  }
}

export interface View {
  eye: V3; ctr: V3; scale: number;
  vx: number; vy: number; vw: number; vh: number;   // viewport rect
}

export function project(view: View, p: V3): { x: number; y: number; z: number } {
  const fwd = norm(sub(view.ctr, view.eye));
  const right = norm(cross(fwd, v3(0, 1, 0)));
  const up = cross(right, fwd);
  const d = sub(p, view.eye);
  const z = dot(d, fwd);
  const s = (view.vw * view.scale) / Math.max(z, 0.05);
  return {
    x: view.vx + view.vw / 2 + dot(d, right) * s,
    y: view.vy + view.vh / 2 - dot(d, up) * s,
    z,
  };
}

export function tri(c: Canvas, view: View, a: V3, b: V3, cc: V3, col: [number, number, number]): void {
  const q = [project(view, a), project(view, b), project(view, cc)];
  if (q.some((p) => p.z <= 0.05)) return;
  const minX = Math.max(view.vx, Math.floor(Math.min(q[0].x, q[1].x, q[2].x)));
  const maxX = Math.min(view.vx + view.vw - 1, Math.ceil(Math.max(q[0].x, q[1].x, q[2].x)));
  const minY = Math.max(view.vy, Math.floor(Math.min(q[0].y, q[1].y, q[2].y)));
  const maxY = Math.min(view.vy + view.vh - 1, Math.ceil(Math.max(q[0].y, q[1].y, q[2].y)));
  const area = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((q[1].x - x) * (q[2].y - y) - (q[2].x - x) * (q[1].y - y)) / area;
      const w1 = ((q[2].x - x) * (q[0].y - y) - (q[0].x - x) * (q[2].y - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * q[0].z + w1 * q[1].z + w2 * q[2].z;
      const o = y * c.w + x;
      if (z >= c.z[o]) continue;
      c.z[o] = z;
      c.img[o * 4] = Math.min(255, col[0]);
      c.img[o * 4 + 1] = Math.min(255, col[1]);
      c.img[o * 4 + 2] = Math.min(255, col[2]);
    }
  }
}

/** Flat-shaded indexed mesh with a two-light rig. */
export function drawShell(
  c: Canvas, view: View, pos: Float32Array, tris: Uint32Array,
  base: [number, number, number], tint?: (i0: number, i1: number, i2: number) => number,
): void {
  const key = norm(v3(0.45, 0.8, 0.4));
  const fill = norm(v3(-0.6, 0.3, -0.5));
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
    const A = v3(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
    const B = v3(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
    const C = v3(pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]);
    const n = norm(cross(sub(B, A), sub(C, A)));
    const l = 0.16 + 0.85 * Math.max(0, dot(n, key)) + 0.28 * Math.max(0, dot(n, fill));
    // sharp specular makes creases in sheet metal readable
    const V = norm(sub(view.eye, A));
    const H = norm(add(V, key));
    const spec = Math.pow(Math.max(0, dot(n, H)), 42) * 0.9;
    const s = tint ? tint(ia, ib, ic) : 0;
    const col: [number, number, number] = [
      (base[0] * l + 255 * spec) * (1 - s) + 180 * s,
      (base[1] * l + 255 * spec) * (1 - s) + 172 * s,
      (base[2] * l + 255 * spec) * (1 - s) + 168 * s,
    ];
    tri(c, view, A, B, C, col);
  }
}

export { v3, norm, sub, add, mul, cross, dot };

/**
 * Smooth-shaded triangle with per-vertex normals and a light model close to
 * the app's: a hard sun, a sky/ground hemisphere term, and a Blinn specular.
 * This exists so a headless preview shows what the SHADER's normals produce,
 * not what recomputed flat normals would have produced - those two can differ
 * completely, and only the first is what ends up on screen.
 */
export function triSmooth(
  c: Canvas, view: View, p: [V3, V3, V3], nn: [V3, V3, V3],
  col: [number, number, number], spec = 0.5, rough = 0.4,
): void {
  const q = [project(view, p[0]), project(view, p[1]), project(view, p[2])];
  if (q.some((v) => v.z <= 0.05)) return;
  const minX = Math.max(view.vx, Math.floor(Math.min(q[0].x, q[1].x, q[2].x)));
  const maxX = Math.min(view.vx + view.vw - 1, Math.ceil(Math.max(q[0].x, q[1].x, q[2].x)));
  const minY = Math.max(view.vy, Math.floor(Math.min(q[0].y, q[1].y, q[2].y)));
  const maxY = Math.min(view.vy + view.vh - 1, Math.ceil(Math.max(q[0].y, q[1].y, q[2].y)));
  const area = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y);
  if (Math.abs(area) < 1e-9) return;
  const sun = norm(v3(0.55, 0.78, 0.32));
  const shin = 2 / Math.max(rough * rough * rough * rough, 1e-4);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((q[1].x - x) * (q[2].y - y) - (q[2].x - x) * (q[1].y - y)) / area;
      const w1 = ((q[2].x - x) * (q[0].y - y) - (q[0].x - x) * (q[2].y - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * q[0].z + w1 * q[1].z + w2 * q[2].z;
      const o = y * c.w + x;
      if (z >= c.z[o]) continue;
      c.z[o] = z;
      let N = v3(
        w0 * nn[0].x + w1 * nn[1].x + w2 * nn[2].x,
        w0 * nn[0].y + w1 * nn[1].y + w2 * nn[2].y,
        w0 * nn[0].z + w1 * nn[1].z + w2 * nn[2].z,
      );
      N = norm(N);
      const P = v3(
        w0 * p[0].x + w1 * p[1].x + w2 * p[2].x,
        w0 * p[0].y + w1 * p[1].y + w2 * p[2].y,
        w0 * p[0].z + w1 * p[1].z + w2 * p[2].z,
      );
      const V = norm(sub(view.eye, P));
      if (dot(N, V) < 0) N = mul(N, -1);
      const ndl = Math.max(dot(N, sun), 0);
      const H = norm(add(sun, V));
      const s = Math.pow(Math.max(dot(N, H), 0), shin) * spec;
      const sky = 0.5 + 0.5 * N.y;                       // hemisphere ambient
      const amb = 0.10 + 0.26 * sky;
      const fres = 0.04 + 0.5 * Math.pow(1 - Math.max(dot(N, V), 0), 5) * spec;
      const out: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const base = col[k] / 255;
        const lit = base * (amb + ndl * 0.95) + s * 1.5 + fres * 0.55;
        out[k] = Math.round(255 * Math.min(1, Math.pow(Math.max(lit, 0), 1 / 2.2) * 0.95));
      }
      c.img[o * 4] = out[0]; c.img[o * 4 + 1] = out[1]; c.img[o * 4 + 2] = out[2];
    }
  }
}
