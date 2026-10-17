// Loose props: furniture, street furniture, vehicles. Each is a few boxes and
// cylinders - greybox silhouettes you can read at 150 km/h - plus a box collider
// and a mass (relative to the player car = 1). Props drift and tumble in zero
// gravity and get knocked away by the car.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { F } from '../../core/world.js';
import { boxP, V3, Q } from '../ctx.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const R = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));

function legs4(mb, w, d, h, y, t, col) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(t, h, t, T(sx * (w / 2 - t), y, sz * (d / 2 - t)), K.PROP, col);
}
function wheel(mb, x, y, z, r, w, col) {
  mb.cylinder(r, r, w, 8, R(x, y, z, 0, 0, Math.PI / 2), K.PROP, col, null, null, 0.2);
}

export const PROPS = {
  chair: { size: [0.5, 1.0, 0.5], mass: 0.012, build(mb, c) { mb.box(0.46, 0.06, 0.46, T(0, -0.02, 0), K.PROP, c); mb.box(0.46, 0.5, 0.05, T(0, 0.26, -0.2), K.PROP, c); legs4(mb, 0.46, 0.46, 0.46, -0.27, 0.05, c); } },
  table: { size: [1.6, 0.76, 0.9], mass: 0.035, build(mb, c) { mb.box(1.6, 0.06, 0.9, T(0, 0.35, 0), K.PROP, c); legs4(mb, 1.5, 0.82, 0.7, -0.03, 0.07, c); } },
  sofa: { size: [2.1, 0.95, 0.9], mass: 0.06, build(mb, c) { mb.box(2.1, 0.45, 0.9, T(0, -0.2, 0), K.PROP, c); mb.box(2.1, 0.5, 0.22, T(0, 0.27, -0.34), K.PROP, c); for (const s of [-1, 1]) mb.box(0.22, 0.3, 0.9, T(s * 0.94, 0.17, 0), K.PROP, c); } },
  armchair: { size: [1.0, 0.95, 0.9], mass: 0.03, build(mb, c) { mb.box(1.0, 0.45, 0.9, T(0, -0.2, 0), K.PROP, c); mb.box(1.0, 0.5, 0.22, T(0, 0.27, -0.34), K.PROP, c); for (const s of [-1, 1]) mb.box(0.18, 0.3, 0.9, T(s * 0.41, 0.17, 0), K.PROP, c); } },
  bed: { size: [1.6, 1.0, 2.1], mass: 0.07, build(mb, c) { mb.box(1.6, 0.35, 2.1, T(0, -0.25, 0), K.PROP, c); mb.box(1.5, 0.22, 2.0, T(0, 0.03, 0.03), K.PROP, lin(PAL.propLight)); mb.box(1.6, 0.95, 0.08, T(0, 0.02, -1.04), K.PROP, c); mb.box(0.6, 0.12, 0.4, T(-0.38, 0.2, -0.75), K.PROP, lin(PAL.white)); mb.box(0.6, 0.12, 0.4, T(0.38, 0.2, -0.75), K.PROP, lin(PAL.white)); } },
  wardrobe: { size: [1.1, 2.0, 0.6], mass: 0.08, build(mb, c) { mb.box(1.1, 2.0, 0.6, T(0, 0, 0), K.PROP, c); mb.box(0.02, 1.8, 0.02, T(0, 0, 0.31), K.PROP, lin(PAL.cut)); } },
  bookshelf: { size: [0.9, 1.9, 0.35], mass: 0.04, build(mb, c) { for (const s of [-1, 1]) mb.box(0.04, 1.9, 0.35, T(s * 0.43, 0, 0), K.PROP, c); for (let i = 0; i < 5; i++) mb.box(0.86, 0.03, 0.33, T(0, -0.92 + i * 0.46, 0), K.PROP, c); for (let i = 0; i < 4; i++) mb.box(0.8, 0.3, 0.22, T(0, -0.75 + i * 0.46, 0.02), K.PROP, lin(PAL.propDark)); mb.box(0.9, 1.9, 0.02, T(0, 0, -0.17), K.PROP, c); } },
  fridge: { size: [0.75, 1.8, 0.7], mass: 0.07, build(mb) { const w = lin(PAL.white); mb.box(0.75, 1.8, 0.7, T(0, 0, 0), K.PROP, w); mb.box(0.73, 0.02, 0.02, T(0, 0.3, 0.36), K.PROP, lin(PAL.metal)); mb.box(0.04, 0.4, 0.04, T(0.28, 0.6, 0.37), K.PROP, lin(PAL.metal)); } },
  stove: { size: [0.7, 0.9, 0.65], mass: 0.05, build(mb) { mb.box(0.7, 0.9, 0.65, T(0, 0, 0), K.PROP, lin(PAL.white)); mb.box(0.6, 0.35, 0.02, T(0, -0.1, 0.33), K.GLASS, lin(PAL.glass)); } },
  piano: { size: [1.5, 1.3, 0.65], mass: 0.22, build(mb) { const c = lin(0x3a3633); mb.box(1.5, 1.3, 0.4, T(0, 0, -0.12), K.PROP, c); mb.box(1.5, 0.08, 0.3, T(0, -0.05, 0.2), K.PROP, lin(PAL.white)); mb.box(1.5, 0.1, 0.32, T(0, 0.02, 0.2), K.PROP, c); } },
  bathtub: { size: [1.7, 0.6, 0.8], mass: 0.06, build(mb) { const w = lin(PAL.white); mb.box(1.7, 0.08, 0.8, T(0, -0.26, 0), K.PROP, w); for (const s of [-1, 1]) { mb.box(1.7, 0.6, 0.08, T(0, 0, s * 0.36), K.PROP, w); mb.box(0.08, 0.6, 0.64, T(s * 0.81, 0, 0), K.PROP, w); } } },
  lamp: { size: [0.5, 1.7, 0.5], mass: 0.006, build(mb, c) { mb.cylinder(0.2, 0.2, 0.04, 8, T(0, -0.83, 0), K.PROP, c); mb.cylinder(0.025, 0.025, 1.4, 5, T(0, -0.1, 0), K.PROP, c); mb.cylinder(0.25, 0.15, 0.32, 8, T(0, 0.65, 0), K.PROP, lin(PAL.propLight)); } },
  tv: { size: [1.1, 0.7, 0.3], mass: 0.012, build(mb) { mb.box(1.1, 0.65, 0.08, T(0, 0.02, 0), K.PROP, lin(0x2c2c2e)); mb.box(1.0, 0.55, 0.01, T(0, 0.02, 0.045), K.GLASS, lin(PAL.glass)); mb.box(0.3, 0.04, 0.25, T(0, -0.33, 0), K.PROP, lin(0x2c2c2e)); } },
  clock: { size: [0.55, 2.0, 0.38], mass: 0.035, build(mb, c) { mb.box(0.55, 2.0, 0.38, T(0, 0, 0), K.PROP, c); mb.cylinder(0.2, 0.2, 0.02, 12, R(0, 0.65, 0.2, Math.PI / 2, 0, 0), K.PROP, lin(PAL.white)); } },
  door: { size: [0.9, 2.1, 0.06], mass: 0.02, build(mb, c) { mb.box(0.9, 2.1, 0.05, T(0, 0, 0), K.PROP, c); mb.box(0.1, 0.03, 0.06, T(0.33, 0, 0.03), K.PROP, lin(PAL.metal)); } },
  mattress: { size: [1.4, 0.24, 1.95], mass: 0.02, build(mb) { mb.box(1.4, 0.22, 1.95, T(0, 0, 0), K.PROP, lin(PAL.propLight)); } },
  rug: { size: [2.4, 0.04, 1.7], mass: 0.006, build(mb, c) { mb.box(2.4, 0.03, 1.7, T(0, 0, 0), K.PROP, c); } },
  frame: { size: [0.9, 0.7, 0.05], mass: 0.004, build(mb, c) { mb.box(0.9, 0.7, 0.04, T(0, 0, 0), K.PROP, c); mb.box(0.78, 0.58, 0.01, T(0, 0, 0.022), K.MARK, lin(PAL.wall2)); } },
  crate: { size: [1.0, 1.0, 1.0], mass: 0.03, build(mb, c) { mb.box(1, 1, 1, T(0, 0, 0), K.PROP, c); mb.box(1.02, 0.12, 1.02, T(0, 0.3, 0), K.PROP, lin(PAL.propDark)); mb.box(1.02, 0.12, 1.02, T(0, -0.3, 0), K.PROP, lin(PAL.propDark)); } },
  barrel: { size: [0.7, 0.95, 0.7], mass: 0.03, build(mb) { mb.cylinder(0.33, 0.33, 0.92, 10, T(0, 0, 0), K.METAL, lin(PAL.hazard)); } },
  bin: { size: [0.65, 1.05, 0.75], mass: 0.015, build(mb) { mb.box(0.6, 0.95, 0.7, T(0, -0.04, 0), K.PROP, lin(0x5d6a5a)); mb.box(0.64, 0.06, 0.74, T(0, 0.46, 0), K.PROP, lin(0x4b5649)); } },
  bench: { size: [1.8, 0.9, 0.6], mass: 0.03, build(mb, c) { mb.box(1.8, 0.06, 0.45, T(0, -0.02, 0.05), K.PROP, c); mb.box(1.8, 0.4, 0.05, T(0, 0.25, -0.2), K.PROP, c); for (const s of [-1, 1]) mb.box(0.06, 0.45, 0.5, T(s * 0.8, -0.24, 0), K.METAL, lin(PAL.metal)); } },
  lamppost: { size: [1.6, 6.4, 0.4], mass: 0.05, build(mb) { const m = lin(PAL.metal); mb.cylinder(0.12, 0.08, 6.2, 6, T(0, 0, 0), K.METAL, m); mb.box(1.5, 0.08, 0.08, T(0.7, 3.0, 0), K.METAL, m); mb.box(0.5, 0.15, 0.3, T(1.35, 2.92, 0), K.METAL, m); } },
  hydrant: { size: [0.45, 0.8, 0.45], mass: 0.02, build(mb) { const c = lin(PAL.hazard); mb.cylinder(0.15, 0.15, 0.6, 8, T(0, -0.05, 0), K.METAL, c); mb.cylinder(0.12, 0.05, 0.2, 8, T(0, 0.33, 0), K.METAL, c); mb.box(0.42, 0.1, 0.1, T(0, 0.05, 0), K.METAL, c); } },
  mailbox: { size: [0.5, 1.3, 0.5], mass: 0.01, build(mb, c) { mb.box(0.08, 1.1, 0.08, T(0, -0.15, 0), K.PROP, c); mb.box(0.3, 0.3, 0.5, T(0, 0.5, 0), K.METAL, lin(PAL.metal)); } },
  sign: { size: [0.8, 2.6, 0.1], mass: 0.012, build(mb) { mb.cylinder(0.04, 0.04, 2.6, 5, T(0, 0, 0), K.METAL, lin(PAL.metal)); mb.box(0.75, 0.75, 0.03, T(0, 0.9, 0.04), K.MARK, lin(PAL.white)); } },
  trafficlight: { size: [0.5, 4.2, 0.5], mass: 0.04, build(mb) { const m = lin(0x4a4d50); mb.cylinder(0.08, 0.08, 4.0, 6, T(0, -0.1, 0), K.METAL, m); mb.box(0.35, 1.0, 0.3, T(0, 1.55, 0.15), K.METAL, m); for (let i = 0; i < 3; i++) mb.cylinder(0.1, 0.1, 0.02, 8, R(0, 1.85 - i * 0.3, 0.31, Math.PI / 2, 0, 0), K.MARK, lin(PAL.propLight)); } },
  phonebox: { size: [1.0, 2.5, 1.0], mass: 0.12, build(mb) { const c = lin(0x6f6a64); mb.box(1.0, 0.2, 1.0, T(0, 1.15, 0), K.PROP, c); mb.box(1.0, 0.1, 1.0, T(0, -1.2, 0), K.PROP, c); for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(0.1, 2.3, 0.1, T(sx * 0.45, 0, sz * 0.45), K.PROP, c); mb.box(0.8, 2.0, 0.8, T(0, 0, 0), K.GLASS, lin(PAL.glass)); } },
  cart: { size: [0.6, 1.0, 0.95], mass: 0.012, build(mb) { const m = lin(PAL.metal); mb.box(0.56, 0.04, 0.9, T(0, -0.05, 0), K.METAL, m); for (const s of [-1, 1]) mb.box(0.03, 0.45, 0.9, T(s * 0.28, 0.17, 0), K.METAL, m); mb.box(0.56, 0.45, 0.03, T(0, 0.17, 0.45), K.METAL, m); mb.box(0.5, 0.45, 0.03, T(0, 0.17, -0.45), K.METAL, m); mb.box(0.56, 0.03, 0.03, T(0, 0.48, -0.55), K.METAL, m); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 0.24, -0.45, sz * 0.36, 0.06, 0.04, lin(0x333333)); } },
  stall: { size: [3.0, 2.6, 2.0], mass: 0.08, build(mb, c) { mb.box(3.0, 0.08, 1.2, T(0, -0.35, 0.3), K.PROP, c); for (const sx of [-1, 1]) for (const sz of [-1, 1]) mb.box(0.08, 2.4, 0.08, T(sx * 1.45, 0, sz * 0.9), K.PROP, c); mb.box(3.2, 0.06, 2.2, R(0, 1.25, 0, 0.12, 0, 0), K.MARK, lin(PAL.wall3)); for (let i = 0; i < 4; i++) mb.box(0.5, 0.3, 0.4, T(-1.1 + i * 0.72, -0.15, 0.3), K.PROP, lin(PAL.propDark)); } },
  bike: { size: [1.8, 1.1, 0.12], mass: 0.008, build(mb) { const m = lin(0x3b3f43); for (const s of [-1, 1]) mb.cylinder(0.34, 0.34, 0.05, 12, R(s * 0.55, -0.2, 0, Math.PI / 2, 0, 0), K.METAL, m); mb.box(1.1, 0.05, 0.05, R(0, 0.05, 0, 0, 0, 0.1), K.METAL, m); mb.box(0.05, 0.6, 0.05, R(-0.2, 0.0, 0, 0, 0, 0.3), K.METAL, m); mb.box(0.5, 0.05, 0.05, T(0.5, 0.42, 0), K.METAL, m); } },
  cone: { size: [0.45, 0.75, 0.45], mass: 0.004, build(mb) { mb.cylinder(0.2, 0.03, 0.7, 8, T(0, 0, 0), K.PROP, lin(PAL.hazard)); mb.box(0.44, 0.04, 0.44, T(0, -0.35, 0), K.PROP, lin(0x333333)); } },
  sedan: { size: [1.8, 1.45, 4.5], mass: 0.9, build(mb, c) { const g = lin(PAL.glass); mb.box(1.8, 0.7, 4.5, T(0, -0.25, 0), K.METAL, c); mb.box(1.6, 0.6, 2.3, T(0, 0.4, -0.15), K.GLASS, g); mb.box(1.62, 0.08, 2.0, T(0, 0.72, -0.15), K.METAL, c); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 0.82, -0.55, sz * 1.42, 0.34, 0.24, lin(0x262626)); } },
  hatch: { size: [1.75, 1.5, 3.9], mass: 0.8, build(mb, c) { const g = lin(PAL.glass); mb.box(1.75, 0.72, 3.9, T(0, -0.24, 0), K.METAL, c); mb.box(1.6, 0.62, 2.3, T(0, 0.42, -0.4), K.GLASS, g); mb.box(1.62, 0.08, 2.1, T(0, 0.75, -0.45), K.METAL, c); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 0.8, -0.56, sz * 1.25, 0.33, 0.22, lin(0x262626)); } },
  van: { size: [2.0, 2.2, 5.0], mass: 1.4, build(mb, c) { const g = lin(PAL.glass); mb.box(2.0, 1.9, 3.7, T(0, 0.05, -0.6), K.METAL, c); mb.box(2.0, 1.2, 1.3, T(0, -0.3, 1.85), K.METAL, c); mb.box(1.9, 0.6, 0.05, R(0, 0.6, 1.25, -0.5, 0, 0), K.GLASS, g); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 0.9, -0.8, sz * 1.7, 0.36, 0.26, lin(0x262626)); } },
  bus: { size: [2.6, 3.0, 11.0], mass: 6, build(mb, c) { mb.box(2.6, 2.6, 11, T(0, 0.1, 0), K.METAL, lin(PAL.wall3)); mb.box(2.64, 0.9, 10.4, T(0, 0.55, 0), K.GLASS, lin(PAL.glass)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 1.15, -1.2, sz * 3.6, 0.5, 0.3, lin(0x262626)); } },
  boat: { size: [1.6, 0.8, 4.2], mass: 0.2, build(mb, c) { mb.box(1.5, 0.12, 3.6, T(0, -0.32, 0), K.PROP, c); for (const s of [-1, 1]) mb.box(0.1, 0.6, 3.8, R(s * 0.75, 0, 0, 0, 0, s * 0.18), K.PROP, c); mb.box(1.5, 0.6, 0.1, T(0, 0, -1.85), K.PROP, c); mb.cylinder(0.7, 0.0, 0.8, 4, R(0, 0, 2.1, Math.PI / 2, Math.PI / 4, 0), K.PROP, c); mb.box(1.4, 0.06, 0.3, T(0, 0.0, 0.4), K.PROP, lin(PAL.propDark)); } },
  pew: { size: [4.0, 1.0, 0.7], mass: 0.08, build(mb, c) { mb.box(4.0, 0.07, 0.45, T(0, -0.05, 0.05), K.PROP, c); mb.box(4.0, 0.55, 0.06, T(0, 0.25, -0.2), K.PROP, c); for (const s of [-1, 0, 1]) mb.box(0.07, 0.95, 0.6, T(s * 1.95, -0.02, 0), K.PROP, c); } },
  candles: { size: [0.6, 1.6, 0.6], mass: 0.006, build(mb, c) { const m = lin(PAL.metal); mb.cylinder(0.25, 0.25, 0.04, 8, T(0, -0.78, 0), K.METAL, m); mb.cylinder(0.03, 0.03, 1.4, 5, T(0, -0.1, 0), K.METAL, m); mb.box(0.6, 0.03, 0.03, T(0, 0.6, 0), K.METAL, m); for (const s of [-1, 0, 1]) mb.cylinder(0.03, 0.03, 0.2, 5, T(s * 0.28, 0.72, 0), K.PROP, lin(PAL.white)); } },
  plank: { size: [0.25, 0.06, 3.2], mass: 0.006, build(mb, c) { mb.box(0.25, 0.05, 3.2, T(0, 0, 0), K.PROP, c); } },
  pipe: { size: [0.3, 0.3, 3.0], mass: 0.01, build(mb) { mb.cylinder(0.14, 0.14, 3.0, 6, R(0, 0, 0, Math.PI / 2, 0, 0), K.METAL, lin(PAL.metal)); } },
  suitcase: { size: [0.7, 0.5, 0.25], mass: 0.006, build(mb, c) { mb.box(0.7, 0.5, 0.25, T(0, 0, 0), K.PROP, lin(PAL.propDark)); mb.box(0.2, 0.05, 0.05, T(0, 0.27, 0), K.PROP, c); } },
  // ---- section 2: the city
  truck: { size: [2.5, 3.5, 8.2], mass: 4, build(mb, c) { const g = lin(PAL.glass); mb.box(2.5, 2.9, 5.8, T(0, 0.25, -1.1), K.METAL, lin(PAL.white)); mb.box(2.4, 2.0, 2.0, T(0, -0.15, 3.0), K.METAL, c); mb.box(2.3, 0.8, 0.05, R(0, 0.45, 4.02, -0.25, 0, 0), K.GLASS, g); for (const sx of [-1, 1]) for (const sz of [-1.2, 0.2, 3.0]) wheel(mb, sx * 1.1, -1.3, sz * 1.0 - 0.3, 0.46, 0.3, lin(0x262626)); } },
  tram: { size: [2.65, 3.6, 18], mass: 9, build(mb, c) { const g = lin(PAL.glass); mb.box(2.65, 2.7, 18, T(0, 0.15, 0), K.METAL, lin(PAL.wall3)); mb.box(2.68, 1.05, 17.2, T(0, 0.55, 0), K.GLASS, g); mb.box(2.3, 0.35, 15, T(0, 1.65, 0), K.METAL, lin(PAL.steel)); mb.box(0.1, 1.0, 1.6, R(0, 2.3, 2, 0, 0, 0.6), K.METAL, lin(PAL.frame)); for (const sz of [-6.5, 6.5]) mb.box(2.0, 0.6, 2.4, T(0, -1.45, sz), K.METAL, lin(PAL.frame)); } },
  kiosk: { size: [2.6, 2.7, 2.0], mass: 0.5, build(mb, c) { mb.box(2.4, 2.2, 1.8, T(0, -0.2, 0), K.PROP, c); mb.box(2.7, 0.12, 2.1, T(0, 0.98, 0.05), K.MARK, lin(PAL.wall3)); mb.box(1.8, 0.9, 0.04, T(0, 0.05, 0.91), K.GLASS, lin(PAL.glass)); } },
  shelter: { size: [4.2, 2.7, 1.7], mass: 0.4, build(mb) { const m = lin(PAL.steel); mb.box(4.2, 0.1, 1.7, T(0, 1.3, 0), K.METAL, m); for (const sx of [-1, 1]) mb.box(0.1, 2.6, 0.1, T(sx * 2.0, 0, -0.75), K.METAL, m); mb.box(4.0, 2.2, 0.04, T(0, 0.05, -0.78), K.GLASS, lin(PAL.glass)); mb.box(0.04, 2.2, 1.4, T(-2.0, 0.05, 0), K.GLASS, lin(PAL.glass)); mb.box(1.8, 0.08, 0.4, T(0.4, -0.7, -0.5), K.PROP, lin(PAL.propDark)); } },
  barrier: { size: [0.6, 0.85, 4.0], mass: 0.6, build(mb) { const c = lin(PAL.concrete); mb.box(0.6, 0.3, 4.0, T(0, -0.28, 0), K.PLAIN, c); mb.box(0.3, 0.55, 4.0, T(0, 0.15, 0), K.PLAIN, c); } },
  planter: { size: [1.6, 1.3, 1.6], mass: 0.5, build(mb) { mb.box(1.6, 0.7, 1.6, T(0, -0.3, 0), K.PLAIN, lin(PAL.concrete2)); mb.cylinder(0.65, 0.2, 0.9, 6, T(0, 0.45, 0), K.PROP, lin(PAL.leaf)); } },
  bollard: { size: [0.3, 1.0, 0.3], mass: 0.03, build(mb) { mb.cylinder(0.14, 0.14, 1.0, 6, T(0, 0, 0), K.METAL, lin(PAL.frame)); } },
  container: { size: [2.44, 2.6, 6.1], mass: 5, build(mb, c) { mb.box(2.44, 2.6, 6.1, T(0, 0, 0), K.METAL, c); for (let i = -5; i <= 5; i++) mb.box(2.48, 2.3, 0.08, T(0, 0, i * 0.55), K.METAL, lin(PAL.frame)); } },
  desk: { size: [1.6, 0.75, 0.8], mass: 0.03, build(mb, c) { mb.box(1.6, 0.05, 0.8, T(0, 0.35, 0), K.PROP, lin(PAL.propLight)); for (const s of [-1, 1]) mb.box(0.05, 0.7, 0.75, T(s * 0.77, 0, 0), K.METAL, lin(PAL.metal)); mb.box(0.5, 0.35, 0.04, T(0.2, 0.55, -0.2), K.PROP, lin(0x2c2c2e)); } },
  cabinet: { size: [0.5, 1.3, 0.62], mass: 0.04, build(mb) { mb.box(0.5, 1.3, 0.62, T(0, 0, 0), K.METAL, lin(PAL.steel)); for (let i = 0; i < 4; i++) mb.box(0.3, 0.03, 0.02, T(0, -0.45 + i * 0.32, 0.32), K.METAL, lin(PAL.metal)); } },
  plant: { size: [0.8, 1.6, 0.8], mass: 0.01, build(mb) { mb.cylinder(0.3, 0.24, 0.5, 8, T(0, -0.55, 0), K.PROP, lin(PAL.propDark)); mb.cylinder(0.45, 0.1, 1.0, 6, T(0, 0.25, 0), K.PROP, lin(PAL.leaf)); } },
  trolley: { size: [0.8, 1.9, 1.3], mass: 0.02, build(mb) { const m = lin(PAL.metal); mb.box(0.8, 0.06, 1.3, T(0, -0.8, 0), K.METAL, m); for (const sz of [-1, 1]) mb.box(0.06, 1.8, 0.06, T(0, 0, sz * 0.6), K.METAL, m); mb.box(0.06, 0.06, 1.3, T(0, 0.9, 0), K.METAL, m); mb.box(0.6, 0.5, 0.8, T(0, -0.5, 0), K.PROP, lin(PAL.propDark)); mb.box(0.5, 0.4, 0.5, T(0.05, -0.05, 0.1), K.PROP, lin(PAL.prop)); } },
  pram: { size: [0.6, 1.0, 1.0], mass: 0.008, build(mb, c) { mb.box(0.55, 0.45, 0.8, T(0, 0.05, 0), K.PROP, c); mb.box(0.55, 0.4, 0.05, R(0, 0.35, -0.35, -0.5, 0, 0), K.PROP, c); for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(mb, sx * 0.25, -0.35, sz * 0.32, 0.12, 0.03, lin(0x333333)); } },
};

const FURN_COL = [PAL.prop, PAL.propDark, PAL.propLight, 0xb7a58a, 0x9f9484];
const CAR_COL = [PAL.car, 0x8a9096, 0xa59f96, 0x7d858c, 0xb0b3b3, 0x8d877f];

/**
 * Spawn a loose prop. pose: { pos, quat }. o: { drift (0..1 float strength), parent, mass, flags, scale }
 */
export function prop(ctx, type, pose, o = {}) {
  const def = PROPS[type];
  if (!def) throw new Error('unknown prop ' + type);
  const rng = o.rng || ctx.rng;
  const mb = new MeshBuilder();
  const isCar = ['sedan', 'hatch', 'van', 'bus', 'boat'].includes(type);
  const col = lin(o.color ?? (isCar ? rng.pick(CAR_COL) : rng.pick(FURN_COL)), 0.03, rng);
  def.build(mb, col);
  const [w, h, d] = def.size;
  const poly = boxP(w, h, d, null, K.PROP, col);
  const k = o.drift ?? 1;
  let motion;
  if (o.parent) {
    motion = { parent: o.parent, bob: { a: 0.08 * k, f: rng.range(0.4, 0.8), p: rng.range(0, 6) }, rot: { x: 0.05 * k, y: 0.08 * k, z: 0.05 * k, f: rng.range(0.2, 0.5), p: rng.range(0, 6) } };
  } else {
    const ax = V3(rng.gauss(), rng.gauss(), rng.gauss()).normalize();
    motion = {
      swell: 1, ext: [Math.max(1, w / 2), Math.max(1, d / 2)],
      bob: { a: rng.range(0.2, 0.7) * k, f: rng.range(0.25, 0.6), p: rng.range(0, 6.28) },
      sway: { x: rng.range(0.2, 1.2) * k, z: rng.range(0.2, 1.2) * k, f: rng.range(0.1, 0.25), p: rng.range(0, 6.28) },
      spin: { axis: [ax.x, ax.y, ax.z], rate: rng.range(0.02, 0.16) * k * (isCar ? 0.4 : 1), p: rng.range(0, 6.28) },
    };
  }
  const flags = F.PROP | (o.flags || 0);
  const b = ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion, flags, colliders: [{ poly, drivable: false, surface: 'prop' }], mass: o.mass ?? def.mass, name: type });
  b.userData.prop = type;
  if (o.breakable) { b.flags |= F.BREAKABLE; b.userData.breakSpeed = o.breakSpeed ?? 4; }
  return b;
}

/**
 * A loose object resting on a plate of the heavy world (section 2): positioned by
 * its real lowest point on the plate surface, rigid with the plate until the car
 * knocks it, then it falls with gravity, bounces and slides on solid ground.
 *  o: { yaw, rx, rz (rest attitude), lift, color, mass, breakable }
 */
export function groundProp(ctx, type, plate, x, z, o = {}) {
  const def = PROPS[type];
  if (!def) throw new Error('unknown prop ' + type);
  const rng = o.rng || ctx.rng;
  const mb = new MeshBuilder();
  const isCar = ['sedan', 'hatch', 'van', 'bus', 'truck', 'tram', 'container'].includes(type);
  const col = lin(o.color ?? (isCar ? rng.pick(CAR_COL) : rng.pick(FURN_COL)), 0.03, rng);
  def.build(mb, col);
  const [w, h, d] = def.size;
  const lq = Q(o.rx || 0, o.yaw || 0, o.rz || 0);
  // lowest point of the mesh in the plate's frame -> rest height
  let minY = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < mb.pos.length; i += 3) { v.set(mb.pos[i], mb.pos[i + 1], mb.pos[i + 2]).applyQuaternion(lq); minY = Math.min(minY, v.y); }
  const pos = plate.toWorld(x, -minY + (o.lift ?? 0) + (o.y ?? 0), z);
  const quat = plate.quat.clone().multiply(lq);
  const poly = boxP(w, h, d, null, K.PROP, col);
  const b = ctx.body({ mb, pos, quat, motion: { parent: plate.parent }, flags: F.PROP | (o.flags || 0), colliders: [{ poly, drivable: false, surface: 'prop' }], mass: o.mass ?? def.mass, name: type });
  Object.assign(b.userData, { prop: type, gravity: 12, collide: true, rad: Math.max(0.25, Math.min(w, h, d) * 0.5), linDamp: 0.08, angDamp: 0.4, friction: 2.5, heavy: true });
  if (o.breakable) { b.flags |= F.BREAKABLE; b.userData.breakSpeed = o.breakSpeed ?? 4; }
  return b;
}

export const FURNITURE = ['chair', 'chair', 'table', 'sofa', 'armchair', 'bed', 'wardrobe', 'bookshelf', 'fridge', 'lamp', 'tv', 'clock', 'door', 'mattress', 'rug', 'frame', 'stove', 'bathtub', 'piano', 'suitcase', 'pram'];
export const STREET = ['lamppost', 'bin', 'bench', 'hydrant', 'mailbox', 'sign', 'cone', 'bike', 'trafficlight', 'phonebox', 'crate', 'barrel'];
export const VEHICLES = ['sedan', 'sedan', 'hatch', 'hatch', 'van'];
export const CITY_CARS = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'van', 'van', 'truck'];
