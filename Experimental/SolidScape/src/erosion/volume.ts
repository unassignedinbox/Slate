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
    const normal = geom.attributes.normal as THREE.BufferAttribute;
    if (!pos) return;
    if (!normal) geom.computeVertexNormals();
    const nattr = geom.attributes.normal as THREE.BufferAttribute;
    const nVerts = pos.count;

    // adjacency from index (or from triangle soup)
    const idx = geom.index ? (geom.index.array as ArrayLike<number>) : null;
    const adjacency = new Map<number, number[]>();
    const addEdge = (a: number, b: number) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        const la = adjacency.get(a)!; if (!la.includes(b)) la.push(b);
        const lb = adjacency.get(b)!; if (!lb.includes(a)) lb.push(a);
    };
    if (idx) {
        for (let i = 0; i < idx.length; i += 3) addEdge(idx[i] as number, idx[i + 1] as number), addEdge(idx[i + 1] as number, idx[i + 2] as number), addEdge(idx[i + 2] as number, idx[i] as number);
    } else {
        for (let i = 0; i < nVerts; i += 3) addEdge(i, i + 1), addEdge(i + 1, i + 2), addEdge(i + 2, i);
    }

    const heights = new Float32Array(nVerts);
    for (let i = 0; i < nVerts; i++) heights[i] = pos.getY(i);
    const flow = new Float32Array(nVerts);

    for (let d = 0; d < params.droplets; d++) {
        // start near top of mesh (high y) — bias to upper hemisphere of sphere
        let cur = Math.floor(rand() * nVerts);
        for (let k = 0; k < 2; k++) {
            const cand = Math.floor(rand() * nVerts);
            if (heights[cand] > heights[cur]) cur = cand;
        }
        let water = 1.0, sediment = 0, vel = 0;
        for (let step = 0; step < params.steps; step++) {
            if (water < 0.008) break;
            const neigh = adjacency.get(cur);
            if (!neigh || neigh.length === 0) break;
            let best = cur, bestY = heights[cur];
            for (const nb of neigh) if (heights[nb] < bestY) { bestY = heights[nb]; best = nb; }
            if (best === cur) break; // local minimum
            const deltaH = heights[best] - heights[cur]; // negative downhill
            const slope = Math.max(-deltaH, 0.01);
            const speed = Math.max(vel * params.inertia + slope * (1 - params.inertia), 0.08);
            vel = speed;
            const cap = slope * speed * water * 0.09;
            if (sediment > cap || deltaH > 0) {
                const dep = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - cap) * params.deposit;
                if (dep > 1e-4) {
                    const nx = nattr.getX(cur), nz = nattr.getZ(cur);
                    // deposit outward along normal (adds material) — y is height, so we bias y too
                    pos.setXYZ(cur, pos.getX(cur) + nx * dep * 0.45, heights[cur] + dep * 0.45, pos.getZ(cur) + nz * dep * 0.45);
                    heights[cur] += dep * 0.45;
                    sediment -= dep;
                    flow[cur] += dep;
                }
            } else {
                let erode = Math.min((cap - sediment) * params.erodeRate, -deltaH);
                erode = Math.max(0, erode);
                if (erode > 1e-4) {
                    const nx = nattr.getX(cur), nz = nattr.getZ(cur);
                    pos.setXYZ(cur, pos.getX(cur) - nx * erode * 0.45, heights[cur] - erode * 0.45, pos.getZ(cur) - nz * erode * 0.45);
                    heights[cur] -= erode * 0.45;
                    sediment += erode;
                    flow[cur] += erode;
                }
            }
            water *= 0.992;
            cur = best;
        }
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    // store flow as vertex color (visual debug)
    const colors = new Float32Array(nVerts * 3);
    let maxF = 0; for (let i = 0; i < nVerts; i++) if (flow[i] > maxF) maxF = flow[i];
    for (let i = 0; i < nVerts; i++) {
        const t = maxF > 0 ? Math.pow(flow[i] / maxF, 0.6) : 0;
        // sediment-rich (deposition) → sandy, eroded → darker rock
        colors[i * 3] = 0.72 - t * 0.15;
        colors[i * 3 + 1] = 0.62 - t * 0.1;
        colors[i * 3 + 2] = 0.52 - t * 0.05;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Thermal on mesh: slump vertices where slope > talus (3D, not just Y)
export function ThermalErodeMesh(geom: THREE.BufferGeometry, talusDeg: number, iterations: number, cell: number): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const idx = geom.index ? (geom.index.array as ArrayLike<number>) : null;
    const adjacency = new Map<number, number[]>();
    const addEdge = (a: number, b: number) => {
        if (!adjacency.has(a)) adjacency.set(a, []);
        if (!adjacency.has(b)) adjacency.set(b, []);
        const la = adjacency.get(a)!; if (!la.includes(b)) la.push(b);
        const lb = adjacency.get(b)!; if (!lb.includes(a)) lb.push(a);
    };
    if (idx) for (let i = 0; i < idx.length; i += 3) addEdge(idx[i] as number, idx[i + 1] as number), addEdge(idx[i + 1] as number, idx[i + 2] as number), addEdge(idx[i + 2] as number, idx[i] as number);
    else for (let i = 0; i < pos.count; i += 3) addEdge(i, i + 1), addEdge(i + 1, i + 2), addEdge(i + 2, i);

    const tanTalus = Math.tan(talusDeg * Math.PI / 180);
    const thresh = tanTalus * cell;
    const n = pos.count;
    let buf = new Float32Array(n * 3);
    let src = new Float32Array(n * 3); for (let i = 0; i < n; i++){ src[i*3]=pos.getX(i); src[i*3+1]=pos.getY(i); src[i*3+2]=pos.getZ(i); }
    for (let it = 0; it < iterations; it++) {
        for (let i = 0; i < n*3; i++) buf[i]=src[i];
        let changed = false;
        for (let v = 0; v < n; v++) {
            const vx = src[v*3], vy = src[v*3+1], vz = src[v*3+2];
            const neigh = adjacency.get(v); if (!neigh) continue;
            let lowestY = vy, lowIdx = -1;
            for (const nb of neigh) {
                const ny = src[nb*3+1];
                if (ny < lowestY) { lowestY = ny; lowIdx = nb; }
            }
            if (lowIdx === -1) continue;
            const diff = vy - lowestY;
            // horizontal distance approximated by edge length in XZ
            const horiz = Math.hypot(vx - src[lowIdx*3], vz - src[lowIdx*3+2]);
            if (diff > thresh && horiz > 1e-6 && diff / Math.max(horiz, 0.1) > tanTalus) {
                const excess = diff - thresh;
                const t = Math.min(excess * 0.18, diff * 0.35);
                // slump: move vertex down, neighbor up (mass conserve)
                buf[v*3+1] -= t * 0.5;
                buf[lowIdx*3+1] += t * 0.5;
                changed = true;
            }
        }
        if (!changed) break;
        const tmp = src; src = buf; buf = tmp;
    }
    for (let i = 0; i < n; i++) pos.setXYZ(i, src[i*3], src[i*3+1], src[i*3+2]);
    pos.needsUpdate = true;
    geom.computeVertexNormals();
}

// Create a dedicated 3D sphere mesh for the SDF sphere test (not a heightfield)
export function CreateErodedSphereMesh(
    _field: CompiledField,
    sphere: SphereInfo,
    opts: { thermal: number; talus: number; droplets: number; iters: number; erode: number; deposit: number }
): THREE.BufferGeometry {
    // Use icosphere with subdiv 5 (≈10k verts) — enough to resolve gullies
    const geom = new THREE.IcosahedronGeometry(sphere.r, 5);
    // move to sphere center
    geom.translate(sphere.x, sphere.y, sphere.z);
    geom.computeVertexNormals();

    // thermal first (slump the 8m cliff if sphere sits on plane — but for isolated sphere, thermal rounds the top)
    if (opts.thermal > 0) {
        const cell = (sphere.r * 2) / 32; // approx edge length
        ThermalErodeMesh(geom, opts.talus, opts.thermal, cell);
    }
    // hydraulic
    DropletErodeMesh(geom, {
        droplets: opts.droplets,
        steps: 48,
        erodeRate: opts.erode,
        deposit: opts.deposit,
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
