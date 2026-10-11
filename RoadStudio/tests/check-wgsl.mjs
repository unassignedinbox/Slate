// Parses the WGSL in src/render/shaders.js with wgsl_reflect and checks the entry points
// the renderer relies on. This catches syntax and binding errors without a GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WGSL } from '../src/render/shaders.js';

// The package's CJS entry is not loadable under "type": "module"; use its ESM build.
const { WgslReflect } = await import('wgsl_reflect/wgsl_reflect.module.js');

test('WGSL parses and exposes the expected entry points', () => {
  const r = new WgslReflect(WGSL);
  const vs = r.entry.vertex.map((f) => f.name);
  const fs = r.entry.fragment.map((f) => f.name);
  for (const n of ['vs_main', 'vs_inst', 'vs_shadow', 'vs_shadow_inst', 'vs_sky']) assert.ok(vs.includes(n), n);
  for (const n of ['fs_main', 'fs_sky']) assert.ok(fs.includes(n), n);
  assert.ok(r.structs.some((s) => s.name === 'Globals'));
});
