// Optional deep validation: compiles every WGSL module and pipeline with Dawn
// (the same Tint compiler Chrome uses) on the null backend — full semantic
// validation without needing a GPU. Not required to run the demo.
//
//   mkdir -p /tmp/wgsl-check && cd /tmp/wgsl-check && npm i webgpu
//   NODE_PATH=/tmp/wgsl-check/node_modules node Tools/validate-wgsl.mjs
// (or copy this file next to a node_modules containing the `webgpu` package)
let mod;
for (const spec of ['webgpu', '/tmp/wgsl-check/node_modules/webgpu/index.js', process.env.SLATE_WEBGPU_MODULE || '']) {
  if (!spec) continue;
  try { mod = await import(spec); break; } catch { /* try next */ }
}
if (!mod) { console.log('Package "webgpu" (Dawn for Node) not found — see header for install. Skipping.'); process.exit(0); }
const { create } = mod;
Object.assign(globalThis, mod.globals);
const { buildShaders } = await import('../src/shaders.js');
const gpu = create(['backend=null']);
const device = await (await gpu.requestAdapter()).requestDevice();
const shaders = buildShaders({ ATLAS_N: 524288, GDF_N: 262144, triCount: 8000, dynCount: 100, staticCount: 100 });
let bad = 0;
for (const [name, code] of Object.entries(shaders)) {
  if (name === 'COMMON') continue;
  const mod = device.createShaderModule({ code, label: name });
  const errs = (await mod.getCompilationInfo()).messages.filter(m => m.type === 'error');
  console.log(name, errs.length ? 'ERRORS' : 'ok'); errs.forEach(e => console.log('  line', e.lineNum, e.message));
  bad += errs.length;
}
console.log(bad ? `${bad} WGSL errors` : 'All WGSL modules compile (Dawn/Tint).');
process.exit(bad ? 1 : 0);
