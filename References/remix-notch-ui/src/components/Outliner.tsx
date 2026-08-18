import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Folder, Box, Sun, Camera, Wind, FileCode, Compass, Bone, 
  Eye, EyeOff, Lock, Unlock, LayoutList, LayoutGrid, ListTree, 
  Search, ChevronRight, ChevronDown, Layers, Cpu, Zap, Settings2,
  MoreHorizontal
} from 'lucide-react';

type ItemType = 'folder' | 'mesh' | 'light' | 'camera' | 'physics' | 'script' | 'cad' | 'bone' | 'system';

interface OutlinerItem {
  id: string;
  name: string;
  type: ItemType;
  children?: OutlinerItem[];
  visible: boolean;
  locked: boolean;
  color?: string;
}

const MOCK_DATA: OutlinerItem[] = [
  {
    id: 'env', name: 'Environment', type: 'folder', visible: true, locked: false,
    children: [
      { id: 'sun', name: 'Directional Light', type: 'light', visible: true, locked: true },
      { id: 'sky', name: 'Procedural Sky', type: 'system', visible: true, locked: false },
      { id: 'wind', name: 'Global Wind Force', type: 'physics', visible: true, locked: false },
    ]
  },
  {
    id: 'player', name: 'Player Character', type: 'folder', visible: true, locked: false,
    children: [
      { id: 'rig', name: 'Humanoid Rig', type: 'bone', visible: true, locked: false },
      { id: 'mesh', name: 'Hero_Mesh_HighPoly', type: 'mesh', visible: true, locked: false },
      { id: 'col', name: 'Capsule Collider', type: 'physics', visible: false, locked: false },
      { id: 'script', name: 'PlayerController.ts', type: 'script', visible: true, locked: false },
    ]
  },
  {
    id: 'level', name: 'Level Geometry', type: 'folder', visible: true, locked: false,
    children: [
      { id: 'terrain', name: 'Terrain_Chunk_01', type: 'mesh', visible: true, locked: true },
      { 
        id: 'obs', name: 'Obstacles', type: 'folder', visible: true, locked: false,
        children: [
          { id: 'wall1', name: 'Wall_Parametric_A', type: 'cad', visible: true, locked: false },
          { id: 'wall2', name: 'Wall_Parametric_B', type: 'cad', visible: true, locked: false },
          { id: 'box', name: 'RigidBody_Crate', type: 'physics', visible: true, locked: false },
        ]
      }
    ]
  },
  {
    id: 'sim', name: 'Active Simulations', type: 'folder', visible: true, locked: false,
    children: [
      { id: 'fluid', name: 'Water_Fluid_Sim', type: 'physics', visible: true, locked: false },
      { id: 'cloth', name: 'Flag_Cloth_Sim', type: 'physics', visible: true, locked: false },
    ]
  }
];

const getTypeIcon = (type: ItemType) => {
  switch (type) {
    case 'folder': return Folder;
    case 'mesh': return Box;
    case 'light': return Sun;
    case 'camera': return Camera;
    case 'physics': return Zap;
    case 'script': return FileCode;
    case 'cad': return Compass;
    case 'bone': return Bone;
    case 'system': return Cpu;
    default: return Box;
  }
};

const getTypeColor = (type: ItemType) => {
  switch (type) {
    case 'folder': return 'text-yellow-500';
    case 'mesh': return 'text-blue-400';
    case 'light': return 'text-amber-300';
    case 'camera': return 'text-zinc-400';
    case 'physics': return 'text-purple-400';
    case 'script': return 'text-emerald-400';
    case 'cad': return 'text-orange-400';
    case 'bone': return 'text-rose-400';
    case 'system': return 'text-cyan-400';
    default: return 'text-zinc-400';
  }
};

export default function Outliner({ 
  isOpen, 
  theme, 
  typographyStyles, 
  font,
  iconStroke,
  iconSize,
  iconStyle,
  systemColors
}: any) {
  const [data, setData] = useState<OutlinerItem[]>(MOCK_DATA);
  const [layout, setLayout] = useState<'tree' | 'list' | 'grid'>('tree');
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['env', 'player', 'level', 'obs']));
  const [selected, setSelected] = useState<string | null>('mesh');
  const [contextMenu, setContextMenu] = useState<{ id: string, type: ItemType, x: number, y: number } | null>(null);
  
  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const handleDelete = (id: string) => {
    const filterOut = (items: OutlinerItem[]): OutlinerItem[] => {
      return items.filter(item => item.id !== id).map(item => ({
        ...item,
        children: item.children ? filterOut(item.children) : undefined
      }));
    };
    setData(filterOut(data));
    setContextMenu(null);
  };

  const handleSetColor = (id: string, color: string) => {
    const updateColor = (items: OutlinerItem[]): OutlinerItem[] => {
      return items.map(item => {
        if (item.id === id) return { ...item, color };
        if (item.children) return { ...item, children: updateColor(item.children) };
        return item;
      });
    };
    setData(updateColor(data));
    setContextMenu(null);
  };

  const flattenData = (items: OutlinerItem[], depth = 0): (OutlinerItem & { depth: number })[] => {
    let result: (OutlinerItem & { depth: number })[] = [];
    for (const item of items) {
      result.push({ ...item, depth });
      if (item.children && expanded.has(item.id)) {
        result = result.concat(flattenData(item.children, depth + 1));
      }
    }
    return result;
  };

  const allItemsFlat = flattenData(data);
  const filteredItems = allItemsFlat.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // If list or grid, we just show all items flat without depth (or just leaf nodes? Let's show all matching)
  const displayItems = layout === 'tree' ? filteredItems : 
    // for list/grid, maybe flatten everything regardless of expanded state
    (() => {
      const flatAll = (items: OutlinerItem[]): OutlinerItem[] => {
        let res: OutlinerItem[] = [];
        for (const i of items) {
          res.push(i);
          if (i.children) res = res.concat(flatAll(i.children));
        }
        return res;
      };
      return flatAll(data).filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    })();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '-100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '-100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={`absolute left-0 top-0 bottom-0 w-80 ${theme.panel} border-r ${theme.border} shadow-2xl z-40 flex flex-col backdrop-blur-xl`}
          style={{ fontFamily: font.name }}
        >
          {/* Header */}
          <div className={`p-4 border-b ${theme.border} flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className={`${theme.text}`} size={20} strokeWidth={iconStroke} />
                <h2 className={`${theme.text} ${typographyStyles.title} text-lg`}>Outliner</h2>
              </div>
              <div className="flex items-center gap-1 bg-zinc-500/10 p-1 rounded-lg">
                <button onClick={() => setLayout('tree')} className={`p-1.5 rounded-md transition-all ${layout === 'tree' ? `${theme.card} ${theme.text} shadow-sm` : `${theme.subtext} hover:bg-zinc-500/10`}`}>
                  <ListTree size={16} strokeWidth={iconStroke} />
                </button>
                <button onClick={() => setLayout('list')} className={`p-1.5 rounded-md transition-all ${layout === 'list' ? `${theme.card} ${theme.text} shadow-sm` : `${theme.subtext} hover:bg-zinc-500/10`}`}>
                  <LayoutList size={16} strokeWidth={iconStroke} />
                </button>
                <button onClick={() => setLayout('grid')} className={`p-1.5 rounded-md transition-all ${layout === 'grid' ? `${theme.card} ${theme.text} shadow-sm` : `${theme.subtext} hover:bg-zinc-500/10`}`}>
                  <LayoutGrid size={16} strokeWidth={iconStroke} />
                </button>
              </div>
            </div>
            
            <div className={`relative flex items-center w-full ${theme.card} rounded-lg border ${theme.border} px-3 py-2`}>
              <Search size={14} className={`${theme.subtext} mr-2`} strokeWidth={iconStroke} />
              <input 
                type="text" 
                placeholder="Search hierarchy..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={`bg-transparent border-none outline-none w-full text-sm ${theme.text} placeholder:opacity-50`}
              />
              <Settings2 size={14} className={`${theme.subtext} ml-2 cursor-pointer hover:${theme.text}`} strokeWidth={iconStroke} />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
            {layout === 'grid' ? (
              <div className="grid grid-cols-3 gap-2">
                {displayItems.map(item => {
                  const Icon = getTypeIcon(item.type);
                  const isSelected = selected === item.id;
                  return (
                    <motion.div
                      layoutId={`item-${item.id}`}
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-colors
                        ${isSelected ? `bg-blue-500/10 border-blue-500/30` : `border-transparent hover:bg-zinc-500/10`}
                      `}
                    >
                      <Icon size={24} className={`mb-2 ${iconStyle === 'coloured' ? (item.color || getTypeColor(item.type)) : theme.text}`} strokeWidth={iconStroke} />
                      <span className={`text-[10px] text-center truncate w-full ${isSelected ? theme.text : theme.subtext}`}>{item.name}</span>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {displayItems.map((item: any) => {
                  const Icon = getTypeIcon(item.type);
                  const isSelected = selected === item.id;
                  const depth = layout === 'tree' ? item.depth : 0;
                  const hasChildren = item.children && item.children.length > 0;
                  const isExpanded = expanded.has(item.id);

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      whileHover={{ x: 4, backgroundColor: 'rgba(113, 113, 122, 0.1)' }}
                      whileTap={{ scale: 0.98 }}
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      className={`group flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected ? `bg-blue-500/10` : ``}
                      `}
                      style={{ paddingLeft: `${depth * 16 + 8}px` }}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-4 flex items-center justify-center" onClick={(e) => hasChildren && toggleExpand(item.id, e)}>
                          {hasChildren && (
                            <ChevronRight 
                              size={14} 
                              className={`${theme.subtext} transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} 
                              strokeWidth={iconStroke} 
                            />
                          )}
                        </div>
                        <Icon size={16} className={`shrink-0 ${iconStyle === 'coloured' ? (item.color || getTypeColor(item.type)) : (isSelected ? theme.text : theme.subtext)}`} strokeWidth={iconStroke} />
                        <span className={`text-sm truncate ${isSelected ? `${theme.text} font-medium` : theme.subtext}`}>
                          {item.name}
                        </span>
                      </div>
                      
                      <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-100' : ''}`}>
                        {item.locked ? (
                          <Lock size={12} className="text-red-400/70" strokeWidth={iconStroke} />
                        ) : (
                          <Unlock size={12} className={`${theme.subtext} hover:${theme.text}`} strokeWidth={iconStroke} />
                        )}
                        {item.visible ? (
                          <Eye size={12} className={`${theme.subtext} hover:${theme.text}`} strokeWidth={iconStroke} />
                        ) : (
                          <EyeOff size={12} className="text-zinc-500/50" strokeWidth={iconStroke} />
                        )}
                        <MoreHorizontal 
                          size={14} 
                          className={`${theme.subtext} hover:${theme.text} ml-1`} 
                          strokeWidth={iconStroke} 
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextMenu({ id: item.id, type: item.type, x: e.clientX, y: e.clientY });
                          }}
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Footer Status */}
          <div className={`p-2 border-t ${theme.border} flex justify-between items-center text-[10px] ${theme.subtext}`}>
            <span>{displayItems.length} Objects</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1"><Zap size={10} className="text-purple-400" /> 3 Active</span>
              <span className="flex items-center gap-1"><Box size={10} className="text-blue-400" /> 12.4k Tris</span>
            </div>
          </div>

          {/* Context Menu Overlay */}
          {contextMenu && (
            <div 
              className="fixed inset-0 z-[100]" 
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
            />
          )}
          <AnimatePresence>
            {contextMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className={`fixed z-[101] w-48 ${theme.panel} border ${theme.border} shadow-2xl rounded-xl overflow-hidden flex flex-col p-1 backdrop-blur-2xl`}
                style={{ 
                  left: Math.min(contextMenu.x, window.innerWidth - 200), 
                  top: Math.min(contextMenu.y, window.innerHeight - 200) 
                }}
              >
                  <div className={`px-3 py-2 text-xs font-medium ${theme.subtext} border-b ${theme.border} mb-1`}>
                    {contextMenu.type === 'folder' ? 'Folder Options' : 'Object Options'}
                  </div>
                  
                  {contextMenu.type === 'folder' && (
                    <div className="px-2 py-1.5 mb-1">
                      <div className={`text-[10px] uppercase tracking-wider ${theme.subtext} mb-2`}>Set Color</div>
                      <div className="flex gap-1.5">
                        {['text-red-400', 'text-orange-400', 'text-yellow-400', 'text-green-400', 'text-blue-400', 'text-purple-400'].map(color => (
                          <button
                            key={color}
                            onClick={() => handleSetColor(contextMenu.id, color)}
                            className={`w-5 h-5 rounded-full ${color.replace('text-', 'bg-').replace('400', '500')} hover:scale-110 transition-transform`}
                          />
                        ))}
                        <button
                          onClick={() => handleSetColor(contextMenu.id, '')}
                          className={`w-5 h-5 rounded-full border ${theme.border} flex items-center justify-center hover:scale-110 transition-transform`}
                        >
                          <X size={10} className={theme.subtext} />
                        </button>
                      </div>
                    </div>
                  )}

                  <button 
                    className={`flex items-center gap-2 px-2 py-1.5 text-sm ${theme.text} hover:bg-zinc-500/10 rounded-md transition-colors text-left`}
                    onClick={() => { /* Rename logic */ setContextMenu(null); }}
                  >
                    <Type size={14} /> Rename
                  </button>
                  
                  <button 
                    className={`flex items-center gap-2 px-2 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-md transition-colors text-left`}
                    onClick={() => handleDelete(contextMenu.id)}
                  >
                    <X size={14} /> Delete
                  </button>
                </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
