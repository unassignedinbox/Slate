import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Wind,
  Footprints,
  Eye,
  Volume2,
  Skull,
  Activity,
  Layers,
  Sparkles,
  Compass,
  VolumeX,
  Crosshair,
} from 'lucide-react';
import { AnimationType } from '../eagle/AnimationEngine';
import { PlumageType } from '../eagle/EagleModel';
import { CameraPreset, EnvironmentType } from './Viewport';

interface ControlPanelProps {
  currentAnim: AnimationType;
  onAnimChange: (anim: AnimationType) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  plumage: PlumageType;
  onPlumageChange: (type: PlumageType) => void;
  showSkeleton: boolean;
  onToggleSkeleton: () => void;
  showAerodynamics: boolean;
  onToggleAerodynamics: () => void;
  showFeathersOnly: boolean;
  onToggleFeathersOnly: () => void;
  environment: EnvironmentType;
  onEnvironmentChange: (env: EnvironmentType) => void;
  cameraPreset: CameraPreset;
  onCameraPresetChange: (preset: CameraPreset) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onTriggerScreech: () => void;
  cursorTracking: boolean;
  onToggleCursorTracking: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  currentAnim,
  onAnimChange,
  speed,
  onSpeedChange,
  isPaused,
  onTogglePause,
  plumage,
  onPlumageChange,
  showSkeleton,
  onToggleSkeleton,
  showAerodynamics,
  onToggleAerodynamics,
  showFeathersOnly,
  onToggleFeathersOnly,
  environment,
  onEnvironmentChange,
  cameraPreset,
  onCameraPresetChange,
  isMuted,
  onToggleMute,
  onTriggerScreech,
  cursorTracking,
  onToggleCursorTracking,
}) => {
  const animations: {
    id: AnimationType;
    label: string;
    icon: React.ReactNode;
    desc: string;
    biomechanics: string;
  }[] = [
    {
      id: 'flap',
      label: 'Wing Flap Cycle',
      icon: <Wind className="w-4 h-4" />,
      desc: 'Powerful downstroke & drag-reducing wrist-folding upstroke',
      biomechanics: 'Pectoralis major downstroke thrust with dynamic primary feather splay & body heave.',
    },
    {
      id: 'glide',
      label: 'Glide / Soar Cycle',
      icon: <Sparkles className="w-4 h-4" />,
      desc: 'Thermal soaring equilibrium with slotted wingtip airfoils',
      biomechanics: 'Outer primaries P6-P10 splay to diffuse induced vortices; micro tail rudder trims.',
    },
    {
      id: 'walk',
      label: 'Walk Cycle (Ground)',
      icon: <Footprints className="w-4 h-4" />,
      desc: 'Alternating digitigrade raptor stride with curled talons',
      biomechanics: 'Talon curling during swing phase, lateral waddling mass shift, saccadic head-bobbing.',
    },
    {
      id: 'idle',
      label: 'Idle / Perched',
      icon: <Activity className="w-4 h-4" />,
      desc: 'Respiration keel expansion, subtle weight shifts & glances',
      biomechanics: 'Deep thoracic breathing, nictitating eye sweeps, and balance micro-corrections.',
    },
    {
      id: 'screech',
      label: 'Screech & Display',
      icon: <Volume2 className="w-4 h-4" />,
      desc: 'Aggressive vocal display, 45° gape, crop swelling & mantling',
      biomechanics: 'Craned neck, maxilla/mandible gape, syrinx acoustic vibration & flared mantle.',
    },
    {
      id: 'head_turn',
      label: 'Head Turn / Saccades',
      icon: <Eye className="w-4 h-4" />,
      desc: 'Rapid raptorial saccades, 45° head cocking & depth scans',
      biomechanics: 'Fixed retinal sockets require rapid saccades and triangulation head tilts for stereo depth.',
    },
  ];

  return (
    <div className="w-96 h-full bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 text-slate-100 flex flex-col justify-between overflow-y-auto p-5 select-none shadow-2xl z-20">
      {/* 1. Header & Quick Controls */}
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-amber-400 tracking-wide flex items-center space-x-2">
              <span>Biomechanical Rig</span>
            </h2>
            <div className="flex items-center space-x-1.5">
              <button
                onClick={onToggleMute}
                className={`p-1.5 rounded-lg border transition-all ${
                  isMuted
                    ? 'bg-rose-950/40 border-rose-700/60 text-rose-400'
                    : 'bg-slate-800 border-slate-700 text-amber-400 hover:border-amber-400'
                }`}
                title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">Accurate Avian Anatomy & Motion Engine</p>
        </div>

        {/* 2. Animations List */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Animation Cycles
          </label>
          <div className="grid grid-cols-1 gap-2">
            {animations.map((anim) => {
              const isActive = currentAnim === anim.id;
              return (
                <button
                  key={anim.id}
                  onClick={() => onAnimChange(anim.id)}
                  className={`flex flex-col p-2.5 rounded-xl border text-left transition-all duration-200 ${
                    isActive
                      ? 'bg-amber-500/15 border-amber-500 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50'
                      : 'bg-slate-800/60 border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className={`${isActive ? 'text-amber-400' : 'text-slate-400'}`}>{anim.icon}</span>
                      <span className="text-sm font-semibold">{anim.label}</span>
                    </div>
                    {isActive && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-300 border border-amber-500/40 uppercase">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-1">{anim.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Playback Controls & Speed Scrubber */}
        <div className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Playback Engine</span>
            <span className="text-xs font-mono text-amber-400 font-bold">{speed.toFixed(2)}x Speed</span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onTogglePause}
              className={`flex-1 py-2 rounded-lg font-medium text-xs flex items-center justify-center space-x-1.5 transition-all ${
                isPaused
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold shadow-lg shadow-amber-500/30'
              }`}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>

            <button
              onClick={() => onSpeedChange(1.0)}
              className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 hover:text-white transition-colors"
              title="Reset Speed (1.0x)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Speed Slider with Slow-Mo markers */}
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>0.1x (Slow-Mo)</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.05"
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
            />
          </div>

          {/* Screech Quick Trigger Button */}
          <button
            onClick={onTriggerScreech}
            className="w-full py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Trigger Raptor Screech Vocal</span>
          </button>
        </div>

        {/* 4. Species & Plumage Morphs */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Plumage & Species
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onPlumageChange('bald_eagle')}
              className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                plumage === 'bald_eagle'
                  ? 'bg-amber-500/20 border-amber-500 text-white ring-1 ring-amber-500/40'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <div className="font-semibold text-slate-100">Bald Eagle</div>
              <div className="text-[10px] text-slate-400">Haliaeetus leucocephalus</div>
            </button>

            <button
              onClick={() => onPlumageChange('golden_eagle')}
              className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                plumage === 'golden_eagle'
                  ? 'bg-amber-500/20 border-amber-500 text-white ring-1 ring-amber-500/40'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <div className="font-semibold text-slate-100">Golden Eagle</div>
              <div className="text-[10px] text-slate-400">Aquila chrysaetos</div>
            </button>
          </div>
        </div>

        {/* 5. Inspection Modes & Visual Layers */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Inspection Modes & Layers
          </label>
          <div className="grid grid-cols-2 gap-2">
            {/* Skeletal X-Ray */}
            <button
              onClick={onToggleSkeleton}
              className={`flex items-center space-x-2 p-2 rounded-lg border text-xs font-medium transition-all ${
                showSkeleton
                  ? 'bg-blue-600/30 border-blue-400 text-blue-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Skull className="w-3.5 h-3.5 text-blue-400" />
              <span>Skeletal X-Ray</span>
            </button>

            {/* Aerodynamic Streamlines */}
            <button
              onClick={onToggleAerodynamics}
              className={`flex items-center space-x-2 p-2 rounded-lg border text-xs font-medium transition-all ${
                showAerodynamics
                  ? 'bg-cyan-600/30 border-cyan-400 text-cyan-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Wind className="w-3.5 h-3.5 text-cyan-400" />
              <span>Aero Streamlines</span>
            </button>

            {/* Feather Layer Isolation */}
            <button
              onClick={onToggleFeathersOnly}
              className={`flex items-center space-x-2 p-2 rounded-lg border text-xs font-medium transition-all ${
                showFeathersOnly
                  ? 'bg-amber-600/30 border-amber-400 text-amber-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Feathers Only</span>
            </button>

            {/* Interactive Cursor Tracking */}
            <button
              onClick={onToggleCursorTracking}
              className={`flex items-center space-x-2 p-2 rounded-lg border text-xs font-medium transition-all ${
                cursorTracking
                  ? 'bg-emerald-600/30 border-emerald-400 text-emerald-200'
                  : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cursor Gaze</span>
            </button>
          </div>
        </div>

        {/* 6. Environment & Lighting Presets */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
            Environment & Lighting
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(
              [
                { id: 'alpine_sky', label: 'Alpine Sky' },
                { id: 'canyon_ground', label: 'Canyon Ground' },
                { id: 'sunset_golden', label: 'Golden Sunset' },
                { id: 'studio', label: 'Studio Stage' },
              ] as { id: EnvironmentType; label: string }[]
            ).map((env) => (
              <button
                key={env.id}
                onClick={() => onEnvironmentChange(env.id)}
                className={`py-1.5 px-2.5 rounded-lg border font-medium text-left transition-all ${
                  environment === env.id
                    ? 'bg-slate-700 border-amber-500 text-amber-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800'
                }`}
              >
                {env.label}
              </button>
            ))}
          </div>
        </div>

        {/* 7. Camera Perspectives */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
            <Compass className="w-3.5 h-3.5" />
            <span>Camera Presets</span>
          </label>
          <div className="grid grid-cols-3 gap-1.5 text-[11px]">
            {(
              [
                { id: 'free', label: 'Free Orbit' },
                { id: 'cinematic', label: 'Cinematic' },
                { id: 'aero_top', label: 'Dorsal Aero' },
                { id: 'head_closeup', label: 'Raptor Head' },
                { id: 'wingtip', label: 'Wingtip Slots' },
                { id: 'talons_low', label: 'Talons' },
              ] as { id: CameraPreset; label: string }[]
            ).map((cam) => (
              <button
                key={cam.id}
                onClick={() => onCameraPresetChange(cam.id)}
                className={`py-1.5 px-2 rounded-lg border font-medium text-center transition-all ${
                  cameraPreset === cam.id
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                    : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {cam.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 8. Footer Specs */}
      <div className="pt-4 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
        <div className="flex justify-between">
          <span>Wingspan:</span>
          <span className="font-mono text-slate-200">2.10 m (6.9 ft)</span>
        </div>
        <div className="flex justify-between">
          <span>Primary Feathers:</span>
          <span className="font-mono text-slate-200">10 (P1-P10 slotted)</span>
        </div>
        <div className="flex justify-between">
          <span>Secondary Feathers:</span>
          <span className="font-mono text-slate-200">14 (S1-S14)</span>
        </div>
        <div className="flex justify-between">
          <span>Talon Pressure:</span>
          <span className="font-mono text-slate-200">&gt;400 psi</span>
        </div>
      </div>
    </div>
  );
};
