//==========================================================================================
// Frame uniform layout — the single source of truth shared by WGSL (shaders/common.js) and
// the host. Field order here must match the Frame struct exactly; the writer below is the
// only place that packs values, so a mismatch cannot drift silently across passes.
//
// Per-pass push values (ping-pong planes, z ranges) are written into a ring of slots at
// 512-byte alignment and bound through a dynamic offset, so one uniform buffer serves every
// dispatch without re-writing between passes.
//==========================================================================================

export const SLOT_BYTES = 512;

export const FRAME_FIELDS = [
    ['dims', 4, 'u32'],        // nx, ny, nz, hydRes
    ['worldLo', 4, 'f32'],     // lo.xyz [m], voxelSize [m]
    ['worldHi', 4, 'f32'],     // hi.xyz [m], time [s]
    ['camPos', 4, 'f32'],      // pos.xyz [m], tanHalfFov
    ['camRight', 4, 'f32'],    // basis, w = jitter x
    ['camUp', 4, 'f32'],       // basis, w = jitter y
    ['camFwd', 4, 'f32'],      // basis
    ['view', 4, 'f32'],        // width, height, sampleIndex, renderScale
    ['sims', 4, 'f32'],        // dt [s], step, rain [m/s], evaporation [1/s]
    ['fluvial', 4, 'f32'],     // K, m, n, reserved
    ['transport', 4, 'f32'],   // settling, capacity, flow conductance, maxStep [voxels]
    ['aeolian', 4, 'f32'],     // speed [m/s], direction [rad], abrasion, deposition
    ['thermal', 4, 'f32'],     // tan(repose), rate, creep, enabled
    ['climate', 4, 'f32'],     // snowline [m], lapse, humidity, variation
    ['particles', 4, 'f32'],   // spawn rate, pool size, wind gravity bias, display scale
    ['sun', 4, 'f32'],         // direction.xyz, intensity
    ['sky', 4, 'f32'],         // ambient, fog density, exposure, detail amplitude [m]
    ['tint', 4, 'f32'],        // biome, vegetation, sediment mix, wet darkening
    ['flags', 4, 'u32'],       // debug view, agent type weights (8 bits each), option bits, bake pack
    ['stats', 4, 'f32'],       // eroded m3, deposited m3, carried m3, bake z-count
    ['bake', 4, 'f32'],        // seed, world scale, clip plane [m], bake generation
    ['water', 4, 'f32'],       // wave amplitude [m], refraction, foam, flow streaks
    ['waterOptics', 4, 'f32'], // specular, absorption [1/m], turbidity, sediment tint
    ['waterShallow', 4, 'f32'],// shallow tint rgb
    ['waterDeep', 4, 'f32'],   // deep tint rgb
    ['push', 4, 'u32'],        // ping-pong source plane, destination plane, iteration, parity
];

export const FRAME_FLOATS = FRAME_FIELDS.reduce((sum, [, size]) => sum + size, 0);

export class FrameRing
{
    constructor(slots = 96)
    {
        this.slots = slots;
        this.stride = SLOT_BYTES / 4;
        this.data = new Float32Array(slots * this.stride);
        this.bits = new Uint32Array(this.data.buffer);
        this.index = 0;
        this.offsets = new Map();
    }

    // Reserve a slot for a pass; the same pass keeps its slot across frames, which keeps the
    // dynamic offsets stable and avoids re-uploading the whole ring every step.
    slot(name)
    {
        if (!this.offsets.has(name))
        {
            if (this.offsets.size >= this.slots)
            {
                throw new Error(`frame ring exhausted (${this.slots} slots)`);
            }
            this.offsets.set(name, this.offsets.size);
        }
        return this.offsets.get(name);
    }

    reset()
    {
        // Values are rewritten every frame by fill(), so only the pass mapping persists.
    }

    f32(slot, field, index, value)
    {
        const base = slot * this.stride + this.fieldOffset(field);
        this.data[base + index] = value;
    }

    u32(slot, field, index, value)
    {
        const base = slot * this.stride + this.fieldOffset(field);
        this.bits[base + index] = value >>> 0;
    }

    vec(slot, field, values)
    {
        for (let i = 0; i < values.length; i += 1)
        {
            const base = slot * this.stride + this.fieldOffset(field);
            this.data[base + i] = values[i];
        }
    }

    uvec(slot, field, values)
    {
        for (let i = 0; i < values.length; i += 1)
        {
            const base = slot * this.stride + this.fieldOffset(field);
            this.bits[base + i] = values[i] >>> 0;
        }
    }

    fieldOffset(field)
    {
        if (!this.fieldOffsets)
        {
            this.fieldOffsets = new Map();
            let offset = 0;
            for (const [name, size] of FRAME_FIELDS)
            {
                this.fieldOffsets.set(name, offset);
                offset += size;
            }
        }
        const found = this.fieldOffsets.get(field);
        if (found === undefined)
        {
            throw new Error(`unknown frame field ${field}`);
        }
        return found;
    }

    // Copy a prepared slot into every reserved slot so all passes see the shared state.
    clone(fromSlot, toSlot)
    {
        const from = fromSlot * this.stride;
        const to = toSlot * this.stride;
        this.data.copyWithin(to, from, from + this.stride);
    }

    write(device, buffer)
    {
        device.queue.writeBuffer(buffer, 0, this.data.buffer, 0, this.offsets.size * SLOT_BYTES);
    }

    byteLength()
    {
        return this.slots * SLOT_BYTES;
    }
}

// Runtime-tunable state. Presets are the entry point for artists; every value is exposed in
// the inspector with the same physical units used by the solver.
export const QUALITY_PRESETS = {
    draft: { label: 'Draft', dims: [128, 64, 128], hyd: 128, particles: 6000, stepsPerFrame: 2, marchSteps: 96, renderScale: 0.6, refineEvery: 3 },
    standard: { label: 'Standard', dims: [192, 96, 192], hyd: 192, particles: 18000, stepsPerFrame: 1, marchSteps: 128, renderScale: 0.8, refineEvery: 4 },
    high: { label: 'High', dims: [256, 128, 256], hyd: 256, particles: 48000, stepsPerFrame: 1, marchSteps: 168, renderScale: 1.0, refineEvery: 5 },
    ultra: { label: 'Ultra', dims: [320, 160, 320], hyd: 320, particles: 110000, stepsPerFrame: 1, marchSteps: 208, renderScale: 1.0, refineEvery: 6 },
};

export const WORLD_EXTENT = [1600, 800, 1600];

export function defaultSettings()
{
    // One object holds every artist-facing quantity. Units are physical throughout: metres,
    // seconds, radians, cubic metres. The UI reads and writes this object directly, and
    // prepareFrame() is the single place that packs it into the uniform ring.
    return {
        quality: 'standard',
        world: 1600,              // [m] XZ extent of the simulation box

        // Model time per step. Landscape evolution needs deep time: one step is a storm that
        // lasts hours, and a few hundred steps cut a canyon. The readout converts to years.
        dt: 6000,                 // [s] model time per step
        rainMm: 9.4,              // [mm/h] rainfall intensity
        evapScale: 1.0,           // [-] multiplier on the base evaporation rate

        // Stream power: E = K * A^m * S^n. K is in metres per second per (m^2)^m per S^n and
        // the exponents reproduce a flatter, more channelised landscape than the textbook
        // m=0.5, n=1 pair, which on a 1600 m map cuts broad sheets instead of valleys.
        erodibility: 0.036,
        areaExponent: 0.85,
        slopeExponent: 0.7,
        settling: 0.05,           // [m/s] settling velocity; deposition = V_s / u
        capacity: 0.03,           // [-] transport capacity scale
        conductance: 0.85,        // [-] fraction of stored water routed per step
        maxStepVoxels: 0.35,      // [voxels] hard cap on surface change per step
        fillIterations: 12,
        accumulateIterations: 24,
        transportIterations: 4,   // downstream sediment hops per step
        refineEvery: 4,

        wind: { enabled: true, speed: 13.5, windDeg: 37, direction: 0.6458, abrasion: 0.00042, deposition: 0.85 },
        thermal: { enabled: true, repose: 40, rate: 0.55, creep: 0.02 },
        climate: { snowline: 480, lapse: 0.045, humidity: 1.0, rainVariation: 0.35 },
        particles: { enabled: true, rate: 1.0, share: [0.55, 0.35, 0.10], displayScale: 2.4 },

        water: {
            waveAmplitude: 0.35,
            refraction: 0.6,
            foam: 0.55,
            streaks: 0.8,
            specular: 1.0,
            absorption: 0.09,
            turbidity: 0.35,
            sedimentTint: 0.5,
            shallowTint: [0.16, 0.34, 0.36],
            deepTint: [0.03, 0.09, 0.13],
        },

        render: {
            sunAzimuthDeg: 52,
            sunElevationDeg: 34,
            sunIntensity: 1.15,
            shadowSoftness: 0.18,
            ambient: 0.55,
            fog: 0.35,
            exposure: 1.05,
            turbidity: 0.35,
            detail: 0.35,
            vegetation: 0.35,
            wetDarkening: 0.55,
            biome: 1,
            renderScale: 0.8,
            contours: false,
            flowVectors: false,
            clipEnabled: false,
            clipHeight: 220,
            sliceEnabled: false,
            debugView: 0,
            showWater: true,
            showParticles: true,
            showTerrain: true,
            showSky: true,
            showGrid: false,
        },

        bake: { seed: 1, stride: 1 },
    };
}
