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

/** 3D splat: distribute amount to 3x3x3 neighbourhood with trilinear falloff */
function Splat3D(data: Float32Array, N: number, cx: number, cy: number, cz: number, amount: number, radius = 1): void {
    const rInt = Math.ceil(radius);
    for (let dz=-rInt; dz<=rInt; dz++) for (let dy=-rInt; dy<=rInt; dy++) for (let dx=-rInt; dx<=rInt; dx++) {
        const nx=cx+dx, ny=cy+dy, nz=cz+dz;
        if(nx<0||ny<0||nz<0||nx>=N||ny>=N||nz>=N) continue;
        const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(dist>radius+1e-6) continue;
        const w = Math.max(0, 1 - dist/(radius+0.9));
        const idx=idx3(nx,ny,nz,N);
        data[idx] += amount * w * 0.42; // spread, conserve ~ mass
    }
}

/** Async hydraulic droplet erosion on voxels — walks downhill by effective surface height (y - SDF) so carved valleys attract flow */
export async function DropletErodeVoxelsAsync(
    vol: VoxelVolume,
    mask: Uint8Array,
    settings: ErodeSettings,
    onProgress?: (done: number, total: number) => void,
    yieldEvery = 500
): Promise<void> {
    const { data, N, cell, min } = vol;
    // scale droplets with iterations but cap for interactivity
    const totalDroplets = Math.min(settings.droplets * Math.max(1, Math.floor(settings.iterations/4)), 8500);
    const inertia = settings.inertia;
    const erodeRate = Math.min(settings.erodeRate, 0.36);
    const evaporation = settings.evaporation;

    let surfaceList: number[] = [];
    for (let i=0;i<mask.length;i++) if(mask[i]) surfaceList.push(i);
    if(surfaceList.length===0) return;

    const yWorldFor = (yIdx:number)=> min.y + yIdx*cell;
    // effective surface height ≈ y - SDF (for top region SDF≈y - surf) -> carved valleys (higher SDF) become lower
    const effHeight = (idx:number, yIdx:number)=> yWorldFor(yIdx) - data[idx]*0.75;

    const startCandidates = surfaceList.filter(i=>{
        const yIdx=Math.floor((i/N)%N);
        const y=yWorldFor(yIdx);
        return y > min.y + vol.size*0.38 && data[i] < 0.35;
    });
    const pool = startCandidates.length>600 ? startCandidates : surfaceList;

    const neighOffsets:[number,number,number][]=[];
    for(let dz=-1;dz<=1;dz++) for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if(dx||dy||dz) neighOffsets.push([dx,dy,dz]);

    // flow accumulation for widening (where many droplets pass, erode more)
    const flowCount = new Uint16Array(data.length);

    for(let d=0; d<totalDroplets; d++){
        let curIdx = pool[Math.floor(Math.random()*pool.length)];
        for(let k=0;k<2;k++){
            const cand=pool[Math.floor(Math.random()*pool.length)];
            if(effHeight(cand, Math.floor((cand/N)%N)) > effHeight(curIdx, Math.floor((curIdx/N)%N))) curIdx=cand;
        }
        let water=1.0, sediment=0, vel=0;
        let curX=curIdx%N, curY=Math.floor((curIdx/N)%N), curZ=Math.floor(curIdx/(N*N));
        let prevDir:[number,number,number]=[0,0,0];
        for(let step=0; step<42; step++){
            if(water<0.015) break;
            const curEff = effHeight(curIdx, curY);
            let bestIdx=-1;
            let bestEff = curEff;
            let bestDist=cell;
            let bestX=curX,bestY=curY,bestZ=curZ;
            let bestDir:[number,number,number]=[0,0,0];
            for(const [dx,dy,dz] of neighOffsets){
                const nx=curX+dx, ny=curY+dy, nz=curZ+dz;
                if(nx<0||ny<0||nz<0||nx>=N||ny>=N||nz>=N) continue;
                const nIdx=idx3(nx,ny,nz,N);
                if(!mask[nIdx]) continue;
                const eff = effHeight(nIdx, ny);
                // inertia: slight preference to continue same direction
                const dot = dx*prevDir[0]+dy*prevDir[1]+dz*prevDir[2];
                const bias = dot>0 ? 0.015*dot : 0;
                const score = eff - bias;
                if(score < bestEff - 1e-5){
                    bestEff=score; bestIdx=nIdx; bestX=nx; bestY=ny; bestZ=nz;
                    bestDist=Math.sqrt(dx*dx+dy*dy+dz*dz)*cell;
                    bestDir=[dx,dy,dz];
                }
            }
            if(bestIdx===-1) break;
            const heightDiff = curEff - bestEff; // >0 downhill
            const slope = Math.max(heightDiff / Math.max(bestDist, cell*0.6), 0.012);
            vel = vel*inertia + slope*(1-inertia);
            vel = Math.max(vel, 0.04);
            const capacity = slope * vel * water * (settings.capacity*6.5 + 0.18);
            flowCount[curIdx] = Math.min(65535, flowCount[curIdx]+1);
            const widen = Math.min(1.4, 0.85 + Math.log2(1+flowCount[curIdx])*0.18);
            if(sediment > capacity){
                const dep=Math.min((sediment-capacity)*settings.deposit*0.55, heightDiff*0.45);
                const cdep=Math.min(dep, 0.08);
                if(cdep>1e-4){
                    Splat3D(data,N,curX,curY,curZ,-cdep*0.55,1.2);
                    sediment -= cdep;
                }
            }else{
                let erodeAmt=Math.min((capacity - sediment)*erodeRate, heightDiff*0.72);
                erodeAmt=Math.min(Math.max(0,erodeAmt), 0.26);
                erodeAmt *= widen;
                if(erodeAmt>1e-4){
                    Splat3D(data,N,curX,curY,curZ,erodeAmt*0.62,1.45);
                    Splat3D(data,N,bestX,bestY,bestZ,erodeAmt*0.26,1.25);
                    sediment += erodeAmt*0.9;
                }
            }
            water *= (1 - evaporation*0.9);
            prevDir=bestDir;
            curX=bestX; curY=bestY; curZ=bestZ; curIdx=bestIdx;
        }
        if(d%yieldEvery===0){
            onProgress?.(d,totalDroplets);
            await new Promise<void>(r=>setTimeout(r,0));
        }
    }
    onProgress?.(totalDroplets,totalDroplets);
    // two-pass 26-neighbour smooth (18% blend) to kill voxel stair-step while keeping gullies
    for(let pass=0; pass<2; pass++){
        const copy2 = data.slice();
        for(let z=1;z<N-1;z++) for(let y=1;y<N-1;y++) for(let x=1;x<N-1;x++){
            const i=idx3(x,y,z,N);
            if(!mask[i]) continue;
            let avg=0,cnt=0;
            for(let dz=-1;dz<=1;dz++) for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
                if(dx===0&&dy===0&&dz===0) continue;
                const n=idx3(x+dx,y+dy,z+dz,N);
                if(mask[n]){ avg+=copy2[n]; cnt++; }
            }
            if(cnt>=8) data[i] = data[i]*0.82 + (avg/cnt)*0.18;
        }
    }
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
