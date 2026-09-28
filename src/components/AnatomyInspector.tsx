import React from 'react';
import { X, Info, Zap, Feather } from 'lucide-react';
import { AnatomicalHotspot } from '../eagle/EagleModel';

interface AnatomyInspectorProps {
  hotspot: AnatomicalHotspot | null;
  onClose: () => void;
  allHotspots: AnatomicalHotspot[];
  onSelectHotspot: (h: AnatomicalHotspot) => void;
}

export const AnatomyInspector: React.FC<AnatomyInspectorProps> = ({
  hotspot,
  onClose,
  allHotspots,
  onSelectHotspot,
}) => {
  if (!hotspot) return null;

  return (
    <div className="absolute top-6 left-6 w-96 bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-5 text-slate-100 z-30 animate-in fade-in slide-in-from-top-4 duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold">
              {hotspot.category} Anatomy
            </span>
            <h3 className="text-base font-bold text-white leading-tight">{hotspot.name}</h3>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Anatomical Structure */}
      <div className="space-y-3 text-xs leading-relaxed">
        <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/60">
          <div className="flex items-center space-x-1.5 text-slate-300 font-semibold mb-1">
            <Feather className="w-3.5 h-3.5 text-amber-400" />
            <span>Structural Anatomy</span>
          </div>
          <p className="text-slate-300">{hotspot.description}</p>
        </div>

        {/* Avian Biomechanics & Aerodynamics */}
        <div className="bg-amber-950/20 rounded-xl p-3 border border-amber-600/30">
          <div className="flex items-center space-x-1.5 text-amber-300 font-semibold mb-1">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Biomechanical & Aerodynamic Function</span>
          </div>
          <p className="text-amber-100/90">{hotspot.avianBiomechanics}</p>
        </div>
      </div>

      {/* Quick Switch to Other Anatomical Points */}
      <div className="mt-4 pt-3 border-t border-slate-800">
        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-2">
          Explore Other Structures
        </label>
        <div className="flex flex-wrap gap-1.5">
          {allHotspots.map((h) => (
            <button
              key={h.id}
              onClick={() => onSelectHotspot(h)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                h.id === hotspot.id
                  ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {h.id.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
