/** Small vector / matrix kit. Right-handed, Y up, metres. */
export interface V2 { x: number; y: number }
export interface V3 { x: number; y: number; z: number }

export const v2 = (x = 0, y = 0): V2 => ({ x, y });
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
});
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t);
};
/** Signed angle of a ground-plane direction, measured in the XZ plane. */
export const angleXZ = (d: V3): number => Math.atan2(d.z, d.x);

// ---------------------------------------------------------------- matrices
export type M4 = Float32Array;
export const m4 = (): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function m4Mul(a: M4, b: M4, out = m4()): M4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function m4Perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2);
  const o = m4();
  o[0] = f / aspect; o[5] = f; o[10] = far / (near - far); o[11] = -1;
  o[14] = (far * near) / (near - far); o[15] = 0;
  return o;
}

export function m4Ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
  const o = m4();
  o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 1 / (n - f);
  o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = n / (n - f);
  return o;
}

export function m4LookAt(eye: V3, ctr: V3, up: V3): M4 {
  const f = norm(sub(ctr, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  const o = m4();
  o[0] = s.x; o[4] = s.y; o[8] = s.z;
  o[1] = u.x; o[5] = u.y; o[9] = u.z;
  o[2] = -f.x; o[6] = -f.y; o[10] = -f.z;
  o[12] = -dot(s, eye); o[13] = -dot(u, eye); o[14] = dot(f, eye);
  return o;
}

export function m4Invert(m: M4): M4 {
  const o = m4();
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return o;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

export function m4XformPoint(m: M4, p: V3): V3 {
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15] || 1;
  return {
    x: (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w,
    y: (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w,
    z: (m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]) / w,
  };
}

export function m4TRS(t: V3, yaw: number, s: V3): M4 {
  const c = Math.cos(yaw), si = Math.sin(yaw);
  const o = m4();
  o[0] = c * s.x; o[2] = -si * s.x;
  o[5] = s.y;
  o[8] = si * s.z; o[10] = c * s.z;
  o[12] = t.x; o[13] = t.y; o[14] = t.z;
  return o;
}

/** Deterministic hash noise, so a given network always rebuilds identically. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function noise1(x: number): number {
  const i = Math.floor(x), f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(hash2(i, 0), hash2(i + 1, 0), s) * 2 - 1;
}
export function fbm1(x: number, oct = 4): number {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += noise1(x * f + i * 17.3) * a; a *= 0.5; f *= 2; }
  return s;
}
