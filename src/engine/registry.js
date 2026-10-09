// Node registry: every Gaea node id (1-240) plus one extra Substance-style fill (241).
// mode: how the stack applies the node
//   'gen'     returns Float32Array field -> blended onto height with the layer blend mode
//   'mod'     returns new height        -> lerped onto height by opacity * mask
//   'combine' blends height with a secondary source using a Gaea combiner blend mode
//   'xform'   remaps the whole state (height, albedo, maps)
//   'obj'     returns {type,...}: color/map/mod/pass (see color.js, utility.js)
//   'mask'    standalone mask layer: sets the mask consumed by the next layer
import { PRIMITIVES, GRADIENTS, SHAPES } from './generators.js';
import { FILTERS, BLEND, TRANSFORMS, derivedField } from './ops.js';
import { EROSION } from './erosion.js';
import { boxBlur, gaussBlur } from './grid.js';
import { perlin as _perlin, fbm as _fbm } from './noise.js';
import { GEOLOGY } from './geology.js';
import { WATER } from './water.js';
import { COLOR, PALETTES, hex } from './color.js';
import { UTILITY, VEGETATION } from './utility.js';
import { MASKS, maskNames, deriveFor } from './masks.js';

// ---- parameter helpers ----
const num = (k, l, d, min = 0, max = 1, s = 0.01) => ({ k, l, d, min, max, s, t: 'num' });
const sel = (k, l, d, opts) => ({ k, l, d, opts, t: 'sel' });
const col = (k, l, d) => ({ k, l, d, t: 'col' });
const bool = (k, l, d) => ({ k, l, d, t: 'bool' });

const SEED = num('seed', 'Seed', 1, 0, 9999, 1);
const BASE = [num('scale', 'Scale', 4, 0.1, 64, 0.1), num('offsetX', 'Offset X', 0, -50, 50, 0.01), num('offsetY', 'Offset Y', 0, -50, 50, 0.01), num('rotation', 'Rotation°', 0, -180, 180, 1), SEED];
const FRAC = [num('octaves', 'Octaves', 6, 1, 10, 1), num('lacunarity', 'Lacunarity', 2, 1, 4, 0.05), num('gain', 'Gain', 0.5, 0, 1, 0.01)];
const CENTER = [num('centerX', 'Center X', 0.5, 0, 1, 0.01), num('centerY', 'Center Y', 0.5, 0, 1, 0.01), num('radius', 'Radius', 0.35, 0.02, 1, 0.01)];
const ANGLE = (d = 0) => num('angle', 'Angle°', d, -180, 180, 1);
const AMT = (d = 0.15) => num('amount', 'Amount', d, 0, 1, 0.01);
const RADIUS = (d = 3, max = 40) => num('radius', 'Radius', d, 0.5, max, 0.5);

const TERRAIN_PALETTE = sel('palette', 'Palette', 'earth', Object.keys(PALETTES));
const COLOR_P = col('color', 'Color', '#8a8a8a');
const MAP_LINE = (k, l, d) => num(k, l, d, 0, 1, 0.01);

// ---- node table ----
const N = []; // collected entries
function def(id, name, cat, mode, params, run, notes = '') {
  N.push({ id, name, cat, mode, params, run, notes });
}

// 1-28 primitives
const PRIM_EXTRA = {
  1: [num('value', 'Value', 0.5, 0, 1, 0.01)],
  5: [num('jitter', 'Jitter', 1, 0, 1, 0.01)], 6: [num('jitter', 'Jitter', 1, 0, 1, 0.01)], 7: [num('jitter', 'Jitter', 1, 0, 1, 0.01)], 8: [num('jitter', 'Jitter', 1, 0, 1, 0.01)],
  9: [num('jitter', 'Jitter', 1, 0, 1, 0.01)], 10: [num('jitter', 'Jitter', 1, 0, 1, 0.01)],
  12: [ANGLE(0)], 21: [num('lineWidth', 'Line width', 0.1, 0.01, 0.5, 0.01)], 23: [num('lineWidth', 'Mortar', 0.08, 0.01, 0.4, 0.01)],
};
const PRIM_NAMES = ['Constant', 'Perlin', 'Simplex', 'Value Noise', 'Voronoi (F1)', 'Voronoi (F2)', 'Voronoi (F3)', 'Voronoi (F4)', 'Voronoi Crackle', 'Worley', 'Cellular', 'Gabor', 'Sparse Convolution', 'Wavelet', 'fBm (Fractal Brownian Motion)', 'Ridged Multifractal', 'Billow', 'Swiss', 'Jordan', 'Random', 'Grid', 'Hexagonal', 'Brick', 'Checker', 'Stripes', 'Sine', 'Sawtooth', 'Triangle Wave'];
const PRIM_PARAMS = (id) => {
  if (id === 1) return [...(PRIM_EXTRA[1]), SEED];
  if (id === 20) return [SEED];
  if (id === 11) return [...BASE];
  if (id >= 21 && id <= 28) return [...BASE, ...(PRIM_EXTRA[id] || [])];
  if (id === 15 || id === 16 || id === 17 || id === 18 || id === 19 || id === 14 || id === 4 || id === 2 || id === 3 || id === 13 || id === 12 || id === 5 || id === 6 || id === 7 || id === 8 || id === 9 || id === 10) return [...BASE, ...(PRIM_EXTRA[id] || []), ...(id >= 15 && id <= 19 ? FRAC : [])];
  return [...BASE];
};
PRIM_NAMES.forEach((name, k) => {
  const id = k + 1;
  def(id, name, 'Primitives', 'gen', PRIM_PARAMS(id), (p, st) => {
    const f = PRIMITIVES[id];
    return f ? f(p, st.N) : new Float32Array(st.N * st.N);
  });
});

// 29-52 gradients / shapes
const SHAPE_NAMES = [
  ['Gradient Linear', 'Gradients', [ANGLE(0), num('extent', 'Extent', 1, 0.1, 4, 0.05)]],
  ['Gradient Radial', 'Gradients', [num('extent', 'Extent', 1, 0.1, 4, 0.05)]],
  ['Gradient Angular', 'Gradients', [num('offset', 'Offset', 0, 0, 1, 0.01)]],
  ['Gradient Square', 'Gradients', [num('extent', 'Extent', 1, 0.1, 4, 0.05)]],
  ['Shape Circle', 'Shapes', [...CENTER, num('detail', 'Edge noise', 0.15, 0, 1, 0.01), SEED]],
  ['Shape Square', 'Shapes', [...CENTER, num('detail', 'Edge noise', 0.15, 0, 1, 0.01), SEED]],
  ['Shape Triangle', 'Shapes', [...CENTER, num('detail', 'Edge noise', 0.15, 0, 1, 0.01), SEED]],
  ['Shape Star', 'Shapes', [...CENTER, num('detail', 'Edge noise', 0.15, 0, 1, 0.01), SEED]],
  ['Mountain', 'Shapes', [...CENTER, ...FRAC, SEED]],
  ['Volcano', 'Shapes', [...CENTER, SEED]],
  ['Mesa', 'Shapes', [num('radius', 'Radius', 0.4, 0.05, 1, 0.01), num('height', 'Height', 0.6, 0, 1, 0.01), SEED]],
  ['Dunes', 'Shapes', [ANGLE(20), num('wavelength', 'Wavelength', 0.12, 0.01, 1, 0.01), SEED]],
  ['Hills', 'Shapes', [...BASE, ...FRAC]],
  ['Ridges', 'Shapes', [...BASE, ...FRAC]],
  ['Crater', 'Shapes', [...CENTER, num('detail', 'Rim noise', 0.2, 0, 1, 0.01), SEED]],
  ['Canyon', 'Shapes', [num('width', 'Width', 0.08, 0.01, 0.4, 0.01), SEED]],
  ['Plain', 'Shapes', [...BASE, ...FRAC]],
  ['Plateau', 'Shapes', [num('detail', 'Edge noise', 0.1, 0, 1, 0.01), SEED]],
  ['Cliff', 'Shapes', [num('position', 'Position', 0, -1, 1, 0.01), SEED]],
  ['Rocky', 'Shapes', [...BASE, ...FRAC]],
  ['Badlands', 'Shapes', [...BASE, ...FRAC]],
  ['Coast', 'Shapes', [...BASE, ...FRAC]],
  ['Island', 'Shapes', [...CENTER, num('detail', 'Coast noise', 0.15, 0, 1, 0.01), SEED]],
  ['Continent', 'Shapes', [...BASE, ...FRAC]],
];
SHAPE_NAMES.forEach(([name, cat, params], k) => {
  const id = 29 + k;
  const f = id <= 32 ? GRADIENTS[id] : SHAPES[id];
  def(id, name, cat, 'gen', params, (p, st) => f(p, st.N));
});

// 53-69 erosion
const ERO = [
  ['Hydraulic (General)', [num('iterations', 'Droplets', 40000, 1000, 200000, 1000), SEED]],
  ['Hydraulic Rain', [num('iterations', 'Raindrops', 80000, 1000, 300000, 1000), SEED]],
  ['Hydraulic Flow', [num('K', 'Carve K', 0.4, 0, 3, 0.01), num('iterations', 'Passes', 4, 1, 12, 1)]],
  ['Hydraulic Stream', [num('K', 'Carve K', 0.6, 0, 3, 0.01), num('threshold', 'Stream area', 40, 0, 5000, 1), num('iterations', 'Passes', 4, 1, 12, 1)]],
  ['Hydraulic River', [num('K', 'Carve K', 0.8, 0, 3, 0.01), num('threshold', 'River area', 400, 0, 20000, 10), num('iterations', 'Passes', 6, 1, 12, 1)]],
  ['Thermal', [num('talus', 'Talus', 0.01, 0.001, 0.1, 0.001), num('rate', 'Rate', 0.5, 0, 1, 0.01), num('iterations', 'Iterations', 40, 1, 300, 1)]],
  ['Wind', [ANGLE(0), num('strength', 'Strength', 0.3, 0, 2, 0.01)]],
  ['Glacial', [num('width', 'Valley width', 6, 1, 30, 1), num('depth', 'Depth', 0.06, 0, 0.3, 0.005), num('threshold', 'Ice flow', 0.02, 0, 0.2, 0.001)]],
  ['Coastal', [num('seaLevel', 'Sea level', 0.2, 0, 1, 0.01), num('band', 'Band', 0.05, 0.01, 0.3, 0.01), num('strength', 'Strength', 0.5, 0, 1, 0.01)]],
  ['Cascade', [num('threshold', 'Steep threshold', 0.02, 0, 0.3, 0.001), num('steps', 'Steps', 3, 1, 12, 1), num('amount', 'Step size', 0.02, 0, 0.1, 0.001)]],
  ['Sediment Transport', [num('radius', 'Radius', 4, 1, 20, 1), AMT(0.5)]],
  ['Debris Flow', [num('threshold', 'Threshold', 0.25, 0, 1, 0.01), num('rate', 'Rate', 0.3, 0, 1, 0.01), num('iterations', 'Iterations', 8, 1, 60, 1)]],
  ['Snowmelt', [num('snowline', 'Snowline', 0.6, 0, 1, 0.01), num('rate', 'Rate', 0.4, 0, 1, 0.01)]],
  ['FastErosion', [num('K', 'K', 0.4, 0, 2, 0.01)]],
  ['FlowErosion', [num('strength', 'Strength', 0.5, 0, 1, 0.01), num('steps', 'Steps', 6, 1, 20, 1)]],
  ['RainErosion', [num('strength', 'Strength', 0.5, 0, 2, 0.01)]],
  ['StreamErosion', [num('K', 'K', 0.5, 0, 3, 0.01), num('threshold', 'Stream area', 0, 0, 5000, 1), num('iterations', 'Passes', 4, 1, 12, 1)]],
];
ERO.forEach(([name, params], k) => {
  const id = 53 + k;
  def(id, name, 'Erosion', 'mod', params, (p, st, h) => EROSION[id](h, st.N, { ...p, seaLevel: st.seaLevel ?? p.seaLevel }));
});

// 70-84 geology
const GEO = [
  ['Strata', [num('layers', 'Layers', 12, 2, 60, 1), num('tilt', 'Tilt', 0.4, -2, 2, 0.01), AMT(0.5), SEED]],
  ['Sediment', [num('radius', 'Radius', 6, 1, 30, 1), AMT(0.3)]],
  ['Outcrop', [num('threshold', 'Height threshold', 0.55, 0, 1, 0.01), AMT(0.12), SEED]],
  ['Fault', [ANGLE(30), num('offset', 'Offset', 0, -0.5, 0.5, 0.01), num('throw', 'Throw', 0.12, -0.5, 0.5, 0.01), num('softness', 'Softness', 0.02, 0.001, 0.2, 0.001)]],
  ['Fold', [num('amplitude', 'Amplitude', 0.08, 0, 0.5, 0.01), num('frequency', 'Frequency', 3, 0.5, 12, 0.1), ANGLE(0)]],
  ['Tectonic', [num('scale', 'Plate scale', 4, 1, 16, 0.5), num('width', 'Boundary width', 0.05, 0.005, 0.3, 0.005), AMT(0.15), SEED]],
  ['Uplift', [...CENTER.slice(0, 2), num('radius', 'Radius', 0.5, 0.05, 1, 0.01), AMT(0.15)]],
  ['Subsidence', [...CENTER.slice(0, 2), num('radius', 'Radius', 0.5, 0.05, 1, 0.01), AMT(0.15)]],
  ['Graben', [ANGLE(0), num('width', 'Width', 0.12, 0.01, 0.5, 0.01), AMT(0.12)]],
  ['Horst', [ANGLE(0), num('width', 'Width', 0.12, 0.01, 0.5, 0.01), AMT(0.12)]],
  ['Volcanic', [...CENTER, num('height', 'Cone height', 0.45, 0, 1, 0.01), SEED]],
  ['Lava Flow', [num('thickness', 'Thickness', 0.02, 0, 0.2, 0.001), num('length', 'Path length', 500, 10, 4000, 10)]],
  ['Impact', [...CENTER, num('depth', 'Depth', 0.12, 0, 0.5, 0.01)]],
  ['Meteor', [num('count', 'Count', 25, 1, 200, 1), num('radius', 'Radius', 0.03, 0.005, 0.2, 0.001), num('depth', 'Depth', 0.04, 0, 0.3, 0.01), SEED]],
  ['Mineral', [num('scale', 'Vein scale', 6, 1, 30, 0.5), AMT(0.03), SEED]],
];
GEO.forEach(([name, params], k) => {
  const id = 70 + k;
  def(id, name, 'Geology', 'mod', params, (p, st, h) => GEOLOGY[id](h, st.N, p, st));
});

// 85-94 water (carve into the heightmap)
const WAT = [
  ['Water Fill', [num('level', 'Water level', 0.25, 0, 1, 0.01)]],
  ['Lake', [num('minDepth', 'Min depth', 0.02, 0, 0.2, 0.001), num('selectivity', 'Selectivity', 0.6, 0, 1, 0.01), num('deepen', 'Deepen', 0.5, 0, 2, 0.01)]],
  ['River', [num('threshold', 'Channel area', 0.03, 0.001, 0.5, 0.001), num('depth', 'Carve depth', 0.05, 0, 0.3, 0.001), num('width', 'Bank blur', 1, 0, 6, 1), num('waterLift', 'Surface lift', 0.004, 0, 0.05, 0.001)]],
  ['Stream', [num('threshold', 'Channel area', 0.008, 0.001, 0.5, 0.001), num('depth', 'Carve depth', 0.015, 0, 0.3, 0.001)]],
  ['Ocean', [num('level', 'Sea level', 0.2, 0, 1, 0.01), num('shelf', 'Shelf width', 0.04, 0, 0.3, 0.005), num('carve', 'Coastal carve', 1, 0, 3, 0.05)]],
  ['Flood', [num('stage', 'Flood stage', 0.02, 0, 0.2, 0.001), num('reach', 'Reach', 8, 1, 40, 1), num('threshold', 'Channel area', 0.02, 0.001, 0.5, 0.001)]],
  ['Pond', [num('minDepth', 'Min depth', 0.004, 0, 0.1, 0.001), num('maxDepth', 'Max depth', 0.04, 0, 0.2, 0.001)]],
  ['Waterfall', [num('threshold', 'Channel area', 0.02, 0.001, 0.5, 0.001), num('steep', 'Step threshold', 0.01, 0, 0.2, 0.001), num('drop', 'Drop', 0.06, 0, 0.3, 0.001)]],
  ['Delta', [num('sea', 'Sea level', 0.2, 0, 1, 0.01), num('radius', 'Fan radius', 10, 2, 40, 1), num('amount', 'Deposit', 0.05, 0, 0.3, 0.001), num('threshold', 'Channel area', 0.02, 0.001, 0.5, 0.001)]],
  ['Meander', [num('amplitude', 'Amplitude', 0.05, 0, 0.3, 0.001), num('frequency', 'Frequency', 3, 0.5, 12, 0.1), num('depth', 'Depth', 0.05, 0, 0.3, 0.001), num('threshold', 'Channel area', 0.03, 0.001, 0.5, 0.001)]],
];
WAT.forEach(([name, params], k) => {
  const id = 85 + k;
  def(id, name, 'Water', 'mod', params, (p, st, h) => WATER[id](h, st.N, p, st));
});

// 95-128 filters / modifiers (derived 123-128 are generators)
const FILT = {
  95: ['Blur Gaussian', [RADIUS(3, 40)], 'mod'],
  96: ['Blur Box', [RADIUS(3, 40)], 'mod'],
  97: ['Blur Radial', [num('centerX', 'Center X', 0.5, 0, 1, 0.01), num('centerY', 'Center Y', 0.5, 0, 1, 0.01), num('strength', 'Strength', 0.3, 0, 1, 0.01)], 'mod'],
  98: ['Sharpen', [AMT(0.5)], 'mod'],
  99: ['Unsharp Mask', [RADIUS(2, 20), num('threshold', 'Threshold', 0.01, 0, 0.2, 0.001), AMT(1)], 'mod'],
  100: ['Median', [RADIUS(1, 6)], 'mod'],
  101: ['Dilate', [RADIUS(1, 6)], 'mod'],
  102: ['Erode Morphological', [RADIUS(1, 6)], 'mod'],
  103: ['Smooth', [AMT(0.5)], 'mod'],
  104: ['Detail Enhance', [RADIUS(8, 40), AMT(0.5)], 'mod'],
  105: ['Contrast', [num('amount', 'Contrast', 1.5, 0, 4, 0.01)], 'mod'],
  106: ['Brightness', [num('amount', 'Shift', 0.1, -1, 1, 0.01)], 'mod'],
  107: ['Gamma', [num('gamma', 'Gamma', 1, 0.1, 4, 0.01)], 'mod'],
  108: ['Levels', [num('inLow', 'In low', 0, 0, 1, 0.01), num('inHigh', 'In high', 1, 0, 1, 0.01), num('gamma', 'Gamma', 1, 0.1, 4, 0.01), num('outLow', 'Out low', 0, 0, 1, 0.01), num('outHigh', 'Out high', 1, 0, 1, 0.01)], 'mod'],
  109: ['Curves', [sel('curve', 'Curve', 'scurve', ['scurve', 'easein', 'easeout', 'inverse'])], 'mod'],
  110: ['Histogram', [], 'mod'],
  111: ['Equalize', [], 'mod'],
  112: ['Normalize', [], 'mod'],
  113: ['Invert', [], 'mod'],
  114: ['Abs', [], 'mod'],
  115: ['Clamp', [num('min', 'Min', 0, 0, 1, 0.01), num('max', 'Max', 1, 0, 1, 0.01)], 'mod'],
  116: ['Remap', [num('inMin', 'In min', 0, 0, 1, 0.01), num('inMax', 'In max', 1, 0, 1, 0.01), num('outMin', 'Out min', 0, 0, 1, 0.01), num('outMax', 'Out max', 1, 0, 1, 0.01)], 'mod'],
  117: ['Terrace', [num('steps', 'Steps', 8, 2, 40, 1), num('smooth', 'Edge softness', 0.2, 0, 1, 0.01)], 'mod'],
  118: ['Quantize', [num('levels', 'Levels', 8, 2, 64, 1)], 'mod'],
  119: ['Posterize', [num('levels', 'Levels', 6, 2, 16, 1)], 'mod'],
  120: ['Steepen', [RADIUS(2, 20), AMT(1)], 'mod'],
  121: ['Flatten', [num('value', 'Target', 0.5, 0, 1, 0.01), AMT(0.5)], 'mod'],
  122: ['Planar', [AMT(1)], 'mod'],
  123: ['Slope', [num('heightScale', 'Height scale', 1, 0.1, 5, 0.1)], 'gen'],
  124: ['Direction', [], 'gen'],
  125: ['Convexity', [RADIUS(2, 20)], 'gen'],
  126: ['Concavity', [RADIUS(2, 20)], 'gen'],
  127: ['Roughness', [RADIUS(2, 20)], 'gen'],
  128: ['Smoothness', [RADIUS(2, 20)], 'gen'],
};
for (const [idStr, [name, params, mode]] of Object.entries(FILT)) {
  const id = +idStr;
  if (mode === 'gen') {
    def(id, name, 'Filters', 'gen', params, (p, st, h) => derivedField(id, h, st.N, p) || new Float32Array(h.length));
  } else {
    def(id, name, 'Filters', 'mod', params, (p, st, h) => {
      if (id === 110) { // histogram: stats only
        const bins = new Float32Array(64); for (const v of h) bins[Math.min(63, Math.floor(Math.max(0, Math.min(1, v)) * 64))]++;
        st.histogram = bins; return h;
      }
      return FILTERS[id](h, st.N, p);
    });
  }
}

// 129-152 combiners (blend h with a secondary source, using the Gaea blend mode of this node)
const COMB_NAMES = ['Add', 'Subtract', 'Multiply', 'Divide', 'Max', 'Min', 'Average', 'Blend', 'Overlay', 'Screen', 'Darken', 'Lighten', 'Difference', 'Exclusion', 'Soft Light', 'Hard Light', 'Color Dodge', 'Color Burn', 'Linear Dodge', 'Linear Burn', 'Vivid Light', 'Linear Light', 'Pin Light', 'Hard Mix'];
const COMB_PARAMS = [sel('source', 'Secondary source', 'constant', ['constant', 'imported', 'blurred']), num('value', 'Constant value', 0.5, 0, 1, 0.01), RADIUS(4, 40)];
COMB_NAMES.forEach((name, k) => {
  const id = 129 + k;
  def(id, name, 'Combiners', 'combine', COMB_PARAMS, (p, st, h) => {
    let second;
    if (p.source === 'imported' && st.importData) second = st.importData;
    else if (p.source === 'blurred') second = gaussBlur(h, st.N, p.radius ?? 4);
    else second = new Float32Array(h.length).fill(p.value ?? 0.5);
    const out = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) out[i] = BLEND[id](h[i], second[i]);
    return { type: 'mod', h: out };
  });
});

// 153-178 masks as standalone mask layers; inline use goes through each layer's mask slot.
for (const [idStr, mname] of Object.entries(maskNames)) {
  const id = +idStr;
  const params = maskParams(id);
  def(id, mname + ' Mask', 'Masks', 'mask', params, (p, st) => {
    const d = deriveFor(st);
    const m = MASKS[id](p, st, d);
    return m;
  });
}
export function maskParams(id) {
  switch (id) {
    case 153: return [num('min', 'Min slope', 0.2, 0, 1, 0.01), num('max', 'Max slope', 0.7, 0, 1, 0.01)];
    case 154: return [num('min', 'Min height', 0.2, 0, 1, 0.01), num('max', 'Max height', 0.8, 0, 1, 0.01), num('feather', 'Feather', 0.05, 0, 0.5, 0.01)];
    case 158: return [num('min', 'Min flow', 0.2, 0, 1, 0.01), num('max', 'Max flow', 0.9, 0, 1, 0.01)];
    case 160: return [num('line', 'Snowline', 0.65, 0, 1, 0.01), num('slopeCut', 'Slope cut', 1.5, 0, 5, 0.1)];
    case 161: return [num('azimuth', 'Sun azimuth°', 315, 0, 360, 1), num('altitude', 'Sun altitude°', 35, 1, 89, 1)];
    case 162: return [num('radius', 'Radius', 8, 2, 40, 1), num('strength', 'Strength', 6, 0, 30, 0.5)];
    case 163: return [ANGLE(0), num('width', 'Width°', 90, 1, 360, 1)];
    case 164: return [RADIUS(2, 20)];
    case 165: return [num('steps', 'Steps', 8, 2, 40, 1), num('width', 'Edge width', 0.15, 0.01, 0.5, 0.01)];
    case 166: return [num('min', 'Min slope', 0.55, 0, 1, 0.01), num('max', 'Max slope', 0.85, 0, 1, 0.01)];
    case 169: return [num('width', 'Border width', 0.08, 0.005, 0.5, 0.005)];
    case 170: return [...CENTER];
    case 171: return [sel('axis', 'Axis', 'x', ['x', 'y']), num('min', 'Min', 0, 0, 1, 0.01), num('max', 'Max', 1, 0, 1, 0.01), num('feather', 'Feather', 0.02, 0, 0.5, 0.01)];
    case 172: return [ANGLE(0), num('width', 'Width°', 60, 1, 360, 1)];
    case 173: return [sel('source', 'Source', 'height', ['height', 'slope', 'flow', 'curvature']), num('min', 'Min', 0.2, 0, 1, 0.01), num('max', 'Max', 0.8, 0, 1, 0.01), num('feather', 'Feather', 0.02, 0, 0.5, 0.01)];
    case 174: return [ANGLE(0), num('extent', 'Extent', 1, 0.1, 4, 0.05)];
    case 175: return [num('centerX', 'Center X', 0.5, 0, 1, 0.01), num('centerY', 'Center Y', 0.5, 0, 1, 0.01), num('radius', 'Radius', 0.5, 0.05, 1.5, 0.01)];
    case 176: return [num('centerX', 'Center X', 0.5, 0, 1, 0.01), num('centerY', 'Center Y', 0.5, 0, 1, 0.01), num('start', 'Start°', 0, -180, 360, 1), num('span', 'Span°', 90, 1, 360, 1)];
    case 177: return [num('height', 'Min height', 0.5, 0, 1, 0.01), num('slope', 'Min slope', 0.5, 0, 1, 0.01)];
    case 178: return [];
    default: return [];
  }
}

// 179-203 color / texturing
const COLOR_NAMES = [
  ['Colorize', 'Color', [TERRAIN_PALETTE]], ['SatMap', 'Color', [TERRAIN_PALETTE, SEED]], ['CLUTer', 'Color', [TERRAIN_PALETTE, num('steps', 'Steps', 8, 2, 40, 1)]],
  ['Color Slope', 'Color', [col('flat', 'Flat', '#6e8f3f'), col('steep', 'Steep', '#5b4a3c')]],
  ['Color Height', 'Color', [col('low', 'Low', '#2b4c7e'), col('high', 'High', '#f2efe8')]],
  ['Color Curvature', 'Color', [col('concave', 'Concave', '#2e3b2a'), col('convex', 'Convex', '#d6c9a2')]],
  ['Color Flow', 'Color', [col('wet', 'Wet', '#1d4f7a')]],
  ['Color Snow', 'Color', [col('color', 'Color', '#f7fbff'), num('line', 'Snowline', 0.7, 0, 1, 0.01)]],
  ['Color Rock', 'Color', [col('color', 'Color', '#7b6e62')]],
  ['Color Vegetation', 'Color', [col('color', 'Color', '#4f7d32')]],
  ['Color Desert', 'Color', [col('color', 'Color', '#d9b77c')]],
  ['Color Ice', 'Color', [col('color', 'Color', '#cfe8f5'), num('line', 'Ice line', 0.8, 0, 1, 0.01)]],
  ['Color Water', 'Color', [col('color', 'Color', '#1f5f8b')]],
  ['Gradient Map', 'Color', [sel('palette', 'Gradient', 'volcanic', Object.keys(PALETTES))]],
  ['Triplanar', 'Color', [col('base', 'Base', '#8a7c63'), col('alt', 'Alt', '#5c5143'), num('scale', 'Scale', 12, 1, 64, 0.5), SEED]],
  ['Splat', 'Color', [SEED]],
  ['Material', 'Color', [sel('material', 'Material', 'rock', ['rock', 'grass', 'sand', 'snow', 'metal'])]],
  ['Albedo', 'Color', [num('gain', 'Gain', 1, 0, 2, 0.01)]],
  ['Normal Map', 'Maps', [num('strength', 'Strength', 1, 0, 4, 0.05)]],
  ['Roughness Map', 'Maps', []],
  ['AO Map', 'Maps', [RADIUS(6, 40), num('strength', 'Strength', 6, 0, 30, 0.5)]],
  ['Displacement Map', 'Maps', [num('amount', 'Amplitude', 0.01, 0, 0.1, 0.001), num('scale', 'Detail scale', 24, 1, 128, 1), SEED]],
  ['Flow Map', 'Maps', []],
  ['Moisture Map', 'Maps', []],
  ['Snow Map', 'Maps', [num('line', 'Snowline', 0.7, 0, 1, 0.01)]],
];
COLOR_NAMES.forEach(([name, cat, params], k) => {
  const id = 179 + k;
  def(id, name, cat, 'obj', params, (p, st, h, d) => COLOR[id](p, st, d, h));
});

// 204-216 transforms (remap the whole stack state)
const XF = [
  ['Translate', [num('dx', 'Shift X', 0, -1, 1, 0.005), num('dy', 'Shift Y', 0, -1, 1, 0.005)]],
  ['Rotate', [ANGLE(0)]],
  ['Scale', [num('factor', 'Factor', 1, 0.2, 4, 0.01)]],
  ['Warp', [num('amount', 'Amount', 0.1, 0, 0.5, 0.005), num('scale', 'Scale', 3, 0.5, 12, 0.1), SEED]],
  ['Domain Warp', [num('amount', 'Amount', 0.2, 0, 0.5, 0.005), num('scale', 'Scale', 2, 0.5, 12, 0.1), SEED]],
  ['Tile', [num('count', 'Tiles', 2, 1, 8, 1)]],
  ['Mirror', [sel('axis', 'Axis', 'x', ['x', 'y', 'xy'])]],
  ['Repeat', [num('count', 'Repeats', 2, 1, 8, 1), num('dx', 'Offset', 0, 0, 1, 0.01)]],
  ['Flip', [sel('axis', 'Axis', 'h', ['h', 'v'])]],
  ['Crop', [num('size', 'Size', 0.5, 0.05, 1, 0.01), num('x', 'X', 0, 0, 1, 0.01), num('y', 'Y', 0, 0, 1, 0.01)]],
  ['Resize', [num('factor', 'Pixelation', 1, 0.1, 1, 0.01)]],
  ['Resample', [num('factor', 'Factor', 1, 0.2, 4, 0.01)]],
  ['Offset', [num('dx', 'Offset X (wrap)', 0, -1, 1, 0.005), num('dy', 'Offset Y (wrap)', 0, -1, 1, 0.005)]],
];
XF.forEach(([name, params], k) => {
  const id = 204 + k;
  def(id, name, 'Transforms', 'xform', params, (p, st) => TRANSFORMS[id](st.N, p));
});

// 217-235 utility
const UTIL = [
  ['Cache', 'Utility', [], (h) => ({ type: 'pass' })],
  ['Output', 'Utility', [str('name', 'Output name', 'out')], (h, st, p) => UTILITY[218](h, st, p)],
  ['Input', 'Utility', [], (h, st, p) => UTILITY[219](h, st, p)],
  ['File Import', 'Utility', [], (h, st, p) => UTILITY[220](h, st, p)],
  ['Export', 'Utility', [], (h, st, p) => UTILITY[221]()],
  ['View', 'Utility', [sel('mode', 'View', 'height', ['height', 'albedo', 'slope', 'water', 'roughness', 'ao', 'normal'])], (h, st, p) => UTILITY[222](h, st, p)],
  ['Compare', 'Utility', [], (h, st, p) => UTILITY[223](h, st, p)],
  ['3D View', 'Utility', [num('exaggeration', 'Exaggeration', 1, 0.1, 4, 0.05)], (h, st, p) => UTILITY[224](h, st, p)],
  ['Stats', 'Utility', [], (h, st, p) => UTILITY[225](h, st, p)],
  ['Switch', 'Utility', [sel('select', 'Input', 0, [0, 1])], (h, st, p) => UTILITY[226](h, st, p)],
  ['Gate', 'Utility', [num('threshold', 'Threshold', 0.2, 0, 1, 0.01), num('fill', 'Fill value', 0, 0, 1, 0.01)], (h, st, p) => UTILITY[227](h, st, p)],
  ['Merge', 'Utility', [AMT(0.5)], (h, st, p) => UTILITY[228](h, st, p)],
  ['Split', 'Utility', [num('bands', 'Bands', 4, 2, 16, 1)], (h, st, p) => UTILITY[229](h, st, p)],
  ['Channel Extract', 'Utility', [sel('channel', 'Channel', 'R', ['R', 'G', 'B'])], (h, st, p) => UTILITY[230](h, st, p)],
  ['Combine Channels', 'Utility', [sel('channel', 'Channel', 'R', ['R', 'G', 'B'])], (h, st, p) => UTILITY[231](h, st, p)],
  ['Grayscale', 'Utility', [], (h, st, p) => UTILITY[232](h, st, p)],
  ['RGB to HSV', 'Utility', [], (h, st, p) => UTILITY[233](h, st, p)],
  ['HSV to RGB', 'Utility', [], (h, st, p) => UTILITY[234](h, st, p)],
  ['Luminance', 'Utility', [], (h, st, p) => UTILITY[235](h, st, p)],
];
function str(k, l, d) { return { k, l, d, t: 'str' }; }
UTIL.forEach(([name, cat, params, run], k) => {
  const id = 217 + k;
  def(id, name, cat, 'obj', params, (p, st, h) => run(h, st, p));
});

// 236-240 vegetation / scatter
const VEG = [
  ['Scatter', [num('density', 'Density', 0.02, 0, 0.2, 0.001), SEED]],
  ['Density', [RADIUS(3, 30)]],
  ['Biome', []],
  ['Tree Line', [num('altitude', 'Altitude', 0.6, 0, 1, 0.01), num('softness', 'Softness', 0.05, 0, 0.3, 0.01)]],
  ['Grass Line', [num('altitude', 'Altitude', 0.35, 0, 1, 0.01), num('softness', 'Softness', 0.05, 0, 0.3, 0.01)]],
];
VEG.forEach(([name, params], k) => {
  const id = 236 + k;
  def(id, name, 'Vegetation', 'obj', params, (p, st, h, d) => VEGETATION[id](h, st, p, d));
});

// 241 extra: Substance Painter-style procedural fill (colour, layer-stacked)
def(241, 'Procedural Fill (SP-style)', 'Color', 'obj', [
  col('color', 'Fill color', '#9c8f7a'), col('color2', 'Second color', '#5f574b'),
  sel('pattern', 'Pattern', 'noise', ['solid', 'noise', 'gradient', 'stripes']),
  num('scale', 'Scale', 8, 1, 64, 0.5), num('contrast', 'Contrast', 0.5, 0, 1, 0.01), SEED,
], (p, st) => ({ type: 'color', w: new Float32Array(st.N * st.N).fill(1), rgb: fillPattern(st.N, p) }));

function fillPattern(N, p) {
  const c1 = hex(p.color ?? '#9c8f7a'), c2 = hex(p.color2 ?? '#5f574b');
  const out = new Float32Array(N * N * 3), s = p.scale ?? 8, sd = p.seed ?? 1, con = p.contrast ?? 0.5;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, u = (x / N) * s, v = (y / N) * s;
    let t;
    switch (p.pattern) {
      case 'solid': t = 0; break;
      case 'gradient': t = y / N; break;
      case 'stripes': t = 0.5 + 0.5 * Math.sin(u * Math.PI * 2); break;
      default: t = 0.5 + 0.5 * _fbm(_perlin, u, v, sd, 5) * (1 + con);
    }
    t = Math.min(1, Math.max(0, t));
    for (let k = 0; k < 3; k++) out[i * 3 + k] = c1[k] * (1 - t) + c2[k] * t;
  }
  return out;
}

export const NODES = Object.fromEntries(N.map((n) => [n.id, n]));
export const NODE_LIST = N.slice().sort((a, b) => a.id - b.id);
export const CATEGORIES = [...new Set(NODE_LIST.map((n) => n.cat))];
export function defaultParams(node) {
  const p = {};
  for (const spec of node.params) p[spec.k] = spec.d;
  return p;
}
