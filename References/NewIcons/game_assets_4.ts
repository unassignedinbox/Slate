import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const TilemapWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="tileFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="tileShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="tileBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#tileShadow)">
        {/* Board Base */}
        <rect x="-50" y="-50" width="100" height="100" rx="4" fill="url(#tileFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Grid */}
        <g stroke="#4b5563" strokeWidth="1" opacity="0.5">
          <line x1="-25" y1="-50" x2="-25" y2="50" />
          <line x1="0" y1="-50" x2="0" y2="50" />
          <line x1="25" y1="-50" x2="25" y2="50" />
          <line x1="-50" y1="-25" x2="50" y2="-25" />
          <line x1="-50" y1="0" x2="50" y2="0" />
          <line x1="-50" y1="25" x2="50" y2="25" />
        </g>
        
        {/* Tiles */}
        <rect x="-48" y="-48" width="21" height="21" rx="2" fill="#10b981" />
        <rect x="-23" y="-48" width="21" height="21" rx="2" fill="#10b981" />
        <rect x="2" y="-48" width="21" height="21" rx="2" fill="#3b82f6" />
        
        <rect x="-48" y="-23" width="21" height="21" rx="2" fill="#10b981" />
        <rect x="-23" y="-23" width="21" height="21" rx="2" fill="#f59e0b" />
        <rect x="2" y="-23" width="21" height="21" rx="2" fill="#3b82f6" />
        
        <rect x="-23" y="2" width="21" height="21" rx="2" fill="#f59e0b" />
        <rect x="2" y="2" width="21" height="21" rx="2" fill="#f59e0b" />
        <rect x="27" y="2" width="21" height="21" rx="2" fill="#8b5cf6" />
        
        {/* Highlighted Tile (Selection) */}
        <rect x="2" y="27" width="21" height="21" rx="2" fill="none" stroke="#fcd34d" strokeWidth="2" strokeDasharray="4 2" />
      </g>

      {/* Badge */}
      <g transform="translate(35, 35)" filter="url(#tileBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="12" height="12" rx="1" />
          <line x1="10" y1="4" x2="10" y2="16" />
          <line x1="4" y1="10" x2="16" y2="10" />
        </g>
      </g>
    </g>
  </svg>
);

const SpriteSheetWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="spriteFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="spriteShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="spriteBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      {/* Background Film Strip */}
      <g filter="url(#spriteShadow)">
        <rect x="-80" y="-30" width="160" height="60" rx="4" fill="url(#spriteFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Film Holes */}
        <g fill="#111">
          {[-70, -50, -30, -10, 10, 30, 50, 70].map(x => (
            <rect key={'top-'+x} x={x-3} y="-26" width="6" height="4" rx="1" />
          ))}
          {[-70, -50, -30, -10, 10, 30, 50, 70].map(x => (
            <rect key={'bot-'+x} x={x-3} y="22" width="6" height="4" rx="1" />
          ))}
        </g>
        
        {/* Frames */}
        <rect x="-65" y="-15" width="30" height="30" rx="2" fill="#2d2d2d" stroke="#555" strokeWidth="1" />
        <rect x="-25" y="-15" width="30" height="30" rx="2" fill="#2d2d2d" stroke="#555" strokeWidth="1" />
        <rect x="15" y="-15" width="30" height="30" rx="2" fill="#2d2d2d" stroke="#555" strokeWidth="1" />
        
        {/* Sprite Character Animation (Simple stick figure running) */}
        {/* Frame 1 */}
        <g transform="translate(-50, 0)" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="0" cy="-6" r="3" fill="#f43f5e" />
          <path d="M 0 -3 L 0 5" />
          <path d="M 0 -1 L -6 2 M 0 -1 L 4 4" />
          <path d="M 0 5 L -4 10 M 0 5 L 4 10" />
        </g>
        {/* Frame 2 */}
        <g transform="translate(-10, 0)" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="0" cy="-7" r="3" fill="#f43f5e" />
          <path d="M 0 -4 L 2 4" />
          <path d="M 1 -2 L -5 0 M 1 -2 L 5 2" />
          <path d="M 2 4 L -2 9 M 2 4 L 6 9" />
        </g>
        {/* Frame 3 */}
        <g transform="translate(30, 0)" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="2" cy="-6" r="3" fill="#f43f5e" />
          <path d="M 2 -3 L 4 5" />
          <path d="M 2 -1 L -3 -2 M 3 0 L 7 1" />
          <path d="M 4 5 L 0 9 M 4 5 L 7 8" />
        </g>
        
        {/* Crop/Active Frame Highlight */}
        <rect x="-27" y="-17" width="34" height="34" rx="3" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
      </g>

      {/* Badge */}
      <g transform="translate(45, -45)" filter="url(#spriteBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <circle cx="10" cy="10" r="3" />
          <line x1="3" y1="7" x2="17" y2="7" />
          <line x1="3" y1="13" x2="17" y2="13" />
        </g>
      </g>
    </g>
  </svg>
);

const GizmoWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <filter id="gizmoShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="gizmoBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#gizmoShadow)">
        {/* Grid plane */}
        <path d="M -50 20 L 0 45 L 50 20 L 0 -5 Z" fill="#1f1f1f" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        
        {/* Rotation Rings */}
        <ellipse cx="0" cy="15" rx="30" ry="12" fill="none" stroke="#34d399" strokeWidth="2" opacity="0.6" />
        <path d="M 0 -15 A 25 25 0 0 0 -25 15 A 25 25 0 0 0 0 45" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.6" transform="rotate(-30 0 15)" />
        <path d="M 0 -15 A 25 25 0 0 1 25 15 A 25 25 0 0 1 0 45" fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.6" transform="rotate(30 0 15)" />

        {/* Translation Axes */}
        {/* Y Axis (Green) */}
        <line x1="0" y1="15" x2="0" y2="-45" stroke="#34d399" strokeWidth="3" strokeLinecap="round" />
        <polygon points="-5,-40 5,-40 0,-55" fill="#34d399" />
        
        {/* X Axis (Red) */}
        <line x1="0" y1="15" x2="40" y2="35" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
        <polygon points="35,30 40,40 50,40" fill="#ef4444" />
        
        {/* Z Axis (Blue) */}
        <line x1="0" y1="15" x2="-35" y2="30" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
        <polygon points="-30,25 -35,35 -45,35" fill="#3b82f6" />
        
        {/* Center Origin Point */}
        <circle cx="0" cy="15" r="5" fill="#fff" />
      </g>

      {/* Badge */}
      <g transform="translate(30, -50)" filter="url(#gizmoBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="10" y1="10" x2="10" y2="2" stroke="#34d399" />
          <line x1="10" y1="10" x2="18" y2="15" stroke="#ef4444" />
          <line x1="10" y1="10" x2="2" y2="15" stroke="#3b82f6" />
          <circle cx="10" cy="10" r="1.5" fill="#fff" stroke="none" />
        </g>
      </g>
    </g>
  </svg>
);

const LightProbeWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="probeFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="probeShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="probeBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      
      {/* Reflective Sphere Gradient */}
      <radialGradient id="probeReflection" cx="40%" cy="40%" r="60%">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="20%" stopColor="#e0f2fe" stopOpacity="0.7" />
        <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#0f172a" stopOpacity="0.9" />
      </radialGradient>
    </defs>
    <g transform="translate(120, 120)">
      {/* Surrounding Sample Points */}
      <path d="M 0 -60 L 0 60 M -60 0 L 60 0 M -40 -40 L 40 40 M -40 40 L 40 -40" stroke="#fcd34d" strokeWidth="1" strokeDasharray="2 4" opacity="0.3" />
      <g fill="#fcd34d" opacity="0.6">
        <circle cx="0" cy="-60" r="3" />
        <circle cx="0" cy="60" r="3" />
        <circle cx="-60" cy="0" r="3" />
        <circle cx="60" cy="0" r="3" />
        <circle cx="-40" cy="-40" r="3" />
        <circle cx="40" cy="40" r="3" />
        <circle cx="-40" cy="40" r="3" />
        <circle cx="40" cy="-40" r="3" />
      </g>

      <g filter="url(#probeShadow)">
        {/* Base Stand */}
        <path d="M -10 35 L 10 35 L 15 55 L -15 55 Z" fill="#111" stroke="#333" strokeWidth="1.5" />
        <rect x="-4" y="20" width="8" height="20" fill="#2d2d2d" stroke="#555" strokeWidth="1" />
        
        {/* The Probe Sphere */}
        <circle cx="0" cy="0" r="30" fill="url(#probeReflection)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        
        {/* Reflection Highlight */}
        <ellipse cx="-8" cy="-12" rx="10" ry="6" fill="#fff" opacity="0.6" transform="rotate(-30 -8 -12)" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -45)" filter="url(#probeBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="5" />
          <path d="M 10 1 L 10 3 M 10 17 L 10 19 M 1 10 L 3 10 M 17 10 L 19 10" />
          <path d="M 3.5 3.5 L 5 5 M 15 15 L 16.5 16.5 M 3.5 16.5 L 5 15 M 15 5 L 16.5 3.5" />
        </g>
      </g>
    </g>
  </svg>
);

const TerrainBrushWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="brushFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="brushShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="brushBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#brushShadow)">
        {/* Terrain Surface (Curved up to show brushing) */}
        <path d="M -60 30 Q -30 30, 0 5 Q 30 -20, 60 10 L 60 50 L -60 50 Z" fill="url(#brushFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinejoin="round" />
        
        {/* Wireframe over the terrain */}
        <path d="M -60 40 Q -30 40, 0 15 Q 30 -10, 60 20" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.4" />
        <path d="M -60 50 Q -30 50, 0 25 Q 30 0, 60 30" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.4" />
        <path d="M -40 30 L -40 50 M -20 20 L -20 50 M 0 5 L 0 50 M 20 -5 L 20 50 M 40 2 L 40 50" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.4" />
        
        {/* Brush Circle (Projected on terrain) */}
        <ellipse cx="10" cy="0" rx="30" ry="12" fill="rgba(16,185,129,0.2)" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
        <ellipse cx="10" cy="0" rx="15" ry="6" fill="rgba(16,185,129,0.3)" stroke="#10b981" strokeWidth="1" />
        
        {/* Upward Arrow (Raise Terrain) */}
        <path d="M 10 0 L 10 -30 M 0 -20 L 10 -35 L 20 -20" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -45)" filter="url(#brushBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="6" strokeDasharray="2 2" />
          <path d="M 10 12 L 10 4 M 7 7 L 10 3 L 13 7" />
        </g>
      </g>
    </g>
  </svg>
);

const AudioMixerWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="mixerFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="mixerShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="mixerBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#mixerShadow)">
        {/* Mixer Board */}
        <rect x="-60" y="-40" width="120" height="80" rx="4" fill="url(#mixerFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Channels */}
        {[-40, -15, 10, 35].map((x, i) => (
          <g key={'channel-'+i} transform={"translate(" + x + ", 0)"}>
            {/* EQ Knobs */}
            <circle cx="0" cy="-25" r="4" fill="#2d2d2d" stroke={i === 3 ? "#ef4444" : "#4b5563"} strokeWidth="1.5" />
            <circle cx="0" cy="-13" r="4" fill="#2d2d2d" stroke={i === 3 ? "#ef4444" : "#4b5563"} strokeWidth="1.5" />
            
            {/* Fader Track */}
            <rect x="-2" y="0" width="4" height="30" rx="2" fill="#111" />
            
            {/* Fader Cap */}
            <rect x="-6" y={i === 0 ? 5 : i === 1 ? 15 : i === 2 ? 0 : 20} width="12" height="6" rx="1" fill={i === 3 ? "#ef4444" : "#fff"} stroke="#999" strokeWidth="1" />
          </g>
        ))}
        
        {/* Master Level Meters */}
        <g transform="translate(65, -30)">
          {/* L */}
          <rect x="0" y="0" width="4" height="60" rx="2" fill="#111" />
          <rect x="0" y="20" width="4" height="40" rx="2" fill="#34d399" />
          <rect x="0" y="10" width="4" height="10" fill="#facc15" />
          
          {/* R */}
          <rect x="8" y="0" width="4" height="60" rx="2" fill="#111" />
          <rect x="8" y="25" width="4" height="35" rx="2" fill="#34d399" />
          <rect x="8" y="15" width="4" height="10" fill="#facc15" />
        </g>
      </g>

      {/* Badge */}
      <g transform="translate(35, -55)" filter="url(#mixerBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="2" width="4" height="16" rx="2" />
          <rect x="13" y="2" width="4" height="16" rx="2" />
          <line x1="1" y1="6" x2="9" y2="6" strokeWidth="2" stroke="#ef4444" />
          <line x1="11" y1="12" x2="19" y2="12" strokeWidth="2" stroke="#ef4444" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <TilemapWidget />
      <SpriteSheetWidget />
      <GizmoWidget />
      <LightProbeWidget />
      <TerrainBrushWidget />
      <AudioMixerWidget />`;

const appIndex = content.indexOf('export default function App() {');
if (appIndex !== -1) {
    let modified = content.slice(0, appIndex) + newComponents + '\n' + content.slice(appIndex);
    const renderIndex = modified.lastIndexOf('</div>');
    if (renderIndex !== -1) {
        modified = modified.slice(0, renderIndex) + renderComponents + '\n    ' + modified.slice(renderIndex);
        fs.writeFileSync('src/App.tsx', modified);
        console.log("6 More widgets added successfully.");
    } else {
        console.log("Could not find render area.");
    }
} else {
    console.log("Could not find App function.");
}
