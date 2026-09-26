// utils.js — math, RNG, geometry helpers for the low-poly builder
import * as THREE from './vendor/three.module.min.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function smootherstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function gauss(u) { return Math.exp(-2.4 * u * u); }

export function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cz = az + dz * t;
  const ex = px - cx, ez = pz - cz;
  return { d: Math.sqrt(ex * ex + ez * ez), cx, cz };
}

export function distPoly(pts, x, z) {
  let best = Infinity, bcx = 0, bcz = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (r.d < best) { best = r.d; bcx = r.cx; bcz = r.cz; }
  }
  return { d: best, cx: bcx, cz: bcz };
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _col = new THREE.Color();

// Bake a colored, transformed, non-indexed geometry part.
// t = { p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz]|number, dir:[x,y,z] }
export function part(geo, colorHex, t = {}) {
  if (geo.index) geo = geo.toNonIndexed();
  if (t.p || t.r || t.s !== undefined || t.dir) {
    _q.identity();
    if (t.dir) {
      _q.setFromUnitVectors(_v2.set(0, 1, 0), _v2.set(t.dir[0], t.dir[1], t.dir[2]).normalize());
    } else if (t.r) {
      _q.setFromEuler(_e.set(t.r[0], t.r[1], t.r[2]));
    }
    const p = t.p || [0, 0, 0];
    let s = [1, 1, 1];
    if (typeof t.s === 'number') s = [t.s, t.s, t.s];
    else if (t.s) s = t.s;
    _m4.compose(_v.set(p[0], p[1], p[2]), _q, new THREE.Vector3(s[0], s[1], s[2]));
    geo.applyMatrix4(_m4);
  }
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  _col.set(colorHex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Merge non-indexed geometries that all carry position/normal/color.
export function mergeGeoms(list) {
  const items = [];
  let total = 0;
  for (const g of list) {
    const gg = g.index ? g.toNonIndexed() : g;
    if (!gg.attributes.normal) gg.computeVertexNormals();
    items.push(gg);
    total += gg.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of items) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3);
    else col.fill(1, o * 3, (o + c) * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// InstancedMesh from baked parts (single merged geometry, vertex colors)
export function instMesh(parts, count, o = {}) {
  const geo = parts.length === 1 ? parts[0] : mergeGeoms(parts);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: o.roughness !== undefined ? o.roughness : 0.92,
    metalness: o.metalness !== undefined ? o.metalness : 0.05,
    transparent: !!o.transparent,
    opacity: o.opacity !== undefined ? o.opacity : 1,
  });
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.castShadow = o.castShadow !== false;
  im.receiveShadow = o.receiveShadow !== false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return im;
}

export function setInst(im, i, x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m4.compose(_v.set(x, y, z), _q, new THREE.Vector3(s, s, s));
  im.setMatrixAt(i, _m4);
}

export function setInstScale(im, i, x, y, z, ry, sx, sy, sz) {
  _q.setFromEuler(_e.set(0, ry, 0));
  _m4.compose(_v.set(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
  im.setMatrixAt(i, _m4);
}

export function hideInst(im, i) {
  im.getMatrixAt(i, _m4);
  _m4.scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
  im.setMatrixAt(i, _m4);
  im.instanceMatrix.needsUpdate = true;
}

// Weathered warning sign texture (needs DOM — skipped in headless tests)
export function signTexture(line1, line2, opts = {}) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#c9b98c';
  g.fillRect(0, 0, 256, 180);
  g.strokeStyle = '#3a3128'; g.lineWidth = 10;
  g.strokeRect(7, 7, 242, 166);
  // hazard corners
  g.fillStyle = '#b8901f';
  g.fillRect(10, 10, 60, 18); g.fillRect(186, 152, 60, 18);
  if (opts.skull) {
    g.fillStyle = '#2c2620';
    g.beginPath(); g.arc(128, 62, 30, 0, TAU); g.fill();       // cranium
    g.fillRect(112, 84, 32, 18);                                 // jaw
    g.fillStyle = '#c9b98c';
    g.beginPath(); g.arc(117, 58, 8, 0, TAU); g.arc(139, 58, 8, 0, TAU); g.fill(); // eyes
    g.fillRect(120, 72, 16, 5);                                  // nose
    g.fillStyle = '#2c2620';
    for (let i = 0; i < 4; i++) g.fillRect(114 + i * 8, 86, 4, 14); // teeth
  }
  g.fillStyle = opts.fg || '#8a1c12';
  g.textAlign = 'center';
  g.font = 'bold 40px Georgia, serif';
  g.fillText(line1, 128, opts.skull ? 132 : 92);
  if (line2) {
    g.font = 'bold 34px Georgia, serif';
    g.fillText(line2, 128, opts.skull ? 166 : 132);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
