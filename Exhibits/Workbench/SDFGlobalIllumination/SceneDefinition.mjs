export const SDF_BOUNDS = {
    minimum: [-9.0, -0.7, -9.0],
    maximum: [9.0, 8.0, 9.0],
};

export const SDF_RESOLUTION = [96, 48, 96];

export const MATERIALS = [
    { name: "Warm plaster", albedo: [0.62, 0.60, 0.54], emissive: 0.0 },
    { name: "Red wall", albedo: [0.68, 0.075, 0.035], emissive: 0.0 },
    { name: "Blue wall", albedo: [0.035, 0.19, 0.66], emissive: 0.0 },
    { name: "Gold block", albedo: [0.82, 0.42, 0.055], emissive: 0.0 },
    { name: "Teal block", albedo: [0.025, 0.48, 0.38], emissive: 0.0 },
    { name: "Orange sphere", albedo: [0.92, 0.15, 0.035], emissive: 0.0 },
    { name: "Blue sphere", albedo: [0.045, 0.32, 0.88], emissive: 0.0 },
    { name: "Neutral pillar", albedo: [0.43, 0.47, 0.45], emissive: 0.0 },
    { name: "Cyan emitter", albedo: [0.25, 0.92, 1.0], emissive: 1.0 },
];

export const PRIMITIVES = [
    { type: "box", center: [0.0, -0.35, 0.0], half: [9.0, 0.35, 9.0], material: 0 },
    { type: "box", center: [0.0, 3.65, -8.7], half: [9.0, 4.35, 0.3], material: 0 },
    { type: "box", center: [-8.7, 3.65, 0.0], half: [0.3, 4.35, 9.0], material: 1 },
    { type: "box", center: [8.7, 3.65, 0.0], half: [0.3, 4.35, 9.0], material: 2 },
    { type: "box", center: [-3.25, 1.15, -2.6], half: [1.15, 1.15, 1.1], material: 3 },
    { type: "box", center: [3.25, 1.75, -3.2], half: [1.35, 1.75, 1.0], material: 4 },
    { type: "box", center: [0.0, 0.35, 2.75], half: [2.75, 0.35, 1.65], material: 0 },
    { type: "sphere", center: [-2.0, 1.85, 2.5], radius: 1.18, material: 5 },
    { type: "sphere", center: [2.15, 1.68, 2.15], radius: 0.98, material: 6 },
    { type: "box", center: [-6.0, 2.0, 4.3], half: [0.75, 2.0, 0.75], material: 7 },
    { type: "box", center: [6.05, 1.5, 3.9], half: [0.85, 1.5, 0.85], material: 7 },
    { type: "box", center: [0.0, 5.25, -8.28], half: [2.05, 0.72, 0.16], material: 8 },
];

export function signedDistanceToPrimitive(point, primitive)
{
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

export function sampleSceneDistance(point)
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
