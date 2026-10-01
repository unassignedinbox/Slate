import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  float,
  getViewPosition,
  int,
  instanceIndex,
  ivec2,
  sampler,
  storage,
  texture,
  textureStore,
  uniform,
  vec2,
  vec4,
  wgsl,
  wgslFn,
} from 'three/tsl';
import type { GBufferBundle } from './gbuffer';
import type { SceneBVHBundle } from './sceneBvh';
import {
  bvhIntersectFirstHit,
  getVertexAttribute,
} from './external/three-mesh-bvh/src/webgpu';
import { SurfelMoments, SurfelStruct, type SurfelPool } from './surfelPool';
import {
  snap_to_surfel_grid_origin,
  type SurfelHashGrid,
} from './surfelHashGrid';
import { consts, radiusBasedEpsilon } from './surfelIntegratePass';
import {
  surfelRadialDepthOcclusion,
  U_OCCLUSION_PARAMS,
} from './surfelRadialDepth';
import { createHiZDepthPyramid } from './hiZDepthPyramid';

const TILE_SIZE = 8;
const MAX_RAYS_PER_PROBE = 8;
const MAX_SURFELS_PER_PROBE_HIT = 24;
const MAX_HIZ_STEPS = 64;

export type ScreenProbeSettings = {
  samples: number;
  useHiZ: boolean;
  envIntensity: number;
  envLod: number;
  directStrength: number;
  multiBounceStrength: number;
};

export type ScreenProbePass = {
  run: (
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
    bvh: SceneBVHBundle,
    light: THREE.DirectionalLight,
    settings: ScreenProbeSettings,
  ) => void;
  getOutputTexture: () => THREE.Texture | null;
  getTraceStatsTexture: () => THREE.Texture | null;
  getProbeRadianceTexture: () => THREE.Texture | null;
  getProbeGeometryTexture: () => THREE.Texture | null;
};

const gridHelpers = wgsl(
  /* wgsl */ `
    fn screen_probe_grid_coord(pRel: vec3f) -> vec3i {
      return vec3i(floor(pRel / SURFEL_GRID_CELL_DIAMETER));
    }

    fn screen_probe_cascade_float(coord: vec3i) -> f32 {
      let fcoord = vec3f(coord) + vec3f(0.5);
      let maxC = max(abs(fcoord.x), max(abs(fcoord.y), abs(fcoord.z)));
      return log2(maxC / (f32(SURFEL_CS) * 0.5));
    }

    fn screen_probe_cascade(cf: f32) -> u32 {
      return u32(clamp(ceil(max(0.0, cf)), 0.0, f32(SURFEL_CASCADES - 1)));
    }

    fn screen_probe_coord_in_cascade(coord: vec3i, cascade: u32) -> vec3i {
      return (coord >> vec3u(cascade)) + SURFEL_CS / 2;
    }

    fn screen_probe_c4(coord: vec3i) -> vec4u {
      let cascade = screen_probe_cascade(screen_probe_cascade_float(coord));
      let within = screen_probe_coord_in_cascade(coord, cascade);
      let c = clamp(within, vec3i(0), vec3i(SURFEL_CS - 1));
      return vec4u(vec3u(c), cascade);
    }

    fn screen_probe_hash(c4: vec4u) -> u32 {
      let cs = u32(SURFEL_CS);
      return c4.x + c4.y * cs + c4.z * cs * cs + c4.w * cs * cs * cs;
    }

    fn screen_probe_surfel_radius(pos: vec3f, camPos: vec3f) -> f32 {
      let dist = length(pos - camPos);
      let cascadeRadius = SURFEL_GRID_CELL_DIAMETER * f32(SURFEL_CS) * 0.5;
      return SURFEL_BASE_RADIUS * max(1.0, dist / cascadeRadius);
    }
  `,
  [consts],
);

const sampleDiffuseArray = wgslFn(/* wgsl */ `
  fn screen_probe_sample_diffuse(
    tex: texture_2d_array<f32>,
    texSampler: sampler,
    uvIn: vec2f,
    layerIn: i32
  ) -> vec3f {
    let layers = textureNumLayers(tex);
    let layer = clamp(layerIn, 0, i32(layers) - 1);
    return textureSampleLevel(tex, texSampler, uvIn, layer, 0.0).rgb;
  }
`);

const sampleEnvironment = wgslFn(
  /* wgsl */ `
  fn screen_probe_sample_environment(
    dirIn: vec3f,
    envTexture: texture_2d<f32>,
    envSampler: sampler,
    lod: f32
  ) -> vec3f {
    let d = normalize(dirIn);
    let u = atan2(d.z, d.x) * (0.5 / PI) + 0.5;
    let v = acos(clamp(-d.y, -1.0, 1.0)) / PI;
    let hdr = textureSampleLevel(envTexture, envSampler, vec2f(u, v), lod).rgb;
    let lum = dot(hdr, vec3f(0.2126, 0.7152, 0.0722));
    let knee = 5.0;
    let maxValue = 15.0;
    if (lum <= knee) { return hdr; }
    let compressed = knee + (maxValue - knee) *
      (1.0 - exp(-(lum - knee) / (maxValue - knee)));
    return hdr * (compressed / max(lum, 1e-5));
  }
`,
  [consts],
);

const probeSampling = wgsl(/* wgsl */ `
  fn screen_probe_hash_u32(valueIn: u32) -> u32 {
    var value = valueIn;
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    value *= 0x846ca68bu;
    value ^= value >> 16u;
    return value;
  }

  fn screen_probe_random_2(probeIndex: u32, sampleIndex: u32) -> vec2f {
    let a = screen_probe_hash_u32(probeIndex * 0x9e3779b9u + sampleIndex * 0x85ebca6bu);
    let b = screen_probe_hash_u32(a + 0xc2b2ae35u);
    return vec2f(
      f32(a & 0x00ffffffu) / 16777216.0,
      f32(b & 0x00ffffffu) / 16777216.0
    );
  }

  fn screen_probe_basis(normalIn: vec3f) -> mat3x3f {
    let n = normalize(normalIn);
    let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
    let tangent = normalize(cross(up, n));
    let bitangent = cross(n, tangent);
    return mat3x3f(tangent, bitangent, n);
  }

  fn screen_probe_cosine_direction(
    probeIndex: u32,
    sampleIndex: u32,
    sampleCount: u32,
    basis: mat3x3f
  ) -> vec3f {
    let random = screen_probe_random_2(probeIndex, sampleIndex);
    let stratified = (f32(sampleIndex) + random.x) / max(1.0, f32(sampleCount));
    let radius = sqrt(clamp(stratified, 0.0, 1.0));
    let angle = 2.0 * PI * random.y;
    let local = vec3f(
      radius * cos(angle),
      radius * sin(angle),
      sqrt(max(0.0, 1.0 - stratified))
    );
    return normalize(basis * local);
  }
`);

const screenSpaceHitStruct = wgsl(/* wgsl */ `
  struct ScreenSpaceHit {
    status: u32,
    position: vec3f,
    normal: vec3f,
    albedo: vec3f,
    steps: u32,
  };

  struct ScreenProbeTraceResult {
    radiance: vec3f,
    stats: vec4f,
  };
`);

const hiZTraceHelpers = wgslFn(
  /* wgsl */ `
    fn screen_probe_hiz_level_size(fullSize: vec2i, level: u32) -> vec2i {
      var size = fullSize;
      for (var i = 0u; i < level; i = i + 1u) {
        size = max(vec2i(1), (size + vec2i(1)) / 2);
      }
      return size;
    }

    fn screen_probe_hiz_offset_y(fullSize: vec2i, level: u32) -> i32 {
      let parity = level & 1u;
      var offset = 0;
      var current = parity;
      loop {
        if (current >= level) { break; }
        offset += screen_probe_hiz_level_size(fullSize, current).y;
        current += 2u;
      }
      return offset;
    }

    fn screen_probe_hiz_bounds(
      level: u32,
      coord: vec2i,
      fullSize: vec2i,
      evenAtlas: texture_2d<f32>,
      oddAtlas: texture_2d<f32>
    ) -> vec2f {
      let offsetCoord = coord + vec2i(0, screen_probe_hiz_offset_y(fullSize, level));
      if ((level & 1u) == 0u) {
        return textureLoad(evenAtlas, offsetCoord, 0).xy;
      }
      return textureLoad(oddAtlas, offsetCoord, 0).xy;
    }

    fn screen_probe_reconstruct_world(
      uv: vec2f,
      depth: f32,
      inverseProjection: mat4x4f,
      cameraWorld: mat4x4f
    ) -> vec3f {
      let screen = vec2f(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
      let clip = vec4f(screen, depth, 1.0);
      let viewH = inverseProjection * clip;
      let view = viewH.xyz / viewH.w;
      return (cameraWorld * vec4f(view, 1.0)).xyz;
    }

    fn screen_probe_trace_hiz(
      origin: vec3f,
      direction: vec3f,
      viewProjection: mat4x4f,
      inverseProjection: mat4x4f,
      cameraWorld: mat4x4f,
      fullSize: vec2i,
      levelCount: u32,
      evenAtlas: texture_2d<f32>,
      oddAtlas: texture_2d<f32>,
      sceneDepth: texture_2d<f32>,
      sceneNormal: texture_2d<f32>,
      sceneAlbedo: texture_2d<f32>
    ) -> ScreenSpaceHit {
      var result: ScreenSpaceHit;
      result.status = 2u;
      result.position = vec3f(0.0);
      result.normal = vec3f(0.0, 1.0, 0.0);
      result.albedo = vec3f(0.0);
      result.steps = 0u;

      if (levelCount == 0u) { return result; }
      let maxTraceLevel = min(levelCount - 1u, 5u);
      var level = min(2u, maxTraceLevel);
      var distanceAlongRay = 0.012;

      for (var step = 0u; step < ${MAX_HIZ_STEPS}u; step = step + 1u) {
        result.steps = step + 1u;
        let samplePosition = origin + direction * distanceAlongRay;
        let clip = viewProjection * vec4f(samplePosition, 1.0);
        if (clip.w <= 1e-5) {
          result.status = 2u;
          return result;
        }

        let ndc = clip.xyz / clip.w;
        if (ndc.z >= 1.0 || distanceAlongRay >= 80.0) {
          result.status = 0u;
          return result;
        }
        if (ndc.z <= 0.0) {
          distanceAlongRay += 0.025;
          continue;
        }

        let uv = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
        if (any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) {
          result.status = 2u;
          return result;
        }

        let levelSize = screen_probe_hiz_level_size(fullSize, level);
        let levelCoord = clamp(
          vec2i(floor(uv * vec2f(levelSize))),
          vec2i(0),
          levelSize - vec2i(1)
        );
        let bounds = screen_probe_hiz_bounds(
          level,
          levelCoord,
          fullSize,
          evenAtlas,
          oddAtlas
        );
        let depthTolerance = 0.00035 * exp2(f32(level));

        if (bounds.x < 0.999999 && ndc.z >= bounds.x - depthTolerance) {
          if (level > 0u) {
            level -= 1u;
            continue;
          }

          let fullCoord = clamp(
            vec2i(floor(uv * vec2f(fullSize))),
            vec2i(0),
            fullSize - vec2i(1)
          );
          let surfaceDepth = textureLoad(sceneDepth, fullCoord, 0).r;
          if (surfaceDepth <= 0.0 || surfaceDepth >= 0.999999) {
            distanceAlongRay += 0.035;
            level = min(2u, maxTraceLevel);
            continue;
          }

          let surfacePosition = screen_probe_reconstruct_world(
            uv,
            surfaceDepth,
            inverseProjection,
            cameraWorld
          );
          let delta = surfacePosition - origin;
          let projectedDistance = dot(delta, direction);
          if (projectedDistance <= 0.012) {
            distanceAlongRay += 0.035;
            level = min(2u, maxTraceLevel);
            continue;
          }

          let perpendicular = length(delta - direction * projectedDistance);
          let worldTolerance = max(0.025, projectedDistance * 0.006);
          let surfaceNormal = normalize(
            textureLoad(sceneNormal, fullCoord, 0).xyz * 2.0 - 1.0
          );
          let facing = dot(surfaceNormal, -direction);
          if (perpendicular <= worldTolerance && facing > 0.02) {
            result.status = 1u;
            result.position = surfacePosition;
            result.normal = surfaceNormal;
            result.albedo = clamp(
              textureLoad(sceneAlbedo, fullCoord, 0).rgb,
              vec3f(0.0),
              vec3f(1.0)
            );
            return result;
          }

          result.status = 2u;
          return result;
        }

        let levelScale = exp2(f32(level));
        let stepLength = clamp(
          max(0.0125, distanceAlongRay * 0.01) * levelScale,
          0.025,
          0.5
        );
        distanceAlongRay += stepLength;
        level = min(level + 1u, maxTraceLevel);
      }

      result.status = 2u;
      return result;
    }
  `,
  [screenSpaceHitStruct] as unknown as NonNullable<
    Parameters<typeof wgslFn>[1]
  >,
);

const lookupSurfelRadiance = wgslFn(
  /* wgsl */ `
    fn screen_probe_lookup_surfel_radiance(
      hitPosition: vec3f,
      hitNormal: vec3f,
      cameraPosition: vec3f,
      gridOrigin: vec3f,
      momentsOffset: u32,
      occlusionParams: vec4f
    ) -> vec3f {
      let relative = hitPosition - gridOrigin;
      let coord = screen_probe_grid_coord(relative);
      let cell = i32(screen_probe_hash(screen_probe_c4(coord)) % TOTAL_CELLS);
      let start = offsetsAndList.value[cell];
      let end = offsetsAndList.value[cell + 1];
      let count = min(max(end - start, 0), ${MAX_SURFELS_PER_PROBE_HIT});
      if (count <= 0) { return vec3f(0.0); }

      var sumRadiance = vec3f(0.0);
      var sumWeight = 0.0;

      for (var i = 0; i < count; i = i + 1) {
        let sid = offsetsAndList.value[OFFSETS_AND_LIST_START + start + i];
        if (sid < 0) { continue; }

        let surfel = surfels.value[u32(sid)];
        let surfelPosition = surfel.posb.xyz;
        let surfelNormal = normalize(surfel.normal);
        let radius = screen_probe_surfel_radius(surfelPosition, cameraPosition) *
          SURFEL_RADIUS_OVERSCALE;
        let epsilon = radius_based_epsilon(radius);
        let offsetPosition = surfelPosition + surfelNormal * epsilon;
        let delta = hitPosition - offsetPosition;
        let distance = length(delta);
        if (distance <= 1e-5) { continue; }

        let direction = delta / distance;
        let normalDistance = abs(dot(delta, surfelNormal));
        let mahalanobis = distance *
          (1.0 + normalDistance * SURFEL_NORMAL_DIRECTION_SQUISH);
        let directional = max(0.0, dot(surfelNormal, hitNormal));
        var weight = smoothstep(radius, 0.0, mahalanobis) * directional;
        if (weight <= 0.0) { continue; }

        if (weight > 0.02) {
          let visibility = surfel_radial_occlusion(
            u32(sid),
            direction,
            surfelNormal,
            distance,
            hitNormal,
            radius,
            delta,
            occlusionParams
          );
          weight *= visibility;
        }
        if (weight <= 0.0) { continue; }

        let irradiance = moments.value[u32(sid) + momentsOffset].irradiance.xyz;
        sumRadiance += irradiance * weight;
        sumWeight += weight;
      }

      if (sumWeight <= 1e-5) { return vec3f(0.0); }
      return sumRadiance / sumWeight;
    }
  `,
  [
    consts,
    gridHelpers,
    radiusBasedEpsilon,
    surfelRadialDepthOcclusion,
  ] as unknown as NonNullable<Parameters<typeof wgslFn>[1]>,
);

const evaluateScreenProbeHit = wgslFn(
  /* wgsl */ `
    fn screen_probe_evaluate_hit(
      hitPosition: vec3f,
      hitNormal: vec3f,
      hitAlbedo: vec3f,
      lightDirection: vec3f,
      lightColor: vec3f,
      cameraPosition: vec3f,
      gridOrigin: vec3f,
      momentsOffset: u32,
      occlusionParams: vec4f,
      directStrength: f32,
      multiBounceStrength: f32
    ) -> vec3f {
      let epsilon = 0.002;
      var radiance = vec3f(0.0);
      var shadowRay: Ray;
      shadowRay.origin = hitPosition + hitNormal * epsilon;
      shadowRay.direction = lightDirection;
      let shadowHit = bvhIntersectFirstHit(shadowRay);
      if (!shadowHit.didHit) {
        let nDotL = max(0.0, dot(hitNormal, lightDirection));
        radiance += lightColor * hitAlbedo * nDotL *
          (1.0 / PI) * directStrength;
      }

      let cachedRadiance = screen_probe_lookup_surfel_radiance(
        hitPosition,
        hitNormal,
        cameraPosition,
        gridOrigin,
        momentsOffset,
        occlusionParams
      );
      radiance += cachedRadiance * hitAlbedo * multiBounceStrength;
      return radiance;
    }
  `,
  [
    consts,
    bvhIntersectFirstHit,
    lookupSurfelRadiance,
  ] as unknown as NonNullable<Parameters<typeof wgslFn>[1]>,
);

const traceScreenProbe = wgslFn(
  /* wgsl */ `
    fn trace_screen_probe(
      receiverPosition: vec3f,
      receiverNormal: vec3f,
      probeIndex: u32,
      sampleCountIn: u32,
      useHiZ: u32,
      viewProjection: mat4x4f,
      inverseProjection: mat4x4f,
      cameraWorld: mat4x4f,
      fullSize: vec2i,
      hiZLevelCount: u32,
      hiZEven: texture_2d<f32>,
      hiZOdd: texture_2d<f32>,
      sceneDepth: texture_2d<f32>,
      sceneNormal: texture_2d<f32>,
      sceneAlbedo: texture_2d<f32>,
      lightDirection: vec3f,
      lightColor: vec3f,
      cameraPosition: vec3f,
      gridOrigin: vec3f,
      momentsOffset: u32,
      occlusionParams: vec4f,
      directStrength: f32,
      multiBounceStrength: f32,
      envTexture: texture_2d<f32>,
      envSampler: sampler,
      envIntensity: f32,
      envLod: f32,
      diffuseTexture: texture_2d_array<f32>,
      diffuseSampler: sampler
    ) -> ScreenProbeTraceResult {
      let sampleCount = clamp(sampleCountIn, 1u, ${MAX_RAYS_PER_PROBE}u);
      let basis = screen_probe_basis(receiverNormal);
      let receiverEpsilon = 0.002;
      var accumulated = vec3f(0.0);
      var hiZResolved = 0.0;
      var bvhFallback = 0.0;
      var environmentMiss = 0.0;
      var hiZStepFraction = 0.0;

      for (var sampleIndex = 0u; sampleIndex < sampleCount; sampleIndex = sampleIndex + 1u) {
        let rayDirection = screen_probe_cosine_direction(
          probeIndex,
          sampleIndex,
          sampleCount,
          basis
        );
        let rayOrigin = receiverPosition + receiverNormal * receiverEpsilon;
        var incoming = vec3f(0.0);
        var resolved = false;

        if (useHiZ != 0u) {
          let screenHit = screen_probe_trace_hiz(
            rayOrigin,
            rayDirection,
            viewProjection,
            inverseProjection,
            cameraWorld,
            fullSize,
            hiZLevelCount,
            hiZEven,
            hiZOdd,
            sceneDepth,
            sceneNormal,
            sceneAlbedo
          );
          hiZStepFraction += f32(screenHit.steps) / f32(${MAX_HIZ_STEPS});

          if (screenHit.status == 1u) {
            incoming = screen_probe_evaluate_hit(
              screenHit.position,
              screenHit.normal,
              screenHit.albedo,
              lightDirection,
              lightColor,
              cameraPosition,
              gridOrigin,
              momentsOffset,
              occlusionParams,
              directStrength,
              multiBounceStrength
            );
            hiZResolved += 1.0;
            resolved = true;
          } else if (screenHit.status == 0u) {
            incoming = screen_probe_sample_environment(
              rayDirection,
              envTexture,
              envSampler,
              envLod
            ) * envIntensity;
            environmentMiss += 1.0;
            resolved = true;
          }
        }

        if (!resolved) {
          bvhFallback += 1.0;
          var ray: Ray;
          ray.origin = rayOrigin;
          ray.direction = rayDirection;
          let hit = bvhIntersectFirstHit(ray);

          if (hit.didHit) {
            let hitPosition = ray.origin + ray.direction * hit.dist;
            let hitNormal = normalize(hit.normal);
            let uvAndMaterial = getVertexAttribute(hit.barycoord, hit.indices.xyz);
            let hitAlbedo = clamp(
              screen_probe_sample_diffuse(
                diffuseTexture,
                diffuseSampler,
                uvAndMaterial.xy,
                i32(round(uvAndMaterial.z))
              ),
              vec3f(0.0),
              vec3f(1.0)
            );
            incoming = screen_probe_evaluate_hit(
              hitPosition,
              hitNormal,
              hitAlbedo,
              lightDirection,
              lightColor,
              cameraPosition,
              gridOrigin,
              momentsOffset,
              occlusionParams,
              directStrength,
              multiBounceStrength
            );
          } else {
            incoming = screen_probe_sample_environment(
              rayDirection,
              envTexture,
              envSampler,
              envLod
            ) * envIntensity;
            environmentMiss += 1.0;
          }
        }

        accumulated += incoming;
      }

      let inverseCount = 1.0 / max(1.0, f32(sampleCount));
      var result: ScreenProbeTraceResult;
      result.radiance = accumulated * inverseCount;
      result.stats = vec4f(
        hiZResolved * inverseCount,
        bvhFallback * inverseCount,
        environmentMiss * inverseCount,
        hiZStepFraction * inverseCount
      );
      return result;
    }
  `,
  [
    consts,
    screenSpaceHitStruct,
    hiZTraceHelpers,
    bvhIntersectFirstHit,
    getVertexAttribute,
    probeSampling,
    sampleDiffuseArray,
    sampleEnvironment,
    evaluateScreenProbeHit,
  ] as unknown as NonNullable<Parameters<typeof wgslFn>[1]>,
);

const reconstructScreenProbes = wgslFn(/* wgsl */ `
  fn reconstruct_screen_probes(
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

    for (var offsetY = -1; offsetY <= 1; offsetY = offsetY + 1) {
      for (var offsetX = -1; offsetX <= 1; offsetX = offsetX + 1) {
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

export function createScreenProbePass(
  grid: SurfelHashGrid,
  pool: SurfelPool,
  environment: THREE.Texture,
): ScreenProbePass {
  const hiZPyramid = createHiZDepthPyramid();
  let probeRadianceTexture: THREE.StorageTexture | null = null;
  let probeGeometryTexture: THREE.StorageTexture | null = null;
  let probeStatsTexture: THREE.StorageTexture | null = null;
  let outputTexture: THREE.StorageTexture | null = null;
  let traceNode: THREE.ComputeNode | null = null;
  let reconstructNode: THREE.ComputeNode | null = null;
  let textureWidth = 0;
  let textureHeight = 0;
  let probeWidth = 0;
  let probeHeight = 0;

  const U_PROJECTION_INVERSE = uniform(new THREE.Matrix4());
  const U_CAMERA_WORLD = uniform(new THREE.Matrix4());
  const U_VIEW_PROJECTION = uniform(new THREE.Matrix4());
  const U_CAMERA_POSITION = uniform(new THREE.Vector3());
  const U_GRID_ORIGIN = uniform(new THREE.Vector3());
  const U_MOMENTS_OFFSET = uniform(0);
  const U_LIGHT_DIRECTION = uniform(new THREE.Vector3(0, 1, 0));
  const U_LIGHT_COLOR = uniform(new THREE.Color(1, 1, 1));
  const U_SAMPLE_COUNT = uniform(4);
  const U_USE_HIZ = uniform(1);
  const U_HIZ_LEVEL_COUNT = uniform(1);
  const U_ENV_INTENSITY = uniform(1.0);
  const U_ENV_LOD = uniform(4.0);
  const U_DIRECT_STRENGTH = uniform(1.0);
  const U_MULTI_BOUNCE_STRENGTH = uniform(1.0);

  function makeStorageTexture(width: number, height: number, name: string) {
    const result = new THREE.StorageTexture(width, height);
    result.type = THREE.HalfFloatType;
    result.format = THREE.RGBAFormat;
    result.minFilter = THREE.NearestFilter;
    result.magFilter = THREE.NearestFilter;
    result.generateMipmaps = false;
    result.name = name;
    return result;
  }

  function ensureTextures(width: number, height: number) {
    const nextProbeWidth = Math.max(1, Math.ceil(width / TILE_SIZE));
    const nextProbeHeight = Math.max(1, Math.ceil(height / TILE_SIZE));
    if (
      outputTexture &&
      width === textureWidth &&
      height === textureHeight &&
      nextProbeWidth === probeWidth &&
      nextProbeHeight === probeHeight
    ) {
      return;
    }

    textureWidth = width;
    textureHeight = height;
    probeWidth = nextProbeWidth;
    probeHeight = nextProbeHeight;
    probeRadianceTexture?.dispose();
    probeGeometryTexture?.dispose();
    probeStatsTexture?.dispose();
    outputTexture?.dispose();
    probeRadianceTexture = makeStorageTexture(
      probeWidth,
      probeHeight,
      'Screen Probe Radiance',
    );
    probeGeometryTexture = makeStorageTexture(
      probeWidth,
      probeHeight,
      'Screen Probe Geometry',
    );
    probeStatsTexture = makeStorageTexture(
      probeWidth,
      probeHeight,
      'Screen Probe Trace Stats',
    );
    outputTexture = makeStorageTexture(width, height, 'Screen Probe Resolve');
    traceNode = null;
    reconstructNode = null;
  }

  function run(
    renderer: THREE.WebGPURenderer,
    camera: THREE.PerspectiveCamera,
    gbuffer: GBufferBundle,
    bvh: SceneBVHBundle,
    light: THREE.DirectionalLight,
    settings: ScreenProbeSettings,
  ) {
    const width = gbuffer.target.width;
    const height = gbuffer.target.height;
    ensureTextures(width, height);
    if (
      !probeRadianceTexture ||
      !probeGeometryTexture ||
      !probeStatsTexture ||
      !outputTexture
    )
      return;

    const depthTexture = gbuffer.target.depthTexture;
    const normalTexture = gbuffer.target.textures[0];
    const albedoTexture = gbuffer.target.textures[1];
    const surfelAttribute = pool.getSurfelAttr();
    const momentsAttribute = pool.getMomentsAttr();
    const offsetsAndListAttribute = grid.getOffsetsAndListAttr();
    const surfelDepthAttribute = pool.getSurfelDepthAttr();
    if (
      !depthTexture ||
      !normalTexture ||
      !surfelAttribute ||
      !momentsAttribute ||
      !offsetsAndListAttribute ||
      !surfelDepthAttribute
    ) {
      return;
    }

    if (
      settings.useHiZ ||
      !hiZPyramid.getEvenTexture() ||
      !hiZPyramid.getOddTexture()
    ) {
      hiZPyramid.run(renderer, depthTexture, width, height);
    }
    const hiZEvenTexture = hiZPyramid.getEvenTexture();
    const hiZOddTexture = hiZPyramid.getOddTexture();
    if (!hiZEvenTexture || !hiZOddTexture) return;

    U_PROJECTION_INVERSE.value.copy(camera.projectionMatrixInverse);
    U_CAMERA_WORLD.value.copy(camera.matrixWorld);
    U_VIEW_PROJECTION.value.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    U_CAMERA_POSITION.value.copy(camera.position);
    snap_to_surfel_grid_origin(U_GRID_ORIGIN.value, camera.position);
    U_MOMENTS_OFFSET.value = pool.getOffsets().writeOffset;
    U_LIGHT_DIRECTION.value
      .subVectors(light.position, light.target.position)
      .normalize();
    U_LIGHT_COLOR.value.copy(light.color).multiplyScalar(light.intensity);
    U_SAMPLE_COUNT.value = THREE.MathUtils.clamp(
      Math.floor(settings.samples),
      1,
      MAX_RAYS_PER_PROBE,
    );
    U_USE_HIZ.value = settings.useHiZ ? 1 : 0;
    U_HIZ_LEVEL_COUNT.value = hiZPyramid.getLevelCount();
    U_ENV_INTENSITY.value = Math.max(0, settings.envIntensity);
    U_ENV_LOD.value = Math.max(0, settings.envLod);
    U_DIRECT_STRENGTH.value = Math.max(0, settings.directStrength);
    U_MULTI_BOUNCE_STRENGTH.value = Math.max(0, settings.multiBounceStrength);

    if (!traceNode) {
      const capacity = surfelAttribute.count;
      const surfels = storage(surfelAttribute, SurfelStruct, capacity)
        .setAccess('readOnly')
        .setName('surfels');
      const moments = storage(momentsAttribute, SurfelMoments, capacity * 2)
        .setAccess('readOnly')
        .setName('moments');
      const offsetsAndList = storage(
        offsetsAndListAttribute,
        'int',
        offsetsAndListAttribute.count,
      )
        .setAccess('readOnly')
        .setName('offsetsAndList');
      const surfelDepth = storage(
        surfelDepthAttribute,
        'vec4',
        surfelDepthAttribute.count,
      )
        .setAccess('readOnly')
        .setName('surfelDepth');

      // This thin runtime wrapper attaches the concrete scene/cache buffers to
      // the otherwise reusable WGSL probe tracer.
      const traceScreenProbeBound = wgslFn(
        /* wgsl */ `
          fn trace_screen_probe_bound(
            receiverPosition: vec3f,
            receiverNormal: vec3f,
            probeIndex: u32,
            sampleCountIn: u32,
            useHiZ: u32,
            viewProjection: mat4x4f,
            inverseProjection: mat4x4f,
            cameraWorld: mat4x4f,
            fullSize: vec2i,
            hiZLevelCount: u32,
            hiZEven: texture_2d<f32>,
            hiZOdd: texture_2d<f32>,
            sceneDepth: texture_2d<f32>,
            sceneNormal: texture_2d<f32>,
            sceneAlbedo: texture_2d<f32>,
            lightDirection: vec3f,
            lightColor: vec3f,
            cameraPosition: vec3f,
            gridOrigin: vec3f,
            momentsOffset: u32,
            occlusionParams: vec4f,
            directStrength: f32,
            multiBounceStrength: f32,
            envTexture: texture_2d<f32>,
            envSampler: sampler,
            envIntensity: f32,
            envLod: f32,
            diffuseTexture: texture_2d_array<f32>,
            diffuseSampler: sampler
          ) -> ScreenProbeTraceResult {
            return trace_screen_probe(
              receiverPosition,
              receiverNormal,
              probeIndex,
              sampleCountIn,
              useHiZ,
              viewProjection,
              inverseProjection,
              cameraWorld,
              fullSize,
              hiZLevelCount,
              hiZEven,
              hiZOdd,
              sceneDepth,
              sceneNormal,
              sceneAlbedo,
              lightDirection,
              lightColor,
              cameraPosition,
              gridOrigin,
              momentsOffset,
              occlusionParams,
              directStrength,
              multiBounceStrength,
              envTexture,
              envSampler,
              envIntensity,
              envLod,
              diffuseTexture,
              diffuseSampler
            );
          }
        `,
        [
          traceScreenProbe,
          bvh.bvhNode,
          bvh.positionNode,
          bvh.indexNode,
          bvh.colorNode,
          surfels,
          moments,
          offsetsAndList,
          surfelDepth,
        ] as unknown as NonNullable<Parameters<typeof wgslFn>[1]>,
      );

      traceNode = Fn(() => {
        const probeIndex = int(instanceIndex);
        const x = probeIndex.mod(int(probeWidth));
        const y = probeIndex.div(int(probeWidth));
        const pixelX = int(x.mul(TILE_SIZE).add(Math.floor(TILE_SIZE / 2))).min(
          int(width - 1),
        );
        const pixelY = int(y.mul(TILE_SIZE).add(Math.floor(TILE_SIZE / 2))).min(
          int(height - 1),
        );
        const uv = vec2(
          pixelX.toFloat().add(0.5).div(float(width)),
          pixelY.toFloat().add(0.5).div(float(height)),
        );
        const depth = texture(depthTexture, uv).r;
        const valid = depth.lessThan(0.999999).and(depth.greaterThan(0.0));
        const radianceOut = vec4(0).toVar();
        const geometryOut = vec4(0).toVar();
        const statsOut = vec4(0).toVar();

        If(valid, () => {
          const normal = texture(normalTexture, uv)
            .xyz.mul(2.0)
            .sub(1.0)
            .normalize();
          const viewPosition = getViewPosition(uv, depth, U_PROJECTION_INVERSE);
          const worldPosition = U_CAMERA_WORLD.mul(vec4(viewPosition, 1.0)).xyz;
          const traced = traceScreenProbeBound({
            receiverPosition: worldPosition,
            receiverNormal: normal,
            probeIndex: probeIndex.toUint(),
            sampleCountIn: U_SAMPLE_COUNT.toUint(),
            useHiZ: U_USE_HIZ.toUint(),
            viewProjection: U_VIEW_PROJECTION,
            inverseProjection: U_PROJECTION_INVERSE,
            cameraWorld: U_CAMERA_WORLD,
            fullSize: ivec2(width, height),
            hiZLevelCount: U_HIZ_LEVEL_COUNT.toUint(),
            hiZEven: texture(hiZEvenTexture),
            hiZOdd: texture(hiZOddTexture),
            sceneDepth: texture(depthTexture),
            sceneNormal: texture(normalTexture),
            sceneAlbedo: texture(albedoTexture),
            lightDirection: U_LIGHT_DIRECTION,
            lightColor: U_LIGHT_COLOR,
            cameraPosition: U_CAMERA_POSITION,
            gridOrigin: U_GRID_ORIGIN,
            momentsOffset: U_MOMENTS_OFFSET.toUint(),
            occlusionParams: U_OCCLUSION_PARAMS,
            directStrength: U_DIRECT_STRENGTH,
            multiBounceStrength: U_MULTI_BOUNCE_STRENGTH,
            envTexture: texture(environment),
            envSampler: sampler(environment),
            envIntensity: U_ENV_INTENSITY,
            envLod: U_ENV_LOD,
            diffuseTexture: texture(bvh.diffuseArrayTex),
            diffuseSampler: sampler(bvh.diffuseArrayTex),
          });
          radianceOut.assign(vec4(traced.get('radiance'), 1.0));
          geometryOut.assign(vec4(normal, depth));
          statsOut.assign(traced.get('stats'));
        });

        textureStore(probeRadianceTexture!, ivec2(x, y), radianceOut);
        textureStore(probeGeometryTexture!, ivec2(x, y), geometryOut);
        textureStore(probeStatsTexture!, ivec2(x, y), statsOut);
      })()
        .compute(probeWidth * probeHeight)
        .setName('Screen Probe Trace');
    }

    if (!reconstructNode) {
      reconstructNode = Fn(() => {
        const pixelIndex = int(instanceIndex);
        const x = pixelIndex.mod(int(width));
        const y = pixelIndex.div(int(width));
        const uv = vec2(
          x.toFloat().add(0.5).div(float(width)),
          y.toFloat().add(0.5).div(float(height)),
        );
        const depth = texture(depthTexture, uv).r;
        const valid = depth.lessThan(0.999999).and(depth.greaterThan(0.0));
        const resolved = vec4(0).toVar();

        If(valid, () => {
          const normal = texture(normalTexture, uv)
            .xyz.mul(2.0)
            .sub(1.0)
            .normalize();
          resolved.assign(
            reconstructScreenProbes({
              pixelCoord: ivec2(x, y),
              pixelUv: uv,
              pixelDepth: depth,
              pixelNormal: normal,
              fullSize: ivec2(width, height),
              probeSize: ivec2(probeWidth, probeHeight),
              inverseProjection: U_PROJECTION_INVERSE,
              probeRadiance: texture(probeRadianceTexture!),
              probeGeometry: texture(probeGeometryTexture!),
            }),
          );
        });

        textureStore(outputTexture!, ivec2(x, y), resolved);
      })()
        .compute(width * height)
        .setName('Screen Probe Reconstruct');
    }

    renderer.compute(traceNode);
    renderer.compute(reconstructNode);
  }

  return {
    run,
    getOutputTexture: () => outputTexture,
    getTraceStatsTexture: () => probeStatsTexture,
    getProbeRadianceTexture: () => probeRadianceTexture,
    getProbeGeometryTexture: () => probeGeometryTexture,
  };
}
