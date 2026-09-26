import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const cache = new Map();
let tintSeed = 1000;

/**
 * Shared flat-shaded material cache so the whole scene keeps the same
 * low-poly look and we do not leak hundreds of duplicate materials.
 */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = cache.get(key);
  if (m) return m;
  // Defaults first, then everything the caller asked for. Spreading the rest
  // matters: an explicit whitelist silently swallowed vertexColors and
  // polygonOffset, which is a very quiet way to lose a material's whole look.
  const { flatShading, roughness, metalness, emissive, ...rest } = opts;
  m = new THREE.MeshStandardMaterial({
    color,
    flatShading: flatShading !== false,
    roughness: roughness !== undefined ? roughness : 0.92,
    metalness: metalness !== undefined ? metalness : 0.04,
    emissive: emissive !== undefined ? new THREE.Color(emissive) : new THREE.Color(0x000000),
    ...rest,
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

/**
 * Collapse a group of static meshes into one mesh per material, baking each
 * child's transform. Purely a draw-call optimisation — only use it on things
 * that never move or animate after construction.
 */
export function flattenStatic(root, { tint = 0 } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const drop = [];

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keepSeparate) return;
    let b = buckets.get(o.material);
    if (!b) {
      b = { material: o.material, parts: [], cast: false, receive: false };
      buckets.set(o.material, b);
    }
    const g = o.geometry.clone();
    g.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    b.parts.push(g);
    b.cast = b.cast || o.castShadow;
    b.receive = b.receive || o.receiveShadow;
    drop.push(o);
  });

  const attrKey = (g) => Object.keys(g.attributes).sort().join(',');

  for (const o of drop) if (o.parent) o.parent.remove(o);
  for (const b of buckets.values()) {
    if (!b.parts.length) continue;
    // Keep uv/normal data when every part agrees on it — textured pieces such
    // as the mine warning boards would otherwise lose their uvs.
    let geo = null;
    const flat = b.parts.map((g) => (g.index ? g.toNonIndexed() : g));
    if (flat.every((g) => attrKey(g) === attrKey(flat[0]))) {
      geo = mergeGeometries(flat, false);
    }
    let geometry = geo || mergeParts(b.parts);
    let material = b.material;
    // Optional per-facet tonal variation, so big flat castings and slab-sided
    // hulls do not read as plastic.
    if (tint > 0 && !material.map && !material.transparent && !material.vertexColors) {
      geometry = tintFaces(geometry, `#${material.color.getHexString()}`, tint, ++tintSeed);
      material = tintedMaterial({
        roughness: material.roughness,
        metalness: material.metalness,
      });
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  }
  return root;
}

/**
 * Give a merged geometry a per-face colour jitter. Cast concrete, sandbags and
 * sheet steel all read as plastic without it; a couple of percent of tonal
 * variation per facet is enough to make a big flat wall look poured.
 *
 * The geometry must be non-indexed (everything from mergeParts is). Pair it
 * with a white material that has vertexColors enabled.
 */
export function tintFaces(geo, baseHex, amount = 0.055, seed = 7) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const base = new THREE.Color(baseHex);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rand() - 0.5) * 2 * amount;
    // a touch of warm/cool drift as well as brightness
    const warm = 1 + (rand() - 0.5) * amount * 0.7;
    const r = Math.min(1, base.r * k * warm);
    const gg = Math.min(1, base.g * k);
    const b = Math.min(1, (base.b * k) / warm);
    for (let v = 0; v < 3 && i + v < n; v++) {
      colors[(i + v) * 3] = r;
      colors[(i + v) * 3 + 1] = gg;
      colors[(i + v) * 3 + 2] = b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** White base material that takes its colour from per-face vertex colours. */
export function tintedMaterial(opts = {}) {
  return mat(0xffffff, { vertexColors: true, ...opts });
}
