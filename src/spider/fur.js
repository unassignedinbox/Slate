import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

// Low-poly bristle geometry shared by every fur instance (a slightly
// tapered, gently curved cone reads as a seta/hair from gameplay camera
// distances without the cost of real strand geometry or alpha-tested
// hair cards).
function makeHairGeometry() {
  const geo = new THREE.CylinderGeometry(0.0, 1, 1, 5, 3, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // -0.5 .. 0.5
    const t = y + 0.5; // 0 (base) .. 1 (tip)
    // slight forward curve toward the tip for a more organic bristle silhouette
    const bend = Math.pow(t, 1.6) * 0.18;
    pos.setX(i, pos.getX(i) + bend);
  }
  geo.computeVertexNormals();
  geo.translate(0, 0.5, 0); // base at origin, tip at +Y
  return geo;
}

let _hairGeo = null;
function hairGeometry() {
  if (!_hairGeo) _hairGeo = makeHairGeometry();
  return _hairGeo;
}

const _pos = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _mat = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _combDefault = new THREE.Vector3(0, -1, 0);

/**
 * Grows instanced "fur" (setae) directly on the surface of `mesh`, parented
 * to it so it inherits every subsequent transform update for free.
 *
 * @param {THREE.Mesh} mesh source geometry to sample & parent to
 * @param {object} opts
 *   density: number of candidate hairs
 *   length: base hair length (world units)
 *   lengthVariance: 0..1 randomization of length
 *   radius: base radius of each hair at its root
 *   combBack: 0..1 blend of surface normal vs. combDir (styling)
 *   combDir: THREE.Vector3 direction hairs are combed toward
 *   region: optional (localPos, localNormal) => boolean filter
 */
export function attachFur(mesh, opts) {
  const {
    material,
    density = 500,
    length = 0.008,
    lengthVariance = 0.5,
    radius = 0.0006,
    combBack = 0.4,
    combDir = _combDefault,
    region = null,
    seed = 1,
  } = opts;

  let sampler;
  try {
    sampler = new MeshSurfaceSampler(mesh).build();
  } catch (e) {
    return null; // degenerate geometry (e.g. zero-area) — skip silently
  }

  const inst = new THREE.InstancedMesh(hairGeometry(), material, density);
  inst.castShadow = false;
  inst.receiveShadow = false;
  inst.frustumCulled = true;

  let rngState = seed >>> 0 || 1;
  const rng = () => {
    rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
    return ((rngState >>> 0) / 4294967296);
  };

  let kept = 0;
  for (let i = 0; i < density; i++) {
    sampler.sample(_pos, _nrm);
    if (region && !region(_pos, _nrm)) {
      inst.setMatrixAt(i, _mat.compose(_pos, _quat.identity(), _zeroScale));
      continue;
    }
    kept++;
    const dir = _nrm.clone().lerp(combDir, combBack).normalize();
    _quat.setFromUnitVectors(_up, dir);
    // small random spin & tilt per-hair for a less uniform "planted" look
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      (rng() - 0.5) * 0.9
    );
    _quat.multiply(tilt);
    const len = length * (1 - lengthVariance * 0.5 + rng() * lengthVariance);
    const rad = radius * (0.7 + rng() * 0.6);
    _scale.set(rad, len, rad);
    _mat.compose(_pos, _quat, _scale);
    inst.setMatrixAt(i, _mat);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.isFur = true;
  inst.userData.hairCount = kept;
  mesh.add(inst);
  return inst;
}
