//==========================================================================================
// Terrain engine — owns every GPU resource and encodes the simulation + render schedule.
//
// One compute bind group layout serves every solver pass; the Frame uniform lives in a ring of
// 512-byte slots and each pass binds its own slot through a dynamic offset, so per-pass ping
// pong indices never require a buffer rewrite mid-submit.
//==========================================================================================

import { FrameRing, QUALITY_PRESETS, WORLD_EXTENT, SLOT_BYTES } from './uniforms.js';
import { bakeShader } from './shaders/bake.js';
import { applyShader } from './shaders/apply.js';
import { refineShader } from './shaders/refine.js';
import { surfaceShader } from './shaders/surface.js';
import { hydrologyShader } from './shaders/hydrology.js';
import { particlesShader } from './shaders/particles.js';
import { thermalShader } from './shaders/thermal.js';
import { renderShader } from './shaders/render.js';
import { createShaderModuleChecked } from './device.js';
import { GRID_PLANES, GRID_PLANE_COUNT } from './gridPlanes.js';

const P = GRID_PLANES;

export class TerrainEngine
{
    constructor(device, format, report)
    {
        this.device = device;
        this.format = format;
        this.report = report || (() => {});
        this.ring = new FrameRing(96);
        this.pipelines = null;
        this.graphSignature = null;
        this.countersReadback = null;
        this.countersPending = false;
        this.frameStats = { eroded: 0, deposited: 0, carried: 0, escaped: 0, alive: 0, spawned: 0, dead: 0 };
        this.bakeDirty = true;
        this.bakeStride = 1;
        this.accumPlane = P.accumA;
        this.step = 0;
        this.parity = 0;
        this.time = 0;
        this.refineCounter = 0;
        this.textureWidth = 1;
        this.textureHeight = 1;
    }

    //------------------------------------------------------------------------------------------
    // Resource allocation
    //------------------------------------------------------------------------------------------
    configure(options)
    {
        const preset = QUALITY_PRESETS[options.quality] || QUALITY_PRESETS.standard;
        this.options = { ...options, preset };
        const [nx, ny, nz] = preset.dims;
        const world = options.world || WORLD_EXTENT[0];
        const voxel = world / nx;
        const lo = [-world * 0.5, 0, -world * 0.5];
        const hi = [world * 0.5, ny * voxel, world * 0.5];

        this.grid = { nx, ny, nz, hyd: preset.hyd, voxel, lo, hi, world };
        this.poolSize = preset.particles;
        this.maxMarchSteps = preset.marchSteps;

        const device = this.device;
        const destroy = (resource) => resource?.destroy?.();
        const previous = this.resources;
        if (previous)
        {
            for (const resource of Object.values(previous))
            {
                if (resource && typeof resource.destroy === 'function')
                {
                    resource.destroy();
                }
            }
        }
        void destroy;

        const volumeUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
        const volumeSize = { width: nx, height: ny, depthOrArrayLayers: nz };
        const makeVolume = (format, label) => device.createTexture({
            label, size: volumeSize, dimension: '3d', format, usage: volumeUsage,
        });

        const hydUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST;
        const makeWater = (label) => device.createTexture({
            label,
            size: { width: preset.hyd, height: preset.hyd },
            format: 'rgba16float',
            usage: hydUsage,
        });

        const deltasBytes = nx * ny * nz * 4;
        const gridBytes = GRID_PLANE_COUNT * preset.hyd * preset.hyd * 4;
        const atomicBytes = 2 * preset.hyd * preset.hyd * 4;
        const counterBytes = 256;

        this.resources = {
            sdfA: makeVolume('r32float', 'sdfA'),
            sdfB: makeVolume('r32float', 'sdfB'),
            matA: makeVolume('rgba16float', 'matA'),
            matB: makeVolume('rgba16float', 'matB'),
            waterTex: makeWater('waterA'),
            waterTex2: makeWater('waterB'),
            deltas: device.createBuffer({ label: 'deltas', size: deltasBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
            grid: device.createBuffer({ label: 'grid', size: gridBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
            gridAtomic: device.createBuffer({ label: 'gridAtomic', size: atomicBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
            counters: device.createBuffer({ label: 'counters', size: counterBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }),
            particles: device.createBuffer({ label: 'particles', size: this.poolSize * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
            uniforms: device.createBuffer({ label: 'frameRing', size: this.ring.byteLength(), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
            graphParams: device.createBuffer({ label: 'graphParams', size: 64 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
            staging: device.createBuffer({ label: 'staging', size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        };
        this.countersReadback = null;

        // Zero the planar fields and the particle pool so a fresh terrain starts clean.
        device.queue.writeBuffer(this.resources.grid, 0, new Float32Array(GRID_PLANE_COUNT * preset.hyd * preset.hyd));
        device.queue.writeBuffer(this.resources.gridAtomic, 0, new Int32Array(2 * preset.hyd * preset.hyd));
        device.queue.writeBuffer(this.resources.counters, 0, new Uint32Array(64));

        this.targets = null;
        this.pipelines = null;
        this.bakeDirty = true;
        this.step = 0;
        this.time = 0;
        this.parity = 0;
        this.accumPlane = P.accumA;
    }

    setTargetSize(width, height)
    {
        const w = Math.max(64, Math.floor(width));
        const h = Math.max(64, Math.floor(height));
        if (this.textureWidth === w && this.textureHeight === h && this.targets)
        {
            return;
        }
        this.textureWidth = w;
        this.textureHeight = h;
        const device = this.device;
        if (this.targets)
        {
            for (const target of Object.values(this.targets))
            {
                target.destroy?.();
            }
        }
        this.targets = {
            color: device.createTexture({
                label: 'color',
                size: { width: w, height: h },
                format: 'rgba16float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }),
            depth: device.createTexture({
                label: 'depth',
                size: { width: w, height: h },
                format: 'r32float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }),
            accum: device.createTexture({
                label: 'accum',
                size: { width: w, height: h },
                format: 'rgba16float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            }),
        };
        // Only the render bind groups reference these targets; the pipelines and their shader
        // modules stay valid, so a resize costs bind group creation and nothing else.
        this.renderGroups = null;
        this.attachmentGroups = null;
        if (this.renderLayout)
        {
            this.makeBindGroups();
        }
    }

    //------------------------------------------------------------------------------------------
    // Pipelines
    //------------------------------------------------------------------------------------------
    buildPipelines(graphWgsl, signature)
    {
        const device = this.device;
        if (this.pipelines && signature === this.graphSignature)
        {
            if (!this.renderGroups)
            {
                this.makeBindGroups();
            }
            return false;
        }
        this.graphSignature = signature;
        const report = this.report;
        const module = (label, code) => createShaderModuleChecked(device, label, code, report);
        const sources = {
            bake: module('bake.wgsl', bakeShader(graphWgsl)),
            apply: module('apply.wgsl', applyShader(graphWgsl)),
            refine: module('refine.wgsl', refineShader(graphWgsl)),
            surface: module('surface.wgsl', surfaceShader(graphWgsl)),
            hydrology: module('hydrology.wgsl', hydrologyShader(graphWgsl)),
            particles: module('particles.wgsl', particlesShader(graphWgsl)),
            thermal: module('thermal.wgsl', thermalShader(graphWgsl)),
            render: module('render.wgsl', renderShader(graphWgsl)),
        };

        const simLayout = device.createBindGroupLayout({
            label: 'sim',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '3d' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '3d' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 12, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
                { binding: 13, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
            ],
        });

        const renderLayout = device.createBindGroupLayout({
            label: 'render',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 128 } },
                { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '3d' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
                { binding: 7, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 8, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
                { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
                { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
            ],
        });

        this.simLayout = simLayout;
        this.renderLayout = renderLayout;
        const pipelineLayout = (layout) => device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const simPipeline = (label, entryPoint, moduleKey) => device.createComputePipeline({
            label,
            layout: pipelineLayout(simLayout),
            compute: { module: sources[moduleKey], entryPoint },
        });

        this.pipelines = {
            bake: simPipeline('bake', 'bakeGraph', 'bake'),
            apply: simPipeline('apply', 'applyDeltas', 'apply'),
            refine: simPipeline('refine', 'refineBand', 'refine'),
            surfaceScan: simPipeline('surfaceScan', 'surfaceScan', 'surface'),
            climate: simPipeline('climate', 'climatePass', 'surface'),
            wind: simPipeline('wind', 'windPass', 'surface'),
            fillSeed: simPipeline('fillSeed', 'hydFillSeed', 'hydrology'),
            fillStep: simPipeline('fillStep', 'hydFillStep', 'hydrology'),
            route: simPipeline('route', 'flowRoute', 'hydrology'),
            accumulate: simPipeline('accumulate', 'flowAccumulate', 'hydrology'),
            waterFlux: simPipeline('waterFlux', 'waterFlux', 'hydrology'),
            waterApply: simPipeline('waterApply', 'waterApply', 'hydrology'),
            waterVelocity: simPipeline('waterVelocity', 'waterVelocity', 'hydrology'),
            erode: simPipeline('erode', 'erodeDeposit', 'hydrology'),
            sediment: simPipeline('sediment', 'sedimentGather', 'hydrology'),
            transport: simPipeline('transport', 'sedimentTransport', 'hydrology'),
            publishWater: simPipeline('publishWater', 'publishWater', 'hydrology'),
            particleStep: simPipeline('particleStep', 'particleStep', 'particles'),
            particleCount: simPipeline('particleCount', 'particleCount', 'particles'),
            thermal: simPipeline('thermal', 'thermalStep', 'thermal'),
            clearDeltas: simPipeline('clearDeltas', 'clearDeltas', 'thermal'),
            clearCounters: simPipeline('clearCounters', 'clearCounters', 'thermal'),
        };

        this.renderPipelines = {
            terrain: device.createRenderPipeline({
                label: 'terrain',
                layout: pipelineLayout(renderLayout),
                vertex: { module: sources.render, entryPoint: 'fullscreenVertex' },
                fragment: {
                    module: sources.render,
                    entryPoint: 'terrainFragment',
                    targets: [{ format: 'rgba16float' }, { format: 'r32float' }],
                },
                primitive: { topology: 'triangle-list' },
            }),
            water: device.createRenderPipeline({
                label: 'water',
                layout: pipelineLayout(renderLayout),
                vertex: { module: sources.render, entryPoint: 'waterVertex' },
                fragment: {
                    module: sources.render,
                    entryPoint: 'waterFragment',
                    targets: [{
                        format: 'rgba16float',
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: { topology: 'triangle-list' },
            }),
            points: device.createRenderPipeline({
                label: 'points',
                layout: pipelineLayout(renderLayout),
                vertex: { module: sources.render, entryPoint: 'pointVertex' },
                fragment: {
                    module: sources.render,
                    entryPoint: 'pointFragment',
                    targets: [{
                        format: 'rgba16float',
                        blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        },
                    }],
                },
                primitive: { topology: 'triangle-list' },
            }),
            accumulate: device.createRenderPipeline({
                label: 'accumulate',
                layout: pipelineLayout(renderLayout),
                vertex: { module: sources.render, entryPoint: 'presentVertex' },
                fragment: {
                    module: sources.render,
                    entryPoint: 'accumulateFragment',
                    targets: [{
                        format: 'rgba16float',
                        blend: {
                            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                        },
                    }],
                },
                primitive: { topology: 'triangle-list' },
            }),
            present: device.createRenderPipeline({
                label: 'present',
                layout: pipelineLayout(renderLayout),
                vertex: { module: sources.render, entryPoint: 'presentVertex' },
                fragment: {
                    module: sources.render,
                    entryPoint: 'presentFragment',
                    targets: [{ format: this.format }],
                },
                primitive: { topology: 'triangle-list' },
            }),
        };

        this.makeBindGroups();
        return true;
    }

    makeBindGroups()
    {
        const device = this.device;
        const r = this.resources;
        const sampler = this.sampler || (this.sampler = device.createSampler({
            label: 'linear',
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
        }));
        const volumeView = (texture) => texture.createView({ dimension: '3d' });
        const pair = (readSdf, readMat, writeSdf, writeMat) => device.createBindGroup({
            label: 'sim',
            layout: this.simLayout,
            entries: [
                { binding: 0, resource: { buffer: r.uniforms, offset: 0, size: SLOT_BYTES } },
                { binding: 1, resource: { buffer: r.graphParams } },
                { binding: 2, resource: volumeView(readSdf) },
                { binding: 3, resource: volumeView(readMat) },
                { binding: 4, resource: sampler },
                { binding: 5, resource: writeSdf.createView({ dimension: '3d' }) },
                { binding: 6, resource: writeMat.createView({ dimension: '3d' }) },
                { binding: 7, resource: { buffer: r.deltas } },
                { binding: 8, resource: { buffer: r.particles } },
                { binding: 9, resource: { buffer: r.grid } },
                { binding: 10, resource: { buffer: r.gridAtomic } },
                { binding: 11, resource: { buffer: r.counters } },
                { binding: 12, resource: r.waterTex.createView() },
                { binding: 13, resource: r.waterTex2.createView() },
            ],
        });
        this.simGroups = [pair(r.sdfA, r.matA, r.sdfB, r.matB), pair(r.sdfB, r.matB, r.sdfA, r.matA)];

        if (!this.targets)
        {
            return;
        }
        const t = this.targets;
        const water = r.waterTex.createView();
        // A texture may not be sampled in the same pass that writes it, so the two families of
        // passes get their own bind groups. "attachments" is used where colour and depth are
        // render targets (terrain, present); "scene" is used where the off-screen colour and
        // depth buffers are read back as textures (water, parcels, accumulation).
        const group = (parity, label, nine, ten, eleven) => device.createBindGroup({
            label: `${label}${parity}`,
            layout: this.renderLayout,
            entries: [
                { binding: 0, resource: { buffer: r.uniforms, offset: 0, size: SLOT_BYTES } },
                { binding: 1, resource: { buffer: r.graphParams } },
                { binding: 2, resource: volumeView(parity === 0 ? r.sdfA : r.sdfB) },
                { binding: 3, resource: volumeView(parity === 0 ? r.matA : r.matB) },
                { binding: 4, resource: sampler },
                { binding: 5, resource: water },
                { binding: 6, resource: r.waterTex2.createView() },
                { binding: 7, resource: { buffer: r.grid } },
                { binding: 8, resource: { buffer: r.particles } },
                { binding: 9, resource: nine },
                { binding: 10, resource: ten },
                { binding: 11, resource: eleven },
            ],
        });
        const colorView = t.color.createView();
        const depthView = t.depth.createView();
        const accumView = t.accum.createView();
        this.attachmentGroups = [0, 1].map((parity) => group(parity, 'attach', water, water, accumView));
        this.renderGroups = [0, 1].map((parity) => group(parity, 'scene', colorView, depthView, water));
    }

    //------------------------------------------------------------------------------------------
    // Frame uniform helpers
    //------------------------------------------------------------------------------------------
    prepareFrame(settings, camera, extras)
    {
        const ring = this.ring;
        ring.index = 0;
        const { nx, ny, nz, hyd, voxel, lo, hi } = this.grid;
        const slot = 0;
        ring.uvec(slot, 'dims', [nx, ny, nz, hyd]);
        ring.vec(slot, 'worldLo', [lo[0], lo[1], lo[2], voxel]);
        ring.vec(slot, 'worldHi', [hi[0], hi[1], hi[2], this.time]);
        ring.vec(slot, 'camPos', [camera.position[0], camera.position[1], camera.position[2], camera.tanHalfFov]);
        ring.vec(slot, 'camRight', [...camera.right, camera.jitter[0]]);
        ring.vec(slot, 'camUp', [...camera.up, camera.jitter[1]]);
        ring.vec(slot, 'camFwd', [...camera.forward, 0]);
        ring.vec(slot, 'view', [this.textureWidth, this.textureHeight, extras.samples || 1, settings.render.renderScale]);
        ring.vec(slot, 'sims', [settings.dt, this.step, settings.rain, settings.evaporation]);
        ring.vec(slot, 'fluvial', [settings.erodibility, settings.areaExponent, settings.slopeExponent, 0]);
        ring.vec(slot, 'transport', [settings.settling, settings.capacity, settings.conductance, settings.maxStepVoxels]);
        ring.vec(slot, 'aeolian', [settings.wind.enabled ? settings.wind.speed : 0, settings.wind.direction, settings.wind.abrasion, settings.wind.deposition]);
        ring.vec(slot, 'thermal', [Math.tan((settings.thermal.repose || 0) * Math.PI / 180), settings.thermal.rate, settings.thermal.creep, settings.thermal.enabled ? 1 : 0]);
        ring.vec(slot, 'climate', [settings.climate.snowline, settings.climate.lapse, settings.climate.humidity, settings.climate.rainVariation]);
        ring.vec(slot, 'particles', [settings.particles.enabled ? settings.particles.rate : 0, this.poolSize, 1.0, settings.particles.displayScale || 2.4]);
        const sun = extras.sun;
        ring.vec(slot, 'sun', [sun[0], sun[1], sun[2], settings.render.sunIntensity]);
        ring.vec(slot, 'sky', [settings.render.ambient, settings.render.fog, settings.render.exposure, settings.render.detail * voxel]);
        ring.vec(slot, 'tint', [settings.render.biome, settings.render.vegetation, 0.5, settings.render.wetDarkening]);
        const shares = settings.particles.share || [0.6, 0.3, 0.1];
        const weights = (Math.round(shares[0] * 255) & 255) | ((Math.round(shares[1] * 255) & 255) << 8) | ((Math.round(shares[2] * 255) & 255) << 16);
        const optionBits = (settings.render.contours ? 4096 : 0) | (settings.render.clipEnabled ? 2048 : 0) | (settings.render.sliceEnabled ? 8192 : 0);
        ring.uvec(slot, 'flags', [
            settings.render.debugView | 0,
            weights >>> 0,
            (this.maxMarchSteps & 1023) | optionBits,
            ((this.bakeStride & 0xffff) << 16) >>> 0,
        ]);
        ring.vec(slot, 'stats', [this.frameStats.eroded, this.frameStats.deposited, this.frameStats.carried, 0]);
        ring.vec(slot, 'bake', [settings.bake.seed || 1, settings.world, settings.render.clipHeight, this.step]);
        const water = settings.water || {};
        const shallow = water.shallowTint || [0.16, 0.34, 0.36];
        const deep = water.deepTint || [0.03, 0.09, 0.13];
        ring.vec(slot, 'water', [water.waveAmplitude ?? 0.35, water.refraction ?? 0.6, water.foam ?? 0.55, water.streaks ?? 0.8]);
        ring.vec(slot, 'waterOptics', [water.specular ?? 1.0, water.absorption ?? 0.09, water.turbidity ?? 0.35, water.sedimentTint ?? 0.5]);
        ring.vec(slot, 'waterShallow', [shallow[0], shallow[1], shallow[2], 0]);
        ring.vec(slot, 'waterDeep', [deep[0], deep[1], deep[2], 0]);
        ring.uvec(slot, 'push', [0, 0, 0, 0]);
        this.baseSlot = slot;
    }

    writeGraphParams(compiled, values)
    {
        const data = new Float32Array(64 * 4);
        for (const entry of compiled.params) {
            const nodeValues = values?.[entry.node];
            const value = nodeValues && nodeValues[entry.param] !== undefined ? nodeValues[entry.param] : entry.value;
            data[entry.slot * 4 + entry.component] = Number(value) || 0;
        }
        this.device.queue.writeBuffer(this.resources.graphParams, 0, data);
    }

    //------------------------------------------------------------------------------------------
    // Pass encoding
    //------------------------------------------------------------------------------------------
    beginPass(encoder, name, push, bindGroupIndex)
    {
        const slot = this.ring.slot(name);
        this.ring.clone(0, slot);
        if (push)
        {
            if (push.push) this.ring.uvec(slot, 'push', push.push);
            if (push.flags) this.ring.uvec(slot, 'flags', push.flags);
            if (push.stats) this.ring.vec(slot, 'stats', push.stats);
            if (push.bake) this.ring.vec(slot, 'bake', push.bake);
            if (push.view) this.ring.vec(slot, 'view', push.view);
            if (push.particles) this.ring.vec(slot, 'particles', push.particles);
            if (push.sims) this.ring.vec(slot, 'sims', push.sims);
            if (push.thermal) this.ring.vec(slot, 'thermal', push.thermal);
            if (push.transport) this.ring.vec(slot, 'transport', push.transport);
        }
        const offset = slot * SLOT_BYTES;
        const pass = encoder.beginComputePass({ label: name });
        pass.setPipeline(this.pipelines[name.split('#')[0]]);
        pass.setBindGroup(0, this.simGroups[bindGroupIndex], [offset]);
        return pass;
    }

    flipParity()
    {
        this.parity = 1 - this.parity;
    }

    //------------------------------------------------------------------------------------------
    // Baking
    //------------------------------------------------------------------------------------------
    bake(stride)
    {
        const { nx, ny, nz } = this.grid;
        const encoder = this.device.createCommandEncoder({ label: 'bake' });
        this.bakeStride = stride;
        const slot = this.ring.slot('bake');
        this.ring.clone(0, slot);
        // Bake packs its stride into the high half of flags.w and writes the full volume.
        const flags = this.ring.bits;
        const base = slot * (SLOT_BYTES / 4);
        // flags.w carries the block stride in its high half; stats.w carries the z span the
        // pass covers, which is how a partial (slab) bake is expressed.
        flags[base + this.ring.fieldOffset('flags') + 3] = ((stride & 0xffff) << 16) >>> 0;
        flags[base + this.ring.fieldOffset('stats') + 3] = new Float32Array(new Uint32Array([nz]).buffer)[0];
        this.ring.write(this.device, this.resources.uniforms);
        const pass = encoder.beginComputePass({ label: 'bakeGraph' });
        pass.setPipeline(this.pipelines.bake);
        pass.setBindGroup(0, this.simGroups[this.parity], [slot * SLOT_BYTES]);
        pass.dispatchWorkgroups(Math.ceil(nx / (4 * stride)), Math.ceil(ny / (4 * stride)), Math.ceil(nz / (4 * stride)));
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.flipParity();
        this.bakeDirty = false;
    }

    //------------------------------------------------------------------------------------------
    // Simulation step
    //------------------------------------------------------------------------------------------
    stepSimulation(request)
    {
        const encoder = this.device.createCommandEncoder({ label: 'sim' });
        const { nx, ny, nz, hyd } = this.grid;
        const gx = Math.ceil(nx / 4);
        const gy = Math.ceil(ny / 4);
        const gz = Math.ceil(nz / 4);
        const hx = Math.ceil(hyd / 8);
        const hy = Math.ceil(hyd / 8);
        const voxelCount = nx * ny * nz;
        const groupIndex = this.parity;

        const clear = this.beginPass(encoder, 'clearCounters', null, groupIndex);
        clear.dispatchWorkgroups(1);
        clear.end();

        const clearDeltas = this.beginPass(encoder, 'clearDeltas', null, groupIndex);
        clearDeltas.dispatchWorkgroups(Math.ceil(voxelCount / 256));
        clearDeltas.end();

        if (request.particlesEnabled)
        {
            // Population census for this step: spawning decisions read it, and the readback
            // reports it to the interface.
            const census = this.beginPass(encoder, 'particleCount', null, groupIndex);
            census.dispatchWorkgroups(Math.ceil(this.poolSize / 64));
            census.end();
        }

        const surface = this.beginPass(encoder, 'surfaceScan', null, groupIndex);
        surface.dispatchWorkgroups(hx, hy);
        surface.end();

        const climate = this.beginPass(encoder, 'climate', null, groupIndex);
        climate.dispatchWorkgroups(hx, hy);
        climate.end();

        if (request.windEnabled)
        {
            const wind = this.beginPass(encoder, 'wind', null, groupIndex);
            wind.dispatchWorkgroups(hx, hy);
            wind.end();
        }

        // Depression filling: alternate planes so the final result always lands in G_FILLED.
        // The relaxation propagates one cell per pass, so a basin wider than the pass count
        // never fills — and an unfilled flat basin is where broken drainage comes from. One
        // pass per column of the grid is therefore the floor, not a luxury.
        let fillIterations = Math.max(Math.max(1, request.fillIterations) * 2 + 1, hyd);
        if (fillIterations % 2 === 0)
        {
            fillIterations += 1;
        }
        let fillSrc = P.flux;
        let fillDst = P.filled;
        const seed = this.beginPass(encoder, 'fillSeed', { push: [0, fillDst, 0, 0] }, groupIndex);
        seed.dispatchWorkgroups(hx, hy);
        seed.end();
        for (let i = 0; i < fillIterations; i += 1)
        {
            const pass = this.beginPass(encoder, 'fillStep', { push: [fillSrc, fillDst, i, 0] }, groupIndex);
            pass.dispatchWorkgroups(hx, hy);
            pass.end();
            const next = fillSrc;
            fillSrc = fillDst;
            fillDst = next;
        }

        const route = this.beginPass(encoder, 'route', null, groupIndex);
        route.dispatchWorkgroups(hx, hy);
        route.end();

        // Flow accumulation: ping-pong seeded from the previous step's field.
        const iterations = Math.max(2, request.accumulateIterations);
        let src = this.accumPlane;
        let dst = src === P.accumA ? P.accumB : P.accumA;
        for (let i = 0; i < iterations; i += 1)
        {
            const pass = this.beginPass(encoder, 'accumulate', { push: [src, dst, i, 0] }, groupIndex);
            pass.dispatchWorkgroups(hx, hy);
            pass.end();
            const next = src;
            src = dst;
            dst = next;
        }
        this.accumPlane = src;

        const flux = this.beginPass(encoder, 'waterFlux', null, groupIndex);
        flux.dispatchWorkgroups(hx, hy);
        flux.end();

        const apply = this.beginPass(encoder, 'waterApply', null, groupIndex);
        apply.dispatchWorkgroups(hx, hy);
        apply.end();

        // The velocity pass needs to know which accumulation plane this step converged into.
        const velocity = this.beginPass(encoder, 'waterVelocity', { push: [this.accumPlane, 0, 0, 0] }, groupIndex);
        velocity.dispatchWorkgroups(hx, hy);
        velocity.end();

        const erode = this.beginPass(encoder, 'erode', { push: [this.accumPlane, 0, 0, 0] }, groupIndex);
        erode.dispatchWorkgroups(hx, hy);
        erode.end();

        const hops = Math.max(0, request.transportIterations ?? 4);
        for (let i = 0; i < hops; i += 1)
        {
            const hop = this.beginPass(encoder, 'transport', null, groupIndex);
            hop.dispatchWorkgroups(hx, hy);
            hop.end();
        }

        const gather = this.beginPass(encoder, 'sediment', null, groupIndex);
        gather.dispatchWorkgroups(hx, hy);
        gather.end();

        const publish = this.beginPass(encoder, 'publishWater', null, groupIndex);
        publish.dispatchWorkgroups(hx, hy);
        publish.end();

        if (request.particlesEnabled)
        {
            const particles = this.beginPass(encoder, 'particleStep', null, groupIndex);
            particles.dispatchWorkgroups(Math.ceil(this.poolSize / 64));
            particles.end();
        }

        if (request.thermalEnabled)
        {
            const thermal = this.beginPass(encoder, 'thermal', null, groupIndex);
            thermal.dispatchWorkgroups(gx, gy, gz);
            thermal.end();
        }

        const applyDeltas = this.beginPass(encoder, 'apply', null, groupIndex);
        applyDeltas.dispatchWorkgroups(gx, gy, gz);
        applyDeltas.end();
        this.flipParity();

        this.refineCounter += 1;
        if (request.refineEvery > 0 && this.refineCounter >= request.refineEvery)
        {
            this.refineCounter = 0;
            const refine = this.beginPass(encoder, 'refine', null, this.parity);
            refine.dispatchWorkgroups(gx, gy, gz);
            refine.end();
            this.flipParity();
        }

        if (this.ringDirty)
        {
            this.ring.write(this.device, this.resources.uniforms);
            this.ringDirty = false;
        }

        this.device.queue.submit([encoder.finish()]);
        this.step += 1;
        this.time += request.dt;
    }

    submitUniforms()
    {
        this.ring.write(this.device, this.resources.uniforms);
    }

    //------------------------------------------------------------------------------------------
    // Rendering
    //------------------------------------------------------------------------------------------
    renderView(options)
    {
        if (!this.targets)
        {
            return;
        }
        const t = this.targets;
        const encoder = this.device.createCommandEncoder({ label: 'render' });
        const scene = this.renderGroups?.[this.parity] ?? this.renderGroups?.[0];
        const attached = this.attachmentGroups?.[this.parity] ?? this.attachmentGroups?.[0];
        if (!scene || !attached)
        {
            return;
        }
        const terrainSlot = this.ring.slot('terrain');
        this.ring.clone(0, terrainSlot);
        const waterSlot = this.ring.slot('water');
        this.ring.clone(0, waterSlot);
        const pointSlot = this.ring.slot('points');
        this.ring.clone(0, pointSlot);
        const accumSlot = this.ring.slot('accumulate');
        this.ring.clone(0, accumSlot);
        const presentSlot = this.ring.slot('present');
        this.ring.clone(0, presentSlot);
        if (options.samples) this.ring.vec(presentSlot, 'view', [this.textureWidth, this.textureHeight, options.samples, this.options.preset.renderScale]);
        this.ring.write(this.device, this.resources.uniforms);

        // Terrain
        // Depth is written as a second colour target: the marcher emits view distance into
        // r32float, which the water pass then samples instead of running its own trace.
        const terrain = encoder.beginRenderPass({
            label: 'terrain',
            colorAttachments: [
                {
                    view: t.color.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
                {
                    view: t.depth.createView(),
                    clearValue: { r: 1e9, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        terrain.setPipeline(this.renderPipelines.terrain);
        terrain.setBindGroup(0, attached, [terrainSlot * SLOT_BYTES]);
        terrain.draw(3);
        terrain.end();

        // Water
        if (options.showWater)
        {
            const water = encoder.beginRenderPass({
                label: 'water',
                colorAttachments: [{
                    view: t.color.createView(),
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });
            water.setPipeline(this.renderPipelines.water);
            water.setBindGroup(0, scene, [waterSlot * SLOT_BYTES]);
            water.draw(3);
            water.end();
        }

        // Agent parcels
        if (options.showParticles && options.poolSize > 0)
        {
            const points = encoder.beginRenderPass({
                label: 'points',
                colorAttachments: [{
                    view: t.color.createView(),
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });
            points.setPipeline(this.renderPipelines.points);
            points.setBindGroup(0, scene, [pointSlot * SLOT_BYTES]);
            points.draw(6, options.poolSize);
            points.end();
        }

        // Progressive accumulation and presentation
        const accumulate = encoder.beginRenderPass({
            label: 'accumulate',
            colorAttachments: [{
                view: t.accum.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: options.resetAccumulation ? 'clear' : 'load',
                storeOp: 'store',
            }],
        });
        accumulate.setPipeline(this.renderPipelines.accumulate);
        accumulate.setBindGroup(0, scene, [accumSlot * SLOT_BYTES]);
        accumulate.draw(3);
        accumulate.end();

        const present = encoder.beginRenderPass({
            label: 'present',
            colorAttachments: [{
                view: options.target,
                clearValue: { r: 0.02, g: 0.02, b: 0.02, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        present.setPipeline(this.renderPipelines.present);
        present.setBindGroup(0, attached, [presentSlot * SLOT_BYTES]);
        present.draw(3);
        present.end();

        this.device.queue.submit([encoder.finish()]);
    }

    //------------------------------------------------------------------------------------------
    // Telemetry
    //------------------------------------------------------------------------------------------
    requestCounters()
    {
        if (this.countersPending || !this.resources)
        {
            return;
        }
        const encoder = this.device.createCommandEncoder({ label: 'counters' });
        encoder.copyBufferToBuffer(this.resources.counters, 0, this.resources.staging, 0, 256);
        this.device.queue.submit([encoder.finish()]);
        this.countersPending = true;
    }

    async pollCounters()
    {
        if (!this.countersPending)
        {
            return this.frameStats;
        }
        const staging = this.resources.staging;
        try
        {
            await staging.mapAsync(GPUMapMode.READ);
            const values = new Uint32Array(staging.getMappedRange().slice(0));
            staging.unmap();
            const scale = 1e-6;
            this.frameStats = {
                eroded: values[0] * scale,
                deposited: values[1] * scale,
                carried: values[2] * scale,
                escaped: values[3] * scale,
                alive: values[4],
                dead: values[5],
                spawned: values[6],
            };
        }
        catch (error)
        {
            void error;
        }
        finally
        {
            this.countersPending = false;
        }
        return this.frameStats;
    }
}
