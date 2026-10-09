// Mini SVG diagrams for inspector cards (Frontier-style illustrative graphics).
import { valueNoise, smoothstep } from './noise.js';

export function contourDiagram(altitude = 300, roughness = 50, erosion = 30) {
  const rings = Array.from({ length: 12 }, (_, i) => {
    const points = Array.from({ length: 97 }, (_, j) => {
      const a = (j / 96) * Math.PI * 2;
      const r = (14 + i * 9) * Math.sqrt(Math.max(0.05, altitude / 500));
      const detail = (roughness / 100) * (1 - erosion / 180);
      const irregular = 1 + detail * (0.2 * Math.sin(a * 3 + i * 0.15) + 0.1 * Math.cos(a * 7));
      return `${310 + Math.cos(a) * r * 1.85 * irregular},${118 + Math.sin(a) * r * 0.76 * irregular}`;
    });
    return points.join(' ');
  });
  return `<div class="contour-diagram"><svg viewBox="0 0 620 238" role="img" aria-label="Terrain elevation contour diagram">
    <path d="M20 118 H600 M310 10 V225" stroke="#ffffff0c" strokeDasharray="3 5"/>
    ${rings.map((points, i) => `<polygon points="${points}" fill="${i === 0 ? '#d0ba9322' : 'none'}" stroke="${i % 3 === 0 ? '#c3af8a' : '#7e7360'}" strokeOpacity="${0.85 - i * 0.035}" stroke-width="${i % 3 === 0 ? 1 : 0.6}"/>`).join('')}
    <path d="M305 118 H315 M310 113 V123" stroke="#e3c79b"/>
    <text x="325" y="113" font-size="10" fill="#d3bea0">${Math.round(altitude)} m</text>
    <text x="22" y="218" font-size="9" fill="#858078">CONTOUR INTERVAL</text><text x="132" y="218" font-size="9" fill="#c3b498">${Math.max(1, Math.round(altitude / 12))} m</text>
  </svg></div>`;
}

export function erosionChannels(erosion = 40) {
  return `<svg class="erosion-channels" viewBox="0 0 400 125" role="img" aria-label="Erosion drainage channels">
    <path d="M185 6 C165 38 240 65 202 120" fill="none" stroke="#aa9a7b" stroke-width="${1 + erosion / 20}"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<path d="M${n % 2 ? 300 + n * 9 : 65 + n * 7} ${n * 11 + 3} Q${n % 2 ? 245 : 130} ${n * 12 + 4} ${190 + Math.sin(n) * 12} ${n * 12 + 22}" fill="none" stroke="#a99a80" stroke-width="${0.4 + erosion / 75}" opacity="${0.2 + erosion / 140}"/>`).join('')}
  </svg>`;
}

export function roughnessProfile(roughness = 50) {
  const points = Array.from({ length: 100 }, (_, i) =>
    `${i * 4},${65 - (Math.sin(i * 0.17) * 0.4 + Math.sin(i * 0.72) * 0.24 + Math.sin(i * 1.7) * 0.1) * roughness * 0.65}`).join(' ');
  return `<svg class="roughness-profile" viewBox="0 0 400 125" role="img" aria-label="Surface roughness profile">
    <path d="M0 65 H400" stroke="#ffffff13" strokeDasharray="3 4"/>
    <polygon points="0,120 ${points} 400,120" fill="#bfac9109"/>
    <polyline points="${points}" stroke="#bca887" stroke-width="1.3" fill="none"/>
  </svg>`;
}

export function duneProfile(angle = 42, amount = 50) {
  const pts = Array.from({ length: 81 }, (_, i) => {
    const t = i / 80;
    const y = 70 - (Math.abs(Math.sin(t * Math.PI * 4)) ** 1.4) * amount * 0.6 - Math.sin(t * 17 + angle) * 2;
    return `${i * 5},${y}`;
  }).join(' ');
  return `<svg class="roughness-profile" viewBox="0 0 400 125" role="img" aria-label="Dune train profile">
    <polyline points="${pts}" fill="none" stroke="#cbb287" stroke-width="1.4"/>
    <polygon points="0,125 ${pts} 400,125" fill="#cbb28715"/>
  </svg>`;
}

export function talusDiagram(talus = 0.6, rate = 0.4) {
  const angle = 18 + talus * 32;
  return `<svg class="mask-diagram" viewBox="0 0 400 125" role="img" aria-label="Talus repose diagram">
    <path d="M20 105 L140 30 L280 105 Z" fill="#8d7a6414" stroke="#8d7a64" stroke-width="1.2"/>
    <path d="M140 30 L210 62 L280 105" stroke="#c2a184" stroke-width="1" strokeDasharray="3 3" fill="none"/>
    ${[0, 1, 2, 3].map((i) => `<circle cx="${175 + i * 22}" cy="${48 + i * 15}" r="${2.5 + rate * 3}" fill="#c2a184" opacity=".6"/>`).join('')}
    <path d="M20 105 H380" stroke="#5c5347"/>
    <text x="24" y="120" font-size="9" fill="#858078">REPOSE</text>
    <text x="76" y="120" font-size="9" fill="#c3b498">${Math.round(angle * 1.4)}°</text>
  </svg>`;
}

export function windDiagram(strength = 50, direction = 38) {
  const lines = Array.from({ length: 5 }, (_, i) => {
    const y = 18 + i * 22;
    return `<path d="M${20 + i * 8} ${y} Q160 ${y - 12 - strength * 0.18} 280 ${y} T390 ${y + 6}" stroke="#72c8b3" stroke-width="1.1" opacity="${0.25 + (strength / 100) * 0.5}" fill="none"/>`;
  }).join('');
  return `<svg class="wind-lines" viewBox="0 0 400 125" role="img" aria-label="Wind flow lines">
    ${lines}
    <g transform="rotate(${direction - 90} 200 62)">
      <path d="M200 24 L212 52 L200 46 L188 52 Z" fill="#72c8b3aa"/>
    </g>
  </svg>`;
}

export function riverDiagram(power = 1.3, depth = 35) {
  return `<svg class="erosion-channels" viewBox="0 0 400 125" role="img" aria-label="River network">
    <path d="M60 8 C120 40 150 48 200 62 C250 76 290 92 350 116" stroke="#82abc9" fill="none" stroke-width="${1 + depth / 18}"/>
    <path d="M120 6 C150 30 170 44 200 62" stroke="#82abc9" fill="none" stroke-width="${0.6 + depth / 30}" opacity=".7"/>
    <path d="M260 10 C250 38 230 50 200 62" stroke="#82abc9" fill="none" stroke-width="${0.6 + depth / 30}" opacity=".7"/>
    <path d="M320 20 C290 50 260 62 200 62" stroke="#82abc9" fill="none" stroke-width="${0.5 + depth / 36}" opacity=".55"/>
    ${Array.from({ length: 26 }, (_, i) => `<circle cx="${40 + i * 13}" cy="${18 + ((i * 37) % 90)}" r="${1 + power}" fill="#82abc9" opacity="${0.08 + power * 0.05}"/>`).join('')}
  </svg>`;
}

/** Mask preview diagram — one per mask kind. */
export function maskDiagram(type, params = {}) {
  const w = 400, h = 110;
  let body = '';
  switch (type) {
    case 'coastal': {
      const sea = (params.seaLevel ?? 0.3) * 100;
      body = `
        <rect x="0" y="${h - sea}" width="${w}" height="${sea}" fill="#2c4c5c55"/>
        <path d="M0 ${h - sea} C60 ${h - sea - 14} 120 ${h - sea + 10} 190 ${h - sea - 6} S320 ${h - sea + 12} 400 ${h - sea - 4}" stroke="#74bdd4" fill="none" stroke-width="1.3"/>
        <rect x="0" y="0" width="${w}" height="${h}" fill="url(#coast-grad)"/>`;
      return wrapMask(body, `<defs><linearGradient id="coast-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d6a078" stop-opacity="0.5"/><stop offset="${1 - (params.seaLevel ?? 0.3) - (params.falloff ?? 0.2) * 0.4}" stop-color="#d6a078" stop-opacity="0.18"/>
        <stop offset="${1 - (params.seaLevel ?? 0.3)}" stop-color="#d6a078" stop-opacity="0"/><stop offset="1" stop-color="#d6a078" stop-opacity="0"/></linearGradient></defs>`,
        `COASTAL FALLOFF · ${Math.round((params.seaLevel ?? 0.3) * 100)}% SEA LEVEL`);
    }
    case 'mountain': {
      const start = params.start ?? 0.38;
      body = `
        <path d="M0 100 L90 46 L160 84 L240 30 L320 76 L400 52 L400 110 L0 110 Z" fill="#8d7a6422" stroke="#8d7a64"/>
        <rect x="0" y="0" width="400" height="${(1 - start) * h}" fill="url(#mt-grad)"/>`;
      return wrapMask(body, `<defs><linearGradient id="mt-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d6a078" stop-opacity="0.55"/><stop offset="1" stop-color="#d6a078" stop-opacity="0"/></linearGradient></defs>`,
        `MOUNTAIN FALLOFF · STARTS AT ${Math.round(start * 100)}%`);
    }
    case 'altitude': {
      const lo = (params.lo ?? 0.25) * h, hi = (params.hi ?? 0.75) * h;
      body = `<rect x="0" y="${h - hi}" width="400" height="${hi - lo}" fill="#d6a07833" stroke="#d6a07866"/>`;
      return wrapMask(body, '', `ALTITUDE BAND · ${Math.round((params.lo ?? 0.25) * 100)}–${Math.round((params.hi ?? 0.75) * 100)}%`);
    }
    case 'slope': {
      const bars = Array.from({ length: 34 }, (_, i) => {
        const s = (Math.sin(i * 0.62) * 0.4 + Math.sin(i * 1.7) * 0.3 + 0.5);
        const on = s >= (params.lo ?? 0.25) && s <= (params.hi ?? 0.9);
        return `<rect x="${6 + i * 11.6}" y="${100 - s * 82}" width="8" height="${s * 82}" rx="2" fill="${on ? '#d6a078' : '#4a4238'}" opacity="${on ? 0.85 : 0.5}"/>`;
      }).join('');
      return wrapMask(bars, '', 'SLOPE BAND · STEEPNESS FILTER');
    }
    case 'strata': {
      const bands = Array.from({ length: 6 }, (_, i) =>
        `<rect x="0" y="${8 + i * 17}" width="400" height="9" rx="4" fill="#d6a078" opacity="${0.18 + (i % 2) * 0.35}"/>`).join('');
      return wrapMask(bands, '', `STRATA · ${params.frequency ?? 3.2}× BAND FREQUENCY`);
    }
    case 'rift': {
      const lines = Array.from({ length: 4 }, (_, i) => {
        const x = 60 + i * 90;
        return `<path d="M${x} 0 C${x + 22} 28 ${x - 18} 56 ${x + 8} 88 L${x - 4} 110" stroke="#d6a078" stroke-width="${2 + (params.width ?? 0.35) * 6}" fill="none" opacity=".7"/>`;
      }).join('');
      return wrapMask(lines, '', 'RIFTS · FRACTURE NETWORK');
    }
    case 'cliff': {
      const th = params.threshold ?? 0.45;
      const bars = Array.from({ length: 22 }, (_, i) => {
        const s = Math.abs(Math.sin(i * 0.9));
        return `<rect x="${8 + i * 17.6}" y="${100 - s * 84}" width="11" height="${s * 84}" rx="2" fill="${s > th ? '#d6a078' : '#4a4238'}" opacity="${s > th ? 0.9 : 0.45}"/>`;
      }).join('');
      return wrapMask(bars, '', 'CLIFF FACES · STEEP THRESHOLD');
    }
    case 'noise': {
      const blobs = Array.from({ length: 42 }, (_, i) => {
        const n = valueNoise(params.seed ?? 7, (i % 7) * 0.14, Math.floor(i / 7) * 0.16, params.scale ?? 2.5);
        const on = smoothstep((params.threshold ?? 0.42) - (params.softness ?? 0.3), (params.threshold ?? 0.42) + (params.softness ?? 0.3), n);
        return `<rect x="${(i % 7) * 57 + 2}" y="${Math.floor(i / 7) * 18 + 2}" width="53" height="14" rx="4" fill="#d6a078" opacity="${on * 0.75}"/>`;
      }).join('');
      return wrapMask(blobs, '', 'NOISE PATTERN · GENERATOR MASK');
    }
    case 'flow': {
      const lines = `<path d="M30 6 C90 30 140 40 200 58 C260 74 310 88 380 104" stroke="#74bdd4" stroke-width="3.5" fill="none"/>
        <path d="M110 4 C150 26 170 40 200 58" stroke="#74bdd4" stroke-width="2" fill="none" opacity=".65"/>
        <path d="M290 8 C270 32 240 48 200 58" stroke="#74bdd4" stroke-width="2" fill="none" opacity=".65"/>`;
      return wrapMask(lines, '', 'RIVERS & FLOW · DRAINAGE LINES');
    }
    default:
      return wrapMask(`<rect x="0" y="0" width="400" height="110" fill="#2c2c2c"/><text x="200" y="60" text-anchor="middle" font-size="11" fill="#777">UNMASKED</text>`, '', 'NO MASK');
  }
}

function wrapMask(body, defs, caption) {
  return `<div class="mask-diagram"><svg viewBox="0 0 400 110" role="img" aria-label="${caption}">${defs}<rect width="400" height="110" rx="8" fill="#1b1b1b"/>${body}</svg>
  <div class="diagram-caption"><span>${caption}</span></div></div>`;
}

/** Satmap ramp preview with the two colours + threshold markers. */
export function rampDiagram(layer) {
  const { lo = 0.35, hi = 0.75, softness = 0.18 } = layer.ramp || {};
  return `<div class="ramp-diagram">
    <div class="gradient-strip" style="background:linear-gradient(90deg, ${layer.colorA} 0%, ${layer.colorA} ${lo * 100}%, ${layer.colorB} ${Math.min(100, hi * 100)}%, ${layer.colorB} 100%)"></div>
    <svg viewBox="0 0 400 26" role="img" aria-label="Ramp thresholds">
      <path d="M0 12 H400" stroke="#ffffff14"/>
      <path d="M${lo * 400} 2 V22" stroke="#d0d0d0" stroke-width="1.2"/>
      <path d="M${hi * 400} 2 V22" stroke="#d0d0d0" stroke-width="1.2"/>
      <rect x="${Math.max(0, (lo - softness) * 400)}" y="6" width="${softness * 800}" height="14" fill="#ffffff0d"/>
      <text x="${lo * 400}" y="24" font-size="8" fill="#8a8a8a" text-anchor="middle">LO</text>
      <text x="${hi * 400}" y="24" font-size="8" fill="#8a8a8a" text-anchor="middle">HI</text>
    </svg>
    <div class="diagram-caption"><span>SIGNAL RAMP</span><span>${Math.round(lo * 100)} → ${Math.round(hi * 100)}</span></div>
  </div>`;
}

/** Hydraulic budget bars. */
export function dropletBudget(droplets = 28000, lifetime = 42) {
  const cells = Math.round(droplets * lifetime / 1000);
  return `<div class="erosion-art">${Array.from({ length: 9 }, (_, i) => {
    const hh = 12 + ((i * 53 + cells) % 60) * (droplets / 90000);
    return `<div><i style="height:${Math.min(70, hh)}px"></i><i style="height:${Math.min(70, hh * 0.7)}px"></i><i style="height:${Math.min(70, hh * 0.45)}px"></i></div>`;
  }).join('')}</div>`;
}
