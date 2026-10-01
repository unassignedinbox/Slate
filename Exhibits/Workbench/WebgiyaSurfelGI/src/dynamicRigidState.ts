import * as THREE from 'three/webgpu';
import { storage, struct } from 'three/tsl';

export const MAX_DYNAMIC_RIGIDS = 8;

export const DynamicRigidStruct = struct(
  {
    centerRadius: 'vec4',
    previousRadius: 'vec4',
    albedo: 'vec4',
  },
  'DynamicRigidProxy',
);

export type DynamicRigidProxy = {
  mesh: THREE.Mesh;
  localCenter: THREE.Vector3;
  localRadius: number;
  albedo: THREE.Color;
};

export type DynamicRigidState = {
  sync: (proxies: DynamicRigidProxy[]) => void;
  getAttribute: () => THREE.StorageBufferAttribute;
  getStorageNode: () => THREE.StorageBufferNode;
};

export function createDynamicRigidState(): DynamicRigidState {
  const values = new Float32Array(MAX_DYNAMIC_RIGIDS * 12);
  const attribute = new THREE.StorageBufferAttribute(values, 12);
  const storageNode = storage(attribute, DynamicRigidStruct, MAX_DYNAMIC_RIGIDS)
    .toReadOnly()
    .setName('dynamicRigids');
  const previousCenters = new WeakMap<THREE.Mesh, THREE.Vector3>();
  const center = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const worldScale = new THREE.Vector3();

  function sync(proxies: DynamicRigidProxy[]) {
    values.fill(0);
    const count = Math.min(proxies.length, MAX_DYNAMIC_RIGIDS);
    for (let index = 0; index < count; ++index) {
      const proxy = proxies[index];
      proxy.mesh.updateWorldMatrix(true, false);
      center.copy(proxy.localCenter).applyMatrix4(proxy.mesh.matrixWorld);
      proxy.mesh.getWorldScale(worldScale);
      const radius =
        proxy.localRadius *
        Math.max(
          Math.abs(worldScale.x),
          Math.abs(worldScale.y),
          Math.abs(worldScale.z),
        );
      previous.copy(previousCenters.get(proxy.mesh) ?? center);

      const offset = index * 12;
      values[offset] = center.x;
      values[offset + 1] = center.y;
      values[offset + 2] = center.z;
      values[offset + 3] = radius;
      values[offset + 4] = previous.x;
      values[offset + 5] = previous.y;
      values[offset + 6] = previous.z;
      values[offset + 7] = radius;
      values[offset + 8] = proxy.albedo.r;
      values[offset + 9] = proxy.albedo.g;
      values[offset + 10] = proxy.albedo.b;
      values[offset + 11] = 1;
      previousCenters.set(proxy.mesh, center.clone());
    }
    attribute.needsUpdate = true;
  }

  return {
    sync,
    getAttribute: () => attribute,
    getStorageNode: () => storageNode,
  };
}
