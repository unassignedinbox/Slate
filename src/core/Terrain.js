/* ============================================================================
   Terrain — a gentle analytic heightfield.

   Roads drape over it (the Ribbon samples height(x,z) at every section node),
   which is why the same field can drive both the ground mesh and the road
   elevations without any manual stitching.
   ========================================================================== */

import * as THREE from 'three';
import { NoiseField, clamp, lerp, smoothstep } from './mathx.js';

export class Terrain {
  constructor({ seed = 7, amplitude = 0, scale = 420, enabled = false } = {}) {
    this.set({ seed, amplitude, scale, enabled });
  }

  set({ seed, amplitude, scale, enabled }) {
    if (seed !== undefined) { this.seed = seed; this.n = new NoiseField(seed, 256); }
    if (amplitude !== undefined) this.amplitude = amplitude;
    if (scale !== undefined) this.scale = scale;
    if (enabled !== undefined) this.enabled = enabled;
    this.n = this.n || new NoiseField(this.seed ?? 7, 256);
  }

  height(x, z) {
    if (!this.enabled || this.amplitude <= 0) return 0;
    const s = 1 / (this.scale || 420);
    const h = this.n.fbm(x * s, z * s, 4, 2.05, 0.5);
    const ridge = 1 - Math.abs(this.n.fbm(x * s * 0.45 + 31, z * s * 0.45 - 17, 2, 2, 0.5));
    return (h * 0.75 + (ridge - 0.5) * 0.5) * this.amplitude;
  }

  /** Write terrain heights into every node of a network. */
  apply(net) {
    for (const n of net.nodes.values()) {
      if (n.elevLocked) continue;
      n.y = this.height(n.x, n.z);
    }
    for (const e of net.edges.values()) e.invalidate();
  }

  /** Displaced ground plane covering the given extent. */
  buildMesh(extent = 6000, resolution = 220) {
    const size = extent;
    const seg = resolution;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.height(x, z) - 0.14);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }
}
