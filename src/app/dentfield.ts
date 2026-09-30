/**
 * Runtime dent instances.
 *
 * A dent is not geometry here, it is six numbers: where it is, which way its
 * tangent frame points, which baked dent type it is, how big it is scaled, and
 * how far along the baked damage sequence it has been driven. The vertex
 * shader does the rest. That means:
 *
 *   - arbitrary hit positions (no per-site bake, no snapping),
 *   - unlimited hits (the oldest/shallowest instance is recycled),
 *   - the same 2.5 MB bake drives every panel on every vehicle,
 *   - repeat hits in the same place deepen the existing dent instead of
 *     stacking a second one, which is what actually happens to metal.
 */

import { V3, v3, add, sub, mul, norm, dot, len, cross, clamp, rng } from '../core/math';
import { DentAtlas, DENT_TYPES } from '../frac/dentmap';

export interface DentInstance {
  p: V3;                 // contact point, object space
  t: V3; b: V3; n: V3;   // tangent frame (n = outward surface normal)
  type: number;
  scale: number;
  /** cursor along the baked damage sequence, in frames */
  level: number;
  target: number;
  vel: number;
  age: number;
}

export const MAX_DENTS = 8;

export class DentField {
  items: DentInstance[] = [];
  rand = rng(1234);
  /** energy that drives a dent to full depth [J] */
  fullEnergy = 5200;

  constructor(public atlas: DentAtlas) {}

  get frames(): number { return this.atlas.frames; }

  /**
   * Choose the baked impactor that best matches the blow.
   *
   * The energy threshold is really a threshold on whether anything BEHIND the
   * panel gave way. Below it the panel is still supported all round, so the
   * sheet has to stretch to go anywhere and the result is a smooth dish. Above
   * it the surrounding structure collapses, sheet gets fed into the damaged
   * area, and it crumples into facets.
   */
  private pickType(energy: number): number {
    if (energy < 1400) return 0;           // dish: trolley, knee, hail
    if (energy < 8000) return 1;           // crush: pole, another car's corner
    return 2;                              // fold: beam contact, bonnet buckle
  }

  /**
   * Stamp a dent at a surface point. `n` is the outward surface normal there,
   * `dir` the direction the impactor was travelling.
   */
  add(p: V3, n: V3, dir: V3, energy: number): DentInstance {
    const type = this.pickType(energy);
    const ty = this.atlas.types[type];
    const facing = clamp(-dot(norm(dir), n), 0.15, 1);       // glancing blows do less
    const scale = clamp(0.72 + Math.log10(Math.max(energy, 10)) * 0.115, 0.68, 1.26);
    const adv = (this.frames - 1) * clamp(energy / this.fullEnergy, 0.06, 1.1) * facing;

    // Repeat hits in roughly the same place deepen the existing dent.
    for (const d of this.items) {
      if (d.type !== type) continue;
      if (len(sub(p, d.p)) < ty.half * d.scale * 0.42 && dot(d.n, n) > 0.7) {
        d.target = clamp(d.target + adv * 0.75, 0, this.frames - 1.001);
        d.vel += adv * 6;
        d.age = 0;
        return d;
      }
    }

    // random roll about the normal, so repeated dents never look cloned
    const up = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    let t = norm(cross(up, n));
    const a = this.rand() * Math.PI * 2;
    const bt = cross(n, t);
    t = norm(add(mul(t, Math.cos(a)), mul(bt, Math.sin(a))));
    const b = cross(n, t);

    const inst: DentInstance = {
      p, t, b, n: norm(n), type, scale,
      level: 0, target: clamp(adv, 0, this.frames - 1.001), vel: adv * 6, age: 0,
    };
    if (this.items.length >= MAX_DENTS) {
      // recycle the shallowest old dent
      let worst = 0, ws = 1e9;
      for (let i = 0; i < this.items.length; i++) {
        const s = this.items[i].target - this.items[i].age * 0.25;
        if (s < ws) { ws = s; worst = i; }
      }
      this.items[worst] = inst;
    } else {
      this.items.push(inst);
    }
    return inst;
  }

  /** Metal booms in and settles rather than snapping to its final shape. */
  update(dt: number): void {
    for (const d of this.items) {
      d.age += dt;
      if (d.level === d.target && Math.abs(d.vel) < 1e-4) continue;
      const k = 300, c = 17;
      d.vel += (d.target - d.level) * k * dt - d.vel * c * dt;
      d.level = clamp(d.level + d.vel * dt, 0, this.frames - 1.001);
      if (Math.abs(d.target - d.level) < 1e-3 && Math.abs(d.vel) < 1e-3) {
        d.level = d.target; d.vel = 0;
      }
    }
  }

  clear(): void { this.items.length = 0; }

  /** Pack the instance list into the four vec4 uniform arrays the shader wants. */
  pack(A: Float32Array, B: Float32Array, C: Float32Array, D: Float32Array): number {
    const nInst = Math.min(this.items.length, MAX_DENTS);
    for (let i = 0; i < nInst; i++) {
      const d = this.items[i];
      const half = this.atlas.types[d.type].half * d.scale;
      A[i * 4] = d.p.x; A[i * 4 + 1] = d.p.y; A[i * 4 + 2] = d.p.z; A[i * 4 + 3] = 1 / half;
      B[i * 4] = d.t.x; B[i * 4 + 1] = d.t.y; B[i * 4 + 2] = d.t.z; B[i * 4 + 3] = d.level;
      C[i * 4] = d.b.x; C[i * 4 + 1] = d.b.y; C[i * 4 + 2] = d.b.z; C[i * 4 + 3] = d.type;
      D[i * 4] = d.n.x; D[i * 4 + 1] = d.n.y; D[i * 4 + 2] = d.n.z; D[i * 4 + 3] = d.scale;
    }
    return nInst;
  }

  /**
   * CPU mirror of the vertex shader's stamp (see DEFORM_GLSL/applyDents).
   * Used by the headless tests, and it is what you would call to push the
   * damage into collision proxies or to query "how deep is the dent here".
   */
  sample(p: V3): { d: V3; dmg: number } {
    const a = this.atlas;
    const R = a.res, F = a.frames;
    const out = v3(); let dmg = 0;
    for (const inst of this.items) {
      const half = a.types[inst.type].half * inst.scale;
      const r = sub(p, inst.p);
      const u = dot(r, inst.t) / half, v = dot(r, inst.b) / half;
      if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      if (Math.abs(dot(r, inst.n)) > half * 0.55) continue;
      const f0 = Math.floor(inst.level), f1 = Math.min(f0 + 1, F - 1);
      const tt = inst.level - f0;
      const fx = (u * 0.5 + 0.5) * (R - 1), fy = (v * 0.5 + 0.5) * (R - 1);
      const i0 = Math.floor(fx), j0 = Math.floor(fy);
      const wx = fx - i0, wy = fy - j0;
      const tex = (f: number, i: number, j: number, c: number) => {
        const ii = clamp(i, 0, R - 1), jj = clamp(j, 0, R - 1);
        return a.pos[((inst.type * F + f) * R * R + jj * R + ii) * 4 + c];
      };
      const bil = (f: number, c: number) =>
        (tex(f, i0, j0, c) * (1 - wx) + tex(f, i0 + 1, j0, c) * wx) * (1 - wy) +
        (tex(f, i0, j0 + 1, c) * (1 - wx) + tex(f, i0 + 1, j0 + 1, c) * wx) * wy;
      const d0 = [0, 1, 2, 3].map((c) => bil(f0, c) * (1 - tt) + bil(f1, c) * tt);
      const disp = add(add(mul(inst.t, d0[0]), mul(inst.b, d0[1])), mul(inst.n, d0[2]));
      out.x += disp.x * inst.scale; out.y += disp.y * inst.scale; out.z += disp.z * inst.scale;
      dmg = Math.max(dmg, d0[3]);
    }
    return { d: out, dmg };
  }

  /** Deepest damage on the body, 0..1. */
  worst(): number {
    let m = 0;
    for (const d of this.items) m = Math.max(m, d.level / (this.frames - 1));
    return m;
  }

  describe(): string {
    if (!this.items.length) return 'none';
    const byType = new Map<number, number>();
    for (const d of this.items) byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
    return [...byType.entries()]
      .map(([t, c]) => `${c}× ${DENT_TYPES[t].label.split(' ')[0]}`).join(', ');
  }
}
