// Procedural vehicle shells — lofted bodies, glazed cabins, separate wheels, lamps and trim.
// Each type is built once and drawn instanced; wheels are instanced separately so they spin.

import { MeshBuilder, SURF } from '../core/mesh.js';
import { box, cylinder, lathe, loft } from '../core/geokit.js';
import { TAU, lerp, clamp } from '../core/math.js';

/** Rounded rectangle ring in the YZ plane at station x. */
function ring(x, halfW, y0, y1, r, n = 18) {
  const pts = [];
  const h = (y1 - y0) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const p = Math.max(2.0, 2.0 + (1 - r) * 5);
    const sx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / p);
    const sy = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / p);
    pts.push({ x, y: cy + sy * h, z: sx * halfW });
  }
  return pts;
}

const CAR_TYPES = {
  sedan:  { len: 4.62, width: 1.82, wheelbase: 2.78, wheelR: 0.33, roof: 1.44, hood: 0.92, type: 'car' },
  hatch:  { len: 4.08, width: 1.76, wheelbase: 2.56, wheelR: 0.31, roof: 1.48, hood: 0.88, type: 'car' },
  suv:    { len: 4.82, width: 1.94, wheelbase: 2.86, wheelR: 0.38, roof: 1.74, hood: 1.05, type: 'car' },
  van:    { len: 5.4,  width: 2.0,  wheelbase: 3.2,  wheelR: 0.36, roof: 2.1,  hood: 1.1,  type: 'van' },
  bus:    { len: 11.9, width: 2.55, wheelbase: 5.9,  wheelR: 0.48, roof: 3.1,  hood: 2.9,  type: 'bus' },
  truck:  { len: 8.4,  width: 2.45, wheelbase: 4.6,  wheelR: 0.46, roof: 2.6,  hood: 1.5,  type: 'truck' },
};

export const VEHICLE_TYPES = Object.keys(CAR_TYPES);

function silhouette(spec) {
  const L = spec.len, W = spec.width / 2, g = spec.wheelR * 0.62;
  const s = [];
  const add = (f, w, y0, y1, r) => s.push({ f, w, y0, y1, r });
  if (spec.type === 'car') {
    add(0.00, W * 0.72, g + 0.14, spec.hood - 0.08, 0.5);
    add(0.04, W * 0.93, g + 0.05, spec.hood + 0.02, 0.55);
    add(0.17, W * 1.0, g - 0.02, spec.hood + 0.06, 0.6);
    add(0.30, W * 1.0, g - 0.04, spec.hood + 0.22, 0.62);
    add(0.38, W * 0.99, g - 0.04, spec.roof - 0.06, 0.7);
    add(0.50, W * 0.985, g - 0.04, spec.roof, 0.72);
    add(0.63, W * 0.98, g - 0.04, spec.roof - 0.02, 0.7);
    add(0.74, W * 0.97, g - 0.03, spec.roof - 0.26, 0.64);
    add(0.86, W * 0.95, g + 0.0, spec.hood + 0.16, 0.6);
    add(0.96, W * 0.88, g + 0.08, spec.hood + 0.08, 0.55);
    add(1.00, W * 0.70, g + 0.16, spec.hood - 0.02, 0.5);
  } else if (spec.type === 'van' || spec.type === 'truck') {
    add(0.00, W * 0.78, g + 0.1, spec.hood, 0.5);
    add(0.05, W * 0.96, g + 0.02, spec.hood + 0.35, 0.55);
    add(0.16, W * 1.0, g - 0.04, spec.roof - 0.05, 0.6);
    add(0.30, W * 1.0, g - 0.05, spec.roof, 0.6);
    add(0.70, W * 1.0, g - 0.05, spec.roof, 0.6);
    add(0.94, W * 0.99, g - 0.02, spec.roof - 0.02, 0.58);
    add(1.00, W * 0.92, g + 0.06, spec.roof - 0.06, 0.52);
  } else {
    add(0.00, W * 0.9, g + 0.05, spec.roof - 0.1, 0.5);
    add(0.03, W * 1.0, g - 0.02, spec.roof, 0.55);
    add(0.5, W * 1.0, g - 0.04, spec.roof + 0.04, 0.55);
    add(0.97, W * 1.0, g - 0.02, spec.roof, 0.55);
    add(1.00, W * 0.9, g + 0.05, spec.roof - 0.1, 0.5);
  }
  return s;
}

export function buildVehicleMesh(name) {
  const spec = CAR_TYPES[name];
  const mb = new MeshBuilder(`vehicle-${name}`);
  const L = spec.len;
  const sil = silhouette(spec);
  const sections = sil.map((q) => ring(-L / 2 + q.f * L, q.w, q.y0, q.y1, q.r).map((p) => ({ ...p, surface: SURF.CAR_PAINT })));
  mb.attr({ surface: SURF.CAR_PAINT });
  loft(mb, sections, { closed: true, surface: SURF.CAR_PAINT, uStep: 0.4, vStep: 0.2 });

  // glazing
  mb.attr({ surface: SURF.CAR_GLASS });
  const glass = (xc, w, y0, y1, zOff, thick, yaw = 0) => {
    box(mb, { x: xc, y: (y0 + y1) / 2, z: zOff }, { x: w, y: y1 - y0, z: thick },
      { attrs: { surface: SURF.CAR_GLASS } });
  };
  if (spec.type === 'car') {
    const roofY = spec.roof, beltY = spec.hood + 0.14;
    for (const sgn of [-1, 1]) {
      glass(-L * 0.02, L * 0.3, beltY, roofY - 0.1, sgn * (spec.width / 2 - 0.02), 0.03);
      glass(L * 0.16, L * 0.2, beltY, roofY - 0.16, sgn * (spec.width / 2 - 0.03), 0.03);
    }
    box(mb, { x: -L * 0.16, y: (beltY + roofY) / 2 + 0.06, z: 0 },
      { x: 0.1, y: roofY - beltY, z: spec.width - 0.18 }, { attrs: { surface: SURF.CAR_GLASS } });
    box(mb, { x: L * 0.3, y: (beltY + roofY) / 2 + 0.02, z: 0 },
      { x: 0.1, y: roofY - beltY - 0.18, z: spec.width - 0.3 }, { attrs: { surface: SURF.CAR_GLASS } });
  } else {
    const beltY = spec.hood + 0.25, roofY = spec.roof - 0.12;
    box(mb, { x: -L / 2 + 0.22, y: (beltY + roofY) / 2, z: 0 },
      { x: 0.08, y: roofY - beltY, z: spec.width - 0.2 }, { attrs: { surface: SURF.CAR_GLASS } });
    for (const sgn of [-1, 1]) {
      glass(-L * 0.28, L * 0.18, beltY, roofY, sgn * (spec.width / 2 - 0.02), 0.03);
      if (spec.type === 'bus') {
        for (let i = 0; i < 4; i++) {
          glass(-L * 0.1 + i * L * 0.2, L * 0.15, beltY - 0.1, roofY, sgn * (spec.width / 2 - 0.02), 0.03);
        }
      }
    }
  }

  // lamps + trim
  mb.attr({ surface: SURF.LIGHT_WHITE });
  for (const sgn of [-1, 1]) {
    box(mb, { x: -L / 2 + 0.06, y: spec.hood - 0.18, z: sgn * spec.width * 0.33 },
      { x: 0.12, y: 0.17, z: 0.42 }, { attrs: { surface: SURF.LIGHT_WHITE } });
  }
  mb.attr({ surface: SURF.LIGHT_RED });
  for (const sgn of [-1, 1]) {
    box(mb, { x: L / 2 - 0.06, y: spec.hood - 0.1, z: sgn * spec.width * 0.34 },
      { x: 0.1, y: 0.2, z: 0.4 }, { attrs: { surface: SURF.LIGHT_RED } });
  }
  mb.attr({ surface: SURF.CHROME });
  box(mb, { x: -L / 2 + 0.02, y: spec.hood - 0.42, z: 0 }, { x: 0.1, y: 0.22, z: spec.width * 0.78 },
    { attrs: { surface: SURF.CHROME } });
  box(mb, { x: L / 2 - 0.02, y: spec.hood - 0.38, z: 0 }, { x: 0.1, y: 0.2, z: spec.width * 0.74 },
    { attrs: { surface: SURF.CHROME } });
  // mirrors
  for (const sgn of [-1, 1]) {
    box(mb, { x: -L * 0.1, y: spec.hood + 0.22, z: sgn * (spec.width / 2 + 0.1) },
      { x: 0.22, y: 0.11, z: 0.2 }, { attrs: { surface: SURF.CAR_PAINT } });
  }

  const wheels = [];
  const wx = spec.wheelbase / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wheels.push({ x: sx * wx, y: spec.wheelR, z: sz * (spec.width / 2 - spec.wheelR * 0.38), steer: sx < 0 });
    }
  }
  if (spec.type === 'bus' || spec.type === 'truck') {
    for (const sz of [-1, 1]) wheels.push({ x: wx - 1.3, y: spec.wheelR, z: sz * (spec.width / 2 - spec.wheelR * 0.38), steer: false });
  }

  return { mesh: mb.finish(), spec: { ...spec, name }, wheels };
}

/** One wheel: tyre torus-ish cylinder + dished rim. */
export function buildWheelMesh(radius = 0.33, width = 0.24) {
  const mb = new MeshBuilder('wheel');
  mb.attr({ surface: SURF.TIRE });
  cylinder(mb, { x: 0, y: 0, z: -width / 2 }, { x: 0, y: 0, z: width / 2 }, radius, radius, 20,
    { attrs: { surface: SURF.TIRE }, capStart: false, capEnd: false });
  // shoulder rings
  for (const sgn of [-1, 1]) {
    cylinder(mb, { x: 0, y: 0, z: sgn * width / 2 }, { x: 0, y: 0, z: sgn * (width / 2 - 0.03) },
      radius, radius * 0.93, 20, { attrs: { surface: SURF.TIRE }, capStart: false, capEnd: false });
  }
  mb.attr({ surface: SURF.CHROME });
  for (const sgn of [-1, 1]) {
    lathe(mb, { x: 0, y: 0, z: 0 }, [
      { x: 0.0, y: sgn * (width / 2 - 0.07) }, { x: radius * 0.4, y: sgn * (width / 2 - 0.045) },
      { x: radius * 0.72, y: sgn * (width / 2 - 0.028) }, { x: radius * 0.93, y: sgn * (width / 2 - 0.03) },
    ], 16, { surface: SURF.CHROME });
  }
  return mb.finish();
}

export function vehicleSpec(name) { return CAR_TYPES[name]; }

export const PAINT_COLOURS = [
  [0.72, 0.73, 0.75], [0.05, 0.06, 0.07], [0.62, 0.11, 0.12], [0.07, 0.17, 0.42],
  [0.88, 0.88, 0.9], [0.2, 0.22, 0.24], [0.35, 0.38, 0.4], [0.1, 0.32, 0.22],
  [0.78, 0.55, 0.1], [0.45, 0.47, 0.5], [0.02, 0.28, 0.45], [0.55, 0.57, 0.6],
];
