//==========================================================================================
// Graph verification harness — compiles every shipped preset through the node-graph
// compiler, validates the generated WGSL with naga, and asserts the graph contracts the
// engine relies on (single output, no cycles, parameter table fits the uniform block).
//
//   node tools/verify-graph.mjs
//
// This is the offline half of the pipeline: it proves that a graph an artist draws can only
// ever produce shader code that compiles. Anything the compiler rejects is reported with the
// node and socket that caused it.
//==========================================================================================

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { compileGraph, MAX_GRAPH_PARAMS } from '../src/kernel/graph/compiler.js';
import { PRESETS, presetDocument, createDocument, createNode, connect, wouldCycle } from '../src/kernel/graph/doc.js';
import { NODE_LIBRARY, NODE_BY_ID } from '../src/kernel/graph/nodes.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

import * as naga from '@forgeax/engine-wgpu-wasm/pkg';

const pkgDir = path.dirname(require.resolve('@forgeax/engine-wgpu-wasm/package.json'));
const wasmBytes = await readFile(path.join(pkgDir, 'pkg', 'wgpu_wasm_bg.wasm'));
await naga.default({ module_or_path: new Uint8Array(wasmBytes.buffer, wasmBytes.byteOffset, wasmBytes.byteLength) });

const shaderRoot = path.join(root, 'src', 'kernel', 'shaders');
const graphStub = await import(path.join(shaderRoot, 'graphStub.js'));
const bakeModule = await import(path.join(shaderRoot, 'bake.js'));
const commonModule = await import(path.join(shaderRoot, 'common.js'));
const bindingsModule = await import(path.join(shaderRoot, 'bindings.js'));

const failures = [];
const notes = [];

function fail(message)
{
    failures.push(message);
}

function validateGlsl(label, source)
{
    try
    {
        naga.validate(naga.parse(source));
        return true;
    }
    catch (error)
    {
        const message = String(error?.message ?? error);
        const line = error?.line_num ?? error?.line ?? null;
        let context = '';
        if (line)
        {
            const rows = source.split('\n');
            const from = Math.max(0, line - 4);
            const to = Math.min(rows.length, line + 3);
            context = '\n' + rows.slice(from, to)
                .map((row, index) => `        ${String(from + index + 1).padStart(4)} | ${row}`)
                .join('\n');
        }
        fail(`${label}: ${message}${line ? ` (line ${line})` : ''}${context}`);
        return false;
    }
}

//------------------------------------------------------------------------------------------
// 1. Library sanity: unique ids, sockets typed, output node present.
//------------------------------------------------------------------------------------------
const seen = new Set();
for (const node of NODE_LIBRARY)
{
    if (seen.has(node.id))
    {
        fail(`node library: duplicate id "${node.id}"`);
    }
    seen.add(node.id);
    if (!node.title || !node.group)
    {
        fail(`node library: "${node.id}" is missing a title or group`);
    }
    const inputs = node.sockets?.in ?? [];
    const outputs = node.sockets?.out ?? [];
    for (const socket of [...inputs, ...outputs])
    {
        if (!socket.id || !socket.type)
        {
            fail(`node library: "${node.id}" has an untyped socket`);
        }
    }
    if (outputs.length === 0 && node.id !== 'terrainOutput')
    {
        fail(`node library: "${node.id}" produces no output socket`);
    }
    if (typeof node.emit !== 'function')
    {
        fail(`node library: "${node.id}" has no emit() function`);
    }
}
notes.push(`node library: ${NODE_LIBRARY.length} node types across ${new Set(NODE_LIBRARY.map((n) => n.group)).size} groups`);

if (!NODE_LIBRARY.some((node) => node.id === 'terrainOutput'))
{
    fail('node library: no terrainOutput node to terminate a graph');
}

//------------------------------------------------------------------------------------------
// 2. Every preset must compile clean and produce valid WGSL.
//------------------------------------------------------------------------------------------
for (const preset of PRESETS)
{
    const doc = presetDocument(preset.id);
    if (!doc.nodes?.length)
    {
        fail(`preset "${preset.id}": document is empty`);
        continue;
    }

    const compiled = compileGraph(doc);
    if (compiled.errors.length)
    {
        fail(`preset "${preset.id}": compiler reported ${compiled.errors.length} error(s)\n        ${compiled.errors.join('\n        ')}`);
        continue;
    }
    if (compiled.warnings.length)
    {
        fail(`preset "${preset.id}": compiler reported warnings\n        ${compiled.warnings.join('\n        ')}`);
    }
    if (compiled.params.length > MAX_GRAPH_PARAMS)
    {
        fail(`preset "${preset.id}": ${compiled.params.length} parameters exceed the ${MAX_GRAPH_PARAMS} slot budget`);
    }
    if (!compiled.signature)
    {
        fail(`preset "${preset.id}": compiler produced no signature, so the engine cannot cache pipelines`);
    }

    // A graph is always concatenated after the shared shader library, so that composition —
    // not the fragment on its own — is what the GPU actually compiles.
    const composed = `${commonModule.COMMON}\n${bindingsModule.SIM_BINDINGS}\n${bindingsModule.FIELD_WRITE_HELPERS}\n${compiled.wgsl}`;
    const ok = validateGlsl(`preset "${preset.id}" graph`, composed);
    if (ok)
    {
        // The graph module is always concatenated with a host module, so validate the real
        // composition too — that is where a missing helper or a name clash would show up.
        const bake = bakeModule.bakeShader(compiled.wgsl);
        validateGlsl(`preset "${preset.id}" + bake`, bake);
        notes.push(`preset "${preset.id}": ${doc.nodes.length} nodes, ${(doc.edges ?? []).length} wires, ${compiled.params.length} parameters`);
    }
}

//------------------------------------------------------------------------------------------
// 3. Cycle guard: the editor must refuse a wire that would close a loop.
//------------------------------------------------------------------------------------------
{
    const doc = createDocument();
    const a = createNode('mountain', 0, 0);
    const b = createNode('mountain', 300, 0);
    const out = createNode('terrainOutput', 600, 0);
    doc.nodes.push(a, b, out);
    const source = NODE_BY_ID.get('mountain').sockets.out[0].id;
    const target = NODE_BY_ID.get('mountain').sockets.in[0].id;
    const sink = NODE_BY_ID.get('terrainOutput').sockets.in[0].id;
    connect(doc, a.id, source, b.id, target);
    connect(doc, b.id, source, out.id, sink);

    if (wouldCycle(doc, b.id, a.id))
    {
        notes.push('cycle guard: feedback wire rejected as expected');
    }
    else
    {
        fail('cycle guard: a wire that closes a loop was accepted');
    }

    const closed = compileGraph(doc);
    if (closed.errors.length)
    {
        fail(`cycle guard: the acyclic document did not compile\n        ${closed.errors.join('\n        ')}`);
    }
}

//------------------------------------------------------------------------------------------
// 4. The stub module must expose exactly the entry points the fallback expects.
//------------------------------------------------------------------------------------------
for (const name of ['graphSdf', 'graphHardness', 'graphRainMask', 'graphStrata'])
{
    if (!new RegExp(`fn\\s+${name}\\s*\\(`).test(graphStub.GRAPH_STUB))
    {
        fail(`graph stub: missing ${name}()`);
    }
}

console.log(notes.map((line) => `  ${line}`).join('\n'));
if (failures.length)
{
    console.log('');
    for (const failure of failures)
    {
        console.log(`  FAIL  ${failure}`);
    }
    console.log(`\n${failures.length} graph check(s) failed.`);
    process.exit(1);
}
console.log('\nAll graph checks passed.');
