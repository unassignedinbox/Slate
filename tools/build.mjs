// Bundles src/main.js -> public/js/spine.js
// three.js is vendored from node_modules, so the game runs with zero external CDNs.
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/main.js')],
  outfile: path.join(root, 'public/js/spine.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  sourcemap: true,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: '/* SPINE RUNNER - built from src/ with esbuild. Edit src/, then: npm run build */',
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching src/ ...');
} else {
  const t = Date.now();
  await esbuild.build(options);
  console.log(`[build] wrote public/js/spine.js in ${Date.now() - t}ms`);
}
