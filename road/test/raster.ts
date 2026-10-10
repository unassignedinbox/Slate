/* Headless z-buffer rasteriser: there is no GPU in the sandbox, so this is how
   the geometry gets looked at. Shades with real vertex normals and can overlay
   the QUAD wireframe, which is the only way to see topology. */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { V3, v3, norm, sub, cross, dot, add, mul } from '../src/core/vec';

export function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export class Canvas {
  img: Uint8Array; z: Float32Array;
  constructor(public w: number, public h: number, bg: [number, number, number] = [20, 22, 26]) {
    this.img = new Uint8Array(w * h * 4);
    this.z = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) {
      this.img[i * 4] = bg[0]; this.img[i * 4 + 1] = bg[1]; this.img[i * 4 + 2] = bg[2]; this.img[i * 4 + 3] = 255;
    }
  }
  save(p: string): void { writeFileSync(p, png(this.w, this.h, this.img)); }
}

export interface View { eye: V3; ctr: V3; scale: number; vx: number; vy: number; vw: number; vh: number }

export function project(v: View, p: V3): { x: number; y: number; z: number } {
  const fwd = norm(sub(v.ctr, v.eye));
  const upRef = Math.abs(fwd.y) > 0.98 ? v3(0, 0, 1) : v3(0, 1, 0);
  const right = norm(cross(fwd, upRef));
  const up = cross(right, fwd);
  const d = sub(p, v.eye);
  const z = dot(d, fwd);
  const s = (v.vw * v.scale) / Math.max(z, 0.05);
  return { x: v.vx + v.vw / 2 + dot(d, right) * s, y: v.vy + v.vh / 2 - dot(d, up) * s, z };
}

export function triSmooth(
  c: Canvas, view: View, p: [V3, V3, V3], nn: [V3, V3, V3], col: [number, number, number],
): void {
  const q = [project(view, p[0]), project(view, p[1]), project(view, p[2])];
  if (q.some((v) => v.z <= 0.05)) return;
  const minX = Math.max(view.vx, Math.floor(Math.min(q[0].x, q[1].x, q[2].x)));
  const maxX = Math.min(view.vx + view.vw - 1, Math.ceil(Math.max(q[0].x, q[1].x, q[2].x)));
  const minY = Math.max(view.vy, Math.floor(Math.min(q[0].y, q[1].y, q[2].y)));
  const maxY = Math.min(view.vy + view.vh - 1, Math.ceil(Math.max(q[0].y, q[1].y, q[2].y)));
  const area = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y);
  if (Math.abs(area) < 1e-9) return;
  const sun = norm(v3(0.45, 0.82, 0.35));
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
      let N = norm(v3(
        w0 * nn[0].x + w1 * nn[1].x + w2 * nn[2].x,
        w0 * nn[0].y + w1 * nn[1].y + w2 * nn[2].y,
        w0 * nn[0].z + w1 * nn[1].z + w2 * nn[2].z));
      const P = v3(w0 * p[0].x + w1 * p[1].x + w2 * p[2].x,
        w0 * p[0].y + w1 * p[1].y + w2 * p[2].y, w0 * p[0].z + w1 * p[1].z + w2 * p[2].z);
      const Vv = norm(sub(view.eye, P));
      if (dot(N, Vv) < 0) N = mul(N, -1);
      const ndl = Math.max(dot(N, sun), 0);
      const amb = 0.16 + 0.26 * (0.5 + 0.5 * N.y);
      for (let k = 0; k < 3; k++) {
        const lit = (col[k] / 255) * (amb + ndl * 0.9);
        c.img[o * 4 + k] = Math.round(255 * Math.min(1, Math.pow(Math.max(lit, 0), 1 / 2.2)));
      }
    }
  }
}

export function line(c: Canvas, view: View, a: V3, b: V3, col: [number, number, number], bias = 0.985): void {
  const p = project(view, a), q = project(view, b);
  if (p.z <= 0.05 || q.z <= 0.05) return;
  const n = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = Math.round(p.x + (q.x - p.x) * t), y = Math.round(p.y + (q.y - p.y) * t);
    if (x < view.vx || y < view.vy || x >= view.vx + view.vw || y >= view.vy + view.vh) continue;
    const z = (p.z + (q.z - p.z) * t) * bias;
    const o = y * c.w + x;
    if (z >= c.z[o]) continue;
    c.z[o] = z;
    c.img[o * 4] = col[0]; c.img[o * 4 + 1] = col[1]; c.img[o * 4 + 2] = col[2];
  }
}

export { v3 };
