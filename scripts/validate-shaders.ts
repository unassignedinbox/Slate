/**
 * Shader smoke test.
 *
 * There is no GPU here, so instead of compiling we mock the GPU, run every
 * registered node's evaluate() across its enum permutations (once with all
 * inputs connected, once with none), capture every fragment source that would
 * actually be submitted, and then run three checks on each:
 *
 *   1. it parses as GLSL ES 3.00
 *   2. every identifier resolves to a declaration or a known builtin
 *   3. every `uniform` the shader declares is actually supplied by the pass
 *      (a missing uniform silently reads as 0 on the GPU — black output, no error)
 *
 *   npm run validate:shaders
 */
import { parser } from '@shaderfrog/glsl-parser';
import { allNodeDefs, defaultParams, type EvalCtx, type NodeDef } from '../src/core/graph/types';
import '../src/core/nodes';
import { RAYMARCH_FRAG } from '../src/render/raymarch';

interface Captured {
  name: string;
  frag: string;
  origin: string;
  supplied: Set<string>;
}

const captured: Captured[] = [];
let origin = '';

const fakeTex = (fmt = 'R32F') => ({ tex: {} as any, w: 512, h: 512, fmt, key: 'k', uid: Math.random() });
const fakeVol = () => ({ tex: {} as any, size: 64, uid: Math.random() });

function record(o: any, injected: string[]) {
  captured.push({
    name: o.name,
    frag: o.frag,
    origin,
    supplied: new Set([...Object.keys(o.uniforms ?? {}), ...Object.keys(o.ints ?? {}), ...injected]),
  });
}

const mockGPU: any = {
  pass: (o: any) => record(o, ['uTexel', 'uRes']),
  pass3D: (o: any) => record(o, ['uTexel', 'uRes', 'uVolRes', 'uLayer']),
  present: (o: any) => record(o, ['uTexel', 'uRes']),
  alloc: (_w: number, _h: number, fmt: string) => fakeTex(fmt),
  allocVolume: () => fakeVol(),
  free() {},
  freeVolume() {},
  minMax: () => [0, 1] as [number, number],
  read: () => new Float32Array(4),
  readBytes: () => new Uint8Array(4),
  lut: () => ({}),
};

function makeCtx(def: NodeDef, connected: boolean, params: Record<string, any>): EvalCtx {
  return {
    gpu: mockGPU,
    res: 512,
    volRes: 64,
    worldSize: 4096,
    heightScale: 900,
    cell: 8,
    seed: 7,
    p: params,
    input: (id) => {
      if (!connected) return null;
      const port = def.inputs.find((i) => i.id === id);
      if (!port || port.type === 'volume') return null;
      return fakeTex(port.type === 'color' ? 'RGBA8' : 'R32F') as any;
    },
    inputVol: (id) => {
      if (!connected) return null;
      const port = def.inputs.find((i) => i.id === id);
      return port && port.type === 'volume' ? (fakeVol() as any) : null;
    },
    inputOr: () => fakeTex() as any,
    alloc: (fmt = 'R32F') => fakeTex(fmt) as any,
    allocVol: () => fakeVol() as any,
    release() {},
    releaseVol() {},
    warn() {},
    tick() {},
    aborted: () => false,
  };
}

function enumCombos(def: NodeDef): Record<string, any>[] {
  const base = defaultParams(def.type);
  const out: Record<string, any>[] = [base];
  for (const p of def.params) {
    if (p.kind !== 'enum' || !p.options) continue;
    for (const o of p.options) {
      if (o.value === base[p.id]) continue;
      out.push({ ...base, [p.id]: o.value });
    }
  }
  for (const c of out) {
    for (const p of def.params) {
      if (['iterations', 'accumIters', 'inciseIters', 'passes', 'settle'].includes(p.id)) c[p.id] = 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- builtins

const BUILTIN_FNS = new Set([
  'radians','degrees','sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','asinh','acosh','atanh',
  'pow','exp','log','exp2','log2','sqrt','inversesqrt','abs','sign','floor','trunc','round','roundEven',
  'ceil','fract','mod','modf','min','max','clamp','mix','step','smoothstep','isnan','isinf',
  'floatBitsToInt','floatBitsToUint','intBitsToFloat','uintBitsToFloat',
  'packSnorm2x16','unpackSnorm2x16','packUnorm2x16','unpackUnorm2x16','packHalf2x16','unpackHalf2x16',
  'length','distance','dot','cross','normalize','faceforward','reflect','refract',
  'matrixCompMult','outerProduct','transpose','determinant','inverse',
  'lessThan','lessThanEqual','greaterThan','greaterThanEqual','equal','notEqual','any','all','not',
  'texture','textureProj','textureLod','textureOffset','texelFetch','texelFetchOffset',
  'textureProjOffset','textureLodOffset','textureProjLod','textureProjLodOffset',
  'textureGrad','textureGradOffset','textureProjGrad','textureProjGradOffset','textureSize',
  'dFdx','dFdy','fwidth',
  // constructors — the parser sees these as calls
  'float','int','uint','bool','vec2','vec3','vec4','ivec2','ivec3','ivec4','uvec2','uvec3','uvec4',
  'bvec2','bvec3','bvec4','mat2','mat3','mat4','mat2x2','mat2x3','mat2x4','mat3x2','mat3x3','mat3x4',
  'mat4x2','mat4x3','mat4x4',
]);

const BUILTIN_VARS = new Set([
  'gl_Position','gl_PointSize','gl_FragCoord','gl_FrontFacing','gl_PointCoord','gl_FragDepth',
  'gl_VertexID','gl_InstanceID','gl_FragColor','gl_MaxVertexAttribs','gl_DepthRange',
]);

const UNIFORM_RE = /^[ \t]*uniform[ \t]+(?:highp|mediump|lowp)?[ \t]*([A-Za-z_]\w*)[ \t]+([^;]+);/gm;

function declaredUniforms(src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  UNIFORM_RE.lastIndex = 0;
  while ((m = UNIFORM_RE.exec(src))) {
    for (const raw of m[2].split(',')) {
      const name = raw.trim().replace(/\[.*$/, '').trim();
      if (name) out.push(name);
    }
  }
  return out;
}

// ------------------------------------------------------------------- run

let ran = 0;
for (const def of allNodeDefs()) {
  for (const params of enumCombos(def)) {
    for (const connected of [true, false]) {
      origin = `${def.type}${connected ? '' : ' [unconnected]'}`;
      try {
        def.evaluate(makeCtx(def, connected, { ...params }));
        ran++;
      } catch (e: any) {
        console.error(`✗ ${def.type} threw during evaluate: ${e?.message ?? e}`);
        process.exitCode = 1;
      }
    }
  }
}

origin = 'viewport';
captured.push({
  name: 'view.raymarch',
  frag: RAYMARCH_FRAG,
  origin,
  supplied: new Set([
    'uHeight','uColor','uWater','uVolume','uHasHeight','uHasColor','uHasWater','uHasVolume',
    'uCamPos','uCamTarget','uFov','uWorldSize','uHeightScale','uExag','uSeaLevel','uCaveBlend',
    'uSunDir','uSunIntensity','uAmbient','uSkyTop','uSkyBottom','uGroundCol','uShowGrid','uShowWater',
    'uShadows','uAO','uFog','uQuality','uWireframe','uShadeMode','uTime','uTexel','uRes',
  ]),
});

// merge sources: a shader may be submitted from several places; require every
// uniform to be satisfied by at least one of them
const bySrc = new Map<string, { info: Captured; supplied: Set<string>[] }>();
for (const c of captured) {
  const hit = bySrc.get(c.frag);
  if (hit) hit.supplied.push(c.supplied);
  else bySrc.set(c.frag, { info: c, supplied: [c.supplied] });
}

// A pass name is also its debug label; two different sources sharing one name
// used to collide in the program cache. Keep them distinct so the label stays
// meaningful and the old failure mode cannot come back.
{
  const byName = new Map<string, Set<string>>();
  for (const c of captured) {
    const set = byName.get(c.name) ?? new Set<string>();
    set.add(c.frag);
    byName.set(c.name, set);
  }
  for (const [name, srcs] of byName) {
    if (srcs.size > 1) {
      process.exitCode = 1;
      console.error(`\n✗ [name] pass name "${name}" is used by ${srcs.size} different shader sources`);
    }
  }
}

let failures = 0;
const fail = (info: Captured, kind: string, detail: string, line?: number, src?: string) => {
  failures++;
  process.exitCode = 1;
  console.error(`\n✗ [${kind}] ${info.name}  (from ${info.origin})`);
  console.error(`  ${detail}`);
  if (line && src) {
    const lines = src.split('\n');
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) {
      console.error(`   ${i === line - 1 ? '>' : ' '} ${String(i + 1).padStart(4)}| ${lines[i]}`);
    }
  }
};

for (const [src, { info, supplied }] of bySrc) {
  let ast: any;
  try {
    ast = parser.parse(src, { quiet: true });
  } catch (e: any) {
    fail(info, 'parse', e.message?.split('\n')[0] ?? String(e), e?.location?.start?.line, src);
    continue;
  }

  // ---- 2. undeclared identifiers
  const undeclaredVars: string[] = [];
  const undeclaredFns: string[] = [];
  for (const scope of ast.scopes ?? []) {
    for (const [name, b] of Object.entries<any>(scope.bindings ?? {})) {
      if (!b.declaration && !BUILTIN_VARS.has(name)) undeclaredVars.push(name);
    }
    for (const [name, overloads] of Object.entries<any>(scope.functions ?? {})) {
      if (BUILTIN_FNS.has(name)) continue;
      const anyDecl = Object.values<any>(overloads).some((o) => !!o.declaration);
      if (!anyDecl) undeclaredFns.push(name);
    }
  }
  if (undeclaredVars.length) fail(info, 'undeclared', `variables: ${[...new Set(undeclaredVars)].join(', ')}`);
  if (undeclaredFns.length) fail(info, 'undeclared', `functions: ${[...new Set(undeclaredFns)].join(', ')}`);

  // ---- 3. uniforms actually supplied
  const needed = declaredUniforms(src);
  const missing = needed.filter((u) => !supplied.some((s) => s.has(u)));
  if (missing.length) fail(info, 'uniform', `declared but never set: ${missing.join(', ')}`);
}

console.log(`\nevaluated ${ran} node invocations`);
console.log(`checked ${bySrc.size} unique fragment shaders — ${failures} problem${failures === 1 ? '' : 's'}`);
if (!failures) console.log('parse + scope + uniform binding all clean ✓');
