/* skeleton.js — Tyrannosaurus rex (FMNH PR2081 "Sue" proportions), built bone by
 * bone as solid geometry and rigged as a real joint hierarchy.
 *
 * Axes:  +X forward (snout),  +Y up,  +Z = animal's LEFT.
 * Units: metres. Femur 1.32 m, tibia 1.15 m, skull 1.40 m, total ~12.2 m.
 */
import * as THREE from 'three';
import { sweep, blob, plate, mirrorZ, merge, weather, roughen, longBone, lerp, clamp, smooth } from './boneKit.js';

export const DIM = {
  skull: 1.40,
  cervical: [10, 1.12],
  dorsal: [13, 1.86],
  sacral: [5, 0.66],
  caudal: [40, 6.30],
  femur: 1.32, tibia: 1.15, metatarsus: 0.72, phalanx: 0.46,
  humerus: 0.38, forearm: 0.21,
  hipHeight: 3.05, hipHalfWidth: 0.30,
};

/* =======================================================================
 *  SKULL — a fenestrated strut architecture, exactly like a mounted skull.
 *  Lateral coordinates: x = 0 at snout tip → 1.40 at occiput, y = 0 at the
 *  maxillary tooth line. Each element is a solid swept bar whose half-width
 *  (lateral) varies, so the skull is genuinely volumetric and hollow inside.
 * ==================================================================== */
function skullGeometry() {
  const parts = [];
  const S = 1.0;
  // helper: bar defined by lateral [x,y] points, a z(t) offset track, and section sizes
  const bar = (pts2, zTrack, w, d, o = {}) => {
    const n = pts2.length - 1;
    const pts = pts2.map((p, i) => [p[0] * S, p[1] * S, (typeof zTrack === 'function' ? zTrack(i / n) : zTrack)]);
    return sweep(pts, w, d, { radial: o.radial || 12, steps: o.steps || 30, section: o.section || 2 });
  };

  // --- premaxilla (short, deep, U-shaped in plan) ---
  parts.push(bar([[0.03, 0.30], [0.06, 0.18], [0.10, 0.05], [0.16, 0.01]],
    t => lerp(0.04, 0.10, t), [0.045, 0.05, 0.05, 0.045], [0.06, 0.07, 0.06, 0.05]));
  // --- maxilla: massive dental ramus + ascending ramus framing the antorbital fenestra
  parts.push(bar([[0.15, 0.03], [0.34, 0.00], [0.55, 0.00], [0.72, 0.03]],
    t => lerp(0.10, 0.20, Math.sin(t * Math.PI) * 0.9 + 0.1), [0.085, 0.10, 0.10, 0.085], [0.055, 0.075, 0.075, 0.06]));
  parts.push(bar([[0.19, 0.06], [0.30, 0.22], [0.44, 0.30], [0.60, 0.30], [0.72, 0.20], [0.74, 0.07]],
    t => lerp(0.075, 0.13, Math.sin(t * Math.PI)), [0.05, 0.055, 0.05, 0.05, 0.055, 0.06], [0.06, 0.05, 0.045, 0.045, 0.05, 0.06]));
  // maxillary body fill between the two rami (anterior of antorbital fossa)
  parts.push(bar([[0.16, 0.04], [0.26, 0.20], [0.30, 0.28]], t => lerp(0.09, 0.075, t), [0.07, 0.06, 0.05], [0.07, 0.06, 0.05]));

  // --- nasals (fused pair, rugose dorsal ridge) ---
  parts.push(bar([[0.10, 0.28], [0.26, 0.38], [0.48, 0.45], [0.70, 0.48], [0.82, 0.48]],
    t => lerp(0.035, 0.075, t), [0.05, 0.055, 0.06, 0.065, 0.06], [0.045, 0.05, 0.055, 0.06, 0.055]));
  for (let i = 0; i < 6; i++) {
    const t = i / 5, x = lerp(0.24, 0.78, t);
    parts.push(blob([x, lerp(0.40, 0.50, t) + 0.02, lerp(0.035, 0.07, t)], 0.030, [1.6, 0.7, 0.9]));
  }
  // --- lacrimal (inverted L, front of orbit) ---
  parts.push(bar([[0.62, 0.44], [0.76, 0.47], [0.82, 0.36], [0.83, 0.20], [0.82, 0.08]],
    t => lerp(0.10, 0.145, smooth(t)), [0.05, 0.06, 0.055, 0.05, 0.05], [0.055, 0.075, 0.065, 0.055, 0.05]));
  parts.push(blob([0.79, 0.50, 0.13], 0.055, [1.3, 0.9, 0.8]));   // lacrimal horn
  // --- jugal (below orbit) + quadratojugal ---
  parts.push(bar([[0.72, 0.04], [0.88, 0.07], [1.02, 0.12], [1.10, 0.14]],
    t => lerp(0.14, 0.21, t), [0.055, 0.07, 0.065, 0.05], [0.055, 0.075, 0.07, 0.05]));
  parts.push(bar([[0.96, 0.11], [1.00, 0.26], [1.02, 0.40]], t => lerp(0.185, 0.20, t), [0.045, 0.045, 0.05], [0.05, 0.05, 0.05]));
  parts.push(bar([[1.09, 0.13], [1.17, 0.22], [1.19, 0.34]], t => lerp(0.20, 0.215, t), [0.04, 0.04, 0.045], [0.05, 0.05, 0.05]));
  // --- postorbital (behind orbit, heavy boss) ---
  parts.push(bar([[1.00, 0.52], [1.02, 0.40], [1.00, 0.26], [0.97, 0.16]],
    t => lerp(0.17, 0.20, t), [0.055, 0.05, 0.045, 0.04], [0.065, 0.06, 0.05, 0.045]));
  parts.push(blob([1.01, 0.50, 0.185], 0.058, [1.1, 0.9, 1.0]));
  // --- squamosal + quadrate (jaw suspension) ---
  parts.push(bar([[1.02, 0.50], [1.14, 0.46], [1.22, 0.38], [1.20, 0.27]],
    t => lerp(0.19, 0.24, t), [0.05, 0.055, 0.055, 0.05], [0.055, 0.06, 0.055, 0.05]));
  parts.push(bar([[1.23, 0.42], [1.22, 0.24], [1.18, 0.06], [1.15, -0.01]],
    t => lerp(0.20, 0.235, t), [0.045, 0.05, 0.055, 0.07], [0.05, 0.055, 0.06, 0.055]));
  // --- skull roof: frontals + parietals + sagittal crest, plus occiput block ---
  parts.push(bar([[0.72, 0.49], [0.88, 0.53], [1.02, 0.55], [1.16, 0.52], [1.28, 0.46]],
    t => lerp(0.07, 0.10, Math.sin(t * Math.PI)), [0.075, 0.10, 0.115, 0.10, 0.07],
    [0.05, 0.055, 0.06, 0.055, 0.05], { section: 3 }));
  parts.push(blob([1.12, 0.55, 0.0], 0.09, [1.6, 0.55, 0.35]));  // sagittal crest
  parts.push(blob([1.30, 0.30, 0.0], 0.17, [0.8, 1.25, 1.10]));  // braincase / occiput
  parts.push(blob([1.36, 0.16, 0.0], 0.055, [0.8, 0.9, 0.9]));   // occipital condyle
  // paroccipital processes
  parts.push(bar([[1.30, 0.34], [1.34, 0.30], [1.33, 0.24]], t => lerp(0.05, 0.27, t), [0.05, 0.05, 0.045], [0.06, 0.055, 0.05]));
  // palate strut (pterygoid/ectopterygoid) visible through the fenestrae
  parts.push(bar([[0.55, 0.00], [0.80, 0.02], [1.05, 0.10], [1.18, 0.14]], t => lerp(0.05, 0.10, t), [0.03, 0.035, 0.04, 0.04], [0.025, 0.03, 0.035, 0.04]));

  // --- teeth: premaxillary (4, D-shaped, small) + maxillary (12, banana-sized) ---
  const tooth = (x, y, z, len, rad, tilt) => {
    const g = new THREE.ConeGeometry(rad, len, 10, 1);
    g.translate(0, -len / 2, 0);
    g.rotateZ(tilt); g.rotateX(0.06 * Math.sign(z));
    g.translate(x, y, z);
    return g;
  };
  for (let i = 0; i < 4; i++) {
    const t = i / 3, x = lerp(0.055, 0.135, t);
    parts.push(tooth(x, 0.00 + 0.012 * (1 - t), lerp(0.035, 0.085, t), 0.11, 0.021, 0.35 - t * 0.2));
  }
  for (let i = 0; i < 12; i++) {
    const t = i / 11, x = lerp(0.19, 0.70, t);
    const len = 0.30 * (1 - Math.pow(Math.abs(t - 0.32) * 1.6, 1.7)) + 0.09;
    parts.push(tooth(x, -0.005, lerp(0.095, 0.175, smooth(t)), len, 0.030 + 0.012 * (1 - Math.abs(t - 0.3)), 0.10 - t * 0.28));
  }

  const left = merge(parts);
  return merge([left, mirrorZ(left)]);
}

function mandibleGeometry() {
  const parts = [];
  // dentary — deep, straight-bottomed bar
  parts.push(sweep([[0.03, -0.09, 0.045], [0.22, -0.13, 0.10], [0.45, -0.13, 0.145], [0.66, -0.11, 0.175]],
    [0.055, 0.075, 0.075, 0.065], [0.085, 0.105, 0.10, 0.085], { radial: 12, steps: 26 }));
  // surangular + angular, framing the external mandibular fenestra
  parts.push(sweep([[0.64, -0.05, 0.175], [0.85, -0.03, 0.195], [1.05, -0.02, 0.205], [1.16, -0.03, 0.205]],
    [0.05, 0.062, 0.062, 0.05], [0.055, 0.075, 0.075, 0.055], { radial: 12, steps: 22 }));
  parts.push(sweep([[0.63, -0.17, 0.165], [0.84, -0.16, 0.185], [1.02, -0.13, 0.195], [1.13, -0.09, 0.20]],
    [0.04, 0.05, 0.05, 0.045], [0.045, 0.05, 0.05, 0.045], { radial: 10, steps: 20 }));
  parts.push(blob([1.14, -0.02, 0.20], 0.07, [1.1, 1.0, 0.8]));          // articular / glenoid
  parts.push(blob([1.02, 0.03, 0.20], 0.06, [1.5, 0.8, 0.6]));            // coronoid eminence
  // dentary teeth (13)
  for (let i = 0; i < 13; i++) {
    const t = i / 12, x = lerp(0.06, 0.63, t);
    const len = 0.23 * (1 - Math.pow(Math.abs(t - 0.28) * 1.5, 1.8)) + 0.07;
    const g = new THREE.ConeGeometry(0.023 + 0.010 * (1 - Math.abs(t - 0.28)), len, 10, 1);
    g.translate(0, len / 2, 0);
    g.rotateZ(-(0.18 - t * 0.3));
    g.translate(x, -0.035, lerp(0.055, 0.155, smooth(t)));
    parts.push(g);
  }
  const half = merge(parts);
  return merge([half, mirrorZ(half)]);
}

/* =======================================================================
 *  VERTEBRAE
 * ==================================================================== */
function vertebra({ len, cRad, cDepth, spine, spineLean, spineW, tp, tpDrop, zyg = true, chevron = 0, hypo = 0 }) {
  const parts = [];
  // centrum: hourglass, opisthocoelous-ish ball at the front
  parts.push(sweep([[0, 0, 0], [len * 0.22, 0, 0], [len * 0.5, 0, 0], [len * 0.78, 0, 0], [len, 0, 0]],
    [cRad * 1.05, cRad * 0.78, cRad * 0.70, cRad * 0.80, cRad * 1.02],
    [cDepth * 1.02, cDepth * 0.76, cDepth * 0.70, cDepth * 0.80, cDepth * 1.0], { radial: 14, steps: 20 }));
  parts.push(blob([len * 0.99, 0, 0], cRad * 0.92, [0.55, 1.0, 1.0]));
  // neural arch
  const archTop = cDepth + spine * 0.10 + 0.05;
  parts.push(sweep([[len * 0.5, cDepth * 0.7, 0], [len * 0.5, archTop * 0.75, 0], [len * 0.5 + spineLean * 0.15, archTop, 0]],
    [cRad * 0.75, cRad * 0.55, cRad * 0.5], [cRad * 0.6, cRad * 0.45, cRad * 0.42], { radial: 10, steps: 10 }));
  // neural spine — a blade, thin laterally, tall
  if (spine > 0.02) {
    parts.push(sweep([
      [len * 0.5, archTop * 0.9, 0],
      [len * 0.5 + spineLean * 0.4, archTop + spine * 0.45, 0],
      [len * 0.5 + spineLean, archTop + spine, 0]],
      [spineW * 1.3, spineW * 1.15, spineW * 1.5],
      [len * 0.30, len * 0.27, len * 0.26], { radial: 10, steps: 14, section: 3 }));
  }
  // transverse processes / diapophyses
  if (tp > 0.02) {
    const arm = sweep([[len * 0.45, cDepth * 0.9, 0], [len * 0.45, cDepth * 0.95 - tpDrop * 0.5, tp * 0.55], [len * 0.44, cDepth * 0.9 - tpDrop, tp]],
      [len * 0.22, len * 0.18, len * 0.16], [cRad * 0.40, cRad * 0.32, cRad * 0.28], { radial: 10, steps: 12, section: 3 });
    parts.push(arm, mirrorZ(arm));
  }
  // zygapophyses
  if (zyg) {
    const z1 = blob([len * 0.06, cDepth + 0.04, cRad * 0.52], cRad * 0.24, [1.1, 0.6, 0.9]);
    const z2 = blob([len * 0.94, cDepth + 0.05, cRad * 0.50], cRad * 0.24, [1.1, 0.6, 0.9]);
    parts.push(z1, mirrorZ(z1), z2, mirrorZ(z2));
  }
  // haemal arch (chevron) under caudals
  if (chevron > 0.02) {
    const ch = sweep([[len * 0.9, -cDepth * 0.8, 0], [len * 0.95, -cDepth - chevron * 0.5, 0], [len * 0.9 - chevron * 0.35, -cDepth - chevron, 0]],
      [len * 0.18, len * 0.15, len * 0.13], [cRad * 0.34, cRad * 0.28, cRad * 0.24], { radial: 8, steps: 10, section: 3 });
    parts.push(ch);
  }
  if (hypo > 0.02) parts.push(blob([len * 0.5, -cDepth - hypo * 0.4, 0], hypo * 0.5, [1.4, 1.0, 0.5]));
  return merge(parts);
}

function cervicalRib(len, drop) {
  const g = sweep([[0, 0, 0], [len * 0.45, -drop * 0.5, 0.02], [len, -drop, 0.03]],
    [0.030, 0.026, 0.020], [0.030, 0.024, 0.017], { radial: 8, steps: 12 });
  return g;
}

function dorsalRib(len, curve, thick) {
  // capitulum/tuberculum head, a strong lateral bow, then the shaft turns
  // forward and medially toward the sternal end — a basket, not a hoop.
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const out = Math.sin(Math.pow(t, 0.85) * Math.PI * 0.80) * curve;
    const fwd = 0.20 * Math.sin(t * Math.PI * 0.9) - 0.26 * t * t;
    pts.push([fwd, -t * len, out]);
  }
  const w = [thick * 1.6, thick * 1.2, thick, thick, thick * 0.98, thick * 0.95,
             thick * 0.92, thick * 0.88, thick * 0.84, thick * 0.78, thick * 0.66];
  const d = w.map((v, i) => v * lerp(2.3, 1.05, i / 10));
  return sweep(pts, w, d, { radial: 10, steps: 40, section: 2.6 });
}

/* =======================================================================
 *  PELVIS, LIMBS
 * ==================================================================== */
function iliumGeometry() {
  // Sue: ilium ~1.45 m long. A tall thin blade with a straight dorsal margin,
  // a pointed preacetabular process, a squared postacetabular blade, and two
  // peduncles bracketing the acetabulum.
  const outline = [
    [-0.78, 0.06], [-0.74, 0.26], [-0.50, 0.36], [-0.14, 0.41], [0.24, 0.41],
    [0.50, 0.36], [0.63, 0.24], [0.66, 0.02], [0.58, -0.12], [0.44, -0.20],
    [0.30, -0.34], [0.16, -0.38], [0.06, -0.24], [-0.06, -0.30], [-0.26, -0.26],
    [-0.52, -0.16], [-0.72, -0.08],
  ];
  const g = plate(outline, 0.042, { bevel: 0.026, curveSegments: 4 });
  const rim = sweep([[-0.74, 0.26, 0], [-0.3, 0.38, 0], [0.2, 0.42, 0], [0.55, 0.32, 0], [0.66, 0.06, 0]],
    [0.030, 0.034, 0.034, 0.030, 0.026], [0.055, 0.062, 0.062, 0.055, 0.045], { radial: 10, steps: 22 });
  const acet = blob([0.10, -0.20, 0.0], 0.145, [1.15, 0.9, 0.62]);
  const brev = sweep([[0.10, -0.10, 0.0], [0.34, -0.06, 0.0], [0.58, -0.02, 0.0]],
    [0.030, 0.028, 0.024], [0.050, 0.045, 0.038], { radial: 8, steps: 12 });
  const merged = merge([g, rim, acet, brev]);
  merged.translate(0, -0.02, 0.255);
  return merge([merged, mirrorZ(merged)]);
}

function pubisGeometry() {
  const shaft = sweep([[0.10, -0.30, 0.125], [0.16, -0.72, 0.095], [0.20, -1.18, 0.075], [0.20, -1.52, 0.07]],
    [0.075, 0.048, 0.042, 0.048], [0.095, 0.062, 0.052, 0.058], { radial: 12, steps: 26 });
  const boot = sweep([[-0.16, -1.62, 0.06], [0.10, -1.66, 0.06], [0.40, -1.60, 0.06]],
    [0.095, 0.115, 0.085], [0.075, 0.09, 0.065], { radial: 12, steps: 16, section: 2.6 });
  const apron = plate([[0.10, -0.55], [0.19, -0.55], [0.21, -1.45], [0.14, -1.45]], 0.024, { bevel: 0.014 });
  apron.translate(0, 0, 0.035);
  const half = merge([shaft, boot, apron]);
  return merge([half, mirrorZ(half)]);
}

function ischiumGeometry() {
  const shaft = sweep([[-0.05, -0.28, 0.13], [-0.32, -0.60, 0.09], [-0.58, -0.92, 0.06], [-0.72, -1.10, 0.05]],
    [0.075, 0.05, 0.042, 0.048], [0.09, 0.06, 0.05, 0.055], { radial: 10, steps: 22 });
  const obt = plate([[-0.08, -0.34], [-0.30, -0.62], [-0.26, -0.70], [-0.04, -0.44]], 0.025, { bevel: 0.015 });
  obt.translate(0, 0, 0.05);
  const half = merge([shaft, obt]);
  return merge([half, mirrorZ(half)]);
}

function femurGeometry(L) {
  const parts = [];
  const g = longBone({ length: L, bow: 0.035, bowAxis: [1, 0, 0], prox: 0.155, shaft: 0.098, dist: 0.165, depth: 0.82 });
  g.rotateX(Math.PI);              // run downward along -Y
  parts.push(g);
  parts.push(blob([0, -0.085, -0.135], 0.105, [0.95, 0.95, 1.05]));          // medial head
  parts.push(sweep([[0, -0.075, -0.05], [0, -0.075, -0.115]], [0.085, 0.085], [0.085, 0.085], { radial: 10, steps: 6 }));
  parts.push(blob([-0.01, -0.11, 0.075], 0.085, [0.9, 1.5, 0.7]));            // greater trochanter
  parts.push(blob([0.07, -0.30, 0.02], 0.055, [0.7, 2.0, 0.6]));              // 4th trochanter ridge
  parts.push(blob([0.02, -L + 0.06, 0.085], 0.10, [1.0, 0.95, 0.85]));        // lateral condyle
  parts.push(blob([0.02, -L + 0.06, -0.085], 0.10, [1.0, 0.95, 0.85]));       // medial condyle
  return merge(parts);
}

function tibiaGeometry(L) {
  const parts = [];
  const t = longBone({ length: L, bow: 0.012, bowAxis: [-1, 0, 0], prox: 0.140, shaft: 0.078, dist: 0.115, depth: 0.85 });
  t.rotateX(Math.PI); parts.push(t);
  parts.push(blob([0.10, -0.13, 0.0], 0.075, [1.0, 1.7, 0.55]));              // cnemial crest
  parts.push(blob([0.0, -0.05, 0.07], 0.075, [1.0, 0.8, 0.9]));
  // fibula — slender, lateral, tapering to a splint
  parts.push(sweep([[0.015, -0.06, 0.105], [0.01, -L * 0.35, 0.11], [0.0, -L * 0.7, 0.085], [0.0, -L + 0.06, 0.07]],
    [0.050, 0.030, 0.021, 0.026], [0.062, 0.034, 0.024, 0.030], { radial: 10, steps: 24 }));
  // astragalus + calcaneum (ascending process up the tibia front)
  parts.push(blob([0.035, -L + 0.03, -0.02], 0.085, [1.0, 0.7, 1.15]));
  parts.push(sweep([[0.07, -L + 0.06, 0.0], [0.075, -L + 0.30, 0.0]], [0.055, 0.045], [0.030, 0.022], { radial: 8, steps: 6 }));
  return merge(parts);
}

function metatarsusGeometry(L) {
  // arctometatarsalian: MT III pinched between II and IV proximally
  const parts = [];
  const mt = (zTop, zBot, scaleTop, scaleBot, lenScale) => {
    const l = L * lenScale;
    return sweep([[0.0, 0, zTop], [0.005, -l * 0.3, lerp(zTop, zBot, 0.3)], [0.0, -l * 0.72, lerp(zTop, zBot, 0.8)], [0.0, -l, zBot]],
      [0.048 * scaleTop, 0.034, 0.036, 0.055 * scaleBot],
      [0.058 * scaleTop, 0.040, 0.042, 0.052 * scaleBot], { radial: 12, steps: 22 });
  };
  parts.push(mt(0.085, 0.115, 1.0, 1.0, 1.0));       // MT IV (lateral)
  parts.push(mt(0.0, 0.0, 0.55, 1.25, 1.0));          // MT III (pinched above)
  parts.push(mt(-0.085, -0.115, 1.0, 1.0, 0.97));     // MT II (medial)
  // MT I splint + hallux hanging behind-medial
  parts.push(sweep([[-0.02, -L * 0.62, -0.10], [-0.05, -L * 0.88, -0.115]], [0.022, 0.028], [0.026, 0.030], { radial: 8, steps: 8 }));
  parts.push(blob([0.0, -0.02, 0.0], 0.075, [1.1, 0.6, 1.7]));  // proximal block
  return merge(parts);
}

function toeGeometry(lengths, spread, claw) {
  // phalanges in series with inter-phalangeal condyles, ending in an ungual
  const parts = [];
  let x = 0, y = 0, ang = 0;
  for (let i = 0; i < lengths.length; i++) {
    const L = lengths[i];
    ang += (i === 0 ? 0.10 : 0.22);
    const dx = Math.cos(-ang) * L, dy = Math.sin(-ang) * L;
    const r0 = 0.052 - i * 0.006, r1 = 0.046 - i * 0.006;
    parts.push(sweep([[x, y, 0], [x + dx * 0.25, y + dy * 0.25, 0], [x + dx * 0.75, y + dy * 0.75, 0], [x + dx, y + dy, 0]],
      [r0 * 1.15, r0 * 0.82, r1 * 0.85, r1 * 1.2], [r0 * 1.2, r0 * 0.9, r1 * 0.9, r1 * 1.25], { radial: 10, steps: 14 }));
    parts.push(blob([x + dx, y + dy, 0], r1 * 1.05, [0.9, 1.0, 1.25]));
    x += dx; y += dy;
  }
  // ungual (claw): curved, laterally compressed, sharp
  const cl = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = -ang - t * 0.85;
    cl.push([x + Math.cos(a) * claw * t, y + Math.sin(a) * claw * t - t * t * claw * 0.12, 0]);
  }
  parts.push(sweep(cl, [0.050, 0.044, 0.036, 0.028, 0.020, 0.012, 0.004],
    [0.055, 0.050, 0.042, 0.033, 0.023, 0.013, 0.004], { radial: 10, steps: 18, section: 2.4 }));
  const g = merge(parts);
  g.rotateY(spread);
  return g;
}

function scapulocoracoid() {
  // strap-like blade running up-and-back over the ribs, expanded at both ends;
  // coracoid is a smaller rounded plate with a hooked ventral process.
  const blade = sweep([
    [-0.74, 0.60, 0.0], [-0.55, 0.40, 0.0], [-0.34, 0.18, 0.0], [-0.14, -0.04, 0.0], [-0.02, -0.20, 0.0]],
    [0.135, 0.085, 0.070, 0.078, 0.095], [0.028, 0.024, 0.026, 0.034, 0.050],
    { radial: 12, steps: 26, section: 2.6 });
  const corOutline = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    corOutline.push([0.06 + Math.cos(a) * 0.17, -0.32 + Math.sin(a) * 0.155 - (a > Math.PI ? 0.05 : 0)]);
  }
  const cor = plate(corOutline, 0.05, { bevel: 0.028, curveSegments: 4 });
  const hook = sweep([[0.02, -0.44, 0], [0.0, -0.54, 0], [-0.08, -0.58, 0]], [0.05, 0.045, 0.04], [0.04, 0.035, 0.03], { radial: 8, steps: 10 });
  const glen = blob([0.0, -0.30, 0.0], 0.075, [1.0, 0.95, 0.85]);
  const half = merge([blade, cor, hook, glen]);
  half.rotateY(-0.22);
  half.rotateZ(0.12);
  half.translate(0, 0, 0.40);
  return merge([half, mirrorZ(half)]);
}

function forelimbGeometry() {
  const parts = [];
  const h = longBone({ length: DIM.humerus, bow: 0.05, bowAxis: [1, 0, 0], prox: 0.062, shaft: 0.032, dist: 0.052, depth: 0.85 });
  h.rotateX(Math.PI);
  parts.push(h, blob([0.03, -0.09, 0.0], 0.038, [1.2, 1.5, 0.7]));  // deltopectoral crest
  return merge(parts);
}

function forearmGeometry() {
  const L = DIM.forearm, parts = [];
  const r = longBone({ length: L, bow: 0.02, bowAxis: [1, 0, 0], prox: 0.040, shaft: 0.024, dist: 0.034, depth: 0.9 });
  r.rotateX(Math.PI); r.translate(0, 0, -0.022);
  const u = longBone({ length: L * 1.02, bow: 0.03, bowAxis: [-1, 0, 0], prox: 0.048, shaft: 0.026, dist: 0.032, depth: 0.9 });
  u.rotateX(Math.PI); u.translate(0, 0, 0.026);
  parts.push(r, u, blob([-0.03, -0.02, 0.026], 0.040, [1.3, 1.0, 0.8])); // olecranon
  return merge(parts);
}

function handGeometry() {
  const parts = [];
  parts.push(blob([0, -0.03, 0], 0.045, [1.0, 0.8, 1.5]));   // carpus
  // two functional digits (II and III), each ending in a big recurved ungual
  const digit = (z, lens, claw, splay) => {
    const g = toeGeometry(lens, 0, claw);
    g.scale(0.72, 0.72, 0.62);
    g.rotateZ(-1.15 + splay);
    g.rotateY(splay * 0.8);
    g.translate(0, -0.055, z);
    parts.push(g);
  };
  digit(-0.035, [0.10, 0.085], 0.10, 0.0);
  digit(0.035, [0.085, 0.07, 0.055], 0.085, 0.12);
  return merge(parts);
}

function gastraliaGeometry(xStart, xEnd, count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = lerp(xStart, xEnd, t);
    const w = 0.34 + 0.20 * Math.sin(t * Math.PI);
    const drop = 0.06 * Math.sin(t * Math.PI);
    const g = sweep([[x, -drop * 0.2, 0.02], [x - 0.04, -drop * 0.7, w * 0.6], [x - 0.10, -drop, w]],
      [0.020, 0.017, 0.013], [0.024, 0.020, 0.015], { radial: 8, steps: 10 });
    parts.push(g, mirrorZ(g));
  }
  return merge(parts);
}

/* =======================================================================
 *  ASSEMBLY
 * ==================================================================== */
export function buildRex() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0.03,
    flatShading: false,
  });

  const M = (geo, seed) => {
    roughen(geo, 0.0042, 9);
    weather(geo, seed);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };

  const root = new THREE.Group();                 // world transform of the animal
  const body = new THREE.Group();                 // pelvis-anchored body
  body.position.y = DIM.hipHeight;
  root.add(body);

  const rig = { root, body, joints: {}, meshes: {} };

  /* ---- pelvis ---- */
  const pelvis = new THREE.Group();
  body.add(pelvis);
  const pelvisGeo = merge([iliumGeometry(), pubisGeometry(), ischiumGeometry()]);
  pelvis.add(M(pelvisGeo, 3));
  rig.joints.pelvis = pelvis;

  /* ---- sacrum + dorsal + cervical chain (forward from pelvis) ---- */
  const [nDor, dorLen] = DIM.dorsal, [nCer, cerLen] = DIM.cervical, [nSac, sacLen] = DIM.sacral;

  // sacrum block (fused), drawn in pelvis space
  const sacParts = [];
  for (let i = 0; i < nSac; i++) {
    const l = sacLen / nSac;
    const v = vertebra({ len: l, cRad: 0.115, cDepth: 0.10, spine: 0.40, spineLean: 0.0, spineW: 0.030, tp: 0.26, tpDrop: 0.02 });
    v.translate(-sacLen * 0.42 + i * l, 0.16, 0);
    sacParts.push(v);
  }
  pelvis.add(M(merge(sacParts), 4));

  // spine chain forward
  const spineNodes = [];
  let cursor = new THREE.Group();
  cursor.position.set(sacLen * 0.58, 0.16, 0);
  pelvis.add(cursor);
  spineNodes.push(cursor);

  const dorsalNodes = [];
  for (let i = 0; i < nDor; i++) {
    const t = i / (nDor - 1);                       // 0 = posterior, 1 = anterior
    const l = (dorLen / nDor) * lerp(1.06, 0.92, t);
    const node = new THREE.Group();
    node.position.set(i === 0 ? 0.02 : prevLen, 0, 0);
    // gentle dorsal curve: hips lower than shoulders
    node.rotation.z = i === 0 ? 0.01 : lerp(0.009, 0.004, t);
    cursor.add(node);
    var prevLen = l;
    const cRad = lerp(0.135, 0.115, t);
    const spineH = lerp(0.46, 0.30, Math.pow(t, 0.7));
    const vg = vertebra({ len: l, cRad, cDepth: cRad * 0.85, spine: spineH, spineLean: lerp(-0.05, 0.06, t), spineW: 0.032, tp: lerp(0.22, 0.17, t), tpDrop: lerp(0.0, 0.03, t) });
    const parts = [vg];
    // ribs: full-length in the middle of the ribcage, short at both ends
    const ribLen = 2.20 * Math.sin(Math.pow(clamp((t + 0.06), 0, 1), 0.55) * Math.PI * 0.86) * lerp(0.75, 1.0, smooth(clamp(t * 1.4, 0, 1)));
    if (ribLen > 0.25) {
      const rb = dorsalRib(ribLen, 0.30 + 0.42 * Math.sin(t * Math.PI), 0.032);
      rb.translate(l * 0.45, cRad * 0.78, 0.13 + cRad * 0.4);
      rb.rotateY(0);
      parts.push(rb, mirrorZ(rb));
    }
    node.add(M(merge(parts), 10 + i));
    dorsalNodes.push(node);
    cursor = node;
    spineNodes.push(node);
  }
  rig.joints.dorsals = dorsalNodes;

  // gastralia hung under the middle dorsals
  const gast = M(gastraliaGeometry(-0.45, 0.75, 11), 55);
  gast.position.set(0.1, -1.30, 0);
  dorsalNodes[Math.floor(nDor * 0.55)].add(gast);

  // pectoral girdle + arms hang from an anterior dorsal
  const shoulderHost = dorsalNodes[nDor - 3];
  const girdle = new THREE.Group();
  girdle.position.set(0.05, -0.62, 0);
  shoulderHost.add(girdle);
  girdle.add(M(scapulocoracoid(), 61));

  for (const side of [1, -1]) {
    const sh = new THREE.Group();
    sh.position.set(0.02, -0.30, 0.42 * side);
    sh.rotation.set(0, 0, -0.9);
    sh.rotation.y = -0.25 * side;
    girdle.add(sh);
    sh.add(M(forelimbGeometry(), 70 + side));
    const el = new THREE.Group();
    el.position.y = -DIM.humerus;
    el.rotation.z = 1.15;
    sh.add(el);
    el.add(M(forearmGeometry(), 72 + side));
    const wr = new THREE.Group();
    wr.position.y = -DIM.forearm;
    el.add(wr);
    wr.add(M(handGeometry(), 74 + side));
    rig.joints[`arm${side > 0 ? 'L' : 'R'}`] = { shoulder: sh, elbow: el, wrist: wr };
  }

  // cervical chain: the classic S-curve
  const cervicalNodes = [];
  let cprev = 0.0;
  let cnode = cursor;
  for (let i = 0; i < nCer; i++) {
    const t = i / (nCer - 1);                       // 0 = base of neck, 1 = skull
    const l = (cerLen / nCer) * lerp(1.15, 0.72, t);
    const node = new THREE.Group();
    node.position.set(i === 0 ? 0.06 : cprev, 0, 0);
    // S-curve: rise steeply out of the shoulders, then level and dip to the head
    node.rotation.z = i === 0 ? 0.24 : lerp(0.135, -0.30, smooth(t));
    cnode.add(node);
    cprev = l;
    const cRad = lerp(0.115, 0.075, t);
    const vg = vertebra({
      len: l, cRad, cDepth: cRad * 0.82, spine: lerp(0.24, 0.10, t), spineLean: -0.05,
      spineW: 0.030, tp: lerp(0.15, 0.10, t), tpDrop: 0.05,
    });
    const parts = [vg];
    if (i > 0 && i < nCer - 1) {
      const cr = cervicalRib(l * 1.7, 0.10);
      cr.translate(l * 0.5, -cRad * 0.6, cRad * 0.75);
      parts.push(cr, mirrorZ(cr));
    }
    node.add(M(merge(parts), 100 + i));
    cervicalNodes.push(node);
    cnode = node;
  }
  rig.joints.cervicals = cervicalNodes;

  // skull
  const skullNode = new THREE.Group();
  skullNode.position.set(cprev + 0.02, 0.02, 0);
  skullNode.rotation.z = -0.26;
  cnode.add(skullNode);
  const skullPivot = new THREE.Group();            // occipital condyle at the origin
  skullNode.add(skullPivot);
  const skullMesh = M(skullGeometry(), 200);
  skullMesh.position.set(-1.36, -0.16, 0);         // bring occipital condyle to pivot
  skullPivot.add(skullMesh);
  rig.joints.skull = skullPivot;

  const jaw = new THREE.Group();
  jaw.position.set(-1.36 + 1.145, -0.16 - 0.02, 0);  // jaw joint at the quadrate
  skullPivot.add(jaw);
  const jawMesh = M(mandibleGeometry(), 210);
  jawMesh.position.set(-1.145, 0.02, 0);
  jaw.add(jawMesh);
  rig.joints.jaw = jaw;

  /* ---- tail: 40 caudals, each its own joint for secondary motion ---- */
  const [nCau, cauLen] = DIM.caudal;
  const tailBase = new THREE.Group();
  tailBase.position.set(-DIM.sacral[1] * 0.46, 0.14, 0);
  tailBase.rotation.y = Math.PI;                   // chain runs backwards
  pelvis.add(tailBase);
  const caudalNodes = [];
  let tprev = 0;
  let tnode = tailBase;
  for (let i = 0; i < nCau; i++) {
    const t = i / (nCau - 1);
    const l = (cauLen / nCau) * lerp(1.45, 0.42, Math.pow(t, 0.8));
    const node = new THREE.Group();
    node.position.set(i === 0 ? 0.02 : tprev, 0, 0);
    node.rotation.z = i === 0 ? 0.02 : lerp(0.002, 0.006, t);  // slight droop then straight
    tnode.add(node);
    tprev = l;
    const cRad = lerp(0.135, 0.016, Math.pow(t, 0.75));
    const spine = lerp(0.42, 0.0, clamp(t * 1.5, 0, 1));
    const chev = t > 0.02 && t < 0.80 ? lerp(0.34, 0.05, t) : 0;
    const vg = vertebra({
      len: l, cRad, cDepth: cRad * 0.88, spine, spineLean: 0.05, spineW: 0.026,
      tp: t < 0.45 ? lerp(0.28, 0.03, t / 0.45) : 0, tpDrop: 0.01, chevron: chev, zyg: t < 0.9,
    });
    node.add(M(vg, 300 + i));
    caudalNodes.push(node);
    tnode = node;
  }
  rig.joints.caudals = caudalNodes;
  rig.joints.tailBase = tailBase;

  /* ---- hind limbs ---- */
  for (const side of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(0.10, -0.20, DIM.hipHalfWidth * side);
    pelvis.add(hip);
    hip.add(M(femurGeometry(DIM.femur), 400 + side));

    const knee = new THREE.Group();
    knee.position.y = -DIM.femur;
    hip.add(knee);
    knee.add(M(tibiaGeometry(DIM.tibia), 410 + side));

    const ankle = new THREE.Group();
    ankle.position.y = -DIM.tibia;
    knee.add(ankle);
    ankle.add(M(metatarsusGeometry(DIM.metatarsus), 420 + side));

    const foot = new THREE.Group();
    foot.position.y = -DIM.metatarsus;
    ankle.add(foot);
    const toes = [];
    const digitSpecs = [
      { z: 0.115, lens: [0.20, 0.17, 0.13], claw: 0.17, spread: 0.30 },   // IV
      { z: 0.0, lens: [0.24, 0.19, 0.15], claw: 0.19, spread: 0.0 },      // III
      { z: -0.115, lens: [0.20, 0.17, 0.13], claw: 0.17, spread: -0.30 }, // II
    ];
    for (const d of digitSpecs) {
      const tn = new THREE.Group();
      tn.position.set(0.02, -0.02, d.z);
      foot.add(tn);
      tn.add(M(toeGeometry(d.lens, d.spread, d.claw), 430 + d.z * 100 + side));
      toes.push(tn);
    }
    // hallux pointing back-medially
    const hal = new THREE.Group();
    hal.position.set(-0.05, -0.16, -0.115 * side);
    ankle.add(hal);
    const halG = toeGeometry([0.10, 0.08], 0, 0.10);
    halG.scale(0.8, 0.8, 0.8); halG.rotateZ(-0.5); halG.rotateY(Math.PI * (side > 0 ? 1 : 1));
    hal.add(M(halG, 440 + side));

    rig.joints[`leg${side > 0 ? 'L' : 'R'}`] = { hip, knee, ankle, foot, toes, side };
  }

  rig.material = mat;
  return rig;
}
