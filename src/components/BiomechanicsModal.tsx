import React from 'react';
import { X, BookOpen, Wind, Compass, Sparkles, Activity } from 'lucide-react';

interface BiomechanicsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BiomechanicsModal: React.FC<BiomechanicsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Avian Biomechanics & Aerodynamics Reference</h2>
              <p className="text-xs text-slate-400">Scientific analysis of eagle flight kinematics and raptor mechanics</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-slate-300 text-sm leading-relaxed">
          {/* Section 1: Wing Flap Mechanics */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-2">
            <h3 className="font-bold text-amber-400 text-base flex items-center space-x-2">
              <Wind className="w-4 h-4" />
              <span>1. Wing Flap Kinematics (Downstroke & Recovery)</span>
            </h3>
            <p>
              In powered flapping flight, an eagle relies on two primary muscle groups anchored to the sternal keel: the
              <strong> Pectoralis major</strong> (powers the downward sweep) and the <strong>Supracoracoideus</strong> (acts
              as a pulley via the triosseal canal to elevate the wing).
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>
                <strong>Downstroke (Power Stroke):</strong> The wing is extended to its maximum 2.1m span and swept downward and forward. Outer primaries flex upward under aerodynamic lift, generating thrust and vertical climb.
              </li>
              <li>
                <strong>Upstroke (Recovery Stroke):</strong> To minimize negative aerodynamic drag, the eagle flexes its elbow and carpal wrist joint inward, folding the wing closer to the body and twisting (pronating) the primary feathers so air slices through rather than pushing the bird downward.
              </li>
            </ul>
          </div>

          {/* Section 2: Slotted Primaries & Induced Drag */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-2">
            <h3 className="font-bold text-amber-400 text-base flex items-center space-x-2">
              <Sparkles className="w-4 h-4" />
              <span>2. Slotted Wingtips & Vortex Dissipation</span>
            </h3>
            <p>
              High-aspect-ratio soaring birds like eagles have specialized <em>emarginations</em> on their outer primary
              feathers (P6 through P10).
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>
                When soaring in thermal updrafts, high pressure air beneath the wing flows upward through the slots between individual primary feathers.
              </li>
              <li>
                Each feather acts as an independent miniature airfoil, converting would-be turbulent tip vortices into multiple smaller, harmless vortices and generating additional forward thrust.
              </li>
            </ul>
          </div>

          {/* Section 3: Terrestrial Locomotion & Talon Dynamics */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-2">
            <h3 className="font-bold text-amber-400 text-base flex items-center space-x-2">
              <Activity className="w-4 h-4" />
              <span>3. Ground Locomotion & Predatory Talons</span>
            </h3>
            <p>
              Eagles are digitigrade terrestrial walkers. Their massive talons require specialized kinematic compensation:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>
                <strong>Talon Curling:</strong> During the swing phase of each step, the flexor tendons curl the razor claws backward so they do not snag on rocky ground.
              </li>
              <li>
                <strong>Digital Flexor Tendon Locking:</strong> Once clamped onto prey or a perch branch, ratcheting ridges on the tendon sheath lock the grip securely with &gt;400 psi of pressure without continuous muscular exertion.
              </li>
            </ul>
          </div>

          {/* Section 4: Raptor Vision & Saccades */}
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-4 space-y-2">
            <h3 className="font-bold text-amber-400 text-base flex items-center space-x-2">
              <Compass className="w-4 h-4" />
              <span>4. Raptor Saccadic Vision & Head Cocking</span>
            </h3>
            <p>
              Because an eagle's eyes are so large they fill the skull cavity and have minimal freedom to move within their bony sclerotic rings, raptors rely on rapid head saccades (20–50 ms snaps) and distinct 45° head-tilting maneuvers to triangulate depth using their dual foveae.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20"
          >
            Close Reference
          </button>
        </div>
      </div>
    </div>
  );
};
