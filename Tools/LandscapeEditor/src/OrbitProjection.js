// OrbitProjection: column-major 4x4 matrix helpers and an orbit camera around a target point. Matrices are Float32Array
// of 16 values, as WebGL expects.

export function Perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
}

export function LookAt(eye, target, up) {
    let zx = eye[0] - target[0];
    let zy = eye[1] - target[1];
    let zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len;
    zy /= len;
    zz /= len;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len;
    xy /= len;
    xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const out = new Float32Array(16);
    out[0] = xx;
    out[1] = yx;
    out[2] = zx;
    out[4] = xy;
    out[5] = yy;
    out[6] = zy;
    out[8] = xz;
    out[9] = yz;
    out[10] = zz;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
}

export function Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    }
    return out;
}

export function CreateOrbit() {
    return { yaw: 0.7, pitch: 0.75, distance: 2.6, target: [0, 0, 0] };
}

export function OrbitEye(orbit) {
    const cp = Math.cos(orbit.pitch);
    return [
        orbit.target[0] + orbit.distance * cp * Math.sin(orbit.yaw),
        orbit.target[1] + orbit.distance * Math.sin(orbit.pitch),
        orbit.target[2] + orbit.distance * cp * Math.cos(orbit.yaw),
    ];
}

export function OrbitMatrices(orbit, aspect) {
    const view = LookAt(OrbitEye(orbit), orbit.target, [0, 1, 0]);
    const projection = Perspective(0.8, aspect, 0.01, 50);
    return { view, projection, viewProjection: Multiply(projection, view) };
}

// Applies a pointer drag (pixels) or a wheel step to the orbit state, clamping pitch and distance.
export function DragOrbit(orbit, dx, dy) {
    orbit.yaw -= dx * 0.008;
    orbit.pitch = Math.min(1.5, Math.max(0.08, orbit.pitch + dy * 0.008));
    return orbit;
}

export function ZoomOrbit(orbit, delta) {
    orbit.distance = Math.min(8, Math.max(0.8, orbit.distance * Math.exp(delta * 0.001)));
    return orbit;
}
