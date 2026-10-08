import test from 'node:test';
import assert from 'node:assert/strict';

// Shader sources are static strings — verify structural sanity without GL.
test('VERT + FRAG are structurally sane GLSL', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/shaders.js', import.meta.url), 'utf8'));
  const vert = src.match(/export const VERT = \/\* glsl \*\/`([\s\S]*?)`;/)[1];
  const frag = src.match(/export const FRAG = \/\* glsl \*\/`([\s\S]*?)`;/)[1];
  for (const [name, code] of [['VERT', vert], ['FRAG', frag]]) {
    assert.ok(code.includes('void main'), `${name} has main`);
    assert.equal((code.match(/{/g) || []).length, (code.match(/}/g) || []).length, `${name} braces`);
    assert.equal((code.match(/\(/g) || []).length, (code.match(/\)/g) || []).length, `${name} parens`);
    assert.ok(!code.includes('${'), `${name} has no accidental template holes`);
  }
  // Every uniform set by the engine must be declared.
  const engine = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/engine.js', import.meta.url), 'utf8'));
  const used = [...engine.matchAll(/u\.(\w+)\.value/g)].map((m) => m[1]);
  assert.ok(used.length > 10, 'engine sets uniforms');
  for (const u of new Set(used)) {
    assert.ok(vert.includes(u), `VERT declares ${u}`);
  }
});
