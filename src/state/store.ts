import { create } from 'zustand';
import {
  defaultParams, getNodeDef,
  type GraphDoc, type GraphEdge, type GraphNode, type ProjectSettings,
} from '../core/graph/types';
import type { BuildIssue } from '../core/graph/Evaluator';
import { makeDefaultGraph } from './defaultGraph';
import { DEFAULT_SHADING, type ShadingSettings } from '../render/TerrainRenderer';
import '../core/nodes';

let idSeq = Date.now() % 100000;
export const newId = (p: string) => `${p}_${(idSeq++).toString(36)}`;

export type BuildStatus = 'idle' | 'building' | 'done' | 'error';

interface Store {
  doc: GraphDoc;
  selection: string[];
  pinned: string | null;
  shading: ShadingSettings;

  status: BuildStatus;
  progress: number;
  progressLabel: string;
  issues: BuildIssue[];
  buildMs: number;
  autoBuild: boolean;
  buildToken: number;

  // canvas view
  pan: { x: number; y: number };
  zoom: number;
  background: 'dots' | 'blank';
  canvasControls: boolean;

  // history
  past: string[];
  future: string[];

  // ---- actions
  commit(mutator: (d: GraphDoc) => void, opts?: { silent?: boolean }): void;
  undo(): void;
  redo(): void;

  addNode(type: string, x: number, y: number): string | null;
  removeNodes(ids: string[]): void;
  duplicateNodes(ids: string[]): void;
  moveNodes(ids: string[], dx: number, dy: number): void;
  setNodePos(id: string, x: number, y: number): void;
  setParam(id: string, key: string, value: any): void;
  setNodeFlag(id: string, key: 'folded' | 'bypassed' | 'locked', value: boolean): void;
  renameNode(id: string, title: string): void;

  connect(from: string, fromPort: string, to: string, toPort: string): void;
  disconnect(edgeId: string): void;
  disconnectInput(nodeId: string, portId: string): void;

  select(ids: string[], additive?: boolean): void;
  pin(id: string | null): void;

  setSettings(patch: Partial<ProjectSettings>): void;
  setShading(patch: Partial<ShadingSettings>): void;
  setView(patch: Partial<{ pan: { x: number; y: number }; zoom: number; background: 'dots' | 'blank'; canvasControls: boolean }>): void;

  setStatus(s: BuildStatus, progress?: number, label?: string): void;
  setBuildResultMeta(issues: BuildIssue[], ms: number): void;
  requestBuild(): void;
  setAutoBuild(v: boolean): void;

  loadDoc(doc: GraphDoc): void;
  serialize(): string;
}

const clone = (d: GraphDoc): GraphDoc => JSON.parse(JSON.stringify(d));
const HISTORY_LIMIT = 80;

export const useStore = create<Store>((set, get) => ({
  doc: makeDefaultGraph(),
  selection: [],
  pinned: null,
  shading: { ...DEFAULT_SHADING },

  status: 'idle',
  progress: 0,
  progressLabel: '',
  issues: [],
  buildMs: 0,
  autoBuild: true,
  buildToken: 0,

  pan: { x: 60, y: 40 },
  zoom: 0.62,
  background: 'dots',
  canvasControls: false,

  past: [],
  future: [],

  commit(mutator, opts) {
    const s = get();
    const before = JSON.stringify(s.doc);
    const next = clone(s.doc);
    mutator(next);
    const after = JSON.stringify(next);
    if (before === after) return;
    set({
      doc: next,
      past: opts?.silent ? s.past : [...s.past.slice(-HISTORY_LIMIT), before],
      future: opts?.silent ? s.future : [],
    });
    if (get().autoBuild) get().requestBuild();
  },

  undo() {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      doc: JSON.parse(prev),
      past: s.past.slice(0, -1),
      future: [JSON.stringify(s.doc), ...s.future].slice(0, HISTORY_LIMIT),
    });
    if (get().autoBuild) get().requestBuild();
  },

  redo() {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      doc: JSON.parse(next),
      past: [...s.past, JSON.stringify(s.doc)].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
    });
    if (get().autoBuild) get().requestBuild();
  },

  addNode(type, x, y) {
    const def = getNodeDef(type);
    if (!def) return null;
    const id = newId(type);
    get().commit((d) => {
      d.nodes.push({ id, type, x: Math.round(x), y: Math.round(y), params: defaultParams(type) });
    });
    set({ selection: [id] });
    return id;
  },

  removeNodes(ids) {
    const keep = new Set(ids);
    get().commit((d) => {
      d.nodes = d.nodes.filter((n) => !keep.has(n.id) || n.type === 'output');
      const alive = new Set(d.nodes.map((n) => n.id));
      d.edges = d.edges.filter((e) => alive.has(e.from) && alive.has(e.to));
    });
    set({ selection: [] });
  },

  duplicateNodes(ids) {
    const s = get();
    const map = new Map<string, string>();
    const created: string[] = [];
    s.commit((d) => {
      for (const id of ids) {
        const n = d.nodes.find((x) => x.id === id);
        if (!n || n.type === 'output') continue;
        const copy: GraphNode = { ...clone({ nodes: [n], edges: [], settings: d.settings }).nodes[0] };
        copy.id = newId(n.type);
        copy.x += 40;
        copy.y += 40;
        map.set(id, copy.id);
        d.nodes.push(copy);
        created.push(copy.id);
      }
      const inner = d.edges.filter((e) => map.has(e.from) && map.has(e.to));
      for (const e of inner) {
        d.edges.push({ id: newId('e'), from: map.get(e.from)!, fromPort: e.fromPort, to: map.get(e.to)!, toPort: e.toPort });
      }
    });
    set({ selection: created });
  },

  moveNodes(ids, dx, dy) {
    const idset = new Set(ids);
    set((s) => {
      const doc = { ...s.doc, nodes: s.doc.nodes.map((n) => (idset.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) };
      return { doc };
    });
  },

  setNodePos(id, x, y) {
    set((s) => ({ doc: { ...s.doc, nodes: s.doc.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) } }));
  },

  setParam(id, key, value) {
    get().commit((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n) n.params[key] = value;
    });
  },

  setNodeFlag(id, key, value) {
    get().commit((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n) (n as any)[key] = value;
    });
  },

  renameNode(id, title) {
    get().commit((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n) n.title = title || undefined;
    });
  },

  connect(from, fromPort, to, toPort) {
    if (from === to) return;
    const def = getNodeDef(get().doc.nodes.find((n) => n.id === from)?.type ?? '');
    const defTo = getNodeDef(get().doc.nodes.find((n) => n.id === to)?.type ?? '');
    const outType = def?.outputs.find((o) => o.id === fromPort)?.type;
    const inType = defTo?.inputs.find((i) => i.id === toPort)?.type;
    if (!outType || !inType || outType !== inType) return;

    // reject cycles
    const doc = get().doc;
    const adj = new Map<string, string[]>();
    for (const e of doc.edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }
    const stack = [to];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === from) return;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nx of adj.get(cur) ?? []) stack.push(nx);
    }

    get().commit((d) => {
      d.edges = d.edges.filter((e) => !(e.to === to && e.toPort === toPort));
      d.edges.push({ id: newId('e'), from, fromPort, to, toPort });
    });
  },

  disconnect(edgeId) {
    get().commit((d) => { d.edges = d.edges.filter((e) => e.id !== edgeId); });
  },

  disconnectInput(nodeId, portId) {
    get().commit((d) => { d.edges = d.edges.filter((e) => !(e.to === nodeId && e.toPort === portId)); });
  },

  select(ids, additive) {
    set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids }));
  },

  pin(id) {
    set({ pinned: id });
    get().requestBuild();
  },

  setSettings(patch) {
    get().commit((d) => { d.settings = { ...d.settings, ...patch }; });
  },

  setShading(patch) {
    set((s) => ({ shading: { ...s.shading, ...patch } }));
  },

  setView(patch) {
    set(patch as any);
  },

  setStatus(status, progress, label) {
    set((s) => ({ status, progress: progress ?? s.progress, progressLabel: label ?? s.progressLabel }));
  },

  setBuildResultMeta(issues, ms) {
    set({ issues, buildMs: ms });
  },

  requestBuild() {
    set((s) => ({ buildToken: s.buildToken + 1 }));
  },

  setAutoBuild(v) {
    set({ autoBuild: v });
    if (v) get().requestBuild();
  },

  loadDoc(doc) {
    set({ doc, selection: [], pinned: null, past: [], future: [] });
    get().requestBuild();
  },

  serialize() {
    return JSON.stringify({ version: 1, ...get().doc }, null, 2);
  },
}));

export function edgesOf(doc: GraphDoc, nodeId: string): GraphEdge[] {
  return doc.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}
