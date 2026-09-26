import * as THREE from 'three';
import {
  WORLD,
  BEACH_PROFILE,
  ROADS,
  TRENCHES,
  MOUNDS,
  BERMS,
  COLORS,
  WALL,
} from './config.js';
import {
  clamp,
  lerp,
  smoothstep,
  smootherstep,
  sampleCurve,
  fbm2,
  distToPolyline,
  distToSegment2,
  Rng,
} from './util.js';

export const SURF = {
  SAND: 0,
  WET: 1,
  GRAVEL: 2,
  DIRT: 3,
  GRASS: 4,
  MUD: 5,
  CONCRETE: 6,
};

/** Grip multipliers per surface type. */
export const SURFACE_GRIP = {
  [SURF.SAND]: 0.78,
  [SURF.WET]: 0.68,
  [SURF.GRAVEL]: 1.0,
  [SURF.DIRT]: 0.93,
  [SURF.GRASS]: 0.85,
  [SURF.MUD]: 0.62,
  [SURF.CONCRETE]: 1.06,
};

export const SURFACE_DUST = {
  [SURF.SAND]: 0xd7c69a,
  [SURF.WET]: 0x8f7f60,
  [SURF.GRAVEL]: 0xa8a49a,
  [SURF.DIRT]: 0x8b7452,
  [SURF.GRASS]: 0x6e7a4c,
  [SURF.MUD]: 0x5f4f38,
  [SURF.CONCRETE]: 0xc0bdb3,
};

function bboxOfPoints(pts, pad) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

export class Terrain {
  constructor() {
    this.minX = WORLD.minX;
    this.maxX = WORLD.maxX;
    this.minZ = WORLD.minZ;
    this.maxZ = WORLD.maxZ;

    this.nx = Math.round((this.maxX - this.minX) / WORLD.cell) + 1;
    this.nz = Math.round((this.maxZ - this.minZ) / WORLD.cell) + 1;
    this.cellX = (this.maxX - this.minX) / (this.nx - 1);
    this.cellZ = (this.maxZ - this.minZ) / (this.nz - 1);

    const rng = new Rng(90210);

    // Bomb craters scattered over the beach.
    this.craters = [];
    for (let i = 0; i < 46; i++) {
      const x = rng.float(this.minX + 20, this.maxX - 20);
      const z = rng.float(-250, 250);
      this.craters.push({
        x,
        z,
        r: rng.float(4.5, 13),
        d: rng.float(0.9, 2.6),
      });
    }

    // Pre-bake bounding boxes so the height function can early-out.
    this.roadInfo = ROADS.map((r) => ({
      ...r,
      bbox: bboxOfPoints(r.points, r.width * 2.2 + 14),
    }));
    this.trenchInfo = TRENCHES.map((t) => ({
      ...t,
      bbox: bboxOfPoints(t.points, t.width * 2.0 + 8),
    }));

    this.heights = new Float32Array(this.nx * this.nz);
    this.types = new Uint8Array(this.nx * this.nz);
    this.roadMaskGrid = new Float32Array(this.nx * this.nz);

    this._buildHeightfield();
    this._buildMesh();
    this._buildHeightTexture();

    this.waterLevel = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Height composition                                                */
  /* ---------------------------------------------------------------- */

  _rawHeight(x, z) {
    // Base cross-shore profile.
    let h = sampleCurve(BEACH_PROFILE, z);
    const dryness = smoothstep(-2.6, 1.0, h);

    // Rolling dune undulation, kept low frequency so the mesh stays clean.
    h += fbm2(x * 0.0058, z * 0.0058, 2, 11) * 2.25 * (0.3 + 0.7 * dryness);
    h += fbm2(x * 0.0155, z * 0.0155, 2, 27) * 0.26 * dryness;

    // Huge mounds of earth.
    for (let i = 0; i < MOUNDS.length; i++) {
      const m = MOUNDS[i];
      const dx = x - m.x;
      const dz = z - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > m.r * m.r) continue;
      const t = Math.sqrt(d2) / m.r;
      h += m.h * smootherstep(1, 0, t);
    }

    // Long earth berms.
    for (let i = 0; i < BERMS.length; i++) {
      const b = BERMS[i];
      const { d2 } = distToSegment2(x, z, b.ax, b.az, b.bx, b.bz);
      if (d2 > b.r * b.r) continue;
      const t = Math.sqrt(d2) / b.r;
      h += b.h * smootherstep(1, 0, t);
    }

    // Shell craters (bowl + raised lip).
    for (let i = 0; i < this.craters.length; i++) {
      const c = this.craters[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const reach = c.r * 1.7;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d < c.r) {
        const t = d / c.r;
        h -= c.d * (1 - t * t);
      }
      const lipT = (d - c.r * 1.02) / (c.r * 0.5);
      h += c.d * 0.3 * Math.exp(-lipT * lipT);
    }

    let trenchMask = 0;
    for (let i = 0; i < this.trenchInfo.length; i++) {
      const t = this.trenchInfo[i];
      if (x < t.bbox.minX || x > t.bbox.maxX || z < t.bbox.minZ || z > t.bbox.maxZ) continue;
      const { d } = distToPolyline(x, z, t.points);
      const hw = t.width * 0.5;
      if (d < hw * 2.4) {
        const inner = smoothstep(hw, hw * 0.45, d);
        h -= t.depth * inner;
        // Spoil parapet thrown up either side of the cut.
        const lipT = (d - hw * 1.25) / (hw * 0.55);
        h += t.depth * 0.26 * Math.exp(-lipT * lipT);
        trenchMask = Math.max(trenchMask, inner);
      }
    }

    // Roads flatten everything they cross (they are the cleared pathways).
    let roadMask = 0;
    let roadKind = null;
    for (let i = 0; i < this.roadInfo.length; i++) {
      const r = this.roadInfo[i];
      if (x < r.bbox.minX || x > r.bbox.maxX || z < r.bbox.minZ || z > r.bbox.maxZ) continue;
      const { d, cx, cz } = distToPolyline(x, z, r.points);
      const hw = r.width * 0.5;
      if (d > hw * 1.9) continue;
      // Road surface height = smoothed base profile at the centreline.
      let roadH = sampleCurve(BEACH_PROFILE, cz);
      roadH += fbm2(cx * 0.0062, cz * 0.0062, 2, 11) * 1.5;
      roadH += 0.12;
      const w = smoothstep(hw * 1.55, hw * 0.85, d);
      if (w > roadMask) {
        roadKind = r.kind;
      }
      h = lerp(h, roadH, w * 0.96);
      roadMask = Math.max(roadMask, w);
      if (r.berm) {
        const bt = (d - hw * 1.5) / (hw * 0.6);
        h += 0.85 * Math.exp(-bt * bt);
      }
    }

    // Concrete apron in front of the wall, and the ramp up to the breach.
    const apron = smoothstep(-228, -250, z);
    if (apron > 0) {
      const apronH = lerp(7.4, 8.9, smoothstep(-240, -262, z));
      h = lerp(h, apronH, apron * 0.92);
    }

    // Headlands. The cove is closed at both flanks by earth bluffs, so the
    // playfield ends in landscape rather than in a slab hanging over the sea,
    // and the great wall runs into high ground at either end.
    const bluff = smoothstep(this.maxX - 52, this.maxX - 4, Math.abs(x));
    if (bluff > 0) {
      const crest =
        12.5 +
        fbm2(x * 0.009, z * 0.009, 3, 404) * 6.0 +
        smoothstep(60, -250, z) * 7.5;
      h = lerp(h, Math.max(h, crest), bluff * bluff * (3 - 2 * bluff));
    }

    return { h, trenchMask, roadMask, roadKind };
  }

  _classify(h, slope, info, x, z) {
    if (info.roadMask > 0.45) {
      return info.roadKind === 'gravel' ? SURF.GRAVEL : SURF.DIRT;
    }
    if (z < -244) return SURF.CONCRETE;
    if (info.trenchMask > 0.4) return SURF.MUD;
    if (h < -1.2) return SURF.WET;
    if (h < 0.7) return SURF.WET;
    if (h > 3.6 && slope < 0.36) {
      // Clifftops and the high dune shoulders hold turf; the open beach does not.
      const g = fbm2(x * 0.0185, z * 0.0185, 2, 5) + smoothstep(7, 15, h) * 0.34;
      if (g > 0.19) return SURF.GRASS;
    }
    if (slope > 0.62) return SURF.DIRT;
    return SURF.SAND;
  }

  _buildHeightfield() {
    const { nx, nz } = this;
    this._info = new Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = this.minZ + j * this.cellZ;
      for (let i = 0; i < nx; i++) {
        const x = this.minX + i * this.cellX;
        const info = this._rawHeight(x, z);
        const idx = j * nx + i;
        this.heights[idx] = info.h;
        this.roadMaskGrid[idx] = info.roadMask;
        this._info[idx] = info;
      }
    }
    // Classify after heights exist so we can use real slopes.
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const x = this.minX + i * this.cellX;
        const z = this.minZ + j * this.cellZ;
        const hl = this.heights[j * nx + Math.max(0, i - 1)];
        const hr = this.heights[j * nx + Math.min(nx - 1, i + 1)];
        const hd = this.heights[Math.max(0, j - 1) * nx + i];
        const hu = this.heights[Math.min(nz - 1, j + 1) * nx + i];
        const gx = (hr - hl) / (2 * this.cellX);
        const gz = (hu - hd) / (2 * this.cellZ);
        const slope = Math.hypot(gx, gz);
        this.types[idx] = this._classify(this.heights[idx], slope, this._info[idx], x, z);
      }
    }
  }

  _vertexColor(i, j, out) {
    const idx = j * this.nx + i;
    const x = this.minX + i * this.cellX;
    const z = this.minZ + j * this.cellZ;
    const h = this.heights[idx];
    const type = this.types[idx];
    const info = this._info[idx];

    let c;
    switch (type) {
      case SURF.GRAVEL:
        c = new THREE.Color(COLORS.gravel);
        break;
      case SURF.DIRT:
        c = new THREE.Color(COLORS.dirt);
        break;
      case SURF.MUD:
        c = new THREE.Color(COLORS.mud);
        break;
      case SURF.CONCRETE:
        c = new THREE.Color(COLORS.concrete);
        break;
      case SURF.GRASS: {
        const n = fbm2(x * 0.03, z * 0.03, 2, 91);
        c = new THREE.Color(COLORS.grass).lerp(new THREE.Color(COLORS.grassDark), n * 0.5 + 0.5);
        // Dune grass grows in thin sand, so keep it sandy rather than lush.
        c.lerp(new THREE.Color(COLORS.sandDry), 0.42);
        break;
      }
      case SURF.WET: {
        const t = smoothstep(1.2, -2.4, h);
        c = new THREE.Color(COLORS.sandWet).lerp(new THREE.Color(COLORS.sandDeep), t);
        break;
      }
      default: {
        const n = fbm2(x * 0.026, z * 0.026, 2, 71) * 0.5 + 0.5;
        c = new THREE.Color(COLORS.sandDry).lerp(new THREE.Color(COLORS.sandPale), n);
        const wet = smoothstep(2.0, 0.4, h);
        if (wet > 0) c.lerp(new THREE.Color(COLORS.sandWet), wet * 0.75);
      }
    }

    // Churned dirt along trench lips and near the wall works.
    if (info.trenchMask > 0.02 && type !== SURF.GRAVEL) {
      c.lerp(new THREE.Color(COLORS.mud), clamp(info.trenchMask * 0.85, 0, 0.8));
    }
    out.copy(c);
    return out;
  }

  _buildMesh() {
    const { nx, nz } = this;
    const quads = (nx - 1) * (nz - 1);
    const triCount = quads * 2;
    const positions = new Float32Array(triCount * 3 * 3);
    const normals = new Float32Array(triCount * 3 * 3);
    const colors = new Float32Array(triCount * 3 * 3);

    const vcols = new Array(nx * nz);
    const tmp = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        vcols[j * nx + i] = this._vertexColor(i, j, tmp).clone();
      }
    }

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const pC = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const n = new THREE.Vector3();
    let p = 0;

    const vx = (i) => this.minX + i * this.cellX;
    const vz = (j) => this.minZ + j * this.cellZ;

    const pushTri = (i0, j0, i1, j1, i2, j2) => {
      const h0 = this.heights[j0 * nx + i0];
      const h1 = this.heights[j1 * nx + i1];
      const h2 = this.heights[j2 * nx + i2];
      pA.set(vx(i0), h0, vz(j0));
      pB.set(vx(i1), h1, vz(j1));
      pC.set(vx(i2), h2, vz(j2));
      cb.subVectors(pC, pB);
      ab.subVectors(pA, pB);
      n.crossVectors(cb, ab).normalize();

      // Flat per-face colour = average of the three corners (crisp low-poly look).
      const c0 = vcols[j0 * nx + i0];
      const c1 = vcols[j1 * nx + i1];
      const c2 = vcols[j2 * nx + i2];
      let r = (c0.r + c1.r + c2.r) / 3;
      let g = (c0.g + c1.g + c2.g) / 3;
      let b = (c0.b + c1.b + c2.b) / 3;
      // Tiny deterministic per-face jitter keeps big flat areas from banding.
      const jit = 1 + (((i0 * 73856093) ^ (j0 * 19349663)) % 100) / 100 * 0.055 - 0.027;
      r *= jit;
      g *= jit;
      b *= jit;

      const verts = [pA, pB, pC];
      for (let k = 0; k < 3; k++) {
        positions[p] = verts[k].x;
        positions[p + 1] = verts[k].y;
        positions[p + 2] = verts[k].z;
        normals[p] = n.x;
        normals[p + 1] = n.y;
        normals[p + 2] = n.z;
        colors[p] = r;
        colors[p + 1] = g;
        colors[p + 2] = b;
        p += 3;
      }
    };

    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        // Diagonal from (i,j) to (i+1,j+1) — matches heightAt() sampling.
        pushTri(i, j, i, j + 1, i + 1, j + 1);
        pushTri(i, j, i + 1, j + 1, i + 1, j);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    this.geometry = geo;

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.waterUniform = { value: -10 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterLevel = this.waterUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosT;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWPosT = (modelMatrix * vec4(transformed,1.0)).xyz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWPosT;\nuniform float uWaterLevel;'
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float depthBelow = uWaterLevel - vWPosT.y;
          float submerged = smoothstep(-0.15, 1.2, depthBelow);
          float damp = smoothstep(1.6, -0.1, depthBelow);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42,0.5,0.56), submerged);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, (1.0-submerged) * damp * 0.85);
          `
        );
    };
    mat.customProgramCacheKey = () => 'terrain-water-line';
    this.material = mat;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  _buildHeightTexture() {
    // 8-bit encoded heightmap used by the ocean shader for depth / foam.
    const { nx, nz } = this;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      minH = Math.min(minH, this.heights[i]);
      maxH = Math.max(maxH, this.heights[i]);
    }
    this.heightRange = { min: minH, max: maxH };
    const data = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const t = clamp((this.heights[idx] - minH) / (maxH - minH), 0, 1);
        data[idx * 4] = Math.round(t * 255);
        data[idx * 4 + 1] = Math.round(t * 255);
        data[idx * 4 + 2] = Math.round(t * 255);
        data[idx * 4 + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTexture = tex;
  }

  /* ---------------------------------------------------------------- */
  /* Sampling API                                                      */
  /* ---------------------------------------------------------------- */

  gridIndex(x, z) {
    const gx = clamp((x - this.minX) / this.cellX, 0, this.nx - 1.001);
    const gz = clamp((z - this.minZ) / this.cellZ, 0, this.nz - 1.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    return { i, j, fx: gx - i, fz: gz - j };
  }

  heightAt(x, z) {
    const { i, j, fx, fz } = this.gridIndex(x, z);
    const nx = this.nx;
    const h00 = this.heights[j * nx + i];
    const h10 = this.heights[j * nx + i + 1];
    const h01 = this.heights[(j + 1) * nx + i];
    const h11 = this.heights[(j + 1) * nx + i + 1];
    if (fx > fz) {
      // triangle (v00, v11, v10)
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    // triangle (v00, v01, v11)
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  normalAt(x, z, target = new THREE.Vector3()) {
    const e = this.cellX;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    target.set(hl - hr, 2 * e, hd - hu).normalize();
    return target;
  }

  slopeAt(x, z) {
    const e = this.cellX;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return Math.hypot((hr - hl) / (2 * e), (hu - hd) / (2 * e));
  }

  typeAt(x, z) {
    const { i, j, fx, fz } = this.gridIndex(x, z);
    const ii = fx > 0.5 ? i + 1 : i;
    const jj = fz > 0.5 ? j + 1 : j;
    return this.types[clamp(jj, 0, this.nz - 1) * this.nx + clamp(ii, 0, this.nx - 1)];
  }

  roadMaskAt(x, z) {
    const { i, j, fx, fz } = this.gridIndex(x, z);
    const nx = this.nx;
    const a = this.roadMaskGrid[j * nx + i];
    const b = this.roadMaskGrid[j * nx + i + 1];
    const c = this.roadMaskGrid[(j + 1) * nx + i];
    const d = this.roadMaskGrid[(j + 1) * nx + i + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  /** True if a straight line between two points is blocked by the ground. */
  terrainBlocksLine(ax, ay, az, bx, by, bz, steps = 26) {
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = lerp(ax, bx, t);
      const y = lerp(ay, by, t);
      const z = lerp(az, bz, t);
      if (this.heightAt(x, z) > y + 0.25) return true;
    }
    return false;
  }

  setWaterLevel(level) {
    this.waterLevel = level;
    this.waterUniform.value = level;
  }

  inBounds(x, z, pad = 0) {
    return (
      x > this.minX + pad && x < this.maxX - pad && z > this.minZ + pad && z < this.maxZ - pad
    );
  }

  /** Find a flat-ish spot near (x,z) — used when scattering props. */
  isBuildable(x, z, maxSlope = 0.45, minH = -0.5) {
    if (!this.inBounds(x, z, 8)) return false;
    if (z < WALL.z + WALL.thickness) return false;
    const h = this.heightAt(x, z);
    if (h < minH) return false;
    if (this.slopeAt(x, z) > maxSlope) return false;
    return true;
  }
}
