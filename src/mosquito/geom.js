import * as THREE from 'three';

/**
 * Lathe a profile r(t) over a length, t in [0,1].
 *
 * NOTE: THREE.LatheGeometry spins around +Y. Every joint chain in this rig
 * runs along +Z (segment length = local Z, cross-section = local XY), so
 * the result is rotated into that convention here. Getting this wrong
 * explodes every limb into a row of floating tubes.
 */
export function taperedTube(length, rFn, { radial = 14, steps = 16, capStart = true, capEnd = true } = {}) {
  const pts = [];
  if (capStart) pts.push(new THREE.Vector2(0.0001, 0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector2(Math.max(0.0001, rFn(t)), t * length));
  }
  if (capEnd) pts.push(new THREE.Vector2(0.0001, length));
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateX(Math.PI / 2);          // +Y length axis -> +Z
  g.computeVertexNormals();
  return g;
}

/**
 * Body segment with a squashed cross-section (mosquitoes are not round in
 * section - the thorax is deep and narrow, the abdomen is flattened).
 * Squash is applied to X/Y, i.e. the cross-section, never the length.
 */
export function bodySegment(length, rFn, squashY = 1, squashX = 1, radial = 18, steps = 20) {
  const g = taperedTube(length, rFn, { radial, steps });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) * squashX);
    p.setY(i, p.getY(i) * squashY);
  }
  g.computeVertexNormals();
  return g;
}

/** Sharp bevelled ring - reads as a machined collar between segments. */
export function collar(r, width, bevel = 0.35, radial = 18) {
  const b = width * bevel;
  const pts = [
    new THREE.Vector2(r * 0.92, 0),
    new THREE.Vector2(r, b),
    new THREE.Vector2(r, width - b),
    new THREE.Vector2(r * 0.92, width),
  ];
  const g = new THREE.LatheGeometry(pts, radial);
  g.rotateX(Math.PI / 2);          // ring axis -> +Z, matching the chains
  g.computeVertexNormals();
  return g;
}

/**
 * Compound eye: a hemispheroid built from a subdivided icosahedron so that
 * flat shading gives real facets rather than a smooth ball.
 */
export function compoundEye(radius, detail = 3, squash = new THREE.Vector3(1, 0.86, 1.22)) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * squash.x, p.getY(i) * squash.y, p.getZ(i) * squash.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Mosquito wing.
 *
 * Built in the wing's own frame: +Z is spanwise (root -> tip), +X is
 * chordwise (leading -> trailing), Y is the camber axis.
 * Very high aspect ratio, rounded leading edge, pointed tip, slight
 * S-curve to the trailing edge - the shape is what makes the silhouette
 * read as Culicidae rather than a generic fly.
 *
 * Returns geometry with an extra `aSpan` attribute (0 at root, 1 at tip)
 * used by the shader to apply live twist + aeroelastic flexure.
 */
export function wingGeometry(length, chord, camber, spanSteps = 34, chordSteps = 7) {
  const pos = [], nrm = [], uv = [], span = [], idx = [];

  // Planform half-width as a function of span
  const halfWidth = (t) => {
    // fast widening near the root, long parallel mid-section, sharp tip
    const grow = Math.pow(Math.min(1, t / 0.18), 0.65);
    const tip = Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.9)), 0.55);
    return 0.5 * chord * grow * tip;
  };
  // Chordwise camber profile (thin, slightly reflexed trailing edge)
  const camberY = (c) => {
    const s = Math.sin(Math.PI * c);
    return camber * chord * (s - 0.35 * Math.sin(2 * Math.PI * c));
  };
  // The leading edge is not straight - it sweeps back slightly
  const sweep = (t) => 0.12 * chord * Math.pow(t, 1.7);

  for (let i = 0; i <= spanSteps; i++) {
    const t = i / spanSteps;
    const hw = halfWidth(t);
    const cx = sweep(t);
    for (let j = 0; j <= chordSteps; j++) {
      const c = j / chordSteps;
      const x = cx + (c - 0.42) * 2 * hw;
      const y = camberY(c) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.4)));
      const z = t * length;
      pos.push(x, y, z);
      nrm.push(0, 1, 0);
      uv.push(c, t);
      span.push(t);
    }
  }
  const stride = chordSteps + 1;
  for (let i = 0; i < spanSteps; i++) {
    for (let j = 0; j < chordSteps; j++) {
      const a = i * stride + j, b = a + 1, cc = a + stride, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Longitudinal wing veins as thin tubes riding the planform. */
export function wingVeins(length, chord, veinCount) {
  const merged = [];
  for (let v = 0; v < veinCount; v++) {
    const c = (v + 0.6) / (veinCount + 0.2); // chordwise seat of this vein
    const pts = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const grow = Math.pow(Math.min(1, t / 0.18), 0.65);
      const tip = Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 1.9)), 0.55);
      const hw = 0.5 * chord * grow * tip;
      const cx = 0.12 * chord * Math.pow(t, 1.7);
      // veins fan out from a common base
      const cc = 0.5 + (c - 0.5) * Math.min(1, 0.25 + t * 1.6);
      pts.push(new THREE.Vector3(cx + (cc - 0.42) * 2 * hw, 0, t * length));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r = chord * (v === 0 ? 0.045 : 0.026) * (1 - 0.35 * (v / veinCount));
    merged.push(new THREE.TubeGeometry(curve, 24, r, 5, false));
  }
  return merged;
}

/** Helical flutes for the boring head. */
export function drillHead(length, radius, flutes, pitch) {
  const group = [];
  const core = taperedTube(length, (t) => radius * (0.25 + 0.75 * Math.pow(1 - t, 0.55)), { radial: 12, steps: 14 });
  group.push(core);
  for (let f = 0; f < flutes; f++) {
    const pts = [];
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = (f / flutes) * Math.PI * 2 + (t * length / pitch) * Math.PI * 2;
      const r = radius * (0.3 + 0.7 * Math.pow(1 - t, 0.55));
      pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r, t * length));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    group.push(new THREE.TubeGeometry(curve, 30, radius * 0.11, 4, false));
  }
  return group;
}

/** Recessed panel line - a thin dark inset ring. */
export function panelRing(r, z, depth, radial = 18) {
  const g = new THREE.CylinderGeometry(r - depth, r - depth, depth * 1.6, radial, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, z);
  return g;
}

export function tmpGroup(geoms, material) {
  const g = new THREE.Group();
  for (const geo of geoms) g.add(new THREE.Mesh(geo, material));
  return g;
}
