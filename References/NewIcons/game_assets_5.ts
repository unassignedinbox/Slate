import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const ProfilerWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="profFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="profShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="profBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#profShadow)">
        {/* Screen/Panel */}
        <rect x="-60" y="-45" width="120" height="90" rx="6" fill="url(#profFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Inner Screen */}
        <rect x="-50" y="-35" width="100" height="70" rx="2" fill="#111" stroke="#333" strokeWidth="1" />
        
        {/* Grid lines */}
        <path d="M -50 -15 L 50 -15 M -50 5 L 50 5 M -50 25 L 50 25" fill="none" stroke="#222" strokeWidth="1" />
        <path d="M -25 -35 L -25 35 M 0 -35 L 0 35 M 25 -35 L 25 35" fill="none" stroke="#222" strokeWidth="1" />
        
        {/* Graph 1 (CPU - Green) */}
        <path d="M -50 25 L -35 15 L -20 20 L -5 -5 L 10 10 L 25 -20 L 40 -10 L 50 -25" fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" />
        <path d="M -50 35 L -50 25 L -35 15 L -20 20 L -5 -5 L 10 10 L 25 -20 L 40 -10 L 50 -25 L 50 35 Z" fill="#34d399" opacity="0.15" />
        
        {/* Graph 2 (GPU - Blue) */}
        <path d="M -50 10 L -30 20 L -10 0 L 10 -15 L 30 5 L 50 -5" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" opacity="0.8" />
        
        {/* Warning Spike (Red) */}
        <circle cx="25" cy="-20" r="3" fill="#ef4444" />
        <circle cx="25" cy="-20" r="6" fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.6" />
      </g>

      {/* Badge */}
      <g transform="translate(35, -60)" filter="url(#profBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2,14 8,8 12,12 18,4" />
          <polyline points="14,4 18,4 18,8" />
        </g>
      </g>
    </g>
  </svg>
);

const SceneHierarchyWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="hierFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="hierShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="hierBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#hierShadow)">
        {/* Panel */}
        <rect x="-55" y="-55" width="110" height="110" rx="6" fill="url(#hierFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Header */}
        <rect x="-55" y="-55" width="110" height="20" rx="6" fill="#2d2d2d" />
        <rect x="-45" y="-48" width="30" height="6" rx="3" fill="#fff" opacity="0.8" />
        
        {/* Tree Items */}
        {/* Root */}
        <polygon points="-40,-20 -36,-16 -40,-12" fill="#fff" opacity="0.6" />
        <rect x="-30" y="-19" width="45" height="6" rx="2" fill="#fff" opacity="0.9" />
        
        {/* Child 1 */}
        <rect x="-36" y="-5" width="1" height="40" fill="#555" />
        <rect x="-36" y="-5" width="10" height="1" fill="#555" />
        <polygon points="-25,-7 -21,-3 -25,1" fill="#fff" opacity="0.6" transform="rotate(90 -23 -3)" />
        <rect x="-15" y="-6" width="40" height="6" rx="2" fill="#a855f7" /> {/* Highlighted */}
        <rect x="-50" y="-10" width="100" height="14" fill="#a855f7" opacity="0.2" /> {/* Selection bg */}
        
        {/* Grandchild */}
        <rect x="-21" y="8" width="1" height="10" fill="#555" />
        <rect x="-21" y="8" width="10" height="1" fill="#555" />
        <rect x="-5" y="7" width="30" height="6" rx="2" fill="#fff" opacity="0.7" />
        
        <rect x="-21" y="18" width="10" height="1" fill="#555" />
        <rect x="-5" y="17" width="25" height="6" rx="2" fill="#fff" opacity="0.7" />
        
        {/* Child 2 */}
        <rect x="-36" y="32" width="10" height="1" fill="#555" />
        <polygon points="-25,30 -21,34 -25,38" fill="#fff" opacity="0.6" />
        <rect x="-15" y="31" width="35" height="6" rx="2" fill="#fff" opacity="0.7" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, 30)" filter="url(#hierBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="16" height="4" rx="1" />
          <rect x="6" y="9" width="12" height="4" rx="1" />
          <rect x="6" y="16" width="12" height="4" rx="1" />
          <line x1="4" y1="6" x2="4" y2="18" />
          <line x1="4" y1="11" x2="6" y2="11" />
          <line x1="4" y1="18" x2="6" y2="18" />
        </g>
      </g>
    </g>
  </svg>
);

const ColorPickerWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="colorFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="colorShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="colorBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      
      {/* Conic Gradient approximation using overlapping sweeps */}
      <linearGradient id="cgrad1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#f00"/><stop offset="100%" stopColor="#ff0"/></linearGradient>
      <linearGradient id="cgrad2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f0"/><stop offset="100%" stopColor="#0ff"/></linearGradient>
      <linearGradient id="cgrad3" x1="1" y1="0" x2="0" y2="0"><stop offset="0%" stopColor="#00f"/><stop offset="100%" stopColor="#f0f"/></linearGradient>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#colorShadow)">
        {/* Panel */}
        <rect x="-50" y="-55" width="100" height="110" rx="6" fill="url(#colorFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Color Wheel (Simulated) */}
        <g transform="translate(0, -15)">
          <circle cx="0" cy="0" r="28" fill="#fff" />
          <path d="M 0 -28 A 28 28 0 0 1 28 0 L 0 0 Z" fill="#ef4444" />
          <path d="M 28 0 A 28 28 0 0 1 0 28 L 0 0 Z" fill="#3b82f6" />
          <path d="M 0 28 A 28 28 0 0 1 -28 0 L 0 0 Z" fill="#10b981" />
          <path d="M -28 0 A 28 28 0 0 1 0 -28 L 0 0 Z" fill="#facc15" />
          {/* Inner gradient mask */}
          <circle cx="0" cy="0" r="28" fill="url(#colorFrontGrad)" opacity="0.3" />
          <circle cx="0" cy="0" r="14" fill="#2d2d2d" />
          
          {/* Picker Handle */}
          <circle cx="15" cy="-15" r="4" fill="none" stroke="#fff" strokeWidth="2" />
        </g>
        
        {/* Sliders */}
        <rect x="-35" y="25" width="70" height="6" rx="3" fill="#ef4444" opacity="0.8" />
        <circle cx="-10" cy="28" r="4" fill="#fff" />
        
        <rect x="-35" y="40" width="70" height="6" rx="3" fill="#fff" opacity="0.8" />
        <circle cx="20" cy="43" r="4" fill="#fff" />
      </g>

      {/* Badge */}
      <g transform="translate(30, -45)" filter="url(#colorBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 14.5 2 L 18 5.5 L 6 17.5 L 2 18 L 2.5 14 Z" />
          <line x1="12" y1="4.5" x2="15.5" y2="8" />
          <path d="M 2 18 L 0 20" strokeWidth="2.5" />
        </g>
      </g>
    </g>
  </svg>
);

const TerminalWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="termFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1a1a1a" stopOpacity="1" />
        <stop offset="100%" stopColor="#0a0a0a" stopOpacity="1" />
      </linearGradient>
      <filter id="termShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="termBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#termShadow)">
        {/* Terminal Window */}
        <rect x="-60" y="-45" width="120" height="90" rx="6" fill="url(#termFrontGrad)" stroke="#333" strokeWidth="1.5" />
        
        {/* Header Bar */}
        <path d="M -60 -39 C -60 -42.3, -57.3 -45, -54 -45 L 54 -45 C 57.3 -45, 60 -42.3, 60 -39 L 60 -25 L -60 -25 Z" fill="#2d2d2d" />
        <circle cx="-50" cy="-35" r="3" fill="#ef4444" />
        <circle cx="-40" cy="-35" r="3" fill="#facc15" />
        <circle cx="-30" cy="-35" r="3" fill="#22c55e" />
        
        {/* Code/Text Lines */}
        <g transform="translate(-50, -10)">
          <path d="M 0 0 L 4 4 L 0 8" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8" y="2" width="40" height="4" rx="2" fill="#fff" opacity="0.8" />
          
          <rect x="8" y="14" width="70" height="4" rx="2" fill="#9ca3af" />
          <rect x="8" y="24" width="55" height="4" rx="2" fill="#9ca3af" />
          
          <path d="M 0 36 L 4 40 L 0 44" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8" y="38" width="6" height="4" fill="#22c55e" opacity="0.8" />
        </g>
      </g>

      {/* Badge */}
      <g transform="translate(35, 25)" filter="url(#termBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4,4 10,10 4,16" />
          <line x1="12" y1="16" x2="18" y2="16" />
        </g>
      </g>
    </g>
  </svg>
);

const BuildWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="buildFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="buildShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="buildBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#buildShadow)">
        {/* Gear 1 */}
        <g transform="translate(-15, -10) scale(1.2)">
          <path d="M 0 -20 L 4 -20 L 6 -15 L 12 -12 L 17 -16 L 20 -13 L 15 -8 L 17 -2 L 22 0 L 22 4 L 17 6 L 15 12 L 20 16 L 17 20 L 12 15 L 6 17 L 4 22 L 0 22 L -2 17 L -8 15 L -13 20 L -16 17 L -12 12 L -14 6 L -19 4 L -19 0 L -14 -2 L -12 -8 L -16 -13 L -13 -16 L -8 -12 L -2 -15 Z" fill="#2d2d2d" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="2" cy="1" r="6" fill="#111" />
        </g>
        
        {/* Gear 2 (Smaller, intersecting) */}
        <g transform="translate(15, 20) rotate(15)">
          <path d="M 0 -15 L 3 -15 L 4 -11 L 9 -9 L 13 -12 L 15 -10 L 11 -6 L 13 -2 L 17 0 L 17 3 L 13 4 L 11 9 L 15 13 L 13 15 L 9 11 L 4 13 L 3 17 L 0 17 L -2 13 L -6 11 L -10 15 L -12 13 L -9 9 L -10 4 L -14 3 L -14 0 L -10 -2 L -9 -6 L -12 -10 L -10 -12 L -6 -9 L -2 -11 Z" fill="#3b82f6" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="1" cy="1" r="4" fill="#111" />
        </g>
        
        {/* Hammer */}
        <g transform="translate(15, -15) rotate(45)">
          <rect x="-4" y="-2" width="8" height="35" rx="2" fill="#854d0e" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <rect x="-12" y="-12" width="24" height="12" rx="2" fill="#9ca3af" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
          <path d="M 12 -9 L 16 -6 L 12 -3 Z" fill="#9ca3af" />
        </g>
      </g>

      {/* Badge */}
      <g transform="translate(-45, 20)" filter="url(#buildBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="10,2 18,6 18,14 10,18 2,14 2,6" />
          <circle cx="10" cy="10" r="3" />
        </g>
      </g>
    </g>
  </svg>
);

const XRWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="xrFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="xrShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="xrBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#xrShadow)">
        {/* Headband */}
        <path d="M -50 -10 Q 0 -30, 50 -10 L 50 10 Q 0 -10, -50 10 Z" fill="#2d2d2d" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
        
        {/* Visor */}
        <rect x="-40" y="-5" width="80" height="35" rx="12" fill="url(#xrFrontGrad)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        
        {/* Front Glass */}
        <rect x="-35" y="0" width="70" height="25" rx="8" fill="#111" />
        
        {/* Lenses / Cameras */}
        <circle cx="-15" cy="12" r="5" fill="#2d2d2d" stroke="#8b5cf6" strokeWidth="1.5" />
        <circle cx="15" cy="12" r="5" fill="#2d2d2d" stroke="#8b5cf6" strokeWidth="1.5" />
        
        <circle cx="-15" cy="12" r="2" fill="#8b5cf6" />
        <circle cx="15" cy="12" r="2" fill="#8b5cf6" />
        
        {/* Glowing Trim */}
        <path d="M -35 12 Q 0 25, 35 12" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -45)" filter="url(#xrBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 3 6 L 17 6 C 18.5 6, 19 7, 19 9 L 19 13 C 19 15, 18 16, 16 16 L 13 16 L 11 12 L 9 12 L 7 16 L 4 16 C 2 16, 1 15, 1 13 L 1 9 C 1 7, 1.5 6, 3 6 Z" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <ProfilerWidget />
      <SceneHierarchyWidget />
      <ColorPickerWidget />
      <TerminalWidget />
      <BuildWidget />
      <XRWidget />`;

const appIndex = content.indexOf('export default function App() {');
if (appIndex !== -1) {
    let modified = content.slice(0, appIndex) + newComponents + '\n' + content.slice(appIndex);
    const renderIndex = modified.lastIndexOf('</div>');
    if (renderIndex !== -1) {
        modified = modified.slice(0, renderIndex) + renderComponents + '\n    ' + modified.slice(renderIndex);
        fs.writeFileSync('src/App.tsx', modified);
        console.log("6 Final widgets added successfully.");
    } else {
        console.log("Could not find render area.");
    }
} else {
    console.log("Could not find App function.");
}
