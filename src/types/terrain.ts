// Slate Terrain Studio - Types & Interfaces
// Modeled after QuadSpinner Gaea 1.x & 2.x architectural paradigms

export type LayerType =
  | 'mountain_generator'
  | 'voronoi_generator'
  | 'ridge_generator'
  | 'plateau_generator'
  | 'caldera_generator'
  | 'canyon_generator'
  | 'dunes_generator'
  | 'sdf_sculpt'
  | 'hydraulic_erosion'
  | 'rain_precipitation'
  | 'alluvial_deposits'
  | 'rocky_thermal'
  | 'strata_terrace'
  | 'displace_perturb'
  | 'satmap_color';

export type BlendMode =
  | 'normal'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'min'
  | 'max'
  | 'screen'
  | 'overlay';

export interface BaseLayerConfig {
  id: string;
  name: string;
  type: LayerType;
  enabled: boolean;
  opacity: number; // 0.0 to 1.0
  blendMode: BlendMode;
  maskAltitudeMin: number; // 0.0 to 1.0
  maskAltitudeMax: number; // 0.0 to 1.0
  maskSlopeMin: number; // 0 to 90 degrees
  maskSlopeMax: number; // 0 to 90 degrees
  maskInvert: boolean;
}

// Generator Layer Configs
export interface MountainGeneratorConfig extends BaseLayerConfig {
  type: 'mountain_generator';
  scale: number; // 0.5 to 10.0
  height: number; // 0 to 1
  octaves: number; // 1 to 8
  roughness: number; // 0 to 1
  lacunarity: number; // 1.5 to 3.5
  peakSharpness: number; // 0.5 to 4.0
  seed: number;
}

export interface VoronoiGeneratorConfig extends BaseLayerConfig {
  type: 'voronoi_generator';
  scale: number;
  height: number;
  jitter: number; // 0 to 1
  ridgeSharpness: number;
  inverted: boolean;
  seed: number;
}

export interface RidgeGeneratorConfig extends BaseLayerConfig {
  type: 'ridge_generator';
  scale: number;
  height: number;
  octaves: number;
  gain: number;
  sharpness: number;
  seed: number;
}

export interface PlateauGeneratorConfig extends BaseLayerConfig {
  type: 'plateau_generator';
  scale: number;
  height: number;
  bevelWidth: number;
  terraceSteps: number;
  roughness: number;
  seed: number;
}

export interface CalderaGeneratorConfig extends BaseLayerConfig {
  type: 'caldera_generator';
  radius: number;
  rimHeight: number;
  floorDepth: number;
  centralConeHeight: number;
  roughness: number;
  seed: number;
}

export interface CanyonGeneratorConfig extends BaseLayerConfig {
  type: 'canyon_generator';
  depth: number;
  width: number;
  meander: number;
  terraces: number;
  seed: number;
}

export interface DunesGeneratorConfig extends BaseLayerConfig {
  type: 'dunes_generator';
  scale: number;
  height: number;
  windAngle: number; // 0 to 360 degrees
  asymmetry: number; // 0 to 1 (slip face sharpness)
  seed: number;
}

// SDF Sculpt Tool Types
export type SculptTool =
  | 'carve_gully'      // Downcutting incision SDF carve
  | 'deposit_talus'    // Scree/talus deposit SDF mound
  | 'alluvial_wash'    // Smooth crevice fill
  | 'rock_chisel'      // Fractured rocky displacement
  | 'raise_peak'       // Organic mountain lift
  | 'lower_valley'     // Valley depression
  | 'flatten_plateau'  // Level to target height
  | 'rain_painter';    // Paint precipitation mask

export interface SculptStroke {
  tool: SculptTool;
  x: number; // normalized [0, 1]
  y: number; // normalized [0, 1]
  radius: number; // normalized [0.01, 0.4]
  strength: number; // [0, 1]
  targetHeight?: number; // for flatten
}

export interface SdfSculptConfig extends BaseLayerConfig {
  type: 'sdf_sculpt';
  strokes: SculptStroke[];
}

// Gaea Hydraulic Erosion Parameters
export interface HydraulicErosionConfig extends BaseLayerConfig {
  type: 'hydraulic_erosion';
  iterations: number; // 10 to 300
  erosionScale: number; // 0.1 to 3.0 (Gaea Erosion Scale)
  downcutting: number; // 0.0 to 1.0 (Gaea Downcutting vertical gouge)
  inhibition: number; // 0.0 to 1.0 (Gaea downcutting inhibition by sediment)
  baseLevel: number; // 0.0 to 1.0 (lowest elevation downcutting reaches)
  sedimentCapacity: number; // 0.01 to 0.5 (fluvial transport capacity)
  depositionRate: number; // 0.01 to 0.3
  evaporationRate: number; // 0.005 to 0.1
  rockSoftness: number; // 0.1 to 1.0 (erodibility)
  sedimentRemoval: number; // 0.0 to 1.0 (Gaea sediment removal)
  seed: number;
}

// Gaea Rain / Selective Precipitation Parameters
export interface RainPrecipitationConfig extends BaseLayerConfig {
  type: 'rain_precipitation';
  precipitationAmount: number; // 0.1 to 2.0
  windAngle: number; // 0 to 360 degrees
  windStrength: number; // 0.0 to 1.0 (orographic lift vs rain shadow)
  altitudeMin: number; // 0.0 to 1.0
  altitudeMax: number; // 0.0 to 1.0
  rainShadowStrength: number; // 0.0 to 1.0
  dropletCount: number; // number of rain particles
  seed: number;
}

// Gaea Alluvium & Deposits Parameters
export interface AlluvialDepositsConfig extends BaseLayerConfig {
  type: 'alluvial_deposits';
  iterations: number; // 5 to 50
  amount: number; // 0.0 to 1.0 (Gaea amount of soil deposits)
  settling: number; // 0.0 to 1.0 (viscosity / settling rate in crevices)
  hardness: number; // 0.0 to 1.0
  power: number; // 0.1 to 2.0
  chaos: number; // 0.0 to 1.0 (randomness in sediment drift)
  mode: 'crevices' | 'valley_fans' | 'drift';
  seed: number;
}

// Gaea Rocky / Thermal Weathering Parameters
export interface RockyThermalConfig extends BaseLayerConfig {
  type: 'rocky_thermal';
  iterations: number; // 5 to 60
  angleRepose: number; // 25 to 50 degrees (critical scree angle)
  talusVolume: number; // 0.0 to 1.0 (scree deposited at cliff feet)
  rockSoftness: number; // 0.0 to 1.0
  shatterStrength: number; // 0.0 to 1.0 (cellular rock fracturing)
  shatterScale: number; // 5.0 to 60.0
  strataSteps: number; // 0 to 20 (rock layer terracing)
  seed: number;
}

// Modifier Layer Configs
export interface StrataTerraceConfig extends BaseLayerConfig {
  type: 'strata_terrace';
  frequency: number; // 2 to 40
  sharpness: number; // 0.1 to 1.0
  warpStrength: number; // 0.0 to 0.5
}

export interface DisplacePerturbConfig extends BaseLayerConfig {
  type: 'displace_perturb';
  strength: number; // 0.0 to 0.5
  frequency: number; // 1.0 to 20.0
  seed: number;
}

// SatMap Satellite Color Map Config
export interface SatMapConfig extends BaseLayerConfig {
  type: 'satmap_color';
  presetId: string; // ID of the SatMap preset from library
  category: 'rocky' | 'desert' | 'lush' | 'arctic' | 'volcanic' | 'badlands';
  driver: 'elevation' | 'slope' | 'wear' | 'deposit' | 'flow' | 'composite';
  slopeInfluence: number; // 0.0 to 1.0
  altitudeBias: number; // -1.0 to 1.0
  rockHighlightStrength: number; // 0.0 to 1.0 (Gaea Surfacer wind streak mode)
  flowWetness: number; // 0.0 to 1.0 (darkens / saturates stream beds)
  depositSiltBlend: number; // 0.0 to 1.0 (tints deposition zones)
  contrast: number; // 0.5 to 2.0
  brightness: number; // -0.5 to 0.5
  saturation: number; // 0.0 to 2.0
}

export type TerrainLayer =
  | MountainGeneratorConfig
  | VoronoiGeneratorConfig
  | RidgeGeneratorConfig
  | PlateauGeneratorConfig
  | CalderaGeneratorConfig
  | CanyonGeneratorConfig
  | DunesGeneratorConfig
  | SdfSculptConfig
  | HydraulicErosionConfig
  | RainPrecipitationConfig
  | AlluvialDepositsConfig
  | RockyThermalConfig
  | StrataTerraceConfig
  | DisplacePerturbConfig
  | SatMapConfig;

export interface ColorStop {
  position: number; // 0.0 to 1.0
  color: string; // hex color e.g. '#a67c52'
}

export interface SatMapPreset {
  id: string;
  name: string;
  category: 'rocky' | 'desert' | 'lush' | 'arctic' | 'volcanic' | 'badlands';
  description: string;
  stops: ColorStop[];
  rockTint?: string;
  siltTint?: string;
  wetnessTint?: string;
}

export interface TerrainSimulationResult {
  resolution: number;
  heightmap: Float32Array; // Size: resolution * resolution, heights in [0, 1]
  normals: Float32Array; // Size: resolution * resolution * 3
  wearMap: Float32Array; // Size: resolution * resolution, bedrock worn away
  depositMap: Float32Array; // Size: resolution * resolution, sediment deposits
  flowMap: Float32Array; // Size: resolution * resolution, cumulative water discharge
  precipitationMask: Float32Array; // Size: resolution * resolution
  albedoTexture: Uint8ClampedArray; // Size: resolution * resolution * 4 (RGBA)
  minHeight: number;
  maxHeight: number;
  executionTimeMs: number;
}

export type ViewportShadingMode =
  | 'satmap'
  | 'height'
  | 'wear'
  | 'deposit'
  | 'flow'
  | 'slope'
  | 'ambient_occlusion'
  | 'normal';

export interface ViewportSettings {
  shadingMode: ViewportShadingMode;
  wireframe: boolean;
  sunElevation: number; // 10 to 85 degrees
  sunAzimuth: number; // 0 to 360 degrees
  sunIntensity: number; // 0.5 to 3.0
  heightScale: number; // 10 to 100 3D height scale
  waterLevel: number; // 0.0 to 1.0
  showWater: boolean;
  cameraFov: number;
  is2DView: boolean;
}

export interface BrushSettings {
  tool: SculptTool;
  radius: number; // in world or grid space
  strength: number; // 0.05 to 1.0
  falloff: 'smooth' | 'linear' | 'sharp';
  targetHeight: number; // For plateau/flatten
}
