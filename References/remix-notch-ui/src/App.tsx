import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wifi, Bluetooth, Battery, Moon, Bell, Settings, 
  ChevronLeft, ChevronRight, Palette, Type, CheckCircle2,
  Monitor, X, AlertTriangle, Info, Volume2, Mic, Shield, Mail, Calendar, MessageSquare, BellRing, Sun, Keyboard, ArrowLeft, ChevronDown,
  CornerDownLeft, ArrowRightLeft, Star, RefreshCw
} from 'lucide-react';

const QualityStarsIcon = ({ count, strokeWidth, className, style, size }: any) => {
  const dim = size || 24;
  return (
    <div className={className} style={{ ...style, position: 'relative', width: dim, height: dim }}>
      {count === 1 && <Star strokeWidth={strokeWidth} style={{width: '100%', height: '100%', position: 'absolute', top: 0, left: 0}} />}
      {count === 2 && <>
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: 0, top: '15%', width: '60%', height: '60%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: 0, bottom: '15%', width: '60%', height: '60%'}} />
      </>}
      {count === 3 && <>
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: '20%', top: 0, width: '60%', height: '60%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: 0, bottom: 0, width: '60%', height: '60%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: 0, bottom: 0, width: '60%', height: '60%'}} />
      </>}
      {count === 4 && <>
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: 0, top: 0, width: '55%', height: '55%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: 0, top: 0, width: '55%', height: '55%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: 0, bottom: 0, width: '55%', height: '55%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: 0, bottom: 0, width: '55%', height: '55%'}} />
      </>}
      {count === 5 && <>
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: '25%', top: 0, width: '50%', height: '50%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: 0, top: '35%', width: '45%', height: '45%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: 0, top: '35%', width: '45%', height: '45%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', left: '10%', bottom: 0, width: '45%', height: '45%'}} />
        <Star strokeWidth={strokeWidth} style={{position:'absolute', right: '10%', bottom: 0, width: '45%', height: '45%'}} />
      </>}
    </div>
  );
};

const THEMES = {
  oled: { 
    id: 'oled', name: 'OLED', 
    bg: 'bg-[#000000]', panel: 'bg-[#09090b]/95', 
    text: 'text-zinc-100', subtext: 'text-zinc-500', 
    border: 'border-zinc-800/80', card: 'bg-[#121214]',
    notch: 'text-zinc-900',
    previewBg: 'bg-[#000000]', previewWindow: 'bg-[#121214]',
    previewEl1: 'bg-white/5', previewEl2: 'bg-white/10'
  },
  dark: { 
    id: 'dark', name: 'Dark', 
    bg: 'bg-[#0a0a0a]', panel: 'bg-[#18181b]/95', 
    text: 'text-zinc-100', subtext: 'text-zinc-400', 
    border: 'border-zinc-800', card: 'bg-[#1f1f22]',
    notch: 'text-zinc-800',
    previewBg: 'bg-[#18181b]', previewWindow: 'bg-[#27272a]',
    previewEl1: 'bg-white/10', previewEl2: 'bg-white/20'
  },
  light: { 
    id: 'light', name: 'Clean White', 
    bg: 'bg-zinc-100', panel: 'bg-white/95', 
    text: 'text-zinc-900', subtext: 'text-zinc-500', 
    border: 'border-zinc-200', card: 'bg-zinc-50',
    notch: 'text-zinc-200',
    previewBg: 'bg-[#e5e5ea]', previewWindow: 'bg-[#ffffff]',
    previewEl1: 'bg-black/10', previewEl2: 'bg-black/20'
  },
  sand: { 
    id: 'sand', name: 'Desert Sand', 
    bg: 'bg-[#e8d5b5]', panel: 'bg-[#f2e5cc]/95', 
    text: 'text-[#4a3b2c]', subtext: 'text-[#8a7356]', 
    border: 'border-[#cfae7e]', card: 'bg-[#faeed9]',
    notch: 'text-[#cfae7e]',
    previewBg: 'bg-[#dcb679]', previewWindow: 'bg-[#f4e4c4]',
    previewEl1: 'bg-[#dcb679]/40', previewEl2: 'bg-[#dcb679]/60'
  },
  purplish: {
    id: 'purplish', name: 'Purplish',
    bg: 'bg-[#0f0a1c]', panel: 'bg-[#17102b]/95',
    text: 'text-purple-100', subtext: 'text-purple-400',
    border: 'border-purple-900/50', card: 'bg-[#1d1438]',
    notch: 'text-[#17102b]',
    previewBg: 'bg-[#1f163d]', previewWindow: 'bg-[#2d2054]',
    previewEl1: 'bg-purple-300/20', previewEl2: 'bg-purple-300/40'
  },
  bluish: {
    id: 'bluish', name: 'Bluish',
    bg: 'bg-[#09111c]', panel: 'bg-[#0f1b2d]/95',
    text: 'text-blue-100', subtext: 'text-blue-400',
    border: 'border-blue-900/50', card: 'bg-[#15253d]',
    notch: 'text-[#0f1b2d]',
    previewBg: 'bg-[#1a2d4a]', previewWindow: 'bg-[#264066]',
    previewEl1: 'bg-blue-300/20', previewEl2: 'bg-blue-300/40'
  },
};

const COLORS = [
  { id: 'blue', class: 'bg-blue-500', textClass: 'text-blue-500', bgSoft: 'bg-blue-500/10', borderClass: 'border-blue-500/20' },
  { id: 'cyan', class: 'bg-cyan-500', textClass: 'text-cyan-500', bgSoft: 'bg-cyan-500/10', borderClass: 'border-cyan-500/20' },
  { id: 'teal', class: 'bg-teal-500', textClass: 'text-teal-500', bgSoft: 'bg-teal-500/10', borderClass: 'border-teal-500/20' },
  { id: 'emerald', class: 'bg-emerald-500', textClass: 'text-emerald-500', bgSoft: 'bg-emerald-500/10', borderClass: 'border-emerald-500/20' },
  { id: 'amber', class: 'bg-amber-500', textClass: 'text-amber-500', bgSoft: 'bg-amber-500/10', borderClass: 'border-amber-500/20' },
  { id: 'orange', class: 'bg-orange-500', textClass: 'text-orange-500', bgSoft: 'bg-orange-500/10', borderClass: 'border-orange-500/20' },
  { id: 'rose', class: 'bg-rose-500', textClass: 'text-rose-500', bgSoft: 'bg-rose-500/10', borderClass: 'border-rose-500/20' },
  { id: 'violet', class: 'bg-violet-500', textClass: 'text-violet-500', bgSoft: 'bg-violet-500/10', borderClass: 'border-violet-500/20' },
];

const FONTS = [
  { id: 'inter', name: 'Inter', class: 'font-sans' },
  { id: 'general', name: 'General Sans', class: 'font-sans tracking-tight' },
  { id: 'mono', name: 'JetBrains Mono', class: 'font-mono' },
  { id: 'serif1', name: 'Playfair', class: 'font-serif' },
  { id: 'serif2', name: 'Merriweather', class: 'font-serif tracking-wide' },
  { id: 'mono2', name: 'Fira Code', class: 'font-mono tracking-tight' },
  { id: 'sans1', name: 'Roboto', class: 'font-sans font-medium' },
  { id: 'sans2', name: 'Lato', class: 'font-sans font-light' },
  { id: 'sans3', name: 'Montserrat', class: 'font-sans uppercase tracking-widest' },
  { id: 'sans4', name: 'Nunito', class: 'font-sans rounded' },
  { id: 'sans5', name: 'Oswald', class: 'font-sans font-bold stretch-condensed' },
  { id: 'mono3', name: 'Source Code', class: 'font-mono font-light' },
];

const FONT_STYLES = [
  { id: 'thin', name: 'Thin', class: 'font-light' },
  { id: 'regular', name: 'Regular', class: 'font-normal' },
  { id: 'medium', name: 'Medium', class: 'font-medium' },
  { id: 'bold', name: 'Bold', class: 'font-bold' },
];

const getIconColorClass = (Icon: any, style: string, theme: any, sysColors: any) => {
  if (style === 'monotone') return theme.subtext;
  if (style === 'duotone') return `${sysColors.primary.textClass} opacity-70`;
  
  switch (Icon) {
    case Volume2: return 'text-blue-500';
    case Mic: return 'text-orange-500';
    case Moon: return 'text-indigo-500';
    case Settings: return 'text-zinc-500';
    case Palette: return 'text-pink-500';
    case Monitor: return 'text-cyan-500';
    case Shield: return 'text-emerald-500';
    case Bell: 
    case BellRing: return 'text-amber-500';
    case Mail: return 'text-blue-400';
    case Calendar: return 'text-red-500';
    case MessageSquare: return 'text-green-500';
    case AlertTriangle: return 'text-amber-500';
    case Info: return 'text-blue-500';
    case CheckCircle2: return 'text-emerald-500';
    case Wifi: return 'text-blue-500';
    case Bluetooth: return 'text-blue-500';
    default: return theme.subtext;
  }
};

const getIconStroke = (style: string) => {
  switch(style) {
    case 'thin': return 1;
    case 'regular': return 2;
    case 'medium': return 2.5;
    case 'bold': return 3;
    case 'italic': return 2;
    default: return 2;
  }
};

const MouseIcon = ({ active, className }: { active: string, className?: string }) => (
  <svg width="24" height="36" viewBox="0 0 24 36" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
    <rect x="4" y="2" width="16" height="32" rx="8" />
    <path d="M4 16h16" />
    <path d="M12 2v14" />
    {active === 'LMB' && <path d="M4 10v6h8V2c-4 0-8 3-8 8z" fill="currentColor" fillOpacity="0.4" stroke="none" />}
    {active === 'RMB' && <path d="M20 10v6h-8V2c4 0 8 3 8 8z" fill="currentColor" fillOpacity="0.4" stroke="none" />}
    {(active === 'MMB' || active === 'Scroll') && <rect x="10" y="5" width="4" height="6" rx="2" fill="currentColor" stroke="none" />}
    {!(active === 'MMB' || active === 'Scroll') && <rect x="10" y="5" width="4" height="6" rx="2" />}
  </svg>
);

const Keycap = ({ children, className = "", theme }: { children: React.ReactNode, className?: string, theme: any }) => (
  <kbd className={`flex items-center justify-center h-8 min-w-[2rem] px-2 rounded-lg border ${theme.border} bg-black/5 dark:bg-white/5 ${theme.text} text-xs font-mono shadow-sm border-b-2 ${className}`}>
    {children}
  </kbd>
);

const MainKey = ({ keyStr, theme }: { keyStr: string, theme: any }) => {
  if (keyStr.includes('MB') || keyStr.includes('Scroll')) {
    let active = 'None';
    if (keyStr.includes('LMB')) active = 'LMB';
    if (keyStr.includes('RMB')) active = 'RMB';
    if (keyStr.includes('MMB')) active = 'MMB';
    if (keyStr.includes('Scroll')) active = 'Scroll';
    
    return (
      <div className={`flex items-center gap-2 px-2 py-1 rounded-xl bg-black/5 dark:bg-white/5 border ${theme.border} shadow-sm border-b-2`}>
        <MouseIcon active={active} className={`${theme.text}`} />
        <span className={`text-xs font-medium ${theme.text} pr-1`}>{keyStr.includes('Drag') ? 'Drag' : keyStr.includes('Scroll') ? 'Scroll' : 'Click'}</span>
      </div>
    );
  }

  if (keyStr === 'W A S D') {
    return (
      <div className="flex flex-col items-center gap-1">
        <Keycap theme={theme}>W</Keycap>
        <div className="flex gap-1">
          <Keycap theme={theme}>A</Keycap>
          <Keycap theme={theme}>S</Keycap>
          <Keycap theme={theme}>D</Keycap>
        </div>
      </div>
    );
  }

  if (keyStr === 'Space') {
    return <Keycap theme={theme} className="w-24">Space</Keycap>;
  }

  if (keyStr === 'Enter') {
    return <Keycap theme={theme} className="gap-2">Enter <CornerDownLeft size={14}/></Keycap>;
  }

  if (keyStr === 'Tab') {
    return <Keycap theme={theme} className="gap-2"><ArrowRightLeft size={14}/> Tab</Keycap>;
  }

  return <Keycap theme={theme}>{keyStr}</Keycap>;
}

const RenderHotkey = ({ hk, theme }: { hk: any, theme: any }) => {
  const { key, ctrl, alt, shift } = hk;
  return (
    <div className="flex items-center gap-1.5">
      {ctrl && <Keycap theme={theme} className="!bg-black/10 dark:!bg-white/10 !text-zinc-500">Ctrl</Keycap>}
      {alt && <Keycap theme={theme} className="!bg-black/10 dark:!bg-white/10 !text-zinc-500">Alt</Keycap>}
      {shift && <Keycap theme={theme} className="!bg-black/10 dark:!bg-white/10 !text-zinc-500">Shift</Keycap>}
      <MainKey keyStr={key} theme={theme} />
    </div>
  );
}

const HOTKEY_PRESETS: Record<string, any[]> = {
  blender: [
    { id: '1', action: 'Orbit Camera', group: 'Viewport', key: 'MMB Drag', ctrl: false, shift: false, alt: false },
    { id: '2', action: 'Pan Camera', group: 'Viewport', key: 'MMB Drag', ctrl: false, shift: true, alt: false },
    { id: '3', action: 'Zoom Camera', group: 'Viewport', key: 'Scroll', ctrl: false, shift: false, alt: false },
    { id: '4', action: 'Fly Mode / Freelook', group: 'Viewport', key: '~', ctrl: false, shift: true, alt: false },
    { id: '5', action: 'Fly Movement', group: 'Viewport', key: 'W A S D', ctrl: false, shift: false, alt: false },
    { id: '6', action: 'Search Menu', group: 'Global', key: 'Space', ctrl: false, shift: false, alt: false },
    { id: '7', action: 'Confirm Action', group: 'Global', key: 'Enter', ctrl: false, shift: false, alt: false },
    { id: '8', action: 'Toggle Outliner', group: 'Interface', key: 'Tab', ctrl: false, shift: false, alt: false },
  ],
  unreal: [
    { id: '1', action: 'Look / Rotate', group: 'Viewport', key: 'RMB Drag', ctrl: false, shift: false, alt: false },
    { id: '2', action: 'Pan Camera', group: 'Viewport', key: 'MMB Drag', ctrl: false, shift: false, alt: false },
    { id: '3', action: 'Zoom Camera', group: 'Viewport', key: 'RMB Drag', ctrl: false, shift: false, alt: true },
    { id: '4', action: 'Freelook', group: 'Viewport', key: 'RMB', ctrl: false, shift: false, alt: false },
    { id: '5', action: 'Fly Movement', group: 'Viewport', key: 'W A S D', ctrl: false, shift: false, alt: false },
    { id: '6', action: 'Play Node', group: 'Editor', key: 'Enter', ctrl: false, shift: false, alt: true },
    { id: '7', action: 'Cycle Modes', group: 'Editor', key: 'Tab', ctrl: true, shift: false, alt: false },
  ],
  unity: [
    { id: '1', action: 'Orbit Camera', group: 'Viewport', key: 'LMB Drag', ctrl: false, shift: false, alt: true },
    { id: '2', action: 'Pan Camera', group: 'Viewport', key: 'MMB Drag', ctrl: false, shift: false, alt: false },
    { id: '3', action: 'Zoom Camera', group: 'Viewport', key: 'RMB Drag', ctrl: false, shift: false, alt: true },
    { id: '4', action: 'Freelook', group: 'Viewport', key: 'RMB', ctrl: false, shift: false, alt: false },
    { id: '5', action: 'Fly Movement', group: 'Viewport', key: 'W A S D', ctrl: false, shift: false, alt: false },
    { id: '6', action: 'Search Menu', group: 'Global', key: 'Space', ctrl: true, shift: false, alt: false },
  ]
};

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeView, setActiveView] = useState<'main' | 'settings' | 'appearance' | 'notifications' | 'display' | 'input'>('main');
  const [displayTab, setDisplayTab] = useState<'display' | 'fonts' | 'theme'>('fonts');
  
  const fontContainerRef = useRef<HTMLDivElement>(null);
  
  const scrollFonts = (direction: 'left' | 'right') => {
    if (fontContainerRef.current) {
      fontContainerRef.current.scrollBy({ 
        left: direction === 'left' ? -250 : 250, 
        behavior: 'smooth' 
      });
    }
  };

  // Preferences State
  const [themeId, setThemeId] = useState<keyof typeof THEMES>('oled');
  const [fontId, setFontId] = useState('inter');
  const [radius, setRadius] = useState(24);
  const [transparentSidebar, setTransparentSidebar] = useState(false);

  // System Colors State
  const [primaryColorId, setPrimaryColorId] = useState('blue');
  const [secondaryColorId, setSecondaryColorId] = useState('violet');
  const [infoColorId, setInfoColorId] = useState('cyan');
  const [warningColorId, setWarningColorId] = useState('amber');
  const [alertColorId, setAlertColorId] = useState('rose');

  // UI State
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [iconStyle, setIconStyle] = useState<'monotone' | 'duotone' | 'coloured'>('monotone');
  const [iconSize, setIconSize] = useState(24);
  const [iconWeightId, setIconWeightId] = useState('regular');
  const [antialiasing, setAntialiasing] = useState<'subpixel-antialiased' | 'antialiased' | 'smoothing-none'>('antialiased');
  const [quality, setQuality] = useState<'Low' | 'Medium' | 'High' | 'Epic' | 'Cinematic'>('High');
  const [vsyncEnabled, setVsyncEnabled] = useState(true);
  const [dndEnabled, setDndEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [giEnabled, setGiEnabled] = useState(false);
  const [notifsEnabled, setNotifsEnabled] = useState(true);
  const [notifications, setNotifications] = useState([
    { id: 1, type: "alert", title: "Storage Almost Full", time: "Just now", desc: "You have used 95% of your allocated cloud storage. Please upgrade your plan to avoid data loss." },
    { id: 2, type: "warning", title: "High Memory Usage", time: "2m ago", desc: "System memory is running high. Consider closing unused applications to improve performance." },
    { id: 3, type: "info", title: "System Update", time: "10m ago", desc: "A new software update is available for your workspace. This includes security patches and performance improvements." },
    { id: 4, type: "default", title: "New Message", time: "1h ago", desc: "Hey, are we still on for the design review tomorrow? I have some new mockups to share." }
  ]);
  const [appNotifs, setAppNotifs] = useState({
    mail: true,
    calendar: true,
    messages: true,
    system: false
  });

  // Display Settings
  const [resolution, setResolution] = useState('1920x1080');
  const [scaling, setScaling] = useState(100);
  const [refreshRate, setRefreshRate] = useState('60Hz');
  const [multiDisplay, setMultiDisplay] = useState('extend');

  // Input Settings & Hotkeys
  const [inputPreset, setInputPreset] = useState<'blender' | 'unreal' | 'unity'>('blender');
  const [hotkeys, setHotkeys] = useState(HOTKEY_PRESETS['blender']);
  const [editingHotkey, setEditingHotkey] = useState<string | null>(null);

  React.useEffect(() => {
    setHotkeys(HOTKEY_PRESETS[inputPreset]);
  }, [inputPreset]);

  const iconStroke = getIconStroke(iconWeightId);

  // Typography Scale State
  const [titleSize, setTitleSize] = useState(24);
  const [headerSize, setHeaderSize] = useState(20);
  const [subheaderSize, setSubheaderSize] = useState(16);
  const [bodySize, setBodySize] = useState(14);
  const [labelSize, setLabelSize] = useState(12);
  const [captionSize, setCaptionSize] = useState(10);
  const [warningSize, setWarningSize] = useState(14);
  const [alertSize, setAlertSize] = useState(14);

  // Typography Style State
  const [titleStyle, setTitleStyle] = useState('bold');
  const [headerStyle, setHeaderStyle] = useState('bold');
  const [subheaderStyle, setSubheaderStyle] = useState('medium');
  const [bodyStyle, setBodyStyle] = useState('regular');
  const [labelStyle, setLabelStyle] = useState('medium');
  const [captionStyle, setCaptionStyle] = useState('regular');
  const [warningStyle, setWarningStyle] = useState('medium');
  const [alertStyle, setAlertStyle] = useState('bold');

  const theme = THEMES[themeId];
  const font = FONTS.find(f => f.id === fontId) || FONTS[0];

  const systemColors = {
    primary: COLORS.find(c => c.id === primaryColorId) || COLORS[0],
    secondary: COLORS.find(c => c.id === secondaryColorId) || COLORS[7],
    info: COLORS.find(c => c.id === infoColorId) || COLORS[1],
    warning: COLORS.find(c => c.id === warningColorId) || COLORS[4],
    alert: COLORS.find(c => c.id === alertColorId) || COLORS[6],
  };

  const typographyStyles = {
    title: FONT_STYLES.find(s => s.id === titleStyle)?.class || '',
    header: FONT_STYLES.find(s => s.id === headerStyle)?.class || '',
    subheader: FONT_STYLES.find(s => s.id === subheaderStyle)?.class || '',
    body: FONT_STYLES.find(s => s.id === bodyStyle)?.class || '',
    label: FONT_STYLES.find(s => s.id === labelStyle)?.class || '',
    caption: FONT_STYLES.find(s => s.id === captionStyle)?.class || '',
    warning: FONT_STYLES.find(s => s.id === warningStyle)?.class || '',
    alert: FONT_STYLES.find(s => s.id === alertStyle)?.class || '',
  };

  const togglePanel = () => {
    if (isOpen) {
      setIsOpen(false);
      setTimeout(() => setActiveView('main'), 300); // Reset view after close
    } else {
      setIsOpen(true);
    }
  };

  const sizes = { title: titleSize, header: headerSize, subheader: subheaderSize, body: bodySize, label: labelSize, caption: captionSize, warning: warningSize, alert: alertSize };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text} ${font.class} ${antialiasing} relative overflow-hidden flex flex-col items-center justify-center transition-colors duration-500`}>
      
      {/* Custom Slider Thumb Styles */}
      <style>{`
        .smoothing-none {
          -webkit-font-smoothing: none;
          -moz-osx-font-smoothing: grayscale;
        }
        input[type=range]::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          background: ${themeId === 'light' || themeId === 'sand' ? '#fff' : '#444'};
          border: 1px solid ${themeId === 'light' || themeId === 'sand' ? '#ccc' : '#666'};
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        input[type=range]::-moz-range-thumb {
          width: 20px;
          height: 20px;
          background: ${themeId === 'light' || themeId === 'sand' ? '#fff' : '#444'};
          border: 1px solid ${themeId === 'light' || themeId === 'sand' ? '#ccc' : '#666'};
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
      `}</style>

      {/* Full Screen Dropdown Panel */}
      <motion.div
        initial={false}
        animate={{ y: isOpen ? 0 : '-100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`fixed inset-0 w-full h-full ${theme.panel} backdrop-blur-3xl z-40 flex flex-col border-b ${theme.border} shadow-2xl transition-colors duration-500`}
      >
        {/* Settings Button (Global Top Right) */}
        <button 
          onClick={() => setActiveView('settings')}
          className={`absolute top-6 right-6 md:top-8 md:right-8 p-3 rounded-full ${theme.card} border ${theme.border} hover:brightness-110 transition-all z-50`}
        >
          <Settings strokeWidth={iconStroke} className={`w-6 h-6 ${theme.text}`} />
        </button>

        <div className="flex-1 w-full mx-auto pt-24 pb-12 px-6 sm:px-8 overflow-hidden flex flex-col relative">
          <AnimatePresence mode="wait">
            
            {/* MAIN DASHBOARD VIEW */}
            {activeView === 'main' && (
              <motion.div 
                key="main"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col md:flex-row gap-12 h-full w-full max-w-5xl mx-auto overflow-y-auto pb-20 relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                {/* Left Column: Quick Settings */}
                <div className="w-full md:w-1/3 flex flex-col gap-6">
                  <h3 className={`${theme.text} mb-2 px-2 ${typographyStyles.header}`} style={{ fontSize: `${headerSize}px` }}>Control Center</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <QuickIcon 
                      icon={(props: any) => <QualityStarsIcon count={quality === 'Low' ? 1 : quality === 'Medium' ? 2 : quality === 'High' ? 3 : quality === 'Epic' ? 4 : 5} {...props} />} 
                      primaryColor={systemColors.primary} 
                      theme={theme} 
                      label={`Quality: ${quality}`} 
                      active={true} 
                      onClick={() => {
                        const states = ['Low', 'Medium', 'High', 'Epic', 'Cinematic'] as const;
                        const currentIndex = states.indexOf(quality);
                        setQuality(states[(currentIndex + 1) % states.length]);
                      }} 
                      radius={radius} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} 
                    />
                    <QuickIcon 
                      icon={RefreshCw} 
                      primaryColor={systemColors.primary} 
                      theme={theme} 
                      label={`VSync: ${vsyncEnabled ? 'ON' : 'OFF'}`} 
                      active={vsyncEnabled} 
                      onClick={() => setVsyncEnabled(!vsyncEnabled)} 
                      radius={radius} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} 
                    />
                    <QuickIcon 
                      icon={Sun} 
                      primaryColor={systemColors.primary} 
                      theme={theme} 
                      label={`Global Illumination: ${giEnabled ? 'ON' : 'OFF'}`} 
                      active={giEnabled} 
                      onClick={() => setGiEnabled(!giEnabled)} 
                      radius={radius} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} 
                    />
                    <QuickIcon 
                      icon={notifsEnabled ? BellRing : Bell} 
                      primaryColor={systemColors.primary} 
                      theme={theme} 
                      label={`Notifications: ${notifsEnabled ? 'ON' : 'OFF'}`} 
                      active={notifsEnabled} 
                      onClick={() => setNotifsEnabled(!notifsEnabled)} 
                      radius={radius} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} 
                    />
                    <QuickIcon 
                      icon={antialiasing === 'smoothing-none' ? X : antialiasing === 'antialiased' ? Type : Monitor} 
                      primaryColor={systemColors.primary} 
                      theme={theme} 
                      label={antialiasing === 'smoothing-none' ? 'AA: None' : antialiasing === 'antialiased' ? 'AA: Basic' : 'AA: TSAA'} 
                      active={antialiasing !== 'smoothing-none'} 
                      onClick={() => {
                        if (antialiasing === 'smoothing-none') setAntialiasing('antialiased');
                        else if (antialiasing === 'antialiased') setAntialiasing('subpixel-antialiased');
                        else setAntialiasing('smoothing-none');
                      }} 
                      radius={radius} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} 
                    />
                  </div>

                  <div 
                    className={`w-full h-16 ${theme.card} flex items-center px-6 mt-4 border ${theme.border}`}
                    style={{ borderRadius: `${radius}px` }}
                  >
                    <Monitor strokeWidth={iconStroke} className={`w-5 h-5 ${theme.subtext} mr-4`} />
                    <div className={`flex-1 h-2 ${theme.border} bg-opacity-50 rounded-full overflow-hidden`}>
                      <div className={`w-2/3 h-full ${theme.text} bg-opacity-80 rounded-full`}></div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Notifications */}
                <div className="w-full md:w-2/3 flex flex-col">
                  <div className="flex items-center justify-between mb-8 px-2">
                    <h3 className={`${theme.text} ${typographyStyles.header}`} style={{ fontSize: `${headerSize}px` }}>Notifications</h3>
                    {notifications.length > 0 && (
                      <button onClick={() => setNotifications([])} className={`${systemColors.primary.textClass} hover:opacity-80 transition-opacity ${typographyStyles.label}`} style={{ fontSize: `${labelSize}px` }}>Clear messages</button>
                    )}
                  </div>
                  <div className="space-y-4">
                    {notifications.length > 0 ? (
                      notifications.map(n => (
                        <NotificationCard key={n.id} theme={theme} sysColors={systemColors} radius={radius} sizes={sizes} typoStyles={typographyStyles} type={n.type as any} title={n.title} time={n.time} desc={n.desc} iconStyle={iconStyle} iconSize={iconSize} iconStroke={iconStroke} />
                      ))
                    ) : (
                      <div className={`flex flex-col items-center justify-center py-16 text-center ${theme.subtext}`}>
                        <CheckCircle2 strokeWidth={iconStroke} className="w-12 h-12 mb-4 opacity-20" />
                        <p className={`${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>You're all caught up.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* SETTINGS LIST VIEW */}
            {activeView === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col h-full max-w-2xl mx-auto w-full overflow-y-auto pb-20 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                <div className="flex items-center gap-4 mb-8 px-2">
                  <button onClick={() => setActiveView('main')} className={`p-2 -ml-2 rounded-full hover:${theme.card} transition-colors`}>
                    <ChevronLeft strokeWidth={iconStroke} className={`w-6 h-6 ${theme.text}`} />
                  </button>
                  <h2 className={`${theme.text} tracking-tight ${typographyStyles.header}`} style={{ fontSize: `${headerSize * 1.2}px` }}>Settings</h2>
                </div>

                <div 
                  className={`${theme.card} border ${theme.border} overflow-hidden shadow-xl`}
                  style={{ borderRadius: `${Math.max(16, radius)}px` }}
                >
                  <SettingsRow 
                    icon={Palette} title="Display Settings" subtitle="Appearance, theme, fonts, and system colors" 
                    theme={theme} onClick={() => { setActiveView('display'); setDisplayTab('theme'); }} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke}
                  />
                  <SettingsRow icon={Monitor} title="Display & Workspace" subtitle="Resolution, scaling, multiple displays" theme={theme} onClick={() => { setActiveView('display'); setDisplayTab('display'); }} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} />
                  <SettingsRow icon={Keyboard} title="Input Devices" subtitle="Keyboard, mouse, and touch settings" theme={theme} onClick={() => setActiveView('input')} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} />
                  <SettingsRow icon={Shield} title="Privacy & Security" subtitle="Permissions, camera access, firewall" theme={theme} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} />
                  <SettingsRow icon={Bell} title="Apps & Notifications" subtitle="Do not disturb, app permissions" theme={theme} onClick={() => setActiveView('notifications')} hasBorder={false} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} sysColors={systemColors} iconSize={iconSize} iconStroke={iconStroke} />
                </div>
              </motion.div>
            )}

            {/* APPS & NOTIFICATIONS VIEW */}
            {activeView === 'notifications' && (
              <motion.div 
                key="notifications"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col h-full w-full max-w-3xl mx-auto overflow-y-auto pb-20 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                <div className="flex items-center justify-between mb-10 px-2">
                  <h2 className={`${theme.text} tracking-tight ${typographyStyles.title}`} style={{ fontSize: `${titleSize * 1.2}px` }}>Apps & Notifications</h2>
                  <button onClick={() => setActiveView('settings')} className={`w-10 h-10 rounded-full ${theme.card} border ${theme.border} flex items-center justify-center hover:brightness-110 transition-all`}>
                    <ArrowLeft strokeWidth={iconStroke} className={`w-5 h-5 ${theme.text}`} />
                  </button>
                </div>

                {/* Global Settings Card */}
                <div className={`${theme.card} border ${theme.border} p-6 md:p-8 mb-8`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                  <div className="flex justify-between items-center mb-8 pb-8 border-b border-white/5">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full ${systemColors.primary.bgSoft} flex items-center justify-center`}>
                        <Moon strokeWidth={iconStroke} className={`w-5 h-5 ${systemColors.primary.textClass}`} />
                      </div>
                      <div>
                        <h3 className={`${theme.text} ${typographyStyles.header}`} style={{ fontSize: `${headerSize}px` }}>Do Not Disturb</h3>
                        <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Silence all notifications and alerts</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setDndEnabled(!dndEnabled)}
                      className={`w-12 h-6 rounded-full transition-colors relative ${dndEnabled ? systemColors.primary.class : themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm ${dndEnabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full ${systemColors.info.bgSoft} flex items-center justify-center`}>
                        <BellRing strokeWidth={iconStroke} className={`w-5 h-5 ${systemColors.info.textClass}`} />
                      </div>
                      <div>
                        <h3 className={`${theme.text} ${typographyStyles.header}`} style={{ fontSize: `${headerSize}px` }}>Notification Sounds</h3>
                        <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Play sounds for incoming alerts</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setSoundEnabled(!soundEnabled)}
                      className={`w-12 h-6 rounded-full transition-colors relative ${soundEnabled ? systemColors.primary.class : themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm ${soundEnabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </div>

                {/* App Permissions Card */}
                <div className="mb-6 px-2">
                  <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>App Permissions</h3>
                  <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Choose which apps can send you notifications</p>
                </div>
                
                <div className={`${theme.card} border ${theme.border} overflow-hidden`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                  <AppToggleRow icon={Mail} title="Mail" subtitle="New emails and calendar invites" active={appNotifs.mail} onChange={() => setAppNotifs({...appNotifs, mail: !appNotifs.mail})} theme={theme} themeId={themeId} sysColors={systemColors} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} iconSize={iconSize} iconStroke={iconStroke} />
                  <AppToggleRow icon={Calendar} title="Calendar" subtitle="Upcoming events and reminders" active={appNotifs.calendar} onChange={() => setAppNotifs({...appNotifs, calendar: !appNotifs.calendar})} theme={theme} themeId={themeId} sysColors={systemColors} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} iconSize={iconSize} iconStroke={iconStroke} />
                  <AppToggleRow icon={MessageSquare} title="Messages" subtitle="Direct messages and mentions" active={appNotifs.messages} onChange={() => setAppNotifs({...appNotifs, messages: !appNotifs.messages})} theme={theme} themeId={themeId} sysColors={systemColors} sizes={sizes} typoStyles={typographyStyles} iconStyle={iconStyle} iconSize={iconSize} iconStroke={iconStroke} />
                  <AppToggleRow icon={AlertTriangle} title="System Alerts" subtitle="Critical system and security updates" active={appNotifs.system} onChange={() => setAppNotifs({...appNotifs, system: !appNotifs.system})} theme={theme} themeId={themeId} sysColors={systemColors} sizes={sizes} typoStyles={typographyStyles} hasBorder={false} iconStyle={iconStyle} iconSize={iconSize} iconStroke={iconStroke} />
                </div>
              </motion.div>
            )}

            {/* APPEARANCE VIEW */}
                        {(activeView === 'appearance' || activeView === 'display') && (
              <motion.div 
                key="display-settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col h-full w-full mx-auto overflow-hidden"
              >
                {/* Header Area */}
                <div className="flex-shrink-0 px-2 pt-2 mb-6">
                  <div className="flex items-center gap-4 mb-2">
                    <button onClick={() => setActiveView('settings')} className={`w-10 h-10 rounded-full ${theme.card} border ${theme.border} flex items-center justify-center hover:brightness-110 transition-all`}>
                      <ChevronLeft strokeWidth={iconStroke} className={`w-6 h-6 ${theme.text}`} />
                    </button>
                    <h2 className={`${theme.text} tracking-tight ${typographyStyles.title}`} style={{ fontSize: `${titleSize * 1.2}px` }}>Display Settings</h2>
                  </div>
                  <p className={`${theme.subtext} ${typographyStyles.body} ml-14`} style={{ fontSize: `${bodySize}px` }}>Appearance & typography</p>
                </div>

                {/* Tabs */}
                <div className="flex-shrink-0 flex gap-8 px-2 ml-14 mb-8 border-b border-transparent">
                  {(['display', 'fonts', 'theme'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setDisplayTab(tab)}
                      className={`pb-2 relative ${typographyStyles.title} ${displayTab === tab ? theme.text : theme.subtext} transition-colors capitalize`}
                      style={{ fontSize: `${titleSize}px` }}
                    >
                      {tab}
                      {displayTab === tab && (
                        <motion.div
                          layoutId="displayTabUnderline"
                          className={`absolute left-0 right-0 bottom-0 h-[3px] rounded-t-full ${systemColors.primary.class}`}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Clipped Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto px-2 ml-14 pb-20 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-zinc-500/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent pr-4 relative">
                  <AnimatePresence mode="wait">
                    {displayTab === 'display' && (
                      <motion.div key="display-tab" initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0, x:-20}} transition={{duration: 0.15}}>
{/* Display Settings Card */}
                <div className={`${theme.card} border ${theme.border} p-6 md:p-8 mb-8`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                  {/* Resolution */}
                  <div className="mb-8">
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>Resolution</h3>
                    <div className="flex flex-wrap gap-2">
                      {['1920x1080', '2560x1440', '3840x2160'].map(res => (
                        <button
                          key={res}
                          onClick={() => setResolution(res)}
                          className={`py-2 px-4 rounded-xl transition-all ${resolution === res ? `${systemColors.primary.class} text-white shadow-sm` : `bg-transparent ${theme.subtext} hover:bg-zinc-500/10 border ${theme.border}`}`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scaling */}
                  <div className="mb-8">
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>UI Scaling ({scaling}%)</h3>
                    <input 
                      type="range" 
                      min="100" 
                      max="200" 
                      step="25"
                      value={scaling}
                      onChange={(e) => setScaling(Number(e.target.value))}
                      className={`w-full h-1.5 rounded-full appearance-none outline-none ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
                    />
                    <div className="flex justify-between mt-2">
                      <span className={`text-xs ${theme.subtext}`}>100%</span>
                      <span className={`text-xs ${theme.subtext}`}>200%</span>
                    </div>
                  </div>

                  {/* Refresh Rate */}
                  <div className="mb-8">
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>Refresh Rate</h3>
                    <div className="flex flex-wrap gap-2">
                      {['60Hz', '120Hz', '144Hz'].map(rate => (
                        <button
                          key={rate}
                          onClick={() => setRefreshRate(rate)}
                          className={`py-2 px-4 rounded-xl transition-all ${refreshRate === rate ? `${theme.text} border ${theme.border} bg-white/5` : `bg-transparent ${theme.subtext} hover:bg-zinc-500/10 border border-transparent`}`}
                        >
                          {rate}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Multiple Displays */}
                  <div>
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>Multiple Displays</h3>
                    <div className="flex gap-2 bg-zinc-500/10 p-1.5 rounded-2xl w-full">
                      {['mirror', 'extend', 'second_only'].map(mode => (
                        <button
                          key={mode}
                          onClick={() => setMultiDisplay(mode)}
                          className={`flex-1 py-2.5 px-4 rounded-xl transition-all capitalize ${multiDisplay === mode ? `${theme.card} ${theme.text} shadow-sm border border-zinc-500/20` : `bg-transparent ${theme.subtext} hover:bg-zinc-500/10`}`}
                        >
                          {mode.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              
                      </motion.div>
                    )}
                    {displayTab === 'fonts' && (
                      <motion.div key="fonts-tab" initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0, x:-20}} transition={{duration: 0.15}}>
{/* Tile 2: Typography & Icons */}
                <div className={`p-6 sm:p-8 mb-8 border ${theme.border} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/[0.03]' : (themeId === 'oled' ? 'bg-white/[0.02]' : 'bg-white/[0.04]')}`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
                  {/* Typography Specimen (Image 2 & 3 Style) */}
                  <div className="mb-12">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Typography</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Typeface & scale</p>
                    </div>
                    
                    {/* Cool Minimal Font Selector */}
                    <div className="relative mb-8 group/fonts">
                      {/* Left Scroll Arrow */}
                      <button 
                        onClick={() => scrollFonts('left')}
                        className={`absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full ${theme.panel} backdrop-blur-md border ${theme.border} shadow-lg flex items-center justify-center opacity-0 group-hover/fonts:opacity-100 transition-all hover:scale-110`}
                        aria-label="Scroll left"
                      >
                        <ChevronLeft strokeWidth={iconStroke} className={`w-5 h-5 ${theme.text}`} />
                      </button>

                      <div 
                        ref={fontContainerRef}
                        className="flex overflow-x-auto gap-4 pb-4 snap-x [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-1"
                      >
                        {FONTS.map(f => (
                          <button
                            key={f.id}
                            onClick={() => setFontId(f.id)}
                            className={`relative flex-none w-48 p-5 text-left border transition-all overflow-hidden snap-start ${fontId === f.id ? `${theme.border} ${theme.card} ring-1 ring-black/5 dark:ring-white/5` : `border-transparent hover:${theme.card} hover:${theme.border}`}`}
                            style={{ borderRadius: `${Math.max(16, radius)}px` }}
                          >
                            <div className={`text-3xl mb-2 ${f.class} ${theme.text}`}>Aa</div>
                            <div className={`text-sm font-medium ${theme.text} truncate`}>{f.name}</div>
                            <div className={`text-xs ${theme.subtext} mt-1 truncate`}>The quick brown fox</div>
                            
                            {fontId === f.id && (
                              <div className="absolute top-4 right-4">
                                <CheckCircle2 strokeWidth={iconStroke} className={`w-4 h-4 ${theme.text}`} />
                              </div>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Right Scroll Arrow */}
                      <button 
                        onClick={() => scrollFonts('right')}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full ${theme.panel} backdrop-blur-md border ${theme.border} shadow-lg flex items-center justify-center opacity-0 group-hover/fonts:opacity-100 transition-all hover:scale-110`}
                        aria-label="Scroll right"
                      >
                        <ChevronRight strokeWidth={iconStroke} className={`w-5 h-5 ${theme.text}`} />
                      </button>
                    </div>

                    <div className={`p-8 md:p-12 ${theme.card} border ${theme.border} flex flex-col gap-12`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
                      {/* Specimen Header */}
                      <div className={`flex flex-col md:flex-row md:items-end justify-between gap-8 pb-12 border-b ${theme.border}`}>
                        <div>
                          <div className={`text-xs ${theme.subtext} mb-4 tracking-widest uppercase`}>Typeface & Colors</div>
                          <h1 className={`text-5xl md:text-7xl ${font.class} ${theme.text} tracking-tight`}>{font.name}</h1>
                        </div>
                        <div className={`text-left md:text-right ${font.class} ${theme.subtext} max-w-[320px] break-all leading-relaxed text-sm md:text-base`}>
                          ABCDEFGHIJKLMNOPQRSTUVWXYZ<br/>
                          abcdefghijklmnopqrstuvwxyz<br/>
                          0123456789
                        </div>
                      </div>

                      {/* Type Scale */}
                      <div className="flex flex-col gap-8">
                        <div className={`text-xs ${theme.subtext} tracking-widest uppercase mb-4`}>Type scale - Desktop</div>
                        
                        <TypographyScaleRow title="Title" styleId={titleStyle} setStyleId={setTitleStyle} size={titleSize} setSize={setTitleSize} min={20} max={64} fontClass={font.class} theme={theme} themeId={themeId} />
                        <TypographyScaleRow title="Header" styleId={headerStyle} setStyleId={setHeaderStyle} size={headerSize} setSize={setHeaderSize} min={16} max={40} fontClass={font.class} theme={theme} themeId={themeId} />
                        <TypographyScaleRow title="Subheader" styleId={subheaderStyle} setStyleId={setSubheaderStyle} size={subheaderSize} setSize={setSubheaderSize} min={12} max={32} fontClass={font.class} theme={theme} themeId={themeId} />
                        <TypographyScaleRow title="Body" styleId={bodyStyle} setStyleId={setBodyStyle} size={bodySize} setSize={setBodySize} min={10} max={24} fontClass={font.class} theme={theme} themeId={themeId} />
                        <TypographyScaleRow title="Label" styleId={labelStyle} setStyleId={setLabelStyle} size={labelSize} setSize={setLabelSize} min={8} max={20} fontClass={font.class} theme={theme} themeId={themeId} sampleText="METADATA • 10:42 AM • SYSTEM" />
                        <TypographyScaleRow title="Caption" styleId={captionStyle} setStyleId={setCaptionStyle} size={captionSize} setSize={setCaptionSize} min={8} max={16} fontClass={font.class} theme={theme} themeId={themeId} sampleText="* This is a small caption text" />
                        <TypographyScaleRow title="Warning" styleId={warningStyle} setStyleId={setWarningStyle} size={warningSize} setSize={setWarningSize} min={10} max={24} fontClass={font.class} theme={theme} themeId={themeId} sampleText="Action required: Connection lost" colorClass={systemColors.warning.textClass} />
                        <TypographyScaleRow title="Alert" styleId={alertStyle} setStyleId={setAlertStyle} size={alertSize} setSize={setAlertSize} min={10} max={24} fontClass={font.class} theme={theme} themeId={themeId} sampleText="Critical: System failure detected" colorClass={systemColors.alert.textClass} />
                        
                      </div>
                    </div>
                  </div>

                  {/* Icon Style */}
                  <div className="mb-12">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Icon Style</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Choose how icons are displayed</p>
                    </div>
                    <div className="flex gap-2 p-1.5 bg-zinc-500/10 rounded-2xl">
                      {['monotone', 'duotone', 'coloured'].map(style => (
                        <button
                          key={style}
                          onClick={() => setIconStyle(style as any)}
                          className={`flex-1 py-2.5 px-4 rounded-xl transition-all capitalize ${iconStyle === style ? `${theme.card} ${theme.text} shadow-sm border border-zinc-500/20` : `bg-transparent ${theme.subtext} hover:bg-zinc-500/10`}`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Icon Font (Size & Weight) */}
                  <div className="mb-4">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Icon Font</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Adjust the size and weight of system icons</p>
                    </div>
                    <div className={`p-8 md:p-12 ${theme.card} border ${theme.border} flex flex-col gap-12`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
                      <IconScaleRow title="System Icons" weightId={iconWeightId} setWeightId={setIconWeightId} size={iconSize} setSize={setIconSize} min={16} max={48} theme={theme} themeId={themeId} sysColors={systemColors} iconStyle={iconStyle} />
                    </div>
                  </div>
                </div>

                

                <div className={`p-6 sm:p-8 mb-8 border ${theme.border} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/[0.03]' : (themeId === 'oled' ? 'bg-white/[0.02]' : 'bg-white/[0.04]')}`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
{/* Font Rendering / Antialiasing */}
                  <div className="mb-4">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Font Antialiasing</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Adjust text rendering smoothness</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 p-1.5 bg-zinc-500/10 rounded-2xl">
                      {[
                        { id: 'subpixel-antialiased', label: 'Subpixel (Auto)' },
                        { id: 'antialiased', label: 'Grayscale' },
                        { id: 'smoothing-none', label: 'None' }
                      ].map(aa => (
                        <button
                          key={aa.id}
                          onClick={() => setAntialiasing(aa.id as any)}
                          className={`flex-1 py-2.5 px-4 rounded-xl transition-all ${antialiasing === aa.id ? `${theme.card} ${theme.text} shadow-sm border border-zinc-500/20` : `bg-transparent ${theme.subtext} hover:bg-zinc-500/10`}`}
                        >
                          {aa.label}
                        </button>
                      ))}
                    </div>
                  </div>
                
                </div>

                      </motion.div>
                    )}
                    {displayTab === 'theme' && (
                      <motion.div key="theme-tab" initial={{opacity:0, x:20}} animate={{opacity:1, x:0}} exit={{opacity:0, x:-20}} transition={{duration: 0.15}}>
{/* Tile 1: Theme & Corner Radius */}
                <div className={`p-6 sm:p-8 mb-8 border ${theme.border} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/[0.03]' : (themeId === 'oled' ? 'bg-white/[0.02]' : 'bg-white/[0.04]')}`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
                  <div className="mb-12">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Theme</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Customize UI colors</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      {Object.values(THEMES).map((t) => (
                        <div key={t.id} className="flex flex-col items-center gap-3">
                          <button
                            onClick={() => setThemeId(t.id as any)}
                            className={`p-1.5 rounded-[24px] transition-all w-full ${themeId === t.id ? `border-2 ${systemColors.primary.borderClass.replace('/20', '')} shadow-[0_0_15px_rgba(0,0,0,0.1)]` : 'border-2 border-transparent hover:scale-[1.02]'}`}
                          >
                            <div className={`w-full aspect-[4/3] rounded-[18px] ${t.previewBg} relative overflow-hidden`}>
                            {/* Inner Window */}
                            <div 
                              className={`absolute top-5 left-5 right-[-10%] bottom-[-10%] ${t.previewWindow} shadow-xl flex transition-all duration-300`}
                              style={{ borderTopLeftRadius: `${Math.max(8, radius * 0.5)}px` }}
                            >
                              {/* Sidebar */}
                              <div className={`w-[35%] border-r ${themeId === 'light' || themeId === 'sand' ? 'border-black/5' : 'border-white/5'} p-3.5 flex flex-col gap-3`}>
                                {/* Dots */}
                                <div className="flex gap-1.5 mb-2">
                                  <div className={`w-2 h-2 rounded-full ${t.previewEl2}`}></div>
                                  <div className={`w-2 h-2 rounded-full ${t.previewEl2}`}></div>
                                  <div className={`w-2 h-2 rounded-full ${t.previewEl2}`}></div>
                                </div>
                                {/* Lines */}
                                <div className={`w-full h-2 rounded-full ${t.previewEl1}`}></div>
                                <div className={`w-3/4 h-2 rounded-full ${t.previewEl1}`}></div>
                                <div className={`w-5/6 h-2 rounded-full ${t.previewEl1}`}></div>
                                {/* Bottom Profile */}
                                <div className="mt-auto flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded-full ${t.previewEl2}`}></div>
                                  <div className={`w-8 h-2 rounded-full ${t.previewEl1}`}></div>
                                </div>
                              </div>
                              {/* Main Area */}
                              <div className="flex-1 p-5 flex flex-col gap-4">
                                <div className={`w-1/3 h-2 rounded-full ${t.previewEl1}`}></div>
                                <div className={`w-1/2 h-3 rounded-full ${t.previewEl2} mb-2`}></div>
                                <div className="flex gap-2.5">
                                  <div className={`flex-1 aspect-square ${t.previewEl1} transition-all duration-300`} style={{ borderRadius: `${Math.max(4, radius * 0.25)}px` }}></div>
                                  <div className={`flex-1 aspect-square ${t.previewEl1} transition-all duration-300`} style={{ borderRadius: `${Math.max(4, radius * 0.25)}px` }}></div>
                                  <div className={`flex-1 aspect-square ${t.previewEl1} transition-all duration-300`} style={{ borderRadius: `${Math.max(4, radius * 0.25)}px` }}></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </button>
                        <span className={`text-sm font-semibold tracking-wide ${themeId === t.id ? theme.text : theme.subtext} ${themeId === t.id ? `underline underline-offset-4 decoration-2 ${systemColors.primary.textClass}` : ''}`}>{t.name}</span>
                      </div>
                    ))}
                  </div>
                  </div>

                  {/* Corner Radius Slider */}
                  <div className="mb-4">
                    <div className="flex justify-between items-end mb-4">
                      <div>
                        <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Corner Radius</h3>
                        <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Adjust the roundness of UI elements</p>
                      </div>
                      <span className={`font-medium ${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>{radius}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="48"
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      className={`w-full h-1.5 rounded-full appearance-none outline-none mb-10 ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
                    />
                    
                    {/* Sidebar Toggle */}
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Sidebar</h3>
                        <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Make the sidebar transparent</p>
                      </div>
                      <button 
                        onClick={() => setTransparentSidebar(!transparentSidebar)}
                        className={`w-12 h-6 rounded-full transition-colors relative ${transparentSidebar ? systemColors.primary.class : themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
                      >
                        <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm ${transparentSidebar ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                </div>

                

                <div className={`p-6 sm:p-8 mb-8 border ${theme.border} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/[0.03]' : (themeId === 'oled' ? 'bg-white/[0.02]' : 'bg-white/[0.04]')}`} style={{ borderRadius: `${Math.max(24, radius)}px` }}>
{/* System Colors */}
                  <div className="mb-12">
                    <div className="mb-6">
                      <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>System Colors</h3>
                      <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Semantic colors for UI elements</p>
                    </div>
                    <div 
                      className={`${theme.card} border ${theme.border} px-6`}
                      style={{ borderRadius: `${Math.max(16, radius)}px` }}
                    >
                      <ColorPickerRow 
                        id="primary" title="Primary" description="Main interactive elements and accents" 
                        selectedId={primaryColorId} onSelect={setPrimaryColorId} theme={theme} 
                        isActive={activeColorPicker === 'primary'} onToggle={() => setActiveColorPicker(p => p === 'primary' ? null : 'primary')}
                        typoStyles={typographyStyles}
                        iconStroke={iconStroke}
                      />
                      <ColorPickerRow 
                        id="secondary" title="Secondary" description="Alternative interactive elements" 
                        selectedId={secondaryColorId} onSelect={setSecondaryColorId} theme={theme} 
                        isActive={activeColorPicker === 'secondary'} onToggle={() => setActiveColorPicker(p => p === 'secondary' ? null : 'secondary')}
                        typoStyles={typographyStyles}
                        iconStroke={iconStroke}
                      />
                      <ColorPickerRow 
                        id="info" title="Info" description="Informational messages and badges" 
                        selectedId={infoColorId} onSelect={setInfoColorId} theme={theme} 
                        isActive={activeColorPicker === 'info'} onToggle={() => setActiveColorPicker(p => p === 'info' ? null : 'info')}
                        typoStyles={typographyStyles}
                        iconStroke={iconStroke}
                      />
                      <ColorPickerRow 
                        id="warning" title="Warning" description="Non-critical alerts and warnings" 
                        selectedId={warningColorId} onSelect={setWarningColorId} theme={theme} 
                        isActive={activeColorPicker === 'warning'} onToggle={() => setActiveColorPicker(p => p === 'warning' ? null : 'warning')}
                        typoStyles={typographyStyles}
                        iconStroke={iconStroke}
                      />
                      <ColorPickerRow 
                        id="alert" title="Alert" description="Critical errors and destructive actions" 
                        selectedId={alertColorId} onSelect={setAlertColorId} theme={theme} 
                        isActive={activeColorPicker === 'alert'} onToggle={() => setActiveColorPicker(p => p === 'alert' ? null : 'alert')}
                        typoStyles={typographyStyles}
                        iconStroke={iconStroke}
                      />
                    </div>
                  </div>

                  
                </div>

                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
            {activeView === 'input' && (
              <motion.div 
                key="input"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col h-full w-full max-w-3xl mx-auto overflow-y-auto pb-20 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                <div className="flex items-center justify-between mb-10 px-2">
                  <div>
                    <h2 className={`${theme.text} tracking-tight ${typographyStyles.title}`} style={{ fontSize: `${titleSize * 1.2}px` }}>Input Devices</h2>
                    <p className={`${theme.subtext} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Keyboard, mouse, and touch settings</p>
                  </div>
                  <button onClick={() => setActiveView('settings')} className={`w-10 h-10 rounded-full ${theme.card} border ${theme.border} flex items-center justify-center hover:brightness-110 transition-all`}>
                    <ArrowLeft strokeWidth={iconStroke} className={`w-5 h-5 ${theme.text}`} />
                  </button>
                </div>

                <div className={`${theme.card} border ${theme.border} p-6 md:p-8 mb-8`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                  <div className="mb-6 flex justify-between items-center">
                    <h3 className={`${theme.text} ${typographyStyles.title}`} style={{ fontSize: `${titleSize}px` }}>Global Hotkeys</h3>
                    <div className="relative">
                      <select 
                        value={inputPreset}
                        onChange={(e) => setInputPreset(e.target.value as any)}
                        className={`appearance-none bg-zinc-500/10 ${theme.text} border ${theme.border} text-xs px-3 py-1.5 rounded-lg pr-8 outline-none hover:bg-zinc-500/20 transition-colors cursor-pointer capitalize`}
                      >
                        <option value="blender">Blender Default</option>
                        <option value="unreal">Unreal Engine</option>
                        <option value="unity">Unity 3D</option>
                      </select>
                      <ChevronDown size={14} className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${theme.subtext}`} />
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    {hotkeys.map(hk => (
                      <div key={hk.id} className={`flex items-center justify-between p-3 rounded-xl border ${theme.border} bg-white/[0.02] hover:bg-white/[0.04] transition-colors`}>
                        <div className="flex flex-col">
                          <span className={`font-medium ${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>{hk.action}</span>
                          <span className={`text-xs ${theme.subtext}`}>{hk.group}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <RenderHotkey hk={hk} theme={theme} />
                          
                          <button 
                            className={`ml-2 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${theme.subtext}`}
                            onClick={() => {
                              setEditingHotkey(hk.id);
                              // Just a simple visual swap or alert for now
                              alert("Listening for new keybind for: " + hk.action);
                              setEditingHotkey(null);
                            }}
                          >
                            <Keyboard className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`${theme.card} border ${theme.border} p-6 md:p-8`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                   <div className="mb-6">
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>Mouse Settings</h3>
                  </div>
                  <div className="flex flex-col gap-6">
                    <div className="flex justify-between items-center">
                      <span className={`${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Invert Scroll Direction</span>
                      <button className={`w-12 h-6 rounded-full transition-colors relative bg-white/10`}>
                        <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm left-1`} />
                      </button>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Pointer Speed</span>
                      <input type="range" min="1" max="10" defaultValue="5" className={`w-32 h-1.5 rounded-full appearance-none outline-none bg-white/10`} />
                    </div>
                  </div>
                </div>

                <div className={`${theme.card} border ${theme.border} p-6 md:p-8 mt-8`} style={{ borderRadius: `${Math.max(16, radius)}px` }}>
                   <div className="mb-6">
                    <h3 className={`${theme.text} ${typographyStyles.title} mb-2`} style={{ fontSize: `${titleSize}px` }}>Touch & Stylus</h3>
                  </div>
                  <div className="flex flex-col gap-6">
                    <div className="flex justify-between items-center">
                      <span className={`${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Enable Touch Gestures</span>
                      <button className={`w-12 h-6 rounded-full transition-colors relative ${systemColors.primary.class}`}>
                        <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm left-7`} />
                      </button>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Stylus Pressure Sensitivity</span>
                      <button className={`w-12 h-6 rounded-full transition-colors relative ${systemColors.primary.class}`}>
                        <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm left-7`} />
                      </button>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      <span className={`${theme.text} ${typographyStyles.body}`} style={{ fontSize: `${bodySize}px` }}>Default Touch Action</span>
                      <div className="flex gap-2 p-1 bg-zinc-500/10 rounded-lg">
                        {['Orbit', 'Pan', 'Select'].map(act => (
                          <button key={act} className={`px-3 py-1 rounded-md text-xs transition-colors ${act === 'Orbit' ? `${theme.card} ${theme.text} shadow-sm border border-zinc-500/20` : `${theme.subtext} hover:bg-zinc-500/10`}`}>
                            {act}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Top Notch */}
      <motion.div
        initial={{ y: -40 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={togglePanel}
        className="absolute top-0 left-1/2 -translate-x-1/2 w-48 sm:w-64 h-8 flex items-center justify-center z-50 drop-shadow-2xl cursor-pointer group"
      >
        {/* Trapezoid SVG Background */}
        <svg
          className={`absolute inset-0 w-full h-full ${theme.notch} transition-colors duration-500`}
          viewBox="0 0 200 32"
          preserveAspectRatio="none"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 0 0 L 200 0 L 185 22 Q 180 32 165 32 L 35 32 Q 20 32 15 22 L 0 0 Z"
            stroke="rgba(150,150,150,0.15)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Text inside notch */}
        <div className="relative z-10 flex items-center justify-center -mt-1">
          <span className={`text-[10px] sm:text-[11px] font-bold tracking-widest ${themeId === 'light' ? 'text-zinc-600' : 'text-zinc-300'} uppercase select-none transition-colors duration-500`}>
            WorkspaceName
          </span>
        </div>
      </motion.div>

      {/* Main Content Area (Background) */}
      <main className="flex flex-col items-center justify-center text-center p-6">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className={`${theme.subtext} text-sm tracking-widest uppercase transition-colors duration-500`}
        >
          Click the top notch to open dashboard
        </motion.p>
      </main>
    </div>
  );
}

// --- Helper Components ---

function ColorPickerRow({ id, title, description, selectedId, onSelect, theme, isActive, onToggle, typoStyles, iconStroke }: any) {
  const selectedColor = COLORS.find(c => c.id === selectedId) || COLORS[0];
  
  return (
    <div className={`border-b ${theme.border} last:border-0`}>
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between py-5 focus:outline-none group"
      >
        <span className={`text-sm ${theme.text} ${typoStyles.subheader}`}>{title}</span>
        <div className="flex items-center gap-3">
          <div className={`w-5 h-5 rounded-full ${selectedColor.class} shadow-sm ring-1 ring-black/10`} />
          <ChevronRight strokeWidth={iconStroke} className={`w-4 h-4 ${theme.subtext} transition-transform duration-300 ${isActive ? 'rotate-90' : ''}`} />
        </div>
      </button>
      <AnimatePresence>
        {isActive && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pb-6 pt-1">
              <p className={`text-xs ${theme.subtext} mb-4 ${typoStyles.body}`}>{description}</p>
              <div className="flex gap-3 flex-wrap">
                {COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`w-8 h-8 rounded-full ${c.class} flex items-center justify-center transition-transform hover:scale-110 focus:outline-none ${selectedId === c.id ? 'ring-2 ring-offset-2 ring-offset-transparent ring-white/50 scale-110 shadow-md' : ''}`}
                  >
                    {selectedId === c.id && <CheckCircle2 strokeWidth={iconStroke} className="w-4 h-4 text-white drop-shadow-md" />}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TypographyScaleRow({ title, styleId, setStyleId, size, setSize, min, max, fontClass, theme, themeId, sampleText, colorClass }: any) {
  const currentStyle = FONT_STYLES.find(s => s.id === styleId) || FONT_STYLES[1];

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-6 pb-8 border-b ${theme.border} last:border-0 last:pb-0`}>
      <div className="w-64 flex-shrink-0">
        <div className="flex justify-between items-end mb-3">
          <div className={`text-base font-medium ${theme.text}`}>{title}</div>
          <div className={`text-xs ${theme.subtext}`}>{size}px</div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={`w-full h-1.5 rounded-full appearance-none outline-none ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
        />
        <div className="mt-4 flex gap-1.5 flex-wrap">
          {FONT_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => setStyleId(s.id)}
              className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded-md transition-colors ${styleId === s.id ? `${theme.text} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'} font-medium` : `${theme.subtext} hover:${theme.text}`}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className={`${fontClass} ${colorClass || theme.text} ${currentStyle.class} truncate`} style={{ fontSize: `${size}px` }}>
        {sampleText || 'The quick brown fox jumps over the lazy dog'}
      </div>
    </div>
  );
}

function IconScaleRow({ title, weightId, setWeightId, size, setSize, min, max, theme, themeId, sysColors, iconStyle }: any) {
  const stroke = getIconStroke(weightId);

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-6 pb-8 border-b ${theme.border} last:border-0 last:pb-0`}>
      <div className="w-64 flex-shrink-0">
        <div className="flex justify-between items-end mb-3">
          <div className={`text-base font-medium ${theme.text}`}>{title}</div>
          <div className={`text-xs ${theme.subtext}`}>{size}px</div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={`w-full h-1.5 rounded-full appearance-none outline-none ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
        />
        <div className="mt-4 flex gap-1.5 flex-wrap">
          {FONT_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => setWeightId(s.id)}
              className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded-md transition-colors ${weightId === s.id ? `${theme.text} ${themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'} font-medium` : `${theme.subtext} hover:${theme.text}`}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex items-center justify-end gap-6 overflow-hidden">
        <Settings size={size} strokeWidth={stroke} className={getIconColorClass(Settings, iconStyle, theme, sysColors)} />
        <Bell size={size} strokeWidth={stroke} className={getIconColorClass(Bell, iconStyle, theme, sysColors)} />
        <Mail size={size} strokeWidth={stroke} className={getIconColorClass(Mail, iconStyle, theme, sysColors)} />
        <CheckCircle2 size={size} strokeWidth={stroke} className={getIconColorClass(CheckCircle2, iconStyle, theme, sysColors)} />
      </div>
    </div>
  );
}

function QuickIcon({ icon: Icon, primaryColor, theme, label, active = false, onClick, radius, sizes, typoStyles, iconStyle, sysColors, iconSize, iconStroke }: any) {
  const iconColor = active ? 'text-white' : getIconColorClass(Icon, iconStyle, theme, sysColors);
  return (
    <div 
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-3 p-6 ${active ? primaryColor.class : theme.card} transition-all cursor-pointer hover:brightness-110 border ${theme.border}`}
      style={{ borderRadius: `${radius}px` }}
    >
      <Icon size={iconSize * 1.25} strokeWidth={iconStroke} className={iconColor} />
      <span className={`${active ? 'text-white' : theme.subtext} ${typoStyles.label}`} style={{ fontSize: `${sizes.label}px` }}>{label}</span>
    </div>
  );
}

function NotificationCard({ title, time, desc, theme, sysColors, type = 'default', radius, sizes, typoStyles, iconStyle, iconSize, iconStroke }: any) {
  let colorObj = sysColors.primary;
  let Icon = Bell;
  let isSpecial = type !== 'default';
  
  if (type === 'alert') { colorObj = sysColors.alert; Icon = AlertTriangle; }
  else if (type === 'warning') { colorObj = sysColors.warning; Icon = AlertTriangle; }
  else if (type === 'info') { colorObj = sysColors.info; Icon = Info; }

  const descStyle = type === 'alert' ? typoStyles.alert : (type === 'warning' ? typoStyles.warning : typoStyles.body);
  const iconColor = isSpecial ? colorObj.textClass : getIconColorClass(Icon, iconStyle, theme, sysColors);

  return (
    <div 
      className={`${theme.card} p-6 flex gap-6 cursor-pointer hover:brightness-110 transition-all border ${theme.border}`}
      style={{ borderRadius: `${radius}px` }}
    >
      <div className={`w-12 h-12 rounded-full ${isSpecial ? `${colorObj.bgSoft} ${colorObj.borderClass}` : `${theme.bg} border ${theme.border}`} flex items-center justify-center flex-shrink-0`}>
        <Icon size={iconSize * 0.8} strokeWidth={iconStroke} className={iconColor} />
      </div>
      <div className="text-left flex-1">
        <div className="flex justify-between items-center mb-2">
          <h4 className={`${isSpecial ? colorObj.textClass : theme.text} ${typoStyles.subheader}`} style={{ fontSize: `${sizes.subheader}px` }}>{title}</h4>
          <span className={`${theme.subtext} ${typoStyles.label}`} style={{ fontSize: `${sizes.label}px` }}>{time}</span>
        </div>
        <p className={`${isSpecial ? colorObj.textClass : theme.subtext} ${isSpecial ? 'opacity-80' : ''} leading-relaxed ${descStyle}`} style={{ fontSize: `${isSpecial ? sizes.warning : sizes.body}px` }}>{desc}</p>
      </div>
    </div>
  );
}

function SettingsRow({ icon: Icon, title, subtitle, theme, onClick, hasBorder = true, sizes, typoStyles, iconStyle, sysColors, iconSize, iconStroke }: any) {
  const iconColor = getIconColorClass(Icon, iconStyle, theme, sysColors);
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-5 p-5 cursor-pointer hover:brightness-110 transition-all ${hasBorder ? `border-b ${theme.border}` : ''}`}
    >
      <div className={`w-12 h-12 rounded-full ${theme.bg} border ${theme.border} flex items-center justify-center flex-shrink-0`}>
        <Icon size={iconSize} strokeWidth={iconStroke} className={iconColor} />
      </div>
      <div className="flex-1">
        <h4 className={`${theme.text} ${typoStyles.subheader}`} style={{ fontSize: `${sizes.subheader}px` }}>{title}</h4>
        <p className={`${theme.subtext} ${typoStyles.body}`} style={{ fontSize: `${sizes.body}px` }}>{subtitle}</p>
      </div>
      <ChevronRight strokeWidth={iconStroke} className={`w-5 h-5 ${theme.subtext} opacity-50`} />
    </div>
  );
}

function AppToggleRow({ icon: Icon, title, subtitle, active, onChange, theme, themeId, sysColors, sizes, typoStyles, hasBorder = true, iconStyle, iconSize, iconStroke }: any) {
  const iconColor = getIconColorClass(Icon, iconStyle, theme, sysColors);
  return (
    <div className={`flex items-center justify-between p-5 ${hasBorder ? `border-b ${theme.border}` : ''}`}>
      <div className="flex items-center gap-5">
        <div className={`w-12 h-12 rounded-full ${theme.bg} border ${theme.border} flex items-center justify-center flex-shrink-0`}>
          <Icon size={iconSize} strokeWidth={iconStroke} className={iconColor} />
        </div>
        <div>
          <h4 className={`${theme.text} ${typoStyles.subheader}`} style={{ fontSize: `${sizes.subheader}px` }}>{title}</h4>
          <p className={`${theme.subtext} ${typoStyles.body}`} style={{ fontSize: `${sizes.body}px` }}>{subtitle}</p>
        </div>
      </div>
      <button 
        onClick={onChange}
        className={`w-12 h-6 rounded-full transition-colors relative ${active ? sysColors.primary.class : themeId === 'light' || themeId === 'sand' ? 'bg-black/10' : 'bg-white/10'}`}
      >
        <div className={`absolute top-1 bottom-1 w-4 rounded-full bg-white transition-all shadow-sm ${active ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}
