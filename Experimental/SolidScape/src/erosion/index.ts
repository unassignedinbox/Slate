// SolidScape — Erosion orchestrator: SDF-volumetric for sphere, heightfield for terrain
// Sphere → true 3D voxel SDF erosion (N³ volume, 3D droplet walk on surface voxels)
// Terrain → fallback 2D heightfield Δh texture (same as before but now labeled correctly)
// Both upload to FieldPass: SetErosionVolume (3D) or SetErosion (2D). Preview canvas stays 2D.

import * as THREE from 'three';
import type { CompiledField } from '../sdf';
import { BakeHeightfield, type Heightfield } from './heightfield';
import { ThermalErode } from './thermal';
import { DropletErodeAsync, type DropletParams } from './droplet';
import { FindFirstSphere } from './volume';
import { VoxelizeField, ThermalErodeVoxels, DropletErodeVoxelsAsync, VoxelTopHeightmap } from './voxel';
import type { FieldPass } from '../sdfPass';

export interface ErodeSettings
{
    tileSize: number;
    resolution: number;
    iterations: number;
    droplets: number;
    erodeRate: number;
    deposit: number;
    talus: number;
    thermal: number;
    inertia: number;
    capacity: number;
    evaporation: number;
}

export const DefaultErodeSettings: ErodeSettings = {
    tileSize: 48,
    resolution: 512,
    iterations: 32,
    droplets: 4096,
    erodeRate: 0.28,
    deposit: 0.30,
    talus: 30,
    thermal: 6,
    inertia: 0.06,
    capacity: 0.07,
    evaporation: 0.012,
};

export class ErosionPreview
{
    original: Heightfield | null = null;
    eroded: Float32Array | null = null;
    flow: Float32Array | null = null;

    private fieldPass: FieldPass | null = null;
    private erosionDelta: Float32Array | null = null;
    private erosionSize = 0;
    private erosionTile = 0;
    private erosionSphere: { x: number; y: number; z: number; r: number } | null = null;

    // volumetric
    private volData: Float32Array | null = null;
    private volN = 0;
    private volMin: THREE.Vector3 | null = null;
    private volSize = 0;

    readonly mesh: THREE.Mesh;
    private readonly geom: THREE.PlaneGeometry;
    private readonly mat: THREE.MeshStandardMaterial;
    private visible = false;

    readonly volumeMesh: THREE.Mesh;
    private readonly volumeMat: THREE.MeshStandardMaterial;
    private readonly groundMesh: THREE.Mesh;
    private isVolumeMode = false;

    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly flowCanvas: HTMLCanvasElement;

    private running = false;

    constructor(scene: THREE.Scene, fieldPass?: FieldPass)
    {
        if (fieldPass) this.fieldPass = fieldPass;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 256; this.canvas.height = 256;
        this.canvas.style.width = '256px'; this.canvas.style.height = '256px';
        this.canvas.style.borderRadius = '8px';
        this.canvas.style.display = 'block';
        this.ctx = this.canvas.getContext('2d')!;

        this.flowCanvas = document.createElement('canvas');
        this.flowCanvas.width = 256; this.flowCanvas.height = 256;

        this.geom = new THREE.PlaneGeometry(1, 1, 1, 1);
        this.mat = new THREE.MeshStandardMaterial({
            color: 0x8a7a63, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide, flatShading: false,
        });
        this.mesh = new THREE.Mesh(this.geom, this.mat);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.visible = false; this.mesh.frustumCulled = false;
        scene.add(this.mesh);

        this.volumeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide, flatShading: false, vertexColors: true });
        this.volumeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.volumeMat);
        this.volumeMesh.visible = false; this.volumeMesh.frustumCulled = false;
        scene.add(this.volumeMesh);

        const groundGeom = new THREE.PlaneGeometry(200, 200); groundGeom.rotateX(-Math.PI/2);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.95, side: THREE.DoubleSide });
        this.groundMesh = new THREE.Mesh(groundGeom, groundMat);
        this.groundMesh.position.y = 0.02; this.groundMesh.visible = false;
        scene.add(this.groundMesh);

        this.PaintEmpty();
    }

    BindFieldPass(pass: FieldPass): void {
        this.fieldPass = pass;
        if (this.visible) {
            if (this.volData && this.volMin) pass.SetErosionVolume(this.volData, this.volN, this.volMin, this.volSize);
            else if (this.erosionDelta) pass.SetErosion(this.erosionDelta, this.erosionSize, this.erosionTile, this.erosionSphere);
        }
    }

    SetVisible(v: boolean): void {
        this.visible = v;
        if (this.fieldPass) {
            if (v) {
                if (this.volData && this.volMin) this.fieldPass.SetErosionVolume(this.volData, this.volN, this.volMin, this.volSize);
                else if (this.erosionDelta) this.fieldPass.SetErosion(this.erosionDelta, this.erosionSize, this.erosionTile, this.erosionSphere);
            } else this.fieldPass.ClearErosion();
        }
        this.volumeMesh.visible = false; this.groundMesh.visible = false; this.mesh.visible = false;
    }

    IsVisible(): boolean { return this.visible; }
    HasResult(): boolean { return !!(this.volData || this.erosionDelta || this.eroded); }
    IsRunning(): boolean { return this.running; }
    IsVolumeMode(): boolean { return this.isVolumeMode; }
    GetDelta(): Float32Array | null { return this.erosionDelta; }

    private PaintEmpty(): void {
        this.ctx.fillStyle = '#111'; this.ctx.fillRect(0,0,256,256);
        this.ctx.fillStyle = '#5c5c5c'; this.ctx.font = '11px system-ui'; this.ctx.textAlign='center';
        this.ctx.fillText('No bake yet',128,128); this.ctx.fillText('Connect Erode · press Run',128,142);
    }

    PaintHeightfield(heights: Float32Array, size: number): void {
        let min=Infinity,max=-Infinity; for(let i=0;i<heights.length;i++){const v=heights[i]; if(v<min)min=v; if(v>max)max=v;}
        const range=Math.max(max-min,1e-6);
        const img=this.ctx.createImageData(256,256);
        for(let y=0;y<256;y++) for(let x=0;x<256;x++){
            const sx=Math.floor(x/256*size), sz=Math.floor(y/256*size);
            const h=heights[sz*size+sx]; const t=(h-min)/range;
            const r=t<0.5?Math.round(42+(138-42)*(t*2)):Math.round(138+(232-138)*((t-0.5)*2));
            const g=t<0.5?Math.round(42+(122-42)*(t*2)):Math.round(122+(232-122)*((t-0.5)*2));
            const b=t<0.5?Math.round(42+(99-42)*(t*2)):Math.round(99+(232-99)*((t-0.5)*2));
            const o=(y*256+x)*4; img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=255;
        }
        this.ctx.putImageData(img,0,0);
        this.ctx.fillStyle='rgba(0,0,0,0.55)'; this.ctx.fillRect(0,236,256,20);
        this.ctx.fillStyle='#e8e8e8'; this.ctx.font='10px ui-monospace, monospace'; this.ctx.textAlign='left';
        this.ctx.fillText(`min ${min.toFixed(2)} m  max ${max.toFixed(2)} m  Δ ${(max-min).toFixed(2)} m`,6,249);
    }

    PaintFlow(flow: Float32Array, size: number): void {
        const fc=this.flowCanvas.getContext('2d')!; let max=0; for(let i=0;i<flow.length;i++) if(flow[i]>max) max=flow[i];
        const img=fc.createImageData(256,256);
        for(let y=0;y<256;y++) for(let x=0;x<256;x++){
            const sx=Math.floor(x/256*size), sz=Math.floor(y/256*size);
            const v=flow[sz*size+sx]/Math.max(max,1e-6); const t=Math.pow(Math.min(v*3,1),0.7);
            const r=Math.round(15+t*80), g=Math.round(90+t*80), b=Math.round(180+t*60);
            const o=(y*256+x)*4; img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=255;
        }
        fc.putImageData(img,0,0);
    }

    async BakeAndErode(field: CompiledField, settings: ErodeSettings, onProgress?: (msg:string)=>void): Promise<void> {
        if(this.running) return; this.running=true;
        try {
            const sphere = FindFirstSphere(field);
            this.isVolumeMode = sphere!==null;
            if (sphere) {
                // ── TRUE 3D VOXEL PATH ──
                const N = 68; // ~314k voxels, cell ~0.35m for r=8
                const size = sphere.r * 2.6;
                const min = new THREE.Vector3(sphere.x - size*0.5, sphere.y - size*0.5, sphere.z - size*0.5);
                // Clamp min.y to just below ground so volume includes plane
                if (min.y > -2) min.y = -2;
                onProgress?.(`Voxelizing ${N}³ SDF …`);
                const vol = VoxelizeField(field, N, min, size);
                const mask = new Uint8Array(vol.data.length);
                // surface mask
                {
                    const thresh = vol.cell*1.45;
                    for(let i=0;i<vol.data.length;i++) mask[i] = Math.abs(vol.data[i]) < thresh ? 1:0;
                }
                onProgress?.(`Thermal ${settings.thermal}× …`);
                ThermalErodeVoxels(vol, mask, settings.talus, Math.min(settings.thermal, 3));
                await new Promise<void>(r=>setTimeout(r,16));
                onProgress?.(`Droplets ${settings.droplets}× (3D) …`);
                await DropletErodeVoxelsAsync(vol, mask, settings, (done,total)=>onProgress?.(`Droplets ${done}/${total} …`));
                // preview via top-down heightmap extracted from volume
                const top = VoxelTopHeightmap(vol, 256);
                this.PaintHeightfield(top.heights, 256);
                // store for FieldPass volume
                this.volData = vol.data; this.volN = N; this.volMin = min.clone(); this.volSize = size;
                this.erosionDelta = null; // ensure 2D off
                // also keep a heightfield for flow preview? not needed
                if (this.fieldPass) {
                    this.fieldPass.SetErosionVolume(vol.data, N, min, size);
                    this.visible = true;
                }
                this.volumeMesh.visible=false; this.groundMesh.visible=false; this.mesh.visible=false;
                { let maxD=0; for(let i=0;i<vol.data.length;i++){const a=Math.abs(vol.data[i]); if(a>maxD) maxD=a;} onProgress?.(`Done — SDF volume ${N}³ Δmax ${maxD.toFixed(2)}m erosion active`); }
                return;
            }

            // ── TERRAIN FALLBACK: 2D heightfield Δh texture ──
            const modeLabel='terrain';
            onProgress?.(`Baking ${settings.resolution}² for SDF ${modeLabel} …`);
            const hf=BakeHeightfield(field, settings.resolution, settings.tileSize);
            this.original=hf; this.eroded=new Float32Array(hf.data);
            this.PaintHeightfield(this.eroded, hf.size); await new Promise<void>(r=>setTimeout(r,16));
            if(settings.thermal>0){
                onProgress?.(`Thermal ${settings.thermal}× talus ${settings.talus}° …`);
                ThermalErode(this.eroded, hf.size, hf.cellSize, {talusDeg: settings.talus, iterations: settings.thermal});
                this.PaintHeightfield(this.eroded, hf.size); await new Promise<void>(r=>setTimeout(r,16));
            }
            {
                onProgress?.(`Droplets ${settings.iterations}×${settings.droplets} …`);
                const dParams: DropletParams={iterations: settings.iterations, droplets: settings.droplets, inertia: settings.inertia, capacity: settings.capacity, erosionRate: settings.erodeRate, depositionRate: settings.deposit, evaporation: settings.evaporation, minSlope:0.01};
                const {flow}=await DropletErodeAsync(this.eroded, hf.size, hf.cellSize, dParams,4,(done,total)=>onProgress?.(`Droplets ${done}/${total} …`));
                this.flow=flow; this.PaintFlow(flow,hf.size); this.PaintHeightfield(this.eroded,hf.size);
            }
            const delta=new Float32Array(this.eroded.length);
            for(let i=0;i<delta.length;i++) delta[i]=this.eroded[i]-hf.data[i];
            this.erosionDelta=delta; this.erosionSize=hf.size; this.erosionTile=hf.tileSize; this.erosionSphere=null;
            this.volData=null; this.volMin=null;
            if(this.fieldPass){ this.fieldPass.SetErosion(delta,hf.size,hf.tileSize,null); this.visible=true; }
            this.volumeMesh.visible=false; this.groundMesh.visible=false; this.mesh.visible=false;
            { let maxD=0; for(let i=0;i<delta.length;i++){const a=Math.abs(delta[i]); if(a>maxD) maxD=a;} onProgress?.(`Done — SDF ${modeLabel} ${hf.size}² Δmax ${maxD.toFixed(3)}m erosion active`); }
        } finally { this.running=false; }
    }

    Reset(): void {
        this.original=null; this.eroded=null; this.flow=null;
        this.erosionDelta=null; this.erosionSize=0; this.erosionSphere=null;
        this.volData=null; this.volMin=null; this.volSize=0; this.volN=0;
        this.visible=false; this.mesh.visible=false; this.mesh.position.set(0,0,0);
        this.volumeMesh.visible=false; this.groundMesh.visible=false; this.isVolumeMode=false;
        if(this.fieldPass) this.fieldPass.ClearErosion();
        this.PaintEmpty();
    }

    Dispose(): void {
        this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose();
        this.volumeMesh.geometry.dispose(); (this.volumeMat as THREE.Material).dispose();
        this.groundMesh.geometry.dispose(); (this.groundMesh.material as THREE.Material).dispose();
    }
}
