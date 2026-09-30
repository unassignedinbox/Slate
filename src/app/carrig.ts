/**
 * Car damage rig: the runtime half of the baked-deformation pipeline.
 *
 *   bake time   elasto-plastic shell solve per impact site  (frac/dent.ts)
 *                 -> per-vertex VAT  (exact, bound to this mesh)
 *                 -> deformation cage (mesh-independent, drives every part)
 *   run time    each site holds a damage cursor; an impact advances the cursor
 *               of the nearest site, and the vertex shader plays the bake.
 *
 * Nothing is solved per frame. The whole runtime cost is: pick a site, add to
 * a float, and up to a handful of texture fetches per vertex.
 */

import { V3, v3, add, sub, mul, norm, dot, len, clamp } from '../core/math';
import { buildCarShell, shellNormals, IndexedShell, CAR } from '../geom/carbody';
import {
  DentSite, ShellTopo, buildTopology, bakeDent, BakedDent, Cage, makeCage, fitCage,
} from '../frac/dent';

export interface SiteState {
  site: DentSite;
  /** baked lazily on first use */
  bake: BakedDent | null;
  /** cage-node deltas per frame (frames * nodes * 4), baked with the dent */
  cage: Float32Array | null;
  /** damage cursor in frames, 0 = pristine */
  level: number;
  target: number;
  vel: number;
  /** true once the GPU copy is up to date */
  uploaded: boolean;
}

export const FRAMES = 14;
/** How many dents the shader blends at once. */
export const MAX_ACTIVE = 6;

export interface LampState {
  label: string;
  centre: V3;
  half: V3;
  broken: boolean;
  /** which site breaks it */
  site: number;
}

export class CarRig {
  shell: IndexedShell;
  topo: ShellTopo;
  nrm0: Float32Array;
  cage: Cage;
  sites: SiteState[] = [];
  lamps: LampState[] = [];
  frames = FRAMES;
  /** total plastic work proxy, for the HUD */
  crush = 0;
  bakeMs = 0;
  bakedCount = 0;
  /** bumped whenever a site's texture data needs pushing to the GPU */
  revision = 0;
  /** background baking */
  private worker: Worker | null = null;
  private queue: number[] = [];
  private busy = false;
  pending = 0;

  constructor(cell = CAR.cell) {
    this.shell = buildCarShell(cell);
    this.topo = buildTopology(this.shell);
    this.nrm0 = shellNormals(this.shell.pos, this.shell.tris);
    this.cage = makeCage(this.shell.min, this.shell.max, 22, 9, 9);

    const S = (
      label: string, p: V3, radius: number, depth: number, dir?: V3,
      shape: 'sphere' | 'barrier' = 'sphere', span?: number, zone?: number,
    ) => {
      const snapped = this.snap(p, dir);
      this.sites.push({
        site: { label, p: snapped.p, d: snapped.d, radius, depth, shape, span, zone },
        bake: null, cage: null, level: 0, target: 0, vel: 0, uploaded: false,
      });
    };

    // A production rig would place these from the crash-structure layout.
    S('front corner, left', v3(1.98, -0.18, -0.72), 0.26, 0.32, undefined, 'barrier', 0.95, 0.70);
    S('front bumper, centre', v3(2.07, -0.16, 0.0), 0.30, 0.32, undefined, 'barrier', 1.30, 0.80);
    S('front corner, right', v3(1.98, -0.18, 0.72), 0.26, 0.32, undefined, 'barrier', 0.95, 0.70);
    S('bonnet, left', v3(1.28, 0.30, -0.42), 0.26, 0.13, v3(0, -1, 0));
    S('bonnet, right', v3(1.28, 0.30, 0.42), 0.26, 0.13, v3(0, -1, 0));
    S('roof', v3(0.05, 0.72, 0.0), 0.30, 0.12, v3(0, -1, 0));
    S('door, left', v3(0.25, -0.05, -0.92), 0.30, 0.15, v3(0, 0, 1));
    S('door, right', v3(0.25, -0.05, 0.92), 0.30, 0.15, v3(0, 0, -1));
    S('rear quarter, left', v3(-1.45, -0.08, -0.88), 0.26, 0.15, v3(0, 0, 1));
    S('rear quarter, right', v3(-1.45, -0.08, 0.88), 0.26, 0.15, v3(0, 0, -1));
    S('boot lid', v3(-1.75, 0.26, 0.0), 0.26, 0.12, v3(0, -1, 0));
    S('rear bumper', v3(-2.05, -0.22, 0.0), 0.30, 0.26, undefined, 'barrier', 1.25, 0.60);

    const lamp = (label: string, c: V3, h: V3, site: number) =>
      this.lamps.push({ label, centre: c, half: h, broken: false, site });
    lamp('headlight, left', v3(1.93, -0.02, -0.58), v3(0.055, 0.085, 0.19), 0);
    lamp('headlight, right', v3(1.93, -0.02, 0.58), v3(0.055, 0.085, 0.19), 2);
    lamp('tail light, left', v3(-2.00, 0.10, -0.60), v3(0.045, 0.07, 0.17), 11);
    lamp('tail light, right', v3(-2.00, 0.10, 0.60), v3(0.045, 0.07, 0.17), 11);
  }

  /** Snap a rough site position onto the actual shell surface. */
  private snap(p: V3, dir?: V3): { p: V3; d: V3 } {
    const { pos } = this.shell;
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.shell.n; i++) {
      const d = (pos[i * 3] - p.x) ** 2 + (pos[i * 3 + 1] - p.y) ** 2 + (pos[i * 3 + 2] - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const q = v3(pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]);
    const n = v3(this.nrm0[best * 3], this.nrm0[best * 3 + 1], this.nrm0[best * 3 + 2]);
    return { p: q, d: dir ? norm(dir) : mul(n, -1) };
  }

  /** Run (and cache) the offline solve for one site. */
  ensureBaked(i: number): SiteState {
    const s = this.sites[i];
    if (s.bake) return s;
    s.bake = bakeDent(this.topo, s.site, { frames: this.frames });
    // fit every frame of the solve onto the deformation cage
    const nodes = this.cage.nodes;
    const P = s.bake.count;
    const cage = new Float32Array(this.frames * nodes * 4);
    for (let f = 0; f < this.frames; f++) {
      const slice = s.bake.pos.subarray(f * P * 4, (f + 1) * P * 4);
      cage.set(fitCage(this.cage, this.shell.pos, slice, s.bake.verts), f * nodes * 4);
    }
    s.cage = cage;
    s.uploaded = false;
    this.bakeMs += s.bake.ms;
    this.bakedCount++;
    this.revision++;
    return s;
  }

  // ------------------------------------------------------------- background
  /**
   * Stream the bakes off the main thread. Sites are queued front-first (that
   * is where the player aims); an impact on an unbaked site jumps the queue
   * and the damage appears as soon as the solve lands, a few hundred ms later.
   */
  attachWorker(w: Worker): void {
    this.worker = w;
    w.onmessage = (ev: MessageEvent) => {
      const d = ev.data as {
        i: number; verts: Uint32Array; pos: Float32Array; nrm: Float32Array;
        cage: Float32Array; count: number; ms: number;
      };
      const st = this.sites[d.i];
      st.bake = { verts: d.verts, pos: d.pos, nrm: d.nrm, frames: this.frames, count: d.count, ms: d.ms };
      st.cage = d.cage;
      st.uploaded = false;
      this.bakeMs += d.ms;
      this.bakedCount++;
      this.revision++;
      this.busy = false;
      this.pending = this.queue.length + 0;
      this.pump();
    };
    w.postMessage({
      type: 'init',
      x0: this.shell.pos, tris: this.shell.tris,
      edge: this.topo.edge, edgeRest: this.topo.edgeRest,
      bend: this.topo.bend, bendRest: this.topo.bendRest,
      frames: this.frames,
      cage: {
        nx: this.cage.nx, ny: this.cage.ny, nz: this.cage.nz, nodes: this.cage.nodes,
        min: [this.cage.min.x, this.cage.min.y, this.cage.min.z],
        size: [this.cage.size.x, this.cage.size.y, this.cage.size.z],
      },
    });
    for (let i = 0; i < this.sites.length; i++) this.queue.push(i);
    this.pending = this.queue.length;
    this.pump();
  }

  private pump(): void {
    if (!this.worker || this.busy) return;
    while (this.queue.length && this.sites[this.queue[0]].bake) this.queue.shift();
    const i = this.queue.shift();
    if (i === undefined) { this.pending = 0; return; }
    this.busy = true;
    this.pending = this.queue.length + 1;
    this.worker.postMessage({ type: 'bake', i, site: this.sites[i].site });
  }

  /** Ask for a site now (jumps the queue); falls back to a blocking solve. */
  request(i: number): void {
    if (this.sites[i].bake) return;
    if (!this.worker) { this.ensureBaked(i); return; }
    this.queue = [i, ...this.queue.filter((q) => q !== i)];
    this.pump();
  }

  /** Bake one not-yet-baked site (called when the frame has time to spare). */
  prewarm(): boolean {
    for (let i = 0; i < this.sites.length; i++) {
      if (!this.sites[i].bake) { this.ensureBaked(i); return true; }
    }
    return false;
  }

  /** Nearest site to a world-space (body-local) contact, biased by direction. */
  pickSite(p: V3, dir: V3): number {
    let best = 0, bs = -1e9;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i].site;
      const d = len(sub(p, s.p));
      const facing = dot(norm(dir), s.d);           // 1 = hitting it square on
      const score = -d * 2.2 + facing * 0.9;
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  }

  /**
   * Apply an impact. Energy maps to how far along the baked damage sequence
   * this site is driven; 9 kJ (a 1.4 t car at ~13 km/h) is a full-depth dent.
   */
  impact(p: V3, dir: V3, energy: number): { site: number; lamps: LampState[] } {
    const i = this.pickSite(p, dir);
    const s = this.sites[i];
    this.request(i);
    const facing = clamp(dot(norm(dir), s.site.d), 0.15, 1);
    const adv = this.frames * clamp(energy / 9000, 0, 1.15) * facing;
    s.target = clamp(s.target + adv, 0, this.frames - 1);
    s.vel += adv * 5.5;                              // panel boom / springback
    this.crush += adv;

    const broken: LampState[] = [];
    for (const l of this.lamps) {
      if (l.broken) continue;
      const near = len(sub(p, l.centre)) < 0.55;
      const viaSite = l.site === i && s.target > this.frames * 0.22;
      if ((near && energy > 120) || viaSite) { l.broken = true; broken.push(l); }
    }
    return { site: i, lamps: broken };
  }

  /** Spring the visible damage cursor toward its target (metal rings and settles). */
  update(dt: number): void {
    for (const s of this.sites) {
      if (!s.bake) continue;                 // damage waits for its bake
      if (s.level === s.target && Math.abs(s.vel) < 1e-4) continue;
      const k = 260, c = 15;
      s.vel += (s.target - s.level) * k * dt - s.vel * c * dt;
      s.level = clamp(s.level + s.vel * dt, 0, this.frames - 1.001);
      if (Math.abs(s.target - s.level) < 1e-3 && Math.abs(s.vel) < 1e-3) {
        s.level = s.target; s.vel = 0;
      }
    }
  }

  /** The dents the shader should blend this frame: [siteIndex, frame, amp]. */
  activeDents(): Float32Array {
    const order = this.sites
      .map((s, i) => ({ i, v: s.level }))
      .filter((o) => o.v > 0.001)
      .sort((a, b) => b.v - a.v)
      .slice(0, MAX_ACTIVE);
    const out = new Float32Array(MAX_ACTIVE * 3);
    order.forEach((o, k) => {
      out[k * 3] = o.i;
      out[k * 3 + 1] = this.sites[o.i].level;
      out[k * 3 + 2] = 1;
    });
    return out.slice(0, Math.max(order.length, 0) * 3);
  }

  activeCount(): number {
    return Math.min(this.sites.filter((s) => s.level > 0.001).length, MAX_ACTIVE);
  }

  /** CPU evaluation of the deformed surface (hit tests, headless tests). */
  deformed(out?: Float32Array): Float32Array {
    const x = out ?? new Float32Array(this.shell.pos);
    x.set(this.shell.pos);
    for (const s of this.sites) {
      if (!s.bake || s.level <= 0.001) continue;
      const P = s.bake.count;
      const f0 = Math.floor(s.level), f1 = Math.min(f0 + 1, this.frames - 1);
      const t = s.level - f0;
      const a = f0 * P * 4, b = f1 * P * 4;
      for (let k = 0; k < P; k++) {
        const i = s.bake.verts[k];
        x[i * 3] += s.bake.pos[a + k * 4] * (1 - t) + s.bake.pos[b + k * 4] * t;
        x[i * 3 + 1] += s.bake.pos[a + k * 4 + 1] * (1 - t) + s.bake.pos[b + k * 4 + 1] * t;
        x[i * 3 + 2] += s.bake.pos[a + k * 4 + 2] * (1 - t) + s.bake.pos[b + k * 4 + 2] * t;
      }
    }
    return x;
  }

  /** Total damage 0..1 across the body, for the HUD. */
  damage(): number {
    let d = 0;
    for (const s of this.sites) d += s.level / (this.frames - 1);
    return clamp(d / 3, 0, 1);
  }

  reset(): void {
    for (const s of this.sites) { s.level = 0; s.target = 0; s.vel = 0; }
    for (const l of this.lamps) l.broken = false;
    this.crush = 0;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export { add, sub, mul, norm, dot, v3 };
export type { DentSite };
