import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export interface StatsData {
  fps: number;
  memory: number; // MB
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

function DraggableWidget({ id, title, children, onClose, initialPosition }: any) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={initialPosition}
      className="absolute z-50 bg-[#121212]/95 backdrop-blur-md border border-[#2a2a30] rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden min-w-[280px]"
      style={{ touchAction: 'none' }}
    >
      <div className="flex items-center justify-between p-3 border-b border-[#2a2a30] cursor-grab active:cursor-grabbing bg-[#1a1a1f]/50 select-none">
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        <div className="flex space-x-1">
          <button 
            onClick={() => setCollapsed(!collapsed)} 
            className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-[#2a2a30]"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-red-400 transition-colors p-1 rounded hover:bg-[#2a2a30]"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {!collapsed && <div className="p-4">{children}</div>}
    </motion.div>
  );
}

export function StatWidgetsManager({ activeOverlays, onChange, statsRef }: any) {
  const [data, setData] = useState<StatsData>({ fps: 0, memory: 0, drawCalls: 0, triangles: 0, textures: 0, geometries: 0 });
  const [fpsHistory, setFpsHistory] = useState<number[]>(Array(30).fill(0));

  useEffect(() => {
    if (!activeOverlays || activeOverlays.length === 0) return;
    
    const interval = setInterval(() => {
      const currentStats = statsRef.current;
      setData({ ...currentStats });
      setFpsHistory(prev => [...prev.slice(-29), currentStats.fps]);
    }, 500);
    
    return () => clearInterval(interval);
  }, [activeOverlays, statsRef]);

  const closeOverlay = (id: string) => {
    onChange({ activeOverlays: activeOverlays.filter((x: string) => x !== id) });
  };

  if (!activeOverlays || activeOverlays.length === 0) return null;

  // Render SVG points for FPS
  const maxFPS = 60;
  const fpsPoints = fpsHistory.map((fps, i) => `${(i / (fpsHistory.length - 1)) * 100},${100 - Math.min((fps / maxFPS) * 100, 100)}`).join(' ');

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-40">
      {/* FPS Widget */}
      {activeOverlays.includes('fps') && (
        <div className="pointer-events-auto">
          <DraggableWidget id="fps" title="FPS Monitor" onClose={() => closeOverlay('fps')} initialPosition={{ x: window.innerWidth - 320, y: 20 }}>
            <div className="flex justify-between items-end">
              <span className="text-3xl font-bold text-gray-100">{data.fps}</span>
              <span className="text-xs text-gray-400 mb-1">frames per sec</span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-16 mt-3 bg-[#1a1a1f] rounded border border-[#2a2a30]">
              <polyline points={fpsPoints} fill="none" stroke="#60a5fa" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </DraggableWidget>
        </div>
      )}

      {/* Memory Widget */}
      {activeOverlays.includes('memory') && (
        <div className="pointer-events-auto">
          <DraggableWidget id="memory" title="Memory Allocation" onClose={() => closeOverlay('memory')} initialPosition={{ x: window.innerWidth - 320, y: 200 }}>
            <div className="flex flex-col space-y-4">
              <div>
                 <span className="text-xs text-gray-400">Total JS Heap (MB)</span>
                 <div className="text-2xl font-bold text-gray-100">{data.memory > 0 ? data.memory : '--'}</div>
              </div>
              
              <div className="flex flex-col space-y-2">
                 <span className="text-xs text-gray-400">Asset Distribution</span>
                 <div className="flex h-6 w-full rounded overflow-hidden">
                    <div className="bg-green-500" style={{ width: '40%' }} title="Geometries" />
                    <div className="bg-blue-500" style={{ width: '30%' }} title="Textures" />
                    <div className="bg-purple-500" style={{ width: '20%' }} title="Materials" />
                    <div className="bg-orange-500" style={{ width: '10%' }} title="Other" />
                 </div>
                 <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 mt-2">
                    <div className="flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-1" /> Geometries ({data.geometries})</div>
                    <div className="flex items-center"><span className="w-2 h-2 bg-blue-500 rounded-full mr-1" /> Textures ({data.textures})</div>
                 </div>
              </div>
            </div>
          </DraggableWidget>
        </div>
      )}

      {/* Renderer Widget */}
      {activeOverlays.includes('renderer') && (
        <div className="pointer-events-auto">
          <DraggableWidget id="renderer" title="GPU Renderer Info" onClose={() => closeOverlay('renderer')} initialPosition={{ x: window.innerWidth - 320, y: 450 }}>
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-[#1a1a1f] border border-[#2a2a30] p-3 rounded-lg flex flex-col">
                 <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Draw Calls</span>
                 <span className="text-xl font-bold text-gray-100 mt-1">{data.drawCalls}</span>
               </div>
               <div className="bg-[#1a1a1f] border border-[#2a2a30] p-3 rounded-lg flex flex-col">
                 <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Triangles</span>
                 <span className="text-xl font-bold text-gray-100 mt-1">{data.triangles.toLocaleString()}</span>
               </div>
             </div>
          </DraggableWidget>
        </div>
      )}
    </div>
  );
}
