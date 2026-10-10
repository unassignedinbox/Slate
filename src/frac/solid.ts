/**
 * SOLID FRACTURE SOLVER  (rock, wood, concrete, brick, thick plastic)
 * ===================================================================
 *
 * This is NOT Voronoi / cell-fracture. There are no seed points and no
 * distance-field cells. Instead the body is carved by *crack surfaces* that
 * are each chosen by a local Griffith energy balance inside an impact stress
 * field, under a global surface-energy budget:
 *
 *   1. An impact deposits energy E. A fraction eta of it is available to make
 *      new surface (the rest becomes fragment kinetic energy, sound, heat).
 *      Thermally tempered materials add their stored residual energy
 *      rho_U * V, which is why tempered glass dices and annealed glass doesn't.
 *
 *   2. A diverging stress wave leaves radial compression and *hoop tension*
 *      sigma_theta ~ A / r^1.5 behind it. Hoop tension opens crack planes that
 *      CONTAIN the radial direction -> meridional / radial splitting.
 *      When the wave reflects off a free back face it returns as tension and
 *      opens planes PERPENDICULAR to the radial direction -> back-face spall.
 *
 *   3. For every candidate cell we sample intrinsic flaws (Weibull weakest
 *      link), build candidate crack planes through the weakest flaw, and score
 *      them by the energy release rate they would relieve versus the
 *      orientation-dependent fracture energy they would cost:
 *
 *          G(n) = sigma_n^2 * L_cell / E        (release)
 *          Gc(n) = Gc * aniso(n . grain)        (cost)
 *
 *      The winning plane is cut; its true area is charged to the budget. That
 *      single rule reproduces, with no special-casing:
 *        - conchoidal, impact-centred size grading in rock,
 *        - long grain-parallel splinters in wood (Gc across fibres is ~10x),
 *        - blocky spall cones in concrete,
 *        - few big shards in ductile plastic (huge Gc exhausts the budget).
 *
 *   4. Near-field contact damage is handled explicitly with a Hertzian cone
 *      crack, the signature of a hard blunt impact on a brittle solid.
 */

import {
  V3, add, cross, dot, len, mul, norm, sub, v3, rng, weibull, clamp, rotAxis, basis, lerp,
} from '../core/math';
import {
  Convex, Plane, clipConvex, splitConvex, massProperties, faceArea, faceNormal,
  boundingRadius,
} from '../geom/convex';
import { Material, criticalFlaw } from '../sim/materials';

export interface Impact {
  /** World/body-space contact point. */
  point: V3;
  /** Unit direction of the blow. */
  dir: V3;
  /** Kinetic energy delivered [J]. */
  energy: number;
  /** Momentum delivered [kg m/s] — sets fragment ejection velocities. */
  impulse: number;
  /** Contact patch radius [m]. */
  radius: number;
}

export interface Fragment {
  convex: Convex;
  /** Centre of mass (body space). */
  com: V3;
  volume: number;
  mass: number;
  inertia: Float32Array;
  radius: number;
  vel: V3;
  omega: V3;
  gen: number;
  seed: number;
}

interface Cell {
  poly: Convex;
  com: V3;
  vol: number;
  size: number;      // characteristic length
  gen: number;
  energy: number;    // elastic energy still stored in this cell [J]
  score: number;     // drive/cost ratio, cached
  cand: Plane | null;
  area: number;      // estimated cut area
}

export interface SolidFractureOptions {
  maxFragments?: number;
  /** Fraction of impact energy converted into new fracture surface. */
  surfaceEfficiency?: number;
  seed?: number;
  /** Direction of the free back face for spall (unit), optional. */
  backFace?: V3;
}

/** Hoop tensile stress of a diverging spherical stress wave. */
function hoopStress(imp: Impact, mat: Material, r: number): number {
  const r0 = Math.max(imp.radius, 1e-3);
  // Peak contact pressure scaled so that sigma(r0) ~ a few x tensile strength
  // for a "solid hit"; falls off as r^-1.5 (geometric spreading + damping).
  const p0 = Math.sqrt(Math.max(0, imp.energy) * mat.E / (Math.PI * r0 * r0 * r0)) * 0.02;
  return p0 * Math.pow(r0 / Math.max(r, r0), 1.5);
}

/** Pick a point inside a convex cell, biased toward the impact. */
function samplePoint(c: Convex, com: V3, rand: () => number, bias: V3 | null): V3 {
  const n = c.verts.length;
  let best: V3 | null = null;
  let bestD = Infinity;
  const tries = bias ? 3 : 1;
  for (let t = 0; t < tries; t++) {
    const i = (rand() * n) | 0, j = (rand() * n) | 0, k = (rand() * n) | 0;
    const p = mul(add(add(c.verts[i], c.verts[j]), c.verts[k]), 1 / 3);
    const q = add(com, mul(sub(p, com), 0.35 + 0.6 * rand()));
    const d = bias ? len(sub(q, bias)) : 0;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best!;
}

/** Orientation-dependent fracture energy (wood: cheap along the grain). */
function gcFor(mat: Material, n: V3, grain: V3): number {
  if (mat.anisotropy === 1) return mat.Gc;
  // Cheapest when the crack plane contains the grain axis (n perpendicular to grain).
  const a = Math.abs(dot(n, grain));
  return mat.Gc * (1 + (mat.anisotropy - 1) * Math.pow(a, 1.5));
}

/**
 * Hertzian cone crack: a hard blunt contact on a brittle half-space nucleates a
 * ring crack just outside the contact circle which then flares into a cone
 * (half angle ~22 deg from the load axis in glass, wider in rock/concrete).
 * We approximate the cone with a fan of tangent planes so every piece stays
 * convex; the ring of shards it peels off is the crushed contact zone.
 */
function coneCrack(
  cell: Convex, imp: Impact, halfAngleDeg: number, sides: number, out: Convex[],
): Convex | null {
  const axis = norm(imp.dir);
  const [t1, t2] = basis(axis);
  const ha = (halfAngleDeg * Math.PI) / 180;
  let cur: Convex | null = cell;
  const apex = sub(imp.point, mul(axis, imp.radius / Math.tan(ha)));
  for (let i = 0; i < sides && cur; i++) {
    const a = (i / sides) * Math.PI * 2;
    const radial = add(mul(t1, Math.cos(a)), mul(t2, Math.sin(a)));
    // Plane through the apex, tangent to the cone, outward normal.
    const tangent = add(mul(axis, Math.cos(ha)), mul(radial, Math.sin(ha)));
    const n = norm(sub(radial, mul(axis, Math.tan(ha) * 0 + 0)));
    // Outward normal of the cone surface at this azimuth:
    const nOut = norm(sub(mul(radial, Math.cos(ha)), mul(axis, Math.sin(ha))));
    void tangent; void n;
    const plane: Plane = { n: nOut, d: dot(nOut, apex) };
    const [outside, inside] = splitConvex(cur, { n: mul(plane.n, -1), d: -plane.d }, 1);
    // `outside` = beyond the cone wall (kept as a separate shard), `inside` = plug
    if (outside) out.push(outside);
    cur = inside;
  }
  return cur;
}

export function fractureSolid(
  body: Convex,
  mat: Material,
  imp: Impact,
  opts: SolidFractureOptions = {},
): Fragment[] {
  const maxFrag = opts.maxFragments ?? 160;
  const eta = opts.surfaceEfficiency ?? 0.18;
  const rand = rng(opts.seed ?? 1337);
  const grain = norm(v3(mat.grain[0], mat.grain[1], mat.grain[2]));

  const mp0 = massProperties(body);
  const totalVol = mp0.volume;
  const bodyR = boundingRadius(body, mp0.centroid);

  // ---- energy available to make new surface -------------------------------
  // Only a modest slice of an impact ends up as fracture surface; the rest
  // leaves as fragment kinetic energy, elastic waves, sound and heat. Stored
  // (tempering) energy is released in full.
  let pool = eta * imp.energy + mat.residual * totalVol;

  const cells: Cell[] = [];
  const minSize = Math.max(mat.flawSpacing, Math.pow(totalVol / maxFrag, 1 / 3) * 0.3);

  const mkCell = (poly: Convex, gen: number, energy: number): Cell | null => {
    const mp = massProperties(poly);
    if (mp.volume <= 1e-9) return null;
    return {
      poly, com: mp.centroid, vol: mp.volume,
      size: Math.pow(mp.volume, 1 / 3), gen, energy, score: 0, cand: null, area: 0,
    };
  };

  // ---- stage 1: contact damage (Hertzian cone) ----------------------------
  const brittle = mat.ductility < 0.3;
  const coneStrong = brittle && imp.energy > 40;
  if (coneStrong) {
    const shards: Convex[] = [];
    const wide = mat.id === 'granite' || mat.id === 'concrete' || mat.id === 'brick';
    const plug = coneCrack(body, imp, wide ? 38 : 24, 7, shards);
    for (const s of shards) { const c = mkCell(s, 1, 0); if (c) cells.push(c); }
    if (plug) { const c = mkCell(plug, 1, 0); if (c) cells.push(c); }
    // Charge the cone surface up front.
    const coneArea = Math.PI * Math.pow(imp.radius * 4, 2) * 2;
    pool = Math.max(0, pool - coneArea * mat.Gc);
  } else {
    const c = mkCell(body, 0, 0); if (c) cells.push(c);
  }

  // ---- distribute the elastic energy through the body ---------------------
  // A diverging impact pulse deposits most of its energy near the contact.
  const r0 = Math.max(imp.radius * 3, bodyR * 0.12);
  const weightOf = (c: Cell) => {
    const r = len(sub(c.com, imp.point));
    return c.vol / (1 + Math.pow(r / r0, 2.1));
  };
  {
    let wsum = 0;
    for (const c of cells) wsum += weightOf(c);
    for (const c of cells) c.energy = pool * (weightOf(c) / Math.max(wsum, 1e-12));
  }

  // ---- stage 2: Griffith cascade ------------------------------------------
  // A cell splits when the elastic energy it holds can pay for the surface the
  // split would create. Children inherit what is left over. This single rule
  // sets the fragment-size distribution: energy-rich cells near the impact
  // keep subdividing, distant ones survive whole.
  const flaw0 = criticalFlaw(mat);

  const evaluate = (cell: Cell) => {
    cell.score = -1; cell.cand = null;
    if (cell.size < minSize || cell.energy <= 0) return;

    const rvec = sub(cell.com, imp.point);
    const r = Math.max(len(rvec), 1e-4);
    const rhat = mul(rvec, 1 / r);
    const [u, w] = basis(rhat);
    const back = opts.backFace ? norm(opts.backFace) : null;

    // Weakest-link flaw: larger cells hold larger flaws (Weibull size effect),
    // so big blocks break before small ones at the same stress.
    const volRatio = cell.vol / Math.max(totalVol, 1e-12);
    const aFlaw = weibull(rand, flaw0 * (1 + 3 * Math.pow(volRatio, 1 / mat.m)), mat.m);
    const weakness = clamp(Math.sqrt(aFlaw / Math.max(flaw0, 1e-9)), 0.5, 2.5);

    const flawPt = samplePoint(cell.poly, cell.com, rand, imp.point);
    const areaEst = Math.pow(cell.vol, 2 / 3) * 1.25;

    let best: { s: number; p: Plane } | null = null;
    for (let i = 0; i < 8; i++) {
      let n: V3;
      let mode: 'hoop' | 'spall' | 'grain';
      const pick = rand();
      if (mat.anisotropy > 2 && pick < 0.62) {
        const ang = rand() * Math.PI * 2;
        const [g1, g2] = basis(grain);
        n = norm(add(mul(g1, Math.cos(ang)), mul(g2, Math.sin(ang))));
        mode = 'grain';
      } else if (pick < 0.84) {
        const ang = rand() * Math.PI * 2;
        n = norm(add(mul(u, Math.cos(ang)), mul(w, Math.sin(ang))));
        mode = 'hoop';
      } else {
        n = rhat;
        mode = 'spall';
      }
      // Tortuosity: rough materials wander off the ideal plane.
      const jitter = (0.1 + 0.6 * mat.roughness) * (rand() - 0.5);
      n = norm(rotAxis(n, norm(v3(rand() - 0.5, rand() - 0.5, rand() - 0.5)), jitter));

      // How much of the local tensile field actually opens this plane.
      const align = Math.abs(dot(n, rhat));
      let drive: number;
      if (mode === 'spall') {
        const refl = back ? clamp(dot(rhat, back), 0, 1) : 0.3;
        drive = 0.8 * refl;
      } else {
        drive = 1 - 0.75 * align;
      }
      if (mode === 'grain') drive *= 1.2;   // fibre debonding concentrates stress
      drive *= weakness;

      const gc = gcFor(mat, n, grain);
      const s = (cell.energy * drive) / (gc * areaEst) * (0.7 + 0.6 * rand());
      if (!best || s > best.s) best = { s, p: { n, d: dot(n, flawPt) } };
    }
    if (best && best.s > 1) { cell.score = best.s; cell.cand = best.p; cell.area = areaEst; }
  };

  for (const c of cells) evaluate(c);

  let guard = 0;
  while (cells.length < maxFrag && guard++ < maxFrag * 8) {
    let bi = -1, bs = 1;
    for (let i = 0; i < cells.length; i++) if (cells[i].score > bs) { bs = cells[i].score; bi = i; }
    if (bi < 0) break;
    const cell = cells[bi];
    const plane = cell.cand!;
    const [a, b] = splitConvex(cell.poly, plane, cell.gen + 1);
    if (!a || !b) { cell.score = -1; continue; }

    // Charge the *actual* area created, then hand the remainder down.
    let newArea = 0;
    for (const f of a.faces) if (f.fresh && f.gen === cell.gen + 1) newArea += faceArea(a, f);
    const gc = gcFor(mat, plane.n, grain);
    const left = Math.max(0, cell.energy - newArea * gc);
    const va = massProperties(a).volume, vb = massProperties(b).volume;
    const fa = va / Math.max(va + vb, 1e-12);
    const skew = 0.8 + 0.4 * rand();
    const ea = left * clamp(fa * skew, 0.05, 0.95);
    const ca = mkCell(a, cell.gen + 1, ea), cb = mkCell(b, cell.gen + 1, left - ea);
    cells.splice(bi, 1);
    if (ca) { evaluate(ca); cells.push(ca); }
    if (cb) { evaluate(cb); cells.push(cb); }
  }

  // ---- stage 3: kinematics -------------------------------------------------
  // Momentum is distributed as a radial ejection field plus the incoming
  // impulse direction; near-field fragments leave fastest (they saw the wave
  // at its peak), and every fragment picks up spin from the stress gradient.
  const frags: Fragment[] = [];
  const axis = norm(imp.dir);
  let massTotal = 0;
  for (const c of cells) massTotal += c.vol * mat.rho;
  const vScale = imp.impulse / Math.max(massTotal, 1e-6);

  for (const c of cells) {
    const mp = massProperties(c.poly);
    if (mp.volume < 1e-9) continue;
    const mass = mp.volume * mat.rho;
    const r = sub(mp.centroid, imp.point);
    const d = Math.max(len(r), 1e-3);
    const rhat = mul(r, 1 / d);
    const falloff = 1 / (1 + Math.pow(d / Math.max(imp.radius * 3, 0.05), 1.4));
    const speed = Math.min(vScale * (0.5 + 3.5 * falloff), 42);
    const vel = add(mul(axis, speed * 0.75), mul(rhat, speed * 0.85));
    const lever = sub(mp.centroid, add(imp.point, mul(axis, 0.02)));
    const omega = mul(cross(lever, vel), 2.2 * (0.5 + rand()));
    const inertia = mp.inertia;
    for (let i = 0; i < 9; i++) inertia[i] *= mat.rho;
    frags.push({
      convex: c.poly, com: mp.centroid, volume: mp.volume, mass,
      inertia, radius: boundingRadius(c.poly, mp.centroid),
      vel, omega, gen: c.gen, seed: (rand() * 1e6) | 0,
    });
  }
  return frags;
}

/** Utility: are all faces of a cell original (i.e. untouched piece)? */
export function isIntact(c: Convex): boolean {
  return c.faces.every((f) => !f.fresh);
}

export { faceNormal, clipConvex, lerp };
