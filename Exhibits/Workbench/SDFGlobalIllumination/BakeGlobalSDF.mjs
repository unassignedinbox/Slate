import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    MATERIALS,
    PRIMITIVES,
    SDF_BOUNDS,
    SDF_RESOLUTION,
    sampleAnalyticSceneDistance,
} from "./SceneDefinition.mjs";
import {
    floatToHalf,
    readShaderBallSdf,
    sampleMeshSdf,
} from "./ShaderBallSDFBake.mjs";

const MAGIC = 0x31464453; // SDF1
const VERSION = 2;
const HEADER_BYTES = 64;
const directory = dirname(fileURLToPath(import.meta.url));
const meshField = await readShaderBallSdf(join(directory, "ShaderBallSDF.bin"));
const shaderBalls = PRIMITIVES
    .map((primitive, primitiveIndex) => ({ primitive, primitiveIndex }))
    .filter(({ primitive }) => primitive.type === "shaderBall");

function voxelPosition(x, y, z, dimensions)
{
    return [
        SDF_BOUNDS.minimum[0] + (x + 0.5) / dimensions[0] * (SDF_BOUNDS.maximum[0] - SDF_BOUNDS.minimum[0]),
        SDF_BOUNDS.minimum[1] + (y + 0.5) / dimensions[1] * (SDF_BOUNDS.maximum[1] - SDF_BOUNDS.minimum[1]),
        SDF_BOUNDS.minimum[2] + (z + 0.5) / dimensions[2] * (SDF_BOUNDS.maximum[2] - SDF_BOUNDS.minimum[2]),
    ];
}

function shaderBallDistance(point, primitive)
{
    const dx = point[0] - primitive.position[0];
    const dy = point[1] - primitive.position[1];
    const dz = point[2] - primitive.position[2];
    const cosine = Math.cos(primitive.rotationY);
    const sine = Math.sin(primitive.rotationY);
    const local = [
        (cosine * dx - sine * dz) / primitive.scale,
        dy / primitive.scale,
        (sine * dx + cosine * dz) / primitive.scale,
    ];
    return sampleMeshSdf(meshField, local) * primitive.scale;
}

function sampleComposedScene(point)
{
    let result = sampleAnalyticSceneDistance(point);
    for (const { primitive, primitiveIndex } of shaderBalls)
    {
        const distance = shaderBallDistance(point, primitive);
        if (distance < result.distance) result = { distance, primitiveIndex };
    }
    return result;
}

function bakeDistanceLevel(dimensions)
{
    const count = dimensions[0] * dimensions[1] * dimensions[2];
    const values = new Uint16Array(count);
    let address = 0;
    for (let z = 0; z < dimensions[2]; ++z)
    {
        for (let y = 0; y < dimensions[1]; ++y)
        {
            for (let x = 0; x < dimensions[0]; ++x)
            {
                const { distance } = sampleComposedScene(voxelPosition(x, y, z, dimensions));
                values[address++] = floatToHalf(Math.max(-32.0, Math.min(32.0, distance)));
            }
        }
    }
    return new Uint8Array(values.buffer);
}

function bakeMaterialVolume()
{
    const dimensions = SDF_RESOLUTION;
    const count = dimensions[0] * dimensions[1] * dimensions[2];
    const values = new Uint8Array(count * 4);
    let address = 0;
    for (let z = 0; z < dimensions[2]; ++z)
    {
        for (let y = 0; y < dimensions[1]; ++y)
        {
            for (let x = 0; x < dimensions[0]; ++x)
            {
                const { primitiveIndex } = sampleComposedScene(voxelPosition(x, y, z, dimensions));
                const material = MATERIALS[PRIMITIVES[primitiveIndex].material];
                values[address++] = Math.round(Math.max(0, Math.min(1, material.albedo[0])) * 255);
                values[address++] = Math.round(Math.max(0, Math.min(1, material.albedo[1])) * 255);
                values[address++] = Math.round(Math.max(0, Math.min(1, material.albedo[2])) * 255);
                values[address++] = Math.round(Math.max(0, Math.min(1, material.emissive)) * 255);
            }
        }
    }
    return values;
}

const levels = [];
let dimensions = [...SDF_RESOLUTION];
while (true)
{
    process.stdout.write(`Baking composed ${dimensions.join("x")} global distance level...\n`);
    levels.push({ dimensions: [...dimensions], bytes: bakeDistanceLevel(dimensions) });
    if (dimensions.every((value) => value === 1)) break;
    dimensions = dimensions.map((value) => Math.max(1, Math.floor(value / 2)));
}

process.stdout.write(`Baking composed ${SDF_RESOLUTION.join("x")} material volume...\n`);
const materialBytes = bakeMaterialVolume();
let materialOffset = HEADER_BYTES;
for (const level of levels) materialOffset += 16 + level.bytes.byteLength;
const totalBytes = materialOffset + materialBytes.byteLength;
const output = new Uint8Array(totalBytes);
const view = new DataView(output.buffer);
view.setUint32(0, MAGIC, true);
view.setUint32(4, VERSION, true);
view.setUint32(8, SDF_RESOLUTION[0], true);
view.setUint32(12, SDF_RESOLUTION[1], true);
view.setUint32(16, SDF_RESOLUTION[2], true);
view.setUint32(20, levels.length, true);
for (let axis = 0; axis < 3; ++axis) view.setFloat32(24 + axis * 4, SDF_BOUNDS.minimum[axis], true);
for (let axis = 0; axis < 3; ++axis) view.setFloat32(36 + axis * 4, SDF_BOUNDS.maximum[axis], true);
view.setUint32(48, materialOffset, true);
view.setUint32(52, totalBytes, true);
view.setUint32(56, PRIMITIVES.length, true);
view.setUint32(60, MATERIALS.length, true);

let offset = HEADER_BYTES;
for (const level of levels)
{
    view.setUint32(offset, level.dimensions[0], true);
    view.setUint32(offset + 4, level.dimensions[1], true);
    view.setUint32(offset + 8, level.dimensions[2], true);
    view.setUint32(offset + 12, level.bytes.byteLength, true);
    offset += 16;
    output.set(level.bytes, offset);
    offset += level.bytes.byteLength;
}
output.set(materialBytes, materialOffset);

const binaryPath = join(directory, "GlobalSDF.bin");
await writeFile(binaryPath, output);
const sha256 = createHash("sha256").update(output).digest("hex");
const metadata = {
    format: "SDF1",
    version: VERSION,
    bounds: SDF_BOUNDS,
    baseResolution: SDF_RESOLUTION,
    mipResolutions: levels.map((level) => level.dimensions),
    distanceEncoding: "IEEE-754 binary16 world-space signed distance",
    materialEncoding: "RGBA8: linear albedo RGB + emissive mask A",
    composition: "analytic architecture union four transformed canonical ShaderBall mesh SDFs",
    meshSdf: "ShaderBallSDF.bin",
    shaderBallInstances: shaderBalls.length,
    primitives: PRIMITIVES.length,
    materials: MATERIALS.length,
    byteLength: totalBytes,
    sha256,
};
await writeFile(join(directory, "GlobalSDF.meta.json"), `${JSON.stringify(metadata, null, 2)}\n`);
process.stdout.write(`Wrote ${binaryPath} (${totalBytes.toLocaleString()} bytes)\nSHA-256 ${sha256}\n`);
