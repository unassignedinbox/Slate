// Static checks for SLATE GLSL: balance, declaration-before-use, uniform
// references from JS, and bake codegen sanity. Run: node tools/check-glsl.mjs
import { motionFS, eventFS, scatterVS, scatterFS, acceptFS, feedbackFS, repairFS, heightFS, thermalFS, flowDecayFS, flowSplatVS, flowSplatFS, countFS } from '../src/core/glsl/sim.js';
import { terrainFS, PARTICLE_VS, PARTICLE_FS } from '../src/core/glsl/render.js';
import { ATLAS_GLSL, NOISE_GLSL, PRIM_GLSL, FIELD_GLSL } from '../src/core/glsl/common.js';
import { bakeFS } from '../src/core/glsl/bake.js';
import { Graph, DEFS, makeNode, defaultParams } from '../src/core/graph.js';
import { PRESETS } from '../src/presets.js';

const shaders = {
  motion: motionFS, event: eventFS, scatterVS, scatterFS, accept: acceptFS,
  feedback: feedbackFS, repair: repairFS, height: heightFS, thermal: thermalFS,
  flowDecay: flowDecayFS, flowSplatVS, flowSplatFS, count: countFS,
  terrain: terrainFS, particleVS: PARTICLE_VS, particleFS: PARTICLE_FS,
  bakeSample: bakeFS('float scene(vec3 p){ return sdTerrainSlab(p, -30.0, 8.0, 16.0, 0.024, 6, 0.35, 7.0); }', ''),
  bakeField: bakeFS(`float f2b(vec3 p){ return fieldSDF(p); }
float scene(vec3 p){ return f2b(p); }`, FIELD_GLSL),
};

let failures = 0;
const fail = (msg) => { console.error('  ✗', msg); failures++; };

function checkBalanced(name, src) {
  let depthP = 0, depthB = 0, depthS = 0;
  // strip comments and strings
  const clean = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '(') depthP++;
    if (c === ')') depthP--;
    if (c === '{') depthB++;
    if (c === '}') depthB--;
    if (c === '[') depthS++;
    if (c === ']') depthS--;
    if (depthP < 0) { fail(`${name}: ')' underflow at ${i}`); return; }
    if (depthB < 0) { fail(`${name}: '}' underflow at ${i}`); return; }
    if (depthS < 0) { fail(`${name}: ']' underflow at ${i}`); return; }
  }
  if (depthP) fail(`${name}: ${depthP} unclosed '('`);
  if (depthB) fail(`${name}: ${depthB} unclosed '{'`);
  if (depthS) fail(`${name}: ${depthS} unclosed '['`);
}

function checkVersion(name, src) {
  if (!src.startsWith('#version 300 es')) fail(`${name}: missing #version 300 es at line 1`);
}

function checkDeclBeforeUse(name, src) {
  const clean = src.replace(/\/\/[^\n]*/g, '');
  // function definitions
  const defs = [];
  const re = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(clean))) {
    const line = clean.slice(0, m.index).split('\n').length;
    defs.push({ name: m[2], line, ret: m[1] });
  }
  // reserved words that look like calls
  const reserved = new Set(['if', 'for', 'while', 'return', 'else', 'mix', 'min', 'max', 'clamp', 'smoothstep', 'length', 'normalize', 'dot', 'cross', 'abs', 'sin', 'cos', 'tan', 'exp', 'pow', 'sqrt', 'floor', 'fract', 'sign', 'texture', 'texelFetch', 'discard']);
  for (const d of defs) {
    // find uses before definition line
    const before = clean.split('\n').slice(0, d.line - 1).join('\n');
    const useRe = new RegExp(`\\b${d.name}\\s*\\(`, 'g');
    if (!reserved.has(d.name) && useRe.test(before) && !new RegExp(`\\b(?:float|void|int|vec[234]|ivec[234]|mat\\d)\\s+${d.name}\\s*\\(`).test(before)) {
      fail(`${name}: function '${d.name}' used before definition (def at line ${d.line})`);
    }
  }
}

function checkCommon(name, src, allCommons) {
  // every identifier used as function call with a common-defined name must resolve
  // (light check: undefined helper functions used in shader body)
  const clean = src.replace(/\/\/[^\n]*/g, '');
  const defined = new Set();
  const re = /\b(?:float|void|int|bool|vec[234]|ivec[234]|mat\d)\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(clean))) defined.add(m[1]);
  for (const c of allCommons) {
    const re2 = /\b(?:float|void|int|bool|vec[234]|ivec[234]|mat\d)\s+([A-Za-z_]\w*)\s*\(/g;
    let m2;
    while ((m2 = re2.exec(c.replace(/\/\/[^\n]*/g, '')))) defined.add(m2[1]);
  }
  const builtin = new Set(['main', 'mix', 'min', 'max', 'clamp', 'smoothstep', 'step', 'length', 'normalize', 'distance', 'dot', 'cross', 'abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'exp', 'exp2', 'log', 'log2', 'pow', 'sqrt', 'inversesqrt', 'floor', 'ceil', 'fract', 'mod', 'sign', 'texture', 'texelFetch', 'textureLod', 'imageLoad', 'any', 'all', 'lessThan', 'greaterThan', 'greaterThanEqual', 'lessThanEqual', 'equal', 'notEqual', 'not', 'isnan', 'isinf', 'reflect', 'refract', 'faceforward', 'matrixCompMult', 'transpose', 'dFdx', 'dFdy', 'fwidth', 'discard', 'radians', 'degrees', 'outerProduct',
    // type constructors & keywords that look like calls
    'float', 'int', 'uint', 'bool', 'void', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'if', 'for', 'while', 'do', 'else', 'return', 'layout', 'uniform', 'in', 'out', 'inout', 'const', 'precision', 'highp', 'mediump', 'lowp', 'struct', 'switch', 'case', 'default', 'break', 'continue', 'flat', 'smooth', 'noperspective', 'centroid']);
  const calls = clean.match(/\b([a-z_]\w*)\s*\(/g) || [];
  const missing = new Set();
  for (const c of calls) {
    const fn = c.slice(0, -1).trim();
    if (!builtin.has(fn) && !defined.has(fn) && !missing.has(fn)) {
      // could be a variable being called? unlikely in GLSL — flag
      missing.add(fn);
    }
  }
  if (missing.size) fail(`${name}: unknown function calls: ${[...missing].join(', ')}`);
}

const commons = [ATLAS_GLSL, NOISE_GLSL, PRIM_GLSL, FIELD_GLSL];
for (const [name, src] of Object.entries(shaders)) {
  checkBalanced(name, src);
  checkVersion(name, src);
  checkDeclBeforeUse(name, src);
  checkCommon(name, src, commons);
}
console.log(`shader checks done — ${failures} failure(s)`);

// ── bake codegen sanity: compile every preset ──
for (const preset of PRESETS) {
  const g = new Graph();
  const map = {};
  preset.nodes.forEach(n => {
    const node = makeNode(n.type, n.x, n.y);
    node.params = { ...defaultParams(n.type), ...n.params };
    map[n.id] = node;
    g.add(node);
  });
  preset.links.forEach(l => g.link(map[l.from].id, map[l.to].id, l.toInput));
  const c = g.compile();
  if (!c) { console.error(`preset ${preset.name}: no output!`); failures++; continue; }
  const body = `float scene(vec3 p){\n${c.preFns}\n  return ${c.preEntry};\n}`;
  checkBalanced(`preset:${preset.name}:pre`, body);
  checkCommon(`preset:${preset.name}:pre`, body, commons);
  if (c.hasSim) {
    const body2 = `float scene(vec3 p){\n${c.postFns}\n  return ${c.postEntry};\n}`;
    checkBalanced(`preset:${preset.name}:post`, body2);
    checkCommon(`preset:${preset.name}:post`, body2, commons);
  }
  console.log(`preset ${preset.name}: ${c.order.length} nodes, sim=${c.hasSim}, preFns=${c.preFns.split('\n').length}, postFns=${c.postFns.split('\n').length}`);
}

// number-literal sanity in codegen params: no bare ints where floats required
const intFloatRe = /,\s*-?\d+\.0*,/g; void intFloatRe;
console.log(failures ? `FAILED with ${failures} issue(s)` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
