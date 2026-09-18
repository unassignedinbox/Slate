// Slate SatMap Gradient Browser
// Visual preset selector showing authentic satellite color gradients categorized by biome

import React from 'react';
import { SATMAP_PRESETS } from '../../core/satmaps/library';
import type { SatMapPreset } from '../../types/terrain';

interface SatMapBrowserProps {
  selectedPresetId: string;
  onSelectPreset: (presetId: string, category: SatMapPreset['category']) => void;
}

export const SatMapBrowser: React.FC<SatMapBrowserProps> = ({
  selectedPresetId,
  onSelectPreset,
}) => {
  const [activeTab, setActiveTab] = React.useState<string>('all');

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'rocky', label: 'Rocky' },
    { id: 'desert', label: 'Desert' },
    { id: 'lush', label: 'Lush' },
    { id: 'arctic', label: 'Arctic' },
    { id: 'volcanic', label: 'Volcanic' },
    { id: 'badlands', label: 'Badlands' },
  ];

  const filteredPresets = activeTab === 'all'
    ? SATMAP_PRESETS
    : SATMAP_PRESETS.filter((p) => p.category === activeTab);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[#242838] pb-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-all ${
              activeTab === cat.id
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1e2b]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Preset Cards */}
      <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
        {filteredPresets.map((preset) => {
          const isSelected = preset.id === selectedPresetId;
          // Build CSS gradient string
          const gradientCss = `linear-gradient(to right, ${preset.stops
            .map((s) => `${s.color} ${(s.position * 100).toFixed(0)}%`)
            .join(', ')})`;

          return (
            <div
              key={preset.id}
              onClick={() => onSelectPreset(preset.id, preset.category)}
              className={`p-2 rounded-lg border cursor-pointer transition-all flex flex-col gap-1.5 ${
                isSelected
                  ? 'border-blue-500 bg-blue-950/20 shadow-md ring-1 ring-blue-500'
                  : 'border-[#242838] bg-[#12141c] hover:border-gray-600 hover:bg-[#171a24]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">{preset.name}</span>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">
                  {preset.category}
                </span>
              </div>

              {/* Gradient Preview Bar */}
              <div
                className="h-4 w-full rounded border border-black/30 shadow-inner"
                style={{ background: gradientCss }}
              />

              <p className="text-[10px] text-gray-400 line-clamp-1">{preset.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
