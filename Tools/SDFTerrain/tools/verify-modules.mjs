//==========================================================================================
// Validates the shader modules the browser will actually compile.
//
// verify-wgsl.mjs checks the shipped modules against the graph stub; verify-graph.mjs checks the
// graph source against the common preamble. Neither one builds what the device is handed, which
// is every module with a real compiled graph spliced into it. A mismatch there is a wall of
// console errors at first paint and a black viewport, so it is checked here against every preset.
//
// Usage: node tools/verify-modules.mjs
//==========================================================================================

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shaderRoot = path.join(root, 'src', 'kernel', 'shaders');

let naga = null;
try
{
    naga = await import('@forgeax/engine-wgpu-wasm/pkg');
}
catch (error)
{
    console.log('skipped: the naga validator needs the dev dependencies (npm install).');
    void error;
    process.exit(0);
}
const pkgDir = path.dirname(fileURLToPath(import.meta.resolve('@forgeax/engine-wgpu-wasm/package.json')));
const wasmBytes = await readFile(path.join(pkgDir, 'pkg', 'wgpu_wasm_bg.wasm'));
await naga.default({ module_or_path: new Uint8Array(wasmBytes.buffer, wasmBytes.byteOffset, wasmBytes.byteLength) });

const { compileGraph } = await import('../src/kernel/graph/compiler.js');
const { presetDocument, PRESETS } = await import('../src/kernel/graph/doc.js');

// Every module factory the engine builds a pipeline from. Each takes the compiled graph source
// and returns the full module the device compiles; the *_MODULE constants are the same
// factories run against the stub.
const factories = [];
for (const name of ['bake', 'apply', 'refine', 'surface', 'hydrology', 'particles', 'render', 'thermal'])
{
    const exports_ = await import(path.join(shaderRoot, `${name}.js`));
    const entry = Object.entries(exports_).find(([key]) => typeof exports_[key] === 'function' && /Shader$/.test(key));
    if (entry)
    {
        factories.push({ name, key: entry[0], value: entry[1] });
        continue;
    }
    // thermal and apply take no graph: their module constant is already the whole module.
    const constant = Object.entries(exports_).find(([key, value]) => /_MODULE$/.test(key) && typeof value === 'string');
    if (constant)
    {
        factories.push({ name, key: constant[0], value: () => constant[1] });
        continue;
    }
    console.log(`  FAIL  ${name}.js exports no shader factory`);
    process.exitCode = 1;
}

function validate(label, code)
{
    try
    {
        const parsed = naga.parse(code);
        naga.validate(parsed);
        return null;
    }
    catch (error)
    {
        const detail = error && error.message ? error.message : String(error);
        return `${label}: ${detail}`;
    }
}

let checked = 0;
const problems = [];

for (const preset of PRESETS)
{
    const doc = presetDocument(preset.id);
    const compiled = compileGraph(doc);
    if (compiled.errors.length > 0)
    {
        problems.push(`preset "${preset.id}" does not compile: ${compiled.errors.join('; ')}`);
        continue;
    }

    for (const factory of factories)
    {
        let source = null;
        try
        {
            const produced = factory.value(compiled.wgsl);
            source = typeof produced === 'string' ? produced : produced?.code ?? null;
        }
        catch (error)
        {
            problems.push(`${preset.id}/${factory.key} threw while building: ${(error && error.message) || error}`);
            continue;
        }
        if (typeof source !== 'string' || source.length === 0)
        {
            problems.push(`${preset.id}/${factory.key} produced no source`);
            continue;
        }
        const failure = validate(`${preset.id}/${factory.key}`, source);
        if (failure)
        {
            problems.push(failure);
        }
        checked += 1;
    }
}

console.log(`validated ${checked} shader modules across ${PRESETS.length} presets`);

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
    console.log('\nAll engine modules validated with the real compiled graphs.');
}
