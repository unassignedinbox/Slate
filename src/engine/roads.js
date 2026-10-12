import { planStreetscape, isCurbAccess } from '../lib/streetscape.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadWidth, seededRandom, STANDARDS, createCurve } from '../lib/network.js';

import {
  resolveRoadMarking,
  isRoadMarking,
  resolveAttachedDetail,
  isRoadAttachedDetail,
} from '../lib/placement.js';
import { buildTopology } from '../lib/topology.js';
import { planInfrastructure } from '../lib/infrastructure.js';
import { weldGeometries } from './geometry.js';
import {
  renderRoad,
  renderJunction,
  renderRailway,
  paintGeometry,
  arrowGeometry,
} from './features.js';

const UP = new THREE.Vector3(0, 1, 0);
const MATERIALS = {};
let textures;

function makeTextures() {
  if (textures) return textures;
  const create = (base, variation, paving = false) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(256, 256);
    const rand = seededRandom(34);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = base + (rand() - 0.5) * variation;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (paving) {
      ctx.strokeStyle = 'rgba(32,32,32,.16)';
      ctx.lineWidth = 1;
      for (let y = 0; y <= 256; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      for (let y = 0; y < 256; y += 32)
        for (let x = ((y / 32) % 2) * 32; x <= 256; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 32);
          ctx.stroke();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  const tactileCanvas = document.createElement('canvas');
  tactileCanvas.width = tactileCanvas.height = 256;
  const tactileContext = tactileCanvas.getContext('2d');
  tactileContext.fillStyle = '#aa914c';
  tactileContext.fillRect(0, 0, 256, 256);
  for (let y = 16; y < 256; y += 32)
    for (let x = 16; x < 256; x += 32) {
      tactileContext.beginPath();
      tactileContext.arc(x + 1, y + 2, 8, 0, Math.PI * 2);
      tactileContext.fillStyle = '#81692e';
      tactileContext.fill();
      tactileContext.beginPath();
      tactileContext.arc(x, y, 6, 0, Math.PI * 2);
      tactileContext.fillStyle = '#eed28b';
      tactileContext.fill();
    }
  const tactile = new THREE.CanvasTexture(tactileCanvas);
  tactile.wrapS = tactile.wrapT = THREE.RepeatWrapping;
  tactile.repeat.set(8, 8);
  tactile.colorSpace = THREE.SRGBColorSpace;
  tactile.anisotropy = 8;
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = woodCanvas.height = 256;
  const woodContext = woodCanvas.getContext('2d');
  woodContext.fillStyle = '#af9774';
  woodContext.fillRect(0, 0, 256, 256);
  const rand = seededRandom(903);
  for (let i = 0; i < 150; i++) {
    woodContext.strokeStyle = `rgba(66,42,18,${0.02 + rand() * 0.12})`;
    woodContext.beginPath();
    const y = rand() * 256;
    woodContext.moveTo(0, y);
    woodContext.bezierCurveTo(75, y + rand() * 6, 160, y - rand() * 6, 256, y);
    woodContext.stroke();
  }
  for (let y = 0; y < 256; y += 32) {
    woodContext.fillStyle = '#715c43';
    woodContext.fillRect(0, y, 256, 1.4);
  }
  const timber = new THREE.CanvasTexture(woodCanvas);
  timber.wrapS = timber.wrapT = THREE.RepeatWrapping;
  timber.colorSpace = THREE.SRGBColorSpace;
  timber.anisotropy = 8;
  textures = {
    tactile,
    timber,
    asphalt: create(225, 30),
    paving: create(226, 15, true),
    ground: create(230, 13),
  };
  return textures;
}

function mat(name, color, extra = {}) {
  if (!MATERIALS[name]) {
    MATERIALS[name] = new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
    MATERIALS[name].name = name;
  }
  return MATERIALS[name];
}

export function roadCurve(road) {
  return createCurve(road);
}

export function sampleRoad(road, trimStart = 0, trimEnd = 0) {
  const curve = roadCurve(road);
  const length = curve.getLength();
  const start = Math.min(0.4, trimStart / length);
  const end = Math.max(0.6, 1 - trimEnd / length);
  const count = Math.max(2, Math.min(500, Math.ceil((length * (end - start)) / 3)));
  const samples = [];
  for (let i = 0; i <= count; i++) {
    const t = start + (i / count) * (end - start);
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    samples.push({ point, tangent, normal, distance: (t - start) * length });
  }
  return samples;
}

export function ribbonGeometry(samples, width, offset = 0, lift = 0, dashed = null) {
  const vertices = [],
    uv = [],
    indices = [];
  const appendQuad = (a, b, da, db) => {
    const index = vertices.length / 3;
    for (const [s, side, distance] of [
      [a, -1, da],
      [a, 1, da],
      [b, -1, db],
      [b, 1, db],
    ]) {
      const p = s.point.clone().addScaledVector(s.normal, offset + (side * width) / 2);
      vertices.push(p.x, p.y + lift, p.z);
      uv.push(side === -1 ? 0 : width / 4, distance / 4);
    }
    indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
  };
  if (!dashed) {
    // Share vertices along the spline: an indexed, manifold strip with continuous longitudinal UVs.
    samples.forEach((sample) => {
      for (const side of [-1, 1]) {
        const p = sample.point.clone().addScaledVector(sample.normal, offset + (side * width) / 2);
        vertices.push(p.x, p.y + lift, p.z);
        uv.push(side === -1 ? 0 : width / 4, sample.distance / 4);
      }
    });
    for (let i = 0; i < samples.length - 1; i++) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  for (let i = 0; dashed && i < samples.length - 1; i++) {
    const a = samples[i],
      b = samples[i + 1];
    const [dash, gap] = dashed;
    const period = dash + gap;
    let current = a.distance;
    while (current < b.distance - 0.0001) {
      const phase = current % period;
      const next = Math.min(b.distance, current + (phase < dash ? dash - phase : period - phase));
      if (phase < dash) {
        const mix = (distance) => {
          const t = (distance - a.distance) / Math.max(0.001, b.distance - a.distance);
          return {
            point: a.point.clone().lerp(b.point, t),
            normal: a.normal.clone().lerp(b.normal, t).normalize(),
          };
        };
        appendQuad(mix(current), mix(next), current, next);
      }
      current = next + 0.00001;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ribbon(parent, samples, width, offset, lift, material, dashed, id) {
  if (width < 0.001) return;
  const mesh = new THREE.Mesh(ribbonGeometry(samples, width, offset, lift, dashed), material);
  mesh.receiveShadow = true;
  if (id) mesh.userData.roadId = id;
  parent.add(mesh);
  return mesh;
}

function wall(parent, samples, offset, bottom, top, material, reverse = false) {
  const positions = [],
    uv = [],
    indices = [];
  samples.forEach((s) => {
    const p = s.point.clone().addScaledVector(s.normal, offset);
    positions.push(p.x, p.y + bottom, p.z, p.x, p.y + top, p.z);
    uv.push(s.distance / 4, 0, s.distance / 4, top - bottom);
  });
  for (let i = 0; i < samples.length - 1; i++) {
    const v = i * 2;
    if (offset > 0 !== reverse) indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    else indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
}

function box(parent, position, size, material, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.y = rotation;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function crosswalk(parent, sample, width, material, lift = 0.155) {
  const { point, tangent, normal } = sample;
  const rotation = Math.atan2(tangent.x, tangent.z);
  for (let x = -width / 2 + 0.4; x < width / 2 - 0.2; x += 1.1) {
    const p = point.clone().addScaledVector(normal, x);
    const mesh = box(parent, [p.x, p.y + lift, p.z], [0.5, 0.018, 3.3], material, rotation);
    mesh.castShadow = false;
  }
}

export function buildNetworkScene(network, options = {}) {
  const root = new THREE.Group();
  root.name = 'Frontier_Road_Network';
  const roadGroup = new THREE.Group();
  roadGroup.name = 'Roads';
  root.add(roadGroup);
  const details = new THREE.Group();
  details.name = 'Street_details';
  root.add(details);
  const underground = new THREE.Group();
  underground.name = 'Underground';
  root.add(underground);
  const { asphalt, paving, tactile, timber } = makeTextures();
  const asphaltMat = mat('Asphalt', '#525a58', { map: asphalt });
  const concreteMat = mat('Concrete_paving', '#b0afa0', { map: paving });
  const curbMat = mat('Curb_stone', '#c2c0b1');
  const paintOptions = {
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  };
  const whiteMat = mat('White_road_marking', '#eee9d9', paintOptions);
  const yellowMat = mat(
    'Yellow_road_marking',
    STANDARDS.find((s) => s.id === network.standard)?.center || '#dac56e',
    paintOptions,
  );
  yellowMat.color.set(STANDARDS.find((s) => s.id === network.standard)?.center || '#dac56e');
  const greenMat = mat('Cycle_lane', '#698276', { map: asphalt });
  const redMat = mat('Bus_lane', '#966d62', { map: asphalt });
  const medianMat = mat('Median_planting', '#687d56');
  const ironMat = mat('Street_furniture', '#4d5650', { metalness: 0.55 });
  const steelMat = mat('Galvanized_steel', '#b7bdba', { metalness: 0.75, roughness: 0.4 });
  const surfaces = new THREE.Group();
  surfaces.name = 'Connected_carriageway_surfaces';
  const railways = new THREE.Group();
  railways.name = 'Surface_railways';
  root.add(railways);
  const topology = buildTopology(network, { includeHidden: !!options.exporting });
  const infrastructure = planInfrastructure(network, { includeHidden: !!options.exporting });
  root.userData.levelCrossings = infrastructure.crossings.length;
  root.userData.topology = 'shared-spline-portals-v2';
  const instances = { poles: [], lamps: [], trees: [], trunks: [], bollards: [], arrows: [] };
  const materials = {
    asphalt: asphaltMat,
    timber: mat('Timber_decking', '#d2bd99', { map: timber }),
    bridgeSteel: mat('Bridge_structural_steel', '#718f87', { metalness: 0.7, roughness: 0.46 }),
    bridgeCable: mat('Bridge_cable_steel', '#bfc9c6', { metalness: 0.85, roughness: 0.35 }),
    bridgeStone: mat('Bridge_masonry', '#b7a68b', { map: paving }),
    bridgeTimber: mat('Bridge_structural_timber', '#977553', { map: timber }),
    bridgeRoof: mat('Covered_bridge_roof', '#4c655d', {
      metalness: 0.5,
      roughness: 0.68,
      side: THREE.DoubleSide,
    }),
    paving: concreteMat,
    tactile: mat('Tactile_warning_paving', '#ffffff', { map: tactile }),
    rampConcrete: mat('Vehicle_access_concrete', '#b6b4a1', { map: paving }),
    drainIron: mat('Drain_cast_iron', '#454943', { metalness: 0.65, roughness: 0.58 }),
    drainShadow: mat('Drain_recess', '#121914'),
    concrete: mat('Cast_concrete', '#a2a49b', { map: paving }),
    gravel: mat('Compacted_gravel', '#968a70', { map: asphalt }),
    curb: curbMat,
    white: whiteMat,
    yellow: yellowMat,
    cycle: greenMat,
    bus: redMat,
    median: medianMat,
    iron: ironMat,
    steel: steelMat,
    structuralConcrete: mat('Bridge_structural_concrete', '#989b90', { map: paving }),
    crossingDeck: mat('Level_crossing_panels', '#858b80', { map: paving }),
    ballast: mat('Railway_ballast', '#8f8878', { map: asphalt }),
    sleepers: mat('Concrete_rail_sleepers', '#8e9186'),
    railSteel: mat('Railway_steel', '#acb3ae', { metalness: 0.8, roughness: 0.3 }),
    flange: mat('Rail_flange_recess', '#222a24', { depthWrite: false }),
    whiteHardware: mat('Crossing_white_hardware', '#dddccd'),
    safetyRed: mat('Crossing_barrier_red', '#bc6253'),
    signalRed: mat('Crossing_signal', '#9a392e'),
  };
  for (const road of network.roads) {
    if (road.hidden && !options.exporting) continue;
    const group = new THREE.Group();
    group.name = `${road.name.replace(/\W+/g, '_')}_${road.id}`;
    group.userData.roadId = road.id;
    if (road.type === 'railway') {
      railways.add(group);
      renderRailway(group, road, infrastructure, materials);
      continue;
    }
    if (road.type === 'subway') {
      underground.add(group);
      const samples = sampleRoad(road);
      ribbon(group, samples, 6.2, 0, 0.1, mat('Metro_track_bed', '#5c546b'), null, road.id);
      for (const offset of [-2.1, -0.7, 0.7, 2.1])
        ribbon(group, samples, 0.16, offset, 0.3, steelMat);
      ribbon(group, samples, 6, 0, 0.2, concreteMat, [0.25, 1.5]);
      continue;
    }
    roadGroup.add(group);
    if (road.type === 'roundabout' && (road.closed || road.island) && road.center) {
      const radius = Math.max(1, road.radius - roadWidth(road) / 2);
      const island = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius + 0.2, 0.4, 64),
        medianMat,
      );
      island.position.set(road.center.x, 0.15, road.center.z);
      island.receiveShadow = true;
      group.add(island);
    }
    const plan = topology.plans.get(road.id);
    if (plan) {
      plan.streetscape = planStreetscape(network, plan, infrastructure);
      renderRoad(
        group,
        surfaces,
        plan,
        infrastructure,
        materials,
        instances,
        options,
        ribbonGeometry,
        network.standard,
      );
    }
  }
  for (const node of topology.junctions)
    renderJunction(roadGroup, surfaces, node, infrastructure, materials, ribbonGeometry);

  function instanced(positions, geometry, material, name, parent = details) {
    if (!positions.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    mesh.name = name;
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.scale || 1);
      dummy.rotation.set(0, p.rotation || 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
  if (options.fixtures !== false)
    instanced(
      instances.poles,
      new THREE.CylinderGeometry(0.11, 0.16, 7.6, 6),
      ironMat,
      'Street_light_poles',
    );
  if (options.fixtures !== false)
    instanced(
      instances.lamps,
      new THREE.BoxGeometry(0.9, 0.18, 1.4),
      mat('Lamp_housing', '#d1c7a5'),
      'Street_light_heads',
    );
  if (options.vegetation !== false)
    instanced(
      instances.trunks,
      new THREE.CylinderGeometry(0.19, 0.28, 3, 5),
      mat('Tree_bark', '#685c46'),
      'Tree_trunks',
    );
  if (options.vegetation !== false)
    instanced(
      instances.trees,
      new THREE.IcosahedronGeometry(2.7, 2),
      mat('Street_tree_canopies', '#597356'),
      'Street_trees',
    );
  instanced(
    instances.bollards,
    new THREE.CylinderGeometry(0.12, 0.12, 1.25, 6),
    steelMat,
    'Guardrail_posts',
    roadGroup,
  );
  network.props.forEach((prop) => buildProp(details, prop, { network, topology, infrastructure }));

  if (options.underground) {
    // In authoring mode the tunnel is ghosted above the ground; export keeps true -9 m elevations.
    if (!options.exporting) {
      underground.position.y = 9.6;
      underground.traverse((o) => {
        if (o.isMesh)
          o.material = mat('Metro_authoring_overlay', '#b19ccc', {
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
          });
      });
    }
  } else underground.visible = false;
  batchRoadSurfaces(surfaces, !options.exporting, true);
  surfaces.children.forEach((mesh) => {
    mesh.userData.surface = true;
  });
  root.add(surfaces);
  if (!options.exporting) {
    batchRoadSurfaces(roadGroup);
    batchRoadSurfaces(railways);
  } else {
    const junctionGroup = new THREE.Group();
    junctionGroup.name = 'Junction_returns';
    roadGroup.add(junctionGroup);
    [...roadGroup.children]
      .filter((o) => o.isMesh && !o.isInstancedMesh)
      .forEach((o) => junctionGroup.add(o));
    for (const parent of [roadGroup, railways, details, underground])
      [...parent.children].filter((o) => o.isGroup).forEach((o) => batchRoadSurfaces(o, false));
  }
  surfaces.visible = options.roads !== false;
  railways.visible = options.railways !== false;
  roadGroup.visible = options.roads !== false;
  details.visible = options.details !== false;
  if (options.wireframe) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.wireframe = true;
        o.userData.ownMaterial = true;
      }
    });
  }
  return root;
}

export function batchRoadSurfaces(group, withRanges = true, weld = false) {
  // Live rendering uses one draw per material, while face ranges retain per-road picking.
  // Core carriageways are welded in both live rendering and exports; furniture
  // stays in its own named road groups for authoring.
  group.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(),
    keep = [],
    oldGeometries = new Set();
  group.traverse((object) => {
    if (object.isInstancedMesh) {
      keep.push(object);
      return;
    }
    if (!object.isMesh) return;
    oldGeometries.add(object.geometry);
    let parent = object,
      roadId,
      visible = true;
    while (parent && parent !== group) {
      roadId ||= parent.userData.roadId;
      if (!parent.visible) visible = false;
      parent = parent.parent;
    }
    if (!visible) return;
    const material = object.material;
    const key = `${material.uuid}/${object.renderOrder}`;
    if (!buckets.has(key))
      buckets.set(key, {
        material,
        geometries: [],
        ranges: [],
        triangles: 0,
        castShadow: false,
        receiveShadow: false,
        renderOrder: object.renderOrder,
        data: {},
      });
    const bucket = buckets.get(key);
    const geometry = object.geometry
      .clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const triangles = (geometry.index?.count || geometry.attributes.position.count) / 3;
    bucket.geometries.push(geometry);
    bucket.ranges.push({
      start: bucket.triangles,
      end: bucket.triangles + triangles,
      roadId,
      propId: object.userData.propId,
      junctionId: object.userData.junctionId,
    });
    bucket.triangles += triangles;
    bucket.castShadow ||= object.castShadow;
    bucket.receiveShadow ||= object.receiveShadow;
    if (object.userData.bridgeFeature) {
      const counts = (bucket.data.bridgeFeatures ||= {});
      const feature = object.userData.bridgeFeature;
      counts[feature] = (counts[feature] || 0) + 1;
      bucket.data.bridgeStyle = object.userData.bridgeStyle;
    }
    if (object.userData.streetscapeFeature) {
      const counts = (bucket.data.streetscapeFeatures ||= {});
      const feature = object.userData.streetscapeFeature;
      counts[feature] = (counts[feature] || 0) + 1;
    }
    for (const flag of ['decal', 'structure', 'surface'])
      if (object.userData[flag]) bucket.data[flag] = true;
  });
  group.clear();
  keep.forEach((object) => group.add(object));
  for (const bucket of buckets.values()) {
    const geometry = weld
      ? weldGeometries(bucket.geometries)
      : mergeGeometries(bucket.geometries, false);
    bucket.geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.name = `Batched_${bucket.material.name}`;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.castShadow = bucket.castShadow;
    mesh.renderOrder = bucket.renderOrder;
    mesh.userData = bucket.data;
    if (withRanges) mesh.userData.faceRanges = bucket.ranges;
    group.add(mesh);
  }
  oldGeometries.forEach((g) => g.dispose());
}

export function buildProp(parent, prop, context) {
  const group = new THREE.Group();
  group.name = `${prop.type}_${prop.id}`;
  group.userData.propId = prop.id;
  group.position.set(prop.x, prop.y || 0, prop.z);
  group.rotation.y = prop.rotation || 0;
  const white = mat('White_road_marking', '#eee9d9');
  const metal = mat('Street_furniture', '#4d5650', { metalness: 0.55 });
  const stone = mat('Concrete_paving', '#b0afa0');
  const yellow = mat('Safety_yellow', '#d6b663');
  const width = prop.width || 7;
  if (context && prop.roadId && isRoadMarking(prop)) {
    const placement = resolveRoadMarking(context.network, prop, context);
    if (placement) {
      const { plan, distance, prop: resolved } = placement;
      const offset = resolved.roadAnchor.offset;
      group.position.set(resolved.x, resolved.y, resolved.z);
      group.rotation.y = resolved.rotation;
      group.updateMatrix();
      const inverse = group.matrix.clone().invert();
      const addPaint = (geometry) => {
        geometry.translate(0, resolved.roadAnchor.lift, 0).applyMatrix4(inverse);
        const mesh = new THREE.Mesh(geometry, white);
        mesh.renderOrder = 3;
        mesh.userData.decal = true;
        group.add(mesh);
      };
      if (prop.type === 'arrow')
        addPaint(arrowGeometry(plan, distance, offset, 1, resolved.roadAnchor.angle));
      else {
        const w = resolved.width;
        for (let x = -w / 2 + 0.35; x < w / 2 - 0.2; x += 1.05)
          addPaint(paintGeometry(plan, distance, x, 0.45, 3));
      }
      parent.add(group);
      return group;
    }
    // An orphaned/blocked attached decal stays in the authoring model, but must
    // never fall back to a floating box. Undo or dragging onto a road restores it.
    group.userData.invalidAttachment = true;
    parent.add(group);
    return group;
  }
  if (prop.type === 'crosswalk') {
    crosswalk(
      group,
      {
        point: new THREE.Vector3(),
        tangent: new THREE.Vector3(0, 0, 1),
        normal: new THREE.Vector3(1, 0, 0),
      },
      width,
      white,
    );
  } else if (prop.type === 'arrow') {
    box(group, [0, 0.15, 0], [0.32, 0.02, 3.5], white);
    box(group, [-0.45, 0.15, -1.5], [0.3, 0.02, 1.8], white, -0.7);
    box(group, [0.45, 0.15, -1.5], [0.3, 0.02, 1.8], white, 0.7);
  } else if (prop.type === 'bollard') {
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), metal);
    bollard.position.y = 0.65;
    bollard.castShadow = true;
    group.add(bollard);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.13, 10), yellow);
    band.position.y = 0.99;
    group.add(band);
    box(group, [0, 0.08, 0], [0.5, 0.14, 0.5], stone);
  } else if (prop.type === 'bump') {
    const geometry = new THREE.CylinderGeometry(0.9, 0.9, width, 12, 1, false, 0, Math.PI);
    geometry.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, mat('Speed_hump_rubber', '#3c423e'));
    mesh.scale.y = 0.3;
    mesh.position.y = 0.1;
    group.add(mesh);
    for (let x = -width / 2 + 0.5; x < width / 2; x += 1.1)
      box(group, [x, 0.28, 0], [0.5, 0.03, 1.3], yellow);
  } else if (prop.type === 'rail') {
    for (const z of [-0.75, 0.75]) box(group, [0, 0.28, z], [width + 8, 0.15, 0.09], metal);
    for (let x = -width / 2 - 3; x < width / 2 + 3; x += 0.7)
      box(group, [x, 0.13, 0], [0.18, 0.13, 2.6], mat('Rail_sleepers', '#5b5143'));
    for (const side of [-1, 1]) {
      box(group, [side * (width / 2 + 1.2), 0.7, 1.8], [0.45, 1.4, 0.45], metal);
      box(group, [(side * width) / 4, 1.5, 1.8], [width / 2 + 2, 0.15, 0.15], white);
      for (let x = 1; x < width / 2; x += 1)
        box(
          group,
          [side * x, 1.51, 1.8],
          [0.4, 0.17, 0.17],
          mat('Crossing_barrier_red', '#ae6557'),
        );
    }
  } else if (prop.type === 'light') {
    box(group, [0, 4, 0], [0.18, 8, 0.18], metal);
    box(group, [0.9, 8, 0], [2, 0.15, 0.3], metal);
    box(group, [1.6, 7.92, 0], [1.1, 0.18, 0.65], stone);
  } else if (prop.type === 'busStop') {
    for (const x of [-2.3, 2.3]) box(group, [x, 1.5, 0], [0.16, 3, 0.16], metal);
    box(group, [0, 3.05, 0], [5.4, 0.2, 2.2], metal);
    box(
      group,
      [0, 1.7, -0.7],
      [4.5, 2.2, 0.08],
      mat('Shelter_glass', '#8ca59b', { transparent: true, opacity: 0.5 }),
    );
    box(group, [0, 0.6, 0], [3.6, 0.17, 0.7], mat('Bench', '#987e5c'));
  } else if (prop.type === 'subway') {
    box(group, [0, 0.13, 0], [4.5, 0.25, 6.5], stone);
    box(group, [0, 0.25, 0], [2.8, 0.1, 5], mat('Metro_stairwell', '#343e3a'));
    for (const side of [-1, 1]) box(group, [side * 1.7, 0.7, 0], [0.1, 1.3, 5.2], metal);
    box(group, [0, 3.2, -2.4], [3.8, 0.7, 0.15], mat('Metro_sign', '#617d80'));
    for (const side of [-1, 1]) box(group, [side * 1.7, 1.8, -2.4], [0.12, 3, 0.12], metal);
  }
  parent.add(group);
  return group;
}

export function buildSelection(road) {
  const group = new THREE.Group();
  if (!road) return group;
  const samples = sampleRoad(road);
  group.userData.center = roadCurve(road).getPointAt(0.5);
  const width = roadWidth(road);
  const material = new THREE.MeshBasicMaterial({
    color: '#e0c28b',
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  for (const side of [-1, 1]) {
    const edge = ribbon(group, samples, 0.42, side * (width / 2 + 0.2), 0.5, material);
    edge.renderOrder = 20;
  }
  road.points.forEach((p, index) => {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#efe2bf', depthTest: false }),
    );
    marker.position.set(p.x, (p.y || 0) + 0.75, p.z);
    marker.userData.pointIndex = index;
    marker.userData.roadId = road.id;
    marker.userData.handle = true;
    marker.userData.baseSize = 1.7;
    marker.renderOrder = 22;
    group.add(marker);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.7, 20), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(marker.position);
    ring.renderOrder = 21;
    ring.userData.handle = true;
    ring.userData.baseSize = 2.7;
    group.add(ring);
  });
  return group;
}

export function buildPropSelection(prop, network) {
  if (network && prop?.roadId && isRoadAttachedDetail(prop))
    prop = resolveAttachedDetail(network, prop)?.prop || prop;
  const group = new THREE.Group();
  if (!prop) return group;
  const dimensions = {
    crosswalk: [prop.width || 7, 0.4, 4],
    arrow: [2, 0.4, 4.5],
    bollard: [0.8, 1.4, 0.8],
    bump: [prop.width || 7, 0.65, 2],
    rail: [(prop.width || 7) + 8, 2, 5],
    light: [3, 8.3, 1.2],
    busStop: [5.8, 3.5, 2.5],
    subway: [5, 3.6, 7],
    driveway: [
      (network?.roads.find((r) => r.id === prop.roadId)?.sidewalk || 2.4) + 5,
      0.4,
      (prop.width || 4.5) + 1.8,
    ],
    curbRamp: [
      network?.roads.find((r) => r.id === prop.roadId)?.sidewalk || 2.4,
      0.4,
      (prop.width || 2.4) + 1.2,
    ],
  }[prop.type] || [2, 2, 2];
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...dimensions));
  const mesh = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: '#e0c28b',
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  mesh.position.set(prop.x, (prop.y || 0) + dimensions[1] / 2, prop.z);
  mesh.rotation.y = prop.rotation || 0;
  if (prop.type === 'driveway')
    mesh.position.add(
      new THREE.Vector3(
        -Math.cos(prop.rotation || 0),
        0,
        Math.sin(prop.rotation || 0),
      ).multiplyScalar((prop.curbAnchor?.side || 1) * 2.5),
    );
  mesh.renderOrder = 22;
  mesh.userData.ownMaterial = true;
  group.add(mesh);
  group.userData.center = new THREE.Vector3(prop.x, (prop.y || 0) + dimensions[1], prop.z);
  return group;
}

export function buildTerrain(network) {
  const group = new THREE.Group();
  const tex = makeTextures().ground;
  tex.repeat.set(45, 45);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    mat('Terrain', '#707d68', { map: tex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.24;
  ground.receiveShadow = true;
  group.add(ground);
  if (
    network.roads.some(
      (r) =>
        r.type === 'bridge' &&
        (r.structure === 'river' || (!r.structure && r.name === 'Eastbank Bridge')),
    )
  ) {
    const extent = Math.max(
      ...network.roads
        .filter((r) => r.type !== 'bridge' && r.type !== 'subway')
        .flatMap((r) => r.points.map((p) => p.x)),
    );
    const points = Array.from({ length: 15 }, (_, i) => ({
      x: extent * 1.33 + Math.sin(i * 0.7) * extent * 0.05,
      z: ((i - 7) * network.size) / 6,
      y: -0.15,
    }));
    const samples = sampleRoad({ points });
    ribbon(group, samples, Math.max(38, extent * 0.22), 0, 0.02, mat('River_bank', '#879082'));
    ribbon(
      group,
      samples,
      Math.max(30, extent * 0.17),
      0,
      0.1,
      mat('River_water', '#637e7c', { roughness: 0.45, metalness: 0.2 }),
    );
  }
  return group;
}

export function disposeGroup(group) {
  if (!group) return;
  const materials = new Set();
  group.traverse((o) => {
    o.geometry?.dispose();
    if (o.userData.ownMaterial || o.material?.isMeshBasicMaterial) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m) materials.add(m);
      });
    }
  });
  materials.forEach((m) => m.dispose());
  group.removeFromParent();
}
