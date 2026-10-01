import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, SAH } from './external/three-mesh-bvh/src';
import { buildDiffuseArrayTexture } from './diffuseArray';
import type { SceneBVHBundle } from './sceneBvh';

export type DynamicSceneBVHBundle = SceneBVHBundle & {
  update: () => boolean;
  dynamicObjectCount: number;
  getRefitCount: () => number;
};

type PreparedGeometry = {
  geometry: THREE.BufferGeometry;
  object: THREE.Mesh;
};

type BlasSource = {
  nodes: Float32Array;
  nodeCount: number;
  triangleBase: number;
  flatNodeOffset: number;
  dynamic: DynamicRecord | null;
};

type DynamicRecord = {
  object: THREE.Mesh;
  localPositions: Float32Array;
  localNormals: Float32Array;
  vertexBase: number;
  sourceNodes: Float32Array;
  worldNodes: Float32Array;
  lastMatrix: THREE.Matrix4;
};

type TopologyRef =
  | { kind: 'source'; source: BlasSource }
  | {
      kind: 'branch';
      nodeIndex: number;
      left: TopologyRef;
      right: TopologyRef;
    };

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function prepareGeometry(
  object: THREE.Mesh,
  materialIdByUUID: Map<string, number>,
  bakeWorldTransform: boolean,
): PreparedGeometry | null {
  let geometry = object.geometry.clone();
  if (bakeWorldTransform) geometry.applyMatrix4(object.matrixWorld);

  // Static scene geometry keeps upstream's independent-triangle material
  // encoding. Dynamic rigid objects retain their indexed canonical geometry;
  // each supported object has one material, so no vertex duplication is needed.
  if (bakeWorldTransform)
    geometry = geometry.index ? geometry.toNonIndexed() : geometry;

  const position = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!position) return null;
  const vertexCount = position.count;

  if (!geometry.index) {
    const index = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  } else if (!(geometry.index.array instanceof Uint32Array)) {
    geometry.setIndex(
      new THREE.BufferAttribute(new Uint32Array(geometry.index.array), 1),
    );
  }

  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2),
    );
  }

  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const packed = new Float32Array(vertexCount * 3);
  const materials = materialsOf(object);
  const defaultId = materialIdByUUID.get(materials[0]?.uuid ?? '') ?? 0;

  if (
    bakeWorldTransform &&
    geometry.groups.length > 0 &&
    materials.length > 1
  ) {
    // toNonIndexed preserves group ranges, so every group still addresses the
    // corresponding independent vertices.
    const materialIds = new Float32Array(vertexCount);
    for (const group of geometry.groups) {
      const material = materials[group.materialIndex ?? 0] ?? materials[0];
      materialIds.fill(
        materialIdByUUID.get(material?.uuid ?? '') ?? defaultId,
        group.start,
        group.start + group.count,
      );
    }
    for (let i = 0; i < vertexCount; i++) {
      packed[i * 3] = uv.getX(i);
      packed[i * 3 + 1] = uv.getY(i);
      packed[i * 3 + 2] = materialIds[i];
    }
  } else {
    for (let i = 0; i < vertexCount; i++) {
      packed[i * 3] = uv.getX(i);
      packed[i * 3 + 1] = uv.getY(i);
      packed[i * 3 + 2] = defaultId;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(packed, 3));
  geometry.computeBoundingBox();
  return { geometry, object };
}

function transformNodeBounds(
  source: Float32Array,
  target: Float32Array,
  matrix: THREE.Matrix4,
) {
  const sourceBits = new Uint32Array(
    source.buffer,
    source.byteOffset,
    source.length,
  );
  const targetBits = new Uint32Array(
    target.buffer,
    target.byteOffset,
    target.length,
  );
  const e = matrix.elements;

  for (let node = 0; node < source.length / 8; node++) {
    const offset = node * 8;
    const minX = source[offset];
    const minY = source[offset + 1];
    const minZ = source[offset + 2];
    const maxX = source[offset + 3];
    const maxY = source[offset + 4];
    const maxZ = source[offset + 5];
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const extentX = (maxX - minX) * 0.5;
    const extentY = (maxY - minY) * 0.5;
    const extentZ = (maxZ - minZ) * 0.5;
    const worldCenterX =
      e[0] * centerX + e[4] * centerY + e[8] * centerZ + e[12];
    const worldCenterY =
      e[1] * centerX + e[5] * centerY + e[9] * centerZ + e[13];
    const worldCenterZ =
      e[2] * centerX + e[6] * centerY + e[10] * centerZ + e[14];
    const worldExtentX =
      Math.abs(e[0]) * extentX +
      Math.abs(e[4]) * extentY +
      Math.abs(e[8]) * extentZ;
    const worldExtentY =
      Math.abs(e[1]) * extentX +
      Math.abs(e[5]) * extentY +
      Math.abs(e[9]) * extentZ;
    const worldExtentZ =
      Math.abs(e[2]) * extentX +
      Math.abs(e[6]) * extentY +
      Math.abs(e[10]) * extentZ;

    target[offset] = worldCenterX - worldExtentX;
    target[offset + 1] = worldCenterY - worldExtentY;
    target[offset + 2] = worldCenterZ - worldExtentZ;
    target[offset + 3] = worldCenterX + worldExtentX;
    target[offset + 4] = worldCenterY + worldExtentY;
    target[offset + 5] = worldCenterZ + worldExtentZ;
    targetBits[offset + 6] = sourceBits[offset + 6];
    targetBits[offset + 7] = sourceBits[offset + 7];
  }
}

function transformVertices(
  record: DynamicRecord,
  positions: Float32Array,
  normals: Float32Array,
) {
  const world = record.object.matrixWorld;
  const e = world.elements;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world).elements;

  for (let i = 0; i < record.localPositions.length / 3; i++) {
    const localOffset = i * 3;
    const targetOffset = (record.vertexBase + i) * 3;
    const x = record.localPositions[localOffset];
    const y = record.localPositions[localOffset + 1];
    const z = record.localPositions[localOffset + 2];
    positions[targetOffset] = e[0] * x + e[4] * y + e[8] * z + e[12];
    positions[targetOffset + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    positions[targetOffset + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];

    const nx = record.localNormals[localOffset];
    const ny = record.localNormals[localOffset + 1];
    const nz = record.localNormals[localOffset + 2];
    let worldX =
      normalMatrix[0] * nx + normalMatrix[3] * ny + normalMatrix[6] * nz;
    let worldY =
      normalMatrix[1] * nx + normalMatrix[4] * ny + normalMatrix[7] * nz;
    let worldZ =
      normalMatrix[2] * nx + normalMatrix[5] * ny + normalMatrix[8] * nz;
    const inverseLength =
      1 / Math.max(1e-12, Math.hypot(worldX, worldY, worldZ));
    worldX *= inverseLength;
    worldY *= inverseLength;
    worldZ *= inverseLength;
    normals[targetOffset] = worldX;
    normals[targetOffset + 1] = worldY;
    normals[targetOffset + 2] = worldZ;
  }
}

function nodeBounds(nodes: Float32Array, nodeIndex: number) {
  const offset = nodeIndex * 8;
  return {
    minX: nodes[offset],
    minY: nodes[offset + 1],
    minZ: nodes[offset + 2],
    maxX: nodes[offset + 3],
    maxY: nodes[offset + 4],
    maxZ: nodes[offset + 5],
  };
}

export function createDynamicSceneBVH(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
): DynamicSceneBVHBundle {
  scene.updateMatrixWorld(true);
  const { diffuseArrayTex, materialIdByUUID } = buildDiffuseArrayTexture(
    renderer,
    scene,
    1024,
  );

  const staticPrepared: PreparedGeometry[] = [];
  const dynamicPrepared: PreparedGeometry[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const dynamic = object.userData.dynamicRigid === true;
    const prepared = prepareGeometry(object, materialIdByUUID, !dynamic);
    if (!prepared) return;
    (dynamic ? dynamicPrepared : staticPrepared).push(prepared);
  });
  if (staticPrepared.length === 0) {
    throw new Error('createDynamicSceneBVH: no static geometry found');
  }

  const staticGeometry = BufferGeometryUtils.mergeGeometries(
    staticPrepared.map((entry) => entry.geometry),
  );
  if (!staticGeometry) {
    throw new Error('createDynamicSceneBVH: static geometry merge failed');
  }
  const staticBVH = new MeshBVH(staticGeometry, {
    maxLeafTris: 1,
    strategy: SAH,
  });

  const geometries = [
    staticGeometry,
    ...dynamicPrepared.map((entry) => entry.geometry),
  ];
  const vertexCounts = geometries.map(
    (geometry) => geometry.getAttribute('position').count,
  );
  const triangleCounts = geometries.map(
    (geometry) => geometry.index!.count / 3,
  );
  const vertexBases: number[] = [];
  const triangleBases: number[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  for (let i = 0; i < geometries.length; i++) {
    vertexBases.push(totalVertices);
    triangleBases.push(totalTriangles);
    totalVertices += vertexCounts[i];
    totalTriangles += triangleCounts[i];
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const colors = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalTriangles * 3);
  for (
    let geometryIndex = 0;
    geometryIndex < geometries.length;
    geometryIndex++
  ) {
    const geometry = geometries[geometryIndex];
    const vertexBase = vertexBases[geometryIndex];
    const triangleBase = triangleBases[geometryIndex];
    const geometryPositions = geometry.getAttribute('position')
      .array as Float32Array;
    const geometryNormals = geometry.getAttribute('normal')
      .array as Float32Array;
    const geometryColors = geometry.getAttribute('color').array as Float32Array;
    positions.set(geometryPositions, vertexBase * 3);
    normals.set(geometryNormals, vertexBase * 3);
    colors.set(geometryColors, vertexBase * 3);
    const geometryIndices = geometry.index!.array;
    for (let i = 0; i < geometryIndices.length; i++) {
      indices[triangleBase * 3 + i] = geometryIndices[i] + vertexBase;
    }
  }

  const staticRoots = (staticBVH as unknown as { _roots: ArrayBuffer[] })
    ._roots;
  const staticNodes = new Float32Array(staticRoots[0]);
  const sources: BlasSource[] = [
    {
      nodes: staticNodes,
      nodeCount: staticNodes.length / 8,
      triangleBase: triangleBases[0],
      flatNodeOffset: 0,
      dynamic: null,
    },
  ];
  const dynamicRecords: DynamicRecord[] = [];

  for (let i = 0; i < dynamicPrepared.length; i++) {
    const prepared = dynamicPrepared[i];
    const geometry = prepared.geometry;
    const bvh = new MeshBVH(geometry, {
      maxLeafTris: 4,
      strategy: SAH,
    });
    // MeshBVH may reorder the index after the combined stream was initialized.
    const triangleBase = triangleBases[i + 1];
    for (let index = 0; index < geometry.index!.array.length; index++) {
      indices[triangleBase * 3 + index] =
        geometry.index!.array[index] + vertexBases[i + 1];
    }
    const roots = (bvh as unknown as { _roots: ArrayBuffer[] })._roots;
    const sourceNodes = new Float32Array(roots[0]);
    const record: DynamicRecord = {
      object: prepared.object,
      localPositions: new Float32Array(
        geometry.getAttribute('position').array as Float32Array,
      ),
      localNormals: new Float32Array(
        geometry.getAttribute('normal').array as Float32Array,
      ),
      vertexBase: vertexBases[i + 1],
      sourceNodes,
      worldNodes: new Float32Array(sourceNodes.length),
      lastMatrix: new THREE.Matrix4(),
    };
    transformVertices(record, positions, normals);
    transformNodeBounds(
      record.sourceNodes,
      record.worldNodes,
      record.object.matrixWorld,
    );
    record.lastMatrix.copy(record.object.matrixWorld);
    dynamicRecords.push(record);
    sources.push({
      nodes: record.worldNodes,
      nodeCount: record.worldNodes.length / 8,
      triangleBase,
      flatNodeOffset: 0,
      dynamic: record,
    });
  }

  const totalNodeCount =
    sources.reduce((sum, source) => sum + source.nodeCount, 0) +
    Math.max(0, sources.length - 1);
  const combinedNodes = new Float32Array(totalNodeCount * 8);
  const combinedNodeBits = new Uint32Array(combinedNodes.buffer);
  let nodeCursor = 0;

  const copySource = (source: BlasSource): TopologyRef => {
    source.flatNodeOffset = nodeCursor;
    const sourceBits = new Uint32Array(
      source.nodes.buffer,
      source.nodes.byteOffset,
      source.nodes.length,
    );
    for (let node = 0; node < source.nodeCount; node++) {
      const sourceOffset = node * 8;
      const targetOffset = (nodeCursor + node) * 8;
      combinedNodes.set(
        source.nodes.subarray(sourceOffset, sourceOffset + 6),
        targetOffset,
      );
      const splitOrCount = sourceBits[sourceOffset + 7];
      const leaf = (splitOrCount & 0xffff0000) !== 0;
      combinedNodeBits[targetOffset + 6] =
        sourceBits[sourceOffset + 6] + (leaf ? source.triangleBase : 0);
      combinedNodeBits[targetOffset + 7] = splitOrCount;
    }
    nodeCursor += source.nodeCount;
    return { kind: 'source', source };
  };

  const buildTopology = (entries: BlasSource[]): TopologyRef => {
    if (entries.length === 1) return copySource(entries[0]);
    const parentIndex = nodeCursor++;
    const midpoint = Math.ceil(entries.length / 2);
    const left = buildTopology(entries.slice(0, midpoint));
    const rightRoot = nodeCursor;
    const right = buildTopology(entries.slice(midpoint));
    combinedNodeBits[parentIndex * 8 + 6] = rightRoot - parentIndex;
    combinedNodeBits[parentIndex * 8 + 7] = 0;
    return { kind: 'branch', nodeIndex: parentIndex, left, right };
  };
  const topology = buildTopology(sources);
  if (nodeCursor !== totalNodeCount) {
    throw new Error('createDynamicSceneBVH: invalid flattened TLAS size');
  }

  const updateTopologyBounds = (
    ref: TopologyRef,
  ): ReturnType<typeof nodeBounds> => {
    if (ref.kind === 'source') {
      return nodeBounds(combinedNodes, ref.source.flatNodeOffset);
    }
    const left = updateTopologyBounds(ref.left);
    const right = updateTopologyBounds(ref.right);
    const offset = ref.nodeIndex * 8;
    combinedNodes[offset] = Math.min(left.minX, right.minX);
    combinedNodes[offset + 1] = Math.min(left.minY, right.minY);
    combinedNodes[offset + 2] = Math.min(left.minZ, right.minZ);
    combinedNodes[offset + 3] = Math.max(left.maxX, right.maxX);
    combinedNodes[offset + 4] = Math.max(left.maxY, right.maxY);
    combinedNodes[offset + 5] = Math.max(left.maxZ, right.maxZ);
    return nodeBounds(combinedNodes, ref.nodeIndex);
  };
  updateTopologyBounds(topology);

  const bvhAttr = new THREE.StorageBufferAttribute(combinedNodes, 8);
  const positionAttr = new THREE.StorageBufferAttribute(positions, 3);
  const normalAttr = new THREE.StorageBufferAttribute(normals, 3);
  const indexAttr = new THREE.StorageBufferAttribute(indices, 3);
  const colorAttr = new THREE.StorageBufferAttribute(colors, 3);
  const bvhNode = storage(bvhAttr, 'BVHNode', bvhAttr.count)
    .toReadOnly()
    .setName('bvh');
  const positionNode = storage(positionAttr, 'vec3', positionAttr.count)
    .toReadOnly()
    .setName('bvh_position');
  const normalNode = storage(normalAttr, 'vec3', normalAttr.count)
    .toReadOnly()
    .setName('bvh_normal');
  const indexNode = storage(indexAttr, 'uvec3', indexAttr.count)
    .toReadOnly()
    .setName('bvh_index');
  const colorNode = storage(colorAttr, 'vec3', colorAttr.count)
    .toReadOnly()
    .setName('bvh_attribute');
  let refitCount = 0;

  const update = () => {
    let changed = false;
    for (let i = 0; i < dynamicRecords.length; i++) {
      const record = dynamicRecords[i];
      if (record.lastMatrix.equals(record.object.matrixWorld)) continue;
      changed = true;
      transformVertices(record, positions, normals);
      transformNodeBounds(
        record.sourceNodes,
        record.worldNodes,
        record.object.matrixWorld,
      );
      record.lastMatrix.copy(record.object.matrixWorld);
      const source = sources[i + 1];
      const targetOffset = source.flatNodeOffset * 8;
      const sourceBits = new Uint32Array(record.worldNodes.buffer);
      for (let node = 0; node < source.nodeCount; node++) {
        const sourceOffset = node * 8;
        const nodeOffset = targetOffset + sourceOffset;
        combinedNodes.set(
          record.worldNodes.subarray(sourceOffset, sourceOffset + 6),
          nodeOffset,
        );
        const splitOrCount = sourceBits[sourceOffset + 7];
        const leaf = (splitOrCount & 0xffff0000) !== 0;
        combinedNodeBits[nodeOffset + 6] =
          sourceBits[sourceOffset + 6] + (leaf ? source.triangleBase : 0);
        combinedNodeBits[nodeOffset + 7] = splitOrCount;
      }
    }
    if (!changed) return false;
    updateTopologyBounds(topology);
    bvhAttr.needsUpdate = true;
    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    refitCount += 1;
    return true;
  };

  return {
    bvhNode,
    positionNode,
    normalNode,
    indexNode,
    colorNode,
    diffuseArrayTex,
    update,
    dynamicObjectCount: dynamicRecords.length,
    getRefitCount: () => refitCount,
  };
}
