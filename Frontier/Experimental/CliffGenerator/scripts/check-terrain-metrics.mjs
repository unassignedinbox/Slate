// Terrain quality metrics for a preset, plus a zoomed hillshade crop of the river-rich window.
//   node scripts/check-terrain-metrics.mjs "Alpine granite" [res=256] [overrides-json] [out.png]
// Metrics (lower = better unless noted):
//   gridBias    how strongly slope directions snap to the 8 D8 directions (0 isotropic … 1 snapped)
//   bankRough   mean |h − mean of 4 neighbours| on the river band (stair-steps raise it)
//   wetCells    cells where the water level stands above the ground (higher = more water kept)
//   siltShare   share of land cells painted as silt / lake bed
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');
const { generateTerrain } = await import(path.join(SRC, 'pipeline.js'));
const { defaults, presets } = await import(path.join(SRC, 'params.js'));
const { NO_WATER } = await import(path.join(SRC, 'features.js'));

const [, , presetArg = 'Alpine granite', resArg = '256', ovrArg = '{}', outArg = ''] = process.argv;
const res = Number(resArg);
const params = { ...defaults, ...presets[presetArg], ...JSON.parse(ovrArg), resolution: res };
params.droplets = Math.round(params.droplets * (res * res) / (512 * 512));
const t0 = Date.now();
const r = generateTerrain(params, () => {});
const ms = Date.now() - t0;
const N = res, H = r.height, cell = params.worldSize / (N - 1);
const sea = params.waterEnabled ? params.seaLevel : -1e9;

let re = 0, im = 0, wsum = 0, rough = 0, rn = 0, wet = 0, land = 0, silt = 0;
for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
  const c = j * N + i;
  const gx = (H[c + 1] - H[c - 1]) / (2 * cell), gz = (H[c + N] - H[c - N]) / (2 * cell);
  const s = Math.hypot(gx, gz);
  if (s > 0.05 && s < 1.5) { const th = Math.atan2(gz, gx); re += s * Math.cos(8 * th); im += s * Math.sin(8 * th); wsum += s; }
  if (r.river[c] > 0.3) { rough += Math.abs(H[c] - (H[c - 1] + H[c + 1] + H[c - N] + H[c + N]) / 4); rn++; }
}
for (let c = 0; c < N * N; c++) {
  if (r.waterLevel[c] > NO_WATER * 0.5 && r.waterLevel[c] - H[c] > 0.02) wet++;
  if (H[c] > sea) { land++; if (r.lake[c] > 0.3) silt++; }
}
const metrics = {
  preset: presetArg, res, overrides: JSON.parse(ovrArg), ms,
  gridBias: +(Math.hypot(re, im) / Math.max(1e-9, wsum)).toFixed(4),
  bankRough: +(rough / Math.max(1, rn)).toFixed(4),
  wetCells: wet, siltShare: +(silt / Math.max(1, land)).toFixed(4),
};
console.log(JSON.stringify(metrics));

if (outArg) writeCrop(outArg);

function writeCrop(out) {
  // the 160² window with the most river cells, shown at 4× with a plain hillshade and the water in blue
  const W = Math.min(160, N), Z = 4, S = W * Z;
  const integ = new Float64Array((N + 1) * (N + 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    integ[(j + 1) * (N + 1) + i + 1] = integ[j * (N + 1) + i + 1] + integ[(j + 1) * (N + 1) + i] - integ[j * (N + 1) + i] + (r.river[j * N + i] > 0.3 ? 1 : 0);
  }
  let best = { s: -1, x: 0, y: 0 };
  for (let y = 0; y + W <= N; y += 8) for (let x = 0; x + W <= N; x += 8) {
    const s = integ[(y + W) * (N + 1) + x + W] - integ[y * (N + 1) + x + W] - integ[(y + W) * (N + 1) + x] + integ[y * (N + 1) + x];
    if (s > best.s) best = { s, x, y };
  }
  const sun = [Math.cos(0.8) * Math.cos(3.6), Math.sin(0.8), Math.cos(0.8) * Math.sin(3.6)];
  const rgb = Buffer.alloc(S * S * 3);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const gi = best.x + Math.floor(i / Z), gj = best.y + Math.floor(j / Z), c = gj * N + gi;
    const hx = H[gj * N + Math.min(N - 1, gi + 1)] - H[gj * N + Math.max(0, gi - 1)];
    const hz = H[Math.min(N - 1, gj + 1) * N + gi] - H[Math.max(0, gj - 1) * N + gi];
    let nx = -hx / (2 * cell), ny = 1, nz = -hz / (2 * cell); const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const s = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]);
    const g = 60 + 150 * (0.35 + 0.65 * s);
    let R = g * 0.95, G = g * 0.92, B = g * 0.85;
    const wl = r.waterLevel[c];
    if (wl > NO_WATER * 0.5 && wl - H[c] > 0.02) { R = 40; G = 110; B = 160; }
    const k = (j * S + i) * 3; rgb[k] = R; rgb[k + 1] = G; rgb[k + 2] = B;
  }
  writePNG(out, S, S, rgb);
}

function writePNG(file, w, h, rgb) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = rgb[y * w * 3 + i];
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
