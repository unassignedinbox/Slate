// Slate SDF Sculpting Toolbar
// Interactive 3D terrain sculpting tools matching Gaea directed erosion workflows

import React from 'react';
import {
  Waves,
  Mountain,
  Eraser,
  CloudRain,
  Flame,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { BrushSettings, SculptTool } from '../../types/terrain';

interface SculptToolbarProps {
  brushSettings: BrushSettings;
  onUpdateBrush: (settings: Partial<BrushSettings>) => void;
  isSculptingActive: boolean;
  onToggleSculpting: () => void;
  onClearStrokes: () => void;
  strokeCount: number;
}

export const SculptToolbar: React.FC<SculptToolbarProps> = ({
  brushSettings,
  onUpdateBrush,
  isSculptingActive,
  onToggleSculpting,
  onClearStrokes,
  strokeCount,
}) => {
  const tools: { id: SculptTool; label: string; desc: string; icon: string }[] = [
    {
      id: 'carve_gully',
      label: 'Carve Gully',
      desc: 'Directed downcutting incision carving sharp V-shaped river ravines',
      icon: '🌊',
    },
    {
      id: 'deposit_talus',
      label: 'Deposit Talus',
      desc: 'Scree & sediment mound deposit constrained by angle of repose',
      icon: '🪵',
    },
    {
      id: 'alluvial_wash',
      label: 'Alluvial Wash',
      desc: 'Relaxes slopes and fills micro-crevices into alluvial flatbeds',
      icon: '🌿',
    },
    {
      id: 'rock_chisel',
      label: 'Rock Chisel',
      desc: 'Stamps cellular fractures and crags into steep cliff faces',
      icon: '⛏️',
    },
    {
      id: 'rain_painter',
      label: 'Rain Painter',
      desc: 'Paints selective rainfall mask to drive hydraulic erosion origin',
      icon: '🌧️',
    },
    {
      id: 'raise_peak',
      label: 'Raise Peak',
      desc: 'Organic mountain uplift with cosine falloff',
      icon: '⛰️',
    },
    {
      id: 'lower_valley',
      label: 'Lower Valley',
      desc: 'Depresses terrain into deep basins',
      icon: '🕳️',
    },
    {
      id: 'flatten_plateau',
      label: 'Plateau Level',
      desc: 'Flattens terrain towards target altitude',
      icon: '📐',
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3 bg-[#11131b] border border-[#232736] rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🖌️</span>
          <span className="text-xs font-bold text-gray-200">SDF Erosion Sculptor</span>
        </div>
        <button
          onClick={onToggleSculpting}
          className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
            isSculptingActive
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-1 ring-emerald-400'
              : 'bg-[#1b1f2d] text-gray-400 hover:text-white hover:bg-[#252b3d]'
          }`}
        >
          {isSculptingActive ? '● Sculpting ON' : '○ Sculpting OFF'}
        </button>
      </div>

      {isSculptingActive && (
        <p className="text-[11px] text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-2 leading-relaxed">
          Click and drag in the 3D viewport to sculpt directly with the active brush tool!
        </p>
      )}

      {/* Tool Selector Grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {tools.map((tool) => {
          const isSelected = brushSettings.tool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => onUpdateBrush({ tool: tool.id })}
              className={`p-2 rounded-lg border text-left transition-all flex items-center gap-2 ${
                isSelected
                  ? 'bg-blue-600/20 border-blue-500 text-white shadow-sm'
                  : 'bg-[#151822] border-[#222634] text-gray-400 hover:text-gray-200 hover:bg-[#1a1e2b]'
              }`}
              title={tool.desc}
            >
              <span className="text-sm">{tool.icon}</span>
              <div className="flex flex-col overflow-hidden">
                <span className="text-[11px] font-semibold truncate leading-tight">{tool.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Brush Parameters */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-[#232736]">
        {/* Brush Radius */}
        <div>
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Brush Radius</span>
            <span className="font-mono text-gray-200">{(brushSettings.radius * 100).toFixed(0)}m</span>
          </div>
          <input
            type="range"
            min="0.02"
            max="0.35"
            step="0.01"
            value={brushSettings.radius}
            onChange={(e) => onUpdateBrush({ radius: Number(e.target.value) })}
            className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Brush Strength */}
        <div>
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Brush Strength</span>
            <span className="font-mono text-gray-200">{Math.round(brushSettings.strength * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.05"
            max="1.0"
            step="0.05"
            value={brushSettings.strength}
            onChange={(e) => onUpdateBrush({ strength: Number(e.target.value) })}
            className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {brushSettings.tool === 'flatten_plateau' && (
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Target Altitude</span>
              <span className="font-mono text-blue-400">{Math.round(brushSettings.targetHeight * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={brushSettings.targetHeight}
              onChange={(e) => onUpdateBrush({ targetHeight: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        )}

        {/* Stroke Count & Clear */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-gray-500">Strokes Applied: {strokeCount}</span>
          {strokeCount > 0 && (
            <button
              onClick={onClearStrokes}
              className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline"
            >
              Clear Strokes
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
