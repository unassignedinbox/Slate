import React, { useRef } from 'react';
import { LayoutNode, ViewportConfig, PanelType, SplitDirection } from '../types';
import { EditorHeader } from './EditorHeader';
import { ViewportArea } from './ViewportArea';
import { OutlinerArea } from './OutlinerArea';
import { PropertiesArea } from './PropertiesArea';
import { FooterControls } from './FooterControls';
import { UVEditorArea } from './UVEditorArea';
import { Box, ListTree, Sliders, X, Plus, Map } from 'lucide-react';

interface LayoutRendererProps {
  node: LayoutNode;
  config: ViewportConfig;
  onUpdateConfig: (updates: Partial<ViewportConfig>) => void;
  cameraManagerRef: React.MutableRefObject<any>;
  layoutActions: {
    onSplit: (id: string, dir: SplitDirection, insertAt: 'first' | 'second') => void;
    onClose: (id: string) => void;
    onUpdatePanel: (id: string, type: PanelType) => void;
    onResize: (id: string, ratio: number) => void;
    canClose: boolean;
  };
}

export function LayoutRenderer(props: LayoutRendererProps) {
    if (props.node.type === 'split') {
        return <SplitContainer {...props} node={props.node} />;
    }
    return <LeafContainer {...props} node={props.node} />;
}

function EmptyPanelChooser({ onChoose, onClose }: { onChoose: (type: PanelType) => void, onClose: () => void }) {
    const CHOICES: { id: PanelType; label: string; icon: React.ReactNode }[] = [
      { id: '3d_viewport', label: '3D Viewport', icon: <Box size={24} /> },
      { id: 'uv_editor', label: 'UV Editor', icon: <Map size={24} /> },
      { id: 'outliner', label: 'Outliner', icon: <ListTree size={24} /> },
      { id: 'properties', label: 'Properties', icon: <Sliders size={24} /> },
    ];

    return (
        <div className="flex-1 w-full h-full bg-[#0a0a0c] flex flex-col items-center justify-center relative p-6">
            <button onClick={onClose} className="absolute top-4 right-4 p-1.5 text-gray-500 hover:text-white bg-[#1a1a1f] hover:bg-red-500/20 hover:text-red-400 rounded-lg border border-[#2a2a30] transition-colors shadow-sm">
               <X size={16} />
            </button>
            
            <h3 className="text-gray-300 font-medium mb-6 flex items-center space-x-2">
               <Plus size={16} className="text-blue-500" />
               <span>Choose Panel Type</span>
            </h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl w-full">
                {CHOICES.map(p => (
                    <button
                        key={p.id}
                        onClick={() => onChoose(p.id)}
                        className="flex flex-col items-center justify-center p-5 bg-[#121212] border border-[#2a2a30] rounded-xl hover:border-blue-500/50 hover:bg-[#1a1a1f] hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] transition-all group"
                    >
                        <div className="text-gray-500 group-hover:text-blue-400 mb-3 transition-colors">{p.icon}</div>
                        <span className="text-sm text-gray-400 font-medium group-hover:text-gray-200 transition-colors">{p.label}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

function SplitContainer(props: LayoutRendererProps & { node: any }) {
    const { node, layoutActions } = props;
    const isHorizontal = node.direction === 'horizontal';
    const containerRef = useRef<HTMLDivElement>(null);

    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startPos = isHorizontal ? e.clientX : e.clientY;
        const startRatio = node.ratio;
        let finalRatio = startRatio;

        const onMouseMove = (moveEvent: MouseEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const delta = isHorizontal ? moveEvent.clientX - startPos : moveEvent.clientY - startPos;
            const total = isHorizontal ? rect.width : rect.height;
            finalRatio = startRatio + delta / total;
            
            const visualRatio = Math.max(0, Math.min(1, finalRatio));
            layoutActions.onResize(node.id, visualRatio);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            if (finalRatio < 0.05) {
                layoutActions.onClose(node.first.id);
            } else if (finalRatio > 0.95) {
                layoutActions.onClose(node.second.id);
            } else {
                const clampedRatio = Math.max(0.05, Math.min(0.95, finalRatio));
                layoutActions.onResize(node.id, clampedRatio);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div ref={containerRef} className={`flex w-full h-full overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
            <div style={{ flex: `${node.ratio * 100}%` }} className="relative overflow-hidden flex flex-col">
                <LayoutRenderer {...props} node={node.first} />
            </div>
            <div
                onMouseDown={handleDragStart}
                className={`bg-[#1e1e24] z-[100] transition-colors hover:bg-blue-500 border-[#2a2a30] ${isHorizontal ? 'w-1.5 border-x cursor-col-resize' : 'h-1.5 border-y cursor-row-resize'}`}
            />
            <div style={{ flex: `${(1 - node.ratio) * 100}%` }} className="relative overflow-hidden flex flex-col">
                <LayoutRenderer {...props} node={node.second} />
            </div>
        </div>
    );
}

function LeafContainer(props: LayoutRendererProps & { node: any }) {
    const { node, config, onUpdateConfig, layoutActions, cameraManagerRef } = props;
    const containerRef = useRef<HTMLDivElement>(null);

    if (node.panelType === 'empty') {
        return (
            <div ref={containerRef} className="flex w-full h-full flex-col relative overflow-hidden bg-[#0a0a0c]">
                <EmptyPanelChooser
                    onChoose={(type) => layoutActions.onUpdatePanel(node.id, type)}
                    onClose={() => layoutActions.onClose(node.id)}
                />
            </div>
        );
    }

    return (
        <div ref={containerRef} className="flex w-full h-full flex-col bg-[#0a0a0c] relative overflow-hidden border border-transparent">
            <EditorHeader
                panelType={node.panelType}
                onTypeChange={(type) => layoutActions.onUpdatePanel(node.id, type)}
                onSplit={(dir, insertAt) => layoutActions.onSplit(node.id, dir, insertAt)}
                onClose={() => layoutActions.onClose(node.id)}
                canClose={layoutActions.canClose}
            />
            
            <div className="flex-1 relative overflow-hidden flex flex-col">
                {node.panelType === '3d_viewport' && <ViewportArea viewport={config} onChange={onUpdateConfig} cameraManagerRef={cameraManagerRef} />}
                {node.panelType === 'uv_editor' && <UVEditorArea />}
                {node.panelType === 'outliner' && <OutlinerArea viewport={config} />}
                {node.panelType === 'properties' && <PropertiesArea viewport={config} />}
            </div>

            {/* Footers */}
            {node.panelType === '3d_viewport' && <FooterControls viewport={config} onChange={onUpdateConfig} cameraManagerRef={cameraManagerRef} />}
            {node.panelType === 'outliner' && (
                <div className="h-12 bg-[#1e1e24] flex items-center px-4 text-xs text-gray-500 select-none relative z-50 border-t border-[#2a2a30]">
                    <span>0 items</span>
                </div>
            )}
            {node.panelType === 'properties' && (
                <div className="h-12 bg-[#1e1e24] flex items-center justify-between px-4 text-xs text-gray-500 select-none relative z-50 border-t border-[#2a2a30]">
                    <span>No active object</span>
                </div>
            )}
        </div>
    );
}
