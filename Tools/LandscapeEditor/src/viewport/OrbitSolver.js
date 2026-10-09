//============================================================================================================================================
//                                                               ORBITSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/viewport/OrbitSolver.js — Orbit camera solver: yaw, pitch and distance pose with drag and zoom
//    updates, and perspective and look-at matrices for a Z-up world.

//------------------------------------------------------------------------------------------------------------------------
//                                                          POSE
//------------------------------------------------------------------------------------------------------------------------
export function createOrbitPose()
{
    return { yaw: 0.9, pitch: 0.6, distance: 4.1, target: [0, 0, 0.08] };
}

function clampRange(x, low, high)
{
    return Math.min(high, Math.max(low, x));
}

export function rotateOrbitPose(pose, deltaX, deltaY)
{
    pose.yaw -= deltaX * 0.006;
    pose.pitch = clampRange(pose.pitch + deltaY * 0.005, 0.06, 1.52);
}

export function zoomOrbitPose(pose, deltaY)
{
    pose.distance = clampRange(pose.distance * Math.exp(deltaY * 0.0012), 0.9, 9);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        MATRICES
//------------------------------------------------------------------------------------------------------------------------
// Column-major 4x4 matrices, as WebGL expects.
function crossProduct(a, b)
{
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dotProduct(a, b)
{
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalizeVector(v)
{
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
}

function lookAtMatrix(eye, target, up)
{
    const forward = normalizeVector([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    const side = normalizeVector(crossProduct(forward, up));
    const upward = crossProduct(side, forward);
    return new Float32Array([
        side[0], upward[0], -forward[0], 0,
        side[1], upward[1], -forward[1], 0,
        side[2], upward[2], -forward[2], 0,
        -dotProduct(side, eye), -dotProduct(upward, eye), dotProduct(forward, eye), 1
    ]);
}

function perspectiveMatrix(fovY, aspect, near, far)
{
    const focal = 1 / Math.tan(fovY / 2);
    const rangeInverse = 1 / (near - far);
    return new Float32Array([
        focal / aspect, 0, 0, 0,
        0, focal, 0, 0,
        0, 0, (far + near) * rangeInverse, -1,
        0, 0, 2 * far * near * rangeInverse, 0
    ]);
}

function multiplyMatrix(a, b)
{
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++)
    {
        for (let row = 0; row < 4; row++)
        {
            let sum = 0;
            for (let k = 0; k < 4; k++)
            {
                sum += a[k * 4 + row] * b[column * 4 + k];
            }
            out[column * 4 + row] = sum;
        }
    }
    return out;
}

export function orbitViewProjection(pose, aspect)
{
    const cosPitch = Math.cos(pose.pitch);
    const eye = [
        pose.target[0] + pose.distance * cosPitch * Math.cos(pose.yaw),
        pose.target[1] + pose.distance * cosPitch * Math.sin(pose.yaw),
        pose.target[2] + pose.distance * Math.sin(pose.pitch)
    ];
    return multiplyMatrix(perspectiveMatrix(0.78, aspect, 0.02, 40), lookAtMatrix(eye, pose.target, [0, 0, 1]));
}
