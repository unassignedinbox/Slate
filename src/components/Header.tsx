import React from 'react';
import { BookOpen, HelpCircle } from 'lucide-react';
import { AnimationType } from '../eagle/AnimationEngine';
import { PlumageType } from '../eagle/EagleModel';

interface HeaderProps {
  currentAnim: AnimationType;
  plumage: PlumageType;
  onOpenBiomechanics: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentAnim, plumage, onOpenBiomechanics }) => {
  const animNames: Record<AnimationType, string> = {
    flap: 'Wing Flap Cycle',
    glide: 'Glide & Thermal Soaring',
    walk: 'Terrestrial Walk Cycle',
    idle: 'Idle & Respiration',
    screech: 'Screech & Display',
    head_turn: 'Raptor Head Saccades',
  };

  return (
    <header className="absolute top-0 left-0 right-96 h-14 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-6 z-20 select-none">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center font-black text-slate-950 shadow-lg shadow-amber-500/20 text-sm">
          🦅
        </div>
        <div>
          <h1 className="text-sm font-bold text-white flex items-center space-x-2">
            <span>Eagle 3D Biomechanical Studio</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {plumage === 'bald_eagle' ? 'Bald Eagle (H. leucocephalus)' : 'Golden Eagle (A. chrysaetos)'}
            </span>
          </h1>
          <p className="text-[11px] text-slate-400">
            Current Cycle:{' '}
            <span className="text-amber-400 font-semibold">{animNames[currentAnim]}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={onOpenBiomechanics}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-all"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-400" />
          <span>Avian Biomechanics Guide</span>
        </button>

        <div className="group relative">
          <button className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors">
            <HelpCircle className="w-4 h-4" />
          </button>
          <div className="absolute right-0 mt-2 w-64 bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 space-y-1.5">
            <div className="font-bold text-amber-400 mb-1">Keyboard Shortcuts</div>
            <div className="flex justify-between">
              <span className="font-mono text-slate-400">Space:</span>
              <span>Play / Pause</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-slate-400">1 - 6:</span>
              <span>Switch Animations</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-slate-400">X:</span>
              <span>Toggle Skeletal X-Ray</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-slate-400">M:</span>
              <span>Mute / Unmute Audio</span>
            </div>
            <div className="flex justify-between">
              <span className="font-mono text-slate-400">S:</span>
              <span>Trigger Screech</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
