// Rock placement patterns driven by the erosion maps:
//   • scree aprons  — where sediment and slumped talus collected beneath faces (deposit map)
//   • cliff blocks  — embedded along resistant beds on steep faces (hardness × slope), bed-aligned
//   • summit tors   — rare large blocks perched on convex high crests (cavity × elevation)
// Candidates come from a jittered grid; acceptance is probabilistic per pattern; sizes follow a
// power law so there are many small stones for every large block.

import * as THREE from 'three';
import { mulberry32, hash2, smoothstep, lerp } from './noise.js';
import { makeSampler } from './terrain-geometry.js';

const MAX_INSTANCES = 14000;

export function placeRocks(field, params, library) {
  const sampler = makeSampler(field);
  const size = field.worldSize;
  const rand = mulberry32(params.rockSeed * 7919 + 1);
  const { min, max } = field.stats;
  const range = Math.max(1, max - min);

  const spacing = size / 150;
  const steps = Math.floor(size / spacing);
  const placements = [];

  const dipRad = (params.strataDip * Math.PI) / 180;
  const dirRad = (params.strataDipDirection * Math.PI) / 180;
  const bedNormal = new THREE.Vector3(-Math.tan(dipRad) * Math.cos(dirRad), 1, -Math.tan(dipRad) * Math.sin(dirRad)).normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), nrm = new THREE.Vector3(), axis = new THREE.Vector3();

  const sizeMin = params.rockSizeMin, sizeMax = Math.max(params.rockSizeMin + 0.1, params.rockSizeMax);
  const powerLaw = (lo, hi, k) => lo * Math.pow(hi / lo, Math.pow(rand(), k));

  const bandTilt = (x, z) => Math.tan(dipRad) * (Math.cos(dirRad) * (x + size * 0.5) + Math.sin(dirRad) * (z + size * 0.5));
  // Move a candidate along the slope until it sits at the centre of its bed (hard beds hold the blocks).
  function snapToBed(x, z, strength) {
    let px = x, pz = z;
    for (let it = 0; it < 4; it++) {
      const h = sampler.height(px, pz);
      const t = (h + bandTilt(px, pz)) / params.strataBand;
      const target = (Math.floor(t) + 0.62) * params.strataBand - bandTilt(px, pz);
      const n = sampler.normal(px, pz);
      const gx = -n[0] / Math.max(0.05, n[1]), gz = -n[2] / Math.max(0.05, n[1]);   // height gradient
      const g2 = gx * gx + gz * gz;
      if (g2 < 1e-4) break;
      const step = ((target - h) / g2) * strength;
      px += Math.max(-spacing, Math.min(spacing, gx * step));
      pz += Math.max(-spacing, Math.min(spacing, gz * step));
    }
    return [px, pz];
  }

  function add(x, z, radius, kind, tiltFollow, embed, bedAlign) {
    if (placements.length >= MAX_INSTANCES) return;
    if (Math.abs(x) > size * 0.495 || Math.abs(z) > size * 0.495) return;
    const h = sampler.height(x, z);
    const n = sampler.normal(x, z);
    nrm.set(n[0], n[1], n[2]);
    const [dxp, dzp] = sampler.displaced(x, z, params);
    const geometrySet = radius < 2.2 ? 'small' : 'large';
    const index = Math.floor(rand() * library[geometrySet].length);
    const geometry = library[geometrySet][index];

    // Orientation: blend between world-up and surface normal, then optional bed alignment, then yaw.
    const target = new THREE.Vector3().copy(up).lerp(nrm, tiltFollow).normalize();
    if (bedAlign > 0) target.lerp(bedNormal, bedAlign).normalize();
    qTilt.setFromUnitVectors(up, target);
    qYaw.setFromAxisAngle(up, rand() * Math.PI * 2);
    q.copy(qTilt).multiply(qYaw);
    // Extra random tumble for loose scree.
    if (kind === 'scree') {
      axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, (rand() - 0.5) * 0.9));
    }

    const sx = radius * (0.85 + rand() * 0.3), sy = radius * (0.8 + rand() * 0.4), sz = radius * (0.85 + rand() * 0.3);
    s.set(sx, sy, sz);
    // Sink into the ground along the surface normal; cliff blocks are pushed out of the face instead.
    const sink = geometry.userData.height * sy * 0.5 * embed;
    p.set(dxp, h, dzp).addScaledVector(nrm, -sink).addScaledVector(up, -geometry.userData.bottom * sy * (1 - embed) * 0.2);
    if (kind === 'block') p.addScaledVector(nrm, radius * 0.6 * params.rockProtrude * Math.hypot(n[0], n[2]));
    m.compose(p, q, s);
    // slight per-rock albedo variation (weathered vs. freshly broken)
    const tone = 0.82 + rand() * 0.3;
    const warm = (rand() - 0.5) * 0.08;
    placements.push({ set: geometrySet, index, matrix: m.clone(), kind, color: [tone + warm, tone, tone - warm] });
  }

  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const x = (i + 0.5 + (rand() - 0.5) * 0.9) * spacing - size * 0.5;
      const z = (j + 0.5 + (rand() - 0.5) * 0.9) * spacing - size * 0.5;
      if (Math.abs(x) > size * 0.495 || Math.abs(z) > size * 0.495) continue;
      const h = sampler.height(x, z);
      if (params.waterEnabled && h < params.seaLevel - 2) continue;
      const slope = sampler.map('slope', x, z);          // tan(angle)
      const deposit = sampler.map('deposit', x, z);
      const hardness = sampler.map('hardness', x, z);
      const cavity = sampler.map('cavity', x, z);
      const elev = (h - min) / range;
      const angle = Math.atan(slope);

      // --- scree aprons -------------------------------------------------------------------------
      const screeWeight = params.screeDensity * Math.pow(deposit, 1.3) * smoothstep(0.08, 0.3, angle) * (1 - smoothstep(0.7, 1.0, angle));
      if (rand() < screeWeight * 1.6) {
        const cluster = 1 + Math.floor(rand() * 4 * deposit);
        for (let c = 0; c < cluster; c++) {
          const r = powerLaw(sizeMin * 0.5, lerp(sizeMin, sizeMax, 0.35), 1.8);
          const jitter = spacing * 0.6;
          add(x + (rand() - 0.5) * jitter, z + (rand() - 0.5) * jitter, r, 'scree', 0.75, params.rockEmbed * 0.8, 0);
        }
      }

      // --- cliff blocks along resistant beds ---------------------------------------------------
      const bedBand = hash2(Math.floor((h + 0.5 * params.strataBand) / params.strataBand), 3, params.rockSeed);
      const cliffWeight = params.cliffBlockDensity * hardness * hardness * smoothstep(0.65, 1.1, angle) * (0.4 + 0.6 * bedBand);
      if (rand() < cliffWeight * 1.4) {
        const r = powerLaw(lerp(sizeMin, sizeMax, 0.25), sizeMax, 1.3);
        const [bx, bz] = snapToBed(x, z, params.rockBedding);
        add(bx, bz, Math.min(r, params.strataBand * 0.75), 'block', 0.45, lerp(0.45, 0.8, params.rockEmbed), params.rockBedding * 0.9);
        // bed rows: a neighbour block along the same contour
        if (rand() < params.rockBedding * 0.6) {
          const n0 = sampler.normal(bx, bz);
          const tx = -n0[2], tz = n0[0];                 // along-contour direction
          const tl = Math.hypot(tx, tz) || 1;
          const off = r * (1.4 + rand() * 1.2);
          add(bx + (tx / tl) * off, bz + (tz / tl) * off, r * (0.6 + rand() * 0.5), 'block', 0.45, lerp(0.45, 0.8, params.rockEmbed), params.rockBedding * 0.9);
        }
      }

      // --- summit tors ---------------------------------------------------------------------------
      const torWeight = params.torDensity * smoothstep(0.25, 0.8, cavity) * smoothstep(0.55, 0.9, elev) * (1 - smoothstep(0.35, 0.8, angle));
      if (rand() < torWeight * 0.5) {
        const r = powerLaw(sizeMax * 0.45, sizeMax, 1.0);
        add(x, z, r, 'tor', 0.3, lerp(0.35, 0.7, params.rockEmbed), params.rockBedding);
        // companion blocks
        const companions = Math.floor(rand() * 3);
        for (let c = 0; c < companions; c++) {
          add(x + (rand() - 0.5) * r * 3, z + (rand() - 0.5) * r * 3, r * (0.3 + rand() * 0.4), 'block', 0.5, lerp(0.4, 0.8, params.rockEmbed), params.rockBedding);
        }
      }
    }
  }
  return placements;
}

export function buildRockMeshes(placements, library, material) {
  const groupsByKey = new Map();
  for (const pl of placements) {
    const key = `${pl.set}:${pl.index}`;
    let list = groupsByKey.get(key);
    if (!list) { list = []; groupsByKey.set(key, list); }
    list.push(pl);
  }
  const meshes = [];
  const color = new THREE.Color();
  for (const [key, items] of groupsByKey) {
    const [set, index] = key.split(':');
    const geometry = library[set][Number(index)];
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((pl, i) => { mesh.setMatrixAt(i, pl.matrix); mesh.setColorAt(i, color.setRGB(...pl.color)); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `rocks-${key}`;
    meshes.push(mesh);
  }
  return meshes;
}
