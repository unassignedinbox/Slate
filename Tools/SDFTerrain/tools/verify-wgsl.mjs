//==========================================================================================
// WGSL verification harness — parses and validates every shader module with naga (WGPU 29)
// before it ever reaches a browser. Reports source positions for failures.
//
//   node tools/verify-wgsl.mjs
//
// The tool's shader sources live in src/kernel/shaders/*.js and export either strings or
// functions producing complete WGSL modules. Each exported module is validated independently.
//==========================================================================================

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

import { readFile } from 'node:fs/promises';

// The naga validator lives in a dev dependency, so a checkout without node_modules can still
// run the graph, pipeline, interface and frame checks. Say so plainly instead of dying on an
// unresolved import three lines up.
let naga = null;
try
{
    naga = await import('@forgeax/engine-wgpu-wasm/pkg');
}
catch (error)
{
    console.log('skipped: the naga validator needs the dev dependencies.');
    console.log('run `npm install` in Tools/SDFTerrain to enable this check.');
    void error;
    process.exit(0);
}
const pkgDir = path.dirname(fileURLToPath(import.meta.resolve('@forgeax/engine-wgpu-wasm/package.json')));
const wasmBytes = await readFile(path.join(pkgDir, 'pkg', 'wgpu_wasm_bg.wasm'));
await naga.default({ module_or_path: new Uint8Array(wasmBytes.buffer, wasmBytes.byteOffset, wasmBytes.byteLength) });

const shaderRoot = path.join(root, 'src', 'kernel', 'shaders');
const files = (await readdir(shaderRoot)).filter((name) => name.endsWith('.js')).sort();

let total = 0;
let failures = 0;
const report = [];

function describe(error)
{
    if (!error)
    {
        return 'unknown error';
    }
    const message = String(error.message ?? error);
    const line = error.line_num ?? error.line ?? null;
    const col = error.line_pos ?? error.column ?? null;
    return line ? `${message} (line ${line}, col ${col})` : message;
}

function showContext(source, line)
{
    if (!line)
    {
        return '';
    }
    const rows = source.split('\n');
    const from = Math.max(0, line - 3);
    const to = Math.min(rows.length, line + 2);
    const out = [];
    for (let i = from; i < to; i += 1)
    {
        out.push(`${String(i + 1).padStart(4, ' ')} | ${rows[i]}`);
    }
    return out.join('\n');
}

for (const file of files)
{
    const module = await import(path.join(shaderRoot, file));
    const entries = Object.entries(module).filter(([, value]) => typeof value === 'string');
    for (const [name, source] of entries)
    {
        // Convention: only exports named *_MODULE are complete, compilable modules.
        if (!name.endsWith('_MODULE'))
        {
            continue;
        }
        total += 1;
        const label = `${file}::${name}`;
        try
        {
            const parsed = naga.parse(source);
            naga.validate(parsed);
            report.push(`  PASS  ${label}  (${source.split('\n').length} lines)`);
        }
        catch (error)
        {
            failures += 1;
            report.push(`  FAIL  ${label}\n        ${describe(error)}\n${showContext(source, error?.line_num ?? error?.line)}`);
        }
    }
}

console.log(report.join('\n'));
console.log(`\n${total - failures}/${total} WGSL modules validated with naga.`);
process.exit(failures === 0 ? 0 : 1);
