import React, { useMemo, useRef, useEffect } from 'react';
import { ViewportConfig } from '../types';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Box, TorusKnot, GizmoHelper, GizmoViewport, GizmoViewcube, PerspectiveCamera, OrthographicCamera, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { StatWidgetsManager } from './StatWidgets';

interface ViewportAreaProps {
  viewport: ViewportConfig;
  onChange: (updates: Partial<ViewportConfig>) => void;
  cameraManagerRef?: React.MutableRefObject<any>;
}

function CameraHandler({ viewport, managerRef, controlsRef, onChange }: any) {
  const { camera } = useThree();
  
  useEffect(() => {
    managerRef.current = {
      saveBookmark: (name: string) => {
        const newBookmark = {
          id: Date.now().toString(),
          name,
          position: camera.position.toArray(),
          target: controlsRef.current?.target.toArray() || [0,0,0]
        };
        const existing = viewport.bookmarks || [];
        onChange({ bookmarks: [...existing, newBookmark] });
      },
      loadBookmark: (b: any) => {
        camera.position.fromArray(b.position);
        if (controlsRef.current) {
          controlsRef.current.target.fromArray(b.target);
          controlsRef.current.update();
        }
      }
    };
  }, [camera, controlsRef, viewport.bookmarks, onChange]);

  return null;
}

function StatsCollector({ statsRef }: { statsRef: React.MutableRefObject<any> }) {
  const { gl } = useThree();
  const frames = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
      statsRef.current.fps = Math.round((frames.current * 1000) / (now - lastTime.current));
      frames.current = 0;
      lastTime.current = now;

      statsRef.current.drawCalls = gl.info.render.calls;
      statsRef.current.triangles = gl.info.render.triangles;
      statsRef.current.textures = gl.info.memory.textures;
      statsRef.current.geometries = gl.info.memory.geometries;

      const mem = (performance as any).memory;
      if (mem) {
        statsRef.current.memory = Math.round(mem.usedJSHeapSize / 1048576);
      }
    }
  });
  return null;
}

function PointsGrid({ spacing, subdivisions, fadeDistance }: { spacing: number; subdivisions: number; fadeDistance: number }) {
  const planeRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  useFrame((state) => {
    const camPos = state.camera.position;
    if (planeRef.current) {
      // Snap the plane to the major grid so the shader texture doesn't slide
      planeRef.current.position.set(
        Math.floor(camPos.x / spacing) * spacing,
        0,
        Math.floor(camPos.z / spacing) * spacing
      );
    }
    if (materialRef.current) {
      materialRef.current.uniforms.cameraPos.value.copy(camPos);
    }
  });

  const shader = useMemo(() => ({
    uniforms: {
      cameraPos: { value: new THREE.Vector3() },
      fadeDistance: { value: fadeDistance },
      spacing: { value: spacing },
      subdivisions: { value: Math.max(1.0, subdivisions) }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 cameraPos;
      uniform float fadeDistance;
      uniform float spacing;
      uniform float subdivisions;

      void main() {
        float minorSpacing = spacing / subdivisions;
        
        vec2 gridPos = vWorldPos.xz / minorSpacing;
        vec2 nearest = round(gridPos);
        vec2 diff = gridPos - nearest;
        
        float distToPoint = length(diff) * minorSpacing;
        float dotRadius = minorSpacing * 0.08;
        
        if (distToPoint > dotRadius) discard;

        vec2 majorGridPos = nearest / subdivisions;
        vec2 nearestMajor = round(majorGridPos);
        bool isMajor = length(majorGridPos - nearestMajor) < 0.01;

        vec3 color = isMajor ? vec3(0.45, 0.45, 0.55) : vec3(0.25, 0.25, 0.3);

        float distToCam = distance(vWorldPos, cameraPos);
        float alpha = 1.0 - smoothstep(fadeDistance * 0.4, fadeDistance, distToCam);
        
        alpha *= smoothstep(dotRadius, dotRadius * 0.7, distToPoint) * -1.0 + 1.0;

        gl_FragColor = vec4(color, alpha * (isMajor ? 0.9 : 0.5));
      }
    `
  }), [fadeDistance, spacing, subdivisions]);

  return (
    <mesh ref={planeRef} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[fadeDistance * 2.5, fadeDistance * 2.5]} />
      <shaderMaterial ref={materialRef} args={[shader]} transparent depthWrite={false} />
    </mesh>
  );
}

export function ViewportArea({ viewport, onChange, cameraManagerRef }: ViewportAreaProps) {
  const controlsRef = useRef<any>(null);
  const localManagerRef = useRef<any>(null);
  const managerRef = cameraManagerRef || localManagerRef;
  const statsRef = useRef({ fps: 0, memory: 0, drawCalls: 0, triangles: 0, textures: 0, geometries: 0 });
  
  const getUnitScale = () => {
    switch (viewport.gridUnit) {
      case 'mm': return 0.001;
      case 'cm': return 0.01;
      case 'km': return 1000;
      case 'm':
      default: return 1;
    }
  };
  
  const unitScale = getUnitScale();
  const cellSpacing = viewport.gridSize * unitScale;
  const gridPlaneSize = cellSpacing * 100; // Render 100 cells across

  const renderMaterial = () => {
    switch (viewport.shadingMode) {
      case 'wireframe': 
        return <meshStandardMaterial wireframe color="#888" />;
      case 'matcap': 
        return <meshMatcapMaterial color="#e2e2e2" />;
      case 'normal': 
        return <meshNormalMaterial />;
      case 'metallic': 
        return <meshStandardMaterial metalness={1} roughness={0.1} color="#ffffff" />;
      case 'gi': 
        // Faking GI feel with physical material
        return <meshPhysicalMaterial clearcoat={1} clearcoatRoughness={0.2} roughness={0.5} color="#e0e0e0" />;
      case 'solid':
      default: 
        return <meshStandardMaterial color="#3a3a40" />;
    }
  };

  return (
    <div className="flex-1 bg-[#0a0a0c] relative overflow-hidden flex items-center justify-center p-0">
      <div className="relative w-full h-full bg-[#1a1a1f] shadow-inner transition-all duration-300 flex items-center justify-center overflow-hidden border-y border-[#2a2a30]">
        
        <Canvas>
          <CameraHandler viewport={viewport} managerRef={managerRef} controlsRef={controlsRef} onChange={onChange} />
          <StatsCollector statsRef={statsRef} />
          
          {viewport.cameraType === 'orthographic' ? (
             <OrthographicCamera makeDefault position={[5 * unitScale, 5 * unitScale, 5 * unitScale]} zoom={150} near={-1000} far={1000} />
          ) : (
             <PerspectiveCamera makeDefault position={[5 * unitScale, 5 * unitScale, 5 * unitScale]} fov={50} near={0.1} far={10000} />
          )}

          <color attach="background" args={['#1a1a1f']} />
          <ambientLight intensity={viewport.shadingMode === 'gi' ? 1.5 : 0.5} />
          <directionalLight position={[10 * unitScale, 10 * unitScale, 5 * unitScale]} intensity={1.5} castShadow />
          {viewport.shadingMode === 'gi' && (
            <directionalLight position={[-10 * unitScale, 5 * unitScale, -10 * unitScale]} intensity={0.5} color="#b4e4ff" />
          )}
          
          {/* Display Object */}
          <TorusKnot args={[1 * unitScale, 0.3 * unitScale, 128, 32]} position={[0, 1.5 * unitScale, 0]}>
            {renderMaterial()}
            {viewport.shadingMode === 'solid' && (
              <lineSegments>
                <edgesGeometry attach="geometry" args={[new THREE.TorusKnotGeometry(1 * unitScale, 0.3 * unitScale, 128, 32)]} />
                <lineBasicMaterial attach="material" color="#5a5a60" />
              </lineSegments>
            )}
          </TorusKnot>

          {/* Grid and Axes */}
          {viewport.gridType === 'lines' && (
            <Grid 
              infiniteGrid={true}
              cellSize={cellSpacing / (viewport.gridSubdivisions || 10)} 
              cellThickness={1} 
              cellColor="#2a2a30" 
              sectionSize={cellSpacing} 
              sectionThickness={1.5} 
              sectionColor="#3a3a40" 
              fadeDistance={gridPlaneSize} 
              fadeStrength={1} 
            />
          )}
          {viewport.gridType === 'dots' && (
            <PointsGrid 
              spacing={cellSpacing} 
              subdivisions={viewport.gridSubdivisions || 10} 
              fadeDistance={gridPlaneSize} 
            />
          )}
          
          {/* Independent Axes */}
          <group>
            {/* X Axis (Red) */}
            {viewport.showAxisX && (
              <mesh position={[0, 0.001, 0]}>
                <boxGeometry args={[gridPlaneSize * 2, cellSpacing * 0.02, cellSpacing * 0.02]} />
                <meshBasicMaterial color="#ff3653" />
              </mesh>
            )}
            {/* Z Axis (Blue) */}
            {viewport.showAxisZ && (
              <mesh position={[0, 0.001, 0]}>
                <boxGeometry args={[cellSpacing * 0.02, cellSpacing * 0.02, gridPlaneSize * 2]} />
                <meshBasicMaterial color="#2c8fff" />
              </mesh>
            )}
            {/* Y Axis (Green) */}
            {viewport.showAxisY && (
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[cellSpacing * 0.02, gridPlaneSize * 2, cellSpacing * 0.02]} />
                <meshBasicMaterial color="#8adb00" />
              </mesh>
            )}
          </group>

          {/* Blender-like Camera Controls */}
          <OrbitControls 
            ref={controlsRef}
            makeDefault 
            minPolarAngle={0.01}
            maxPolarAngle={Math.PI - 0.01}
            mouseButtons={{
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: THREE.MOUSE.PAN
            }}
          />

          {/* Gizmo Helper */}
          <GizmoHelper alignment="top-right" margin={[60, 60]}>
            {viewport.gizmoType === 'cad' ? (
              <GizmoViewcube 
                color="white" 
                strokeColor="#555" 
                textColor="black" 
                hoverColor="#eee" 
                opacity={0.3}
                transparent={true}
                faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']} 
              />
            ) : (
              <GizmoViewport axisColors={['#ff3653', '#8adb00', '#2c8fff']} labelColor="white" />
            )}
          </GizmoHelper>
        </Canvas>

        {/* Stat Widgets Overlay Layer */}
        <StatWidgetsManager activeOverlays={viewport.activeOverlays} onChange={onChange} statsRef={statsRef} />

        {/* Dimension Overlay */}
        <div className="absolute bottom-4 left-4 text-[#666] font-mono text-[10px] select-none bg-black/40 px-2 py-1 rounded border border-[#2a2a30]">
          Grid Spacing: {viewport.gridSize}{viewport.gridUnit}
        </div>
      </div>
    </div>
  );
}
