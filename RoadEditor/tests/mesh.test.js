// Mesh-assembly tests: run the road editor's three.js geometry path (terrain
// displacement, strip meshes, normals, OBJ export) headlessly in Node.
// Needs `npm install` (three as a devDependency); skips cleanly otherwise.
// Run from RoadEditor/: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeTerrainSampler, terrainHeightRange, defaultTerrainParams } from '../src/terrain.js';
import { defaultRoadParams, sampleRoad, buildRoadMeshData, presetRoads } from '../src/road.js';

let THREE = null, OBJExporter = null;
try {
  THREE = await import('three');
  ({ OBJExporter } = await import('three/addons/exporters/OBJExporter.js'));
} catch { /* three not installed — the suite skips below */ }

const it = THREE ? test : test.skip;

function stripGeometry(strip) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(strip.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(strip.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(strip.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

it('procedural terrain mesh: displaced plane with finite normals and matching range', () => {
  const params = { ...defaultTerrainParams, seed: 5, size: 200, height: 30, roughness: 60 };
  const sampler = makeTerrainSampler(params);
  const geometry = new THREE.PlaneGeometry(params.size, params.size, 32, 32);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, sampler(pos.getX(i), pos.getZ(i)));
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  assert.ok(normal, 'normals computed');
  const box = new THREE.Box3().setFromBufferAttribute(pos);
  const { min, max } = terrainHeightRange(sampler, params.size, 16);
  assert.ok(box.min.y >= min - 1 && box.max.y <= max + 1, 'mesh heights match the sampler');
  for (let i = 0; i < normal.count; i += 97) {
    const len = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    assert.ok(Math.abs(len - 1) < 1e-3, `unit normal (got ${len})`);
    assert.ok(normal.getY(i) > 0, 'upward-facing normals');
  }
});

it('road strip mesh: bounding box spans width + shoulders across the road', () => {
  const params = { ...defaultRoadParams, width: 6, shoulderWidth: 1.5, markings: false, sampleLength: 2 };
  const stations = sampleRoad([{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], params, () => 0);
  const meshData = buildRoadMeshData(stations, params);
  const asphalt = stripGeometry(meshData.asphalt);
  const shoulder = stripGeometry(meshData.shoulder);
  const boxA = new THREE.Box3().setFromBufferAttribute(asphalt.attributes.position);
  const boxS = new THREE.Box3().setFromBufferAttribute(shoulder.attributes.position);
  assert.ok(Math.abs(boxA.min.z + 3) < 1e-4 && Math.abs(boxA.max.z - 3) < 1e-4, 'asphalt spans ±width/2');
  assert.ok(Math.abs(boxS.min.z + 4.5) < 1e-4 && Math.abs(boxS.max.z - 4.5) < 1e-4, 'shoulders span ±(width/2 + shoulder)');
  assert.ok(Math.abs(boxA.min.x) < 1e-4 && Math.abs(boxA.max.x - 40) < 1e-4, 'asphalt runs the road length');
  // UVs exist and u follows the arc length.
  assert.ok(asphalt.attributes.uv, 'uvs present');
  assert.ok(Math.abs(asphalt.attributes.uv.getX(asphalt.attributes.uv.count - 1) - 40) < 0.5);
  // Every index is in range.
  for (let i = 0; i < asphalt.index.count; i++) {
    assert.ok(asphalt.index.getX(i) < asphalt.attributes.position.count);
  }
});

it('marking meshes build as separate strips', () => {
  const params = { ...defaultRoadParams, width: 8, lanes: 3, markings: true, shoulderWidth: 0, sampleLength: 1 };
  const stations = sampleRoad([{ x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }], params, () => 0);
  const meshData = buildRoadMeshData(stations, params);
  const edges = stripGeometry(meshData.markEdges);
  const dividers = stripGeometry(meshData.markDividers);
  assert.ok(edges.index.count > 0 && dividers.index.count > 0);
  // Markings sit above the asphalt surface (ride height + mark raise).
  const boxD = new THREE.Box3().setFromBufferAttribute(dividers.attributes.position);
  assert.ok(boxD.min.y > 0.1, 'dividers raised above the surface');
});

it('closed circuit preset builds a looped mesh', () => {
  const sampler = makeTerrainSampler({ ...defaultTerrainParams, seed: 11 });
  const preset = presetRoads('circuit', sampler, 400);
  const params = { ...defaultRoadParams, closed: true, markings: false, shoulderWidth: 1 };
  const stations = sampleRoad(preset.points, params, sampler);
  const meshData = buildRoadMeshData(stations, params);
  const asphalt = stripGeometry(meshData.asphalt);
  const box = new THREE.Box3().setFromBufferAttribute(asphalt.attributes.position);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 50 && size.z > 50, `loop has extent (got ${size.x.toFixed(0)} × ${size.z.toFixed(0)})`);
  // A closed loop's stations return to the start.
  const first = stations[0], last = stations[stations.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 1e-6);
});

it('OBJ export produces named objects and complete geometry', () => {
  const params = { ...defaultRoadParams, width: 7, shoulderWidth: 1.5, markings: true, lanes: 2, sampleLength: 2 };
  const stations = sampleRoad([{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }], params, () => 0);
  const meshData = buildRoadMeshData(stations, params);
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x2f3134 });
  for (const [key, name] of [['asphalt', 'Road_Asphalt'], ['shoulder', 'Road_Shoulder'], ['markEdges', 'Road_EdgeLines'], ['markDividers', 'Road_LaneDividers']]) {
    const mesh = new THREE.Mesh(stripGeometry(meshData[key]), material);
    mesh.name = name;
    group.add(mesh);
  }
  const output = new OBJExporter().parse(group);
  for (const name of ['Road_Asphalt', 'Road_Shoulder', 'Road_EdgeLines', 'Road_LaneDividers']) {
    assert.ok(output.includes(`o ${name}`), `OBJ contains o ${name}`);
  }
  const vCount = (output.match(/^v /gm) || []).length;
  const fCount = (output.match(/^f /gm) || []).length;
  const expectedVerts = meshData.asphalt.positions.length / 3 + meshData.shoulder.positions.length / 3
    + meshData.markEdges.positions.length / 3 + meshData.markDividers.positions.length / 3;
  assert.equal(vCount, expectedVerts, 'OBJ vertex count matches the strips');
  assert.ok(fCount > 0, 'OBJ has faces');
  assert.ok(meshData.stats.triangles * 3 <= fCount * 3 + 1e-9, 'face count covers the triangles');
});
