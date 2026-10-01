import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  atomicAdd,
  atomicMax,
  clamp,
  dot,
  float,
  instanceIndex,
  int,
  length,
  max,
  storage,
} from 'three/tsl';
import { SURFEL_KILL_SIGNAL } from './constants.ts';
import {
  MAX_DYNAMIC_RIGIDS,
  type DynamicRigidState,
} from './dynamicRigidState.ts';
import { SurfelStruct, type SurfelPool } from './surfelPool.ts';

export type DynamicRigidInvalidatePass = {
  run: (
    renderer: THREE.WebGPURenderer,
    pool: SurfelPool,
    dispatchArgs: THREE.IndirectStorageBufferAttribute,
  ) => void;
};

export function createDynamicRigidInvalidatePass(
  rigidState: DynamicRigidState,
): DynamicRigidInvalidatePass {
  let computeNode: THREE.ComputeNode | null = null;

  function run(
    renderer: THREE.WebGPURenderer,
    pool: SurfelPool,
    dispatchArgs: THREE.IndirectStorageBufferAttribute,
  ) {
    const surfelAttribute = pool.getSurfelAttr();
    const poolMax = pool.getPoolMaxAtomic();
    const touched = pool.getTouched();
    if (!surfelAttribute || !poolMax || !touched) return;

    if (!computeNode) {
      const surfels = storage(
        surfelAttribute,
        SurfelStruct,
        surfelAttribute.count,
      ).toReadOnly();
      const dynamicRigids = rigidState.getStorageNode();

      computeNode = Fn(() => {
        const index = int(instanceIndex);
        const total = atomicAdd(poolMax.element(0), int(0));
        If(index.lessThan(total), () => {
          const position = surfels.element(index).get('posb').xyz;
          for (
            let rigidIndex = 0;
            rigidIndex < MAX_DYNAMIC_RIGIDS;
            ++rigidIndex
          ) {
            const proxy = dynamicRigids.element(rigidIndex);
            const current = proxy.get('centerRadius');
            const previous = proxy.get('previousRadius');
            If(current.w.greaterThan(0), () => {
              const segment = current.xyz.sub(previous.xyz);
              const lengthSquared = max(dot(segment, segment), float(1e-6));
              const segmentT = clamp(
                dot(position.sub(previous.xyz), segment).div(lengthSquared),
                0,
                1,
              );
              const closest = previous.xyz.add(segment.mul(segmentT));
              const sweptRadius = max(current.w, previous.w).add(0.32);
              If(length(position.sub(closest)).lessThan(sweptRadius), () => {
                atomicMax(touched.element(index), int(SURFEL_KILL_SIGNAL));
              });
            });
          }
        });
      })()
        .computeKernel([64, 1, 1])
        .setName('Dynamic Rigid Surfel Invalidate');
    }

    renderer.compute(computeNode, dispatchArgs);
  }

  return { run };
}
