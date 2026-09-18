// Slate Terrain Studio - Main Application Component
// Architecture:
// - Left: Interactive 3D WebGL Viewport + Viewport HUD Overlay
// - Right: Slate Pro Inspector with Layer Stack, Gaea Algorithm Properties, SDF Sculpting, SatMaps, and Exporters

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  TerrainLayer,
  LayerType,
  TerrainSimulationResult,
  ViewportSettings,
  BrushSettings,
  SculptStroke,
  SdfSculptConfig,
  HydraulicErosionConfig,
} from './types/terrain';
import { TERRAIN_PRESETS } from './presets/terrainPresets';
import { executeTerrainPipeline } from './core/pipeline/terrainPipeline';
import { TerrainViewport } from './components/viewport/TerrainViewport';
import { ViewportOverlay } from './components/viewport/ViewportOverlay';
import { InspectorPanel } from './components/inspector/InspectorPanel';
import {
  exportHeightmapPNG,
  exportObjMesh,
  exportSatMapAlbedoPNG,
} from './core/export/exporters';

export default function App() {
  // Current preset & layer stack
  const [activePresetId, setActivePresetId] = useState<string>('alpine_glacial_horn');
  const [layers, setLayers] = useState<TerrainLayer[]>(() => {
    const preset = TERRAIN_PRESETS[0];
    return JSON.parse(JSON.stringify(preset.layers));
  });

  const [selectedLayerId, setSelectedLayerId] = useState<string>(() => layers[0]?.id ?? '');
  const [resolution, setResolution] = useState<number>(256);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Viewport Settings
  const [viewportSettings, setViewportSettings] = useState<ViewportSettings>({
    shadingMode: 'satmap',
    wireframe: false,
    sunElevation: 48,
    sunAzimuth: 135,
    sunIntensity: 2.2,
    heightScale: 32,
    waterLevel: 0.12,
    showWater: false,
    cameraFov: 45,
    is2DView: false,
  });

  // Brush / Sculpting Settings
  const [isSculptingActive, setIsSculptingActive] = useState<boolean>(false);
  const [brushSettings, setBrushSettings] = useState<BrushSettings>({
    tool: 'carve_gully',
    radius: 0.08,
    strength: 0.45,
    falloff: 'smooth',
    targetHeight: 0.5,
  });

  // Latest simulation result
  const [simulationResult, setSimulationResult] = useState<TerrainSimulationResult | null>(null);

  // Count sculpt strokes in stack
  const sculptLayer = layers.find((l) => l.type === 'sdf_sculpt') as SdfSculptConfig | undefined;
  const strokeCount = sculptLayer?.strokes.length ?? 0;

  // Recompute Pipeline Execution
  const executePipeline = useCallback(() => {
    setIsProcessing(true);
    // Use requestAnimationFrame so UI remains responsive
    requestAnimationFrame(() => {
      try {
        const result = executeTerrainPipeline(layers, resolution);
        setSimulationResult(result);
      } catch (err) {
        console.error('Pipeline execution error:', err);
      } finally {
        setIsProcessing(false);
      }
    });
  }, [layers, resolution]);

  // Initial build and trigger on layers / resolution change
  const debounceTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      executePipeline();
    }, 40);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [executePipeline]);

  // Handle Preset Load
  const handleLoadPreset = (presetId: string) => {
    const preset = TERRAIN_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    const clonedLayers = JSON.parse(JSON.stringify(preset.layers));
    setLayers(clonedLayers);
    setSelectedLayerId(clonedLayers[0]?.id ?? '');
  };

  // Update a single layer
  const handleUpdateLayer = (id: string, updates: Partial<TerrainLayer>) => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id === id) {
          return { ...layer, ...updates } as TerrainLayer;
        }
        return layer;
      })
    );
  };

  // Reorder layers in stack
  const handleMoveLayer = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layers.length) return;

    setLayers((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // Duplicate layer
  const handleDuplicateLayer = (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const newLayer: TerrainLayer = {
      ...JSON.parse(JSON.stringify(layer)),
      id: `layer_${Date.now()}`,
      name: `${layer.name} Copy`,
    };
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      const copy = [...prev];
      copy.splice(idx + 1, 0, newLayer);
      return copy;
    });
    setSelectedLayerId(newLayer.id);
  };

  // Delete layer
  const handleDeleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedLayerId === id) {
      const remaining = layers.filter((l) => l.id !== id);
      setSelectedLayerId(remaining[0]?.id ?? '');
    }
  };

  // Add new layer to stack
  const handleAddLayer = (type: LayerType) => {
    const newId = `layer_${Date.now()}`;
    let newLayer: TerrainLayer;

    switch (type) {
      case 'hydraulic_erosion':
        newLayer = {
          id: newId,
          name: 'Hydraulic Erosion Pass',
          type: 'hydraulic_erosion',
          enabled: true,
          opacity: 1.0,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          iterations: 50,
          erosionScale: 1.0,
          downcutting: 0.6,
          inhibition: 0.4,
          baseLevel: 0.1,
          sedimentCapacity: 0.2,
          depositionRate: 0.12,
          evaporationRate: 0.02,
          rockSoftness: 0.7,
          sedimentRemoval: 0.1,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'rain_precipitation':
        newLayer = {
          id: newId,
          name: 'Orographic Rain Pass',
          type: 'rain_precipitation',
          enabled: true,
          opacity: 1.0,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          precipitationAmount: 1.0,
          windAngle: 120,
          windStrength: 0.6,
          altitudeMin: 0.2,
          altitudeMax: 0.9,
          rainShadowStrength: 0.6,
          dropletCount: 40000,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'alluvial_deposits':
        newLayer = {
          id: newId,
          name: 'Alluvial Deposits',
          type: 'alluvial_deposits',
          enabled: true,
          opacity: 0.75,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          iterations: 20,
          amount: 0.4,
          settling: 0.6,
          hardness: 0.35,
          power: 1.2,
          chaos: 0.2,
          mode: 'valley_fans',
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'rocky_thermal':
        newLayer = {
          id: newId,
          name: 'Rocky Talus Scree',
          type: 'rocky_thermal',
          enabled: true,
          opacity: 0.85,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          iterations: 25,
          angleRepose: 35,
          talusVolume: 0.7,
          rockSoftness: 0.5,
          shatterStrength: 0.4,
          shatterScale: 30.0,
          strataSteps: 0,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'sdf_sculpt':
        newLayer = {
          id: newId,
          name: 'SDF Sculpt Layer',
          type: 'sdf_sculpt',
          enabled: true,
          opacity: 1.0,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          strokes: [],
        };
        break;
      case 'satmap_color':
        newLayer = {
          id: newId,
          name: 'SatMap Color Grade',
          type: 'satmap_color',
          enabled: true,
          opacity: 1.0,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          presetId: 'rocky_grand_canyon',
          category: 'rocky',
          driver: 'composite',
          slopeInfluence: 0.7,
          altitudeBias: 0.0,
          rockHighlightStrength: 0.65,
          flowWetness: 0.7,
          depositSiltBlend: 0.75,
          contrast: 1.15,
          brightness: 0.0,
          saturation: 1.1,
        };
        break;
      case 'mountain_generator':
        newLayer = {
          id: newId,
          name: 'Mountain Peak',
          type: 'mountain_generator',
          enabled: true,
          opacity: 0.8,
          blendMode: 'add',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          scale: 2.0,
          height: 0.7,
          octaves: 6,
          roughness: 0.5,
          lacunarity: 2.0,
          peakSharpness: 2.0,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'ridge_generator':
        newLayer = {
          id: newId,
          name: 'Razor Ridge',
          type: 'ridge_generator',
          enabled: true,
          opacity: 0.75,
          blendMode: 'max',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          scale: 1.5,
          height: 0.8,
          octaves: 6,
          gain: 0.55,
          sharpness: 2.0,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'voronoi_generator':
        newLayer = {
          id: newId,
          name: 'Voronoi Facets',
          type: 'voronoi_generator',
          enabled: true,
          opacity: 0.7,
          blendMode: 'add',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          scale: 1.8,
          height: 0.8,
          jitter: 0.8,
          ridgeSharpness: 1.6,
          inverted: false,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'plateau_generator':
        newLayer = {
          id: newId,
          name: 'Mesa Plateau',
          type: 'plateau_generator',
          enabled: true,
          opacity: 0.8,
          blendMode: 'max',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          scale: 1.2,
          height: 0.75,
          bevelWidth: 0.2,
          terraceSteps: 5,
          roughness: 0.35,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'caldera_generator':
        newLayer = {
          id: newId,
          name: 'Volcanic Crater',
          type: 'caldera_generator',
          enabled: true,
          opacity: 0.85,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          radius: 0.45,
          rimHeight: 0.4,
          floorDepth: 0.35,
          centralConeHeight: 0.2,
          roughness: 0.4,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'canyon_generator':
        newLayer = {
          id: newId,
          name: 'River Canyon Carve',
          type: 'canyon_generator',
          enabled: true,
          opacity: 0.8,
          blendMode: 'multiply',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          depth: 0.6,
          width: 0.2,
          meander: 1.2,
          terraces: 3,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'dunes_generator':
        newLayer = {
          id: newId,
          name: 'Wind Sand Dunes',
          type: 'dunes_generator',
          enabled: true,
          opacity: 0.6,
          blendMode: 'add',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          scale: 2.0,
          height: 0.5,
          windAngle: 45,
          asymmetry: 0.5,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      case 'strata_terrace':
        newLayer = {
          id: newId,
          name: 'Strata Terracing',
          type: 'strata_terrace',
          enabled: true,
          opacity: 0.6,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          frequency: 16,
          sharpness: 0.8,
          warpStrength: 0.15,
        };
        break;
      case 'displace_perturb':
        newLayer = {
          id: newId,
          name: 'Domain Displace',
          type: 'displace_perturb',
          enabled: true,
          opacity: 0.5,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          strength: 0.3,
          frequency: 5.0,
          seed: Math.floor(Math.random() * 99999),
        };
        break;
      default:
        return;
    }

    setLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  // Apply interactive 3D sculpt stroke
  const handleApplyStroke = (stroke: SculptStroke) => {
    // Find or create SDF sculpt layer
    setLayers((prev) => {
      let sculptIdx = prev.findIndex((l) => l.type === 'sdf_sculpt');
      let copy = [...prev];

      if (sculptIdx === -1) {
        // Insert sculpt layer above generators
        const newSculptLayer: SdfSculptConfig = {
          id: `sculpt_${Date.now()}`,
          name: 'SDF Sculpt & Directed Cuts',
          type: 'sdf_sculpt',
          enabled: true,
          opacity: 1.0,
          blendMode: 'normal',
          maskAltitudeMin: 0,
          maskAltitudeMax: 1,
          maskSlopeMin: 0,
          maskSlopeMax: 90,
          maskInvert: false,
          strokes: [stroke],
        };
        copy.splice(1, 0, newSculptLayer);
      } else {
        const sculpt = copy[sculptIdx] as SdfSculptConfig;
        copy[sculptIdx] = {
          ...sculpt,
          strokes: [...sculpt.strokes, stroke],
        };
      }
      return copy;
    });
  };

  // Clear all strokes
  const handleClearStrokes = () => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.type === 'sdf_sculpt') {
          return { ...l, strokes: [] };
        }
        return l;
      })
    );
  };

  // Step Hydraulic Erosion simulation forward
  const handleStepErosion = (steps: number) => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.type === 'hydraulic_erosion') {
          return { ...l, iterations: (l as HydraulicErosionConfig).iterations + steps };
        }
        return l;
      })
    );
  };

  // Reset Terrain Sculpting & Seeds
  const handleResetTerrain = () => {
    handleClearStrokes();
    executePipeline();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0c0d12]">
      {/* LEFT: 3D Viewport & Simulation Canvas */}
      <div className="flex-1 h-full relative overflow-hidden">
        <TerrainViewport
          simulationResult={simulationResult}
          viewportSettings={viewportSettings}
          brushSettings={brushSettings}
          isSculptingActive={isSculptingActive}
          onApplyStroke={handleApplyStroke}
        />

        {/* Viewport Overlay Controls HUD */}
        <ViewportOverlay
          viewportSettings={viewportSettings}
          onUpdateViewportSettings={(updates) =>
            setViewportSettings((prev) => ({ ...prev, ...updates }))
          }
          simulationResult={simulationResult}
          resolution={resolution}
          onChangeResolution={setResolution}
          onStepErosion={handleStepErosion}
          onBakeAll={executePipeline}
          onResetTerrain={handleResetTerrain}
          onExportMesh={() => simulationResult && exportObjMesh(simulationResult)}
          onExportHeightmap={() => simulationResult && exportHeightmapPNG(simulationResult)}
          onExportSatMap={() => simulationResult && exportSatMapAlbedoPNG(simulationResult)}
          isProcessing={isProcessing}
        />
      </div>

      {/* RIGHT: Slate Pro Inspector Panel */}
      <InspectorPanel
        layers={layers}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onUpdateLayer={handleUpdateLayer}
        onMoveLayer={handleMoveLayer}
        onDuplicateLayer={handleDuplicateLayer}
        onDeleteLayer={handleDeleteLayer}
        onAddLayer={handleAddLayer}
        onLoadPreset={handleLoadPreset}
        activePresetId={activePresetId}
        brushSettings={brushSettings}
        onUpdateBrush={(updates) => setBrushSettings((prev) => ({ ...prev, ...updates }))}
        isSculptingActive={isSculptingActive}
        onToggleSculpting={() => setIsSculptingActive(!isSculptingActive)}
        onClearStrokes={handleClearStrokes}
        strokeCount={strokeCount}
        simulationResult={simulationResult}
      />
    </div>
  );
}
