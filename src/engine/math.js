// Small, dependency-free math helpers.
//
// Vectors are plain [x, y, z] arrays.
// Matrices are column-major 16-element arrays (the same layout as three.js
// Matrix4.elements, so they can be handed to the renderer without conversion).
//
// Local frame convention used everywhere: +X = right, +Y = up, +Z = forward.
// Yaw is measured around +Y; a yaw of 0 means facing +Z.

export const UP = [0, 1, 0];

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const distXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerpV = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};

// Horizontal forward vector for a yaw angle.
export const forwardFromYaw = (yaw) => [Math.sin(yaw), 0, Math.cos(yaw)];
export const yawFromForward = (f) => Math.atan2(f[0], f[2]);

// Right-handed orthonormal frame from a forward vector (Y-up).
// Returns { F, R, N } with R = cross(N, F) and N = cross(F, R).
export function frameFromForward(forward, up = UP) {
  const F = norm(forward);
  let R = cross(up, F);
  if (len(R) < 1e-6) R = [1, 0, 0];
  R = norm(R);
  const N = norm(cross(F, R));
  return { F, R, N };
}

// ---------- matrices ----------

export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// a * b (apply b first, then a).
export function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function mat4FromBasis(p, X, Y, Z) {
  return [
    X[0], X[1], X[2], 0,
    Y[0], Y[1], Y[2], 0,
    Z[0], Z[1], Z[2], 0,
    p[0], p[1], p[2], 1,
  ];
}

export function mat4Translation(p) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
}

// Rotation about a unit axis (Rodrigues' formula).
export function mat4RotationAxis(axis, angle) {
  const [x, y, z] = norm(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}

export const mat4RotY = (a) => mat4RotationAxis([0, 1, 0], a);
export const mat4RotX = (a) => mat4RotationAxis([1, 0, 0], a);
export const mat4RotZ = (a) => mat4RotationAxis([0, 0, 1], a);

export function mat4TransformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function mat4TransformDir(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

export const mat4Position = (m) => [m[12], m[13], m[14]];
export const mat4Axis = (m, i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];

// Inverse of a rigid transform (rotation + translation, no scale).
export function mat4InverseRigid(m) {
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  return [
    m[0], m[4], m[8], 0,
    m[1], m[5], m[9], 0,
    m[2], m[6], m[10], 0,
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    -(m[4] * tx + m[5] * ty + m[6] * tz),
    -(m[8] * tx + m[9] * ty + m[10] * tz),
    1,
  ];
}

// ---------- seeded random numbers (mulberry32) ----------

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
    // Pick a key from { key: weight } entries.
    weighted(table) {
      const keys = Object.keys(table);
      const total = keys.reduce((s, k) => s + table[k], 0);
      let r = next() * total;
      for (const k of keys) {
        r -= table[k];
        if (r <= 0) return k;
      }
      return keys[keys.length - 1];
    },
    // Derive an independent generator, so adding content in one place does not
    // reshuffle everything else.
    fork(tag) {
      let h = 2166136261 ^ (seed >>> 0);
      const str = String(tag);
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
      return createRng(h >>> 0);
    },
  };
  return rng;
}

// Stable short hash of a string (for asserting determinism in tests).
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
