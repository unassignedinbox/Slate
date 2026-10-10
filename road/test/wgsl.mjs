import { SHADER } from '/tmp/sh_src.mjs';
import { WgslReflect } from 'wgsl_reflect';
try {
  const r = new WgslReflect(SHADER);
  console.log('WGSL parsed OK');
  console.log('  entry points:',
    [...r.entry.vertex.map(e => 'vs:' + e.name), ...r.entry.fragment.map(e => 'fs:' + e.name)].join(', '));
  console.log('  uniforms:', r.uniforms.map(u => `${u.name} (group ${u.group}, binding ${u.binding}, ${u.size} B)`).join('; '));
  for (const e of r.entry.vertex) {
    console.log(`  ${e.name} inputs:`, e.inputs.map(i => `@location(${i.location}) ${i.name}: ${i.type?.name}`).join(', '));
  }
} catch (e) {
  console.log('WGSL PARSE FAILED:', e.message);
  process.exit(1);
}
