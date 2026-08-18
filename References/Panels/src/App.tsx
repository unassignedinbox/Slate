/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { TabBar } from './components/TabBar';
import { ViewportArea } from './components/ViewportArea';
import { FooterControls } from './components/FooterControls';
import { LayoutRenderer } from './components/LayoutRenderer';
import { ViewportConfig, SplitDirection, PanelType } from './types';
import { splitNode, closeNode, updatePanelType, resizeSplit } from './utils/layoutUtils';

function createDefaultViewport(idNum: number, initialPanelType: PanelType = 'empty'): ViewportConfig {
  return {
    id: `vp-${Date.now()}-${Math.random()}`,
    name: `Workspace ${idNum}`,
    gridType: 'lines',
    gridSize: 1,
    gridSubdivisions: 10,
    gridUnit: 'm',
    shadingMode: 'solid',
    gizmoType: 'blender',
    zoomToFit: true,
    showAxisX: true,
    showAxisY: false,
    showAxisZ: true,
    cameraType: 'perspective',
    bookmarks: [],
    activeOverlays: [],
    layout: { id: `root-${idNum}`, type: 'leaf', panelType: initialPanelType },
  };
}

export default function App() {
  const [viewports, setViewports] = useState<ViewportConfig[]>([createDefaultViewport(1, '3d_viewport')]);
  const [activeId, setActiveId] = useState<string>(viewports[0].id);
  const [nextIdNum, setNextIdNum] = useState(2);

  const activeViewport = viewports.find(vp => vp.id === activeId) || viewports[0];
  const cameraManagerRef = useRef<any>(null);

  const handleAdd = () => {
    const newVp = createDefaultViewport(nextIdNum);
    setViewports([...viewports, newVp]);
    setActiveId(newVp.id);
    setNextIdNum(prev => prev + 1);
  };

  const handleClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewports.length === 1) return; // Prevent closing last tab
    
    const newViewports = viewports.filter(vp => vp.id !== id);
    setViewports(newViewports);
    
    if (activeId === id) {
      setActiveId(newViewports[newViewports.length - 1].id);
    }
  };

  const handleViewportChange = (id: string, updates: Partial<ViewportConfig>) => {
    setViewports(prev => prev.map(vp => 
      vp.id === id ? { ...vp, ...updates } : vp
    ));
  };

  return (
    <div className="h-screen w-screen bg-[#000000] text-gray-200 font-sans flex flex-col items-center justify-center py-6 px-4">
      {/* Main Window Container */}
      <div className="w-full h-full max-w-6xl flex-1 flex flex-col bg-[#0a0a0c] rounded-3xl border border-[#1e1e24] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden relative">
        {/* Viewport Tabs Header */}
        <TabBar
          viewports={viewports}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={handleClose}
          onAdd={handleAdd}
        />

        {/* Main Viewport Content */}
        {activeViewport ? (
          <div className="flex-1 flex flex-col relative overflow-hidden bg-[#0a0a0c]">
            <LayoutRenderer
              node={activeViewport.layout}
              config={activeViewport}
              onUpdateConfig={(updates) => handleViewportChange(activeViewport.id, updates)}
              cameraManagerRef={cameraManagerRef}
              layoutActions={{
                onSplit: (id: string, dir: SplitDirection, insertAt: 'first' | 'second') => {
                  handleViewportChange(activeViewport.id, { layout: splitNode(activeViewport.layout, id, dir, insertAt) });
                },
                onClose: (id: string) => {
                  const newLayout = closeNode(activeViewport.layout, id);
                  if (newLayout) handleViewportChange(activeViewport.id, { layout: newLayout });
                },
                onUpdatePanel: (id: string, type: PanelType) => {
                  handleViewportChange(activeViewport.id, { layout: updatePanelType(activeViewport.layout, id, type) });
                },
                onResize: (id: string, ratio: number) => {
                  handleViewportChange(activeViewport.id, { layout: resizeSplit(activeViewport.layout, id, ratio) });
                },
                canClose: activeViewport.layout.type === 'split'
              }}
            />
          </div>
        ) : (
          <div className="flex-1 bg-[#0a0a0c] flex items-center justify-center text-gray-500">
            No active viewport
          </div>
        )}
      </div>
    </div>
  );
}
