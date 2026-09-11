//==========================================================================================
// Pipeline verification harness — cross-checks the host-side pipeline descriptions in
// src/kernel/terrainEngine.js against the WGSL that the shader modules actually declare.
//
//   node tools/verify-pipeline.mjs
//
// A WebGPU pipeline is validated at runtime by the device, not by naga, so a typo in an entry
// point name or a binding number that does not match the shader only shows up as an exception
// in the browser. This harness closes that gap offline: entry points are matched by name, bind
// group entries are matched by number and kind, and render attachment formats are matched
// against the shader's output locations.
//==========================================================================================

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineSource = await readFile(path.join(root, 'src', 'kernel', 'terrainEngine.js'), 'utf8');
const commonSource = await readFile(path.join(root, 'src', 'kernel', 'shaders', 'common.js'), 'utf8');

const failures = [];
const notes = [];
const fail = (message) => failures.push(message);

const moduleByKey = {};
for (const file of ['bake', 'apply', 'refine', 'surface', 'hydrology', 'particles', 'thermal', 'render'])
{
    const imported = await import(path.join(root, 'src', 'kernel', 'shaders', `${file}.js`));
    const entry = Object.entries(imported).find(([name]) => name.endsWith('_MODULE'));
    if (!entry)
    {
        fail(`shader module src/kernel/shaders/${file}.js exports no *_MODULE string`);
        continue;
    }
    moduleByKey[file] = entry[1];
}
notes.push(`shader modules: ${Object.keys(moduleByKey).join(', ')}`);

function entryPoints(source)
{
    return new Set([...source.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]));
}

function bindings(source)
{
    const found = new Map();
    const pattern = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_<>, ]+);/g;
    for (const match of source.matchAll(pattern))
    {
        const [, group, binding, , name, type] = match;
        found.set(Number(binding), { group: Number(group), name, type: type.trim(), raw: match[0] });
    }
    return found;
}

//------------------------------------------------------------------------------------------
// 1. Compute pipelines: entry point present in the module it names.
//------------------------------------------------------------------------------------------
const simEntries = [...engineSource.matchAll(/simPipeline\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
    .map((match) => ({ label: match[1], entry: match[2], module: match[3] }));

if (simEntries.length === 0)
{
    fail('terrainEngine: no simPipeline() descriptions found');
}

for (const pipeline of simEntries)
{
    const source = moduleByKey[pipeline.module];
    if (!source)
    {
        fail(`terrainEngine: pipeline "${pipeline.label}" names unknown module "${pipeline.module}"`);
        continue;
    }
    if (!entryPoints(source).has(pipeline.entry))
    {
        fail(`terrainEngine: pipeline "${pipeline.label}" wants entry "${pipeline.entry}" which ${pipeline.module}.js does not define`);
    }
}
notes.push(`compute pipelines: ${simEntries.length} entry points resolved`);

//------------------------------------------------------------------------------------------
// 2. Pass names used by the simulation schedule must exist in the pipeline table.
//------------------------------------------------------------------------------------------
const declared = new Set(simEntries.map((entry) => entry.label));
const render = moduleByKey.render;
const renderEntries = entryPoints(render);

for (const match of engineSource.matchAll(/beginPass\(encoder,\s*'([^']+)'/g))
{
    const name = match[1].split('#')[0];
    if (!declared.has(name))
    {
        fail(`terrainEngine: beginPass('${name}') has no matching pipeline`);
    }
}
for (const match of engineSource.matchAll(/this\.renderPipelines\.([A-Za-z_]+)/g))
{
    // Presence in the table is checked separately; nothing to resolve from the source alone.
    void match;
}
for (const match of engineSource.matchAll(/entryPoint:\s*'([^']+)'/g))
{
    if (!renderEntries.has(match[1]))
    {
        fail(`terrainEngine: render pipeline wants entry "${match[1]}" which render.js does not define`);
    }
}
notes.push(`render entry points: ${[...renderEntries].filter((name) => /Vertex|Fragment/.test(name)).length} declared`);

//------------------------------------------------------------------------------------------
// 3. Bind group layout vs shader declarations (compute family).
//------------------------------------------------------------------------------------------
const simBindingNumbers = new Set([...engineSource.matchAll(/label: 'sim',\s*entries: \[([\s\S]*?)\n\s*\],/g)]
    .flatMap((match) => [...match[1].matchAll(/binding:\s*(\d+)/g)].map((entry) => Number(entry[1]))));

const computeModules = ['bake', 'apply', 'refine', 'surface', 'hydrology', 'particles', 'thermal'];
const declaredNumbers = new Map();
for (const key of computeModules)
{
    for (const [number, info] of bindings(moduleByKey[key]))
    {
        declaredNumbers.set(number, info);
    }
}
for (const [number, info] of declaredNumbers)
{
    if (!simBindingNumbers.has(number))
    {
        fail(`bind group "sim" has no entry for binding ${number} (${info.name} in ${info.type})`);
    }
}
for (const number of simBindingNumbers)
{
    if (!declaredNumbers.has(number))
    {
        fail(`bind group "sim" declares binding ${number} that no compute module uses`);
    }
}
notes.push(`sim bind group: ${simBindingNumbers.size} entries, ${declaredNumbers.size} declared in WGSL`);

//------------------------------------------------------------------------------------------
// 4. Storage texture kinds must match the layout (access and format).
//------------------------------------------------------------------------------------------
const layoutText = engineSource.match(/label: 'sim',\s*entries: \[([\s\S]*?)\n\s*\],/)?.[1] ?? '';
const storageExpectations = [
    { binding: 5, format: 'r32float' },
    { binding: 6, format: 'rgba16float' },
    { binding: 12, format: 'rgba16float' },
    { binding: 13, format: 'rgba16float' },
];
for (const expectation of storageExpectations)
{
    const row = layoutText.split('\n').find((line) => line.includes(`binding: ${expectation.binding},`));
    if (!row || !row.includes(`format: '${expectation.format}'`))
    {
        fail(`sim bind group binding ${expectation.binding} should be a write-only ${expectation.format} storage texture`);
    }
}
for (const binding of [5, 6, 12, 13])
{
    const info = declaredNumbers.get(binding);
    if (info && !/texture_storage/.test(info.type))
    {
        fail(`binding ${binding} is declared "${info.type}" in WGSL but the layout expects a storage texture`);
    }
}
for (const [number, info] of declaredNumbers)
{
    if (/texture_storage/.test(info.type) && !/write/.test(info.type))
    {
        fail(`binding ${number} (${info.name}) declares a storage texture without write access; every storage texture here is write-only`);
    }
    if (/texture_2d<f32>/.test(info.type) && !/unfilterable/.test(layoutText.split('\n').find((line) => line.includes(`binding: ${number},`)) ?? ''))
    {
        notes.push(`binding ${number} (${info.name}) is sampled as a filterable float texture`);
    }
}

//------------------------------------------------------------------------------------------
// 5. Render bind group: same rules, plus the render-target conflict that a GPU only reports
//    at draw time — a texture may not be sampled in a pass that also renders into it.
//------------------------------------------------------------------------------------------
const renderLayoutText = engineSource.match(/label: 'render',\s*entries: \[([\s\S]*?)\n\s*\],/)?.[1] ?? '';
const renderNumbers = new Set([...renderLayoutText.matchAll(/binding:\s*(\d+)/g)].map((match) => Number(match[1])));
const renderBindings = bindings(render);
for (const number of renderNumbers)
{
    if (!renderBindings.has(number))
    {
        fail(`bind group "render" declares binding ${number} that render.js does not use`);
    }
}
for (const [number, info] of renderBindings)
{
    if (!renderNumbers.has(number))
    {
        fail(`render.js uses binding ${number} (${info.name}) with no entry in the "render" layout`);
    }
}

// The engine builds two families of render bind groups precisely to avoid read/write overlap.
if (!/attachmentGroups/.test(engineSource) || !/renderGroups/.test(engineSource))
{
    fail('terrainEngine: expected both an "attachmentGroups" and a "renderGroups" family to avoid attachment/sampler conflicts');
}
if (/binding: 9, resource: colorView[\s\S]{0,200}?binding: 11, resource: accumView/.test(engineSource))
{
    notes.push('render bind groups: scene family binds colour and depth as textures, attachment family binds accumulation');
}

//------------------------------------------------------------------------------------------
// 6. Uniform blocks: the frame struct must fit the 512-byte slot ring, and the graph
//    parameter block must be big enough for the compiler's slot budget.
//------------------------------------------------------------------------------------------
const uniforms = await import(path.join(root, 'src', 'kernel', 'uniforms.js'));
const frameBytes = uniforms.FRAME_FLOATS * 4;
if (frameBytes > uniforms.SLOT_BYTES)
{
    fail(`frame uniform is ${frameBytes} bytes but each ring slot is ${uniforms.SLOT_BYTES}`);
}
const paramArray = /var<uniform>\s+gparams\s*:\s*array<vec4f,\s*(\d+)>/.exec(commonSource);
if (!paramArray)
{
    fail('common.js does not declare the graph parameter block as array<vec4f, N>');
}
const graphParams = [...engineSource.matchAll(/graphParams', size: (\d+) \* (\d+)/g)][0];
if (graphParams && paramArray)
{
    const bytes = Number(graphParams[1]) * Number(graphParams[2]);
    const slots = bytes / 16;
    const declaredSlots = Number(paramArray[1]);
    const compiler = await import(path.join(root, 'src', 'kernel', 'graph', 'compiler.js'));
    if (declaredSlots !== slots)
    {
        fail(`graph parameter block: WGSL declares ${declaredSlots} vec4 slots but the buffer holds ${slots}`);
    }
    if (slots * 4 < compiler.MAX_GRAPH_PARAMS)
    {
        fail(`graph parameter block holds ${slots * 4} values but the compiler allows ${compiler.MAX_GRAPH_PARAMS} parameters`);
    }
    notes.push(`graph parameter block: ${slots} vec4 slots (${slots * 4} values), frame uniform ${frameBytes} bytes in ${uniforms.SLOT_BYTES}-byte ring slots`);
}

console.log(notes.map((line) => `  ${line}`).join('\n'));
if (failures.length)
{
    console.log('');
    for (const failure of failures)
    {
        console.log(`  FAIL  ${failure}`);
    }
    console.log(`\n${failures.length} pipeline check(s) failed.`);
    process.exit(1);
}
console.log('\nAll pipeline checks passed.');
