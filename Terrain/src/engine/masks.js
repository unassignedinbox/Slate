// 153-178 Masks. Every mask is a grayscale grid in [0, 1] computed from the evaluation context.
// A mask can be attached to any layer as its influence map, or added as a standalone "Mask" layer
// whose grayscale output is written as height (so it can be blended, eroded or coloured like any other layer).
import { makeDef } from './def.js';
import { num, int, sel } from './schema.js';
import { clamp, smoothstep, scaleToMax, blurBox } from './grid.js';
import { fieldOf } from './sampling.js';
import { derive, shadowMap } from './context.js';

// Derived field accessor: memoised on the context, computed with the shared derive function of the same name.
const D = (ctx, name) => ctx.get(name, derive[name]);
const band = (v, lo, hi, s) => smoothstep(lo - s, lo, v) * (1 - smoothstep(hi, hi + s, v));
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const channelOf = (ctx, name) => {
  switch (name) {
    case 'slope': return D(ctx, 'slopeN');
    case 'curvature': return Float32Array.from(D(ctx, 'curvature'), (v) => v * 0.5 + 0.5);
    case 'flow': return D(ctx, 'flowN');
    case 'water': return ctx.water;
    default: return ctx.H;
  }
};

export const maskFns = {
  slope: (ctx, p) => {
    const s = D(ctx, 'slope');
    return fieldOf(ctx.N, (x, y, i) => band(s[i], p.min, p.max, p.soft));
  },
  height: (ctx, p) => fieldOf(ctx.N, (x, y, i) => band(ctx.H[i], p.min, p.max, p.soft)),
  curvature: (ctx, p) => {
    const c = D(ctx, 'curvature');
    return fieldOf(ctx.N, (x, y, i) => band(c[i], p.min, p.max, p.soft));
  },
  cavity: (ctx, p) => {
    const c = D(ctx, 'curvature');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.start, p.start + p.soft, -c[i]) * p.strength);
  },
  convexity: (ctx, p) => {
    const c = D(ctx, 'curvature');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.start, p.start + p.soft, c[i]) * p.strength);
  },
  flow: (ctx, p) => {
    const f = D(ctx, 'flowN');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.threshold - p.soft, p.threshold + p.soft, f[i]));
  },
  water: (ctx, p) => fieldOf(ctx.N, (x, y, i) => clamp(ctx.water[i] / Math.max(1e-4, p.depth))),
  snow: (ctx, p) => {
    const s = D(ctx, 'slope');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.altitude, p.altitude + p.soft, ctx.H[i]) * (1 - smoothstep(p.slopeMax - 5, p.slopeMax + 5, s[i])));
  },
  shadow: (ctx, p) => {
    const sh = shadowMap(ctx, p.azimuth, p.elevation);
    return fieldOf(ctx.N, (x, y, i) => 1 - sh[i] * p.strength);
  },
  ao: (ctx, p) => {
    const ao = D(ctx, 'ao');
    return fieldOf(ctx.N, (x, y, i) => clamp(1 - ao[i] * p.strength));
  },
  direction: (ctx, p) => {
    const g = D(ctx, 'grad');
    const want = (p.direction * Math.PI) / 180;
    return fieldOf(ctx.N, (x, y, i) => {
      // Aspect = downhill direction, i.e. opposite the gradient.
      const aspect = Math.atan2(-g.gy[i], -g.gx[i]);
      return 1 - smoothstep(p.width * 0.5, p.width, angDiff(aspect, want));
    });
  },
  roughness: (ctx, p) => {
    const r = scaleToMax(D(ctx, 'roughness'));
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.min, p.max, r[i]));
  },
  terrace: (ctx, p) => {
    const steps = Math.max(1, p.steps);
    return fieldOf(ctx.N, (x, y, i) => {
      const f = (ctx.H[i] * steps) % 1;
      return 1 - smoothstep(0, p.width, Math.min(f, 1 - f));
    });
  },
  cliff: (ctx, p) => {
    const s = D(ctx, 'slope');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(p.min - p.soft, p.min + p.soft, s[i]));
  },
  ridge: (ctx, p) => {
    const bl = D(ctx, 'blurLarge');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(0, p.soft, ctx.H[i] - bl[i]));
  },
  valley: (ctx, p) => {
    const bl = D(ctx, 'blurLarge');
    return fieldOf(ctx.N, (x, y, i) => smoothstep(0, p.soft, bl[i] - ctx.H[i]));
  },
  edge: (ctx, p) => {
    const N = ctx.N;
    return fieldOf(N, (x, y) => 1 - smoothstep(0, p.width, Math.min(x, y, N - 1 - x, N - 1 - y) / N));
  },
  distance: (ctx, p) => {
    const N = ctx.N;
    const px = (p.cx * 0.5 + 0.5) * (N - 1), py = (p.cy * 0.5 + 0.5) * (N - 1);
    return fieldOf(N, (x, y) => 1 - smoothstep(p.radius * 0.5, p.radius, (Math.hypot(x - px, y - py) / N) * 2));
  },
  position: (ctx, p) => fieldOf(ctx.N, (x, y) => smoothstep(p.from, p.to, p.axis === 'x' ? x / (ctx.N - 1) : y / (ctx.N - 1))),
  angle: (ctx, p) => {
    const N = ctx.N, want = (p.reference * Math.PI) / 180;
    return fieldOf(N, (x, y) => {
      const a = Math.atan2(y / (N - 1) - (p.cy * 0.5 + 0.5), x / (N - 1) - (p.cx * 0.5 + 0.5));
      return ((1 + Math.cos(a - want)) / 2) ** p.sharp;
    });
  },
  range: (ctx, p) => {
    const src = channelOf(ctx, p.source);
    return fieldOf(ctx.N, (x, y, i) => band(src[i], p.min, p.max, p.soft));
  },
  gradient: (ctx, p) => {
    const N = ctx.N, a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return fieldOf(N, (x, y) => {
      const t = (x / (N - 1) - 0.5) * c + (y / (N - 1) - 0.5) * s + 0.5;
      return clamp((t - p.from) / Math.max(1e-4, p.to - p.from));
    });
  },
  radial: (ctx, p) => {
    const N = ctx.N;
    return fieldOf(N, (x, y) => {
      const ux = (x / (N - 1)) * 2 - 1 - p.cx, uy = (y / (N - 1)) * 2 - 1 - p.cy;
      return clamp(1 - Math.hypot(ux, uy) / Math.max(1e-3, p.radius)) ** p.falloff;
    });
  },
  angular: (ctx, p) => {
    const N = ctx.N;
    return fieldOf(N, (x, y) => {
      const a = Math.atan2(y / (N - 1) - 0.5 - p.cy * 0.5, x / (N - 1) - 0.5 - p.cx * 0.5) / (Math.PI * 2) + 0.5 + p.phase;
      return smoothstep(p.sweep, p.sweep + p.soft, a - Math.floor(a));
    });
  },
  select: (ctx, p) => {
    const s = D(ctx, 'slope');
    return fieldOf(ctx.N, (x, y, i) => {
      const a = band(s[i], p.slopeMin, p.slopeMax, 2);
      const b = band(ctx.H[i], p.heightMin, p.heightMax, 0.01);
      return p.combine === 'and' ? a * b : Math.max(a, b);
    });
  },
  painted: (ctx, p, src) => {
    const N = ctx.N, paint = src?.paint;
    if (!paint || paint.length === 0) return new Float32Array(N * N);
    const M = Math.round(Math.sqrt(paint.length));
    return fieldOf(N, (x, y) => {
      const sx = Math.min(M - 1, Math.floor((x / N) * M)), sy = Math.min(M - 1, Math.floor((y / N) * M));
      return paint[sy * M + sx] / 255;
    });
  },
};

// Shared post-processing: edge blur and inversion.
export function finishMask(ctx, g, p, invert) {
  let out = g;
  if (p.blur && p.blur > 0) out = blurBox(out, ctx.N, Math.max(1, Math.round((p.blur * ctx.N) / 256)));
  if (invert) out = out.map((v) => 1 - v);
  return out;
}

// Evaluate a mask attached to a layer. Returns null when no mask type is set.
export function evaluateMask(ctx, mask) {
  const def = mask?.type ? maskDefByKey[`mask_${mask.type}`] : null;
  if (!def) return null;
  const p = { ...def.defaults, ...(mask.params || {}) };
  return finishMask(ctx, maskFns[mask.type](ctx, p, mask), p, mask.invert);
}

const maskDef = (id, key, name, params, desc) => makeDef({
  id, key: `mask_${key}`, name, cat: 'Masks', kind: 'mask',
  params: [...params, num('blur', 'Edge blur', 0, 0, 12, 0.5)],
  desc,
  run: (ctx, p, layer) => ({ height: finishMask(ctx, maskFns[key](ctx, p, layer), p, false) }),
});

export const maskDefs = [
  maskDef(153, 'slope', 'Slope Mask', [num('min', 'Min slope [deg]', 20, 0, 90, 0.5), num('max', 'Max slope [deg]', 60, 0, 90, 0.5), num('soft', 'Softness [deg]', 8, 0.1, 30, 0.5)], 'Influence by slope angle.'),
  maskDef(154, 'height', 'Height Mask', [num('min', 'Min height', 0.3, 0, 1), num('max', 'Max height', 0.8, 0, 1), num('soft', 'Softness', 0.08, 0.001, 0.5, 0.001)], 'Influence by elevation range.'),
  maskDef(155, 'curvature', 'Curvature Mask', [num('min', 'Min curvature', -1, -1, 1, 0.01), num('max', 'Max curvature', 1, -1, 1, 0.01), num('soft', 'Softness', 0.1, 0.001, 0.5, 0.001)], 'Influence by signed curvature (+ ridges, - valleys).'),
  maskDef(156, 'cavity', 'Cavity Mask', [num('start', 'Start', 0.1, 0, 1, 0.01), num('soft', 'Softness', 0.3, 0.01, 1, 0.01), num('strength', 'Strength', 1, 0, 1, 0.01)], 'Concave crevices and hollows.'),
  maskDef(157, 'convexity', 'Convexity Mask', [num('start', 'Start', 0.1, 0, 1, 0.01), num('soft', 'Softness', 0.3, 0.01, 1, 0.01), num('strength', 'Strength', 1, 0, 1, 0.01)], 'Convex ridges and spurs.'),
  maskDef(158, 'flow', 'Flow Mask', [num('threshold', 'Threshold', 0.6, 0, 1, 0.01), num('soft', 'Softness', 0.08, 0.001, 0.5, 0.001)], 'Water flow accumulation (channels).'),
  maskDef(159, 'water', 'Water Mask', [num('depth', 'Full at depth', 0.02, 0.001, 0.2, 0.001)], 'Areas covered by water (carved lakes, rivers, ocean).'),
  maskDef(160, 'snow', 'Snow Mask', [num('altitude', 'Snowline', 0.65, 0, 1, 0.01), num('soft', 'Softness', 0.1, 0.001, 0.5, 0.001), num('slopeMax', 'Max slope [deg]', 35, 0, 90, 0.5)], 'Snow accumulation: high and gentle ground.'),
  maskDef(161, 'shadow', 'Shadow Mask', [num('azimuth', 'Sun azimuth [deg]', 225, 0, 360, 1), num('elevation', 'Sun elevation [deg]', 35, 1, 89, 1), num('strength', 'Strength', 1, 0, 1, 0.01)], 'Cast shadows from a directional sun (ray marched).'),
  maskDef(162, 'ao', 'Ambient Occlusion Mask', [num('strength', 'Strength', 1, 0, 2, 0.01)], 'Ambient occlusion from horizon sampling (dark where occluded).'),
  maskDef(163, 'direction', 'Direction Mask', [num('direction', 'Facing [deg]', 180, 0, 360, 1), num('width', 'Width [rad]', 1.5, 0.05, 3.14, 0.01)], 'Slope aspect: which way the ground faces.'),
  maskDef(164, 'roughness', 'Roughness Mask', [num('min', 'Min roughness', 0.2, 0, 1, 0.01), num('max', 'Max roughness', 0.9, 0, 1, 0.01)], 'Local surface roughness.'),
  maskDef(165, 'terrace', 'Terrace Mask', [int('steps', 'Terrace levels', 8, 1, 60), num('width', 'Edge width', 0.08, 0.001, 0.5, 0.001)], 'Edges of stepped terraces.'),
  maskDef(166, 'cliff', 'Cliff Mask', [num('min', 'Cliff slope [deg]', 50, 0, 90, 0.5), num('soft', 'Softness [deg]', 6, 0.1, 30, 0.5)], 'Steep cliff faces.'),
  maskDef(167, 'ridge', 'Ridge Mask', [num('soft', 'Softness', 0.02, 0.001, 0.3, 0.001)], 'Ridge lines (higher than the large-scale average).'),
  maskDef(168, 'valley', 'Valley Mask', [num('soft', 'Softness', 0.02, 0.001, 0.3, 0.001)], 'Valley floors (lower than the large-scale average).'),
  maskDef(169, 'edge', 'Edge Mask', [num('width', 'Border width', 0.12, 0.01, 0.5, 0.01)], 'Terrain borders.'),
  maskDef(170, 'distance', 'Distance Mask', [num('cx', 'Point X', 0, -1, 1, 0.01), num('cy', 'Point Y', 0, -1, 1, 0.01), num('radius', 'Radius', 0.5, 0.01, 1.5, 0.01)], 'Distance from a point, fading out with radius.'),
  maskDef(171, 'position', 'Position Mask', [sel('axis', 'Axis', 'x', [['x', 'X'], ['y', 'Y']]), num('from', 'From', 0.2, 0, 1, 0.01), num('to', 'To', 0.8, 0, 1, 0.01)], 'Ramp by X or Y position.'),
  maskDef(172, 'angle', 'Angle Mask', [num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01), num('reference', 'Reference [deg]', 0, -180, 180, 1), num('sharp', 'Sharpness', 1, 0.2, 6, 0.05)], 'Angle from a centre relative to a reference direction.'),
  maskDef(173, 'range', 'Range Mask', [sel('source', 'Channel', 'height', [['height', 'Height'], ['slope', 'Slope'], ['curvature', 'Curvature'], ['flow', 'Flow'], ['water', 'Water']]), num('min', 'Min', 0.3, 0, 1, 0.01), num('max', 'Max', 0.7, 0, 1, 0.01), num('soft', 'Softness', 0.05, 0.001, 0.5, 0.001)], 'Select a value range of any channel.'),
  maskDef(174, 'gradient', 'Gradient Mask', [num('angle', 'Direction [deg]', 0, -180, 180, 1), num('from', 'From', 0.2, -0.5, 1, 0.01), num('to', 'To', 0.8, -0.5, 1, 0.01)], 'Linear gradient falloff.'),
  maskDef(175, 'radial', 'Radial Mask', [num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01), num('radius', 'Radius', 0.8, 0.01, 2, 0.01), num('falloff', 'Falloff', 1.5, 0.2, 5, 0.05)], 'Radial falloff from a centre.'),
  maskDef(176, 'angular', 'Angular Mask', [num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01), num('phase', 'Phase', 0, 0, 1, 0.01), num('sweep', 'Sweep start', 0, 0, 1, 0.01), num('soft', 'Softness', 0.2, 0.001, 1, 0.001)], 'Angular sweep around a centre.'),
  maskDef(177, 'select', 'Select', [num('slopeMin', 'Slope min [deg]', 10, 0, 90, 0.5), num('slopeMax', 'Slope max [deg]', 45, 0, 90, 0.5), num('heightMin', 'Height min', 0, 0, 1, 0.01), num('heightMax', 'Height max', 1, 0, 1, 0.01), sel('combine', 'Criteria', 'and', [['and', 'Match all'], ['or', 'Match any']])], 'Manual selection by combined criteria (slope and height).'),
  maskDef(178, 'painted', 'Custom Painted Mask', [], 'User-painted mask: paint with the brush in the viewport (Paint tool).'),
];

export const maskDefByKey = Object.fromEntries(maskDefs.map((d) => [d.key, d]));
