import * as THREE from 'three';
import { featherTexture, hash, clamp } from './util.js';

// Feather geometry: base at origin, grows along +Z, width along X, camber in Y.
// Cached by parameter signature so hundreds of feathers share few geometries.
const geoCache = new Map();

export function featherGeometry(len, width, opts = {}) {
  const {
    pointy = 0.8,      // >1 pointed tip, <1 rounded
    tipStart = 0.55,   // where taper begins
    camber = 0.16,     // cross-section curl (edges down)
    droop = 0.10,      // lengthwise droop
    calamus = 0.14,    // bare-shaft fraction at base
  } = opts;
  const key = [len, width, pointy, tipStart, camber, droop, calamus]
    .map(v => v.toFixed(3)).join('|');
  if (geoCache.has(key)) return geoCache.get(key);

  const LS = 10, WS = 4;
  const pos = [], uvs = [], col = [], idx = [];
  for (let iv = 0; iv <= LS; iv++) {
    const v = iv / LS;
    // width profile
    const grow = Math.min(1, Math.max(0.06, (v - calamus * 0.4) / calamus));
    let tip = 1;
    if (v > tipStart) {
      const t = (v - tipStart) / (1 - tipStart);
      tip = Math.pow(Math.cos(t * Math.PI / 2), pointy);
    }
    const half = 0.5 * width * Math.min(grow, 1) * tip;
    for (let iu = 0; iu <= WS; iu++) {
      const u = (iu / WS) * 2 - 1;
      // slight vane asymmetry: leading (negative x) narrower
      const ux = u < 0 ? u * 0.82 : u;
      const x = ux * half;
      let y = -camber * width * (u * u) * (0.35 + 0.65 * v);
      y -= droop * len * v * v;
      const z = v * len;
      pos.push(x, y, z);
      uvs.push(iu / WS, v);
      // vertex shading: bright shaft, subtly darker rim & tip
      const shade = 1.0 - 0.18 * Math.abs(u) - 0.10 * v;
      col.push(shade, shade, shade);
    }
  }
  const W = WS + 1;
  for (let iv = 0; iv < LS; iv++) for (let iu = 0; iu < WS; iu++) {
    const a = iv * W + iu, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  geoCache.set(key, g);
  return g;
}

// ---- shared feather materials ----
let _mats = null;
export function featherMaterials() {
  if (_mats) return _mats;
  const flightTex = featherTexture('flight', 1);
  const flightTex2 = featherTexture('flight', 4);
  const bodyTex = featherTexture('body', 2);

  function mat(color, tex, rough = 0.9) {
    return new THREE.MeshStandardMaterial({
      color,
      map: tex.map,
      alphaMap: tex.alphaMap,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: rough,
      metalness: 0.0,
      vertexColors: true,
      shadowSide: THREE.FrontSide,
    });
  }
  _mats = {
    primary: mat(0x241a10, flightTex, 0.82),        // near-black brown
    secondary: mat(0x332516, flightTex2, 0.86),
    covertDark: mat(0x3d2c1a, bodyTex, 0.9),
    covertMid: mat(0x4a3722, bodyTex, 0.9),
    bodyDark: mat(0x382817, bodyTex, 0.95),
    bodyMid: mat(0x4d3921, bodyTex, 0.95),
    bodyLight: mat(0x5d4729, bodyTex, 0.95),
    white: mat(0xe9e4d8, bodyTex, 0.9),
    whiteBright: mat(0xf4f0e6, flightTex2, 0.85),
  };
  return _mats;
}

// Create a feather mesh. Returns mesh (castShadow on).
export function makeFeather(len, width, material, opts) {
  const m = new THREE.Mesh(featherGeometry(len, width, opts), material);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

// Feather record used by the animator
export function featherRecord(mesh, spreadEuler, foldEuler, group, idx, side) {
  const qs = new THREE.Quaternion().setFromEuler(spreadEuler);
  const qf = new THREE.Quaternion().setFromEuler(foldEuler);
  // ensure shortest-path slerp (mirrored eulers can flip quaternion sign)
  if (qf.dot(qs) < 0) { qf.x *= -1; qf.y *= -1; qf.z *= -1; qf.w *= -1; }
  mesh.quaternion.copy(qs);
  return {
    mesh, group, idx, side,
    spreadQ: qs, foldQ: qf,
    phase: hash(idx * 3.7 + (side > 0 ? 0 : 13)) * Math.PI * 2,
    tmpQ: new THREE.Quaternion(),
    flutterE: new THREE.Euler(),
  };
}
