import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export const MESH_SDF_MAGIC = 0x3144534d; // MSD1
export const MESH_SDF_RESOLUTION = [96, 96, 96];
export const MESH_SDF_BOUNDS = {
    minimum: [-0.64, -0.07, -0.64],
    maximum: [0.64, 1.21, 0.64],
};

export function floatToHalf(value)
{
    const scalar = new Float32Array(1);
    const bits = new Uint32Array(scalar.buffer);
    scalar[0] = value;
    const source = bits[0];
    const sign = (source >>> 16) & 0x8000;
    let exponent = ((source >>> 23) & 0xff) - 127 + 15;
    let mantissa = source & 0x7fffff;
    if (exponent <= 0)
    {
        if (exponent < -10) return sign;
        mantissa = (mantissa | 0x800000) >>> (1 - exponent);
        return sign | ((mantissa + 0x1000) >>> 13);
    }
    if (exponent >= 31) return sign | 0x7bff;
    if (mantissa & 0x1000)
    {
        mantissa += 0x2000;
        if (mantissa & 0x800000)
        {
            mantissa = 0;
            exponent += 1;
            if (exponent >= 31) return sign | 0x7bff;
        }
    }
    return sign | (exponent << 10) | (mantissa >>> 13);
}

export function halfToFloat(value)
{
    const sign = (value & 0x8000) << 16;
    let exponent = (value >>> 10) & 0x1f;
    let mantissa = value & 0x3ff;
    let bits;
    if (exponent === 0)
    {
        if (mantissa === 0) bits = sign;
        else
        {
            exponent = 1;
            while ((mantissa & 0x400) === 0)
            {
                mantissa <<= 1;
                exponent -= 1;
            }
            mantissa &= 0x3ff;
            bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
        }
    }
    else if (exponent === 31) bits = sign | 0x7f800000 | (mantissa << 13);
    else bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
    const integer = new Uint32Array([bits >>> 0]);
    return new Float32Array(integer.buffer)[0];
}

function decodeShaderBall(content)
{
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    if (view.byteLength < 16 || view.getUint32(0, true) !== 0x314d4253)
        throw new Error("ShaderBall.mesh is not an SBM1 stream");
    const vertexCount = view.getUint32(4, true);
    const indexCount = view.getUint32(8, true);
    if (view.byteLength !== 16 + vertexCount * 32 + indexCount * 4 || indexCount % 3 !== 0)
        throw new Error("ShaderBall.mesh has an inconsistent byte count");
    const source = new Float32Array(content.buffer, content.byteOffset + 16, vertexCount * 8);
    const positions = new Float32Array(vertexCount * 3);
    for (let index = 0; index < vertexCount; ++index)
    {
        // Convert the shared asset from Z-up to this demo's Y-up coordinates.
        positions[index * 3] = source[index * 8];
        positions[index * 3 + 1] = source[index * 8 + 2];
        positions[index * 3 + 2] = -source[index * 8 + 1];
    }
    const indexOffset = content.byteOffset + 16 + vertexCount * 32;
    const indices = new Uint32Array(content.buffer.slice(indexOffset, indexOffset + indexCount * 4));
    return { positions, indices, triangleCount: indexCount / 3 };
}

function closestPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, output)
{
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else
    {
        const bpx = px - bx, bpy = py - by, bpz = pz - bz;
        const d3 = abx * bpx + aby * bpy + abz * bpz;
        const d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
        else
        {
            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0)
            {
                const v = d1 / (d1 - d3);
                qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
            }
            else
            {
                const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
                const d5 = abx * cpx + aby * cpy + abz * cpz;
                const d6 = acx * cpx + acy * cpy + acz * cpz;
                if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
                else
                {
                    const vb = d5 * d2 - d1 * d6;
                    if (vb <= 0 && d2 >= 0 && d6 <= 0)
                    {
                        const w = d2 / (d2 - d6);
                        qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
                    }
                    else
                    {
                        const va = d3 * d6 - d5 * d4;
                        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
                        {
                            const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                            qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
                        }
                        else
                        {
                            const inverse = 1 / (va + vb + vc);
                            const v = vb * inverse;
                            const w = vc * inverse;
                            qx = ax + abx * v + acx * w;
                            qy = ay + aby * v + acy * w;
                            qz = az + abz * v + acz * w;
                        }
                    }
                }
            }
        }
    }
    output[0] = qx; output[1] = qy; output[2] = qz;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
}

export async function bakeShaderBallSdf(meshPath)
{
    const meshBytes = new Uint8Array(await readFile(meshPath));
    const mesh = decodeShaderBall(meshBytes);
    const [nx, ny, nz] = MESH_SDF_RESOLUTION;
    const count = nx * ny * nz;
    const minimum = MESH_SDF_BOUNDS.minimum;
    const maximum = MESH_SDF_BOUNDS.maximum;
    const spacing = maximum.map((value, axis) => (value - minimum[axis]) / MESH_SDF_RESOLUTION[axis]);
    const maximumSpacing = Math.max(...spacing);
    const surfaceThresholdSquared = (maximumSpacing * 1.35) ** 2;

    let seedX = new Float32Array(count); seedX.fill(Number.NaN);
    let seedY = new Float32Array(count); seedY.fill(Number.NaN);
    let seedZ = new Float32Array(count); seedZ.fill(Number.NaN);
    let seedTriangle = new Int32Array(count); seedTriangle.fill(-1);
    const seedDistance = new Float32Array(count); seedDistance.fill(Infinity);
    const surface = new Uint8Array(count);
    const closest = new Float64Array(3);
    const p = mesh.positions;
    const indices = mesh.indices;
    let seedCount = 0;

    process.stdout.write(`Voxelising ${mesh.triangleCount.toLocaleString()} ShaderBall triangles into ${nx}³ sub-voxel seeds...\n`);
    for (let triangle = 0; triangle < mesh.triangleCount; ++triangle)
    {
        const ia = indices[triangle * 3] * 3;
        const ib = indices[triangle * 3 + 1] * 3;
        const ic = indices[triangle * 3 + 2] * 3;
        const ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
        const bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
        const cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minimum[0]) / spacing[0] - 1.5));
        const y0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minimum[1]) / spacing[1] - 1.5));
        const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minimum[2]) / spacing[2] - 1.5));
        const x1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - minimum[0]) / spacing[0] + 0.5));
        const y1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - minimum[1]) / spacing[1] + 0.5));
        const z1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - minimum[2]) / spacing[2] + 0.5));
        for (let z = z0; z <= z1; ++z)
        {
            const pz = minimum[2] + (z + 0.5) * spacing[2];
            for (let y = y0; y <= y1; ++y)
            {
                const py = minimum[1] + (y + 0.5) * spacing[1];
                let address = (z * ny + y) * nx + x0;
                for (let x = x0; x <= x1; ++x, ++address)
                {
                    const px = minimum[0] + (x + 0.5) * spacing[0];
                    const distanceSquared = closestPointTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, closest);
                    if (distanceSquared <= surfaceThresholdSquared && distanceSquared < seedDistance[address])
                    {
                        if (seedTriangle[address] < 0) seedCount += 1;
                        seedDistance[address] = distanceSquared;
                        seedX[address] = closest[0]; seedY[address] = closest[1]; seedZ[address] = closest[2];
                        seedTriangle[address] = triangle;
                        surface[address] = 1;
                    }
                }
            }
        }
    }
    if (seedCount === 0) throw new Error("ShaderBall voxelisation produced no seeds");
    process.stdout.write(`Seeded ${seedCount.toLocaleString()} surface voxels; propagating closest points with 3D JFA...\n`);

    let destinationX = new Float32Array(count);
    let destinationY = new Float32Array(count);
    let destinationZ = new Float32Array(count);
    let destinationTriangle = new Int32Array(count);
    const passes = [64, 32, 16, 8, 4, 2, 1, 1]; // JFA + one step-one correction pass.
    for (const step of passes)
    {
        for (let z = 0; z < nz; ++z)
        {
            const pz = minimum[2] + (z + 0.5) * spacing[2];
            for (let y = 0; y < ny; ++y)
            {
                const py = minimum[1] + (y + 0.5) * spacing[1];
                for (let x = 0; x < nx; ++x)
                {
                    const address = (z * ny + y) * nx + x;
                    const px = minimum[0] + (x + 0.5) * spacing[0];
                    let bestTriangle = seedTriangle[address];
                    let bestX = seedX[address], bestY = seedY[address], bestZ = seedZ[address];
                    let bestDistance = bestTriangle >= 0
                        ? (px - bestX) ** 2 + (py - bestY) ** 2 + (pz - bestZ) ** 2
                        : Infinity;
                    for (let oz = -step; oz <= step; oz += step)
                    {
                        const nzp = z + oz;
                        if (nzp < 0 || nzp >= nz) continue;
                        for (let oy = -step; oy <= step; oy += step)
                        {
                            const nyp = y + oy;
                            if (nyp < 0 || nyp >= ny) continue;
                            for (let ox = -step; ox <= step; ox += step)
                            {
                                if (ox === 0 && oy === 0 && oz === 0) continue;
                                const nxp = x + ox;
                                if (nxp < 0 || nxp >= nx) continue;
                                const neighbour = (nzp * ny + nyp) * nx + nxp;
                                const candidateTriangle = seedTriangle[neighbour];
                                if (candidateTriangle < 0) continue;
                                const candidateX = seedX[neighbour];
                                const candidateY = seedY[neighbour];
                                const candidateZ = seedZ[neighbour];
                                const candidateDistance = (px - candidateX) ** 2
                                    + (py - candidateY) ** 2 + (pz - candidateZ) ** 2;
                                if (candidateDistance < bestDistance)
                                {
                                    bestDistance = candidateDistance;
                                    bestTriangle = candidateTriangle;
                                    bestX = candidateX; bestY = candidateY; bestZ = candidateZ;
                                }
                            }
                        }
                    }
                    destinationTriangle[address] = bestTriangle;
                    destinationX[address] = bestX; destinationY[address] = bestY; destinationZ[address] = bestZ;
                }
            }
        }
        [seedX, destinationX] = [destinationX, seedX];
        [seedY, destinationY] = [destinationY, seedY];
        [seedZ, destinationZ] = [destinationZ, seedZ];
        [seedTriangle, destinationTriangle] = [destinationTriangle, seedTriangle];
        process.stdout.write(`  JFA step ${step}\n`);
    }

    // The conservative surface shell becomes a barrier. Flooding from the
    // volume boundary provides a topology-aware sign even for disconnected
    // closed parts of the ShaderBall.
    process.stdout.write("Flood-filling the exterior for a stable signed field...\n");
    const exterior = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0, tail = 0;
    const enqueue = (address) =>
    {
        if (surface[address] || exterior[address]) return;
        exterior[address] = 1;
        queue[tail++] = address;
    };
    for (let z = 0; z < nz; ++z) for (let y = 0; y < ny; ++y)
    {
        enqueue((z * ny + y) * nx);
        enqueue((z * ny + y) * nx + nx - 1);
    }
    for (let z = 0; z < nz; ++z) for (let x = 0; x < nx; ++x)
    {
        enqueue(z * ny * nx + x);
        enqueue((z * ny + ny - 1) * nx + x);
    }
    for (let y = 0; y < ny; ++y) for (let x = 0; x < nx; ++x)
    {
        enqueue(y * nx + x);
        enqueue(((nz - 1) * ny + y) * nx + x);
    }
    const plane = nx * ny;
    while (head < tail)
    {
        const address = queue[head++];
        const x = address % nx;
        const y = Math.floor(address / nx) % ny;
        const z = Math.floor(address / plane);
        if (x > 0) enqueue(address - 1);
        if (x + 1 < nx) enqueue(address + 1);
        if (y > 0) enqueue(address - nx);
        if (y + 1 < ny) enqueue(address + nx);
        if (z > 0) enqueue(address - plane);
        if (z + 1 < nz) enqueue(address + plane);
    }

    process.stdout.write("Applying exact triangle closest-point refinement to propagated JFA candidates...\n");
    const distances = new Float32Array(count);
    const candidateOffsets = [0, -1, 1, -nx, nx, -plane, plane];
    let interiorCount = 0;
    for (let z = 0; z < nz; ++z)
    {
        const pz = minimum[2] + (z + 0.5) * spacing[2];
        for (let y = 0; y < ny; ++y)
        {
            const py = minimum[1] + (y + 0.5) * spacing[1];
            for (let x = 0; x < nx; ++x)
            {
                const address = (z * ny + y) * nx + x;
                const px = minimum[0] + (x + 0.5) * spacing[0];
                let bestDistance = Infinity;
                let bestTriangle = seedTriangle[address];
                let bestClosestX = seedX[address], bestClosestY = seedY[address], bestClosestZ = seedZ[address];
                for (const offset of candidateOffsets)
                {
                    const candidateAddress = address + offset;
                    if (candidateAddress < 0 || candidateAddress >= count) continue;
                    if (offset === -1 && x === 0 || offset === 1 && x + 1 === nx) continue;
                    if (offset === -nx && y === 0 || offset === nx && y + 1 === ny) continue;
                    if (offset === -plane && z === 0 || offset === plane && z + 1 === nz) continue;
                    const triangle = seedTriangle[candidateAddress];
                    if (triangle < 0) continue;
                    const ia = indices[triangle * 3] * 3;
                    const ib = indices[triangle * 3 + 1] * 3;
                    const ic = indices[triangle * 3 + 2] * 3;
                    const distanceSquared = closestPointTriangle(
                        px, py, pz,
                        p[ia], p[ia + 1], p[ia + 2],
                        p[ib], p[ib + 1], p[ib + 2],
                        p[ic], p[ic + 1], p[ic + 2],
                        closest,
                    );
                    if (distanceSquared < bestDistance)
                    {
                        bestDistance = distanceSquared;
                        bestTriangle = triangle;
                        bestClosestX = closest[0]; bestClosestY = closest[1]; bestClosestZ = closest[2];
                    }
                }
                let inside = exterior[address] === 0 && surface[address] === 0;
                if (surface[address] && bestTriangle >= 0)
                {
                    const ia = indices[bestTriangle * 3] * 3;
                    const ib = indices[bestTriangle * 3 + 1] * 3;
                    const ic = indices[bestTriangle * 3 + 2] * 3;
                    const abx = p[ib] - p[ia], aby = p[ib + 1] - p[ia + 1], abz = p[ib + 2] - p[ia + 2];
                    const acx = p[ic] - p[ia], acy = p[ic + 1] - p[ia + 1], acz = p[ic + 2] - p[ia + 2];
                    const nxg = aby * acz - abz * acy;
                    const nyg = abz * acx - abx * acz;
                    const nzg = abx * acy - aby * acx;
                    inside = (px - bestClosestX) * nxg + (py - bestClosestY) * nyg + (pz - bestClosestZ) * nzg < 0;
                }
                if (inside) interiorCount += 1;
                distances[address] = Math.sqrt(bestDistance) * (inside ? -1 : 1);
            }
        }
    }
    return { distances, seedCount, interiorCount, triangleCount: mesh.triangleCount };
}

export async function writeShaderBallSdf(path, metadataPath, bake)
{
    const [nx, ny, nz] = MESH_SDF_RESOLUTION;
    const headerBytes = 64;
    const output = new Uint8Array(headerBytes + bake.distances.length * 2);
    const view = new DataView(output.buffer);
    view.setUint32(0, MESH_SDF_MAGIC, true);
    view.setUint32(4, 1, true);
    view.setUint32(8, nx, true); view.setUint32(12, ny, true); view.setUint32(16, nz, true);
    for (let axis = 0; axis < 3; ++axis) view.setFloat32(20 + axis * 4, MESH_SDF_BOUNDS.minimum[axis], true);
    for (let axis = 0; axis < 3; ++axis) view.setFloat32(32 + axis * 4, MESH_SDF_BOUNDS.maximum[axis], true);
    view.setUint32(44, headerBytes, true);
    view.setUint32(48, bake.triangleCount, true);
    view.setUint32(52, bake.seedCount, true);
    view.setUint32(56, bake.interiorCount, true);
    const half = new Uint16Array(output.buffer, headerBytes, bake.distances.length);
    for (let index = 0; index < half.length; ++index) half[index] = floatToHalf(bake.distances[index]);
    await writeFile(path, output);
    const sha256 = createHash("sha256").update(output).digest("hex");
    await writeFile(metadataPath, `${JSON.stringify({
        format: "MSD1",
        version: 1,
        source: "../../Assets/ShaderBall/ShaderBall.mesh",
        sourceTriangles: bake.triangleCount,
        resolution: MESH_SDF_RESOLUTION,
        bounds: MESH_SDF_BOUNDS,
        method: "conservative sub-voxel triangle seeds + 3D JFA/JFA+1 + exterior flood sign + exact triangle candidate refinement",
        seedVoxels: bake.seedCount,
        interiorVoxels: bake.interiorCount,
        byteLength: output.byteLength,
        sha256,
    }, null, 2)}\n`);
    return { output, sha256 };
}

export async function readShaderBallSdf(path)
{
    const bytes = new Uint8Array(await readFile(path));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MESH_SDF_MAGIC || view.getUint32(4, true) !== 1)
        throw new Error("ShaderBallSDF.bin is not an MSD1 stream");
    const dimensions = [view.getUint32(8, true), view.getUint32(12, true), view.getUint32(16, true)];
    const minimum = [view.getFloat32(20, true), view.getFloat32(24, true), view.getFloat32(28, true)];
    const maximum = [view.getFloat32(32, true), view.getFloat32(36, true), view.getFloat32(40, true)];
    const offset = view.getUint32(44, true);
    const half = new Uint16Array(bytes.buffer, bytes.byteOffset + offset, dimensions[0] * dimensions[1] * dimensions[2]);
    const distances = new Float32Array(half.length);
    for (let index = 0; index < half.length; ++index) distances[index] = halfToFloat(half[index]);
    return { dimensions, minimum, maximum, distances };
}

export function sampleMeshSdf(field, point)
{
    const dimensions = field.dimensions;
    const clamped = point.map((value, axis) => Math.max(field.minimum[axis], Math.min(field.maximum[axis], value)));
    const outsideDistance = Math.hypot(point[0] - clamped[0], point[1] - clamped[1], point[2] - clamped[2]);
    const coordinate = clamped.map((value, axis) =>
        (value - field.minimum[axis]) / (field.maximum[axis] - field.minimum[axis]) * dimensions[axis] - 0.5);
    const base = coordinate.map((value, axis) => Math.max(0, Math.min(dimensions[axis] - 1, Math.floor(value))));
    const next = base.map((value, axis) => Math.min(dimensions[axis] - 1, value + 1));
    const fraction = coordinate.map((value, axis) => Math.max(0, Math.min(1, value - base[axis])));
    const at = (x, y, z) => field.distances[(z * dimensions[1] + y) * dimensions[0] + x];
    const x00 = at(base[0], base[1], base[2]) * (1 - fraction[0]) + at(next[0], base[1], base[2]) * fraction[0];
    const x10 = at(base[0], next[1], base[2]) * (1 - fraction[0]) + at(next[0], next[1], base[2]) * fraction[0];
    const x01 = at(base[0], base[1], next[2]) * (1 - fraction[0]) + at(next[0], base[1], next[2]) * fraction[0];
    const x11 = at(base[0], next[1], next[2]) * (1 - fraction[0]) + at(next[0], next[1], next[2]) * fraction[0];
    const y0 = x00 * (1 - fraction[1]) + x10 * fraction[1];
    const y1 = x01 * (1 - fraction[1]) + x11 * fraction[1];
    return y0 * (1 - fraction[2]) + y1 * fraction[2] + outsideDistance;
}
