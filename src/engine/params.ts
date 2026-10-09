// Self-describing parameter schemas. Every generator, mask, erosion type and
// filter publishes a ParamDef list; the inspector renders it generically, so
// adding an operation never requires new UI code.

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export type ParamDef =
  | {
      kind: 'slider';
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      def: number;
      unit?: string;
      hint?: string;
    }
  | {
      kind: 'dropdown';
      key: string;
      label: string;
      options: Option[];
      def: string;
      hint?: string;
    }
  | { kind: 'toggle'; key: string; label: string; def: boolean; hint?: string };

export interface OpDef {
  id: string;
  label: string;
  blurb: string;
  icon?: string;
  params: ParamDef[];
}

export function defaultParams(defs: ParamDef[]): Params {
  const out: Params = {};
  for (const d of defs) out[d.key] = d.def;
  return out;
}

/** Force a stored parameter set to match its schema (forward compatibility). */
export function normalizeParams(defs: ParamDef[], stored: Params | undefined): Params {
  const out = defaultParams(defs);
  if (!stored) return out;
  for (const d of defs) {
    const v = stored[d.key];
    if (v === undefined) continue;
    if (d.kind === 'slider') {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
      if (Number.isFinite(n)) out[d.key] = clampToStep(n, d.min, d.max, d.step);
    } else if (d.kind === 'dropdown') {
      if (d.options.some((o) => o.value === v)) out[d.key] = v as string;
    } else {
      out[d.key] = Boolean(v);
    }
  }
  return out;
}

function clampToStep(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  if (step <= 0) return c;
  const snapped = Math.round((c - min) / step) * step + min;
  const fixed = Number(snapped.toFixed(6));
  return Math.min(max, Math.max(min, fixed));
}

export function num(p: Params, key: string, fallback = 0): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(p: Params, key: string, fallback = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function bool(p: Params, key: string, fallback = false): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}
