// Scans every WGSL source in src/kernel/shaders for identifiers that collide with WGSL
// reserved keywords (naga reports the first one, this reports all of them).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESERVED = ('NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become binding_array cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noinline nointerpolation non_coherent noncoherent noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where while writeonly yield').split(' ');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'src', 'kernel', 'shaders');
const files = (await readdir(root)).filter((f) => f.endsWith('.js'));
let hits = 0;
for (const file of files)
{
    const text = await readFile(path.join(root, file), 'utf8');
    // strip JS template noise, then look at identifier positions
    const ids = new Set();
    for (const match of text.matchAll(/\b(?:let|var|const|fn|struct|return)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) ids.add(match[1]);
    for (const match of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) ids.add(match[1]);
    for (const id of ids) if (RESERVED.includes(id)) { console.log(`${file}: reserved identifier "${id}"`); hits += 1; }
}
console.log(hits === 0 ? 'no reserved identifier collisions' : `${hits} collisions`);
