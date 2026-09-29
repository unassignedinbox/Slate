import type { GPU, Tex2D, Vol3D, TexFormat } from '../gl/GPU';

/** Data that can travel down a wire. */
export type PortType = 'field' | 'color' | 'volume';

export const PORT_COLORS: Record<PortType, string> = {
  field: '#8b93a7',   // scalar heightfield / mask  — grey-blue
  color: '#c08a5a',   // RGBA colour map            — amber
  volume: '#6f8f7a',  // 3D SDF volume              — green
};

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  /** Input may be left unconnected. */
  optional?: boolean;
  info?: string;
}

export type ParamKind =
  | 'float'
  | 'int'
  | 'bool'
  | 'enum'
  | 'seed'
  | 'angle'
  | 'vec2'
  | 'gradient';

export interface ParamDef {
  id: string;
  label: string;
  kind: ParamKind;
  default: any;
  min?: number;
  max?: number;
  step?: number;
  /** slider response curve; 2 = quadratic ease so small values are reachable */
  curve?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  group?: string;
  info?: string;
  /** hide unless the predicate passes (params object is passed in) */
  when?: (p: Record<string, any>) => boolean;
}

export type CategoryId =
  | 'generators'
  | 'shape'
  | 'erosion'
  | 'analysis'
  | 'texturing'
  | 'volume'
  | 'output';

export interface EvalCtx {
  gpu: GPU;
  /** heightfield resolution (square) */
  res: number;
  /** cave volume resolution (cubic) */
  volRes: number;
  /** terrain footprint in metres */
  worldSize: number;
  /** vertical range in metres that field value 1.0 maps to */
  heightScale: number;
  /** metres per texel = worldSize / res */
  cell: number;
  /** project seed, combined with per-node seeds */
  seed: number;

  /** Resolve a connected input. Returns null when unconnected. */
  input(id: string): Tex2D | null;
  inputVol(id: string): Vol3D | null;
  /** Input, or a freshly allocated field filled with `fallback`. */
  inputOr(id: string, fallback: number): Tex2D;

  p: Record<string, any>;

  alloc(fmt?: TexFormat, res?: number): Tex2D;
  allocVol(size?: number): Vol3D;
  /** Return a scratch target to the pool. Never call this on a value you return. */
  release(t: Tex2D | null | undefined): void;
  releaseVol(v: Vol3D | null | undefined): void;

  /** Surface a message on the node badge + build log. */
  warn(msg: string): void;
  /** Progress ticks for long loops (0..1 within this node). */
  tick(fraction: number): void;
  /** Cooperative abort — long loops should bail when this returns true. */
  aborted(): boolean;
}

export type NodeOutputs = Record<string, Tex2D | Vol3D | null>;

export interface NodeDef {
  type: string;
  title: string;
  subtitle: string;
  category: CategoryId;
  icon: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /**
   * Minimum sensible build resolution. Erosion needs texels to carve into; below
   * this the result is mush and the node says so instead of quietly blurring.
   */
  minRes?: number;
  /** Rough relative cost, used to weight the build progress bar. */
  cost?: number;
  /** Extra search keywords. */
  keywords?: string[];
  evaluate(ctx: EvalCtx): NodeOutputs;
}

// ------------------------------------------------------------ graph model

export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, any>;
  /** collapsed body */
  folded?: boolean;
  /** muted nodes pass their first input straight through */
  bypassed?: boolean;
  /** pinned as the viewport source */
  previewed?: boolean;
  locked?: boolean;
  title?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export interface GraphDoc {
  nodes: GraphNode[];
  edges: GraphEdge[];
  settings: ProjectSettings;
}

export interface ProjectSettings {
  /** heightfield resolution — the one that decides whether erosion is crisp */
  resolution: number;
  /** cave SDF volume resolution */
  volumeResolution: number;
  /** terrain footprint, metres */
  worldSize: number;
  /** vertical scale, metres */
  heightScale: number;
  seed: number;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  resolution: 1024,
  volumeResolution: 128,
  worldSize: 4096,
  heightScale: 900,
  seed: 1337,
};

// ------------------------------------------------------------- registry

const registry = new Map<string, NodeDef>();

export function defineNode(def: NodeDef): NodeDef {
  if (registry.has(def.type)) throw new Error(`duplicate node type ${def.type}`);
  registry.set(def.type, def);
  return def;
}

export function getNodeDef(type: string): NodeDef | undefined {
  return registry.get(type);
}

export function allNodeDefs(): NodeDef[] {
  return [...registry.values()];
}

export function defaultParams(type: string): Record<string, any> {
  const def = registry.get(type);
  if (!def) return {};
  const p: Record<string, any> = {};
  for (const d of def.params) p[d.id] = Array.isArray(d.default) ? [...d.default] : d.default;
  return p;
}

export const CATEGORY_META: Record<CategoryId, { label: string; icon: string; accent: string }> = {
  generators: { label: 'Generators', icon: 'sparkles', accent: '#7d8cc4' },
  shape:      { label: 'Shape',      icon: 'layers',   accent: '#8c7dc4' },
  erosion:    { label: 'Erosion',    icon: 'droplet',  accent: '#4f8fa8' },
  analysis:   { label: 'Analysis',   icon: 'scan',     accent: '#a88f4f' },
  texturing:  { label: 'Texturing',  icon: 'palette',  accent: '#a85f7a' },
  volume:     { label: 'SDF Volume', icon: 'cube',     accent: '#5fa87f' },
  output:     { label: 'Output',     icon: 'monitor',  accent: '#b0b0b0' },
};
