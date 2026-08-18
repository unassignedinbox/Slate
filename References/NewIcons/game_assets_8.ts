import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const NavMeshWidget = () => (
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

const AudioSourceWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="audioFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="audioShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="audioBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#audioShadow)">
        {/* Speaker Cone */}
        <path d="M -20 -15 L -20 15 L -5 15 L 15 35 L 15 -35 L -5 -15 Z" fill="url(#audioFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="-5" y1="-15" x2="-5" y2="15" stroke="#1f1f1f" strokeWidth="1.5" />
        
        {/* Sound Waves */}
        <path d="M 25 -10 A 15 15 0 0 1 25 10" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M 35 -20 A 30 30 0 0 1 35 20" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
        <path d="M 45 -30 A 45 45 0 0 1 45 30" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
      </g>

      {/* Badge */}
      <g transform="translate(-45, 15)" filter="url(#audioBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 8 L 4 12 L 8 12 L 14 16 L 14 4 L 8 8 Z" />
          <path d="M 16 7 A 4 4 0 0 1 16 13" />
        </g>
      </g>
    </g>
  </svg>
);

const IKRigWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="ikFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="ikShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="ikBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#ikShadow)">
        {/* Bones (Polygons) */}
        <polygon points="-30,-30 -15,0 -20,5 -40,-25" fill="url(#ikFrontGrad)" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" />
        <polygon points="-15,0 25,10 20,15 -20,5" fill="url(#ikFrontGrad)" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" />
        <polygon points="25,10 45,-5 40,-10 20,15" fill="url(#ikFrontGrad)" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" />
        
        {/* Joints */}
        <circle cx="-30" cy="-30" r="5" fill="#fcd34d" stroke="#333" strokeWidth="1" />
        <circle cx="-15" cy="0" r="5" fill="#fcd34d" stroke="#333" strokeWidth="1" />
        <circle cx="25" cy="10" r="5" fill="#fcd34d" stroke="#333" strokeWidth="1" />
        
        {/* IK Target Handle */}
        <circle cx="45" cy="-5" r="6" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
        <path d="M 45 -15 L 45 -25 M 45 5 L 45 15 M 35 -5 L 25 -5 M 55 -5 L 65 -5" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        
        {/* Pole Vector Target */}
        <line x1="-15" y1="0" x2="-25" y2="35" stroke="#10b981" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx="-25" cy="35" r="4" fill="#10b981" />
      </g>

      {/* Badge */}
      <g transform="translate(-50, 10)" filter="url(#ikBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="4" x2="10" y2="16" />
          <line x1="10" y1="16" x2="16" y2="8" />
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
          <circle cx="16" cy="8" r="1.5" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <NavMeshWidget />
      <RaycastWidget />
      <AudioSourceWidget />
      <IKRigWidget />`;

const appIndex = content.indexOf('export default function App() {');
if (appIndex !== -1) {
    let modified = content.slice(0, appIndex) + newComponents + '\n' + content.slice(appIndex);
    const renderIndex = modified.lastIndexOf('</div>');
    if (renderIndex !== -1) {
        modified = modified.slice(0, renderIndex) + renderComponents + '\n    ' + modified.slice(renderIndex);
        fs.writeFileSync('src/App.tsx', modified);
        console.log("4 More widgets added successfully.");
    } else {
        console.log("Could not find render area.");
    }
} else {
    console.log("Could not find App function.");
}
