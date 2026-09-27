import * as THREE from 'three';
import { COLORS, TIDE } from '../config.js';
import { clamp, smoothstep } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// The tide.
//
// The sea sits behind the player and climbs. Because the beach is a shallow
// shelf, a small rise in level swallows a *lot* of ground - the shoreline
// chases you inland. Ground height under every water vertex is baked once, so
// the shader-free foam band and depth shading follow the real terrain as the
// water comes up.
// ---------------------------------------------------------------------------

const cShallow = new THREE.Color(0x3f8fa3);
const cDeep = new THREE.Color(COLORS.waterDeep);
const cFoam = new THREE.Color(COLORS.foam);
const tmp = new THREE.Color();

export class Ocean {
  constructor(field, { minX = -1700, maxX = 1700, minZ = -2000, maxZ = 1500, step = 32 } = {}) {
    this.level = TIDE.startLevel;
    this.time = 0;
    this.field = field;

    this.nx = Math.round((maxX - minX) / step) + 1;
    this.nz = Math.round((maxZ - minZ) / step) + 1;
    const count = this.nx * this.nz;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.ground = new Float32Array(count);
    this.baseX = new Float32Array(count);
    this.baseZ = new Float32Array(count);

    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const x = minX + i * step;
        const z = minZ + j * step;
        this.baseX[k] = x;
        this.baseZ[k] = z;
        // outside the playfield the "ground" is deep ocean
        const inField = Math.abs(x) < 560 && z > -2900 && z < 520;
        this.ground[k] = inField ? field.height(x, z) : -40;
        positions[k * 3] = x;
        positions[k * 3 + 1] = this.level;
        positions[k * 3 + 2] = z;
      }
    }

    const idx = new Uint32Array((this.nx - 1) * (this.nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < this.nz - 1; j++) {
      for (let i = 0; i < this.nx - 1; i++) {
        const a = j * this.nx + i;
        const b = a + 1;
        const c = a + this.nx;
        const d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // flatShading derives normals in the fragment shader, so the water never
    // needs its normals recomputed as the waves move
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    mat.name = 'water';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.positions = geo.attributes.position;
    this.colors = geo.attributes.color;
    this._frame = 0;
    this.update(0, null, true);
  }

  waveAt(x, z, t) {
    return (
      Math.sin(x * 0.028 + t * 1.25) * 0.45 +
      Math.sin(z * 0.041 - t * 1.75) * 0.34 +
      Math.sin((x + z) * 0.017 + t * 0.8) * 0.55 +
      Math.sin(z * 0.11 - t * 2.6) * 0.16
    );
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3|null} focus animate waves only around this point;
   *        distant water sits flat at sea level, which is invisible through
   *        the haze and saves ~2 ms a frame.
   */
  update(dt, focus = null, force = false) {
    this.time += dt;
    const rising = Math.max(0, this.time - TIDE.graceSeconds);
    this.level = Math.min(TIDE.maxLevel, TIDE.startLevel + rising * TIDE.rise);

    this._frame++;
    const doColor = force || this._frame % 2 === 0;
    const pos = this.positions.array;
    const col = this.colors.array;
    const t = this.time;
    const fx = focus ? focus.x : 0;
    const fz = focus ? focus.z : 240;
    const near2 = 1150 * 1150;

    for (let k = 0; k < this.ground.length; k++) {
      const x = this.baseX[k];
      const z = this.baseZ[k];
      const dx = x - fx;
      const dz = z - fz;
      if (dx * dx + dz * dz > near2) {
        pos[k * 3 + 1] = this.level;
        if (force || this._frame % 12 === 0) {
          const far = smoothstep(0.5, 14, this.level - this.ground[k]);
          tmp.copy(cShallow).lerp(cDeep, far);
          col[k * 3] = tmp.r;
          col[k * 3 + 1] = tmp.g;
          col[k * 3 + 2] = tmp.b;
          this.colors.needsUpdate = true;
        }
        continue;
      }
      const depth = this.level - this.ground[k];
      const shore = clamp(depth / 3, 0, 1);
      const y = this.level + this.waveAt(x, z, t) * (0.35 + 0.65 * shore);
      pos[k * 3 + 1] = y;
      if (doColor) {
        const deepK = smoothstep(0.5, 14, depth);
        tmp.copy(cShallow).lerp(cDeep, deepK);
        // breaking surf where the water is only knee deep, plus wave crests
        const crest = smoothstep(0.35, 0.9, y - this.level);
        const surf = (1 - smoothstep(0.1, 2.4, depth)) * 0.85 + crest * 0.25;
        tmp.lerp(cFoam, clamp(surf, 0, 1));
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
      }
    }
    this.positions.needsUpdate = true;
    if (doColor) this.colors.needsUpdate = true;
    return this.level;
  }

  /** Water depth at a world position (<=0 means dry). */
  depthAt(x, z) {
    return this.level - this.field.height(x, z);
  }

  /** How far inland the waterline currently is (world Z of the shoreline). */
  shorelineZ() {
    // the beach profile is monotonic enough to invert by search
    let lo = -2800;
    let hi = 460;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.field.profile(mid) > this.level) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
}
