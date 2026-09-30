// ---------------------------------------------------------------------------
// Convex polyhedron representation + plane slicing.
// This is the core "destruction geometry kernel": every fracture technique in
// the lab (radial glass patterns, wood splinters, rock recursion, wall chunk
// baking) bottoms out in slicing convex cells with planes — the same primitive
// used by NVIDIA Blast / Müller et al. 2013 (VACD pattern fracture).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export interface Shard {
  // Each face is an independent loop of vertices, wound CCW seen from outside.
  faces: THREE.Vector3[][];
  // Per-face flag: true if the face is a freshly created fracture surface.
  inner: boolean[];
}

const EPS = 1e-6;

export function cloneShard(s: Shard): Shard {
  return {
    faces: s.faces.map((f) => f.map((v) => v.clone())),
    inner: s.inner.slice(),
  };
}

export function makeBoxShard(
  w: number,
  h: number,
  d: number,
  center = new THREE.Vector3()
): Shard {
  const x = w / 2, y = h / 2, z = d / 2;
  const p = (a: number, b: number, c: number) =>
    new THREE.Vector3(a + center.x, b + center.y, c + center.z);
  const faces = [
    [p(-x, -y, -z), p(-x, -y, z), p(-x, y, z), p(-x, y, -z)], // -X
    [p(x, -y, -z), p(x, y, -z), p(x, y, z), p(x, -y, z)], // +X
    [p(-x, -y, -z), p(x, -y, -z), p(x, -y, z), p(-x, -y, z)], // -Y
    [p(-x, y, -z), p(-x, y, z), p(x, y, z), p(x, y, -z)], // +Y
    [p(-x, -y, -z), p(-x, y, -z), p(x, y, -z), p(x, -y, -z)], // -Z
    [p(-x, -y, z), p(x, -y, z), p(x, y, z), p(-x, y, z)], // +Z
  ];
  return { faces, inner: faces.map(() => false) };
}

/** Newell normal of a (roughly planar) polygon. */
export function faceNormal(face: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < face.length; i++) {
    const a = face[i];
    const b = face[(i + 1) % face.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

/** Signed volume + centroid via divergence theorem. */
export function volumeCentroid(s: Shard): { volume: number; centroid: THREE.Vector3 } {
  let vol = 0;
  const c = new THREE.Vector3();
  for (const face of s.faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const a = face[0], b = face[i], d = face[i + 1];
      const v = a.dot(new THREE.Vector3().crossVectors(b, d)) / 6;
      vol += v;
      c.x += (v * (a.x + b.x + d.x)) / 4;
      c.y += (v * (a.y + b.y + d.y)) / 4;
      c.z += (v * (a.z + b.z + d.z)) / 4;
    }
  }
  if (Math.abs(vol) > 1e-12) c.divideScalar(vol);
  return { volume: vol, centroid: c };
}

interface ClipResult {
  kept: THREE.Vector3[];
  cuts: THREE.Vector3[];
}

/** Keep the part of `face` with signed distance <= 0 to the plane. */
function clipFace(face: THREE.Vector3[], plane: THREE.Plane): ClipResult {
  const kept: THREE.Vector3[] = [];
  const cuts: THREE.Vector3[] = [];
  const n = face.length;
  for (let i = 0; i < n; i++) {
    const a = face[i];
    const b = face[(i + 1) % n];
    const da = plane.distanceToPoint(a);
    const db = plane.distanceToPoint(b);
    if (da <= EPS) kept.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      const p = a.clone().lerp(b, t);
      kept.push(p);
      cuts.push(p);
    }
  }
  return { kept, cuts };
}

function dedupe(points: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    let found = false;
    for (const q of out) {
      if (p.distanceToSquared(q) < 1e-10) {
        found = true;
        break;
      }
    }
    if (!found) out.push(p);
  }
  return out;
}

/** Build the cap polygon on the slicing plane, wound so its normal = `normal`. */
function buildCap(points: THREE.Vector3[], normal: THREE.Vector3): THREE.Vector3[] | null {
  const pts = dedupe(points);
  if (pts.length < 3) return null;
  const centroid = new THREE.Vector3();
  for (const p of pts) centroid.add(p);
  centroid.divideScalar(pts.length);
  // basis in plane
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(u)) > 0.9) u.set(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(normal, u).normalize();
  const t2 = new THREE.Vector3().crossVectors(normal, t1);
  pts.sort((a, b) => {
    const pa = Math.atan2(a.clone().sub(centroid).dot(t2), a.clone().sub(centroid).dot(t1));
    const pb = Math.atan2(b.clone().sub(centroid).dot(t2), b.clone().sub(centroid).dot(t1));
    return pa - pb;
  });
  // ensure winding matches `normal`
  const fn = faceNormal(pts);
  if (fn.dot(normal) < 0) pts.reverse();
  return pts;
}

export interface SliceOptions {
  /** Displace cap vertices along the plane normal with matched noise so the
   * two fracture faces stay coincident but look rough (rock / concrete). */
  roughness?: number;
  noiseScale?: number;
}

function hashNoise(p: THREE.Vector3, scale: number): number {
  const s = Math.sin(p.x * 127.1 * scale + p.y * 311.7 * scale + p.z * 74.7 * scale) * 43758.5453;
  return (s - Math.floor(s)) - 0.5;
}

/**
 * Slice a convex shard by a plane. Returns the piece below (dist<=0) and above.
 * Either may be null if degenerate.
 */
export function sliceShard(
  shard: Shard,
  plane: THREE.Plane,
  opts: SliceOptions = {}
): { below: Shard | null; above: Shard | null } {
  const belowFaces: THREE.Vector3[][] = [];
  const belowInner: boolean[] = [];
  const aboveFaces: THREE.Vector3[][] = [];
  const aboveInner: boolean[] = [];
  const cutPoints: THREE.Vector3[] = [];

  const negPlane = new THREE.Plane(plane.normal.clone().negate(), -plane.constant);

  for (let fi = 0; fi < shard.faces.length; fi++) {
    const face = shard.faces[fi];
    const rb = clipFace(face, plane);
    if (rb.kept.length >= 3) {
      belowFaces.push(rb.kept);
      belowInner.push(shard.inner[fi]);
    }
    const ra = clipFace(face, negPlane);
    if (ra.kept.length >= 3) {
      aboveFaces.push(ra.kept);
      aboveInner.push(shard.inner[fi]);
    }
    cutPoints.push(...rb.cuts);
  }

  if (belowFaces.length === 0 || aboveFaces.length === 0) {
    // plane missed the shard
    return {
      below: belowFaces.length ? { faces: belowFaces, inner: belowInner } : null,
      above: aboveFaces.length ? { faces: aboveFaces, inner: aboveInner } : null,
    };
  }

  const cap = buildCap(cutPoints, plane.normal);
  if (cap) {
    // Optional rough fracture surface: displace matched points along the plane
    // normal by deterministic noise -> both sides remain coincident.
    let capBelow = cap;
    if (opts.roughness && cap.length >= 3) {
      const amp = opts.roughness;
      const scale = opts.noiseScale ?? 25;
      capBelow = cap.map((p) =>
        p.clone().addScaledVector(plane.normal, hashNoise(p, scale) * amp)
      );
    }
    belowFaces.push(capBelow.slice()); // cap normal must point OUT of below => +normal
    belowInner.push(true);
    aboveFaces.push(capBelow.slice().reverse());
    aboveInner.push(true);
  }

  const below: Shard = { faces: belowFaces, inner: belowInner };
  const above: Shard = { faces: aboveFaces, inner: aboveInner };
  return {
    below: volumeCentroid(below).volume > 1e-9 ? below : null,
    above: volumeCentroid(above).volume > 1e-9 ? above : null,
  };
}

/** Unique vertices of a shard (for physics contact sampling). */
export function shardVertices(s: Shard, max = 24): THREE.Vector3[] {
  const all: THREE.Vector3[] = [];
  for (const f of s.faces) all.push(...f);
  const uniq = dedupe(all);
  if (uniq.length <= max) return uniq;
  const step = uniq.length / max;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < max; i++) out.push(uniq[Math.floor(i * step)]);
  return out;
}

/**
 * Convert a shard to BufferGeometry with flat shading.
 * Group 0 = original surface material, group 1 = fracture surface material.
 */
export function shardToGeometry(s: Shard): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  const order: number[] = [];
  for (let i = 0; i < s.faces.length; i++) order.push(i);
  order.sort((a, b) => Number(s.inner[a]) - Number(s.inner[b]));

  let outerTris = 0;
  let totalTris = 0;
  for (const fi of order) {
    const face = s.faces[fi];
    const n = faceNormal(face);
    for (let i = 1; i + 1 < face.length; i++) {
      const a = face[0], b = face[i], c = face[i + 1];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      norm.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
      totalTris++;
      if (!s.inner[fi]) outerTris++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.addGroup(0, outerTris * 3, 0);
  if (totalTris > outerTris) geo.addGroup(outerTris * 3, (totalTris - outerTris) * 3, 1);
  return geo;
}

/** Translate a shard in place. */
export function translateShard(s: Shard, offset: THREE.Vector3): void {
  for (const f of s.faces) for (const v of f) v.add(offset);
}

/** Approximate radius (max vertex distance from centroid). */
export function shardRadius(s: Shard, centroid: THREE.Vector3): number {
  let r = 0;
  for (const f of s.faces) for (const v of f) r = Math.max(r, v.distanceTo(centroid));
  return r;
}
