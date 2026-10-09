// Renders evaluated stacks to PNG (height, colour and water) with no browser needed.
// Usage: node scripts/render-samples.mjs [outDir] [resolution]
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { createPreset, presetNames, createLayer } from '../src/engine/document.js';
import { evaluateStack } from '../src/engine/stack.js';
import { byKey, byId } from '../src/engine/registry.js';

const outDir = process.argv[2] || 'samples';
const N = Number(process.argv[3] || 192);
mkdirSync(outDir, { recursive: true });

const crc = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Simple hillshade over the height field for readability.
function shade(H, N, hs, cs) {
  const out = new Uint8Array(N * N * 3);
  const lx = -0.6, ly = -0.5, lz = 0.6, ll = Math.hypot(lx, ly, lz);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xm = Math.max(0, x - 1), xp = Math.min(N - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(N - 1, y + 1);
    const dzdx = ((H[y * N + xp] - H[y * N + xm]) * hs) / (2 * cs), dzdy = ((H[yp * N + x] - H[ym * N + x]) * hs) / (2 * cs);
    const nl = Math.hypot(dzdx, dzdy, 1);
    const d = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / (nl * ll));
    const i = (y * N + x) * 3;
    out[i] = out[i + 1] = out[i + 2] = Math.round(255 * (0.25 + 0.75 * d));
  }
  return out;
}

function render(name, r) {
  const n = r.N, cs = r.cfg.worldSize / n, hs = r.cfg.heightScale;
  const hillBuf = shade(r.H, n, hs, cs);
  const colour = new Uint8Array(n * n * 3), hgt = new Uint8Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    const shadeV = hillBuf[i * 3] / 255;
    for (let k = 0; k < 3; k++) {
      colour[i * 3 + k] = Math.round(255 * Math.min(1, Math.max(0, r.C[i * 3 + k] * (0.35 + 0.65 * shadeV))));
    }
    if (r.water[i] > 0) {
      const t = Math.min(1, r.water[i] / 0.02) * 0.6; // translucent fill, not a solid disc
      colour[i * 3] = Math.round(colour[i * 3] * (1 - t) + 40 * t);
      colour[i * 3 + 1] = Math.round(colour[i * 3 + 1] * (1 - t) + 110 * t);
      colour[i * 3 + 2] = Math.round(colour[i * 3 + 2] * (1 - t) + 170 * t);
    }
    const v = Math.round(255 * Math.min(1, Math.max(0, r.H[i])));
    hgt[i * 3] = hgt[i * 3 + 1] = hgt[i * 3 + 2] = v;
  }
  writeFileSync(join(outDir, `${name}-colour.png`), png(n, n, Buffer.from(colour.buffer)));
  writeFileSync(join(outDir, `${name}-height.png`), png(n, n, Buffer.from(hgt.buffer)));
}

const only = process.argv[4];
for (const name of presetNames) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  const doc = createPreset(name, N);
  const r = evaluateStack(doc);
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  console.log(name, `${r.summary.ms.toFixed(0)}ms`, r.errors.length ? r.errors : '');
  render(slug, r);
}

// Single-layer gallery: one generator/shape per image so each can be judged on its own.
if (process.env.GALLERY) {
  const keys = process.env.GALLERY.split(',');
  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) { console.warn('no such key', key); continue; }
    const base = createLayer('constant', { params: { value: 0.2 } });
    const layer = createLayer(def.id);
    const r = evaluateStack({ config: { resolution: N, worldSize: 2048, heightScale: 600, seed: 3 }, layers: [base, layer] });
    console.log(key, `${r.summary.ms.toFixed(0)}ms`, r.errors.length ? r.errors[0].message : '', `${r.summary.min.toFixed(2)}..${r.summary.max.toFixed(2)}`);
    render(`gallery-${key}`, r);
  }
}
void byId;
