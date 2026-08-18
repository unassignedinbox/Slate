import React from 'react';
import { ViewportConfig } from '../types';

interface OutlinerAreaProps {
  viewport: ViewportConfig;
}

export function OutlinerArea({ viewport }: OutlinerAreaProps) {
  return (
    <div className="flex-1 bg-[#121212] flex flex-col relative overflow-hidden text-sm">
      <div className="flex-1 overflow-y-auto p-2 no-scrollbar flex items-center justify-center">
         <span className="text-gray-600 italic">Empty</span>
      </div>
    </div>
  );
}
