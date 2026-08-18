import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const ParticleEmitterWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="partFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="partShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="partBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#partShadow)">
        {/* Emitter Base */}
        <polygon points="-15,40 15,40 10,20 -10,20" fill="url(#partFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <rect x="-10" y="15" width="20" height="5" rx="2" fill="#3b82f6" />
        
        {/* Particles */}
        {/* Sparkles / Orbs */}
        <circle cx="0" cy="5" r="4" fill="#fcd34d" opacity="0.9" />
        <circle cx="-15" cy="-5" r="3" fill="#f43f5e" opacity="0.8" />
        <circle cx="20" cy="-10" r="5" fill="#38bdf8" opacity="0.7" />
        <circle cx="-25" cy="-25" r="2" fill="#a855f7" opacity="0.9" />
        <circle cx="10" cy="-35" r="3" fill="#10b981" opacity="0.6" />
        <circle cx="-5" cy="-50" r="4" fill="#fcd34d" opacity="0.8" />
        <circle cx="30" cy="-45" r="2.5" fill="#f43f5e" opacity="0.9" />
        
        {/* Motion trails */}
        <path d="M 0 15 L 0 9 M -8 15 L -13 0 M 8 15 L 15 -2 M -2 15 L -20 -15 M 2 15 L 8 -25 M 5 15 L 25 -35" fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="2 2" opacity="0.3" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, 25)" filter="url(#partBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="2" />
          <path d="M 10 2 L 10 5 M 10 15 L 10 18 M 2 10 L 5 10 M 15 10 L 18 10 M 4.5 4.5 L 6.5 6.5 M 13.5 13.5 L 15.5 15.5 M 4.5 15.5 L 6.5 13.5 M 13.5 4.5 L 15.5 6.5" />
        </g>
      </g>
    </g>
  </svg>
);

const PhysicsRigidbodyWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="physFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="physShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="physBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#physShadow)">
        {/* Slope/Ground */}
        <polygon points="-60,10 -20,10 40,40 -60,40" fill="url(#physFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Falling/Bouncing Cube */}
        <g transform="translate(0, 0) rotate(15)">
          <rect x="-15" y="-15" width="30" height="30" rx="3" fill="#f43f5e" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
          <path d="M -15 -15 L 0 0 M 15 -15 L 0 0 M 15 15 L 0 0 M -15 15 L 0 0" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" />
        </g>
        
        {/* Gravity Vector */}
        <path d="M 0 0 L 0 25" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
        <polygon points="-3,20 3,20 0,27" fill="#10b981" />
        
        {/* Velocity/Bounce Vector */}
        <path d="M 0 0 L 25 -15" fill="none" stroke="#38bdf8" strokeWidth="2" />
        <polygon points="18,-14 22,-8 28,-17" fill="#38bdf8" />
        
        {/* Rotation indicator */}
        <path d="M -25 -15 A 20 20 0 0 1 -5 -35" fill="none" stroke="#fcd34d" strokeWidth="2" strokeDasharray="3 3" />
        <polygon points="-10,-37 -2,-34 -7,-28" fill="#fcd34d" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, -50)" filter="url(#physBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#f43f5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="10,2 18,7 18,17 10,22 2,17 2,7" />
          <path d="M 2 7 L 10 12 L 18 7 M 10 12 L 10 22" />
        </g>
      </g>
    </g>
  </svg>
);

const AnimationCurveWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="curveFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="curveShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="curveBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#curveShadow)">
        {/* Graph Area */}
        <rect x="-60" y="-45" width="120" height="90" rx="4" fill="url(#curveFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Grid lines */}
        <g stroke="#333" strokeWidth="1">
          <line x1="-60" y1="-15" x2="60" y2="-15" />
          <line x1="-60" y1="15" x2="60" y2="15" />
          <line x1="-20" y1="-45" x2="-20" y2="45" />
          <line x1="20" y1="-45" x2="20" y2="45" />
        </g>
        
        {/* The Curve */}
        <path d="M -50 25 C -20 25, -20 -25, 10 -25 S 40 10, 50 10" fill="none" stroke="#a855f7" strokeWidth="2.5" />
        
        {/* Keyframes */}
        <polygon points="-50,22 -47,25 -50,28 -53,25" fill="#fcd34d" stroke="#111" strokeWidth="1" />
        <polygon points="10,-28 13,-25 10,-22 7,-25" fill="#fcd34d" stroke="#111" strokeWidth="1" />
        <polygon points="50,7 53,10 50,13 47,10" fill="#fcd34d" stroke="#111" strokeWidth="1" />
        
        {/* Tangent Handles on Middle Keyframe */}
        <line x1="-10" y1="-25" x2="30" y2="-25" stroke="#fff" strokeWidth="1" opacity="0.6" />
        <circle cx="-10" cy="-25" r="2" fill="#fff" />
        <circle cx="30" cy="-25" r="2" fill="#fff" />
      </g>

      {/* Badge */}
      <g transform="translate(30, 25)" filter="url(#curveBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 16 C 8 16, 8 4, 14 4 S 18 12, 20 12" />
          <circle cx="2" cy="16" r="1" />
          <circle cx="14" cy="4" r="1" />
          <circle cx="20" cy="12" r="1" />
        </g>
      </g>
    </g>
  </svg>
);

const NavMeshWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="navFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="navShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="navBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#navShadow)">
        {/* Isometric base */}
        <polygon points="0,-40 60,-10 0,20 -60,-10" fill="url(#navFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <polygon points="-60,-10 0,20 0,35 -60,5" fill="#222" />
        <polygon points="60,-10 0,20 0,35 60,5" fill="#111" />
        
        {/* NavMesh Polygons (Blue tint over the surface) */}
        <g fill="rgba(56, 189, 248, 0.2)" stroke="#38bdf8" strokeWidth="1" strokeLinejoin="round">
          <polygon points="0,-35 40,-15 10,-5 -20,-25" />
          <polygon points="10,-5 40,-15 50,-5 20,10" />
          <polygon points="-20,-25 10,-5 -10,10 -40,-10" />
          <polygon points="-10,10 10,-5 20,10 0,25" />
        </g>
        
        {/* Hole/Obstacle (no navmesh) */}
        <polygon points="0,25 20,10 50,20 30,35" fill="none" stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        
        {/* Path line */}
        <path d="M -30 -15 L -5 0 L 25 -5 L 45 0" fill="none" stroke="#fcd34d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Start/End markers */}
        <circle cx="-30" cy="-15" r="3" fill="#10b981" />
        <circle cx="45" cy="0" r="3" fill="#f43f5e" />
      </g>

      {/* Badge */}
      <g transform="translate(25, -60)" filter="url(#navBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="10,2 18,6 10,10 2,6" />
          <polygon points="10,10 18,14 10,18 2,14" />
          <path d="M 2 10 L 10 14 L 18 10" />
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
        {/* Origin Emitter */}
        <circle cx="-40" cy="-40" r="8" fill="url(#rayFrontGrad)" stroke="#10b981" strokeWidth="2" />
        <circle cx="-40" cy="-40" r="3" fill="#10b981" />
        
        {/* Target Object (A hexagon or angled wall) */}
        <polygon points="20,10 50,-10 60,20 30,40" fill="url(#rayFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Ray */}
        <line x1="-35" y1="-35" x2="28" y2="15" stroke="#10b981" strokeWidth="2" strokeDasharray="6 3" />
        
        {/* Hit Point */}
        <circle cx="28" cy="15" r="4" fill="#ef4444" />
        <circle cx="28" cy="15" r="8" fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.6" />
        
        {/* Hit Normal */}
        <line x1="28" y1="15" x2="10" y2="35" stroke="#38bdf8" strokeWidth="2" />
        <polygon points="9,30 6,39 15,35" fill="#38bdf8" />
      </g>

      {/* Badge */}
      <g transform="translate(-50, 15)" filter="url(#rayBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="4" cy="4" r="2" />
          <line x1="6" y1="6" x2="16" y2="16" />
          <polyline points="12,16 16,16 16,12" />
        </g>
      </g>
    </g>
  </svg>
);

const ShaderNodeWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="nodeFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="nodeShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="nodeBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      {/* Background connections */}
      <path d="M -60 -20 C -40 -20, -40 -10, -20 -10" fill="none" stroke="#f43f5e" strokeWidth="2" />
      <path d="M -60 10 C -40 10, -40 5, -20 5" fill="none" stroke="#a855f7" strokeWidth="2" />
      <path d="M 20 -5 C 40 -5, 40 -25, 60 -25" fill="none" stroke="#10b981" strokeWidth="2" />

      <g filter="url(#nodeShadow)">
        {/* Node Window */}
        <rect x="-20" y="-35" width="40" height="60" rx="4" fill="url(#nodeFrontGrad)" stroke="#333" strokeWidth="1.5" />
        
        {/* Header */}
        <path d="M -20 -31 C -20 -33.2, -18.2 -35, -16 -35 L 16 -35 C 18.2 -35, 20 -33.2, 20 -31 L 20 -20 L -20 -20 Z" fill="#3b82f6" />
        <rect x="-12" y="-29" width="24" height="4" rx="2" fill="#fff" opacity="0.8" />
        
        {/* Input Pins */}
        <circle cx="-20" cy="-10" r="3" fill="#f43f5e" />
        <circle cx="-20" cy="5" r="3" fill="#a855f7" />
        <circle cx="-20" cy="15" r="3" fill="#fcd34d" />
        
        {/* Output Pins */}
        <circle cx="20" cy="-5" r="3" fill="#10b981" />
        
        {/* Inner lines (visual design) */}
        <rect x="-12" y="-12" width="10" height="3" rx="1.5" fill="#fff" opacity="0.4" />
        <rect x="-12" y="3" width="14" height="3" rx="1.5" fill="#fff" opacity="0.4" />
        <rect x="2" y="-6" width="10" height="3" rx="1.5" fill="#fff" opacity="0.4" />
      </g>

      {/* Badge */}
      <g transform="translate(30, 20)" filter="url(#nodeBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="12" height="12" rx="2" />
          <line x1="2" y1="8" x2="4" y2="8" />
          <line x1="2" y1="12" x2="4" y2="12" />
          <line x1="16" y1="10" x2="18" y2="10" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <ParticleEmitterWidget />
      <PhysicsRigidbodyWidget />
      <AnimationCurveWidget />
      <NavMeshWidget />
      <RaycastWidget />
      <ShaderNodeWidget />`;

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
