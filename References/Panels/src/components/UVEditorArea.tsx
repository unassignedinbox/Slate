import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Grid3X3, Camera, Activity, Video, Eye, Box, X } from 'lucide-react';

function UDIMInfo({ show, cols, rows }: { show: boolean, cols: number, rows: number }) {
  if (!show) return null;
  const tiles = [];
  for (let v = 0; v < rows; v++) {
    for (let u = 0; u < cols; u++) {
      const udim = 1001 + u + v * 10;
      const isActive = udim === 1001;
      tiles.push(
        <group key={udim} position={[u, v, 0]}>
           {isActive && (
             <mesh position={[0.5, 0.5, -0.01]}>
               <planeGeometry args={[1, 1]} />
               <meshBasicMaterial color="#ffffff" transparent opacity={0.05} />
             </mesh>
           )}
           <Text position={[0.05, 0.05, 0]} fontSize={0.1} color={isActive ? "#aaaaaa" : "#555555"} anchorX="left" anchorY="bottom">
             {udim}
           </Text>
        </group>
      );
    }
  }
  return <group>{tiles}</group>;
}

function CustomUVGrid({ 
    showUdim, cols, rows, subdivisions, size, type 
}: { 
    showUdim: boolean, cols: number, rows: number, subdivisions: number, size: number, type: 'none' | 'lines' | 'dots' 
}) {
  const { majorPts, minorPts, dotPts } = useMemo(() => {
    const major = [];
    const minor = [];
    const dots = [];
    
    const validSize = Math.max(0.1, size);
    const validSub = Math.max(1, Math.floor(subdivisions));

    const maxU = showUdim ? Math.max(1, cols) : 1;
    const maxV = showUdim ? Math.max(1, rows) : 1;

    const gridSpanU = Math.max(maxU, Math.ceil(maxU / validSize) * validSize);
    const gridSpanV = Math.max(maxV, Math.ceil(maxV / validSize) * validSize);

    if (showUdim || type !== 'none') {
        for (let x = 0; x <= gridSpanU + 0.0001; x += validSize) {
            major.push(x, 0, 0, x, gridSpanV, 0);
        }
        for (let y = 0; y <= gridSpanV + 0.0001; y += validSize) {
            major.push(0, y, 0, gridSpanU, y, 0);
        }
    }

    if (type === 'lines') {
       const minorStep = validSize / validSub;
       for (let x = 0; x <= gridSpanU + 0.0001; x += minorStep) {
           const mod = x % validSize;
           if (Math.abs(mod) > 0.001 && Math.abs(mod - validSize) > 0.001) {
               minor.push(x, 0, 0, x, gridSpanV, 0);
           }
       }
       for (let y = 0; y <= gridSpanV + 0.0001; y += minorStep) {
           const mod = y % validSize;
           if (Math.abs(mod) > 0.001 && Math.abs(mod - validSize) > 0.001) {
               minor.push(0, y, 0, gridSpanU, y, 0);
           }
       }
    }

    if (type === 'dots') {
        const minorStep = validSize / validSub;
        for (let x = 0; x <= gridSpanU + 0.0001; x += minorStep) {
            for (let y = 0; y <= gridSpanV + 0.0001; y += minorStep) {
                dots.push(x, y, 0);
            }
        }
    }

    return { 
       majorPts: new Float32Array(major), 
       minorPts: new Float32Array(minor), 
       dotPts: new Float32Array(dots) 
    };
  }, [showUdim, cols, rows, subdivisions, size, type]);

  // Unique key to force R3F to rebuild the buffer geometry if params change
  // This completely prevents the WebGL array-resize bug ("linear shifting artifact")
  const buildKey = `${showUdim}-${cols}-${rows}-${subdivisions}-${size}-${type}`;

  return (
    <group position={[0, 0, -0.02]}>
      {majorPts.length > 0 && (
         <lineSegments key={`major-${buildKey}`}>
            <bufferGeometry>
               <bufferAttribute attach="attributes-position" count={majorPts.length / 3} array={majorPts} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color="#5a5a60" linewidth={2} />
         </lineSegments>
      )}
      {minorPts.length > 0 && (
         <lineSegments key={`minor-${buildKey}`}>
            <bufferGeometry>
               <bufferAttribute attach="attributes-position" count={minorPts.length / 3} array={minorPts} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color="#333333" linewidth={1} />
         </lineSegments>
      )}
      {dotPts.length > 0 && (
         <points key={`dot-${buildKey}`}>
            <bufferGeometry>
               <bufferAttribute attach="attributes-position" count={dotPts.length / 3} array={dotPts} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial size={2} sizeAttenuation={false} color="#555555" />
         </points>
      )}
    </group>
  );
}

export function UVEditorArea() {
  const [uvMode, setUvMode] = useState<'wireframe' | 'solid' | 'heatmap'>('wireframe');
  const [gridSubdivisions, setGridSubdivisions] = useState(10);
  const [gridType, setGridType] = useState<'none' | 'lines' | 'dots'>('lines');
  const [showAxisU, setShowAxisU] = useState(true);
  const [showAxisV, setShowAxisV] = useState(true);
  const [gridSize, setGridSize] = useState(1);
  const [activeOverlays, setActiveOverlays] = useState<string[]>([]);
  
  const [showUdim, setShowUdim] = useState(true);
  const [udimCols, setUdimCols] = useState(10);
  const [udimRows, setUdimRows] = useState(3);
  
  const [isGridMenuOpen, setIsGridMenuOpen] = useState(false);
  const [isStatsMenuOpen, setIsStatsMenuOpen] = useState(false);
  const [isBookmarksMenuOpen, setIsBookmarksMenuOpen] = useState(false);

  const uvGeo = useMemo(() => {
    const geo3d = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
    const geo2d = new THREE.BufferGeometry();
    const uv = geo3d.attributes.uv.array;
    const pos = new Float32Array((uv.length / 2) * 3);
    const colors = new Float32Array((uv.length / 2) * 3);
    const color = new THREE.Color();

    for(let i=0; i<uv.length/2; i++) {
       pos[i*3] = uv[i*2]; // U
       pos[i*3+1] = uv[i*2+1]; // V
       pos[i*3+2] = 0; // Z

       // Heatmap stretch approximation
       const dist = Math.sqrt(Math.pow(uv[i*2] - 0.5, 2) + Math.pow(uv[i*2+1] - 0.5, 2));
       color.setHSL(0.6 - dist * 0.8, 1, 0.5); 
       colors[i*3] = color.r;
       colors[i*3+1] = color.g;
       colors[i*3+2] = color.b;
    }
    geo2d.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo2d.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo2d.setIndex(geo3d.getIndex());
    return geo2d;
  }, []);

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden bg-[#121212]">
      <div className="flex-1 relative">
        <Canvas orthographic camera={{ position: [0.5, 0.5, 5], zoom: 200, near: 0.1, far: 100 }}>
          <OrbitControls 
             enableRotate={false} 
             target={[0.5, 0.5, 0]}
             mouseButtons={{
               LEFT: THREE.MOUSE.NONE,
               MIDDLE: THREE.MOUSE.PAN,
               RIGHT: THREE.MOUSE.PAN
             }}
          />
          
          <CustomUVGrid 
            showUdim={showUdim} 
            cols={udimCols} 
            rows={udimRows} 
            subdivisions={gridSubdivisions} 
            size={gridSize} 
            type={gridType} 
          />
          <UDIMInfo show={showUdim} cols={udimCols} rows={udimRows} />
          
          {/* Highlight U/V Axes */}
          {(gridType !== 'none' || showUdim) && (
            <group>
              {showAxisU && (
                <mesh position={[Math.max(1, Math.ceil((showUdim ? udimCols : 1) / gridSize) * gridSize) / 2, 0, -0.01]}>
                  <boxGeometry args={[Math.max(1, Math.ceil((showUdim ? udimCols : 1) / gridSize) * gridSize), 0.01, 0.01]} />
                  <meshBasicMaterial color="#ef4444" opacity={0.6} transparent />
                </mesh>
              )}
              {showAxisV && (
                <mesh position={[0, Math.max(1, Math.ceil((showUdim ? udimRows : 1) / gridSize) * gridSize) / 2, -0.01]}>
                  <boxGeometry args={[0.01, Math.max(1, Math.ceil((showUdim ? udimRows : 1) / gridSize) * gridSize), 0.01]} />
                  <meshBasicMaterial color="#22c55e" opacity={0.6} transparent />
                </mesh>
              )}
            </group>
          )}

          <mesh geometry={uvGeo}>
            {uvMode === 'wireframe' && <meshBasicMaterial wireframe color="#00ffcc" transparent opacity={0.6} />}
            {uvMode === 'solid' && <meshBasicMaterial color="#aaaaaa" side={THREE.DoubleSide} wireframe={false} />}
            {uvMode === 'heatmap' && <meshBasicMaterial vertexColors={true} side={THREE.DoubleSide} />}
          </mesh>
        </Canvas>
      </div>

      <div className="h-12 bg-[#1e1e24] flex items-center justify-between px-4 text-xs text-gray-400 select-none relative z-50">
        <div className="flex items-center space-x-3">
          
          {/* Bookmarks Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsBookmarksMenuOpen(!isBookmarksMenuOpen)}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-full transition-colors ${isBookmarksMenuOpen ? 'bg-[#3a3a40] text-gray-100' : 'bg-[#121212] hover:bg-[#2a2a30] hover:text-gray-200'}`}
            >
              <Camera size={14} />
              <span>Cameras</span>
            </button>
            {isBookmarksMenuOpen && (
              <div className="absolute bottom-full left-0 mb-3 w-[240px] bg-[#1e1e24] border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-3 flex flex-col z-[100]">
                 <span className="text-gray-500 text-center py-4 italic">No saved cameras (2D View)</span>
              </div>
            )}
          </div>

          {/* Grid Options Button */}
          <div className="relative">
            <button
              onClick={() => setIsGridMenuOpen(!isGridMenuOpen)}
              className={`flex items-center space-x-2 px-4 py-1.5 rounded-full transition-colors ${isGridMenuOpen ? 'bg-[#3a3a40] text-gray-100' : 'bg-[#121212] hover:bg-[#2a2a30] hover:text-gray-200'}`}
            >
              <Grid3X3 size={14} />
              <span>Grid Options</span>
            </button>

            {isGridMenuOpen && (
              <div className="absolute bottom-full left-0 mb-3 w-[340px] bg-[#1e1e24] border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-5 flex flex-col space-y-5 z-[100]">
                <div className="flex justify-between items-center text-gray-200 font-semibold border-b border-[#2a2a30] pb-3">
                  <span>Grid settings</span>
                  <button onClick={() => setIsGridMenuOpen(false)} className="text-gray-400 hover:text-white transition-colors bg-[#2a2a30] hover:bg-[#3a3a40] p-1 rounded-full">
                    <X size={14} />
                  </button>
                </div>
                
                {/* Grid Type */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 font-medium text-sm">Grid</span>
                  <div className="flex bg-[#121212] rounded border border-[#2a2a30] overflow-hidden text-xs">
                    <button onClick={() => setGridType('none')} className={`px-4 py-1.5 transition-colors ${gridType === 'none' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>None</button>
                    <button onClick={() => setGridType('lines')} className={`px-4 py-1.5 border-l border-[#2a2a30] transition-colors ${gridType === 'lines' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>Lines</button>
                    <button onClick={() => setGridType('dots')} className={`px-4 py-1.5 border-l border-[#2a2a30] transition-colors ${gridType === 'dots' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>Dotted</button>
                  </div>
                </div>

                {/* Scale Options */}
                <div className="flex flex-col space-y-3">
                  <span className="text-gray-400 font-medium text-sm">Scale</span>
                  <div className="flex items-center space-x-3">
                    <input 
                      type="range" min="0.1" max="10" step="0.1" 
                      value={gridSize} 
                      onChange={(e) => setGridSize(Number(e.target.value))} 
                      className="flex-1 accent-blue-500 h-1.5 bg-[#121212] rounded-lg appearance-none cursor-pointer" 
                    />
                    <div className="flex items-center bg-[#121212] border border-[#2a2a30] rounded overflow-hidden">
                      <input 
                        type="number" 
                        value={gridSize} 
                        onChange={(e) => setGridSize(Number(e.target.value) || 0.1)} 
                        className="w-12 py-1 bg-transparent text-center text-gray-200 outline-none text-sm" 
                      />
                      <div className="py-1 px-2 bg-transparent text-gray-400 border-l border-[#2a2a30] text-sm">UV</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-medium text-sm">Subdivisions</span>
                    <input 
                      type="number" min="1" max="100" 
                      value={gridSubdivisions} 
                      onChange={(e) => setGridSubdivisions(Number(e.target.value) || 10)} 
                      className="w-14 bg-[#121212] border border-[#2a2a30] rounded py-1 text-center text-gray-200 outline-none text-sm focus:border-blue-500 transition-colors"
                    />
                  </div>
                  <input 
                    type="range" min="1" max="100" step="1" 
                    value={gridSubdivisions} 
                    onChange={(e) => setGridSubdivisions(Number(e.target.value))} 
                    className="w-full accent-blue-500 h-1.5 bg-[#121212] rounded-lg appearance-none cursor-pointer" 
                  />
                </div>

                {/* UDIM Tile Settings */}
                <div className="flex flex-col space-y-3 pt-3 border-t border-[#2a2a30]">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 font-medium text-sm">UDIM Tiles</span>
                    <button 
                      onClick={() => setShowUdim(!showUdim)} 
                      className={`w-10 h-5 rounded-full relative transition-colors ${showUdim ? 'bg-blue-500' : 'bg-[#2a2a30] border border-[#3a3a40]'}`}
                    >
                       <div className={`absolute top-[1px] w-4 h-4 rounded-full bg-white transition-transform ${showUdim ? 'left-[22px]' : 'left-[1px]'}`} />
                    </button>
                  </div>
                  
                  {showUdim && (
                    <div className="flex items-center space-x-3">
                       <div className="flex-1 flex flex-col space-y-1">
                         <span className="text-gray-500 text-xs">Columns (U)</span>
                         <input 
                           type="number" min="1" max="100" 
                           value={udimCols} 
                           onChange={(e) => setUdimCols(Number(e.target.value) || 1)} 
                           className="w-full bg-[#121212] border border-[#2a2a30] rounded py-1 px-2 text-gray-200 outline-none text-sm focus:border-blue-500 transition-colors"
                         />
                       </div>
                       <div className="flex-1 flex flex-col space-y-1">
                         <span className="text-gray-500 text-xs">Rows (V)</span>
                         <input 
                           type="number" min="1" max="100" 
                           value={udimRows} 
                           onChange={(e) => setUdimRows(Number(e.target.value) || 1)} 
                           className="w-full bg-[#121212] border border-[#2a2a30] rounded py-1 px-2 text-gray-200 outline-none text-sm focus:border-blue-500 transition-colors"
                         />
                       </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#2a2a30]">
                  <span className="text-gray-400 font-medium text-sm">Axes</span>
                  <div className="flex space-x-3">
                    <button 
                      onClick={() => setShowAxisU(!showAxisU)} 
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${showAxisU ? 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-[#121212] text-gray-500 border border-[#2a2a30] hover:border-gray-500'}`}
                    >
                      U
                    </button>
                    <button 
                      onClick={() => setShowAxisV(!showAxisV)} 
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${showAxisV ? 'bg-green-500/20 text-green-500 border border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'bg-[#121212] text-gray-500 border border-[#2a2a30] hover:border-gray-500'}`}
                    >
                      V
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="relative">
            <button
              onClick={() => setIsStatsMenuOpen(!isStatsMenuOpen)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full transition-colors ${activeOverlays.length ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-[#121212] border border-[#2a2a30] hover:bg-[#2a2a30] text-gray-400 hover:text-gray-200'}`}
            >
              <Activity size={14} />
              <span>Overlays</span>
            </button>

            {isStatsMenuOpen && (
              <div className="absolute bottom-full right-0 mb-3 w-[200px] bg-[#1e1e24] border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-2 flex flex-col space-y-1 z-[100]">
                 {[
                   { id: 'fps', label: 'FPS Monitor' },
                   { id: 'stretch', label: 'Stretch Metrics' },
                 ].map((overlay) => (
                    <button 
                      key={overlay.id}
                      onClick={() => {
                        const newActive = activeOverlays.includes(overlay.id) 
                          ? activeOverlays.filter(id => id !== overlay.id)
                          : [...activeOverlays, overlay.id];
                        setActiveOverlays(newActive);
                      }}
                      className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-[#2a2a30] text-gray-300 transition-colors text-left"
                    >
                      <div className={`w-3 h-3 rounded-sm border flex-shrink-0 ${activeOverlays.includes(overlay.id) ? 'bg-green-500 border-green-500' : 'border-[#4a4a50]'}`} />
                      <span>{overlay.label}</span>
                    </button>
                 ))}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <Video size={14} />
            <div className="flex bg-[#121212] border border-[#2a2a30] rounded-full overflow-hidden text-xs">
              <button className="px-3 py-1.5 bg-[#3a3a40] text-white">2D View</button>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Eye size={14} />
            <select
              value={uvMode}
              onChange={(e) => setUvMode(e.target.value as any)}
              className="bg-[#121212] border border-[#2a2a30] rounded-full px-3 py-1.5 text-gray-300 outline-none focus:border-blue-500 cursor-pointer capitalize"
            >
              <option value="wireframe">Wireframe</option>
              <option value="solid">Solid</option>
              <option value="heatmap">Heatmap</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
