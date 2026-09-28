/* boneKit.js — procedural osteology toolkit.
 * Everything here builds *solid* 3-D bone volumes: swept elliptical cross-sections
 * along curved paths, with expanded epiphyses, flattened blades and rugose knobs.
 * No cylinders-as-sticks, no planes, no billboards.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- small math helpers ---------- */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (t) => t * t * (3 - 2 * t);
export function catmull(list, t) {           // piecewise interpolation of scalars
  const n = list.length - 1, f = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1), u = f - i;
  const p0 = list[Math.max(0, i - 1)], p1 = list[i], p2 = list[i + 1], p3 = list[Math.min(n, i + 2)];
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/* ---------- core: sweep an elliptical profile along a 3-D curve ----------
 * pts      : array of [x,y,z] control points (CatmullRom)
 * widths   : array of half-widths (local X / lateral) sampled along t
 * depths   : array of half-depths (local Y)  — if omitted, = widths
 * opts.rollFn(t) -> radians, twists the cross-section
 * opts.squash(t) -> extra multiplier used to flatten blades
 */
export function sweep(pts, widths, depths, opts = {}) {
  const steps = opts.steps || Math.max(18, pts.length * 10);
  const radial = opts.radial || 12;
  const curve = new THREE.CatmullRomCurve3(pts.map(p => V(p[0], p[1], p[2])), false, 'centripetal', 0.5);
  const frames = curve.computeFrenetFrames(steps, false);
  const pos = [], idx = [], nrm = [];
  const dep = depths || widths;
  const tmp = new THREE.Vector3();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const P = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const w = catmull(widths, t) * (opts.scale || 1);
    const d = catmull(dep, t) * (opts.scale || 1);
    const roll = opts.rollFn ? opts.rollFn(t) : 0;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2 + roll;
      let ca = Math.cos(a), sa = Math.sin(a);
      // super-ellipse exponent lets us make blades/plates with squarer sections
      const e = opts.section || 2;
      if (e !== 2) {
        const ce = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / e);
        const se = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / e);
        ca = ce; sa = se;
      }
      tmp.copy(P).addScaledVector(N, ca * w).addScaledVector(B, sa * d);
      pos.push(tmp.x, tmp.y, tmp.z);
      nrm.push(0, 0, 0);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial;
      const c = (i + 1) * radial + j, d = (i + 1) * radial + (j + 1) % radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const capStart = pos.length / 3;
  const p0 = curve.getPointAt(0), p1 = curve.getPointAt(1);
  pos.push(p0.x, p0.y, p0.z); nrm.push(0, 0, 0);
  pos.push(p1.x, p1.y, p1.z); nrm.push(0, 0, 0);
  for (let j = 0; j < radial; j++) {
    idx.push(capStart, (j + 1) % radial, j);
    const base = steps * radial;
    idx.push(capStart + 1, base + j, base + (j + 1) % radial);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* A knob / condyle / process blob: deformed sphere. */
export function blob(center, r, scale = [1, 1, 1], rot = null) {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.scale(scale[0], scale[1], scale[2]);
  if (rot) g.rotateX(rot[0]), g.rotateY(rot[1]), g.rotateZ(rot[2]);
  g.translate(center[0], center[1], center[2]);
  return g;
}

/* A flat-ish bone plate (ilium, scapular blade, pubic apron) built from a 2-D
 * outline in the XY plane, extruded with a rounded, thickness-varying profile. */
export function plate(outline2d, thickness, opts = {}) {
  const shape = new THREE.Shape(outline2d.map(p => new THREE.Vector2(p[0], p[1])));
  if (opts.holes) {
    for (const h of opts.holes) {
      const path = new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1])));
      shape.holes.push(path);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.45, bevelSize: opts.bevel ?? thickness * 0.5,
    bevelSegments: 3, curveSegments: opts.curveSegments || 12,
  });
  g.translate(0, 0, -thickness / 2 - thickness * 0.45 / 2);
  g.computeVertexNormals();
  return g;
}

/* Mirror across the transverse plane (x) — used to face the skull forwards. */
export function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const idx = g.getIndex();
  if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } }
  else {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      for (const at of Object.values(g.attributes)) {
        const it = at.itemSize;
        for (let k = 0; k < it; k++) {
          const a0 = at.array[i * it + k];
          at.array[i * it + k] = at.array[(i + 2) * it + k];
          at.array[(i + 2) * it + k] = a0;
        }
      }
    }
  }
  g.computeVertexNormals();
  return g;
}

/* Mirror a geometry across the sagittal plane (z). */
export function mirrorZ(geo) {
  const g = geo.clone();
  g.scale(1, 1, -1);
  const idx = g.getIndex();
  if (idx) { const a = idx.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } }
  g.computeVertexNormals();
  return g;
}

export function merge(list) {
  const clean = list.filter(Boolean).map(g => {
    const c = g.index ? g.toNonIndexed() : g;
    const o = new THREE.BufferGeometry();
    o.setAttribute('position', c.getAttribute('position').clone());
    o.setAttribute('normal', c.getAttribute('normal').clone());
    const uvSrc = c.getAttribute('uv');
    const n = c.getAttribute('position').count;
    o.setAttribute('uv', uvSrc ? uvSrc.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    return o;
  });
  return mergeGeometries(clean, false);
}

/* Bake age/soil mottling into vertex colours so bones don't read as plastic. */
export function weather(geo, seed = 1) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const rnd = (x, y, z) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nrm.getY(i);
    // low-frequency stain + high-frequency grain
    const stain = 0.5 * (rnd(Math.floor(x * 5), Math.floor(y * 5), Math.floor(z * 5)));
    const grain = 0.5 * rnd(Math.floor(x * 40), Math.floor(y * 40), Math.floor(z * 40));
    let v = 0.80 + 0.16 * stain + 0.06 * grain;
    v *= 0.88 + 0.12 * (ny * 0.5 + 0.5);          // undersides darker (dirt settles up-facing? no: cavities)
    const warm = 0.02 * stain;
    col[i * 3] = clamp(v + warm, 0, 1);
    col[i * 3 + 1] = clamp(v * 0.965, 0, 1);
    col[i * 3 + 2] = clamp(v * 0.90 - warm * 0.5, 0, 1);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/* Micro-relief: nudge vertices along their normals with layered value noise so
 * bone surfaces read as bone (rugosities, muscle scars, weathering) rather than
 * as smooth plastic tubes. */
function vnoise(x, y, z) {
  const h = (i, j, k) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  let v = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
    v += w * h(xi + dx, yi + dy, zi + dz);
  }
  return v * 2 - 1;
}
export function roughen(geo, amp = 0.0045, freq = 11) {
  const pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
  // scale the relief to the size of the element: a caudal tip must not look
  // like it was chewed, while a femur can carry real rugosity
  geo.computeBoundingSphere();
  const r = geo.boundingSphere ? geo.boundingSphere.radius : 1;
  amp *= clamp(r / 0.7, 0.18, 1.6);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = vnoise(x * freq, y * freq, z * freq) * 0.65
            + vnoise(x * freq * 3.1, y * freq * 3.1, z * freq * 3.1) * 0.25
            + vnoise(x * freq * 9.3, y * freq * 9.3, z * freq * 9.3) * 0.10;
    const d = n * amp;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* Long-bone factory: a shaft with expanded proximal/distal ends, an anatomical
 * bow, and an elliptical section that rotates along the shaft. */
export function longBone({
  length, bow = 0.04, bowAxis = [1, 0, 0], twist = 0,
  prox = 0.16, shaft = 0.075, dist = 0.14, depth = 0.85,
  proxNeck = 0.13, distNeck = 0.82, radial = 16,
}) {
  const ax = new THREE.Vector3(...bowAxis).normalize();
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const b = Math.sin(t * Math.PI) * bow * length;
    pts.push([ax.x * b, t * length, ax.z * b]);
  }
  const widths = [prox, lerp(prox, shaft, 0.75), shaft * 1.02, shaft, shaft * 1.05, lerp(shaft, dist, 0.7), dist];
  const depths = widths.map((w, i) => w * lerp(depth, 1.0, Math.abs(i / 6 - 0.5) * 2 * 0.35));
  const g = sweep(pts, widths, depths, { radial, steps: 40, rollFn: t => twist * t });
  return g;
}
