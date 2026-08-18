import React from 'react';
import { Plus, X } from 'lucide-react';
import { ViewportConfig } from '../types';

interface TabBarProps {
  viewports: ViewportConfig[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string, e: React.MouseEvent) => void;
  onAdd: () => void;
}

export function TabBar({ viewports, activeId, onSelect, onClose, onAdd }: TabBarProps) {
  return (
    <div className="flex items-end h-8 bg-[#121212] select-none pl-4">
      {viewports.map((vp) => {
        const isActive = vp.id === activeId;
        return (
          <div
            key={vp.id}
            onClick={() => onSelect(vp.id)}
            className={`
              relative group flex items-center justify-between h-8 px-6 min-w-[140px] max-w-[200px] cursor-pointer
              transition-colors -ml-3 z-10
              ${isActive ? 'bg-[#1e1e24] text-gray-100 z-20' : 'bg-[#18181c] text-gray-400 hover:bg-[#202026] hover:text-gray-200'}
            `}
            style={{
              clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%)',
            }}
          >
            <span className="truncate flex-1 text-xs font-medium mr-2">{vp.name}</span>
            <button
              onClick={(e) => onClose(vp.id, e)}
              className={`p-0.5 rounded-sm hover:bg-white/10 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      
      <button
        onClick={onAdd}
        className="flex items-center justify-center w-6 h-6 ml-2 mb-1 rounded-full bg-[#1e1e24] hover:bg-[#2a2a30] text-gray-400 hover:text-gray-100 transition-colors z-0"
        title="New Viewport"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

