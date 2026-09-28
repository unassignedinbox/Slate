import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EagleModel, PlumageType, AnatomicalHotspot } from '../eagle/EagleModel';
import { AnimationEngine, AnimationType } from '../eagle/AnimationEngine';
import { AerodynamicFlowVisualizer } from '../eagle/ParticleSystems';
import { EagleSoundEngine } from '../audio/EagleSoundEngine';

export type EnvironmentType = 'alpine_sky' | 'canyon_ground' | 'sunset_golden' | 'studio';
export type CameraPreset = 'free' | 'cinematic' | 'aero_top' | 'head_closeup' | 'wingtip' | 'talons_low';

interface ViewportProps {
  currentAnim: AnimationType;
  onAnimChange: (anim: AnimationType) => void;
  speed: number;
  isPaused: boolean;
  plumage: PlumageType;
  showSkeleton: boolean;
  showAerodynamics: boolean;
  showFeathersOnly: boolean;
  environment: EnvironmentType;
  cameraPreset: CameraPreset;
  onCameraPresetChange: (preset: CameraPreset) => void;
  soundEngine: EagleSoundEngine;
  onSelectHotspot: (hotspot: AnatomicalHotspot | null) => void;
  selectedHotspot: AnatomicalHotspot | null;
  cursorTrackingEnabled: boolean;
}

export const Viewport: React.FC<ViewportProps> = ({
  currentAnim,
  onAnimChange,
  speed,
  isPaused,
  plumage,
  showSkeleton,
  showAerodynamics,
  showFeathersOnly,
  environment,
  cameraPreset,
  onCameraPresetChange,
  soundEngine,
  onSelectHotspot,
  selectedHotspot,
  cursorTrackingEnabled,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const eagleModelRef = useRef<EagleModel | null>(null);
  const animEngineRef = useRef<AnimationEngine>(new AnimationEngine());
  const aeroFlowRef = useRef<AerodynamicFlowVisualizer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const envGroupRef = useRef<THREE.Group | null>(null);

  const [hotspotScreenPositions, setHotspotScreenPositions] = useState<
    { id: string; name: string; x: number; y: number; visible: boolean; data: AnatomicalHotspot }[]
  >([]);

  // Sound sync ref
  const lastFlapPhaseRef = useRef<number>(0);

  // Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    camera.position.set(1.8, 0.9, 2.2);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // Orbit Controls
    const controls = new OrbitControls(camera, canvasRef.current);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controls.minDistance = 0.4;
    controls.maxDistance = 15;
    controls.target.set(0, 0.2, 0);
    controlsRef.current = controls;

    // Environment Group
    const envGroup = new THREE.Group();
    scene.add(envGroup);
    envGroupRef.current = envGroup;

    // Build 3D Eagle Model
    const eagle = new EagleModel(plumage);
    scene.add(eagle.group);
    eagleModelRef.current = eagle;

    // Build Aerodynamic Particle Streamlines
    const aero = new AerodynamicFlowVisualizer();
    scene.add(aero.group);
    aeroFlowRef.current = aero;

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Mouse Move for Interactive Raptor Head Tracking & Hotspot raycasting
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      animEngineRef.current.cursorTarget.set(x, y);
    };
    containerRef.current.addEventListener('mousemove', handleMouseMove);

    // Animation Loop
    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const currentTime = performance.now();
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      // Update Animation Engine
      if (eagleModelRef.current && animEngineRef.current) {
        animEngineRef.current.update(delta, eagleModelRef.current.rig);

        // Sound synchronization for Wing Flap Whoosh
        if (animEngineRef.current.currentAnim === 'flap' && !isPaused) {
          const currentPhase = animEngineRef.current.normalizedPhase;
          // Downstroke transition trigger around phase 0.05
          if (lastFlapPhaseRef.current > 0.85 && currentPhase < 0.2) {
            soundEngine.playWingWhoosh();
          }
          lastFlapPhaseRef.current = currentPhase;
        }

        // Screech vocalization trigger
        if (animEngineRef.current.currentAnim === 'screech' && animEngineRef.current.isScreeching) {
          soundEngine.playEagleScreech();
          animEngineRef.current.isScreeching = false;
        }
      }

      // Update Aerodynamic Flow Particles
      if (aeroFlowRef.current) {
        aeroFlowRef.current.update(delta, animEngineRef.current.currentAnim === 'flap');
      }

      // Camera preset smooth interpolations
      if (cameraRef.current && controlsRef.current) {
        if (cameraPreset === 'cinematic') {
          const orbitRadius = 2.8;
          const orbitSpeed = 0.25;
          const camX = Math.cos(currentTime * 0.001 * orbitSpeed) * orbitRadius;
          const camZ = Math.sin(currentTime * 0.001 * orbitSpeed) * orbitRadius;
          camera.position.x = THREE.MathUtils.lerp(camera.position.x, camX, 0.03);
          camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.8 + Math.sin(currentTime * 0.0005) * 0.4, 0.03);
          camera.position.z = THREE.MathUtils.lerp(camera.position.z, camZ, 0.03);
          controls.target.lerp(new THREE.Vector3(0, 0.2, 0), 0.05);
        }
        controls.update();
      }

      // Project 3D Hotspot positions to 2D Screen
      if (cameraRef.current && eagleModelRef.current) {
        const positions = eagleModelRef.current.hotspots.map((h) => {
          const worldPos = h.position.clone();
          // Transform by eagle root position/rotation
          worldPos.applyMatrix4(eagleModelRef.current!.group.matrixWorld);

          const screenPos = worldPos.clone().project(cameraRef.current!);
          const isBehind = screenPos.z > 1.0;

          const screenX = ((screenPos.x + 1) * width) / 2;
          const screenY = ((-screenPos.y + 1) * height) / 2;

          return {
            id: h.id,
            name: h.name,
            x: screenX,
            y: screenY,
            visible: !isBehind && screenX > 0 && screenX < width && screenY > 0 && screenY < height,
            data: h,
          };
        });
        setHotspotScreenPositions(positions);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', handleMouseMove);
      }
      renderer.dispose();
    };
  }, []);

  // Update Animation Parameters
  useEffect(() => {
    if (animEngineRef.current) {
      animEngineRef.current.playAnimation(currentAnim);
      animEngineRef.current.speed = speed;
      animEngineRef.current.isPaused = isPaused;
      animEngineRef.current.isCursorTracking = cursorTrackingEnabled;
    }
  }, [currentAnim, speed, isPaused, cursorTrackingEnabled]);

  // Update Plumage
  useEffect(() => {
    if (eagleModelRef.current) {
      eagleModelRef.current.setPlumage(plumage);
    }
  }, [plumage]);

  // Update Skeleton / Feathers / Aerodynamics Toggles
  useEffect(() => {
    if (eagleModelRef.current) {
      eagleModelRef.current.rig.skeletonGroup.visible = showSkeleton;
      eagleModelRef.current.rig.bodyMeshGroup.visible = !showSkeleton && !showFeathersOnly;
      eagleModelRef.current.rig.feathersGroup.visible = !showSkeleton;
    }
    if (aeroFlowRef.current) {
      aeroFlowRef.current.group.visible = showAerodynamics;
    }
  }, [showSkeleton, showFeathersOnly, showAerodynamics]);

  // Update Camera Presets
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;

    switch (cameraPreset) {
      case 'aero_top':
        cam.position.set(0.1, 3.2, 0.05);
        ctrl.target.set(0, 0.2, 0);
        break;
      case 'head_closeup':
        cam.position.set(0.7, 0.45, 0.35);
        ctrl.target.set(0.35, 0.3, 0);
        break;
      case 'wingtip':
        cam.position.set(0.2, 0.35, 1.35);
        ctrl.target.set(0.05, 0.15, 0.85);
        break;
      case 'talons_low':
        cam.position.set(0.65, -0.25, 0.55);
        ctrl.target.set(0, -0.2, 0);
        break;
      case 'free':
        // Keep current
        break;
    }
  }, [cameraPreset]);

  // Update Environment & Lighting
  useEffect(() => {
    if (!sceneRef.current || !envGroupRef.current) return;
    const envGroup = envGroupRef.current;
    const scene = sceneRef.current;

    // Clear previous environment
    while (envGroup.children.length > 0) {
      envGroup.remove(envGroup.children[0]);
    }

    // Set background & lights according to environment type
    if (environment === 'alpine_sky') {
      scene.background = new THREE.Color(0x7dd3fc);
      scene.fog = new THREE.FogExp2(0xbae6fd, 0.008);

      // Sky Dome hemisphere
      const skyGeo = new THREE.SphereGeometry(150, 32, 15);
      const skyMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.BackSide,
      });
      const sky = new THREE.Mesh(skyGeo, skyMat);
      envGroup.add(sky);

      // High Altitude Sunlight
      const sun = new THREE.DirectionalLight(0xfffbeb, 2.4);
      sun.position.set(5, 12, 7);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 2048;
      sun.shadow.mapSize.height = 2048;
      sun.shadow.bias = -0.0005;
      envGroup.add(sun);

      const hemi = new THREE.HemisphereLight(0xbae6fd, 0x0369a1, 0.8);
      envGroup.add(hemi);

      // Distant Alpine Mountain Peaks
      const mtnGroup = new THREE.Group();
      for (let m = 0; m < 12; m++) {
        const angle = (m / 12) * Math.PI * 2;
        const dist = 70 + Math.random() * 20;
        const height = 25 + Math.random() * 20;
        const mtnGeom = new THREE.ConeGeometry(18 + Math.random() * 12, height, 5);
        const mtnMat = new THREE.MeshStandardMaterial({
          color: 0x334155,
          roughness: 0.9,
          metalness: 0.1,
        });
        const mtn = new THREE.Mesh(mtnGeom, mtnMat);
        mtn.position.set(Math.cos(angle) * dist, height * 0.4 - 15, Math.sin(angle) * dist);
        mtnGroup.add(mtn);
      }
      envGroup.add(mtnGroup);

      // Subtle volumetric clouds
      for (let c = 0; c < 8; c++) {
        const cloudGeom = new THREE.SphereGeometry(6 + Math.random() * 4, 12, 8);
        cloudGeom.scale(2.2, 0.6, 1.4);
        const cloudMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.95,
          transparent: true,
          opacity: 0.75,
        });
        const cloud = new THREE.Mesh(cloudGeom, cloudMat);
        const angle = (c / 8) * Math.PI * 2;
        cloud.position.set(Math.cos(angle) * 35, 12 + Math.random() * 8, Math.sin(angle) * 35);
        envGroup.add(cloud);
      }
    } else if (environment === 'canyon_ground') {
      scene.background = new THREE.Color(0xfbbf24);
      scene.fog = new THREE.FogExp2(0xfde047, 0.012);

      const sun = new THREE.DirectionalLight(0xfef08a, 2.2);
      sun.position.set(6, 8, 4);
      sun.castShadow = true;
      envGroup.add(sun);

      const hemi = new THREE.HemisphereLight(0xfef08a, 0x78350f, 0.7);
      envGroup.add(hemi);

      // Canyon Ground Plane
      const groundGeom = new THREE.PlaneGeometry(80, 80, 32, 32);
      groundGeom.rotateX(-Math.PI / 2);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x78350f,
        roughness: 0.95,
        metalness: 0.05,
      });
      const ground = new THREE.Mesh(groundGeom, groundMat);
      ground.position.y = -0.32;
      ground.receiveShadow = true;
      envGroup.add(ground);

      // Rocky perch stones
      const rockGeom = new THREE.DodecahedronGeometry(0.55, 1);
      rockGeom.scale(1.8, 0.5, 1.2);
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x451a03,
        roughness: 0.9,
      });
      const rock = new THREE.Mesh(rockGeom, rockMat);
      rock.position.set(0, -0.4, 0);
      rock.receiveShadow = true;
      rock.castShadow = true;
      envGroup.add(rock);
    } else if (environment === 'sunset_golden') {
      scene.background = new THREE.Color(0x451a03);
      scene.fog = new THREE.FogExp2(0x78350f, 0.01);

      // Golden Hour Rim Sun Light
      const sun = new THREE.DirectionalLight(0xf97316, 3.2);
      sun.position.set(-8, 3, -6);
      sun.castShadow = true;
      envGroup.add(sun);

      const fill = new THREE.DirectionalLight(0x38bdf8, 0.8);
      fill.position.set(6, 4, 6);
      envGroup.add(fill);

      const hemi = new THREE.HemisphereLight(0xfb923c, 0x1e1b4b, 0.9);
      envGroup.add(hemi);
    } else {
      // Studio Lighting
      scene.background = new THREE.Color(0x0f172a);
      scene.fog = null;

      // Key light
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
      keyLight.position.set(4, 6, 5);
      keyLight.castShadow = true;
      envGroup.add(keyLight);

      // Fill light
      const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.2);
      fillLight.position.set(-5, 3, -4);
      envGroup.add(fillLight);

      // Back rim light
      const rimLight = new THREE.DirectionalLight(0xf59e0b, 1.8);
      rimLight.position.set(0, 4, -6);
      envGroup.add(rimLight);

      // Circular Studio Pedestal
      const pedestalGeom = new THREE.CylinderGeometry(1.6, 1.8, 0.1, 48);
      const pedestalMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.4,
        metalness: 0.3,
      });
      const pedestal = new THREE.Mesh(pedestalGeom, pedestalMat);
      pedestal.position.y = -0.35;
      pedestal.receiveShadow = true;
      envGroup.add(pedestal);
    }
  }, [environment]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none bg-slate-950">
      <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing outline-none" />

      {/* 3D Hotspot Interactive Overlay Markers */}
      {!showSkeleton && (
        <div className="absolute inset-0 pointer-events-none">
          {hotspotScreenPositions.map((h) => {
            if (!h.visible) return null;
            const isSelected = selectedHotspot?.id === h.id;

            return (
              <div
                key={h.id}
                style={{
                  left: `${h.x}px`,
                  top: `${h.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                className="absolute pointer-events-auto transition-transform duration-150"
              >
                <button
                  onClick={() => onSelectHotspot(isSelected ? null : h.data)}
                  className={`group relative flex items-center justify-center rounded-full transition-all duration-200 ${
                    isSelected
                      ? 'w-7 h-7 bg-amber-500 text-slate-950 ring-4 ring-amber-400/40 shadow-lg shadow-amber-500/50 scale-110'
                      : 'w-5 h-5 bg-slate-900/90 text-amber-400 border border-amber-500/50 hover:scale-125 hover:border-amber-400 shadow-md'
                  }`}
                  title={h.name}
                >
                  <span className="text-[10px] font-bold font-mono">●</span>

                  {/* Hover tooltip */}
                  <span className="absolute left-full ml-2 px-2 py-1 bg-slate-900/95 border border-slate-700 rounded text-xs text-slate-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl z-30">
                    {h.name}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Instructions / Controls hint */}
      <div className="absolute bottom-4 left-4 bg-slate-900/80 backdrop-blur-md border border-slate-800 text-slate-400 text-xs px-3 py-2 rounded-lg pointer-events-none flex items-center space-x-3 shadow-lg">
        <div className="flex items-center space-x-1.5">
          <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono text-[10px]">Left Drag</span>
          <span>Rotate</span>
        </div>
        <div className="w-1 h-1 bg-slate-700 rounded-full" />
        <div className="flex items-center space-x-1.5">
          <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono text-[10px]">Right Drag</span>
          <span>Pan</span>
        </div>
        <div className="w-1 h-1 bg-slate-700 rounded-full" />
        <div className="flex items-center space-x-1.5">
          <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300 font-mono text-[10px]">Scroll</span>
          <span>Zoom</span>
        </div>
      </div>
    </div>
  );
};
