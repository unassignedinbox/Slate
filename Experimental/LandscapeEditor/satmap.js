// Satmap texturing — satellite-style layers driven by terrain signals.
import { fbm, valueNoise, smoothstep } from './noise.js';
import { evalMask, maskKinds } from './heightfield.js';

/** Source signals a satmap layer can bind to (dropdown). */
export const satSources = {
  height: {
    name: 'Height', icon: 'Terrain',
    description: 'Elevation ramp · hypsometric tinting from lowland to summit',
  },
  slope: {
    name: 'Slope / protrusions', icon: 'Cliff',
    description: 'Steepness · cliffs, ribs and rocky protrusions catch the light',
  },
  protrusion: {
    name: 'Crest exposure', icon: 'Rift',
    description: 'Positive curvature · ridges, arêtes and outcrop crests',
  },
  flow: {
    name: 'Rivers & flow', icon: 'Flow',
    description: 'Drainage accumulation · river beds, floodplains and deltas',
  },
  sediment: {
    name: 'Sedimentation', icon: 'Grain',
    description: 'Deposited material · alluvial fans, basins and drifts',
  },
  wetness: {
    name: 'Wetness', icon: 'Droplets',
    description: 'Moisture pooling · damp lowlands, marshes and lake margins',
  },
  aspect: {
    name: 'Sun aspect', icon: 'Sun',
    description: 'Sun-facing slopes · warm faces against cool shaded sides',
  },
  ao: {
    name: 'Ambient occlusion', icon: 'Gauge',
    description: 'Crevice darkening · valleys and hollows hold shadow',
  },
  noise: {
    name: 'Detail noise', icon: 'Sparkles',
    description: 'Generator pattern · mottling, patches and mineral variation',
  },
  constant: {
    name: 'Constant tint', icon: 'Palette',
    description: 'Flat wash · uniform colour with optional detail grain',
  },
};

export const satBlends = {
  mix: { name: 'Mix', hint: 'Normal coverage blend' },
  multiply: { name: 'Multiply', hint: 'Darken into the surface' },
  screen: { name: 'Screen', hint: 'Brighten softly' },
  overlay: { name: 'Overlay', hint: 'Push contrast of the base' },
};

export const satLayerDefaults = () => ({
  id: `sat-${Math.random().toString(36).slice(2, 9)}`,
  kind: 'sat',
  name: 'Satmap layer',
  enabled: true,
  source: 'height',
  ramp: { lo: 0.35, hi: 0.75, softness: 0.18 },
  colorA: '#3c4632',
  colorB: '#b0a183',
  detail: { amount: 0.25, scale: 6, seed: 5 },
  pattern: { kind: 'fbm', amount: 0.35, scale: 3.2, seed: 9 },
  mask: { type: 'none', params: {} },
  opacity: 0.9,
  blend: 'mix',
});

export function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

function channelValue(source, signals, u, v) {
  const a = signals.arrays;
  switch (source) {
    case 'height': return signals.height(u, v);
    case 'slope': return signals.slope(u, v);
    case 'protrusion': return signals.protrusion(u, v);
    case 'flow': return signals.flow(u, v);
    case 'sediment': return signals.sediment(u, v);
    case 'wetness': return signals.wetness(u, v);
    case 'aspect': return signals.aspect(u, v);
    case 'ao': return signals.ao(u, v);
    case 'noise': return valueNoise(401, u, v, 4);
    default: return 0.5;
  }
}

/**
 * Composite the satmap layers into an RGBA byte image (size × size).
 * Signals come from computeSignals(); each layer ramps a source signal into a
 * two-colour gradient, modulates it with a detail generator and masks it.
 */
export function compositeSatmap(signals, satLayers, size) {
  const img = new Uint8ClampedArray(size * size * 4);
  // base wash — deep valley floor so nothing is ever empty
  for (let i = 0; i < size * size; i++) {
    img[i * 4] = 34; img[i * 4 + 1] = 34; img[i * 4 + 2] = 34; img[i * 4 + 3] = 255;
  }

  const out = [0, 0, 0];
  for (const layer of satLayers) {
    if (!layer.enabled) continue;
    const opacity = layer.opacity ?? 0.9;
    if (opacity <= 0.001) continue;
    const cA = hexToRgb(layer.colorA), cB = hexToRgb(layer.colorB);
    const ramp = layer.ramp || { lo: 0.35, hi: 0.75, softness: 0.18 };
    const detail = layer.detail || { amount: 0, scale: 6, seed: 5 };
    const pattern = layer.pattern || { kind: 'fbm', amount: 0, scale: 3, seed: 9 };
    const maskDef = {
      type: layer.mask?.type || 'none',
      params: { ...(maskKinds[layer.mask?.type]?.defaults || {}), ...(layer.mask?.params || {}) },
    };
    const useMask = maskDef.type !== 'none';
    const blend = layer.blend || 'mix';

    for (let y = 0; y < size; y++) {
      const v = y / (size - 1);
      for (let x = 0; x < size; x++) {
        const u = x / (size - 1);
        let m = useMask ? evalMask(maskDef, u, v, signals) : 1;
        m *= opacity;
        if (m <= 0.002) continue;

        let ch = channelValue(layer.source, signals, u, v);
        if (pattern.amount > 0) {
          const pn = pattern.kind === 'ridged'
            ? 1 - Math.abs(valueNoise(pattern.seed, u, v, pattern.scale) * 2 - 1)
            : pattern.kind === 'voronoi'
              ? 1 - valueNoise(pattern.seed + 3, u, v, pattern.scale)
              : fbm(pattern.seed, u * pattern.scale, v * pattern.scale, { octaves: 4 });
          ch = ch * (1 - pattern.amount * 0.55) + pn * pattern.amount * 0.55;
        }

        // monotonic two-stop ramp: colour A below `lo`, colour B above `hi`,
        // with `softness` feathering both shoulders
        const lo2 = ramp.lo - ramp.softness;
        const hi2 = ramp.hi + ramp.softness;
        const tt = smoothstep(lo2, Math.max(lo2 + 0.01, hi2), ch);

        let r = cA[0] + (cB[0] - cA[0]) * tt;
        let g = cA[1] + (cB[1] - cA[1]) * tt;
        let b = cA[2] + (cB[2] - cA[2]) * tt;

        if (detail.amount > 0) {
          const dn = valueNoise(detail.seed, u, v, detail.scale) - 0.5;
          const grain = 1 + dn * detail.amount * 0.9;
          r *= grain; g *= grain; b *= grain;
        }

        const idx = (y * size + x) * 4;
        const br = img[idx] / 255, bg = img[idx + 1] / 255, bb = img[idx + 2] / 255;
        if (blend === 'multiply') {
          out[0] = br * r; out[1] = bg * g; out[2] = bb * b;
        } else if (blend === 'screen') {
          out[0] = 1 - (1 - br) * (1 - r); out[1] = 1 - (1 - bg) * (1 - g); out[2] = 1 - (1 - bb) * (1 - b);
        } else if (blend === 'overlay') {
          out[0] = br < 0.5 ? 2 * br * r : 1 - 2 * (1 - br) * (1 - r);
          out[1] = bg < 0.5 ? 2 * bg * g : 1 - 2 * (1 - bg) * (1 - g);
          out[2] = bb < 0.5 ? 2 * bb * b : 1 - 2 * (1 - bb) * (1 - b);
        } else {
          out[0] = r; out[1] = g; out[2] = b;
        }
        img[idx] = (br + (out[0] - br) * m) * 255;
        img[idx + 1] = (bg + (out[1] - bg) * m) * 255;
        img[idx + 2] = (bb + (out[2] - bb) * m) * 255;
        img[idx + 3] = 255;
      }
    }
  }
  return img;
}

/** Grayscale / hypsometric preview of a signal array (for view modes + minimap). */
export function signalImage(array, size, colorA = '#141414', colorB = '#e8e8e8') {
  const img = new Uint8ClampedArray(size * size * 4);
  const cA = hexToRgb(colorA), cB = hexToRgb(colorB);
  for (let i = 0; i < size * size; i++) {
    const t = Math.max(0, Math.min(1, array[i]));
    img[i * 4] = (cA[0] + (cB[0] - cA[0]) * t) * 255;
    img[i * 4 + 1] = (cA[1] + (cB[1] - cA[1]) * t) * 255;
    img[i * 4 + 2] = (cA[2] + (cB[2] - cA[2]) * t) * 255;
    img[i * 4 + 3] = 255;
  }
  return img;
}
