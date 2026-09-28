//============================================================================================================================================
//                                                      MATHSPECIFICATION.JS
//============================================================================================================================================
// 🧩 Minimal right-handed linear algebra for the eagle showcase: vec3, quaternion (x,y,z,w) and column-major mat4
//    (same memory order WebGL expects). Angles are radians [rad], lengths metres [m].

export const DEG = Math.PI / 180.0;

//------------------------------------------------------------------------------------------------------------------------
//                                                            VEC3
//------------------------------------------------------------------------------------------------------------------------

export const V3 = {
    make: (x = 0, y = 0, z = 0) => [x, y, z],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    length: (a) => Math.hypot(a[0], a[1], a[2]),
    distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    normalize: (a) =>
    {
        const L = Math.hypot(a[0], a[1], a[2]) || 1.0;
        return [a[0] / L, a[1] / L, a[2] / L];
    },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

//------------------------------------------------------------------------------------------------------------------------
//                                                         QUATERNION
//------------------------------------------------------------------------------------------------------------------------

export const Quat = {
    identity: () => [0, 0, 0, 1],

    fromAxisAngle(axis, angle)
    {
        const A = V3.normalize(axis);
        const H = angle * 0.5, S = Math.sin(H);
        return [A[0] * S, A[1] * S, A[2] * S, Math.cos(H)];
    },

    // Intrinsic X→Y→Z (pitch, yaw, roll about the joint's own axes).
    fromEuler(x, y, z)
    {
        const cx = Math.cos(x * 0.5), sx = Math.sin(x * 0.5);
        const cy = Math.cos(y * 0.5), sy = Math.sin(y * 0.5);
        const cz = Math.cos(z * 0.5), sz = Math.sin(z * 0.5);
        return [
            sx * cy * cz + cx * sy * sz,
            cx * sy * cz - sx * cy * sz,
            cx * cy * sz + sx * sy * cz,
            cx * cy * cz - sx * sy * sz,
        ];
    },

    multiply(a, b)
    {
        return [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ];
    },

    conjugate: (q) => [-q[0], -q[1], -q[2], q[3]],

    rotate(q, v)
    {
        const t = V3.scale(V3.cross([q[0], q[1], q[2]], v), 2.0);
        return V3.add(V3.add(v, V3.scale(t, q[3])), V3.cross([q[0], q[1], q[2]], t));
    },

    normalize(q)
    {
        const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1.0;
        return [q[0] / L, q[1] / L, q[2] / L, q[3] / L];
    },

    slerp(a, b, t)
    {
        let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        let B = b;
        if (d < 0.0) { B = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
        if (d > 0.9995)
        {
            return Quat.normalize([
                a[0] + (B[0] - a[0]) * t, a[1] + (B[1] - a[1]) * t,
                a[2] + (B[2] - a[2]) * t, a[3] + (B[3] - a[3]) * t]);
        }
        const θ = Math.acos(d), s = Math.sin(θ);
        const w1 = Math.sin((1 - t) * θ) / s, w2 = Math.sin(t * θ) / s;
        return [a[0] * w1 + B[0] * w2, a[1] * w1 + B[1] * w2, a[2] * w1 + B[2] * w2, a[3] * w1 + B[3] * w2];
    },

    // Rotation carrying unit vector `from` onto unit vector `to`.
    fromUnitVectors(from, to)
    {
        const d = V3.dot(from, to);
        if (d > 0.999999) return [0, 0, 0, 1];
        if (d < -0.999999)
        {
            let axis = V3.cross([1, 0, 0], from);
            if (V3.length(axis) < 1e-6) axis = V3.cross([0, 1, 0], from);
            return Quat.fromAxisAngle(axis, Math.PI);
        }
        const c = V3.cross(from, to);
        return Quat.normalize([c[0], c[1], c[2], 1.0 + d]);
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     MAT4 (COLUMN MAJOR)
//------------------------------------------------------------------------------------------------------------------------

export const M4 = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

    multiply(a, b, out = new Float32Array(16))
    {
        for (let c = 0; c < 4; ++c)
        {
            const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
            out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
            out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
            out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
            out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
        }
        return out;
    },

    compose(translation, rotation, scale = [1, 1, 1], out = new Float32Array(16))
    {
        const [x, y, z, w] = rotation;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;
        out[0] = (1 - (yy + zz)) * scale[0]; out[1] = (xy + wz) * scale[0];       out[2] = (xz - wy) * scale[0];       out[3] = 0;
        out[4] = (xy - wz) * scale[1];       out[5] = (1 - (xx + zz)) * scale[1]; out[6] = (yz + wx) * scale[1];       out[7] = 0;
        out[8] = (xz + wy) * scale[2];       out[9] = (yz - wx) * scale[2];       out[10] = (1 - (xx + yy)) * scale[2]; out[11] = 0;
        out[12] = translation[0];            out[13] = translation[1];            out[14] = translation[2];            out[15] = 1;
        return out;
    },

    invert(m, out = new Float32Array(16))
    {
        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
        const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
        const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
        const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det) return out.set(M4.identity()), out;
        det = 1.0 / det;
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
    },

    transformPoint(m, p)
    {
        return [
            m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        ];
    },

    transformDirection(m, v)
    {
        return [
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
        ];
    },

    perspective(fovY, aspect, near, far, out = new Float32Array(16))
    {
        const f = 1.0 / Math.tan(fovY * 0.5);
        out.fill(0);
        out[0] = f / aspect; out[5] = f; out[11] = -1;
        out[10] = (far + near) / (near - far);
        out[14] = (2 * far * near) / (near - far);
        return out;
    },

    orthographic(l, r, b, t, n, f, out = new Float32Array(16))
    {
        out.fill(0);
        out[0] = 2 / (r - l); out[5] = 2 / (t - b); out[10] = -2 / (f - n);
        out[12] = -(r + l) / (r - l); out[13] = -(t + b) / (t - b); out[14] = -(f + n) / (f - n); out[15] = 1;
        return out;
    },

    lookAt(eye, target, up, out = new Float32Array(16))
    {
        const z = V3.normalize(V3.sub(eye, target));
        let x = V3.cross(up, z);
        if (V3.length(x) < 1e-6) x = V3.cross([1, 0, 0], z);
        x = V3.normalize(x);
        const y = V3.cross(z, x);
        out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
        out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
        out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
        out[12] = -V3.dot(x, eye); out[13] = -V3.dot(y, eye); out[14] = -V3.dot(z, eye); out[15] = 1;
        return out;
    },
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     SCALAR HELPERS
//------------------------------------------------------------------------------------------------------------------------

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
export const fract = (x) => x - Math.floor(x);

// Deterministic value noise so every run of the showcase is identical.
export function Hash1(n)
{
    return fract(Math.sin(n * 127.1) * 43758.5453123);
}

export function Noise1(x)
{
    const i = Math.floor(x), f = fract(x);
    const u = f * f * (3 - 2 * f);
    return lerp(Hash1(i), Hash1(i + 1), u) * 2.0 - 1.0;
}

// Fractal noise used for thermals, feather ruffle and idle micro-motion.
export function Fractal1(x, octaves = 3)
{
    let a = 0.5, s = 0.0, f = 1.0;
    for (let i = 0; i < octaves; ++i) { s += a * Noise1(x * f + i * 13.7); f *= 2.03; a *= 0.5; }
    return s;
}
