// SolidScape — Erosion orchestrator 1+2 on 512² tile: thermal → droplet, toggleable preview
// Bakes the live SDF field to a heightfield, runs thermal + droplet, keeps both buffers and exposes a THREE preview mesh + 2D canvas.

import * as THREE from 'three';
import type { CompiledField } from '../sdf';
import { BakeHeightfield, type Heightfield } from './heightfield';
import { ThermalErode } from './thermal';
import { DropletErodeAsync, type DropletParams } from './droplet';

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
    tileSize: 96,
    resolution: 512,
    iterations: 32,
    droplets: 4096,
    erodeRate: 0.28,
    deposit: 0.30,
    talus: 33,
    thermal: 3,
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

    // THREE preview
    readonly mesh: THREE.Mesh;
    private readonly geom: THREE.PlaneGeometry;
    private readonly mat: THREE.MeshStandardMaterial;
    private tileSize = 96;
    private size = 512;
    private visible = false;

    // 2D preview canvas (for node / panel)
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly flowCanvas: HTMLCanvasElement;

    private running = false;

    constructor(scene: THREE.Scene)
    {
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

        // initial empty preview
        this.PaintEmpty();
    }

    SetVisible(v: boolean): void
    {
        this.visible = v;
        this.mesh.visible = v && this.eroded !== null;
    }

    IsVisible(): boolean { return this.visible; }

    HasResult(): boolean { return this.eroded !== null; }

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

    private RebuildMesh(heights: Float32Array, size: number, tileSize: number): void
    {
        this.tileSize = tileSize; this.size = size;
        // rebuild geometry with correct segments
        const newGeom = new THREE.PlaneGeometry(tileSize, tileSize, size - 1, size - 1);
        const pos = newGeom.attributes.position as THREE.BufferAttribute;
        // PlaneGeometry is XY plane centred at 0; after rotation.x = -π/2, Z becomes world Y (height)
        // But easier: write heights into pos.y before rotation? Actually plane's vertices are (x, y, 0) then rotated.
        // After rotation, y = original z? Let's just write into pos.z and let rotation map it.
        // PlaneGeometry: x∈[-w/2,w/2], y∈[-h/2,h/2], z=0. After rotX -90°, y->z, z->y. So height should be z.
        for (let iz = 0; iz < size; iz++)
        {
            for (let ix = 0; ix < size; ix++)
            {
                const idx = iz * size + ix;
                // Plane vertex order is row-major y then x? THREE builds row x then y: index = iy* (nx+1)+ix
                // Our iz corresponds to y = tileSize/2 - iz*cellSize ?? Need to map.
                // PlaneGeometry y = (1 - v)*h - h/2 where v = iy/(ny). So iy=0 → y=+h/2 (top). Our iz=0 → worldMin (-tile/2) bottom.
                // So invert iz.
                const iy = size - 1 - iz;
                const vIdx = iy * size + ix;
                pos.setZ(vIdx, heights[idx]);
            }
        }
        pos.needsUpdate = true;
        newGeom.computeVertexNormals();
        // swap
        this.mesh.geometry.dispose();
        (this.mesh.geometry as THREE.BufferGeometry) = newGeom;
        // keep reference for future dispose
        (this as unknown as { geom: THREE.BufferGeometry }).geom = newGeom as unknown as THREE.PlaneGeometry;
        this.mesh.visible = this.visible;
    }

    PaintHeightfield(heights: Float32Array, size: number): void
    {
        // find min/max for normalization
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < heights.length; i++) { const v = heights[i]; if (v < min) min = v; if (v > max) max = v; }
        const range = Math.max(max - min, 1e-6);
        // draw to 256 canvas via downsample
        const img = this.ctx.createImageData(256, 256);
        for (let y = 0; y < 256; y++)
        {
            for (let x = 0; x < 256; x++)
            {
                const sx = Math.floor(x / 256 * size);
                const sz = Math.floor(y / 256 * size);
                const h = heights[sz * size + sx];
                const t = (h - min) / range;
                // height ramp: dark ground → sand → grey rock → white peak
                // use simple gradient: 0= #2a2a2a, 0.5= #8a7a63, 1= #e8e8e8
                const r = t < 0.5 ? Math.round(42 + (138 - 42) * (t * 2)) : Math.round(138 + (232 - 138) * ((t - 0.5) * 2));
                const g = t < 0.5 ? Math.round(42 + (122 - 42) * (t * 2)) : Math.round(122 + (232 - 122) * ((t - 0.5) * 2));
                const b = t < 0.5 ? Math.round(42 + (99 - 42) * (t * 2)) : Math.round(99 + (232 - 99) * ((t - 0.5) * 2));
                const o = (y * 256 + x) * 4;
                img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
            }
        }
        this.ctx.putImageData(img, 0, 0);
        // overlay label
        this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this.ctx.fillRect(0, 236, 256, 20);
        this.ctx.fillStyle = '#e8e8e8';
        this.ctx.font = '10px ui-monospace, monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`min ${min.toFixed(2)} m  max ${max.toFixed(2)} m  Δ ${(max - min).toFixed(2)} m`, 6, 249);
    }

    PaintFlow(flow: Float32Array, size: number): void
    {
        // flow preview drawn to same canvas as overlay? Keep separate but also composite faint on height?
        // For now paint flow to flowCanvas for export
        const fc = this.flowCanvas.getContext('2d')!;
        let max = 0; for (let i = 0; i < flow.length; i++) if (flow[i] > max) max = flow[i];
        const img = fc.createImageData(256, 256);
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++)
        {
            const sx = Math.floor(x / 256 * size), sz = Math.floor(y / 256 * size);
            const v = flow[sz * size + sx] / Math.max(max, 1e-6);
            const t = Math.pow(Math.min(v * 3, 1), 0.7); // amplify low flow
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
            onProgress?.(`Baking ${settings.resolution}² …`);
            // Bake must be async to not block UI; yield between row batches
            const hf = BakeHeightfield(field, settings.resolution, settings.tileSize);
            this.original = hf;
            this.size = hf.size; this.tileSize = hf.tileSize;
            this.eroded = new Float32Array(hf.data); // copy
            this.PaintHeightfield(this.eroded, this.size);
            await new Promise<void>(r => setTimeout(r, 16));

            if (settings.thermal > 0)
            {
                onProgress?.(`Thermal ${settings.thermal}× talus ${settings.talus}° …`);
                ThermalErode(this.eroded, this.size, hf.cellSize, { talusDeg: settings.talus, iterations: settings.thermal });
                this.PaintHeightfield(this.eroded, this.size);
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
                const { flow } = await DropletErodeAsync(this.eroded, this.size, hf.cellSize, dParams, 4,
                    (done, total) => onProgress?.(`Droplets ${done}/${total} …`));
                this.flow = flow;
                this.PaintFlow(flow, this.size);
                this.PaintHeightfield(this.eroded, this.size);
            }

            onProgress?.(`Building preview mesh …`);
            this.RebuildMesh(this.eroded, this.size, this.tileSize);
            onProgress?.(`Done — Δh max ${(this.original.maxH - Math.min(...this.eroded)).toFixed(3)} m`);
        } finally { this.running = false; }
    }

    Reset(): void
    {
        this.original = null;
        this.eroded = null;
        this.flow = null;
        this.mesh.visible = false;
        this.PaintEmpty();
    }

    Dispose(): void
    {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
