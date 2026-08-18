import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

const newComponents = `const FluidSimWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="fluidFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="fluidShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="fluidBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#fluidShadow)">
        {/* Simulation Bounds */}
        <rect x="-55" y="-55" width="110" height="110" rx="4" fill="url(#fluidFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Swirling Flow Lines (Cyan & Blue) */}
        <path d="M -55 -20 C -20 -20, -10 -40, 15 -40 S 40 -10, 55 -20" fill="none" stroke="#0ea5e9" strokeWidth="2" opacity="0.6" />
        <path d="M -55 0 C -10 20, -10 -20, 20 0 S 40 30, 55 10" fill="none" stroke="#38bdf8" strokeWidth="3" opacity="0.8" />
        <path d="M -55 30 C -20 10, 0 40, 30 20 S 50 40, 55 40" fill="none" stroke="#22d3ee" strokeWidth="2" opacity="0.5" />
        
        {/* Velocity Vectors (Arrows) */}
        <g stroke="#fff" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.6">
          {/* Top vortex */}
          <path d="M -30 -30 L -20 -35 M -23 -38 L -20 -35 L -17 -32" />
          <path d="M 0 -35 L 10 -30 M 7 -33 L 10 -30 L 7 -27" />
          {/* Middle flow */}
          <path d="M -40 5 L -30 15 M -33 16 L -30 15 L -29 12" />
          <path d="M -5 -5 L 10 -5 M 7 -8 L 10 -5 L 7 -2" />
          <path d="M 30 -5 L 45 5 M 41 5 L 45 5 L 43 2" />
          {/* Bottom eddy */}
          <path d="M -20 35 L -10 25 M -13 25 L -10 25 L -10 28" />
          <path d="M 20 30 L 30 30 M 27 27 L 30 30 L 27 33" />
        </g>
        
        {/* Particles / Densities */}
        <circle cx="-10" cy="-5" r="8" fill="#0284c7" opacity="0.5" filter="blur(4px)" />
        <circle cx="30" cy="5" r="12" fill="#0ea5e9" opacity="0.4" filter="blur(6px)" />
        <circle cx="-25" cy="25" r="10" fill="#38bdf8" opacity="0.4" filter="blur(5px)" />
      </g>
      
      {/* Badge */}
      <g transform="translate(30, -55)" filter="url(#fluidBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 4 12 C 4 16.4, 7.6 20, 12 20 C 16.4 20, 20 16.4, 20 12 C 20 7.6, 12 0, 12 0 C 12 0, 4 7.6, 4 12 Z" transform="scale(0.8) translate(2, -2)" />
        </g>
      </g>
    </g>
  </svg>
);

const WaterSurfaceWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="waterFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="waterShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="waterBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#waterShadow)">
        {/* Isometric Water Plane Base */}
        <polygon points="0,-40 60,0 0,40 -60,0" fill="#0369a1" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <polygon points="-60,0 0,40 0,55 -60,15" fill="#0c4a6e" />
        <polygon points="60,0 0,40 0,55 60,15" fill="#075985" />
        
        {/* Caustics / Waves Grid */}
        <g stroke="#38bdf8" strokeWidth="1.5" opacity="0.6">
          <path d="M -45,-10 Q -30,0 -15,-10 T 15,-10 T 45,-10" fill="none" />
          <path d="M -30,0 Q -15,10 0,0 T 30,0" fill="none" />
          <path d="M -15,10 Q 0,20 15,10" fill="none" />
        </g>

        {/* Droplet Impact / Ripples */}
        <ellipse cx="0" cy="10" rx="20" ry="8" fill="none" stroke="#bae6fd" strokeWidth="2" opacity="0.8" />
        <ellipse cx="0" cy="10" rx="35" ry="14" fill="none" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.5" />
        <ellipse cx="0" cy="10" rx="50" ry="20" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
        
        {/* Splash Droplets */}
        <circle cx="-5" cy="-5" r="2" fill="#e0f2fe" />
        <circle cx="8" cy="2" r="1.5" fill="#bae6fd" />
        <circle cx="2" cy="-12" r="2.5" fill="#e0f2fe" />
      </g>
      
      {/* Badge */}
      <g transform="translate(-45, -55)" filter="url(#waterBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 12 Q 6 6 10 12 T 18 12" />
          <path d="M 2 18 Q 6 12 10 18 T 18 18" opacity="0.5" />
        </g>
      </g>
    </g>
  </svg>
);

const ClothSimWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="clothFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="clothShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="clothBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#clothShadow)">
        {/* Background Support / Anchor bar */}
        <line x1="-50" y1="-40" x2="50" y2="-40" stroke="#333" strokeWidth="4" strokeLinecap="round" />
        
        {/* The Cloth Mesh (Draped) */}
        <path d="M -40 -40 Q -25 -10, -30 20 Q -35 40, -10 50 Q 15 40, 20 20 Q 30 -5, 40 -40 Z" fill="url(#clothFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinejoin="round" />
        
        {/* Horizontal grid curves (folds) */}
        <path d="M -36 -20 Q -10 -5, 36 -20" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />
        <path d="M -33 0 Q -5 20, 30 0" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.6" />
        <path d="M -28 25 Q -5 45, 23 20" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />
        
        {/* Vertical grid curves (folds) */}
        <path d="M -20 -40 Q -10 10, -15 45" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />
        <path d="M 0 -40 Q 10 10, -5 48" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.6" />
        <path d="M 20 -40 Q 25 5, 10 38" fill="none" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />

        {/* Pin Points (Red) */}
        <circle cx="-40" cy="-40" r="4" fill="#ef4444" />
        <circle cx="0" cy="-40" r="4" fill="#ef4444" />
        <circle cx="40" cy="-40" r="4" fill="#ef4444" />
        
        {/* Highlight fold */}
        <path d="M -15 45 Q -5 48, 10 38" fill="none" stroke="#fff" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
      </g>
      
      {/* Badge */}
      <g transform="translate(30, 20)" filter="url(#clothBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 2 Q 10 8, 18 2 L 15 18 Q 10 14, 5 18 Z" />
          <line x1="10" y1="5" x2="10" y2="15" opacity="0.5" />
        </g>
      </g>
    </g>
  </svg>
);

const HeightmapTerrainWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="heightFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="heightShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="heightBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#heightShadow)">
        {/* Base plane */}
        <polygon points="-55,30 -20,45 55,30 20,15" fill="url(#heightFrontGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <polygon points="-55,30 -20,45 -20,55 -55,40" fill="#222" />
        <polygon points="55,30 -20,45 -20,55 55,40" fill="#111" />
        
        {/* Contour layers */}
        {/* Level 1 (Base - Greenish) */}
        <path d="M -45 25 Q -15 40, 15 35 T 45 25 L 15 15 Z" fill="#10b981" opacity="0.6" />
        
        {/* Level 2 (Mid - Yellowish) */}
        <path d="M -35 15 Q -10 30, 10 20 T 35 10 L 5 5 Z" fill="#facc15" opacity="0.7" />
        
        {/* Level 3 (High - Orange) */}
        <path d="M -20 5 Q 0 15, 10 5 T 20 -5 L -5 -10 Z" fill="#f97316" opacity="0.8" />
        
        {/* Level 4 (Peak - White/Red) */}
        <path d="M -10 -5 Q 0 5, 5 -5 T 10 -15 L -5 -15 Z" fill="#f43f5e" opacity="0.9" />
        <polygon points="-5,-12 0,-5 5,-12 0,-18" fill="#fff" />
        
        {/* Secondary Peak */}
        <path d="M 25 20 Q 30 25, 35 20 T 40 15 L 30 10 Z" fill="#f97316" opacity="0.8" />
        <polygon points="30,12 35,18 40,12 35,8" fill="#fff" opacity="0.9" />

        {/* Vertical probe lines */}
        <line x1="0" y1="-10" x2="0" y2="45" stroke="#fff" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        <circle cx="0" cy="-10" r="2" fill="#fff" />
        <circle cx="0" cy="45" r="2" fill="#fff" />
        
        <line x1="35" y1="12" x2="35" y2="35" stroke="#fff" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        <circle cx="35" cy="12" r="2" fill="#fff" />
        <circle cx="35" cy="35" r="2" fill="#fff" />
      </g>
      
      {/* Badge */}
      <g transform="translate(-45, -50)" filter="url(#heightBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 2 16 L 8 6 L 12 12 L 18 4" />
          <path d="M 5 11 L 8 6 L 11 11" stroke="#fff" strokeWidth="2" />
        </g>
      </g>
    </g>
  </svg>
);

const TexturePaintWidget = () => (
  <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl hover:scale-105 transition-transform duration-500 ease-out">
    <defs>
      <linearGradient id="paintFrontGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#363636" stopOpacity="1" />
        <stop offset="100%" stopColor="#1f1f1f" stopOpacity="1" />
      </linearGradient>
      <filter id="paintShadow">
        <feDropShadow dx="0" dy="12" stdDeviation="15" floodColor="#000" floodOpacity="0.4" />
      </filter>
      <filter id="paintBadgeShadow">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
      </filter>
    </defs>
    <g transform="translate(120, 120)">
      <g filter="url(#paintShadow)">
        {/* Canvas Base */}
        <rect x="-50" y="-50" width="100" height="100" rx="4" fill="#e5e5e5" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        
        {/* Paint Splats */}
        {/* Pink Splat */}
        <path d="M -20 -20 Q -30 -30, -10 -40 Q 0 -20, 10 -30 Q 20 -10, 0 0 Q -20 10, -20 -20 Z" fill="#ec4899" />
        <circle cx="-30" cy="-30" r="4" fill="#ec4899" />
        <circle cx="5" cy="-42" r="3" fill="#ec4899" />
        
        {/* Cyan Splat */}
        <path d="M 10 10 Q 30 -10, 40 10 Q 30 30, 20 25 Q 5 40, 0 20 Q -10 10, 10 10 Z" fill="#06b6d4" />
        <circle cx="35" cy="30" r="5" fill="#06b6d4" />
        <circle cx="-5" cy="35" r="2.5" fill="#06b6d4" />

        {/* Yellow Stroke */}
        <path d="M -35 25 Q -20 40, 10 5" fill="none" stroke="#eab308" strokeWidth="8" strokeLinecap="round" />
        
        {/* Overlay Grid lines (UV indication) */}
        <g stroke="#fff" strokeWidth="1" opacity="0.3">
          <line x1="-50" y1="0" x2="50" y2="0" />
          <line x1="0" y1="-50" x2="0" y2="50" />
        </g>
        
        {/* Stylus / Paintbrush */}
        <g transform="translate(10, 5) rotate(-45)">
          <path d="M 0 0 L -10 30 L 10 30 Z" fill="#4b5563" /> {/* Brush tip */}
          <path d="M -5 30 L 5 30 L 0 45 Z" fill="#06b6d4" /> {/* Paint on tip */}
          <rect x="-10" y="-40" width="20" height="40" rx="2" fill="#1f2937" stroke="#374151" strokeWidth="1" /> {/* Handle */}
          <rect x="-10" y="-35" width="20" height="5" fill="#fbbf24" /> {/* Band */}
        </g>
      </g>
      
      {/* Badge */}
      <g transform="translate(35, -45)" filter="url(#paintBadgeShadow)">
        <rect width="40" height="40" rx="12" fill="#262626" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
        <g transform="translate(10, 10)" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 16 4 Q 20 8, 16 12 Q 10 18, 4 16 Q 2 10, 8 4 Q 12 0, 16 4 Z" />
          <circle cx="8" cy="8" r="1.5" fill="#ec4899" />
          <circle cx="14" cy="8" r="1.5" fill="#ec4899" />
          <circle cx="10" cy="14" r="1.5" fill="#ec4899" />
        </g>
      </g>
    </g>
  </svg>
);
`

const renderComponents = `      <FluidSimWidget />
      <WaterSurfaceWidget />
      <ClothSimWidget />
      <HeightmapTerrainWidget />
      <TexturePaintWidget />`;

const appIndex = content.indexOf('export default function App() {');
if (appIndex !== -1) {
    let modified = content.slice(0, appIndex) + newComponents + '\n' + content.slice(appIndex);
    const renderIndex = modified.lastIndexOf('</div>');
    if (renderIndex !== -1) {
        modified = modified.slice(0, renderIndex) + renderComponents + '\n    ' + modified.slice(renderIndex);
        fs.writeFileSync('src/App.tsx', modified);
        console.log("5 More widgets added successfully.");
    } else {
        console.log("Could not find render area.");
    }
} else {
    console.log("Could not find App function.");
}
