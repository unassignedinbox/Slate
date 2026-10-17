// Builds the floating town: ground plates, fractured buildings, landmarks, floating furniture
// and debris. Every shard becomes one THREE.Group in shard-local coordinates. The group's
// position is set from the shard's world offset (origin + drift), so the sim and the
// renderer always agree.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLATE } from '../../../levels/fragmented-town/town.js';
import { mulberry32 } from '../sim/rng.js';
import { propCenter } from '../sim/world.js';

const TAU = Math.PI * 2;

// Stable numeric seed from a string id
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// All geometry in this file is NON-indexed so that merges are always compatible.
function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

function cyl(rt, rb, h, seg = 10, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

export function buildTown(town, level, materials) {
  const root = new THREE.Group();
  const shards = {};

  for (const shardDef of level.shards) {
    const t = town.shards[shardDef.id];
    const group = new THREE.Group();
    group.position.set(shardDef.origin[0], shardDef.origin[1], shardDef.origin[2]);
    group.userData.shardId = shardDef.id;
    root.add(group);

    const anim = { chunks: [], props: [], debris: [], spinners: [] };

    // ---- ground plates: instanced top slab, with broken rock hanging underneath
    const present = t.plates.filter((p) => p.present);
    const topMesh = new THREE.InstancedMesh(box(PLATE - 1.5, 3, PLATE - 1.5, 0, -1.5, 0), materials.plateTop, present.length);
    const rockGeo = new THREE.ConeGeometry(17, 34, 6, 1);
    rockGeo.rotateX(Math.PI);
    rockGeo.translate(0, -20, 0);
    const rockMesh = new THREE.InstancedMesh(rockGeo, materials.plateRock, present.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const prng = mulberry32(shardDef.seed + 99);
    present.forEach((p, i) => {
      m4.makeTranslation(p.x, 0, p.z);
      topMesh.setMatrixAt(i, m4);
      const sc = 0.75 + prng() * 0.5;
      q.setFromAxisAngle(yAxis, prng() * TAU);
      m4.compose(
        new THREE.Vector3(p.x + (prng() - 0.5) * 6, 0, p.z + (prng() - 0.5) * 6),
        q,
        new THREE.Vector3(sc, 0.6 + prng() * 0.8, sc),
      );
      rockMesh.setMatrixAt(i, m4);
    });
    topMesh.instanceMatrix.needsUpdate = true;
    rockMesh.instanceMatrix.needsUpdate = true;
    group.add(topMesh, rockMesh);

    // ---- buildings and landmarks (fractured chunks)
    for (const b of t.solids) {
      const mat = materials[wallKey(b.kind)];
      const bg = buildBuilding(b, mat, materials);
      group.add(bg.group);
      anim.chunks.push(...bg.chunks);
    }

    // ---- floating furniture
    for (const p of t.props) {
      const obj = buildProp(p, materials);
      group.add(obj);
      anim.props.push({ obj, p, phase: ((p.seed % 1000) / 1000) * TAU });
    }

    // ---- debris: fractured bits drifting in the air
    const rockBase = new THREE.IcosahedronGeometry(0.5, 0);
    for (const d of t.debris) {
      const m = new THREE.Mesh(rockBase, materials.debris);
      m.scale.set(d.size, d.size * d.aspect, d.size * (0.6 + d.aspect * 0.4));
      group.add(m);
      anim.debris.push({ m, d });
    }

    // ---- landmark extras
    for (const b of t.solids) {
      if (b.kind === 'mill') {
        const sails = new THREE.Group();
        sails.position.set(b.x + b.w / 2 + 1.5, 18, b.z);
        for (let k = 0; k < 4; k++) {
          const arm = new THREE.Group();
          arm.rotation.z = (k * TAU) / 4;
          const blade = new THREE.Mesh(box(0.6, 15, 0.6, 0, 6, 0), materials.propWood);
          arm.add(blade);
          sails.add(arm);
        }
        group.add(sails);
        anim.spinners.push({ obj: sails, speed: 0.35 });
      }
      if (b.kind === 'tower') {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(b.w * 0.7, 12, 4), materials.landmark);
        spire.position.set(b.x, b.h + 6, b.z);
        spire.rotation.y = Math.PI / 4;
        group.add(spire);
      }
    }

    shards[shardDef.id] = { group, anim, def: shardDef };
  }
  return { root, shards };
}

function wallKey(kind) {
  if (kind === 'tenement') return 'tenement';
  if (kind === 'shop') return 'shop';
  if (kind === 'warehouse' || kind === 'hall') return 'warehouse';
  if (kind === 'tower' || kind === 'mill') return 'landmark';
  return 'house';
}

// Fractured building: 2-3 slices along the long axis. Gaps between slices show the dark interior.
function buildBuilding(b, wallMat, materials) {
  const rnd = mulberry32(hashStr(b.id));
  const group = new THREE.Group();
  group.position.set(b.x, 0, b.z);
  const chunks = [];

  const alongX = b.w >= b.d;
  const L = alongX ? b.w : b.d; // length along the slicing axis
  const W = alongX ? b.d : b.w; // depth across it
  const n = L > 18 ? 3 : 2;
  const gaps = [];
  for (let i = 0; i < n - 1; i++) gaps.push(0.4 + rnd() * 0.8);
  const totalGap = gaps.reduce((a, c) => a + c, 0);
  const seg = (L - totalGap) / n;

  // Dark interior: seen through the fracture gaps
  const interior = new THREE.Mesh(
    box(alongX ? L - 0.8 : W - 0.8, b.h - 0.8, alongX ? W - 0.8 : L - 0.8, 0, b.h / 2, 0),
    materials.interior,
  );
  group.add(interior);

  let cursor = -L / 2;
  for (let i = 0; i < n; i++) {
    const len = seg * (0.92 + rnd() * 0.16);
    const cx = cursor + len / 2;
    // Outer slices may be broken short. The middle slice stays full height.
    const topFactor = i === 1 ? 1 : 0.8 + rnd() * 0.2;
    const h = Math.max(3, b.h * topFactor);
    const sizeX = alongX ? len : W;
    const sizeZ = alongX ? W : len;

    const parts = [box(sizeX, h, sizeZ, 0, h / 2, 0)];
    if (b.kind !== 'warehouse' && b.kind !== 'hall' && h > 6) {
      const floors = Math.floor((h - 2) / 3.4);
      const cols = Math.max(1, Math.floor(len / 3.2));
      for (let f = 0; f < floors; f++) {
        const y = 1.8 + f * 3.4;
        for (let c = 0; c < cols; c++) {
          const along = -len / 2 + ((c + 0.5) * len) / cols;
          for (const side of [-1, 1]) {
            if (alongX) parts.push(box(1.1, 1.4, 0.12, along, y, side * (W / 2 + 0.05)));
            else parts.push(box(0.12, 1.4, 1.1, side * (W / 2 + 0.05), y, along));
          }
        }
      }
    }

    // Two material groups: [0] = wall body, [1] = all windows (merged into one geometry)
    const mesh = parts.length > 1
      ? new THREE.Mesh(
          mergeGeometries([parts[0], mergeGeometries(parts.slice(1), false)], true),
          [wallMat, materials.window],
        )
      : new THREE.Mesh(parts[0], wallMat);

    const slice = new THREE.Group();
    slice.position.set(alongX ? cx : 0, 0, alongX ? 0 : cx);
    slice.add(mesh);
    // Some slices sit slightly out of square: the cracks read as weight shifting
    const tilt = rnd() < 0.35 ? (rnd() - 0.5) * 0.05 : 0;
    slice.rotation.z = tilt;
    group.add(slice);

    chunks.push({
      obj: slice,
      base: { x: slice.position.x, z: slice.position.z },
      amp: 0.03 + rnd() * 0.09,       // metres of bob
      period: 6 + rnd() * 8,          // seconds
      phase: rnd() * TAU,
      tilt,
    });
    cursor += len + (gaps[i] ?? 0);
  }

  // Rooftop oddment: a water tank on some tenements
  if (b.kind === 'tenement' && rnd() < 0.5) {
    group.add(new THREE.Mesh(cyl(1.2, 1.2, 2.2, 10, 0, b.h + 1.1, 0), materials.propMetal));
  }
  return { group, chunks };
}

// Floating furniture. Each prop is a small assembly in its own group.
function buildProp(p, m) {
  const g = new THREE.Group();
  const add = (geo, mat) => g.add(new THREE.Mesh(geo, mat));
  switch (p.kind) {
    case 'table':
      add(box(1.6, 0.08, 1.0, 0, 0.75, 0), m.propWood);
      for (const [x, z] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) add(box(0.06, 0.75, 0.06, x, 0.37, z), m.propWood);
      break;
    case 'chair':
      add(box(0.5, 0.06, 0.5, 0, 0.45, 0), m.propWood);
      add(box(0.5, 0.5, 0.05, 0, 0.72, -0.22), m.propWood);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) add(box(0.05, 0.45, 0.05, x, 0.22, z), m.propWood);
      break;
    case 'bed':
      add(box(1.0, 0.3, 2.0, 0, 0.3, 0), m.propWood);
      add(box(0.95, 0.18, 1.9, 0, 0.5, 0), m.propFabric);
      add(box(1.0, 0.7, 0.08, 0, 0.55, -1.0), m.propWood);
      break;
    case 'wardrobe':
      add(box(1.2, 2.0, 0.6, 0, 1.0, 0), m.propWood);
      add(box(0.02, 1.8, 0.02, 0, 1.0, 0.31), m.propMetal);
      break;
    case 'crate':
      add(box(1.0, 1.0, 1.0, 0, 0.5, 0), m.propWood);
      add(box(1.04, 0.1, 1.04, 0, 0.3, 0), m.propMetal);
      add(box(1.04, 0.1, 1.04, 0, 0.7, 0), m.propMetal);
      break;
    case 'barrel':
      add(cyl(0.5, 0.5, 1.0, 12, 0, 0.5, 0), m.propWood);
      add(cyl(0.52, 0.52, 0.08, 12, 0, 0.25, 0), m.propMetal);
      add(cyl(0.52, 0.52, 0.08, 12, 0, 0.75, 0), m.propMetal);
      break;
    case 'lamp': {
      add(cyl(0.03, 0.03, 1.7, 6, 0, 0.85, 0), m.propMetal);
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), m.propFabric);
      shade.position.y = 1.85;
      g.add(shade);
      break;
    }
    case 'bench':
      add(box(0.5, 0.08, 1.6, 0, 0.45, 0), m.propWood);
      add(box(0.06, 0.45, 1.4, -0.2, 0.22, 0), m.propMetal);
      add(box(0.06, 0.45, 1.4, 0.2, 0.22, 0), m.propMetal);
      break;
    case 'cart':
      add(box(1.2, 0.5, 1.8, 0, 0.9, 0), m.propWood);
      for (const z of [-0.7, 0.7]) {
        const wheel = cyl(0.35, 0.35, 0.08, 12, 0, 0, 0);
        wheel.rotateZ(Math.PI / 2);
        wheel.translate(0.65, 0.35, z);
        add(wheel, m.propMetal);
      }
      break;
    case 'stool':
      add(cyl(0.3, 0.3, 0.06, 10, 0, 0.6, 0), m.propWood);
      add(cyl(0.04, 0.04, 0.6, 6, 0, 0.3, 0), m.propMetal);
      break;
    default:
      add(box(1, 1, 1, 0, 0.5, 0), m.propWood);
  }
  return g;
}

// Per-frame update of animated parts. Positions are shard-local.
export function updateTown(handles, t) {
  for (const key of Object.keys(handles.shards)) {
    const { anim } = handles.shards[key];
    for (const c of anim.chunks) {
      const ph = (TAU * t) / c.period + c.phase;
      c.obj.position.set(c.base.x + c.amp * 0.4 * Math.cos(ph * 2), c.amp * Math.sin(ph), c.base.z);
      c.obj.rotation.z = c.tilt + Math.sin((TAU * t) / (c.period * 1.3) + c.phase) * 0.004;
    }
    for (const pr of anim.props) {
      const c = propCenter(pr.p, t);
      pr.obj.position.set(c.x, c.y, c.z);
      pr.obj.rotation.set(
        0.12 * Math.sin(t * 0.3 + pr.phase),
        pr.p.spin * t + pr.phase,
        0.1 * Math.cos(t * 0.23 + pr.phase),
      );
    }
    for (const { m, d } of anim.debris) {
      m.position.set(d.x, d.y + d.bob * Math.sin((TAU * t) / d.period + d.phase), d.z);
      m.rotation.set(d.spin[0] * t, d.spin[1] * t, d.spin[2] * t);
    }
    for (const sp of anim.spinners) sp.obj.rotation.z = sp.speed * t;
  }
}
