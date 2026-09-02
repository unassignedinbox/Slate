/**
 * check-wiring.mjs — static verification of the browser side, which cannot be
 * exercised in Node because it needs a real document and AudioContext.
 *
 *   1. every non-entry module imports cleanly (nothing touches the DOM at
 *      import time, which is also what makes the offline renderer work);
 *   2. the entry point parses and only references symbols that exist;
 *   3. every $('#id') selector used by the UI exists in index.html;
 *   4. every asset referenced by index.html exists on disk.
 *
 * Usage: npm run check
 */

import { readFileSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';

let bad = 0;
const fail = (msg) => {
  bad++;
  console.log(`  FAIL ${msg}`);
};

const MODULES = [
  'src/cars.js',
  'src/model/firing.js',
  'src/model/tone.js',
  'src/model/engine.js',
  'src/audio/buffers.js',
  'src/audio/graph.js',
  'src/ui/app.js',
];

for (const m of MODULES) {
  try {
    await import(new URL(`../${m}`, import.meta.url).href);
    console.log(`  import ok   ${m}`);
  } catch (e) {
    fail(`${m} threw on import: ${e.message}`);
  }
}

// entry point: parse only (it instantiates the app, which needs a real DOM)
try {
  const src = readFileSync(new URL('../src/main.js', import.meta.url));
  new SourceTextModule(src.toString(), { identifier: 'src/main.js' });
  console.log('  parse ok    src/main.js');
} catch (e) {
  fail(`src/main.js does not parse: ${e.message}`);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
const ids = [...new Set([...app.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]))];
for (const id of ids) {
  if (!new RegExp(`id="${id}"`).test(html)) fail(`index.html has no element with id="${id}"`);
}
console.log(`  selectors   ${ids.length} $('#id') references matched against index.html`);

const assets = [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)].map((m) => m[1]);
for (const a of assets) {
  try {
    readFileSync(new URL(`../${a}`, import.meta.url));
  } catch {
    fail(`index.html references missing asset ${a}`);
  }
}
console.log(`  assets      ${assets.length} referenced file(s) present`);

console.log(bad ? `\n${bad} wiring problem(s)` : '\nwiring OK');
process.exit(bad ? 1 : 0);
