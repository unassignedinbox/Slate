import React, { useState, useRef, useEffect } from 'react';
import { Box, ListTree, Sliders, ChevronDown, Plus, X, ArrowLeftFromLine, ArrowRightFromLine, ArrowUpFromLine, ArrowDownFromLine, Map, Layout } from 'lucide-react';
import { PanelType } from '../types';

interface EditorHeaderProps {
  panelType: PanelType;
  onTypeChange: (type: PanelType) => void;
  onSplit: (direction: 'horizontal' | 'vertical', insertAt: 'first' | 'second') => void;
  onClose: () => void;
  canClose: boolean;
}

const PANEL_TYPES: { id: PanelType; label: string; icon: React.ReactNode }[] = [
  { id: '3d_viewport', label: '3D Viewport', icon: <Box size={14} /> },
  { id: 'uv_editor', label: 'UV Editor', icon: <Map size={14} /> },
  { id: 'outliner', label: 'Outliner', icon: <ListTree size={14} /> },
  { id: 'properties', label: 'Properties', icon: <Sliders size={14} /> },
];

export function EditorHeader({ panelType, onTypeChange, onSplit, onClose, canClose }: EditorHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const splitMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
      if (splitMenuRef.current && !splitMenuRef.current.contains(e.target as Node)) setIsSplitOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activePanel = PANEL_TYPES.find(p => p.id === panelType) || PANEL_TYPES[0];

  return (
    <div className="h-8 bg-[#1e1e24] border-b border-[#2a2a30] flex items-center px-2 z-20 shadow-sm relative select-none">
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={() => { setIsOpen(!isOpen); setIsSplitOpen(false); }}
          className={`flex items-center space-x-1.5 px-2 py-1 rounded transition-colors ${isOpen ? 'bg-[#3a3a40] text-gray-100' : 'hover:bg-[#2a2a30] text-gray-400 hover:text-gray-200'}`}
          title="Editor Type"
        >
          {activePanel.icon}
          <ChevronDown size={12} className="opacity-50" />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-[160px] bg-[#1e1e24] border border-[#2a2a30] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1 flex flex-col z-[100]">
            {PANEL_TYPES.map((panel) => (
              <button
                key={panel.id}
                onClick={() => {
                  onTypeChange(panel.id);
                  setIsOpen(false);
                }}
                className={`flex items-center space-x-2 px-3 py-1.5 hover:bg-[#3a3a40] transition-colors text-left text-sm ${panelType === panel.id ? 'text-white bg-[#2a2a30]' : 'text-gray-400'}`}
              >
                {panel.icon}
                <span>{panel.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-4 flex items-center text-xs text-gray-300">
         <span className="font-semibold">{activePanel.label}</span>
      </div>
      
      <div className="ml-auto flex items-center space-x-1 pr-1">
        <div className="relative" ref={splitMenuRef}>
          <button 
            onClick={() => { setIsSplitOpen(!isSplitOpen); setIsOpen(false); }} 
            className={`p-1.5 rounded-md transition-colors ${isSplitOpen ? 'bg-[#3a3a40] text-white' : 'text-gray-400 hover:bg-[#2a2a30] hover:text-gray-200'}`} 
            title="Split Panel"
          >
            <Layout size={14} />
          </button>
          
          {isSplitOpen && (
            <div className="absolute top-full right-0 mt-1 w-[140px] bg-[#1e1e24] border border-[#2a2a30] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] py-1 flex flex-col z-[100]">
              <button onClick={() => { onSplit('horizontal', 'first'); setIsSplitOpen(false); }} className="flex items-center space-x-2 px-3 py-1.5 hover:bg-[#3a3a40] text-gray-400 hover:text-white transition-colors text-left text-sm">
                 <ArrowLeftFromLine size={14} />
                 <span>Split Left</span>
              </button>
              <button onClick={() => { onSplit('horizontal', 'second'); setIsSplitOpen(false); }} className="flex items-center space-x-2 px-3 py-1.5 hover:bg-[#3a3a40] text-gray-400 hover:text-white transition-colors text-left text-sm">
                 <ArrowRightFromLine size={14} />
                 <span>Split Right</span>
              </button>
              <div className="my-1 border-t border-[#2a2a30]"></div>
              <button onClick={() => { onSplit('vertical', 'first'); setIsSplitOpen(false); }} className="flex items-center space-x-2 px-3 py-1.5 hover:bg-[#3a3a40] text-gray-400 hover:text-white transition-colors text-left text-sm">
                 <ArrowUpFromLine size={14} />
                 <span>Split Top</span>
              </button>
              <button onClick={() => { onSplit('vertical', 'second'); setIsSplitOpen(false); }} className="flex items-center space-x-2 px-3 py-1.5 hover:bg-[#3a3a40] text-gray-400 hover:text-white transition-colors text-left text-sm">
                 <ArrowDownFromLine size={14} />
                 <span>Split Bottom</span>
              </button>
            </div>
          )}
        </div>
        
        {canClose && (
          <button onClick={onClose} className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md text-gray-400 transition-colors" title="Close Panel">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
