/*
 * Compile every GLSL program headlessly.
 *
 * There is no GPU in the build sandbox, and a shader that fails to compile
 * takes the whole app down at startup, so the shaders are validated with
 * glslang instead. Install it with:
 *   npm i -D glslang-validator-prebuilt-predownloaded
 * If it is not present this test skips rather than fails.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { VS, FS, FS_GLASS, VS_SHADOW, FS_SHADOW } from '../src/render/renderer';

function findBinary(): string | null {
  const req = createRequire(import.meta.url);
  const guesses = [
    'glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux',
    '/tmp/node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux',
    '/usr/bin/glslangValidator',
  ];
  for (const g of guesses) {
    try {
      const p = g.startsWith('/') ? g : req.resolve(g);
      if (existsSync(p)) return p;
    } catch { /* keep looking */ }
  }
  return null;
}

const bin = findBinary();
if (!bin) {
  console.log('glslangValidator not found - skipping shader compile check');
  process.exit(0);
}

const cases: [string, string, 'vert' | 'frag'][] = [
  ['main.vert', VS, 'vert'],
  ['main.frag', FS, 'frag'],
  ['glass.frag', FS_GLASS, 'frag'],
  ['shadow.vert', VS_SHADOW, 'vert'],
  ['shadow.frag', FS_SHADOW, 'frag'],
];

let bad = 0;
for (const [name, src, stage] of cases) {
  const f = `/tmp/slate-${name}`;
  writeFileSync(f, src);
  try {
    execFileSync(bin, ['-S', stage, f], { stdio: 'pipe' });
    console.log(`OK   ${name}  (${src.split('\n').length} lines)`);
  } catch (e) {
    bad++;
    const err = e as { stdout?: Buffer; message?: string };
    console.log(`FAIL ${name}\n${err.stdout?.toString() ?? err.message}`);
  }
}
process.exit(bad ? 1 : 0);
