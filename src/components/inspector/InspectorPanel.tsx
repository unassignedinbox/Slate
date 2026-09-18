// Slate Pro Inspector Panel
// Located on the Right side of the screen (Left side has 3D Viewport)
// Contains: Preset Manager, Layer Stack, Selected Layer Properties,
// SDF Sculpting Toolbar, SatMap Library, and Exporters.

import React, { useState } from 'react';
import {
  Layers,
  Sliders,
  Paintbrush,
  Palette,
  Download,
  FolderOpen,
  Info,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import type {
  TerrainLayer,
  LayerType,
  BrushSettings,
  TerrainSimulationResult,
} from '../../types/terrain';
import { LayerStack } from './LayerStack';
import { LayerProperties } from './LayerProperties';
import { SculptToolbar } from './SculptToolbar';
import { SatMapBrowser } from './SatMapBrowser';
import { TERRAIN_PRESETS } from '../../presets/terrainPresets';
import {
  exportHeightmapPNG,
  exportRaw16Heightmap,
  exportObjMesh,
  exportSatMapAlbedoPNG,
  exportFlowMapPNG,
  exportDepositMapPNG,
  exportNormalMapPNG,
} from '../../core/export/exporters';

interface InspectorPanelProps {
  layers: TerrainLayer[];
  selectedLayerId: string;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<TerrainLayer>) => void;
  onMoveLayer: (index: number, direction: 'up' | 'down') => void;
  onDuplicateLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onAddLayer: (type: LayerType) => void;
  onLoadPreset: (presetId: string) => void;
  activePresetId: string;
  brushSettings: BrushSettings;
  onUpdateBrush: (settings: Partial<BrushSettings>) => void;
  isSculptingActive: boolean;
  onToggleSculpting: () => void;
  onClearStrokes: () => void;
  strokeCount: number;
  simulationResult: TerrainSimulationResult | null;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onAddLayer,
  onLoadPreset,
  activePresetId,
  brushSettings,
  onUpdateBrush,
  isSculptingActive,
  onToggleSculpting,
  onClearStrokes,
  strokeCount,
  simulationResult,
}) => {
  const [activeTab, setActiveTab] = useState<'stack' | 'properties' | 'sculpt' | 'satmaps' | 'export'>('stack');

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? layers[0];

  const satMapLayer = layers.find((l) => l.type === 'satmap_color');

  return (
    <div className="w-96 h-full bg-[#0d0f16] border-l border-[#1f2334] flex flex-col z-20 shadow-2xl">
      {/* Top Header: Slate Brand & Preset Switcher */}
      <div className="p-3 border-b border-[#1f2334] flex flex-col gap-2.5 bg-[#10121a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <span className="font-mono font-bold text-white text-xs">S</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-extrabold tracking-tight text-sm text-gray-100">SLATE</span>
              <span className="text-[10px] text-blue-400 font-mono tracking-widest uppercase font-semibold">
                SDF · Gaea Studio
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-300 border border-blue-800/50">
            v2.4 Pro
          </span>
        </div>

        {/* Quick Presets Dropdown */}
        <div className="flex items-center gap-2">
          <FolderOpen className="w-3.5 h-3.5 text-gray-400" />
          <select
            value={activePresetId}
            onChange={(e) => onLoadPreset(e.target.value)}
            className="flex-1 bg-[#161824] text-gray-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-[#272b3e] focus:outline-none focus:border-blue-500 transition-colors"
          >
            {TERRAIN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.badge})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation Tab Bar */}
      <div className="flex border-b border-[#1f2334] bg-[#0f1118] px-2 pt-1 gap-1">
        {[
          { id: 'stack', label: 'Layers', icon: Layers },
          { id: 'properties', label: 'Inspector', icon: Sliders },
          { id: 'sculpt', label: 'SDF Sculpt', icon: Paintbrush },
          { id: 'satmaps', label: 'SatMaps', icon: Palette },
          { id: 'export', label: 'Export', icon: Download },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex flex-col items-center justify-center py-2 px-1 text-[11px] font-semibold border-b-2 transition-all gap-1 ${
                isActive
                  ? 'border-blue-500 text-blue-400 bg-[#151824]'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-[#12141e]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
        {/* TAB 1: LAYER STACK */}
        {activeTab === 'stack' && (
          <div className="flex flex-col gap-4">
            <LayerStack
              layers={layers}
              selectedLayerId={selectedLayerId}
              onSelectLayer={(id) => {
                onSelectLayer(id);
                // When clicking a layer, allow fast editing
              }}
              onUpdateLayer={onUpdateLayer}
              onMoveLayer={onMoveLayer}
              onDuplicateLayer={onDuplicateLayer}
              onDeleteLayer={onDeleteLayer}
              onAddLayer={onAddLayer}
            />

            {/* Quick Properties Card for Selected Layer */}
            {selectedLayer && (
              <div className="p-3 bg-[#11131c] border border-[#232738] rounded-xl flex flex-col gap-2 shadow-inner">
                <div className="flex items-center justify-between pb-1 border-b border-[#1f2230]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-200">{selectedLayer.name}</span>
                    <span className="text-[10px] text-gray-400">Settings</span>
                  </div>
                  <button
                    onClick={() => setActiveTab('properties')}
                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5"
                  >
                    <span>Full Inspector</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <LayerProperties
                  layer={selectedLayer}
                  onUpdate={(updates) => onUpdateLayer(selectedLayer.id, updates)}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DETAILED LAYER PROPERTIES */}
        {activeTab === 'properties' && selectedLayer && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#1f2334]">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-gray-100">{selectedLayer.name}</span>
                <span className="text-[10px] text-gray-400 font-mono">ID: {selectedLayer.id}</span>
              </div>
              <span className="text-[10px] font-mono uppercase bg-blue-950/60 border border-blue-800/40 text-blue-300 px-2 py-0.5 rounded">
                {selectedLayer.type.replace('_', ' ')}
              </span>
            </div>

            <LayerProperties
              layer={selectedLayer}
              onUpdate={(updates) => onUpdateLayer(selectedLayer.id, updates)}
            />
          </div>
        )}

        {/* TAB 3: SDF SCULPTING */}
        {activeTab === 'sculpt' && (
          <div className="flex flex-col gap-3">
            <SculptToolbar
              brushSettings={brushSettings}
              onUpdateBrush={onUpdateBrush}
              isSculptingActive={isSculptingActive}
              onToggleSculpting={onToggleSculpting}
              onClearStrokes={onClearStrokes}
              strokeCount={strokeCount}
            />

            <div className="p-3 bg-[#11131c] border border-[#232738] rounded-xl flex flex-col gap-2">
              <span className="text-xs font-bold text-gray-300">How SDF Sculpting Works</span>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Sculpt brushes modify the terrain signed distance field directly. 
                <strong className="text-cyan-300"> Carve Gully</strong> simulates directed downcutting incision along your stroke path.
                <strong className="text-amber-300"> Deposit Talus</strong> heaps up scree material according to the angle of repose.
                <strong className="text-sky-300"> Rain Painter</strong> stamps precipitation intensity to guide where subsequent hydraulic erosion originates!
              </p>
            </div>
          </div>
        )}

        {/* TAB 4: SATMAP LIBRARY */}
        {activeTab === 'satmaps' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between pb-1 border-b border-[#1f2334]">
              <span className="text-xs font-bold text-gray-200">QuadSpinner SatMap CLUT Library</span>
              <span className="text-[10px] text-gray-500 font-mono">Satellite Color Ramps</span>
            </div>

            {satMapLayer ? (
              <SatMapBrowser
                selectedPresetId={satMapLayer.presetId}
                onSelectPreset={(presetId, category) => {
                  onUpdateLayer(satMapLayer.id, { presetId, category });
                }}
              />
            ) : (
              <div className="p-3 bg-[#141620] border border-[#232736] rounded-xl text-center flex flex-col gap-2">
                <p className="text-xs text-gray-400">No active SatMap Color layer found in stack.</p>
                <button
                  onClick={() => onAddLayer('satmap_color')}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold"
                >
                  Add SatMap Layer
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: EXPORT PANEL */}
        {activeTab === 'export' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between pb-1 border-b border-[#1f2334]">
              <span className="text-xs font-bold text-gray-200">Asset &amp; Data Exporter</span>
              <span className="text-[10px] text-gray-500 font-mono">Production Ready</span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {/* 16-bit Heightmap */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">Heightmap (PNG)</span>
                  <span className="text-[10px] text-gray-400">8-bit standard grayscale map</span>
                </div>
                <button
                  onClick={() => simulationResult && exportHeightmapPNG(simulationResult)}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  PNG
                </button>
              </div>

              {/* 16-bit RAW Heightmap */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">16-bit RAW Heightmap</span>
                  <span className="text-[10px] text-gray-400">Lossless 65536 elevation steps (Unreal/Unity)</span>
                </div>
                <button
                  onClick={() => simulationResult && exportRaw16Heightmap(simulationResult)}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  RAW
                </button>
              </div>

              {/* 3D Wavefront OBJ */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">3D Mesh (.obj)</span>
                  <span className="text-[10px] text-gray-400">Wavefront geometry with UVs and Normals</span>
                </div>
                <button
                  onClick={() => simulationResult && exportObjMesh(simulationResult)}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  OBJ
                </button>
              </div>

              {/* SatMap Albedo Texture */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">SatMap Albedo Texture</span>
                  <span className="text-[10px] text-gray-400">High-resolution RGBA color map</span>
                </div>
                <button
                  onClick={() => simulationResult && exportSatMapAlbedoPNG(simulationResult)}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  PNG
                </button>
              </div>

              {/* River Flow Drainage Map */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">River Flow Map</span>
                  <span className="text-[10px] text-gray-400">Water runoff drainage channels</span>
                </div>
                <button
                  onClick={() => simulationResult && exportFlowMapPNG(simulationResult)}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  PNG
                </button>
              </div>

              {/* Talus Deposit Map */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">Deposit / Talus Map</span>
                  <span className="text-[10px] text-gray-400">Scree &amp; alluvium sedimentation</span>
                </div>
                <button
                  onClick={() => simulationResult && exportDepositMapPNG(simulationResult)}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  PNG
                </button>
              </div>

              {/* Normal Map */}
              <div className="p-2.5 bg-[#12141d] border border-[#222636] rounded-xl flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-200">Normal Map</span>
                  <span className="text-[10px] text-gray-400">Tangent-space RGB normal map</span>
                </div>
                <button
                  onClick={() => simulationResult && exportNormalMapPNG(simulationResult)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow"
                >
                  PNG
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 border-t border-[#1f2334] bg-[#0c0d14] text-[10px] text-gray-500 flex items-center justify-between">
        <span>Gaea Algorithm Parity</span>
        <span className="font-mono text-gray-400">SPMD · Downcutting · SatMaps</span>
      </div>
    </div>
  );
};
