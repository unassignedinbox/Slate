#!/usr/bin/env node
// Type-checks every WGSL module with naga (the wgpu/Firefox shader front-end, WASI build) and
// cross-checks the binding reflection with wgsl_reflect, so shader errors fail here, not in the browser.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';
import { SURFACE_WGSL } from '../src/gfx/shaders/surface.js';
import { SKY_WGSL } from '../src/gfx/shaders/sky.js';
import { POST_WGSL } from '../src/gfx/shaders/post.js';
import { OVERLAY_WGSL, WIRE_WGSL } from '../src/gfx/shaders/overlay.js';

const mods = [['surface', SURFACE_WGSL], ['sky', SKY_WGSL], ['post', POST_WGSL], ['overlay', OVERLAY_WGSL], ['wire', WIRE_WGSL]];
let bad = 0;

// ---- naga validation (full type + uniformity analysis, same front-end wgpu uses)
const here = dirname(fileURLToPath(import.meta.url));
const naga = join(here, '..', 'node_modules', 'naga-wasi-cli', 'bin', 'naga.mjs');
// naga runs under WASI with the cwd preopened, so the scratch files must live inside the app
const appRoot = join(here, '..');
const tmpRel = join('node_modules', '.wgsl-check');
mkdirSync(join(appRoot, tmpRel), { recursive: true });
if (!existsSync(naga)) {
  console.log('\u001b[33m!\u001b[0m naga-wasi-cli not installed — run `npm i` for full WGSL validation');
} else {
  for (const [name, src] of mods) {
    const rel = join(tmpRel, `${name}.wgsl`);
    writeFileSync(join(appRoot, rel), src);
    let out = '';
    try {
      out = execFileSync(process.execPath, [naga, rel], { encoding: 'utf8', cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }
    if (/Validation successful/.test(out)) {
      console.log(`\u001b[32m✓\u001b[0m naga ${name}`);
    } else {
      bad++;
      console.log(`\u001b[31m✗\u001b[0m naga ${name}\n${out.split('\n').filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join('\n')}`);
    }
  }
}
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
rmSync(join(appRoot, tmpRel), { recursive: true, force: true });
process.exit(bad ? 1 : 0);
