/**
 * SDF volume nodes — the part that makes caves, tunnels and overhangs possible.
 *
 * Sign convention: NEGATIVE = inside the carved void. The renderer computes
 *
 *     dGround(p) = p.y - height(p.xz) * heightScale     (negative = inside rock)
 *     dFinal(p)  = smax(dGround(p), -dVolume(p), k)     (subtract the void)
 *
 * The ground term is evaluated analytically from the full-resolution heightfield
 * every raymarch step, so the *surface* is never quantised by the volume grid.
 * Only the cave walls live at volume resolution — and those are smooth blobby
 * forms where a soft 128³ or 192³ grid is exactly right.
 */
import { defineNode } from '../graph/types';
import { HEADER, NOISE, FRACTAL, shader } from '../shaders/lib';
import { t2, t3 } from '../gl/GPU';

/** World-space position of the voxel being written, plus height sampling. */
const VOL_COMMON = /* glsl */ `
uniform float uVolRes, uLayer, uWorldSize, uHeightScale;
uniform sampler2D uHeight; uniform float uHasHeight;

vec3 volPos(){
  return vec3((vUV.x - 0.5) * uWorldSize,
              uLayer * uHeightScale,
              (vUV.y - 0.5) * uWorldSize);
}
vec2 volUV(){ return vUV; }

float surfaceAt(vec2 uv){
  return uHasHeight > 0.5 ? texture(uHeight, clamp(uv, 0.0, 1.0)).r * uHeightScale : uHeightScale;
}

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
`;

// ---------------------------------------------------------------------------
// Cave Network — Voronoi-edge tunnels
// ---------------------------------------------------------------------------

export const CaveNetwork = defineNode({
  type: 'caves',
  title: 'Cave Network',
  subtitle: 'Voronoi-edge tunnel system',
  category: 'volume',
  icon: 'cube',
  cost: 8,
  keywords: ['tunnel', 'cavern', 'karst', 'void', 'sdf'],
  inputs: [
    { id: 'height', label: 'Surface', type: 'field', optional: true, info: 'Keeps tunnels below the terrain surface.' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true, info: 'Where on the map caves are allowed.' },
    { id: 'volume', label: 'Volume', type: 'volume', optional: true, info: 'Union with an incoming volume.' },
  ],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    { id: 'density', label: 'Density', kind: 'float', default: 3.2, min: 0.5, max: 16, step: 0.05, info: 'Voronoi cells across the terrain — more cells, more tunnels.' },
    { id: 'radius', label: 'Tunnel Radius', kind: 'float', default: 26, min: 2, max: 200, step: 0.5, unit: 'm' },
    { id: 'verticality', label: 'Verticality', kind: 'float', default: 0.45, min: 0.05, max: 3, step: 0.01, info: 'Squashes the network vertically so tunnels run mostly level.' },
    { id: 'roughness', label: 'Wall Roughness', kind: 'float', default: 0.45, min: 0, max: 2, step: 0.01 },
    { id: 'roughScale', label: 'Roughness Scale', kind: 'float', default: 6, min: 0.5, max: 40, step: 0.1 },
    { id: 'ceiling', label: 'Ceiling Depth', kind: 'float', default: 90, min: 0, max: 800, step: 2, unit: 'm', info: 'Minimum rock thickness kept above a tunnel.' },
    { id: 'floor', label: 'Floor', kind: 'float', default: 0.02, min: 0, max: 1, step: 0.005, info: 'Caves stop below this fraction of the height range.' },
    { id: 'chambers', label: 'Chambers', kind: 'float', default: 0.5, min: 0, max: 1, step: 0.01, info: 'Widens junctions into rooms.' },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const vol = ctx.allocVol();
    const h = ctx.input('height');
    const mask = ctx.input('mask');
    const inVol = ctx.inputVol('volume');
    ctx.gpu.pass3D({
      name: 'vol.caves',
      frag: shader(HEADER, NOISE, FRACTAL, VOL_COMMON, /* glsl */ `
uniform sampler2D uMask; uniform float uHasMask;
uniform sampler3D uIn; uniform float uHasIn;
uniform float uDensity, uRadius, uVert, uRough, uRoughScale, uCeil, uFloor, uChambers, uSeed;
layout(location=0) out vec4 o;
void main(){
  vec3 p = volPos();
  vec3 q = vec3(p.x, p.y / max(0.02, uVert), p.z) / uWorldSize * uDensity + uSeed;

  vec3 w = worley3(q);
  float edge = (w.y - w.x);                       // 0 along cell boundaries
  float cellScale = uWorldSize / max(0.001, uDensity);

  // radius grows at junctions (where F2-F1 stays small in several directions)
  float rad = uRadius * (1.0 + uChambers * (1.0 - smoothstep(0.0, 0.12, w.x)) * 1.6);
  float d = edge * cellScale * 0.5 - rad;

  // rough walls
  if (uRough > 0.0){
    d += fractal3(p / uWorldSize * uRoughScale, 0, 0, 4, 2.1, 0.5, 1.0, 1.0, uSeed + 5.0)
         * uRough * uRadius * 0.6;
  }

  // Keep a rock ceiling: the void must stay uCeil metres below the surface.
  float surf = surfaceAt(volUV());
  float below = (p.y - (surf - uCeil));           // >0 means too close to the surface
  d = smax(d, below, uRadius * 0.6);

  // and above the floor
  float floorY = uFloor * uHeightScale;
  d = smax(d, floorY - p.y, uRadius * 0.6);

  // horizontal mask
  if (uHasMask > 0.5){
    float m = clamp(texture(uMask, volUV()).r, 0.0, 1.0);
    d = mix(1e5, d, m);
  }

  if (uHasIn > 0.5){
    float di = texture(uIn, vec3(vUV, uLayer)).r;
    d = min(d, di);
  }
  o = vec4(d);
}`),
      uniforms: {
        uHeight: t2(h), uHasHeight: h ? 1 : 0,
        uMask: t2(mask), uHasMask: mask ? 1 : 0,
        uIn: t3(inVol), uHasIn: inVol ? 1 : 0,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uDensity: ctx.p.density, uRadius: ctx.p.radius, uVert: ctx.p.verticality,
        uRough: ctx.p.roughness, uRoughScale: ctx.p.roughScale,
        uCeil: ctx.p.ceiling, uFloor: ctx.p.floor, uChambers: ctx.p.chambers,
        uSeed: ctx.p.seed + ctx.seed * 0.13,
      },
      target: vol,
    });
    return { out: vol };
  },
});

// ---------------------------------------------------------------------------
// Gyroid Cavern — triply periodic minimal surface, great for lava-tube lattices
// ---------------------------------------------------------------------------

export const GyroidCavern = defineNode({
  type: 'gyroid',
  title: 'Gyroid Cavern',
  subtitle: 'Periodic lattice voids',
  category: 'volume',
  icon: 'cube',
  cost: 5,
  keywords: ['lattice', 'tpms', 'lava tube', 'honeycomb'],
  inputs: [
    { id: 'height', label: 'Surface', type: 'field', optional: true },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
    { id: 'volume', label: 'Volume', type: 'volume', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    { id: 'scale', label: 'Scale', kind: 'float', default: 7, min: 0.5, max: 48, step: 0.1 },
    { id: 'thickness', label: 'Void Thickness', kind: 'float', default: 0.42, min: 0.02, max: 1.4, step: 0.005 },
    { id: 'squash', label: 'Vertical Squash', kind: 'float', default: 2.2, min: 0.2, max: 8, step: 0.05 },
    { id: 'warp', label: 'Warp', kind: 'float', default: 0.35, min: 0, max: 2, step: 0.01 },
    { id: 'ceiling', label: 'Ceiling Depth', kind: 'float', default: 120, min: 0, max: 800, step: 2, unit: 'm' },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const vol = ctx.allocVol();
    const h = ctx.input('height');
    const mask = ctx.input('mask');
    const inVol = ctx.inputVol('volume');
    ctx.gpu.pass3D({
      name: 'vol.gyroid',
      frag: shader(HEADER, NOISE, FRACTAL, VOL_COMMON, /* glsl */ `
uniform sampler2D uMask; uniform float uHasMask;
uniform sampler3D uIn; uniform float uHasIn;
uniform float uScale, uThick, uSquash, uWarp, uCeil, uSeed;
layout(location=0) out vec4 o;
void main(){
  vec3 p = volPos();
  vec3 q = vec3(p.x, p.y * uSquash, p.z) / uWorldSize * uScale * TAU + uSeed;
  if (uWarp > 0.0){
    q += vec3(fractal3(q * 0.12, 0, 0, 3, 2.0, 0.5, 1.0, 1.0, uSeed),
              fractal3(q * 0.12 + 17.0, 0, 0, 3, 2.0, 0.5, 1.0, 1.0, uSeed),
              fractal3(q * 0.12 - 11.0, 0, 0, 3, 2.0, 0.5, 1.0, 1.0, uSeed)) * uWarp * 3.0;
  }
  float g = sin(q.x)*cos(q.y) + sin(q.y)*cos(q.z) + sin(q.z)*cos(q.x);
  float cellSize = uWorldSize / max(0.01, uScale);
  float d = (abs(g) - uThick) * cellSize * 0.12;

  float surf = surfaceAt(volUV());
  d = smax(d, p.y - (surf - uCeil), cellSize * 0.1);

  if (uHasMask > 0.5){
    float m = clamp(texture(uMask, volUV()).r, 0.0, 1.0);
    d = mix(1e5, d, m);
  }
  if (uHasIn > 0.5) d = min(d, texture(uIn, vec3(vUV, uLayer)).r);
  o = vec4(d);
}`),
      uniforms: {
        uHeight: t2(h), uHasHeight: h ? 1 : 0,
        uMask: t2(mask), uHasMask: mask ? 1 : 0,
        uIn: t3(inVol), uHasIn: inVol ? 1 : 0,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uScale: ctx.p.scale, uThick: ctx.p.thickness, uSquash: ctx.p.squash,
        uWarp: ctx.p.warp, uCeil: ctx.p.ceiling, uSeed: ctx.p.seed + ctx.seed * 0.23,
      },
      target: vol,
    });
    return { out: vol };
  },
});

// ---------------------------------------------------------------------------
// Noise Carve — blobby 3D-noise voids, good for eroded karst pockets
// ---------------------------------------------------------------------------

export const NoiseCarve = defineNode({
  type: 'noisecarve',
  title: 'Noise Carve',
  subtitle: '3D noise isosurface voids',
  category: 'volume',
  icon: 'cube',
  cost: 6,
  keywords: ['pocket', 'karst', 'swiss cheese', 'void'],
  inputs: [
    { id: 'height', label: 'Surface', type: 'field', optional: true },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
    { id: 'volume', label: 'Volume', type: 'volume', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    { id: 'scale', label: 'Scale', kind: 'float', default: 5, min: 0.3, max: 40, step: 0.05 },
    { id: 'threshold', label: 'Threshold', kind: 'float', default: 0.28, min: -1, max: 1, step: 0.005, info: 'Higher = more rock removed.' },
    { id: 'octaves', label: 'Octaves', kind: 'int', default: 4, min: 1, max: 10, step: 1 },
    { id: 'squash', label: 'Vertical Squash', kind: 'float', default: 1.8, min: 0.2, max: 8, step: 0.05 },
    { id: 'ceiling', label: 'Ceiling Depth', kind: 'float', default: 80, min: 0, max: 800, step: 2, unit: 'm' },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const vol = ctx.allocVol();
    const h = ctx.input('height');
    const mask = ctx.input('mask');
    const inVol = ctx.inputVol('volume');
    ctx.gpu.pass3D({
      name: 'vol.noisecarve',
      frag: shader(HEADER, NOISE, FRACTAL, VOL_COMMON, /* glsl */ `
uniform sampler2D uMask; uniform float uHasMask;
uniform sampler3D uIn; uniform float uHasIn;
uniform float uScale, uThresh, uSquash, uCeil, uSeed; uniform int uOct;
layout(location=0) out vec4 o;
void main(){
  vec3 p = volPos();
  vec3 q = vec3(p.x, p.y * uSquash, p.z) / uWorldSize * uScale;
  float n = fractal3(q, 0, 0, uOct, 2.05, 0.5, 1.0, 1.0, uSeed);
  float cellSize = uWorldSize / max(0.01, uScale);
  float d = (uThresh - n) * cellSize * 0.25;
  float surf = surfaceAt(volUV());
  d = smax(d, p.y - (surf - uCeil), cellSize * 0.1);
  if (uHasMask > 0.5) d = mix(1e5, d, clamp(texture(uMask, volUV()).r, 0.0, 1.0));
  if (uHasIn > 0.5) d = min(d, texture(uIn, vec3(vUV, uLayer)).r);
  o = vec4(d);
}`),
      uniforms: {
        uHeight: t2(h), uHasHeight: h ? 1 : 0,
        uMask: t2(mask), uHasMask: mask ? 1 : 0,
        uIn: t3(inVol), uHasIn: inVol ? 1 : 0,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uScale: ctx.p.scale, uThresh: ctx.p.threshold, uSquash: ctx.p.squash,
        uCeil: ctx.p.ceiling, uSeed: ctx.p.seed + ctx.seed * 0.41,
      },
      ints: { uOct: ctx.p.octaves },
      target: vol,
    });
    return { out: vol };
  },
});

// ---------------------------------------------------------------------------
// Undercut — horizontal notches into cliff faces => genuine overhangs
// ---------------------------------------------------------------------------

export const Undercut = defineNode({
  type: 'undercut',
  title: 'Undercut',
  subtitle: 'Notch cliff bases into overhangs',
  category: 'volume',
  icon: 'cube',
  cost: 7,
  keywords: ['overhang', 'notch', 'wave cut', 'alcove', 'scallop'],
  inputs: [
    { id: 'height', label: 'Surface', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true, info: 'Where to cut — try Wear from Hydraulic, or a Height Select band.' },
    { id: 'volume', label: 'Volume', type: 'volume', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    { id: 'band', label: 'Band Height', kind: 'float', default: 0.34, min: 0, max: 1, step: 0.005, info: 'Fraction of the height range where the notch sits.' },
    { id: 'bandWidth', label: 'Band Thickness', kind: 'float', default: 55, min: 4, max: 500, step: 1, unit: 'm' },
    { id: 'depth', label: 'Cut Depth', kind: 'float', default: 60, min: 0, max: 600, step: 1, unit: 'm' },
    { id: 'minSlope', label: 'Min Slope', kind: 'float', default: 42, min: 0, max: 89, step: 0.5, unit: '°', info: 'Only faces steeper than this get undercut.' },
    { id: 'roughness', label: 'Roughness', kind: 'float', default: 0.4, min: 0, max: 2, step: 0.01 },
    { id: 'roughScale', label: 'Roughness Scale', kind: 'float', default: 14, min: 0.5, max: 80, step: 0.5 },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const h = ctx.input('height');
    if (!h) return { out: ctx.inputVol('volume') ?? null };
    const vol = ctx.allocVol();
    const mask = ctx.input('mask');
    const inVol = ctx.inputVol('volume');
    ctx.gpu.pass3D({
      name: 'vol.undercut',
      frag: shader(HEADER, NOISE, FRACTAL, VOL_COMMON, /* glsl */ `
uniform sampler2D uMask; uniform float uHasMask;
uniform sampler3D uIn; uniform float uHasIn;
uniform float uBand, uBandW, uDepth, uSlopeTan, uRough, uRoughScale, uSeed, uCell;
layout(location=0) out vec4 o;
void main(){
  vec3 p = volPos();
  vec2 uv = volUV();
  float surf = surfaceAt(uv);

  // local steepness of the terrain, in world units
  float e = 1.0 / uVolRes;
  float hl = surfaceAt(uv - vec2(e, 0.0));
  float hr = surfaceAt(uv + vec2(e, 0.0));
  float hd = surfaceAt(uv - vec2(0.0, e));
  float hu = surfaceAt(uv + vec2(0.0, e));
  float run = 2.0 * e * uWorldSize;
  vec2 g = vec2(hr - hl, hu - hd) / run;
  float steep = smoothstep(uSlopeTan * 0.7, uSlopeTan * 1.5, length(g));

  float m = uHasMask > 0.5 ? clamp(texture(uMask, uv).r, 0.0, 1.0) : 1.0;
  float amount = steep * m;

  // shell hugging the surface, thickness driven by how much we want to cut
  float distToSurf = p.y - surf;                      // <0 inside the rock
  float thick = uDepth * amount;
  float shell = max(distToSurf, -(distToSurf + thick));

  // vertical band so the notch is a horizontal stripe, not the whole face
  float centre = uBand * uHeightScale;
  float bandD = abs(p.y - centre) - uBandW * 0.5;

  float d = max(shell, bandD);

  if (uRough > 0.0){
    d += fractal3(p / uWorldSize * uRoughScale, 0, 0, 4, 2.1, 0.5, 1.0, 1.0, uSeed)
         * uRough * uBandW * 0.25;
  }
  if (thick < 0.5) d = 1e5;

  if (uHasIn > 0.5) d = min(d, texture(uIn, vec3(vUV, uLayer)).r);
  o = vec4(d);
}`),
      uniforms: {
        uHeight: t2(h), uHasHeight: 1,
        uMask: t2(mask), uHasMask: mask ? 1 : 0,
        uIn: t3(inVol), uHasIn: inVol ? 1 : 0,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uBand: ctx.p.band, uBandW: ctx.p.bandWidth, uDepth: ctx.p.depth,
        uSlopeTan: Math.tan((ctx.p.minSlope * Math.PI) / 180),
        uRough: ctx.p.roughness, uRoughScale: ctx.p.roughScale,
        uSeed: ctx.p.seed + ctx.seed * 0.67, uCell: ctx.cell,
      },
      target: vol,
    });
    return { out: vol };
  },
});

// ---------------------------------------------------------------------------
// SDF Combine
// ---------------------------------------------------------------------------

export const SDFCombine = defineNode({
  type: 'sdfcombine',
  title: 'SDF Combine',
  subtitle: 'Boolean ops on volumes',
  category: 'volume',
  icon: 'cube',
  cost: 3,
  keywords: ['union', 'subtract', 'intersect', 'boolean', 'smooth'],
  inputs: [
    { id: 'a', label: 'A', type: 'volume' },
    { id: 'b', label: 'B', type: 'volume' },
  ],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    {
      id: 'mode', label: 'Operation', kind: 'enum', default: 'union',
      options: [
        { value: 'union', label: 'Union' },
        { value: 'subtract', label: 'Subtract (A − B)' },
        { value: 'intersect', label: 'Intersect' },
      ],
    },
    { id: 'smooth', label: 'Smoothness', kind: 'float', default: 20, min: 0, max: 400, step: 1, unit: 'm' },
  ],
  evaluate(ctx) {
    const a = ctx.inputVol('a');
    const b = ctx.inputVol('b');
    if (!a) return { out: b };
    if (!b) return { out: a };
    const vol = ctx.allocVol();
    ctx.gpu.pass3D({
      name: 'vol.combine',
      frag: shader(HEADER, VOL_COMMON, /* glsl */ `
uniform sampler3D uA, uB; uniform int uMode; uniform float uK;
layout(location=0) out vec4 o;
void main(){
  vec3 c = vec3(vUV, uLayer);
  float a = texture(uA, c).r;
  float b = texture(uB, c).r;
  float k = max(1e-3, uK);
  float d;
  if (uMode == 0) d = uK > 0.0 ? smin(a, b, k) : min(a, b);
  else if (uMode == 1) d = uK > 0.0 ? smax(a, -b, k) : max(a, -b);
  else d = uK > 0.0 ? smax(a, b, k) : max(a, b);
  o = vec4(d);
}`),
      uniforms: {
        uA: t3(a), uB: t3(b), uK: ctx.p.smooth,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uHeight: 0, uHasHeight: 0,
      },
      ints: { uMode: { union: 0, subtract: 1, intersect: 2 }[ctx.p.mode as string] ?? 0 },
      target: vol,
    });
    return { out: vol };
  },
});

export const VolumeDisplace = defineNode({
  type: 'voldisplace',
  title: 'Volume Displace',
  subtitle: 'Roughen SDF walls',
  category: 'volume',
  icon: 'cube',
  cost: 4,
  inputs: [{ id: 'volume', label: 'Volume', type: 'volume' }],
  outputs: [{ id: 'out', label: 'Volume', type: 'volume' }],
  params: [
    { id: 'amount', label: 'Amount', kind: 'float', default: 18, min: 0, max: 300, step: 0.5, unit: 'm' },
    { id: 'scale', label: 'Scale', kind: 'float', default: 12, min: 0.5, max: 80, step: 0.25 },
    { id: 'octaves', label: 'Octaves', kind: 'int', default: 4, min: 1, max: 8, step: 1 },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const a = ctx.inputVol('volume');
    if (!a) return { out: null };
    const vol = ctx.allocVol();
    ctx.gpu.pass3D({
      name: 'vol.displace',
      frag: shader(HEADER, NOISE, FRACTAL, VOL_COMMON, /* glsl */ `
uniform sampler3D uA; uniform float uAmt, uScale, uSeed; uniform int uOct;
layout(location=0) out vec4 o;
void main(){
  vec3 c = vec3(vUV, uLayer);
  float d = texture(uA, c).r;
  vec3 p = volPos() / uWorldSize * uScale;
  d += fractal3(p, 0, 0, uOct, 2.07, 0.5, 1.0, 1.0, uSeed) * uAmt;
  o = vec4(d);
}`),
      uniforms: {
        uA: t3(a), uAmt: ctx.p.amount, uScale: ctx.p.scale,
        uSeed: ctx.p.seed + ctx.seed * 0.83,
        uWorldSize: ctx.worldSize, uHeightScale: ctx.heightScale,
        uHeight: 0, uHasHeight: 0,
      },
      ints: { uOct: ctx.p.octaves },
      target: vol,
    });
    return { out: vol };
  },
});
