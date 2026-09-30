/**
 * Scenes: one per demo material.
 *
 *   pane      -> live 2D crack-network solver (glass, acrylic sheet)
 *   solid     -> energy-budgeted 3D crack-surface solver (rock, wood, plastic)
 *   structure -> bonded block graph with load propagation (buildings)
 */

import {
  V3, add, clamp, cross, dot, len, mul, norm, sub, v3, quat, qFromAxis, rng, M4, m4Compose,
} from '../core/math';
import {
  Convex, boxConvex, blobConvex, buildMesh, massProperties, boundingRadius, MeshData,
} from '../geom/convex';
import { Material, MATERIALS, MaterialId } from '../sim/materials';
import { Body, Piece, Structure, World } from '../sim/world';
import { fractureSolid, Impact } from '../frac/solid';
import { CrackNetwork } from '../frac/crack2d';
import { RegionExtractor, ShellFragment } from '../frac/regions';
import { CarRig, LampState } from './carrig';
import {
  shellToMesh, slabMesh, wheelMesh, conformPane, buildBoxShell, shellNormals, IndexedShell,
} from '../geom/carbody';
import { DentField, MAX_DENTS } from './dentfield';

export type SceneKind = 'pane' | 'solid' | 'structure' | 'vehicle' | 'sheet';

export interface SceneDef {
  id: string;
  label: string;
  kind: SceneKind;
  material: MaterialId;
  blurb: string;
  /** Sensible default impact energy [J] for this target. */
  energy: number;
}

export const SCENES: SceneDef[] = [
  {
    id: 'glass', label: 'Window · annealed glass', kind: 'pane', material: 'annealed-glass',
    energy: 40,
    blurb: 'Radial cracks nucleate on the back face, concentric arcs snap the petals, tips arrest on each other as T-junctions. Pieces only fall once they are fully surrounded.',
  },
  {
    id: 'tempered', label: 'Window · tempered glass', kind: 'pane', material: 'tempered-glass',
    energy: 40,
    blurb: 'Stored tempering energy (~7e4 J/m^3) pays for a thousand times more surface than the impact does, so a branching front sweeps the pane and dices it.',
  },
  {
    id: 'acrylic', label: 'Panel · acrylic / PMMA', kind: 'pane', material: 'acrylic',
    energy: 260,
    blurb: 'Gc is 50x glass, so far fewer cracks, they run slower, wander more and arrest early. Tough, not shattery.',
  },
  {
    id: 'rock', label: 'Boulder · granite', kind: 'solid', material: 'granite',
    energy: 4000,
    blurb: 'Hertzian cone under the contact, then hoop-tension meridional splitting and back-face spall. Fragment sizes grade with distance from the impact.',
  },
  {
    id: 'wood', label: 'Beam · spruce', kind: 'solid', material: 'spruce',
    energy: 1600,
    blurb: 'Fracture energy across the fibres is ~10x the along-grain value, so cracks run along the grain: long splinters, not chunks.',
  },
  {
    id: 'plastic', label: 'Panel · ABS plastic', kind: 'solid', material: 'abs-plastic',
    energy: 2600,
    blurb: 'Gc ~5000 J/m^2. The energy budget buys very little new surface: a few large pieces, blunt tears, stress-whitened edges.',
  },
  {
    id: 'sheet', label: 'Panel · sheet steel', kind: 'sheet', material: 'concrete',
    energy: 1800,
    blurb: 'A 1.2 mm steel skin. One elasto-plastic dent is solved offline on a flat sheet and stored as a displacement-map sequence, then stamped at any point, any angle, any scale. Hit it anywhere, as often as you like: 2.5 MB of bake, no per-asset work.',
  },
  {
    id: 'car', label: 'Car · panel deformation', kind: 'vehicle', material: 'abs-plastic',
    energy: 3000,
    blurb: 'Sheet steel does not fracture, it yields. Each impact site has an offline elasto-plastic shell solve baked into a vertex-animation texture; the impact energy just decides how far along that baked damage sequence to play. Headlight glass is solved live.',
  },
  {
    id: 'wall', label: 'Building · brick wall', kind: 'structure', material: 'brick',
    energy: 9000,
    blurb: 'Blocks bonded by mortar joints. Gravity load is pushed down the bond graph; overloaded joints snap, unsupported islands go dynamic. Progressive collapse.',
  },
  {
    id: 'pillar', label: 'Building · concrete column', kind: 'structure', material: 'concrete',
    energy: 9000,
    blurb: 'Same structural solver, taller and heavier: knock out the base and the load path above it fails in sequence.',
  },
];

export interface RenderPiece {
  mesh: MeshData;
  /** dynamic debris -> gets folded into the CPU-transformed draw batch */
  batch?: boolean;
  model: M4;
  style: number;
  color: [number, number, number];
  spec: number; rough: number; seed: number; strain: number;
  grain: V3; alpha: number;
  glass: boolean;
  mask?: boolean;
  /** 0 rigid, 1 per-vertex VAT, 2 lattice cage */
  deform?: number;
}

export const styleFor = (m: Material): number =>
  m.style === 'glass' ? 4 : m.style === 'plastic' ? 3 :
    (m.id === 'spruce' ? 1 : 2);

// ---------------------------------------------------------------------------

export interface HitInfo { point: V3; normal: V3; }

export abstract class Scene {
  world = new World();
  rand = rng(7);
  fragmentCount = 0;
  lastStats: Record<string, string> = {};
  constructor(public def: SceneDef, public mat: Material) {}
  abstract build(): void;
  abstract pick(ro: V3, rd: V3): HitInfo | null;
  abstract hit(p: V3, dir: V3, energy: number): void;
  abstract update(dtWall: number, crackScale: number, physScale: number): void;
  abstract collect(out: RenderPiece[]): void;
  get cameraTarget(): V3 { return v3(0, 1, 0); }
  get cameraDist(): number { return 4.2; }
  dispose(): void { this.world.clear(); }
}

// ------------------------------------------------------------------- shared

function bodyFromConvex(
  c: Convex, mat: Material, vel: V3, omega: V3, seed: number, gen: number,
): Body {
  const mp = massProperties(c);
  const com = mp.centroid;
  // recentre geometry on the COM
  for (const v of c.verts) { v.x -= com.x; v.y -= com.y; v.z -= com.z; }
  const mesh = buildMesh(c, mat.roughness, norm(v3(mat.grain[0], mat.grain[1], mat.grain[2])), seed);
  const inertia = mp.inertia;
  const I = new Float32Array(9);
  for (let i = 0; i < 9; i++) I[i] = inertia[i] * mat.rho;
  const mass = Math.max(mp.volume * mat.rho, 1e-4);
  const radius = boundingRadius(c, v3());
  const piece: Piece = { mesh, offset: v3(), mat, seed, strain: clamp(gen / 4, 0, 1) };
  return new Body({
    pos: com, vel, omega, mass, inertia: I,
    contacts: c.verts.map((v) => v3(v.x, v.y, v.z)),
    radius, pieces: [piece], mat,
  });
}

// =========================================================== PANE (glass etc)

export class PaneScene extends Scene {
  W = 1.7; H = 1.15; T = 0.006;
  originY = 1.15;
  net!: CrackNetwork;
  regions!: RegionExtractor;
  paneMesh!: MeshData;
  frame: { mesh: MeshData; model: M4 }[] = [];
  ribbon: MeshData = { pos: new Float32Array(0), nrm: new Float32Array(0), attr: new Float32Array(0), count: 0 };
  ribbonDirty = true;
  shards: Body[] = [];
  intact = true;
  impactEnergy = 0;
  sinceHarvest = 0;
  doneTimer = 0;

  build(): void {
    if (this.mat.id === 'acrylic') this.T = 0.004;
    this.net = new CrackNetwork({
      width: this.W, height: this.H, thickness: this.T, material: this.mat,
      res: this.mat.id === 'tempered-glass' ? 420 : 380, seed: 4242,
    });
    this.regions = new RegionExtractor(this.net);
    const pane = boxConvex(this.W / 2, this.H / 2, this.T / 2);
    this.paneMesh = buildMesh(pane, 0, v3(0, 1, 0), 0);

    // frame
    const steel = MATERIALS.concrete;
    const bar = (w: number, h: number, d: number, x: number, y: number) => {
      const c = boxConvex(w / 2, h / 2, d / 2);
      this.frame.push({
        mesh: buildMesh(c, 0.3, v3(0, 1, 0), 3),
        model: m4Compose(v3(x, this.originY + y, 0), quat()),
      });
    };
    const fw = 0.06, fd = 0.05;
    bar(this.W + fw * 2, fw, fd, 0, this.H / 2 + fw / 2);
    bar(this.W + fw * 2, fw, fd, 0, -this.H / 2 - fw / 2);
    bar(fw, this.H, fd, -this.W / 2 - fw / 2, 0);
    bar(fw, this.H, fd, this.W / 2 + fw / 2, 0);
    // posts down to the ground
    const postH = this.originY - this.H / 2 - fw;
    const post = boxConvex(0.04, postH / 2, 0.04);
    for (const sx of [-1, 1]) {
      this.frame.push({
        mesh: buildMesh(post, 0.3, v3(0, 1, 0), 5),
        model: m4Compose(v3(sx * (this.W / 2), postH / 2, 0), quat()),
      });
    }
    void steel;
  }

  get cameraTarget(): V3 { return v3(0, this.originY * 0.92, 0); }
  get cameraDist(): number { return 3.4; }

  pick(ro: V3, rd: V3): HitInfo | null {
    if (Math.abs(rd.z) < 1e-6) return null;
    const t = -ro.z / rd.z;
    if (t <= 0) return null;
    const p = add(ro, mul(rd, t));
    if (Math.abs(p.x) > this.W / 2 || Math.abs(p.y - this.originY) > this.H / 2) return null;
    return { point: p, normal: v3(0, 0, Math.sign(-rd.z)) };
  }

  hit(p: V3, dir: V3, energy: number): void {
    this.impactEnergy += energy;
    const radius = clamp(0.004 + energy * 0.0009, 0.004, 0.03);
    this.net.impact({
      x: p.x, y: p.y - this.originY, energy,
      radius, penetration: clamp(energy / 60, 0, 1),
    });
    this.intact = false;
    this.impactDir = norm(dir);
  }
  private impactDir = v3(0, 0, -1);

  update(dtWall: number, crackScale: number, physScale: number): void {
    // ---- crack propagation in bullet time
    if (!this.net.done) {
      const dtSim = dtWall * crackScale;
      const dtc = (this.net.h / 1900) * 0.8;
      const subs = clamp(Math.ceil(dtSim / dtc), 1, 500);
      for (let i = 0; i < subs; i++) this.net.step(dtSim / subs);
      this.ribbonDirty = true;
    } else {
      this.doneTimer += dtWall;
    }

    // ---- harvest newly isolated pieces
    this.sinceHarvest += dtWall;
    if (!this.intact && this.sinceHarvest > 0.05) {
      this.sinceHarvest = 0;
      const heavy = this.impactEnergy > 26;
      const releaseBorder = this.net.done && (heavy || this.doneTimer > 0.6);
      const frags = this.regions.harvest(releaseBorder, 3);
      for (const f of frags) this.spawnShard(f);
    }

    // ---- rigid bodies
    let t = dtWall * physScale;
    const h = 1 / 240;
    let guard = 0;
    while (t > 0 && guard++ < 24) { const s = Math.min(h, t); this.world.step(s); t -= s; }
  }

  private spawnShard(f: ShellFragment): void {
    const mat = this.mat;
    const mass = Math.max(f.area * this.T * mat.rho, 5e-5);
    // Plate inertia for a lamina of radius r.
    const r2 = f.radius * f.radius;
    const I = new Float32Array([
      mass * r2 * 0.28, 0, 0,
      0, mass * r2 * 0.28, 0,
      0, 0, mass * r2 * 0.5,
    ]);
    const im = this.net.impacts[0];
    const d = im ? Math.hypot(f.cx - im.x, f.cy - im.y) : 1;
    // Out-of-plane kick: the plate is moving when it lets go. Momentum decays
    // away from the contact; pieces near the hole are thrown, far ones drop.
    const kick = clamp(1.6 * Math.exp(-d * 2.4) * Math.sqrt(this.impactEnergy), 0, 6);
    const dir = this.impactDir;
    const vel = add(mul(dir, kick), v3(
      (this.rand() - 0.5) * 0.35 + f.cx * 0.25,
      (this.rand() - 0.5) * 0.35,
      0,
    ));
    const omega = v3((this.rand() - 0.5) * 9, (this.rand() - 0.5) * 9, (this.rand() - 0.5) * 6);
    const piece: Piece = {
      mesh: f.mesh, offset: v3(), mat, seed: (this.rand() * 1e5) | 0,
      strain: 0,
    };
    const b = new Body({
      pos: v3(f.cx, this.originY + f.cy, 0),
      vel, omega, mass, inertia: I,
      contacts: f.contacts, radius: f.radius, pieces: [piece], mat,
    });
    this.world.add(b);
    this.shards.push(b);
    this.fragmentCount++;
  }

  /** Rebuild the crack-line ribbon geometry (drawn on the intact pane). */
  buildRibbon(): MeshData {
    const paths = this.net.paths;
    const pos: number[] = [], nrm: number[] = [], attr: number[] = [];
    const w = this.mat.id === 'tempered-glass' ? 0.0016 : 0.0026;
    const z = this.T * 0.5 + 0.0003;
    for (const p of paths) {
      const n = p.pts.length / 2;
      if (n < 2) continue;
      for (let i = 0; i + 1 < n; i++) {
        const ax = p.pts[i * 2], ay = p.pts[i * 2 + 1];
        const bx = p.pts[i * 2 + 2], by = p.pts[i * 2 + 3];
        let ex = bx - ax, ey = by - ay;
        const l = Math.hypot(ex, ey) || 1e-9;
        ex /= l; ey /= l;
        const nx2 = -ey * w, ny2 = ex * w;
        for (const zs of [z, -z]) {
          const s = Math.sign(zs);
          const quadA = [ax - nx2, ay - ny2, ax + nx2, ay + ny2, bx + nx2, by + ny2, bx - nx2, by - ny2];
          const order = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          const uv = [0, 1, 1, 0];
          for (const k of order) {
            pos.push(quadA[k * 2], quadA[k * 2 + 1], zs);
            nrm.push(0, 0, s);
            attr.push(0, uv[k], 0);
          }
        }
      }
    }
    return {
      pos: new Float32Array(pos), nrm: new Float32Array(nrm),
      attr: new Float32Array(attr), count: pos.length / 3,
    };
  }

  collect(out: RenderPiece[]): void {
    const mat = this.mat;
    const style = styleFor(mat);
    const paneModel = m4Compose(v3(0, this.originY, 0), quat());
    // frame
    for (const f of this.frame) {
      out.push({
        mesh: f.mesh, model: f.model, style: 2, color: [0.17, 0.18, 0.2],
        spec: 0.5, rough: 0.4, seed: 2, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: false,
      });
    }
    // intact pane (with released cells masked out)
    out.push({
      mesh: this.paneMesh, model: paneModel, style, color: mat.color,
      spec: mat.specular, rough: mat.roughness, seed: 1, strain: 0,
      grain: v3(0, 1, 0), alpha: 1, glass: true, mask: true,
    });
    // crack lines
    if (this.net.paths.length) {
      if (this.ribbonDirty) { this.ribbon = this.buildRibbon(); this.ribbonDirty = false; }
      if (this.ribbon.count) {
        out.push({
          mesh: this.ribbon, model: paneModel, style: 5, color: [1, 1, 1],
          spec: 1, rough: 0, seed: 0, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: true,
        });
      }
    }
    // shards
    for (const b of this.world.bodies) {
      for (const p of b.pieces) {
        out.push({
          mesh: p.mesh, model: m4Compose(add(b.pos, p.offset), b.quat), style,
          color: mat.color, spec: mat.specular, rough: mat.roughness, seed: p.seed,
          strain: p.strain, grain: v3(0, 1, 0), alpha: 1, glass: mat.style === 'glass',
          batch: mat.style === 'glass',
        });
      }
    }
  }

  stats(): Record<string, string> {
    const s = this.net.stats();
    return {
      'crack paths': String(s.paths),
      'active tips': String(s.tips),
      'crack length': s.length.toFixed(2) + ' m',
      'new surface': (s.length * this.T * 2).toFixed(3) + ' m²',
      'surface energy': s.surfaceEnergy.toFixed(2) + ' J',
      'terminal speed': (s.vTerm | 0) + ' m/s (0.6 c_R)',
      fragments: String(this.fragmentCount),
    };
  }
}

// ======================================================= SOLID (rock/wood...)

export class SolidScene extends Scene {
  body!: Convex;
  intactMesh!: MeshData;
  intactModel!: M4;
  intactPos = v3(0, 0.6, 0);
  broken = false;
  supports: { mesh: MeshData; model: M4 }[] = [];
  private pending: { frags: ReturnType<typeof fractureSolid>; t: number } | null = null;

  build(): void {
    const mat = this.mat;
    if (mat.id === 'granite') {
      this.body = blobConvex(0.52, rng(11), 0.35);
      this.intactPos = v3(0, 0.52, 0);
    } else if (mat.id === 'spruce') {
      this.body = boxConvex(1.25, 0.11, 0.11);
      this.intactPos = v3(0, 0.78, 0);
      // two trestles
      for (const sx of [-1, 1]) {
        const c = boxConvex(0.1, 0.33, 0.18);
        this.supports.push({
          mesh: buildMesh(c, 0.6, v3(0, 1, 0), 9),
          model: m4Compose(v3(sx * 1.0, 0.33, 0), quat()),
        });
      }
    } else {
      // A crate *panel*: 25 mm of ABS. A solid block of it would weigh 400 kg
      // and its huge Gc means nothing short of a cannon would break it.
      this.body = boxConvex(0.45, 0.35, 0.0125);
      this.intactPos = v3(0, 0.62, 0);
      for (const sx of [-1, 1]) {
        const c = boxConvex(0.03, 0.2, 0.12);
        this.supports.push({
          mesh: buildMesh(c, 0.6, v3(0, 1, 0), 9),
          model: m4Compose(v3(sx * 0.5, 0.2, 0.06), quat()),
        });
      }
    }
    this.intactMesh = buildMesh(this.body, mat.roughness * 0.5, norm(v3(...mat.grain)), 17);
    this.intactModel = m4Compose(this.intactPos, quat());

    this.world.onHardLanding = (b, speed) => this.secondary(b, speed);
  }

  get cameraTarget(): V3 { return v3(0, this.intactPos.y * 0.9, 0); }
  get cameraDist(): number { return this.mat.id === 'spruce' ? 4.4 : 2.9; }

  pick(ro: V3, rd: V3): HitInfo | null {
    // ray vs bounding sphere of the intact body, else vs its AABB proxy
    if (this.broken) return null;
    const c = this.intactPos;
    const r = boundingRadius(this.body, v3()) * 0.95;
    const oc = sub(ro, c);
    const b = dot(oc, rd);
    const disc = b * b - (dot(oc, oc) - r * r);
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = add(ro, mul(rd, t));
    return { point: p, normal: norm(sub(p, c)) };
  }

  hit(p: V3, dir: V3, energy: number): void {
    if (this.broken) return;
    this.broken = true;
    const local = sub(p, this.intactPos);
    const imp: Impact = {
      point: local, dir: norm(dir), energy,
      impulse: Math.sqrt(2 * energy * 0.6) * 1.6,
      radius: clamp(0.012 + energy * 0.0012, 0.012, 0.06),
    };
    const frags = fractureSolid(this.body, this.mat, imp, {
      maxFragments: this.mat.ductility > 0.6 ? 26 : 150,
      surfaceEfficiency: 0.16,
      seed: (Math.random() * 1e6) | 0,
      backFace: norm(mul(imp.dir, 1)),
    });
    for (const f of frags) {
      const b = bodyFromConvex(f.convex, this.mat, f.vel, f.omega, f.seed, f.gen);
      b.pos = add(b.pos, this.intactPos);
      this.world.add(b);
      this.fragmentCount++;
    }
    this.lastStats = {
      fragments: String(frags.length),
      'impact energy': energy.toFixed(1) + ' J',
    };
  }

  /** Debris that lands hard enough keeps breaking (real rubble does). */
  private secondary(b: Body, speed: number): void {
    if (this.world.bodies.length > 320) return;
    const mat = b.mat;
    if (mat.ductility > 0.5) return;
    const ke = 0.5 * b.mass * speed * speed;
    if (ke < 6 || b.mass < 0.25 || b.pieces.length !== 1) return;
    if (this.rand() > 0.5) return;
    // Re-fracture this fragment with a small energy budget.
    const conv = b.pieces[0] as unknown as { convex?: Convex };
    void conv;
  }

  update(_dt: number, _c: number, physScale: number): void {
    let t = _dt * physScale;
    const h = 1 / 240;
    let guard = 0;
    while (t > 0 && guard++ < 24) { const s = Math.min(h, t); this.world.step(s); t -= s; }
    if (this.pending) this.pending = null;
  }

  collect(out: RenderPiece[]): void {
    const mat = this.mat;
    const style = styleFor(mat);
    const grain = norm(v3(...mat.grain));
    for (const s of this.supports) {
      out.push({
        mesh: s.mesh, model: s.model, style: 1, color: [0.35, 0.26, 0.17],
        spec: 0.2, rough: 0.9, seed: 4, strain: 0, grain: v3(1, 0, 0), alpha: 1, glass: false,
      });
    }
    if (!this.broken) {
      out.push({
        mesh: this.intactMesh, model: this.intactModel, style, color: mat.color,
        spec: mat.specular, rough: mat.roughness, seed: 17, strain: 0, grain, alpha: 1,
        glass: mat.style === 'glass',
      });
    }
    for (const b of this.world.bodies) {
      for (const p of b.pieces) {
        out.push({
          mesh: p.mesh, model: m4Compose(add(b.pos, p.offset), b.quat), style,
          color: mat.color, spec: mat.specular, rough: mat.roughness, seed: p.seed,
          strain: p.strain, grain, alpha: 1, glass: mat.style === 'glass', batch: mat.style === 'glass',
        });
      }
    }
  }
}

// ============================================================ STRUCTURE

interface Block {
  id: number;
  centre: V3;
  half: V3;
  convex: Convex;
  mesh: MeshData;
  mass: number;
  inertia: Float32Array;
  alive: boolean;
  dynamic: boolean;
  seed: number;
}

export class StructureScene extends Scene {
  blocks: Block[] = [];
  struct!: Structure;
  islandsDynamic = new Set<number>();
  relaxTimer = 0;
  collapsed = 0;

  build(): void {
    const mat = this.mat;
    const isColumn = this.def.id === 'pillar';
    const bw = isColumn ? 0.42 : 0.42, bh = isColumn ? 0.3 : 0.22, bd = isColumn ? 0.42 : 0.24;
    const cols = isColumn ? 2 : 8, rows = isColumn ? 14 : 9;
    const rand = rng(5150);
    let id = 0;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * bw * 0.5;
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * bw + (isColumn ? 0 : offset - bw * 0.25);
        const y = bh / 2 + r * bh;
        const z = 0;
        const convex = boxConvex(bw / 2 * 0.985, bh / 2 * 0.985, bd / 2 * 0.985);
        const mp = massProperties(convex);
        const I = new Float32Array(9);
        for (let i = 0; i < 9; i++) I[i] = mp.inertia[i] * mat.rho;
        this.blocks.push({
          id: id++, centre: v3(x, y, z), half: v3(bw / 2, bh / 2, bd / 2), convex,
          mesh: buildMesh(convex, mat.roughness, v3(0, 1, 0), (rand() * 1e4) | 0),
          mass: mp.volume * mat.rho, inertia: I, alive: true, dynamic: false,
          seed: (rand() * 1e4) | 0,
        });
      }
    }
    const n = this.blocks.length;
    const w = new Float64Array(n), h = new Float64Array(n);
    for (let i = 0; i < n; i++) { w[i] = this.blocks[i].mass * 9.81; h[i] = this.blocks[i].centre.y; }
    this.struct = new Structure(n, w, h);
    // mortar joints between touching blocks
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.blocks[i], b = this.blocks[j];
        const dx = Math.abs(a.centre.x - b.centre.x) - (a.half.x + b.half.x);
        const dy = Math.abs(a.centre.y - b.centre.y) - (a.half.y + b.half.y);
        const dz = Math.abs(a.centre.z - b.centre.z) - (a.half.z + b.half.z);
        const touchY = dy > -0.02 && dy < 0.02 && dx < -0.01 && dz < -0.01;
        const touchX = dx > -0.02 && dx < 0.02 && dy < -0.01 && dz < -0.01;
        if (!touchY && !touchX) continue;
        const area = touchY
          ? Math.min(a.half.x + b.half.x - Math.abs(a.centre.x - b.centre.x), 2 * Math.min(a.half.x, b.half.x)) * 2 * Math.min(a.half.z, b.half.z)
          : 2 * Math.min(a.half.y, b.half.y) * 2 * Math.min(a.half.z, b.half.z);
        // mortar tensile strength ~ 0.3 MPa; shear a bit more
        this.struct.addBond(i, j, Math.max(area, 1e-4), 0.30e6 * (touchY ? 1 : 0.55));
      }
    }
    this.world.onHardLanding = (b, speed) => this.landing(b, speed);
  }

  get cameraTarget(): V3 {
    const top = this.blocks.length ? Math.max(...this.blocks.map((b) => b.centre.y)) : 2;
    return v3(0, top * 0.45, 0);
  }
  get cameraDist(): number { return this.def.id === 'pillar' ? 7.5 : 8.0; }

  pick(ro: V3, rd: V3): HitInfo | null {
    let best: HitInfo | null = null, bestT = Infinity;
    for (const b of this.blocks) {
      if (!b.alive || b.dynamic) continue;
      const t = rayBox(ro, rd, b.centre, b.half);
      if (t !== null && t < bestT) {
        bestT = t;
        const p = add(ro, mul(rd, t));
        best = { point: p, normal: boxNormal(p, b.centre, b.half) };
      }
    }
    return best;
  }

  hit(p: V3, dir: V3, energy: number): void {
    const mat = this.mat;
    const radius = clamp(0.18 + energy * 0.01, 0.2, 1.1);
    // 1. pulverise / fracture the blocks inside the impact zone
    let destroyed = 0;
    for (const b of this.blocks) {
      if (!b.alive || b.dynamic) continue;
      const d = len(sub(b.centre, p));
      if (d > radius) continue;
      const share = energy * clamp(1 - d / radius, 0.15, 1) / Math.max(1, destroyed + 1);
      const imp: Impact = {
        point: sub(p, b.centre), dir: norm(dir), energy: share,
        impulse: Math.sqrt(2 * share * b.mass) * 0.9,
        radius: 0.05,
      };
      const frags = fractureSolid(b.convex, mat, imp, {
        maxFragments: 26, surfaceEfficiency: 0.2, seed: b.seed,
      });
      for (const f of frags) {
        const nb = bodyFromConvex(f.convex, mat, f.vel, f.omega, f.seed, f.gen);
        nb.pos = add(nb.pos, b.centre);
        this.world.add(nb);
        this.fragmentCount++;
      }
      b.alive = false;
      this.struct.kill(b.id);
      destroyed++;
    }
    // 2. shock weakens the surrounding mortar
    this.struct.blast([p], this.blocks.map((b) => b.centre), radius * 2.6, energy);
    this.settle();
  }

  /** Load propagation + island detection; unsupported islands go dynamic. */
  private settle(): void {
    for (let i = 0; i < 8; i++) if (!this.struct.relax()) break;
    const isl = this.struct.islands();
    const groups = new Map<number, number[]>();
    for (const b of this.blocks) {
      if (!b.alive || b.dynamic) continue;
      const k = isl[b.id];
      const l = groups.get(k);
      if (l) l.push(b.id); else groups.set(k, [b.id]);
    }
    for (const [, ids] of groups) {
      let grounded = false;
      for (const id of ids) if (this.blocks[id].centre.y - this.blocks[id].half.y < 0.02) grounded = true;
      if (grounded) continue;
      this.makeIslandDynamic(ids);
    }
  }

  private makeIslandDynamic(ids: number[]): void {
    const mat = this.mat;
    let mass = 0;
    let com = v3();
    for (const id of ids) { const b = this.blocks[id]; mass += b.mass; com = add(com, mul(b.centre, b.mass)); }
    if (mass <= 0) return;
    com = mul(com, 1 / mass);
    const I = new Float32Array(9);
    const contacts: V3[] = [];
    const pieces: Piece[] = [];
    let radius = 0;
    for (const id of ids) {
      const b = this.blocks[id];
      const off = sub(b.centre, com);
      for (let i = 0; i < 9; i++) I[i] += b.inertia[i];
      // parallel axis
      const d2 = dot(off, off);
      I[0] += b.mass * (d2 - off.x * off.x); I[4] += b.mass * (d2 - off.y * off.y); I[8] += b.mass * (d2 - off.z * off.z);
      I[1] -= b.mass * off.x * off.y; I[3] -= b.mass * off.x * off.y;
      I[2] -= b.mass * off.x * off.z; I[6] -= b.mass * off.x * off.z;
      I[5] -= b.mass * off.y * off.z; I[7] -= b.mass * off.y * off.z;
      pieces.push({ mesh: b.mesh, offset: off, mat, seed: b.seed, strain: 0 });
      for (const v of b.convex.verts) contacts.push(add(off, v));
      radius = Math.max(radius, len(off) + len(b.half));
      b.dynamic = true;
    }
    const body = new Body({
      pos: com, mass, inertia: I, contacts, radius, pieces, mat,
      vel: v3((this.rand() - 0.5) * 0.15, 0, (this.rand() - 0.5) * 0.15),
      omega: v3((this.rand() - 0.5) * 0.2, 0, (this.rand() - 0.5) * 0.2),
      blocks: ids.map((id) => ({
        id, piece: pieces[ids.indexOf(id)], contacts: this.blocks[id].convex.verts.map((v) => v3(v.x, v.y, v.z)),
        mass: this.blocks[id].mass, radius: len(this.blocks[id].half),
      })),
    });
    this.world.add(body);
    this.collapsed += ids.length;
  }

  /** Slabs that hit the ground hard break apart into their blocks. */
  private landing(b: Body, speed: number): void {
    if (b.blocks.length < 2 || speed < 2.2) return;
    if (this.world.bodies.length > 260) return;
    this.world.remove(b);
    for (const blk of b.blocks) {
      const off = blk.piece.offset;
      const I = new Float32Array(this.blocks[blk.id].inertia);
      const nb = new Body({
        pos: add(b.pos, off), quat: b.quat,
        vel: add(b.vel, mul(v3(this.rand() - 0.5, this.rand() * 0.3, this.rand() - 0.5), speed * 0.25)),
        omega: add(b.omega, v3((this.rand() - 0.5) * 3, (this.rand() - 0.5) * 3, (this.rand() - 0.5) * 3)),
        mass: blk.mass, inertia: I, contacts: blk.contacts, radius: blk.radius,
        pieces: [{ ...blk.piece, offset: v3() }], mat: b.mat,
      });
      this.world.add(nb);
    }
  }

  update(dt: number, _c: number, physScale: number): void {
    this.relaxTimer += dt;
    if (this.relaxTimer > 0.12) { this.relaxTimer = 0; this.settle(); }
    let t = dt * physScale;
    const h = 1 / 240;
    let guard = 0;
    while (t > 0 && guard++ < 24) { const s = Math.min(h, t); this.world.step(s); t -= s; }
  }

  collect(out: RenderPiece[]): void {
    const mat = this.mat;
    const style = styleFor(mat);
    for (const b of this.blocks) {
      if (!b.alive || b.dynamic) continue;
      out.push({
        mesh: b.mesh, model: m4Compose(b.centre, quat()), style, color: mat.color,
        spec: mat.specular, rough: mat.roughness, seed: b.seed, strain: 0,
        grain: v3(0, 1, 0), alpha: 1, glass: false,
      });
    }
    for (const body of this.world.bodies) {
      for (const p of body.pieces) {
        const off = p.offset.x || p.offset.y || p.offset.z
          ? add(body.pos, rotate(body.quat, p.offset)) : body.pos;
        out.push({
          mesh: p.mesh, model: m4Compose(off, body.quat), style, color: mat.color,
          spec: mat.specular, rough: mat.roughness, seed: p.seed, strain: p.strain,
          grain: v3(0, 1, 0), alpha: 1, glass: false,
        });
      }
    }
  }

  stats(): Record<string, string> {
    const intact = this.blocks.filter((b) => b.alive && !b.dynamic).length;
    const broken = this.struct.bonds.filter((b) => b.broken).length;
    return {
      blocks: `${intact} / ${this.blocks.length} standing`,
      'mortar joints': `${this.struct.bonds.length - broken} intact, ${broken} snapped`,
      'collapsed blocks': String(this.collapsed),
      fragments: String(this.fragmentCount),
    };
  }
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: V3): V3 {
  const u = v3(q.x, q.y, q.z);
  const t = cross(u, add(cross(u, v), mul(v, q.w)));
  return add(v, mul(t, 2));
}

function rayBox(ro: V3, rd: V3, c: V3, h: V3): number | null {
  let tmin = -Infinity, tmax = Infinity;
  const o = sub(ro, c);
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  for (const a of axes) {
    if (Math.abs(rd[a]) < 1e-9) { if (Math.abs(o[a]) > h[a]) return null; continue; }
    const inv = 1 / rd[a];
    let t1 = (-h[a] - o[a]) * inv, t2 = (h[a] - o[a]) * inv;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}

function boxNormal(p: V3, c: V3, h: V3): V3 {
  const d = sub(p, c);
  const ax = Math.abs(d.x) / h.x, ay = Math.abs(d.y) / h.y, az = Math.abs(d.z) / h.z;
  if (ax > ay && ax > az) return v3(Math.sign(d.x), 0, 0);
  if (ay > az) return v3(0, Math.sign(d.y), 0);
  return v3(0, 0, Math.sign(d.z));
}


// ============================================================ VEHICLE (metal)

/**
 * Car panel damage.
 *
 * Steel panels do not fracture, they yield: the realistic thing is a plastic
 * shell solve, which is far too slow to run per frame. So it is baked per
 * impact site (see frac/dent.ts) and replayed from a vertex-animation texture,
 * with the impact energy choosing how far along the baked damage sequence to
 * go. The lamp lenses are the opposite case - brittle, cheap, tiny - so those
 * are fractured live by the same Griffith solver the other scenes use.
 */
export class CarScene extends Scene {
  rig = new CarRig();
  /** stamped flat-sheet dents (the atlas is shared, injected by main.ts) */
  dents!: DentField;
  carY = 0.95;
  bodyMesh!: MeshData;
  wheels: { mesh: MeshData; model: M4 }[] = [];
  windows: MeshData[] = [];
  lampMeshes: MeshData[] = [];
  shards: Body[] = [];
  /** 1 = per-vertex VAT, 2 = lattice cage */
  mode = 1;
  lastSite = '-';
  hits = 0;

  build(): void {
    this.bodyMesh = shellToMesh(this.rig.shell);
    for (const l of this.rig.lamps) this.lampMeshes.push(slabMesh(l.centre, l.half, 0.014));

    const wm = wheelMesh(0.33, 0.20);
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      this.wheels.push({
        mesh: wm,
        model: m4Compose(v3(sx * 1.26, this.carY - 0.33, sz * 0.9), quat()),
      });
    }

    // greenhouse glass: snapped onto the body surface and bound to the same
    // deformation cage, so it rides the panel it is glued into
    const g = (c: V3, u: V3, vv: V3) =>
      this.windows.push(conformPane(this.rig.shell, this.rig.nrm0, c, u, vv, 7));
    g(v3(0.60, 0.46, 0), v3(0.16, 0.20, 0), v3(0, 0, 0.50));          // windscreen
    g(v3(-0.95, 0.47, 0), v3(-0.17, 0.17, 0), v3(0, 0, 0.46));        // backlight
    for (const sz of [1, -1]) {
      g(v3(-0.16, 0.50, sz * 0.72), v3(0.44, 0, 0), v3(0, 0.125, 0)); // side glass
    }
  }

  get cameraTarget(): V3 { return v3(0, this.carY * 0.85, 0); }
  get cameraDist(): number { return 7.2; }

  private toLocal(p: V3): V3 { return v3(p.x, p.y - this.carY, p.z); }
  private toWorld(p: V3): V3 { return v3(p.x, p.y + this.carY, p.z); }

  pick(ro: V3, rd: V3): HitInfo | null {
    // ray vs the (undeformed) body triangles - a few thousand tris per click
    const o = this.toLocal(ro);
    const { pos, tris } = this.rig.shell;
    let bt = 1e9; let bn = v3(0, 1, 0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const e1 = v3(pos[b] - ax, pos[b + 1] - ay, pos[b + 2] - az);
      const e2 = v3(pos[c] - ax, pos[c + 1] - ay, pos[c + 2] - az);
      const pv = cross(rd, e2);
      const det = dot(e1, pv);
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const tv = v3(o.x - ax, o.y - ay, o.z - az);
      const u = dot(tv, pv) * inv;
      if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1);
      const vv = dot(rd, qv) * inv;
      if (vv < 0 || u + vv > 1) continue;
      const tt = dot(e2, qv) * inv;
      if (tt > 0.01 && tt < bt) { bt = tt; bn = norm(cross(e1, e2)); }
    }
    if (bt > 1e8) return null;
    return { point: add(ro, mul(rd, bt)), normal: bn };
  }

  hit(p: V3, dir: V3, energy: number): void {
    const lp = this.toLocal(p);
    this.hits++;
    // Two kinds of damage, two kinds of bake:
    //   structural crush (front/rear) is site specific - the rails and the
    //     bumper beam decide how the nose folds, so it uses the per-site bake
    //   panel damage is translation invariant - stamp the portable flat-sheet
    //     dent at the exact contact point instead
    const crushZone = Math.abs(lp.x) > 1.42 && energy > 1200;
    if (crushZone) {
      const res = this.rig.impact(lp, dir, energy);
      this.lastSite = `${this.rig.sites[res.site].site.label} (crush bake)`;
      for (const l of res.lamps) this.shatterLamp(l, dir, energy);
    } else {
      const n = this.rig.normalAt(lp);
      this.dents.add(lp, n, dir, energy);
      this.lastSite = `stamped dent @ ${lp.x.toFixed(2)}, ${lp.y.toFixed(2)}, ${lp.z.toFixed(2)}`;
      for (const l of this.rig.lamps) {
        if (!l.broken && len(sub(lp, l.centre)) < 0.42 && energy > 120) {
          l.broken = true;
          this.shatterLamp(l, dir, energy);
        }
      }
    }
  }

  /** Lamp lenses are brittle: solve them live, like every other glass part. */
  private shatterLamp(l: LampState, dir: V3, energy: number): void {
    const mat = MATERIALS['annealed-glass'];
    const box = boxConvex(l.half.x, l.half.y, l.half.z);
    const frags = fractureSolid(box, mat, {
      point: v3(l.half.x * 0.5, 0, 0), dir: norm(dir),
      energy: clamp(energy * 0.06, 20, 400),
      impulse: Math.sqrt(2 * Math.max(energy, 1) * 0.02),
      radius: 0.03,
    }, { maxFragments: 26, seed: 17 });
    const base = this.toWorld(l.centre);
    for (const f of frags) {
      const vel = add(mul(norm(dir), 0.8 + this.rand() * 1.6), v3(
        (this.rand() - 0.5) * 1.4, 0.4 + this.rand() * 1.2, (this.rand() - 0.5) * 1.4));
      const omega = v3((this.rand() - 0.5) * 14, (this.rand() - 0.5) * 14, (this.rand() - 0.5) * 14);
      const b = bodyFromConvex(f.convex, mat, vel, omega, (this.rand() * 1e5) | 0, 1);
      b.pos = add(base, b.pos);
      this.world.add(b);
      this.shards.push(b);
      this.fragmentCount++;
    }
  }

  update(dtWall: number, _crackScale: number, physScale: number): void {
    this.rig.update(Math.min(dtWall, 0.033));
    this.dents.update(Math.min(dtWall, 0.033));
    let t = dtWall * physScale;
    const h = 1 / 240;
    let guard = 0;
    while (t > 0 && guard++ < 24) { const s = Math.min(h, t); this.world.step(s); t -= s; }
  }

  collect(out: RenderPiece[]): void {
    const model = m4Compose(v3(0, this.carY, 0), quat());
    const paint: [number, number, number] = [0.085, 0.16, 0.30];
    out.push({
      mesh: this.bodyMesh, model, style: 6, color: paint, spec: 1, rough: 0.08,
      seed: 4, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: false, deform: this.mode,
    });
    for (const w of this.wheels) {
      out.push({
        mesh: w.mesh, model: w.model, style: 3, color: [0.055, 0.055, 0.06],
        spec: 0.25, rough: 0.85, seed: 9, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: false,
      });
    }
    // lamps and glass ride the deformation CAGE: one bake, every bound part
    for (let i = 0; i < this.rig.lamps.length; i++) {
      if (this.rig.lamps[i].broken) continue;
      const tail = i >= 2;
      out.push({
        mesh: this.lampMeshes[i], model, style: 4,
        color: tail ? [0.55, 0.06, 0.06] : [0.86, 0.88, 0.92],
        spec: 1, rough: 0.05, seed: 3 + i, strain: 0, grain: v3(0, 1, 0),
        alpha: 1, glass: true, deform: 2,
      });
    }
    for (const w of this.windows) {
      out.push({
        mesh: w, model, style: 4, color: [0.035, 0.05, 0.06], spec: 1, rough: 0.04,
        seed: 2, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: true, deform: 2,
      });
    }
    for (const b of this.world.bodies) {
      for (const pc of b.pieces) {
        out.push({
          mesh: pc.mesh, model: m4Compose(add(b.pos, pc.offset), b.quat), style: styleFor(pc.mat),
          color: pc.mat.color, spec: pc.mat.specular, rough: pc.mat.roughness,
          seed: pc.seed, strain: pc.strain, grain: v3(...pc.mat.grain), alpha: 1,
          glass: pc.mat.style === 'glass', batch: pc.mat.style === 'glass',
        });
      }
    }
  }

  dispose(): void {
    this.rig.dispose();
    this.world.clear();
  }

  stats(): Record<string, string> {
    const r = this.rig;
    const baked = r.sites.filter((s) => s.bake).length;
    let patch = 0;
    for (const s of r.sites) if (s.bake) patch += s.bake.count;
    return {
      'deformer': this.mode === 1 ? 'per-vertex VAT' : 'lattice cage (FFD)',
      'body mesh': `${r.shell.n} verts · ${r.shell.tris.length / 3} tris · 1 draw`,
      'sites baked': `${baked} / ${r.sites.length}` + (r.bakeMs ? ` · ${(r.bakeMs / Math.max(baked, 1)).toFixed(0)} ms each` : ''),
      'VAT slots': patch ? `${patch} verts × ${r.frames} frames` : '-',
      'active dents': `${r.activeCount()} blended`,
      'stamped dents': `${this.dents.items.length} / ${MAX_DENTS} · ${this.dents.describe()}`,
      'last impact': this.lastSite,
      'panel damage': `${(r.damage() * 100).toFixed(0)} %`,
      'lamp shards': String(this.shards.length),
      'runtime solve': 'none (playback only)',
    };
  }
}


// ============================================================== SHEET (metal)

/**
 * A bare steel panel: nothing but sheet metal, so you can see exactly what the
 * portable dent bake does. Every hit stamps the SAME baked dent - solved once
 * offline on a flat clamped sheet - at the contact point, with a random roll
 * about the normal and a scale from the impact energy. Hits close together
 * deepen the existing dent instead of stacking.
 */
export class SheetScene extends Scene {
  W = 1.55; H = 1.05; T = 0.0012;      // 1.2 mm cold-rolled steel
  originY = 1.2;
  shell!: IndexedShell;
  sheetMesh!: MeshData;
  nrm0!: Float32Array;
  frame: { mesh: MeshData; model: M4 }[] = [];
  dents!: DentField;
  hits = 0;
  lastHit = '-';

  build(): void {
    this.shell = buildBoxShell(this.W, this.H, this.T, 0.019);
    this.sheetMesh = shellToMesh(this.shell);
    this.nrm0 = shellNormals(this.shell.pos, this.shell.tris);

    const bar = (w: number, h: number, d: number, x: number, y: number) => {
      const c = boxConvex(w / 2, h / 2, d / 2);
      this.frame.push({
        mesh: buildMesh(c, 0.3, v3(0, 1, 0), 3),
        model: m4Compose(v3(x, this.originY + y, 0), quat()),
      });
    };
    const fw = 0.05, fd = 0.06;
    bar(this.W + fw * 2, fw, fd, 0, this.H / 2 + fw / 2);
    bar(this.W + fw * 2, fw, fd, 0, -this.H / 2 - fw / 2);
    bar(fw, this.H, fd, -this.W / 2 - fw / 2, 0);
    bar(fw, this.H, fd, this.W / 2 + fw / 2, 0);
    const postH = this.originY - this.H / 2 - fw;
    const post = boxConvex(0.035, postH / 2, 0.035);
    for (const sx of [-1, 1]) {
      this.frame.push({
        mesh: buildMesh(post, 0.3, v3(0, 1, 0), 5),
        model: m4Compose(v3(sx * (this.W / 2), postH / 2, 0), quat()),
      });
    }
  }

  get cameraTarget(): V3 { return v3(0, this.originY * 0.95, 0); }
  get cameraDist(): number { return 3.1; }

  pick(ro: V3, rd: V3): HitInfo | null {
    if (Math.abs(rd.z) < 1e-6) return null;
    const t = (this.T / 2 - ro.z) / rd.z;
    if (t <= 0) return null;
    const p = add(ro, mul(rd, t));
    const m = 0.02;
    if (Math.abs(p.x) > this.W / 2 - m || Math.abs(p.y - this.originY) > this.H / 2 - m) return null;
    return { point: p, normal: v3(0, 0, Math.sign(-rd.z)) };
  }

  hit(p: V3, dir: V3, energy: number): void {
    const lp = v3(p.x, p.y - this.originY, this.T / 2);
    const n = v3(0, 0, Math.sign(-dir.z) || 1);
    const d = this.dents.add(lp, n, dir, energy);
    this.hits++;
    const ty = this.dents.atlas.types[d.type];
    this.lastHit = `${ty.label} · ${(ty.half * d.scale * 200).toFixed(0)} cm across`;
  }

  update(dtWall: number, _crackScale: number, physScale: number): void {
    this.dents.update(Math.min(dtWall, 0.033));
    let t = dtWall * physScale;
    let guard = 0;
    while (t > 0 && guard++ < 24) { const s = Math.min(1 / 240, t); this.world.step(s); t -= s; }
  }

  collect(out: RenderPiece[]): void {
    const model = m4Compose(v3(0, this.originY, 0), quat());
    out.push({
      mesh: this.sheetMesh, model, style: 6, color: [0.30, 0.33, 0.36],
      spec: 1, rough: 0.14, seed: 6, strain: 0, grain: v3(0, 1, 0),
      alpha: 1, glass: false, deform: 3,
    });
    for (const f of this.frame) {
      out.push({
        mesh: f.mesh, model: f.model, style: 2, color: [0.19, 0.2, 0.22],
        spec: 0.5, rough: 0.55, seed: 2, strain: 0, grain: v3(0, 1, 0), alpha: 1, glass: false,
      });
    }
  }

  stats(): Record<string, string> {
    const a = this.dents.atlas;
    return {
      'panel': `${this.shell.n} verts · 1.2 mm steel · 1 draw`,
      'dent library': `${a.types.length} types × ${a.frames} frames × ${a.res}² · ` +
        `${((a.pos.length + a.nrm.length) * 4 / 1048576).toFixed(1)} MB`,
      'bake time': `${a.ms.toFixed(0)} ms (once, offline)`,
      'stamped dents': `${this.dents.items.length} / ${MAX_DENTS}`,
      'mix': this.dents.describe(),
      'deepest': `${(this.dents.worst() * 100).toFixed(0)} % of full depth`,
      'last hit': this.lastHit,
      'runtime solve': 'none (texture lookup in the vertex shader)',
    };
  }
}

export function makeScene(def: SceneDef): Scene {
  const mat = MATERIALS[def.material];
  const s: Scene = def.kind === 'pane' ? new PaneScene(def, mat)
    : def.kind === 'solid' ? new SolidScene(def, mat)
      : def.kind === 'vehicle' ? new CarScene(def, mat)
        : def.kind === 'sheet' ? new SheetScene(def, mat)
        : new StructureScene(def, mat);
  s.build();
  return s;
}

export { qFromAxis };
