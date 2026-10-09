// Slate — masks #153–178. Grayscale influence maps; any mask fits any layer.
import { clamp, lerp, smoothstep, invLerp, hillshade, TAU } from './util.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const M = (n, id, name, desc, params, run) => ({ n, id, name, desc, params, run });

export const MASKS = [
  M(153, 'slope', 'Slope Mask', 'Select by slope angle (degrees).', [
    P('lo', 'Min angle', 0, 90, 1, 0, '°'), P('hi', 'Max angle', 0, 90, 1, 45, '°'), P('soft', 'Softness', 0, 30, 0.5, 6, '°'),
  ], (ctx, p, out) => {
    const s = ctx.field('slope');
    for (let i = 0; i < out.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      out[i] = smoothstep(p.lo - p.soft, p.lo + p.soft, a) * (1 - smoothstep(p.hi - p.soft, p.hi + p.soft, a));
    }
  }),
  M(154, 'height', 'Height Mask', 'Select by elevation range.', [
    P('lo', 'Min height', 0, 1, 0.01, 0.25), P('hi', 'Max height', 0, 1, 0.01, 0.75), P('soft', 'Softness', 0, 0.3, 0.005, 0.05),
  ], (ctx, p, out) => {
    const h = ctx.field('height01');
    for (let i = 0; i < out.length; i++)
      out[i] = smoothstep(p.lo - p.soft, p.lo + p.soft, h[i]) * (1 - smoothstep(p.hi - p.soft, p.hi + p.soft, h[i]));
  }),
  M(155, 'curvature', 'Curvature Mask', 'Select by mean curvature (signed).', [
    P('center', 'Center', -1, 1, 0.01, 0), P('width', 'Width', 0.001, 1, 0.005, 0.1), P('soft', 'Softness', 0, 0.5, 0.01, 0.05),
  ], (ctx, p, out) => {
    const c = ctx.field('curvN');
    for (let i = 0; i < out.length; i++) {
      const d = Math.abs(c[i] - p.center);
      out[i] = 1 - smoothstep(p.width, p.width + p.soft * 2 + 1e-4, d);
    }
  }),
  M(156, 'cavity', 'Cavity Mask', 'Concave crevices and pits.', [
    P('strength', 'Strength', 0, 2, 0.05, 1), P('radius', 'Radius', 1, 8, 1, 4, 'px'),
  ], (ctx, p, out) => {
    const c = ctx.field('cavity');
    for (let i = 0; i < out.length; i++) out[i] = clamp(c[i] * p.strength);
  }),
  M(157, 'convexity', 'Convexity Mask', 'Convex ridges and bumps.', [
    P('strength', 'Strength', 0, 2, 0.05, 1),
  ], (ctx, p, out) => {
    const c = ctx.field('convex');
    for (let i = 0; i < out.length; i++) out[i] = clamp(c[i] * p.strength);
  }),
  M(158, 'flow', 'Flow Mask', 'Water flow accumulation zones.', [
    P('threshold', 'Threshold', 0, 1, 0.01, 0.3), P('soft', 'Softness', 0, 0.5, 0.01, 0.1),
  ], (ctx, p, out) => {
    const f = ctx.field('flow');
    for (let i = 0; i < out.length; i++) out[i] = smoothstep(p.threshold - p.soft, p.threshold + p.soft, f[i]);
  }),
  M(159, 'water', 'Water Mask', 'Areas below the water level.', [
    P('soft', 'Shore softness', 0, 0.1, 0.002, 0.01),
  ], (ctx, p, out) => {
    const n = ctx.n, lvl = ctx.waterLevel;
    for (let i = 0; i < out.length; i++) out[i] = 1 - smoothstep(lvl - p.soft, lvl + p.soft, ctx.h[i]);
    void n;
  }),
  M(160, 'snow', 'Snow Mask', 'Snow accumulation (high + flat).', [
    P('line', 'Snow line', 0, 1, 0.01, 0.55), P('slopeMax', 'Max slope°', 0, 90, 1, 40, '°'), P('soft', 'Softness', 0, 0.3, 0.01, 0.08),
  ], (ctx, p, out) => {
    const h = ctx.field('height01'), s = ctx.field('slope');
    for (let i = 0; i < out.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      out[i] = smoothstep(p.line - p.soft, p.line + p.soft, h[i]) * (1 - smoothstep(p.slopeMax - 8, p.slopeMax + 8, a));
    }
  }),
  M(161, 'shadow', 'Shadow Mask', 'Shadowed areas from a sun angle.', [
    P('azimuth', 'Azimuth', 0, 360, 1, 315, '°'), P('altitude', 'Altitude', 1, 89, 1, 35, '°'), P('soft', 'Softness', 0, 0.5, 0.01, 0.15),
  ], (ctx, p, out) => {
    const hs = hillshade(ctx.h, ctx.n, p.azimuth, p.altitude);
    for (let i = 0; i < out.length; i++) out[i] = 1 - smoothstep(0.5 - p.soft, 0.5 + p.soft, hs[i]);
  }),
  M(162, 'ao', 'Ambient Occlusion Mask', 'Occluded / enclosed areas.', [
    P('strength', 'Strength', 0, 2, 0.05, 1), P('invert', 'Invert', 0, 1, 1, 0, '', 'Select open areas instead'),
  ], (ctx, p, out) => {
    const a = ctx.field('ao');
    for (let i = 0; i < out.length; i++) out[i] = clamp((p.invert ? a[i] : 1 - a[i]) * p.strength);
  }),
  M(163, 'direction', 'Direction Mask', 'Select by slope aspect (facing).', [
    P('angle', 'Facing angle', 0, 360, 1, 180, '°'), P('width', 'Width', 1, 180, 1, 60, '°'), P('soft', 'Softness', 0, 60, 1, 15, '°'),
  ], (ctx, p, out) => {
    const a = ctx.field('aspect');
    const target = (p.angle * Math.PI) / 180;
    const w = (p.width * Math.PI) / 360, s = (p.soft * Math.PI) / 180;
    for (let i = 0; i < out.length; i++) {
      let d = Math.abs(a[i] - target) % TAU;
      if (d > Math.PI) d = TAU - d;
      out[i] = 1 - smoothstep(w, w + s + 1e-4, d);
    }
  }),
  M(164, 'roughness', 'Roughness Mask', 'Select by surface roughness.', [
    P('threshold', 'Threshold', 0, 1, 0.01, 0.4), P('soft', 'Softness', 0, 0.5, 0.01, 0.1),
  ], (ctx, p, out) => {
    const r = ctx.field('rough');
    for (let i = 0; i < out.length; i++) out[i] = smoothstep(p.threshold - p.soft, p.threshold + p.soft, r[i]);
  }),
  M(165, 'terrace', 'Terrace Mask', 'Terrace edges (band transitions).', [
    P('levels', 'Levels', 2, 24, 1, 8), P('width', 'Edge width', 0.01, 0.5, 0.01, 0.12),
  ], (ctx, p, out) => {
    const h = ctx.field('height01');
    for (let i = 0; i < out.length; i++) {
      const t = ((h[i] * p.levels) % 1 + 1) % 1;
      const d = Math.min(t, 1 - t);
      out[i] = 1 - smoothstep(0, p.width, d);
    }
  }),
  M(166, 'cliff', 'Cliff Mask', 'Steep cliff faces.', [
    P('angle', 'Min angle', 0, 90, 1, 55, '°'), P('soft', 'Softness', 0, 30, 1, 8, '°'),
  ], (ctx, p, out) => {
    const s = ctx.field('slope');
    for (let i = 0; i < out.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      out[i] = smoothstep(p.angle - p.soft, p.angle + p.soft, a);
    }
  }),
  M(167, 'ridge', 'Ridge Mask', 'Ridge lines (convex + high curvature).', [
    P('threshold', 'Threshold', 0, 1, 0.01, 0.45), P('soft', 'Softness', 0, 0.5, 0.01, 0.12),
  ], (ctx, p, out) => {
    const c = ctx.field('convex');
    for (let i = 0; i < out.length; i++) out[i] = smoothstep(p.threshold - p.soft, p.threshold + p.soft, c[i]);
  }),
  M(168, 'valley', 'Valley Mask', 'Valley floors (concave + low).', [
    P('threshold', 'Threshold', 0, 1, 0.01, 0.4), P('soft', 'Softness', 0, 0.5, 0.01, 0.12),
  ], (ctx, p, out) => {
    const c = ctx.field('cavity'), f = ctx.field('flow');
    for (let i = 0; i < out.length; i++)
      out[i] = smoothstep(p.threshold - p.soft, p.threshold + p.soft, clamp(c[i] * 0.6 + f[i] * 0.4));
  }),
  M(169, 'edge', 'Edge Mask', 'Terrain borders (falloff inward).', [
    P('margin', 'Margin', 0, 0.45, 0.005, 0.12), P('soft', 'Softness', 0, 0.3, 0.005, 0.06),
  ], (ctx, p, out) => {
    const e = ctx.field('edge');
    for (let i = 0; i < out.length; i++) out[i] = 1 - smoothstep(p.margin, p.margin + p.soft + 1e-4, e[i]);
  }),
  M(170, 'distance', 'Distance Mask', 'Distance from a point or line.', [
    P('mode', 'Mode', 0, 1, 1, 0, 'enum', 'Point|Line'),
    P('x', 'X', 0, 1, 0.005, 0.5), P('y', 'Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0, 1.5, 0.01, 0.35), P('soft', 'Softness', 0, 0.5, 0.01, 0.12),
    P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, out) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      let d;
      if (p.mode === 0) d = Math.hypot(u - p.x, v - p.y);
      else d = Math.abs((v - p.y) - 0.35 * (u - p.x)) / Math.hypot(1, 0.35); // sloped guide line
      let m = 1 - smoothstep(p.radius - p.soft, p.radius + p.soft, d);
      out[y * n + x] = p.invert ? 1 - m : m;
    }
  }),
  M(171, 'position', 'Position Mask', 'Rectangular region by X/Y.', [
    P('x0', 'X min', 0, 1, 0.005, 0.25), P('x1', 'X max', 0, 1, 0.005, 0.75),
    P('y0', 'Y min', 0, 1, 0.005, 0.25), P('y1', 'Y max', 0, 1, 0.005, 0.75), P('soft', 'Softness', 0, 0.3, 0.005, 0.05),
  ], (ctx, p, out) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      out[y * n + x] =
        smoothstep(p.x0 - p.soft, p.x0 + p.soft, u) * (1 - smoothstep(p.x1 - p.soft, p.x1 + p.soft, u)) *
        smoothstep(p.y0 - p.soft, p.y0 + p.soft, v) * (1 - smoothstep(p.y1 - p.soft, p.y1 + p.soft, v));
    }
  }),
  M(172, 'angle', 'Angle Mask', 'Angle to a reference point.', [
    P('x', 'Ref X', 0, 1, 0.005, 0.5), P('y', 'Ref Y', 0, 1, 0.005, 0.5),
    P('angle', 'Angle', 0, 360, 1, 90, '°'), P('width', 'Width', 1, 180, 1, 45, '°'), P('soft', 'Softness', 0, 60, 1, 12, '°'),
  ], (ctx, p, out) => {
    const n = ctx.n, target = (p.angle * Math.PI) / 180, w = (p.width * Math.PI) / 360, s = (p.soft * Math.PI) / 180;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1) - p.x, v = y / (n - 1) - p.y;
      let d = Math.abs(Math.atan2(v, u) - target) % TAU;
      if (d > Math.PI) d = TAU - d;
      out[y * n + x] = 1 - smoothstep(w, w + s + 1e-4, d);
    }
  }),
  M(173, 'range', 'Range Mask', 'Select a luminance/value range of the color buffer.', [
    P('lo', 'Min', 0, 1, 0.01, 0.3), P('hi', 'Max', 0, 1, 0.01, 0.7), P('soft', 'Softness', 0, 0.3, 0.01, 0.06),
  ], (ctx, p, out) => {
    const l = ctx.field('luma');
    for (let i = 0; i < out.length; i++)
      out[i] = smoothstep(p.lo - p.soft, p.lo + p.soft, l[i]) * (1 - smoothstep(p.hi - p.soft, p.hi + p.soft, l[i]));
  }),
  M(174, 'gradient', 'Gradient Mask', 'Linear gradient falloff.', [
    P('angle', 'Angle', 0, 360, 1, 0, '°'), P('start', 'Start', 0, 1, 0.01, 0.15), P('end', 'End', 0, 1, 0.01, 0.85), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, out) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1) - 0.5, v = y / (n - 1) - 0.5;
      const t = clamp((u * ca + v * sa) + 0.5, 0, 1);
      const m = smoothstep(p.start, p.end, t);
      out[y * n + x] = p.invert ? 1 - m : m;
    }
  }),
  M(175, 'radial', 'Radial Mask', 'Radial falloff from center.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('inner', 'Inner', 0, 1, 0.01, 0.2), P('outer', 'Outer', 0, 1.5, 0.01, 0.55), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, out) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x / (n - 1) - p.x, y / (n - 1) - p.y);
      let m = 1 - smoothstep(p.inner, Math.max(p.inner + 1e-4, p.outer), d);
      out[y * n + x] = p.invert ? 1 - m : m;
    }
  }),
  M(176, 'angular', 'Angular Mask', 'Angular sweep mask around center.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('start', 'Start', 0, 360, 1, 0, '°'), P('sweep', 'Sweep', 0, 360, 1, 120, '°'), P('soft', 'Softness', 0, 60, 1, 10, '°'),
  ], (ctx, p, out) => {
    const n = ctx.n, s0 = (p.start * Math.PI) / 180, sw = (p.sweep * Math.PI) / 180, s = (p.soft * Math.PI) / 180;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = Math.atan2(y / (n - 1) - p.y, x / (n - 1) - p.x);
      let d = (a - s0) % TAU; if (d < 0) d += TAU;
      out[y * n + x] = smoothstep(0, s + 1e-4, d) * (1 - smoothstep(sw - s, sw + 1e-4, d)) * (sw >= TAU - 1e-3 ? 1 : 1);
      if (sw >= TAU - 1e-3) out[y * n + x] = 1;
    }
  }),
  M(177, 'select', 'Select Mask', 'Manual selection by combined criteria.', [
    P('hLo', 'Height min', 0, 1, 0.01, 0), P('hHi', 'Height max', 0, 1, 0.01, 1),
    P('sLo', 'Slope min°', 0, 90, 1, 0, '°'), P('sHi', 'Slope max°', 0, 90, 1, 90, '°'),
    P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, out) => {
    const h = ctx.field('height01'), s = ctx.field('slope');
    for (let i = 0; i < out.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      let m = (h[i] >= p.hLo && h[i] <= p.hHi && a >= p.sLo && a <= p.sHi) ? 1 : 0;
      out[i] = p.invert ? 1 - m : m;
    }
    void invLerp; void lerp;
  }),
  M(178, 'painted', 'Custom Painted Mask', 'User-painted in the viewport (2D paint mode).', [
    P('invert', 'Invert', 0, 1, 1, 0), P('contrast', 'Contrast', 0, 2, 0.05, 1),
  ], (ctx, p, out) => {
    const src = ctx.maskPaint; // Float32Array(res²) or null
    for (let i = 0; i < out.length; i++) {
      let m = src ? src[i] : 1;
      m = clamp((m - 0.5) * p.contrast + 0.5);
      out[i] = p.invert ? 1 - m : m;
    }
  }),
];
export const MASK_MAP = Object.fromEntries(MASKS.map((m) => [m.id, m]));
