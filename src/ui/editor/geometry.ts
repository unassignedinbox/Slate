import { getNodeDef, type GraphNode } from '../../core/graph/types';

/** Locked-down card geometry so wires can be placed without DOM measurement. */
export const NODE_W = 240;
export const HEAD_H = 57;       // 13 + 32 glyph + 12
export const DIVIDER_H = 1;
export const BODY_PAD_TOP = 9;
export const COL_LABEL_H = 15;  // 11px line + 4px padding
export const ROW_H = 21;
export const ROW_GAP = 2;
export const BODY_PAD_BOTTOM = 11;
export const PREVIEW_H = 96 + 12;
export const ISSUE_H = 38;

export function portIndexY(i: number) {
  return HEAD_H + DIVIDER_H + BODY_PAD_TOP + COL_LABEL_H + i * (ROW_H + ROW_GAP) + ROW_H / 2;
}

export function portOffset(node: GraphNode, portId: string, dir: 'in' | 'out'): { x: number; y: number } {
  const def = getNodeDef(node.type);
  if (!def) return { x: dir === 'in' ? 0 : NODE_W, y: HEAD_H / 2 };
  if (node.folded) return { x: dir === 'in' ? 0 : NODE_W, y: HEAD_H / 2 };
  const list = dir === 'in' ? def.inputs : def.outputs;
  const i = Math.max(0, list.findIndex((p) => p.id === portId));
  return { x: dir === 'in' ? 0 : NODE_W, y: portIndexY(i) };
}

export function nodeHeight(node: GraphNode, opts: { hasThumb: boolean; issue: boolean }) {
  const def = getNodeDef(node.type);
  if (!def) return HEAD_H;
  if (node.folded) return HEAD_H;
  const rows = Math.max(def.inputs.length, def.outputs.length, 1);
  let h = HEAD_H + DIVIDER_H + BODY_PAD_TOP + COL_LABEL_H + rows * ROW_H + (rows - 1) * ROW_GAP + BODY_PAD_BOTTOM;
  if (opts.hasThumb) h += PREVIEW_H;
  if (opts.issue) h += ISSUE_H;
  return h;
}

/** Cubic bezier between two points, horizontal tangents. */
export function wirePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1);
  const k = Math.max(34, Math.min(170, dx * 0.5));
  return `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
}
