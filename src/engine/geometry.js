import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURFACE_Y, PAVING_Y } from '../lib/topology.js';

function geometry(positions, indices, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      uv ||
        positions.flatMap((_, i) => (i % 3 === 0 ? [positions[i] / 4, positions[i + 2] / 4] : [])),
      2,
    ),
  );
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
function upTriangle(indices, positions, a, b, c) {
  const at = (i) => ({ x: positions[i * 3], z: positions[i * 3 + 2] });
  const p = at(a),
    q = at(b),
    r = at(c);
  const y = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
  if (Math.abs(y) < 1e-9) return;
  indices.push(a, y > 0 ? b : c, y > 0 ? c : b);
}

export function surfaceRibbonGeometry(samples, width, offset = 0, lift = SURFACE_Y, heightAt) {
  const positions = [],
    indices = [];
  for (const s of samples)
    for (const side of [-1, 1]) {
      const p = s.point.clone().addScaledVector(s.normal, offset + (side * width) / 2);
      positions.push(p.x, p.y + (heightAt ? heightAt(p, lift) : lift), p.z);
    }
  for (let i = 0; i < samples.length - 1; i++) {
    const v = i * 2;
    upTriangle(indices, positions, v, v + 1, v + 2);
    upTriangle(indices, positions, v + 1, v + 3, v + 2);
  }
  return geometry(positions, indices);
}

export function polygonGeometry(boundary, lift = SURFACE_Y, center) {
  const positions = boundary.flatMap((p) => [p.x, p.y + lift, p.z]);
  const contour = boundary.map((p) => new THREE.Vector2(p.x, -p.z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []),
    indices = [];
  let inserted = false;
  const inTriangle = (a, b, c, p) => {
    const orient = (v, w, x) => (w.x - v.x) * (x.z - v.z) - (w.z - v.z) * (x.x - v.x);
    const s = [orient(a, b, p), orient(b, c, p), orient(c, a, p)];
    return s.every((v) => v > 0.000001) || s.every((v) => v < -0.000001);
  };
  for (const [a, b, c] of triangles) {
    if (center && !inserted && inTriangle(boundary[a], boundary[b], boundary[c], center)) {
      const v = positions.length / 3;
      positions.push(center.x, center.y + lift, center.z);
      upTriangle(indices, positions, a, b, v);
      upTriangle(indices, positions, b, c, v);
      upTriangle(indices, positions, c, a, v);
      inserted = true;
    } else upTriangle(indices, positions, a, b, c);
  }
  return geometry(positions, indices);
}

export function pavementReturnGeometry(inner, outer, heightAt) {
  const positions = [],
    indices = [];
  for (let i = 0; i < inner.length; i++) {
    for (const p of [inner[i], outer[i]])
      positions.push(p.x, p.y + (heightAt ? heightAt(p, PAVING_Y, i) : PAVING_Y), p.z);
  }
  for (let i = 0; i < inner.length - 1; i++) {
    const v = i * 2;
    upTriangle(indices, positions, v, v + 1, v + 2);
    upTriangle(indices, positions, v + 1, v + 3, v + 2);
  }
  return geometry(positions, indices);
}

/** Closed swept rectangular beam/slab. World-space UVs match pavement surfaces. */
export function volumeRibbonGeometry(samples, width, offset, bottom, top) {
  const positions = [],
    indices = [],
    uv = [];
  const vertex = (p) => {
    positions.push(p.x, p.y, p.z);
    uv.push(p.x / 4, p.z / 4);
  };
  const edge = (s, side, height) => {
    const p = s.point.clone().addScaledVector(s.normal, offset + (side * width) / 2);
    p.y += typeof height === 'function' ? height(s) : height;
    return p;
  };
  // Four independent face strips share vertices longitudinally. Hard normals
  // at the cross-section corners are retained without 16 new vertices per
  // spline segment (critical for large-city GLB export memory).
  for (const s of samples) {
    const lt = edge(s, -1, top),
      rt = edge(s, 1, top),
      lb = edge(s, -1, bottom),
      rb = edge(s, 1, bottom);
    [lt, rt, lb, rb, lt, lb, rb, rt].forEach(vertex);
  }
  for (let i = 0; i < samples.length - 1; i++) {
    const v = i * 8,
      w = v + 8;
    indices.push(
      v,
      v + 1,
      w,
      v + 1,
      w + 1,
      w,
      v + 2,
      w + 2,
      v + 3,
      v + 3,
      w + 2,
      w + 3,
      v + 4,
      w + 4,
      v + 5,
      v + 5,
      w + 4,
      w + 5,
      v + 6,
      w + 6,
      v + 7,
      v + 7,
      w + 6,
      w + 7,
    );
  }
  const cap = (s, end) => {
    const v = positions.length / 3;
    [edge(s, -1, top), edge(s, 1, top), edge(s, -1, bottom), edge(s, 1, bottom)].forEach(vertex);
    if (end) indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    else indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  };
  if (samples.length) {
    cap(samples[0], false);
    cap(samples.at(-1), true);
  }
  if (
    samples.length &&
    samples[0].normal.dot(new THREE.Vector3(-samples[0].tangent.z, 0, samples[0].tangent.x)) < 0
  )
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return geometry(positions, indices, uv);
}

export function pathSamples(path, outward = false) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)],
      b = path[Math.min(path.length - 1, i + 1)];
    const tangent = b.clone().sub(a).normalize();
    return {
      point: p.clone(),
      tangent,
      normal: new THREE.Vector3(-tangent.z, 0, tangent.x)
        .normalize()
        .multiplyScalar(outward ? -1 : 1),
      distance: i,
    };
  });
}

/** Weld across road/junction seams, then recompute normals together. UVs use
 * world X/Z throughout, so they do not prevent shared surface vertices.
 */
export function weldGeometries(geometries, groups = false) {
  if (!geometries.length) return geometry([], []);
  const copies = geometries.map((g) => {
    const c = g.clone();
    c.deleteAttribute('normal');
    return c;
  });
  const merged = mergeGeometries(copies, groups);
  copies.forEach((g) => g.dispose());
  const welded = mergeVertices(merged, 0.0001);
  merged.dispose();
  welded.computeVertexNormals();
  return welded;
}

/** Pure geometry entry point for regression tests, no DOM/WebGL needed. */
export function networkSurfaceGeometry(topology) {
  const parts = [];
  for (const p of topology.plans.values()) parts.push(surfaceRibbonGeometry(p.samples, p.carriage));
  for (const j of topology.junctions) parts.push(polygonGeometry(j.boundary, SURFACE_Y, j));
  const result = weldGeometries(parts);
  parts.forEach((g) => g.dispose());
  return result;
}

export function profileRibbonGeometry(samples, offsets, lift = SURFACE_Y) {
  const positions = [],
    indices = [],
    n = offsets.length;
  for (const s of samples)
    for (const offset of offsets) {
      const p = s.point.clone().addScaledVector(s.normal, offset);
      positions.push(p.x, p.y + lift, p.z);
    }
  for (let i = 0; i < samples.length - 1; i++)
    for (let j = 0; j < n - 1; j++) {
      const v = i * n + j;
      upTriangle(indices, positions, v, v + 1, v + n);
      upTriangle(indices, positions, v + 1, v + n + 1, v + n);
    }
  return geometry(positions, indices);
}

export function polygonVolumeGeometry(boundary, bottom, top, center) {
  const roof = polygonGeometry(boundary, top, center);
  const floor = polygonGeometry(boundary, bottom, center);
  for (let i = 0; i < floor.index.count; i += 3) {
    const b = floor.index.getX(i + 1);
    floor.index.setX(i + 1, floor.index.getX(i + 2));
    floor.index.setX(i + 2, b);
  }
  floor.computeVertexNormals();
  const p = [],
    indices = [];
  const area = boundary.reduce((sum, a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    return sum + a.x * b.z - b.x * a.z;
  }, 0);
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      v = p.length / 3;
    p.push(
      a.x,
      a.y + top,
      a.z,
      b.x,
      b.y + top,
      b.z,
      a.x,
      a.y + bottom,
      a.z,
      b.x,
      b.y + bottom,
      b.z,
    );
    if (area > 0) indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    else indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const sides = geometry(p, indices),
    result = weldGeometries([roof, floor, sides]);
  roof.dispose();
  floor.dispose();
  sides.dispose();
  return result;
}

/** Indexed ribbon with an independently authored height at every lateral
 * station: curb drops are part of the paving, not overlays on a raised slab. */
export function gridRibbonGeometry(samples, offsets, heightAt) {
  const positions = [],
    indices = [],
    columns = offsets.length;
  for (const s of samples)
    for (const offset of offsets) {
      const p = s.point.clone().addScaledVector(s.normal, offset);
      positions.push(p.x, p.y + heightAt(s, offset), p.z);
    }
  for (let row = 0; row < samples.length - 1; row++)
    for (let col = 0; col < columns - 1; col++) {
      const a = row * columns + col,
        b = a + 1,
        c = a + columns,
        d = c + 1;
      upTriangle(indices, positions, a, b, c);
      upTriangle(indices, positions, b, d, c);
    }
  return geometry(positions, indices);
}
