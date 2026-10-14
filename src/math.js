// Minimal vec/mat math in Frontier's frame: +X forward, +Y left, +Z up, metres, right-handed.
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  lerp: (a, b, t) => a + (b - a) * t,
};

// Column-major mat4 (WGSL mat4x4f layout).
export function matIdentity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
export function matMultiply(a, b) { // a * b
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
  }
  return o;
}
export function matFromBasis(origin, xAxis, yAxis, zAxis) {
  return new Float32Array([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    zAxis[0], zAxis[1], zAxis[2], 0,
    origin[0], origin[1], origin[2], 1]);
}
export function matTranslation(p) { const m = matIdentity(); m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; return m; }
export function matScale(s) { const m = matIdentity(); m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; return m; }
export function matRotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
export function matRotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
export function matRotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
// yaw(+Z), pitch(+Y), roll(+X) chassis matrix at position.
export function matChassis(pos, yaw, pitch, roll) {
  return matMultiply(matTranslation(pos), matMultiply(matRotZ(yaw), matMultiply(matRotY(pitch), matRotX(roll))));
}
export function matInvert(m) {
  // General 4x4 inverse (cofactor), enough for rigid + scale placements.
  const a = m; const o = new Float32Array(16);
  const b00=a[0],b01=a[1],b02=a[2],b03=a[3],b10=a[4],b11=a[5],b12=a[6],b13=a[7],b20=a[8],b21=a[9],b22=a[10],b23=a[11],b30=a[12],b31=a[13],b32=a[14],b33=a[15];
  let det = b00*(b11*(b22*b33-b23*b32)-b12*(b21*b33-b23*b31)+b13*(b21*b32-b22*b31))
          - b01*(b10*(b22*b33-b23*b32)-b12*(b20*b33-b23*b30)+b13*(b20*b32-b22*b30))
          + b02*(b10*(b21*b33-b23*b31)-b11*(b20*b33-b23*b30)+b13*(b20*b31-b21*b30))
          - b03*(b10*(b21*b32-b22*b31)-b11*(b20*b32-b22*b30)+b12*(b20*b31-b21*b30));
  det = 1.0 / (det || 1);
  o[0]=(b11*(b22*b33-b23*b32)-b12*(b21*b33-b23*b31)+b13*(b21*b32-b22*b31))*det;
  o[4]=-(b10*(b22*b33-b23*b32)-b12*(b20*b33-b23*b30)+b13*(b20*b32-b22*b30))*det;
  o[8]=(b10*(b21*b33-b23*b31)-b11*(b20*b33-b23*b30)+b13*(b20*b31-b21*b30))*det;
  o[12]=-(b10*(b21*b32-b22*b31)-b11*(b20*b32-b22*b30)+b12*(b20*b31-b21*b30))*det;
  o[1]=-(b01*(b22*b33-b23*b32)-b02*(b21*b33-b23*b31)+b03*(b21*b32-b22*b31))*det;
  o[5]=(b00*(b22*b33-b23*b32)-b02*(b20*b33-b23*b30)+b03*(b20*b32-b22*b30))*det;
  o[9]=-(b00*(b21*b33-b23*b31)-b01*(b20*b33-b23*b30)+b03*(b20*b31-b21*b30))*det;
  o[13]=(b00*(b21*b32-b22*b31)-b01*(b20*b32-b22*b30)+b02*(b20*b31-b21*b30))*det;
  o[2]=(b01*(b12*b33-b13*b32)-b02*(b11*b33-b13*b31)+b03*(b11*b32-b12*b31))*det;
  o[6]=-(b00*(b12*b33-b13*b32)-b02*(b10*b33-b13*b30)+b03*(b10*b32-b12*b30))*det;
  o[10]=(b00*(b11*b33-b13*b31)-b01*(b10*b33-b13*b30)+b03*(b10*b31-b11*b30))*det;
  o[14]=-(b00*(b11*b32-b12*b31)-b01*(b10*b32-b12*b30)+b02*(b10*b31-b11*b30))*det;
  o[3]=-(b01*(b12*b23-b13*b22)-b02*(b11*b23-b13*b21)+b03*(b11*b22-b12*b21))*det;
  o[7]=(b00*(b12*b23-b13*b22)-b02*(b10*b23-b13*b20)+b03*(b10*b22-b12*b20))*det;
  o[11]=-(b00*(b11*b23-b13*b21)-b01*(b10*b23-b13*b20)+b03*(b10*b21-b11*b20))*det;
  o[15]=(b00*(b11*b22-b12*b21)-b01*(b10*b22-b12*b20)+b02*(b10*b21-b11*b20))*det;
  return o;
}
export function transformPoint(m, p) {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]];
}
export function transformDir(m, p) {
  return [
    m[0]*p[0] + m[4]*p[1] + m[8]*p[2],
    m[1]*p[0] + m[5]*p[1] + m[9]*p[2],
    m[2]*p[0] + m[6]*p[1] + m[10]*p[2]];
}
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2); const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = far / (near - far); o[11] = -1; o[14] = (near * far) / (near - far);
  return o;
}
export function lookAt(eye, target, up) {
  const z = V3.norm(V3.sub(eye, target)); const x = V3.norm(V3.cross(up, z)); const y = V3.cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1]);
}
