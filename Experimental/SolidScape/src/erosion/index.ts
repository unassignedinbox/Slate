// SolidScape — Erosion orchestrator 1+2 on 512² tile: thermal → droplet, toggleable preview
// Bakes the live SDF field to a heightfield, runs thermal + droplet, keeps both buffers and exposes a THREE preview mesh + 2D canvas.
// New: if the field is a single SDF sphere (the test scene), we bypass the heightmap
// entirely and erode a true 3D icosphere mesh along its surface — no stretched pillar.

import * as THREE from 'three';
import type { CompiledField } from '../sdf';
import { BakeHeightfield, type Heightfield } from './heightfield';
import { ThermalErode } from './thermal';
import { DropletErodeAsync, type DropletParams } from './droplet';
import { FindFirstSphere, CreateSphereFromHeightfield } from './volume';

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
    tileSize: 48, // tight enough for sphere test (r8 dome = 16m) — 96 was showing a huge flat apron around the pillar
    resolution: 512,
    iterations: 32,
    droplets: 4096,
    erodeRate: 0.28,
    deposit: 0.30,
    talus: 30,
    thermal: 6, // extra slump so the 8m sphere→ground cliff becomes a talus cone instead of a vertical pillar
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

    // THREE preview — heightmap plane
    readonly mesh: THREE.Mesh;
    private readonly geom: THREE.PlaneGeometry;
    private readonly mat: THREE.MeshStandardMaterial;
    private tileSize = 96;
    private size = 512;
    private visible = false;

    // 3D SDF preview — true volumetric sphere (icosphere) when the field is a sphere
    readonly volumeMesh: THREE.Mesh;
    private readonly volumeMat: THREE.MeshStandardMaterial;
    private readonly groundMesh: THREE.Mesh;
    private isVolumeMode = false;

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
        this.groundMesh.position.y = 0.02; // avoid z-fighting
        this.groundMesh.visible = false;
        this.groundMesh.receiveShadow = false;
        scene.add(this.groundMesh);

        // initial empty preview
        this.PaintEmpty();
    }

    SetVisible(v: boolean): void
    {
        this.visible = v;
        if (this.isVolumeMode) {
            const hasVol = this.volumeMesh.geometry.attributes.position !== undefined && (this.volumeMesh.geometry.attributes.position as THREE.BufferAttribute).count > 0;
            this.volumeMesh.visible = v && hasVol;
            this.groundMesh.visible = v && hasVol;
        } else this.mesh.visible = v && this.eroded !== null;
    }

    IsVisible(): boolean { return this.visible; }

    HasResult(): boolean { return this.isVolumeMode ? (this.volumeMesh.geometry.attributes.position !== undefined && (this.volumeMesh.geometry.attributes.position as THREE.BufferAttribute).count > 0) : this.eroded !== null; }

    IsVolumeMode(): boolean { return this.isVolumeMode; }

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
        // SDF vs heightmap: a sphere on a plane bakes to a dome with an 8m vertical cliff at r=8.
        // Showing the full 96m tile makes that cliff look like a stretched pillar on a table.
        // Crop the preview mesh to the content bounds (≈ dome + talus) so it reads as a rock, not a table.
        const worldMin = -tileSize * 0.5;
        const cellSize = tileSize / (size - 1);
        const hThresh = 0.08; // above ground
        let minX = size, maxX = -1, minZ = size, maxZ = -1;
        for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) if (heights[z * size + x] > hThresh) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
        let meshW = tileSize, meshD = tileSize, offX = 0, offZ = 0, srcMinX = 0, srcMaxX = size - 1, srcMinZ = 0, srcMaxZ = size - 1;
        if (maxX >= 0 && (maxX - minX) < size * 0.85)
        {
            const pad = Math.ceil(2 / cellSize) + 2; // ~2m apron + 2 cells for filtering
            srcMinX = Math.max(0, minX - pad); srcMaxX = Math.min(size - 1, maxX + pad);
            srcMinZ = Math.max(0, minZ - pad); srcMaxZ = Math.min(size - 1, maxZ + pad);
            meshW = (srcMaxX - srcMinX) * cellSize; meshD = (srcMaxZ - srcMinZ) * cellSize;
            offX = worldMin + (srcMinX + srcMaxX) * 0.5 * cellSize;
            offZ = worldMin + (srcMinZ + srcMaxZ) * 0.5 * cellSize;
        }
        // cap preview segments to 256 for perf/memory — bake is still 512², display is downsampled but cropped
        const disp = Math.min(256, Math.max(srcMaxX - srcMinX + 1, srcMaxZ - srcMinZ + 1, 64));
        const seg = disp - 1;
        const newGeom = new THREE.PlaneGeometry(meshW, meshD, seg, seg);
        const pos = newGeom.attributes.position as THREE.BufferAttribute;
        for (let iz = 0; iz < disp; iz++)
        {
            const t = disp === 1 ? 0 : iz / seg;
            const srcZ = Math.round(srcMinZ + t * (srcMaxZ - srcMinZ));
            for (let ix = 0; ix < disp; ix++)
            {
                const s = disp === 1 ? 0 : ix / seg;
                const srcX = Math.round(srcMinX + s * (srcMaxX - srcMinX));
                const h = heights[Math.min(size - 1, srcZ) * size + Math.min(size - 1, srcX)];
                const iy = disp - 1 - iz;
                const vIdx = iy * disp + ix;
                pos.setZ(vIdx, h);
            }
        }
        pos.needsUpdate = true;
        newGeom.computeVertexNormals();
        const old = this.mesh.geometry as THREE.BufferGeometry;
        this.mesh.geometry = newGeom;
        old.dispose();
        (this as unknown as { geom: THREE.BufferGeometry }).geom = newGeom as unknown as THREE.PlaneGeometry;
        this.mesh.position.set(offX, 0, offZ);
        this.mesh.visible = this.visible && this.eroded !== null;
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
            // 3D path: if the field is dominantly a sphere, do true volumetric mesh erosion
            // Hybrid: run the proven 512² heightfield sim, then displace a real icosphere
            // with its delta — so gullies have the quality of the heightfield sim but
            // wrap around the sphere in 3D (no pillar).
            const sphere = FindFirstSphere(field);
            const useVolume = sphere !== null;
            if (useVolume && sphere) {
                this.isVolumeMode = true;
                this.mesh.visible = false;
                onProgress?.(`Baking ${settings.resolution}² heightfield for 3D displacement …`);
                const hf = BakeHeightfield(field, settings.resolution, settings.tileSize);
                this.original = hf; this.size = hf.size; this.tileSize = hf.tileSize;
                this.eroded = new Float32Array(hf.data);
                this.PaintHeightfield(this.eroded, this.size);
                await new Promise<void>(r => setTimeout(r, 16));
                if (settings.thermal > 0) {
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
                onProgress?.(`Displacing 3D sphere with heightfield …`);
                const geom = CreateSphereFromHeightfield(sphere, hf.data, this.eroded, this.size, this.tileSize);
                this.volumeMesh.geometry.dispose();
                this.volumeMesh.geometry = geom;
                this.volumeMesh.visible = this.visible;
                { let minE = Infinity; for (let i = 0; i < this.eroded.length; i++) if (this.eroded[i] < minE) minE = this.eroded[i]; onProgress?.(`Done — 3D sphere ${sphere.r.toFixed(1)}m, ${(geom.attributes.position as THREE.BufferAttribute).count} verts, Δh ${(hf.maxH - minE).toFixed(2)}m`); }
                return;
            }
            this.isVolumeMode = false;
            this.volumeMesh.visible = false;
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
            { let minE = Infinity; for (let i = 0; i < this.eroded.length; i++) if (this.eroded[i] < minE) minE = this.eroded[i]; onProgress?.(`Done — Δh max ${(this.original.maxH - minE).toFixed(3)} m`); }
        } finally { this.running = false; }
    }

    Reset(): void
    {
        this.original = null;
        this.eroded = null;
        this.flow = null;
        this.mesh.visible = false;
        this.mesh.position.set(0, 0, 0);
        this.volumeMesh.visible = false;
        this.groundMesh.visible = false;
        this.isVolumeMode = false;
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
