// Three.js materials. Surface textures are generated procedurally on canvas so
// the editor ships without binary assets. Tiling is world-space (4 m per tile).
import * as THREE from 'three';

type TexKind = 'asphalt' | 'concrete' | 'brick' | 'cobble' | 'gravel' | 'dirt' | 'paving' | 'grass' | 'plain';

interface Spec {
  color: number;
  tex?: TexKind;
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  polyOffset?: boolean;
  doubleSided?: boolean;
}

const SPECS: Record<string, Spec> = {
  surf_asphalt: { color: 0xffffff, tex: 'asphalt', rough: 0.92 },
  surf_concrete: { color: 0xd3d0c9, tex: 'concrete', rough: 0.85 },
  surf_brick: { color: 0xc27354, tex: 'brick', rough: 0.9 },
  surf_cobble: { color: 0x9b9184, tex: 'cobble', rough: 0.95 },
  surf_gravel: { color: 0xc9bca4, tex: 'gravel', rough: 1 },
  surf_dirt: { color: 0x9a7650, tex: 'dirt', rough: 1 },
  surf_paving: { color: 0xc3bcab, tex: 'paving', rough: 0.85 },
  sidewalk: { color: 0xe2dfd8, tex: 'concrete', rough: 0.85 },
  curb: { color: 0xb8b4ab, tex: 'concrete', rough: 0.9 },
  grass: { color: 0x7fa85a, tex: 'grass', rough: 1 },
  bus: { color: 0xb8362d, tex: 'asphalt', rough: 0.8 },
  bike: { color: 0x2f8052, tex: 'asphalt', rough: 0.8 },
  gravel: { color: 0xb7a98f, tex: 'gravel', rough: 1 },
  paint_white: { color: 0xf4f4ef, rough: 0.6, polyOffset: true },
  paint_yellow: { color: 0xf2b92a, rough: 0.6, polyOffset: true },
  ballast: { color: 0x8a847c, tex: 'gravel', rough: 1 },
  steel: { color: 0xc8cdd3, metal: 0.8, rough: 0.35 },
  sleeper: { color: 0x6b4f3a, rough: 0.9 },
  crossing_pad: { color: 0x4a4644, tex: 'asphalt', rough: 0.9, polyOffset: true },
  gate: { color: 0xd62b2b, rough: 0.5 },
  pole: { color: 0x6f757d, metal: 0.5, rough: 0.45 },
  lamp: { color: 0xfff6dc, emissive: 0xffe8b0, emissiveIntensity: 1.6 },
  lamp_red: { color: 0xff3030, emissive: 0xff1010, emissiveIntensity: 2.0 },
  bollard_white: { color: 0xf3f3f1, rough: 0.5 },
  bollard_yellow: { color: 0xf2b705, rough: 0.5 },
  glass: { color: 0x9fd0ea, rough: 0.2, opacity: 0.4 },
  shelter: { color: 0x33414d, metal: 0.4, rough: 0.5 },
  bench: { color: 0x7a5a3a, rough: 0.8 },
  bus_sign: { color: 0x1f5fb0, rough: 0.6 },
  bump: { color: 0xd9a521, tex: 'asphalt', rough: 0.85 },
  station: { color: 0x59616b, rough: 0.7 },
  metro: { color: 0x0a6fbf, rough: 0.5 },
  tunnel: { color: 0x2fd3ff, rough: 0.5, opacity: 0.18, doubleSided: true },
};

const textureCache = new Map<TexKind, THREE.CanvasTexture>();

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function paint(kind: TexKind): HTMLCanvasElement {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d')!;
  const r = rng(kind.length * 9973 + kind.charCodeAt(0));
  const speck = (count: number, cols: string[], size: number) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(r() * N, r() * N, size, size);
    }
  };
  switch (kind) {
    case 'asphalt':
      g.fillStyle = '#6c6f73';
      g.fillRect(0, 0, N, N);
      speck(2600, ['#55585c', '#7e8286', '#5c5f63', '#8a8d91'], 1.5);
      speck(120, ['#3c3e42'], 3);
      break;
    case 'concrete':
      g.fillStyle = '#c4c1ba';
      g.fillRect(0, 0, N, N);
      speck(1200, ['#b5b2ab', '#cfccc5'], 2);
      g.strokeStyle = '#8f8c86';
      g.lineWidth = 2;
      for (let i = 0; i <= N; i += 128) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke();
      }
      break;
    case 'paving':
      g.fillStyle = '#c5bda9';
      g.fillRect(0, 0, N, N);
      g.strokeStyle = '#968e7c';
      g.lineWidth = 2;
      for (let i = 0; i <= N; i += 64) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke();
      }
      speck(600, ['#b3aa96', '#d4cdbd'], 3);
      break;
    case 'brick':
      g.fillStyle = '#8f5a44';
      g.fillRect(0, 0, N, N);
      for (let row = 0; row < 16; row++) {
        const off = row % 2 ? 16 : 0;
        for (let col = -1; col < 8; col++) {
          g.fillStyle = `hsl(${12 + r() * 8} ${40 + r() * 15}% ${40 + r() * 12}%)`;
          g.fillRect(col * 32 + off + 1, row * 16 + 1, 30, 14);
        }
      }
      break;
    case 'cobble':
      g.fillStyle = '#6e675e';
      g.fillRect(0, 0, N, N);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `hsl(30 ${5 + r() * 8}% ${35 + r() * 25}%)`;
        g.beginPath();
        g.ellipse(r() * N, r() * N, 7 + r() * 4, 5 + r() * 3, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'gravel':
      g.fillStyle = '#a79c86';
      g.fillRect(0, 0, N, N);
      speck(2400, ['#8c826f', '#c4b9a1', '#77705f', '#d6ccb4'], 2.5);
      break;
    case 'dirt':
      g.fillStyle = '#7b5d3b';
      g.fillRect(0, 0, N, N);
      speck(2000, ['#6a4f31', '#8e6e47', '#5a4329'], 3);
      break;
    case 'grass':
      g.fillStyle = '#7a9f52';
      g.fillRect(0, 0, N, N);
      speck(3000, ['#6c9046', '#8ab364', '#5f8040', '#97bd70'], 2);
      break;
    default:
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, N, N);
  }
  return c;
}

export function texture(kind: TexKind): THREE.CanvasTexture {
  let t = textureCache.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(paint(kind));
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    textureCache.set(kind, t);
  }
  return t;
}

const materialCache = new Map<string, THREE.Material>();

export function material(name: string): THREE.Material {
  let m = materialCache.get(name);
  if (m) return m;
  const s = SPECS[name] ?? { color: 0xff00ff };
  const common = {
    color: s.color,
    roughness: s.rough ?? 0.8,
    metalness: s.metal ?? 0,
    side: THREE.DoubleSide,
    map: s.tex ? texture(s.tex) : null,
    polygonOffset: !!s.polyOffset,
    polygonOffsetFactor: s.polyOffset ? -2 : 0,
    polygonOffsetUnits: s.polyOffset ? -2 : 0,
  };
  if (s.emissive !== undefined) {
    m = new THREE.MeshStandardMaterial({ ...common, emissive: s.emissive, emissiveIntensity: s.emissiveIntensity ?? 1 });
  } else if (s.opacity !== undefined) {
    m = new THREE.MeshStandardMaterial({ ...common, transparent: true, opacity: s.opacity, depthWrite: false });
  } else {
    m = new THREE.MeshStandardMaterial(common);
  }
  materialCache.set(name, m);
  return m;
}

export function groundMaterial(): THREE.MeshStandardMaterial {
  const t = texture('grass').clone();
  t.repeat.set(2500, 2500);
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color: 0x9ab97c, map: t, roughness: 1 });
}
