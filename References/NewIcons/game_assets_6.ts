import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const CameraFrustumWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="camFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="camShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="camBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <linearGradient id="camFrustum" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
      </linearGradient>
    </defs>
    <g transform="translate(120, 120)">
      {/* Frustum Area */}
      <polygon points="10,-10 10,10 60,40 60,-40" fill="url(#camFrustum)" style={{ mixBlendMode: 'screen' }} />
      <path d="M 10 -10 L 60 -40 M 10 10 L 60 40 M 10 -10 L 10 10 M 60 -40 L 60 40" fill="none" stroke="#38bdf8" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
      <rect x="50" y="-30" width="10" height="60" fill="none" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
      
      <g filter="url(#camShadow)">
        {/* Camera Body */}
        <rect x="-40" y="-20" width="40" height="30" rx="4" fill="url(#camFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <path d="M -40 -20 L 0 -20 L 0 -10 L -40 -10 Z" fill="#2d2d2d" />
        
        {/* Film Reels */}
        <circle cx="-25" cy="-25" r="12" fill="#111" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="-25" cy="-25" r="4" fill="#333" />
        <circle cx="5" cy="-25" r="12" fill="#111" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <circle cx="5" cy="-25" r="4" fill="#333" />
        
        {/* Lens */}
        <path d="M 0 -10 L 15 -15 L 15 15 L 0 10 Z" fill="#222" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinejoin="round" />
        <ellipse cx="15" cy="0" rx="4" ry="15" fill="#38bdf8" opacity="0.8" />
        <ellipse cx="13" cy="0" rx="2" ry="12" fill="#fff" opacity="0.5" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, 25)" filter="url(#camBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="10" height="10" rx="2" />
          <polygon points="12,8 18,5 18,15 12,12" />
        </g>
      </g>
    </g>
  </svg>
);

const BehaviorTreeWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="btFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="btShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="btBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      {/* Connections */}
      <path d="M 0 -35 L 0 -15 M 0 -15 L -35 5 M 0 -15 L 35 5" fill="none" stroke="#9ca3af" strokeWidth="2" />
      
      <g filter="url(#btShadow)">
        {/* Root Node (Selector / ? ) */}
        <rect x="-20" y="-55" width="40" height="20" rx="4" fill="url(#btFrontGrad)" stroke="#3b82f6" strokeWidth="1.5" />
        <text x="0" y="-41" fill="#3b82f6" fontSize="12" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">?</text>
        
        {/* Sequence Node ( -> ) */}
        <rect x="-55" y="5" width="40" height="20" rx="4" fill="url(#btFrontGrad)" stroke="#10b981" strokeWidth="1.5" />
        <text x="-35" y="19" fill="#10b981" fontSize="12" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">→</text>
        
        {/* Action Node ( Leaf ) */}
        <rect x="15" y="5" width="40" height="20" rx="4" fill="url(#btFrontGrad)" stroke="#f43f5e" strokeWidth="1.5" />
        <rect x="25" y="13" width="20" height="4" rx="1" fill="#f43f5e" />
        
        {/* Active Highlight on Action */}
        <rect x="13" y="3" width="44" height="24" rx="6" fill="none" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 2" opacity="0.6" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -55)" filter="url(#btBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2" width="6" height="4" />
          <rect x="2" y="12" width="6" height="4" />
          <rect x="12" y="12" width="6" height="4" />
          <path d="M 10 6 L 10 9 M 10 9 L 5 12 M 10 9 L 15 12" />
        </g>
      </g>
    </g>
  </svg>
);

const UVEditorWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="uvFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="uvShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="uvBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#1f1f1f" />
        <rect x="8" width="8" height="8" fill="#2d2d2d" />
        <rect y="8" width="8" height="8" fill="#2d2d2d" />
        <rect x="8" y="8" width="8" height="8" fill="#1f1f1f" />
      </pattern>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#uvShadow)">
        {/* Editor Window */}
        <rect x="-55" y="-55" width="110" height="110" rx="6" fill="url(#uvFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <rect x="-45" y="-45" width="90" height="90" fill="url(#checker)" stroke="#444" strokeWidth="1" />
        
        {/* UV Shell */}
        <g stroke="#a855f7" strokeWidth="1.5" fill="rgba(168, 85, 247, 0.2)" strokeLinejoin="round">
          <polygon points="-25,-25 15,-25 25,15 -15,25" />
          <polygon points="15,-25 35,-5 25,15" />
          <polygon points="-25,-25 -35,-5 -15,25" />
        </g>
        
        {/* Vertices */}
        <circle cx="-25" cy="-25" r="2.5" fill="#a855f7" />
        <circle cx="15" cy="-25" r="2.5" fill="#a855f7" />
        <circle cx="25" cy="15" r="2.5" fill="#a855f7" />
        <circle cx="-15" cy="25" r="2.5" fill="#a855f7" />
        <circle cx="35" cy="-5" r="2.5" fill="#a855f7" />
        <circle cx="-35" cy="-5" r="2.5" fill="#a855f7" />
        
        {/* Selected Vertex/Edge */}
        <line x1="-15" y1="25" x2="25" y2="15" stroke="#fcd34d" strokeWidth="2" />
        <circle cx="5" cy="20" r="3" fill="#fcd34d" />
      </g>

      {/* Badge */}
      <g transform="translate(30, 30)" filter="url(#uvBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M 3 10 L 17 10 M 10 3 L 10 17" opacity="0.5" />
          <circle cx="10" cy="10" r="2" fill="#a855f7" />
        </g>
      </g>
    </g>
  </svg>
);

const GamepadInputWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="padFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="padShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="padBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#padShadow)">
        {/* Gamepad Body */}
        <path d="M -50 -10 C -50 -30, -30 -30, -15 -20 C 0 -25, 15 -20, 30 -30 C 50 -30, 50 -10, 50 10 C 50 40, 30 40, 20 20 C 10 30, -10 30, -20 20 C -30 40, -50 40, -50 10 Z" fill="url(#padFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* D-Pad */}
        <path d="M -35 -5 L -25 -5 L -25 -15 L -15 -15 L -15 -5 L -5 -5 L -5 5 L -15 5 L -15 15 L -25 15 L -25 5 L -35 5 Z" fill="#2d2d2d" stroke="#111" strokeWidth="1" />
        
        {/* Action Buttons */}
        <circle cx="25" cy="-15" r="4" fill="#3b82f6" /> {/* X */}
        <circle cx="35" cy="-5" r="4" fill="#ef4444" /> {/* B */}
        <circle cx="15" cy="-5" r="4" fill="#8b5cf6" /> {/* Y */}
        <circle cx="25" cy="5" r="4" fill="#10b981" /> {/* A */}
        
        {/* Analog Sticks */}
        <circle cx="-15" cy="15" r="10" fill="#111" />
        <circle cx="-15" cy="15" r="7" fill="#2d2d2d" />
        
        <circle cx="5" cy="15" r="10" fill="#111" />
        <circle cx="5" cy="15" r="7" fill="#2d2d2d" />
        
        {/* Center Buttons */}
        <rect x="-5" y="-10" width="10" height="4" rx="2" fill="#555" />
      </g>

      {/* Input Mapping Lines */}
      <path d="M 25 5 L 45 35" fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="3 3" />
      <rect x="40" y="35" width="25" height="12" rx="2" fill="#10b981" />
      <text x="52" y="44" fill="#fff" fontSize="8" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">JUMP</text>

      {/* Badge */}
      <g transform="translate(-45, -50)" filter="url(#padBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="16" height="10" rx="4" />
          <circle cx="6" cy="10" r="1.5" fill="#f43f5e" />
          <circle cx="14" cy="10" r="1.5" fill="#f43f5e" />
        </g>
      </g>
    </g>
  </svg>
);

const PostProcessingWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="postFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="postShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="postBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
      {/* Bloom Effect */}
      <filter id="bloom">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#postShadow)">
        {/* Screen/Viewport */}
        <rect x="-60" y="-40" width="120" height="80" rx="4" fill="url(#postFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Left Side (Raw) */}
        <g clipPath="url(#leftClip)">
          <clipPath id="leftClip"><rect x="-60" y="-40" width="60" height="80" /></clipPath>
          <circle cx="-15" cy="-5" r="15" fill="#a1a1aa" />
          <polygon points="-40,25 -20,-5 0,25" fill="#71717a" />
        </g>
        
        {/* Right Side (Post-Processed: Bloom + Color Grade) */}
        <g clipPath="url(#rightClip)">
          <clipPath id="rightClip"><rect x="0" y="-40" width="60" height="80" /></clipPath>
          <rect x="0" y="-40" width="60" height="80" fill="#0f172a" opacity="0.5" /> {/* Color tint */}
          <circle cx="15" cy="-5" r="15" fill="#38bdf8" filter="url(#bloom)" />
          <polygon points="0,25 20,-5 40,25" fill="#818cf8" filter="url(#bloom)" />
        </g>
        
        {/* Split Line */}
        <line x1="0" y1="-40" x2="0" y2="40" stroke="#fff" strokeWidth="2" />
        <circle cx="0" cy="0" r="4" fill="#fff" />
        <path d="M -3 -3 L -6 0 L -3 3 M 3 -3 L 6 0 L 3 3" fill="none" stroke="#111" strokeWidth="1" />
      </g>

      {/* Badge */}
      <g transform="translate(35, 20)" filter="url(#postBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 16 L 16 4" />
          <circle cx="6" cy="6" r="2" fill="#38bdf8" />
          <circle cx="14" cy="14" r="2" />
        </g>
      </g>
    </g>
  </svg>
);

const SplinePathWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="splineFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="splineShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="splineBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#splineShadow)">
        {/* Background Grid */}
        <rect x="-60" y="-45" width="120" height="90" rx="4" fill="url(#splineFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g stroke="#333" strokeWidth="1" opacity="0.5">
          <line x1="-40" y1="-45" x2="-40" y2="45" />
          <line x1="-20" y1="-45" x2="-20" y2="45" />
          <line x1="0" y1="-45" x2="0" y2="45" />
          <line x1="20" y1="-45" x2="20" y2="45" />
          <line x1="40" y1="-45" x2="40" y2="45" />
          <line x1="-60" y1="-25" x2="60" y2="-25" />
          <line x1="-60" y1="-5" x2="60" y2="-5" />
          <line x1="-60" y1="15" x2="60" y2="15" />
          <line x1="-60" y1="35" x2="60" y2="35" />
        </g>
        
        {/* Tangent Handles */}
        <line x1="-30" y1="10" x2="-50" y2="-20" stroke="#fcd34d" strokeWidth="1.5" opacity="0.6" />
        <line x1="0" y1="-20" x2="-20" y2="15" stroke="#fcd34d" strokeWidth="1.5" opacity="0.6" />
        <line x1="0" y1="-20" x2="20" y2="-55" stroke="#fcd34d" strokeWidth="1.5" opacity="0.6" />
        <line x1="40" y1="20" x2="25" y2="5" stroke="#fcd34d" strokeWidth="1.5" opacity="0.6" />
        
        {/* Tangent Points */}
        <circle cx="-50" cy="-20" r="2.5" fill="#fcd34d" />
        <circle cx="-20" cy="15" r="2.5" fill="#fcd34d" />
        <circle cx="20" cy="-55" r="2.5" fill="#fcd34d" />
        <circle cx="25" cy="5" r="2.5" fill="#fcd34d" />
        
        {/* The Spline Curve */}
        <path d="M -30 10 C -50 -20, -20 15, 0 -20 S 25 5, 40 20" fill="none" stroke="#22c55e" strokeWidth="3" />
        
        {/* Control Points */}
        <circle cx="-30" cy="10" r="4" fill="#fff" stroke="#22c55e" strokeWidth="2" />
        <circle cx="0" cy="-20" r="4" fill="#fff" stroke="#22c55e" strokeWidth="2" />
        <circle cx="40" cy="20" r="4" fill="#fff" stroke="#22c55e" strokeWidth="2" />
      </g>

      {/* Badge */}
      <g transform="translate(30, -60)" filter="url(#splineBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 16 C 4 8, 16 12, 16 4" />
          <circle cx="4" cy="16" r="1.5" fill="#22c55e" />
          <circle cx="16" cy="4" r="1.5" fill="#22c55e" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <CameraFrustumWidget />
      <BehaviorTreeWidget />
      <UVEditorWidget />
      <GamepadInputWidget />
      <PostProcessingWidget />
      <SplinePathWidget />`;

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
