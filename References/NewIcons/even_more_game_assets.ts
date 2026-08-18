import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const VFXGraphWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="vfxFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="vfxShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="vfxBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <radialGradient id="vfxGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#06b6d4" stopOpacity="1" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
      </radialGradient>
    </defs>
    <g transform="translate(120, 110)">
      {/* Background Magic/VFX */}
      <circle cx="10" cy="-20" r="40" fill="url(#vfxGlow)" opacity="0.4" filter="blur(4px)" />
      
      <g filter="url(#vfxShadow)">
        {/* Graph Nodes */}
        {/* Node 1 (Input) */}
        <rect x="-50" y="-10" width="30" height="20" rx="4" fill="url(#vfxFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="-20" cy="0" r="3" fill="#06b6d4" />
        
        {/* Node 2 (Math/Logic) */}
        <rect x="-10" y="-40" width="30" height="20" rx="4" fill="url(#vfxFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="-10" cy="-30" r="3" fill="#06b6d4" />
        <circle cx="20" cy="-30" r="3" fill="#06b6d4" />
        
        {/* Node 3 (Output Particle) */}
        <rect x="30" y="-15" width="40" height="30" rx="4" fill="url(#vfxFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="30" cy="0" r="3" fill="#06b6d4" />
        
        {/* Connections */}
        <path d="M -20 0 C -10 0, -20 -30, -10 -30" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" />
        <path d="M 20 -30 C 30 -30, 20 0, 30 0" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" />
      </g>
      
      {/* Burst Effect */}
      <path d="M 50 -30 L 52 -40 M 55 -25 L 65 -25 M 60 -15 L 70 -5" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
      <circle cx="55" cy="-25" r="8" fill="url(#vfxGlow)" />

      {/* Badge */}
      <g transform="translate(-45, -50)" filter="url(#vfxBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 10 2 L 10 7 M 10 13 L 10 18 M 2 10 L 7 10 M 13 10 L 18 10 M 4.3 4.3 L 7.8 7.8 M 12.2 12.2 L 15.7 15.7 M 15.7 4.3 L 12.2 7.8 M 7.8 12.2 L 4.3 15.7" />
          <circle cx="10" cy="10" r="2" fill="#22d3ee" />
        </g>
      </g>
    </g>
  </svg>
);

const DecalWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="decalFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="decalShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="decalBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <linearGradient id="decalBeam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#facc15" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
      </linearGradient>
    </defs>
    <g transform="translate(120, 110)">
      <g filter="url(#decalShadow)">
        {/* Wall/Surface */}
        <path d="M -50 20 L 50 -10 L 50 50 L -50 80 Z" fill="url(#decalFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M -50 20 L 50 -10 L 50 -15 L -50 15 Z" fill="#2d2d2d" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        
        {/* The Decal (Splatter / Graphic) */}
        <g transform="translate(0, 30) scale(1, 0.7) rotate(15)">
          <path d="M 0 -15 C 10 -15, 15 -5, 15 0 C 15 10, 5 15, 0 15 C -10 15, -20 5, -15 -5 C -10 -10, -5 -15, 0 -15 Z" fill="#facc15" opacity="0.8" />
          <circle cx="12" cy="12" r="3" fill="#facc15" opacity="0.8" />
          <circle cx="-15" cy="8" r="4" fill="#facc15" opacity="0.8" />
          <circle cx="-5" cy="-18" r="2" fill="#facc15" opacity="0.8" />
        </g>
        
        {/* Projector Box */}
        <rect x="-15" y="-50" width="30" height="20" rx="4" fill="#111" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        <polygon points="-5,-30 5,-30 10,-20 -10,-20" fill="#222" />
        
        {/* Projection Beam */}
        <polygon points="-8,-20 8,-20 25,30 -25,40" fill="url(#decalBeam)" opacity="0.6" style={{ mixBlendMode: 'screen' }} />
      </g>

      {/* Badge */}
      <g transform="translate(35, -45)" filter="url(#decalBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="6" strokeDasharray="2 3" />
          <circle cx="10" cy="10" r="2" fill="#facc15" />
          <path d="M 10 1 L 10 4 M 10 16 L 10 19 M 1 10 L 4 10 M 16 10 L 19 10" strokeWidth="1.5" />
        </g>
      </g>
    </g>
  </svg>
);

const LODGroupWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="lodFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="lodShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="lodBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 130)">
      <g filter="url(#lodShadow)">
        {/* High Poly (Foreground) */}
        <g transform="translate(-30, 20)">
          <path d="M 0 -35 L 20 -5 L 0 10 L -20 -5 Z" fill="#363636" stroke="#818cf8" strokeWidth="1" />
          <path d="M 0 -35 L 0 10" stroke="#818cf8" strokeWidth="1" />
          <path d="M -20 -5 L 20 -5" stroke="#818cf8" strokeWidth="1" />
          <path d="M -10 -20 L 10 -20 L 10 3 L -10 3 Z" fill="none" stroke="#818cf8" strokeWidth="0.5" />
          <path d="M -20 -5 L 0 -20 M 20 -5 L 0 -20" stroke="#818cf8" strokeWidth="0.5" />
        </g>
        
        {/* Medium Poly (Middle) */}
        <g transform="translate(15, -5) scale(0.7)">
          <path d="M 0 -35 L 20 -5 L 0 10 L -20 -5 Z" fill="#2d2d2d" stroke="#6366f1" strokeWidth="1.5" />
          <path d="M 0 -35 L 0 10" stroke="#6366f1" strokeWidth="1.5" />
          <path d="M -20 -5 L 20 -5" stroke="#6366f1" strokeWidth="1.5" />
        </g>
        
        {/* Low Poly (Background) */}
        <g transform="translate(45, -30) scale(0.4)">
          <path d="M 0 -35 L 20 -5 L -20 -5 Z" fill="#1f1f1f" stroke="#4f46e5" strokeWidth="2.5" />
          <path d="M 0 -35 L 0 10" stroke="#4f46e5" strokeWidth="2.5" />
        </g>
        
        {/* Distance connection lines */}
        <path d="M -20 15 L 10 -15 L 40 -35" fill="none" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -65)" filter="url(#lodBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="12" width="4" height="6" fill="#818cf8" />
          <rect x="8" y="7" width="4" height="11" fill="#818cf8" opacity="0.6" />
          <rect x="14" y="2" width="4" height="16" fill="#818cf8" opacity="0.3" />
        </g>
      </g>
    </g>
  </svg>
);

const UICanvasWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="uiFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="uiShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="uiBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      {/* 3D projection lines */}
      <path d="M -60 -40 L -40 -60 M -60 40 L -40 20 M 60 -40 L 80 -60 M 60 40 L 80 20" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4" />
      
      <g filter="url(#uiShadow)">
        {/* Canvas bounding box */}
        <rect x="-60" y="-40" width="120" height="80" fill="none" stroke="#a855f7" strokeWidth="1" opacity="0.5" />
        
        {/* UI Panel */}
        <g transform="translate(-10, -10)">
          <rect x="-30" y="-20" width="80" height="60" rx="4" fill="url(#uiFrontGrad)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
          
          {/* Header */}
          <rect x="-30" y="-20" width="80" height="15" rx="4" fill="#a855f7" />
          <circle cx="40" cy="-12" r="3" fill="#fff" />
          <rect x="-22" y="-14" width="25" height="4" rx="2" fill="#fff" opacity="0.8" />
          
          {/* Content */}
          <rect x="-20" y="5" width="25" height="25" rx="2" fill="#2d2d2d" stroke="#555" strokeWidth="1" />
          <path d="M -15 25 L -5 10 L 0 15 L 10 5" fill="none" stroke="#d8b4fe" strokeWidth="1.5" strokeLinecap="round" />
          
          <rect x="15" y="5" width="25" height="4" rx="2" fill="#999" />
          <rect x="15" y="15" width="20" height="4" rx="2" fill="#777" />
          <rect x="15" y="25" width="15" height="4" rx="2" fill="#555" />
          
          {/* Slider */}
          <rect x="-20" y="45" width="60" height="4" rx="2" fill="#2d2d2d" />
          <rect x="-20" y="45" width="25" height="4" rx="2" fill="#a855f7" />
          <circle cx="5" cy="47" r="4" fill="#fff" />
        </g>
      </g>

      {/* Badge */}
      <g transform="translate(35, 25)" filter="url(#uiBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="16" height="14" rx="2" />
          <line x1="2" y1="8" x2="18" y2="8" />
          <line x1="6" y1="5" x2="8" y2="5" />
        </g>
      </g>
    </g>
  </svg>
);

const RaycastWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="rayFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="rayShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="rayBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#rayShadow)">
        {/* Surface */}
        <path d="M -50 20 L 10 40 L 70 20 L 10 0 Z" fill="url(#rayFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M -50 20 L 10 40 L 10 50 L -50 30 Z" fill="#111" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <path d="M 10 40 L 70 20 L 70 30 L 10 50 Z" fill="#1f1f1f" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        
        {/* Ray Origin (Camera/Eye) */}
        <rect x="-45" y="-55" width="20" height="15" rx="3" fill="#2d2d2d" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        <circle cx="-35" cy="-47.5" r="4" fill="#ef4444" />
        
        {/* The Ray */}
        <path d="M -35 -40 L 10 20" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeDasharray="4 2" />
        
        {/* Hit Point */}
        <circle cx="10" cy="20" r="5" fill="#ef4444" />
        <circle cx="10" cy="20" r="10" fill="none" stroke="#ef4444" strokeWidth="1.5" opacity="0.6" />
        
        {/* Hit Normal */}
        <path d="M 10 20 L 10 -20" fill="none" stroke="#34d399" strokeWidth="2" />
        <polygon points="10,-25 6,-15 14,-15" fill="#34d399" />
        
        {/* Reflection (optional, faint) */}
        <path d="M 10 20 L 50 -10" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.4" />
      </g>

      {/* Badge */}
      <g transform="translate(30, -50)" filter="url(#rayBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="6" />
          <circle cx="10" cy="10" r="1.5" fill="#ef4444" />
          <line x1="10" y1="0" x2="10" y2="3" />
          <line x1="10" y1="17" x2="10" y2="20" />
          <line x1="0" y1="10" x2="3" y2="10" />
          <line x1="17" y1="10" x2="20" y2="10" />
        </g>
      </g>
    </g>
  </svg>
);

const TimelineWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="timeFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="timeShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="timeBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#timeShadow)">
        {/* Timeline Panel */}
        <rect x="-65" y="-35" width="130" height="70" rx="6" fill="url(#timeFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Top Ruler */}
        <rect x="-65" y="-35" width="130" height="15" rx="6" fill="#111" />
        <path d="M -50 -35 L -50 -25 M -30 -35 L -30 -28 M -10 -35 L -10 -25 M 10 -35 L 10 -28 M 30 -35 L 30 -25 M 50 -35 L 50 -28" stroke="#555" strokeWidth="1" />
        
        {/* Tracks */}
        <rect x="-60" y="-10" width="120" height="12" rx="2" fill="#222" />
        <rect x="-60" y="8" width="120" height="12" rx="2" fill="#222" />
        
        {/* Keyframes */}
        {/* Track 1 */}
        <polygon points="-40,-10 -36,-4 -40,2 -44,-4" fill="#3b82f6" />
        <polygon points="10,-10 14,-4 10,2 6,-4" fill="#3b82f6" />
        <rect x="-36" y="-6" width="46" height="4" fill="#3b82f6" opacity="0.3" />
        
        {/* Track 2 */}
        <polygon points="-20,8 -16,14 -20,20 -24,14" fill="#ec4899" />
        <polygon points="40,8 44,14 40,20 36,14" fill="#ec4899" />
        <rect x="-16" y="12" width="56" height="4" fill="#ec4899" opacity="0.3" />
        
        {/* Playhead */}
        <path d="M 0 -35 L 5 -25 L 1 -25 L 1 30 L -1 30 L -1 -25 L -5 -25 Z" fill="#ef4444" />
      </g>

      {/* Badge */}
      <g transform="translate(-15, 20)" filter="url(#timeBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="7,4 15,10 7,16" fill="#3b82f6" fillOpacity="0.2" />
          <line x1="2" y1="10" x2="18" y2="10" strokeDasharray="2 2" strokeWidth="1.5" opacity="0.5" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <VFXGraphWidget />
      <DecalWidget />
      <LODGroupWidget />
      <UICanvasWidget />
      <RaycastWidget />
      <TimelineWidget />`;

const appIndex = content.indexOf('export default function App() {');
if (appIndex !== -1) {
    let modified = content.slice(0, appIndex) + newComponents + '\n' + content.slice(appIndex);
    const renderIndex = modified.lastIndexOf('</div>');
    if (renderIndex !== -1) {
        modified = modified.slice(0, renderIndex) + renderComponents + '\n    ' + modified.slice(renderIndex);
        fs.writeFileSync('src/App.tsx', modified);
        console.log("More widgets added successfully.");
    } else {
        console.log("Could not find render area.");
    }
} else {
    console.log("Could not find App function.");
}
