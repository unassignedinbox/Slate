#!/usr/bin/env node
// Parses every WGSL module with wgsl_reflect so shader typos fail in CI instead of in the browser.
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';
import { SURFACE_WGSL } from '../src/gfx/shaders/surface.js';
import { SKY_WGSL } from '../src/gfx/shaders/sky.js';
import { POST_WGSL } from '../src/gfx/shaders/post.js';
import { OVERLAY_WGSL, WIRE_WGSL } from '../src/gfx/shaders/overlay.js';

const mods = [['surface', SURFACE_WGSL], ['sky', SKY_WGSL], ['post', POST_WGSL], ['overlay', OVERLAY_WGSL], ['wire', WIRE_WGSL]];
let bad = 0;
for (const [name, src] of mods) {
  try {
    const r = new WgslReflect(src);
    const entries = [...r.entry.vertex.map((e) => `vs:${e.name}`), ...r.entry.fragment.map((e) => `fs:${e.name}`)];
    const groups = r.getBindGroups();
    const binds = groups.map((g, i) => `g${i}:${g.filter(Boolean).length}`).join(' ');
    console.log(`\u001b[32m✓\u001b[0m ${name.padEnd(8)} ${String(src.length).padStart(6)} chars  ${entries.join(' ')}  [${binds}]`);
  } catch (e) {
    bad++;
    console.log(`\u001b[31m✗\u001b[0m ${name}: ${e.message}`);
    const m = /line\s+(\d+)/i.exec(e.message || '');
    if (m) {
      const lines = src.split('\n');
      const ln = Number(m[1]);
      for (let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++) {
        console.log(`   ${String(i + 1).padStart(4)} ${lines[i]}`);
      }
    }
  }
}
process.exit(bad ? 1 : 0);
