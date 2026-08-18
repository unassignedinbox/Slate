import React, { useState } from 'react';
import { Grid3X3, Grip, Square, Box, Eye, X, Activity, Video, Camera } from 'lucide-react';
import { ViewportConfig, GridType, ShadingMode, GridUnit, GizmoType } from '../types';

interface FooterControlsProps {
  viewport: ViewportConfig;
  onChange: (updates: Partial<ViewportConfig>) => void;
  cameraManagerRef?: React.MutableRefObject<any>;
}

export function FooterControls({ viewport, onChange, cameraManagerRef }: FooterControlsProps) {
  const [isGridMenuOpen, setIsGridMenuOpen] = useState(false);
  const [isStatsMenuOpen, setIsStatsMenuOpen] = useState(false);
  const [isBookmarksMenuOpen, setIsBookmarksMenuOpen] = useState(false);

  const SHADING_MODES: ShadingMode[] = ['solid', 'wireframe', 'matcap', 'normal', 'metallic', 'gi'];
  const UNITS: GridUnit[] = ['mm', 'cm', 'm', 'km'];
  const GIZMOS: GizmoType[] = ['blender', 'cad'];

  return (
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

          {/* Bookmarks Popover Menu */}
          {isBookmarksMenuOpen && (
            <div className="absolute bottom-full left-0 mb-3 w-[240px] bg-[#1e1e24] border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-3 flex flex-col z-[100]">
               <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#2a2a30]">
                  <span className="font-semibold text-gray-200 text-xs">Saved Cameras</span>
                  <button 
                    onClick={() => cameraManagerRef?.current?.saveBookmark(`Camera ${Math.floor(Math.random() * 1000)}`)} 
                    className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-2 py-1 rounded transition-colors text-xs"
                  >
                     + Save
                  </button>
               </div>
               <div className="flex flex-col space-y-1.5 max-h-48 overflow-y-auto no-scrollbar text-xs">
                  {viewport.bookmarks?.map((b: any, index: number) => (
                     <div key={b.id} className="flex justify-between items-center bg-[#121212] border border-[#2a2a30] p-2 rounded hover:border-gray-500 cursor-pointer group transition-colors" onClick={() => cameraManagerRef?.current?.loadBookmark(b)}>
                        <span className="truncate text-gray-300 group-hover:text-white">
                          {index + 1}. {b.name}
                        </span>
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            onChange({ bookmarks: viewport.bookmarks.filter((x: any) => x.id !== b.id) });
                          }} 
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                        >
                           <X size={12} />
                        </button>
                     </div>
                  ))}
                  {(!viewport.bookmarks || viewport.bookmarks.length === 0) && (
                     <span className="text-gray-500 text-center py-4 italic">No saved cameras</span>
                  )}
               </div>
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

          {/* Popover Menu */}
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
                  <button onClick={() => onChange({ gridType: 'none' })} className={`px-4 py-1.5 transition-colors ${viewport.gridType === 'none' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>None</button>
                  <button onClick={() => onChange({ gridType: 'lines' })} className={`px-4 py-1.5 border-l border-[#2a2a30] transition-colors ${viewport.gridType === 'lines' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>Lines</button>
                  <button onClick={() => onChange({ gridType: 'dots' })} className={`px-4 py-1.5 border-l border-[#2a2a30] transition-colors ${viewport.gridType === 'dots' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}>Dotted</button>
                </div>
              </div>

              {/* Grid Scale Slider */}
              <div className="flex flex-col space-y-3">
                <span className="text-gray-400 font-medium text-sm">Scale</span>
                <div className="flex items-center space-x-3">
                  <input 
                    type="range" 
                    min="0.1" 
                    max="10" 
                    step="0.1" 
                    value={viewport.gridSize} 
                    onChange={(e) => onChange({gridSize: Number(e.target.value)})} 
                    className="flex-1 accent-blue-500 h-1.5 bg-[#121212] rounded-lg appearance-none cursor-pointer" 
                  />
                  <div className="flex items-center bg-[#121212] border border-[#2a2a30] rounded overflow-hidden">
                    <input 
                      type="number" 
                      value={viewport.gridSize} 
                      onChange={(e) => onChange({gridSize: Number(e.target.value) || 0.1})} 
                      className="w-12 py-1 bg-transparent text-center text-gray-200 outline-none text-sm" 
                    />
                    <select 
                      value={viewport.gridUnit} 
                      onChange={(e) => onChange({gridUnit: e.target.value as GridUnit})} 
                      className="py-1 px-1 bg-transparent text-gray-400 outline-none cursor-pointer border-l border-[#2a2a30] hover:text-gray-200 text-sm"
                    >
                      {UNITS.map(u => <option key={u} value={u} className="bg-[#121212]">{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Grid Subdivisions */}
              <div className="flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 font-medium text-sm">Subdivisions</span>
                  <input 
                    type="number" 
                    min="1" 
                    max="100" 
                    value={viewport.gridSubdivisions || 10} 
                    onChange={(e) => onChange({gridSubdivisions: Number(e.target.value) || 10})} 
                    className="w-14 bg-[#121212] border border-[#2a2a30] rounded py-1 text-center text-gray-200 outline-none text-sm focus:border-blue-500 transition-colors"
                  />
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  step="1" 
                  value={viewport.gridSubdivisions || 10} 
                  onChange={(e) => onChange({gridSubdivisions: Number(e.target.value)})} 
                  className="w-full accent-blue-500 h-1.5 bg-[#121212] rounded-lg appearance-none cursor-pointer" 
                />
              </div>

              {/* Axes Toggles */}
              <div className="flex items-center justify-between">
                <span className="text-gray-400 font-medium text-sm">Axes</span>
                <div className="flex space-x-3">
                  <button 
                    onClick={() => onChange({ showAxisX: !viewport.showAxisX })} 
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${viewport.showAxisX ? 'bg-red-500/20 text-red-500 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-[#121212] text-gray-500 border border-[#2a2a30] hover:border-gray-500'}`}
                  >
                    X
                  </button>
                  <button 
                    onClick={() => onChange({ showAxisY: !viewport.showAxisY })} 
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${viewport.showAxisY ? 'bg-green-500/20 text-green-500 border border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]' : 'bg-[#121212] text-gray-500 border border-[#2a2a30] hover:border-gray-500'}`}
                  >
                    Y
                  </button>
                  <button 
                    onClick={() => onChange({ showAxisZ: !viewport.showAxisZ })} 
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${viewport.showAxisZ ? 'bg-blue-500/20 text-blue-500 border border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'bg-[#121212] text-gray-500 border border-[#2a2a30] hover:border-gray-500'}`}
                  >
                    Z
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-4">
        
        {/* Stats Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsStatsMenuOpen(!isStatsMenuOpen)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full transition-colors ${viewport.activeOverlays?.length ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-[#121212] border border-[#2a2a30] hover:bg-[#2a2a30] text-gray-400 hover:text-gray-200'}`}
          >
            <Activity size={14} />
            <span>Overlays</span>
          </button>

          {/* Stats Popover Menu */}
          {isStatsMenuOpen && (
            <div className="absolute bottom-full right-0 mb-3 w-[200px] bg-[#1e1e24] border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-2 flex flex-col space-y-1 z-[100]">
               {[
                 { id: 'fps', label: 'FPS Monitor' },
                 { id: 'memory', label: 'Memory Allocation' },
                 { id: 'renderer', label: 'GPU Renderer' }
               ].map((overlay) => (
                  <button 
                    key={overlay.id}
                    onClick={() => {
                      const current = viewport.activeOverlays || [];
                      const newActive = current.includes(overlay.id) 
                        ? current.filter(id => id !== overlay.id)
                        : [...current, overlay.id];
                      onChange({ activeOverlays: newActive });
                    }}
                    className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-[#2a2a30] text-gray-300 transition-colors text-left"
                  >
                    <div className={`w-3 h-3 rounded-sm border flex-shrink-0 ${viewport.activeOverlays?.includes(overlay.id) ? 'bg-green-500 border-green-500' : 'border-[#4a4a50]'}`} />
                    <span>{overlay.label}</span>
                  </button>
               ))}
            </div>
          )}
        </div>

        {/* Camera Type */}
        <div className="flex items-center space-x-2">
          <Video size={14} />
          <div className="flex bg-[#121212] border border-[#2a2a30] rounded-full overflow-hidden text-xs">
            <button 
              onClick={() => onChange({ cameraType: 'perspective' })} 
              className={`px-3 py-1.5 transition-colors ${viewport.cameraType === 'perspective' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Persp
            </button>
            <button 
              onClick={() => onChange({ cameraType: 'orthographic' })} 
              className={`px-3 py-1.5 border-l border-[#2a2a30] transition-colors ${viewport.cameraType === 'orthographic' ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Ortho
            </button>
          </div>
        </div>

        {/* Shading Overlays */}
        <div className="flex items-center space-x-2">
          <Eye size={14} />
          <select
            value={viewport.shadingMode}
            onChange={(e) => onChange({ shadingMode: e.target.value as ShadingMode })}
            className="bg-[#121212] border border-[#2a2a30] rounded-full px-3 py-1.5 text-gray-300 outline-none focus:border-blue-500 cursor-pointer capitalize"
          >
            {SHADING_MODES.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Gizmo Type */}
        <div className="flex items-center space-x-2">
          <Box size={14} />
          <select
            value={viewport.gizmoType}
            onChange={(e) => onChange({ gizmoType: e.target.value as GizmoType })}
            className="bg-[#121212] border border-[#2a2a30] rounded-full px-3 py-1.5 text-gray-300 outline-none focus:border-blue-500 cursor-pointer capitalize"
          >
            {GIZMOS.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
