// world.js — terrain (height field), layout, ocean tide, sky
import * as THREE from './vendor/three.module.min.js';
import { clamp, clamp01, smoothstep, smootherstep, hash2, gauss, distSeg, distPoly, part, mergeGeoms, mulberry32 } from './utils.js';
import { S, CFG } from './state.js';

// ------------------------------------------------------------------
// LAYOUT — ocean at -Z, the Great Wall at +Z. Players land between.
// ------------------------------------------------------------------
export const KNOTS = [
  [-260, -8], [-190, -7], [-100, 1.0], [-80, 1.8],
  [60, 2.6], [150, 3.0], [168, 3.3], [300, 3.3],
];

export const MOUNDS = [ // [x, z, radius, height]
  [-95, -12, 26, 11],
  [-8, -2, 21, 9],
  [92, 2, 24, 10],
  [-118, 62, 20, 8],
  [112, 74, 24, 11],
  [28, 98, 17, 7],
  [152, 118, 20, 9],
  [-156, 112, 21, 10],
];

export const TRENCHES = [ // zig-zag fire trenches
  { pts: [[-125, -50], [-95, -58], [-62, -52], [-30, -60], [0, -54], [30, -62], [60, -52], [95, -58], [125, -52]], w: 2.1, depth: 2.35, par: 0.55 },
  { pts: [[-140, 32], [-100, 38], [-70, 30]], w: 2.1, depth: 2.35, par: 0.55 },
  { pts: [[-30, 36], [10, 30], [45, 38]], w: 2.1, depth: 2.35, par: 0.55 },
  { pts: [[85, 34], [120, 28]], w: 2.1, depth: 2.35, par: 0.55 },
  { pts: [[-135, 118], [-95, 124], [-55, 116], [-35, 122]], w: 2.1, depth: 2.3, par: 0.5 },
  { pts: [[30, 120], [70, 114], [110, 122]], w: 2.1, depth: 2.3, par: 0.5 },
];

export const CROSSINGS = [ // where roads bridge the trenches (carve suppressed)
  [-60, -52.5, 6], [55, -54, 6], [0, -54, 3.6],
  [-46, 118, 5], [50, 116, 5],
];

export const ROADS = [ // dirt roads from the beach gaps to the gate
  { pts: [[-60, -104], [-60, -40], [-61, 10], [-58, 60], [-50, 100], [-38, 130], [-20, 152], [-6, 164]], halfW: 3.6 },
  { pts: [[55, -104], [55, -40], [56, 10], [58, 60], [54, 100], [46, 132], [26, 156], [8, 166]], halfW: 3.6 },
];

export const WIRES = [ // barbed wire belts (split polylines leave gaps/lanes)
  { pts: [[-172, -88], [-64, -84]] },
  { pts: [[-56, -86], [-5, -88]] },
  { pts: [[5, -86], [51, -84]] },
  { pts: [[59, -86], [172, -88]] },
  { pts: [[-172, 10], [-75, 6], [-33, 13]] },
  { pts: [[15, 15], [35, 10]] },
  { pts: [[46, 10], [66, 7], [117, 12]] },
  { pts: [[127, 10], [172, 8]] },
  { pts: [[-172, 127], [-49, 126]] },
  { pts: [[-37, 128], [41, 127]] },
  { pts: [[53, 126], [172, 124]] },
];

export const CRATERS = (() => {
  const rng = mulberry32(1337);
  const out = [];
  let guard = 0;
  while (out.length < 15 && guard++ < 400) {
    const x = -150 + rng() * 300;
    const z = -75 + rng() * 215;
    const r = 2.6 + rng() * 2.2;
    if (roadDistRaw(x, z) < 6) continue;
    if (trenchNear(x, z) < r + 4) continue;
    out.push([x, z, r, 0.7 + rng() * 0.5]);
  }
  return out;
})();

export const HEDGEHOGS = (() => {
  const rng = mulberry32(4242);
  const out = [];
  let guard = 0;
  while (out.length < 30 && guard++ < 600) {
    const x = -160 + rng() * 320;
    const z = -142 + rng() * 46;
    if (Math.hypot(x - 0, z + 140) < 16) continue;             // spawn area
    if (Math.hypot(x - 4, z + 160) < 14) continue;             // landing craft
    if (Math.abs(x + 60) < 10) continue;                       // west lane
    if (Math.abs(x - 55) < 10) continue;                       // east lane
    if (Math.abs(x) < 12) continue;                            // centre lane
    let ok = true;
    for (const h of out) if (Math.hypot(x - h[0], z - h[1]) < 5.2) { ok = false; break; }
    if (!ok) continue;
    out.push([x, z, rng() * Math.PI]);
  }
  return out;
})();

// trench metadata with bbox for fast rejects
for (const tr of TRENCHES) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of tr.pts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
  }
  tr.bbx0 = x0; tr.bbx1 = x1; tr.bbz0 = z0; tr.bbz1 = z1;
}

// ------------------------------------------------------------------
// HEIGHT FIELD
// ------------------------------------------------------------------
function baseZ(z) {
  const K = KNOTS;
  if (z <= K[0][0]) return K[0][1];
  for (let i = 0; i < K.length - 1; i++) {
    if (z <= K[i + 1][0]) {
      const t = smootherstep(K[i][0], K[i + 1][0], z);
      return K[i][1] + (K[i + 1][1] - K[i][1]) * t;
    }
  }
  return K[K.length - 1][1];
}

function noise2(x, z) {
  return 0.22 * (Math.sin(x * 0.043 + z * 0.027 + 2.1) * 0.6 + Math.sin(x * 0.019 - z * 0.051) * 0.4);
}
function plainNoiseF(z) {
  return smoothstep(-70, -20, z) * (1 - smoothstep(148, 168, z));
}

const TF = { carve: 0, par: 0 };
export function trenchF(x, z) {
  let carve = 0, par = 0;
  for (const tr of TRENCHES) {
    if (x < tr.bbx0 - 5 || x > tr.bbx1 + 5 || z < tr.bbz0 - 5 || z > tr.bbz1 + 5) continue;
    const pts = tr.pts, w = tr.w;
    for (let i = 0; i < pts.length - 1; i++) {
      const r = distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (r.d > w + 2.8) continue;
      const inside = clamp01(1 - r.d / w);
      const c = tr.depth * Math.pow(inside, 0.72);
      if (c > carve) carve = c;
      if (r.d > w * 0.5) {
        const p = tr.par * gauss((r.d - (w + 1.0)) / 1.6);
        if (p > par) par = p;
      }
    }
  }
  if (carve > 0.001 || par > 0.001) {
    for (const c of CROSSINGS) {
      const dx = x - c[0], dz = z - c[1];
      const lim = c[2] + 2;
      if (dx * dx + dz * dz < lim * lim) {
        const d = Math.sqrt(dx * dx + dz * dz);
        const mult = smoothstep(c[2] * 0.45, c[2], d);
        carve *= mult; par *= mult;
      }
    }
  }
  TF.carve = carve; TF.par = par;
  return TF;
}

function craterC(x, z) {
  let v = 0;
  for (const c of CRATERS) {
    const dx = x - c[0], dz = z - c[1];
    if (dx * dx + dz * dz > (c[2] + 1.6) * (c[2] + 1.6)) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < c[2]) v -= c[3] * (0.5 + 0.5 * Math.cos(Math.PI * d / c[2]));
    else v += 0.2 * gauss((d - c[2] - 0.7) / 0.7);
  }
  return v;
}

export function craterF(x, z) { // 0..1 for coloring
  let v = 0;
  for (const c of CRATERS) {
    const dx = x - c[0], dz = z - c[1];
    const d2 = dx * dx + dz * dz;
    if (d2 < c[2] * c[2]) {
      const t = 1 - Math.sqrt(d2) / c[2];
      if (t > v) v = t;
    }
  }
  return v;
}

export function moundF(x, z) {
  let v = 0;
  for (const m of MOUNDS) {
    const dx = x - m[0], dz = z - m[1];
    const d2 = dx * dx + dz * dz;
    if (d2 < m[2] * m[2]) {
      const t = 1 - Math.sqrt(d2) / m[2];
      if (t > v) v = t;
    }
  }
  return v;
}

function roadDistRaw(x, z) {
  let best = Infinity;
  for (const r of ROADS) {
    const d = distPoly(r.pts, x, z).d - r.halfW;
    if (d < best) best = d;
  }
  return best;
}
export function roadDist(x, z) { return Math.max(0, roadDistRaw(x, z)); }
export function onRoad(x, z) { return roadDistRaw(x, z) < 0; }

export function trenchNear(x, z) {
  let best = Infinity;
  for (const tr of TRENCHES) {
    const d = distPoly(tr.pts, x, z).d;
    if (d < best) best = d;
  }
  return best;
}

export function H(x, z) {
  let y = baseZ(z) + noise2(x, z) * plainNoiseF(z);
  for (let i = 0; i < MOUNDS.length; i++) {
    const m = MOUNDS[i];
    const dx = x - m[0], dz = z - m[1];
    const d2 = dx * dx + dz * dz;
    if (d2 < m[2] * m[2]) {
      y += m[3] * (0.5 + 0.5 * Math.cos(Math.PI * Math.sqrt(d2) / m[2]));
    }
  }
  const tf = trenchF(x, z);
  y += tf.par - tf.carve;
  y += craterC(x, z);
  return y;
}

export function waterlineZ(level) {
  // furthest inland the water reaches at x=0 (ignores bumps that poke through)
  let last = -170;
  for (let z = -170; z < 40; z += 2) {
    if (H(0, z) < level) last = z;
  }
  return last;
}

// ------------------------------------------------------------------
// TERRAIN MESH — flat-shaded, per-face vertex colors, clean facets
// ------------------------------------------------------------------
const C_DEEPSAND = new THREE.Color(0x8d7f63);
const C_WETSAND = new THREE.Color(0xb0a37d);
const C_SAND = new THREE.Color(0xd7c598);
const C_DUNE = new THREE.Color(0xb9ad7f);
const C_GRASS1 = new THREE.Color(0x7d9a54);
const C_GRASS2 = new THREE.Color(0x739049);
const C_GRASS3 = new THREE.Color(0x86a15c);
const C_EARTH = new THREE.Color(0x95805c);
const C_EARTH2 = new THREE.Color(0x7d6b4e);
const C_SCORCH = new THREE.Color(0x5b5442);
const C_TRENCHFLOOR = new THREE.Color(0x6a5a44);
const C_TRENCHWALL = new THREE.Color(0x77664c);
const C_ROAD = new THREE.Color(0x9b7f57);
const C_ROAD2 = new THREE.Color(0x8d714c);
const C_ROADEDGE = new THREE.Color(0x8a7355);

export function buildTerrain() {
  const NX = 120;
  const xs = new Array(NX);
  for (let i = 0; i < NX; i++) xs[i] = -178 + (356 * i) / (NX - 1);
  const zs = [];
  for (let z = -260; z < -85.9; z += 7.25) zs.push(z);
  for (let z = -86; z <= 180.001; z += 2.4) zs.push(z);
  const NZ = zs.length;

  const grid = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      grid[j * NX + i] = H(xs[i], zs[j]);
    }
  }

  const quads = (NX - 1) * (NZ - 1);
  const pos = new Float32Array(quads * 18);
  const col = new Float32Array(quads * 18);
  let o = 0;
  const c = new THREE.Color();

  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const ax = xs[i], az = zs[j], ay = grid[j * NX + i];
      const bx = xs[i + 1], bz = zs[j], by = grid[j * NX + i + 1];
      const cx = xs[i + 1], cz = zs[j + 1], cy = grid[(j + 1) * NX + i + 1];
      const dx = xs[i], dz = zs[j + 1], dy = grid[(j + 1) * NX + i];
      // face 1: a,c,b  face 2: a,d,c
      faceColor((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, c);
      emitTri(pos, col, o, ax, ay, az, cx, cy, cz, bx, by, bz, c); o += 9;
      faceColor((ax + cx + dx) / 3, (az + cz + dz) / 3, (ay + cy + dy) / 3, c);
      emitTri(pos, col, o, ax, ay, az, dx, dy, dz, cx, cy, cz, c); o += 9;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  S.scene.add(mesh);
  S.terrainMesh = mesh;
  return mesh;
}

function emitTri(pos, col, o, x1, y1, z1, x2, y2, z2, x3, y3, z3, c) {
  pos[o] = x1; pos[o + 1] = y1; pos[o + 2] = z1;
  pos[o + 3] = x2; pos[o + 4] = y2; pos[o + 5] = z2;
  pos[o + 6] = x3; pos[o + 7] = y3; pos[o + 8] = z3;
  for (let k = 0; k < 9; k += 3) {
    col[o + k] = c.r; col[o + k + 1] = c.g; col[o + k + 2] = c.b;
  }
}

function faceColor(cx, cz, cy, out) {
  const h = hash2(cx * 0.37, cz * 0.53);
  const road = roadDist(cx, cz);
  const tf = trenchF(cx, cz);
  const cf = craterF(cx, cz);
  const mf = moundF(cx, cz);

  if (cy < -1.4) out.copy(C_DEEPSAND);
  else if (cy < 0.55) out.copy(C_WETSAND);
  else if (cz < -88 + h * 8 && cy < 1.5) out.copy(C_SAND);
  else if (cz < -72 + h * 8) out.copy(h < 0.45 ? C_DUNE : C_SAND);
  else out.copy(h < 0.34 ? C_GRASS1 : h < 0.67 ? C_GRASS2 : C_GRASS3);

  if (mf > 0.34) out.copy(h < 0.5 ? C_EARTH : C_EARTH2);
  if (cf > 0.4) out.copy(C_SCORCH);
  else if (cf > 0.14) out.copy(C_EARTH2);
  if (tf.par > 0.16) out.copy(h < 0.5 ? C_EARTH2 : C_EARTH);
  if (tf.carve > 0.02) out.copy(tf.carve > 1.25 ? C_TRENCHFLOOR : C_TRENCHWALL);
  if (road < 0.05) out.copy(h < 0.5 ? C_ROAD : C_ROAD2);
  else if (road < 1.2 && cz > -96) out.copy(C_ROADEDGE);

  const jit = 0.94 + h * 0.1;
  out.multiplyScalar(jit);
}

// ------------------------------------------------------------------
// OCEAN — rising tide, low-poly animated waves
// ------------------------------------------------------------------
export function buildWater() {
  const geo = new THREE.PlaneGeometry(780, 720, 104, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2f6f8f, transparent: true, opacity: 0.8,
    flatShading: true, shininess: 110, specular: 0xaad4ee,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, -160);
  mesh.receiveShadow = false;
  S.scene.add(mesh);
  const pos = geo.attributes.position;
  const base = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    base[i * 2] = pos.getX(i);
    base[i * 2 + 1] = pos.getZ(i);
  }
  S.water = { mesh, base };
  return mesh;
}

export function updateWaterVisual(time) {
  const w = S.water;
  if (!w) return;
  const pos = w.mesh.geometry.attributes.position;
  const arr = pos.array;
  const t = time;
  const lvl = S.waterLevel;
  for (let i = 0, n = pos.count; i < n; i++) {
    const x = w.base[i * 2], z = w.base[i * 2 + 1];
    arr[i * 3 + 1] = lvl
      + 0.15 * Math.sin(x * 0.055 + t * 0.9)
      + 0.11 * Math.sin(z * 0.081 + t * 1.25)
      + 0.07 * Math.sin((x + z) * 0.13 + t * 2.0);
  }
  pos.needsUpdate = true;
  w.mesh.position.y = 0; // absolute heights baked into vertices
}

// ------------------------------------------------------------------
// SKY + CLOUDS
// ------------------------------------------------------------------
export function buildSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x5f93b8) },
      bottom: { value: new THREE.Color(0xdfe9ec) },
      sunDir: { value: sunDir.clone() },
      sunTint: { value: new THREE.Color(0xffe9c4) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunTint;
      varying vec3 vP;
      void main() {
        vec3 n = normalize(vP);
        float h = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 1.35));
        float s = pow(max(dot(n, normalize(sunDir)), 0.0), 42.0);
        col += sunTint * s * 0.55;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(950, 24, 12), mat);
  dome.frustumCulled = false;
  S.scene.add(dome);
  return dome;
}

export function buildClouds() {
  const rng = mulberry32(777);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const parts = [];
    const n = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(1, 0);
      parts.push(part(g, 0xf6f8f9, {
        p: [(k - n / 2) * 7 + rng() * 4, rng() * 2.4, rng() * 6 - 3],
        s: [7 + rng() * 8, 2.6 + rng() * 1.6, 5 + rng() * 4],
      }));
    }
    const mesh = new THREE.Mesh(mergeGeoms(parts), new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, transparent: true, opacity: 0.92,
    }));
    mesh.position.set(-420 + rng() * 840, 65 + rng() * 55, -420 + rng() * 700);
    S.scene.add(mesh);
    clouds.push(mesh);
  }
  S.clouds = clouds;
}

export function updateClouds(dt) {
  if (!S.clouds) return;
  for (const c of S.clouds) {
    c.position.x += dt * 1.6;
    if (c.position.x > 500) c.position.x = -500;
  }
}

export function buildWorld(sunDir) {
  buildSky(sunDir);
  buildTerrain();
  buildWater();
  buildClouds();
}
