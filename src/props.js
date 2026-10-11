// Street furniture: bollards, speed bumps, lights, signs, railway-crossing
// equipment, trees, benches, subway entrances. Each prop returns pieces
// [{mat, geo}] so both single props and batched city builds share one source.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterials } from './materials.js';

const signTextureCache = new Map();

function signTexture(label) {
  if (signTextureCache.has(label)) return signTextureCache.get(label);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#f2f2f2';
  x.beginPath();
  x.arc(64, 64, 60, 0, Math.PI * 2);
  x.fill();
  x.lineWidth = 12;
  x.strokeStyle = '#c23b3b';
  x.beginPath();
  x.arc(64, 64, 53, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = '#1c1c1c';
  x.font = "700 58px 'DM Sans', sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(label), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  signTextureCache.set(label, t);
  return t;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return { mat, geo: g };
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 10) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return { mat, geo: g };
}

function sph(r, mat, x = 0, y = 0, z = 0, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, seg);
  g.translate(x, y, z);
  return { mat, geo: g };
}

/** Pieces for a prop kind at local origin, facing +Z before rotY. */
export function propPieces(kind, opts = {}) {
  switch (kind) {
    case 'bollard': {
      return [
        cyl(0.055, 0.075, 0.92, 'metalDark', 0, 0.46, 0, 8),
        cyl(0.062, 0.062, 0.12, 'paintWhite', 0, 0.78, 0, 8),
        sph(0.055, 'metalDark', 0, 0.93, 0, 8),
      ];
    }
    case 'speed-bump': {
      const g = new THREE.CylinderGeometry(0.28, 0.28, 3.6, 12, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, 0);
      return [
        { mat: 'yellowBlack', geo: g },
        box(3.6, 0.02, 0.5, 'paintYellow', 0, 0.015, 0),
      ];
    }
    case 'streetlight': {
      return [
        cyl(0.07, 0.1, 8, 'metalDark', 0, 4, 0, 8),
        box(0.12, 0.12, 2.6, 'metalDark', 0, 7.9, 1.25),
        box(0.36, 0.14, 0.9, 'metalDark', 0, 7.82, 2.55),
        box(0.3, 0.06, 0.75, 'lampGlass', 0, 7.72, 2.55),
        box(0.3, 0.12, 0.3, 'metalDark', 0, 0.06, 0),
      ];
    }
    case 'sign-speed': {
      const label = opts.label ?? 50;
      const tex = signTexture(label);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
      return [
        cyl(0.045, 0.05, 2.4, 'metalLight', 0, 1.2, 0, 8),
        (() => {
          const g = new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20);
          g.rotateX(Math.PI / 2);
          g.translate(0, 2.25, 0.03);
          return { mat: `__sign_${label}`, geo: g, material: mat };
        })(),
      ];
    }
    case 'crossbuck': {
      return [
        cyl(0.05, 0.06, 2.6, 'metalLight', 0, 1.3, 0, 8),
        box(1.35, 0.16, 0.05, 'paintWhite', 0, 2.55, 0, Math.PI / 4),
        box(1.35, 0.16, 0.05, 'paintWhite', 0, 2.55, 0, -Math.PI / 4),
      ];
    }
    case 'crossing-gate': {
      return [
        cyl(0.11, 0.13, 1.15, 'metalDark', 0, 0.58, 0, 10),
        box(0.42, 0.55, 0.42, 'metalDark', 0, 1.35, 0),
        sph(0.13, 'signalRed', 0.22, 1.35, 0, 10),
        // arm raised ~72 degrees
        (() => {
          const g = new THREE.BoxGeometry(4.4, 0.16, 0.1);
          g.translate(2.2, 0, 0);
          g.rotateZ(-Math.PI / 2 + 0.32);
          g.translate(0.12, 1.45, 0);
          return { mat: 'gateStripes', geo: g };
        })(),
        box(0.1, 1.4, 0.1, 'metalDark', 0.12, 2.15, 0),
      ];
    }
    case 'crossing-signal': {
      return [
        cyl(0.06, 0.075, 3.1, 'metalDark', 0, 1.55, 0, 8),
        box(0.62, 0.62, 0.14, 'metalDark', 0, 3.05, 0),
        sph(0.12, 'signalRed', -0.15, 3.05, 0.1, 10),
        sph(0.12, 'signalRed', 0.15, 3.05, 0.1, 10),
        box(1.25, 0.15, 0.05, 'paintWhite', 0, 2.45, 0, Math.PI / 4),
        box(1.25, 0.15, 0.05, 'paintWhite', 0, 2.45, 0, -Math.PI / 4),
      ];
    }
    case 'tree': {
      const s = opts.scale ?? 1;
      return [
        cyl(0.14 * s, 0.2 * s, 2.4 * s, 'bark', 0, 1.2 * s, 0, 7),
        sph(1.15 * s, 'leaf', 0, 3.1 * s, 0, 9),
        sph(0.85 * s, 'leafLight', 0.55 * s, 3.75 * s, 0.25 * s, 9),
        sph(0.75 * s, 'leaf', -0.55 * s, 3.5 * s, -0.3 * s, 9),
      ];
    }
    case 'bench': {
      return [
        box(1.8, 0.08, 0.5, 'sleeper', 0, 0.45, 0),
        box(1.8, 0.42, 0.07, 'sleeper', 0, 0.72, -0.22),
        box(0.08, 0.45, 0.5, 'metalDark', -0.8, 0.22, 0),
        box(0.08, 0.45, 0.5, 'metalDark', 0.8, 0.22, 0),
      ];
    }
    case 'hydrant': {
      return [
        cyl(0.14, 0.16, 0.55, 'paintRed', 0, 0.28, 0, 10),
        sph(0.14, 'paintRed', 0, 0.58, 0, 10),
        cyl(0.055, 0.055, 0.42, 'paintRed', 0, 0.38, 0, 8),
      ];
    }
    case 'trash': {
      return [
        cyl(0.26, 0.22, 0.78, 'metalDark', 0, 0.39, 0, 10),
        cyl(0.28, 0.28, 0.06, 'metalLight', 0, 0.81, 0, 10),
      ];
    }
    case 'subway-entrance': {
      return [
        box(3.1, 0.22, 4.4, 'concrete', 0, 0.11, 0),
        box(3.1, 0.18, 4.4, 'metalDark', 0, 2.62, 0),
        box(3.0, 2.5, 0.08, 'glass', 0, 1.36, -2.15),
        box(0.08, 2.5, 4.3, 'glass', -1.5, 1.36, 0),
        box(0.08, 2.5, 4.3, 'glass', 1.5, 1.36, 0),
        // stairwell hint: dark ramp down
        box(2.2, 0.12, 3.4, 'rubber', 0, 0.28, 0.3),
        // sign blade
        box(1.4, 0.34, 0.06, 'metalDark', 0, 2.35, -2.35),
        box(1.2, 0.2, 0.02, 'lampGlass', 0, 2.35, -2.39),
      ];
    }
    case 'platform-sign': {
      return [
        cyl(0.05, 0.06, 2.7, 'metalLight', 0, 1.35, 0, 8),
        box(1.7, 0.55, 0.07, 'metalDark', 0, 2.55, 0),
        box(1.5, 0.32, 0.02, 'lampGlass', 0, 2.55, -0.05),
      ];
    }
    default:
      return [box(0.4, 0.4, 0.4, 'metalDark', 0, 0.2, 0)];
  }
}

export const PROP_KINDS = {
  bollard: { name: 'Bollard', icon: 'Cylinder', desc: 'Protective post · pedestrian edge control', group: 'Furniture' },
  'speed-bump': { name: 'Speed bump', icon: 'Waves', desc: 'Raised traffic calming hump', group: 'Furniture' },
  streetlight: { name: 'Street light', icon: 'Lamp', desc: '8 m column with cantilever arm', group: 'Furniture' },
  'sign-speed': { name: 'Speed limit sign', icon: 'Circle', desc: 'Regulatory speed roundel', group: 'Furniture' },
  'crossing-gate': { name: 'Crossing gate', icon: 'Split', desc: 'Railway crossing boom + beacon', group: 'Rail' },
  'crossing-signal': { name: 'Crossing signal', icon: 'Siren', desc: 'Railway crossbuck + twin lamps', group: 'Rail' },
  crossbuck: { name: 'Crossbuck sign', icon: 'X', desc: 'Railway crossing warning X', group: 'Rail' },
  tree: { name: 'Tree', icon: 'Trees', desc: 'Streetscape canopy tree', group: 'Nature' },
  bench: { name: 'Bench', icon: 'Armchair', desc: 'Timber park bench', group: 'Furniture' },
  hydrant: { name: 'Hydrant', icon: 'Droplets', desc: 'Fire hydrant', group: 'Furniture' },
  trash: { name: 'Litter bin', icon: 'Trash2', desc: 'Street litter bin', group: 'Furniture' },
  'subway-entrance': { name: 'Subway entrance', icon: 'TrainFront', desc: 'Glazed stair kiosk to the metro', group: 'Transit' },
  'platform-sign': { name: 'Platform sign', icon: 'Signpost', desc: 'Transit wayfinding blade', group: 'Transit' },
};

/** Build a standalone prop group (with per-prop materials like sign faces). */
export function buildPropMesh(prop) {
  const M = getMaterials();
  const group = new THREE.Group();
  group.position.set(prop.x ?? 0, prop.y ?? 0, prop.z ?? 0);
  group.rotation.y = prop.rotY ?? 0;
  group.name = prop.name || prop.kind;
  group.userData = { objectId: prop.id, kind: 'prop' };
  for (const piece of propPieces(prop.kind, prop.opts || {})) {
    const mat = piece.material || M[piece.mat] || M.metalDark;
    const mesh = new THREE.Mesh(piece.geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Batch: push transformed prop pieces into shared buckets for merging. */
export function collectProp(kind, x, y, z, rotY, buckets, opts = {}) {
  const e = new THREE.Euler(0, rotY ?? 0, 0);
  const q = new THREE.Quaternion().setFromEuler(e);
  const pos = new THREE.Vector3(x, y, z);
  for (const piece of propPieces(kind, opts)) {
    piece.geo.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
    const mat = piece.material
      ? `__custom_${kind}_${opts.label ?? ''}`
      : piece.mat;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(piece.material ? { geo: piece.geo, material: piece.material } : piece.geo);
  }
}

export function finishPropBuckets(buckets) {
  const M = getMaterials();
  const group = new THREE.Group();
  for (const [matName, items] of buckets) {
    const geos = [];
    let material = M[matName];
    for (const it of items) {
      if (it && it.geo) {
        geos.push(it.geo);
        material = it.material;
      } else {
        geos.push(it);
      }
    }
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material || M.metalDark);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  return group;
}
