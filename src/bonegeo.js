/**
 * bonegeo.js — procedural osteological geometry helpers.
 *
 * Every bone is generated as a swept tube along a (usually curved) centre-line
 * that runs from the PROXIMAL end at the local origin toward local +X.
 * Radii vary along the shaft so real bone morphology (expanded epiphyses,
 * narrow diaphysis, olecranon / trochanter bumps) can be reproduced.
 */
import * as THREE from 'three';

export const BONE_MAT = new THREE.MeshStandardMaterial({
  color: 0xe9e1cd,
  roughness: 0.62,
  metalness: 0.0,
  side: THREE.DoubleSide,
  flatShading: false,
});

export const CARTILAGE_MAT = new THREE.MeshStandardMaterial({
  color: 0xd8cbb0, roughness: 0.85, side: THREE.DoubleSide,
});

export const KERATIN_MAT = new THREE.MeshStandardMaterial({
  color: 0xf0c33c, roughness: 0.35, side: THREE.DoubleSide,
});

export const CLAW_MAT = new THREE.MeshStandardMaterial({
  color: 0x22242a, roughness: 0.3, side: THREE.DoubleSide,
});

/** Smooth bump used to sculpt tubercles / condyles onto a shaft. */
export function bump(t, centre, width, height) {
  const d = (t - centre) / width;
  return d * d > 1 ? 0 : height * Math.pow(Math.cos(d * Math.PI * 0.5), 2);
}

/**
 * Build a tube swept along a centre line.
 * @param {number} length        bone length along +X (metres)
 * @param {(t:number)=>number} radiusFn      radius at parameter t in [0,1]
 * @param {(t:number)=>[number,number]} [bendFn] lateral (y,z) offset of centreline
 * @param {object} [opt] {seg, radial, squashY, squashZ, mat}
 */
export function boneTube(length, radiusFn, bendFn, opt = {}) {
  const seg = opt.seg || 34;
  const radial = opt.radial || 12;
  const sy = opt.squashY ?? 1;
  const sz = opt.squashZ ?? 1;

  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const off = bendFn ? bendFn(t) : [0, 0];
    pts.push(new THREE.Vector3(t * length, off[0], off[1]));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(seg, false);

  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const P = pts[i];
    const N = frames.normals[i], B = frames.binormals[i];
    const r = Math.max(1e-5, radiusFn(t));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a), sn = Math.sin(a);
      const nx = N.x * cx * sy + B.x * sn * sz;
      const ny = N.y * cx * sy + B.y * sn * sz;
      const nz = N.z * cx * sy + B.z * sn * sz;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      const L = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / L, ny / L, nz / L);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, opt.mat || BONE_MAT);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Ellipsoidal blob — used for condyles, epiphyses, braincase, otic capsules. */
export function blob(rx, ry, rz, x = 0, y = 0, z = 0, mat = BONE_MAT) {
  const g = new THREE.SphereGeometry(1, 16, 12);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** A thin curved plate (scapula blade, sternal plate, ilium, orbital rim). */
export function plate(pathPts, thickness, mat = BONE_MAT) {
  const curve = new THREE.CatmullRomCurve3(pathPts.map(p => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, 40, thickness, 8, false);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Container node helper. */
export function node(name, parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(...pos);
  o.rotation.set(...rot);
  o.userData.rest = o.quaternion.clone();
  o.userData.restPos = o.position.clone();
  if (parent) parent.add(o);
  return o;
}

/** Generic long-bone profile: expanded ends, slim diaphysis. */
export function longBoneProfile(rEnd0, rMid, rEnd1, p = 2.2) {
  return (t) => {
    const e0 = Math.pow(1 - t, p);
    const e1 = Math.pow(t, p);
    return rMid + (rEnd0 - rMid) * e0 + (rEnd1 - rMid) * e1;
  };
}
