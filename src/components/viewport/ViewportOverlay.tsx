// Slate Viewport HUD & Overlay Controls
// Offers professional workstation toolbar: Shading mode selector, lighting, wireframe, camera, and simulation HUD

import React, { useState } from 'react';
import {
  Sun,
  Layers,
  Camera,
  Play,
  RotateCcw,
  Sparkles,
  Droplets,
  Eye,
  Grid,
  Download,
  Activity,
  Sliders,
} from 'lucide-react';
import type {
  ViewportSettings,
  ViewportShadingMode,
  TerrainSimulationResult,
} from '../../types/terrain';

interface ViewportOverlayProps {
  viewportSettings: ViewportSettings;
  onUpdateViewportSettings: (settings: Partial<ViewportSettings>) => void;
  simulationResult: TerrainSimulationResult | null;
  resolution: number;
  onChangeResolution: (res: number) => void;
  onStepErosion: (steps: number) => void;
  onBakeAll: () => void;
  onResetTerrain: () => void;
  onExportMesh: () => void;
  onExportHeightmap: () => void;
  onExportSatMap: () => void;
  isProcessing: boolean;
}

export const ViewportOverlay: React.FC<ViewportOverlayProps> = ({
  viewportSettings,
  onUpdateViewportSettings,
  simulationResult,
  resolution,
  onChangeResolution,
  onStepErosion,
  onBakeAll,
  onResetTerrain,
  onExportMesh,
  onExportHeightmap,
  onExportSatMap,
  isProcessing,
}) => {
  const [showLightMenu, setShowLightMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const shadingModes: { id: ViewportShadingMode; label: string; icon: string }[] = [
    { id: 'satmap', label: 'SatMap', icon: '🎨' },
    { id: 'height', label: 'Height', icon: '⛰️' },
    { id: 'wear', label: 'Wear Map', icon: '⚡' },
    { id: 'deposit', label: 'Deposit Map', icon: '🪵' },
    { id: 'flow', label: 'Flow (Rivers)', icon: '🌊' },
    { id: 'slope', label: 'Slope', icon: '📐' },
    { id: 'normal', label: 'Normals', icon: '🧭' },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 select-none">
      {/* Top Controls Bar */}
      <div className="flex items-center justify-between pointer-events-auto gap-2">
        {/* Left: Shading Modes */}
        <div className="flex items-center bg-[#141620]/90 backdrop-blur-md border border-[#272b3c] rounded-lg p-1 shadow-2xl">
          {shadingModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onUpdateViewportSettings({ shadingMode: mode.id })}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                viewportSettings.shadingMode === mode.id
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
              }`}
              title={`Switch Shading Mode to ${mode.label}`}
            >
              <span>{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>

        {/* Right: Viewport Display Toggles */}
        <div className="flex items-center gap-2">
          {/* Wireframe toggle */}
          <button
            onClick={() => onUpdateViewportSettings({ wireframe: !viewportSettings.wireframe })}
            className={`p-1.5 rounded-lg border text-xs font-medium transition-all ${
              viewportSettings.wireframe
                ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                : 'bg-[#141620]/90 border-[#272b3c] text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
            }`}
            title="Toggle Wireframe Grid"
          >
            <Grid className="w-4 h-4" />
          </button>

          {/* Water Surface toggle */}
          <button
            onClick={() => onUpdateViewportSettings({ showWater: !viewportSettings.showWater })}
            className={`p-1.5 rounded-lg border text-xs font-medium transition-all ${
              viewportSettings.showWater
                ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300'
                : 'bg-[#141620]/90 border-[#272b3c] text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
            }`}
            title="Toggle Water Surface Level"
          >
            <Droplets className="w-4 h-4" />
          </button>

          {/* 2D/3D Camera Mode Toggle */}
          <button
            onClick={() => onUpdateViewportSettings({ is2DView: !viewportSettings.is2DView })}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all ${
              viewportSettings.is2DView
                ? 'bg-amber-600/30 border-amber-500 text-amber-300 font-semibold'
                : 'bg-[#141620]/90 border-[#272b3c] text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
            }`}
            title="Switch between 3D Perspective and 2D Top-Down Map View"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{viewportSettings.is2DView ? '2D Map' : '3D Orbit'}</span>
          </button>

          {/* Sun / Lighting Popover */}
          <div className="relative">
            <button
              onClick={() => setShowLightMenu(!showLightMenu)}
              className={`p-1.5 rounded-lg border text-xs transition-all ${
                showLightMenu
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#141620]/90 border-[#272b3c] text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
              }`}
              title="Sun Position & Elevation"
            >
              <Sun className="w-4 h-4" />
            </button>

            {showLightMenu && (
              <div className="absolute right-0 top-10 w-64 bg-[#141620]/95 backdrop-blur-xl border border-[#2e344a] rounded-xl p-3 shadow-2xl z-50 flex flex-col gap-3">
                <div className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Sun & Lighting Controls</span>
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                    <span>Sun Azimuth</span>
                    <span className="font-mono text-gray-300">{viewportSettings.sunAzimuth}°</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={viewportSettings.sunAzimuth}
                    onChange={(e) => onUpdateViewportSettings({ sunAzimuth: Number(e.target.value) })}
                    className="w-full h-1.5 bg-[#252a3d] rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                    <span>Sun Elevation</span>
                    <span className="font-mono text-gray-300">{viewportSettings.sunElevation}°</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="85"
                    value={viewportSettings.sunElevation}
                    onChange={(e) => onUpdateViewportSettings({ sunElevation: Number(e.target.value) })}
                    className="w-full h-1.5 bg-[#252a3d] rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                    <span>Terrain Height Scale</span>
                    <span className="font-mono text-gray-300">{viewportSettings.heightScale}x</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="70"
                    value={viewportSettings.heightScale}
                    onChange={(e) => onUpdateViewportSettings({ heightScale: Number(e.target.value) })}
                    className="w-full h-1.5 bg-[#252a3d] rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                {viewportSettings.showWater && (
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                      <span>Water Level</span>
                      <span className="font-mono text-cyan-400">{Math.round(viewportSettings.waterLevel * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={viewportSettings.waterLevel}
                      onChange={(e) => onUpdateViewportSettings({ waterLevel: Number(e.target.value) })}
                      className="w-full h-1.5 bg-[#252a3d] rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-10 w-52 bg-[#141620]/95 backdrop-blur-xl border border-[#2e344a] rounded-xl p-2 shadow-2xl z-50 flex flex-col gap-1">
                <button
                  onClick={() => {
                    onExportHeightmap();
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white hover:bg-[#23283b] transition-all flex items-center justify-between"
                >
                  <span>16-bit Heightmap (PNG)</span>
                  <span className="text-[10px] text-gray-500">.png</span>
                </button>
                <button
                  onClick={() => {
                    onExportMesh();
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white hover:bg-[#23283b] transition-all flex items-center justify-between"
                >
                  <span>3D Mesh (Wavefront)</span>
                  <span className="text-[10px] text-gray-500">.obj</span>
                </button>
                <button
                  onClick={() => {
                    onExportSatMap();
                    setShowExportMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white hover:bg-[#23283b] transition-all flex items-center justify-between"
                >
                  <span>SatMap Albedo Texture</span>
                  <span className="text-[10px] text-gray-500">.png</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom HUD: Simulation & Resolution Bar */}
      <div className="flex items-center justify-between pointer-events-auto">
        {/* Left Stats & Status */}
        <div className="flex items-center gap-3 bg-[#141620]/90 backdrop-blur-md border border-[#272b3c] rounded-lg px-3 py-1.5 text-xs text-gray-300 shadow-xl">
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-gray-400">Time:</span>
            <span className="font-mono text-emerald-300 font-semibold">
              {simulationResult?.executionTimeMs ?? 0}ms
            </span>
          </div>
          <div className="w-px h-3.5 bg-[#2a2e40]" />
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Elevation:</span>
            <span className="font-mono text-gray-200">
              {Math.round((simulationResult?.minHeight ?? 0) * 3500)}m – {Math.round((simulationResult?.maxHeight ?? 1) * 3500)}m
            </span>
          </div>
          <div className="w-px h-3.5 bg-[#2a2e40]" />
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Grid:</span>
            <span className="font-mono text-blue-400 font-medium">
              {resolution} × {resolution}
            </span>
          </div>
        </div>

        {/* Center: Interactive Simulation Stepper */}
        <div className="flex items-center gap-2 bg-[#141620]/90 backdrop-blur-md border border-[#272b3c] rounded-lg p-1 shadow-xl">
          <button
            onClick={() => onStepErosion(25)}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-200 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-800/50 rounded-md transition-all disabled:opacity-50"
            title="Run 25 hydraulic erosion simulation steps"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>+25 Steps</span>
          </button>
          <button
            onClick={onBakeAll}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md shadow transition-all disabled:opacity-50"
            title="Recompute all layer stack generators and erosion"
          >
            <Sparkles className="w-3 h-3" />
            <span>{isProcessing ? 'Baking...' : 'Recompute All'}</span>
          </button>
          <button
            onClick={onResetTerrain}
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-[#212638] rounded-md transition-all"
            title="Reset Sculpt Strokes & Re-evaluate"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Resolution Switcher */}
        <div className="flex items-center bg-[#141620]/90 backdrop-blur-md border border-[#272b3c] rounded-lg p-1 text-xs shadow-xl">
          <span className="text-[11px] text-gray-400 px-2">Resolution:</span>
          {[128, 256, 512, 1024].map((res) => (
            <button
              key={res}
              onClick={() => onChangeResolution(res)}
              className={`px-2 py-0.5 font-mono text-[11px] rounded transition-all ${
                resolution === res
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-[#1f2333]'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
