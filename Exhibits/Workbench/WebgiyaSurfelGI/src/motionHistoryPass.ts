import * as THREE from 'three/webgpu';
import {
  Fn,
  int,
  instanceIndex,
  ivec2,
  texture,
  textureStore,
  uniform,
  wgsl,
  wgslFn,
} from 'three/tsl';
import type { GBufferBundle } from './gbuffer';

export type MotionHistoryPass = {
  run: (
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
  ) => void;
  reset: () => void;
  getValidationTexture: () => THREE.Texture | null;
  getCurrentHistoryTexture: () => THREE.Texture | null;
  getPreviousHistoryTexture: () => THREE.Texture | null;
};

const U_CURRENT_PROJECTION_INVERSE = uniform(new THREE.Matrix4());
const U_CURRENT_CAMERA_WORLD = uniform(new THREE.Matrix4());
const U_PREVIOUS_PROJECTION_INVERSE = uniform(new THREE.Matrix4());
const U_PREVIOUS_CAMERA_WORLD = uniform(new THREE.Matrix4());
const U_HISTORY_VALID = uniform(0);

/**
 * The history is packed into one RGBA16F texel: octahedral world normal,
 * positive linear view depth, and a combined stable-ID/transform-version key.
 * Keeping two such textures is substantially cheaper than retaining separate
 * full-resolution normal, depth, ID, and version targets.
 */
const temporalHistoryHelpers = wgsl(/* wgsl */ `
  fn temporal_oct_wrap(value: vec2f) -> vec2f {
    return (vec2f(1.0) - abs(value.yx)) * select(vec2f(-1.0), vec2f(1.0), value >= vec2f(0.0));
  }

  fn temporal_oct_encode(normalIn: vec3f) -> vec2f {
    let n = normalize(normalIn);
    let projected = n.xy / max(abs(n.x) + abs(n.y) + abs(n.z), 1e-6);
    let folded = select(temporal_oct_wrap(projected), projected, n.z >= 0.0);
    return folded * 0.5 + 0.5;
  }

  fn temporal_oct_decode(encoded: vec2f) -> vec3f {
    let projected = encoded * 2.0 - 1.0;
    var n = vec3f(projected, 1.0 - abs(projected.x) - abs(projected.y));
    if (n.z < 0.0) {
      n = vec3f(temporal_oct_wrap(n.xy), n.z);
    }
    return normalize(n);
  }

  fn temporal_reconstruct_world_depth(
    uv: vec2f,
    depth: f32,
    inverseProjection: mat4x4f,
    cameraWorld: mat4x4f
  ) -> vec4f {
    let screen = vec2f(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
    let viewH = inverseProjection * vec4f(screen, depth, 1.0);
    let view = viewH.xyz / viewH.w;
    let world = (cameraWorld * vec4f(view, 1.0)).xyz;
    return vec4f(world, max(0.0, -view.z));
  }

  fn temporal_reconstruct_world_linear(
    uv: vec2f,
    linearDepth: f32,
    inverseProjection: mat4x4f,
    cameraWorld: mat4x4f
  ) -> vec3f {
    let screen = vec2f(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
    let rayH = inverseProjection * vec4f(screen, 1.0, 1.0);
    let ray = rayH.xyz / rayH.w;
    let view = ray * (linearDepth / max(-ray.z, 1e-6));
    return (cameraWorld * vec4f(view, 1.0)).xyz;
  }
`);

const validateHistory = wgslFn(
  /* wgsl */ `
  fn validate_temporal_history(
    pixelCoord: vec2i,
    fullSize: vec2i,
    currentDepthTexture: texture_depth_2d,
    currentNormalTexture: texture_2d<f32>,
    currentVelocityTexture: texture_2d<f32>,
    currentIdentityTexture: texture_2d<f32>,
    previousHistoryTexture: texture_2d<f32>,
    currentProjectionInverse: mat4x4f,
    currentCameraWorld: mat4x4f,
    previousProjectionInverse: mat4x4f,
    previousCameraWorld: mat4x4f,
    historyValid: f32
  ) -> mat4x4f {
    let uv = (vec2f(pixelCoord) + vec2f(0.5)) / vec2f(fullSize);
    let depth = textureLoad(currentDepthTexture, pixelCoord, 0);
    let normal = normalize(textureLoad(currentNormalTexture, pixelCoord, 0).xyz * 2.0 - 1.0);
    let velocity = textureLoad(currentVelocityTexture, pixelCoord, 0).xy;
    let identity = textureLoad(currentIdentityTexture, pixelCoord, 0).xy;
    // 32 exact transform generations are sufficient for one-frame history;
    // consecutive versions never alias, even when the generation wraps.
    let currentKey = identity.x + identity.y * 32.0;
    let currentWorldDepth = temporal_reconstruct_world_depth(
      uv,
      depth,
      currentProjectionInverse,
      currentCameraWorld
    );
    let currentPacked = vec4f(
      temporal_oct_encode(normal),
      currentWorldDepth.w,
      currentKey
    );

    let currentScreen = vec2f(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
    let previousScreen = currentScreen - velocity;
    let previousUv = vec2f(
      previousScreen.x * 0.5 + 0.5,
      1.0 - (previousScreen.y * 0.5 + 0.5)
    );
    let inBounds = all(previousUv >= vec2f(0.0)) && all(previousUv < vec2f(1.0));
    let safePreviousUv = clamp(previousUv, vec2f(0.0), vec2f(0.999999));
    let previousCoord = clamp(
      vec2i(safePreviousUv * vec2f(fullSize)),
      vec2i(0),
      fullSize - vec2i(1)
    );
    let previousPacked = textureLoad(previousHistoryTexture, previousCoord, 0);
    let previousNormal = temporal_oct_decode(previousPacked.xy);
    let previousWorld = temporal_reconstruct_world_linear(
      safePreviousUv,
      previousPacked.z,
      previousProjectionInverse,
      previousCameraWorld
    );

    let currentSurfaceValid = depth > 0.0 && depth < 0.999999 && identity.x > 0.5;
    let previousSurfaceValid = previousPacked.z > 0.0 && previousPacked.w > 0.5;
    let keyMatches = abs(previousPacked.w - currentKey) < 0.25;
    let worldError = length(previousWorld - currentWorldDepth.xyz);
    let cameraDistance = length(currentWorldDepth.xyz - currentCameraWorld[3].xyz);
    let worldTolerance = max(0.02, cameraDistance * 0.0025);
    let normalAgreement = dot(normal, previousNormal);

    let depthConfidence = 1.0 - smoothstep(worldTolerance, worldTolerance * 2.0, worldError);
    let normalConfidence = smoothstep(0.82, 0.96, normalAgreement);
    let confidence = min(depthConfidence, normalConfidence) * select(0.0, 1.0, keyMatches);
    confidence *= select(0.0, 1.0, inBounds && currentSurfaceValid && previousSurfaceValid);
    confidence *= clamp(historyValid, 0.0, 1.0);

    // The binary rejection mask is intentionally stricter than the diagnostic
    // confidence so later temporal reuse cannot consume uncertain history.
    let accepted = confidence >= 0.75 && worldError <= worldTolerance && normalAgreement >= 0.88;
    let disoccluded = select(1.0, 0.0, accepted);
    let validation = vec4f(disoccluded, confidence, safePreviousUv);
    return mat4x4f(currentPacked, validation, vec4f(0.0), vec4f(0.0));
  }
`,
  [temporalHistoryHelpers],
);

function makeHistoryTexture(width: number, height: number, name: string) {
  const texture = new THREE.StorageTexture(width, height);
  texture.type = THREE.HalfFloatType;
  texture.format = THREE.RGBAFormat;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = name;
  return texture;
}

function makeValidationTexture(width: number, height: number) {
  const texture = new THREE.StorageTexture(width, height);
  texture.type = THREE.UnsignedByteType;
  texture.format = THREE.RGBAFormat;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.name = 'Temporal Validation';
  return texture;
}

export function createMotionHistoryPass(): MotionHistoryPass {
  let sourceDepth: THREE.DepthTexture | null = null;
  let sourceNormal: THREE.Texture | null = null;
  let sourceVelocity: THREE.Texture | null = null;
  let sourceIdentity: THREE.Texture | null = null;
  let historyTextures: [THREE.StorageTexture, THREE.StorageTexture] | null =
    null;
  let validationTexture: THREE.StorageTexture | null = null;
  let nodes: [THREE.ComputeNode, THREE.ComputeNode] | null = null;
  let width = 0;
  let height = 0;
  let readIndex: 0 | 1 = 0;
  let historyValid = false;
  const previousProjectionInverse = new THREE.Matrix4();
  const previousCameraWorld = new THREE.Matrix4();

  function rebuild(
    gbuffer: GBufferBundle,
    nextWidth: number,
    nextHeight: number,
  ) {
    sourceDepth = gbuffer.target.depthTexture as THREE.DepthTexture;
    sourceNormal = gbuffer.target.textures[0];
    sourceVelocity = gbuffer.target.textures[2];
    sourceIdentity = gbuffer.target.textures[3];
    width = nextWidth;
    height = nextHeight;
    readIndex = 0;
    historyValid = false;

    historyTextures?.[0].dispose();
    historyTextures?.[1].dispose();
    validationTexture?.dispose();
    historyTextures = [
      makeHistoryTexture(width, height, 'Surface History A'),
      makeHistoryTexture(width, height, 'Surface History B'),
    ];
    validationTexture = makeValidationTexture(width, height);

    const makeNode = (read: 0 | 1, write: 0 | 1) =>
      Fn(() => {
        const index = int(instanceIndex);
        const x = index.mod(int(width));
        const y = index.div(int(width));
        const coord = ivec2(x, y);
        const result = validateHistory({
          pixelCoord: coord,
          fullSize: ivec2(width, height),
          currentDepthTexture: texture(sourceDepth!),
          currentNormalTexture: texture(sourceNormal!),
          currentVelocityTexture: texture(sourceVelocity!),
          currentIdentityTexture: texture(sourceIdentity!),
          previousHistoryTexture: texture(historyTextures![read]),
          currentProjectionInverse: U_CURRENT_PROJECTION_INVERSE,
          currentCameraWorld: U_CURRENT_CAMERA_WORLD,
          previousProjectionInverse: U_PREVIOUS_PROJECTION_INVERSE,
          previousCameraWorld: U_PREVIOUS_CAMERA_WORLD,
          historyValid: U_HISTORY_VALID,
        });
        textureStore(historyTextures![write], coord, result.element(int(0)));
        textureStore(validationTexture!, coord, result.element(int(1)));
      })()
        .compute(width * height)
        .setName(`Temporal Surface History ${read} to ${write}`);

    nodes = [makeNode(0, 1), makeNode(1, 0)];
  }

  function run(
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
  ) {
    const nextWidth = gbuffer.target.width;
    const nextHeight = gbuffer.target.height;
    if (
      !nodes ||
      !historyTextures ||
      !validationTexture ||
      sourceDepth !== gbuffer.target.depthTexture ||
      sourceNormal !== gbuffer.target.textures[0] ||
      sourceVelocity !== gbuffer.target.textures[2] ||
      sourceIdentity !== gbuffer.target.textures[3] ||
      width !== nextWidth ||
      height !== nextHeight
    ) {
      rebuild(gbuffer, nextWidth, nextHeight);
      previousProjectionInverse.copy(camera.projectionMatrixInverse);
      previousCameraWorld.copy(camera.matrixWorld);
    }

    U_CURRENT_PROJECTION_INVERSE.value.copy(camera.projectionMatrixInverse);
    U_CURRENT_CAMERA_WORLD.value.copy(camera.matrixWorld);
    U_PREVIOUS_PROJECTION_INVERSE.value.copy(previousProjectionInverse);
    U_PREVIOUS_CAMERA_WORLD.value.copy(previousCameraWorld);
    U_HISTORY_VALID.value = historyValid ? 1 : 0;

    renderer.compute(nodes![readIndex]);

    readIndex = readIndex === 0 ? 1 : 0;
    historyValid = true;
    previousProjectionInverse.copy(camera.projectionMatrixInverse);
    previousCameraWorld.copy(camera.matrixWorld);
  }

  return {
    run,
    reset: () => {
      historyValid = false;
    },
    getValidationTexture: () => validationTexture,
    getCurrentHistoryTexture: () => historyTextures?.[readIndex] ?? null,
    getPreviousHistoryTexture: () =>
      historyTextures?.[readIndex === 0 ? 1 : 0] ?? null,
  };
}
