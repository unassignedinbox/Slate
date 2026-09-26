import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map();

/**
 * Shared flat-shaded material cache so the whole scene keeps the same
 * low-poly look and we do not leak hundreds of duplicate materials.
 */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = cache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color,
    flatShading: opts.flatShading !== false,
    roughness: opts.roughness !== undefined ? opts.roughness : 0.92,
    metalness: opts.metalness !== undefined ? opts.metalness : 0.04,
    transparent: !!opts.transparent,
    opacity: opts.opacity !== undefined ? opts.opacity : 1,
    emissive: opts.emissive !== undefined ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1,
    side: opts.side || THREE.FrontSide,
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
  });
  cache.set(key, m);
  return m;
}

export function clearMaterialCache() {
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Loft a series of cross sections into a closed low-poly hull.
 * sections: [{ z, pts: [[x, y], ...] }] — every section needs the same
 * number of points, ordered consistently around the outline.
 */
export function buildLoft(sections, { capStart = true, capEnd = true } = {}) {
  const positions = [];
  const center = new THREE.Vector3();
  let count = 0;
  for (const s of sections) {
    for (const p of s.pts) {
      center.x += p[0];
      center.y += p[1];
      center.z += s.z;
      count++;
    }
  }
  center.multiplyScalar(1 / Math.max(1, count));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const ref = new THREE.Vector3();

  const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, refPoint) => {
    a.set(ax, ay, az);
    b.set(bx, by, bz);
    c.set(cx, cy, cz);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    ref.copy(mid).sub(refPoint || center);
    if (n.dot(ref) < 0) {
      positions.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    } else {
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    }
  };

  for (let s = 0; s < sections.length - 1; s++) {
    const s0 = sections[s];
    const s1 = sections[s + 1];
    const n0 = s0.pts.length;
    for (let i = 0; i < n0; i++) {
      const j = (i + 1) % n0;
      const p0 = s0.pts[i];
      const p1 = s0.pts[j];
      const q0 = s1.pts[i];
      const q1 = s1.pts[j];
      pushTri(p0[0], p0[1], s0.z, p1[0], p1[1], s0.z, q1[0], q1[1], s1.z);
      pushTri(p0[0], p0[1], s0.z, q1[0], q1[1], s1.z, q0[0], q0[1], s1.z);
    }
  }

  const capSection = (sec, outwardZ) => {
    const pts = sec.pts;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
    }
    cx /= pts.length;
    cy /= pts.length;
    const refPoint = new THREE.Vector3(cx, cy, sec.z - outwardZ * 5);
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      pushTri(cx, cy, sec.z, pts[i][0], pts[i][1], sec.z, pts[j][0], pts[j][1], sec.z, refPoint);
    }
  };

  if (capStart) capSection(sections[0], -1);
  if (capEnd) capSection(sections[sections.length - 1], 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Quad helper (returns non-indexed geometry from 4 corner Vector3-likes). */
export function quadGeometry(p0, p1, p2, p3) {
  const positions = [
    ...p0, ...p1, ...p2,
    ...p0, ...p2, ...p3,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Simple convex prism from a 2D polygon extruded along Y. */
export function prismGeometry(poly, height, yBase = 0) {
  const sections = [
    { z: yBase, pts: poly },
    { z: yBase + height, pts: poly },
  ];
  const geo = buildLoft(sections);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Merge a pile of geometries into one. Anything indexed is flattened first so
 * hand-built lofts and primitive geometry can be mixed freely.
 */
export function mergeParts(parts) {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    // Only position survives the merge — everything here is flat shaded and
    // untextured, and mismatched uv/normal sets make mergeGeometries bail.
    for (const name of Object.keys(f.attributes)) {
      if (name !== 'position') f.deleteAttribute(name);
    }
    f.morphAttributes = {};
    return f;
  });
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('mergeParts failed — incompatible geometry attributes');
  merged.computeVertexNormals();
  return merged;
}
