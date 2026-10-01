import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  atomicAdd,
  atomicMax,
  atomicStore,
  float,
  instancedArray,
  int,
  instanceIndex,
  ivec2,
  normalize,
  storage,
  textureLoad,
  textureStore,
  uniform,
  vec4,
  wgslFn,
} from 'three/tsl';
import {
  MAX_SURFELS_PER_CELL,
  OFFSETS_AND_LIST_START,
  SLG_TOTAL_FLOATS,
  SURFEL_DEPTH_TEXELS,
} from './constants';
import type { SurfelHashGrid } from './surfelHashGrid';
import {
  snap_to_surfel_grid_origin,
  surfel_grid_coord_to_hash,
  surfel_pos_to_grid_coord,
  surfel_radius_for_pos,
} from './surfelHashGrid';
import type { SurfelPool } from './surfelPool';
import { SurfelMoments, SurfelStruct } from './surfelPool';

export type RayHitSurfelSeedSettings = {
  budget: number;
  candidatesPerBudget: number;
  coverageScale: number;
};

export type RayHitSurfelSeedPass = {
  run: (
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    seedTexture: THREE.Texture,
    probeWidth: number,
    probeHeight: number,
    settings: RayHitSurfelSeedSettings,
  ) => void;
  getDebugTexture: () => THREE.Texture | null;
};

const decodeRayHitSeed = wgslFn(/* wgsl */ `
  fn decode_ray_hit_seed(seed: vec4f) -> mat4x4f {
    let packed = bitcast<u32>(seed.w);
    let valid = (packed & 0x80000000u) != 0u;
    let qx = packed & 0x7ffu;
    let qy = (packed >> 11u) & 0x7ffu;
    let oct = vec2f(f32(qx), f32(qy)) / 2047.0 * 2.0 - 1.0;
    var normal = vec3f(oct, 1.0 - abs(oct.x) - abs(oct.y));
    if (normal.z < 0.0) {
      normal.xy = (vec2f(1.0) - abs(normal.yx)) *
        select(vec2f(-1.0), vec2f(1.0), normal.xy >= vec2f(0.0));
    }
    normal = normalize(normal);
    return mat4x4f(
      vec4f(seed.xyz, select(0.0, 1.0, valid)),
      vec4f(normal, 0.0),
      vec4f(0.0),
      vec4f(0.0)
    );
  }
`);

/**
 * Adds a tiny, bounded number of surfels from validated screen-probe ray hits.
 * This pass deliberately runs after the normal screen-space allocator and never
 * changes that allocator's requests or initialization path.
 */
export function createRayHitSurfelSeedPass(
  grid: SurfelHashGrid,
  pool: SurfelPool,
): RayHitSurfelSeedPass {
  let computeNode: THREE.ComputeNode | null = null;
  let resetNode: THREE.ComputeNode | null = null;
  let syncNode: THREE.ComputeNode | null = null;
  let debugTexture: THREE.StorageTexture | null = null;
  let boundSeedTexture: THREE.Texture | null = null;
  let width = 0;
  let height = 0;

  const acceptedCounter = instancedArray(new Int32Array(1), 'int').toAtomic();
  const U_GRID_ORIGIN = uniform(new THREE.Vector3());
  const U_CAMERA_POSITION = uniform(new THREE.Vector3());
  const U_READ_OFFSET = uniform(0);
  const U_WRITE_OFFSET = uniform(0);
  const U_FRAME = uniform(0);
  const U_BUDGET = uniform(32);
  const U_STRIDE = uniform(1);
  const U_COVERAGE_SCALE = uniform(1.0);

  function ensureResources(
    seedTexture: THREE.Texture,
    probeWidth: number,
    probeHeight: number,
  ) {
    if (
      seedTexture === boundSeedTexture &&
      probeWidth === width &&
      probeHeight === height &&
      debugTexture
    ) {
      return;
    }
    boundSeedTexture = seedTexture;
    width = probeWidth;
    height = probeHeight;
    debugTexture?.dispose();
    debugTexture = new THREE.StorageTexture(width, height);
    debugTexture.type = THREE.HalfFloatType;
    debugTexture.format = THREE.RGBAFormat;
    debugTexture.minFilter = THREE.NearestFilter;
    debugTexture.magFilter = THREE.NearestFilter;
    debugTexture.generateMipmaps = false;
    debugTexture.name = 'Ray-hit Surfel Seed Diagnostics';
    computeNode = null;
  }

  function run(
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    seedTexture: THREE.Texture,
    probeWidth: number,
    probeHeight: number,
    settings: RayHitSurfelSeedSettings,
  ) {
    const probeCount = probeWidth * probeHeight;
    if (probeCount <= 0) return;
    ensureResources(seedTexture, probeWidth, probeHeight);

    const poolAlloc = pool.getPoolAllocAtomic();
    const poolMax = pool.getPoolMaxAtomic();
    const poolAttr = pool.getPoolAttr();
    const surfelAttr = pool.getSurfelAttr();
    const momentsAttr = pool.getMomentsAttr();
    const guidingAttr = pool.getGuidingAttr();
    const surfelDepthAttr = pool.getSurfelDepthAttr();
    const offsetsAndListAttr = grid.getOffsetsAndListAttr();
    if (
      !debugTexture ||
      !poolAlloc ||
      !poolMax ||
      !poolAttr ||
      !surfelAttr ||
      !momentsAttr ||
      !guidingAttr ||
      !surfelDepthAttr ||
      !offsetsAndListAttr
    ) {
      return;
    }

    const capacity = surfelAttr.count;
    const budget = THREE.MathUtils.clamp(Math.floor(settings.budget), 0, 256);
    const candidateTarget = Math.max(
      1,
      budget *
        THREE.MathUtils.clamp(Math.floor(settings.candidatesPerBudget), 1, 16),
    );
    U_BUDGET.value = budget;
    U_STRIDE.value = Math.max(1, Math.ceil(probeCount / candidateTarget));
    U_COVERAGE_SCALE.value = THREE.MathUtils.clamp(
      settings.coverageScale,
      0.25,
      3,
    );
    U_CAMERA_POSITION.value.copy(camera.position);
    snap_to_surfel_grid_origin(U_GRID_ORIGIN.value, camera.position);
    U_FRAME.value = renderer.info.frame;
    const offsets = pool.getOffsets();
    U_READ_OFFSET.value = offsets.readOffset;
    U_WRITE_OFFSET.value = offsets.writeOffset;

    const poolBuf = storage(poolAttr, 'int', capacity);
    const surfels = storage(surfelAttr, SurfelStruct, capacity);
    const moments = storage(momentsAttr, SurfelMoments, capacity * 2);
    const guiding = storage(guidingAttr, 'float', guidingAttr.count);
    const surfelDepth = storage(surfelDepthAttr, 'vec4', surfelDepthAttr.count);
    const offsetsAndList = storage(
      offsetsAndListAttr,
      'int',
      offsetsAndListAttr.count,
    ).setAccess('readOnly');

    if (!resetNode) {
      resetNode = Fn(() => {
        atomicStore(acceptedCounter.element(0), int(0));
      })()
        .compute(1)
        .setName('Ray-hit Surfel Seed Budget Reset');
    }

    if (!computeNode) {
      computeNode = Fn(() => {
        const probeIndex = int(instanceIndex);
        const x = probeIndex.mod(int(width));
        const y = probeIndex.div(int(width));
        const diagnostic = vec4(0).toVar();
        const decoded = decodeRayHitSeed(
          textureLoad(boundSeedTexture!, ivec2(x, y)),
        );
        const candidate = decoded.element(int(0));
        const normal = normalize(decoded.element(int(1)).xyz);
        const valid = candidate.w.greaterThan(0.5);

        If(valid, () => {
          diagnostic.assign(vec4(0.18, 0.0, 0.0, 1.0));

          // Rotate a deterministic sparse subset every frame. The strict atomic
          // budget below remains authoritative if several candidates survive.
          const sequence = probeIndex.add(int(U_FRAME));
          const selected = sequence.mod(int(U_STRIDE)).equal(int(0));

          If(selected.and(U_BUDGET.greaterThan(0)), () => {
            const position = candidate.xyz;
            const relative = position.sub(U_GRID_ORIGIN);
            const cell = int(
              surfel_grid_coord_to_hash(surfel_pos_to_grid_coord(relative)),
            );
            const start = offsetsAndList.element(cell);
            const end = offsetsAndList.element(cell.add(int(1)));
            const count = end
              .sub(start)
              .max(int(0))
              .min(int(MAX_SURFELS_PER_CELL));
            const covered = int(0).toVar();
            const candidateRadius = surfel_radius_for_pos(
              position,
              U_CAMERA_POSITION,
            ).mul(U_COVERAGE_SCALE);

            Loop(int(MAX_SURFELS_PER_CELL), ({ i }) => {
              If(i.greaterThanEqual(count), () => {
                Break();
              });
              const sid = offsetsAndList.element(
                start.add(i).add(int(OFFSETS_AND_LIST_START)),
              );
              If(
                sid.greaterThanEqual(int(0)).and(sid.lessThan(int(capacity))),
                () => {
                  const existing = surfels.element(sid);
                  const close = existing
                    .get('posb')
                    .xyz.sub(position)
                    .length()
                    .lessThan(candidateRadius);
                  const aligned = existing
                    .get('normal')
                    .dot(normal)
                    .greaterThan(0.7);
                  If(close.and(aligned), () => {
                    covered.assign(int(1));
                  });
                },
              );
            });

            If(covered.equal(int(1)), () => {
              diagnostic.assign(vec4(0.0, 0.55, 0.0, 1.0));
            }).Else(() => {
              const ticket = atomicAdd(acceptedCounter.element(0), int(1));
              If(ticket.lessThan(int(U_BUDGET)), () => {
                const previousAllocation = atomicAdd(
                  poolAlloc.element(0),
                  int(1),
                );
                If(previousAllocation.lessThan(int(capacity)), () => {
                  const surfelIndex = poolBuf.element(previousAllocation);
                  atomicMax(poolMax.element(0), surfelIndex.add(int(1)));
                  const surfel = surfels.element(surfelIndex);
                  surfel.get('posb').assign(vec4(position, float(U_FRAME)));
                  surfel.get('normal').assign(normal);
                  surfel.get('age').assign(int(0));

                  const coldIrradiance = vec4(0.0, 0.0, 0.0, 0.0);
                  const coldMean = vec4(0.0, 0.0, 0.0, 1.0);
                  const coldVariance = vec4(1.0, 1.0, 1.0, 1.0);
                  const readMoment = moments.element(
                    surfelIndex.add(U_READ_OFFSET),
                  );
                  readMoment.get('irradiance').assign(coldIrradiance);
                  readMoment.get('msmeData0').assign(coldMean);
                  readMoment.get('msmeData1').assign(coldVariance);
                  readMoment.get('guiding').assign(vec4(0.0));
                  readMoment.get('hit').assign(vec4(0.0));
                  const writeMoment = moments.element(
                    surfelIndex.add(U_WRITE_OFFSET),
                  );
                  writeMoment.get('irradiance').assign(coldIrradiance);
                  writeMoment.get('msmeData0').assign(coldMean);
                  writeMoment.get('msmeData1').assign(coldVariance);
                  writeMoment.get('guiding').assign(vec4(0.0));
                  writeMoment.get('hit').assign(vec4(0.0));

                  const guidingBase = surfelIndex.mul(int(SLG_TOTAL_FLOATS));
                  Loop(int(SLG_TOTAL_FLOATS), ({ i }) => {
                    guiding.element(guidingBase.add(i)).assign(float(0));
                  });
                  const depthBase = surfelIndex.mul(
                    int(SURFEL_DEPTH_TEXELS * SURFEL_DEPTH_TEXELS),
                  );
                  Loop(
                    int(SURFEL_DEPTH_TEXELS * SURFEL_DEPTH_TEXELS),
                    ({ i }) => {
                      surfelDepth.element(depthBase.add(i)).assign(vec4(0.0));
                    },
                  );
                  diagnostic.assign(vec4(0.0, 0.35, 1.0, 1.0));
                }).Else(() => {
                  atomicAdd(poolAlloc.element(0), int(-1));
                });
              });
            });
          });
        });

        textureStore(debugTexture!, ivec2(x, y), diagnostic);
      })()
        .compute(probeCount)
        .setName('Ray-hit Surfel Seeding');
    }

    renderer.compute(resetNode);
    renderer.compute(computeNode);

    if (!syncNode) {
      syncNode = Fn(() => {
        const allocationCount = atomicAdd(poolAlloc.element(0), int(0));
        atomicStore(pool.getAliveAtomic().element(0), allocationCount);
      })()
        .compute(1)
        .setName('Ray-hit Surfel Seed Alive Sync');
    }
    renderer.compute(syncNode);
  }

  return {
    run,
    getDebugTexture: () => debugTexture,
  };
}
