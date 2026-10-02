export const SDF_BOUNDS = {
    minimum: [-9.0, -0.7, -9.0],
    maximum: [9.0, 8.0, 9.0],
};

// Roughly 11 cm base voxels retain the canonical mesh-SDF silhouette while
// staying compact enough for a GTX 1650 Super-class global field.
export const SDF_RESOLUTION = [160, 80, 160];

export const MATERIALS = [
    { name: "Warm plaster", albedo: [0.62, 0.60, 0.54], emissive: 0.0 },
    { name: "Red wall", albedo: [0.68, 0.075, 0.035], emissive: 0.0 },
    { name: "Blue wall", albedo: [0.035, 0.19, 0.66], emissive: 0.0 },
    { name: "Gold ShaderBall", albedo: [0.82, 0.42, 0.055], emissive: 0.0 },
    { name: "Green ShaderBall", albedo: [0.025, 0.48, 0.30], emissive: 0.0 },
    { name: "Orange ShaderBall", albedo: [0.92, 0.15, 0.035], emissive: 0.0 },
    { name: "Blue ShaderBall", albedo: [0.045, 0.32, 0.88], emissive: 0.0 },
    { name: "Neutral pillar", albedo: [0.43, 0.47, 0.45], emissive: 0.0 },
    { name: "Cyan emitter", albedo: [0.25, 0.92, 1.0], emissive: 1.0 },
];

export const PRIMITIVES = [
    { type: "box", center: [0.0, -0.35, 0.0], half: [9.0, 0.35, 9.0], material: 0 },
    { type: "box", center: [0.0, 3.65, -8.7], half: [9.0, 4.35, 0.3], material: 0 },
    { type: "box", center: [-8.7, 3.65, 0.0], half: [0.3, 4.35, 9.0], material: 1 },
    { type: "box", center: [8.7, 3.65, 0.0], half: [0.3, 4.35, 9.0], material: 2 },
    { type: "box", center: [0.0, 0.3, 2.25], half: [7.15, 0.3, 2.35], material: 0 },
    { type: "box", center: [-6.8, 1.55, -3.7], half: [0.85, 1.55, 0.85], material: 7 },
    { type: "box", center: [6.75, 2.05, -3.2], half: [0.9, 2.05, 0.9], material: 7 },
    { type: "box", center: [0.0, 5.25, -8.28], half: [2.05, 0.72, 0.16], material: 8 },

    // The same canonical 67,832-triangle Slate ShaderBall is transformed four
    // times. The bake composes its 96³ JFA mesh SDF into the global field.
    { type: "shaderBall", position: [-4.65, 0.61, 2.15], scale: 1.95, rotationY: -0.38, material: 5 },
    { type: "shaderBall", position: [-1.55, 0.61, 2.15], scale: 1.90, rotationY: 0.22, material: 3 },
    { type: "shaderBall", position: [1.55, 0.61, 2.15], scale: 2.02, rotationY: -0.14, material: 6 },
    { type: "shaderBall", position: [4.70, 0.61, 2.15], scale: 1.92, rotationY: 0.34, material: 4 },
];

export function signedDistanceToPrimitive(point, primitive)
{
    if (primitive.type === "shaderBall") return Infinity;
    if (primitive.type === "sphere")
    {
        return Math.hypot(
            point[0] - primitive.center[0],
            point[1] - primitive.center[1],
            point[2] - primitive.center[2],
        ) - primitive.radius;
    }

    const qx = Math.abs(point[0] - primitive.center[0]) - primitive.half[0];
    const qy = Math.abs(point[1] - primitive.center[1]) - primitive.half[1];
    const qz = Math.abs(point[2] - primitive.center[2]) - primitive.half[2];
    const outside = Math.hypot(Math.max(qx, 0.0), Math.max(qy, 0.0), Math.max(qz, 0.0));
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0.0);
    return outside + inside;
}

export function sampleAnalyticSceneDistance(point)
{
    let distance = Infinity;
    let primitiveIndex = 0;
    for (let index = 0; index < PRIMITIVES.length; ++index)
    {
        const candidate = signedDistanceToPrimitive(point, PRIMITIVES[index]);
        if (candidate < distance)
        {
            distance = candidate;
            primitiveIndex = index;
        }
    }
    return { distance, primitiveIndex };
}
