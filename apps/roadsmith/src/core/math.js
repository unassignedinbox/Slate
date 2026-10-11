// Slate · Roadsmith — minimal math kit (column-major mat4, Y-up, right-handed, WebGPU depth 0..1)

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Shortest signed angular difference b-a in (-pi, pi]. */
export function angleDelta(a, b) { return wrapAngle(b - a); }

// ---------------------------------------------------------------- vec3 (plain objects {x,y,z})
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const v3copy = (a) => ({ x: a.x, y: a.y, z: a.z });
export const v3add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const v3sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const v3scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const v3madd = (a, b, s) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const v3dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3len = (a) => Math.hypot(a.x, a.y, a.z);
export const v3dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const v3dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const v3cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export function v3norm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export const v3lerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

// ---------------------------------------------------------------- vec2 helpers on the XZ plane
export const xz = (p) => ({ x: p.x, y: p.z });
export const perpXZ = (d) => ({ x: -d.z, y: 0, z: d.x }); // left-hand normal for +Y up
export function normXZ(d) {
  const l = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / l, y: 0, z: d.z / l };
}
export const headingOf = (d) => Math.atan2(d.z, d.x);
export const dirFromHeading = (h) => ({ x: Math.cos(h), y: 0, z: Math.sin(h) });

/** Intersect two 2D lines (point + dir) on XZ. Returns null when near-parallel. */
export function lineIntersectXZ(p0, d0, p1, d1, eps = 1e-6) {
  const den = d0.x * d1.z - d0.z * d1.x;
  if (Math.abs(den) < eps) return null;
  const t = ((p1.x - p0.x) * d1.z - (p1.z - p0.z) * d1.x) / den;
  return { x: p0.x + d0.x * t, y: 0, z: p0.z + d0.z * t, t };
}

export function segClosestParam(a, b, p) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return 0;
  return clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
}

export function pointSegDist2D(p, a, b) {
  const t = segClosestParam(a, b, p);
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.z - (a.z + (b.z - a.z) * t));
}

export function polygonAreaXZ(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.z - q.x * p.z;
  }
  return a * 0.5;
}

export function polygonCentroidXZ(pts) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = p.x * q.z - q.x * p.z;
    a += f; cx += (p.x + q.x) * f; cz += (p.z + q.z) * f;
  }
  if (Math.abs(a) < 1e-9) {
    cx = 0; cz = 0;
    for (const p of pts) { cx += p.x; cz += p.z; }
    return { x: cx / pts.length, y: 0, z: cz / pts.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: 0, z: cz / (6 * a) };
}

export function pointInPolygonXZ(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- mat4 (Float32Array, column-major)
export function mat4() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

export function mat4Identity(out) {
  out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out;
}

export function mat4Mul(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = far / (near - far); out[11] = -1;
  out[14] = (far * near) / (near - far);
  return out;
}

export function mat4Ortho(out, l, r, b, t, n, f) {
  out.fill(0);
  out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = 1 / (n - f);
  out[12] = (l + r) / (l - r); out[13] = (t + b) / (b - t); out[14] = n / (n - f); out[15] = 1;
  return out;
}

export function mat4LookAt(out, eye, center, up) {
  let zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz_ = up.x * zy - up.y * zx;
  l = Math.hypot(xx, xy, xz_);
  if (l < 1e-6) { xx = 1; xy = 0; xz_ = 0; } else { xx /= l; xy /= l; xz_ /= l; }
  const yx = zy * xz_ - zz * xy, yy = zz * xx - zx * xz_, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz_; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz_ * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
  return out;
}

export function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity(out);
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function mat4Compose(out, pos, quatOrAxisAngle, scale = 1) {
  // quatOrAxisAngle: {x,y,z,w}
  const { x, y, z, w } = quatOrAxisAngle;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz_ = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = scale.x !== undefined ? scale.x : scale;
  const sy = scale.y !== undefined ? scale.y : scale;
  const sz = scale.z !== undefined ? scale.z : scale;
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz_ - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz_ + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

/** Build a TRS matrix from position, yaw (about +Y), pitch (about local X) and uniform/axis scale. */
export function mat4FromYawPitch(out, pos, yaw, pitch = 0, scale = 1, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry(yaw) * Rx(pitch) * Rz(roll)
  const m00 = cy * cr + sy * sp * sr, m01 = cp * sr, m02 = -sy * cr + cy * sp * sr;
  const m10 = -cy * sr + sy * sp * cr, m11 = cp * cr, m12 = sy * sr + cy * sp * cr;
  const m20 = sy * cp, m21 = -sp, m22 = cy * cp;
  const sx = scale.x !== undefined ? scale.x : scale;
  const sy2 = scale.y !== undefined ? scale.y : scale;
  const sz = scale.z !== undefined ? scale.z : scale;
  out[0] = m00 * sx; out[1] = m10 * sx; out[2] = m20 * sx; out[3] = 0;
  out[4] = m01 * sy2; out[5] = m11 * sy2; out[6] = m21 * sy2; out[7] = 0;
  out[8] = m02 * sz; out[9] = m12 * sz; out[10] = m22 * sz; out[11] = 0;
  out[12] = pos.x; out[13] = pos.y; out[14] = pos.z; out[15] = 1;
  return out;
}

export function transformPoint(m, p) {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

export function projectPoint(viewProj, p) {
  const x = viewProj[0] * p.x + viewProj[4] * p.y + viewProj[8] * p.z + viewProj[12];
  const y = viewProj[1] * p.x + viewProj[5] * p.y + viewProj[9] * p.z + viewProj[13];
  const z = viewProj[2] * p.x + viewProj[6] * p.y + viewProj[10] * p.z + viewProj[14];
  const w = viewProj[3] * p.x + viewProj[7] * p.y + viewProj[11] * p.z + viewProj[15];
  return { x, y, z, w };
}

/** Ray from normalized device coords (x,y in -1..1, y up) through an inverse view-projection. */
export function rayFromNDC(invViewProj, ndcX, ndcY, origin) {
  const unproject = (z) => {
    const x = invViewProj[0] * ndcX + invViewProj[4] * ndcY + invViewProj[8] * z + invViewProj[12];
    const y = invViewProj[1] * ndcX + invViewProj[5] * ndcY + invViewProj[9] * z + invViewProj[13];
    const w2 = invViewProj[2] * ndcX + invViewProj[6] * ndcY + invViewProj[10] * z + invViewProj[14];
    const w = invViewProj[3] * ndcX + invViewProj[7] * ndcY + invViewProj[11] * z + invViewProj[15];
    return { x: x / w, y: y / w, z: w2 / w };
  };
  const far = unproject(0.0001);
  const dir = v3norm(v3sub(far, origin));
  return { origin, dir };
}

export function rayPlaneY(ray, planeY) {
  if (Math.abs(ray.dir.y) < 1e-7) return null;
  const t = (planeY - ray.origin.y) / ray.dir.y;
  if (t < 0) return null;
  return { t, point: v3madd(ray.origin, ray.dir, t) };
}

export function raySphere(ray, center, radius) {
  const oc = v3sub(ray.origin, center);
  const b = v3dot(oc, ray.dir);
  const c = v3dot(oc, oc) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (-b + Math.sqrt(h) >= 0 ? 0 : null);
}

/** Closest approach between a ray and a 3D segment; returns {dist, t} */
export function raySegmentDistance(ray, a, b) {
  const u = ray.dir;
  const v = v3sub(b, a);
  const w0 = v3sub(ray.origin, a);
  const aa = v3dot(u, u), bb = v3dot(u, v), cc = v3dot(v, v);
  const dd = v3dot(u, w0), ee = v3dot(v, w0);
  const den = aa * cc - bb * bb;
  let s, t;
  if (Math.abs(den) < 1e-9) { s = 0; t = clamp(ee / (cc || 1), 0, 1); }
  else {
    s = (bb * ee - cc * dd) / den;
    t = clamp((aa * ee - bb * dd) / den, 0, 1);
  }
  if (s < 0) s = 0;
  const pr = v3madd(ray.origin, u, s);
  const ps = v3madd(a, v, t);
  return { dist: v3dist(pr, ps), t, s };
}
