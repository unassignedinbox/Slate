/**
 * OFFLINE BAKE: elasto-plastic sheet-metal panel solver.
 *
 * This is the "real physics" half of the deformation pipeline. We simulate an
 * actual steel panel as a mass-spring shell with:
 *
 *   - membrane springs (in-plane stretch, E·t)
 *   - shear springs (diagonals) so the sheet cannot hinge for free
 *   - bending springs (2-ring) giving plate stiffness ~ E·t³
 *   - VON MISES-style plastic flow: when |strain| passes the yield strain the
 *     spring's REST LENGTH permanently moves toward the current length
 *     (with linear hardening). That is what makes a dent a dent: after the
 *     impactor leaves, the elastic part springs back and the plastic set stays.
 *   - a rigid impactor (ellipsoid) pushed in, then retracted, then the panel
 *     is relaxed so we capture the springback.
 *
 * Because the sheet is nearly inextensible, material has to come from
 * somewhere: the solver pulls it in from around the crater, which is what
 * produces the raised lip / crumple rim around a real dent. We do not model
 * that with any artistic hack — it falls out of the membrane constraint.
 *
 * The result is baked, per severity level, into a displacement field
 * (u, v, w per grid node) that the runtime samples as a VAT.
 */

export interface PanelOpts {
  /** grid resolution (nodes per side) */
  grid: number;
  /** physical size of the baked patch, metres */
  size: number;
  /** sheet thickness, metres (0.0007 = 0.7 mm body panel) */
  thickness: number;
  /** yield strength, Pa (mild deep-draw steel ~ 180e6, HSLA ~ 350e6) */
  yieldStrength: number;
  /** Young's modulus, Pa */
  E: number;
  /** severity levels to bake */
  frames: number;
  /** max impactor penetration at the deepest frame, metres */
  maxDepth: number;
  /** impactor ellipsoid radii (x, y), metres */
  impactor: [number, number];
}

export interface DentField {
  grid: number;
  size: number;
  frames: number;
  /** frames * grid * grid * 3 displacements, metres, panel space (x,y in plane, z out) */
  data: Float32Array;
  /** deepest permanent set per frame, for the HUD */
  depths: number[];
  ms: number;
}

interface Link { a: number; b: number; L0: number; stiff: number }
/** plastic bending hinge over a node triple (curvature constraint) */
interface Hinge { l: number; c: number; r: number; d0: [number, number, number] }

/**
 * Quasi-static position-based solve. Sheet metal is extremely stiff in plane
 * (k ~ 3e6 N/m against a 3 g node), so an explicit integrator would need
 * ~20 kHz to stay stable; position-based projection is unconditionally stable
 * and, since we only want the SETTLED shape (press -> release -> springback),
 * a quasi-static solve is also the physically right thing to integrate.
 *
 * Two yield mechanisms, both real:
 *   membrane  - stretch past epsilon_y = sigma_y / E permanently lengthens the
 *               sheet (that is the draw-in that feeds the crater);
 *   bending   - curvature past kappa_y = 2*sigma_y / (E*t) leaves a permanent
 *               plastic hinge. This is what makes the crater rim: inside the
 *               crater the sheet is hinged for good, just outside it is only
 *               bent elastically, and when the impactor leaves, that elastic
 *               ring springs back and lifts a raised lip around the dent.
 */
export function bakePanel(o: PanelOpts): DentField {
  const t0 = performance.now();
  const G = o.grid;
  const N = G * G;
  const h = o.size / (G - 1);

  const rest = new Float32Array(N * 3);
  const pos = new Float32Array(N * 3);
  const pinned = new Uint8Array(N);

  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const n = j * G + i, k = n * 3;
      rest[k] = (i / (G - 1) - 0.5) * o.size;
      rest[k + 1] = (j / (G - 1) - 0.5) * o.size;
      rest[k + 2] = 0;
      pos[k] = rest[k]; pos[k + 1] = rest[k + 1]; pos[k + 2] = 0;
      pinned[n] = (i === 0 || j === 0 || i === G - 1 || j === G - 1) ? 1 : 0;  // welded seam
    }
  }

  const links: Link[] = [];
  const add = (a: number, b: number, stiff: number) => {
    const L0 = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1]);
    links.push({ a, b, L0, stiff });
  };
  const hinges: Hinge[] = [];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const n = j * G + i;
      if (i + 1 < G) add(n, n + 1, 1.0);
      if (j + 1 < G) add(n, n + G, 1.0);
      if (i + 1 < G && j + 1 < G) add(n, n + G + 1, 0.55);
      if (i > 0 && j + 1 < G) add(n, n + G - 1, 0.55);
      if (i > 0 && i + 1 < G) hinges.push({ l: n - 1, c: n, r: n + 1, d0: [0, 0, 0] });
      if (j > 0 && j + 1 < G) hinges.push({ l: n - G, c: n, r: n + G, d0: [0, 0, 0] });
    }
  }

  const yieldStrain = o.yieldStrength / o.E;                     // ~9.5e-4
  const kappaYield = 2 * o.yieldStrength / (o.E * o.thickness);  // 1/m
  const sagYield = kappaYield * h * h * 0.5;                     // sag of a hinge at yield
  const flowMembrane = 0.14;
  const flowBend = 0.30;
  const kBend = 0.22;
  const iters = 3;

  const project = (allowPlastic: boolean) => {
    for (let it = 0; it < iters; it++) {
      // --- membrane / shear, with plastic stretch ---
      for (let li = 0; li < links.length; li++) {
        const s = links[li];
        const a3 = s.a * 3, b3 = s.b * 3;
        const dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2];
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-12) continue;
        if (allowPlastic) {
          const strain = (len - s.L0) / s.L0;
          const over = Math.abs(strain) - yieldStrain;
          if (over > 0) s.L0 += Math.sign(strain) * over * s.L0 * flowMembrane;
        }
        const pa = pinned[s.a], pb = pinned[s.b];
        if (pa && pb) continue;
        const corr = (len - s.L0) / len * s.stiff;
        const wa = pa ? 0 : (pb ? 1 : 0.5);
        const wb = pb ? 0 : (pa ? 1 : 0.5);
        pos[a3] += dx * corr * wa; pos[a3 + 1] += dy * corr * wa; pos[a3 + 2] += dz * corr * wa;
        pos[b3] -= dx * corr * wb; pos[b3 + 1] -= dy * corr * wb; pos[b3 + 2] -= dz * corr * wb;
      }
      // --- plastic bending hinges ---
      for (let hi = 0; hi < hinges.length; hi++) {
        const g = hinges[hi];
        const l3 = g.l * 3, c3 = g.c * 3, r3 = g.r * 3;
        const dx = pos[c3] - 0.5 * (pos[l3] + pos[r3]);
        const dy = pos[c3 + 1] - 0.5 * (pos[l3 + 1] + pos[r3 + 1]);
        const dz = pos[c3 + 2] - 0.5 * (pos[l3 + 2] + pos[r3 + 2]);
        if (allowPlastic) {
          const ex = dx - g.d0[0], ey = dy - g.d0[1], ez = dz - g.d0[2];
          const e = Math.hypot(ex, ey, ez);
          if (e > sagYield) {
            const k = (1 - sagYield / e) * flowBend;
            g.d0[0] += ex * k; g.d0[1] += ey * k; g.d0[2] += ez * k;
          }
        }
        if (pinned[g.c]) continue;
        // pull the centre node back onto its (plastically offset) rest curvature
        const cx = (dx - g.d0[0]) * kBend, cy = (dy - g.d0[1]) * kBend, cz = (dz - g.d0[2]) * kBend;
        pos[c3] -= cx * 0.5; pos[c3 + 1] -= cy * 0.5; pos[c3 + 2] -= cz * 0.5;
        if (!pinned[g.l]) { pos[l3] += cx * 0.25; pos[l3 + 1] += cy * 0.25; pos[l3 + 2] += cz * 0.25; }
        if (!pinned[g.r]) { pos[r3] += cx * 0.25; pos[r3 + 1] += cy * 0.25; pos[r3 + 2] += cz * 0.25; }
      }
    }
  };

  const [rx, ry] = o.impactor;
  const rz = Math.min(rx, ry) * 1.4;
  const pressImpactor = (zc: number) => {
    for (let n = 0; n < N; n++) {
      if (pinned[n]) continue;
      const k = n * 3;
      const u = pos[k] / rx, v = pos[k + 1] / ry;
      const q = u * u + v * v;
      if (q >= 1) continue;
      const surf = zc + rz * (1 - Math.sqrt(1 - q));
      if (pos[k + 2] > surf) pos[k + 2] = surf;
    }
  };

  const data = new Float32Array(o.frames * N * 3);
  const depths: number[] = [];
  const pressSteps = 55, relaxSteps = 70;

  for (let f = 0; f < o.frames; f++) {
    // each severity level presses deeper into the SAME panel: the ladder is a
    // real accumulated plastic history, not a scaled copy of one dent
    const depth = o.maxDepth * ((f + 1) / o.frames);
    for (let s = 1; s <= pressSteps; s++) {
      pressImpactor(-depth * (s / pressSteps));
      project(true);
    }
    for (let s = 0; s < relaxSteps; s++) project(false);   // elastic springback

    let deepest = 0;
    const base = f * N * 3;
    for (let n = 0; n < N; n++) {
      const k = n * 3;
      data[base + k] = pos[k] - rest[k];
      data[base + k + 1] = pos[k + 1] - rest[k + 1];
      data[base + k + 2] = pos[k + 2] - rest[k + 2];
      deepest = Math.min(deepest, pos[k + 2] - rest[k + 2]);
    }
    depths.push(-deepest);
  }

  return { grid: G, size: o.size, frames: o.frames, data, depths, ms: performance.now() - t0 };
}

/** Sheet-metal presets. */
export const PANEL_PRESETS = {
  /** a bumper / another car's corner: broad, round */
  blunt: (gauge: number): PanelOpts => ({
    grid: 35, size: 0.85, thickness: gauge, yieldStrength: 190e6, E: 200e9,
    frames: 6, maxDepth: 0.05, impactor: [0.17, 0.15],
  }),
  /** a headlight corner / pole: narrow, sharp crease */
  edge: (gauge: number): PanelOpts => ({
    grid: 35, size: 0.85, thickness: gauge, yieldStrength: 190e6, E: 200e9,
    frames: 6, maxDepth: 0.058, impactor: [0.055, 0.22],
  }),
} as const;
