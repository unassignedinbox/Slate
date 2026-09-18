// Slate Layer Properties Inspector
// Provides fine-grained parameters for each layer matching QuadSpinner Gaea algorithms

import React from 'react';
import type { TerrainLayer } from '../../types/terrain';
import { SatMapBrowser } from './SatMapBrowser';

interface LayerPropertiesProps {
  layer: TerrainLayer;
  onUpdate: (updates: Partial<TerrainLayer>) => void;
}

export const LayerProperties: React.FC<LayerPropertiesProps> = ({ layer, onUpdate }) => {
  return (
    <div className="flex flex-col gap-3">
      {/* Dynamic Properties by Layer Type */}
      {/* 1. HYDRAULIC EROSION (GAEA DOWN-CUTTING & FLUVIAL) */}
      {layer.type === 'hydraulic_erosion' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-cyan-300">Gaea Hydraulic Erosion</span>
            <span className="text-[10px] text-gray-500 font-mono">SPMD Simulation</span>
          </div>

          {/* Iterations */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Iterations</span>
              <span className="font-mono text-cyan-300">{layer.iterations}</span>
            </div>
            <input
              type="range"
              min="10"
              max="200"
              step="5"
              value={layer.iterations}
              onChange={(e) => onUpdate({ iterations: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Downcutting */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Downcutting (Vertical Incision)</span>
              <span className="font-mono text-cyan-300">{Math.round(layer.downcutting * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.downcutting}
              onChange={(e) => onUpdate({ downcutting: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Vertical stream power gouging deep V-shaped river gullies
            </span>
          </div>

          {/* Inhibition */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Inhibition (Sediment Brake)</span>
              <span className="font-mono text-cyan-300">{Math.round(layer.inhibition * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.inhibition}
              onChange={(e) => onUpdate({ inhibition: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Restrains downcutting when sediment gathers, forcing alluvial spreading
            </span>
          </div>

          {/* Erosion Scale */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Erosion Scale</span>
              <span className="font-mono text-cyan-300">{layer.erosionScale.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.3"
              max="2.5"
              step="0.1"
              value={layer.erosionScale}
              onChange={(e) => onUpdate({ erosionScale: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Sediment Carrying Capacity */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Sediment Capacity</span>
              <span className="font-mono text-cyan-300">{(layer.sedimentCapacity * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.4"
              step="0.01"
              value={layer.sedimentCapacity}
              onChange={(e) => onUpdate({ sedimentCapacity: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Rock Softness */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Rock Softness</span>
              <span className="font-mono text-cyan-300">{Math.round(layer.rockSoftness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={layer.rockSoftness}
              onChange={(e) => onUpdate({ rockSoftness: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Sediment Removal */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Sediment Removal</span>
              <span className="font-mono text-cyan-300">{Math.round(layer.sedimentRemoval * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="0.8"
              step="0.05"
              value={layer.sedimentRemoval}
              onChange={(e) => onUpdate({ sedimentRemoval: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* 2. RAIN / SELECTIVE PRECIPITATION */}
      {layer.type === 'rain_precipitation' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-sky-300">Orographic Rain &amp; Precipitation</span>
            <span className="text-[10px] text-gray-500 font-mono">Weathering Model</span>
          </div>

          {/* Precipitation Amount */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Precipitation Amount</span>
              <span className="font-mono text-sky-300">{layer.precipitationAmount.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.5"
              step="0.1"
              value={layer.precipitationAmount}
              onChange={(e) => onUpdate({ precipitationAmount: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Wind Angle */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Wind Direction Angle</span>
              <span className="font-mono text-sky-300">{layer.windAngle}°</span>
            </div>
            <input
              type="range"
              min="0"
              max="360"
              value={layer.windAngle}
              onChange={(e) => onUpdate({ windAngle: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Wind Strength / Orographic Lift */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Orographic Lift Strength</span>
              <span className="font-mono text-sky-300">{Math.round(layer.windStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.windStrength}
              onChange={(e) => onUpdate({ windStrength: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Enhances rainfall on windward mountain slopes
            </span>
          </div>

          {/* Rain Shadow Strength */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Rain Shadow Strength</span>
              <span className="font-mono text-sky-300">{Math.round(layer.rainShadowStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.rainShadowStrength}
              onChange={(e) => onUpdate({ rainShadowStrength: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Dries out the leeward side of mountain ridges
            </span>
          </div>

          {/* Altitude Bounds */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Alt Min</span>
                <span className="font-mono text-sky-300">{Math.round(layer.altitudeMin * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.8"
                step="0.05"
                value={layer.altitudeMin}
                onChange={(e) => onUpdate({ altitudeMin: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Alt Max</span>
                <span className="font-mono text-sky-300">{Math.round(layer.altitudeMax * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.0"
                step="0.05"
                value={layer.altitudeMax}
                onChange={(e) => onUpdate({ altitudeMax: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. ALLUVIAL & DEPOSITS */}
      {layer.type === 'alluvial_deposits' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-amber-300">Gaea Alluvium &amp; Deposits</span>
            <span className="text-[10px] text-gray-500 font-mono">Sediment Settling</span>
          </div>

          {/* Mode Selector */}
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">Alluvium Mode</label>
            <div className="grid grid-cols-3 gap-1">
              {[
                { id: 'crevices', label: 'Crevices' },
                { id: 'valley_fans', label: 'Valley Fans' },
                { id: 'drift', label: 'Drift' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => onUpdate({ mode: m.id as any })}
                  className={`py-1 text-[11px] font-semibold rounded border transition-all ${
                    layer.mode === m.id
                      ? 'bg-amber-600 text-white border-amber-500'
                      : 'bg-[#181c28] border-[#252a3a] text-gray-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Amount of Soil Deposits</span>
              <span className="font-mono text-amber-300">{Math.round(layer.amount * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={layer.amount}
              onChange={(e) => onUpdate({ amount: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Settling */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Settling Viscosity</span>
              <span className="font-mono text-amber-300">{Math.round(layer.settling * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.settling}
              onChange={(e) => onUpdate({ settling: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Chaos / Randomness */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Chaos (Sediment Drift)</span>
              <span className="font-mono text-amber-300">{Math.round(layer.chaos * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.chaos}
              onChange={(e) => onUpdate({ chaos: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* 4. ROCKY / THERMAL WEATHERING */}
      {layer.type === 'rocky_thermal' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-orange-300">Gaea Rocky &amp; Talus Scree</span>
            <span className="text-[10px] text-gray-500 font-mono">Mechanical Weathering</span>
          </div>

          {/* Angle of Repose */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Angle of Repose</span>
              <span className="font-mono text-orange-300">{layer.angleRepose}°</span>
            </div>
            <input
              type="range"
              min="24"
              max="48"
              value={layer.angleRepose}
              onChange={(e) => onUpdate({ angleRepose: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Critical slope threshold where unstable rock fails into scree
            </span>
          </div>

          {/* Talus Volume */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Talus Scree Volume</span>
              <span className="font-mono text-orange-300">{Math.round(layer.talusVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={layer.talusVolume}
              onChange={(e) => onUpdate({ talusVolume: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Rock Shatter Strength */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Cellular Rock Shatter</span>
              <span className="font-mono text-orange-300">{Math.round(layer.shatterStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.shatterStrength}
              onChange={(e) => onUpdate({ shatterStrength: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Fractures steep rock faces with cellular crags
            </span>
          </div>

          {/* Shatter Scale */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Shatter Scale</span>
              <span className="font-mono text-orange-300">{layer.shatterScale.toFixed(0)}</span>
            </div>
            <input
              type="range"
              min="8"
              max="60"
              value={layer.shatterScale}
              onChange={(e) => onUpdate({ shatterScale: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* 5. SATMAP SATELLITE GRADING */}
      {layer.type === 'satmap_color' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-rose-300">Gaea SatMap Library &amp; Shading</span>
            <span className="text-[10px] text-gray-500 font-mono">CLUT Satellite Texturing</span>
          </div>

          {/* Preset Picker */}
          <SatMapBrowser
            selectedPresetId={layer.presetId}
            onSelectPreset={(presetId, category) => onUpdate({ presetId, category })}
          />

          {/* Driver Mode */}
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">CLUT Driver Source</label>
            <select
              value={layer.driver}
              onChange={(e) => onUpdate({ driver: e.target.value as any })}
              className="w-full bg-[#181c28] text-gray-300 text-xs rounded p-1.5 border border-[#2b3042] focus:outline-none"
            >
              <option value="composite">Composite (Altitude + Slope + Wear)</option>
              <option value="elevation">Elevation Only</option>
              <option value="slope">Slope Angle</option>
              <option value="wear">Erosion Wear Map</option>
              <option value="deposit">Deposit Map (Talus)</option>
              <option value="flow">Flow Stream Network</option>
            </select>
          </div>

          {/* Slope Influence */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Slope Influence</span>
              <span className="font-mono text-rose-300">{Math.round(layer.slopeInfluence * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.slopeInfluence}
              onChange={(e) => onUpdate({ slopeInfluence: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Rock Highlight (Gaea Surfacer wind streaks) */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Surfacer Rock Highlight</span>
              <span className="font-mono text-rose-300">{Math.round(layer.rockHighlightStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.rockHighlightStrength}
              onChange={(e) => onUpdate({ rockHighlightStrength: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Brightens sharp ridges &amp; protruding rock spurs
            </span>
          </div>

          {/* Riverbed Flow Wetness */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Flow Bed Wetness</span>
              <span className="font-mono text-rose-300">{Math.round(layer.flowWetness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.flowWetness}
              onChange={(e) => onUpdate({ flowWetness: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[10px] text-gray-500">
              Darkens and saturates active river and stream beds
            </span>
          </div>

          {/* Deposit Silt Blend */}
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Sediment Silt Tint</span>
              <span className="font-mono text-rose-300">{Math.round(layer.depositSiltBlend * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={layer.depositSiltBlend}
              onChange={(e) => onUpdate({ depositSiltBlend: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Contrast & Saturation */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Contrast</span>
                <span className="font-mono text-rose-300">{layer.contrast.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.8"
                step="0.05"
                value={layer.contrast}
                onChange={(e) => onUpdate({ contrast: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Saturation</span>
                <span className="font-mono text-rose-300">{layer.saturation.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="1.8"
                step="0.05"
                value={layer.saturation}
                onChange={(e) => onUpdate({ saturation: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* 6. GENERATORS (MOUNTAIN, VORONOI, RIDGE, PLATEAU, CALDERA, CANYON, DUNES) */}
      {(layer.type === 'mountain_generator' ||
        layer.type === 'voronoi_generator' ||
        layer.type === 'ridge_generator' ||
        layer.type === 'plateau_generator' ||
        layer.type === 'caldera_generator' ||
        layer.type === 'canyon_generator' ||
        layer.type === 'dunes_generator') && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-purple-300">Procedural Terrain Generator</span>
            <span className="text-[10px] text-gray-500 font-mono">SDF Primitive</span>
          </div>

          {/* Scale */}
          {'scale' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Scale</span>
                <span className="font-mono text-purple-300">{layer.scale.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.4"
                max="4.0"
                step="0.1"
                value={layer.scale}
                onChange={(e) => onUpdate({ scale: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Height */}
          {'height' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Elevation Amplitude</span>
                <span className="font-mono text-purple-300">{Math.round(layer.height * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={layer.height}
                onChange={(e) => onUpdate({ height: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Octaves */}
          {'octaves' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Fractal Octaves</span>
                <span className="font-mono text-purple-300">{layer.octaves}</span>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                value={layer.octaves}
                onChange={(e) => onUpdate({ octaves: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Roughness */}
          {'roughness' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Roughness</span>
                <span className="font-mono text-purple-300">{Math.round(layer.roughness * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={layer.roughness}
                onChange={(e) => onUpdate({ roughness: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Voronoi Jitter */}
          {'jitter' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Cell Jitter</span>
                <span className="font-mono text-purple-300">{Math.round(layer.jitter * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={layer.jitter}
                onChange={(e) => onUpdate({ jitter: Number(e.target.value) })}
                className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
              />
            </div>
          )}

          {/* Seed */}
          {'seed' in layer && (
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Random Seed</span>
                <span className="font-mono text-purple-300">{layer.seed}</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={layer.seed}
                  onChange={(e) => onUpdate({ seed: Number(e.target.value) })}
                  className="flex-1 bg-[#181c28] text-gray-300 text-xs rounded px-2 py-1 border border-[#2b3042]"
                />
                <button
                  onClick={() => onUpdate({ seed: Math.floor(Math.random() * 99999) })}
                  className="px-2.5 py-1 bg-[#23283a] hover:bg-[#2c334a] text-gray-300 text-xs font-semibold rounded"
                >
                  🎲 Dice
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7. MODIFIERS: STRATA & DISPLACE */}
      {layer.type === 'strata_terrace' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-yellow-300">Geological Strata &amp; Terraces</span>
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Strata Frequency</span>
              <span className="font-mono text-yellow-300">{layer.frequency}</span>
            </div>
            <input
              type="range"
              min="4"
              max="35"
              value={layer.frequency}
              onChange={(e) => onUpdate({ frequency: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Shelf Sharpness</span>
              <span className="font-mono text-yellow-300">{Math.round(layer.sharpness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="0.95"
              step="0.05"
              value={layer.sharpness}
              onChange={(e) => onUpdate({ sharpness: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {layer.type === 'displace_perturb' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-[#242838]">
            <span className="text-xs font-bold text-indigo-300">Domain Displace &amp; Perturb</span>
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Displacement Strength</span>
              <span className="font-mono text-indigo-300">{Math.round(layer.strength * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.8"
              step="0.05"
              value={layer.strength}
              onChange={(e) => onUpdate({ strength: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Perturb Frequency</span>
              <span className="font-mono text-indigo-300">{layer.frequency.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="1.0"
              max="15.0"
              step="0.5"
              value={layer.frequency}
              onChange={(e) => onUpdate({ frequency: Number(e.target.value) })}
              className="w-full h-1.5 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Universal Layer Masking Section */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#242838]">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
          Layer Elevation &amp; Slope Masking
        </span>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex justify-between text-[10px] text-gray-400 mb-1">
              <span>Alt Min</span>
              <span className="font-mono text-gray-300">{Math.round(layer.maskAltitudeMin * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layer.maskAltitudeMin}
              onChange={(e) => onUpdate({ maskAltitudeMin: Number(e.target.value) })}
              className="w-full h-1 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-gray-400 mb-1">
              <span>Alt Max</span>
              <span className="font-mono text-gray-300">{Math.round(layer.maskAltitudeMax * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={layer.maskAltitudeMax}
              onChange={(e) => onUpdate({ maskAltitudeMax: Number(e.target.value) })}
              className="w-full h-1 bg-[#202535] rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="text-[11px] text-gray-400 flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={layer.maskInvert}
              onChange={(e) => onUpdate({ maskInvert: e.target.checked })}
              className="rounded bg-[#1a1d29] border-[#292f44]"
            />
            <span>Invert Altitude Mask</span>
          </label>
        </div>
      </div>
    </div>
  );
};
