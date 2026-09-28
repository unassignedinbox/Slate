import React, { useState, useEffect, useMemo } from 'react';
import { Viewport, EnvironmentType, CameraPreset } from './components/Viewport';
import { ControlPanel } from './components/ControlPanel';
import { Header } from './components/Header';
import { AnatomyInspector } from './components/AnatomyInspector';
import { BiomechanicsModal } from './components/BiomechanicsModal';
import { AnimationType } from './eagle/AnimationEngine';
import { PlumageType, AnatomicalHotspot, EagleModel } from './eagle/EagleModel';
import { EagleSoundEngine } from './audio/EagleSoundEngine';

export const App: React.FC = () => {
  const [currentAnim, setCurrentAnim] = useState<AnimationType>('flap');
  const [speed, setSpeed] = useState<number>(1.0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [plumage, setPlumage] = useState<PlumageType>('bald_eagle');
  const [showSkeleton, setShowSkeleton] = useState<boolean>(false);
  const [showAerodynamics, setShowAerodynamics] = useState<boolean>(false);
  const [showFeathersOnly, setShowFeathersOnly] = useState<boolean>(false);
  const [environment, setEnvironment] = useState<EnvironmentType>('alpine_sky');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('free');
  const [selectedHotspot, setSelectedHotspot] = useState<AnatomicalHotspot | null>(null);
  const [isBiomechanicsOpen, setIsBiomechanicsOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [cursorTracking, setCursorTracking] = useState<boolean>(false);

  const soundEngine = useMemo(() => new EagleSoundEngine(), []);

  // Temporary EagleModel instance to get default hotspots
  const defaultHotspots = useMemo(() => {
    const dummy = new EagleModel();
    return dummy.hotspots;
  }, []);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setIsPaused((p) => !p);
          break;
        case 'Digit1':
          setCurrentAnim('flap');
          break;
        case 'Digit2':
          setCurrentAnim('glide');
          break;
        case 'Digit3':
          setCurrentAnim('walk');
          break;
        case 'Digit4':
          setCurrentAnim('idle');
          break;
        case 'Digit5':
          setCurrentAnim('screech');
          soundEngine.playEagleScreech();
          break;
        case 'Digit6':
          setCurrentAnim('head_turn');
          break;
        case 'KeyX':
          setShowSkeleton((s) => !s);
          break;
        case 'KeyM':
          setIsMuted((m) => {
            const next = !m;
            soundEngine.setMuted(next);
            return next;
          });
          break;
        case 'KeyS':
          setCurrentAnim('screech');
          soundEngine.playEagleScreech();
          break;
        case 'KeyA':
          setShowAerodynamics((a) => !a);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [soundEngine]);

  const handleToggleMute = () => {
    setIsMuted((m) => {
      const next = !m;
      soundEngine.setMuted(next);
      return next;
    });
  };

  const handleTriggerScreech = () => {
    setCurrentAnim('screech');
    soundEngine.playEagleScreech();
  };

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Top Header */}
      <Header
        currentAnim={currentAnim}
        plumage={plumage}
        onOpenBiomechanics={() => setIsBiomechanicsOpen(true)}
      />

      {/* Main 3D Viewport */}
      <main className="flex-1 h-full relative pt-14">
        <Viewport
          currentAnim={currentAnim}
          onAnimChange={setCurrentAnim}
          speed={speed}
          isPaused={isPaused}
          plumage={plumage}
          showSkeleton={showSkeleton}
          showAerodynamics={showAerodynamics}
          showFeathersOnly={showFeathersOnly}
          environment={environment}
          cameraPreset={cameraPreset}
          onCameraPresetChange={setCameraPreset}
          soundEngine={soundEngine}
          onSelectHotspot={setSelectedHotspot}
          selectedHotspot={selectedHotspot}
          cursorTrackingEnabled={cursorTracking}
        />

        {/* Anatomical Hotspot Inspector Card */}
        <AnatomyInspector
          hotspot={selectedHotspot}
          onClose={() => setSelectedHotspot(null)}
          allHotspots={defaultHotspots}
          onSelectHotspot={setSelectedHotspot}
        />
      </main>

      {/* Right Control & Rig Settings Panel */}
      <ControlPanel
        currentAnim={currentAnim}
        onAnimChange={setCurrentAnim}
        speed={speed}
        onSpeedChange={setSpeed}
        isPaused={isPaused}
        onTogglePause={() => setIsPaused((p) => !p)}
        plumage={plumage}
        onPlumageChange={setPlumage}
        showSkeleton={showSkeleton}
        onToggleSkeleton={() => setShowSkeleton((s) => !s)}
        showAerodynamics={showAerodynamics}
        onToggleAerodynamics={() => setShowAerodynamics((a) => !a)}
        showFeathersOnly={showFeathersOnly}
        onToggleFeathersOnly={() => setShowFeathersOnly((f) => !f)}
        environment={environment}
        onEnvironmentChange={setEnvironment}
        cameraPreset={cameraPreset}
        onCameraPresetChange={setCameraPreset}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onTriggerScreech={handleTriggerScreech}
        cursorTracking={cursorTracking}
        onToggleCursorTracking={() => setCursorTracking((c) => !c)}
      />

      {/* Avian Biomechanics Modal */}
      <BiomechanicsModal
        isOpen={isBiomechanicsOpen}
        onClose={() => setIsBiomechanicsOpen(false)}
      />
    </div>
  );
};
export default App;
