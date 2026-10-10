// Debug view of the true-3D cliff chunks (software raster with interpolated SDF normals, no GL). Not the app's shader.
// Usage: node scripts/render-cliff-debug.mjs <path-to-CliffGenerator> [preset] [out.png] [overrides-json]
// Software renderer for the traced cliff walls (wall-mesh.js): flat Lambert, z-buffer. Debug tool only.
import fs from 'node:fs'; import zlib from 'node:zlib';
const ROOT = process.argv[2] + '/src/';
const preset = process.argv[3] || 'Coastal cliffs';
const out = process.argv[4] || '/tmp/cliff.png';
const over = process.argv[5] ? JSON.parse(process.argv[5]) : {};
const { generateTerrain } = await import(ROOT + 'pipeline.js');
const { defaults, presets } = await import(ROOT + 'params.js');
const { refineField } = await import(ROOT + 'terrain-geometry.js');
const res = 256;
const params = { ...defaults, ...presets[preset], ...over, resolution: res };
params.droplets = Math.round(params.droplets * (res * res) / (512 * 512));
const field = generateTerrain(params, () => {});
const v = { ...defaults, ...presets[preset], ...over, sdfOn: 1 };
const F = refineField({ ...field, _refined: undefined }, v);
// THEIRS=1 renders the ridge-trace walls (wall-mesh.js: buildWallGeometry(field, v));
// default renders the edge-trace walls (wall-edge.js: buildEdgeWallGeometry(sim, mesh, v))
const theirs = !!process.env.THEIRS;
const { buildWallGeometry } = await import(ROOT + 'wall-mesh.js');
const { buildEdgeWallGeometry } = await import(ROOT + 'wall-edge.js');
const t0 = Date.now();
if (theirs) (await import(ROOT + 'sdf-chunks.js')).selectChunks(F, v); // sets F.sdfWeight, as in the app
const wg = theirs ? buildWallGeometry(F, v) : buildEdgeWallGeometry(field, F, v);
console.error(JSON.stringify({ triangles: wg.triangles, chains: wg.chains === undefined ? null : wg.chains, lengthM: wg.length === undefined ? null : Math.round(wg.length), maxTurnDeg: wg.maxTurn === undefined ? null : +wg.maxTurn.toFixed(2), ms: Date.now() - t0 }));
const WP = wg.positions, WN = wg.normals;
const tris = [];
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
for (let t = 0; t < WP.length; t += 9) {
  tris.push([WP[t], WP[t+1], WP[t+2], WP[t+3], WP[t+4], WP[t+5], WP[t+6], WP[t+7], WP[t+8], WN[t], WN[t+1], WN[t+2], WN[t+3], WN[t+4], WN[t+5], WN[t+6], WN[t+7], WN[t+8]]);
  for (let i = t; i < t + 9; i += 3) { minX = Math.min(minX, WP[i]); maxX = Math.max(maxX, WP[i]); minY = Math.min(minY, WP[i+1]); maxY = Math.max(maxY, WP[i+1]); minZ = Math.min(minZ, WP[i+2]); maxZ = Math.max(maxZ, WP[i+2]); }
}
const W = 900, H = 640;
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
const span = Math.max(maxX - minX, maxZ - minZ, maxY - minY);
// camera: south-east, looking at the centre, 28 deg elevation
const az = Math.PI * 0.8, el = 0.48, dist = span * 1.6;
const eye = [cx + dist * Math.cos(el) * Math.sin(az), cy + dist * Math.sin(el), cz + dist * Math.cos(el) * Math.cos(az)];
const fwd = [cx - eye[0], cy - eye[1], cz - eye[2]]; let fl = Math.hypot(...fwd); for (let i = 0; i < 3; i++) fwd[i] /= fl;
const right = [fwd[2], 0, -fwd[0]]; let rl = Math.hypot(...right); for (let i = 0; i < 3; i++) right[i] /= rl;
const up = [right[1]*fwd[2]-right[2]*fwd[1], right[2]*fwd[0]-right[0]*fwd[2], right[0]*fwd[1]-right[1]*fwd[0]];
const f = 1.0 / Math.tan(0.5 * 0.7);
const zb = new Float32Array(W * H).fill(Infinity);
const rgb = new Uint8Array(W * H * 3).fill(0); for (let i = 0; i < W*H; i++) { rgb[i*3]=200; rgb[i*3+1]=215; rgb[i*3+2]=230; }
const light = [-0.5, 0.75, 0.45]; const ll = Math.hypot(...light); for (let i = 0; i < 3; i++) light[i] /= ll;
const proj = (p) => { const d = [p[0]-eye[0], p[1]-eye[1], p[2]-eye[2]]; const x = d[0]*right[0]+d[1]*right[1]+d[2]*right[2], y = d[0]*up[0]+d[1]*up[1]+d[2]*up[2], z = d[0]*fwd[0]+d[1]*fwd[1]+d[2]*fwd[2]; return [W/2 + (x/z)*f*H/2*-1 + 0, H/2 - (y/z)*f*H/2, z]; };
for (const t of tris) {
  const p0 = proj([t[0],t[1],t[2]]), p1 = proj([t[3],t[4],t[5]]), p2 = proj([t[6],t[7],t[8]]);
  if (p0[2] <= 0 || p1[2] <= 0 || p2[2] <= 0) continue;
  // normal from geometry (more robust than vertex normals on the sharp carve)
  const e1 = [t[3]-t[0], t[4]-t[1], t[5]-t[2]], e2 = [t[6]-t[0], t[7]-t[1], t[8]-t[2]];
  let nx = e1[1]*e2[2]-e1[2]*e2[1], ny = e1[2]*e2[0]-e1[0]*e2[2], nz = e1[0]*e2[1]-e1[1]*e2[0]; const nl = Math.hypot(nx, ny, nz) || 1; nx/=nl; ny/=nl; nz/=nl;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const sh = [0,1,2].map((q) => 0.25 + 0.75 * Math.max(0, t[9+q*3]*light[0] + t[10+q*3]*light[1] + t[11+q*3]*light[2]));
  const minx = Math.max(0, Math.floor(Math.min(p0[0],p1[0],p2[0]))), maxx = Math.min(W-1, Math.ceil(Math.max(p0[0],p1[0],p2[0])));
  const miny = Math.max(0, Math.floor(Math.min(p0[1],p1[1],p2[1]))), maxy = Math.min(H-1, Math.ceil(Math.max(p0[1],p1[1],p2[1])));
  const den = (p1[1]-p2[1])*(p0[0]-p2[0]) + (p2[0]-p1[0])*(p0[1]-p2[1]); if (Math.abs(den) < 1e-9) continue;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const a = ((p1[1]-p2[1])*(x-p2[0]) + (p2[0]-p1[0])*(y-p2[1])) / den;
    const b = ((p2[1]-p0[1])*(x-p2[0]) + (p0[0]-p2[0])*(y-p2[1])) / den;
    const c = 1 - a - b; if (a < -1e-4 || b < -1e-4 || c < -1e-4) continue;
    const z = a*p0[2] + b*p1[2] + c*p2[2]; const k = y*W+x;
    if (z < zb[k]) { zb[k] = z; const s = a*sh[0] + b*sh[1] + c*sh[2]; rgb[k*3] = Math.min(255, 120*s + 60); rgb[k*3+1] = Math.min(255, 112*s + 56); rgb[k*3+2] = Math.min(255, 100*s + 50); }
  }
}
const raw = Buffer.alloc((W*3+1)*H); for (let y = 0; y < H; y++) rgb.subarray(y*W*3,(y+1)*W*3).forEach((val,i)=>{raw[y*(W*3+1)+1+i]=val;});
const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(JSON.stringify({ out, tris: tris.length, span: +span.toFixed(1) }));
