// SolidScape — Erosion orchestrator 1+2 on 512² tile: thermal → droplet, true SDF erosion
// Bakes the live SDF field to a heightfield, runs thermal + droplet, computes Δh = eroded-original
// and uploads it as an R32F erosion texture to FieldPass. The raymarcher displaces Field() itself
// (Field - Δ*w) — no separate mesh, no heightmap plane — true volumetric SDF erosion.

import * as THREE from 'three';
import type { CompiledField } from '../sdf';
import { BakeHeightfield, type Heightfield } from './heightfield';
import { ThermalErode } from './thermal';
import { DropletErodeAsync, type DropletParams } from './droplet';
import { FindFirstSphere } from './volume';
import type { FieldPass } from '../sdfPass';

export interface ErodeSettings
{
    tileSize: number;   // [m]
    resolution: number; // px (128..512)
    iterations: number; // droplet outer iters
    droplets: number;   // per iter
    erodeRate: number;
    deposit: number;
    talus: number;      // deg
    thermal: number;    // iters
    // hidden stable defaults
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
    // height buffers
    original: Heightfield | null = null;
    eroded: Float32Array | null = null;
    flow: Float32Array | null = null;

    // SDF erosion texture state (shared with FieldPass)
    private fieldPass: FieldPass | null = null;
    private erosionDelta: Float32Array | null = null;
    private erosionSize = 0;
    private erosionTile = 0;
    private erosionSphere: { x: number; y: number; z: number; r: number } | null = null;

    // THREE preview — keeps a minimal mesh for external callers but hidden in SDF mode
    // (groundMesh/volumeMesh retained for API compat — never shown for SDF erosion)
    readonly mesh: THREE.Mesh;
    private readonly geom: THREE.PlaneGeometry;
    private readonly mat: THREE.MeshStandardMaterial;
    private visible = false;

    // legacy 3D meshes — kept but hidden (SDF erosion shows in FieldPass instead)
    readonly volumeMesh: THREE.Mesh;
    private readonly volumeMat: THREE.MeshStandardMaterial;
    private readonly groundMesh: THREE.Mesh;
    private isVolumeMode = false;

    // 2D preview canvas (for node / panel)
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
            color: 0x8a7a63,
            roughness: 0.92,
            metalness: 0.0,
            side: THREE.DoubleSide,
            flatShading: false,
            wireframe: false,
        });
        this.mesh = new THREE.Mesh(this.geom, this.mat);
        this.mesh.rotation.x = -Math.PI / 2;
        this.mesh.visible = false;
        this.mesh.receiveShadow = false;
        this.mesh.castShadow = false;
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);

        this.volumeMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.88,
            metalness: 0.0,
            side: THREE.DoubleSide,
            flatShading: false,
            vertexColors: true,
        });
        this.volumeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.volumeMat);
        this.volumeMesh.visible = false;
        this.volumeMesh.frustumCulled = false;
        this.volumeMesh.castShadow = false;
        this.volumeMesh.receiveShadow = false;
        scene.add(this.volumeMesh);

        const groundGeom = new THREE.PlaneGeometry(200, 200);
        groundGeom.rotateX(-Math.PI / 2);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.95, side: THREE.DoubleSide });
        this.groundMesh = new THREE.Mesh(groundGeom, groundMat);
        this.groundMesh.position.y = 0.02;
        this.groundMesh.visible = false;
        this.groundMesh.receiveShadow = false;
        scene.add(this.groundMesh);

        this.PaintEmpty();
    }

    BindFieldPass(pass: FieldPass): void { this.fieldPass = pass; if (this.erosionDelta && this.visible) pass.SetErosion(this.erosionDelta, this.erosionSize, this.erosionTile, this.erosionSphere); }

    SetVisible(v: boolean): void
    {
        this.visible = v;
        // SDF erosion: toggle the FieldPass displacement. Legacy meshes stay hidden.
        if (this.erosionDelta && this.fieldPass) {
            if (v) this.fieldPass.SetErosion(this.erosionDelta, this.erosionSize, this.erosionTile, this.erosionSphere);
            else this.fieldPass.ClearErosion();
        }
        // keep legacy meshes hidden — SDF preview is the raymarched field itself
        this.volumeMesh.visible = false;
        this.groundMesh.visible = false;
        this.mesh.visible = false;
    }

    IsVisible(): boolean { return this.visible; }

    HasResult(): boolean { return this.erosionDelta !== null || this.eroded !== null; }

    IsVolumeMode(): boolean { return this.isVolumeMode; }

    GetDelta(): Float32Array | null { return this.erosionDelta; }

    private PaintEmpty(): void
    {
        this.ctx.fillStyle = '#111';
        this.ctx.fillRect(0, 0, 256, 256);
        this.ctx.fillStyle = '#5c5c5c';
        this.ctx.font = '11px system-ui';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('No bake yet', 128, 128);
        this.ctx.fillText('Connect Erode · press Run', 128, 142);
    }

    PaintHeightfield(heights: Float32Array, size: number): void
    {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < heights.length; i++) { const v = heights[i]; if (v < min) min = v; if (v > max) max = v; }
        const range = Math.max(max - min, 1e-6);
        const img = this.ctx.createImageData(256, 256);
        for (let y = 0; y < 256; y++)
        {
            for (let x = 0; x < 256; x++)
            {
                const sx = Math.floor(x / 256 * size);
                const sz = Math.floor(y / 256 * size);
                const h = heights[sz * size + sx];
                const t = (h - min) / range;
                const r = t < 0.5 ? Math.round(42 + (138 - 42) * (t * 2)) : Math.round(138 + (232 - 138) * ((t - 0.5) * 2));
                const g = t < 0.5 ? Math.round(42 + (122 - 42) * (t * 2)) : Math.round(122 + (232 - 122) * ((t - 0.5) * 2));
                const b = t < 0.5 ? Math.round(42 + (99 - 42) * (t * 2)) : Math.round(99 + (232 - 99) * ((t - 0.5) * 2));
                const o = (y * 256 + x) * 4;
                img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
            }
        }
        this.ctx.putImageData(img, 0, 0);
        this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.ctx.fillRect(0, 236, 256, 20);
        this.ctx.fillStyle = '#e8e8e8';
        this.ctx.font = '10px ui-monospace, monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`min ${min.toFixed(2)} m  max ${max.toFixed(2)} m  Δ ${(max - min).toFixed(2)} m`, 6, 249);
    }

    PaintFlow(flow: Float32Array, size: number): void
    {
        const fc = this.flowCanvas.getContext('2d')!;
        let max = 0; for (let i = 0; i < flow.length; i++) if (flow[i] > max) max = flow[i];
        const img = fc.createImageData(256, 256);
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++)
        {
            const sx = Math.floor(x / 256 * size), sz = Math.floor(y / 256 * size);
            const v = flow[sz * size + sx] / Math.max(max, 1e-6);
            const t = Math.pow(Math.min(v * 3, 1), 0.7);
            const r = Math.round(15 + t * 80), g = Math.round(90 + t * 80), b = Math.round(180 + t * 60);
            const o = (y * 256 + x) * 4; img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=255;
        }
        fc.putImageData(img,0,0);
    }

    async BakeAndErode(field: CompiledField, settings: ErodeSettings, onProgress?: (msg: string) => void): Promise<void>
    {
        if (this.running) return;
        this.running = true;
        try
        {
            // True SDF erosion: bake 512² heightfield → sim → Δh texture → FieldPass displaces SDF
            // Same sim quality as before, but the result displaces the field, not a mesh.
            const sphere = FindFirstSphere(field);
            this.isVolumeMode = sphere !== null;
            const modeLabel = sphere ? `sphere r${sphere.r.toFixed(1)}m` : 'terrain';

            onProgress?.(`Baking ${settings.resolution}² for SDF ${modeLabel} …`);
            const hf = BakeHeightfield(field, settings.resolution, settings.tileSize);
            this.original = hf;
            this.eroded = new Float32Array(hf.data);
            this.PaintHeightfield(this.eroded, hf.size);
            await new Promise<void>(r => setTimeout(r, 16));

            if (settings.thermal > 0) {
                onProgress?.(`Thermal ${settings.thermal}× talus ${settings.talus}° …`);
                ThermalErode(this.eroded, hf.size, hf.cellSize, { talusDeg: settings.talus, iterations: settings.thermal });
                this.PaintHeightfield(this.eroded, hf.size);
                await new Promise<void>(r => setTimeout(r, 16));
            }

            {
                onProgress?.(`Droplets ${settings.iterations}×${settings.droplets} …`);
                const dParams: DropletParams = {
                    iterations: settings.iterations,
                    droplets: settings.droplets,
                    inertia: settings.inertia,
                    capacity: settings.capacity,
                    erosionRate: settings.erodeRate,
                    depositionRate: settings.deposit,
                    evaporation: settings.evaporation,
                    minSlope: 0.01,
                };
                const { flow } = await DropletErodeAsync(this.eroded, hf.size, hf.cellSize, dParams, 4,
                    (done, total) => onProgress?.(`Droplets ${done}/${total} …`));
                this.flow = flow;
                this.PaintFlow(flow, hf.size);
                this.PaintHeightfield(this.eroded, hf.size);
            }

            // Build Δh = eroded - original (512² R32F). This is the SDF displacement field.
            const delta = new Float32Array(this.eroded.length);
            for (let i = 0; i < delta.length; i++) delta[i] = this.eroded[i] - hf.data[i];
            this.erosionDelta = delta;
            this.erosionSize = hf.size;
            this.erosionTile = hf.tileSize;
            this.erosionSphere = sphere ? { x: sphere.x, y: sphere.y, z: sphere.z, r: sphere.r } : null;

            if (this.fieldPass) {
                this.fieldPass.SetErosion(delta, hf.size, hf.tileSize, this.erosionSphere);
                this.visible = true;
            }
            // keep meshes hidden — SDF raymarch is the preview
            this.volumeMesh.visible = false;
            this.groundMesh.visible = false;
            this.mesh.visible = false;

            { let minE = Infinity, maxD = 0; for (let i = 0; i < this.eroded.length; i++) if (this.eroded[i] < minE) minE = this.eroded[i]; for (let i = 0; i < delta.length; i++) { const a = Math.abs(delta[i]); if (a > maxD) maxD = a; } onProgress?.(`Done — SDF ${modeLabel}  ${hf.size}² Δmax ${maxD.toFixed(3)}m  erosion active`); }
        } finally { this.running = false; }
    }

    Reset(): void
    {
        this.original = null;
        this.eroded = null;
        this.flow = null;
        this.erosionDelta = null;
        this.erosionSize = 0;
        this.erosionSphere = null;
        this.visible = false;
        this.mesh.visible = false;
        this.mesh.position.set(0, 0, 0);
        this.volumeMesh.visible = false;
        this.groundMesh.visible = false;
        this.isVolumeMode = false;
        if (this.fieldPass) this.fieldPass.ClearErosion();
        this.PaintEmpty();
    }

    Dispose(): void
    {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.volumeMesh.geometry.dispose();
        (this.volumeMat as THREE.Material).dispose();
        this.groundMesh.geometry.dispose();
        (this.groundMesh.material as THREE.Material).dispose();
    }
}
