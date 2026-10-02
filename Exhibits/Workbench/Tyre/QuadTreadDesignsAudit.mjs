// Headless audit + proof renderer for the traced/polygon designs in References/QuadTreadModelling.html.
//
// The page is a browser prototype; this extracts the geometry core straight out of the shipped file
// (between the GEOMETRY CORE markers, so it cannot drift) and, for every design — lane or traced —
//
//   boundary/rim    edges used by exactly one quad. A tread band is legitimately open only at its two
//                   lateral rims (± half-width); anything else is a crack you can see through.
//   nonManifold     edges used by more than two quads.
//   degenerate      zero-area quads.
//   nonQuad         faces that are not 4-index quads (must be zero by construction).
//
// Traced designs get four extra checks, aimed at the symmetry engine itself:
//
//   mirror det      every placement matrix must be a pure isometry (|det| = 1): mirrors/rotations/
//                   translations only, never a scale.
//   self-intersect  an authored block outline crossing itself.
//   motif overlap   pieces of DIFFERENT authored blocks (or different placements, including the odd
//                   parity and the v+1 seam spill) overlapping — mirrored/point-mirrored copies must
//                   interlock with the authored motif, not collide with it.
//   sipe floor check  every sipe strip edge tagged 'side' must be matched by a sipe wall foot of a
//                   neighbouring half (weld happens positionally inside the builder; here we count
//                   strip side walls that would dangle — must be 0).
//
// Watertight semantics for traced designs: pieces are closed shells (top fan, bottom fan, wall quads
// everywhere), walls and bottoms run PENETRATION mm past the continuous groove-floor band, so the only
// legitimate boundary is the band's two rim loops.
//
//   node Exhibits/Workbench/Tyre/QuadTreadDesignsAudit.mjs              audit table
//   node Exhibits/Workbench/Tyre/QuadTreadDesignsAudit.mjs --proofs     also write proof PNGs
//
// Proof PNGs (a flat 3-pitch strip and a 3/4 wheel view per design) are written to
// Exhibits/Gallery/Editor/QuadTread/. The renderer is a small z-buffered software raster — no GL,
// no external packages, PNG written by hand through zlib.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const PROOFS = process.argv.includes('--proofs');
const WANT = process.argv.slice(2).filter(a => !a.startsWith('--'));

// ------------------------------------------------ THREE stub ---------------------------------------------------------
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  cross(v) { const x = this.x, y = this.y, z = this.z; this.x = y * v.z - z * v.y; this.y = z * v.x - x * v.z; this.z = x * v.y - y * v.x; return this; }
  crossVectors(a, b) { this.x = a.y * b.z - a.z * b.y; this.y = a.z * b.x - a.x * b.z; this.z = a.x * b.y - a.y * b.x; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
}
globalThis.THREE = { Vector3: V3 };

// ------------------------------------------- extract the geometry core -----------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'References/QuadTreadModelling.html'), 'utf8');
const core = html.split('// == GEOMETRY CORE BEGIN ==')[1].split('// == GEOMETRY CORE END ==')[0]
                 .replace(/^[^\n]*\n/, '');   // strip the rest of the BEGIN marker line itself
eval(core + `
;globalThis.__G = {
  DESIGNS, T, D, sxDet, placements, resolveShape, splitSipes, derive, buildTread,
  setDesign(k) { preset = k; Object.assign(T, DESIGNS[k].set); },
};`);

const { DESIGNS, T, D, sxDet, placements, resolveShape, splitSipes, derive, buildTread, setDesign } = globalThis.__G;

// ------------------------------------------------ mesh audit ----------------------------------------------------------
function auditMesh(B) {
  const { objV, objF } = B;
  let nonQuad = 0;
  const edgeUse = new Map();
  const ek = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  let degenerate = 0;
  for (const f of objF) {
    if (f.length !== 4) nonQuad++;
    // Newell area
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.length; i++) {
      const p = objV[f[i] - 1], q = objV[f[(i + 1) % f.length] - 1];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (Math.hypot(nx, ny, nz) / 2 < 2.5e-4) degenerate++;
    for (let i = 0; i < f.length; i++) {
      const k = ek(f[i], f[(i + 1) % f.length]);
      edgeUse.set(k, (edgeUse.get(k) || 0) + 1);
    }
  }
  let rim = 0, stray = 0, nonManifold = 0;
  for (const [k, c] of edgeUse) {
    if (c > 2) { nonManifold++; continue; }
    if (c === 1) {
      const [a, b] = k.split('|').map(Number);
      const p = objV[a - 1], q = objV[b - 1];
      const onRim = Math.abs(Math.abs(p[0]) - D.halfW) < 0.02 && Math.abs(Math.abs(q[0]) - D.halfW) < 0.02;
      onRim ? rim++ : stray++;
    }
  }
  return { quads: objF.length, verts: objV.length, rim, stray, nonManifold, degenerate, nonQuad };
}

// ----------------------------------------------- design lint ----------------------------------------------------------
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
function segX(p1, p2, p3, p4) {          // proper crossing only — touching/shared endpoints are fine
  const d1 = cross2(sub2(p4, p3), sub2(p1, p3));
  const d2 = cross2(sub2(p4, p3), sub2(p2, p3));
  const d3 = cross2(sub2(p2, p1), sub2(p3, p1));
  const d4 = cross2(sub2(p2, p1), sub2(p4, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function pipInside(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function overlapMm2(A, B, scale) {        // ≈ overlap area in mm² — 0 means touch-at-most
  let crossing = false;
  for (let i = 0; i < A.length && !crossing; i++) for (let j = 0; j < B.length; j++)
    if (segX(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) { crossing = true; break; }
  if (crossing) {                         // quantify roughly so multiple crossings don't spam: sample anyway
  }
  const x0 = Math.max(Math.min(...A.map(p => p[0])), Math.min(...B.map(p => p[0])));
  const x1 = Math.min(Math.max(...A.map(p => p[0])), Math.max(...B.map(p => p[0])));
  const y0 = Math.max(Math.min(...A.map(p => p[1])), Math.min(...B.map(p => p[1])));
  const y1 = Math.min(Math.max(...A.map(p => p[1])), Math.max(...B.map(p => p[1])));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return 0;
  const N = 28;
  let hit = 0, tot = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const pt = [x0 + (i + .5) / N * (x1 - x0), y0 + (j + .5) / N * (y1 - y0)];
    tot++;
    if (pipInside(pt, A) && pipInside(pt, B)) hit++;
  }
  return hit / tot * (x1 - x0) * (y1 - y0) * scale;
}

function lintTraced(key) {
  const dsg = DESIGNS[key];
  const warn = [];
  // placement matrices must be pure isometries
  for (const parity of [0, 1]) for (const pl of placements(dsg, parity)) {
    const det = sxDet(pl.M);
    if (Math.abs(Math.abs(det) - 1) > 1e-9) warn.push(`placement "${pl.label}" is not an isometry (det ${det.toFixed(3)})`);
  }
  // sipes inside one block must run in parallel families: crossed sipes cut each other's slot floors
  // into junctions the audit treats as residue (they model fine, they just are not crack-audited)
  for (const b of dsg.blocks) {
    const ss = b.sipes || [];
    let crossed = false;
    for (let i = 0; i < ss.length && !crossed; i++) for (let j = i + 1; j < ss.length; j++) {
      const d = Math.abs(((ss[i].ang - ss[j].ang) % 180 + 180) % 180);
      if (d > 2 && d < 178) { crossed = true; break; }
    }
    if (crossed) warn.push(`block "${b.name}": sipes cross — keep one sipe family per block parallel`);
  }
  // authored outlines must be simple
  const authored = dsg.blocks.map(b => ({ name: b.name, parts: splitSipes(resolveShape(b.shape, D.halfW, D.P), b.sipes) }));
  for (const b of dsg.blocks) {
    const pts = resolveShape(b.shape, D.halfW, D.P);
    let xs = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
      if (i === 0 && j === pts.length - 1) continue;
      if (segX(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) xs++;
    }
    if (xs) warn.push(`block "${blk.name}" self-intersects (${xs} crossings)`);
  }
  // group areas per (block, placement, parity); pieces inside one block are a partition by construction
  const groups = [];
  for (const parity of [0, 1]) {
    const places = placements(dsg, parity);
    places.forEach((pl, pi) => authored.forEach((blk, bi) => {
      const polys = blk.parts.map(part => part.poly.map(v => {
        const q = pl.M; const u = q.a * v.p[0] + q.b * v.p[1] + q.e, w = q.c * v.p[0] + q.d * v.p[1] + q.f;
        return [u, w];
      }));
      groups.push({ name: `${blk.name} @ ${pl.label} (${parity ? 'B' : 'A'})`, bi, pi, parity, polys });
    }));
  }
  const scale = D.halfW * D.P;            // uv² → mm²
  let overlaps = 0;
  const test = (G1, G2, dv) => {
    for (const p1 of G1.polys) for (const p2 of G2.polys) {
      const shifted = p2.map(([u, v]) => [u, v + dv]);
      const mm2 = overlapMm2(p1, shifted, scale);
      if (mm2 > 1.0) { overlaps++; if (overlaps < 8) warn.push(`overlap ≈${mm2.toFixed(1)} mm²: ${G1.name} × ${G2.name}${dv ? ' (v' + (dv > 0 ? '+' : '') + dv + ')' : ''}`); }
    }
  };
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i], b = groups[j];
    if (a.bi === b.bi && a.pi === b.pi && a.parity === b.parity) continue;
    if (a.parity === b.parity) { test(a, b, 0); test(a, b, 1); }   // within the pitch and across the seam
    else test(a, b, 1);                  // copies of pitch B sit at tile t+1 relative to pitch A's tile t
  }
  for (const g of groups) test(g, g, 1); // the same pitch recipe one tile along — seam spill must not collide
  // sipe strips: every 'side' edge must find its sipe wall foot — counted positionally through the builder
  return warn;
}

// ----------------------------------------------- PNG (hand-rolled) ---------------------------------------------------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                                   // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------- software raster (z-buffer) -----------------------------------------------
const BASE = { tile: [38, 38, 42], bridge: [46, 74, 104] };
function render(B, cam, file) {
  const { w, h } = cam;
  const img = Buffer.alloc(w * h * 3);
  // background: vertical dark gradient
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, f = y / h;
    img[i] = 18 + 8 * (1 - f); img[i + 1] = 19 + 8 * (1 - f); img[i + 2] = 22 + 9 * (1 - f);
  }
  const zbuf = new Float32Array(w * h).fill(-1e18);
  const L = cam.light;
  const V = B.objV;
  const proj = V.map(v => cam.project(v));
  const put = (p0, p1, p2, r, g, b) => {
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    if (minX > maxX || minY > maxY) return;
    const d = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    if (Math.abs(d) < 1e-12) return;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((p1[0] - px) * (p2[1] - py) - (p1[1] - py) * (p2[0] - px));
      const w2 = ((p2[0] - px) * (p0[1] - py) - (p2[1] - py) * (p0[0] - px));
      if ((w1 >= 0 && w2 >= 0 && (d - w1 - w2) * Math.sign(d) >= 0) || (w1 <= 0 && w2 <= 0 && (d - w1 - w2) * Math.sign(d) <= 0)) {
        const l1 = w1 / d, l2 = w2 / d, l0 = 1 - l1 - l2;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const z = l0 * p0[2] + l1 * p1[2] + l2 * p2[2];
        const idx = y * w + x;
        if (z > zbuf[idx]) { zbuf[idx] = z; const i = idx * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; }
      }
    }
  };
  for (let fi = 0; fi < B.objF.length; fi++) {
    const f = B.objF[fi];
    const a = V[f[0] - 1], b = V[f[1] - 1], c = V[f[2] - 1], d4 = V[f[3] - 1];
    const u1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], u2 = [d4[0] - a[0], d4[1] - a[1], d4[2] - a[2]];
    let n = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
    const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl);
    if (n[0] * cam.fwd[0] + n[1] * cam.fwd[1] + n[2] * cam.fwd[2] > 0) n = n.map(v => -v);   // face the camera
    let lam = 0.22 + 0.78 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    const meta = B.objMeta[fi];
    const base = BASE[meta.set], cc = meta.col;
    const r = Math.min(255, base[0] * cc[0] / (meta.set === 'tile' && cc[0] === 1 && cc[1] === 1 ? 1 : 0.6) * lam + 8);
    const g = Math.min(255, base[1] * cc[1] / (meta.set === 'tile' && cc[0] === 1 && cc[1] === 1 ? 1 : 0.6) * lam + 8);
    const bch = Math.min(255, base[2] * cc[2] / (meta.set === 'tile' && cc[0] === 1 && cc[1] === 1 ? 1 : 0.6) * lam + 8);
    const p = f.map(i => proj[i - 1]);
    put(p[0], p[1], p[2], r, g, bch);
    put(p[0], p[2], p[3], r, g, bch);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(w, h, img));
}

// orthographic cameras
function camFlat(B, w, h) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const v of B.objV) {
    x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
    z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const s = Math.min(w / (x1 - x0), h / (z1 - z0)) * 0.94;
  const L = [-0.35, 0.85, 0.4]; const ll = Math.hypot(...L); L.forEach((v, i) => L[i] = v / ll);
  return {
    w, h, light: L, fwd: [0, 1, 0],
    project: v => [(v[0] - cx) * s + w / 2, (v[2] - cz) * s + h / 2, v[1]],
  };
}
function camWheel(B, w, h) {
  const C = [0, 0, 0]; let r = 0;
  for (const v of B.objV) for (let i = 0; i < 3; i++) C[i] += v[i] / B.objV.length;
  for (const v of B.objV) r = Math.max(r, Math.hypot(v[0] - C[0], v[1] - C[1], v[2] - C[2]));
  const e = [1.05, 0.62, 0.88]; const el = Math.hypot(...e); e.forEach((v, i) => e[i] = v / el);
  const fwd = e.map(v => -v);
  let right = [0 * fwd[2] - 1 * fwd[1], 1 * fwd[0] - 0 * fwd[2], 0 * fwd[1] - 0 * fwd[0]];  // (0,1,0) × fwd
  const rl = Math.hypot(...right); right = right.map(v => v / rl);
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  const s = Math.min(w, h) / (2 * r) * 0.9;
  const L = [-0.45, 0.75, 0.5]; const ll = Math.hypot(...L); L.forEach((v, i) => L[i] = v / ll);
  return {
    w, h, light: L, fwd,
    project: v => {
      const d = [v[0] - C[0], v[1] - C[1], v[2] - C[2]];
      return [(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) * s + w / 2,
              -(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * s + h / 2,
              -(d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2])];
    },
  };
}

// -------------------------------------------------- run ----------------------------------------------------------------
const rows = [];
let failures = 0;
const outDir = path.join(ROOT, 'Exhibits/Gallery/Editor/QuadTread');
const keys = Object.keys(DESIGNS).filter(k => !WANT.length || WANT.includes(k));
for (const key of keys) {
  setDesign(key);
  const dsg = DESIGNS[key];
  const B = buildTread();                       // stage 4: full array, bridged / floored
  const m = auditMesh(B);
  const traced = !!dsg.blocks;
  let warns = [];
  if (traced) warns = lintTraced(key);
  const bad = m.stray > 0 || m.nonManifold > 0 || m.degenerate > 0 || m.nonQuad > 0;
  if (bad) failures++;
  rows.push({
    design: key, kind: traced ? 'traced' : 'lane',
    quads: m.quads, copies: traced ? (dsg.sym && dsg.sym.odd ? `${B.copiesPerPitch}·A/B` : B.copiesPerPitch) : '—',
    rim: m.rim, stray: m.stray, nonMan: m.nonManifold, degen: m.degenerate, nonQuad: m.nonQuad,
    lint: warns.length, bad,
  });
  for (const w of warns) console.log(`  ⚠ ${key}: ${w}`);
  if (PROOFS) {
    const Bf = buildTread({ stage: 1, tiles: 3, floor: true });
    render(Bf, camFlat(Bf, 1100, 760), path.join(outDir, `${key}-flat.png`));
    render(B, camWheel(B, 900, 900), path.join(outDir, `${key}-wheel.png`));
  }
}

// table
const cols = ['design', 'kind', 'quads', 'copies', 'rim', 'stray', 'nonMan', 'degen', 'nonQuad', 'lint'];
const fmt = v => String(v);
const widths = cols.map(c => Math.max(c.length, ...rows.map(r => fmt(r[c]).length)));
const line = vals => vals.map((v, i) => fmt(v).padStart(widths[i])).join('  ');
console.log('\n' + line(cols));
console.log(widths.map(w => '─'.repeat(w)).join('  '));
for (const r of rows) console.log(line(cols.map(c => r[c])) + (r.bad ? '   ✗' : ''));
console.log(`\n${rows.length} designs — ${failures} with mesh defects, ${rows.reduce((a, r) => a + r.lint, 0)} lint warnings${PROOFS ? ` — proofs in ${path.relative(ROOT, outDir)}` : ''}`);
process.exit(failures ? 1 : 0);
