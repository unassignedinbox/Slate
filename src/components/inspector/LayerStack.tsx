// Slate Layer Stack Manager
// Replaces complex node graphs with a streamlined, Photoshop-style layer hierarchy
// Supports layer reordering, visibility toggles, blend modes, opacities, and adding new passes.

import React, { useState } from 'react';
import {
  Layers,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Plus,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type { TerrainLayer, LayerType, BlendMode } from '../../types/terrain';

interface LayerStackProps {
  layers: TerrainLayer[];
  selectedLayerId: string;
  onSelectLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<TerrainLayer>) => void;
  onMoveLayer: (index: number, direction: 'up' | 'down') => void;
  onDuplicateLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onAddLayer: (type: LayerType) => void;
}

export const LayerStack: React.FC<LayerStackProps> = ({
  layers,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onAddLayer,
}) => {
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Layer category icon & style helper
  const getLayerMeta = (type: LayerType) => {
    switch (type) {
      case 'mountain_generator':
        return { icon: '⛰️', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'voronoi_generator':
        return { icon: '💎', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'ridge_generator':
        return { icon: '🔪', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'plateau_generator':
        return { icon: '🏛️', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'caldera_generator':
        return { icon: '🌋', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'canyon_generator':
        return { icon: '🏞️', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'dunes_generator':
        return { icon: '🏜️', badge: 'Generator', color: 'text-purple-400 border-purple-500/30' };
      case 'sdf_sculpt':
        return { icon: '🖌️', badge: 'SDF Sculpt', color: 'text-emerald-400 border-emerald-500/30' };
      case 'hydraulic_erosion':
        return { icon: '🌊', badge: 'Erosion', color: 'text-cyan-400 border-cyan-500/30' };
      case 'rain_precipitation':
        return { icon: '🌧️', badge: 'Precipitation', color: 'text-sky-400 border-sky-500/30' };
      case 'alluvial_deposits':
        return { icon: '🌾', badge: 'Alluvium', color: 'text-amber-400 border-amber-500/30' };
      case 'rocky_thermal':
        return { icon: '🪨', badge: 'Rocky / Scree', color: 'text-orange-400 border-orange-500/30' };
      case 'strata_terrace':
        return { icon: '🪜', badge: 'Strata', color: 'text-yellow-400 border-yellow-500/30' };
      case 'displace_perturb':
        return { icon: '🌀', badge: 'Displace', color: 'text-indigo-400 border-indigo-500/30' };
      case 'satmap_color':
        return { icon: '🎨', badge: 'SatMap', color: 'text-rose-400 border-rose-500/30' };
      default:
        return { icon: '📄', badge: 'Layer', color: 'text-gray-400 border-gray-500/30' };
    }
  };

  const blendModes: BlendMode[] = [
    'normal',
    'add',
    'subtract',
    'multiply',
    'min',
    'max',
    'screen',
    'overlay',
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Header and Add Layer Button */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
            Layer Stack
          </span>
          <span className="text-[10px] font-mono text-gray-500 bg-[#161823] px-1.5 py-0.5 rounded border border-[#272a3a]">
            {layers.length}
          </span>
        </div>

        {/* Add Layer Menu */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Layer</span>
          </button>

          {showAddMenu && (
            <div className="absolute right-0 top-8 w-60 bg-[#141622]/98 backdrop-blur-xl border border-[#2c3144] rounded-xl p-2 shadow-2xl z-50 flex flex-col gap-2 text-xs">
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2">
                  Erosion &amp; Weathering
                </span>
                <div className="flex flex-col mt-1 gap-0.5">
                  <button
                    onClick={() => {
                      onAddLayer('hydraulic_erosion');
                      setShowAddMenu(false);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#202538] text-gray-200 text-left"
                  >
                    <span>🌊</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px]">Hydraulic Erosion</span>
                      <span className="text-[10px] text-gray-400">Gaea stream downcutting &amp; sediment</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('rain_precipitation');
                      setShowAddMenu(false);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#202538] text-gray-200 text-left"
                  >
                    <span>🌧️</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px]">Rain (Precipitation)</span>
                      <span className="text-[10px] text-gray-400">Orographic lift &amp; rain shadow</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('alluvial_deposits');
                      setShowAddMenu(false);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#202538] text-gray-200 text-left"
                  >
                    <span>🌾</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px]">Alluvium &amp; Deposits</span>
                      <span className="text-[10px] text-gray-400">Crevice filling &amp; alluvial fans</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('rocky_thermal');
                      setShowAddMenu(false);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#202538] text-gray-200 text-left"
                  >
                    <span>🪨</span>
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px]">Rocky / Thermal</span>
                      <span className="text-[10px] text-gray-400">Angle of repose scree &amp; shatter</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="border-t border-[#232738] pt-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2">
                  Terrain Generators
                </span>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <button
                    onClick={() => {
                      onAddLayer('mountain_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>⛰️</span>
                    <span className="text-[11px]">Mountain</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('ridge_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🔪</span>
                    <span className="text-[11px]">Razor Ridge</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('voronoi_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>💎</span>
                    <span className="text-[11px]">Voronoi Peak</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('plateau_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🏛️</span>
                    <span className="text-[11px]">Mesa Plateau</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('caldera_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🌋</span>
                    <span className="text-[11px]">Caldera</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('canyon_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🏞️</span>
                    <span className="text-[11px]">Canyon</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('dunes_generator');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🏜️</span>
                    <span className="text-[11px]">Sand Dunes</span>
                  </button>
                </div>
              </div>

              <div className="border-t border-[#232738] pt-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-2">
                  Sculpt &amp; Modifiers
                </span>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <button
                    onClick={() => {
                      onAddLayer('sdf_sculpt');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🖌️</span>
                    <span className="text-[11px]">SDF Sculpt</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('satmap_color');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🎨</span>
                    <span className="text-[11px]">SatMap Color</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('strata_terrace');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🪜</span>
                    <span className="text-[11px]">Strata Terrace</span>
                  </button>
                  <button
                    onClick={() => {
                      onAddLayer('displace_perturb');
                      setShowAddMenu(false);
                    }}
                    className="p-1.5 rounded hover:bg-[#202538] text-gray-200 text-left flex items-center gap-1.5"
                  >
                    <span>🌀</span>
                    <span className="text-[11px]">Displace Warp</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Layer List (Ordered Stack) */}
      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
        {layers.map((layer, index) => {
          const isSelected = layer.id === selectedLayerId;
          const meta = getLayerMeta(layer.type);

          return (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`p-2 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                isSelected
                  ? 'bg-[#181c2b] border-blue-500 ring-1 ring-blue-500/40 shadow-md'
                  : 'bg-[#12141d] border-[#222636] hover:bg-[#161925] hover:border-gray-600'
              } ${!layer.enabled ? 'opacity-50' : ''}`}
            >
              {/* Layer Title Row */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  {/* Eye Toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateLayer(layer.id, { enabled: !layer.enabled });
                    }}
                    className="text-gray-400 hover:text-white transition-colors"
                    title={layer.enabled ? 'Mute Layer' : 'Enable Layer'}
                  >
                    {layer.enabled ? <Eye className="w-3.5 h-3.5 text-blue-400" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  </button>

                  <span className="text-sm">{meta.icon}</span>

                  <input
                    type="text"
                    value={layer.name}
                    onChange={(e) => onUpdateLayer(layer.id, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent text-xs font-semibold text-gray-200 focus:outline-none focus:bg-[#202538] px-1 rounded truncate max-w-[130px]"
                  />
                </div>

                {/* Layer Badge & Actions */}
                <div className="flex items-center gap-1">
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${meta.color}`}>
                    {meta.badge}
                  </span>

                  {/* Move Up / Down */}
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveLayer(index, 'up');
                    }}
                    className="p-0.5 text-gray-400 hover:text-white disabled:opacity-20"
                    title="Move Layer Up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={index === layers.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveLayer(index, 'down');
                    }}
                    className="p-0.5 text-gray-400 hover:text-white disabled:opacity-20"
                    title="Move Layer Down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>

                  {/* Duplicate */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateLayer(layer.id);
                    }}
                    className="p-0.5 text-gray-400 hover:text-white"
                    title="Duplicate Layer"
                  >
                    <Copy className="w-3 h-3" />
                  </button>

                  {/* Delete (if more than 1 layer) */}
                  {layers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLayer(layer.id);
                      }}
                      className="p-0.5 text-gray-400 hover:text-rose-400"
                      title="Delete Layer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Blend Mode & Opacity Slider */}
              <div
                className="flex items-center gap-2 pt-1 border-t border-[#1e2230]"
                onClick={(e) => e.stopPropagation()}
              >
                <select
                  value={layer.blendMode}
                  onChange={(e) => onUpdateLayer(layer.id, { blendMode: e.target.value as BlendMode })}
                  className="bg-[#181c28] text-gray-300 text-[10px] font-medium rounded px-1.5 py-0.5 border border-[#2b3042] focus:outline-none"
                >
                  {blendModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode.toUpperCase()}
                    </option>
                  ))}
                </select>

                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={layer.opacity}
                    onChange={(e) => onUpdateLayer(layer.id, { opacity: Number(e.target.value) })}
                    className="w-full h-1 bg-[#252a3b] rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-gray-400 w-7 text-right">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
