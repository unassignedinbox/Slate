// Static shader/material cross-checks (no GL needed):
// every declared uniform is bound, varyings match, includes exist,
// delimiters balance, and shared uniforms are shared by reference.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createShared } from '../src/ocean/shared.js';
import { OceanField } from '../src/ocean/cascades.js';
import { FoamField } from '../src/ocean/foam.js';
import { SpraySystem } from '../src/ocean/spray.js';
import { WaterSurface, Seabed, Sky } from '../src/ocean/water.js';
import { SourceManager } from '../src/ocean/sources.js';

const fakeRenderer = { capabilities: { isWebGL2: true } };
const fakeScene = { add() {}, remove() {} };
const caps = { isWebGL2: true, floatRT: true, halfRT: true, floatLinear: true, maxVertexTextures: 16, maxFragmentTextures: 16 };

const shared = createShared();
const field = new OceanField(fakeRenderer, caps, shared, { N: 128, tiles: [1024, 256, 64] });
const foam = new FoamField(fakeRenderer, shared, { res: 64, tileSize: 520 });
const spray = new SpraySystem(fakeRenderer, fakeScene, shared, { res: 8, spawnR: 100 });
const water = new WaterSurface(fakeScene, shared, foam);
const seabed = new Seabed(fakeScene, shared);
const sky = new Sky(fakeScene, shared);
const sources = new SourceManager(fakeScene, shared);

const mats = [];
field.cascades.forEach((c, i) => {
  mats.push([`cascade${i}.spec`, c.specPass.material]);
  mats.push([`cascade${i}.fft`, c.fftPass.material]);
  mats.push([`cascade${i}.combine`, c.combinePass.material]);
});
mats.push(['copy', field.copyPass.material]);
mats.push(['foam', foam.pass.material]);
mats.push(['spray.update', spray.updatePass.material]);
mats.push(['spray.points', spray.pointsMat]);
mats.push(['water', water.material]);
mats.push(['seabed', seabed.material]);
mats.push(['sky', sky.material]);

// three-provided builtins (in the auto-generated prefix)
const BUILTINS = new Set([
  'modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix',
  'normalMatrix', 'cameraPosition', 'isOrthographic', 'toneMappingExposure',
]);

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function declaredUniforms(src) {
  const names = new Set();
  const re = /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g;
  let m;
  const clean = stripComments(src);
  while ((m = re.exec(clean))) names.add(m[1]);
  return names;
}
function declaredVaryings(src) {
  const names = new Set();
  const re = /varying\s+\w+\s+(\w+)\s*;/g;
  let m;
  const clean = stripComments(src);
  while ((m = re.exec(clean))) names.add(m[1]);
  return names;
}
function balanced(src, name) {
  const clean = stripComments(src).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const stack = [];
  const pairs = { '}': '{', ')': '(', ']': '[' };
  for (const ch of clean) {
    if (ch === '{' || ch === '(' || ch === '[') stack.push(ch);
    else if (pairs[ch]) {
      assert.equal(stack.pop(), pairs[ch], `${name}: unbalanced ${ch}`);
    }
  }
  assert.equal(stack.length, 0, `${name}: unclosed delimiters ${stack}`);
}

for (const [name, mat] of mats) {
  const vs = mat.vertexShader, fs = mat.fragmentShader;
  // 1. delimiters
  balanced(vs, name + '.vert');
  balanced(fs, name + '.frag');
  // 2. varyings match
  const vV = declaredVaryings(vs), vF = declaredVaryings(fs);
  for (const v of vF) assert.ok(vV.has(v), `${name}: frag varying ${v} missing in vert`);
  // 3. uniforms bound
  const uV = declaredUniforms(vs), uF = declaredUniforms(fs);
  for (const u of new Set([...uV, ...uF])) {
    if (BUILTINS.has(u)) continue;
    assert.ok(u in mat.uniforms, `${name}: uniform '${u}' declared but not bound`);
  }
  // 4. includes exist
  for (const src of [vs, fs]) {
    const re = /#include\s+<([^>]+)>/g;
    let m;
    while ((m = re.exec(src))) assert.ok(m[1] in THREE.ShaderChunk, `${name}: missing chunk ${m[1]}`);
  }
  // 5. entry assignments
  assert.ok(/gl_Position\s*=/.test(vs), `${name}: vert must write gl_Position`);
  if (name !== 'spray.points') assert.ok(/gl_FragColor\s*=/.test(fs), `${name}: frag must write gl_FragColor`);
  // 6. no unresolved template placeholders
  assert.ok(!/\$\{/.test(vs + fs), `${name}: unresolved template placeholder`);
  console.log(`ok ${name}: ${(uV.size + uF.size)} uniforms bound, varyings match`);
}

// 7. no GLSL ES 3.00 reserved (future-use) words as identifiers
const RESERVED = [
  'common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef',
  'template', 'this', 'resource', 'goto', 'inline', 'noinline', 'volatile',
  'public', 'static', 'extern', 'external', 'interface', 'flat', 'superp',
  'input', 'output', 'filter', 'sizeof', 'cast', 'namespace', 'using',
  'row_major', 'patch', 'sample', 'subroutine', 'half', 'fixed', 'long',
  'short', 'unsigned',
];
for (const [name, mat] of mats) {
  for (const [stage, src] of [['vert', mat.vertexShader], ['frag', mat.fragmentShader]]) {
    const clean = stripComments(src);
    for (const w of RESERVED) {
      assert.ok(!new RegExp(`\\b${w}\\b`).test(clean), `${name}.${stage}: reserved word '${w}' used as identifier`);
    }
  }
}
console.log('ok no reserved identifiers');

// shared-by-reference checks (updates propagate to all materials)
assert.equal(water.material.uniforms.uTime, shared.uTime);
assert.equal(foam.pass.material.uniforms.uWindSpeed, shared.uWindSpeed);
assert.equal(spray.updatePass.material.uniforms.uPeakK, shared.uPeakK);
assert.equal(field.cascades[0].specPass.material.uniforms.uGamma, shared.uGamma);
console.log('ok shared uniform references');

// source manager state machine (no GL)
const s1 = sources.addSource({ type: 0, x: 10, z: 20, amp: 0.5, lambda: 30 });
assert.ok(s1 && s1.id > 0);
assert.equal(shared.uSrcCount.value, 1);
assert.equal(shared.uSrcA.value[0].x, 10);
sources.removeSource(s1.id);
assert.equal(shared.uSrcCount.value, 0);
console.log('ok source manager');

console.log('materials.test.mjs: ALL PASS');
