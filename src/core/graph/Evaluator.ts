import type { GPU, Tex2D, Vol3D, TexFormat } from '../gl/GPU';
import {
  getNodeDef, type GraphDoc, type GraphNode, type EvalCtx,
  type NodeOutputs, type ProjectSettings,
} from './types';

export interface BuildIssue {
  nodeId: string;
  nodeTitle: string;
  message: string;
  severity: 'warn' | 'error';
}

export interface BuildResult {
  height: Tex2D | null;
  color: Tex2D | null;
  volume: Vol3D | null;
  water: Tex2D | null;
  settings: ProjectSettings;
  seaLevel: number;
  caveBlend: number;
  exaggeration: number;
  issues: BuildIssue[];
  ms: number;
  /** field preview for the pinned node, if any */
  preview: Tex2D | null;
  previewKind: 'field' | 'color' | null;
  generation: number;
}

export interface BuildHandle {
  aborted: boolean;
}

export interface BuildOptions {
  handle: BuildHandle;
  onProgress?: (fraction: number, label: string) => void;
  /** node pinned to the viewport, overrides the Output chain */
  pinnedId?: string | null;
  /** render a small preview for every node that produces a 2D result */
  thumbnails?: boolean;
  onThumbnail?: (nodeId: string, data: ImageData) => void;
}

export const THUMB_SIZE = 128;

const THUMB_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uS;
uniform float uIsColor, uMin, uMax;
layout(location = 0) out vec4 o;
void main(){
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  if (uIsColor > 0.5){
    vec4 c = texture(uS, uv);
    // checker behind transparent regions so masked satmaps read correctly
    vec2 g = floor(uv * 16.0);
    float chk = mod(g.x + g.y, 2.0) * 0.06 + 0.07;
    o = vec4(mix(vec3(chk), c.rgb, c.a), 1.0);
  } else {
    float v = texture(uS, uv).r;
    float n = clamp((v - uMin) / max(1e-6, uMax - uMin), 0.0, 1.0);
    // slight warm ramp so heightfields do not read as flat grey
    vec3 c = mix(vec3(0.06, 0.065, 0.075), vec3(0.93, 0.92, 0.89), n);
    c = mix(c, vec3(0.30, 0.42, 0.50), (1.0 - n) * 0.25);
    o = vec4(c, 1.0);
  }
}`;

interface CacheEntry {
  hash: string;
  outputs: NodeOutputs;
  bytes: number;
  lastUsed: number;
}

function hashString(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const nextFrame = () =>
  new Promise<void>((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });

/** Nodes at or above this cost keep their results between builds. */
const CACHE_COST_THRESHOLD = 8;
const CACHE_BUDGET_BYTES = 420 * 1024 * 1024;

export class Evaluator {
  private cache = new Map<string, CacheEntry>();
  private clock = 0;
  private generation = 0;
  /** outputs of the previous successful build that the renderer still holds */
  private retained: (Tex2D | Vol3D | null)[] = [];

  constructor(private gpu: GPU) {}

  invalidateAll() {
    for (const e of this.cache.values()) this.disposeOutputs(e.outputs);
    this.cache.clear();
  }

  private disposeOutputs(outs: NodeOutputs) {
    for (const k in outs) {
      const v = outs[k];
      if (!v) continue;
      if ((v as Vol3D).size !== undefined) this.gpu.freeVolume(v as Vol3D);
      else this.gpu.free(v as Tex2D);
    }
  }

  private bytesOf(outs: NodeOutputs): number {
    let b = 0;
    for (const k in outs) {
      const v = outs[k];
      if (!v) continue;
      if ((v as Vol3D).size !== undefined) {
        const s = (v as Vol3D).size;
        b += s * s * s * 4;
      } else {
        const t = v as Tex2D;
        const ch = t.fmt === 'R32F' ? 1 : t.fmt === 'RG32F' ? 2 : 4;
        b += t.w * t.h * ch * (t.fmt === 'RGBA8' ? 1 : 4);
      }
    }
    return b;
  }

  private trimCache() {
    let total = 0;
    for (const e of this.cache.values()) total += e.bytes;
    if (total <= CACHE_BUDGET_BYTES) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k, e] of entries) {
      if (total <= CACHE_BUDGET_BYTES) break;
      this.disposeOutputs(e.outputs);
      this.cache.delete(k);
      total -= e.bytes;
    }
  }

  private thumbBytes = new Uint8Array(THUMB_SIZE * THUMB_SIZE * 4);

  /** Small RGBA preview of a 2D result, for the node card. */
  thumbnail(src: Tex2D, isColor: boolean): ImageData | null {
    try {
      const gpu = this.gpu;
      let mn = 0;
      let mx = 1;
      if (!isColor) {
        const r = gpu.minMax(src);
        mn = r[0];
        mx = r[1];
        if (mx - mn < 1e-5) { mn = Math.min(0, mn); mx = mn + 1; }
      }
      const t = gpu.alloc(THUMB_SIZE, THUMB_SIZE, 'RGBA8');
      gpu.pass({
        name: 'evaluator.thumb',
        frag: THUMB_FRAG,
        uniforms: {
          uS: { __texref: true as const, tex: src.tex, is3D: false },
          uIsColor: isColor ? 1 : 0,
          uMin: mn,
          uMax: mx,
        },
        target: t,
      });
      gpu.readBytes(t, this.thumbBytes);
      gpu.free(t);
      return new ImageData(new Uint8ClampedArray(this.thumbBytes), THUMB_SIZE, THUMB_SIZE);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ build

  async build(doc: GraphDoc, opts: BuildOptions): Promise<BuildResult> {
    const t0 = performance.now();
    const gpu = this.gpu;
    const s = doc.settings;
    const issues: BuildIssue[] = [];
    this.generation++;

    // Release whatever the previous build handed to the renderer.
    for (const r of this.retained) {
      if (!r) continue;
      if ((r as Vol3D).size !== undefined) gpu.freeVolume(r as Vol3D);
      else gpu.free(r as Tex2D);
    }
    this.retained = [];

    const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
    // incoming[nodeId][portId] = {from, fromPort}
    const incoming = new Map<string, Map<string, { from: string; fromPort: string }>>();
    for (const e of doc.edges) {
      if (!nodesById.has(e.from) || !nodesById.has(e.to)) continue;
      let m = incoming.get(e.to);
      if (!m) incoming.set(e.to, (m = new Map()));
      m.set(e.toPort, { from: e.from, fromPort: e.fromPort });
    }

    // ---- pick the target ---------------------------------------------------
    let target: GraphNode | undefined;
    if (opts.pinnedId) target = nodesById.get(opts.pinnedId);
    const outputNode = doc.nodes.find((n) => n.type === 'output');
    if (!target) target = outputNode;

    const empty: BuildResult = {
      height: null, color: null, volume: null, water: null,
      settings: s, seaLevel: 0, caveBlend: 0, exaggeration: 1,
      issues, ms: 0, preview: null, previewKind: null, generation: this.generation,
    };
    if (!target) {
      issues.push({ nodeId: '', nodeTitle: '', message: 'No Terrain Output node in the graph.', severity: 'error' });
      return empty;
    }

    // ---- topological order over the reachable subgraph ---------------------
    const order: string[] = [];
    const state = new Map<string, 0 | 1 | 2>();
    const roots = new Set<string>([target.id]);
    if (outputNode && target.id !== outputNode.id) roots.add(outputNode.id);

    let cyclic = false;
    const visit = (id: string) => {
      const st = state.get(id);
      if (st === 2) return;
      if (st === 1) { cyclic = true; return; }
      state.set(id, 1);
      const inc = incoming.get(id);
      if (inc) for (const { from } of inc.values()) visit(from);
      state.set(id, 2);
      order.push(id);
    };
    for (const r of roots) visit(r);
    if (cyclic) {
      issues.push({ nodeId: '', nodeTitle: '', message: 'Cycle detected — the graph must be acyclic.', severity: 'error' });
      return { ...empty, ms: performance.now() - t0 };
    }

    // ---- ref counts so scratch results can be freed as we go ---------------
    const refs = new Map<string, number>();
    for (const id of order) {
      const inc = incoming.get(id);
      if (!inc) continue;
      for (const { from } of inc.values()) refs.set(from, (refs.get(from) ?? 0) + 1);
    }
    for (const r of roots) refs.set(r, (refs.get(r) ?? 0) + 1);

    // Whatever feeds a root IS the render payload. Those results have to outlive
    // the reference-counted sweep below, or the viewport gets handed a texture
    // that was already returned to the pool.
    const payloadSources = new Set<string>(roots);
    for (const r of roots) {
      const rinc = incoming.get(r);
      if (rinc) for (const { from } of rinc.values()) payloadSources.add(from);
    }

    // ---- evaluate ----------------------------------------------------------
    const results = new Map<string, NodeOutputs>();
    const hashes = new Map<string, string>();
    const cached = new Set<string>();
    const settingsKey = `${s.resolution}|${s.volumeResolution}|${s.worldSize}|${s.heightScale}|${s.seed}`;

    const totalCost = order.reduce((a, id) => {
      const n = nodesById.get(id)!;
      return a + (getNodeDef(n.type)?.cost ?? 1);
    }, 0) || 1;
    let doneCost = 0;

    for (let oi = 0; oi < order.length; oi++) {
      if (opts.handle.aborted) break;
      const id = order[oi];
      const node = nodesById.get(id)!;
      const def = getNodeDef(node.type);
      if (!def) {
        issues.push({ nodeId: id, nodeTitle: node.type, message: `Unknown node type "${node.type}".`, severity: 'error' });
        results.set(id, {});
        continue;
      }

      const inc = incoming.get(id);
      const upstream = def.inputs
        .map((p) => {
          const link = inc?.get(p.id);
          return link ? `${p.id}=${hashes.get(link.from) ?? '?'}:${link.fromPort}` : `${p.id}=∅`;
        })
        .join(',');
      const hash = hashString(`${def.type}|${settingsKey}|${JSON.stringify(node.params)}|${node.bypassed ? 'B' : ''}|${upstream}`);
      hashes.set(id, hash);

      // cache hit?
      const hit = this.cache.get(id);
      if (hit && hit.hash === hash) {
        hit.lastUsed = ++this.clock;
        results.set(id, hit.outputs);
        cached.add(id);
        doneCost += def.cost ?? 1;
        opts.onProgress?.(doneCost / totalCost, def.title);
        continue;
      }

      opts.onProgress?.(doneCost / totalCost, def.title);
      if (oi > 0) await nextFrame();
      if (opts.handle.aborted) break;

      // bypassed: forward the first matching input
      if (node.bypassed) {
        const outs: NodeOutputs = {};
        for (const op of def.outputs) {
          const src = def.inputs.find((ip) => ip.type === op.type);
          const link = src ? inc?.get(src.id) : undefined;
          const v = link ? results.get(link.from)?.[link.fromPort] ?? null : null;
          outs[op.id] = v ?? null;
        }
        // shared references — do not let the ref-count sweep free them twice
        results.set(id, outs);
        cached.add(id);
        doneCost += def.cost ?? 1;
        continue;
      }

      // Everything the node allocates is tracked so a throw mid-evaluate cannot
      // strand pool textures. Whatever it returns as output is handed over; the
      // rest is reclaimed below.
      const liveTex = new Set<Tex2D>();
      const liveVol = new Set<Vol3D>();
      const ctx: EvalCtx = {
        gpu,
        res: s.resolution,
        volRes: s.volumeResolution,
        worldSize: s.worldSize,
        heightScale: s.heightScale,
        cell: s.worldSize / s.resolution,
        seed: s.seed,
        p: node.params,
        input: (pid) => {
          const link = inc?.get(pid);
          if (!link) return null;
          const v = results.get(link.from)?.[link.fromPort] ?? null;
          return v && (v as Vol3D).size === undefined ? (v as Tex2D) : null;
        },
        inputVol: (pid) => {
          const link = inc?.get(pid);
          if (!link) return null;
          const v = results.get(link.from)?.[link.fromPort] ?? null;
          return v && (v as Vol3D).size !== undefined ? (v as Vol3D) : null;
        },
        inputOr: (pid, fallback) => {
          const v = ctx.input(pid);
          if (v) return v;
          const t = gpu.alloc(s.resolution, s.resolution, 'R32F');
          gpu.pass({
            name: 'ctx.fill',
            frag: `#version 300 es
precision highp float; in vec2 vUV; uniform float uV; layout(location=0) out vec4 o;
void main(){ o = vec4(uV); }`,
            uniforms: { uV: fallback },
            target: t,
          });
          liveTex.add(t);
          return t;
        },
        alloc: (fmt: TexFormat = 'R32F', res?: number) => {
          const t = gpu.alloc(res ?? s.resolution, res ?? s.resolution, fmt);
          liveTex.add(t);
          return t;
        },
        allocVol: (size?: number) => {
          const v = gpu.allocVolume(size ?? s.volumeResolution);
          liveVol.add(v);
          return v;
        },
        release: (t) => { if (t && liveTex.delete(t)) gpu.free(t); },
        releaseVol: (v) => { if (v && liveVol.delete(v)) gpu.freeVolume(v); },
        warn: (msg) => issues.push({ nodeId: id, nodeTitle: node.title ?? def.title, message: msg, severity: 'warn' }),
        tick: (f) => opts.onProgress?.((doneCost + (def.cost ?? 1) * Math.min(1, Math.max(0, f))) / totalCost, def.title),
        aborted: () => opts.handle.aborted,
      };

      if (def.minRes && s.resolution < def.minRes) {
        issues.push({
          nodeId: id,
          nodeTitle: node.title ?? def.title,
          message: `Wants ≥ ${def.minRes}² — building at ${s.resolution}². Detail will be lost.`,
          severity: 'warn',
        });
      }

      let outs: NodeOutputs = {};
      try {
        outs = def.evaluate(ctx) ?? {};
      } catch (err: any) {
        issues.push({ nodeId: id, nodeTitle: node.title ?? def.title, message: String(err?.message ?? err), severity: 'error' });
        // eslint-disable-next-line no-console
        console.error(`[${def.type}]`, err);
      }
      // hand the declared outputs over, reclaim the rest
      for (const k in outs) {
        const v = outs[k];
        if (!v) continue;
        if ((v as Vol3D).size !== undefined) liveVol.delete(v as Vol3D);
        else liveTex.delete(v as Tex2D);
      }
      for (const t of liveTex) gpu.free(t);
      for (const v of liveVol) gpu.freeVolume(v);

      // release a stale cache entry for this node before storing the new one
      const stale = this.cache.get(id);
      if (stale) { this.disposeOutputs(stale.outputs); this.cache.delete(id); }

      results.set(id, outs);
      doneCost += def.cost ?? 1;

      if (opts.thumbnails && opts.onThumbnail) {
        const port = def.outputs.find((o) => o.type === 'field') ?? def.outputs.find((o) => o.type === 'color');
        const v = port ? outs[port.id] : null;
        if (v && (v as Vol3D).size === undefined) {
          const img = this.thumbnail(v as Tex2D, port!.type === 'color');
          if (img) opts.onThumbnail(id, img);
        }
      }

      if ((def.cost ?? 1) >= CACHE_COST_THRESHOLD) {
        this.cache.set(id, { hash, outputs: outs, bytes: this.bytesOf(outs), lastUsed: ++this.clock });
        cached.add(id);
      }

      // free upstream results nobody else needs
      if (inc) {
        for (const { from } of inc.values()) {
          const left = (refs.get(from) ?? 1) - 1;
          refs.set(from, left);
          if (left <= 0 && !cached.has(from) && !payloadSources.has(from)) {
            const o = results.get(from);
            if (o) { this.disposeOutputs(o); results.set(from, {}); }
          }
        }
      }
    }

    this.trimCache();

    // ---- assemble the render payload ---------------------------------------
    const outInc = outputNode ? incoming.get(outputNode.id) : undefined;
    const pick = (portId: string): Tex2D | Vol3D | null => {
      const link = outInc?.get(portId);
      if (!link) return null;
      return results.get(link.from)?.[link.fromPort] ?? null;
    };

    let height = pick('height') as Tex2D | null;
    let color = pick('color') as Tex2D | null;
    const volume = pick('volume') as Vol3D | null;
    let water = pick('water') as Tex2D | null;

    let preview: Tex2D | null = null;
    let previewKind: 'field' | 'color' | null = null;

    if (opts.pinnedId && opts.pinnedId !== outputNode?.id) {
      const pinned = nodesById.get(opts.pinnedId);
      const pdef = pinned ? getNodeDef(pinned.type) : undefined;
      const pouts = results.get(opts.pinnedId);
      if (pdef && pouts) {
        const fieldPort = pdef.outputs.find((o) => o.type === 'field');
        const colorPort = pdef.outputs.find((o) => o.type === 'color');
        if (fieldPort && pouts[fieldPort.id]) {
          preview = pouts[fieldPort.id] as Tex2D;
          previewKind = 'field';
          height = preview;
          color = null;
        } else if (colorPort && pouts[colorPort.id]) {
          preview = pouts[colorPort.id] as Tex2D;
          previewKind = 'color';
          color = preview;
        }
      }
    }

    const op = outputNode?.params ?? {};
    const result: BuildResult = {
      height, color, volume, water,
      settings: s,
      seaLevel: op.seaLevel ?? 0,
      caveBlend: op.caveBlend ?? 12,
      exaggeration: op.exaggeration ?? 1,
      issues,
      ms: performance.now() - t0,
      preview, previewKind,
      generation: this.generation,
    };

    // Keep the render payload alive until the next build.
    const keep = new Set<Tex2D | Vol3D>();
    for (const v of [height, color, water, volume]) if (v) keep.add(v);
    for (const [id, outs] of results) {
      if (cached.has(id)) continue;
      for (const k in outs) {
        const v = outs[k];
        if (!v) continue;
        if (keep.has(v)) continue;
        if ((v as Vol3D).size !== undefined) gpu.freeVolume(v as Vol3D);
        else gpu.free(v as Tex2D);
      }
    }
    // Values owned by the cache stay put; the ones we hand to the renderer and
    // that are NOT cached get released at the top of the next build.
    const cacheOwned = new Set<Tex2D | Vol3D>();
    for (const e of this.cache.values()) {
      for (const k in e.outputs) {
        const v = e.outputs[k];
        if (v) cacheOwned.add(v);
      }
    }
    for (const v of keep) if (!cacheOwned.has(v)) this.retained.push(v);

    return result;
  }
}
