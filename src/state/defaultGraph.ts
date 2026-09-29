import { defaultParams, type GraphDoc, DEFAULT_SETTINGS } from '../core/graph/types';

let seq = 0;
const nid = (t: string) => `${t}_${(++seq).toString(36)}`;

function node(type: string, x: number, y: number, params: Record<string, any> = {}) {
  return { id: nid(type), type, x, y, params: { ...defaultParams(type), ...params } };
}

/**
 * The starter graph. It is deliberately a complete pipeline rather than a blank
 * canvas: generate mass -> lay down strata -> erode -> route rivers -> texture
 * with satmaps -> carve caves -> output. Every stage is a node you can unplug.
 */
export function makeDefaultGraph(): GraphDoc {
  const mountain = node('mountain', 40, 40, { ranges: 2.1, ridgeWidth: 0.36, detail: 0.45, scale: 2.0 });
  const terrace = node('terrace', 380, 40, { count: 22, hardness: 0.45, tilt: 0.06, irregular: 0.35, amount: 0.35 });
  const hydraulic = node('hydraulic', 720, 40, { iterations: 130, rainfall: 0.4, capacity: 1.25, dissolve: 0.6, deposition: 0.7 });
  const thermal = node('thermal', 1060, 40, { iterations: 55, angle: 46, rate: 0.55 });
  const rivers = node('rivers', 1400, 40, { passes: 2, accumIters: 150, incision: 0.5, depth: 26, width: 4, threshold: 0.44 });

  const slope = node('slope', 1400, 470, { maxAngle: 52, smooth: 1.5 });
  const satRock = node('satmap', 1740, 300, { preset: 'alpine', inHigh: 0.95, variation: 0.07 });
  const satWet = node('satmap', 1740, 620, { preset: 'slate', gamma: 0.7, saturation: 0.75, brightness: 0.8 });
  const satCliff = node('satmap', 1740, 940, { preset: 'rocky', brightness: 0.85 });

  const blend1 = node('colorblend', 2080, 470, { mode: 'over', opacity: 0.85 });
  const blend2 = node('colorblend', 2080, 760, { mode: 'over', opacity: 0.9 });

  const caves = node('caves', 1400, 1180, { density: 3.0, radius: 30, ceiling: 110, chambers: 0.55 });

  const out = node('output', 2440, 470, { seaLevel: 0, caveBlend: 16 });

  const e = (from: string, fromPort: string, to: string, toPort: string) => ({
    id: `e_${(++seq).toString(36)}`, from, fromPort, to, toPort,
  });

  return {
    nodes: [mountain, terrace, hydraulic, thermal, rivers, slope, satRock, satWet, satCliff, blend1, blend2, caves, out],
    edges: [
      e(mountain.id, 'out', terrace.id, 'in'),
      e(terrace.id, 'out', hydraulic.id, 'height'),
      e(terrace.id, 'bands', hydraulic.id, 'hardness'),
      e(hydraulic.id, 'out', thermal.id, 'height'),
      e(terrace.id, 'bands', thermal.id, 'hardness'),
      e(thermal.id, 'out', rivers.id, 'height'),

      e(rivers.id, 'out', slope.id, 'in'),
      e(rivers.id, 'out', satRock.id, 'in'),
      e(rivers.id, 'out', satCliff.id, 'in'),
      e(slope.id, 'out', satCliff.id, 'mask'),
      e(rivers.id, 'flow', satWet.id, 'in'),
      e(rivers.id, 'rivers', satWet.id, 'mask'),

      e(satRock.id, 'out', blend1.id, 'base'),
      e(satCliff.id, 'out', blend1.id, 'top'),
      e(blend1.id, 'out', blend2.id, 'base'),
      e(satWet.id, 'out', blend2.id, 'top'),

      e(rivers.id, 'out', caves.id, 'height'),

      e(rivers.id, 'out', out.id, 'height'),
      e(blend2.id, 'out', out.id, 'color'),
      e(rivers.id, 'water', out.id, 'water'),
      e(caves.id, 'out', out.id, 'volume'),
    ],
    settings: { ...DEFAULT_SETTINGS },
  };
}
