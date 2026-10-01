import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  int,
  instanceIndex,
  ivec2,
  texture,
  textureStore,
  uniform,
  vec2,
  vec4,
  wgsl,
  wgslFn,
} from 'three/tsl';
import type { GBufferBundle } from './gbuffer';

const TILE_SIZE = 8;
const MAX_SPATIAL_NEIGHBORS = 4;

export type ScreenProbeReuseSettings = {
  temporal: boolean;
  spatial: boolean;
  spatialNeighbors: number;
  maxHistory: number;
  maxReservoirM: number;
  correctionClamp: number;
};

export type ScreenProbeReusePass = {
  run: (
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
    currentProbeRadiance: THREE.Texture,
    currentProbeGeometry: THREE.Texture,
    temporalValidation: THREE.Texture,
    settings: ScreenProbeReuseSettings,
  ) => void;
  reset: () => void;
  getOutputTexture: () => THREE.Texture | null;
  getReservoirRadianceTexture: () => THREE.Texture | null;
  getReservoirMetadataTexture: () => THREE.Texture | null;
  getDebugTexture: () => THREE.Texture | null;
};

const reuseHelpers = wgsl(/* wgsl */ `
  fn probe_reuse_hash(valueIn: u32) -> u32 {
    var value = valueIn;
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    value *= 0x846ca68bu;
    value ^= value >> 16u;
    return value;
  }

  fn probe_reuse_random(probeIndex: u32, frameIndex: u32, stream: u32) -> f32 {
    let bits = probe_reuse_hash(
      probeIndex * 0x9e3779b9u + frameIndex * 0x85ebca6bu + stream * 0xc2b2ae35u
    );
    return f32(bits & 0x00ffffffu) / 16777216.0;
  }

  fn probe_reuse_luminance(radiance: vec3f) -> f32 {
    return max(dot(max(radiance, vec3f(0.0)), vec3f(0.2126, 0.7152, 0.0722)), 1e-4);
  }

  fn probe_reuse_center_pixel(
    probeCoord: vec2i,
    fullSize: vec2i
  ) -> vec2i {
    return min(
      probeCoord * ${TILE_SIZE} + vec2i(${Math.floor(TILE_SIZE / 2)}),
      fullSize - vec2i(1)
    );
  }

  fn probe_reuse_view_position(
    probeCoord: vec2i,
    depth: f32,
    fullSize: vec2i,
    inverseProjection: mat4x4f
  ) -> vec3f {
    let pixel = vec2f(probe_reuse_center_pixel(probeCoord, fullSize)) + vec2f(0.5);
    let uv = pixel / vec2f(fullSize);
    let screen = vec2f(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
    let viewH = inverseProjection * vec4f(screen, depth, 1.0);
    return viewH.xyz / viewH.w;
  }
`);

const temporalReuseReservoir = wgslFn(
  /* wgsl */ `
  fn temporal_reuse_reservoir(
    probeCoord: vec2i,
    probeIndex: u32,
    probeSize: vec2i,
    fullSize: vec2i,
    currentRadianceTexture: texture_2d<f32>,
    currentGeometryTexture: texture_2d<f32>,
    validationTexture: texture_2d<f32>,
    velocityTexture: texture_2d<f32>,
    previousRadianceTexture: texture_2d<f32>,
    previousMetadataTexture: texture_2d<f32>,
    frameIndex: u32,
    historyValid: f32,
    temporalEnabled: f32,
    maxHistory: f32
  ) -> mat4x4f {
    let currentRadiance = textureLoad(currentRadianceTexture, probeCoord, 0);
    let currentGeometry = textureLoad(currentGeometryTexture, probeCoord, 0);
    let currentValid = currentRadiance.w > 0.0 &&
      currentGeometry.w > 0.0 && currentGeometry.w < 0.999999;
    if (!currentValid) {
      return mat4x4f(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
    }

    let currentWeight = probe_reuse_luminance(currentRadiance.xyz);
    var selected = vec4f(currentRadiance.xyz, currentWeight);
    var sumWeights = currentWeight;
    var candidateCount = 1.0;
    var selectedAge = 0.0;
    var selectedSource = 0.0;

    let centerPixel = probe_reuse_center_pixel(probeCoord, fullSize);
    let validation = textureLoad(validationTexture, centerPixel, 0);
    let currentUv = (vec2f(centerPixel) + vec2f(0.5)) / vec2f(fullSize);
    let currentScreen = vec2f(currentUv.x, 1.0 - currentUv.y) * 2.0 - 1.0;
    let velocity = textureLoad(velocityTexture, centerPixel, 0).xy;
    let previousScreen = currentScreen - velocity;
    let rawPreviousUv = vec2f(
      previousScreen.x * 0.5 + 0.5,
      1.0 - (previousScreen.y * 0.5 + 0.5)
    );
    let previousUv = clamp(rawPreviousUv, vec2f(0.0), vec2f(0.999999));
    let previousPixel = clamp(
      vec2i(previousUv * vec2f(fullSize)),
      vec2i(0),
      fullSize - vec2i(1)
    );
    let previousProbeCoord = clamp(
      previousPixel / ${TILE_SIZE},
      vec2i(0),
      probeSize - vec2i(1)
    );
    let previousRadiance = textureLoad(previousRadianceTexture, previousProbeCoord, 0);
    let previousMetadata = textureLoad(previousMetadataTexture, previousProbeCoord, 0);
    let acceptHistory = temporalEnabled > 0.5 && historyValid > 0.5 &&
      validation.x < 0.5 && validation.y >= 0.75 &&
      previousRadiance.w > 0.0 && previousMetadata.y > 0.0;

    if (acceptHistory) {
      let retainedCount = min(previousMetadata.y, max(1.0, maxHistory - 1.0));
      let retention = retainedCount / max(previousMetadata.y, 1e-4);
      let previousGroupWeight = previousMetadata.x * retention;
      let combinedWeight = sumWeights + previousGroupWeight;
      let choosePrevious = probe_reuse_random(probeIndex, frameIndex, 0u) <
        previousGroupWeight / max(combinedWeight, 1e-4);
      if (choosePrevious) {
        selected = previousRadiance;
        selectedAge = min(previousMetadata.z + 1.0, maxHistory);
        selectedSource = 0.5;
      }
      sumWeights = combinedWeight;
      candidateCount += retainedCount;
    }

    let metadata = vec4f(
      sumWeights,
      candidateCount,
      selectedAge,
      selectedSource
    );
    let diagnostics = vec4f(
      select(0.0, 1.0, acceptHistory),
      validation.y,
      previousUv
    );
    return mat4x4f(selected, metadata, diagnostics, vec4f(0.0));
  }
`,
  [reuseHelpers],
);

const spatialReuseReservoir = wgslFn(
  /* wgsl */ `
  fn spatial_reuse_reservoir(
    probeCoord: vec2i,
    probeIndex: u32,
    probeSize: vec2i,
    fullSize: vec2i,
    temporalRadianceTexture: texture_2d<f32>,
    temporalMetadataTexture: texture_2d<f32>,
    temporalDiagnosticsTexture: texture_2d<f32>,
    probeGeometryTexture: texture_2d<f32>,
    identityTexture: texture_2d<f32>,
    inverseProjection: mat4x4f,
    frameIndex: u32,
    spatialNeighborCount: u32,
    maxReservoirM: f32,
    correctionClamp: f32
  ) -> mat4x4f {
    var selected = textureLoad(temporalRadianceTexture, probeCoord, 0);
    let initialMetadata = textureLoad(temporalMetadataTexture, probeCoord, 0);
    let temporalDiagnostics = textureLoad(temporalDiagnosticsTexture, probeCoord, 0);
    let geometry = textureLoad(probeGeometryTexture, probeCoord, 0);
    if (selected.w <= 0.0 || initialMetadata.y <= 0.0 || geometry.w <= 0.0) {
      return mat4x4f(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
    }

    var sumWeights = initialMetadata.x;
    var candidateCount = initialMetadata.y;
    var selectedAge = initialMetadata.z;
    var selectedSource = initialMetadata.w;
    var acceptedNeighbors = 0.0;

    let normal = normalize(geometry.xyz);
    let viewPosition = probe_reuse_view_position(
      probeCoord,
      geometry.w,
      fullSize,
      inverseProjection
    );
    let centerPixel = probe_reuse_center_pixel(probeCoord, fullSize);
    let identity = textureLoad(identityTexture, centerPixel, 0).xy;
    let identityKey = identity.x + identity.y * 32.0;
    let offsets = array<vec2i, ${MAX_SPATIAL_NEIGHBORS}>(
      vec2i(1, 0),
      vec2i(-1, 0),
      vec2i(0, 1),
      vec2i(0, -1)
    );

    for (var neighborIndex = 0u; neighborIndex < ${MAX_SPATIAL_NEIGHBORS}u; neighborIndex++) {
      if (neighborIndex >= spatialNeighborCount) { continue; }
      let neighborCoord = probeCoord + offsets[neighborIndex];
      if (any(neighborCoord < vec2i(0)) || any(neighborCoord >= probeSize)) { continue; }

      let neighborGeometry = textureLoad(probeGeometryTexture, neighborCoord, 0);
      let neighborRadiance = textureLoad(temporalRadianceTexture, neighborCoord, 0);
      let neighborMetadata = textureLoad(temporalMetadataTexture, neighborCoord, 0);
      if (neighborGeometry.w <= 0.0 || neighborRadiance.w <= 0.0 || neighborMetadata.y <= 0.0) {
        continue;
      }

      let neighborPixel = probe_reuse_center_pixel(neighborCoord, fullSize);
      let neighborIdentity = textureLoad(identityTexture, neighborPixel, 0).xy;
      let neighborKey = neighborIdentity.x + neighborIdentity.y * 32.0;
      let normalAgreement = dot(normal, normalize(neighborGeometry.xyz));
      let neighborViewPosition = probe_reuse_view_position(
        neighborCoord,
        neighborGeometry.w,
        fullSize,
        inverseProjection
      );
      let positionTolerance = max(0.15, abs(viewPosition.z) * 0.04);
      let sameSurface = identityKey > 0.5 && abs(identityKey - neighborKey) < 0.25 &&
        normalAgreement >= 0.9 &&
        length(viewPosition - neighborViewPosition) <= positionTolerance;
      if (!sameSurface) { continue; }

      let remainingCount = max(0.0, maxReservoirM - candidateCount);
      if (remainingCount <= 0.0) { continue; }
      // Divide the remaining candidate budget across all remaining directions;
      // otherwise a large +X reservoir would starve the other three neighbors.
      let remainingDirections = max(1.0, f32(spatialNeighborCount - neighborIndex));
      let directionBudget = remainingCount / remainingDirections;
      let retainedCount = min(neighborMetadata.y, directionBudget);
      let retention = retainedCount / max(neighborMetadata.y, 1e-4);
      let neighborGroupWeight = neighborMetadata.x * retention;
      let combinedWeight = sumWeights + neighborGroupWeight;
      let chooseNeighbor = probe_reuse_random(
        probeIndex,
        frameIndex,
        neighborIndex + 1u
      ) < neighborGroupWeight / max(combinedWeight, 1e-4);
      if (chooseNeighbor) {
        selected = neighborRadiance;
        selectedAge = neighborMetadata.z;
        selectedSource = 1.0;
      }
      sumWeights = combinedWeight;
      candidateCount += retainedCount;
      acceptedNeighbors += 1.0;
    }

    let correction = min(
      max(correctionClamp, 1.0),
      sumWeights / max(candidateCount * selected.w, 1e-4)
    );
    let resolved = vec4f(max(selected.xyz * correction, vec3f(0.0)), 1.0);
    let metadata = vec4f(
      sumWeights,
      candidateCount,
      selectedAge,
      selectedSource
    );
    let neighborDenominator = max(1.0, f32(spatialNeighborCount));
    let diagnostics = vec4f(
      temporalDiagnostics.x,
      acceptedNeighbors / neighborDenominator,
      selectedSource,
      1.0
    );
    return mat4x4f(selected, metadata, resolved, diagnostics);
  }
`,
  [reuseHelpers],
);

const reconstructReusedProbes = wgslFn(/* wgsl */ `
  fn reconstruct_reused_probes(
    pixelCoord: vec2i,
    pixelUv: vec2f,
    pixelDepth: f32,
    pixelNormal: vec3f,
    fullSize: vec2i,
    probeSize: vec2i,
    inverseProjection: mat4x4f,
    probeRadiance: texture_2d<f32>,
    probeGeometry: texture_2d<f32>
  ) -> vec4f {
    let currentScreen = vec2f(pixelUv.x, 1.0 - pixelUv.y) * 2.0 - 1.0;
    let currentClip = vec4f(currentScreen, pixelDepth, 1.0);
    let currentViewH = inverseProjection * currentClip;
    let currentView = currentViewH.xyz / currentViewH.w;
    let baseProbe = pixelCoord / ${TILE_SIZE};

    var sumRadiance = vec3f(0.0);
    var sumWeight = 0.0;
    var strongestWeight = 0.0;

    for (var offsetY = -1; offsetY <= 1; offsetY++) {
      for (var offsetX = -1; offsetX <= 1; offsetX++) {
        let probeCoord = clamp(
          baseProbe + vec2i(offsetX, offsetY),
          vec2i(0),
          probeSize - vec2i(1)
        );
        let radiance = textureLoad(probeRadiance, probeCoord, 0);
        if (radiance.w <= 0.0) { continue; }

        let geometry = textureLoad(probeGeometry, probeCoord, 0);
        let probeNormal = normalize(geometry.xyz);
        let probePixel = min(
          vec2f(probeCoord * ${TILE_SIZE}) + vec2f(${TILE_SIZE * 0.5}),
          vec2f(fullSize) - vec2f(0.5)
        );
        let probeUv = probePixel / vec2f(fullSize);
        let probeScreen = vec2f(probeUv.x, 1.0 - probeUv.y) * 2.0 - 1.0;
        let probeClip = vec4f(probeScreen, geometry.w, 1.0);
        let probeViewH = inverseProjection * probeClip;
        let probeView = probeViewH.xyz / probeViewH.w;

        let normalWeight = pow(max(0.0, dot(pixelNormal, probeNormal)), 12.0);
        let relativeDepth = abs(currentView.z - probeView.z) /
          max(1.0, abs(currentView.z));
        let depthWeight = exp(-relativeDepth * 48.0);
        let pixelDelta = (vec2f(pixelCoord) + vec2f(0.5) - probePixel) /
          f32(${TILE_SIZE});
        let spatialWeight = 1.0 / (1.0 + dot(pixelDelta, pixelDelta));
        let weight = normalWeight * depthWeight * spatialWeight;

        sumRadiance += radiance.xyz * weight;
        sumWeight += weight;
        strongestWeight = max(strongestWeight, weight);
      }
    }

    if (sumWeight <= 1e-5) { return vec4f(0.0); }
    let confidence = clamp(strongestWeight * 1.35, 0.0, 1.0);
    return vec4f(sumRadiance / sumWeight, confidence);
  }
`);

function makeFloatTexture(width: number, height: number, name: string) {
  const result = new THREE.StorageTexture(width, height);
  result.type = THREE.HalfFloatType;
  result.format = THREE.RGBAFormat;
  result.minFilter = THREE.NearestFilter;
  result.magFilter = THREE.NearestFilter;
  result.generateMipmaps = false;
  result.name = name;
  return result;
}

function makeDebugTexture(width: number, height: number, name: string) {
  const result = new THREE.StorageTexture(width, height);
  result.type = THREE.UnsignedByteType;
  result.format = THREE.RGBAFormat;
  result.minFilter = THREE.NearestFilter;
  result.magFilter = THREE.NearestFilter;
  result.generateMipmaps = false;
  result.name = name;
  return result;
}

export function createScreenProbeReusePass(): ScreenProbeReusePass {
  let currentProbeRadiance: THREE.Texture | null = null;
  let currentProbeGeometry: THREE.Texture | null = null;
  let temporalValidation: THREE.Texture | null = null;
  let velocityTexture: THREE.Texture | null = null;
  let identityTexture: THREE.Texture | null = null;
  let depthTexture: THREE.DepthTexture | null = null;
  let normalTexture: THREE.Texture | null = null;
  let historyRadiance: [THREE.StorageTexture, THREE.StorageTexture] | null =
    null;
  let historyMetadata: [THREE.StorageTexture, THREE.StorageTexture] | null =
    null;
  let temporalRadiance: THREE.StorageTexture | null = null;
  let temporalMetadata: THREE.StorageTexture | null = null;
  let temporalDiagnostics: THREE.StorageTexture | null = null;
  let resolvedProbeRadiance: THREE.StorageTexture | null = null;
  let debugTexture: THREE.StorageTexture | null = null;
  let outputTexture: THREE.StorageTexture | null = null;
  let temporalNodes: [THREE.ComputeNode, THREE.ComputeNode] | null = null;
  let spatialNodes: [THREE.ComputeNode, THREE.ComputeNode] | null = null;
  let reconstructNode: THREE.ComputeNode | null = null;
  let width = 0;
  let height = 0;
  let probeWidth = 0;
  let probeHeight = 0;
  let readIndex: 0 | 1 = 0;
  let historyValid = false;
  let frameIndex = 0;

  const U_PROJECTION_INVERSE = uniform(new THREE.Matrix4());
  const U_FRAME_INDEX = uniform(0);
  const U_HISTORY_VALID = uniform(0);
  const U_TEMPORAL_ENABLED = uniform(1);
  const U_SPATIAL_NEIGHBORS = uniform(4);
  const U_MAX_HISTORY = uniform(16);
  const U_MAX_RESERVOIR_M = uniform(32);
  const U_CORRECTION_CLAMP = uniform(4);

  function disposeTextures() {
    for (const result of historyRadiance ?? []) result.dispose();
    for (const result of historyMetadata ?? []) result.dispose();
    temporalRadiance?.dispose();
    temporalMetadata?.dispose();
    temporalDiagnostics?.dispose();
    resolvedProbeRadiance?.dispose();
    debugTexture?.dispose();
    outputTexture?.dispose();
  }

  function rebuild(
    gbuffer: GBufferBundle,
    nextProbeRadiance: THREE.Texture,
    nextProbeGeometry: THREE.Texture,
    nextTemporalValidation: THREE.Texture,
  ) {
    disposeTextures();
    currentProbeRadiance = nextProbeRadiance;
    currentProbeGeometry = nextProbeGeometry;
    temporalValidation = nextTemporalValidation;
    velocityTexture = gbuffer.target.textures[2];
    identityTexture = gbuffer.target.textures[3];
    depthTexture = gbuffer.target.depthTexture as THREE.DepthTexture;
    normalTexture = gbuffer.target.textures[0];
    width = gbuffer.target.width;
    height = gbuffer.target.height;
    probeWidth = Math.max(1, Math.ceil(width / TILE_SIZE));
    probeHeight = Math.max(1, Math.ceil(height / TILE_SIZE));
    readIndex = 0;
    historyValid = false;
    frameIndex = 0;

    historyRadiance = [
      makeFloatTexture(probeWidth, probeHeight, 'Probe Reservoir Radiance A'),
      makeFloatTexture(probeWidth, probeHeight, 'Probe Reservoir Radiance B'),
    ];
    historyMetadata = [
      makeFloatTexture(probeWidth, probeHeight, 'Probe Reservoir Metadata A'),
      makeFloatTexture(probeWidth, probeHeight, 'Probe Reservoir Metadata B'),
    ];
    temporalRadiance = makeFloatTexture(
      probeWidth,
      probeHeight,
      'Temporal Probe Reservoir Radiance',
    );
    temporalMetadata = makeFloatTexture(
      probeWidth,
      probeHeight,
      'Temporal Probe Reservoir Metadata',
    );
    temporalDiagnostics = makeDebugTexture(
      probeWidth,
      probeHeight,
      'Temporal Probe Reuse Diagnostics',
    );
    resolvedProbeRadiance = makeFloatTexture(
      probeWidth,
      probeHeight,
      'Reused Probe Radiance',
    );
    debugTexture = makeDebugTexture(
      probeWidth,
      probeHeight,
      'Probe Reservoir Diagnostics',
    );
    outputTexture = makeFloatTexture(
      width,
      height,
      'ReSTIR Screen Probe Resolve',
    );

    const makeTemporalNode = (read: 0 | 1) =>
      Fn(() => {
        const index = int(instanceIndex);
        const x = index.mod(int(probeWidth));
        const y = index.div(int(probeWidth));
        const coord = ivec2(x, y);
        const result = temporalReuseReservoir({
          probeCoord: coord,
          probeIndex: index.toUint(),
          probeSize: ivec2(probeWidth, probeHeight),
          fullSize: ivec2(width, height),
          currentRadianceTexture: texture(currentProbeRadiance!),
          currentGeometryTexture: texture(currentProbeGeometry!),
          validationTexture: texture(temporalValidation!),
          velocityTexture: texture(velocityTexture!),
          previousRadianceTexture: texture(historyRadiance![read]),
          previousMetadataTexture: texture(historyMetadata![read]),
          frameIndex: U_FRAME_INDEX.toUint(),
          historyValid: U_HISTORY_VALID,
          temporalEnabled: U_TEMPORAL_ENABLED,
          maxHistory: U_MAX_HISTORY,
        });
        textureStore(temporalRadiance!, coord, result.element(int(0)));
        textureStore(temporalMetadata!, coord, result.element(int(1)));
        textureStore(temporalDiagnostics!, coord, result.element(int(2)));
      })()
        .compute(probeWidth * probeHeight)
        .setName(`Temporal Probe Reservoir ${read}`);

    const makeSpatialNode = (write: 0 | 1) =>
      Fn(() => {
        const index = int(instanceIndex);
        const x = index.mod(int(probeWidth));
        const y = index.div(int(probeWidth));
        const coord = ivec2(x, y);
        const result = spatialReuseReservoir({
          probeCoord: coord,
          probeIndex: index.toUint(),
          probeSize: ivec2(probeWidth, probeHeight),
          fullSize: ivec2(width, height),
          temporalRadianceTexture: texture(temporalRadiance!),
          temporalMetadataTexture: texture(temporalMetadata!),
          temporalDiagnosticsTexture: texture(temporalDiagnostics!),
          probeGeometryTexture: texture(currentProbeGeometry!),
          identityTexture: texture(identityTexture!),
          inverseProjection: U_PROJECTION_INVERSE,
          frameIndex: U_FRAME_INDEX.toUint(),
          spatialNeighborCount: U_SPATIAL_NEIGHBORS.toUint(),
          maxReservoirM: U_MAX_RESERVOIR_M,
          correctionClamp: U_CORRECTION_CLAMP,
        });
        textureStore(historyRadiance![write], coord, result.element(int(0)));
        textureStore(historyMetadata![write], coord, result.element(int(1)));
        textureStore(resolvedProbeRadiance!, coord, result.element(int(2)));
        textureStore(debugTexture!, coord, result.element(int(3)));
      })()
        .compute(probeWidth * probeHeight)
        .setName(`Spatial Probe Reservoir ${write}`);

    temporalNodes = [makeTemporalNode(0), makeTemporalNode(1)];
    spatialNodes = [makeSpatialNode(0), makeSpatialNode(1)];

    reconstructNode = Fn(() => {
      const index = int(instanceIndex);
      const x = index.mod(int(width));
      const y = index.div(int(width));
      const coord = ivec2(x, y);
      const uv = vec2(
        x.toFloat().add(0.5).div(width),
        y.toFloat().add(0.5).div(height),
      );
      const depth = texture(depthTexture!, uv).r;
      const valid = depth.lessThan(0.999999).and(depth.greaterThan(0.0));
      const resolved = vec4(0).toVar();
      If(valid, () => {
        const normal = texture(normalTexture!, uv)
          .xyz.mul(2.0)
          .sub(1.0)
          .normalize();
        resolved.assign(
          reconstructReusedProbes({
            pixelCoord: coord,
            pixelUv: uv,
            pixelDepth: depth,
            pixelNormal: normal,
            fullSize: ivec2(width, height),
            probeSize: ivec2(probeWidth, probeHeight),
            inverseProjection: U_PROJECTION_INVERSE,
            probeRadiance: texture(resolvedProbeRadiance!),
            probeGeometry: texture(currentProbeGeometry!),
          }),
        );
      });
      textureStore(outputTexture!, coord, resolved);
    })()
      .compute(width * height)
      .setName('ReSTIR Screen Probe Reconstruct');
  }

  function run(
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
    nextProbeRadiance: THREE.Texture,
    nextProbeGeometry: THREE.Texture,
    nextTemporalValidation: THREE.Texture,
    settings: ScreenProbeReuseSettings,
  ) {
    if (
      !temporalNodes ||
      !spatialNodes ||
      !reconstructNode ||
      currentProbeRadiance !== nextProbeRadiance ||
      currentProbeGeometry !== nextProbeGeometry ||
      temporalValidation !== nextTemporalValidation ||
      velocityTexture !== gbuffer.target.textures[2] ||
      identityTexture !== gbuffer.target.textures[3] ||
      depthTexture !== gbuffer.target.depthTexture ||
      normalTexture !== gbuffer.target.textures[0] ||
      width !== gbuffer.target.width ||
      height !== gbuffer.target.height
    ) {
      rebuild(
        gbuffer,
        nextProbeRadiance,
        nextProbeGeometry,
        nextTemporalValidation,
      );
    }

    U_PROJECTION_INVERSE.value.copy(camera.projectionMatrixInverse);
    U_FRAME_INDEX.value = frameIndex;
    U_HISTORY_VALID.value = historyValid ? 1 : 0;
    U_TEMPORAL_ENABLED.value = settings.temporal ? 1 : 0;
    U_SPATIAL_NEIGHBORS.value = settings.spatial
      ? THREE.MathUtils.clamp(
          Math.floor(settings.spatialNeighbors),
          0,
          MAX_SPATIAL_NEIGHBORS,
        )
      : 0;
    U_MAX_HISTORY.value = THREE.MathUtils.clamp(
      Math.floor(settings.maxHistory),
      2,
      32,
    );
    U_MAX_RESERVOIR_M.value = THREE.MathUtils.clamp(
      Math.floor(settings.maxReservoirM),
      4,
      64,
    );
    U_CORRECTION_CLAMP.value = THREE.MathUtils.clamp(
      settings.correctionClamp,
      1,
      8,
    );

    const writeIndex: 0 | 1 = readIndex === 0 ? 1 : 0;
    renderer.compute(temporalNodes![readIndex]);
    renderer.compute(spatialNodes![writeIndex]);
    renderer.compute(reconstructNode!);
    readIndex = writeIndex;
    historyValid = true;
    frameIndex = (frameIndex + 1) >>> 0;
  }

  return {
    run,
    reset: () => {
      historyValid = false;
      frameIndex = 0;
    },
    getOutputTexture: () => outputTexture,
    getReservoirRadianceTexture: () => resolvedProbeRadiance,
    getReservoirMetadataTexture: () => historyMetadata?.[readIndex] ?? null,
    getDebugTexture: () => debugTexture,
  };
}
