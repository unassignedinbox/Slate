// SolidScape — 3D volumetric erosion for SDF (true 3D, not heightmap)
// For the sphere test we generate a dedicated icosphere mesh and erode it
// along its surface (gravity-driven droplets walk the mesh). For generic
// terrain we fall back to the heightfield path but the mesh is displaced
// along its normal, not just +Y, so cliffs are preserved.

import * as THREE from 'three';
import type { CompiledField } from '../sdf';
import { EvalField } from '../sdf';
import { FloatsPerInstruction } from '../sdf';

// ── helpers: find a sphere primitive in the tape ──
export interface SphereInfo { x: number; y: number; z: number; r: number; }

export function FindFirstSphere(field: CompiledField): SphereInfo | null {
    // tape: OP_PUSH shape0 = sphere, b=[x,y,z,r]
    for (let i = 0; i < field.count; i++) {
        const o = i * FloatsPerInstruction;
        const op = field.data[o];
        const shape = field.data[o + 1];
        if (op === 0 && shape === 0) {
            const x = field.data[o + 4], y = field.data[o + 5], z = field.data[o + 6], r = field.data[o + 7];
            return { x, y, z, r };
        }
    }
    return null;
}

// ── 3D thermal / hydraulic on mesh (true surface walk) ──
export interface DropletMeshParams {
    droplets: number;
    steps: number;
    erodeRate: number;
    deposit: number;
    inertia: number;
}

export function DropletErodeMesh(
    geom: THREE.BufferGeometry,
    params: DropletMeshParams,
    rand: () => number = Math.random
): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    if (!pos) return;
    geom.computeVertexNormals();
    const nattr = geom.attributes.normal as THREE.BufferAttribute;
    const nVerts = pos.count;

    // adjacency from index
    const idx = geom.index ? (geom.index.array as ArrayLike<number>) : null;
    const adjacency = new Map<number, number[]>();
    const addEdge = (a: number, b: number) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        const la = adjacency.get(a)!; if (!la.includes(b)) la.push(b);
        const lb = adjacency.get(b)!; if (!lb.includes(a)) lb.push(a);
    };
    if (idx) {
        for (let i = 0; i < idx.length; i += 3) {
            const a = idx[i] as number, b = idx[i + 1] as number, c = idx[i + 2] as number;
            addEdge(a, b); addEdge(b, c); addEdge(c, a);
        }
    } else {
        for (let i = 0; i < nVerts; i += 3) { addEdge(i, i + 1); addEdge(i + 1, i + 2); addEdge(i + 2, i); }
    }

    const heights = new Float32Array(nVerts);
    for (let i = 0; i < nVerts; i++) heights[i] = pos.getY(i);
    const flow = new Float32Array(nVerts);
    // keep original positions for stable erosion (avoid feedback cascade that shreds the mesh)
    const origY = new Float32Array(heights);

    for (let d = 0; d < params.droplets; d++) {
        let cur = Math.floor(rand() * nVerts);
        // bias start to upper 30% of sphere (avoid starting on bottom where flow pools)
        for (let k = 0; k < 2; k++) {
            const cand = Math.floor(rand() * nVerts);
            if (heights[cand] > heights[cur] && origY[cand] > origY[cur] - 1) cur = cand;
        }
        // skip if starting very low (bottom hemisphere)
        if (heights[cur] < origY[cur] - 2) continue;
        let water = 1.0, sediment = 0, vel = 0;
        for (let step = 0; step < params.steps; step++) {
            if (water < 0.01) break;
            const neigh = adjacency.get(cur);
            if (!neigh || neigh.length === 0) break;
            let best = cur, bestY = heights[cur];
            for (const nb of neigh) if (heights[nb] < bestY) { bestY = heights[nb]; best = nb; }
            if (best === cur) break;
            const deltaH = heights[best] - heights[cur]; // negative downhill
            const slope = Math.max(-deltaH, 0.008);
            const speed = Math.max(vel * params.inertia + slope * (1 - params.inertia), 0.06);
            vel = speed;
            const cap = slope * speed * water * 0.06; // gentler capacity
            // limit per-step carve to 0.12m so we don't shred
            if (sediment > cap || deltaH > 0) {
                const dep = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - cap) * params.deposit;
                const cdep = Math.min(dep, 0.08);
                if (cdep > 1e-4) {
                    const nx = nattr.getX(cur), ny = nattr.getY(cur), nz = nattr.getZ(cur);
                    const ox = pos.getX(cur), oy = pos.getY(cur), oz = pos.getZ(cur);
                    pos.setXYZ(cur, ox + nx * cdep * 0.35, oy + ny * cdep * 0.35, oz + nz * cdep * 0.35);
                    heights[cur] += cdep * 0.35 * Math.max(ny, 0.2); // y rises a bit
                    sediment -= cdep;
                    flow[cur] += cdep;
                }
            } else {
                let erode = Math.min((cap - sediment) * params.erodeRate, -deltaH);
                erode = Math.min(Math.max(0, erode), 0.12);
                if (erode > 1e-4) {
                    const nx = nattr.getX(cur), ny = nattr.getY(cur), nz = nattr.getZ(cur);
                    const ox = pos.getX(cur), oy = pos.getY(cur), oz = pos.getZ(cur);
                    pos.setXYZ(cur, ox - nx * erode * 0.35, oy - ny * erode * 0.35, oz - nz * erode * 0.35);
                    heights[cur] -= erode * 0.35 * Math.max(ny, 0.2);
                    sediment += erode;
                    flow[cur] += erode;
                }
            }
            water *= 0.993;
            cur = best;
        }
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    const colors = new Float32Array(nVerts * 3);
    let maxF = 0; for (let i = 0; i < nVerts; i++) if (flow[i] > maxF) maxF = flow[i];
    for (let i = 0; i < nVerts; i++) {
        const t = maxF > 0 ? Math.pow(flow[i] / maxF, 0.55) : 0;
        colors[i * 3] = 0.72 - t * 0.12;
        colors[i * 3 + 1] = 0.62 - t * 0.08;
        colors[i * 3 + 2] = 0.52 - t * 0.06;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Thermal on mesh: very gentle — for a sphere we just slightly round the top,
// for terrain it slumps the cliff. Keep it conservative so it doesn't shred.
export function ThermalErodeMesh(geom: THREE.BufferGeometry, talusDeg: number, iterations: number, _cell: number): void {
    if (iterations <= 0) return;
    // For sphere we do a single mild Laplacian smooth instead of talus slump —
    // true talus on a closed sphere would collapse it.
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index ? (geom.index.array as ArrayLike<number>) : null;
    const adjacency = new Map<number, number[]>();
    const addEdge = (a: number, b: number) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        const la = adjacency.get(a)!; if (!la.includes(b)) la.push(b);
        const lb = adjacency.get(b)!; if (!lb.includes(a)) lb.push(a);
    };
    if (idx) for (let i = 0; i < idx.length; i += 3) { addEdge(idx[i] as number, idx[i + 1] as number); addEdge(idx[i + 1] as number, idx[i + 2] as number); addEdge(idx[i + 2] as number, idx[i] as number); }
    else for (let i = 0; i < pos.count; i += 3) { addEdge(i, i + 1); addEdge(i + 1, i + 2); addEdge(i + 2, i); }

    const n = pos.count;
    // 1 pass of mild smooth (iterations capped to 2 for sphere)
    const iters = Math.min(iterations, 2);
    for (let it = 0; it < iters; it++) {
        const copy = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { copy[i * 3] = pos.getX(i); copy[i * 3 + 1] = pos.getY(i); copy[i * 3 + 2] = pos.getZ(i); }
        for (let v = 0; v < n; v++) {
            const neigh = adjacency.get(v); if (!neigh || neigh.length < 3) continue;
            let ax = 0, ay = 0, az = 0;
            for (const nb of neigh) { ax += copy[nb * 3]; ay += copy[nb * 3 + 1]; az += copy[nb * 3 + 2]; }
            ax /= neigh.length; ay /= neigh.length; az /= neigh.length;
            // 4% towards neighbor average — very gentle
            pos.setXYZ(v,
                pos.getX(v) * 0.96 + ax * 0.04,
                pos.getY(v) * 0.96 + ay * 0.04,
                pos.getZ(v) * 0.96 + az * 0.04);
        }
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    void talusDeg;
}

// Create a dedicated 3D sphere mesh for the SDF sphere test (not a heightfield)
// Hybrid: use the well-tuned heightfield erosion to drive a radial displacement
// on an icosphere. This gives the visual quality of the 512² droplet sim
// but wrapped around the sphere — no pillar, true 3D.
export function CreateSphereFromHeightfield(
    sphere: SphereInfo,
    heightsOrig: Float32Array,
    heightsEroded: Float32Array,
    size: number,
    tileSize: number
): THREE.BufferGeometry {
    const geom = new THREE.IcosahedronGeometry(sphere.r, 5); // 10k verts for crisp gullies
    geom.translate(sphere.x, sphere.y, sphere.z);
    geom.computeVertexNormals();
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const nattr = geom.attributes.normal as THREE.BufferAttribute;
    const worldMin = -tileSize * 0.5;
    const cell = tileSize / (size - 1);
    const n = pos.count;
    // sample delta and displace along normal
    for (let i = 0; i < n; i++) {
        const wx = pos.getX(i), wy = pos.getY(i), wz = pos.getZ(i);
        // only displace upper hemisphere and sides (y > sphere.y - r*0.6) — bottom is hidden by ground
        if (wy < sphere.y - sphere.r * 0.55) continue;
        // map (wx,wz) to heightfield cell
        const fx = (wx - worldMin) / cell;
        const fz = (wz - worldMin) / cell;
        const ix = Math.floor(fx), iz = Math.floor(fz);
        if (ix < 0 || iz < 0 || ix >= size - 1 || iz >= size - 1) continue;
        const tx = fx - ix, tz = fz - iz;
        // bilinear sample original and eroded
        const h00o = heightsOrig[iz * size + ix], h10o = heightsOrig[iz * size + ix + 1], h01o = heightsOrig[(iz + 1) * size + ix], h11o = heightsOrig[(iz + 1) * size + ix + 1];
        const h00e = heightsEroded[iz * size + ix], h10e = heightsEroded[iz * size + ix + 1], h01e = heightsEroded[(iz + 1) * size + ix], h11e = heightsEroded[(iz + 1) * size + ix + 1];
        const ho = h00o * (1 - tx) * (1 - tz) + h10o * tx * (1 - tz) + h01o * (1 - tx) * tz + h11o * tx * tz;
        const he = h00e * (1 - tx) * (1 - tz) + h10e * tx * (1 - tz) + h01e * (1 - tx) * tz + h11e * tx * tz;
        const delta = he - ho; // negative = eroded (carved), positive = deposited
        // only carve where delta is negative (erosion) — deposition on sphere looks blobby, skip for now
        if (delta >= -0.02) continue;
        // scale delta to normal displacement — 0.85 keeps 1m heightfield carve ≈ 0.85m radial carve
        const disp = delta * 0.85;
        // clamp to avoid extreme spikes (max 1.8m inwards)
        const c = Math.max(disp, -1.8);
        const nx = nattr.getX(i), ny = nattr.getY(i), nz = nattr.getZ(i);
        pos.setXYZ(i, wx + nx * c, wy + ny * c, wz + nz * c);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    // gentle vertex-color by delta for visual flow
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const wx = pos.getX(i), wz = pos.getZ(i);
        const fx = (wx - worldMin) / cell, fz = (wz - worldMin) / cell;
        const ix = Math.floor(fx), iz = Math.floor(fz);
        let t = 0;
        if (ix >= 0 && iz >= 0 && ix < size && iz < size) {
            const idx = Math.min(size - 1, iz) * size + Math.min(size - 1, ix);
            const d = heightsEroded[idx] - heightsOrig[idx];
            t = Math.min(Math.max(-d / 1.2, 0), 1);
        }
        colors[i * 3] = 0.68 - t * 0.12;
        colors[i * 3 + 1] = 0.60 - t * 0.08;
        colors[i * 3 + 2] = 0.52 - t * 0.06;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
}

export function CreateErodedSphereMesh(
    _field: CompiledField,
    sphere: SphereInfo,
    opts: { thermal: number; talus: number; droplets: number; iters: number; erode: number; deposit: number }
): THREE.BufferGeometry {
    // Icosahedron subdiv 4 → ~2560 verts (subdiv 5 → 10k is overkill and shreds when eroded hard)
    const geom = new THREE.IcosahedronGeometry(sphere.r, 4);
    geom.translate(sphere.x, sphere.y, sphere.z);
    geom.computeVertexNormals();

    if (opts.thermal > 0) {
        const cell = (sphere.r * 2) / 32;
        ThermalErodeMesh(geom, opts.talus, Math.min(opts.thermal, 2), cell);
    }
    DropletErodeMesh(geom, {
        droplets: Math.min(Math.round(opts.droplets), 3500),
        steps: 36,
        erodeRate: Math.min(opts.erode, 0.14),
        deposit: Math.min(opts.deposit, 0.08),
        inertia: 0.06,
    });
    return geom;
}

// Fallback: voxelize + marching cubes for generic SDF (kept minimal)
// For now we expose a simple voxel sampler for debugging
export function VoxelizeSDF(field: CompiledField, N: number, min: THREE.Vector3, max: THREE.Vector3) {
    const data = new Float32Array(N * N * N);
    const size = new THREE.Vector3().subVectors(max, min);
    let idx = 0;
    for (let z = 0; z < N; z++) {
        const wz = min.z + (z / (N - 1)) * size.z;
        for (let y = 0; y < N; y++) {
            const wy = min.y + (y / (N - 1)) * size.y;
            for (let x = 0; x < N; x++) {
                const wx = min.x + (x / (N - 1)) * size.x;
                data[idx++] = EvalField(field.data, field.count, wx, wy, wz);
            }
        }
    }
    return { data, N, min: min.clone(), max: max.clone(), cell: size.x / (N - 1) };
}
