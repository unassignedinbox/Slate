import * as THREE from 'three';
import { COLORS, WORLD } from '../config.js';
import { clamp, lerp, smoothstep } from '../util/mathx.js';
import { valueNoise2 } from '../util/noise.js';

// ---------------------------------------------------------------------------
// The terrain mesh: one indexed grid, flat shaded (faceted low-poly look comes
// from the shader's derivative normals) with smooth vertex colours so the sand
// reads clean instead of noisy. Winding is (a, c, b) / (b, c, d) so every face
// normal points +Y - nothing in this project is inside out.
// ---------------------------------------------------------------------------

const c = new THREE.Color();
const cSand = new THREE.Color(COLORS.sand);
const cWet = new THREE.Color(COLORS.wetSand);
const cGrass = new THREE.Color(COLORS.grass);
const cDry = new THREE.Color(COLORS.dryGrass);
const cDirt = new THREE.Color(COLORS.dirt);
const cMud = new THREE.Color(COLORS.mud);
const cRock = new THREE.Color(COLORS.rock);

export function buildTerrain(field, { waterLevel = -9.5 } = {}) {
  const minX = -WORLD.halfWidth - 60;
  const maxX = WORLD.halfWidth + 60;
  const minZ = WORLD.zEnd - 60;
  const maxZ = WORLD.zStart + 60;
  const cell = WORLD.cell;

  const nx = Math.round((maxX - minX) / cell) + 1;
  const nz = Math.round((maxZ - minZ) / cell) + 1;
  const count = nx * nz;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const heights = new Float32Array(count);

  for (let j = 0; j < nz; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell;
      const y = field.height(x, z);
      const k = j * nx + i;
      heights[k] = y;
      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
    }
  }

  // --- colouring: needs slope, so do it after heights are known -------------
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = positions[k * 3];
      const z = positions[k * 3 + 2];
      const y = heights[k];
      const hl = heights[j * nx + Math.max(0, i - 1)];
      const hr = heights[j * nx + Math.min(nx - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * nx + i];
      const hu = heights[Math.min(nz - 1, j + 1) * nx + i];
      const slope = clamp(Math.hypot(hr - hl, hu - hd) / (cell * 2) * 1.35, 0, 1);

      const beach = smoothstep(-130, 130, z);
      const submerged = smoothstep(waterLevel + 2.5, waterLevel - 3.0, y);
      const n1 = valueNoise2(x * 0.012, z * 0.012, field.seed + 21);
      const n2 = valueNoise2(x * 0.05, z * 0.05, field.seed + 44);

      // inland mix: pasture broken up by patches of churned earth. Big, calm
      // patches (low frequency) keep it clean rather than noisy.
      c.copy(cGrass).lerp(cDry, clamp(n1 * 0.75 + 0.5, 0, 1));
      c.lerp(cDirt, clamp(0.18 + n2 * 0.7, 0, 1) * 0.55);
      // the closer to the wall, the more the ground is shelled to bare earth
      const shelled = smoothstep(-1500, -2650, z);
      c.lerp(cDirt, shelled * 0.45);
      // sand takes over towards the surf
      c.lerp(cSand, beach);
      c.lerp(cWet, submerged * 0.9);
      // steep faces are bare earth / rock
      c.lerp(cDirt, clamp(slope * 1.1, 0, 1) * 0.55);
      c.lerp(cRock, clamp((slope - 0.62) * 1.8, 0, 1) * 0.5);
      // hollows and crater floors hold mud
      const mud = smoothstep(2.0, -2.5, y - field.profile(z));
      c.lerp(cMud, mud * 0.55 * (1 - beach));

      const shade = 1 + valueNoise2(x * 0.09, z * 0.09, field.seed + 5) * 0.07
        + valueNoise2(x * 0.3, z * 0.3, field.seed + 9) * 0.03;
      colors[k * 3] = c.r * shade;
      colors[k * 3 + 1] = c.g * shade;
      colors[k * 3 + 2] = c.b * shade;
    }
  }

  const indices = new (count > 65535 ? Uint32Array : Uint16Array)((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const cc = a + nx;
      const d = cc + 1;
      indices[p++] = a; indices[p++] = cc; indices[p++] = b;
      indices[p++] = b; indices[p++] = cc; indices[p++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.name = 'terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Road ribbons laid on the graded surface.
 *
 * The carriageway is subdivided ACROSS as well as along and each vertex is
 * sampled from the real terrain height, so the surface hugs the camber
 * instead of cutting a chord through the crown (which left the middle of the
 * road poking through as bare dirt). Wheel ruts, a worn crown and gravel
 * shoulders are painted in with vertex colours.
 */
export function buildRoads(field, roads) {
  const group = new THREE.Group();
  group.name = 'roads';

  const cRoad = new THREE.Color(COLORS.road);
  const cRut = new THREE.Color(COLORS.road).multiplyScalar(0.78);
  const cShoulder = new THREE.Color(COLORS.dirt).multiplyScalar(1.02);

  for (const path of roads.paths) {
    const s = path.samples;
    const n = s.length;
    const half = path.width * 0.5;
    const edge = half + 3.4;           // gravel shoulder
    const LAT = 11;                    // lateral vertices across the ribbon
    const positions = new Float32Array(n * LAT * 3);
    const colors = new Float32Array(n * LAT * 3);

    for (let i = 0; i < n; i++) {
      const sm = s[i];
      for (let j = 0; j < LAT; j++) {
        const u = (j / (LAT - 1)) * 2 - 1;          // -1 .. 1 across
        const off = u * edge;
        const x = sm.x + sm.nx * off;
        const z = sm.z + sm.nz * off;
        const y = field.height(x, z) + 0.09;
        const k = (i * LAT + j) * 3;
        positions[k] = x;
        positions[k + 1] = y;
        positions[k + 2] = z;

        const au = Math.abs(u) * edge;
        const onRoad = au < half;
        const rut = Math.exp(-((au - half * 0.52) ** 2) / 2.4);    // two wheel tracks
        const wear = 0.93 + valueNoise2(x * 0.09, z * 0.09, 91) * 0.14;
        const col = onRoad
          ? cRoad.clone().lerp(cRut, rut * 0.75)
          : cShoulder.clone().lerp(cRoad, Math.max(0, 1 - (au - half) / 3.4) * 0.35);
        colors[k] = col.r * wear;
        colors[k + 1] = col.g * wear;
        colors[k + 2] = col.b * wear;
      }
    }

    const idx = new Uint32Array((n - 1) * (LAT - 1) * 6);
    let p = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < LAT - 1; j++) {
        const a = i * LAT + j;         // left-ish, this ring
        const b = a + 1;
        const c = a + LAT;             // next ring
        const d = c + 1;
        // winding chosen so face normals point +Y
        idx[p++] = a; idx[p++] = b; idx[p++] = c;
        idx[p++] = b; idx[p++] = d; idx[p++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

/** Height-aware helper for placing props flush with the ground. */
export function groundY(field, x, z) {
  return field.height(x, z);
}

export function terrainTint(y, waterLevel) {
  return lerp(1, 0.6, smoothstep(waterLevel, waterLevel - 4, y));
}
