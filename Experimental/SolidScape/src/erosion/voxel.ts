// SolidScape — volumetric SDF erosion (true 3D) for sphere/closed shapes
// Voxelizes the SDF field to an N³ grid, then runs thermal slump + hydraulic droplet walk
// directly on voxels. Result is an eroded SDF volume that the raymarcher samples
// trilinearly — no heightmap projection stretch.

import * as THREE from 'three';
import { EvalField } from '../sdf';
import type { CompiledField } from '../sdf';
import type { ErodeSettings } from './index';

export interface VoxelVolume {
    data: Float32Array; // SDF values, size N³, order x + y*N + z*N*N
    N: number;
    min: THREE.Vector3;
    size: number; // world size (cubic)
    cell: number;
}

function idx3(x: number, y: number, z: number, N: number): number { return x + y * N + z * N * N; }

/** Voxelize the compiled field into a cubic N³ volume. */
export function VoxelizeField(field: CompiledField, N: number, min: THREE.Vector3, size: number): VoxelVolume {
    const data = new Float32Array(N * N * N);
    const cell = size / (N - 1);
    let p = 0;
    for (let z = 0; z < N; z++) {
        const wz = min.z + (z / (N - 1)) * size;
        for (let y = 0; y < N; y++) {
            const wy = min.y + (y / (N - 1)) * size;
            for (let x = 0; x < N; x++) {
                const wx = min.x + (x / (N - 1)) * size;
                data[p++] = EvalField(field.data, field.count, wx, wy, wz);
            }
        }
    }
    return { data, N, min: min.clone(), size, cell };
}

/** Build surface mask: voxels where |SDF| < cell*1.4 and neighbor has opposite sign (near zero crossing). */
function BuildSurfaceMask(vol: VoxelVolume, outMask: Uint8Array): number {
    const { data, cell } = vol;
    const thresh = cell * 1.35;
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) < thresh) {
            outMask[i] = 1;
            count++;
        } else outMask[i] = 0;
    }
    // Include also interior voxels just inside surface? For droplet walk we need walkable voxels that are surface
    // Expand mask by one to include immediate interior/exterior? We'll keep as above.
    return count;
}

/** Thermal slump on voxel surface — very gentle. */
export function ThermalErodeVoxels(vol: VoxelVolume, mask: Uint8Array, talusDeg: number, iterations: number): void {
    if (iterations <= 0) return;
    const { data, N, cell } = vol;
    const talus = Math.tan(talusDeg * Math.PI / 180);
    const iters = Math.min(iterations, 3);
    const delta = new Float32Array(data.length);
    const yOf = (yIdx: number, minY: number, cell: number) => minY + yIdx * cell;

    const neigh6: [number, number, number][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

    for (let it = 0; it < iters; it++) {
        delta.fill(0);
        for (let z = 1; z < N-1; z++) for (let y = 1; y < N-1; y++) for (let x = 1; x < N-1; x++) {
            const i = idx3(x,y,z,N);
            if (!mask[i]) continue;
            const yWorld = yOf(y, vol.min.y, cell);
            for (const [dx, dy, dz] of neigh6) {
                const nx = x+dx, ny = y+dy, nz = z+dz;
                const nIdx = idx3(nx,ny,nz,N);
                if (!mask[nIdx]) continue;
                const yNb = yOf(ny, vol.min.y, cell);
                const dY = yWorld - yNb; // positive if current higher
                if (dY <= 0) continue;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) * cell;
                const slope = dY / Math.max(dist, 1e-6);
                if (slope > talus) {
                    const excess = slope - talus;
                    // small transfer proportional to excess, capped
                    let amt = excess * cell * 0.22;
                    amt = Math.min(amt, 0.09);
                    // high loses material (SDF increases), low gains (SDF decreases)
                    delta[i] += amt * 0.55;
                    delta[nIdx] -= amt * 0.55;
                }
            }
        }
        for (let i = 0; i < data.length; i++) if (delta[i] !== 0) data[i] += delta[i];
        // Rebuild mask after each iter (surface may shift slightly)
        BuildSurfaceMask(vol, mask);
    }
}

/** Async hydraulic droplet erosion on voxels — walks downhill by gravity (decreasing y). */
export async function DropletErodeVoxelsAsync(
    vol: VoxelVolume,
    mask: Uint8Array,
    settings: ErodeSettings,
    onProgress?: (done: number, total: number) => void,
    yieldEvery = 600
): Promise<void> {
    const { data, N, cell, min } = vol;
    const totalDroplets = Math.min(settings.droplets * Math.max(1, Math.floor(settings.iterations/4)), 5000);
    // inertia, capacity, erodeRate from settings
    const inertia = settings.inertia;
    const erodeRate = Math.min(settings.erodeRate, 0.12);
    const evaporation = settings.evaporation;

    // Build list of surface indices for fast random pick
    let surfaceList: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) surfaceList.push(i);
    if (surfaceList.length === 0) return;

    // Precompute y world per y index
    const yWorldFor = (yIdx: number) => min.y + yIdx * cell;

    // To avoid walking on bottom ground plane, filter to y > min.y + size*0.35 ?
    const startCandidates = surfaceList.filter(i => {
        const yIdx = Math.floor((i / N) % N);
        const y = yWorldFor(yIdx);
        // keep upper 65% of volume and inside sphere (negative SDF)
        return y > min.y + vol.size*0.42 && data[i] < 0.22;
    });
    const pool = startCandidates.length > 500 ? startCandidates : surfaceList;

    let flow = new Float32Array(data.length); void flow;

    const neighOffsets: [number, number, number][] = [];
    for (let dz=-1; dz<=1; dz++) for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) if (dx||dy||dz) neighOffsets.push([dx,dy,dz]);

    for (let d = 0; d < totalDroplets; d++) {
        // pick start biased to higher y
        let curIdx = pool[Math.floor(Math.random()*pool.length)];
        // optionally try to pick higher one
        for (let k=0;k<2;k++) {
            const cand = pool[Math.floor(Math.random()*pool.length)];
            const yC = yWorldFor(Math.floor((cand / N)% N));
            const yCur = yWorldFor(Math.floor((curIdx / N)% N));
            if (yC > yCur) curIdx = cand;
        }

        let water = 1.0;
        let sediment = 0;
        let vel = 0;
        let curX = curIdx % N;
        let curY = Math.floor((curIdx / N) % N);
        let curZ = Math.floor(curIdx / (N*N));

        for (let step=0; step<34; step++) {
            if (water < 0.02) break;
            const yCurWorld = yWorldFor(curY);
            // find steepest downhill surface neighbor with lower y
            let bestIdx = -1;
            let bestY = yCurWorld;
            let bestDist = 1;
            let bestX = curX, bestYIdx = curY, bestZ = curZ;
            for (const [dx, dy, dz] of neighOffsets) {
                const nx = curX+dx, ny = curY+dy, nz = curZ+dz;
                if (nx<0||ny<0||nz<0||nx>=N||ny>=N||nz>=N) continue;
                const nIdx = idx3(nx,ny,nz,N);
                if (!mask[nIdx]) continue;
                const yNb = yWorldFor(ny);
                // only downhill
                if (yNb >= bestY) continue;
                // require some slope, but allow gentle
                bestY = yNb; bestIdx = nIdx; bestX = nx; bestYIdx = ny; bestZ = nz;
                bestDist = Math.sqrt(dx*dx+dy*dy+dz*dz)*cell;
            }
            if (bestIdx === -1) break;

            const heightDiff = yCurWorld - bestY; // >0
            const slope = Math.max(heightDiff / Math.max(bestDist, cell*0.7), 0.015);
            vel = vel*inertia + slope*(1-inertia);
            vel = Math.max(vel, 0.05);
            const capacity = slope * vel * water * 0.45;

            if (sediment > capacity) {
                // deposit a little at current
                const dep = Math.min((sediment - capacity)* settings.deposit *0.5, heightDiff*0.4);
                const cdep = Math.min(dep, 0.07);
                if (cdep > 1e-4) {
                    // deposit decreases SDF (adds material)
                    data[curIdx] -= cdep * 0.6;
                    sediment -= cdep;
                }
            } else {
                let erodeAmt = Math.min((capacity - sediment)*erodeRate, heightDiff*0.55);
                erodeAmt = Math.min(Math.max(0, erodeAmt), 0.11);
                if (erodeAmt > 1e-4) {
                    // erode current (increase SDF, carve inward)
                    // weight by how vertical the surface is? For sphere, carving deeper on sides looks wrong? Keep uniform.
                    data[curIdx] += erodeAmt * 0.72;
                    // also slightly carve best to make continuous groove
                    data[bestIdx] += erodeAmt * 0.18;
                    sediment += erodeAmt;
                }
            }
            water *= (1 - evaporation);
            curX = bestX; curY = bestYIdx; curZ = bestZ;
            curIdx = bestIdx;
        }

        if (d % yieldEvery === 0) {
            onProgress?.(d, totalDroplets);
            await new Promise<void>(r => setTimeout(r, 0));
        }
    }
    onProgress?.(totalDroplets, totalDroplets);
}

/** Generate a top-down preview heightmap from voxel volume (find highest zero-crossing per column). */
export function VoxelTopHeightmap(vol: VoxelVolume, outSize = 256): { heights: Float32Array; size: number; min: number; max: number } {
    const { data, N, min, size } = vol;
    const cell = size / (N-1);
    const heights = new Float32Array(outSize*outSize);
    let gMin = Infinity, gMax = -Infinity;
    for (let iz=0; iz<outSize; iz++) {
        const wz = min.z + (iz/(outSize-1))*size;
        const zIdx = Math.round((wz - min.z)/cell);
        const cz = Math.max(0, Math.min(N-1, zIdx));
        for (let ix=0; ix<outSize; ix++) {
            const wx = min.x + (ix/(outSize-1))*size;
            const xIdx = Math.round((wx - min.x)/cell);
            const cx = Math.max(0, Math.min(N-1, xIdx));
            // march from top down to find surface (where SDF crosses 0)
            let ySurf = min.y;
            let found = false;
            for (let y=N-1; y>=0; y--) {
                const idx = idx3(cx,y,cz,N);
                const v = data[idx];
                if (v <= 0) {
                    // interpolate between y and y+1 where sign changes
                    if (y < N-1) {
                        const vAbove = data[idx3(cx,y+1,cz,N)];
                        if (vAbove > 0) {
                            const t = vAbove / (vAbove - v);
                            ySurf = (min.y + y*cell) + t*cell;
                        } else ySurf = min.y + y*cell;
                    } else ySurf = min.y + y*cell;
                    found = true;
                    break;
                }
            }
            if (!found) ySurf = min.y; // ground
            heights[iz*outSize + ix] = ySurf;
            if (ySurf < gMin) gMin = ySurf;
            if (ySurf > gMax) gMax = ySurf;
        }
    }
    return { heights, size: outSize, min: gMin, max: gMax };
}
