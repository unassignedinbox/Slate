// Street furniture. Each category builds into its own MeshBuilder so the layer stack can toggle
// them independently, and every piece is lathed/swept/lofted geometry — no cards, no billboards,
// no low-poly stand-ins.

import { MeshBuilder, SURF } from '../core/mesh.js';
import { box, cylinder, lathe, sweep, loft, quadPatch, frameFor } from '../core/geokit.js';
import {
  v3, v3add, v3sub, v3scale, v3madd, v3norm, normXZ, clamp, lerp, TAU,
} from '../core/math.js';
import { laneBand, ROAD_CLASS, GUTTER_WIDTH, KERB } from './profile.js';
import { worldSection } from './section.js';

export const PROP_LAYERS = [
  'lighting', 'signals', 'signage', 'bollards', 'railings', 'billboards',
  'furniture', 'construction', 'drainage',
];

const STEEL = { surface: SURF.METAL };
const RUST = { surface: SURF.STEEL_RUST };
const CONCRETE = { surface: SURF.CONCRETE };
const PLASTIC = { surface: SURF.PLASTIC };
const PAINTED = { surface: SURF.PAINTED_CONCRETE };

/* ------------------------------------------------------------------ individual props */

/** Modern tapered column with a curved outreach arm and a flat luminaire. */
export function lampPost(mb, pos, yaw, opts = {}) {
  const height = opts.height ?? 9.0;
  const reach = opts.reach ?? 1.9;
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  mb.attr({ surface: SURF.CONCRETE });
  lathe(mb, { x: pos.x, y: pos.y, z: pos.z }, [
    { x: 0.30, y: 0.0 }, { x: 0.30, y: 0.09 }, { x: 0.24, y: 0.13 }, { x: 0.165, y: 0.16 },
  ], 14, { surface: SURF.CONCRETE });
  mb.attr({ surface: SURF.METAL });
  // door panel + base flange
  cylinder(mb, { ...pos, y: pos.y + 0.14 }, { ...pos, y: pos.y + 0.55 }, 0.145, 0.135, 14, { attrs: STEEL });
  cylinder(mb, { ...pos, y: pos.y + 0.55 }, { ...pos, y: pos.y + height * 0.72 }, 0.135, 0.095, 14, { attrs: STEEL });
  cylinder(mb, { ...pos, y: pos.y + height * 0.72 }, { ...pos, y: pos.y + height }, 0.095, 0.075, 14, { attrs: STEEL });
  // swept arm
  const path = [];
  const segs = 7;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push({
      x: pos.x + dir.x * reach * t,
      y: pos.y + height + Math.sin(t * Math.PI * 0.5) * 0.52,
      z: pos.z + dir.z * reach * t,
    });
  }
  const armProfile = [
    { x: -0.055, y: -0.055 }, { x: 0.055, y: -0.055 }, { x: 0.055, y: 0.055 }, { x: -0.055, y: 0.055 },
  ];
  sweep(mb, path, armProfile, { surface: SURF.METAL, closedProfile: true, capEnds: true });
  // luminaire housing + lens
  const head = path[path.length - 1];
  const hp = { x: head.x + dir.x * 0.34, y: head.y - 0.03, z: head.z + dir.z * 0.34 };
  box(mb, hp, { x: 0.78, y: 0.13, z: 0.34 }, { yaw, attrs: STEEL });
  mb.attr({ surface: SURF.LAMP_LENS });
  box(mb, { x: hp.x, y: hp.y - 0.075, z: hp.z }, { x: 0.68, y: 0.035, z: 0.27 }, { yaw, attrs: { surface: SURF.LAMP_LENS } });
  return { lightPos: { x: hp.x, y: hp.y - 0.1, z: hp.z }, head: hp };
}

/** Mast-arm signal assembly: pole, outreach, primary head(s), pedestrian head, controller box. */
export function trafficSignal(mb, pos, yaw, reach, groupId, opts = {}) {
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const h = 6.2;
  mb.attr({ surface: SURF.METAL });
  lathe(mb, pos, [{ x: 0.26, y: 0 }, { x: 0.26, y: 0.1 }, { x: 0.2, y: 0.14 }], 12, { surface: SURF.CONCRETE });
  cylinder(mb, { ...pos, y: pos.y + 0.12 }, { ...pos, y: pos.y + h }, 0.115, 0.095, 14, { attrs: STEEL });
  const arm = Math.max(1.2, reach);
  const elbow = { x: pos.x, y: pos.y + h, z: pos.z };
  const tip = { x: pos.x + dir.x * arm, y: pos.y + h - 0.12, z: pos.z + dir.z * arm };
  const path = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    path.push({
      x: lerp(elbow.x, tip.x, t),
      y: elbow.y + Math.sin(t * Math.PI) * 0.1 - 0.12 * t,
      z: lerp(elbow.z, tip.z, t),
    });
  }
  sweep(mb, path, [
    { x: -0.05, y: -0.05 }, { x: 0.05, y: -0.05 }, { x: 0.05, y: 0.05 }, { x: -0.05, y: 0.05 },
  ], { surface: SURF.METAL, closedProfile: true, capEnds: true });

  const headAt = (p, gid) => {
    box(mb, { x: p.x, y: p.y - 0.52, z: p.z }, { x: 0.34, y: 0.98, z: 0.3 }, { yaw, attrs: { surface: SURF.PLASTIC } });
    for (let l = 0; l < 3; l++) {
      const ly = p.y - 0.16 - l * 0.32;
      const cx = p.x + Math.cos(yaw + Math.PI / 2) * 0;
      mb.attr({ surface: SURF.SIGNAL_LENS });
      cylinder(mb,
        { x: cx - dir.x * 0.15, y: ly, z: p.z - dir.z * 0.15 },
        { x: cx - dir.x * 0.19, y: ly, z: p.z - dir.z * 0.19 },
        0.115, 0.1, 12,
        { attrs: { surface: SURF.SIGNAL_LENS, laneA: gid, laneB: l } });
      mb.attr({ surface: SURF.PLASTIC });
      // visor
      cylinder(mb,
        { x: cx - dir.x * 0.19, y: ly, z: p.z - dir.z * 0.19 },
        { x: cx - dir.x * 0.32, y: ly + 0.03, z: p.z - dir.z * 0.32 },
        0.125, 0.13, 12, { attrs: PLASTIC, capStart: false, capEnd: false });
    }
  };
  headAt({ x: tip.x, y: tip.y, z: tip.z }, groupId);
  if (opts.secondary !== false) headAt({ x: pos.x + dir.x * 0.3, y: pos.y + 3.3, z: pos.z + dir.z * 0.3 }, groupId);

  // pedestrian head facing across the footway
  const px = pos.x - dir.x * 0.26, pz = pos.z - dir.z * 0.26;
  box(mb, { x: px, y: pos.y + 2.4, z: pz }, { x: 0.3, y: 0.44, z: 0.26 }, { yaw: yaw + Math.PI, attrs: PLASTIC });
  mb.attr({ surface: SURF.SIGNAL_LENS });
  box(mb, { x: px - dir.x * 0.14, y: pos.y + 2.4, z: pz - dir.z * 0.14 }, { x: 0.22, y: 0.34, z: 0.04 },
    { yaw: yaw + Math.PI, attrs: { surface: SURF.SIGNAL_LENS, laneA: groupId, laneB: 3 } });
  mb.attr({ surface: SURF.METAL });
  box(mb, { x: pos.x - dir.x * 0.55, y: pos.y + 0.62, z: pos.z - dir.z * 0.55 }, { x: 0.52, y: 1.15, z: 0.38 }, { yaw, attrs: STEEL });
  return { tip };
}

const BOLLARD_DESIGNS = ['steel', 'heritage', 'concrete', 'removable'];

export function bollard(mb, pos, design = 'steel', yaw = 0) {
  switch (design) {
    case 'heritage': {
      lathe(mb, pos, [
        { x: 0.16, y: 0 }, { x: 0.17, y: 0.07 }, { x: 0.13, y: 0.1 }, { x: 0.115, y: 0.55 },
        { x: 0.125, y: 0.62 }, { x: 0.1, y: 0.68 }, { x: 0.105, y: 0.78 }, { x: 0.075, y: 0.86 },
        { x: 0.09, y: 0.9 }, { x: 0.06, y: 0.97 }, { x: 0.0, y: 1.0 },
      ], 16, { surface: SURF.METAL });
      break;
    }
    case 'concrete': {
      lathe(mb, pos, [
        { x: 0.21, y: 0 }, { x: 0.2, y: 0.08 }, { x: 0.18, y: 0.72 }, { x: 0.165, y: 0.82 },
        { x: 0.12, y: 0.88 }, { x: 0.0, y: 0.9 },
      ], 14, { surface: SURF.CONCRETE });
      break;
    }
    case 'removable': {
      lathe(mb, pos, [
        { x: 0.17, y: 0 }, { x: 0.17, y: 0.04 }, { x: 0.085, y: 0.05 }, { x: 0.085, y: 0.9 },
        { x: 0.07, y: 0.95 }, { x: 0.0, y: 0.97 },
      ], 14, { surface: SURF.METAL });
      mb.attr({ surface: SURF.PLASTIC });
      cylinder(mb, { ...pos, y: pos.y + 0.78 }, { ...pos, y: pos.y + 0.84 }, 0.095, 0.095, 12, { attrs: PLASTIC });
      break;
    }
    default: {
      lathe(mb, pos, [
        { x: 0.12, y: 0 }, { x: 0.115, y: 0.05 }, { x: 0.1, y: 0.07 }, { x: 0.1, y: 0.95 },
        { x: 0.085, y: 1.0 }, { x: 0.0, y: 1.02 },
      ], 14, { surface: SURF.METAL });
      mb.attr({ surface: SURF.PLASTIC });
      cylinder(mb, { ...pos, y: pos.y + 0.82 }, { ...pos, y: pos.y + 0.9 }, 0.104, 0.104, 14, { attrs: { surface: SURF.PLASTIC } });
    }
  }
}

/** Pedestrian guardrail: posts + top rail + mid infill. */
export function pedestrianRailing(mb, path, opts = {}) {
  if (path.length < 2) return;
  const h = opts.height ?? 1.08;
  sweep(mb, path, [
    { x: -0.035, y: h - 0.07 }, { x: 0.035, y: h - 0.07 }, { x: 0.035, y: h }, { x: -0.035, y: h },
  ], { surface: SURF.METAL, closedProfile: true, capEnds: true });
  sweep(mb, path, [
    { x: -0.025, y: h - 0.52 }, { x: 0.025, y: h - 0.52 }, { x: 0.025, y: h - 0.47 }, { x: -0.025, y: h - 0.47 },
  ], { surface: SURF.METAL, closedProfile: true, capEnds: true });
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (i > 0 && acc < (opts.postSpacing ?? 2.0)) continue;
    acc = 0;
    const p = path[i];
    cylinder(mb, p, { x: p.x, y: p.y + h, z: p.z }, 0.042, 0.038, 10, { attrs: STEEL });
  }
}

/** Corrugated W-beam barrier with sigma posts. */
export function wBeamBarrier(mb, path, opts = {}) {
  if (path.length < 2) return;
  const h = opts.height ?? 0.73;
  const beam = [
    { x: 0.0, y: h - 0.18 }, { x: -0.08, y: h - 0.12 }, { x: -0.085, y: h - 0.04 },
    { x: -0.02, y: h + 0.02 }, { x: -0.085, y: h + 0.08 }, { x: -0.08, y: h + 0.16 },
    { x: 0.0, y: h + 0.22 }, { x: 0.02, y: h + 0.2 }, { x: -0.055, y: h + 0.14 },
    { x: -0.0, y: h + 0.03 }, { x: -0.055, y: h - 0.08 }, { x: 0.02, y: h - 0.16 },
  ];
  sweep(mb, path, beam, { surface: SURF.METAL, closedProfile: true });
  let acc = 1e9;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (acc < (opts.postSpacing ?? 3.2)) continue;
    acc = 0;
    const p = path[i];
    const dir = normXZ(v3sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(0, i - 1)]));
    const right = { x: dir.z, y: 0, z: -dir.x };
    const bp = { x: p.x + right.x * 0.09, y: p.y, z: p.z + right.z * 0.09 };
    box(mb, { x: bp.x, y: bp.y + (h + 0.02) / 2, z: bp.z }, { x: 0.12, y: h + 0.04, z: 0.16 },
      { yaw: Math.atan2(dir.z, dir.x), attrs: RUST });
  }
}

/** Roadside billboard: lattice mast, frame, panel. */
export function billboard(mb, pos, yaw, opts = {}) {
  const h = opts.height ?? 7.5;
  const w = opts.width ?? 9.6;
  const panelH = opts.panelHeight ?? 4.2;
  mb.attr({ surface: SURF.CONCRETE });
  box(mb, { x: pos.x, y: pos.y + 0.18, z: pos.z }, { x: 1.9, y: 0.36, z: 1.9 }, { yaw, attrs: CONCRETE });
  const mast = { x: pos.x, y: pos.y, z: pos.z };
  cylinder(mb, { ...mast, y: pos.y + 0.3 }, { ...mast, y: pos.y + h }, 0.42, 0.36, 16, { attrs: RUST });
  // cross-bracing
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const side = { x: -dir.z, y: 0, z: dir.x };
  for (let i = 0; i < 4; i++) {
    const y0 = pos.y + h * (0.35 + i * 0.14);
    cylinder(mb,
      { x: mast.x - side.x * 0.36, y: y0, z: mast.z - side.z * 0.36 },
      { x: mast.x + side.x * 0.36, y: y0 + 0.5, z: mast.z + side.z * 0.36 },
      0.05, 0.05, 8, { attrs: RUST });
  }
  const centre = { x: pos.x, y: pos.y + h + panelH / 2 - 0.4, z: pos.z };
  box(mb, centre, { x: w, y: panelH, z: 0.34 }, { yaw: yaw + Math.PI / 2, attrs: STEEL });
  mb.attr({ surface: SURF.BILLBOARD });
  box(mb, { x: centre.x + dir.x * 0.2, y: centre.y, z: centre.z + dir.z * 0.2 },
    { x: w - 0.3, y: panelH - 0.26, z: 0.06 }, { yaw: yaw + Math.PI / 2, attrs: { surface: SURF.BILLBOARD } });
  // gantry lights
  for (let i = -1; i <= 1; i += 2) {
    const lp = { x: centre.x + side.x * (w * 0.3 * i) + dir.x * 1.0, y: centre.y - panelH / 2 - 0.2, z: centre.z + side.z * (w * 0.3 * i) + dir.z * 1.0 };
    cylinder(mb, { x: lp.x - dir.x * 0.8, y: lp.y - 0.1, z: lp.z - dir.z * 0.8 }, lp, 0.045, 0.045, 8, { attrs: STEEL });
    box(mb, lp, { x: 0.5, y: 0.16, z: 0.18 }, { yaw: yaw + Math.PI / 2, attrs: { surface: SURF.LAMP_LENS } });
  }
  return { centre };
}

/** Pole-mounted sign plate: disc, triangle or rectangle. */
export function signPost(mb, pos, yaw, kind = 'speed', opts = {}) {
  const h = opts.height ?? 2.35;
  cylinder(mb, pos, { x: pos.x, y: pos.y + h, z: pos.z }, 0.042, 0.04, 10, { attrs: STEEL });
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const face = { x: pos.x + dir.x * 0.04, y: pos.y + h - 0.05, z: pos.z + dir.z * 0.04 };
  const surf = kind === 'stop' ? SURF.SIGN_STOP : kind === 'giveway' ? SURF.SIGN_GIVEWAY : kind === 'parking' ? SURF.SIGN_INFO : SURF.SIGN_SPEED;
  mb.attr({ surface: surf });
  if (kind === 'giveway') {
    const r = 0.42;
    const idx = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 2;
      idx.push(mb.vertex({
        x: face.x + Math.cos(a) * r * -dir.z, y: face.y + Math.sin(a) * r, z: face.z + Math.cos(a) * r * dir.x,
      }, { u: Math.cos(a), v: Math.sin(a), surface: surf }));
    }
    mb.tri(idx[0], idx[1], idx[2]);
    mb.tri(idx[2], idx[1], idx[0]);
  } else if (kind === 'info' || kind === 'parking') {
    box(mb, face, { x: 0.62, y: 0.82, z: 0.035 }, { yaw: yaw + Math.PI / 2, attrs: { surface: surf } });
  } else {
    lathe(mb, { x: face.x, y: face.y, z: face.z }, [{ x: 0, y: 0 }, { x: 0.36, y: 0 }, { x: 0.36, y: 0.03 }, { x: 0, y: 0.03 }], 18, { surface: surf });
  }
}

export function trafficCone(mb, pos, scale = 1) {
  mb.attr({ surface: SURF.PLASTIC });
  box(mb, { x: pos.x, y: pos.y + 0.022 * scale, z: pos.z }, { x: 0.38 * scale, y: 0.045 * scale, z: 0.38 * scale }, { attrs: PLASTIC });
  lathe(mb, { x: pos.x, y: pos.y + 0.04 * scale, z: pos.z }, [
    { x: 0.14 * scale, y: 0 }, { x: 0.115 * scale, y: 0.2 * scale }, { x: 0.085 * scale, y: 0.42 * scale },
    { x: 0.055 * scale, y: 0.62 * scale }, { x: 0.04 * scale, y: 0.70 * scale }, { x: 0.0, y: 0.73 * scale },
  ], 12, { surface: SURF.CONE });
}

export function waterBarrier(mb, pos, yaw) {
  mb.attr({ surface: SURF.BARRIER });
  const prof = [
    { x: -0.24, y: 0 }, { x: 0.24, y: 0 }, { x: 0.18, y: 0.26 }, { x: 0.12, y: 0.78 },
    { x: 0.14, y: 0.95 }, { x: -0.14, y: 0.95 }, { x: -0.12, y: 0.78 }, { x: -0.18, y: 0.26 },
  ];
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  sweep(mb, [
    { x: pos.x - dir.x * 0.95, y: pos.y, z: pos.z - dir.z * 0.95 },
    { x: pos.x, y: pos.y, z: pos.z },
    { x: pos.x + dir.x * 0.95, y: pos.y, z: pos.z + dir.z * 0.95 },
  ], prof, { surface: SURF.BARRIER, closedProfile: true, capEnds: true });
}

export function gullyGrate(mb, pos, yaw) {
  mb.attr({ surface: SURF.METAL });
  const w = 0.44, l = 0.62;
  box(mb, { x: pos.x, y: pos.y - 0.022, z: pos.z }, { x: w + 0.1, y: 0.05, z: l + 0.1 }, { yaw, attrs: RUST });
  for (let i = -2; i <= 2; i++) {
    box(mb, {
      x: pos.x + Math.cos(yaw + Math.PI / 2) * i * 0.085,
      y: pos.y - 0.012,
      z: pos.z + Math.sin(yaw + Math.PI / 2) * i * 0.085,
    }, { x: 0.045, y: 0.03, z: l - 0.08 }, { yaw, attrs: RUST });
  }
}

export function manhole(mb, pos) {
  mb.attr({ surface: SURF.STEEL_RUST });
  lathe(mb, { x: pos.x, y: pos.y - 0.005, z: pos.z }, [
    { x: 0.0, y: 0.018 }, { x: 0.29, y: 0.016 }, { x: 0.31, y: 0.006 }, { x: 0.33, y: 0.0 },
  ], 20, { surface: SURF.STEEL_RUST });
}

export function busShelter(mb, pos, yaw) {
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const side = { x: -dir.z, y: 0, z: dir.x };
  mb.attr({ surface: SURF.METAL });
  for (let i = -1; i <= 1; i += 2) {
    for (let j = -1; j <= 1; j += 2) {
      const p = {
        x: pos.x + side.x * 1.9 * i + dir.x * 0.65 * j,
        y: pos.y,
        z: pos.z + side.z * 1.9 * i + dir.z * 0.65 * j,
      };
      cylinder(mb, p, { x: p.x, y: p.y + 2.5, z: p.z }, 0.05, 0.05, 8, { attrs: STEEL });
    }
  }
  box(mb, { x: pos.x, y: pos.y + 2.58, z: pos.z }, { x: 4.3, y: 0.11, z: 1.65 }, { yaw, attrs: STEEL });
  mb.attr({ surface: SURF.GLASS });
  box(mb, { x: pos.x - dir.x * 0.68, y: pos.y + 1.3, z: pos.z - dir.z * 0.68 }, { x: 4.1, y: 2.3, z: 0.03 }, { yaw, attrs: { surface: SURF.GLASS } });
  box(mb, { x: pos.x + side.x * 2.0, y: pos.y + 1.3, z: pos.z + side.z * 2.0 }, { x: 0.03, y: 2.3, z: 1.5 }, { yaw, attrs: { surface: SURF.GLASS } });
  mb.attr({ surface: SURF.METAL });
  box(mb, { x: pos.x - dir.x * 0.5, y: pos.y + 0.46, z: pos.z - dir.z * 0.5 }, { x: 3.3, y: 0.07, z: 0.4 }, { yaw, attrs: STEEL });
}

export function bench(mb, pos, yaw) {
  mb.attr({ surface: SURF.WOOD });
  const dir = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const side = { x: -dir.z, y: 0, z: dir.x };
  for (let i = 0; i < 4; i++) {
    box(mb, { x: pos.x + dir.x * (i * 0.1 - 0.15), y: pos.y + 0.44, z: pos.z + dir.z * (i * 0.1 - 0.15) },
      { x: 1.8, y: 0.05, z: 0.085 }, { yaw, attrs: { surface: SURF.WOOD } });
  }
  mb.attr({ surface: SURF.METAL });
  for (let i = -1; i <= 1; i += 2) {
    box(mb, { x: pos.x + side.x * 0.78 * i, y: pos.y + 0.22, z: pos.z + side.z * 0.78 * i },
      { x: 0.07, y: 0.44, z: 0.5 }, { yaw, attrs: STEEL });
  }
}

/* ------------------------------------------------------------------ placement */

function footwayOffset(profile, side) {
  const band = laneBand(profile);
  const walk = side < 0 ? profile.footwayL : profile.footwayR;
  const base = (side < 0 ? band.tL : band.tR) + side * (GUTTER_WIDTH + KERB.FACE_BATTER + KERB.TOP_WIDTH);
  return { t: base + side * walk * 0.55, walk, edge: base };
}

/**
 * Populate every furniture category for the network.
 * @returns {{meshes:Object, lights:Array, signals:Array, stats:Object}}
 */
export function buildProps(net, surface, settings, rng) {
  const mbs = {};
  for (const k of PROP_LAYERS) mbs[k] = new MeshBuilder(k);
  const lights = [];
  const signals = [];
  const parked = [];
  const density = settings.propDensity ?? 1;

  // ---- lighting + kerbside furniture along every road
  for (const edge of net.edges.values()) {
    const ribbon = surface.ribbons.get(edge.id);
    if (!ribbon || ribbon.stations.length < 3) continue;
    const p = edge.profile;
    const urban = p.footwayL > 0.05;
    const spacing = (p.class === ROAD_CLASS.HIGHWAY ? 48 : p.class === ROAD_CLASS.ARTERIAL ? 30 : 34) / Math.max(0.35, density);
    const s0 = ribbon.s0, s1 = ribbon.s1;
    const usable = s1 - s0;
    if (usable < 12) continue;
    const count = Math.max(1, Math.floor(usable / spacing));
    const step = usable / (count + 1);
    let side = rng.chance(0.5) ? -1 : 1;
    for (let i = 1; i <= count; i++) {
      const s = s0 + step * i;
      const f = edge.curve.frameAt(s);
      const off = footwayOffset(p, side);
      const t = urban ? off.edge + side * Math.min(0.75, off.walk * 0.35) : off.edge + side * 1.6;
      const pos = { x: f.p.x + f.right.x * t, y: f.p.y + (urban ? 0.16 : -0.05), z: f.p.z + f.right.z * t };
      const yaw = Math.atan2(-f.right.z * side, -f.right.x * side);
      const lamp = lampPost(mbs.lighting, pos, yaw, { height: p.class === ROAD_CLASS.HIGHWAY ? 12 : 9, reach: p.class === ROAD_CLASS.HIGHWAY ? 2.6 : 1.9 });
      lights.push({ p: lamp.lightPos, colour: [1.0, 0.82, 0.56], intensity: 1.0, radius: 26 });
      if (p.class !== ROAD_CLASS.HIGHWAY) side = -side;
    }

    // drainage gullies in the channel
    if (urban) {
      const gstep = 22;
      for (let s = s0 + 11; s < s1 - 6; s += gstep) {
        for (const sd of [-1, 1]) {
          const f = edge.curve.frameAt(s);
          const band = laneBand(p);
          const t = (sd < 0 ? band.tL : band.tR) + sd * (GUTTER_WIDTH * 0.55);
          gullyGrate(mbs.drainage, {
            x: f.p.x + f.right.x * t, y: f.p.y - 0.022 - 0.022, z: f.p.z + f.right.z * t,
          }, Math.atan2(f.t.z, f.t.x));
        }
      }
      for (let s = s0 + 17; s < s1 - 8; s += 37) {
        const f = edge.curve.frameAt(s);
        const t = rng.range(-2.5, 2.5);
        manhole(mbs.drainage, { x: f.p.x + f.right.x * t, y: f.p.y - 0.02 * Math.abs(t) + 0.004, z: f.p.z + f.right.z * t });
      }
    }

    // speed limit + parking signage
    if (urban && usable > 40 && rng.chance(0.7 * density)) {
      const s = s0 + usable * rng.range(0.25, 0.75);
      const sd = rng.chance(0.5) ? -1 : 1;
      const f = edge.curve.frameAt(s);
      const off = footwayOffset(p, sd);
      const t = off.edge + sd * Math.min(0.55, off.walk * 0.3);
      signPost(mbs.signage, { x: f.p.x + f.right.x * t, y: f.p.y + 0.16, z: f.p.z + f.right.z * t },
        Math.atan2(-f.t.z, -f.t.x) + (sd > 0 ? 0 : 0), rng.chance(0.5) ? 'speed' : 'parking');
    }

    // bus stop + shelter on bigger streets
    if (urban && (p.class === ROAD_CLASS.ARTERIAL || p.class === ROAD_CLASS.COLLECTOR) && usable > 70 && rng.chance(0.5 * density)) {
      const s = s0 + usable * rng.range(0.3, 0.7);
      const sd = rng.chance(0.5) ? -1 : 1;
      const f = edge.curve.frameAt(s);
      const off = footwayOffset(p, sd);
      const t = off.edge + sd * (off.walk * 0.62);
      const pos = { x: f.p.x + f.right.x * t, y: f.p.y + 0.16, z: f.p.z + f.right.z * t };
      busShelter(mbs.furniture, pos, Math.atan2(f.right.z * sd, f.right.x * sd));
      bench(mbs.furniture, {
        x: pos.x + f.t.x * 4.5, y: pos.y, z: pos.z + f.t.z * 4.5,
      }, Math.atan2(f.right.z * sd, f.right.x * sd));
    }

    // motorway / ramp barriers
    if (!urban) {
      for (const sd of [-1, 1]) {
        const band = laneBand(p);
        const t = (sd < 0 ? band.tL : band.tR) + sd * 1.0;
        const path = edge.curve.offsetPolyline(t, 3.0, s0, s1).map((q) => ({ x: q.x, y: q.y - 0.05, z: q.z }));
        wBeamBarrier(mbs.railings, path);
      }
    }

    // construction kit
    for (const c of edge.features.construction) {
      const dirSign = c.t0 + c.t1 > 0 ? 1 : -1;
      for (let s = c.s0 - 9; s < c.s1 + 5; s += 2.2) {
        const f = edge.curve.frameAt(clamp(s, 0, edge.curve.length));
        const taper = s < c.s0 ? clamp((s - (c.s0 - 9)) / 9, 0, 1) : 1;
        const t = lerp(dirSign * (Math.abs(c.t0) + Math.abs(c.t1)) * 0.5 - dirSign * 2.4, (c.t0 + c.t1) / 2 - dirSign * 0.5, taper);
        trafficCone(mbs.construction, { x: f.p.x + f.right.x * t, y: f.p.y - 0.02 * Math.abs(t), z: f.p.z + f.right.z * t });
      }
      for (let s = c.s0; s < c.s1; s += 1.9) {
        const f = edge.curve.frameAt(clamp(s, 0, edge.curve.length));
        for (const t of [c.t0 - 0.5, c.t1 + 0.5]) {
          waterBarrier(mbs.construction, {
            x: f.p.x + f.right.x * t, y: f.p.y - 0.02 * Math.abs(t), z: f.p.z + f.right.z * t,
          }, Math.atan2(f.t.z, f.t.x));
        }
      }
      const fs = edge.curve.frameAt(clamp(c.s0 - 11, 0, edge.curve.length));
      signPost(mbs.construction, {
        x: fs.p.x + fs.right.x * ((c.t0 + c.t1) / 2), y: fs.p.y, z: fs.p.z + fs.right.z * ((c.t0 + c.t1) / 2),
      }, Math.atan2(-fs.t.z, -fs.t.x), 'info', { height: 1.6 });
    }
  }

  // ---- junction furniture: signals, bollards, guardrail returns
  let signalGroup = 0;
  for (const [, j] of surface.junctions) {
    if (j.branchCount < 2) continue;
    const signalised = j.signalised;
    for (let m = 0; m < j.mouths.length; m++) {
      const mouth = j.mouths[m];
      const edge = net.edges.get(mouth.edgeId);
      const urban = edge.profile.footwayL > 0.05;
      const inward = v3scale(mouth.dir, -1);
      // the right-hand kerb point of this approach, pulled back onto the footway
      const corner = mouth.kerbR;
      const away = normXZ(v3sub(corner, j.centre));
      const base = {
        x: corner.x + away.x * 0.9, y: corner.y + 0.02, z: corner.z + away.z * 0.9,
      };
      if (signalised && urban) {
        const yaw = Math.atan2(-mouth.dir.z, -mouth.dir.x);
        const reach = clamp(mouth.halfWidth * 0.85, 1.6, 7.5);
        trafficSignal(mbs.signals, base, yaw + Math.PI, reach, signalGroup + (m % 2));
        signals.push({ group: signalGroup + (m % 2), junction: j.id, mouth: m, heading: mouth.heading });
      } else if (urban && edge.profile.class !== ROAD_CLASS.HIGHWAY) {
        const yaw = Math.atan2(-mouth.dir.z, -mouth.dir.x);
        const kind = j.control === 'stop' && m > 0 ? 'stop' : j.control === 'yield' ? 'giveway' : 'speed';
        if (j.branchCount >= 3) signPost(mbs.signage, base, yaw, kind);
      }
      // pedestrian guardrail on the kerb return either side of the crossing
      if (urban && j.branchCount >= 3 && rng.chance(0.55)) {
        const c = j.corners[m];
        if (c) {
          const path = c.kerb.map((p, i) => {
            const t = i / (c.kerb.length - 1);
            const bk = c.back[i];
            return { x: lerp(p.x, bk.x, 0.28), y: p.y + 0.14, z: lerp(p.z, bk.z, 0.28) };
          });
          pedestrianRailing(mbs.railings, path.slice(1, -1));
        }
      }
    }
    // bollards guarding the corners
    for (const c of j.corners) {
      if (!c) continue;
      const design = BOLLARD_DESIGNS[Math.floor(rng() * BOLLARD_DESIGNS.length)];
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const t = 0.25 + (0.5 * i) / Math.max(1, n - 1);
        const k = Math.min(c.kerb.length - 1, Math.floor(t * (c.kerb.length - 1)));
        const p = c.kerb[k], b = c.back[k];
        bollard(mbs.bollards, {
          x: lerp(p.x, b.x, 0.22), y: p.y + 0.14, z: lerp(p.z, b.z, 0.22),
        }, design);
      }
    }
    if (signalised) signalGroup += 2;
  }

  const meshes = {};
  for (const k of PROP_LAYERS) {
    if (mbs[k].vertexCount > 0) meshes[k] = mbs[k].finish();
  }
  return { meshes, lights, signals, signalGroups: signalGroup, parked };
}
