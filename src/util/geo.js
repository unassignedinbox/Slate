import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Geometry helpers + a batcher that merges every static prop in the world into
// one mesh per material. Thousands of hedgehogs, mines, sandbags, teeth and
// wire pickets end up as ~15 draw calls.
//
// Note on normals: geometry.applyMatrix4 transforms normals with the correct
// normal matrix, and we never use mirrored (negative determinant) transforms,
// so nothing in the world ends up inside-out.
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();

export function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function cyl(rt, rb, h, seg, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function sphere(r, mat, x = 0, y = 0, z = 0, wseg = 7, hseg = 5) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, wseg, hseg), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A squashed low-poly sandbag with a bit of deterministic lumpiness. */
export function sandbagGeo(w = 1.6, h = 0.62, d = 0.95, jitter = 0.08, seed = 1) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 1, 1);
  const p = g.attributes.position;
  let s = seed * 9301;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) + rnd() * jitter * 2,
      p.getY(i) + rnd() * jitter,
      p.getZ(i) + rnd() * jitter * 2,
    );
  }
  g.computeVertexNormals();
  return g;
}

/** Extrude a closed 2D profile (in XY) along Z with flat caps. */
export function prism(points2, depth, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(points2[0][0], points2[0][1]);
  for (let i = 1; i < points2.length; i++) shape.lineTo(points2[i][0], points2[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, mat);
}

/**
 * Tapered slab (frustum block) - the workhorse for concrete fortifications.
 * wb/wt and db/dt are HALF extents at the base and the top; the block sits on
 * y = 0 and rises to y = h.
 */
export function taperBox(wb, wt, h, db, dt, mat) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1);
  g.rotateY(Math.PI / 4);
  const p = g.attributes.position;
  const K = Math.SQRT2 * 2; // maps the rotated unit quad onto +/- 1 half extents
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setX(i, p.getX(i) * K * (top ? wt : wb));
    p.setZ(i, p.getZ(i) * K * (top ? dt : db));
    p.setY(i, (p.getY(i) + 0.5) * h);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/**
 * Merge every *direct* child mesh of a container into one mesh per material,
 * leaving child Groups (pivots, toggled effects) untouched. Used on the MG
 * turrets and aircraft so an animated model costs 2-3 draw calls instead of 40.
 */
export function mergeInPlace(container) {
  const byMat = new Map();
  for (const child of [...container.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.deleteAttribute('uv2');
    g.clearGroups();
    g.applyMatrix4(child.matrix);
    let arr = byMat.get(child.material);
    if (!arr) byMat.set(child.material, (arr = []));
    arr.push(g);
    container.remove(child);
  }
  for (const [mat, geos] of byMat) {
    const merged = BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    container.add(mesh);
    for (const g of geos) g.dispose();
  }
  return container;
}

export class Batcher {
  constructor() {
    this.groups = new Map(); // material -> geometry[]
  }

  /** Bake an object3D (with its local transform tree) at `matrix`. */
  add(object, matrix = null) {
    object.updateMatrixWorld(true);
    object.traverse((child) => {
      if (!child.isMesh) return;
      const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      g.deleteAttribute('uv');
      g.deleteAttribute('uv1');
      g.deleteAttribute('uv2');
      g.clearGroups();
      _m.copy(child.matrixWorld);
      if (matrix) _m.premultiply(matrix);
      g.applyMatrix4(_m);
      const mat = child.material;
      let arr = this.groups.get(mat);
      if (!arr) this.groups.set(mat, (arr = []));
      arr.push(g);
    });
  }

  /** Place a prop at a world position with yaw + uniform scale. */
  place(object, x, y, z, yaw = 0, scale = 1) {
    _m.identity();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(scale, scale, scale),
    );
    this.add(object, m);
  }

  build(name = 'batched') {
    const root = new THREE.Group();
    root.name = name;
    for (const [mat, geos] of this.groups) {
      if (!geos.length) continue;
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.groups.clear();
    return root;
  }
}
