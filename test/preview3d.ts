/* Headless flat-shaded preview of the 3D solid fracture solver. */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { boxConvex, blobConvex, buildMesh, massProperties } from '../src/geom/convex';
import { MATERIALS, MaterialId } from '../src/sim/materials';
import { fractureSolid } from '../src/frac/solid';
import { rng, v3, norm, add, mul, sub, cross, dot, V3 } from '../src/core/math';

function png(w: number, h: number, rgba: Uint8Array): Buffer {
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
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const CW = 620, CH = 480;
const cases: [MaterialId, number, number][] = [
  ['granite', 4000, 1.3], ['spruce', 1600, 2.9], ['concrete', 9000, 1.1], ['abs-plastic', 700, 1.5],
];
const W = cases.length * CW, H = CH;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { img[i * 4] = 14; img[i * 4 + 1] = 16; img[i * 4 + 2] = 20; img[i * 4 + 3] = 255; }
const zbuf = new Float32Array(W * H).fill(Infinity);

let col = 0;
for (const [id, E, span] of cases) {
  const mat = MATERIALS[id];
  const body = id === 'granite' ? blobConvex(0.52, rng(11), 0.35)
    : id === 'spruce' ? boxConvex(1.25, 0.11, 0.11)
      : id === 'abs-plastic' ? boxConvex(0.55, 0.42, 0.0125) : boxConvex(0.42, 0.34, 0.34);
  const frags = fractureSolid(body, mat, {
    point: v3(0, 0.12, 0.3), dir: norm(v3(0, -0.25, -1)), energy: E,
    impulse: Math.sqrt(2 * E * 0.6) * 1.6, radius: 0.02,
  }, { maxFragments: mat.ductility > 0.6 ? 26 : 150, seed: 3 });

  // explode the fragments a little so the internal cut faces are visible
  const eye = v3(1.7, 1.25, 2.4), ctr = v3(0, 0, 0);
  const fwd = norm(sub(ctr, eye)), right = norm(cross(fwd, v3(0, 1, 0))), up = cross(right, fwd);
  const ox = col * CW;
  const proj = (p: V3) => {
    const d = sub(p, eye);
    const z = dot(d, fwd);
    const s = (CW * 0.55) / span / Math.max(z, 0.05);
    return { x: ox + CW / 2 + dot(d, right) * s, y: CH / 2 - dot(d, up) * s, z };
  };
  const sun = norm(v3(0.5, 0.8, 0.35));
  let tris = 0;
  for (const f of frags) {
    const off = mul(norm(f.com), Math.min(0.32, 0.22 * Math.hypot(f.com.x, f.com.y, f.com.z) + 0.05));
    const md = buildMesh(f.convex, mat.roughness, norm(v3(...mat.grain)), f.seed);
    for (let i = 0; i < md.count; i += 3) {
      const P = [0, 1, 2].map((k) => {
        const j = (i + k) * 3;
        return add(v3(md.pos[j], md.pos[j + 1], md.pos[j + 2]), add(f.com, off));
      });
      const n = norm(cross(sub(P[1], P[0]), sub(P[2], P[0])));
      const fresh = md.attr[i * 3];
      const l = Math.max(0.12, dot(n, sun));
      const base = fresh > 0.5 ? 1.35 : 0.85;
      const c = [mat.color[0], mat.color[1], mat.color[2]].map((v) => Math.min(255, v * 255 * l * base * 1.5));
      const q = P.map(proj);
      tris++;
      const minX = Math.max(ox, Math.floor(Math.min(q[0].x, q[1].x, q[2].x)));
      const maxX = Math.min(ox + CW - 1, Math.ceil(Math.max(q[0].x, q[1].x, q[2].x)));
      const minY = Math.max(0, Math.floor(Math.min(q[0].y, q[1].y, q[2].y)));
      const maxY = Math.min(CH - 1, Math.ceil(Math.max(q[0].y, q[1].y, q[2].y)));
      const area = (q[1].x - q[0].x) * (q[2].y - q[0].y) - (q[2].x - q[0].x) * (q[1].y - q[0].y);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const w0 = ((q[1].x - x) * (q[2].y - y) - (q[2].x - x) * (q[1].y - y)) / area;
        const w1 = ((q[2].x - x) * (q[0].y - y) - (q[0].x - x) * (q[2].y - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * q[0].z + w1 * q[1].z + w2 * q[2].z;
        const o = y * W + x;
        if (z >= zbuf[o]) continue;
        zbuf[o] = z;
        img[o * 4] = c[0]; img[o * 4 + 1] = c[1]; img[o * 4 + 2] = c[2];
      }
    }
  }
  let vol = 0; for (const f of frags) vol += f.volume;
  console.log(`${id.padEnd(12)} E=${E}J frags=${String(frags.length).padStart(4)} tris=${tris} vol=${vol.toFixed(4)} m^3 (orig ${massProperties(body).volume.toFixed(4)})`);
  col++;
}
writeFileSync('/tmp/solid.png', png(W, H, img));
console.log('wrote /tmp/solid.png');
