// Webgiya host with screen-probe GI and a camera-space GTAO visibility raster.
// The pinned upstream main.ts and surfel algorithms remain byte-identical.
import './style.css';
import { initRenderer } from './renderer.ts';
import { createScene } from './scene.ts';
import { configureSceneSelector, createSceneSwitcher, createUI } from './ui.ts';
import {
  SCENE_PRESETS,
  captureDirectionalLightDefaults,
  clearSceneContent,
  recreateDirectionalLight,
  type SceneDefinition,
  type SceneSettings,
} from './content.ts';
import { createMotionGBuffer } from './motionGBuffer.ts';
import { createMotionHistoryPass } from './motionHistoryPass.ts';
import { createSurfelPool } from './surfelPool.ts';
import { createSurfelPreparePass } from './surfelPreparePass.ts';
import { createSurfelAgePass } from './surfelAgePass.ts';
import { createSurfelFindMissingPass } from './surfelFindMissingPass.ts';
import { createSurfelAllocatePass } from './surfelAllocatePass.ts';
import { createSurfelDispatchArgs } from './surfelDispatchArgs.ts';
import { createSurfelHashGrid } from './surfelHashGrid.ts';
import {
  createSurfelScreenDebug,
  SCREEN_DEBUG_MODES,
} from './debug/surfelScreenDebug.ts';
import { MAX_SURFELS } from './constants.ts';

import { createSceneBVH, type SceneBVHBundle } from './sceneBvh.ts';
import { createSurfelIntegratePass } from './surfelIntegratePass.ts';
import { createSurfelGIResolvePass } from './surfelGIResolvePass.ts';
import { createScreenProbePass } from './screenProbePass.ts';
import * as THREE from 'three/webgpu';
import {
  float,
  fract,
  mrt,
  normalView,
  output,
  pass,
  screenUV,
  texture,
  vec4,
} from 'three/tsl';
import {
  createLightControls,
  findSunPositionWeighted,
  setLightAnglesFromEnvMapSunUVLocation,
} from './lighting.ts';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { createIntegratorDispatchArgs } from './integratorDispatchArgs.ts';
import {
  applyOcclusionSettings,
  configureRadialDepthGUI,
  DEFAULT_OCCLUSION_SETTINGS,
} from './surfelRadialDepth.ts';
import { EXRLoader, HDRLoader } from 'three/examples/jsm/Addons.js';
import { updateTemporalSurfaceVersions } from './shaderBallScene.ts';

const loadingOverlay =
  document.querySelector<HTMLDivElement>('#loading-overlay');
const loadingMessage =
  document.querySelector<HTMLDivElement>('#loading-message');
const errorOverlay = document.querySelector<HTMLDivElement>('#error-overlay');
const errorMessage = document.querySelector<HTMLDivElement>('#error-message');

const WEBGPU_ERROR_MESSAGE =
  "WebGPU isn't supported in this browser. If you know WebGPU should work, it's also possible your browser needs a restart, as it's grown tired of all this computing.";

let hasFatalError = false;

function setOverlayVisible(element: HTMLDivElement | null, visible: boolean) {
  if (!element) return;
  element.hidden = !visible;
  element.classList.toggle('hidden', !visible);
}

function setLoading(message?: string) {
  if (loadingMessage && message) {
    loadingMessage.textContent = message;
  }
  setOverlayVisible(loadingOverlay, true);
}

function clearLoading() {
  setOverlayVisible(loadingOverlay, false);
}

function isWebGpuError(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes('webgpu') ||
    text.includes('webgpurenderer') ||
    text.includes('webglbackend') ||
    text.includes('webglextensions') ||
    text.includes('getsupportedextensions') ||
    text.includes('context provider')
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function showError(error: unknown) {
  if (hasFatalError) return;
  hasFatalError = true;
  const message = describeError(error);
  const friendly = isWebGpuError(message)
    ? WEBGPU_ERROR_MESSAGE
    : message || 'Unknown error';
  if (errorMessage) {
    errorMessage.textContent = friendly;
  }
  setOverlayVisible(errorOverlay, true);
  clearLoading();
}

setLoading('Initializing renderer');

window.addEventListener('error', (event) => {
  showError(event.error ?? event.message ?? event);
});

window.addEventListener('unhandledrejection', (event) => {
  showError(event.reason ?? event);
});

const { renderer } = await initRenderer().catch((error) => {
  showError(error);
  throw error;
});
const gui = createUI(renderer);
const sceneBundle = createScene(renderer);
const { scene, camera, controls } = sceneBundle;
let dirLight = sceneBundle.dirLight;
const dirLightDefaults = captureDirectionalLightDefaults(dirLight);
const defaultCameraSettings: NonNullable<SceneSettings['camera']> = {
  position: camera.position.clone(),
  target: controls.target.clone(),
};

// Load blue noise texture
const loader = new THREE.TextureLoader();
const blueNoise = await loader.loadAsync(
  `${import.meta.env.BASE_URL}textures/LDR_RGBA_0.png`,
);
blueNoise.colorSpace = THREE.NoColorSpace; // The default, but still...
blueNoise.wrapS = blueNoise.wrapT = THREE.RepeatWrapping;
blueNoise.minFilter = THREE.NearestFilter;
blueNoise.magFilter = THREE.NearestFilter;
blueNoise.generateMipmaps = false;

// EXR
// const pmremGenerator = new THREE.PMREMGenerator( renderer );
// pmremGenerator.compileEquirectangularShader();

const exrLoader = new EXRLoader();
exrLoader.setDataType(THREE.FloatType);
const hdrLoader = new HDRLoader();

const envCache = new Map<string, THREE.DataTexture>();

async function loadEnvTexture(path: string): Promise<THREE.DataTexture> {
  const cached = envCache.get(path);
  if (cached) return cached;

  const ext = path.split('.').pop()?.toLowerCase();
  const loader = ext === 'hdr' ? hdrLoader : exrLoader;
  const tex = (await loader.loadAsync(path)) as THREE.DataTexture;
  tex.generateMipmaps = true;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  envCache.set(path, tex);
  return tex;
}

let envTex: THREE.DataTexture | null = null;

// Viewport camera can show debug
camera.layers.enable(1);

const gbuffer = createMotionGBuffer(renderer);
const motionHistory = createMotionHistoryPass();

const surfelPool = createSurfelPool();
surfelPool.ensureCapacity(MAX_SURFELS);
const surfelPrepare = createSurfelPreparePass();
const surfelAge = createSurfelAgePass();
const surfelFindMissing = createSurfelFindMissingPass();
const surfelAllocate = createSurfelAllocatePass();
const surfelDispatchArgs = createSurfelDispatchArgs();
const uniformGrid = createSurfelHashGrid();
const screenDebug = createSurfelScreenDebug(uniformGrid, surfelPool);

// Create BVH & Pass
const integratorDispatchArgs = createIntegratorDispatchArgs();
let surfelIntegrate: ReturnType<typeof createSurfelIntegratePass> | null = null;
let screenProbePass: ReturnType<typeof createScreenProbePass> | null = null;

screenDebug.setDebugMode(screenDebug.debugParams.mode);
screenDebug.configureGUI(gui);

const { updateAnimation, updateLightFromAngles, lightCfg, setLight } =
  createLightControls(gui, dirLight);
const defaultLightSettings = { ...lightCfg };

const GI_MODES = {
  Direct: 'direct',
  Indirect: 'indirect',
  Combined: 'combined',
} as const;
type GiMode = Exclude<NonNullable<SceneSettings['gi']>['mode'], undefined>;
const defaultGiParams: { mode: GiMode; indirectIntensity: number } = {
  mode: GI_MODES.Combined,
  indirectIntensity: 1.0,
};
const giParams = { ...defaultGiParams };

const giFolder = gui.addFolder('GI');
let mustRebuildCompositeMaterial = true;
const giModeController = giFolder
  .add(giParams, 'mode', GI_MODES)
  .name('Output')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  });
const giIndirectController = giFolder
  .add(giParams, 'indirectIntensity', 0, 10, 0.1)
  .name('Indirect Intensity')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  });
giModeController.listen?.();
giIndirectController.listen?.();

const VISIBILITY_OUTPUTS = {
  Lighting: 'lighting',
  'Visibility raster': 'visibility',
} as const;
type VisibilityOutput =
  (typeof VISIBILITY_OUTPUTS)[keyof typeof VISIBILITY_OUTPUTS];
const visibilityParams: {
  enabled: boolean;
  output: VisibilityOutput;
  strength: number;
  radius: number;
  samples: number;
} = {
  enabled: true,
  output: VISIBILITY_OUTPUTS.Lighting,
  strength: 0.72,
  radius: 0.65,
  samples: 12,
};
let visibilityPass: ReturnType<typeof ao> | null = null;
const visibilityFolder = gui.addFolder('Visibility raster / AO');
visibilityFolder
  .add(visibilityParams, 'enabled')
  .name('Ambient Occlusion')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
visibilityFolder
  .add(visibilityParams, 'output', VISIBILITY_OUTPUTS)
  .name('Output')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
visibilityFolder
  .add(visibilityParams, 'strength', 0, 1, 0.01)
  .name('AO Strength')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
visibilityFolder
  .add(visibilityParams, 'radius', 0.05, 2.0, 0.05)
  .name('AO Radius')
  .onChange(() => {
    if (visibilityPass) visibilityPass.radius.value = visibilityParams.radius;
  })
  .listen?.();
visibilityFolder
  .add(visibilityParams, 'samples', 4, 24, 1)
  .name('AO Samples')
  .onChange(() => {
    if (visibilityPass) visibilityPass.samples.value = visibilityParams.samples;
  })
  .listen?.();

const TEMPORAL_OUTPUTS = {
  Lighting: 'lighting',
  'Motion vectors': 'motion-vectors',
  'Surface IDs': 'surface-ids',
  'Reprojected coordinates': 'reprojected-coordinates',
  Disocclusion: 'disocclusion',
  'History confidence': 'history-confidence',
} as const;
type TemporalOutput = (typeof TEMPORAL_OUTPUTS)[keyof typeof TEMPORAL_OUTPUTS];
const temporalParams: { output: TemporalOutput } = {
  output: TEMPORAL_OUTPUTS.Lighting,
};
const temporalFolder = gui.addFolder('Motion / history validation');
temporalFolder
  .add(temporalParams, 'output', TEMPORAL_OUTPUTS)
  .name('Output')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
temporalFolder
  .add({ reset: () => motionHistory.reset() }, 'reset')
  .name('Reset history');

const defaultIntegratorParams = { baseSampleCount: 4 };
const integratorParams = { ...defaultIntegratorParams };
const integratorFolder = gui.addFolder('Integrator');
const baseSampleController = integratorFolder
  .add(integratorParams, 'baseSampleCount', 1, 64, 1)
  .name('Base Samples')
  .onChange(() => {
    surfelIntegrate?.setBaseSampleCount(integratorParams.baseSampleCount);
  });
baseSampleController.listen?.();
const defaultGiTransportParams = {
  envIntensity: 1.0,
  envLod: 4.0,
  giFromDirect: 1.0,
  giFromIndirect: 1.0,
  albedoBoost: 1.0,
};
const giTransportParams = { ...defaultGiTransportParams };
const multiBounceParams = { enabled: true };
const effectiveMultiBounceStrength = () =>
  multiBounceParams.enabled ? giTransportParams.giFromIndirect : 0;

const SCREEN_PROBE_OUTPUTS = {
  Lighting: 'lighting',
  'Screen probe GI': 'radiance',
  'Probe confidence': 'confidence',
  'Trace source': 'trace-source',
  'Hi-Z steps': 'hiz-steps',
} as const;
type ScreenProbeOutput =
  (typeof SCREEN_PROBE_OUTPUTS)[keyof typeof SCREEN_PROBE_OUTPUTS];
const screenProbeParams: {
  enabled: boolean;
  useHiZ: boolean;
  output: ScreenProbeOutput;
  blendStrength: number;
  samples: number;
} = {
  enabled: true,
  useHiZ: true,
  output: SCREEN_PROBE_OUTPUTS.Lighting,
  blendStrength: 0.8,
  samples: 4,
};
const screenProbeFolder = gui.addFolder('Screen probes');
screenProbeFolder
  .add(screenProbeParams, 'enabled')
  .name('Screen-probe GI')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
screenProbeFolder
  .add(screenProbeParams, 'useHiZ')
  .name('Hi-Z first')
  .listen?.();
screenProbeFolder
  .add(screenProbeParams, 'output', SCREEN_PROBE_OUTPUTS)
  .name('Output')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
screenProbeFolder
  .add(screenProbeParams, 'blendStrength', 0, 1, 0.01)
  .name('Probe confidence blend')
  .onChange(() => {
    mustRebuildCompositeMaterial = true;
  })
  .listen?.();
screenProbeFolder
  .add(screenProbeParams, 'samples', 1, 8, 1)
  .name('Directions per probe')
  .listen?.();

const envIntensityController = integratorFolder
  .add(giTransportParams, 'envIntensity', 0, 5, 0.05)
  .name('Env GI Intensity')
  .onChange(() => {
    surfelIntegrate?.setEnvControls(
      giTransportParams.envIntensity,
      giTransportParams.envLod,
    );
  });
envIntensityController.listen?.();
const envLodController = integratorFolder
  .add(giTransportParams, 'envLod', 0, 10, 0.25)
  .name('Env GI LOD')
  .onChange(() => {
    surfelIntegrate?.setEnvControls(
      giTransportParams.envIntensity,
      giTransportParams.envLod,
    );
  });
envLodController.listen?.();
const multiBounceController = integratorFolder
  .add(multiBounceParams, 'enabled')
  .name('Multi-bounce GI')
  .onChange(() => {
    surfelIntegrate?.setGiScales(
      giTransportParams.giFromDirect,
      effectiveMultiBounceStrength(),
    );
  });
multiBounceController.listen?.();
const giFromDirectController = integratorFolder
  .add(giTransportParams, 'giFromDirect', 0, 4, 0.05)
  .name('First-bounce Strength')
  .onChange(() => {
    surfelIntegrate?.setGiScales(
      giTransportParams.giFromDirect,
      effectiveMultiBounceStrength(),
    );
  });
giFromDirectController.listen?.();
const giFromIndirectController = integratorFolder
  .add(giTransportParams, 'giFromIndirect', 0, 4, 0.05)
  .name('Multi-bounce Strength')
  .onChange(() => {
    surfelIntegrate?.setGiScales(
      giTransportParams.giFromDirect,
      effectiveMultiBounceStrength(),
    );
  });
giFromIndirectController.listen?.();
const albedoBoostController = integratorFolder
  .add(giTransportParams, 'albedoBoost', 1, 4, 0.05)
  .name('GI Albedo Boost')
  .onChange(() => {
    surfelIntegrate?.setAlbedoBoost(giTransportParams.albedoBoost);
  });
albedoBoostController.listen?.();

configureRadialDepthGUI(gui);

function applyLightSettings(settings: NonNullable<SceneSettings['light']>) {
  if (settings.azimuthDeg !== undefined)
    lightCfg.azimuthDeg = settings.azimuthDeg;
  if (settings.elevationDeg !== undefined)
    lightCfg.elevationDeg = settings.elevationDeg;
  if (settings.intensity !== undefined) lightCfg.intensity = settings.intensity;
  if (settings.animate !== undefined) lightCfg.animate = settings.animate;
  if (settings.speed !== undefined) lightCfg.speed = settings.speed;
}

function applyGiSettings(settings: NonNullable<SceneSettings['gi']>) {
  if (settings.mode !== undefined) giParams.mode = settings.mode;
  if (settings.indirectIntensity !== undefined)
    giParams.indirectIntensity = settings.indirectIntensity;
  mustRebuildCompositeMaterial = true;
}

function applyCameraSettings(settings?: NonNullable<SceneSettings['camera']>) {
  const next = settings ?? defaultCameraSettings;
  camera.position.copy(next.position);
  const target = next.target ?? defaultCameraSettings.target ?? controls.target;
  controls.target.copy(target);
  controls.update();
}

function applyIntegratorSettings(
  settings?: NonNullable<SceneSettings['integrator']>,
) {
  if (!settings) return;
  if (settings.baseSampleCount !== undefined) {
    integratorParams.baseSampleCount = settings.baseSampleCount;
    surfelIntegrate?.setBaseSampleCount(integratorParams.baseSampleCount);
  }
}

function applyTransportSettings(
  settings?: NonNullable<SceneSettings['transport']>,
) {
  if (!settings) return;
  if (settings.envIntensity !== undefined)
    giTransportParams.envIntensity = settings.envIntensity;
  if (settings.envLod !== undefined) giTransportParams.envLod = settings.envLod;
  if (settings.giFromDirect !== undefined)
    giTransportParams.giFromDirect = settings.giFromDirect;
  if (settings.giFromIndirect !== undefined)
    giTransportParams.giFromIndirect = settings.giFromIndirect;
  if (settings.albedoBoost !== undefined)
    giTransportParams.albedoBoost = settings.albedoBoost;

  surfelIntegrate?.setEnvControls(
    giTransportParams.envIntensity,
    giTransportParams.envLod,
  );
  surfelIntegrate?.setGiScales(
    giTransportParams.giFromDirect,
    effectiveMultiBounceStrength(),
  );
  surfelIntegrate?.setAlbedoBoost(giTransportParams.albedoBoost);
}

function applySceneSettings(settings?: SceneSettings) {
  if (settings?.gi) applyGiSettings(settings.gi);
  if (settings?.occlusion) applyOcclusionSettings(settings.occlusion);
  if (settings?.light) applyLightSettings(settings.light);
  if (settings?.integrator) applyIntegratorSettings(settings.integrator);
  if (settings?.transport) applyTransportSettings(settings.transport);
  applyCameraSettings(settings?.camera);
}

function resetParamsToDefaults() {
  giParams.mode = defaultGiParams.mode;
  giParams.indirectIntensity = defaultGiParams.indirectIntensity;
  mustRebuildCompositeMaterial = true;

  integratorParams.baseSampleCount = defaultIntegratorParams.baseSampleCount;
  giTransportParams.envIntensity = defaultGiTransportParams.envIntensity;
  giTransportParams.envLod = defaultGiTransportParams.envLod;
  giTransportParams.giFromDirect = defaultGiTransportParams.giFromDirect;
  giTransportParams.giFromIndirect = defaultGiTransportParams.giFromIndirect;
  giTransportParams.albedoBoost = defaultGiTransportParams.albedoBoost;
  multiBounceParams.enabled = true;

  applyOcclusionSettings(DEFAULT_OCCLUSION_SETTINGS);
  Object.assign(lightCfg, defaultLightSettings);

  surfelIntegrate?.setBaseSampleCount(integratorParams.baseSampleCount);
  surfelIntegrate?.setEnvControls(
    giTransportParams.envIntensity,
    giTransportParams.envLod,
  );
  surfelIntegrate?.setGiScales(
    giTransportParams.giFromDirect,
    effectiveMultiBounceStrength(),
  );
  surfelIntegrate?.setAlbedoBoost(giTransportParams.albedoBoost);
}

let sceneBVH: SceneBVHBundle | null = null;
let sceneLoadToken = 0;

async function loadScene(sceneDef: SceneDefinition) {
  console.log('Loading', sceneDef.label);
  const loadToken = ++sceneLoadToken;
  setLoading(`Loading ${sceneDef.label}`);

  sceneBVH = null;
  screenProbePass = null;
  motionHistory.reset();
  dirLight = recreateDirectionalLight(scene, dirLight, dirLightDefaults);
  clearSceneContent(scene);
  setLight(dirLight);
  surfelPrepare.run(renderer, surfelPool, { forceClear: true });

  try {
    envTex = await loadEnvTexture(sceneDef.hdr);
  } catch (error) {
    if (loadToken === sceneLoadToken) {
      showError(error);
    }
    return;
  }
  if (loadToken !== sceneLoadToken || !envTex) return;

  const suv = findSunPositionWeighted(envTex);
  console.log('Sun found at UV', suv);
  resetParamsToDefaults();
  setLightAnglesFromEnvMapSunUVLocation(suv[0], suv[1]);

  applySceneSettings(sceneDef.settings);
  updateLightFromAngles();

  surfelIntegrate = createSurfelIntegratePass(blueNoise, envTex);
  surfelIntegrate.setBaseSampleCount(integratorParams.baseSampleCount);
  surfelIntegrate.setEnvControls(
    giTransportParams.envIntensity,
    giTransportParams.envLod,
  );
  surfelIntegrate.setGiScales(
    giTransportParams.giFromDirect,
    effectiveMultiBounceStrength(),
  );
  surfelIntegrate.setAlbedoBoost(giTransportParams.albedoBoost);

  try {
    await sceneDef.populate(scene, dirLight);
  } catch (error) {
    if (loadToken === sceneLoadToken) {
      showError(error);
    }
    return;
  }
  if (loadToken !== sceneLoadToken) return;

  try {
    setLoading('Building BVH');
    sceneBVH = createSceneBVH(renderer, scene);
    screenProbePass = createScreenProbePass(uniformGrid, surfelPool, envTex);
    mustRebuildCompositeMaterial = true;
  } catch (error) {
    if (loadToken === sceneLoadToken) {
      showError(error);
    }
    return;
  }
  if (loadToken === sceneLoadToken) {
    clearLoading();
  }
}

async function loadSceneById(sceneId: string) {
  const nextScene = SCENE_PRESETS.find((scene) => scene.id === sceneId);
  if (!nextScene) return;
  await loadScene(nextScene);
}

const sceneOptions = SCENE_PRESETS.map((scene) => ({
  id: scene.id,
  label: scene.label,
}));
const sceneIdSet = new Set(sceneOptions.map((scene) => scene.id));
const sceneIdByLabel = new Map(
  sceneOptions.map((scene) => [scene.label, scene.id]),
);
const sceneLabelById = new Map(
  sceneOptions.map((scene) => [scene.id, scene.label]),
);
const defaultSceneId = sceneOptions[0]?.id;
let currentSceneId = defaultSceneId;
let isSyncingSceneSelection = false;

function normalizeSceneId(value: string): string {
  if (sceneIdSet.has(value)) return value;
  return sceneIdByLabel.get(value) ?? value;
}

function getSceneIdFromQuery(): string | null {
  if (!defaultSceneId) return null;
  const params = new URLSearchParams(window.location.search);
  const raw =
    params.get('scene') ?? params.get('sceneId') ?? params.get('scene_id');
  if (!raw) return defaultSceneId;
  const normalized = normalizeSceneId(raw);
  return sceneIdSet.has(normalized) ? normalized : defaultSceneId;
}

const sceneSwitcher = createSceneSwitcher(
  sceneOptions,
  (sceneId) => {
    if (isSyncingSceneSelection) return;
    selectScene(normalizeSceneId(sceneId));
  },
  defaultSceneId,
);

const inspectorSceneSelector = defaultSceneId
  ? configureSceneSelector(
      gui,
      sceneOptions,
      (sceneId) => {
        if (isSyncingSceneSelection) return;
        selectScene(normalizeSceneId(sceneId));
      },
      defaultSceneId,
    )
  : null;

function syncSceneSelection(sceneId: string) {
  isSyncingSceneSelection = true;
  try {
    currentSceneId = sceneId;
    sceneSwitcher?.setValue(sceneId);
    if (inspectorSceneSelector) {
      inspectorSceneSelector.params.scene = sceneId;
      if ('select' in inspectorSceneSelector.controller) {
        const label = sceneLabelById.get(sceneId);
        if (label) {
          inspectorSceneSelector.controller.select.value = label;
        }
      } else {
        inspectorSceneSelector.controller.updateDisplay?.();
      }
    }
  } finally {
    isSyncingSceneSelection = false;
  }
}

function selectScene(sceneId: string) {
  const normalized = normalizeSceneId(sceneId);
  if (!normalized || !sceneIdSet.has(normalized)) {
    return;
  }
  if (normalized === currentSceneId) {
    syncSceneSelection(normalized);
    return;
  }
  syncSceneSelection(normalized);
  void loadSceneById(normalized);
}

const initialSceneId = getSceneIdFromQuery();
if (initialSceneId) {
  syncSceneSelection(initialSceneId);
  await loadSceneById(initialSceneId);
}

const surfelResolve = createSurfelGIResolvePass(uniformGrid, surfelPool);

// --------------------------------------------------------
// COMPOSITING SETUP
// --------------------------------------------------------
const postProcessing = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);

scenePass.setMRT(
  mrt({
    output: output,
    normal: normalView,
    // velocity: velocity,
  }),
);

const scenePassColor = scenePass.getTextureNode('output').toInspector('Color');
const scenePassDepth = scenePass.getTextureNode('depth').toInspector('Depth');
const scenePassNormal = scenePass
  .getTextureNode('normal')
  .toInspector('Normal');
visibilityPass = ao(scenePassDepth, scenePassNormal, camera);
visibilityPass.resolutionScale = 0.5;
visibilityPass.radius.value = visibilityParams.radius;
visibilityPass.thickness.value = 0.75;
visibilityPass.distanceExponent.value = 1.35;
visibilityPass.distanceFallOff.value = 0.82;
visibilityPass.scale.value = 1.0;
visibilityPass.samples.value = visibilityParams.samples;
const visibilityRaster = visibilityPass
  .getTextureNode()
  .toInspector('Visibility Raster');

// const scenePassVelocity = scenePass
//   .getTextureNode('velocity')
//   .toInspector('Velocity');

// const traaNode = traa(
//   scenePassColor,
//   scenePassDepth,
//   scenePassVelocity,
//   camera,
// );
// postProcessing.outputNode = traaNode;

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  // Resize offscreen gbuffer and invalidate temporal history. The history pass
  // lazily reallocates its ping-pong textures at the new physical resolution.
  gbuffer.resize(renderer);
  motionHistory.reset();

  postProcessing.needsUpdate = true;

  mustRebuildCompositeMaterial = true;
});

const prevCameraPos = new THREE.Vector3();
prevCameraPos.copy(camera.position);

renderer.setAnimationLoop(() => {
  if (renderer.info.frame < 100) {
    const csmHelper = scene.userData.csmHelper;
    if (csmHelper) {
      csmHelper.update();
      csmHelper.updateVisibility();
    }
  }

  controls.update();
  updateAnimation();
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  updateTemporalSurfaceVersions(scene);

  if (!sceneBVH || !surfelIntegrate) {
    // postProcessing.render();       // show direct scene while loading
    prevCameraPos.copy(camera.position);
    return;
  }
  scene.background = null;
  // Offscreen gbuffer for spawning
  const prevTarget = renderer.getRenderTarget();
  camera.layers.set(0);
  renderer.setMRT(gbuffer.sceneMRT);
  renderer.setRenderTarget(gbuffer.target);

  renderer.render(scene, camera);
  renderer.setRenderTarget(prevTarget);
  renderer.setMRT(null);
  camera.layers.enable(1);

  // Reproject the current surface raster into the preceding frame and reject
  // off-screen, mismatched, newly exposed, or transformed surface history.
  motionHistory.run(renderer, camera, gbuffer);

  // GPU surfel prepare + generation into a fixed-capacity pool (capacity set once at init)
  // Age and recycle a fraction of the pool; this replenishes the free list gradually
  // Rebuild the alive list each frame (compaction): returns indices of currently alive surfels
  surfelPrepare.run(renderer, surfelPool);

  const findResult = surfelFindMissing.run(
    renderer,
    camera,
    gbuffer,
    surfelPool,
    uniformGrid,
    prevCameraPos,
  );
  surfelDispatchArgs.run(renderer, surfelPool);
  const indirectAttr = surfelDispatchArgs.getIndirectAttr();

  surfelAge.run(
    renderer,
    surfelPool,
    surfelFindMissing,
    uniformGrid,
    prevCameraPos,
    indirectAttr,
  );
  surfelAllocate.run(
    renderer,
    surfelPool,
    surfelFindMissing,
    findResult.tileCount,
  );

  // Rebuild grid to include freshly spawned surfels for downstream passes
  uniformGrid.build(renderer, surfelPool, camera);

  // Get the dispatch args for the integrator
  integratorDispatchArgs.run(renderer, surfelPool);
  // 2. INTEGRATE (Ray Trace)
  surfelIntegrate.run(
    renderer,
    surfelPool,
    sceneBVH,
    uniformGrid,
    camera,
    dirLight,
    integratorDispatchArgs.getIndirectAttr(),
  );

  // 3. Resolve the persistent world-space surfel cache.
  surfelResolve.run(renderer, camera, gbuffer);

  // 4. Trace one 8x8 screen probe over each visible tile. Secondary hits
  // consume the freshly integrated surfel field for multi-bounce radiance.
  if (screenProbeParams.enabled && screenProbePass) {
    screenProbePass.run(renderer, camera, gbuffer, sceneBVH, dirLight, {
      samples: screenProbeParams.samples,
      useHiZ: screenProbeParams.useHiZ,
      envIntensity: giTransportParams.envIntensity,
      envLod: giTransportParams.envLod,
      directStrength: giTransportParams.giFromDirect,
      multiBounceStrength: effectiveMultiBounceStrength(),
    });
  }

  // Surfel health debug
  // debugSurfelSystem(renderer, surfelPool, uniformGrid, surfelFindMissing);
  // debugOffsetsStats(renderer, uniformGrid)
  // build the per-pixel overlay from GBuffer + CSR
  const debugActive = screenDebug.debugParams.mode !== SCREEN_DEBUG_MODES.Off;

  // 5. Composite Final Image (Fullscreen Pass)
  const giTex = surfelResolve.getOutputTexture();
  const screenProbeTex = screenProbeParams.enabled
    ? screenProbePass?.getOutputTexture()
    : null;
  const screenProbeStatsTex = screenProbeParams.enabled
    ? screenProbePass?.getTraceStatsTexture()
    : null;
  const temporalValidationTex = motionHistory.getValidationTexture();
  let directLight;
  if (giTex) {
    if (mustRebuildCompositeMaterial) {
      directLight = scenePassColor; // Direct light with the original raster shadows.
      const albedo = texture(gbuffer.target.textures[1], screenUV);
      const aoVisibility = visibilityRaster;
      const ambientVisibility = visibilityParams.enabled
        ? aoVisibility
            .mul(visibilityParams.strength)
            .add(1.0 - visibilityParams.strength)
        : float(1.0);
      // Only a restrained quarter-strength AO reaches the direct/hemisphere pass;
      // the full visibility term belongs on indirect and ambient illumination.
      const directVisibility = visibilityParams.enabled
        ? aoVisibility
            .mul(visibilityParams.strength * 0.25)
            .add(1.0 - visibilityParams.strength * 0.25)
        : float(1.0);
      const visibleDirect = directLight.mul(directVisibility);

      // The original full-resolution surfel resolve remains the fallback. Screen
      // probes replace it only where bilateral reconstruction reports confidence,
      // preventing the two estimators from being added twice.
      const surfelRadiance = texture(giTex, screenUV).rgb;
      let probeRadiance: THREE.Node = surfelRadiance;
      let probeConfidence: THREE.Node = float(0.0);
      let indirectRadiance: THREE.Node = surfelRadiance;
      if (screenProbeTex) {
        const probeSample = texture(screenProbeTex, screenUV);
        probeRadiance = probeSample.rgb;
        probeConfidence = probeSample.a.mul(screenProbeParams.blendStrength);
        indirectRadiance = surfelRadiance
          .mul(float(1.0).sub(probeConfidence))
          .add(probeRadiance.mul(probeConfidence));
      }
      const indirectLight = vec4(
        indirectRadiance
          .mul(albedo.rgb)
          .mul(giParams.indirectIntensity)
          .mul(ambientVisibility),
        1.0,
      );
      const probeDebugLight = vec4(
        probeRadiance
          .mul(albedo.rgb)
          .mul(giParams.indirectIntensity)
          .mul(ambientVisibility),
        1.0,
      );
      const traceStats: THREE.Node = screenProbeStatsTex
        ? texture(screenProbeStatsTex, screenUV)
        : vec4(0.0);
      // Trace-source legend: green = Hi-Z, red = BVH fallback, blue = env miss.
      const traceSourceDebug = vec4(
        traceStats.y,
        traceStats.x,
        traceStats.z,
        1.0,
      );
      const hiZStepsDebug = vec4(traceStats.w, traceStats.w, traceStats.w, 1.0);
      const validationSample: THREE.Node = temporalValidationTex
        ? texture(temporalValidationTex, screenUV)
        : vec4(1.0, 0.0, 0.0, 0.0);
      const motionSample = texture(gbuffer.target.textures[2], screenUV).xy;
      // Signed NDC velocity is magnified 8x: neutral grey is stationary,
      // red/green deviations indicate horizontal/vertical motion.
      const motionDebug = vec4(
        motionSample.x.mul(4.0).add(0.5),
        motionSample.y.mul(4.0).add(0.5),
        0.5,
        1.0,
      );
      const surfaceId = texture(gbuffer.target.textures[3], screenUV).r;
      const surfaceIdDebug = vec4(
        fract(surfaceId.mul(0.1031)),
        fract(surfaceId.mul(0.11369)),
        fract(surfaceId.mul(0.13787)),
        1.0,
      );
      const reprojectedCoordinateDebug = vec4(
        validationSample.z,
        validationSample.w,
        0.0,
        1.0,
      );
      const disocclusionDebug = vec4(
        validationSample.r,
        validationSample.r,
        validationSample.r,
        1.0,
      );
      const historyConfidenceDebug = vec4(
        validationSample.g,
        validationSample.g,
        validationSample.g,
        1.0,
      );

      if (temporalParams.output === TEMPORAL_OUTPUTS['Motion vectors']) {
        postProcessing.outputNode = fxaa(motionDebug);
        postProcessing.needsUpdate = true;
      } else if (temporalParams.output === TEMPORAL_OUTPUTS['Surface IDs']) {
        postProcessing.outputNode = fxaa(surfaceIdDebug);
        postProcessing.needsUpdate = true;
      } else if (
        temporalParams.output === TEMPORAL_OUTPUTS['Reprojected coordinates']
      ) {
        postProcessing.outputNode = fxaa(reprojectedCoordinateDebug);
        postProcessing.needsUpdate = true;
      } else if (temporalParams.output === TEMPORAL_OUTPUTS.Disocclusion) {
        postProcessing.outputNode = fxaa(disocclusionDebug);
        postProcessing.needsUpdate = true;
      } else if (
        temporalParams.output === TEMPORAL_OUTPUTS['History confidence']
      ) {
        postProcessing.outputNode = fxaa(historyConfidenceDebug);
        postProcessing.needsUpdate = true;
      } else if (
        visibilityParams.output === VISIBILITY_OUTPUTS['Visibility raster']
      ) {
        postProcessing.outputNode = fxaa(
          vec4(aoVisibility, aoVisibility, aoVisibility, 1.0),
        );
        postProcessing.needsUpdate = true;
      } else if (
        screenProbeParams.enabled &&
        screenProbeParams.output === SCREEN_PROBE_OUTPUTS['Screen probe GI']
      ) {
        postProcessing.outputNode = fxaa(probeDebugLight);
        postProcessing.needsUpdate = true;
      } else if (
        screenProbeParams.enabled &&
        screenProbeParams.output === SCREEN_PROBE_OUTPUTS['Probe confidence']
      ) {
        postProcessing.outputNode = fxaa(
          vec4(probeConfidence, probeConfidence, probeConfidence, 1.0),
        );
        postProcessing.needsUpdate = true;
      } else if (
        screenProbeParams.enabled &&
        screenProbeParams.output === SCREEN_PROBE_OUTPUTS['Trace source']
      ) {
        postProcessing.outputNode = fxaa(traceSourceDebug);
        postProcessing.needsUpdate = true;
      } else if (
        screenProbeParams.enabled &&
        screenProbeParams.output === SCREEN_PROBE_OUTPUTS['Hi-Z steps']
      ) {
        postProcessing.outputNode = fxaa(hiZStepsDebug);
        postProcessing.needsUpdate = true;
      } else {
        switch (giParams.mode) {
          case GI_MODES.Direct:
            postProcessing.outputNode = fxaa(visibleDirect);
            postProcessing.needsUpdate = true;
            break;
          case GI_MODES.Indirect:
            postProcessing.outputNode = fxaa(indirectLight);
            postProcessing.needsUpdate = true;
            break;
          case GI_MODES.Combined:
          default:
            postProcessing.outputNode = fxaa(visibleDirect.add(indirectLight));
            postProcessing.needsUpdate = true;
            break;
        }
      }
      mustRebuildCompositeMaterial = false;
    }
  }

  scene.background = envTex;
  postProcessing.render();

  if (debugActive) {
    screenDebug.run(
      renderer,
      camera,
      gbuffer,
      surfelFindMissing,
      prevCameraPos,
      sceneBVH,
    );
    renderer.render(scene, camera);
    screenDebug.renderOverlay(renderer);
  }

  // Update prevCameraPos for the next frame
  prevCameraPos.copy(camera.position);
  surfelPool.swapMoments();
});
