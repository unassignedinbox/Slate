// Static integration checks: every id referenced by main.js exists in
// index.html, every icon exists in icons.js, and every import-map / file
// reference resolves. Catches UI wiring typos without a browser.
// Run from RoadEditor/: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const main = readFileSync(join(root, 'src/main.js'), 'utf8');
const icons = readFileSync(join(root, 'src/icons.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

test('every id used by main.js exists in index.html', () => {
  const used = new Set();
  for (const m of main.matchAll(/\$\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of main.matchAll(/\$\("([^"]+)"\)/g)) used.add(m[1]);
  const missing = [...used].filter((id) => !id.includes('${') && !htmlIds.has(id));
  assert.deepEqual(missing, [], `missing ids: ${missing.join(', ')}`);
});

test('every range control has a matching output badge', () => {
  const ids = [];
  for (const m of main.matchAll(/(?:roadRangeIds|terrainRangeIds) = \[([^\]]+)\]/g)) {
    ids.push(...m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
  }
  ids.push('rideHeight');
  const missing = ids.filter((id) => !htmlIds.has(`${id}-out`));
  assert.deepEqual(missing, [], `missing outputs: ${missing.join(', ')}`);
});

test('every icon used in HTML or JS exists in icons.js', () => {
  const iconNames = new Set([...icons.matchAll(/^  "([a-z0-9-]+)":/gm)].map((m) => m[1]));
  const used = new Set();
  for (const m of html.matchAll(/data-icon="([^"]+)"/g)) used.add(m[1]);
  for (const m of main.matchAll(/icon\('([^']+)'\)/g)) used.add(m[1]);
  const missing = [...used].filter((n) => !iconNames.has(n));
  assert.deepEqual(missing, [], `missing icons: ${missing.join(', ')}`);
});

test('import map entries and addon imports resolve to vendored files', () => {
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  for (const [key, value] of Object.entries(map.imports)) {
    assert.ok(existsSync(join(root, value.replace('./', ''))), `import map "${key}" → ${value} missing`);
  }
  for (const m of main.matchAll(/from '(three\/addons\/[^']+)'/g)) {
    const rel = m[1].replace('three/addons/', 'vendor/');
    assert.ok(existsSync(join(root, rel)), `addon import ${m[1]} → ${rel} missing`);
  }
  for (const m of main.matchAll(/from '\.\/([^']+)'/g)) {
    assert.ok(existsSync(join(root, 'src', m[1])), `relative import ./${m[1]} missing`);
  }
  for (const m of html.matchAll(/(?:src|href)="(\.[^"]+)"/g)) {
    assert.ok(existsSync(join(root, m[1].replace('./', ''))), `index.html reference ${m[1]} missing`);
  }
});

test('hidden file inputs exist', () => {
  for (const id of ['obj-file', 'project-file']) {
    assert.ok(htmlIds.has(id), `missing file input #${id}`);
  }
});
