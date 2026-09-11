//==========================================================================================
// Headless frame smoke test. WebGPU needs a browser, so this drives the real TerrainEngine
// against a recording stub device and runs the actual pass schedule through it.
//
// This exists because the studio once shipped a black viewport: boot never compiled the graph,
// so the compute pipelines were null, the first step of the first frame threw, and the render
// callback chain stopped dead. Nothing on the command line could see it — the WGSL validated and
// every module parsed. A stub device that runs a few frames catches that whole family of fault.
//
// Usage: node tools/verify-frames.mjs
//==========================================================================================

const usage = {
    MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64,
    STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512,
};
globalThis.GPUBufferUsage = usage;
globalThis.GPUMapMode = { READ: 1, WRITE: 2 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

const problems = [];
const record = { passes: [], pipelines: new Set(), dispatch: 0, draw: 0, submits: 0, writes: 0, barriers: 0 };

function check(condition, message)
{
    if (!condition)
    {
        problems.push(message);
    }
}

// ---------------------------------------------------------------- stub device
class StubPass
{
    constructor(kind, label)
    {
        this.kind = kind;
        this.label = label;
        this.ended = false;
    }

    setPipeline(pipeline)
    {
        check(!!pipeline, `pass "${this.label}" was handed an undefined pipeline`);
        if (pipeline)
        {
            record.pipelines.add(pipeline.label);
        }
    }

    setBindGroup(index, group, offsets)
    {
        check(!!group, `pass "${this.label}" was handed an undefined bind group`);
        check(offsets === undefined || offsets.every((value) => Number.isFinite(value)),
            `pass "${this.label}" got a non-finite dynamic offset`);
        void index;
    }

    dispatchWorkgroups(x, y = 1, z = 1)
    {
        check(Number.isFinite(x) && x > 0 && Number.isFinite(y) && Number.isFinite(z),
            `pass "${this.label}" dispatched a non-positive or non-finite workgroup count (${x}, ${y}, ${z})`);
        record.dispatch += 1;
        record.passes.push(this.label);
    }

    draw(count, instances = 1)
    {
        check(Number.isFinite(count) && count > 0, `pass "${this.label}" drew ${count} vertices`);
        record.draw += 1;
        record.passes.push(this.label);
        void instances;
    }

    end()
    {
        this.ended = true;
    }
}

const stubDevice = {
    limits: {},
    features: new Set(),
    lost: new Promise(() => {}),
    addEventListener() {},
    pushErrorScope() {},
    async popErrorScope() { return null; },
    createBuffer(descriptor)
    {
        check(Number.isFinite(descriptor.size) && descriptor.size > 0, `buffer "${descriptor.label}" has size ${descriptor.size}`);
        return { label: descriptor.label, size: descriptor.size, destroy() {}, getMappedRange: () => new ArrayBuffer(descriptor.size), unmap() {}, mapAsync: async () => {} };
    },
    createTexture(descriptor)
    {
        const { width, height, depthOrArrayLayers } = descriptor.size;
        check(width > 0 && height > 0 && (depthOrArrayLayers === undefined || depthOrArrayLayers > 0),
            `texture "${descriptor.label}" has size ${width}x${height}x${depthOrArrayLayers ?? 1}`);
        return {
            label: descriptor.label,
            size: descriptor.size,
            createView: () => ({ label: `${descriptor.label}:view` }),
            destroy() {},
        };
    },
    createSampler: () => ({ label: 'sampler' }),
    createShaderModule(descriptor)
    {
        check(typeof descriptor.code === 'string' && descriptor.code.length > 0, `shader "${descriptor.label}" is empty`);
        return { label: descriptor.label, getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout: (descriptor) => ({ label: descriptor.label, entries: descriptor.entries }),
    createPipelineLayout: (descriptor) => ({ label: descriptor.label }),
    createBindGroup(descriptor)
    {
        check(Array.isArray(descriptor.entries) && descriptor.entries.length > 0, `bind group "${descriptor.label}" has no entries`);
        return { label: descriptor.label, entries: descriptor.entries };
    },
    createComputePipeline(descriptor)
    {
        return { label: `compute:${descriptor.label}`, descriptor, getBindGroupLayout: () => ({}) };
    },
    createRenderPipeline(descriptor)
    {
        return { label: `render:${descriptor.label}`, descriptor, getBindGroupLayout: () => ({}) };
    },
    createCommandEncoder()
    {
        return {
            beginComputePass: (descriptor) => new StubPass('compute', descriptor?.label ?? 'compute'),
            beginRenderPass: (descriptor) => new StubPass('render', descriptor?.label ?? 'render'),
            copyBufferToBuffer() { record.writes += 1; },
            copyTextureToBuffer() { record.writes += 1; },
            finish: () => ({ label: 'commands' }),
        };
    },
    queue: {
        writeBuffer() { record.writes += 1; },
        submit() { record.submits += 1; },
        onSubmittedWorkDone: async () => {},
    },
};

// ---------------------------------------------------------------- drive the real engine
const { TerrainEngine } = await import('../src/kernel/terrainEngine.js');
const { defaultSettings, QUALITY_PRESETS, WORLD_EXTENT } = await import('../src/kernel/uniforms.js');
const { compileGraph } = await import('../src/kernel/graph/compiler.js');
const { presetDocument } = await import('../src/kernel/graph/doc.js');

const settings = defaultSettings();
settings.quality = 'draft';

// Compile a real preset, exactly as boot does: an empty graph would not exercise the spliced
// graph functions or the parameter block.
const compiled = compileGraph(presetDocument('canyon'));
check(compiled.errors.length === 0, `canyon preset does not compile: ${compiled.errors.join('; ')}`);
const params = {};
for (const node of presetDocument('canyon').nodes)
{
    params[node.id] = node.params;
}

const engine = new TerrainEngine(stubDevice, 'bgra8unorm', (message) => problems.push(`engine reported: ${message}`));
engine.configure({ quality: settings.quality, world: settings.world ?? WORLD_EXTENT });
engine.setTargetSize(320, 180);

// The exact call the studio makes at boot. Without it the pipelines are null, the first step of
// the first frame throws, and the browser shows a black viewport with frozen counters. The check
// below reports that as a failure instead of letting the throw escape.
engine.buildPipelines(compiled.wgsl, compiled.signature);
engine.writeGraphParams(compiled, params);
check(!!engine.pipelines, 'buildPipelines left engine.pipelines null');
check(!!engine.renderPipelines, 'buildPipelines left engine.renderPipelines null');
const camera =
{
    position: [620, 300, 640],
    forward: [-0.6, -0.2, -0.75],
    right: [0.78, 0, -0.62],
    up: [0, 1, 0],
    tanHalfFov: Math.tan((46 * Math.PI / 180) * 0.5),
    jitter: [0, 0],
};

const request = {
    dt: settings.dt,
    fillIterations: settings.fillIterations,
    accumulateIterations: settings.accumulateIterations,
    refineEvery: settings.refineEvery,
    transportIterations: settings.transportIterations,
    windEnabled: true,
    particlesEnabled: true,
    thermalEnabled: true,
};

let frames = 0;
try
{
    for (let i = 0; i < 3; i += 1)
    {
        engine.prepareFrame(settings, camera, { samples: 1, sun: [0.4, 0.72, 0.55] });
        engine.bake(1);
        engine.stepSimulation(request);
        engine.renderView({ target: { label: 'swapchain' }, showWater: true, showParticles: true, poolSize: engine.poolSize, samples: 1, resetAccumulation: true });
        frames += 1;
    }
}
catch (error)
{
    // Reported as a failure with the frame number: the studio survives a loop fault, so the test
    // should describe it rather than exit on a stack trace.
    problems.push(`frame ${frames + 1} threw: ${(error && error.message) || error}`);
}

engine.requestCounters();

// ---------------------------------------------------------------- expectations
const expectedCompute = ['bake', 'apply', 'refine', 'surfaceScan', 'climate', 'wind', 'fillSeed', 'fillStep',
    'route', 'accumulate', 'waterFlux', 'waterApply', 'waterVelocity', 'erode', 'sediment', 'transport',
    'publishWater', 'particleStep', 'particleCount', 'thermal', 'clearDeltas', 'clearCounters'];
for (const name of expectedCompute)
{
    check(!!(engine.pipelines && engine.pipelines[name]), `compute pipeline "${name}" was never created`);
}
for (const name of ['terrain', 'water', 'points', 'accumulate', 'present'])
{
    check(!!(engine.renderPipelines && engine.renderPipelines[name]), `render pipeline "${name}" was never created`);
}

check(record.dispatch > 40, `expected the schedule to dispatch many passes, saw ${record.dispatch}`);
check(record.submits > 0, 'nothing was ever submitted to the queue');
check(record.draw >= 3, `expected the render passes to draw, saw ${record.draw}`);
check(record.writes > 0, 'nothing was ever uploaded to the device');
check(engine.ring.offsets.size <= engine.ring.slots, 'the frame ring ran out of slots');
check(engine.grid.nx > 0 && engine.grid.voxel > 0, 'engine grid was never configured');

// Every pass that ran must have used a slot that stays inside the ring.
const slots = [...(engine.ring?.offsets?.values?.() ?? [])];
check(slots.every((value) => value >= 0 && value < engine.ring.slots), 'a pass reserved a slot outside the ring');

console.log(`ran ${frames} frames through the engine: ${record.dispatch} dispatches, ${record.draw} draws, `
    + `${record.pipelines.size} pipelines, ${record.submits} submits, ${engine.ring.offsets.size} ring slots`);

if (problems.length > 0)
{
    console.log(`\nproblems (${problems.length})`);
    for (const problem of problems)
    {
        console.log(`  FAIL  ${problem}`);
    }
    process.exitCode = 1;
}
else
{
    console.log('\nAll frame checks passed.');
}
